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
globalUniverAPI = univerAPI; // This is still useful if other parts of your app need direct API access

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
  async (prompt) => {
    if (!workerMessenger) {
      console.error("AI worker messenger is not set!");
      return "ERROR: AI not ready";
    }

    // Send the prompt to the worker.
    // We are deliberately formatting this to look like a chat message
    // because the worker.js cannot be modified to handle a new type.
    workerMessenger({
      type: "generate",
      data: [{ role: "user", content: prompt }] // Worker expects an array of messages
    });

    // Return a message indicating generation is in progress.
    // The actual AI response will appear in the chat UI.
    return "Generating AI response in chat...";
  },
  {
    description: 'customFunction.SMOLLM.description',
    locales: {
      enUS: {
        customFunction: {
          SMOLLM: {
            description: 'Sends a prompt to the SmolLM AI model and displays response in chat.',
          },
        },
      },
    },
  }
);

/* ------------------------------------------------------------------ */
/* 5. NEW: Function to set cell value from outside */
/* ------------------------------------------------------------------ */
/**
 * Sets the value of a cell in the active sheet.
 * @param {string} cellReference The cell reference (e.g., "A1", "B5").
 * @param {string} value The value to set in the cell.
 * @returns {boolean} True if successful, false otherwise.
 */
export function setCellValueInUniver(cellReference, value) {
  if (!globalUniverAPI) {
    console.error("Univer API is not initialized yet.");
    return false;
  }

  const match = cellReference.match(/^([A-Z]+)([0-9]+)$/i);
  if (!match) {
    console.error("Invalid cell reference format:", cellReference);
    return false;
  }

  const colLetters = match[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < colLetters.length; i++) {
    col = col * 26 + (colLetters.charCodeAt(i) - 65 + 1);
  }
  col = col - 1; // Convert to 0-based index

  const row = parseInt(match[2], 10) - 1; // Convert to 0-based index

  try {
    globalUniverAPI.getActiveSheet().setRangeValue(
      { row, column: col, rowCount: 1, columnCount: 1 },
      [[value]]
    );
    return true;
  } catch (e) {
    console.error("Error setting cell value:", e);
    return false;
  }
}
