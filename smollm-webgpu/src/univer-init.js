/*********************************************************************
 *  univer-init.js  —  drop this into src/ (or adjust the path)       *
 *********************************************************************/

/* ----------  Imports (all at top, ES-module style) --------------- */
import {
  createUniver,
  defaultTheme,
  LocaleType,
  merge,
} from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core';
import enUS from '@univerjs/presets/preset-sheets-core/locales/en-US';
import zhCN from '@univerjs/presets/preset-sheets-core/locales/zh-CN';
import { BaseFunction, StringValueObject } from '@univerjs/engine-formula';

import './style.css';
import '@univerjs/presets/lib/styles/preset-sheets-core.css';

/* ----------  Globals & simple helpers  --------------------------- */
export let workerMessenger = null;
export function setWorkerMessenger(messenger) {
  workerMessenger = messenger;
}

export let globalUniverAPI = null;

function columnToLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;                 // 1 → A, 27 → AA, etc.
}

/* ----------  Boot-strap Univer  ---------------------------------- */
const { univerAPI } = createUniver({
  locale: LocaleType.EN_US,
  locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
  theme: defaultTheme,
  presets: [UniverSheetsCorePreset({ container: 'univer' })],
});
globalUniverAPI = univerAPI;

univerAPI.createUniverSheet({
  name: 'Hello Univer',
  rowCount: 100,
  columnCount: 100,
});

/* ----------  Example fun function:  TAYLORSWIFT() ---------------- */
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
    const idx = Number(Array.isArray(args[0]) ? args[0][0] : args[0]);
    return idx >= 1 && idx <= LYRICS.length
      ? LYRICS[idx - 1]
      : LYRICS[Math.floor(Math.random() * LYRICS.length)];
  },
  { description: 'Returns a random (or indexed) Taylor Swift lyric.' }
);

/* ----------  Class-based SMOLLM() (no arguments needed) ---------- */
class SMOLLMFunc extends BaseFunction {
  async calculate() {
    /* 1. Which cell is this formula sitting in? */
    const { row, column } = this.getContext();          // 0-based indices
    const here = columnToLetter(column + 1) + (row + 1); // e.g. “D12”

    /* 2. Write that address (sans $) into A5 */
    globalUniverAPI.executeCommand('sheet.command.set-range-values', {
      value:  { v: here },
      range:  { startRow: 4, startColumn: 0, endRow: 4, endColumn: 0 },
    });

    /* 3. Fire the AI worker (optional, non-blocking) */
    if (workerMessenger) {
      workerMessenger({
        type: 'generate',
        data: [{ role: 'user', content: '' }],
      });
    }

    /* 4. Show something in the formula cell */
    return StringValueObject.create(`Generating from ${here}…`);
  }
}

/* ----------  Register SMOLLM so users can just type =SMOLLM() ---- */
univerAPI.getFormula().registerFunction(
  'SMOLLM',                 // what users type
  SMOLLMFunc,               // handler class
  { description: 'Calls SmolLM and records its own cell in A5.' }
);
