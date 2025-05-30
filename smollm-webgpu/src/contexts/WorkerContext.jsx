import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';

// Create the Worker Context
const WorkerContext = createContext(null);

// Custom hook to consume the Worker Context
export const useWorker = () => {
  const context = useContext(WorkerContext);
  if (!context) {
    throw new Error('useWorker must be used within a WorkerProvider');
  }
  return context;
};

// Worker Provider Component
export const WorkerProvider = ({ children }) => {
  const worker = useRef(null);

  // Model loading and progress
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false); // True if any AI generation is happening (chat or sheet)

  // AI-related states that might be needed by consuming components
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);
  const [currentAiQueryTargetCell, setCurrentAiQueryTargetCell] = useState(null);

  // This state is specifically for chat messages, managed here to provide a unified chat history
  // to the worker. App.jsx will still manage its own display of messages.
  const [chatMessagesHistory, setChatMessagesHistory] = useState([]);


  // Unified function to handle sending AI queries to the worker
  // This function is exposed via context for both chat input and spreadsheet formulas
  const sendAiQueryToWorker = useCallback((prompt, targetCell = null) => {
    if (!worker.current || status !== "ready") {
      setError("AI model not ready to process query.");
      return;
    }
    if (isRunning) {
      setError("Another AI generation is already in progress.");
      return;
    }

    setIsRunning(true); // Indicate AI is busy
    setTps(null); // Clear TPS for new operation
    setNumTokens(null); // Clear numTokens
    setError(null); // Clear previous errors

    if (targetCell) {
      // It's a spreadsheet query
      console.log(`Sending AI query for cell ${targetCell}: ${prompt}`);
      setCurrentAiQueryTargetCell(targetCell); // Store the target cell
      worker.current.postMessage({
        type: "ai_sheet_generate",
        data: { prompt: prompt, targetCell: targetCell },
      });
    } else {
      // It's a regular chat message
      const newMessage = { role: "user", content: prompt };
      // Update internal chat history for the worker
      setChatMessagesHistory((prev) => [...prev, newMessage]);
      console.log("Sending chat query:", prompt);
      worker.current.postMessage({
        type: "generate",
        data: [...chatMessagesHistory, newMessage], // Send the full conversation history
      });
    }
  }, [worker, status, isRunning, chatMessagesHistory]); // Dependencies for useCallback

  const onInterrupt = useCallback(() => {
    if (worker.current) {
        worker.current.postMessage({ type: "interrupt" });
    }
    // If an AI sheet command was in progress, clear its target to indicate interruption
    if (currentAiQueryTargetCell) {
        setCurrentAiQueryTargetCell(null);
    }
    // The worker will eventually send a 'complete' status (or 'error' if it truly fails)
    // which will set isRunning to false.
  }, [worker, currentAiQueryTargetCell]);

  const resetChat = useCallback(() => {
    if (worker.current) {
        worker.current.postMessage({ type: "reset" });
    }
    setChatMessagesHistory([]); // Clear chat history in context
    setTps(null);
    setNumTokens(null);
    setIsRunning(false);
    setError(null);
    setCurrentAiQueryTargetCell(null);
  }, [worker]);


  useEffect(() => {
    // Create the worker if it does not yet exist.
    if (!worker.current) {
      worker.current = new Worker(new URL("../worker.js", import.meta.url), { // Adjusted path
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
            setChatMessagesHistory((prev) => [
              ...prev,
              { role: "assistant", content: "" },
            ]);
          }
          break;

        case "chat_update":
          {
            // Chat generation update: append output to the last assistant message.
            const { output, tps: newTps, numTokens: newNumTokens } = e.data;
            setTps(newTps);
            setNumTokens(newNumTokens);
            setChatMessagesHistory((prev) => {
              const cloned = [...prev];
              const last = cloned.at(-1);
              if (last && last.role === "assistant") {
                cloned[cloned.length - 1] = {
                  ...last,
                  content: last.content + output,
                };
              } else {
                  cloned.push({ role: "assistant", content: output });
              }
              return cloned;
            });
          }
          break;

        case "chat_complete":
          setIsRunning(false);
          setTps(null);
          setNumTokens(null);
          break;

        // --- AI Sheet-specific handling ---
        case "ai_sheet_complete":
            {
                const { output, targetCell } = e.data;
                console.log(`AI Sheet Generation Complete: Output for cell ${targetCell}`, output);

                if (window.univerAPI && targetCell) {
                    try {
                        const univer = window.univerAPI.getUniver();
                        const sheet = univer.getCurrentUniverSheetInstance().getActiveSheet();
                        sheet.getRange(targetCell).setValue(output);
                        console.log(`Successfully updated cell ${targetCell} with AI output.`);
                    } catch (apiError) {
                        setError(`Failed to update spreadsheet cell ${targetCell}: ${apiError.message}`);
                        console.error("Univer API error:", apiError);
                        if (window.univerAPI && targetCell) {
                            try {
                                const univer = window.univerAPI.getUniver();
                                const sheet = univer.getCurrentUniverSheetInstance().getActiveSheet();
                                sheet.getRange(targetCell).setValue(`ERROR: ${apiError.message}`);
                            } catch (fallbackError) {
                                console.error("Failed to set cell error on secondary attempt:", fallbackError);
                            }
                        }
                    }
                } else {
                    setError("Univer API not available or target cell missing for AI sheet update.");
                    console.error("Univer API not available or target cell missing.", { univerAPI: window.univerAPI, targetCell });
                }
                setCurrentAiQueryTargetCell(null);
                setIsRunning(false);
                setTps(null);
                setNumTokens(null);
            }
            break;

        case "error":
          setError(e.data.data);
          setIsRunning(false);
          if (currentAiQueryTargetCell && window.univerAPI) {
            try {
              const univer = window.univerAPI.getUniver();
              const sheet = univer.getCurrentUniverSheetInstance().getActiveSheet();
              sheet.getRange(currentAiQueryTargetCell).setValue(`ERROR: ${e.data.data}`);
            } catch (apiError) {
              console.error("Failed to update cell with worker error:", apiError);
            }
          }
          setCurrentAiQueryTargetCell(null);
          break;
      }
    };

    const onErrorReceived = (e) => {
      console.error("Worker error:", e);
      setError(`Worker Error: ${e.message || e.toString()}`);
      setIsRunning(false);
      if (currentAiQueryTargetCell && window.univerAPI) {
        try {
          const univer = window.univerAPI.getUniver();
          const sheet = univer.getCurrentUniverSheetInstance().getActiveSheet();
          sheet.getRange(currentAiQueryTargetCell).setValue(`ERROR: Worker Error`);
        } catch (apiError) {
          console.error("Failed to update cell with worker error:", apiError);
        }
      }
      setCurrentAiQueryTargetCell(null);
    };

    // Attach the callback function as an event listener.
    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    // --- NEW: Define the global function for UniverJS to call for AI_FILL ---
    // This connects the spreadsheet formula to your React app's AI handling logic.
    // It uses the sendAiQueryToWorker from within the context.
    window.triggerAICellFill = (prompt, targetCell) => {
      if (!prompt || !targetCell) {
        console.warn("AI_FILL: Missing prompt or target cell.");
        setError("AI_FILL: Invalid input for formula.");
        if (window.univerAPI && targetCell) {
          try {
            const univer = window.univerAPI.getUniver();
            const sheet = univer.getCurrentUniverSheetInstance().getActiveSheet();
            sheet.getRange(targetCell).setValue("ERROR: Invalid AI_FILL input");
          } catch (apiError) {
            console.error("Failed to update cell with error:", apiError);
          }
        }
        return;
      }

      // Immediately set "Calculating..." in the cell
      if (window.univerAPI && targetCell) {
          try {
              const univer = window.univerAPI.getUniver();
              const sheet = univer.getCurrentUniverSheetInstance().getActiveSheet();
              sheet.getRange(targetCell).setValue("Calculating...");
          } catch (apiError) {
              console.error("Failed to set 'Calculating...' in cell:", apiError);
          }
      }
      sendAiQueryToWorker(prompt, targetCell); // Use the context's unified function
    };


    // Define a cleanup function for when the component is unmounted.
    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
      // Clean up the global function when component unmounts
      delete window.triggerAICellFill;
      // Terminate the worker when the provider unmounts
      if (worker.current) {
        worker.current.terminate();
        worker.current = null;
      }
    };
  }, [currentAiQueryTargetCell, sendAiQueryToWorker]); // Dependencies for useEffect

  // Context value that will be provided to consumers
  const contextValue = {
    status,
    error,
    loadingMessage,
    progressItems,
    isRunning,
    tps,
    numTokens,
    currentAiQueryTargetCell,
    chatMessagesHistory, // Provide chat history for App.jsx to display
    sendAiQueryToWorker, // Unified function to send queries
    onInterrupt, // Interrupt function
    resetChat, // Reset function
    // Add a function to load the model, as it's part of the worker's lifecycle
    loadModel: () => {
      if (worker.current && status === null) {
        worker.current.postMessage({ type: "load" });
        setStatus("loading");
      }
    },
  };

  return (
    <WorkerContext.Provider value={contextValue}>
      {children}
    </WorkerContext.Provider>
  );
};
