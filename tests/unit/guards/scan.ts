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
// ponytail: the old kit is gone (wave 5); this keeps it from coming back
const LEGACY = (f: string) => f.startsWith("src/ui/components/legacy/");

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

// ponytail: a face reaches the domain through the registry only — what else it takes from the core is plumbing: the
// command shape, jobs and their events, the env seam, the shell's lifecycle, the project folder it is pointed at, the
// file watch, the mock, and what a one-shot command waits for or stops before it exits (the overview update, model
// servers). A domain module imported here is a capability one face has and the others do not
const FACE_PLUMBING = [
  "command.ts",
  "commands/index.ts",
  "env.ts",
  "jobs.ts",
  "shell.ts",
  "types.ts",
  "watch.ts",
  "lib/project.ts",
  "lib/overview-after.ts",
  "mock/index.ts",
  "rag/runtimes/llamacpp.ts",
];

export function n1eFacesPastTheRegistry(): Violation[] {
  return grep(
    files("src/faces"),
    /\b(?:from|import)\s*\(?\s*"\.\.\/core\/([^"]+)"/,
    (m) => !FACE_PLUMBING.includes(m[1]),
  );
}

export function n1fDesktopImportsCore(): Violation[] {
  return grep(files("src/desktop"), /\b(?:from|import)\s*\(?\s*["'](?:\.\.\/)+core\/[^"']*["']/);
}

export function n2BareControls(): Violation[] {
  const list = files("src/ui", /\.tsx$/).filter((f) => !KIT(f));
  return grep(list, /<(button|input|textarea|select)[\s>/]|contentEditable/);
}

export function n2LegacyKit(): Violation[] {
  return files("src/ui", /\.(ts|tsx)$/)
    .filter(LEGACY)
    .map((file) => ({ file, line: 1, text: "old kit file" }));
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

// ponytail: G8 — a value in tokens.stylex.ts that does not come from design/tokens.css is written by scripts/tokens.ts
// (EXTRA, CONTAINERS, BREAKPOINTS); each is one to ask the design sessions for, so the list may only shrink
function entries(text: string, name: string): { key: string; line: number }[] {
  const start = text.indexOf(`const ${name}`);
  if (start < 0) return [];
  const end = text.indexOf("\n};", start);
  const out: { key: string; line: number }[] = [];
  for (const m of text.slice(start, end).matchAll(/^\s+(\w+):\s*["\d]/gm))
    out.push({ key: m[1], line: lineOf(text, start + (m.index ?? 0)) + 1 });
  return out;
}

export function g8TokensOutsideDesign(): Violation[] {
  const file = "scripts/tokens.ts";
  const text = read(file);
  return ["EXTRA", "CONTAINERS", "BREAKPOINTS"].flatMap((name) =>
    entries(text, name).map((e) => ({ file, line: e.line, text: `${name}.${e.key}` })),
  );
}

// ponytail: G8 — the vocabularies' colour aliases of tokens.css (color-status-*, -severity-*, -diff-*) are read by the
// kit, so changing one in the design changes the screen
export function g8AliasesNeverRead(): Violation[] {
  const tokens = "src/ui/styles/tokens.stylex.ts";
  const text = read(tokens);
  const start = text.indexOf("export const color = stylex.defineVars({");
  const block = text.slice(start, text.indexOf("});", start));
  // ponytail: statusChecked coloured a review state Testimus no longer has; tokens.css still names it until the design
  // drops it
  const aliases = [...block.matchAll(/^\s+((?:status|severity|diff)\w+):/gm)]
    .map((m) => m[1])
    .filter((a) => a !== "statusChecked");
  const ui = UI()
    .filter((f) => f !== tokens)
    .map(read)
    .join("\n");
  return aliases
    .filter((a) => !new RegExp(`\\bcolor\\.${a}\\b`).test(ui))
    .map((a) => ({ file: tokens, line: lineOf(text, text.indexOf(`  ${a}:`)), text: `color.${a} never read` }));
}

// ponytail: G1 — the type of a screen is one of the kit's styles (components/ui/type.ts), so changing the design's type
// changes every screen; no size, weight, line height, letter spacing or face is picked outside the kit
export function g1TypeOutsideKit(): Violation[] {
  return grep(
    UI().filter((f) => !KIT(f) && !f.startsWith("src/ui/styles/")),
    /\b(?:fontSize|fontWeight|lineHeight|letterSpacing|fontFamily)\.\w+/,
  );
}

// ponytail: G2 — a select's open list is the kit's Menu (SYSTEM.md Select), never the browser's own list, anywhere
export function g2BrowserLists(): Violation[] {
  return grep(files("src/ui", /\.tsx$/), /<(?:select|option|datalist)\b/);
}

// ponytail: G2 — a framed box (an edge and rounded corners) drawn by a screen is a Card, a Banner or a kit piece; the
// ones left are counted so the list may only shrink
export function g2FramesOutsideKit(): Violation[] {
  const list = files("src/ui", /\.tsx$/).filter((f) => !KIT(f) && !f.startsWith("src/ui/screens/kit/"));
  return grep(
    list,
    /^ {2}(\w+): \{\n(?:(?! {2}\}).*\n)*? {2}\},?$/m,
    (m) => /borderStyle: "(?:solid|dashed)"/.test(m[0]) && /borderRadius:/.test(m[0]),
  );
}

// ponytail: G3 — every Claude block's « + » is ContextMenu (the saved contexts ticked, the block's text saved as one,
// Manage): a screen builds none by hand, and no second « save as a context » lives beside a block
export function g3ContextMenusByHand(): Violation[] {
  const list = files("src/ui", /\.tsx$/).filter(
    (f) =>
      !f.startsWith("src/ui/screens/kit/") &&
      f !== "src/ui/components/ui/ClaudeBlock.tsx" &&
      f !== "src/ui/components/claude/ContextMenu.tsx",
  );
  return [
    ...grep(list, /addContext=\{(?!\s*<ContextMenu\b)/),
    ...grep(list, /\bonAddContext=/),
    ...grep(list, /<SaveContext\b/),
  ];
}

export const GUARDS = {
  "N1a unknown or dynamic command names in src/ui": n1aUnknownCommands,
  "N1b value imports from src/core or src/shared/run in src/ui": n1bValueImportsFromCore,
  "N1c fetch, EventSource or browser storage outside lib/data and lib/prefs": n1cBrowserIoOutsideDataLayer,
  "N1d routes served by faces/http.ts outside the known list": n1dUnknownRoutes,
  "N1e src/core modules a face imports beyond the registry and its plumbing": n1eFacesPastTheRegistry,
  "N1f src/desktop importing src/core": n1fDesktopImportsCore,
  "N2 bare button, input, textarea, select or contentEditable outside components/ui": n2BareControls,
  "N2 old kit files left in components/legacy": n2LegacyKit,
  "N4a literal colours or px sizes outside tokens.stylex.ts": n4LiteralValues,
  "N4c CSS files (other than fonts) and raw HTML in src/ui": n4CssFilesAndRawHtml,
  "N4d inline styles with only constant values": n4StaticInlineStyles,
  "N7 child_process, process.kill or taskkill outside src/shared/run/process.ts": n7ProcessOutsideRunLayer,
  "N7 setTimeout or setInterval in src/core": n7WaitsOutsideWork,
  "G8 token values written by scripts/tokens.ts, not read from design/tokens.css": g8TokensOutsideDesign,
  "G8 vocabulary colour aliases of tokens.css never read in src/ui": g8AliasesNeverRead,
  "G1 font size, weight, line height, letter spacing or face picked outside the kit": g1TypeOutsideKit,
  "G2 the browser's own select, option or datalist list in src/ui": g2BrowserLists,
  "G2 framed boxes (edge and rounded corners) drawn outside the kit": g2FramesOutsideKit,
  "G3 a Claude block's context menu built by hand instead of ContextMenu": g3ContextMenusByHand,
} as const;

export type GuardName = keyof typeof GUARDS;

export function show(v: Violation[]): string {
  return v.map((x) => `${relative(".", x.file)}:${x.line} ${x.text}`).join("\n");
}
