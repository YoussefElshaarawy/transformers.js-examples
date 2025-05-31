import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';

// Import all UniverJS dependencies directly into Chat.jsx
import {
  createUniver,
  defaultTheme,
  LocaleType,
  merge,
  UniverInstanceType, // Import UniverInstanceType for type checking
} from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core';
import enUS from '@univerjs/presets/preset-sheets-core/locales/en-US';
import zhCN from '@univerjs/presets/preset-sheets-core/locales/zh-CN';
// Import specific command for listening to cell changes
import { ICommandService, Disposable } from '@univerjs/core'; // Added Disposable
import { SetRangeValuesCommand, SetRangeValuesCommandParams } from '@univerjs/sheets'; // Assuming this is available

// Import Univer's core styles (ensure these paths are correct relative to your project structure)
import '@univerjs/presets/lib/styles/preset-sheets-core.css';
import '../style.css'; // Path from src/components to src/

// Wrap the Chat component with forwardRef
const Chat = forwardRef(({ messages, onSpreadsheetGenerateRequest }, ref) => {
  const univerContainerRef = useRef(null);
  const [spreadsheetOutputAccumulator, setSpreadsheetOutputAccumulator] = useState({});
  const isProgrammaticUpdate = useRef(false); // Flag to prevent infinite loop

  // Expose functions to the parent component (App.jsx) via ref
  useImperativeHandle(ref, () => ({
    // Method to update a spreadsheet cell incrementally with LLM output
    handleSpreadsheetOutputUpdate: (output, workbookId, sheetId, row, col) => {
      const key = `${workbookId}-${sheetId}-${row}-${col}`;
      setSpreadsheetOutputAccumulator(prev => {
        const newOutput = (prev[key] || '') + output;

        if (window.univerAPI) {
          const univer = window.univerAPI.getUniver();
          const workbook = univer.getUniverSheet(workbookId);
          // In UniverJS, worksheetId is often the same as sheetId for simplicity if not multiple workbooks
          const worksheet = workbook?.getWorksheet(sheetId); 

          if (worksheet) {
            isProgrammaticUpdate.current = true; // Set flag to ignore this update from event listener
            worksheet.setCellRawValue(row, col, newOutput);
          }
        }
        return { ...prev, [key]: newOutput };
      });
    },
    // Method to finalize a spreadsheet cell update (e.g., clear accumulator)
    handleSpreadsheetOutputComplete: (workbookId, sheetId, row, col) => {
      const key = `${workbookId}-${sheetId}-${row}-${col}`;
      setSpreadsheetOutputAccumulator(prev => {
        const newAccumulator = { ...prev };
        delete newAccumulator[key]; // Clear the accumulated output for this cell
        return newAccumulator;
      });
    }
  }));

  // Initialize UniverJS and set up event listener
  useEffect(() => {
    // Only initialize Univer once when the ref is available and univerAPI doesn't exist
    if (univerContainerRef.current && !window.univerAPI) {
      const { univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
        theme: defaultTheme,
        // Mounts to the div with the ref's current id
        presets: [UniverSheetsCorePreset({ container: univerContainerRef.current.id })],
      });

      window.univerAPI = univerAPI; // Expose globally

      univerAPI.createUniverSheet({
        name: 'Hello Univer',
        id: 'default-workbook', // Give it a specific ID
        rowCount: 100,
        columnCount: 100,
        // Define default sheet ID if needed, e.g., 'sheet-01'
        sheets: [{ id: 'sheet-01', name: 'Sheet1', cellData: {} }]
      });

      // Register the TAYLORSWIFT() custom formula
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
          }
        }
      );

      // <--- NEW: Set up listener for cell changes
      const commandService = univerAPI.getCommandService();
      const disposable = commandService.onCommandExecuted((command) => {
        // If this update was programmatically triggered by LLM output, ignore it.
        if (isProgrammaticUpdate.current) {
          isProgrammaticUpdate.current = false; // Reset flag for next potential user input
          return;
        }

        // Listen for the command that changes cell values
        if (command.id === SetRangeValuesCommand.NAME) {
          const params = command.params; // as SetRangeValuesCommandParams;
          const { range, value, workbookId, worksheetId } = params;

          // Check if it's a single cell edit and not empty
          if (
            range.startRow === range.endRow &&
            range.startColumn === range.endColumn &&
            value &&
            value[0] &&
            value[0][0] !== undefined
          ) {
            const content = value[0][0];

            // Only send to LLM if content is a non-empty string
            if (typeof content === 'string' && content.trim().length > 0 && onSpreadsheetGenerateRequest) {
              const row = range.startRow;
              const col = range.startColumn;
              onSpreadsheetGenerateRequest(workbookId, worksheetId, row, col, content);
            }
          }
        }
      });

      // Cleanup function to dispose of the event listener
      return () => {
        disposable.dispose();
      };
    }
  }, [onSpreadsheetGenerateRequest]); // Depend on the prop to re-run effect if it changes

  return (
    <div className="flex flex-row w-full h-full">
      {/* Left Panel: Existing Chat Messages */}
      <div className="flex flex-col w-1/2 h-full overflow-y-auto scrollbar-thin p-4">
        {messages.map((message, i) => (
          <div
            key={i}
            className={`
              mb-4 p-3 rounded-lg shadow-md
              ${message.role === "user"
                ? "bg-blue-500 text-white self-end rounded-br-none"
                : "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 self-start rounded-bl-none"}
              max-w-[80%]
            `}
          >
            <div className="markdown" dangerouslySetInnerHTML={{ __html: message.content }}></div>
          </div>
        ))}
      </div>

      {/* Right Panel: UniverJS Spreadsheet */}
      <div className="w-1/2 h-full p-2 flex flex-col">
        <h2 className="text-xl font-bold text-center mb-2 text-gray-800 dark:text-gray-200">
          Univer Spreadsheet
        </h2>
        {/* The div for UniverJS to mount into */}
        <div
          id="univer-chat-instance" // Unique ID for this Univer instance
          ref={univerContainerRef}
          className="flex-grow w-full h-full border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden"
        >
          {/* UniverJS will render its content here */}
        </div>
      </div>
    </div>
  );
});

export default Chat; // Export with forwardRef
