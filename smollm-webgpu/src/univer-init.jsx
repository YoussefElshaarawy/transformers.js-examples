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

// --- NEW: Global flag to indicate if an SMOLLM request is pending ---
// This flag will be managed by App.jsx
export let isSmollmPending = false;
export function setSmollmPending(status) {
  isSmollmPending = status;
}

// --- NEW: Global variable to store the single pending request's target cell ---
// This will be set by SMOLLM and cleared by App.jsx
let currentSmollmTargetCell = null;
export function setCurrentSmollmTargetCell(cell) {
  currentSmollmTargetCell = cell;
}
export function getCurrentSmollmTargetCell() {
  return currentSmollmTargetCell;
}


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
  (prompt) => {
    if (!workerMessenger) {
      console.error("AI worker messenger is not set!");
      return "ERROR: AI not ready";
    }

    // --- NEW: Block if another SMOLLM request is already pending ---
    if (isSmollmPending) {
      return "AI BUSY: Please wait for previous SMOLLM() to complete.";
    }

    const actualPrompt = Array.isArray(prompt) ? prompt[0] : prompt;

    let targetCell = null;
    const formulaEngine = univerAPI.getFormula();
    const context = formulaEngine.getCurrentContext();

    if (context && globalUniverAPI) {
      const { row, column } = context;
      const workbook = globalUniverAPI.sheets.getActiveWorkbook();
      const sheet = workbook.getActiveSheet();

      targetCell = {
        row: row,
        column: column,
        sheetId: sheet.getSheetId(),
        workbookId: workbook.getUnitId(),
      };
      // console.log("SMOLLM called from (reliable context):", targetCell);
    } else {
      console.warn("SMOLLM: Could not get full formula context or UniverAPI. AI response will only go to chat.");
      return "ERROR: Could not get cell context.";
    }

    // --- NEW: Set the pending flag and store the target cell ---
    setSmollmPending(true);
    setCurrentSmollmTargetCell(targetCell);

    workerMessenger({
      type: "generate",
      data: [{ role: "user", content: actualPrompt }],
      // targetCell is sent here but Worker will NOT send it back
      source: 'formula',
    });

    // Return a placeholder message immediately
    return "Generating AI response...";
  },
  {
    description: 'customFunction.SMOLLM.description',
    locales: {
      enUS: {
        customFunction: {
          SMOLLM: {
            description: 'Sends a prompt to the SmolLM AI model and displays response in its cell.',
          },
        },
      },
    },
  }
);
