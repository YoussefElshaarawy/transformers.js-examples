import { useEffect, useState, useRef } from "react";

// UniverJS imports
import {
    createUniver,
    defaultTheme,
    LocaleType,
    merge,
    UniverInstanceType, // Import UniverInstanceType for better typing
    IWorkbookData, // Import IWorkbookData for creating sheets
    // You might need to import more from @univerjs/sheets depending on event listeners
    // e.g., ISetCellValuesCommandParams from '@univerjs/sheets';
} from '@univerjs/presets'; // Or from '@univerjs/core' depending on your setup
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core';
import enUS from '@univerjs/presets/preset-sheets-core/locales/en-US';
import zhCN from '@univerjs/presets/preset-sheets-core/locales/zh-CN';
import { ISetCellValuesCommandParams, SetCellValuesCommand } from '@univerjs/sheets'; // For programmatically setting cell values
import { ICellData, IRange, IWorkbookService, SheetInterceptors } from '@univerjs/sheets'; // More sheet-related imports for event handling

// UniverJS styles
// import './style.css'; // Keep if you have custom Univer styles
import '@univerjs/presets/lib/styles/preset-sheets-core.css';


import Chat from "./components/Chat"; // You might keep this if you want an overlay chat
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";

const IS_WEBGPU_AVAILABLE = !!navigator.gpu;
const STICKY_SCROLL_THRESHOLD = 120; // This might become less relevant
const EXAMPLES = [ // These won't be used for direct clicking anymore
    "Give me some tips to improve my time management skills.",
    "What is the difference between AI and ML?",
    "Write python code to compute the nth fibonacci number.",
];

function App() {
    // Create a reference to the worker object.
    const worker = useRef(null);
    // Reference for Univer API instance
    const univerApiRef = useRef(null);

    // We'll use this ref to store the coordinates of the cell currently being processed by AI
    const currentAICellRef = useRef(null);

    // Old chat refs (might not be used visually for main interaction now)
    const textareaRef = useRef(null);
    const chatContainerRef = useRef(null);

    // Model loading and progress
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);
    const [loadingMessage, setLoadingMessage] = useState("");
    const [progressItems, setProgressItems] = useState([]);
    const [isRunning, setIsRunning] = useState(false); // Indicates if AI is generating

    // Inputs and outputs (messages array will be updated, but not rendered directly as chat history)
    const [input, setInput] = useState(""); // Still used for internal logic
    const [messages, setMessages] = useState([]); // Still used to send context to worker
    const [tps, setTps] = useState(null);
    const [numTokens, setNumTokens] = useState(null);

    // onEnter and onInterrupt will be modified/called differently
    function onEnter(message, cellRange = null) {
        // If coming from a cell, we might not update the `input` state,
        // and we will update `messages` in a way that provides context but
        // doesn't directly render to the old chat UI.
        setMessages((prev) => [...prev, { role: "user", content: message }]);
        setTps(null);
        setIsRunning(true);
        // Only clear input if it's from the original textarea, which we're hiding
        if (!cellRange) {
            setInput("");
        }
    }

    function onInterrupt() {
        worker.current.postMessage({ type: "interrupt" });
        // Also clear the cell in progress if it's interrupted
        if (currentAICellRef.current && univerApiRef.current) {
            const { row, col } = currentAICellRef.current;
            const workbook = univerApiRef.current.getAPI(UniverInstanceType.UNIVER_SHEET).getActiveWorkbook();
            const sheet = workbook.getActiveSheet();
            // Clear the cell or set it to a specific message like "Interrupted"
            sheet.setRangeValues(row, col, row, col, [['Interrupted.']]);
            currentAICellRef.current = null;
        }
    }

    // No need to resize `textareaRef` as it will be hidden
    // useEffect(() => { resizeInput(); }, [input]);
    // function resizeInput() { /* ... */ }


    // Main effect for setting up the Web Worker
    useEffect(() => {
        if (!worker.current) {
            worker.current = new Worker(new URL("./worker.js", import.meta.url), {
                type: "module",
            });
            worker.current.postMessage({ type: "check" });
        }

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
                        // When generation starts, update the current active cell (if any)
                        // with a "thinking" message or just clear it initially
                        if (currentAICellRef.current && univerApiRef.current) {
                            const { row, col } = currentAICellRef.current;
                            const workbook = univerApiRef.current.getAPI(UniverInstanceType.UNIVER_SHEET).getActiveWorkbook();
                            const sheet = workbook.getActiveSheet();
                            // Set the cell content to empty or a loading indicator
                            sheet.setRangeValues(row, col, row, col, [['']]); // Clear the cell
                        }

                        // Add assistant message to internal messages state for context
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

                        // If we have a cell currently being processed, update it directly
                        if (currentAICellRef.current && univerApiRef.current) {
                            const { row, col } = currentAICellRef.current;
                            const workbook = univerApiRef.current.getAPI(UniverInstanceType.UNIVER_SHEET).getActiveWorkbook();
                            const sheet = workbook.getActiveSheet();

                            // Get the current content of the cell and append the new output
                            // Note: `getRangeValues` returns a 2D array for a single cell, so access `[0][0]`
                            const currentCellData = sheet.getRangeValues(row, col, row, col);
                            const currentContent = currentCellData && currentCellData.length > 0 && currentCellData[0].length > 0
                                ? String(currentCellData[0][0] || '')
                                : '';

                            // Create the command for setting cell values
                            const setCellCommandParams = {
                                unitId: workbook.getUnitId(),
                                subUnitId: sheet.getSheetId(),
                                cellValue: {
                                    [row]: {
                                        [col]: {
                                            v: currentContent + output,
                                            t: 1, // Set cell type to string
                                        },
                                    },
                                },
                            };
                            univerApiRef.current.getCommandServices().executeCommand(SetCellValuesCommand.id, setCellCommandParams);

                        } else {
                            // Fallback to original chat message update if no active cell
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
                    // Clear the currentAICellRef after generation is complete
                    currentAICellRef.current = null;
                    break;

                case "error":
                    setError(e.data.data);
                    // If an error occurs, set the cell content to the error message
                    if (currentAICellRef.current && univerApiRef.current) {
                        const { row, col } = currentAICellRef.current;
                        const workbook = univerApiRef.current.getAPI(UniverInstanceType.UNIVER_SHEET).getActiveWorkbook();
                        const sheet = workbook.getActiveSheet();
                        sheet.setRangeValues(row, col, row, col, [[`Error: ${e.data.data}`]]);
                        currentAICellRef.current = null;
                    }
                    break;
            }
        };

        const onErrorReceived = (e) => {
            console.error("Worker error:", e);
        };

        worker.current.addEventListener("message", onMessageReceived);
        worker.current.addEventListener("error", onErrorReceived);

        return () => {
            worker.current.removeEventListener("message", onMessageReceived);
            worker.current.removeEventListener("error", onErrorReceived);
        };
    }, []);

    // Effect for initializing UniverJS and hooking into cell changes
    useEffect(() => {
        if (status === "ready" && !univerApiRef.current) {
            console.log("Initializing UniverJS...");
            // 1. Boot-strap Univer and mount inside <div id="univer">
            const { univerAPI } = createUniver({
                locale: LocaleType.EN_US,
                locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
                theme: defaultTheme,
                presets: [UniverSheetsCorePreset({ container: 'univer' })],
            });

            // 2. Create a visible 100x100 sheet
            const workbook = (univerAPI.getAPI(UniverInstanceType.UNIVER_SHEET) as any).createUniverSheet({
                name: 'AI Chat Sheet',
                rowCount: 100,
                columnCount: 100,
            });

            // Store the Univer API instance
            univerApiRef.current = univerAPI;

            // 3. Register the TAYLORSWIFT() custom formula
            const LYRICS = [
                "Cause darling I'm a nightmare dressed like a daydream",
                "We're happy, free, confused and lonely at the same time",
                "You call me up again just to break me like a promise",
                "I remember it all too well",
                "Loving him was red—burning red",
            ];

            (univerAPI.getFormula() as any).registerFunction(
                'TAYLORSWIFT',
                (...args) => {
                    const value = Array.isArray(args[0]) ? args[0][0] : args[0];
                    const idx = Number(value);
                    return idx >= 1 && idx <= LYRICS.length
                        ? LYRICS[idx - 1]
                        : LYRICS[Math.floor(Math.random() * LYRICS.length)];
                },
                {
                    description: 'customFunction.TAYLORSWIFT.description',
                    locales: {
                        enUS: {
                            customFunction: {
                                TAYLORSWIFT: {
                                    description:
                                        'Returns a Taylor Swift lyric (optional 1‑5 chooses a specific line).',
                                },
                            },
                        },
                    },
                }
            );

            // --- IMPORTANT: Hook into cell changes to trigger AI ---
            // This is the core of the spreadsheet-as-chat interaction.
            // We need to use Univer's interception mechanism for cell value changes.
            // When a cell's value is set (after an edit), we trigger the AI.

            // Get the CommandServices to intercept commands
            const commandService = univerAPI.getCommandServices();

            // Intercept the SetCellValuesCommand, which is dispatched when a cell's value changes
            commandService.beforeCommandExecute((commandInfo) => {
                if (commandInfo.id === SetCellValuesCommand.id) {
                    const params = commandInfo.params as ISetCellValuesCommandParams;
                    const workbook = univerAPI.getAPI(UniverInstanceType.UNIVER_SHEET).getActiveWorkbook();
                    const sheet = workbook.getActiveSheet();

                    if (!workbook || !sheet || !params || !params.cellValue) {
                        return; // Not a relevant cell value change
                    }

                    // Iterate over the changed cells
                    for (const r in params.cellValue) {
                        for (const c in params.cellValue[r]) {
                            const row = Number(r);
                            const col = Number(c);
                            const cellData: ICellData = params.cellValue[r][c];
                            const cellValue = cellData.v?.toString().trim();

                            // Ensure it's a non-empty string and not the current AI output stream
                            // Avoid processing the same cell if it's currently being updated by AI
                            if (cellValue && cellValue.length > 0 && !isRunning &&
                                !(currentAICellRef.current && currentAICellRef.current.row === row && currentAICellRef.current.col === col)) {

                                console.log(`Cell [${row}, ${col}] changed:`, cellValue);

                                // Store the cell coordinates for AI output
                                currentAICellRef.current = { row, col };

                                // Prepare message for the worker (ensure role is 'user')
                                const messageForAI = { role: "user", content: cellValue };

                                // Send the message to the worker
                                worker.current.postMessage({
                                    type: "generate",
                                    // Send all current "messages" for context, but ensure the last is the user input
                                    data: [...messages.filter(msg => msg.role === 'user'), messageForAI] // Filter for user messages to avoid too much context
                                });

                                // Set isRunning to true immediately to prevent re-triggering from the same cell
                                setIsRunning(true);
                                // Optionally, set the cell to a "thinking" state
                                sheet.setRangeValues(row, col, row, col, [['Thinking...']]);
                            }
                        }
                    }
                }
            });

        }
    }, [status]); // Only run this effect when the 'status' changes to "ready"

    // The original `useEffect` to send messages to the worker.
    // This will now primarily send the `messages` array for contextual generation.
    useEffect(() => {
        // Only send if there's a user message and AI is not already running
        // and if the last message is from the user (ensures we don't send assistant messages)
        if (messages.length > 0 && messages.at(-1).role === "user" && !isRunning && !currentAICellRef.current) {
             // This branch handles messages NOT coming from the spreadsheet cells directly,
             // which might happen if you add a temporary input for testing.
             // With the spreadsheet-as-chat, this block's role might diminish.
            setTps(null);
            worker.current.postMessage({ type: "generate", data: messages });
        }
    }, [messages, isRunning]); // Rerun when messages or isRunning changes

    // Sticky scroll is likely not relevant with spreadsheet UI
    // useEffect(() => { /* ... */ }, [messages, isRunning]);


    return IS_WEBGPU_AVAILABLE ? (
        <div className="flex flex-col h-screen mx-auto items justify-end text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900">
            {/* Initial loading screen */}
            {status === null && (
                <div className="h-full overflow-auto scrollbar-thin flex justify-center items-center flex-col relative">
                    <div className="flex flex-col items-center mb-1 max-w-[320px] text-center">
                        <img
                            src="logo.png"
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

            {/* Model loading progress */}
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

            {/* Main application UI with spreadsheet */}
            {status === "ready" && (
                <div
                    // The chatContainerRef might still be useful for general sizing,
                    // but the internal chat component will be hidden.
                    // ref={chatContainerRef}
                    className="overflow-hidden w-full flex flex-col items-center h-full"
                >
                    {/* The Univer Spreadsheet will be rendered here */}
                    <div id="univer" className="w-full flex-grow">
                        {/* UniverJS will render its content inside this div */}
                    </div>

                    {/* Performance metrics below the spreadsheet */}
                    <p className="text-center text-sm min-h-6 text-gray-500 dark:text-gray-300 mt-2 mb-3">
                        {tps && messages.length > 0 && ( // `messages.length` here means internal messages, not UI ones
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
                                                setMessages([]); // Reset internal messages
                                                // Consider clearing the whole sheet if you want a true reset
                                                if (univerApiRef.current) {
                                                    const workbook = univerApiRef.current.getAPI(UniverInstanceType.UNIVER_SHEET).getActiveWorkbook();
                                                    const sheet = workbook.getActiveSheet();
                                                    sheet.clearRange({ startRow: 0, endRow: 99, startColumn: 0, endColumn: 99 });
                                                }
                                            }}
                                        >
                                            Reset
                                        </span>
                                    </>
                                )}
                            </>
                        )}
                         {isRunning && ( // Display interrupt button if AI is running
                            <span className="ml-2 cursor-pointer text-red-500 underline" onClick={onInterrupt}>
                                Stop Generation
                            </span>
                        )}
                    </p>
                </div>
            )}

            {/* The original input box is now effectively removed from active use
                as the spreadsheet cells are the input.
                You can remove this entire div if you only want spreadsheet input.
            */}
            {/*
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
            */}

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
