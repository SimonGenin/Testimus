import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagesTokens } from "../../../scripts/desktop.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const source = readFileSync(join(ROOT, "src", "ui", "styles", "tokens.stylex.ts"), "utf8");
const css = pagesTokens(source);
const pagesCss = readFileSync(join(ROOT, "src", "desktop", "pages", "pages.css"), "utf8");

const block = (text: string) => {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) out.set(m[1], m[2].trim());
  return out;
};
const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");
const light = block(css.slice(0, darkAt));
const dark = block(css.slice(darkAt));

describe("the desktop pages' tokens", () => {
  it("are tokens.stylex.ts, under the names of design/tokens.css, light and dark", () => {
    expect(light.get("--color-canvas")).toBe("#f7f7f8");
    expect(dark.get("--color-canvas")).toBe("#0e0e10");
    expect(light.get("--color-accent")).toBe("#3e63dd");
    expect(dark.get("--color-accent")).toBe("#8da4ff");
    expect(light.get("--color-scheme")).toBe("light");
    expect(dark.get("--color-scheme")).toBe("dark");
    expect(light.get("--space-7")).toBe("32px");
    expect(light.get("--shadow-2")).toContain("0 12px 32px");
    expect(light.get("--size-control-lg")).toBe("40px");
    expect(light.get("--size-row-2")).toBe("56px");
    expect(light.get("--font-family-mono")).toContain("JetBrains Mono Variable");
    expect(light.get("--line-height-title-lg")).toBe("30px");
    expect(light.get("--letter-spacing-display")).toBe("-0.022em");
    expect(dark.has("--space-7")).toBe(false);
  });

  it("hold every variable of tokens.stylex.ts, once", () => {
    const keys = [...source.matchAll(/export const (\w+) = stylex\.defineVars\(\{([\s\S]*?)\n\}\);/g)].flatMap((m) =>
      [...m[2].matchAll(/^ {2}(\w+):/gm)].map((k) => `${m[1]}.${k[1]}`),
    );
    expect(keys.length).toBeGreaterThan(200);
    expect(light.size).toBe(keys.length);
    expect(css.match(/^ {2}--/gm)?.length).toBe(keys.length);
  });

  it("define every variable pages.css reads", () => {
    const used = new Set([...pagesCss.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(20);
    for (const name of used) expect(light.has(name), name).toBe(true);
  });

  it("pages.css holds no colour of its own", () => {
    expect(pagesCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
