import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { commands } from "../../../../src/core/commands/docs.ts";
import { DEFAULT_PROJECT, writeProject } from "../../../../src/core/lib/project.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";
import { tempRoot } from "../../cov-faces-helpers.ts";

const failures: unknown[] = [];
const picked: unknown[] = [];

vi.mock("../../../../src/core/claude/figures.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  describeFigures: async (_p: string, _id: string, _ctx: unknown, opts: unknown) => {
    picked.push(opts);
    throw failures.shift();
  },
}));

async function add(project: string, raw: unknown, logs: string[]) {
  const c = commands.find((x) => x.name === "docs.add");
  if (!c) throw new Error("no docs.add");
  const ctx = { ...quietCtx(project), log: (_l: string, m: string) => logs.push(m) };
  return (await c.run(ctx, c.input.parse(raw) as never)) as {
    id: string;
    source: { name: string; uploaded?: boolean };
  };
}

describe("docs.add with figure descriptions", () => {
  it("keeps the document when Claude cannot describe its figures", async () => {
    const project = join(tempRoot("docsfig"), "p");
    writeProject(project, DEFAULT_PROJECT);
    const data = Buffer.from(sampleDocx()).toString("base64");
    const logs: string[] = [];
    failures.push(new Error("Claude is absent"), "plain refusal");
    const first = await add(project, { dataBase64: data, id: "DOC_A" }, logs);
    expect(first.source).toMatchObject({ name: "document.docx", uploaded: true });
    const second = await add(project, { name: "spec.docx", dataBase64: data, id: "DOC_B" }, logs);
    expect(second.source).toMatchObject({ name: "spec.docx", uploaded: true });
    expect(logs).toEqual([
      "Figure descriptions skipped: Claude is absent",
      "Figure descriptions skipped: plain refusal",
    ]);
    const uploads = join(project, ".testimus", "uploads");
    expect(existsSync(uploads) ? readdirSync(uploads) : []).toEqual([]);
  });

  it("hands the model and effort picked for the import to the figure descriptions, on add and reconvert", async () => {
    const project = join(tempRoot("docsfig"), "p");
    writeProject(project, DEFAULT_PROJECT);
    const data = Buffer.from(sampleDocx()).toString("base64");
    picked.length = 0;
    failures.push("absent", "absent", "absent");
    await add(project, { dataBase64: data, id: "DOC_D", model: "sonnet", effort: "high" }, []);
    await add(project, { dataBase64: data, id: "DOC_E" }, []);
    const convert = commands.find((x) => x.name === "docs.convert");
    if (!convert) throw new Error("no docs.convert");
    await convert.run(quietCtx(project), convert.input.parse({ id: "DOC_D", model: "haiku", effort: "max" }) as never);
    expect(picked).toEqual([
      { model: "sonnet", effort: "high" },
      { model: undefined, effort: undefined },
      { model: "haiku", effort: "max" },
    ]);
    expect(() => convert.input.parse({ id: "DOC_D", effort: "huge" })).toThrow();
  });

  it("describeFigures on the import wins over project.json rag.describeFigures, both ways", async () => {
    const project = join(tempRoot("docsfig"), "p");
    writeProject(project, DEFAULT_PROJECT);
    const data = Buffer.from(sampleDocx()).toString("base64");
    picked.length = 0;
    failures.push("absent", "absent");
    await add(project, { dataBase64: data, id: "DOC_F", describeFigures: false }, []);
    expect(picked).toEqual([]);
    writeProject(project, { ...DEFAULT_PROJECT, rag: { ...DEFAULT_PROJECT.rag, describeFigures: false } });
    await add(project, { dataBase64: data, id: "DOC_G" }, []);
    expect(picked).toEqual([]);
    const convert = commands.find((x) => x.name === "docs.convert");
    if (!convert) throw new Error("no docs.convert");
    await convert.run(quietCtx(project), convert.input.parse({ id: "DOC_G", describeFigures: true }) as never);
    expect(picked).toHaveLength(1);
    failures.length = 0;
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
