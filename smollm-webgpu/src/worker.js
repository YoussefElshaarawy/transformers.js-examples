import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  InterruptableStoppingCriteria,
} from "@huggingface/transformers";

/**
 * Helper function to perform feature detection for WebGPU
 */
// let fp16_supported = false; // Kept as comment as in original
async function check() {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("WebGPU is not supported (no adapter found)");
    }
    // fp16_supported = adapter.features.has("shader-f16") // Kept commented
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
      dtype: "q4f16",
      device: "webgpu",
      progress_callback,
    });

    return Promise.all([this.tokenizer, this.model]);
  }
}

const stopping_criteria = new InterruptableStoppingCriteria();

let past_key_values_cache = null; // This cache is specifically for *chat* history to maintain context

/**
 * Generates text for the chat interface, supporting multi-turn conversations.
 * @param {Array<{role: string, content: string}>} messages The conversation history for the model.
 */
async function generateChat(messages) {
  // Retrieve the text-generation pipeline.
  const [tokenizer, model] = await TextGenerationPipeline.getInstance();

  const inputs = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    return_dict: true,
  });

  let startTime;
  let numTokens = 0;
  let tps;
  const token_callback_function = () => {
    startTime ??= performance.now(); // Start timer on first token received
    if (numTokens++ > 0) { // Increment after check to avoid 0/time for first token in calculation
      tps = (numTokens / (performance.now() - startTime)) * 1000;
    }
  };
  const callback_function = (output) => {
    self.postMessage({
      status: "chat_update", // Specific status for chat updates
      output,
      tps,
      numTokens,
    });
  };

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function,
    token_callback_function,
  });

  // Tell the main thread we are starting chat generation
  self.postMessage({ status: "chat_start" }); // Specific status for chat start

  const { past_key_values, sequences } = await model.generate({
    ...inputs,
    past_key_values: past_key_values_cache, // Use cache for chat context

    // Sampling (kept commented as per your original)
    // do_sample: true,
    // top_k: 3,
    // temperature: 0.2,

    max_new_tokens: 1024, // Generous max tokens for chat responses
    streamer, // Use streamer for incremental chat updates
    stopping_criteria,
    return_dict_in_generate: true,
  });
  past_key_values_cache = past_key_values; // Update cache for next turn in chat

  // The streamer has already handled sending updates incrementally.
  // We can decode here for internal logging or if a final full string is needed on worker side.
  // const decoded = tokenizer.batch_decode(sequences, { skip_special_tokens: true });

  // Send the complete signal back to the main thread
  self.postMessage({
    status: "chat_complete", // Specific status for chat complete
    // 'output' is not sent here as it was streamed; App.jsx handles assembly.
  });
}

/**
 * Generates a response for a spreadsheet cell query.
 * @param {string} prompt The specific prompt for the AI.
 * @param {string} targetCell The ID of the spreadsheet cell to update (e.g., "A1").
 */
async function generateForSheet(prompt, targetCell) {
    // Retrieve the text-generation pipeline.
    const [tokenizer, model] = await TextGenerationPipeline.getInstance();

    // Prepare inputs for a single turn. We wrap the prompt in a user role for the chat template.
    const inputs = tokenizer.apply_chat_template([{ role: "user", content: prompt }], {
      add_generation_prompt: true,
      return_dict: true,
    });

    // For sheet updates, we generally don't stream. We get the full output and send it once.
    // Also, sheet queries are typically isolated, so we don't use 'past_key_values_cache'.
    const { sequences } = await model.generate({
        ...inputs,
        // No 'past_key_values' for single sheet queries, treat as fresh
        max_new_tokens: 256, // Limit tokens for sheet generation for brevity
        stopping_criteria,
        return_dict_in_generate: true,
    });

    const decoded = tokenizer.batch_decode(sequences, {
        skip_special_tokens: true,
    });

    // Send the output back to the main thread with the target cell ID
    self.postMessage({
        status: "ai_sheet_complete", // Specific status for sheet generation complete
        output: decoded[0], // Assuming the first output is the desired cell value
        targetCell: targetCell, // Pass back the target cell ID
    });
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

  // Run model with dummy input to compile shaders (warm-up)
  const inputs = tokenizer("a");
  await model.generate({ ...inputs, max_new_tokens: 1 });
  self.postMessage({ status: "ready" });
}

// Listen for messages from the main thread
self.addEventListener("message", async (e) => {
  const { type, data } = e.data;

  switch (type) {
    case "check":
      check();
      break;

    case "load":
      load();
      break;

    case "generate": // This type is now exclusively for chat interactions
      stopping_criteria.reset();
      // 'data' here is the full 'messages' array from App.jsx for chat
      await generateChat(data); // Call the dedicated chat generation function
      break;

    case "ai_sheet_generate": // New case for spreadsheet interactions
      stopping_criteria.reset(); // Reset stopping criteria for this new generation
      // 'data' here is { prompt: string, targetCell: string }
      await generateForSheet(data.prompt, data.targetCell); // Call the dedicated sheet generation function
      break;

    case "interrupt":
      stopping_criteria.interrupt();
      break;

    case "reset":
      past_key_values_cache = null; // Clear chat history cache to start a fresh conversation
      stopping_criteria.reset();
      break;
  }
});
