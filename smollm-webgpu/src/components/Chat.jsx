/* UniverChat.jsx ─ spreadsheet-first chat interface -------------------- */
import { useEffect, useRef } from "react";

import {
  createUniver,
  defaultTheme,
  LocaleType,
  merge,
} from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/presets/preset-sheets-core";
import enUS from "@univerjs/presets/preset-sheets-core/locales/en-US";
import zhCN from "@univerjs/presets/preset-sheets-core/locales/zh-CN";
import { SetRangeValuesCommand } from "@univerjs/presets/preset-sheets-core";

import "@univerjs/presets/lib/styles/preset-sheets-core.css";

const THINKING = "…thinking…";

export default function UniverChat() {
  const hostRef      = useRef(null);       // <div> container for the sheet
  const sheetRef     = useRef(null);       // Univer sheet instance
  const workerRef    = useRef(null);       // WebGPU worker
  const pendingRef   = useRef(null);       // {r, c} of the cell being filled

  /* ────────────────────────────────────────────────────────────────────
   * 1.  Boot-strap Univer + worker  (runs once)
   * ────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    /* ---- 1 a . Univer sheet --------------------------------------- */
    const { univerAPI } = createUniver({
      locale : LocaleType.EN_US,
      locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
      theme  : defaultTheme,
      presets: [UniverSheetsCorePreset({ container: hostRef.current })],
    });

    sheetRef.current = (univerAPI as any).createUniverSheet({
      name       : "SmolLM2 Chat",
      rowCount   : 500,
      columnCount: 3,
    });

    /* ---- 1 b . WebGPU worker -------------------------------------- */
    workerRef.current = new Worker(new URL("../worker.js", import.meta.url), {
      type: "module",
    });
    workerRef.current.postMessage({ type: "check" });

    /*  Handle messages from the worker  */
    workerRef.current.addEventListener("message", ({ data }) => {
      const sheet = sheetRef.current;
      if (!sheet || !pendingRef.current) return;

      const { r, c } = pendingRef.current;

      switch (data.status) {
        case "loading":
          /* first time → load model immediately */
          break;

        case "start":
          sheet.getRange(r, c).setValue(THINKING);
          break;

        case "update": {
          /* append partial output in the cell */
          const cell = sheet.getRange(r, c);
          const current = cell.getValue() === THINKING ? "" : cell.getValue();
          cell.setValue(current + data.output);
          break;
        }

        case "complete":
          pendingRef.current = null;
          break;

        case "error":
          sheet.getRange(r, c).setValue("[error] " + data.data);
          pendingRef.current = null;
          break;
      }
    });

    /* ---- 1 c . Intercept every cell edit -------------------------- */
    univerAPI
      .getCommandManager()
      .onCommandExecuted((cmd) => {
        if (cmd.id !== SetRangeValuesCommand.id) return;

        /* single-cell edits only (ignore drag-fill etc.) */
        const { rangeData, cellValue } = cmd.params;
        if (
          rangeData.startRow !== rangeData.endRow ||
          rangeData.startColumn !== rangeData.endColumn
        )
          return;

        const prompt = Array.isArray(cellValue)
          ? cellValue[0][0]
          : cellValue;
        if (!prompt || prompt === THINKING) return; // empty or internal

        /* fire the model */
        pendingRef.current = {
          r: rangeData.startRow,
          c: rangeData.startColumn,
        };
        workerRef.current.postMessage({
          type: "generate",
          data: [{ role: "user", content: prompt }],
        });
      });
  }, []);

  /* ────────────────────────────────────────────────────────────────────
   * 2.  Render (just the container div)                               */
  /* ────────────────────────────────────────────────────────────────── */
  return (
    <div
      ref={hostRef}
      className="flex-1 w-full h-full overflow-hidden dark:bg-gray-900"
    />
  );
}
