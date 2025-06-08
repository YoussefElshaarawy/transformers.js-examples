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
 *  SMOLLM() — logs its caller’s address (sans “$”) into A5          *
 *            and then kicks the AI worker                           *
 *********************************************************************/
univerAPI.getFormula().registerAsyncFunction(
  'SMOLLM',
  // any number of visible args → …args
  async function (...args) {
    // ──────────────────────────────────────────────────────────────
    // 0.  Split “visible” arguments from the hidden runtime object
    // ──────────────────────────────────────────────────────────────
    const maybeRuntime = args[args.length - 1];
    const isRuntimeObj =
      maybeRuntime &&
      typeof maybeRuntime === 'object' &&
      'row' in maybeRuntime &&
      'column' in maybeRuntime;

    const runtime   = isRuntimeObj ? maybeRuntime      : { row: 0, column: 0 };
    const prompt    = isRuntimeObj ? args[0]            : args.join(','); // first visible arg
    const row       = runtime.row;          // 0-based
    const column    = runtime.column;       // 0-based

    // ──────────────────────────────────────────────────────────────
    // 1.  Convert 0-based column → Excel letters (“A”..“Z”, “AA”…)
    // ──────────────────────────────────────────────────────────────
    const here = columnToLetter(column + 1) + (row + 1);   // e.g. "C7"

    // ──────────────────────────────────────────────────────────────
    // 2.  Drop that clean address into cell A5 (row 4, col 0)
    // ──────────────────────────────────────────────────────────────
    univerAPI.executeCommand('sheet.command.set-range-values', {
      value:  { v: here },
      range:  { startRow: 4, startColumn: 0, endRow: 4, endColumn: 0 },
    });

    // ──────────────────────────────────────────────────────────────
    // 3.  Fire the AI worker exactly as before
    // ──────────────────────────────────────────────────────────────
    if (!workerMessenger) return 'ERROR: AI not ready';
    workerMessenger({ type: 'generate',
                      data: [{ role: 'user', content: prompt }] });

    return `Generating from ${here}…`;
  },
  {
    description: 'customFunction.SMOLLM.description',
    locales: {
      enUS: {
        customFunction: {
          SMOLLM: { description: 'Calls SmolLM and logs its own cell to A5.' },
        },
      },
    },
  }
);

/* Helper: number → “A…Z, AA…Z” */
function columnToLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
