import { useEffect, useState, useRef } from "react";

import Chat from "./components/Chat";
// We are NOT importing Spreadsheet component here, as per your request.
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

    // AI Spreadsheet related states
    const [spreadsheetInput, setSpreadsheetInput] = useState('');
    const [spreadsheetOutput, setSpreadsheetOutput] = useState('Type =AI("your prompt") and press Enter here!');
    const [isAiFormulaGenerating, setIsAiFormulaGenerating] = useState(false); // To disable input during generation

    // Model loading and progress (existing)
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);
    const [loadingMessage, setLoadingMessage] = useState("");
    const [progressItems, setProgressItems] = useState([]);
    const [isRunning, setIsRunning] = useState(false); // For chat
    const isModelReady = status === "ready";

    // Chat related states (existing)
    const [input, setInput] = useState(""); // For chat input
    const [messages, setMessages] = useState([]); // For chat messages
    const [tps, setTps] = useState(null);
    const [numTokens, setNumTokens] = useState(null);

    // Chat related functions (existing)
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

    // Worker setup and message handling (modified to handle AI formula responses)
    useEffect(() => {
        if (!worker.current) {
            worker.current = new Worker(new URL("./worker.js", import.meta.url), {
                type: "module",
            });
            worker.current.postMessage({ type: "check" });
        }

        const onMessageReceived = (e) => {
            switch (e.data.type) { // IMPORTANT: Check `e.data.type` or `e.data.status`
                case "ai_formula_complete": // NEW: For AI formula results
                    setSpreadsheetOutput(e.data.payload);
                    setIsAiFormulaGenerating(false);
                    break;
                case "ai_formula_error": // NEW: For AI formula errors
                    setSpreadsheetOutput(`ERROR: ${e.data.error}`);
                    setIsAiFormulaGenerating(false);
                    break;

                // Existing chat/model status messages (might need to check e.data.status or e.data.type)
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
                        setMessages((prev) => [
                            ...prev,
                            { role: "assistant", content: "" },
                        ]);
                    }
                    break;
                case "update":
                    {
                        const { output, tps, numTokens } = e.data;
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
                    }
                    break;
                case "complete":
                    setIsRunning(false);
                    break;
                case "error": // General error for chat/model loading
                    setError(e.data.data);
                    break;
            }
        };

        const onErrorReceived = (e) => {
            console.error("Worker error:", e);
            setError("A worker error occurred: " + e.message); // Update error state if a worker error occurs
        };

        worker.current.addEventListener("message", onMessageReceived);
        worker.current.addEventListener("error", onErrorReceived);

        return () => {
            worker.current.removeEventListener("message", onMessageReceived);
            worker.current.removeEventListener("error", onErrorReceived);
        };
    }, []);

    // Effect for sending chat messages (existing)
    useEffect(() => {
        if (messages.filter((x) => x.role === "user").length === 0) {
            return;
        }
        if (messages.at(-1).role === "assistant") {
            return;
        }
        setTps(null);
        worker.current.postMessage({ type: "generate", data: messages });
    }, [messages, isRunning]);

    // Effect for chat scroll (existing)
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

    // NEW: Function to handle AI formula input in the spreadsheet section
    const handleSpreadsheetInputKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault(); // Prevent new line in textarea
            const formulaText = spreadsheetInput.trim();

            if (formulaText.startsWith('=AI(') && formulaText.endsWith(')')) {
                if (!isModelReady) {
                    setSpreadsheetOutput('AI model not ready. Please wait for it to load.');
                    return;
                }
                if (isAiFormulaGenerating) {
                    setSpreadsheetOutput('Still generating previous AI formula. Please wait.');
                    return;
                }

                const prompt = formulaText.substring(4, formulaText.length - 1).trim();

                if (prompt) {
                    setIsAiFormulaGenerating(true);
                    setSpreadsheetOutput('Generating AI response...');
                    // Send the prompt to the worker
                    worker.current.postMessage({
                        type: "generate_ai_formula", // This needs to be handled in worker.js
                        data: {
                            prompt: prompt,
                            // You don't need a requestId if it's just one output box
                            // requestId: `formula-req-${Date.now()}` // (Optional, if you needed multiple outputs)
                        },
                    });
                } else {
                    setSpreadsheetOutput('ERROR: AI formula requires a prompt, e.g., =AI("Summarize this text").');
                }
            } else {
                // If it's not an AI formula, just display it or clear for next input
                setSpreadsheetOutput(formulaText || 'Type =AI("your prompt") and press Enter here!');
            }
            setSpreadsheetInput(''); // Clear input after processing
        }
    };


    return IS_WEBGPU_AVAILABLE ? (
        <div className="flex h-screen text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900">
            {/* Chat Section (1/4 screen) */}
            <div className="w-1/4 flex flex-col h-full items-center justify-end p-4">
                {status === null && messages.length === 0 && (
                    <div className="h-full overflow-auto scrollbar-thin flex justify-center items-center flex-col relative">
                        <div className="flex flex-col items-center mb-1 max-w-[320px] text-center">
                            <img src="logo.png" width="80%" height="auto" className="block" alt="Logo"></img>
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
                            <div className="mt-4">
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

                {/* Chat Input Section (existing) */}
                <div className="mt-2 border dark:bg-gray-700 rounded-lg w-[90%] max-w-[80%] max-h-[200px] mx-auto relative mb-3 flex">
                    <textarea
                        ref={textareaRef}
                        className="scrollbar-thin flex-grow dark:bg-gray-700 px-3 py-4 rounded-lg bg-transparent border-none outline-none text-gray-800 disabled:text-gray-400 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 disabled:placeholder-gray-200 resize-none disabled:cursor-not-allowed"
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

            {/* Spreadsheet Section (3/4 screen) */}
            <div className="w-3/4 h-full flex flex-col border-l border-gray-300 dark:border-gray-700 p-4">
                <h2 className="text-xl font-semibold mb-4">AI-Powered Spreadsheet Area</h2>

                {/* Simple Input Box for AI Formula */}
                <div className="mb-4">
                    <label htmlFor="ai-formula-input" className="block text-sm font-medium mb-1">
                        Enter AI Formula (e.g., =AI("What is the capital of France?"))
                    </label>
                    <textarea
                        id="ai-formula-input"
                        className="w-full p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 text-gray-800 dark:text-gray-200"
                        rows="2"
                        placeholder='Type =AI("your prompt") and press Enter'
                        value={spreadsheetInput}
                        onChange={(e) => setSpreadsheetInput(e.target.value)}
                        onKeyDown={handleSpreadsheetInputKeyDown}
                        disabled={!isModelReady || isAiFormulaGenerating}
                        title={isModelReady ? "Model is ready" : "Model not loaded yet"}
                    />
                </div>

                {/* AI Formula Output Display */}
                <div className="flex-grow bg-gray-100 dark:bg-gray-800 p-4 rounded-md overflow-auto scrollbar-thin">
                    <h3 className="text-lg font-medium mb-2">AI Formula Output:</h3>
                    <pre className="whitespace-pre-wrap font-mono text-sm">
                        {spreadsheetOutput}
                    </pre>
                </div>
            </div>
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
