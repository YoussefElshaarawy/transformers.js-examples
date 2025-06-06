// worker.js

// Example simplified worker.js structure for illustration purposes.
// Your actual worker.js likely has more complex logic for model inference
// using @huggingface/transformers.js. You will need to integrate these
// changes into your existing worker's message handling flow.

import { pipeline } from '@huggingface/transformers';

let generator = null; // Stores the loaded AI pipeline

// --- NEW: Variables to track the current generation's context ---
let currentAccumulatedOutput = ""; // Accumulates output for the current generation
let currentSmollmRequestId = null;  // Stores the SMOLLM request ID for the current generation

self.addEventListener('message', async (e) => {
    // --- UPDATED: Destructure smollmRequestId from the incoming message data ---
    const { type, data, smollmRequestId } = e.data;

    switch (type) {
        case 'check':
            // Basic feature check logic. Send 'ready' if successful.
            try {
                // Perform necessary checks (e.g., WebGPU availability)
                // For a real app, this might involve more sophisticated checks
                self.postMessage({ status: 'ready' });
            } catch (error) {
                self.postMessage({ status: 'error', data: `Feature check failed: ${error.message}` });
            }
            break;

        case 'load':
            self.postMessage({ status: 'loading', data: 'Loading model...' });
            try {
                // Simulate loading progress and then load the actual pipeline
                self.postMessage({ status: 'initiate', file: 'model_weights.bin', total: 100 });
                await new Promise(r => setTimeout(r, 500)); // Simulate delay
                self.postMessage({ status: 'progress', file: 'model_weights.bin', progress: 50, total: 100 });
                await new Promise(r => setTimeout(r, 500)); // Simulate delay
                self.postMessage({ status: 'progress', file: 'model_weights.bin', progress: 100, total: 100 });
                self.postMessage({ status: 'done', file: 'model_weights.bin' });

                // Initialize the AI model pipeline
                generator = await pipeline('text-generation', 'HuggingFaceTB/SmolLM2-1.7B-Instruct', {
                    // Add any specific model loading options you use here
                });
                self.postMessage({ status: 'ready' });
            } catch (error) {
                self.postMessage({ status: 'error', data: error.message });
            }
            break;

        case 'generate':
            if (!generator) {
                // --- UPDATED: Include smollmRequestId in error messages too ---
                self.postMessage({ status: 'error', data: 'Model not loaded.', smollmRequestId: smollmRequestId });
                return;
            }

            // --- NEW: Reset for a new generation ---
            currentAccumulatedOutput = "";
            // --- NEW: Store the smollmRequestId if this is an SMOLLM-initiated generation ---
            currentSmollmRequestId = smollmRequestId || null;

            try {
                // --- UPDATED: Pass smollmRequestId with 'start' message ---
                self.postMessage({
                    status: 'start',
                    smollmRequestId: currentSmollmRequestId // Will be null for regular chat
                });

                // Extract the latest user prompt from the chat history
                const prompt = data.at(-1).content;

                // Perform AI text generation with a callback for streaming output
                const result = await generator(prompt, {
                    max_new_tokens: 100, // Or whatever max tokens you need
                    do_sample: true,
                    temperature: 0.7,
                    // The callback_function gets called with each new token/chunk
                    callback_function: (chunk) => {
                        const output = chunk.text;
                        currentAccumulatedOutput += output; // Accumulate the full output

                        // --- UPDATED: Pass smollmRequestId with 'update' message ---
                        self.postMessage({
                            status: 'update',
                            output: output,
                            tps: 20, // Simulated TPS, replace with actual calculation if available
                            numTokens: currentAccumulatedOutput.length, // Simulated token count
                            smollmRequestId: currentSmollmRequestId // Will be null for regular chat
                        });
                    },
                });

                // Generation is complete
                // --- UPDATED: Pass smollmRequestId and the final accumulated output with 'complete' message ---
                self.postMessage({
                    status: 'complete',
                    output: currentAccumulatedOutput, // Send the full accumulated output
                    smollmRequestId: currentSmollmRequestId, // Will be null for regular chat
                    tps: 20, // Simulated TPS for chat summary
                    numTokens: currentAccumulatedOutput.length // Simulated token count for chat summary
                });

            } catch (error) {
                // Handle any errors during generation
                self.postMessage({
                    status: 'error',
                    data: error.message,
                    // --- UPDATED: Pass smollmRequestId on error ---
                    smollmRequestId: currentSmollmRequestId
                });
            } finally {
                // --- NEW: Clear the current request ID after generation completes or errors ---
                currentSmollmRequestId = null;
                currentAccumulatedOutput = "";
            }
            break;

        case 'interrupt':
            // Logic to stop ongoing generation if your model pipeline supports it.
            // For example: generator.stop();
            console.log("Generation interrupted by user.");
            // You might need to send a 'complete' message here after stopping
            // to ensure App.jsx cleans up its state.
            // self.postMessage({ status: 'complete', smollmRequestId: currentSmollmRequestId, output: currentAccumulatedOutput });
            break;

        case 'reset':
            // Logic to reset the model or internal state.
            // For example: generator = null;
            break;

        default:
            console.warn('Unknown message type:', type);
    }
});
