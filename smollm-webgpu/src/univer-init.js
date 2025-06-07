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

// --- Univer initialization moved into DOMContentLoaded for robustness ---
document.addEventListener('DOMContentLoaded', async () => { // **Ensure this is async**
  console.log('DOM Content Loaded. Initializing Univer...');

  // --- Create and append the cell interaction bar ---
  const cellBar = document.createElement('div');
  cellBar.id = 'univer-cell-bar';
  // Basic styling for the bar
  cellBar.style.cssText = `
    width: 100%;
    background-color: #f3f4f6; /* light gray */
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    margin-bottom: 8px;
    border-bottom: 1px solid #e5e7eb; /* light border */
    box-sizing: border-box; /* Include padding in width/height */
  `;
  document.body.prepend(cellBar); // Add the bar at the very top of the body

  const cellRefInput = document.createElement('input');
  cellRefInput.id = 'univer-cell-ref-input';
  cellRefInput.type = 'text';
  cellRefInput.placeholder = 'A1';
  cellRefInput.value = 'A1'; // Default value
  cellRefInput.title = 'Cell Reference (e.g. A1, B2)';
  cellRefInput.style.cssText = `
    width: 64px;
    padding: 4px;
    border-radius: 4px;
    border: 1px solid #d1d5db;
    text-align: center;
    margin-right: 8px;
    background-color: #ffffff; /* white background */
  `;
  cellRefInput.disabled = true; // Initially disabled

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
    background-color: #ffffff; /* white background */
  `;
  cellValueInput.disabled = true; // Initially disabled

  const setCellBtn = document.createElement('button');
  setCellBtn.id = 'univer-set-cell-btn';
  setCellBtn.textContent = 'Set';
  setCellBtn.style.cssText = `
    padding: 4px 12px;
    background-color: #3b82f6; /* blue */
    color: white;
    border-radius: 4px;
    margin-right: 8px;
    cursor: not-allowed; /* disabled look */
    opacity: 0.5;
    border: none;
  `;
  setCellBtn.disabled = true; // Initially disabled

  const getCellBtn = document.createElement('button');
  getCellBtn.id = 'univer-get-cell-btn';
  getCellBtn.textContent = 'Get';
  getCellBtn.style.cssText = `
    padding: 4px 12px;
    background-color: #22c55e; /* green */
    color: white;
    border-radius: 4px;
    cursor: not-allowed; /* disabled look */
    opacity: 0.5;
    border: none;
  `;
  getCellBtn.disabled = true; // Initially disabled

  cellBar.appendChild(cellRefInput);
  cellBar.appendChild(cellValueInput);
  cellBar.appendChild(setCellBtn);
  cellBar.appendChild(getCellBtn);

  // --- Initialize UniverJS, destructure both 'univer' (core instance) and 'univerAPI' ---
  const { univer, univerAPI } = createUniver({ // **Destructure both univer and univerAPI**
    locale: LocaleType.EN_US,
    locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
    theme: defaultTheme,
    presets: [UniverSheetsCorePreset({ container: 'univer' })], // Assumes 'univer' div exists in index.html
  });

  globalUniverAPI = univerAPI; // Assign univerAPI to the global variable

  console.log('Univer core instance created. Awaiting bootstrap...');
  try {
    // **This is the key API-first step:**
    // Await the core 'univer' instance's bootstrap method. This method is designed
    // to complete all internal initialization and plugin loading, making the
    // entire Univer system ready for interaction.
    await univer.bootstrap();
    console.log('Univer has successfully bootstrapped and is fully ready.');
  } catch (error) {
    console.error('Failed to bootstrap Univer:', error);
    alert('Univer spreadsheet failed to load. Please check console for errors and ensure your `index.html` has a `<div id="univer"></div>`.');
    return; // Stop if bootstrap fails
  }

  // Ensure an active sheet exists after bootstrap.
  // Although createUniverSheet is called, sometimes explicit activation is needed if
  // multiple sheets are present or initial setup is complex.
  let activeSheet = univerAPI.getActiveSheet();
  if (!activeSheet) {
    console.log('No active sheet found after bootstrap, creating a default one...');
    univerAPI.createUniverSheet({
      name: 'Sheet1', // Give it a default name
      rowCount: 100,
      columnCount: 100,
    });
    activeSheet = univerAPI.getActiveSheet(); // Try to get it again
    if (!activeSheet) {
        console.error("Could not get an active sheet even after creation attempt. Univer might not be fully configured.");
        alert("Univer spreadsheet is loaded but no active sheet could be found/created. Cell operations might not work.");
        // We can continue, but operations might fail if no sheet context
    } else {
        console.log('Default Univer Sheet created and active.');
    }
  } else {
    console.log('Active Univer Sheet found.');
  }


  // Register custom functions *after* univerAPI and sheet are confirmed ready
  registerCustomFormulas();

  // --- NEW: Enable UI elements only after Univer is fully ready and bootstrapped ---
  cellRefInput.disabled = false;
  cellValueInput.disabled = false;
  setCellBtn.disabled = false;
  getCellBtn.disabled = false;
  setCellBtn.style.opacity = '1';
  setCellBtn.style.cursor = 'pointer'; // Ensure cursor changes on hover
  getCellBtn.style.opacity = '1';
  getCellBtn.style.cursor = 'pointer'; // Ensure cursor changes on hover
  console.log('Univer cell interaction UI enabled.');

  // --- Attach Event Listeners to the new UI elements ---
  setCellBtn.addEventListener('click', () => {
      // These checks are still good as defensive programming, though unlikely to fail now
      if (!globalUniverAPI || !globalUniverAPI.getActiveSheet()) {
          alert("Univer spreadsheet API is unexpectedly unavailable. Please reload.");
          console.error("Attempted operation when Univer API or active sheet was not available after bootstrap.");
          return;
      }
      try {
          const cell = new UniverCell(cellRefInput.value);
          if (cell.setValue(cellValueInput.value)) {
              cellValueInput.value = ''; // Clear value after setting
          } else {
              // Detailed console error is already inside UniverCell.setValue
              alert("Failed to set cell value. Check console for details.");
          }
      } catch (e) {
          alert("Failed to set cell value (initialization error or invalid reference). Check console for details.");
          console.error("Error setting cell value via UniverCell:", e);
      }
  });

  getCellBtn.addEventListener('click', () => {
      if (!globalUniverAPI || !globalUniverAPI.getActiveSheet()) {
          alert("Univer spreadsheet API is unexpectedly unavailable. Please reload.");
          console.error("Attempted operation when Univer API or active sheet was not available after bootstrap.");
          return;
      }
      try {
          const cell = new UniverCell(cellRefInput.value);
          const value = cell.getValue();
          cellValueInput.value = value !== undefined ? String(value) : "";
          alert(`Value of ${cellRefInput.value}: ${value !== undefined ? value : "undefined"}`);
      } catch (e) {
          alert("Failed to get cell value. Check console for details.");
          console.error("Error getting cell value via UniverCell:", e);
      }
  });
});

// --- Utility function to parse cell reference (e.g., "A1" to {row: 0, col: 0}) ---
function parseCellReference(cellReference) {
  const match = cellReference.match(/^([A-Z]+)([0-9]+)$/i);
  if (!match) {
    throw new Error(`Invalid cell reference format: "${cellReference}". Expected format like "A1".`);
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

// --- UniverCell Class for Object-Oriented Cell Interaction ---
export class UniverCell {
  constructor(cellReference) {
    // This check is crucial for robustness.
    if (!globalUniverAPI || !globalUniverAPI.getActiveSheet()) {
      throw new Error("Univer API or active sheet is not initialized. Cannot create UniverCell instance.");
    }
    this.cellReference = cellReference.toUpperCase();
    try {
      const { row, col } = parseCellReference(this.cellReference);
      this.row = row;
      this.col = col;
    } catch (error) {
      console.error(`Error parsing cell reference for UniverCell "${this.cellReference}": ${error.message}`);
      throw error; // Re-throw to indicate a bad reference
    }
  }

  /**
   * Gets the value of the cell.
   * @returns {any | undefined} The cell's value, or undefined if an error occurs.
   */
  getValue() {
    if (!globalUniverAPI || !globalUniverAPI.getActiveSheet()) { // Defensive check
      console.error("Univer API or active sheet not available to get cell value (internal check).");
      return undefined;
    }
    try {
      const activeSheet = globalUniverAPI.getActiveSheet();
      const range = activeSheet.getRange(this.row, this.col, 1, 1);
      return range ? range.getValue() : undefined;
    } catch (e) {
      console.error(`Error getting value for cell ${this.cellReference}:`, e);
      return undefined;
    }
  }

  /**
   * Sets the value of the cell.
   * @param {any} value The value to set in the cell.
   * @returns {boolean} True if successful, false otherwise.
   */
  setValue(value) {
    if (!globalUniverAPI || !globalUniverAPI.getActiveSheet()) { // Defensive check
      console.error("Univer API or active sheet not available to set cell value (internal check).");
      return false;
    }
    try {
      const activeSheet = globalUniverAPI.getActiveSheet();
      activeSheet.setRangeValue(
        { row: this.row, column: this.col, rowCount: 1, columnCount: 1 },
        [[value]]
      );
      console.log(`Successfully set cell ${this.cellReference} to "${value}".`);
      return true;
    } catch (e) {
      console.error(`Error setting value for cell ${this.cellReference}:`, e);
      return false;
    }
  }
}

// --- Backward-compatible helper functions, now using UniverCell internally ---
export function setCellValueInUniver(cellReference, value) {
  try {
    const cell = new UniverCell(cellReference);
    return cell.setValue(value);
  } catch (e) {
    console.error(`Failed to set cell value for "${cellReference}" via helper: ${e.message}`);
    return false;
  }
}

export function getCellValueFromUniver(cellReference) {
  try {
    const cell = new UniverCell(cellReference);
    return cell.getValue();
  } catch (e) {
    console.error(`Failed to get cell value for "${cellReference}" via helper: ${e.message}`);
    return undefined;
  }
}

// --- Moved formula registration into a function to be called after API is ready ---
function registerCustomFormulas() {
  if (!globalUniverAPI) {
    console.warn("Univer API not available to register custom formulas yet.");
    return;
  }

  const LYRICS = [
    "Cause darling I'm a nightmare dressed like a daydream",
    "We're happy, free, confused and lonely at the same time",
    "You call me up again just to break me like a promise",
    "I remember it all too well",
    "Loving him was red—burning red",
  ];

  globalUniverAPI.getFormula().registerFunction(
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

  globalUniverAPI.getFormula().registerFunction(
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
  console.log('Custom formulas registered.');
}
