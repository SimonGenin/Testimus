import { cpSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ponytail: every file the app owns is written beside itself then renamed over (Xray Editor's write_text), so a
// crash or a full disk leaves the old file whole — and a failed rename takes its .tmp away with it
export function writeAtomic(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

// ponytail: a folder is copied beside its target then renamed over, so a half-done copy never looks like a context
// or a test's images (a failed copy takes its .tmp folder away)
export function copyDirAtomic(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  const tmp = `${to}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  try {
    cpSync(from, tmp, { recursive: true });
    renameSync(tmp, to);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}
