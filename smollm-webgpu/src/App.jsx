import { useEffect, useState, useRef, useCallback } from "react";

// UniverJS Imports
import {
  createUniver,
  defaultTheme,
  LocaleType,
  merge,
} from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core';
import enUS from '@univerjs/presets/preset-sheets-core/locales/en-US';
import zhCN from '@univerjs/presets/preset-sheets-core/locales/zh-CN';
// Import the command needed to listen for cell value changes
import { SetRangeValuesCommand } from '@univerjs/sheets';

// Local Components (assuming these are in the same directory or accessible)
import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";

// UniverJS Styles (these would typically be imported at the root level of your project,
// ensure your build system handles these imports correctly if they are not already)
// import './style.css'; // Assuming this is for basic Univer container styling
// import '@univerjs/presets/lib/styles/preset-sheets-core.css';

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

  // Inputs and outputs for the main chat UI
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);

  // UniverJS State
  const univerAPI = useRef(null); // To store the Univer API instance

  // A queue for AI requests coming from cell edits
  const aiCellRequestQueue = useRef([]);
  // Ref to hold the target cell address (UniverJS coordinates) for the current AI request
  const currentCellTarget = useRef(null);
  // Flag to indicate if the current generation was triggered by a cell edit
  const isCellTriggered = useRef(false);

  // Function to process the next item in the queue
  const processNextAIRequest = useCallback(() => {
    if (isRunning) {
      // AI is busy, will try again when current generation completes
      return;
    }
    if (aiCellRequestQueue.current.length > 0) {
      const { prompt, targetCellAddress } = aiCellRequestQueue.current.shift();

      currentCellTarget.current = targetCellAddress; // Store the cell coordinates
      isCellTriggered.current = true; // Set flag to indicate cell-triggered AI

      setTps(null); // Reset TPS for new generation
      setIsRunning(true); // Indicate AI is busy

      // Send the prompt to the worker
      worker.current.postMessage({
        type: "generate",
        data: [{ role: "user", content: prompt }], // Worker expects an array of messages
      });
    }
  }, [isRunning]); // Depend on isRunning to re-evaluate when AI becomes free

  // Modified onEnter to handle chat UI triggers
  function onEnter(message) {
    if (isRunning) {
      // If AI is busy, ignore chat input
      console.warn("AI is busy, ignoring chat input.");
      return;
    }

    // Add user message to the chat history
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setTps(null);
    setIsRunning(true);
    setInput(""); // Clear the input field for the UI

    isCellTriggered.current = false; // Ensure this is false for normal chat
  }

  function onInterrupt() {
    // NOTE: We do not set isRunning to false here because the worker
    // will send a 'complete' message when it is done.
    worker.current.postMessage({ type: "interrupt" });

    // Handle interruption for cell requests
    if (currentCellTarget.current) {
      // If a cell request was active, clear its reference
      currentCellTarget.current = null;
      isCellTriggered.current = false; // Reset flag
    }
    // Clear any queued cell requests
    aiCellRequestQueue.current = [];
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

  // Effect for initializing UniverJS and setting up cell edit listener
  useEffect(() => {
    if (!univerAPI.current) {
      // 1. Boot-strap Univer and mount inside <div id="univer">
      const { univerAPI: api } = createUniver({
        locale: LocaleType.EN_US,
        locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
        theme: defaultTheme,
        presets: [UniverSheetsCorePreset({ container: 'univer' })],
      });
      univerAPI.current = api;

      // 2. Create a visible 100x100 sheet
      (univerAPI.current).createUniverSheet({
        name: 'AI Chat Sheet',
        rowCount: 100,
        columnCount: 100,
      });

      // 3. Register a listener for cell value changes (SetRangeValuesCommand)
      // This command is executed when a user finishes editing a cell by pressing Enter or clicking away.
      const commandService = univerAPI.current.getCommandService();
      const disposeCommandListener = commandService.onCommandExecuted((command) => {
        if (command.id === SetRangeValuesCommand.id) {
          const { unitId, subUnitId, range, value } = command.params;

          // Assuming a single cell edit for simplicity. 'value' is an array of arrays.
          if (value && value.length > 0 && value[0].length > 0) {
            const prompt = value[0][0]; // Get the new cell value as the prompt
            const row = range.startRow;
            const col = range.startColumn;

            if (typeof prompt === 'string' && prompt.trim().length > 0) {
              // Only trigger AI if it's not currently running (to prevent re-triggering on AI's own updates)
              // and if the current AI operation wasn't already triggered by a cell (avoiding loops)
              if (!isRunning && !isCellTriggered.current) {
                aiCellRequestQueue.current.push({
                  prompt: prompt.trim(),
                  targetCellAddress: { unitId, subUnitId, row, col }, // Store full address
                });
                processNextAIRequest();
              }
            }
          }
        }
      });

      // Cleanup function for UniverJS and its command listener
      return () => {
        disposeCommandListener.dispose();
        // If UniverJS has a dispose method, call it here:
        // univerAPI.current.dispose();
      };
    }
  }, [isRunning, processNextAIRequest]); // Dependencies: isRunning to prevent re-triggering, processNextAIRequest for stability

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
          processNextAIRequest(); // Try to process queue when ready
          break;

        case "start":
          {
            // Start generation
            // Only add a new assistant message for chat UI, not for cell responses
            if (!isCellTriggered.current) {
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
            const { output, tps, numTokens } = e.data;
            setTps(tps);
            setNumTokens(numTokens);

            // If triggered by a cell, update the cell directly
            if (isCellTriggered.current && currentCellTarget.current && univerAPI.current) {
              const { unitId, subUnitId, row, col } = currentCellTarget.current;
              const workbook = univerAPI.current.getUniverSheet(unitId);
              const sheet = workbook ? workbook.getWorksheet(subUnitId) : null;

              if (sheet) {
                // Get current cell value to append to it
                const currentCellValue = sheet.getRange(row, col).getValue() || '';
                // Update cell value. UniverJS's setValue will trigger SetRangeValuesCommand,
                // but our listener has a guard for `isRunning` to prevent loops.
                sheet.getRange(row, col).setValue(currentCellValue + output);
              }
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

          // Clean up cell specific refs if it was a cell-triggered request
          if (isCellTriggered.current && currentCellTarget.current) {
            currentCellTarget.current = null;
            isCellTriggered.current = false; // Reset flag
          }
          processNextAIRequest(); // Process next item in queue
          break;

        case "error":
          setError(e.data.data);
          setIsRunning(false); // Make sure to release the running state

          // If triggered by a cell, update the cell with an error message
          if (isCellTriggered.current && currentCellTarget.current && univerAPI.current) {
            const { unitId, subUnitId, row, col } = currentCellTarget.current;
            const workbook = univerAPI.current.getUniverSheet(unitId);
            const sheet = workbook ? workbook.getWorksheet(subUnitId) : null;
            if (sheet) {
              sheet.getRange(row, col).setValue(`ERROR: ${e.data.data}`);
            }
            currentCellTarget.current = null;
            isCellTriggered.current = false; // Reset flag
          }
          processNextAIRequest(); // Process next item in queue
          break;
      }
    };

    const onErrorReceived = (e) => {
      console.error("Worker error:", e);
      setError(`Worker error: ${e.message || 'Unknown'}`); // Set a more specific error
      setIsRunning(false);

      // If triggered by a cell, update the cell with an error message
      if (isCellTriggered.current && currentCellTarget.current && univerAPI.current) {
        const { unitId, subUnitId, row, col } = currentCellTarget.current;
        const workbook = univerAPI.current.getUniverSheet(unitId);
        const sheet = workbook ? workbook.getWorksheet(subUnitId) : null;
        if (sheet) {
          sheet.getRange(row, col).setValue(`WORKER ERROR: ${e.message || 'Unknown'}`);
        }
        currentCellTarget.current = null;
        isCellTriggered.current = false; // Reset flag
      }
      processNextAIRequest(); // Process next item in queue
    };

    // Attach the callback function as an event listener.
    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    // Define a cleanup function for when the component is unmounted.
    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, [processNextAIRequest, isRunning]); // Empty dependency array means this runs once on mount, mimicking initial setup

  // Send the messages to the worker thread whenever the `messages` state changes (for chat UI).
  useEffect(() => {
    // Only send messages to the worker if the current generation is NOT specifically for a cell.
    if (!isCellTriggered.current) {
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

  // Auto-scroll chat container
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
              src="logo.png" // Ensure this image path is correct or replace with a placeholder
              width="80%"
              height="auto"
              className="block"
              alt="Logo"
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
        <div className="flex flex-col h-full w-full">
          {/* UniverJS Spreadsheet Container */}
          <div id="univer" style={{ flex: 1, minHeight: '300px', width: '100%' }}>
            {/* UniverJS will mount here */}
          </div>

          {/* Chat UI - Only display if not currently processing a cell request */}
          <div
            ref={chatContainerRef}
            className="overflow-y-auto scrollbar-thin w-full flex flex-col items-center h-full"
            style={{ flex: 1, display: isCellTriggered.current ? 'none' : 'flex' }} // Hide chat if cell-triggered
          >
            <Chat messages={messages} />
            {messages.length === 0 && (
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-2 max-w-[600px] w-full">
                {EXAMPLES.map((msg, i) => (
                  <div
                    key={i}
                    className="m-1 border dark:border-gray-600 rounded-md p-2 bg-gray-100 dark:bg-gray-700 cursor-pointer text-sm"
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
        </div>
      )}

      {/* Input area for the main chat UI */}
      <div className="mt-2 border dark:bg-gray-700 rounded-lg w-[600px] max-w-[80%] max-h-[200px] mx-auto relative mb-3 flex">
        <textarea
          ref={textareaRef}
          className="scrollbar-thin w-[550px] dark:bg-gray-700 px-3 py-4 rounded-lg bg-transparent border-none outline-none text-gray-800 disabled:text-gray-400 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 disabled:placeholder-gray-200 resize-none disabled:cursor-not-allowed"
          placeholder="Type your message..."
          type="text"
          rows={1}
          value={input}
          disabled={status !== "ready" || isRunning || isCellTriggered.current} // Disable if model not ready OR AI is busy OR cell-triggered
          title={status === "ready" ? "Model is ready" : "Model not loaded yet"}
          onKeyDown={(e) => {
            if (
              input.length > 0 &&
              !isRunning && // Check if AI is NOT running (for chat OR cell)
              !isCellTriggered.current && // Ensure it's not a cell-triggered operation
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
