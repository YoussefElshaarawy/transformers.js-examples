import { Univer, set } from '@univerjs/core';
import { defaultWorkbookData } from '@univerjs/common-workbook';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverFormulaPlugin } from '@univerjs/formula';
import { enUS } from '@univerjs/design'; // Note: enUS is imported but not used in this snippet
import { UIPlugin } from '@univerjs/ui';
import { LocaleType } from '@univerjs/core';

// Initialize Univer instance
const univer = Univer.newInstance({
    locale: LocaleType.EN_US, // Using LocaleType enum
});

// Install core plugins
univer.installPlugin(new UIPlugin()); // Install UI plugin if you're using Univer's UI components
univer.installPlugin(new UniverSheetsPlugin());
univer.installPlugin(new UniverFormulaPlugin()); // Essential for custom formulas

// Load a default workbook
univer.createUnit(defaultWorkbookData);

// --- START: Global Functions for External Communication ---

/**
 * Global function exposed for the React chat application to update Univer cell values.
 * This is crucial for the AI response to appear in the spreadsheet.
 * @param {string} address The cell address (e.g., "A1", "B5").
 * @param {any} value The value to set in the cell.
 * @returns {boolean} True if the cell was updated successfully, false otherwise.
 */
window.setUniverCellValue = (address, value) => {
    try {
        const workbook = univer.getCurrentWorkbook();
        if (!workbook) {
            console.error("No active workbook found in Univer.");
            return false;
        }
        const sheet = workbook.getActiveSheet();
        if (!sheet) {
            console.error("No active sheet found in Univer.");
            return false;
        }

        // --- IMPORTANT: Univer's API for setting cell values ---
        // The actual implementation here might vary slightly based on your Univer version and plugins.
        // A common pattern is to get a range and then set its value.
        // For example, if 'address' is "A1", you might parse it to row/column indices.

        // Example parsing "A1" to {row: 0, col: 0}
        const colMatch = address.match(/[A-Z]+/);
        const rowMatch = address.match(/\d+/);

        if (!colMatch || !rowMatch) {
            console.error(`Invalid cell address format: ${address}`);
            return false;
        }

        const colStr = colMatch[0];
        let col = 0;
        for (let i = 0; i < colStr.length; i++) {
            col = col * 26 + (colStr.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
        }
        col = col - 1; // Convert to 0-indexed

        const row = parseInt(rowMatch[0], 10) - 1; // Convert to 0-indexed

        if (isNaN(row) || isNaN(col) || row < 0 || col < 0) {
            console.error(`Parsed invalid row/col from address: ${address} -> row: ${row}, col: ${col}`);
            return false;
        }

        // Get the range and set the value.
        // Note: The specific method might be `sheet.getRange(row, col).setValue(value)`
        // or a command like `SetCellValueCommand`.
        // This is a common pattern for direct range manipulation:
        const range = sheet.getRange(row, col);
        range.setValue(value); // This is a common way to set value on a range object

        console.log(`Univer: Successfully set cell ${address} to "${value}"`);
        return true;
    } catch (error) {
        console.error(`Error setting Univer cell value for ${address}:`, error);
        return false;
    }
};

// --- END: Global Functions for External Communication ---


// --- START: Registering Custom Formula Functions ---

/**
 * 1. Register the custom AI formula function with Univer's formula engine.
 * When `=AI(prompt, targetCell)` is entered in a cell, Univer will call this function.
 * This function then delegates the prompt and target cell to the `window.triggerAICellFill`
 * function, which is managed by your React chat application.
 */
univer.registerFunction({
    name: 'AI', // This is the function name accessible in the spreadsheet: =AI()
    func: async (prompt, targetCellAddress) => {
        // Basic validation for arguments
        if (typeof prompt !== 'string' || typeof targetCellAddress !== 'string') {
            console.error('AI function: Invalid arguments. Expected strings for prompt and targetCellAddress.');
            return '#VALUE!'; // Excel error
        }

        if (window.triggerAICellFill) {
            try {
                // Call the function exposed by the React App and wait for its result
                // The React App is responsible for calling window.setUniverCellValue
                // when the AI response is ready.
                const aiResult = await window.triggerAICellFill(prompt, targetCellAddress);
                console.log(`Univer: AI formula resolved for ${targetCellAddress}.`);
                // The aiResult here is what will be returned to the cell *where =AI() was typed*.
                // The actual filling of the targetCellAddress is handled by setUniverCellValue
                // from the React side.
                return aiResult;
            } catch (error) {
                console.error('Error during AI formula execution:', error);
                return `ERROR: ${error.message || 'AI processing failed.'}`; // Return error to cell
            }
        } else {
            console.error("AI function not available. Is the AI chat application loaded and ready?");
            return '#N/A! - AI Not Ready'; // Return an Excel-like error for "not available"
        }
    },
    // Optional: Add argument definitions for better intellisense in Univer if supported
    // For example:
    // paramTypes: [
    //      { name: 'prompt', type: 'string', description: 'The text prompt for the AI.' },
    //      { name: 'targetCell', type: 'string', description: 'The cell address where the AI result will be written.' },
    // ],
    // description: 'Sends a prompt to the AI model and writes the response to a specified cell.',
});


/**
 * 2. Register a conceptual "Taylor" custom formula function.
 * You would replace the placeholder logic with your actual Taylor series calculation.
 * Example: `=TAYLOR(expression, point, order)`
 */
univer.registerFunction({
    name: 'TAYLOR', // The function name accessible in the spreadsheet: =TAYLOR()
    func: (x, n_terms) => { // Example parameters: x for the point, n_terms for number of terms
        // --- IMPORTANT: Replace this with your actual Taylor series logic ---
        // This is a placeholder example for a simple function like sin(x) around 0
        try {
            const val_x = parseFloat(x);
            const val_n_terms = parseInt(n_terms, 10);

            if (isNaN(val_x) || isNaN(val_n_terms) || val_n_terms < 0) {
                return '#VALUE! - Invalid arguments for TAYLOR';
            }

            let result = 0;
            // Example Taylor series for e^x around x=0: Sum (x^n / n!)
            // This is just a placeholder example, replace with your desired function's series
            for (let i = 0; i < val_n_terms; i++) {
                const term = Math.pow(val_x, i) / factorial(i);
                result += term;
            }
            return result;

        } catch (error) {
            console.error('Error in TAYLOR function:', error);
            return `ERROR: ${error.message || 'Taylor calculation failed.'}`;
        }
    },
    // Optional: Add argument definitions
    // paramTypes: [
    //      { name: 'value', type: 'number', description: 'The value to evaluate the Taylor series at.' },
    //      { name: 'terms', type: 'number', description: 'The number of terms in the Taylor series expansion.' },
    // ],
    // description: 'Calculates the Taylor series expansion of a function.',
});

// Helper function for factorial (needed for the example TAYLOR function)
function factorial(n) {
    if (n === 0 || n === 1) return 1;
    let res = 1;
    for (let i = 2; i <= n; i++) {
        res *= i;
    }
    return res;
}

// --- END: Registering Custom Formula Functions ---

// Expose univer instance globally if needed for debugging or other interactions
window.univer = univer;

// Optional: Render Univer into its designated div (if not handled by another plugin/component)
document.addEventListener('DOMContentLoaded', () => {
    const univerContainer = document.getElementById('univer');
    if (univerContainer) {
        // If you are using a UI plugin (like UniverSheetsUIPlugin or similar),
        // it typically handles the rendering into the container automatically after installation.
        // If not, you might need a specific render method from Univer itself.
        console.log("Univer container found. Univer is initialized.");
    } else {
        console.warn("Univer container (#univer) not found in the DOM.");
    }
});
