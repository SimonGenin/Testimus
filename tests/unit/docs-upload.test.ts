import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invoke } from "../../src/core/commands/index.ts";
import { DEFAULT_PROJECT, writeProject } from "../../src/core/lib/project.ts";
import { sampleDocx } from "../fixtures/docx/sample.ts";

describe("docs.add upload", () => {
  it("adds a document sent as base64 and leaves no upload behind", async () => {
    const project = mkdtempSync(join(tmpdir(), "testimus-upload-"));
    writeProject(project, { ...DEFAULT_PROJECT, rag: { ...DEFAULT_PROJECT.rag, describeFigures: false } });
    const doc = (await invoke(
      "docs.add",
      { name: "SOSIE_211_D401-1_3_01.01.docx", dataBase64: Buffer.from(sampleDocx()).toString("base64") },
      { project },
    )) as { id: string };
    expect(doc.id).toBe("SOSIE_211_D401-1_3");
    expect(existsSync(join(project, "docs", doc.id, "doc.md"))).toBe(true);
    expect(existsSync(join(project, "docs", doc.id, "source.docx"))).toBe(true);
    expect(JSON.parse(readFileSync(join(project, "docs", doc.id, "doc.json"), "utf8")).source.path).toBe(
      "upload: SOSIE_211_D401-1_3_01.01.docx",
    );
    const uploads = join(project, ".testimus", "uploads");
    expect(existsSync(uploads) ? readdirSync(uploads) : []).toEqual([]);
  });

  it("asks for a document when none is given", async () => {
    const project = mkdtempSync(join(tmpdir(), "testimus-upload-"));
    writeProject(project, DEFAULT_PROJECT);
    await expect(invoke("docs.add", {}, { project })).rejects.toThrow(/No document given/);
  });
});
