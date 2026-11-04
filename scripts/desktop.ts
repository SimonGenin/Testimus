import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { join } from "node:path";
import { rolldown } from "rolldown";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src", "desktop");
const OUT = join(ROOT, "dist", "desktop");
const TOKENS = join(ROOT, "src", "ui", "styles", "tokens.stylex.ts");
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };

// ponytail: the woff2 the pages draw with (Latin only: the pages' text is English, the log lines ASCII)
const FONTS: [pkg: string, file: string][] = [
  ["inter", "inter-latin-opsz-normal.woff2"],
  ["inter", "inter-latin-ext-opsz-normal.woff2"],
  ["jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2"],
  ["jetbrains-mono", "jetbrains-mono-latin-ext-wght-normal.woff2"],
];

const nodeBuiltin = (id: string) => id.startsWith("node:") || builtinModules.includes(id);
const external = (id: string) => id === "electron" || nodeBuiltin(id);

const kebab = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();

const varName = (family: string, key: string) =>
  `--${kebab(family)}-${/^[a-z][0-9]+$/.test(key) && key[0] === family[0] ? key.slice(1) : kebab(key)}`;

type Value = string | { default: string; dark?: string };

// ponytail: the pages are plain HTML under a CSP (no StyleX): they read the same tokens as CSS variables, written from
// tokens.stylex.ts at each build so the two never drift — `--<family>-<key>`, the names of design/tokens.css
export function pagesTokens(source: string): string {
  const light: string[] = [];
  const dark: string[] = [];
  for (const m of source.matchAll(/export const (\w+) = stylex\.defineVars\((\{[\s\S]*?\n\})\);/g)) {
    const vars = new Function("DARK", `return ${m[2]};`)("dark") as Record<string, Value>;
    for (const [key, v] of Object.entries(vars)) {
      const name = varName(m[1], key);
      light.push(`  ${name}: ${typeof v === "string" ? v : v.default};`);
      if (typeof v !== "string" && v.dark !== undefined) dark.push(`    ${name}: ${v.dark};`);
    }
  }
  if (!light.length) throw new Error("no stylex.defineVars in tokens.stylex.ts");
  return [
    "/* Written by scripts/desktop.ts from src/ui/styles/tokens.stylex.ts — do not edit. */",
    ":root {",
    ...light,
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    ...dark,
    "  }",
    "}",
    "",
  ].join("\n");
}

async function bundle(input: string, file: string, format: "esm" | "cjs" | "iife", platform: "node" | "browser") {
  const b = await rolldown({
    input: join(SRC, input),
    platform,
    external: platform === "node" ? external : undefined,
    transform: { define: { __VERSION__: JSON.stringify(version) } },
  });
  await b.write({ file: join(OUT, file), format, codeSplitting: false, minify: false });
  await b.close();
}

export async function buildDesktop(): Promise<string> {
  const pages = join(OUT, "pages");
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(pages, "fonts"), { recursive: true });
  await bundle("main.ts", "main.mjs", "esm", "node");
  await bundle("preload.ts", "preload.cjs", "cjs", "node");
  await bundle(join("pages", "error.ts"), join("pages", "error.js"), "iife", "browser");
  for (const f of ["error.html", "pages.css"]) copyFileSync(join(SRC, "pages", f), join(pages, f));
  writeFileSync(
    join(pages, "splash.html"),
    readFileSync(join(SRC, "pages", "splash.html"), "utf8").replaceAll("__VERSION__", version),
  );
  writeFileSync(join(pages, "tokens.css"), pagesTokens(readFileSync(TOKENS, "utf8")));
  for (const [pkg, file] of FONTS)
    copyFileSync(join(ROOT, "node_modules", "@fontsource-variable", pkg, "files", file), join(pages, "fonts", file));
  copyFileSync(join(ROOT, "src", "ui", "public", "logo.png"), join(pages, "logo.png"));
  copyFileSync(join(ROOT, "scripts", "testimus.ico"), join(pages, "testimus.ico"));
  return join(OUT, "main.mjs");
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const main = await buildDesktop();
  process.stdout.write(`Built ${main}\n`);
  if (!argv.includes("--build-only")) {
    const electron = createRequire(import.meta.url)("electron") as unknown as string;
    const child = spawn(electron, [main, ...argv], { cwd: ROOT, stdio: "inherit", windowsHide: false });
    child.on("exit", (code) => process.exit(code ?? 0));
  }
}
