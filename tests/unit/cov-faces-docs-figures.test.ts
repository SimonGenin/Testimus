import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { commands } from "../../src/core/commands/docs.ts";
import { DEFAULT_PROJECT, writeProject } from "../../src/core/lib/project.ts";
import { sampleDocx } from "../fixtures/docx/sample.ts";
import { tempRoot } from "./cov-faces-helpers.ts";

const failures: unknown[] = [];

vi.mock("../../src/core/claude/figures.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  describeFigures: async () => {
    throw failures.shift();
  },
}));

async function add(project: string, raw: unknown, logs: string[]) {
  const c = commands.find((x) => x.name === "docs.add");
  if (!c) throw new Error("no docs.add");
  const ctx = { ...quietCtx(project), log: (_l: string, m: string) => logs.push(m) };
  return (await c.run(ctx, c.input.parse(raw) as never)) as { id: string; source: { path: string } };
}

describe("docs.add with figure descriptions", () => {
  it("keeps the document when Claude cannot describe its figures", async () => {
    const project = join(tempRoot("docsfig"), "p");
    writeProject(project, DEFAULT_PROJECT);
    const data = Buffer.from(sampleDocx()).toString("base64");
    const logs: string[] = [];
    failures.push(new Error("Claude is absent"), "plain refusal");
    const first = await add(project, { dataBase64: data, id: "DOC_A" }, logs);
    expect(first.source.path).toBe("upload: document.docx");
    const second = await add(project, { name: "spec.docx", dataBase64: data, id: "DOC_B" }, logs);
    expect(second.source.path).toBe("upload: spec.docx");
    expect(logs).toEqual([
      "Figure descriptions skipped: Claude is absent",
      "Figure descriptions skipped: plain refusal",
    ]);
    const uploads = join(project, ".testimus", "uploads");
    expect(existsSync(uploads) ? readdirSync(uploads) : []).toEqual([]);
  });

  it("cleans the upload folder when the PDF rendering cannot be read", async () => {
    const project = join(tempRoot("docsfig"), "p");
    writeProject(project, DEFAULT_PROJECT);
    const data = Buffer.from(sampleDocx()).toString("base64");
    const logs: string[] = [];
    failures.push(new Error("absent"));
    await add(
      project,
      { name: "x.docx", dataBase64: data, pdfBase64: Buffer.from("not a pdf").toString("base64"), id: "DOC_C" },
      logs,
    ).catch(() => {});
    const uploads = join(project, ".testimus", "uploads");
    expect(existsSync(uploads) ? readdirSync(uploads) : []).toEqual([]);
  });
});
