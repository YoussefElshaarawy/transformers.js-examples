import {
  createUniver,
  defaultTheme,
  LocaleType,
  merge,
} from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core';
import enUS from '@univerjs/presets/preset-sheets-core/locales/en-US';
import zhCN from '@univerjs/presets/preset-sheets-core/locales/zh-CN';

// Import Univer's core styles (ensure these paths are correct relative to your project structure)
import '@univerjs/presets/lib/styles/preset-sheets-core.css';
// Assuming this style.css is specific to your Univer instance or global styling
import './style.css'; 

/* ------------------------------------------------------------------ */
/* 1.  Boot‑strap Univer and mount inside <div id="univer">          */
/* ------------------------------------------------------------------ */
const { univerAPI } = createUniver({
  locale: LocaleType.EN_US,
  locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
  theme: defaultTheme,
  presets: [UniverSheetsCorePreset({ container: 'univer' })], // Mounts to the div with id="univer"
});

// IMPORTANT: Expose univerAPI globally so App.jsx can interact with it
// This is like giving App.jsx a magical direct line to the spreadsheet.
window.univerAPI = univerAPI;

/* ------------------------------------------------------------------ */
/* 2.  Create a visible 100 × 100 sheet                               */
/* ------------------------------------------------------------------ */
univerAPI.createUniverSheet({
  name: 'Hello Univer',
  rowCount: 100,
  columnCount: 100,
});

/* ------------------------------------------------------------------ */
/* 3.  Register the TAYLORSWIFT() custom formula                      */
/* ------------------------------------------------------------------ */
const LYRICS = [
  "Cause darling I'm a nightmare dressed like a daydream",
  "We're happy, free, confused and lonely at the same time",
  "You call me up again just to break me like a promise",
  "I remember it all too well",
  "Loving him was red—burning red",
];

(univerAPI.getFormula()).registerFunction(
  'TAYLORSWIFT',
  (...args) => {
    // Basic argument parsing for TAYLORSWIFT(index) or TAYLORSWIFT()
    const value = Array.isArray(args[0]) ? args[0][0] : args[0];
    const idx = Number(value);

    // Return a specific lyric if index is valid, otherwise a random one
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
/* 4. Register the AI() custom formula                                */
/* ------------------------------------------------------------------ */
(univerAPI.getFormula()).registerFunction(
  'AI',
  (...args) => {
    const prompt = Array.isArray(args[0]) ? args[0][0] : args[0];
    const currentCell = univerAPI.getActiveWorkbook().getActiveSheet().getActiveRange().getA1Notation();

    if (typeof window.triggerAICellFill === 'function') {
      // Call the global function exposed by WorkerContext to trigger AI generation
      window.triggerAICellFill(prompt, currentCell);
      return "Loading AI..."; // Return a placeholder immediately
    } else {
      console.error("window.triggerAICellFill is not defined. AI integration might not be ready.");
      return "ERROR: AI not ready";
    }
  },
  {
    description: 'customFunction.AI.description',
    locales: {
      enUS: {
        customFunction: {
          AI: {
            description:
              'Sends a prompt to the AI model and fills the current cell with the response.',
          },
        },
      },
    },
  }
);
