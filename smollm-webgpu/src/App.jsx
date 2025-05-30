// ============== App.jsx ==============
import { useEffect, useState, useRef } from "react";

// Assuming these components are in ./components/ or ./components/icons/
// Placeholders will be defined below if not provided by user.
import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";
import Spreadsheet from "./components/Spreadsheet"; // New component

const IS_WEBGPU_AVAILABLE = typeof navigator !== 'undefined' && !!navigator.gpu;
const STICKY_SCROLL_THRESHOLD = 120;
const EXAMPLES = [
  "Give me some tips to improve my time management skills.",
  "What is the difference between AI and ML?",
  "Write python code to compute the nth fibonacci number.",
];
const LOGO_URL = "https://placehold.co/240x80/3B82F6/FFFFFF?text=SmolLM+GPU"; // Placeholder logo

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

  // Spreadsheet state
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
    if (!worker.current && IS_WEBGPU_AVAILABLE) {
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
            // Automatically evaluate initial spreadsheet formulas once model is ready
            Object.entries(spreadsheetData).forEach(([cellId, cellContent]) => {
                if (cellContent.formula && !cellContent.result && !cellContent.isLoading) {
                     evaluateSpreadsheetCell(cellId, cellContent.formula);
                }
            });
            break;
          case "start": 
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "" },
            ]);
            break;
          case "update": 
            const { output, tps: newTps, numTokens: newNumTokens } = e.data;
            setTps(newTps);
            setNumTokens(newNumTokens);
            setMessages((prev) => {
              const cloned = [...prev];
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
            // Also set error for any spreadsheet cells that were loading
            setSpreadsheetData(prev => {
                const updated = {...prev};
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
            setSpreadsheetData(prev => ({
                ...prev,
                [cellId]: { ...(prev[cellId] || {}), isLoading: true, error: null }
            }));
            break;
          }
          case "ai_formula_complete": {
            const { output: formulaOutput, cellId } = e.data;
            setSpreadsheetData(prev => ({
                ...prev,
                [cellId]: { ...(prev[cellId] || {}), result: formulaOutput, isLoading: false }
            }));
            break;
          }
          case "ai_formula_error": {
            const { error: formulaError, cellId } = e.data;
            setSpreadsheetData(prev => ({
                ...prev,
                [cellId]: { ...(prev[cellId] || {}), error: formulaError, isLoading: false }
            }));
            break;
          }
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
    } else if (!IS_WEBGPU_AVAILABLE && status === null) {
        setStatus("no_webgpu");
    }
  }, [status]); // Rerun if status changes, e.g. to re-evaluate after model load.

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
        // Not a special formula, treat the formula string as the result directly
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
              if (worker.current) {
                worker.current.postMessage({ type: "load" });
                setStatus("loading");
                setError(null); 
              } else if (IS_WEBGPU_AVAILABLE) { // Should have been initialized
                  console.error("Worker not initialized but WebGPU is available. This should not happen.");
                  setError("Initialization error. Please refresh.");
              } else {
                  setStatus("no_webgpu"); // Should already be set, but as a fallback
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
  
  if (status === "error" && !loadingMessage) { 
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
        {/* Chat Area: 1/4 width on medium screens and up */}
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

        {/* Spreadsheet Area: 3/4 width on medium screens and up */}
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


// ============== components/Chat.jsx ==============
const Chat = ({ messages }) => {
  if (!messages || messages.length === 0) {
    return null; 
  }
  return (
    <>
      {messages.map((msg, index) => (
        <div key={index} className={`flex w-full my-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`max-w-[90%] px-3 py-2 rounded-lg shadow-sm ${
              msg.role === 'user'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
            }`}
          >
            <p className="text-sm whitespace-pre-wrap break-words overflow-wrap-anywhere">{msg.content}</p>
          </div>
        </div>
      ))}
    </>
  );
};

// ============== components/Progress.jsx ==============
const Progress = ({ text, percentage, total }) => {
  const loadedMB = total && percentage ? (total * percentage / 100 / (1024*1024)).toFixed(2) : 0;
  const totalMB = total ? (total / (1024*1024)).toFixed(2) : 0;

  return (
    <div className="my-2 w-full">
      <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-0.5">
        <span className="truncate max-w-[60%]">{text}</span>
        {total > 0 && <span>{percentage !== undefined ? percentage.toFixed(1) : '0'}% ({loadedMB}MB / {totalMB}MB)</span>}
        {!total && percentage !== undefined && <span>{percentage.toFixed(1)}%</span>}
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2 overflow-hidden">
        <div 
          className="bg-blue-500 h-2 rounded-full transition-all duration-300 ease-out" 
          style={{ width: `${percentage || 0}%` }}
        ></div>
      </div>
    </div>
  );
};

// ============== components/icons/ArrowRightIcon.jsx ==============
const ArrowRightIcon = ({ className }) => (
  <svg className={className || "h-6 w-6"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 12h14" />
  </svg>
);

// ============== components/icons/StopIcon.jsx ==============
const StopIcon = ({ className }) => (
  <svg className={className || "h-6 w-6"} viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h12v12H6z" />
  </svg>
);

// ============== components/Spreadsheet.jsx ==============
const Spreadsheet = ({ spreadsheetData, updateCellFormula, evaluateCell, isModelReady }) => {
    const numRows = 5; // Increased for more space
    const numCols = 4;

    const renderCellContent = (cell) => {
        if (cell.isLoading) {
            return <span className="text-xs italic text-blue-500 dark:text-blue-400">Loading...</span>;
        }
        if (cell.error) {
            return <span className="text-xs text-red-500 dark:text-red-400 break-all">Error: {cell.error}</span>;
        }
        if (cell.result !== undefined && cell.result !== null) {
            return <span className="text-sm break-all">{String(cell.result)}</span>;
        }
        return <span className="text-xs text-gray-400 dark:text-gray-500"></span>; 
    };
    
    const rows = [];
    for (let r = 0; r < numRows; r++) {
        const cols = [];
        for (let c = 0; c < numCols; c++) {
            const cellId = `${r}-${c}`;
            const cell = spreadsheetData[cellId] || { formula: '', result: '', isLoading: false, error: null };
            cols.push(
                <td key={cellId} className="border border-gray-300 dark:border-gray-600 p-0 h-24 align-top relative group">
                    <textarea
                        value={cell.formula || ''}
                        onChange={(e) => updateCellFormula(cellId, e.target.value)}
                        onBlur={(e) => evaluateCell(cellId, e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                evaluateCell(cellId, e.target.value);
                                e.target.blur();
                            }
                        }}
                        className="w-full h-10 p-1.5 bg-transparent dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400 resize-none text-sm scrollbar-thin absolute top-0 left-0 z-10"
                        placeholder={`${String.fromCharCode(65 + c)}${r + 1}`}
                        disabled={!isModelReady}
                        aria-label={`Spreadsheet cell ${String.fromCharCode(65 + c)}${r + 1} formula input`}
                    />
                    <div className="p-1.5 pt-10 h-full overflow-y-auto scrollbar-thin"> 
                      {renderCellContent(cell)}
                    </div>
                </td>
            );
        }
        rows.push(<tr key={r}>{cols}</tr>);
    }

    return (
        <div className="p-4 bg-gray-50 dark:bg-gray-800 h-full flex flex-col">
            <h2 className="text-xl font-semibold mb-3 text-gray-800 dark:text-gray-200">AI Spreadsheet</h2>
            {!isModelReady && <p className="text-sm text-orange-500 dark:text-orange-400 mb-2">Model not ready. Spreadsheet is disabled.</p>}
            <div className="overflow-auto flex-grow">
                <table className="table-fixed border-collapse border border-gray-400 dark:border-gray-500 w-full">
                    <thead>
                        <tr>
                            <th className="border border-gray-300 dark:border-gray-600 p-1.5 w-10 bg-gray-100 dark:bg-gray-700 sticky top-0 z-20"></th>
                            {Array.from({length: numCols}).map((_, c) => (
                                <th key={c} className="border border-gray-300 dark:border-gray-600 p-1.5 bg-gray-100 dark:bg-gray-700 text-sm sticky top-0 z-20">
                                    {String.fromCharCode(65 + c)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, rIndex) => (
                             <tr key={rIndex}>
                                <td className="border border-gray-300 dark:border-gray-600 p-1.5 bg-gray-100 dark:bg-gray-700 text-sm text-center sticky left-0 z-10">{rIndex + 1}</td>
                                {row.props.children} 
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Use <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{"=AI(\"prompt\")"}</code> or <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{"=TAYLORSWIFT(\"type\", value)"}</code>.
            </p>
        </div>
    );
};


// ============== worker.js ==============
// (Modified from user's original)
import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  InterruptableStoppingCriteria,
} from "@huggingface/transformers";

async function checkWebGPUSupport() {
  try {
    if (!navigator.gpu) {
      throw new Error("navigator.gpu is not available.");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("WebGPU is not supported (no adapter found).");
    }
    return true;
  } catch (e) {
    self.postMessage({
      status: "error",
      data: `WebGPU check failed: ${e.message}`,
    });
    return false;
  }
}

class TextGenerationPipeline {
  static model_id = "HuggingFaceTB/SmolLM2-1.7B-Instruct"; 
  static tokenizer_id = "HuggingFaceTB/SmolLM2-1.7B-Instruct"; 
  static model = null;
  static tokenizer = null;

  static async getInstance(progress_callback = null) {
    // Ensure this.tokenizer and this.model are treated as promises until resolved
    if (!this.tokenizerPromise) {
        this.tokenizerPromise = AutoTokenizer.from_pretrained(this.tokenizer_id, {
            progress_callback,
        });
    }
    if (!this.modelPromise) {
        this.modelPromise = AutoModelForCausalLM.from_pretrained(this.model_id, {
            dtype: "q4f16", 
            device: "webgpu",
            progress_callback,
        });
    }
    
    // Await the promises if they haven't been resolved to actual instances yet
    if (typeof this.tokenizerPromise.then === 'function') {
        this.tokenizer = await this.tokenizerPromise;
    }
    if (typeof this.modelPromise.then === 'function') {
        this.model = await this.modelPromise;
    }
    return [this.tokenizer, this.model];
  }
}

const chat_stopping_criteria = new InterruptableStoppingCriteria();
let chat_past_key_values_cache = null;

async function generateChatResponse(messages) {
  try {
    const [tokenizer, model] = await TextGenerationPipeline.getInstance();

    const inputs = tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      return_dict: true,
    });

    let startTime;
    let numTokens = 0;
    let tps;

    const token_callback_function = () => {
      startTime = startTime ?? performance.now();
      if (++numTokens > 0) { 
        tps = (numTokens / (performance.now() - startTime)) * 1000;
      }
    };

    const callback_function = (output) => {
      self.postMessage({
        status: "update", 
        output,
        tps,
        numTokens,
      });
    };

    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function,
      token_callback_function,
    });

    self.postMessage({ status: "start" }); 

    const generationOutput = await model.generate({
      ...inputs,
      past_key_values: chat_past_key_values_cache,
      max_new_tokens: 512, 
      streamer,
      stopping_criteria: chat_stopping_criteria,
      return_dict_in_generate: true, 
    });
    chat_past_key_values_cache = generationOutput.past_key_values;
    
    self.postMessage({
      status: "complete", 
    });
  } catch (e) {
    console.error("Chat generation error:", e);
    self.postMessage({ status: "error", data: `Chat generation failed: ${e.message}` });
  }
}

async function handleAiFormula(prompt, cellId) {
  try {
    self.postMessage({ status: "ai_formula_processing", cellId });

    const [tokenizer, model] = await TextGenerationPipeline.getInstance();
    
    const inputs = tokenizer(prompt, { return_dict: true });

    const { sequences } = await model.generate({
        ...inputs,
        max_new_tokens: 128, 
    });

    const decoded = tokenizer.batch_decode(sequences, {
        skip_special_tokens: true,
    });
    
    self.postMessage({
        status: "ai_formula_complete",
        output: decoded[0] || "", 
        cellId: cellId,
    });

  } catch (e) {
    console.error("AI formula error:", e);
    self.postMessage({
        status: "ai_formula_error",
        error: `AI Formula error: ${e.message}`,
        cellId: cellId,
    });
  }
}


async function loadModel() {
  self.postMessage({
    status: "loading",
    data: "Loading model and tokenizer...",
  });

  try {
    // Reset promises to ensure fresh loading if this function is called again after an error
    TextGenerationPipeline.tokenizerPromise = null;
    TextGenerationPipeline.modelPromise = null;
    TextGenerationPipeline.tokenizer = null;
    TextGenerationPipeline.model = null;

    const [tokenizer, model] = await TextGenerationPipeline.getInstance((progress) => {
      self.postMessage(progress); 
    });

    self.postMessage({
      status: "loading",
      data: "Compiling shaders and warming up model...",
    });

    const dummyPrompt = "Hello"; 
    const inputs = tokenizer(dummyPrompt);
    await model.generate({ ...inputs, max_new_tokens: 1 });
    
    self.postMessage({ status: "ready" });

  } catch (e) {
    console.error("Model loading error:", e);
    self.postMessage({ status: "error", data: `Model loading failed: ${e.message}. Ensure WebGPU is enabled and working.` });
  }
}

self.addEventListener("message", async (e) => {
  const { type, data, cellId } = e.data;

  switch (type) {
    case "check":
      await checkWebGPUSupport();
      break;
    case "load":
      await loadModel();
      break;
    case "generate": 
      chat_stopping_criteria.reset();
      await generateChatResponse(data); 
      break;
    case "interrupt": 
      chat_stopping_criteria.interrupt();
      break;
    case "reset": 
      chat_past_key_values_cache = null;
      chat_stopping_criteria.reset();
      self.postMessage({ status: "info", data: "Chat context reset."});
      break;
    case "ai_formula": 
      await handleAiFormula(data, cellId); 
      break;
    default:
      console.warn("Unknown message type received in worker:", type);
      break;
  }
});
```

```css
/* index.css - User provided, with minor additions if necessary */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer utilities {
  .scrollbar-thin::-webkit-scrollbar {
    @apply w-2 h-2; /* Added h-2 for horizontal scrollbars if they appear */
  }

  .scrollbar-thin::-webkit-scrollbar-track {
    @apply rounded-full bg-gray-100 dark:bg-gray-700;
  }

  .scrollbar-thin::-webkit-scrollbar-thumb {
    @apply rounded-full bg-gray-300 dark:bg-gray-600;
  }

  .scrollbar-thin::-webkit-scrollbar-thumb:hover {
    @apply bg-gray-500 dark:bg-gray-500; /* Dark mode hover consistency */
  }

  .animation-delay-200 {
    animation-delay: 200ms;
  }
  .animation-delay-400 {
    animation-delay: 400ms;
  }

  .overflow-wrap-anywhere {
    overflow-wrap: anywhere;
  }
}

/* Additional global styles if needed */
body {
  @apply font-sans antialiased;
}
```

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WebGPU AI Chat & Spreadsheet</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🧠</text></svg>">
    <script>
        // Basic dark mode persistence (optional, can be enhanced)
        if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
    </script>
</head>
<body class="bg-white dark:bg-gray-900">
    <div id="chat-root"></div>
    </body>
</html>
```

```javascript
// main.jsx (User provided)
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css"; // Assuming this is how Tailwind is included

const chatRoot = document.getElementById("chat-root");
if (!chatRoot) {
  throw new Error("Could not find #chat-root in index.html. Ensure your HTML file has this div.");
}

ReactDOM.createRoot(chatRoot).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
