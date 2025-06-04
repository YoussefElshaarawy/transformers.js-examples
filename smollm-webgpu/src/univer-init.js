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

/* ------------------------------------------------------------------ */
/* Helper to convert 0-indexed row/column to A1 notation */
/* ------------------------------------------------------------------ */
function toA1Notation(row, col) {
    let colStr = '';
    let dividend = col + 1; // Convert 0-indexed column to 1-indexed for A1
    while (dividend > 0) {
        const modulo = (dividend - 1) % 26;
        colStr = String.fromCharCode(65 + modulo) + colStr;
        dividend = Math.floor((dividend - modulo) / 26);
    }
    return `${colStr}${row + 1}`; // Convert 0-indexed row to 1-indexed for A1
}


/* ------------------------------------------------------------------ */
/* 4. Register the SMOLLM() custom formula */
/* ------------------------------------------------------------------ */
univerAPI.getFormula().registerFunction(
    'SMOLLM',
    // IMPORTANT ASSUMPTION: This assumes Univer's custom function API
    // passes a `context` object as a *second* argument to the formula function,
    // which contains the `sheetId`, `row`, and `column` of the cell where the formula is executed.
    // If Univer's actual API differs (e.g., provides context differently or not at all
    // to the formula function), this part will need to be adjusted based on Univer's documentation.
    (prompt, context) => {
        if (!workerMessenger) {
            console.error("AI worker messenger is not set!");
            return "ERROR: AI not ready";
        }

        const actualPrompt = Array.isArray(prompt) ? prompt[0] : prompt;

        // Extract cell information from the context.
        // These property names (`sheetId`, `row`, `column`) are assumed based on common spreadsheet API patterns.
        const sheetId = context?.sheetId;
        const row = context?.row;
        const column = context?.column;

        // Fallback or error handling if cell context is not provided
        if (row === undefined || column === undefined || sheetId === undefined) {
             console.error("Could not determine calling cell's sheetId/row/column for SMOLLM. Ensure Univer custom formula context provides this information.");
             return "ERROR: Cell context missing";
        }

        const cellReference = toA1Notation(row, column); // Convert numerical row/col to A1 notation (e.g., "A1", "B5")
        console.log(`SMOLLM called from: Sheet ${sheetId}, Cell ${cellReference}`);


        // Send the prompt, along with the cell's sheetId and A1 reference, to the worker.
        // The 'source: spreadsheet' flag helps App.jsx differentiate requests.
        workerMessenger({
            type: "generate",
            data: [{ role: "user", content: actualPrompt }],
            cellInfo: {
                sheetId: sheetId,
                cellReference: cellReference,
            },
            source: 'spreadsheet'
        });

        // Return a message indicating generation is in progress for the cell.
        // The actual AI response will be written into this cell directly by App.jsx later.
        return "Generating AI response...";
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
