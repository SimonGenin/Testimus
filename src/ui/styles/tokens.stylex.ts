import * as stylex from "@stylexjs/stylex";

const DARK = "@media (prefers-color-scheme: dark)";

// ponytail: provisional tokens, just enough to prove the StyleX chain; design/tokens.css replaces them at the design gate
export const colors = stylex.defineVars({
  surface: { default: "#ffffff", [DARK]: "#16181d" },
  text: { default: "#1b1d22", [DARK]: "#e8e9ec" },
  accent: { default: "#2f5bd3", [DARK]: "#7d9cf0" },
  accentText: { default: "#ffffff", [DARK]: "#0d1220" },
  focus: { default: "#2f5bd3", [DARK]: "#a8bdf5" },
});

export const space = stylex.defineVars({
  s1: "4px",
  s2: "8px",
  s3: "12px",
});

export const radius = stylex.defineVars({
  r2: "6px",
});

export const lightTheme = stylex.createTheme(colors, {
  surface: "#ffffff",
  text: "#1b1d22",
  accent: "#2f5bd3",
  accentText: "#ffffff",
  focus: "#2f5bd3",
});

export const darkTheme = stylex.createTheme(colors, {
  surface: "#16181d",
  text: "#e8e9ec",
  accent: "#7d9cf0",
  accentText: "#0d1220",
  focus: "#a8bdf5",
});
