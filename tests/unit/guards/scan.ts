import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..", "..");

export type Violation = { file: string; line: number; text: string };

function walk(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(rel, exts));
    else if (exts.test(e.name)) out.push(rel);
  }
  return out;
}

export function files(dir: string, exts = /\.(ts|tsx)$/): string[] {
  return walk(dir, exts).sort();
}

export function read(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

export function grep(
  list: string[],
  pattern: RegExp,
  keep: (m: RegExpExecArray, text: string) => boolean = () => true,
) {
  const found: Violation[] = [];
  for (const file of list) {
    const text = read(file);
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (let m = re.exec(text); m; m = re.exec(text))
      if (keep(m, text)) found.push({ file, line: lineOf(text, m.index), text: m[0].slice(0, 80) });
  }
  return found;
}

const UI = () => files("src/ui");
const DATA_LAYER = (f: string) => f.startsWith("src/ui/lib/data/") || f === "src/ui/lib/prefs.ts";
const KIT = (f: string) => f.startsWith("src/ui/components/ui/");

export async function n1aUnknownCommands(): Promise<Violation[]> {
  const { registry } = await import("../../../src/core/commands/index.ts");
  const names = new Set<string>(registry.map((c) => c.name));
  return grep(UI(), /\bcall(?:<[^>]*>)?\(\s*(["'`])([^"'`]*)\1/, (m) => !names.has(m[2]) || m[1] === "`");
}

export function n1bValueImportsFromCore(): Violation[] {
  return grep(UI(), /import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]*\/(?:core|shared\/run)\/[^"]*)"/, (m) => {
    if (m[1]) return false;
    return m[2]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .some((s) => !s.startsWith("type "));
  }).concat(grep(UI(), /import\s+(?!type\b)[\w*\s]+from\s+"[^"]*\/(?:core|shared\/run)\/[^"]*"/));
}

export function n1cBrowserIoOutsideDataLayer(): Violation[] {
  const list = UI().filter((f) => !DATA_LAYER(f));
  return grep(list, /\bfetch\(|\bnew EventSource\b|\blocalStorage\b|\bsessionStorage\b/);
}

export const KNOWN_ROUTES = ["/", "/api", "/api/", "/api/events", "/api/system/version", "/files/", "/assets/"];

export function n1dUnknownRoutes(): Violation[] {
  return grep(
    ["src/faces/http.ts"],
    /pathname(?:\s*===\s*|\.startsWith\()\s*"([^"]*)"/,
    (m) => !KNOWN_ROUTES.includes(m[1]),
  );
}

export function n2BareControls(): Violation[] {
  const list = files("src/ui", /\.tsx$/).filter((f) => !KIT(f));
  return grep(list, /<(button|input|textarea|select)[\s>/]|contentEditable/);
}

export function n4LiteralValues(): Violation[] {
  const list = files("src/ui", /\.(ts|tsx|css)$/).filter((f) => f !== "src/ui/styles/tokens.stylex.ts");
  return grep(
    list,
    /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|(?<![\w.])(?:\d*\.)?\d+px\b/,
    (m) => !/^(?:0|1)px$/.test(m[0]),
  );
}

export function n4CssFilesAndRawHtml(): Violation[] {
  const css = files("src/ui", /\.css$/)
    .filter((f) => !/^(\s*@font-face\s*\{[^}]*\}\s*|\s*@import\s+"@fontsource[^"]*";\s*)*$/.test(read(f)))
    .map((file) => ({ file, line: 1, text: "CSS file" }));
  return css.concat(grep(UI(), /dangerouslySetInnerHTML/));
}

function literalOnly(body: string): boolean {
  const values = body
    .split(/,(?![^(]*\))/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.replace(/^["']?[\w-]+["']?\s*:\s*/, ""));
  return values.every((v) => /^(?:-?\d+(?:\.\d+)?|"[^"]*"|'[^']*')$/.test(v));
}

export function n4StaticInlineStyles(): Violation[] {
  return grep(files("src/ui", /\.tsx$/), /style=\{\{([^{}]*)\}\}/, (m) => literalOnly(m[1]));
}

export function n7ProcessOutsideRunLayer(): Violation[] {
  const list = files("src").filter((f) => f !== "src/shared/run/process.ts");
  return grep(list, /node:child_process|process\.kill\(|taskkill/);
}

export function n7WaitsOutsideWork(): Violation[] {
  return grep(files("src/core"), /\bset(?:Timeout|Interval)\(/);
}

export const GUARDS = {
  "N1a unknown or dynamic command names in src/ui": n1aUnknownCommands,
  "N1b value imports from src/core or src/shared/run in src/ui": n1bValueImportsFromCore,
  "N1c fetch, EventSource or browser storage outside lib/data and lib/prefs": n1cBrowserIoOutsideDataLayer,
  "N1d routes served by faces/http.ts outside the known list": n1dUnknownRoutes,
  "N2 bare button, input, textarea, select or contentEditable outside components/ui": n2BareControls,
  "N4a literal colours or px sizes outside tokens.stylex.ts": n4LiteralValues,
  "N4c CSS files (other than fonts) and raw HTML in src/ui": n4CssFilesAndRawHtml,
  "N4d inline styles with only constant values": n4StaticInlineStyles,
  "N7 child_process, process.kill or taskkill outside src/shared/run/process.ts": n7ProcessOutsideRunLayer,
  "N7 setTimeout or setInterval in src/core": n7WaitsOutsideWork,
} as const;

export type GuardName = keyof typeof GUARDS;

export function show(v: Violation[]): string {
  return v.map((x) => `${relative(".", x.file)}:${x.line} ${x.text}`).join("\n");
}
