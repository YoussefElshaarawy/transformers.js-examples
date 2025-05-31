import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

import {
  createUniver,
  defaultTheme,
  LocaleType,
  merge,
} from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/presets/preset-sheets-core";
import enUS from "@univerjs/presets/preset-sheets-core/locales/en-US";
import "@univerjs/presets/lib/styles/preset-sheets-core.css";

import BotIcon from "./icons/BotIcon";
import UserIcon from "./icons/UserIcon";
import "./Chat.css";

function render(text) {
  return DOMPurify.sanitize(marked.parse(text));
}

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const containerRef = useRef(null);
  const univerRef = useRef(null);

  useEffect(() => {
    const { univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: { enUS: merge({}, enUS) },
      theme: defaultTheme,
      presets: [UniverSheetsCorePreset({ container: containerRef.current })],
    });

    univerRef.current = univerAPI;

    univerAPI.createUniverSheet({
      name: "Sheet",
      rowCount: 100,
      columnCount: 100,
    });

    const workbook = univerAPI.getCurrentUniverSheetInstance().getWorkBook();
    const sheet = workbook.getActiveSheet();

    workbook.on("onKeyDown", (e) => {
      if (e.key === "Enter") {
        const { row, column } = sheet.getSelection().cellInputPosition;
        const value = sheet.getCellValue(row, column);
        if (value) {
          const userMessage = { role: "user", content: String(value) };
          const assistantMessage = {
            role: "assistant",
            content: "Thinking...",
          };
          setMessages((prev) => [...prev, userMessage, assistantMessage]);

          // Simulate model call
          setTimeout(() => {
            assistantMessage.content = `🧠 You entered: "${value}"`;
            setMessages((prev) => [...prev.slice(0, -1), assistantMessage]);
          }, 800);
        }
      }
    });
  }, []);

  const empty = messages.length === 0;

  return (
    <div className="flex h-screen w-full">
      {/* LEFT: Chat */}
      <div className="w-1/2 p-6 overflow-y-auto">
        <div
          className={`max-w-[960px] w-full ${
            empty ? "flex flex-col items-center justify-end h-full" : "space-y-4"
          }`}
        >
          {empty ? (
            <div className="text-xl">Ready!</div>
          ) : (
            messages.map((msg, i) => (
              <div key={`message-${i}`} className="flex items-start space-x-4">
                {msg.role === "assistant" ? (
                  <>
                    <BotIcon className="h-6 w-6 my-3 text-gray-500 dark:text-gray-300" />
                    <div className="bg-gray-200 dark:bg-gray-700 rounded-lg p-4">
                      <p className="text-gray-800 dark:text-gray-200">
                        {msg.content.length > 0 ? (
                          <span
                            className="markdown"
                            dangerouslySetInnerHTML={{
                              __html: render(msg.content),
                            }}
                          />
                        ) : (
                          <span className="flex gap-1">
                            <span className="w-2.5 h-2.5 bg-gray-600 dark:bg-gray-300 rounded-full animate-pulse"></span>
                            <span className="w-2.5 h-2.5 bg-gray-600 dark:bg-gray-300 rounded-full animate-pulse animation-delay-200"></span>
                            <span className="w-2.5 h-2.5 bg-gray-600 dark:bg-gray-300 rounded-full animate-pulse animation-delay-400"></span>
                          </span>
                        )}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <UserIcon className="h-6 w-6 my-3 text-gray-500 dark:text-gray-300" />
                    <div className="bg-blue-500 text-white rounded-lg p-4">
                      <p>{msg.content}</p>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* RIGHT: Spreadsheet */}
      <div className="w-1/2 border-l border-gray-300">
        <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      </div>
    </div>
  );
}
