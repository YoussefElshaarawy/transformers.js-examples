import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css'; // Assuming you have some global styles here
import {
  createUniver,
  defaultTheme,
  LocaleType,
  merge,
} from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core';
import enUS from '@univerjs/presets/preset-sheets-core/locales/en-US';
import zhCN from '@univerjs/presets/preset-sheets-core/locales/zh-CN';
import '@univerjs/presets/lib/styles/preset-sheets-core.css'; // Univer styles

// Import the App component as it was originally
// No changes needed within the App component itself, only how it's rendered and integrated

const univerAPI = {}; // Declare univerAPI globally or pass it via context/props if needed

const root = ReactDOM.createRoot(document.getElementById('root'));

// Mount the React app to the chat-root div
ReactDOM.createRoot(document.getElementById('chat-root')).render(
  <React.StrictMode>
    <App univerAPI={univerAPI} /> {/* Pass univerAPI to App */}
  </React.StrictMode>
);

// Univer setup, now inside main.jsx to interact with the React App
const { univerAPI: univerAPIInstance } = createUniver({
  locale: LocaleType.EN_US,
  locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
  theme: defaultTheme,
  presets: [UniverSheetsCorePreset({ container: 'univer' })],
});

// Assign the instance to the globally accessible object
Object.assign(univerAPI, univerAPIInstance);

/* ------------------------------------------------------------------ */
/* 2. Create a visible 100 × 100 sheet (cast → any silences TS) */
/* ------------------------------------------------------------------ */
(univerAPIInstance as any).createUniverSheet({
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

(univerAPIInstance.getFormula() as any).registerFunction(
  'TAYLORSWIFT',
  (...args: any[]) => {
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
