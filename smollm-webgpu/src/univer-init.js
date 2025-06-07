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

// --- NEW: Wrap Univer initialization in DOMContentLoaded for robustness ---
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM Content Loaded. Initializing Univer...');
  const { univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
    theme: defaultTheme,
    presets: [UniverSheetsCorePreset({ container: 'univer' })],
  });

  globalUniverAPI = univerAPI;
  console.log('Univer API initialized and assigned to globalUniverAPI:', globalUniverAPI ? 'YES' : 'NO');

  univerAPI.createUniverSheet({
    name: 'Hello Univer',
    rowCount: 100,
    columnCount: 100,
  });
  console.log('Univer Sheet created.');

  // IMPORTANT: Register custom functions *after* univerAPI is available
  // This is a common pattern to ensure the API exists before trying to use it.
  registerCustomFormulas();
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

// --- NEW: UniverCell Class for Object-Oriented Cell Interaction ---
export class UniverCell {
  constructor(cellReference) {
    if (!globalUniverAPI) {
      // This check is crucial for robustness. The constructor should ideally not be called
      // before globalUniverAPI is ready, but it's a good safeguard.
      throw new Error("Univer API is not initialized. Cannot create UniverCell instance.");
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
    if (!globalUnverAPI) {
      console.error("Univer API not available to get cell value.");
      return undefined;
    }
    try {
      const activeSheet = globalUniverAPI.getActiveSheet();
      if (!activeSheet) {
        console.warn("No active sheet found to get cell value from. Ensure a sheet is created and active.");
        return undefined;
      }
      // UniverJS getRange() returns a Range object, then getValue()
      const range = activeSheet.getRange(this.row, this.col, 1, 1); // row, col, rowCount, colCount
      return range ? range.getValue() : undefined; // Return undefined if range is somehow null
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
    if (!globalUniverAPI) {
      console.error("Univer API not available to set cell value.");
      return false;
    }
    try {
      const activeSheet = globalUniverAPI.getActiveSheet();
      if (!activeSheet) {
        console.error("No active sheet found to set cell value in. Ensure a sheet is created and active.");
        return false;
      }
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

  // You could add more methods here, e.g.:
  // getFormula()
  // setFormula(formula)
  // getStyle()
  // setStyle(style)
  // clear()
  // on(eventName, callback) // For custom events related to this cell (more advanced)
}

// --- Backward-compatible helper functions, now using UniverCell ---
/**
 * Sets the value of a cell in the active sheet using a cell reference.
 * @param {string} cellReference The cell reference (e.g., "A1", "B5").
 * @param {any} value The value to set in the cell.
 * @returns {boolean} True if successful, false otherwise.
 */
export function setCellValueInUniver(cellReference, value) {
  try {
    const cell = new UniverCell(cellReference);
    return cell.setValue(value);
  } catch (e) {
    console.error(`Failed to set cell value for "${cellReference}" via helper:`, e.message);
    return false;
  }
}

/**
 * Gets the value of a cell in the active sheet using a cell reference.
 * @param {string} cellReference The cell reference (e.g., "A1", "B5").
 * @returns {any | undefined} The cell's value, or undefined if an error occurs.
 */
export function getCellValueFromUniver(cellReference) {
  try {
    const cell = new UniverCell(cellReference);
    return cell.getValue();
  } catch (e) {
    console.error(`Failed to get cell value for "${cellReference}" via helper:`, e.message);
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
