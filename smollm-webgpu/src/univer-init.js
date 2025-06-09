// univer-init.js - NO CHANGES NEEDED
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

export let smollmCellAddress = null;
export function setSmollmCellAddress(address) {
  smollmCellAddress = address;
}

export let ttsMessenger = null;
export function setTTSMessenger(messenger) {
  ttsMessenger = messenger;
}

export let mcpMessenger = null;
export function setMCPMessenger(messenger) {
  mcpMessenger = messenger;
}

const { univerAPI } = createUniver({
  locale: LocaleType.EN_US,
  locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
  theme: defaultTheme,
  presets: [UniverSheetsCorePreset({ container: 'univer' })],
});

globalUniverAPI = univerAPI;

univerAPI.createUniverSheet({
  name: 'Hello Univer',
  rowCount: 100,
  columnCount: 100,
});

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
      : LY2ICS[Math.floor(Math.random() * LYRICS.length)];
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

univerAPI.getFormula().registerFunction(
  'SMOLLM',
  function (prompt = '', secondArg) {
    const ctx = this.getContext ? this.getContext() : this;
    const row = ctx.row;
    const col = ctx.column;
    const here = colToLetters(col + 1) + (row + 1);

    setSmollmCellAddress(here);

    let additionalContext = '';
    let finalPrompt = prompt;

    if (secondArg && Array.isArray(secondArg) && secondArg.every(row => Array.isArray(row))) {
      try {
        const contextValues = [];
        secondArg.forEach(rowArray => {
          rowArray.forEach(cellValue => {
            if (cellValue !== undefined && cellValue !== null && String(cellValue).trim() !== '') {
              contextValues.push(String(cellValue).trim());
            }
          });
        });

        if (contextValues.length > 0) {
          additionalContext = contextValues.join(' ');
          finalPrompt = `Context: ${additionalContext}\n\nTask: ${prompt}`;
          console.log('Processed context from range:', additionalContext);
        }
      } catch (e) {
        console.error("Error processing context range:", e);
        finalPrompt = `Error reading context range. Original prompt: ${prompt}`;
      }
    }

    if (!workerMessenger) {
      console.error('AI worker messenger is not set!');
      return 'ERROR: AI not ready';
    }
    workerMessenger({
      type: 'generate',
      data: [{ role: 'user', content: finalPrompt }],
    });

    return `Generating from ${here}…`;
  },
  {
    description: 'customFunction.SMOLLM.description',
    locales: {
      enUS: {
        customFunction: {
          SMOLLM: {
            description:
              'Sends a prompt to SmolLM and generates the response in the same cell. Can take an optional range of cells for an added context.',
          },
        },
      },
    },
  }
);

univerAPI.getFormula().registerFunction(
  'TTS',
  function (prompt = '', secondArg) {
    const ctx = this.getContext ? this.getContext() : this;
    const row = ctx.row;
    const col = ctx.column;
    const here = colToLetters(col + 1) + (row + 1);

    let additionalContext = '';
    let finalPrompt = prompt;

    if (secondArg && Array.isArray(secondArg) && secondArg.every(row => Array.isArray(row))) {
      try {
        const contextValues = [];
        secondArg.forEach(rowArray => {
          rowArray.forEach(cellValue => {
            if (cellValue !== undefined && cellValue !== null && String(cellValue).trim() !== '') {
              contextValues.push(String(cellValue).trim());
            }
          });
        });

        if (contextValues.length > 0) {
          additionalContext = contextValues.join(' ');
          finalPrompt = `Context: ${additionalContext}\n\nTask: ${prompt}`;
          console.log('Processed TTS context from range:', additionalContext);
        }
      } catch (e) {
        console.error("Error processing TTS context range:", e);
        finalPrompt = `Error reading TTS context range. Original prompt: ${prompt}`;
      }
    }

    if (!ttsMessenger) {
      console.error('TTS messenger is not set!');
      return 'ERROR: TTS not ready';
    }
    // Pass the tool name directly as the MCP server expects it in the URL path
    ttsMessenger({
      tool: "YoussefSharawy91_kokoro_mcp_text_to_audio",
      prompt: finalPrompt,
      cellAddress: here
    });

    return `Generating Audio from ${here}…`;
  },
  {
    description: 'customFunction.TTS.description',
    locales: {
      enUS: {
        customFunction: {
          TTS: {
            description:
              'Converts text to audio using an external service and provides an audio player. Can take an optional range of cells for an added context.',
          },
        },
      },
    },
  }
);

univerAPI.getFormula().registerFunction(
  'MCP',
  function (toolName = '', prompt = '', thirdArg) {
    const ctx = this.getContext ? this.getContext() : this;
    const row = ctx.row;
    const col = ctx.column;
    const here = colToLetters(col + 1) + (row + 1);

    let additionalContext = '';
    let finalPrompt = prompt;

    // Process additional context from third argument if it's a range
    if (thirdArg && Array.isArray(thirdArg) && thirdArg.every(row => Array.isArray(row))) {
      try {
        const contextValues = [];
        thirdArg.forEach(rowArray => {
          rowArray.forEach(cellValue => {
            if (cellValue !== undefined && cellValue !== null && String(cellValue).trim() !== '') {
              contextValues.push(String(cellValue).trim());
            }
          });
        });

        if (contextValues.length > 0) {
          additionalContext = contextValues.join(' ');
          finalPrompt = `Context: ${additionalContext}\n\nTask: ${prompt}`;
          console.log('Processed MCP context from range:', additionalContext);
        }
      } catch (e) {
        console.error("Error processing MCP context range:", e);
        finalPrompt = `Error reading MCP context range. Original prompt: ${prompt}`;
      }
    }

    if (!mcpMessenger) {
      console.error('MCP messenger is not set!');
      return 'ERROR: MCP not ready';
    }
    mcpMessenger({
      tool: toolName, // Pass the tool name as is
      prompt: finalPrompt,
      cellAddress: here
    });

    return `Calling MCP ${toolName.split('_').pop()} from ${here}…`;
  },
  {
    description: 'customFunction.MCP.description',
    locales: {
      enUS: {
        customFunction: {
          MCP: {
            description:
              'Calls a specified MCP tool with a prompt and an optional range of cells for context. Output will be displayed in the UI (e.g., audio player) or cell.',
          },
        },
      },
    },
  }
);

function colToLetters(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
