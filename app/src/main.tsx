import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "./lib/api";
import App from "./App";
import "./index.css";

// Browser/mock mode paints its own window background and fake traffic lights;
// inside Tauri the sidebar shows native macOS vibrancy through a transparent page.
document.documentElement.classList.add(isTauri ? "tauri" : "browser");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
