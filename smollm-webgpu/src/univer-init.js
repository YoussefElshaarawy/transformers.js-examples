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

/*********************************************************************
 *  SMOLLM() — now also records the caller’s cell in A5              *
 *********************************************************************/
univerAPI.getFormula().registerAsyncFunction(
  'SMOLLM',
  async (
    prompt: string,                 // the first *visible* argument
    runtime?: {                     // ← Univer appends this “runtime”
      row: number;                  //   info automatically
      column: number;
      worksheet: any;
    },
  ) => {
    /* 1.  Work out the clean address (no $) of the calling cell */
    const colLetter = univerAPI.Util.tools.chatAtABC(runtime.column + 1);   // A-Z… :contentReference[oaicite:0]{index=0}
    const callerAddress = `${colLetter}${runtime.row + 1}`;                 // e.g. “C5”

    /* 2.  Push that address into A5 (row-4, col-0) on the same sheet      */
    // Uses the standard “set-range-values” command pattern                :contentReference[oaicite:1]{index=1}
    univerAPI.executeCommand('sheet.command.set-range-values', {
      value: { v: callerAddress },
      range: { startRow: 4, startColumn: 0, endRow: 4, endColumn: 0 },
    });

    /* 3.  Continue with the original AI workflow (unchanged) */
    if (!workerMessenger) {
      console.error('AI worker messenger is not set!');
      return 'ERROR: AI not ready';
    }
    workerMessenger({
      type: 'generate',
      data: [{ role: 'user', content: prompt }],
    });

    /* 4.  Return whatever you want to show in the formula cell */
    return `Generating from ${callerAddress}…`;
  },
  {
    description: 'customFunction.SMOLLM.description',
    locales: {
      enUS: {
        customFunction: {
          SMOLLM: { description: 'Calls SmolLM and records its own cell.' },
        },
      },
    },
  },
);
