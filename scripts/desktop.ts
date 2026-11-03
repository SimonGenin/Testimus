import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { join } from "node:path";
import { rolldown } from "rolldown";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src", "desktop");
const OUT = join(ROOT, "dist", "desktop");
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };

const nodeBuiltin = (id: string) => id.startsWith("node:") || builtinModules.includes(id);
const external = (id: string) => id === "electron" || nodeBuiltin(id);

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
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "pages"), { recursive: true });
  await bundle("main.ts", "main.mjs", "esm", "node");
  await bundle("preload.ts", "preload.cjs", "cjs", "node");
  await bundle(join("pages", "error.ts"), join("pages", "error.js"), "iife", "browser");
  for (const f of ["splash.html", "error.html", "pages.css"])
    copyFileSync(join(SRC, "pages", f), join(OUT, "pages", f));
  copyFileSync(join(ROOT, "src", "ui", "public", "logo.png"), join(OUT, "pages", "logo.png"));
  copyFileSync(join(ROOT, "scripts", "testimus.ico"), join(OUT, "pages", "testimus.ico"));
  return join(OUT, "main.mjs");
}

const argv = process.argv.slice(2);
const main = await buildDesktop();
process.stdout.write(`Built ${main}\n`);
if (!argv.includes("--build-only")) {
  const electron = createRequire(import.meta.url)("electron") as unknown as string;
  const child = spawn(electron, [main, ...argv], { cwd: ROOT, stdio: "inherit", windowsHide: false });
  child.on("exit", (code) => process.exit(code ?? 0));
}
