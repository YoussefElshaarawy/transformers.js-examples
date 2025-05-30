import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import "./univer.js"; 

const chatRoot = document.getElementById("chat-root");
if (!chatRoot) {
  throw new Error("Could not find #chat-root in index.html");
}

ReactDOM.createRoot(chatRoot).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
