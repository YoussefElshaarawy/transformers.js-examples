// App.jsx

import { useEffect, useState, useRef } from "react";

import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";

// --- NEW: Import setWorkerMessenger, globalUniverAPI, and smollmRequestMap from univer-init.js ---
import { setWorkerMessenger, globalUniverAPI, smollmRequestMap } from './univer-init.js';

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

  // --- NEW: State to store the active SMOLLM cell location ---
  const [activeSmollmCell, setActiveSmollmCell] = useState(null); // e.g., { row: 0, col: 0, sheetId: 'sheet1' }

  // --- NEW: Ref to accumulate output for spreadsheet cells ---
  const smollmCellOutputAccumulator = useRef(new Map());

  function onEnter(message) {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setTps(null);
    setIsRunning(true);
    setInput("");
  }

  function onInterrupt() {
    // NOTE: We do not set isRunning to false here because the worker
    // will send a 'complete' message when it is done.
    worker.current.postMessage({ type: "interrupt" });
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
      console.log("App.jsx: Worker initialized and check message sent."); // Debug log
    }

    // --- Provide the worker messenger to univer-init.js ---
    // This allows the SMOLLM function in the sheet to send messages to the worker.
    setWorkerMessenger((message) => {
        if (worker.current) {
            console.log("App.jsx: Received message from Univer, forwarding to worker:", message); // Debug log
            worker.current.postMessage(message);
        } else {
            console.error("AI worker not ready for spreadsheet request."); // Debug error
        }
    });

    // Create a callback function for messages from the worker thread.
    const onMessageReceived = (e) => {
      console.log("App.jsx: Message from worker:", e.data); // Debug log for all worker messages
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
          console.log("App.jsx: Worker status is READY."); // Debug log
          break;

        case "start":
          {
            // If it's a SMOLLM request, initialize the accumulator and set active cell.
            if (e.data.smollmRequestId) {
                smollmCellOutputAccumulator.current.set(e.data.smollmRequestId, '');
                console.log("App.jsx: SMOLLM request started, accumulator initialized for ID:", e.data.smollmRequestId); // Debug log

                // --- NEW: Set activeSmollmCell ---
                const { row, col, sheetId } = smollmRequestMap.get(e.data.smollmRequestId);
                // The cellToLocation method might not be directly available on the sheet object.
                // You might need to use a helper function or construct the cell name manually (e.g., String.fromCharCode(65 + col) + (row + 1))
                // For now, let's just use a string representation.
                const cellName = `Sheet ${sheetId} Cell (${row + 1}, ${String.fromCharCode(65 + col)})`; // Example: Sheet sheet1 Cell (1, A)
                setActiveSmollmCell(cellName);
                console.log("App.jsx: Setting active SMOLLM cell to:", cellName);

            } else {
                // Existing chat logic for regular chat inputs
                setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: "" },
                ]);
            }
          }
          break;

        case "update":
          {
            const { output, tps, numTokens, smollmRequestId } = e.data;
            console.log("App.jsx: Worker sending update:", e.data); // Debug log for update messages

            // --- Handle chat update for regular messages ---
            if (!smollmRequestId) {
                setTps(tps);
                setNumTokens(numTokens);
                setMessages((prev) => {
                    const cloned = [...prev];
                    const last = cloned.at(-1);
                    cloned[cloned.length - 1] = {
                        ...last,
                        content: last.content + output,
                    };
                    return cloned;
                });
            } else {
                // --- NEW: Handle SMOLLM cell update for streaming ---
                console.log("App.jsx: Processing SMOLLM cell update for ID:", smollmRequestId); // Debug log
                if (globalUniverAPI && smollmRequestMap.has(smollmRequestId)) {
                    const { row, col, sheetId } = smollmRequestMap.get(smollmRequestId);
                    console.log("App.jsx: Found cell info:", { row, col, sheetId }); // Debug log

                    // Accumulate the output chunk
                    let currentAccumulated = smollmCellOutputAccumulator.current.get(smollmRequestId) || '';
                    currentAccumulated += output;
                    smollmCellOutputAccumulator.current.set(smollmRequestId, currentAccumulated);
                    console.log("App.jsx: Accumulating output for ID", smollmRequestId, "Current:", currentAccumulated); // Debug log

                    try {
                        // Update the cell in Univer with the accumulated text, in the correct { v: ... } format
                        globalUniverAPI.get.activeWorkbook().getSheetBySheetId(sheetId).setRangeValues(row, col, row, col, [[{ v: currentAccumulated }]]);
                        console.log("App.jsx: Successfully updated cell R", row, "C", col, "S", sheetId, "with:", currentAccumulated); // Debug log
                    } catch (updateError) {
                        console.error("App.jsx: Error updating Univer cell:", updateError); // Debug error
                    }
                } else {
                    console.warn("App.jsx: smollmRequestId not found in smollmRequestMap or globalUniverAPI not ready.", { smollmRequestId, globalUniverAPIReady: !!globalUniverAPI, inMap: smollmRequestMap.has(smollmRequestId) }); // Debug warning
                }
            }
          }
          break;

        case "complete":
          setIsRunning(false);
          console.log("App.jsx: Worker sending complete:", e.data); // Debug log for complete messages

          // --- Handle SMOLLM completion and cleanup ---
          const { smollmRequestId: completedSmollmId, finalOutput } = e.data;
          if (completedSmollmId && smollmRequestMap.has(completedSmollmId)) {
              const { row, col, sheetId } = smollmRequestMap.get(completedSmollmId);
              if (globalUniverAPI) {
                  try {
                      // Ensure the final, complete output is set to the cell, in the correct { v: ... } format
                      globalUniverAPI.get.activeWorkbook().getSheetBySheetId(sheetId).setRangeValues(row, col, row, col, [[{ v: finalOutput }]]);
                      console.log("App.jsx: Final cell update for R", row, "C", col, "S", sheetId, "with:", finalOutput); // Debug log
                  } catch (completeError) {
                      console.error("App.jsx: Error during final cell update:", completeError); // Debug error
                  }
              }
              smollmRequestMap.delete(completedSmollmId); // Clean up the map from univer-init.js
              smollmCellOutputAccumulator.current.delete(completedSmollmId); // Clean up the accumulator
              setActiveSmollmCell(null); // --- NEW: Clear activeSmollmCell on completion ---
              console.log("App.jsx: Cleaned up SMOLLM request ID:", completedSmollmId); // Debug log
          }
          // The general `setTps(tps)` and `setNumTokens(numTokens)` from `complete` can stay,
          // but the message update only applies to regular chat.
          break;

        case "error":
          setError(e.data.data);
          console.error("App.jsx: Worker error:", e.data); // Debug error
          const { smollmRequestId: errorSmollmId } = e.data;
          if (errorSmollmId && smollmRequestMap.has(errorSmollmId)) {
              const { row, col, sheetId } = smollmRequestMap.get(errorSmollmId);
              if (globalUniverAPI) {
                  try {
                      // Update the cell with error message, in the correct { v: ... } format
                      globalUniverAPI.get.activeWorkbook().getSheetBySheetId(sheetId).setRangeValues(row, col, row, col, [[{ v: `ERROR: ${e.data.data}` }]]);
                      console.log("App.jsx: Updated cell R", row, "C", col, "S", sheetId, "with error."); // Debug log
                  } catch (errorUpdateError) {
                      console.error("App.jsx: Error updating cell with error message:", errorUpdateError); // Debug error
                  }
              }
              smollmRequestMap.delete(errorSmollmId);
              smollmCellOutputAccumulator.current.delete(errorSmollmId);
              setActiveSmollmCell(null); // --- NEW: Clear activeSmollmCell on error ---
              console.log("App.jsx: Cleaned up errored SMOLLM request ID:", errorSmollmId); // Debug log
          }
          break;
      }
    };

    const onErrorReceived = (e) => {
      console.error("App.jsx: Uncaught Worker error event:", e); // Debug error
    };

    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, []);

  useEffect(() => {
    // This useEffect is primarily for chat-initiated messages.
    // It should NOT trigger for SMOLLM requests.
    if (messages.filter((x) => x.role === "user").length === 0) {
      return;
    }
    const lastMessage = messages.at(-1);
    // Only process if the last message is a user message and not from a SMOLLM call.
    // We assume chat messages added via onEnter don't have smollmRequestId
    if (lastMessage.role === "assistant" || lastMessage.smollmRequestId) {
        return;
    }

    setTps(null);
    worker.current.postMessage({ type: "generate", data: messages });
    console.log("App.jsx: Chat-initiated message sent to worker:", messages); // Debug log
  }, [messages, isRunning]);

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

  // --- NEW: Function to force sheet refresh/recalculation ---
  const refreshSheet = () => {
    if (globalUniverAPI) {
      const workbook = globalUniverAPI.get.activeWorkbook();
      if (workbook) {
        const sheet = workbook.getActiveSheet();
        if (sheet) {
          // Univer API might have a direct method for recalculation or re-rendering.
          // If not, a common workaround is to trigger a dummy update.
          // For example, setting the value of a cell to its current value or a temporary value.
          // Another way is to trigger a "Dirty" state in the formula engine.

          // Option 1: Triggering a recalculation (preferred if available)
          // The exact command might vary based on Univer's latest API.
          // Check Univer's documentation for an explicit recalculate/refresh method.
          // As a generic example, you might try to get the formula engine and trigger it.
          // This is a placeholder and might need adjustment based on Univer's internals.
          console.log("Attempting to force Univer sheet recalculation/refresh...");
          globalUniverAPI.get.commandService().executeCommand("formula.command.calculate"); // This is a common pattern for formula recalculation

          // Option 2: If a direct recalculate command isn't readily available or doesn't work,
          // you could try to trigger a visual update by setting a non-impactful cell.
          // This is a less ideal solution but sometimes works.
          // const firstCell = sheet.getRange(0, 0); // Get the first cell (A1)
          // const originalValue = firstCell.getValue();
          // sheet.setValue(0, 0, originalValue); // Set its value back to itself to trigger update
          // console.log("Triggering visual refresh by re-setting cell A1.");
        }
      }
    } else {
      console.warn("Univer API is not available to refresh the sheet.");
    }
  };


  return IS_WEBGPU_AVAILABLE ? (
    <div className="flex flex-col h-screen mx-auto items justify-end text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900">
        {/* --- NEW: Display active SMOLLM cell at the top --- */}
        {activeSmollmCell && (
            <div className="w-full text-center py-2 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                AI generating response for cell: <span className="font-bold">{activeSmollmCell}</span>
            </div>
        )}

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
          {/* --- NEW: Refresh Sheet Button --- */}
          <button
            className="mb-4 px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
            onClick={refreshSheet}
            disabled={!globalUniverAPI} // Disable if Univer isn't ready
          >
            Refresh Sheet
          </button>
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
