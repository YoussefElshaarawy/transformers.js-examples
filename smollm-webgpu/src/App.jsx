import { useEffect, useState, useRef, useCallback } from "react";

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
  const worker = useRef(null);
  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);
  const chatRef = useRef(null); // Ref to access methods on Chat component

  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);

  // Function for chat input (standard behavior)
  function onEnter(message) {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setTps(null);
    setIsRunning(true);
    // Clear any pending spreadsheet target when a chat message is sent
    if (worker.current) worker.current._spreadsheetTargetCell = null;
    setInput("");
    worker.current.postMessage({ type: "generate", data: [{ role: "user", content: message }] });
  }

  // Called by Chat.jsx when a cell is edited
  const onSpreadsheetGenerateRequest = useCallback((workbookId, sheetId, row, col, content) => {
    setIsRunning(true);
    setTps(null); // Reset TPS for new generation

    // Attach target cell info directly to the worker instance
    // This is a simple way to pass context from App to its worker message handler
    if (worker.current) {
        worker.current._spreadsheetTargetCell = { workbookId, sheetId, row, col };
    }

    worker.current.postMessage({ type: "generate", data: [{ role: "user", content: content }] });
  }, []); // No dependencies for this callback, as it's a stable function

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

  useEffect(() => {
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
      worker.current.postMessage({ type: "check" });
    }

    const onMessageReceived = (e) => {
      // Check if there's a target spreadsheet cell for this generation
      // This property is set on the worker instance itself by onSpreadsheetGenerateRequest
      const targetCell = worker.current?._spreadsheetTargetCell;

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
            // Only add assistant message to chat if NOT a spreadsheet generation
            if (!targetCell) { // Only for chat output
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

            // Direct output to spreadsheet cell or chat messages
            if (targetCell) {
                // Call method on Chat component via ref to update the spreadsheet cell
                if (chatRef.current && chatRef.current.handleSpreadsheetOutputUpdate) {
                    chatRef.current.handleSpreadsheetOutputUpdate(output, targetCell.workbookId, targetCell.sheetId, targetCell.row, targetCell.col);
                }
            } else {
              // Standard chat message update
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
          setIsRunning(false);
          // Clear target cell reference and notify Chat for spreadsheet completion
          if (targetCell) {
            if (chatRef.current && chatRef.current.handleSpreadsheetOutputComplete) {
                chatRef.current.handleSpreadsheetOutputComplete(targetCell.workbookId, targetCell.sheetId, targetCell.row, targetCell.col);
            }
            if (worker.current) worker.current._spreadsheetTargetCell = null; // Clear target after generation
          }
          break;

        case "error":
          setError(e.data.data);
          setIsRunning(false);
          if (worker.current) worker.current._spreadsheetTargetCell = null; // Clear target on error
          break;
      }
    };

    const onErrorReceived = (e) => {
      console.error("Worker error:", e);
      setIsRunning(false);
      if (worker.current) worker.current._spreadsheetTargetCell = null; // Clear target on error
    };

    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, []); // Dependencies remain minimal, as current target is read from ref

  // This useEffect is now implicitly only for initial chat messages as onEnter
  // directly calls postMessage. For spreadsheet inputs, onSpreadsheetGenerateRequest
  // handles it.
  useEffect(() => {
    // Only send if the last message is from user AND there's no spreadsheet target active
    // This prevents sending partial assistant messages back to the worker
    // or triggering chat generation when a spreadsheet cell is being processed.
    if (messages.filter((x) => x.role === "user").length === 0 || messages.at(-1).role === "assistant" || worker.current?._spreadsheetTargetCell) {
      return;
    }
    // If onEnter already handles sending, this useEffect might be redundant for new chat inputs.
    // However, it's kept to respect original structure and potentially handle historical message loading.
    // If it's truly only for initial chat, onEnter's direct postMessage is sufficient.
    // For now, it's safe to keep as is, but it won't trigger if a spreadsheet cell is active.
    // worker.current.postMessage({ type: "generate", data: messages }); // This line is commented out as onEnter already sends
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


  return IS_WEBGPU_AVAILABLE ? (
    // <--- MODIFIED: Removed 'justify-end' from main container
    <div className="flex flex-col h-screen mx-auto items text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900">
      {/* <--- NEW WRAPPER DIV: This div will take up the available space above the input/disclaimer */}
      <div className="flex-grow w-full overflow-hidden flex flex-col items-center">
        {status === null && messages.length === 0 && (
          <div className="h-full overflow-auto scrollbar-thin flex justify-center items-center flex-col relative">
            <div className="flex flex-col items-center mb-1 max-w-[320px] text-center">
              <img
                src="logo.png"
                width="80%"
                height="auto"
                className="block"
                alt="SmolLM2 WebGPU Logo"
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
          // This Chat component will now fill the flex-grow div
          <Chat
            ref={chatRef}
            messages={messages}
            chatContainerRef={chatContainerRef}
            onSpreadsheetGenerateRequest={onSpreadsheetGenerateRequest}
          />
        )}
      </div> {/* End of flex-grow div */}

      {/* Input area and disclaimer remain at the bottom */}
      <div className="mt-2 border dark:bg-gray-700 rounded-lg w-[600px] max-w-[80%] max-h-[200px] mx-auto relative mb-3 flex">
        <textarea
          ref={textareaRef}
          className="scrollbar-thin w-[550px] dark:bg-gray-700 px-3 py-4 rounded-lg bg-transparent border-none outline-none text-gray-800 disabled:text-gray-400 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 disabled:placeholder-gray-200 resize-none disabled:cursor-not-allowed"
          placeholder="Type your message..."
          type="text"
          rows={1}
          value={input}
          disabled={status !== "ready" || isRunning} // Disable if LLM is running
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
