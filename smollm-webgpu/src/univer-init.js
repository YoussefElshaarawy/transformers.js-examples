// univer-init.js

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

export let workerMessenger = null;

export function setWorkerMessenger(messenger) {
  workerMessenger = messenger;
}

export let globalUniverAPI = null;

export const smollmRequestMap = new Map();

// --- NEW: Export a Promise that resolves when Univer is fully ready ---
let _resolveUniverReady;
export const univerReadyPromise = new Promise(resolve => {
    _resolveUniverReady = resolve;
});


/* ------------------------------------------------------------------ */
/* 1. Boot‑strap Univer and mount inside <div id="univer"> */
/* ------------------------------------------------------------------ */
const { univerAPI, sheet, dispose } = createUniver({
  locale: LocaleType.EN_US,
  locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
  theme: defaultTheme,
  presets: [UniverSheetsCorePreset({ container: 'univer' })],
});

globalUniverAPI = univerAPI;
console.log("Univer initialized, globalUniverAPI set:", globalUniverAPI);

/* ------------------------------------------------------------------ */
/* 2. Create a visible 100 × 100 sheet */
/* ------------------------------------------------------------------ */
univerAPI.createUniverSheet({
  name: 'Hello Univer',
  rowCount: 100,
  columnCount: 100,
});

// Now, we resolve the promise AFTER Univer is expected to be ready.
// Using a setTimeout is a simple way, but ideally, Univer would have an
// explicit 'onReady' event for plugins/services.
setTimeout(() => {
    if (globalUniverAPI?.get.commandService()) {
        console.log("Univer's command service is ready!");
        _resolveUniverReady(true); // Resolve the promise
    } else {
        console.warn("Univer command service not ready after timeout. Manual refresh might be needed.");
        _resolveUniverReady(false); // Resolve as failed, or implement more sophisticated retry
    }
}, 500); // Give Univer some time to fully initialize


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
  async function(prompt) {
    const { row, col, sheetId } = this;

    console.log("SMOLLM function called with:", { prompt, row, col, sheetId });

    const stringPrompt = String(prompt);

    if (!workerMessenger) {
      console.error("AI worker messenger is not set!");
      return { v: "ERROR: AI not ready" };
    }

    const smollmRequestId = `smollm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    smollmRequestMap.set(smollmRequestId, { row, col, sheetId });
    console.log("SMOLLM: Registered request ID", smollmRequestId, "for cell", { row, col, sheetId });

    workerMessenger({
      type: "generate",
      smollmRequestId: smollmRequestId,
      data: [{ role: "user", content: stringPrompt }],
      originalPromptForSmollm: stringPrompt
    });
    console.log("SMOLLM: Message sent to worker for ID", smollmRequestId);

    return { v: "Generating AI response..." };
  },
  {
    description: 'customFunction.SMOLLM.description',
    locales: {
      enUS: {
        customFunction: {
          SMOLLM: {
            description: 'Sends a prompt to the SmolLM AI model and displays response in chat, and updates the cell.',
          },
        },
      },
    },
  }
);
