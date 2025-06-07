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

/* ------------------------------------------------------------------ */
/* 1. Boot‑strap Univer and mount inside <div id="univer"> */
/* ------------------------------------------------------------------ */
// This part runs synchronously when the script loads.
const { univerAPI } = createUniver({
  locale: LocaleType.EN_US,
  locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
  theme: defaultTheme,
  presets: [UniverSheetsCorePreset({ container: 'univer' })],
});

globalUniverAPI = univerAPI;
console.log('Univer API initialized and assigned to globalUniverAPI.');

/* ------------------------------------------------------------------ */
/* 2. Create a visible 100 × 100 sheet */
/* ------------------------------------------------------------------ */
// This also runs synchronously.
univerAPI.createUniverSheet({
  name: 'Hello Univer',
  rowCount: 100,
  columnCount: 100,
});
console.log('Univer Sheet created.');

// --- Utility function to parse cell reference (e.g., "A1" to {row: 0, col: 0}) ---
// This is used directly by the "wormhole" UI functions.
function parseCellReferenceDirect(cellReference) {
  const match = cellReference.match(/^([A-Z]+)([0-9]+)$/i);
  if (!match) {
    throw new Error(`Invalid cell reference format: "${cellReference}". Expected "A1".`);
  }
  const colLetters = match[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < colLetters.length; i++) {
    col = col * 26 + (colLetters.charCodeAt(i) - 65 + 1);
  }
  col = col - 1; // Convert to 0-based index

  const row = parseInt(match[2], 10) - 1; // Convert to 0-based index
  return { row, col };
}

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
      return "ERROR: AI not ready";
    }

    workerMessenger({
      type: "generate",
      data: [{ role: "user", content: prompt }]
    });

    return "Generating AI response in chat...";
  },
  {
    description: 'customFunction.SMOLLM.description',
    locales: {
      enUS: {
        customFunction: {
          SMOLLM: {
            description: 'Sends a prompt to the SmolLM AI model and displays response in chat.',
          },
        },
      },
    },
  }
);


---

/* ------------------------------------------------------------------ */
/* 5. The Wormhole: Create and Manage Cell Control UI */
/* ------------------------------------------------------------------ */
// This crucial part is wrapped in a `setTimeout(..., 0)`.
// This allows the browser's JavaScript event loop to clear,
// giving UniverJS a tiny moment to finish its internal, often asynchronous,
// setup after its synchronous initialization. This makes the UI operations reliable.
setTimeout(() => {
    console.log('Activating Univer cell interaction UI (Wormhole).');

    // Create and append the cell interaction bar to the body
    const cellBar = document.createElement('div');
    cellBar.id = 'univer-cell-bar';
    cellBar.style.cssText = `
      width: 100%;
      background-color: #f3f4f6; /* light gray */
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px;
      margin-bottom: 8px;
      border-bottom: 1px solid #e5e7eb; /* light border */
      box-sizing: border-box;
    `;
    document.body.prepend(cellBar); // Add it at the very top of the body

    const cellRefInput = document.createElement('input');
    cellRefInput.id = 'univer-cell-ref-input';
    cellRefInput.type = 'text';
    cellRefInput.placeholder = 'A1';
    cellRefInput.value = 'A1';
    cellRefInput.title = 'Cell Reference (e.g. A1, B2)';
    cellRefInput.style.cssText = `
      width: 64px;
      padding: 4px;
      border-radius: 4px;
      border: 1px solid #d1d5db;
      text-align: center;
      margin-right: 8px;
      background-color: #ffffff;
    `;

    const cellValueInput = document.createElement('input');
    cellValueInput.id = 'univer-cell-value-input';
    cellValueInput.type = 'text';
    cellValueInput.placeholder = 'Value';
    cellValueInput.title = 'Cell Value';
    cellValueInput.style.cssText = `
      width: 224px;
      padding: 4px;
      border-radius: 4px;
      border: 1px solid #d1d5db;
      margin-right: 8px;
      background-color: #ffffff;
    `;

    const setCellBtn = document.createElement('button');
    setCellBtn.id = 'univer-set-cell-btn';
    setCellBtn.textContent = 'Set';
    setCellBtn.style.cssText = `
      padding: 4px 12px;
      background-color: #3b82f6;
      color: white;
      border-radius: 4px;
      margin-right: 8px;
      cursor: pointer;
      border: none;
    `;

    const getCellBtn = document.createElement('button');
    getCellBtn.id = 'univer-get-cell-btn';
    getCellBtn.textContent = 'Get';
    getCellBtn.style.cssText = `
      padding: 4px 12px;
      background-color: #22c55e;
      color: white;
      border-radius: 4px;
      cursor: pointer;
      border: none;
    `;

    cellBar.appendChild(cellRefInput);
    cellBar.appendChild(cellValueInput);
    cellBar.appendChild(setCellBtn);
    cellBar.appendChild(getCellBtn);

    // --- Attach Event Listeners to the new UI elements using direct API calls ---
    setCellBtn.addEventListener('click', () => {
        const cellReference = cellRefInput.value;
        const value = cellValueInput.value;
        // Basic defensive check: ensure Univer API and active sheet are available
        if (!globalUniverAPI || !globalUniverAPI.getActiveSheet()) {
            alert("Univer spreadsheet API is not ready. Please wait a moment or reload.");
            console.error("Attempted operation when Univer API or active sheet was not available.");
            return;
        }
        try {
            const { row, col } = parseCellReferenceDirect(cellReference);
            // Direct "wormhole" access to set cell value
            globalUniverAPI.getActiveSheet().setRangeValue(
                { row, column: col, rowCount: 1, columnCount: 1 },
                [[value]]
            );
            console.log(`Successfully set cell ${cellReference} to "${value}".`);
            cellValueInput.value = ''; // Clear value after setting
        } catch (e) {
            alert("Failed to set cell value. Check console for details.");
            console.error(`Error setting value for cell ${cellReference}:`, e);
        }
    });

    getCellBtn.addEventListener('click', () => {
        const cellReference = cellRefInput.value;
        // Basic defensive check: ensure Univer API and active sheet are available
        if (!globalUniverAPI || !globalUniverAPI.getActiveSheet()) {
            alert("Univer spreadsheet API is not ready. Please wait a moment or reload.");
            console.error("Attempted operation when Univer API or active sheet was not available.");
            return;
        }
        try {
            const { row, col } = parseCellReferenceDirect(cellReference);
            // Direct "wormhole" access to get cell value
            const value = globalUniverAPI.getActiveSheet().getRange(row, col, 1, 1).getValue();
            cellValueInput.value = value !== undefined ? String(value) : "";
            alert(`Value of ${cellReference}: ${value !== undefined ? value : "undefined"}`);
        } catch (e) {
            alert("Failed to get cell value. Check console for details.");
            console.error(`Error getting value for cell ${cellReference}:`, e);
        }
    });

}, 0); // The critical setTimeout(..., 0) to yield control
