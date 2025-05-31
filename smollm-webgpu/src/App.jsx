import { createUniver, defaultTheme, LocaleType, merge } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core';

// ...

useEffect(() => {
  const univer = createUniver({
    locale: LocaleType.EN_US,
    locales: { enUS: merge({}, {}) },
    theme: defaultTheme,
    presets: [UniverSheetsCorePreset({ container: 'univer' })],
  });
  univerAPI.current = univer.univerAPI;
  univerAPI.current.createUniverSheet({
    name: 'Chat',
    rowCount: 100,
    columnCount: 2,
  });
}, []);

// Render the chat interface inside #chat-root
return (
  <div className="flex h-screen">
    <div id="chat-root" className="w-1/4 h-full overflow-auto">
      {/* Render the chat interface here */}
      {status === null && messages.length === 0 && (
        // ...
      )}
      {status === "loading" && (
        // ...
      )}
      {status === "ready" && (
        // ...
      )}
    </div>
    <div id="univer" className="w-3/4 h-full overflow-auto bg-white dark:bg-gray-900" />
  </div>
);
