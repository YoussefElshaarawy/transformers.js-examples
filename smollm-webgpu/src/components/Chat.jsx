import React, { useEffect, useRef } from 'react';

// Import all UniverJS dependencies directly into Chat.jsx
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
import '../style.css'; // Adjust path if style.css is not in the root

function Chat({ messages }) {
  // Use a ref for the UniverJS container
  const univerContainerRef = useRef(null);

  // Initialize UniverJS once the component mounts
  useEffect(() => {
    if (univerContainerRef.current) {
      /* ------------------------------------------------------------------ */
      /* 1. Boot‑strap Univer and mount inside <div id="univer">          */
      /* ------------------------------------------------------------------ */
      const { univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
        theme: defaultTheme,
        // Mounts to the div with the ref's current id
        presets: [UniverSheetsCorePreset({ container: univerContainerRef.current.id })],
      });

      // IMPORTANT: Expose univerAPI globally so other parts can interact with it
      window.univerAPI = univerAPI;

      /* ------------------------------------------------------------------ */
      /* 2. Create a visible 100 × 100 sheet                               */
      /* ------------------------------------------------------------------ */
      univerAPI.createUniverSheet({
        name: 'Hello Univer',
        rowCount: 100,
        columnCount: 100,
      });

      /* ------------------------------------------------------------------ */
      /* 3. Register the TAYLORSWIFT() custom formula                      */
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
          }
        }
      );
    }
  }, []); // Run only once on mount

  return (
    // The main container of Chat.jsx now uses flex-row to arrange its children
    // The chat messages are on the left, and the spreadsheet is on the right.
    <div className="flex flex-row w-full h-full">
      {/* Left Panel: Existing Chat Messages */}
      {/* We are encapsulating the existing message rendering logic */}
      <div className="flex flex-col w-1/2 h-full overflow-y-auto scrollbar-thin p-4">
        {/* Your sacred markdown styling is still active via the global @scope (.markdown) */}
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
}

export default Chat;
