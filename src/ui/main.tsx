import * as stylex from "@stylexjs/stylex";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { DataProvider } from "./lib/data/provider.tsx";
import { followTheme } from "./lib/theme.ts";
import "./styles/fonts.css";

const page = stylex.create({
  body: { margin: 0, height: "100%", WebkitFontSmoothing: "antialiased" },
  root: { height: "100%" },
});

followTheme();

const root = document.getElementById("root")!;
document.body.className = stylex.props(page.body).className ?? "";
root.className = stylex.props(page.root).className ?? "";

createRoot(root).render(
  <StrictMode>
    <DataProvider>
      <App />
    </DataProvider>
  </StrictMode>,
);
