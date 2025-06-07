import {
  createUniver,
  defaultTheme,
  LocaleType,
  merge,
} from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core';
import enUS from '@univerjs/presets/preset-sheets-core/locales/en-US';
import zhCN from '@univerjs/presets/preset-sheets-core/locales/zh-CN';

import './style.css';
import '@univerjs/presets/lib/styles/preset-sheets-core.css';

// --- Export a variable to hold the worker messenger function ---
// This will be called by SMOLLM to send prompts to the worker.
export let workerMessenger = null;

// --- Export a function to set the worker messenger ---
export function setWorkerMessenger(messenger) {
  workerMessenger = messenger;
}

// --- Export univerAPI so it can be used globally (e.g., in App.jsx for cell updates) ---
export let globalUniverAPI = null;

/* ------------------------------------------------------------------ */
/* 1. Boot‑strap Univer and mount inside <div id="univer"> */
/* ------------------------------------------------------------------ */
const { univerAPI } = createUniver({
  locale: LocaleType.EN_US,
  locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
  theme: defaultTheme,
  presets: [UniverSheetsCorePreset({ container: 'univer' })],
});

// --- Assign univerAPI to the global export ---
globalUniverAPI = univerAPI;

/* ------------------------------------------------------------------ */
/* 2. Create a visible 100 × 100 sheet */
/* ------------------------------------------------------------------ */
univerAPI.createUniverSheet({
  name: 'Hello Univer',
  rowCount: 100,
  columnCount: 100,
});

/* ------------------------------------------------------------------ */
/* 3. Register the TAYLORSWIFT() custom formula */
/* ------------------------------------------------------------------ */
const LYRICS = [
  "Cause darling I'm a nightmare dressed like a daydream",
  "We're happy, free, confused and lonely at the same time",
  "You call me up again just to break me like a promise",
  "I remember it all too well",
  "Loving him was red—burning red",
];

univerAPI.getFormula().registerFunction(
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

/* ------------------------------------------------------------------ */
/* 4. Register the SMOLLM() custom formula */
/* ------------------------------------------------------------------ */

// --- NEW: An array to hold SMOLLM responses, for chat history or optional future use
// We will still populate this, but the cell update will be direct.
export const SMOLLM_RESPONSES = [];

univerAPI.getFormula().registerFunction(
  'SMOLLM',
  // Univer's custom functions can receive an ICustomFunctionContext
  // which includes information about the cell where the formula is located.
  async function (context, prompt) { // Note: 'this' context needs to be available
    const cellInfo = context.rangeList[0]; // Get information about the cell triggering the formula
    const sheetId = cellInfo.sheetId;
    const row = cellInfo.row;
    const col = cellInfo.column;
    const workbookId = univerAPI.getActiveWorkbook().getUnitId(); // Get current workbook ID

    // Ensure prompt is a string. If it comes as a range, extract its value.
    let actualPrompt = prompt;
    if (Array.isArray(prompt) && prompt.length > 0 && prompt[0].length > 0) {
        actualPrompt = prompt[0][0]; // Extract value from a range array
    }

    if (!workerMessenger) {
      console.error("AI worker messenger is not set!");
      // Directly update the cell with an error if AI is not ready
      if (globalUniverAPI) {
        globalUniverAPI.getUniver().getWorkBook(workbookId)
            .getSheetBySheetId(sheetId)
            .getRange(row, col)
            .setValue("ERROR: AI not ready");
      }
      return "ERROR: AI not ready";
    }

    // Send the prompt to the worker, along with the cell address to update later.
    // The worker.js doesn't need to know the cell, but App.jsx does.
    workerMessenger({
      type: "generate",
      data: [{ role: "user", content: actualPrompt }],
      // --- NEW: Pass cell coordinates for App.jsx to use for direct update ---
      cellCoordinates: { workbookId, sheetId, row, col, prompt: actualPrompt }
    });

    // Immediately return a message indicating generation is in progress.
    // The cell will display this temporarily until the AI response arrives and updates it.
    return "Generating AI response...";
  },
  {
    description: 'customFunction.SMOLLM.description',
    locales: {
      enUS: {
        customFunction: {
          SMOLLM: {
            description: 'Sends a prompt to the SmolLM AI model and displays response in this cell.',
          },
        },
      },
    },
  }
);
