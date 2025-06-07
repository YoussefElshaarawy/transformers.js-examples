// App.jsx

import { useEffect, useState, useRef } from "react";

import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";

// --- Import setWorkerMessenger, globalUniverAPI, and smollmRequestMap from univer-init.js ---
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

  // --- State to store the active SMOLLM cell location ---
  const [activeSmollmCell, setActiveSmollmCell] = useState(null); // e.g., { row: 0, col: 0, sheetId: 'sheet1' }

  // --- Ref to accumulate output for spreadsheet cells ---
  const smollmCellOutputAccumulator = useRef(new Map());

  // --- NEW: State for manual cell input ---
  const [manualCellAddress, setManualCellAddress] = useState("A1");
  const [manualCellValue, setManualCellValue] = useState("Hello from App!");
  const [manualCellSheetId, setManualCellSheetId] = useState('sheet-01'); // Assuming default sheet ID or get from UniverAPI

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

  // --- Function to execute the set-range-values command ---
  const setCellValueThroughCommand = (sheetId, row, col, value) => {
      if (globalUniverAPI) {
          try {
              globalUniverAPI.get.commandService().executeCommand('sheet.command.set-range-values', {
                  value: { v: value },
                  range: {
                      startRow: row,
                      startColumn: col,
                      endRow: row,
                      endColumn: col,
                      sheetId: sheetId // Important to specify the sheetId here
                  }
              });
              console.log("App.jsx: Successfully executed set-range-values command for R", row, "C", col, "S", sheetId, "with:", value);
          } catch (commandError) {
              console.error("App.jsx: Error executing set-range-values command:", commandError);
          }
      } else {
          console.warn("App.jsx: globalUniverAPI not ready to execute command.");
      }
  };

  // --- NEW: Function to handle manual cell update ---
  const handleManualCellUpdate = () => {
    if (!globalUniverAPI) {
      console.warn("Univer API is not ready.");
      return;
    }

    try {
      // Get the active workbook and sheet to derive sheetId if not set manually
      const activeWorkbook = globalUniverAPI.get.activeWorkbook();
      const activeSheet = activeWorkbook?.getActiveSheet();
      const currentSheetId = activeSheet?.getSheetId() || manualCellSheetId; // Use active sheet or fallback

      // Convert cell address (e.g., "A1") to row and column indices
      const { row, col } = activeSheet?.get?.cellNameToLocation?.(manualCellAddress) || { row: -1, col: -1 };

      if (row === -1 || col === -1) {
        console.error("Invalid cell address:", manualCellAddress);
        alert(`Invalid cell address: ${manualCellAddress}. Please use formats like A1, B2.`);
        return;
      }

      setCellValueThroughCommand(currentSheetId, row, col, manualCellValue);
      console.log(`Manually updated cell ${manualCellAddress} on sheet ${currentSheetId} with value: "${manualCellValue}"`);
    } catch (e) {
      console.error("Error during manual cell update:", e);
      alert("Failed to update cell. Check console for details.");
    }
  };


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
                // For a more user-friendly cell name display:
                const cellName = globalUniverAPI?.get.activeWorkbook()?.getSheetBySheetId(sheetId)?.get?.cellToLocation?.(row, col) ||
                                 `Sheet ${sheetId} Cell (${row + 1}, ${String.fromCharCode(65 + col)})`;
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
            console.log("App.jsx: Worker sending update:", e.data);

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
                // --- Handle SMOLLM cell update for streaming via command ---
                console.log("App.jsx: Processing SMOLLM cell update for ID:", smollmRequestId);
                if (globalUniverAPI && smollmRequestMap.has(smollmRequestId)) {
                    const { row, col, sheetId } = smollmRequestMap.get(smollmRequestId);

                    let currentAccumulated = smollmCellOutputAccumulator.current.get(smollmRequestId) || '';
                    currentAccumulated += output;
                    smollmCellOutputAccumulator.current.set(smollmRequestId, currentAccumulated);

                    setCellValueThroughCommand(sheetId, row, col, currentAccumulated);

                } else {
                    console.warn("App.jsx: smollmRequestId not found in smollmRequestMap or globalUniverAPI not ready.", { smollmRequestId, globalUniverAPIReady: !!globalUniverAPI, inMap: smollmRequestMap.has(smollmRequestId) });
                }
            }
          }
          break;

        case "complete":
          setIsRunning(false);
          console.log("App.jsx: Worker sending complete:", e.data);

          const { smollmRequestId: completedSmollmId, finalOutput } = e.data;
          if (completedSmollmId && smollmRequestMap.has(completedSmollmId)) {
              const { row, col, sheetId } = smollmRequestMap.get(completedSmollmId);
              if (globalUniverAPI) {
                  // --- Use executeCommand for final update ---
                  setCellValueThroughCommand(sheetId, row, col, finalOutput);
              }
              smollmRequestMap.delete(completedSmollmId);
              smollmCellOutputAccumulator.current.delete(completedSmollmId);
              setActiveSmollmCell(null);
              console.log("App.jsx: Cleaned up SMOLLM request ID:", completedSmollmId);
          }
          break;

        case "error":
          setError(e.data.data);
          console.error("App.jsx: Worker error:", e.data);
          const { smollmRequestId: errorSmollmId } = e.data;
          if (errorSmollmId && smollmRequestMap.has(errorSmollmId)) {
              const { row, col, sheetId } = smollmRequestMap.get(errorSmollmId);
              if (globalUniverAPI) {
                  // --- Use executeCommand for error update ---
                  setCellValueThroughCommand(sheetId, row, col, `ERROR: ${e.data.data}`);
              }
              smollmRequestMap.delete(errorSmollmId);
              smollmCellOutputAccumulator.current.delete(errorSmollmId);
              setActiveSmollmCell(null);
              console.log("App.jsx: Cleaned up errored SMOLLM request ID:", errorSmollmId);
          }
          break;
      }
    };

    const onErrorReceived = (e) => {
      console.error("App.jsx: Uncaught Worker error event:", e);
    };

    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, [setCellValueThroughCommand]);

  useEffect(() => {
    if (messages.filter((x) => x.role === "user").length === 0) {
      return;
    }
    const lastMessage = messages.at(-1);
    if (lastMessage.role === "assistant" || lastMessage.smollmRequestId) {
        return;
    }

    setTps(null);
    worker.current.postMessage({ type: "generate", data: messages });
    console.log("App.jsx: Chat-initiated message sent to worker:", messages);
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

  // --- Function to force sheet refresh/recalculation ---
  const refreshSheet = () => {
    if (globalUniverAPI) {
      const workbook = globalUniverAPI.get.activeWorkbook();
      if (workbook) {
        const sheet = workbook.getActiveSheet();
        if (sheet) {
          // Use the dedicated refreshCanvas() method for visual updates
          sheet.refreshCanvas();
          console.log("Attempted to refresh Univer sheet canvas.");
          // Also trigger formula recalculation in case any formulas are impacted
          globalUniverAPI.get.commandService().executeCommand("formula.command.calculate");
          console.log("Attempted to trigger Univer formula recalculation.");
        }
      }
    } else {
      console.warn("Univer API is not available to refresh the sheet.");
    }
  };


  return IS_WEBGPU_AVAILABLE ? (
    <div className="flex flex-col h-screen mx-auto items justify-end text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900">
        {/* --- Display active SMOLLM cell at the top --- */}
        {activeSmollmCell && (
            <div className="w-full text-center py-2 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                AI generating response for cell: <span className="font-bold">{activeSmollmCell}</span>
            </div>
        )}

        {/* --- NEW: Manual Cell Input Section (always visible) --- */}
        <div className="w-full max-w-[600px] mx-auto p-4 flex flex-col gap-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-850">
            <h3 className="text-lg font-semibold mb-2">Manually Update Univer Cell</h3>
            <div className="flex items-center gap-2">
                <label htmlFor="cellAddress" className="w-20 text-right">Cell (e.g., A1):</label>
                <input
                    id="cellAddress"
                    type="text"
                    className="flex-1 border dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                    value={manualCellAddress}
                    onChange={(e) => setManualCellAddress(e.target.value.toUpperCase())} // Convert to uppercase
                    placeholder="E.g., A1"
                />
            </div>
            <div className="flex items-center gap-2">
                <label htmlFor="cellValue" className="w-20 text-right">Value:</label>
                <input
                    id="cellValue"
                    type="text"
                    className="flex-1 border dark:border-gray-600 rounded-md p-2 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                    value={manualCellValue}
                    onChange={(e) => setManualCellValue(e.target.value)}
                    placeholder="Enter value"
                />
            </div>
            <button
                className="mt-2 px-4 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:bg-green-200 disabled:cursor-not-allowed"
                onClick={handleManualCellUpdate}
                disabled={!globalUniverAPI} // Disable if Univer isn't ready
            >
                Write to Cell
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400">
                Note: This uses the currently active sheet.
            </p>
        </div>


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
          {/* --- Refresh Sheet Button (still useful for general debugging) --- */}
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
