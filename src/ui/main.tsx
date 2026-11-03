import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { DataProvider } from "./lib/data/provider.tsx";
import { readTheme, themeClass } from "./lib/theme.ts";
import "./styles/fonts.css";
import "./styles/index.css";

document.documentElement.className = themeClass(readTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DataProvider>
      <App />
    </DataProvider>
  </StrictMode>,
);
