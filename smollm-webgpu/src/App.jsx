import { useEffect, useState, useRef } from "react";
export let smolCommand = true;
export function setSmolCommand(val) {
  smolCommand = val;
}

import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";

// --- UPDATED: Import setWorkerMessenger, globalUniverAPI, smollmCellAddress, setSmollmCellAddress, and NEW setTTSMessenger from univer-init.js ---
import { setWorkerMessenger, globalUniverAPI, smollmCellAddress, setSmollmCellAddress, setTTSMessenger } from './univer-init.js';

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
  const sentenceRef = useRef([]);    // keeps the running words without forcing re-renders
  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);

  // Model loading and progress
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false); // Make sure this is initially false

  // Inputs and outputs
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);

  // --- NEW: State to hold the target cell address from SMOLLM ---
  const [targetCell, setTargetCell] = useState(null);

  // --- NEW: State for TTS audio player ---
  const [audioUrl, setAudioUrl] = useState(null);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [ttsErrorMessage, setTtsErrorMessage] = useState(null); // For TTS specific errors


  function onEnter(message) {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setTps(null);
    setIsRunning(true); // Sets isRunning to true when user hits enter
    setInput("");
    // Clear any previous audio when a new chat message is sent
    setAudioUrl(null);
    setTtsErrorMessage(null);
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

  // We use the `useEffect` hook to setup the worker as soon as the `App` component is mounted.
  useEffect(() => {
    // Create the worker if it does not yet exist.
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
      worker.current.postMessage({ type: "check" }); // Do a feature check
    }

    // --- NEW: Provide the worker messenger to univer-init.js ---
    // This allows the SMOLLM function in the sheet to send messages to the worker.
    setWorkerMessenger((message) => {
      // Problem 2 Fix: Check if worker is ready before sending message
      if (worker.current && status === "ready") {
        worker.current.postMessage(message);
        // Set the target cell in App.jsx when a new SMOLLM command is initiated
        setTargetCell(smollmCellAddress); // This will update targetCell
      } else {
        console.error("AI worker not ready for spreadsheet request. Model not loaded.");
        // --- FIX: Use targetCell for the error message, or a default if not available ---
        const cellToUpdate = smollmCellAddress || "A3"; // Fallback if smollmCellAddress isn't set yet
        globalUniverAPI
          ?.getActiveWorkbook()
          ?.getActiveSheet()
          ?.getRange(cellToUpdate)
          .setValue("ERROR: Model not loaded."); // More specific error message
      }
    });

    // --- NEW: Provide the TTS messenger to univer-init.js ---
    const ttsApiCall = async ({ prompt, cellAddress }) => {
      setIsGeneratingAudio(true);
      setAudioUrl(null); // Clear previous audio
      setTtsErrorMessage(null); // Clear previous error

      // Update the Univer cell immediately with pending status
      globalUnverAPI
        ?.getActiveWorkbook()
        ?.getActiveSheet()
        ?.getRange(cellAddress)
        .setValue("Generating Audio...");

      try {
        const response = await fetch("https://youssefsharawy91-kokoro-mcp.hf.space/gradio_api/mcp/sse", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Add any necessary authentication headers if the MCP requires it
            // For example, if it requires a Hugging Face token:
            // "Authorization": `Bearer YOUR_HF_TOKEN_HERE`,
          },
          body: JSON.stringify({
            "tool": "YoussefSharawy91_kokoro_mcp_text_to_audio",
            "arguments": { "text": prompt }
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status} - ${response.statusText}`);
        }

        // --- Handling SSE stream ---
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let audioFound = false;
        let completeResponse = ''; // Accumulate SSE data for debugging

        while (true) {
          const { done, value } = await reader.read();
          const chunk = decoder.decode(value, { stream: true });
          completeResponse += chunk; // For debugging

          if (done) break;

          const lines = chunk.split('\n').filter(line => line.startsWith('data:'));

          for (const line of lines) {
            try {
              const data = JSON.parse(line.substring(5)); // Remove 'data: ' prefix
              console.log("Received TTS data chunk:", data);

              if (data.type === "tool_output" && data.content && data.content.audio_url) {
                setAudioUrl(data.content.audio_url);
                audioFound = true;
                globalUniverAPI
                  ?.getActiveWorkbook()
                  ?.getActiveSheet()
                  ?.getRange(cellAddress)
                  .setValue("Audio Generated!");
                break; // Found the audio URL, no need to process further lines
              }
            } catch (e) {
              console.error("Error parsing SSE line:", e, line);
              // Continue to next line if parsing fails
            }
          }
          if (audioFound) break; // If audio URL is found, stop reading the stream
        }

        if (!audioFound) {
          throw new Error("No audio URL found in the TTS response. Full SSE response: " + completeResponse);
        }

      } catch (err) {
        console.error("Error generating audio:", err);
        setTtsErrorMessage(`TTS Error: ${err.message}`);
        globalUniverAPI
          ?.getActiveWorkbook()
          ?.getActiveSheet()
          ?.getRange(cellAddress)
          .setValue(`TTS ERROR: ${err.message}`);
      } finally {
        setIsGeneratingAudio(false);
      }
    };
    setTTSMessenger(ttsApiCall); // Set the messenger for univer-init.js

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
          break;

        case "start":
          {
            // Start generation
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "" },
            ]);
          }
          break;

        case "update": {
          const { output, tps, numTokens } = e.data;
          setTps(tps);
          setNumTokens(numTokens);

          /* keep building the on-screen assistant reply */
          setMessages(prev => {
            const cloned = [...prev];
            const last    = cloned.at(-1);
            cloned[cloned.length - 1] = { ...last, content: last.content + output };
            return cloned;
          });

          /* only accumulate + write if SmolLM-command mode is ON */
          if (smolCommand && targetCell) { // Ensure smolCommand is on and we have a target cell
            sentenceRef.current.push(output);    // grow the array
            const fullSentence = sentenceRef.current.join(""); // concat with no spaces
            globalUniverAPI
              ?.getActiveWorkbook()
              ?.getActiveSheet()
              ?.getRange(targetCell) // Use the dynamic targetCell
              .setValue(fullSentence);
          }
        }
        break;

        // Problem 1 Fix: Set isRunning to false when worker is complete
        case "complete":
          setIsRunning(false);
          // Only clear sentenceRef for smolCommand if it just completed to ensure a fresh start
          // for the *next* smolCommand. If the user relies on continuous accumulation,
          // this might need adjustment, but generally, a new command implies a new output.
          if (smolCommand) {
              sentenceRef.current = []; // Clears the ref for the next SmolLM command
              setTargetCell(null); // Clear the target cell after completion
          }
          break;

      }
    };
    const onErrorReceived = (e) => {
      console.error("Worker error:", e);
      setError("Worker error: " + (e.message || e.error));
    };

    // Attach the callback function as an event listener.
    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    // Define a cleanup function for when the component is unmounted.
    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, [status, targetCell]); // status and targetCell added to dependencies so setWorkerMessenger updates correctly based on model status and target cell

  // Send the messages to the worker thread whenever the `messages` state changes.
  // This useEffect triggers generation for the interactive chat.
  useEffect(() => {
    if (messages.filter((x) => x.role === "user").length === 0) {
      // No user messages yet: do nothing.
      return;
    }
    // Original logic: only generate if the last message is from the user
    // This prevents re-triggering while the assistant is writing.
    if (messages.at(-1).role === "assistant") {
      return;
    }

    // Only send the message if the model is ready and not already running a generation
    // The `onEnter` function sets isRunning(true) for user input.
    // The `complete` status from worker sets isRunning(false).
    if (status === "ready" && isRunning) { // Ensure model is ready AND a generation was initiated (by onEnter)
        setTps(null); // Reset TPS
        worker.current.postMessage({ type: "generate", data: messages });
    }
  }, [messages, isRunning, status]); // Keep messages, isRunning, and status as dependencies

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
              src="logo.png"
              width="300%"
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
                        setAudioUrl(null); // Clear audio on chat reset
                        setTtsErrorMessage(null); // Clear TTS error on chat reset
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

      {/* NEW: Audio Player and TTS Status */}
      {(audioUrl || isGeneratingAudio || ttsErrorMessage) && (
        <div className="w-full max-w-[600px] mx-auto text-center mt-2 mb-3">
          {isGeneratingAudio && (
            <p className="text-blue-500">Generating audio...</p>
          )}
          {ttsErrorMessage && (
            <p className="text-red-500">{ttsErrorMessage}</p>
          )}
          {audioUrl && (
            <audio controls src={audioUrl} className="w-full">
              Your browser does not support the audio element.
            </audio>
          )}
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
              !isRunning && // Only allow Enter if not currently running
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
            <StopIcon className="h-8 w-8 p-1 rounded-md text-gray-800 dark:text-100 absolute right-3 bottom-3" />
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
