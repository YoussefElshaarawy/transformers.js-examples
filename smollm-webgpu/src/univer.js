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
/* 1. Boot‑strap Univer and mount inside <div id="univer">          */
/* ------------------------------------------------------------------ */
const { univerAPI } = createUniver({
  locale: LocaleType.EN_US,
  locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
  theme: defaultTheme,
  presets: [UniverSheetsCorePreset({ container: 'univer' })], // Mounts to the div with id="univer"
});

// IMPORTANT: Expose univerAPI globally so other parts of your application can interact with it
// This is like giving your application a magical direct line to the spreadsheet.
window.univerAPI = univerAPI;

/* ------------------------------------------------------------------ */
/* 2. Create a visible 100 × 100 sheet                                */
/* ------------------------------------------------------------------ */
univerAPI.createUniverSheet({
  name: 'Hello Univer',
  rowCount: 100,
  columnCount: 100,
});

/* ------------------------------------------------------------------ */
/* 3. Register the TAYLORSWIFT() custom formula                     */
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
/* 4. Register the AI() custom formula                              */
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

/* ------------------------------------------------------------------ */
/* NEW: Cell Accessor Functions                                     */
/* ------------------------------------------------------------------ */

/**
 * Gets the most updated actual value from a specified cell in the active sheet.
 * @param {string} cellAddress - The A1 notation of the cell (e.g., "A1", "B5").
 * @returns {any | null} The actual value of the cell, or null if an error occurs or the cell is empty.
 */
function getUniverCellValue(cellAddress) {
  try {
    if (!window.univerAPI) {
      console.warn('Univer API is not yet available.');
      return null;
    }
    const activeWorkbook = window.univerAPI.getActiveWorkbook();
    if (!activeWorkbook) {
      console.warn('No active workbook found in Univer.');
      return null;
    }
    const activeSheet = activeWorkbook.getActiveSheet();
    if (!activeSheet) {
      console.warn('No active sheet found in Univer.');
      return null;
    }

    // Get the range object for the specified cell
    const cell = activeSheet.getRange(cellAddress);

    // getActualCellValue() retrieves the raw, unformatted value, including formulas.
    // getDisplayValue() would retrieve the formatted value as seen in the UI.
    const value = cell.getActualCellValue();
    console.log(`Successfully retrieved value from ${cellAddress}:`, value);
    return value;
  } catch (error) {
    console.error(`Error getting value from cell ${cellAddress}:`, error);
    return null;
  }
}

/**
 * Writes any content (string, number, boolean, or formula string) into a specified cell
 * in the active sheet.
 * @param {string} cellAddress - The A1 notation of the cell (e.g., "A1", "C10").
 * @param {any} value - The content to write into the cell. Can be a string, number, boolean, or a formula string (e.g., "=SUM(A1:B1)").
 * @returns {boolean} True if the write operation was successful, false otherwise.
 */
function setUniverCellValue(cellAddress, value) {
  try {
    if (!window.univerAPI) {
      console.warn('Univer API is not yet available.');
      return false;
    }
    const activeWorkbook = window.univerAPI.getActiveWorkbook();
    if (!activeWorkbook) {
      console.warn('No active workbook found in Univer.');
      return false;
    }
    const activeSheet = activeWorkbook.getActiveSheet();
    if (!activeSheet) {
      console.warn('No active sheet found in Univer.');
      return false;
    }

    // Get the range object for the specified cell
    const cell = activeSheet.getRange(cellAddress);

    // setValue() writes the content to the cell. If it's a string starting with '=',
    // UniverJS will interpret it as a formula.
    cell.setValue(value);
    console.log(`Successfully wrote "${value}" to cell ${cellAddress}`);
    return true;
  } catch (error) {
    console.error(`Error writing value to cell ${cellAddress}:`, error);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Example Usage (for demonstration purposes)                       */
/* ------------------------------------------------------------------ */

// It's good practice to ensure Univer is fully initialized before trying to access cells.
// A setTimeout is used here for demonstration, but in a real app, you might listen
// for a UniverJS 'ready' event or ensure your calls happen after the UI is rendered.
setTimeout(() => {
  console.log('--- Demonstrating Cell Accessor Functions ---');

  // Write some values
  setUniverCellValue('A1', 'Hello Univer!');
  setUniverCellValue('B2', 12345);
  setUniverCellValue('C3', true);
  setUniverCellValue('D4', '=TAYLORSWIFT(2)'); // Set a formula
  setUniverCellValue('E5', '=B2*2'); // Another formula

  // Read values
  const valA1 = getUniverCellValue('A1');
  console.log(`Content of A1: ${valA1}`); // Expected: "Hello Univer!"

  const valB2 = getUniverCellValue('B2');
  console.log(`Content of B2: ${valB2}`); // Expected: 12345

  const valC3 = getUniverCellValue('C3');
  console.log(`Content of C3: ${valC3}`); // Expected: true

  const valD4 = getUniverCellValue('D4');
  // Note: For formulas, getActualCellValue() returns the formula string.
  // getDisplayValue() would return the calculated lyric.
  console.log(`Content of D4 (formula): ${valD4}`); // Expected: "=TAYLORSWIFT(2)"

  const valE5 = getUniverCellValue('E5');
  console.log(`Content of E5 (formula): ${valE5}`); // Expected: "=B2*2"

  // You can also get the displayed value for formulas
  const cellD4 = univerAPI.getActiveWorkbook().getActiveSheet().getRange('D4');
  if (cellD4) {
    const displayValD4 = cellD4.getDisplayValue();
    console.log(`Displayed content of D4: ${displayValD4}`); // Expected: "We're happy, free, confused and lonely at the same time"
  }

}, 1000); // Wait for 1 second to ensure Univer is rendered
