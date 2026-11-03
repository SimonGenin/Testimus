import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { readTheme, themeClass } from "./lib/theme.ts";
import "./styles/index.css";

document.documentElement.className = themeClass(readTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
