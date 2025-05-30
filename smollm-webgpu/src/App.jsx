import { useEffect, useState, useRef } from "react";

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
  // Create a reference to the worker object.
  const worker = useRef(null);

  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);

  // Model loading and progress
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false); // True if any AI generation is happening (chat or sheet)

  // Inputs and outputs
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]); // Only for chat messages
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);

  // State to track if the current generation is for a spreadsheet cell
  const [currentAiQueryTargetCell, setCurrentAiQueryTargetCell] = useState(null);

  function onEnter(message) {
    if (!message.trim()) return; // Don't send empty messages

    // Check if it's an AI sheet command: e.g., "AI:A1: Your prompt here"
    const aiCommandMatch = message.match(/^AI:([A-Za-z]+\d+):\s*(.*)$/i);

    if (aiCommandMatch) {
      const targetCell = aiCommandMatch[1].toUpperCase(); // e.g., "A1"
      const aiPrompt = aiCommandMatch[2].trim();

      if (!aiPrompt) {
        console.warn("AI command requires a prompt.");
        return; // Optionally, add a user-facing error message
      }

      setCurrentAiQueryTargetCell(targetCell); // Store the target cell
      setIsRunning(true); // Indicate AI is busy
      setInput(""); // Clear input field
      setTps(null); // Clear TPS for new operation (as it's not chat-related)
      setNumTokens(null); // Clear numTokens

      // Send the AI sheet command to the worker
      worker.current.postMessage({
        type: "ai_sheet_generate",
        data: { prompt: aiPrompt, targetCell: targetCell },
      });

    } else {
      // It's a regular chat message
      setMessages((prev) => [...prev, { role: "user", content: message }]); // Add user message to chat history
      setTps(null);
      setIsRunning(true);
      setInput("");

      // Send the entire conversation history (including the just-added user message) to the worker for chat generation
      worker.current.postMessage({ type: "generate", data: [...messages, { role: "user", content: message }] });
    }
  }

  function onInterrupt() {
    worker.current.postMessage({ type: "interrupt" });
    // If an AI sheet command was in progress, clear its target to indicate interruption
    if (currentAiQueryTargetCell) {
        setCurrentAiQueryTargetCell(null);
    }
    // The worker will eventually send a 'complete' status (or 'error' if it truly fails)
    // which will set isRunning to false.
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
        // --- General Model Loading/Initialization Statuses ---
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
            })
          );
          break;

        case "done":
          setProgressItems((prev) =>
            prev.filter((item) => item.file !== e.data.file)
          );
          break;

        case "ready":
          setStatus("ready");
          break;

        // --- Chat-specific handling ---
        case "chat_start":
          {
            // Start chat generation: add a new assistant message to the chat history
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "" },
            ]);
          }
          break;

        case "chat_update":
          {
            // Chat generation update: append output to the last assistant message.
            const { output, tps, numTokens } = e.data;
            setTps(tps);
            setNumTokens(numTokens);
            setMessages((prev) => {
              const cloned = [...prev];
              const last = cloned.at(-1);
              if (last && last.role === "assistant") { // Ensure we're updating an assistant message
                cloned[cloned.length - 1] = {
                  ...last,
                  content: last.content + output,
                };
              } else {
                  // Fallback: This should ideally not happen if 'chat_start' was processed correctly
                  cloned.push({ role: "assistant", content: output });
              }
              return cloned;
            });
          }
          break;

        case "chat_complete":
          // Chat generation complete: disable busy state
          setIsRunning(false);
          setTps(null); // Clear TPS after chat generation
          setNumTokens(null);
          break;

        // --- AI Sheet-specific handling ---
        case "ai_sheet_complete":
            {
                const { output, targetCell } = e.data;
                console.log(`AI Sheet Generation Complete: Output for cell ${targetCell}`, output);

                // IMPORTANT: 'window.univerAPI' must be made available globally by your univer.js script.
                // Ensure your univer.js file includes: `window.univerAPI = univerAPI;`
                if (window.univerAPI && targetCell) {
                    try {
                        const univer = window.univerAPI.getUniver();
                        // This assumes you want to modify the currently active sheet.
                        // You might need more robust logic if you have multiple sheets
                        // or want to specify the sheet name in the command.
                        const sheet = univer.getCurrentUniverSheetInstance().getActiveSheet();

                        // Get the range for the target cell and set its value
                        sheet.getRange(targetCell).setValue(output);
                        console.log(`Successfully updated cell ${targetCell} with AI output.`);
                    } catch (apiError) {
                        setError(`Failed to update spreadsheet cell ${targetCell}: ${apiError.message}`);
                        console.error("Univer API error:", apiError);
                    }
                } else {
                    setError("Univer API not available or target cell missing for AI sheet update.");
                    console.error("Univer API not available or target cell missing.", { univerAPI: window.univerAPI, targetCell });
                }
                setCurrentAiQueryTargetCell(null); // Clear the pending target cell
                setIsRunning(false); // AI generation is complete
                setTps(null); // Clear TPS and numTokens as these apply to chat
                setNumTokens(null);
            }
            break;

        case "error":
          setError(e.data.data);
          setIsRunning(false); // Error means generation stopped
          setCurrentAiQueryTargetCell(null); // Clear any pending sheet operations
          break;
      }
    };

    const onErrorReceived = (e) => {
      console.error("Worker error:", e);
      setError(`Worker Error: ${e.message || e.toString()}`);
      setIsRunning(false); // Error means generation stopped
      setCurrentAiQueryTargetCell(null); // Clear any pending sheet operations
    };

    // Attach the callback function as an event listener.
    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    // Define a cleanup function for when the component is unmounted.
    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, []); // Empty dependency array means this runs once on mount

  // This useEffect now *only* handles auto-scrolling for the chat window
  // It only triggers when a new *chat* message is added and generation is ongoing.
  useEffect(() => {
    if (!chatContainerRef.current) return;

    // Only scroll if it's a chat update (i.e., last message is assistant) and we are near the bottom
    if (messages.length > 0 && messages.at(-1).role === "assistant" && isRunning && !currentAiQueryTargetCell) {
        const element = chatContainerRef.current;
        if (
            element.scrollHeight - element.scrollTop - element.clientHeight <
            STICKY_SCROLL_THRESHOLD
        ) {
            element.scrollTop = element.scrollHeight;
        }
    }
  }, [messages, isRunning, currentAiQueryTargetCell]); // Reruns when these states change

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
          {/* Only show examples if no messages AND no AI query is active */}
          {messages.length === 0 && !currentAiQueryTargetCell && (
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

          {/* New: Display specific message when AI is working on a spreadsheet query */}
          {isRunning && currentAiQueryTargetCell && (
            <p className="text-center text-sm min-h-6 text-blue-500 dark:text-blue-300">
                Casting AI spell for cell {currentAiQueryTargetCell}...
            </p>
          )}

          <p className="text-center text-sm min-h-6 text-gray-500 dark:text-gray-300">
            {/* Only show TPS and related info for chat messages, not sheet commands */}
            {tps && messages.length > 0 && !currentAiQueryTargetCell && (
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
                        setTps(null);
                        setNumTokens(null);
                      }}
                    >
                      Reset Chat
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
          placeholder="Type your message or AI:A1: Your prompt for cell A1..."
          type="text"
          rows={1}
          value={input}
          disabled={status !== "ready" || isRunning} // Disable if model not ready or any AI generation is happening
          title={status === "ready" ? "Model is ready" : "Model not loaded yet"}
          onKeyDown={(e) => {
            if (
              input.length > 0 &&
              !isRunning && // Only allow sending if not already running
              e.key === "Enter" &&
              !e.shiftKey
            ) {
              e.preventDefault(); // Prevent default behavior of Enter key (new line)
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
