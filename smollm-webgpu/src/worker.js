import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  InterruptableStoppingCriteria,
} from "@huggingface/transformers";

/**
 * Helper function to perform feature detection for WebGPU
 */
// let fp16_supported = false; // Currently unused, keep for reference
async function check() {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("WebGPU is not supported (no adapter found)");
    }
    // fp16_supported = adapter.features.has("shader-f16")
  } catch (e) {
    self.postMessage({
      status: "error",
      data: e.toString(),
    });
  }
}

/**
 * This class uses the Singleton pattern to enable lazy-loading of the pipeline
 */
class TextGenerationPipeline {
  static model_id = "HuggingFaceTB/SmolLM2-1.7B-Instruct";

  static async getInstance(progress_callback = null) {
    this.tokenizer ??= AutoTokenizer.from_pretrained(this.model_id, {
      progress_callback,
    });

    this.model ??= AutoModelForCausalLM.from_pretrained(this.model_id, {
      dtype: "q4f16", // Quantized 4-bit float 16, optimized for performance
      device: "webgpu", // Use WebGPU for accelerated inference
      progress_callback,
    });

    return Promise.all([this.tokenizer, this.model]);
  }
}

const stopping_criteria = new InterruptableStoppingCriteria();

let past_key_values_cache = null;
let currentRequestId = null; // NEW: Global variable to store the request ID for cell updates

async function generate(messages, requestId = null) { // NEW: Accept requestId
  currentRequestId = requestId; // Store the current request ID

  // Retrieve the text-generation pipeline.
  const [tokenizer, model] = await TextGenerationPipeline.getInstance();

  const inputs = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true, // Add a prompt for generation based on chat history
    return_dict: true, // Return as a dictionary for model input
  });

  let startTime;
  let numTokens = 0;
  let tps;

  const token_callback_function = () => {
    startTime ??= performance.now(); // Start timer on first token

    if (numTokens++ > 0) { // Increment tokens and calculate TPS after the first token
      tps = (numTokens / (performance.now() - startTime)) * 1000;
    }
  };

  const callback_function = (output) => {
    // This callback is called for each streamed output token/chunk
    self.postMessage({
      status: "update",
      output,
      tps,
      numTokens,
      requestId: currentRequestId, // NEW: Include requestId
    });
  };

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true, // Don't include the prompt in the streamed output
    skip_special_tokens: true, // Don't include special tokens (e.g., EOS) in output
    callback_function,
    token_callback_function,
  });

  // Tell the main thread we are starting generation
  self.postMessage({ status: "start", requestId: currentRequestId }); // NEW: Include requestId

  try {
    const { past_key_values, sequences } = await model.generate({
      ...inputs,
      past_key_values: past_key_values_cache, // Use cache for conversational memory

      // Sampling parameters (commented out by default)
      // do_sample: true,
      // top_k: 3,
      // temperature: 0.2,

      max_new_tokens: 1024, // Maximum number of tokens to generate
      streamer, // Stream output to the main thread
      stopping_criteria, // Allow interruption
      return_dict_in_generate: true, // Return a dictionary with sequences and past_key_values
    });
    past_key_values_cache = past_key_values; // Update cache for next turn

    const decoded = tokenizer.batch_decode(sequences, {
      skip_special_tokens: true, // Decode the full sequence without special tokens
    });

    // Send the final output back to the main thread
    self.postMessage({
      status: "complete",
      output: decoded[0], // Send the complete, decoded string from the generated sequence
      tps, // Include tps and numTokens for complete message
      numTokens,
      requestId: currentRequestId, // NEW: Include requestId
    });

  } catch (error) {
    console.error("Worker generation error:", error);
    self.postMessage({
      status: "error",
      data: error.message,
      requestId: currentRequestId, // NEW: Include requestId in error
    });
  } finally {
    currentRequestId = null; // Reset requestId after completion or error to prevent cross-contamination
  }
}

async function load() {
  self.postMessage({
    status: "loading",
    data: "Loading model...",
  });

  // Load the pipeline and save it for future use.
  const [tokenizer, model] = await TextGenerationPipeline.getInstance((x) => {
    // We also add a progress callback to the pipeline so that we can
    // track model loading.
    self.postMessage(x);
  });

  self.postMessage({
    status: "loading",
    data: "Compiling shaders and warming up model...",
  });

  // Run model with dummy input to compile shaders and warm up the model
  const inputs = tokenizer("a");
  await model.generate({ ...inputs, max_new_tokens: 1 });
  self.postMessage({ status: "ready" });
}

// Listen for messages from the main thread
self.addEventListener("message", async (e) => {
  const { type, data, requestId } = e.data; // NEW: Destructure requestId from event data

  switch (type) {
    case "check":
      check();
      break;

    case "load":
      load();
      break;

    case "generate": // Existing chat-based generation
      stopping_criteria.reset();
      generate(data); // Call generate without a requestId (for chat)
      break;

    case "generate-for-cell": // NEW: Handle requests specifically for cell output
      stopping_criteria.reset();
      generate(data, requestId); // Call generate and pass the requestId
      break;

    case "interrupt":
      stopping_criteria.interrupt();
      break;

    case "reset":
      past_key_values_cache = null; // Clear conversational memory
      stopping_criteria.reset();
      currentRequestId = null; // Ensure requestId is also reset on full reset
      break;
  }
});
