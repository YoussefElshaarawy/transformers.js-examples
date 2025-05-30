import { useEffect, useState, useRef } from "react";
import { useWorker } from "./contexts/WorkerContext"; // Import the custom hook

import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress"; // Still needed for loading progress display

const IS_WEBGPU_AVAILABLE = !!navigator.gpu;
const STICKY_SCROLL_THRESHOLD = 120;
const EXAMPLES = [
  "Give me some tips to improve my time management skills.",
  "What is the difference between AI and ML?",
  "Write python code to compute the nth fibonacci number.",
];

function App() {
  // Consume the worker context
  const {
    status,
    error,
    loadingMessage,
    progressItems,
    isRunning,
    tps,
    numTokens,
    currentAiQueryTargetCell,
    chatMessagesHistory, // This is the chat history managed by the context
    sendAiQueryToWorker, // The unified function to send AI queries
    onInterrupt,
    resetChat,
    loadModel, // Function to trigger model loading
  } = useWorker();

  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);

  // Local state for the input field (still managed by App.jsx)
  const [input, setInput] = useState("");

  function onEnter(message) {
    if (!message.trim()) return; // Don't send empty messages

    // Check if it's an AI sheet command: e.g., "AI:A1: Your prompt here"
    const aiCommandMatch = message.match(/^AI:([A-Za-z]+\d+):\s*(.*)$/i);

    if (aiCommandMatch) {
      const targetCell = aiCommandMatch[1].toUpperCase(); // e.g., "A1"
      const aiPrompt = aiCommandMatch[2].trim();

      if (!aiPrompt) {
        console.warn("AI command requires a prompt.");
        // Error handling for UI can be done via context's `setError` if needed
        return;
      }
      sendAiQueryToWorker(aiPrompt, targetCell); // Use the unified function
      setInput(""); // Clear input after sending

    } else {
      // It's a regular chat message
      sendAiQueryToWorker(message, null); // Use the unified function for chat
      setInput(""); // Clear input after sending
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

  // This useEffect now *only* handles auto-scrolling for the chat window
  // It only triggers when a new *chat* message is added and generation is ongoing.
  useEffect(() => {
    if (!chatContainerRef.current) return;

    // Only scroll if it's a chat update (i.e., last message is assistant) and we are near the bottom
    // `chatMessagesHistory` is now from context
    if (chatMessagesHistory.length > 0 && chatMessagesHistory.at(-1).role === "assistant" && isRunning && !currentAiQueryTargetCell) {
        const element = chatContainerRef.current;
        if (
            element.scrollHeight - element.scrollTop - element.clientHeight <
            STICKY_SCROLL_THRESHOLD
        ) {
            element.scrollTop = element.scrollHeight;
        }
    }
  }, [chatMessagesHistory, isRunning, currentAiQueryTargetCell]); // Reruns when these states change

  return IS_WEBGPU_AVAILABLE ? (
    <div className="flex flex-col h-screen mx-auto items justify-end text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900">
      {status === null && chatMessagesHistory.length === 0 && (
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
              onClick={loadModel} // Use loadModel from context
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
          <Chat messages={chatMessagesHistory} /> {/* Use chatMessagesHistory from context */}
          {/* Only show examples if no messages AND no AI query is active */}
          {chatMessagesHistory.length === 0 && !currentAiQueryTargetCell && (
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
            {tps && chatMessagesHistory.length > 0 && !currentAiQueryTargetCell && (
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
                      onClick={resetChat} // Use resetChat from context
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
          <div className="cursor-pointer" onClick={onInterrupt}> {/* Use onInterrupt from context */}
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
