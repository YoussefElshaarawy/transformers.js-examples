import { useEffect, useState, useRef } from "react";
import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";

// Import necessary Univer modules for listening to changes
import { ICellData, IRange } from '@univerjs/core';
import { SelectionManagerService } from '@univerjs/sheets';
import { Disposable, ICommandService, LifecycleStages, OnLifecycle } from '@univerjs/core';
import { SetSelectionsOperation } from '@univerjs/sheets';


const IS_WEBGPU_AVAILABLE = !!navigator.gpu;
const STICKY_SCROLL_THRESHOLD = 120;
const EXAMPLES = [
  "Give me some tips to improve my time management skills.",
  "What is the difference between AI and ML?",
  "Write python code to compute the nth fibonacci number.",
];

// Add univerAPI to the props of the App component
function App({ univerAPI }) {
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

  // State to track the active cell for AI response
  const [activeCell, setActiveCell] = useState(null); // { row, col, sheetId, workbookId }

  function onEnter(message) {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setTps(null);
    setIsRunning(true);
    setInput("");
  }

  function onInterrupt() {
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
    }

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

        case "start": {
          // Start generation for chat
          if (!activeCell) { // Only add to chat messages if not an AI cell response
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "" },
            ]);
          }
          break;
        }

        case "update": {
          const { output, tps, numTokens } = e.data;
          setTps(tps);
          setNumTokens(numTokens);

          if (activeCell) {
            // Update the Univer cell directly
            const { row, col, sheetId, workbookId } = activeCell;
            const workbook = univerAPI.getUniver().getCurrentUniverSheetInstance();
            const sheet = workbook?.getSheetBySheetId(sheetId);
            if (sheet) {
              const cell = sheet.getCell(row, col);
              const currentValue = cell ? cell.v : '';
              sheet.setCell(row, col, { v: (currentValue || '') + output });
            }
          } else {
            // Update the chat output text.
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
          break;
        }

        case "complete":
          setIsRunning(false);
          setActiveCell(null); // Clear active cell after completion
          break;

        case "error":
          setError(e.data.data);
          setActiveCell(null); // Clear active cell on error
          break;
      }
    };

    const onErrorReceived = (e) => {
      console.error("Worker error:", e);
      setActiveCell(null); // Clear active cell on error
    };

    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, [activeCell, univerAPI]); // Add activeCell and univerAPI to dependencies

  // Send the messages to the worker thread whenever the `messages` state changes (for chat)
  useEffect(() => {
    if (messages.filter((x) => x.role === "user").length === 0) {
      return;
    }
    if (messages.at(-1).role === "assistant") {
      return;
    }
    setTps(null);
    if (!activeCell) { // Only send chat messages if not an active cell response
      worker.current.postMessage({ type: "generate", data: messages });
    }
  }, [messages, isRunning, activeCell]);

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


  // *******************************************************************
  // NEW: Univer Cell Change Listener and AI Integration
  // *******************************************************************
  useEffect(() => {
    if (!univerAPI || status !== "ready") return; // Ensure Univer API and LLM are ready

    const commandService = univerAPI.getUniver().getCommandService();
    const sheetService = univerAPI.getUniver().getCurrentUniverSheetInstance()?.getUnitService();

    if (!commandService || !sheetService) return;

    const disposable = new Disposable();

    // Listen for cell value changes
    disposable.add(
      commandService.onCommandExecuted((commandInfo) => {
        if (commandInfo.id === 'sheet.command.set-range-values') {
          const { workbookId, worksheetId, range, value } = commandInfo.params;
          const workbook = univerAPI.getUniver().getWorkbook(workbookId);
          const sheet = workbook?.getSheetBySheetId(worksheetId);

          if (sheet) {
            // Get the actual cell data that was changed
            const { startRow, endRow, startColumn, endColumn } = range;
            for (let r = startRow; r <= endRow; r++) {
              for (let c = startColumn; c <= endColumn; c++) {
                const cellData = sheet.getCell(r, c);
                if (cellData && cellData.v) {
                  const cellContent = String(cellData.v).trim();
                  // Check if the cell content is a prompt for the AI
                  if (cellContent.startsWith('/ai ')) {
                    const prompt = cellContent.substring(4).trim(); // Remove '/ai ' prefix

                    if (prompt) {
                      // Set the active cell for AI response
                      setActiveCell({ row: r, col: c, sheetId: worksheetId, workbookId: workbookId });
                      setIsRunning(true); // Indicate AI is running
                      // Clear the cell content initially or set a "Generating..." message
                      sheet.setCell(r, c, { v: 'Generating AI response...' });

                      // Send the prompt to the worker
                      worker.current.postMessage({
                        type: "generate",
                        data: [{ role: "user", content: prompt }], // Send as a single message
                      });
                    }
                  }
                }
              }
            }
          }
        }
      })
    );

    return () => disposable.dispose(); // Cleanup on unmount
  }, [univerAPI, status]); // Re-run if univerAPI or status changes


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
