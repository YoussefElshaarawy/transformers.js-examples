/* Chat.jsx  ─ renders the conversation inside a live Univer spreadsheet */
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

import "@univerjs/presets/lib/styles/preset-sheets-core.css";

/** =======================================================================
 * Chat → Univer sheet
 *   • column A  → role  (user / assistant)
 *   • column B  → message text
 *   • column C  → tokens (if your message objects carry that field)
 * ===================================================================== */
export default function Chat({ messages }) {
  const containerRef = useRef(null);   // <div> where Univer mounts
  const sheetRef     = useRef(null);   // keep the sheet instance

  /* ---------------------------------------------------------------
   * 1.  Initialise Univer (runs once)
   * ------------------------------------------------------------- */
  useEffect(() => {
    if (!containerRef.current || sheetRef.current) return; // already set-up

    const { univerAPI } = createUniver({
      locale : LocaleType.EN_US,
      locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
      theme  : defaultTheme,
      presets: [UniverSheetsCorePreset({ container: containerRef.current })],
    });

    // create a blank 1 000 × 3 sheet and remember it
    sheetRef.current = (univerAPI as any).createUniverSheet({
      name       : "Chat Log",
      rowCount   : 1000,
      columnCount: 3,
    });

    // header row
    sheetRef.current.getRange("A1").setValue("Role");
    sheetRef.current.getRange("B1").setValue("Content");
    sheetRef.current.getRange("C1").setValue("Tokens");
  }, []);

  /* ---------------------------------------------------------------
   * 2.  On every message update, mirror them into the sheet
   * ------------------------------------------------------------- */
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    // wipe previous rows (keep header)
    sheet.getRange("A2:C1000").clear();

    messages.forEach((msg, i) => {
      const row = i + 2;           // start writing at row-2
      sheet.getRange(`A${row}`).setValue(msg.role);
      sheet.getRange(`B${row}`).setValue(msg.content);
      if (msg.numTokens !== undefined)
        sheet.getRange(`C${row}`).setValue(msg.numTokens);
    });
  }, [messages]);

  /* ---------------------------------------------------------------
   * 3.  Render container
   * ------------------------------------------------------------- */
  return (
    <div
      ref={containerRef}
      className="flex-1 w-full h-full overflow-hidden"
    />
  );
}
