import { useEffect, useState, useRef } from "react";

import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";

// --- NEW: Import globalUniverAPI to access spreadsheet commands ---
import { setWorkerMessenger, globalUniverAPI } from './univer-init.jsx';

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
  const [isRunning, setIsRunning] = useState(false); // Indicates if ANY generation is in progress

  // Inputs and outputs
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);

  // --- NEW: Queue for spreadsheet-triggered AI requests ---
  const [spreadsheetRequestQueue, setSpreadsheetRequestQueue] = useState([]);
  // --- NEW: Holds the current active spreadsheet request ---
  const [currentSpreadsheetRequest, setCurrentSpreadsheetRequest] = useState(null);
  // --- NEW: State to track if worker is busy with a chat request ---
  const [isWorkerBusyWithChat, setIsWorkerBusyWithChat] = useState(false);


  function onEnter(message) {
    // This is for chat input, always append to messages
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setTps(null);
    setIsRunning(true); // Worker will be busy
    setIsWorkerBusyWithChat(true); // Mark worker busy with chat request
    setInput("");
  }

  function onInterrupt() {
    worker.current.postMessage({ type: "interrupt" });
    // When interrupting, both chat and spreadsheet requests should stop.
    // The worker will send 'complete' when done.
    setIsRunning(false); // Optimistically set to false, worker will confirm
    setIsWorkerBusyWithChat(false); // Reset chat busy state
    setCurrentSpreadsheetRequest(null); // Clear current spreadsheet request if any
    setSpreadsheetRequestQueue([]); // Clear any pending spreadsheet requests
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
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
      worker.current.postMessage({ type: "check" });
    }

    // Provide the worker messenger to univer-init.js
    // This allows the SMOLLM function in the sheet to send messages to the worker.
    setWorkerMessenger((message) => {
      if (worker.current) {
        // --- NEW: Handle messages from SMOLLM formula ---
        if (message.source === 'formula') {
          // If worker is busy with a chat request or another spreadsheet request, queue it
          if (isRunning) { // isRunning true means worker is busy with chat or another formula
            setSpreadsheetRequestQueue(prevQueue => [...prevQueue, message]);
            console.log("SMOLLM request queued. Queue size:", prevQueue.length + 1);
          } else {
            // Worker is free, process this spreadsheet request immediately
            setCurrentSpreadsheetRequest(message);
            setIsRunning(true); // Mark worker as busy
            worker.current.postMessage(message);
            console.log("SMOLLM request sent to worker immediately.");
          }
        } else {
          // This is a chat request, send directly
          worker.current.postMessage(message);
        }
      } else {
        console.error("AI worker not ready for request.");
      }
    });

    // Create a callback function for messages from the worker thread.
    const onMessageReceived = (e) => {
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
            // Only append to chat messages if it's a chat request
            if (e.data.source !== 'formula') { // Assuming worker will echo source
                setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: "" },
                ]);
            }
          }
          break;

        case "update":
          {
            const { output, tps, numTokens } = e.data;
            setTps(tps);
            setNumTokens(numTokens);

            // --- NEW: Conditional update for chat vs. spreadsheet ---
            if (e.data.source === 'formula' && currentSpreadsheetRequest) {
                // If it's a formula output, update the target cell directly
                // Note: 'update' messages usually send incremental output.
                // For a single cell update, we might only want the 'complete' message.
                // However, if we want streaming, we'd need to append.
                // For simplicity, let's assume final update is done on 'complete'.
                // If you want streaming, this logic would need to accumulate output.
                // For now, we'll just show chat for update messages.
                // We'll handle the final result on 'complete'.
            } else if (e.data.source !== 'formula') { // Chat updates
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
          {
            const { output, source } = e.data;
            setIsRunning(false); // Worker is now free

            if (source === 'formula' && currentSpreadsheetRequest) {
                // This is the final output for the spreadsheet formula
                if (globalUniverAPI && currentSpreadsheetRequest.targetCell) {
                    const { row, column, sheetId, workbookId } = currentSpreadsheetRequest.targetCell;

                    // Execute command to place output directly into the cell
                    globalUniverAPI.executeCommand('sheet.command.set-range-values', {
                        value: { v: output },
                        range: {
                            startRow: row,
                            endRow: row,
                            startColumn: column,
                            endColumn: column,
                            sheetId: sheetId,
                            workbookId: workbookId,
                        },
                    });
                    console.log(`Output placed in cell: R${row + 1}C${column + 1}`);
                } else {
                    console.warn("Could not update formula cell, targetCell or UniverAPI not available.");
                }
                setCurrentSpreadsheetRequest(null); // Clear the active spreadsheet request

                // --- NEW: Process next item in queue if available ---
                if (spreadsheetRequestQueue.length > 0) {
                    const nextRequest = spreadsheetRequestQueue[0];
                    setSpreadsheetRequestQueue(prevQueue => prevQueue.slice(1)); // Remove from queue
                    setCurrentSpreadsheetRequest(nextRequest); // Set as current
                    setIsRunning(true); // Mark worker as busy again
                    worker.current.postMessage(nextRequest); // Send to worker
                    console.log("Processing next SMOLLM request from queue.");
                } else {
                    // No more spreadsheet requests, check if worker was busy with chat
                    setIsWorkerBusyWithChat(false);
                }

            } else { // This was a chat request
                setIsWorkerBusyWithChat(false);
                // The 'update' case already appended content for chat messages
            }
          }
          break;

        case "error":
          setError(e.data.data);
          // If an error occurs, clear current request and queue
          setIsRunning(false);
          setIsWorkerBusyWithChat(false);
          setCurrentSpreadsheetRequest(null);
          setSpreadsheetRequestQueue([]);
          break;
      }
    };

    const onErrorReceived = (e) => {
      console.error("Worker error:", e);
      // Also handle errors by clearing state
      setError("An unexpected worker error occurred.");
      setIsRunning(false);
      setIsWorkerBusyWithChat(false);
      setCurrentSpreadsheetRequest(null);
      setSpreadsheetRequestQueue([]);
    };

    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, [spreadsheetRequestQueue, currentSpreadsheetRequest, isWorkerBusyWithChat, isRunning]); // Dependencies for useEffect


  // Send the messages to the worker thread whenever the `messages` state changes.
  useEffect(() => {
    // Only send chat messages if worker is not busy with a formula request
    // and if the last message is a user message and not a placeholder.
    if (!isWorkerBusyWithChat && messages.filter((x) => x.role === "user").length > 0 && messages.at(-1).role === "user") {
        setTps(null);
        setIsRunning(true); // Mark worker busy with chat request
        setIsWorkerBusyWithChat(true); // Mark worker busy with chat request
        worker.current.postMessage({ type: "generate", data: messages, source: 'chat' }); // Mark source as 'chat'
    }
  }, [messages]); // Changed dependency from [messages, isRunning] to just [messages] and added isWorkerBusyWithChat check

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
          disabled={status !== "ready" || isRunning} {/* Disable input if worker is busy */}
          title={status === "ready" && !isRunning ? "Model is ready" : "Model is busy or not loaded"}
          onKeyDown={(e) => {
            if (
              input.length > 0 &&
              !isRunning && // Ensure worker is not busy with anything
              e.key === "Enter" &&
              !e.shiftKey
            ) {
              e.preventDefault();
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
