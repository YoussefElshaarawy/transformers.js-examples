http://googleusercontent.com/immersive_entry_chip/0


---

## Step 2: Update `src/App.jsx`

Now, `App.jsx` becomes much simpler. It will import `useWorker` and consume the AI state and functions provided by the `WorkerProvider`.

```jsx

http://googleusercontent.com/immersive_entry_chip/1


---

## Step 3: Update `src/main.jsx`

Finally, we need to wrap your `App` component with the `WorkerProvider` in `main.jsx` so that the context is available to `App` and its children.

```jsx

http://googleusercontent.com/immersive_entry_chip/2


---

**Summary of Changes and Why They Work:**

* **`WorkerContext.jsx`**:
    * **Centralized Worker**: The `Web Worker` is now instantiated and managed *once* within `WorkerProvider`.
    * **Unified State**: All AI-related states (`status`, `isRunning`, `tps`, `numTokens`, `currentAiQueryTargetCell`, `chatMessagesHistory`) are managed here.
    * **`sendAiQueryToWorker`**: This single, unified function handles sending commands to the worker, whether they are for chat or for spreadsheet cells. It correctly updates the internal `chatMessagesHistory` for multi-turn conversations.
    * **`window.triggerAICellFill`**: This global function (for `univer.js` to call) now directly invokes `sendAiQueryToWorker`, ensuring that spreadsheet AI requests go through the same, shared AI pipeline.
    * **Cleanup**: The worker is properly terminated when the `WorkerProvider` unmounts.
* **`App.jsx`**:
    * **Cleaner Logic**: It no longer directly manages the `Worker` or its complex state. It simply `useWorker()` to get the necessary state and functions.
    * **UI Focus**: `App.jsx` is now primarily responsible for rendering the UI based on the AI state provided by the context and dispatching user input.
* **`main.jsx`**:
    * **Provider Setup**: It wraps the `App` component with `WorkerProvider`, making the AI context available throughout your application.

This setup achieves the "Pensieve Context" you envisioned, making your AI integration more robust, scalable, and maintainable!
