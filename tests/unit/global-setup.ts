import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ponytail: every temporary folder a test makes goes under one root per run, removed at the end — without it each run
// left thousands of folders in %TEMP% (95,000 and 1.7 GB free on C: after a day of runs). LOCALAPPDATA too: the
// desktop shell's journal (src/desktop/log.ts) lands there, and the bridge tests filled the real one with « refused »
export default function setup(): () => void {
  const root = mkdtempSync(join(tmpdir(), "testimus-vitest-"));
  process.env.TEMP = root;
  process.env.TMP = root;
  process.env.TMPDIR = root;
  process.env.LOCALAPPDATA = join(root, "localappdata");
  return () => rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}
