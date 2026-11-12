import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { copyFileAtomic, writeAtomic } from "./atomic.ts";
import { osUser } from "./review.ts";
import { type RunResult, readResult, readRunFile, resultFile, runDir } from "./runs.ts";

// ponytail: a run exported as pages — a folder anyone opens in a browser, on any PC (index.html and its script, the
// run and its results, the tests' pictures, a small Node server and its starters), then read back into the project
// (run-import.ts)

export const FORMAT = "testimus-run-pages/1";
const TEMPLATE_FILES = ["index.html", "run.js", "serve.mjs", "start.cmd", "start.sh", "README.md"];
const PLACEHOLDER = '{"run":null,"results":{}}';
export const PICTURE = /^[A-Za-z0-9][\w.-]*\.(png|jpe?g|gif|webp|bmp)$/i;

export function pagesTemplateDir(): string {
  const dev = join(import.meta.dirname ?? ".", "..", "..", "..", "templates", "run-pages");
  if (existsSync(dev)) return dev;
  return join(dirname(process.argv[1] ?? "."), "templates", "run-pages");
}

export function outsidePath(path: string, what: string): string {
  if (!isAbsolute(path))
    throw new UserError(`${what} must be an absolute path: ${path}.`, "Give the folder's full path.");
  if (/^(\\\\|\/\/)/.test(path))
    throw new UserError(`${what} is a network path: ${path}.`, "Copy the folder to this PC first, then give its path.");
  return path;
}

export function filesUnder(dir: string, rel = ""): string[] {
  if (!existsSync(join(dir, rel))) return [];
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? filesUnder(dir, r) : e.isFile() && !e.name.endsWith(".tmp") ? [r] : [];
  });
}

// ponytail: a file of the pages is read only when it is a plain file whose real path is where it says — never through
// a link (on the file or on a folder above it) to elsewhere on this PC, which an import would copy into test-runs/
export function plainFile(root: string, rel: string): boolean {
  const path = join(root, rel);
  if (lstatSync(path, { throwIfNoEntry: false })?.isFile() !== true) return false;
  return realpathSync.native(path) === join(realpathSync.native(root), rel);
}

const embed = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

export type ExportInput = { run: string; dir: string; results?: boolean };

export async function exportRun(project: string, input: ExportInput) {
  const dir = outsidePath(input.dir, "The export folder");
  if (existsSync(dir) && (!statSync(dir).isDirectory() || readdirSync(dir).length))
    throw new UserError(`${dir} is not empty.`, "Pick a new or empty folder: an export never writes over another.");
  const from = runDir(project, input.run);
  const run = readRunFile(project, input.run);
  const withResults = input.results !== false;
  const results: Record<string, RunResult> = {};
  if (withResults)
    for (const t of run.tests)
      if (existsSync(resultFile(from, t.id))) results[t.id] = readResult(project, input.run, t);
  const { importedAt: _, ...frozen } = run;
  const pages = {
    format: FORMAT,
    slug: input.run,
    exportedAt: env.now().toISOString(),
    exportedBy: osUser(),
    ...frozen,
  };
  const tpl = pagesTemplateDir();
  let files = 0;
  const put = (rel: string, data: string | Uint8Array) => {
    writeAtomic(join(dir, rel), data);
    files++;
  };
  for (const f of TEMPLATE_FILES) {
    const text = readFileSync(join(tpl, f), "utf8");
    if (f === "index.html") {
      if (!text.includes(PLACEHOLDER)) throw new Error("templates/run-pages/index.html has no data placeholder.");
      put(
        f,
        text.replace(PLACEHOLDER, () => embed({ run: pages, results })),
      );
    } else put(f, f.endsWith(".cmd") ? text.replace(/\r?\n/g, "\r\n") : text);
  }
  put("run.json", `${JSON.stringify(pages, null, 2)}\n`);
  const copy = async (rel: string) => {
    await copyFileAtomic(join(from, rel), join(dir, rel));
    files++;
  };
  for (const rel of filesUnder(from, "images")) await copy(rel);
  if (withResults)
    for (const rel of filesUnder(from, "results"))
      if (/^results\/[^/]+\.json$/.test(rel) ? results[basename(rel, ".json")] : true) await copy(rel);
  return { run: input.run, dir, files, tests: run.tests.length, results: Object.keys(results).length };
}
