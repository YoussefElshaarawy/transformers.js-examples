// worker.js

import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  InterruptableStoppingCriteria,
} from "@huggingface/transformers";

/**
 * Helper function to perform feature detection for WebGPU
 */
// let fp16_supported = false; // Keep original for now, if you use it later.
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
      dtype: "q4f16",
      device: "webgpu",
      progress_callback,
    });

    return Promise.all([this.tokenizer, this.model]);
  }
}

const stopping_criteria = new InterruptableStoppingCriteria();

// --- UPDATED: past_key_values_cache will only be used for regular chat conversations ---
let past_key_values_cache = null;

// --- NEW: Track the current smollmRequestId being processed ---
let currentSmollmRequestId = null;

async function generate(messages, smollmRequestId) {
  // Retrieve the text-generation pipeline.
  const [tokenizer, model] = await TextGenerationPipeline.getInstance();

  // --- NEW: Set the current smollmRequestId for this generation, if provided ---
  currentSmollmRequestId = smollmRequestId || null;

  // The inputs will be different depending on whether it's an SMOLLM call or a chat call.
  // For SMOLLM, the 'messages' array will typically just contain one user message (the prompt).
  // For chat, it will contain the full history.

  const inputs = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    return_dict: true,
  });

  let startTime;
  let numTokens = 0;
  let tps;
  const token_callback_function = () => {
    startTime ??= performance.now();

    if (numTokens++ > 0) {
      tps = (numTokens / (performance.now() - startTime)) * 1000;
    }
  };

  const callback_function = (output) => {
    // --- UPDATED: Pass smollmRequestId with 'update' messages ---
    self.postMessage({
      status: "update",
      output,
      tps,
      numTokens,
      smollmRequestId: currentSmollmRequestId, // Will be null for regular chat
    });
  };

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function,
    token_callback_function,
  });

  // Tell the main thread we are starting
  // --- UPDATED: Pass smollmRequestId with 'start' message ---
  self.postMessage({
    status: "start",
    smollmRequestId: currentSmollmRequestId, // Will be null for regular chat
  });

  // --- UPDATED: Only use past_key_values_cache for non-SMOLLM (chat) requests ---
  const current_past_key_values = smollmRequestId ? null : past_key_values_cache;

  const { past_key_values, sequences } = await model.generate({
    ...inputs,
    past_key_values: current_past_key_values, // Use null for SMOLLM, cache for chat

    // Sampling (keep your original settings)
    // do_sample: true,
    // top_k: 3,
    // temperature: 0.2,

    max_new_tokens: 1024,
    streamer,
    stopping_criteria,
    return_dict_in_generate: true,
  });

  // --- UPDATED: Only update past_key_values_cache for non-SMOLLM (chat) requests ---
  if (!smollmRequestId) {
    past_key_values_cache = past_key_values;
  }

  const decoded = tokenizer.batch_decode(sequences, {
    skip_special_tokens: true,
  });

  // Send the output back to the main thread
  // --- UPDATED: Pass smollmRequestId with 'complete' message ---
  self.postMessage({
    status: "complete",
    output: decoded.join(''), // Join the array of strings to a single string for final output
    tps, // Include tps for chat summary
    numTokens, // Include numTokens for chat summary
    smollmRequestId: currentSmollmRequestId, // Will be null for regular chat
  });

  // --- NEW: Clear the smollmRequestId after completion/error ---
  currentSmollmRequestId = null;
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

  // Run model with dummy input to compile shaders
  const inputs = tokenizer("a");
  await model.generate({ ...inputs, max_new_tokens: 1 });
  self.postMessage({ status: "ready" });
}

// Listen for messages from the main thread
self.addEventListener("message", async (e) => {
  // --- UPDATED: Destructure smollmRequestId from e.data ---
  const { type, data, smollmRequestId } = e.data;

  switch (type) {
    case "check":
      check();
      break;

    case "load":
      load();
      break;

    case "generate":
      stopping_criteria.reset();
      // --- UPDATED: Pass smollmRequestId to the generate function ---
      generate(data, smollmRequestId);
      break;

    case "interrupt":
      stopping_criteria.interrupt();
      // When interrupted, the model generation will eventually stop and send a 'complete' or 'error' message.
      // We need to ensure that if it was an SMOLLM request, its promise is resolved.
      // This is handled in App.jsx's `onMessageReceived` for 'complete'/'error' statuses.
      break;

    case "reset":
      past_key_values_cache = null;
      stopping_criteria.reset();
      break;
  }
});
