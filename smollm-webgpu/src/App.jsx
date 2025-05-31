import { useEffect, useState, useRef } from "react";

/* ------------------------------------------------------------------ */
/* 0.  NEW -- Univer imports & styles                                  */
/* ------------------------------------------------------------------ */
import {
  createUniver,
  defaultTheme,
  LocaleType,
  merge,
} from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/presets/preset-sheets-core";
import enUS from "@univerjs/presets/preset-sheets-core/locales/en-US";
import zhCN from "@univerjs/presets/preset-sheets-core/locales/zh-CN";
import "@univerjs/presets/lib/styles/preset-sheets-core.css";

import Chat from "./components/Chat";               // <-- still present
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

/* Univer sheet size & which column we’ll write into */
const SHEET_ROWS = 100;
const SHEET_COLS = 100;
const PROMPT_COL = 0;      // column A
const REPLY_COL  = 1;      // column B

function App() {
  /* ------------------------------------------------------------------ */
  /* A.  Un-changed state from your original code                        */
  /* ------------------------------------------------------------------ */
  const worker = useRef(null);
  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);

  const [status, setStatus]       = useState(null);
  const [error, setError]         = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems]   = useState([]);
  const [isRunning, setIsRunning] = useState(false);

  const [input, setInput]         = useState("");
  const [messages, setMessages]   = useState([]);
  const [tps, setTps]             = useState(null);
  const [numTokens, setNumTokens] = useState(null);

  /* ------------------------------------------------------------------ */
  /* B.  NEW -- Univer instance refs & row pointer                       */
  /* ------------------------------------------------------------------ */
  const univerRef    = useRef(null);   // API object
  const sheetRef     = useRef(null);   // active worksheet
  const [rowPtr, setRowPtr] = useState(0);   // top row of current turn

  /* Handy: push a token straight into the sheet */
  function appendTokenToSheet(token) {
    if (!sheetRef.current) return;
    const row = rowPtr + 1;  // assistant row
    const prev = sheetRef.current.getCellValue(row, REPLY_COL) || "";
    sheetRef.current.setValue(row, REPLY_COL, prev + token);
  }

  /* ------------------------------------------------------------------ */
  /* C.  Re-use your onEnter but also write prompt into sheet            */
  /* ------------------------------------------------------------------ */
  function onEnter(message) {
    /* 1. Push into existing chat state machine */
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setTps(null);
    setIsRunning(true);
    setInput("");

    /* 2. Write prompt → sheet (rowPtr, col A) & clear cell value cache */
    if (sheetRef.current) {
      sheetRef.current.setValue(rowPtr, PROMPT_COL, message);
      sheetRef.current.setValue(rowPtr + 1, REPLY_COL, ""); // reserve reply row
    }
  }

  function onInterrupt() {
    worker.current.postMessage({ type: "interrupt" });
  }

  /* Keep original auto-resize for the (now-hidden) textarea */
  useEffect(() => {
    if (!textareaRef.current) return;
    const target = textareaRef.current;
    target.style.height = "auto";
    const newHeight = Math.min(Math.max(target.scrollHeight, 24), 200);
    target.style.height = `${newHeight}px`;
  }, [input]);

  /* ------------------------------------------------------------------ */
  /* D.  Boot-strap Univer once after mount                              */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const { univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
      theme: defaultTheme,
      presets: [UniverSheetsCorePreset({ container: "univer" })],
    });
    univerRef.current = univerAPI;

    // Create the visible sheet
    const workbook = univerAPI.createUniverSheet({
      name: "Hello Univer",
      rowCount: SHEET_ROWS,
      columnCount: SHEET_COLS,
    });
    sheetRef.current = workbook.getActiveSheet();

    /* Listen for cell edits so a user can type directly in the sheet */
    sheetRef.current.on("cellValueChanged", ({ row, column, value }) => {
      // We accept input only if edit is in col A and equals current rowPtr
      if (column === PROMPT_COL && row === rowPtr && !isRunning && value) {
        onEnter(String(value));
      }
    });
  }, []);

  /* ------------------------------------------------------------------ */
  /* E.  Original worker wiring – only tweak “update” & “complete”       */
  /* ------------------------------------------------------------------ */
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
            prev.map((item) =>
              item.file === e.data.file ? { ...item, ...e.data } : item,
            ),
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
          setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
          break;

        case "update": {
          const { output, tps, numTokens } = e.data;
          setTps(tps);
          setNumTokens(numTokens);

          /* ---- NEW: stream into the sheet ---- */
          appendTokenToSheet(output);

          /* ---- keep original Chat bubble path (optional) ---- */
          setMessages((prev) => {
            const cloned = [...prev];
            const last = cloned.at(-1);
            cloned[cloned.length - 1] = {
              ...last,
              content: last.content + output,
            };
            return cloned;
          });
          break;
        }

        case "complete":
          setIsRunning(false);
          /* Advance row pointer for next turn */
          setRowPtr((prev) => prev + 2);
          break;

        case "error":
          setError(e.data.data);
          break;
      }
    };

    const onErrorReceived = (e) => console.error("Worker error:", e);

    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);
    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, [rowPtr]);

  /* Send messages to worker when user prompt appears (unchanged) */
  useEffect(() => {
    if (messages.filter((x) => x.role === "user").length === 0) return;
    if (messages.at(-1).role === "assistant") return;
    setTps(null);
    worker.current.postMessage({ type: "generate", data: messages });
  }, [messages, isRunning]);

  /* Auto-scroll Univer viewport to keep reply row in view */
  useEffect(() => {
    if (!sheetRef.current || !isRunning) return;
    sheetRef.current.setScrollTop((rowPtr + 1) * 24);   // ~24 px row height
  }, [messages, isRunning]);

  /* ------------------------------------------------------------------ */
  /* F.  Render – show Univer sheet + existing overlays/progress         */
  /* ------------------------------------------------------------------ */
  return IS_WEBGPU_AVAILABLE ? (
    <div className="flex flex-col h-screen text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900">
      {/* 1. Progress / loading overlays – unchanged */}
      {status === null && messages.length === 0 && (
        /* … keep your original welcome overlay … */
        /* (left out for brevity – copy from original) */
        <></>
      )}
      {status === "loading" && (
        <div className="w-full max-w-[500px] text-left mx-auto p-4 mt-auto">
          <p className="text-center mb-1">{loadingMessage}</p>
          {progressItems.map(({ file, progress, total }, i) => (
            <Progress key={i} text={file} percentage={progress} total={total} />
          ))}
        </div>
      )}

      {/* 2. Univer sheet container */}
      {status === "ready" && (
        <div id="univer" className="flex-1 overflow-hidden" />
      )}

      {/* 3. Hidden legacy textarea (optional) */}
      <textarea
        ref={textareaRef}
        className="hidden"
        rows={1}
        value={input}
        disabled
      />

      {/* 4. Footer disclaimer */}
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
