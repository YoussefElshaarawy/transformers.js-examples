import { useEffect, useState, useRef } from "react";
export let smolCommand = true;
export function setSmolCommand(val) {
  smolCommand = val;
}

import Chat from "./components/Chat";
import ArrowRightIcon from "./components/icons/ArrowRightIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";

// --- NEW IMPORTS for Custom Audio Player ---
import AudioPlayer from 'react-h5-audio-player';
import 'react-h5-audio-player/lib/styles.css'; // Default styles

// --- UPDATED: Import ALL messengers and other exports from univer-init.js ---
import {
  setWorkerMessenger,
  globalUniverAPI,
  smollmCellAddress,
  setSmollmCellAddress,
  setTTSMessenger,
  setMCPMessenger,
} from './univer-init.js';

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
  const [isRunning, setIsRunning] = useState(false);

  // Inputs and outputs
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);

  // State to hold the target cell address from SMOLLM
  const [targetCell, setTargetCell] = useState(null);

  // State for MCP/TTS audio and status
  const [audioUrl, setAudioUrl] = useState(null);
  const [isProcessingMcp, setIsProcessingMcp] = useState(false);
  const [mcpStatusMessage, setMcpStatusMessage] = useState(null);

  function onEnter(message) {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setTps(null);
    setIsRunning(true);
    setInput("");
    setAudioUrl(null);
    setMcpStatusMessage(null);
    setIsProcessingMcp(false);
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

  useEffect(() => {
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
      worker.current.postMessage({ type: "check" });
    }

    setWorkerMessenger((message) => {
      if (worker.current && status === "ready") {
        worker.current.postMessage(message);
        setTargetCell(smollmCellAddress);
      } else {
        console.error("AI worker not ready for SMOLLM request. Model not loaded.");
        const cellToUpdate = smollmCellAddress || "A3";
        globalUniverAPI
          ?.getActiveWorkbook()
          ?.getActiveSheet()
          ?.getRange(cellToUpdate)
          .setValue("ERROR: Model not loaded.");
      }
    });

    const handleMcpRequest = async ({ tool, prompt, cellAddress }) => {
      setIsProcessingMcp(true);
      setAudioUrl(null);
      setMcpStatusMessage(`Calling ${tool.split('_').pop()}...`);

      globalUniverAPI
        ?.getActiveWorkbook()
        ?.getActiveSheet()
        ?.getRange(cellAddress)
        .setValue(`Processing ${tool.split('_').pop()}...`);

      try {
        const response = await fetch("https://youssefsharawy91-kokoro-mcp.hf.space/gradio_api/mcp/sse", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // IMPORTANT: Add your Hugging Face API token if the Space requires authentication.
            // Example: "Authorization": `Bearer YOUR_HF_TOKEN_HERE`,
          },
          body: JSON.stringify({
            "tool": tool,
            "arguments": { "text": prompt }
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status} - ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let audioOutputFound = false;
        let finalCellContent = `No specific output found for ${tool.split('_').pop()}.`;

        while (true) {
          const { done, value } = await reader.read();
          const chunk = decoder.decode(value, { stream: true });

          const lines = chunk.split('\n').filter(line => line.startsWith('data:'));

          for (const line of lines) {
            try {
              const data = JSON.parse(line.substring(5));
              console.log(`Received MCP data chunk for tool ${tool}:`, data);

              if (data.type === "tool_output" && data.content) {
                if (data.content.audio_url) {
                  setAudioUrl(data.content.audio_url);
                  setMcpStatusMessage("Audio Generated!");
                  finalCellContent = "Audio Generated!";
                  audioOutputFound = true;
                  break;
                } else if (data.content.text) {
                  setMcpStatusMessage(`Text output received from ${tool.split('_').pop()}:`);
                  finalCellContent = data.content.text;
                  audioOutputFound = true;
                  break;
                }
              }
            } catch (e) {
              console.error("Error parsing SSE line:", e, line);
            }
          }
          if (audioOutputFound) break;
          if (done) break;
        }

        globalUniverAPI
          ?.getActiveWorkbook()
          ?.getActiveSheet()
          ?.getRange(cellAddress)
          .setValue(finalCellContent);

        if (!audioOutputFound) {
          setMcpStatusMessage(`No specific audio/text output found from ${tool.split('_').pop()}.`);
        }

      } catch (err) {
        console.error(`Error processing MCP request for ${tool}:`, err);
        setMcpStatusMessage(`MCP Error (${tool.split('_').pop()}): ${err.message}`);
        globalUniverAPI
          ?.getActiveWorkbook()
          ?.getActiveSheet()
          ?.getRange(cellAddress)
          .setValue(`MCP ERROR (${tool.split('_').pop()}): ${err.message}`);
      } finally {
        setIsProcessingMcp(false);
      }
    };

    setTTSMessenger(({ prompt, cellAddress }) =>
      handleMcpRequest({ tool: "YoussefSharawy91_kokoro_mcp_text_to_audio", prompt, cellAddress })
    );
    setMCPMessenger(handleMcpRequest);


    const onMessageReceived = (e) => {
      switch (e.data.status) {
        case "loading": setStatus("loading"); setLoadingMessage(e.data.data); break;
        case "initiate": setProgressItems((prev) => [...prev, e.data]); break;
        case "progress": setProgressItems((prev) => prev.map((item) => {
          if (item.file === e.data.file) { return { ...item, ...e.data }; } return item;
        })); break;
        case "done": setProgressItems((prev) => prev.filter((item) => item.file !== e.data.file)); break;
        case "ready": setStatus("ready"); break;
        case "start": setMessages((prev) => [...prev, { role: "assistant", content: "" },]); break;
        case "update": {
          const { output, tps, numTokens } = e.data;
          setTps(tps); setNumTokens(numTokens);
          setMessages(prev => {
            const cloned = [...prev]; const last = cloned.at(-1);
            cloned[cloned.length - 1] = { ...last, content: last.content + output }; return cloned;
          });
          if (smolCommand && targetCell) {
            sentenceRef.current.push(output); const fullSentence = sentenceRef.current.join("");
            globalUniverAPI?.getActiveWorkbook()?.getActiveSheet()?.getRange(targetCell).setValue(fullSentence);
          }
        } break;
        case "complete":
          setIsRunning(false);
          if (smolCommand) {
            sentenceRef.current = [];
            setTargetCell(null);
          }
          break;
      }
    };
    const onErrorReceived = (e) => {
      console.error("Worker error:", e); setError("Worker error: " + (e.message || e.error));
    };

    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);
    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, [status, targetCell]);

  useEffect(() => {
    if (messages.filter((x) => x.role === "user").length === 0) { return; }
    if (messages.at(-1).role === "assistant") { return; }
    if (status === "ready" && isRunning) {
      setTps(null);
      worker.current.postMessage({ type: "generate", data: messages });
    }
  }, [messages, isRunning, status]);

  useEffect(() => {
    if (!chatContainerRef.current || !isRunning) return;
    const element = chatContainerRef.current;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < STICKY_SCROLL_THRESHOLD) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, isRunning]);

  return IS_WEBGPU_AVAILABLE ? (
    <div className="flex flex-col h-screen mx-auto items justify-end text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900">
      {status === null && messages.length === 0 && (
        <div className="h-full overflow-auto scrollbar-thin flex justify-center items-center flex-col relative">
          <div className="flex flex-col items-center mb-1 max-w-[320px] text-center">
            <img src="logo.png" width="300%" height="auto" className="block"></img>
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
              <a href="https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct" target="_blank" rel="noreferrer" className="font-medium underline">SmolLM2-1.7B-Instruct</a>
              , a 1.7B parameter LLM optimized for in-browser inference.
              Everything runs entirely in your browser with{" "}
              <a href="https://huggingface.co/docs/transformers.js" target="_blank" rel="noreferrer" className="underline">🤗&nbsp;Transformers.js</a>{" "}
              and ONNX Runtime Web, meaning no data is sent to a server. Once
              loaded, it can even be used offline. The source code for the demo
              is available on{" "}
              <a href="https://github.com/huggingface/transformers.js-examples/tree/main/smollm-webgpu" target="_blank" rel="noreferrer" className="font-medium underline">GitHub</a>.
            </p>

            {error && (
              <div className="text-red-500 text-center mb-2">
                <p className="mb-1">Unable to load model due to the following error:</p>
                <p className="text-sm">{error}</p>
              </div>
            )}

            <button
              className="border px-4 py-2 rounded-lg bg-blue-400 text-white hover:bg-blue-500 disabled:bg-blue-100 disabled:cursor-not-allowed select-none"
              onClick={() => { worker.current.postMessage({ type: "load" }); setStatus("loading"); }}
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
              <Progress key={i} text={file} percentage={progress} total={total} />
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
                {!isRunning && (<span>Generated {numTokens} tokens in {(numTokens / tps).toFixed(2)} seconds&nbsp;&#40;</span>)}
                <>
                  <span className="font-medium text-center mr-1 text-black dark:text-white">{tps.toFixed(2)}</span>
                  <span className="text-gray-500 dark:text-gray-300">tokens/second</span>
                </>
                {!isRunning && (
                  <>
                    <span className="mr-1">&#41;.</span>
                    <span
                      className="underline cursor-pointer"
                      onClick={() => {
                        worker.current.postMessage({ type: "reset" });
                        setMessages([]);
                        setAudioUrl(null);
                        setMcpStatusMessage(null);
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

      {/* NEW: Audio Player and MCP Status - MOVED & NOW USING CUSTOM COMPONENT */}
      {(audioUrl || isProcessingMcp || mcpStatusMessage) && (
        <div className="w-full max-w-[600px] mx-auto text-center mt-2 mb-3 px-4">
          {isProcessingMcp && (
            <p className="text-blue-500">{mcpStatusMessage}</p>
          )}
          {!isProcessingMcp && mcpStatusMessage && mcpStatusMessage.startsWith('MCP Error') && (
            <p className="text-red-500">{mcpStatusMessage}</p>
          )}
          {audioUrl && (
            <AudioPlayer
              autoPlay={true} // Auto-play when audioUrl is set
              src={audioUrl}
              onPlay={e => console.log("onPlay")} // Optional: add handlers
              // Add other props for styling or functionality
              // For example, to enable download:
              // customControls={[
              //   AudioPlayer.playPauseOrDownload, // This specific prop isn't built-in, but examples exist
              //   // For a download button, you typically add a custom button with an <a> tag
              // ]}
              layout="horizontal-light" // Another layout option
              showDownloadProgress={true} // Show download progress
              customAdditionalControls={[
                // A common way to add a download button
                <a key="download-btn" href={audioUrl} download="generated_audio.wav" className="rhap_download-btn">
                  Download
                </a>
              ]}
              className="rhap_theme-light" // Apply light theme, you can customize in CSS
            />
          )}
        </div>
      )}

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
