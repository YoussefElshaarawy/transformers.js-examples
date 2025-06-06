// App.jsx

import { useEffect, useState, useRef } from "react";

import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";

// --- UPDATED: Import setWorkerMessenger AND setSmollmCompletionCallback ---
import { setWorkerMessenger, setSmollmCompletionCallback } from './univer-init.js';

const IS_WEBGPU_AVAILABLE = !!navigator.gpu;
const STICKY_SCROLL_THRESHOLD = 120;
const EXAMPLES = [
  "Give me some tips to improve my time management skills.",
  "What is the difference between AI and ML?",
  "Write python code to compute the nth fibonacci number.",
];

function App() {
  // Create a reference to the worker object.
  const worker = useRef(null);

  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);

  // Model loading and progress
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false);

  // Inputs and outputs
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);

  // --- NEW: Map to store ongoing SMOLLM responses to accumulate output for the cell ---
  // We use useRef because this map doesn't trigger re-renders itself,
  // and we need a mutable object that persists across renders.
  const smollmPendingOutputs = useRef(new Map());

  // --- NEW: Ref to hold the current generation ID for tracking which generation is active in the chat UI ---
  const currentChatGenerationId = useRef(null);

  function onEnter(message) {
    // For regular chat input, we don't have a smollmRequestId, so it's a new chat session/turn.
    // Set a temporary ID for tracking this specific chat generation in the UI.
    const newChatGenId = `chat-${Date.now()}`;
    currentChatGenerationId.current = newChatGenId;

    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setTps(null);
    setIsRunning(true);
    setInput("");

    // Trigger the worker directly with the new chat message.
    // The `useEffect` below will only trigger for the *last* user message,
    // which might include SMOLLM prompts if they are added to `messages` later.
    // By sending it here, we ensure regular chat is handled immediately.
    worker.current.postMessage({ type: "generate", data: [{ role: "user", content: message }], chatId: newChatGenId });
  }

  function onInterrupt() {
    worker.current.postMessage({ type: "interrupt" });
    // When interrupted, reset the current chat generation ID
    currentChatGenerationId.current = null;
    setIsRunning(false); // Manually set to false, as the worker might not send 'complete' immediately
  }

  useEffect(() => {
    resizeInput();
  }, [input]);

  function resizeInput() {
    if (!textareaRef.current) return;

    const target = textareaRef.current;
    target.style.height = "auto";
    const newHeight = Math.min(Math.max(target.scrollHeight, 24), 200);
    target.style.height = `${newHeight}px`;
  }

  useEffect(() => {
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
      worker.current.postMessage({ type: "check" });
    }

    // --- UPDATED: Provide the worker messenger to univer-init.js ---
    setWorkerMessenger((message) => {
        if (worker.current) {
            worker.current.postMessage(message);
        } else {
            console.error("AI worker not ready for spreadsheet request.");
        }
    });

    // --- NEW: Provide the SMOLLM completion callback to univer-init.js ---
    // This function will be called by App.jsx when an SMOLLM generation is complete
    // It's used by univer-init.js to resolve the promise for the cell.
    // We pass it a function that *uses* the internal `smollmPendingOutputs` map.
    const smollmCompletionCallback = (requestId, finalOutput) => {
        // The actual logic for resolving the promise and updating the cell is in univer-init.js.
        // We simply provide this bridge function to univer-init.js.
        // There's no direct action needed here in App.jsx for the cell itself.
        // But we need to ensure the `smollmPendingOutputs` map is cleaned up.
        smollmPendingOutputs.current.delete(requestId);
    };
    setSmollmCompletionCallback(smollmCompletionCallback);


    // Create a callback function for messages from the worker thread.
    const onMessageReceived = (e) => {
      // --- NEW: Extract smollmRequestId if present in the worker message ---
      const smollmRequestId = e.data.smollmRequestId;
      // --- NEW: Also extract the optional chatId, for distinguishing chat generations ---
      const chatId = e.data.chatId;

      switch (e.data.status) {
        case "loading":
          setStatus("loading");
          setLoadingMessage(e.data.data);
          break;

        case "initiate":
          setProgressItems((prev) => [...prev, e.data]);
          break;

        case "progress":
          setProgressItems((prev) =>
            prev.map((item) => {
              if (item.file === e.data.file) {
                return { ...item, ...e.data };
              }
              return item;
            }),
          );
          break;

        case "done":
          setProgressItems((prev) =>
            prev.filter((item) => item.file !== e.data.file),
          );
          break;

        case "ready":
          setStatus("ready");
          break;

        case "start":
          {
            // Start generation
            // --- UPDATED: Only add a new assistant message to chat if it's a regular chat generation ---
            // If it's an SMOLLM request, we only want to accumulate its output for the cell.
            // We'll add the *final* SMOLLM output to chat at 'complete' if desired.
            if (!smollmRequestId) {
                setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: "" },
                ]);
            } else {
                // --- NEW: If it's an SMOLLM request, initialize its output accumulation ---
                smollmPendingOutputs.current.set(smollmRequestId, "");
            }
          }
          break;

        case "update":
          {
            const { output, tps, numTokens } = e.data;
            setTps(tps);
            setNumTokens(numTokens);

            // --- UPDATED: Conditional logic for updating chat vs. accumulating for SMOLLM ---
            if (!smollmRequestId) {
                // This is a regular chat generation. Update the last message.
                // We also check if this update matches the currently active chat generation.
                // This handles potential race conditions if multiple 'generate' requests are sent.
                if (chatId === currentChatGenerationId.current) {
                    setMessages((prev) => {
                        const cloned = [...prev];
                        const last = cloned.at(-1);
                        cloned[cloned.length - 1] = {
                            ...last,
                            content: last.content + output,
                        };
                        return cloned;
                    });
                }
            } else {
                // This is an SMOLLM request. Accumulate output.
                const currentAccumulatedOutput = smollmPendingOutputs.current.get(smollmRequestId) || "";
                smollmPendingOutputs.current.set(smollmRequestId, currentAccumulatedOutput + output);
            }
          }
          break;

        case "complete":
          setIsRunning(false);
          currentChatGenerationId.current = null; // Clear the active chat generation ID

          // --- NEW: Handle SMOLLM formula completion ---
          if (smollmRequestId) {
              const finalOutput = smollmPendingOutputs.current.get(smollmRequestId) || "";

              // Use the callback provided by univer-init.js to resolve its promise for the cell
              // We retrieve the function reference from `_smollmCompletionCallback` via `univer-init.js` export
              const completionCallbackFromUniver = univer_init_module.setSmollmCompletionCallback; // Assuming `univer-init.js` exports `setSmollmCompletionCallback`
              if (typeof completionCallbackFromUniver === 'function') {
                  completionCallbackFromUniver(smollmRequestId, finalOutput);
              }

              // --- NEW: Optionally, add the completed SMOLLM response to the chat as well ---
              // Add a user prompt to the chat that reflects the SMOLLM call,
              // then the assistant's response.
              // Note: The prompt from SMOLLM is `e.data.prompt` if the worker sent it,
              // otherwise you might need to find a way to get it from `univer-init.js` side.
              // For simplicity, let's assume `e.data.data` from the original 'generate' message
              // contained the prompt. If not, you'll need to adapt this.
              const originalPrompt = e.data.originalPromptForSmollm; // Assuming worker could send this back
              if (originalPrompt) {
                  setMessages((prev) => [
                      ...prev,
                      { role: "user", content: originalPrompt }, // Display the prompt that generated the SMOLLM output
                      { role: "assistant", content: finalOutput }
                  ]);
              } else {
                  setMessages((prev) => [
                      ...prev,
                      { role: "assistant", content: finalOutput } // Just add the assistant response
                  ]);
              }

              smollmPendingOutputs.current.delete(smollmRequestId); // Clean up
          } else {
              // Regular chat completion: update tps and numTokens for the chat UI
              setTps(e.data.tps);
              setNumTokens(e.data.numTokens);
          }
          break;

        case "error":
          setError(e.data.data);
          // --- NEW: Handle errors for SMOLLM calls ---
          if (smollmRequestId) {
            const completionCallbackFromUniver = univer_init_module.setSmollmCompletionCallback;
            if (typeof completionCallbackFromUniver === 'function') {
                completionCallbackFromUniver(smollmRequestId, `ERROR: ${e.data.data}`);
            }
            smollmPendingOutputs.current.delete(smollmRequestId); // Clean up
          } else {
            // If it's a chat error, append to chat as well
            setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${e.data.data}` }]);
          }
          setIsRunning(false);
          currentChatGenerationId.current = null;
          break;
      }
    };

    const onErrorReceived = (e) => {
      console.error("Worker error:", e);
      setError(e.message || "An unknown worker error occurred.");
      setIsRunning(false);
      currentChatGenerationId.current = null;
    };

    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, []); // Empty dependency array means this runs once on mount, attaching listeners.

  // --- UPDATED: Removed the useEffect that sends 'generate' messages based on 'messages' state ---
  // The `onEnter` function now directly triggers the worker for chat messages.
  // This prevents the `SMOLLM` formula's internal user message (if added to `messages` for display)
  // from accidentally triggering a *second* full chat generation.
  // The `SMOLLM` formula in `univer-init.js` will now directly send its request.

  useEffect(() => {
    if (!chatContainerRef.current || !isRunning) return;
    const element = chatContainerRef.current;
    if (
      element.scrollHeight - element.scrollTop - element.clientHeight <
      STICKY_SCROLL_THRESHOLD
    ) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, isRunning]);

  return IS_WEBGPU_AVAILABLE ? (
    <div className="flex flex-col h-screen mx-auto items justify-end text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900">
      {status === null && messages.length === 0 && (
        <div className="h-full overflow-auto scrollbar-thin flex justify-center items-center flex-col relative">
          <div className="flex flex-col items-center mb-1 max-w-[320px] text-center">
            <img
              src="logo.png"
              width="80%"
              height="auto"
              className="block"
            ></img>
            <h1 className="text-4xl font-bold mb-1">SmolLM2 WebGPU</h1>
            <h2 className="font-semibold">
              A blazingly fast and powerful AI chatbot that runs locally in your
              browser.
            </h2>
          </div>

          <div className="flex flex-col items-center px-4">
            <p className="max-w-[480px] mb-4">
              <br />
              You are about to load{" "}
              <a
                href="https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct"
                target="_blank"
                rel="noreferrer"
                className="font-medium underline"
              >
                SmolLM2-1.7B-Instruct
              </a>
              , a 1.7B parameter LLM optimized for in-browser inference.
              Everything runs entirely in your browser with{" "}
              <a
                href="https://huggingface.co/docs/transformers.js"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                🤗&nbsp;Transformers.js
              </a>{" "}
              and ONNX Runtime Web, meaning no data is sent to a server. Once
              loaded, it can even be used offline. The source code for the demo
              is available on{" "}
              <a
                href="https://github.com/huggingface/transformers.js-examples/tree/main/smollm-webgpu"
                target="_blank"
                rel="noreferrer"
                className="font-medium underline"
              >
                GitHub
              </a>
              .
            </p>

            {error && (
              <div className="text-red-500 text-center mb-2">
                <p className="mb-1">
                  Unable to load model due to the following error:
                </p>
                <p className="text-sm">{error}</p>
              </div>
            )}

            <button
              className="border px-4 py-2 rounded-lg bg-blue-400 text-white hover:bg-blue-500 disabled:bg-blue-100 disabled:cursor-not-allowed select-none"
              onClick={() => {
                worker.current.postMessage({ type: "load" });
                setStatus("loading");
              }}
              disabled={status !== null || error !== null}
            >
              Load model
            </button>
          </div>
        </div>
      )}
      {status === "loading" && (
        <>
          <div className="w-full max-w-[500px] text-left mx-auto p-4 bottom-0 mt-auto">
            <p className="text-center mb-1">{loadingMessage}</p>
            {progressItems.map(({ file, progress, total }, i) => (
              <Progress
                key={i}
                text={file}
                percentage={progress}
                total={total}
              />
            ))}
          </div>
        </>
      )}

      {status === "ready" && (
        <div
          ref={chatContainerRef}
          className="overflow-y-auto scrollbar-thin w-full flex flex-col items-center h-full"
        >
          <Chat messages={messages} />
          {messages.length === 0 && (
            <div>
              {EXAMPLES.map((msg, i) => (
                <div
                  key={i}
                  className="m-1 border dark:border-gray-600 rounded-md p-2 bg-gray-100 dark:bg-gray-700 cursor-pointer"
                  onClick={() => onEnter(msg)}
                >
                  {msg}
                </div>
              ))}
            </div>
          )}
          <p className="text-center text-sm min-h-6 text-gray-500 dark:text-gray-300">
            {tps && messages.length > 0 && (
              <>
                {!isRunning && (
                  <span>
                    Generated {numTokens} tokens in{" "}
                    {(numTokens / tps).toFixed(2)} seconds&nbsp;&#40;
                  </span>
                )}
                <>
                  <span className="font-medium text-center mr-1 text-black dark:text-white">
                    {tps.toFixed(2)}
                  </span>
                  <span className="text-gray-500 dark:text-gray-300">
                    tokens/second
                  </span>
                </>
                {!isRunning && (
                  <>
                    <span className="mr-1">&#41;.</span>
                    <span
                      className="underline cursor-pointer"
                      onClick={() => {
                        worker.current.postMessage({ type: "reset" });
                        setMessages([]);
                        // --- NEW: Reset current chat generation ID on reset ---
                        currentChatGenerationId.current = null;
                      }}
                    >
                      Reset
                    </span>
                  </>
                )}
              </>
            )}
          </p>
        </div>
      )}

      <div className="mt-2 border dark:bg-gray-700 rounded-lg w-[600px] max-w-[80%] max-h-[200px] mx-auto relative mb-3 flex">
        <textarea
          ref={textareaRef}
          className="scrollbar-thin w-[550px] dark:bg-gray-700 px-3 py-4 rounded-lg bg-transparent border-none outline-none text-gray-800 disabled:text-gray-400 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 disabled:placeholder-gray-200 resize-none disabled:cursor-not-allowed"
          placeholder="Type your message..."
          type="text"
          rows={1}
          value={input}
          disabled={status !== "ready"}
          title={status === "ready" ? "Model is ready" : "Model not loaded yet"}
          onKeyDown={(e) => {
            if (
              input.length > 0 &&
              !isRunning &&
              e.key === "Enter" &&
              !e.shiftKey
            ) {
              e.preventDefault(); // Prevent default behavior of Enter key
              onEnter(input);
            }
          }}
          onInput={(e) => setInput(e.target.value)}
        />
        {isRunning ? (
          <div className="cursor-pointer" onClick={onInterrupt}>
            <StopIcon className="h-8 w-8 p-1 rounded-md text-gray-800 dark:text-gray-100 absolute right-3 bottom-3" />
          </div>
        ) : input.length > 0 ? (
          <div className="cursor-pointer" onClick={() => onEnter(input)}>
            <ArrowRightIcon
              className={`h-8 w-8 p-1 bg-gray-800 dark:bg-gray-100 text-white dark:text-black rounded-md absolute right-3 bottom-3`}
            />
          </div>
        ) : (
          <div>
            <ArrowRightIcon
              className={`h-8 w-8 p-1 bg-gray-200 dark:bg-gray-600 text-gray-50 dark:text-gray-800 rounded-md absolute right-3 bottom-3`}
            />
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center mb-3">
        Disclaimer: Generated content may be inaccurate or false.
      </p>
    </div>
  ) : (
    <div className="fixed w-screen h-screen bg-black z-10 bg-opacity-[92%] text-white text-2xl font-semibold flex justify-center items-center text-center">
      WebGPU is not supported
      <br />
      by this browser :&#40;
    </div>
  );
}

export default App;
