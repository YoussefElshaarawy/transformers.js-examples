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

// --- Utility function to parse cell reference (e.g., "A1" to {row: 0, col: 0}) ---
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
/* Main Univer Initialization and UI Setup */
/* ------------------------------------------------------------------ */
// Wrap everything in a DOMContentLoaded listener for ultimate safety,
// and make it `async` so we can `await` Univer's bootstrap.
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM Content Loaded. Starting Univer initialization sequence...');

    // 1. Boot‑strap Univer and mount inside <div id="univer">
    // IMPORTANT: Destructure BOTH 'univer' (the core instance) and 'univerAPI'
    const { univer, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
        theme: defaultTheme,
        presets: [UniverSheetsCorePreset({ container: 'univer' })],
    });

    globalUniverAPI = univerAPI; // Assign univerAPI to the global export
    console.log('Univer API object created. Initiating full bootstrap...');

    try {
        // This is the absolute critical step: await the core univer instance's bootstrap.
        // This ensures all plugins, services, and internal components are fully loaded and ready.
        await univer.bootstrap();
        console.log('Univer has successfully bootstrapped and is fully ready for interaction.');
    } catch (error) {
        console.error('CRITICAL ERROR: Univer failed to bootstrap!', error);
        // This alert is from your previous code, now with proper error logging
        alert('Univer spreadsheet failed to load. Please check console for full error details. Ensure your `index.html` has a `<div id="univer"></div>` with proper sizing.');
        return; // Stop execution if Univer fails to initialize
    }

    // 2. Create a visible 100 × 100 sheet
    // This runs AFTER Univer is fully bootstrapped.
    univerAPI.createUniverSheet({
        name: 'Hello Univer',
        rowCount: 100,
        columnCount: 100,
    });
    console.log('Univer Sheet created.');

    // 3. Register Custom Formulas (TAYLORSWIFT and SMOLLM)
    // Now that Univer is fully ready, we can register functions safely.
    registerCustomFormulas(univerAPI); // Pass univerAPI to the function

    // 4. The Wormhole: Create and Manage Cell Control UI
    // Create UI elements
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
    document.body.prepend(cellBar);

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

    // Attach Event Listeners to the new UI elements using direct API calls
    setCellBtn.addEventListener('click', () => {
        const cellReference = cellRefInput.value;
        const value = cellValueInput.value;
        if (!globalUniverAPI || !globalUniverAPI.getActiveSheet()) {
            alert("Univer API or active sheet not ready for operation. Please reload.");
            console.error("Attempted operation when Univer API or active sheet was not available.");
            return;
        }
        try {
            const { row, col } = parseCellReferenceDirect(cellReference);
            globalUniverAPI.getActiveSheet().setRangeValue(
                { row, column: col, rowCount: 1, columnCount: 1 },
                [[value]]
            );
            console.log(`Successfully set cell <span class="math-inline">\{cellReference\} to "</span>{value}".`);
            cellValueInput.value = '';
        } catch (e) {
            alert("Failed to set cell value. Check console for details.");
            console.error(`Error setting value for cell ${cellReference}:`, e);
        }
    });

    getCellBtn.addEventListener('click', () => {
        const cellReference = cellRefInput.value;
        if (!globalUniverAPI || !globalUniverAPI.getActiveSheet()) {
            alert("Univer API or active sheet not ready for operation. Please reload.");
            console.error("Attempted operation when Univer API or active sheet was not available.");
            return;
        }
        try {
            const { row, col } = parseCellReferenceDirect(cellReference);
            const value = globalUniverAPI.getActiveSheet().getRange(row, col, 1, 1).getValue();
            cellValueInput.value = value !== undefined ? String(value) : "";
            alert(`Value of ${cellReference}: ${value !== undefined ? value : "undefined"}`);
        } catch (e) {
            alert("Failed to get cell value. Check console for details.");
            console.error(`Error getting value for cell ${cellReference}:`, e);
        }
    });

    console.log('Univer cell interaction UI (Wormhole) enabled.');
});

// --- Moved formula registration into a function to be called after API is ready ---
// Pass univerAPI to it to ensure it uses the fully initialized
