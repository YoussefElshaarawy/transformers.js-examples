import { createUniver, defaultTheme, LocaleType, merge } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core';
import enUS from '@univerjs/presets/preset-sheets-core/locales/en-US';
import zhCN from '@univerjs/presets/preset-sheets-core/locales/zh-CN';
import { marked } from "marked";
import DOMPurify from "dompurify";

function render(text) {
  return DOMPurify.sanitize(marked.parse(text));
}

export default function Chat() {
  useEffect(() => {
    const { univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: { enUS: merge({}, enUS), zhCN: merge({}, zhCN) },
      theme: defaultTheme,
      presets: [UniverSheetsCorePreset({ container: 'univer' })],
    });

    univerAPI.createUniverSheet({
      name: 'Chat',
      rowCount: 100,
      columnCount: 2,
    });

    const sheet = univerAPI.getActiveSheet();
    const messages = [...]; // Your messages array

    messages.forEach((msg, index) => {
      if (msg.role === "assistant") {
        sheet.getCell(index, 0).setValue("Assistant:");
        sheet.getCell(index, 1).setValue(render(msg.content));
      } else {
        sheet.getCell(index, 0).setValue("User:");
        sheet.getCell(index, 1).setValue(msg.content);
      }
    });
  }, []);

  return (
    <div id="univer" style={{ height: '100vh', width: '100vw' }} />
  );
}
