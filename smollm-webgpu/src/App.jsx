import { useEffect, useState, useRef } from "react";

// Corrected imports based on typical project structure and your repo
import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";
import Spreadsheet from "./components/Spreadsheet";

const IS_WEBGPU_AVAILABLE = typeof navigator !== 'undefined' && !!navigator.gpu;
const STICKY_SCROLL_THRESHOLD = 120;
const EXAMPLES = [
  "Give me some tips to improve my time management skills.",
  "What is the difference between AI and ML?",
  "Write python code to compute the nth fibonacci number.",
];
// Assuming your logo is in public/logo.png or similar, adjust path if needed
const LOGO_URL = "./logo.png"; // Or direct URL: "https://placehold.co/240x80/3B82F6/FFFFFF?text=SmolLM+GPU";

// Helper for Taylor Swift formula
const taylorSwiftAlbums = [
    "Taylor Swift", "Fearless", "Speak Now", "Red", "1989", "Reputation",
    "Lover", "folklore", "evermore", "Midnights", "THE TORTURED POETS DEPARTMENT"
];
const taylorSwiftLyrics = [
    "You belong with me.",
    "Long live the walls we crashed through.",
    "I had the time of my life fighting dragons with you.",
    "We are never ever getting back together.",
    "Blank Space, baby.",
    "Look what you made me do.",
    "You are what you love."
];

function evaluateTaylorSwiftFormula(prompt) {
    if (!prompt) return "Invalid TAYLORSWIFT prompt";
    const parts = prompt.toLowerCase().split(',');
    const type = parts[0]?.trim().replace(/"/g, '');

    if (type === 'album') {
        const index = parseInt(parts[1]?.trim(), 10);
        if (!isNaN(index) && index > 0 && index <= taylorSwiftAlbums.length) {
            return taylorSwiftAlbums[index - 1];
        }
        return `Invalid album index. Use 1-${taylorSwiftAlbums.length}.`;
    }
    if (type === 'lyric') {
        return taylorSwiftLyrics[Math.floor(Math.random() * taylorSwiftLyrics.length)];
    }
    return 'Usage: =TAYLORSWIFT("album", index) or =TAYLORSWIFT("lyric")';
}


function App() {
  const worker = useRef(null);
  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);

  const [status, setStatus] = useState(null); // null, 'loading', 'ready', 'error', 'no_webgpu'
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false); // For chat generation

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);

  const [spreadsheetData, setSpreadsheetData] = useState({
    "0-0": { formula: '=AI("Capital of France?")', result: '', isLoading: false, error: null },
    "0-1": { formula: '=TAYLORSWIFT("album", 5)', result: '', isLoading: false, error: null },
    "1-0": { formula: '=AI("What is 10 + 5?")', result: '', isLoading: false, error: null },
    "1-1": { formula: '=TAYLORSWIFT("lyric")', result: '', isLoading: false, error: null },
  });


  function onEnterChat(message) {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setTps(null);
    setNumTokens(null);
    setIsRunning(true);
    setInput("");
  }

  function onInterruptChat() {
    if (worker.current) {
      worker.current.postMessage({ type: "interrupt" });
    }
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
    if (!worker.current && IS_WEBGPU_AVAILABLE && typeof Worker !== 'undefined') {
      try {
        // Vite expects worker constructor with `new URL` to correctly bundle the worker.
        // Ensure 'worker.js' is in the 'src' directory or adjust the path.
        // If worker.js is in public, the path would be different and it won't be processed by Vite.
        // For Vite, typical placement is in `src` and it handles the bundling.
        worker.current = new Worker(new URL("./worker.js", import.meta.url), {
          type: "module",
        });
        worker.current.postMessage({ type: "check" });

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
                prev.map((item) =>
                  item.file === e.data.file ? { ...item, ...e.data } : item
                )
              );
              break;
            case "done":
              setProgressItems((prev) =>
                prev.filter((item) => item.file !== e.data.file)
              );
              break;
            case "ready":
              setStatus("ready");
              setLoadingMessage("");
              // Initial evaluation moved to a separate useEffect dependent on 'status'
              break;
            case "start":
              setMessages((prevMessages) => [
                ...prevMessages,
                { role: "assistant", content: "" },
              ]);
              break;
            case "update":
              const { output, tps: newTps, numTokens: newNumTokens } = e.data;
              setTps(newTps);
              setNumTokens(newNumTokens);
              setMessages((prevMessages) => {
                const cloned = [...prevMessages];
                const last = cloned.at(-1);
                if (last && last.role === 'assistant') {
                  cloned[cloned.length - 1] = {
                    ...last,
                    content: last.content + output,
                  };
                }
                return cloned;
              });
              break;
            case "complete":
              setIsRunning(false);
              break;
            case "error":
              setError(e.data.data);
              setStatus("error");
              setIsRunning(false);
              setSpreadsheetData(prevData => {
                  const updated = {...prevData};
                  Object.keys(updated).forEach(cellId => {
                      if (updated[cellId].isLoading) {
                          updated[cellId] = {...updated[cellId], isLoading: false, error: "Model error occurred"};
                      }
                  });
                  return updated;
              });
              break;
            case "ai_formula_processing": {
              const { cellId } = e.data;
              setSpreadsheetData(prevData => ({
                  ...prevData,
                  [cellId]: { ...(prevData[cellId] || {}), isLoading: true, error: null }
              }));
              break;
            }
            case "ai_formula_complete": {
              const { output: formulaOutput, cellId } = e.data;
              setSpreadsheetData(prevData => ({
                  ...prevData,
                  [cellId]: { ...(prevData[cellId] || {}), result: formulaOutput, isLoading: false }
              }));
              break;
            }
            case "ai_formula_error": {
              const { error: formulaError, cellId } = e.data;
              setSpreadsheetData(prevData => ({
                  ...prevData,
                  [cellId]: { ...(prevData[cellId] || {}), error: formulaError, isLoading: false }
              }));
              break;
            }
            default:
              // console.warn("Unknown message from worker:", e.data);
              break;
          }
        };

        const onErrorReceived = (e) => {
          console.error("Worker error:", e);
          setError(`Worker error: ${e.message}. Check console for details.`);
          setStatus("error");
        };

        worker.current.addEventListener("message", onMessageReceived);
        worker.current.addEventListener("error", onErrorReceived);

        return () => {
          if (worker.current) {
              worker.current.removeEventListener("message", onMessageReceived);
              worker.current.removeEventListener("error", onErrorReceived);
              worker.current.terminate();
              worker.current = null;
          }
        };
      } catch (err) {
        console.error("Failed to create worker:", err);
        setError("Failed to initialize Web Worker. Ensure worker.js is in the src/ directory and correctly referenced.");
        setStatus("error");
      }
    } else if (!IS_WEBGPU_AVAILABLE && status === null) {
        setStatus("no_webgpu");
    }
  }, []); // Empty dependency array: runs once on mount.

  // Effect to evaluate spreadsheet cells when model becomes ready
  useEffect(() => {
    if (status === "ready") {
        Object.entries(spreadsheetData).forEach(([cellId, cellContent]) => {
            if (cellContent.formula && !cellContent.result && !cellContent.isLoading && !cellContent.error) {
                 evaluateSpreadsheetCell(cellId, cellContent.formula);
            }
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]); // Depends on status to trigger when model is ready


  useEffect(() => {
    if (status !== "ready" || !isRunning) return;
    const lastMessage = messages.at(-1);
    if (messages.filter((x) => x.role === "user").length === 0 || (lastMessage && lastMessage.role === "assistant")) {
      return;
    }
    if (worker.current) {
      worker.current.postMessage({ type: "generate", data: messages });
    }
  }, [messages, isRunning, status]);

  useEffect(() => {
    if (!chatContainerRef.current) return;
    const element = chatContainerRef.current;
    if (
      element.scrollHeight - element.scrollTop - element.clientHeight <
      STICKY_SCROLL_THRESHOLD || isRunning
    ) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, isRunning]);

  const updateSpreadsheetCellFormula = (cellId, newFormula) => {
    setSpreadsheetData(prev => ({
        ...prev,
        [cellId]: { ...(prev[cellId] || {}), formula: newFormula, result: '', isLoading: false, error: null }
    }));
  };

  const evaluateSpreadsheetCell = (cellId, formula) => {
    if (typeof formula !== 'string') {
        setSpreadsheetData(prev => ({
            ...prev,
            [cellId]: { ...(prev[cellId] || {}), result: 'Invalid formula', error: 'Formula is not a string', isLoading: false }
        }));
        return;
    }

    if (formula.toUpperCase().startsWith('=AI(') && formula.endsWith(')')) {
        if (status !== "ready" || !worker.current) {
            setSpreadsheetData(prev => ({
                ...prev,
                [cellId]: { ...(prev[cellId] || {formula}), error: "AI Model not ready.", isLoading: false }
            }));
            return;
        }
        const prompt = formula.substring(4, formula.length - 1);
        setSpreadsheetData(prev => ({
            ...prev,
            [cellId]: { ...(prev[cellId] || {formula}), isLoading: true, error: null, result: '' }
        }));
        worker.current.postMessage({
            type: "ai_formula",
            data: prompt,
            cellId: cellId
        });
    } else if (formula.toUpperCase().startsWith('=TAYLORSWIFT(') && formula.endsWith(')')) {
        const prompt = formula.substring(13, formula.length - 1);
        const result = evaluateTaylorSwiftFormula(prompt);
        setSpreadsheetData(prev => ({
            ...prev,
            [cellId]: { ...(prev[cellId] || {formula}), result: result, isLoading: false, error: null }
        }));
    } else {
        setSpreadsheetData(prev => ({
            ...prev,
            [cellId]: { ...(prev[cellId] || {}), formula: formula, result: formula, isLoading: false, error: null }
        }));
    }
  };

  if (status === "no_webgpu") {
    return (
      <div className="fixed inset-0 w-screen h-screen bg-black z-10 bg-opacity-90 text-white text-2xl font-semibold flex justify-center items-center text-center p-4">
        WebGPU is not supported by this browser, or it is disabled. <br/> Please use a compatible browser like Chrome or Edge (version 113+).
      </div>
    );
  }

  if (status === null && messages.length === 0) {
    return (
      <div className="flex flex-col h-screen mx-auto items-center justify-center text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 p-4">
        <div className="flex flex-col items-center mb-4 max-w-md text-center">
          <img src={LOGO_URL} alt="SmolLM GPU Logo" className="mb-4" style={{width: '240px', height: 'auto'}}/>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">SmolLM GPU Chat & Sheet</h1>
          <h2 className="text-base md:text-lg font-semibold text-gray-600 dark:text-gray-400">
            A fast AI chatbot and spreadsheet that runs locally in your browser.
          </h2>
        </div>
        <div className="flex flex-col items-center px-4 max-w-lg">
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
            You are about to load{" "}
            <a href="https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct" target="_blank" rel="noreferrer" className="font-medium underline text-blue-600 dark:text-blue-400">
              SmolLM2-1.7B-Instruct
            </a>. Everything runs in your browser with{" "}
            <a href="https://huggingface.co/docs/transformers.js" target="_blank" rel="noreferrer" className="underline text-blue-600 dark:text-blue-400">
              🤗&nbsp;Transformers.js
            </a>.
          </p>
          {error && (
            <div className="text-red-500 dark:text-red-400 text-center mb-2 p-3 bg-red-50 dark:bg-red-900 rounded-lg">
              <p className="mb-1 font-semibold">Unable to load model:</p>
              <p className="text-xs">{error}</p>
            </div>
          )}
          <button
            className="border px-6 py-3 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:bg-blue-300 dark:disabled:bg-blue-800 disabled:cursor-not-allowed select-none text-lg font-medium shadow-md hover:shadow-lg transition-all"
            onClick={() => {
                if (IS_WEBGPU_AVAILABLE) {
                    if (!worker.current) {
                        // This condition implies the useEffect for worker initialization might not have run or failed.
                        // Attempting to set a state to trigger re-evaluation of useEffects might help.
                        // However, the main logic for worker init is in useEffect.
                        console.warn("Load clicked, worker not initialized. Check console for worker creation errors.");
                        setError("Worker initialization failed or pending. Please wait or refresh.");
                        // Optionally, try to re-trigger useEffect for worker creation if it depends on a state
                        // that can be toggled here, but it's usually better to ensure useEffect runs correctly on mount.
                    } else if (status !== 'loading' && status !== 'ready') { // Allow load/retry if not already loading/ready
                        worker.current.postMessage({ type: "load" });
                        setStatus("loading");
                        setError(null);
                    }
                } else {
                    setStatus("no_webgpu");
                }
            }}
            disabled={status === "loading" || status === "ready" || !IS_WEBGPU_AVAILABLE}
          >
            Load Model
          </button>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="flex flex-col h-screen mx-auto items-center justify-center text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 p-4">
        <img src={LOGO_URL} alt="SmolLM GPU Logo" className="mb-4" style={{width: '200px', height: 'auto'}}/>
        <div className="w-full max-w-md text-left mx-auto p-4 rounded-lg shadow-lg bg-gray-50 dark:bg-gray-800">
          <p className="text-center text-lg font-semibold mb-3 text-gray-700 dark:text-gray-300">{loadingMessage || "Loading model..."}</p>
          {progressItems.map(({ file, progress, total }, i) => (
            <Progress key={i} text={file} percentage={progress} total={total} />
          ))}
        </div>
      </div>
    );
  }

  if (status === "error" && !loadingMessage) { // Show a more prominent error if not during loading phase
    return (
      <div className="flex flex-col h-screen mx-auto items-center justify-center text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 p-4">
        <img src={LOGO_URL} alt="SmolLM GPU Logo" className="mb-4" style={{width: '200px', height: 'auto'}}/>
        <div className="text-red-500 dark:text-red-400 text-center mb-2 p-4 bg-red-50 dark:bg-red-900 rounded-lg shadow-lg max-w-md">
            <h2 className="text-xl font-semibold mb-2">An Error Occurred</h2>
            <p className="text-sm">{error || "An unknown error occurred. Please try refreshing the page or check the console."}</p>
            <button
                className="mt-4 border px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600"
                onClick={() => window.location.reload()}
            >
                Refresh Page
            </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      <div className="flex-grow flex flex-col md:flex-row overflow-hidden">
        <div className="w-full md:w-1/4 flex flex-col h-1/2 md:h-full border-r border-gray-200 dark:border-gray-700">
          <div
            ref={chatContainerRef}
            className="flex-grow overflow-y-auto scrollbar-thin p-4 space-y-4"
          >
            <Chat messages={messages} />
            {messages.length === 0 && status === "ready" && (
              <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
                <h3 className="text-lg font-semibold mb-2">Chat with SmolLM</h3>
                <p className="mb-4 text-sm">Model is ready. Try an example or type your message below.</p>
                <div className="space-y-2 max-w-md mx-auto">
                  {EXAMPLES.map((msg, i) => (
                    <div
                      key={i}
                      className="m-1 border dark:border-gray-600 rounded-md p-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer transition-colors text-xs"
                      onClick={() => onEnterChat(msg)}
                    >
                      {msg}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="p-2 text-center text-xs min-h-6 text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700">
            {tps && messages.length > 0 && messages.at(-1)?.role === 'assistant' && (
              <>
                {!isRunning && numTokens > 0 && (
                  <span>
                    Gen. {numTokens} tokens in {(numTokens / tps).toFixed(1)}s&nbsp;(&nbsp;
                  </span>
                )}
                <span className="font-medium text-black dark:text-white">{tps.toFixed(1)}</span>
                <span className="text-gray-500 dark:text-gray-300">&nbsp;tok/s</span>
                {!isRunning && numTokens > 0 && <span>&nbsp;).&nbsp;</span>}
                {!isRunning && (
                  <span
                    className="underline cursor-pointer hover:text-blue-500 dark:hover:text-blue-400"
                    onClick={() => {
                      if (worker.current) worker.current.postMessage({ type: "reset" });
                      setMessages([]);
                      setTps(null);
                      setNumTokens(null);
                    }}
                  >
                    Reset
                  </span>
                )}
              </>
            )}
             {isRunning && <span className="italic">Generating...</span>}
          </div>
          <div className="p-2 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-end bg-gray-100 dark:bg-gray-800 rounded-lg p-1 shadow">
              <textarea
                ref={textareaRef}
                className="flex-grow p-3 bg-transparent border-none outline-none text-gray-800 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 resize-none scrollbar-thin disabled:opacity-50"
                placeholder="Chat message..."
                rows={1}
                value={input}
                disabled={status !== "ready" || isRunning}
                title={status === "ready" ? "Model is ready" : "Model not loaded yet"}
                onKeyDown={(e) => {
                  if (input.trim().length > 0 && !isRunning && e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onEnterChat(input.trim());
                  }
                }}
                onInput={(e) => setInput(e.target.value)}
              />
              <button
                onClick={() => (isRunning ? onInterruptChat() : (input.trim().length > 0 && onEnterChat(input.trim())))}
                disabled={status !== "ready" || (input.trim().length === 0 && !isRunning)}
                className="p-2 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                aria-label={isRunning ? "Stop generation" : "Send message"}
              >
                {isRunning ? (
                  <StopIcon className="h-6 w-6 text-red-500 hover:text-red-600" />
                ) : (
                  <ArrowRightIcon className={`h-6 w-6 ${input.trim().length > 0 ? 'text-blue-500 hover:text-blue-600' : 'text-gray-400 dark:text-gray-600'}`} />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="w-full md:w-3/4 flex flex-col h-1/2 md:h-full">
           <Spreadsheet
                spreadsheetData={spreadsheetData}
                updateCellFormula={updateSpreadsheetCellFormula}
                evaluateCell={evaluateSpreadsheetCell}
                isModelReady={status === "ready"}
            />
        </div>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2 border-t border-gray-200 dark:border-gray-700">
        Disclaimer: Generated content may be inaccurate or false. Model runs locally.
      </p>
    </div>
  );
}

export default App;
