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

// --- NEW: Export a variable to hold the worker messenger function ---
// This function will be set by App.jsx to allow Univer to send messages to the AI worker.
export let workerMessenger = null;

// --- NEW: Export a function to set the worker messenger ---
export function setWorkerMessenger(messenger) {
  workerMessenger = messenger;
}

// --- NEW: Export univerAPI so it can be used globally (e.g., in App.jsx for cell updates) ---
// While not directly used *in* this file for the cell update logic (the Promise handles that),
// it's good to keep it exported if other parts of your app might need it.
export let globalUniverAPI = null;

// --- NEW: Map to store Promises' resolve functions for SMOLLM formula calls ---
// This map holds the 'resolve' function for each SMOLLM formula's Promise,
// keyed by a unique request ID. App.jsx will use this when the AI response is ready.
const smollmResolvers = new Map();

// --- NEW: Function to set the callback for when SMOLLM results are ready ---
// App.jsx will call this to register its callback, which will then resolve the
// promises stored in `smollmResolvers`.
let _smollmCompletionCallback = null; // Use an internal variable to hold the actual callback
export function setSmollmCompletionCallback(callback) {
  _smollmCompletionCallback = callback;
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
  async (prompt) => {
    if (!workerMessenger) {
      console.error("AI worker messenger is not set!");
      // Display an error in the cell immediately if the worker isn't ready
      return "ERROR: AI not ready";
    }

    // --- NEW: Generate a unique request ID for this specific SMOLLM call ---
    // This ID helps App.jsx match the AI's response back to this formula instance.
    const smollmRequestId = `smollm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // --- NEW: Return a Promise that will resolve with the AI response ---
    // The cell will display a loading state until this Promise resolves.
    return new Promise((resolve) => {
      // Store the 'resolve' function in our map, keyed by the unique request ID.
      // App.jsx will later call the callback that uses this 'resolve' function.
      smollmResolvers.set(smollmRequestId, resolve);

      // Send the prompt to the worker via the messenger provided by App.jsx.
      // We include the unique request ID so the worker (and App.jsx) can track it.
      workerMessenger({
        type: "generate", // Keep the type as 'generate' for worker simplicity
        smollmRequestId: smollmRequestId, // NEW: Pass the unique ID for this specific SMOLLM request
        data: [{ role: "user", content: prompt }] // Worker expects an array of messages
      });
    });
  },
  {
    description: 'customFunction.SMOLLM.description',
    locales: {
      enUS: {
        customFunction: {
          SMOLLM: {
            description: 'Sends a prompt to the SmolLM AI model and displays response in chat, also updates the cell.',
          },
        },
      },
    },
  }
);

// --- NEW: Logic to handle the completion of SMOLLM requests from App.jsx ---
// This internal function is what `setSmollmCompletionCallback` will register.
// It resolves the stored Promise for the specific SMOLLM call, updating the cell.
_smollmCompletionCallback = (requestId, finalOutput) => {
  if (smollmResolvers.has(requestId)) {
    const resolve = smollmResolvers.get(requestId);
    resolve(finalOutput); // Resolve the Promise, which updates the cell in Univer
    smollmResolvers.delete(requestId); // Clean up the resolver from the map
  }
};
