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
/* Helper to convert A1 notation to 0-indexed row/column */
/* ------------------------------------------------------------------ */
function fromA1Notation(a1) {
    let colStr = '';
    let rowStr = '';

    // Separate column letters from row numbers
    for (let i = 0; i < a1.length; i++) {
        const char = a1[i];
        if (char >= 'A' && char <= 'Z') {
            colStr += char;
        } else if (char >= '0' && char <= '9') {
            rowStr += char;
        } else {
            throw new Error(`Invalid character in A1 notation: ${char}`);
        }
    }

    if (!colStr || !rowStr) {
        throw new Error('Invalid A1 notation format. Expected format like "A1" or "B2".');
    }

    // Convert column string (e.g., "A", "AB") to 0-indexed number
    let column = 0;
    for (let i = 0; i < colStr.length; i++) {
        column = column * 26 + (colStr.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
    }
    column--; // Adjust to be 0-indexed (A=0, B=1, ...)

    // Convert row string (e.g., "1", "10") to 0-indexed number
    const row = parseInt(rowStr, 10) - 1; // Adjust to be 0-indexed (1=0, 2=1, ...)

    return { row, column };
}


/* ------------------------------------------------------------------ */
/* NEW: Custom UI for manual cell input */
/* ------------------------------------------------------------------ */
// WARNING: Adding direct DOM manipulation in univer-init.js is generally
// not recommended for React applications. It's better to manage UI
// components and their state within App.jsx. This is provided to
// fulfill the specific request.

// Create a container for the new UI elements
const customUiContainer = document.createElement('div');
customUiContainer.id = 'custom-cell-input-ui';
customUiContainer.style.padding = '10px';
customUiContainer.style.borderBottom = '1px solid #ccc';
customUiContainer.style.marginBottom = '10px';
customUiContainer.style.backgroundColor = '#f0f0f0';
customUiContainer.style.display = 'flex';
customUiContainer.style.gap = '10px';
customUiContainer.style.alignItems = 'center';


const cellAddressInput = document.createElement('input');
cellAddressInput.type = 'text';
cellAddressInput.placeholder = 'Enter cell (e.g., A1)';
cellAddressInput.style.padding = '5px';
cellAddressInput.style.border = '1px solid #aaa';
cellAddressInput.style.borderRadius = '3px';
cellAddressInput.style.flex = '0 0 120px';


const cellValueInput = document.createElement('input');
cellValueInput.type = 'text';
cellValueInput.placeholder = 'Enter value';
cellValueInput.style.padding = '5px';
cellValueInput.style.border = '1px solid #aaa';
cellValueInput.style.borderRadius = '3px';
cellValueInput.style.flexGrow = '1';


const setCellButton = document.createElement('button');
setCellButton.textContent = 'Set Cell Value';
setCellButton.style.padding = '5px 10px';
setCellButton.style.backgroundColor = '#4CAF50';
setCellButton.style.color = 'white';
setCellButton.style.border = 'none';
setCellButton.style.borderRadius = '3px';
setCellButton.style.cursor = 'pointer';

customUiContainer.appendChild(cellAddressInput);
customUiContainer.appendChild(cellValueInput);
customUiContainer.appendChild(setCellButton);

// Prepend to body so it appears at the top of your page
document.body.prepend(customUiContainer); 

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

// --- NEW: Add event listener for the custom UI button ---
setCellButton.addEventListener('click', () => {
    const cellAddress = cellAddressInput.value.trim().toUpperCase(); // Convert to uppercase for A1
    const cellValue = cellValueInput.value;

    if (!cellAddress) {
        alert('Please enter a cell address (e.g., A1)');
        return;
    }

    if (!globalUniverAPI) {
        console.error("Univer API is not initialized yet!");
        alert("Spreadsheet not ready. Please wait for Univer to load.");
        return;
    }

    try {
        const { row, column } = fromA1Notation(cellAddress);

        // Use the executeCommand approach as suggested
        globalUniverAPI.executeCommand('sheet.command.set-range-values', {
            // The value is expected in a specific format for commands
            value: { v: cellValue }, // 'v' for raw value
            range: {
                startRow: row,
                startColumn: column,
                endRow: row, // For a single cell, start and end are the same
                endColumn: column
            },
            // Assuming we're targeting the active sheet for simplicity.
            // If you need to target a specific sheet by ID, you would add:
            // sheetId: globalUniverAPI.sheets.getActiveWorkbook().getActiveSheet().getSheetId(),
        });

        console.log(`Successfully set cell <span class="math-inline">\{cellAddress\} to\: "</span>{cellValue}" using command.`);
        // Optionally clear inputs after setting
        // cellAddressInput.value = '';
        // cellValueInput.value = '';
    } catch (e) {
        console.error("Error setting cell value via command:", e);
        alert(`Failed to set cell ${cellAddress}: ${e.message}`);
    }
});


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
  (prompt) => { // Removed 'context' parameter due to previous error.
    if (!workerMessenger) {
      console.error("AI worker messenger is not set!");
      return "ERROR: AI not ready";
    }

    const actualPrompt = Array.isArray(prompt) ? prompt[0] : prompt;

    // IMPORTANT: Currently, the SMOLLM formula cannot directly update its own cell
    // because UniverJS does not reliably provide the calling cell's context (row, column, sheet ID)
    // directly within the custom formula function.
    // Therefore, the AI response from SMOLLM
