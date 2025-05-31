import { createUniver, defaultTheme, LocaleType, merge } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core';
import enUS from '@univerjs/presets/preset-sheets-core/locales/en-US';
import zhCN from '@univerjs/presets/preset-sheets-core/locales/zh-CN';
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useState, useEffect } from "react";

function render(text) {
  return DOMPurify.sanitize(marked.parse(text));
}

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");

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

    messages.forEach((msg, index) => {
      if (msg.role === "assistant") {
        sheet.getCell(index, 0).setValue("Assistant:");
        sheet.getCell(index, 1).setValue(render(msg.content));
      } else {
        sheet.getCell(index, 0).setValue("User:");
        sheet.getCell(index, 1).setValue(msg.content);
      }
    });
  }, [messages]);

  const handleSendMessage = () => {
    setMessages([...messages, { role: "user", content: inputValue }]);
    // Here you can add logic to generate assistant response
    // For example:
    setMessages(messages => [...messages, { role: "assistant", content: "This is a response" }]);
    setInputValue("");
  };

  return (
    <div>
      <div id="univer" style={{ height: '80vh', width: '100vw' }} />
      <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
      <button onClick={handleSendMessage}>Send</button>
    </div>
  );
}
