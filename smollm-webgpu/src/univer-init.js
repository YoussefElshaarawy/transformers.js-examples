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

// --- NEW: Export a variable to hold the worker messenger function ---
export let workerMessenger = null;

// --- NEW: Export a function to set the worker messenger ---
export function setWorkerMessenger(messenger) {
  workerMessenger = messenger;
}

// --- NEW: Export univerAPI so it can be used globally (e.g., in App.jsx for cell updates) ---
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

// --- NEW: Assign univerAPI to the global export ---
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
univerAPI.getFormula().registerFunction(
  'SMOLLM',
  (prompt, context) => { // context provides cell information!
    if (!workerMessenger) {
      console.error("AI worker messenger is not set!");
      return "ERROR: AI not ready";
    }

    // Get the current cell's location from the context provided by Univer
    const row = context.row;
    const col = context.col;
    const sheetId = context.sheetId; 

    // Send the prompt to the worker, including the cell's coordinates.
    // The 'cellInfo' field is new and will be used by App.jsx.
    workerMessenger({
      type: "generate", // Still use 'generate' type for worker.js compatibility
      data: [{ role: "user", content: prompt }], // Worker still expects this format
      cellInfo: { row, col, sheetId } // Pass cell info for App.jsx to use
    });

    // Return a temporary message. The actual AI response will update this cell later.
    return "Generating...";
  },
  {
    description: 'customFunction.SMOLLM.description',
    locales: {
      enUS: {
        customFunction: {
          SMOLLM: {
            description: 'Sends a prompt to the SmolLM AI model and displays response in chat and cell.',
          },
        },
      },
    },
  }
);
