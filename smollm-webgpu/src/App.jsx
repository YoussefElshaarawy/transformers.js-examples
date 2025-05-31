import { useEffect, useState, useRef } from "react";

import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";

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

  // --- START: ADDITIONS FOR AI FORMULA INTEGRATION ---
  // A queue for AI requests coming from the =AI() formula
  const aiFormulaQueue = useRef([]);
  // Ref to hold the resolve/reject functions for the current AI formula request
  const currentFormulaPromise = useRef(null);
  // Ref to hold the target cell address for the current AI formula request
  const currentFormulaTargetCell = useRef(null);
  // Flag to indicate if the current generation was triggered by a formula
  const isFormulaTriggered = useRef(false);

  // Function to process the next item in the queue
  const processNextFormulaRequest = () => {
    if (isRunning) {
      // AI is busy, will try again when current generation completes
      return;
    }
    if (aiFormulaQueue.current.length > 0) {
      const { prompt, targetCellAddress, resolve, reject } = aiFormulaQueue.current.shift();

      // Store the promise handlers and target cell for the current formula request
      currentFormulaPromise.current = { resolve, reject };
      currentFormulaTargetCell.current = targetCellAddress;
      isFormulaTriggered.current = true; // Set flag

      // Simulate typing the prompt into the input and pressing enter
      // This will trigger the existing `onEnter` logic.
      setInput(prompt); // Set the input field to the prompt
      // We need to delay calling onEnter slightly to ensure React processes the setInput
      setTimeout(() => {
        // We'll call onEnter directly here, bypassing the UI input check if desired.
        // Or, more simply, we let the existing useEffect for `messages` handle it,
        // after `onEnter` adds the user message.
        // Let's modify onEnter to accept an optional 'isFormula' flag
        onEnter(prompt, true); // Call onEnter, indicating it's from a formula
      }, 0); // Short delay
    }
  };


  // Expose a global function for Univer to call
  useEffect(() => {
    // The `triggerAICellFill` function from Univer
    window.triggerAICellFill = async (prompt, targetCellAddress) => {
      console.log(`AI Triggered for cell ${targetCellAddress} with prompt: "${prompt}"`);

      // Ensure the model is ready before queuing
      if (status !== "ready") {
        console.warn("AI model not ready for formula. Please load the model first.");
        // Assuming setUniverCellValue is a function provided by Univer
        // You might need to implement this or ensure it's globally available
        // if this code is running within a Univer plugin environment.
        // For demonstration, let's just log it if Univer isn't defined
        if (typeof window.setUniverCellValue === 'function') { // Check window for setUniverCellValue
            window.setUniverCellValue(targetCellAddress, "ERROR: Model not ready.");
        } else {
            console.error("window.setUniverCellValue is not defined. Cannot update cell.");
        }
        return;
      }

      return new Promise((resolve, reject) => {
        aiFormulaQueue.current.push({ prompt, targetCellAddress, resolve, reject });
        processNextFormulaRequest(); // Attempt to process immediately
      });
    };

    // Clean up the global function when the component unmounts
    return () => {
      delete window.triggerAICellFill;
    };
  }, [status, isRunning, messages]); // Depend on status, isRunning, and messages to ensure latest state is captured

  // --- END: ADDITIONS FOR AI FORMULA INTEGRATION ---


  // Modified onEnter to handle formula triggers
  function onEnter(message, fromFormula = false) {
    if (isRunning) {
      if (!fromFormula) { // If it's a chat message, and AI is busy, ignore
        console.warn("AI is busy, ignoring chat input.");
        return;
      }
      // If it's a formula, it would have been queued and `processNextFormulaRequest` handles it,
      // which then calls onEnter. If it's already running, it means this call
      // is part of the queue processing, so we proceed.
    }

    setTps(null);
    setIsRunning(true);
    setInput(""); // Clear the input field for the UI

    // Set the flag based on the source
    isFormulaTriggered.current = fromFormula;

    // IMPORTANT: Send the message to the worker here, depending on the source
    if (fromFormula) {
      // For formulas, send only the current prompt to the worker
      // The worker should be able to handle this as a standalone prompt.
      worker.current.postMessage({ type: "generate", data: [{ role: "user", content: message }] });
    } else {
      // For regular chat, add the user message to history
      // and then let the existing useEffect (which now won't have the formula guard)
      // trigger the worker with the updated messages state.
      // Or, you could directly post it here as well, but the current useEffect
      // structure for chat is fine if we remove the formula guard from it.
      setMessages((prev) => [...prev, { role: "user", content: message }]);
    }
  }

  // Modify the useEffect that watches 'messages' state
  useEffect(() => {
    // This useEffect should now ONLY handle chat-based generations,
    // as formula generations are directly posted in `onEnter`.
    if (isFormulaTriggered.current) {
      return; // Do not process chat messages if current generation is for a formula
    }

    if (messages.filter((x) => x.role === "user").length === 0) {
      return; // No user messages yet: do nothing.
    }
    if (messages.at(-1).role === "assistant") {
      return; // Do not update if the last message is from the assistant
    }
    setTps(null);
    // This postMessage will now only be called for chat-originated messages
    worker.current.postMessage({ type: "generate", data: messages });
  }, [messages, isRunning]);

  function onInterrupt() {
    // NOTE: We do not set isRunning to false here because the worker
    // will send a 'complete' message when it is done.
    worker.current.postMessage({ type: "interrupt" });

    // --- ADDITION: Handle interruption for formula requests ---
    if (currentFormulaPromise.current) {
        currentFormulaPromise.current.reject(new Error("AI generation interrupted."));
        currentFormulaPromise.current = null;
        currentFormulaTargetCell.current = null;
        isFormulaTriggered.current = false; // Reset flag
    }
    // Clear any queued formula requests
    aiFormulaQueue.current = [];
    // --- END ADDITION ---
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

  // We use the `useEffect` hook to setup the worker as soon as the `App` component is mounted.
  useEffect(() => {
    // Create the worker if it does not yet exist.
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
      worker.current.postMessage({ type: "check" }); // Do a feature check
    }

    // Create a callback function for messages from the worker thread.
    const onMessageReceived = (e) => {
      switch (e.data.status) {
        case "loading":
          // Model file start load: add a new progress item to the list.
          setStatus("loading");
          setLoadingMessage(e.data.data);
          break;

        case "initiate":
          setProgressItems((prev) => [...prev, e.data]);
          break;

        case "progress":
          // Model file progress: update one of the progress items.
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
          // Model file loaded: remove the progress item from the list.
          setProgressItems((prev) =>
            prev.filter((item) => item.file !== e.data.file),
          );
          break;

        case "ready":
          // Pipeline ready: the worker is ready to accept messages.
          setStatus("ready");
          processNextFormulaRequest(); // --- ADDITION: Try to process queue when ready ---
          break;

        case "start":
          {
            // Start generation
            // Only add a new assistant message for chat UI, not for formula responses
            if (!isFormulaTriggered.current) {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: "" },
              ]);
            }
          }
          break;

        case "update":
          {
            // Generation update: update the output text.
            // Parse messages
            const { output, tps, numTokens } = e.data;
            setTps(tps);
            setNumTokens(numTokens);

            // --- ADDITION: Handle AI Formula output accumulation ---
            if (isFormulaTriggered.current && currentFormulaTargetCell.current) {
              // Accumulate content for the formula response
              if (!currentFormulaTargetCell.current._aiAccumulatedContent) {
                currentFormulaTargetCell.current._aiAccumulatedContent = "";
              }
              currentFormulaTargetCell.current._aiAccumulatedContent += output;
              // No direct setMessages for formula generation to avoid polluting chat UI
            } else {
              // Original chat UI logic for updates
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
          }
          break;

        case "complete":
          // Generation complete: re-enable the "Generate" button
          setIsRunning(false);

          // --- ADDITION: Resolve AI Formula Promise and process next ---
          if (isFormulaTriggered.current && currentFormulaPromise.current) {
            const finalContent = currentFormulaTargetCell.current._aiAccumulatedContent || "";
            currentFormulaPromise.current.resolve(finalContent);
            // Clean up formula specific refs
            currentFormulaPromise.current = null;
            currentFormulaTargetCell.current = null;
            isFormulaTriggered.current = false; // Reset flag
          }
          // --- END ADDITION ---

          processNextFormulaRequest(); // --- ADDITION: Process next item in queue, regardless of trigger type ---
          break;

        case "error":
          setError(e.data.data);
          setIsRunning(false); // Make sure to release the running state

          // --- ADDITION: Reject AI Formula Promise and process next ---
          if (isFormulaTriggered.current && currentFormulaPromise.current) {
            currentFormulaPromise.current.reject(new Error(e.data.data));
            currentFormulaPromise.current = null;
            currentFormulaTargetCell.current = null;
            isFormulaTriggered.current = false; // Reset flag
          }
          // --- END ADDITION ---

          processNextFormulaRequest(); // --- ADDITION: Process next item in queue ---
          break;
      }
    };

    const onErrorReceived = (e) => {
      console.error("Worker error:", e);
      setError(`Worker error: ${e.message || 'Unknown'}`); // Set a more specific error
      setIsRunning(false);

      // --- ADDITION: Reject AI Formula Promise on worker error and process next ---
      if (isFormulaTriggered.current && currentFormulaPromise.current) {
        currentFormulaPromise.current.reject(new Error(`Worker error: ${e.message || 'Unknown'}`));
        currentFormulaPromise.current = null;
        currentFormulaTargetCell.current = null;
        isFormulaTriggered.current = false; // Reset flag
      }
      // --- END ADDITION ---

      processNextFormulaRequest(); // --- ADDITION: Process next item in queue ---
    };

    // Attach the callback function as an event listener.
    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    // Define a cleanup function for when the component is unmounted.
    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, []); // Empty dependency array means this runs once on mount, mimicking initial setup

  // Send the messages to the worker thread whenever the `messages` state changes.
  useEffect(() => {
    // Only send messages to the worker if the current generation is not specifically for a formula.
    // If `isFormulaTriggered` is true, the `onEnter` for formula would have already called worker.postMessage
    // with the formula prompt, and the `update`/`complete` cases will handle it.
    // This `useEffect` is primarily for the chat UI's messages.
    if (!isFormulaTriggered.current) {
        if (messages.filter((x) => x.role === "user").length === 0) {
            // No user messages yet: do nothing.
            return;
        }
        if (messages.at(-1).role === "assistant") {
            // Do not update if the last message is from the assistant
            return;
        }
        setTps(null);
        worker.current.postMessage({ type: "generate", data: messages });
    }
  }, [messages, isRunning]); // Rerun when messages or isRunning changes

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
          {/* Only display chat messages if not currently processing a formula */}
          {!isFormulaTriggered.current && <Chat messages={messages} />}
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
                {
                  <>
                    <span className="font-medium text-center mr-1 text-black dark:text-white">
                      {tps.toFixed(2)}
                    </span>
                    <span className="text-gray-500 dark:text-gray-300">
                      tokens/second
                    </span>
                  </>
                }
                {!isRunning && (
                  <>
                    <span className="mr-1">&#41;.</span>
                    <span
                      className="underline cursor-pointer"
                      onClick={() => {
                        worker.current.postMessage({ type: "reset" });
                        setMessages([]);
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
          // Disable if model not ready OR AI is busy
          disabled={status !== "ready" || isRunning}
          title={status === "ready" ? "Model is ready" : "Model not loaded yet"}
          onKeyDown={(e) => {
            if (
              input.length > 0 &&
              !isRunning && // Check if AI is NOT running (for chat OR formula)
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
