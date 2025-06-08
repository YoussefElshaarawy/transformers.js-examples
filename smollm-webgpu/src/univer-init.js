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

// --- NEW: Export a variable to hold the cell address from SMOLLM ---
export let smollmCellAddress = null;

// --- NEW: Export a function to set the smollmCellAddress ---
export function setSmollmCellAddress(address) {
  smollmCellAddress = address;
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
  function (prompt = '') {
    // MUST be `function`, not arrow ⇒ gets context
    /* 1️⃣  Where am I?  ------------------------------------------------- */
    const ctx = this.getContext ? this.getContext() : this; // works in ≥0.8.x
    const row = ctx.row; // 0-based, real row
    const col = ctx.column; // 0-based, real col

    const here = colToLetters(col + 1) + (row + 1); // e.g. "D12"

    /* 2️⃣  Pass address to the App component via exported variable  ------- */
    setSmollmCellAddress(here); // Set the exported variable with the cell address

    /* 3️⃣  Send prompt to SmolLM worker  -------------------------------- */
    if (!workerMessenger) {
      console.error('AI worker messenger is not set!');
      return 'ERROR: AI not ready';
    }
    workerMessenger({
      type: 'generate',
      data: [{ role: 'user', content: prompt }],
    });

    /* 4️⃣  Show something in the formula cell  -------------------------- */
    return `Generating from ${here}…`;
  },
  {
    description: 'customFunction.SMOLLM.description',
    locales: {
      enUS: {
        customFunction: {
          SMOLLM: {
            description:
              'Sends a prompt to SmolLM and logs its own cell (without $) to A5.',
          },
        },
      },
    },
  }
);

/* helper: converts 1 → A, 27 → AA, … */
function colToLetters(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
