import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspect } from "../../../../src/core/lib/docs-pipeline.ts";

describe("profiling an original that cannot be profiled", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
  const signal = new AbortController().signal;

  it("refuses a file that is not a .docx or a .pdf, or that is not there", async () => {
    dir = mkdtempSync(join(tmpdir(), "testimus-inspect-"));
    const txt = join(dir, "notes.txt");
    writeFileSync(txt, "not a document");
    await expect(inspect(null, { file: txt }, signal)).rejects.toThrow(`Not a .docx or .pdf file: ${txt}`);
    const missing = join(dir, "missing.docx");
    await expect(inspect(null, { file: missing }, signal)).rejects.toThrow(`Not a .docx or .pdf file: ${missing}`);
  });

  it("refuses an added document's id when no project is open", async () => {
    await expect(inspect(null, { id: "SOSIE_211" }, signal)).rejects.toThrow("No project is open.");
  });
});
