// src/components/Chat.jsx
import React, { useEffect, useRef } from 'react';

// Assuming your global Univer API setup is in index.js or similar
// and it exposes window.univerAPI

const MESSAGE_COLUMN_USER = 1; // Column B for user messages
const MESSAGE_COLUMN_ASSISTANT = 2; // Column C for assistant messages
const START_ROW = 1; // Start writing messages from row 1 (0-indexed)

function Chat({ messages }) {
  const containerRef = useRef(null);
  const rowCounter = useRef(START_ROW); // Keep track of the current row for writing

  useEffect(() => {
    // This effect runs only once when the component mounts to
    // ensure the Univer container is available.
    // The actual Univer instance is initialized in index.js,
    // we just need to ensure this div is present.
  }, []);


  useEffect(() => {
    if (!window.univerAPI) {
      console.error('Univer API not available. Make sure it is initialized and exposed globally.');
      return;
    }

    const univerAPI = window.univerAPI;
    const activeWorkbook = univerAPI.getActiveWorkbook();
    if (!activeWorkbook) {
        console.warn('No active workbook found in Univer. Skipping message write.');
        return;
    }
    const activeSheet = activeWorkbook.getActiveSheet();
    if (!activeSheet) {
        console.warn('No active sheet found in Univer. Skipping message write.');
        return;
    }

    // Only process new messages
    // This logic assumes `messages` grows monotonically
    // and we only need to write the very last message.
    if (messages.length === 0) {
        // Optionally clear the sheet or add a "Welcome" message if messages are reset
        // For simplicity, we'll just return here.
        return;
    }

    const lastMessage = messages[messages.length - 1];

    // Check if the last message has already been written
    // This is a simple debounce to prevent re-writing messages on every render
    // You might need a more robust solution for complex message flows
    const currentCellValue = activeSheet.getCellByColumnAndRow(
      lastMessage.role === "user" ? MESSAGE_COLUMN_USER : MESSAGE_COLUMN_ASSISTANT,
      rowCounter.current - 1 // Check the cell where the last message *would* have been written
    )?.getDisplayText();

    if (currentCellValue === lastMessage.content) {
        return; // Already written
    }

    let column;
    if (lastMessage.role === 'user') {
      column = MESSAGE_COLUMN_USER;
    } else { // role === 'assistant'
      column = MESSAGE_COLUMN_ASSISTANT;
    }

    // Write the message to the current row
    // We're writing to `rowCounter.current` and then incrementing for the next message
    activeSheet.setCellValue(rowCounter.current, column, lastMessage.content);
    rowCounter.current++; // Increment for the next message

    // Optional: Auto-scroll to the new message. This is tricky with Univer's internal scroll.
    // You might need to find a way to access Univer's internal view/scroll methods.
    // For now, we'll rely on the user to scroll.
    // A potential strategy would be to activate the cell you just wrote to.
    activeSheet.activateCell(rowCounter.current - 1, column);

  }, [messages]); // Reruns when messages change

  return (
    // This div will be the container for the Univer Spreadsheet.
    // Ensure its ID matches what you pass to UniverSheetsCorePreset.
    <div id="univer" className="w-full h-full univer-chat-container" ref={containerRef}>
      {/* Univer will inject its canvas/DOM elements here */}
    </div>
  );
}

export default Chat;
