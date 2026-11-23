import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "./lib/api";
import { isMac, isWindows } from "./lib/ui";
import App from "./App";
import "./index.css";

// Browser/mock mode paints its own window background and fake traffic lights;
// inside Tauri on a Mac the sidebar shows native vibrancy through a transparent page.
// On Windows the window is opaque with its normal frame, so the page paints itself
// (`html.tauri.win` in index.css).
const root = document.documentElement;
root.classList.add(isTauri ? "tauri" : "browser");
root.classList.add(isWindows ? "win" : isMac ? "mac" : "other");

// A browser-style context menu (Back, Reload, Inspect…) doesn't belong in a Windows app;
// leave it on text fields, where Cut/Copy/Paste live.
if (isTauri && isWindows) {
  window.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, [contenteditable='true'], .selectable")) return;
    e.preventDefault();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
