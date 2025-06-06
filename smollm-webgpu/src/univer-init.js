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

// --- NEW: Export a map to store promises for cell-initiated AI requests ---
// This map will hold the resolve/reject functions of Promises, keyed by requestId.
export const cellPromises = new Map();

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
  // IMPORTANT: Using a traditional function to ensure 'this' context is bound
  async function (prompt) {
    if (!workerMessenger) {
      console.error("AI worker messenger is not set!");
      return "ERROR: AI not ready";
    }

    // --- NEW: Try to get cell coordinates from the 'this' context ---
    // This is an assumption based on common spreadsheet custom function APIs.
    // If UniverJS 'this' context does not provide these, this part needs re-evaluation.
    let sheetId, row, col;
    try {
        // Example: access context from 'this'. Specific properties may vary by Univer.js version.
        // Assuming 'this' refers to the formula context for the current cell.
        // You might need to inspect 'this' in your console if these are not directly available.
        sheetId = this?.getUnitId ? this.getUnitId() : 'unknownSheet'; // getUnitId() is a common method for sheet ID
        row = this?.row !== undefined ? this.row : -1; // 'row' property for row index
        col = this?.col !== undefined ? this.col : -1; // 'col' property for column index
    } catch (e) {
        console.warn("Could not retrieve cell coordinates from 'this' context in SMOLLM:", e);
        sheetId = 'dynamicSheet'; // Fallback if context is not available
        row = Date.now(); // Use timestamp as a unique row identifier
        col = Math.random(); // Use random as a unique col identifier
    }

    // Generate a unique request ID that includes cell coordinates
    const requestId = `${sheetId}_${row}_${col}_${Date.now()}`;

    // Create a promise that will be resolved when the AI response comes back
    const promise = new Promise((resolve, reject) => {
      // Store the resolve/reject functions with the requestId
      cellPromises.set(requestId, { resolve, reject, sheetId, row, col });
    });

    // Send the prompt to the worker, including the requestId for the cell
    workerMessenger({
      type: "generate-for-cell", // NEW type for cell requests
      data: [{ role: "user", content: prompt }], // Worker expects an array of messages
      requestId: requestId // Pass the unique request ID
    });

    // Return the promise immediately. Univer.js will display "Loading..." or similar
    // until this promise resolves or rejects.
    return promise;
  },
  {
    description: 'customFunction.SMOLLM.description',
    locales: {
      enUS: {
        customFunction: {
          SMOLLM: {
            description: 'Sends a prompt to the SmolLM AI model and displays response in cell and chat.',
          },
        },
      },
    },
  }
);
