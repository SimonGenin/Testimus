import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { type Command, quietCtx } from "../../src/core/command.ts";
import { commands as checkCommands } from "../../src/core/commands/check.ts";
import { commands as docsCommands } from "../../src/core/commands/docs.ts";
import { commands as imageCommands, storeImage } from "../../src/core/commands/images.ts";
import { commands as ragCommands } from "../../src/core/commands/rag.ts";
import { commands as reviewCommands } from "../../src/core/commands/review.ts";
import type { DocJson } from "../../src/core/types.ts";
import { copyFixture, tempRoot } from "./cov-faces-helpers.ts";

const DOC = "SOSIE_211_D401-1_3";
const LOCAL = "local-3f9a12c0";
const all: Command[] = [...checkCommands, ...docsCommands, ...imageCommands, ...ragCommands, ...reviewCommands];
const cmd = (name: string) => {
  const c = all.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return c;
};
const run = async (name: string, raw: unknown = {}): Promise<any> => {
  const c = cmd(name);
  return c.run(quietCtx(project), c.input.parse(raw) as never);
};
const subject = (name: string, raw: unknown) => cmd(name).subject?.(cmd(name).input.parse(raw) as never);

let project = "";
beforeEach(() => {
  project = copyFixture(tempRoot("cmds"));
});

function cloneTest(id: string, review: string, folder = "/Traction/Sectionneurs"): void {
  const src = readFileSync(join(project, "tests", LOCAL, "test.md"), "utf8");
  const md = src
    .replace(/^review: .*$/m, `review: ${review}`)
    .replace(/^folder: .*$/m, `folder: ${folder}`)
    .replace(/^review_note: .*\n/m, review === "to-fix" ? 'review_note: "Fix it."\n' : "");
  mkdirSync(join(project, "tests", id), { recursive: true });
  writeFileSync(join(project, "tests", id, "test.md"), md);
}

describe("check commands", () => {
  it("names the job's subject after what is checked", () => {
    expect(subject("check.run", { all: true })).toBe("all tests");
    expect(subject("check.run", { ids: ["a", "b"], folder: "/F" })).toBe("a, b, /F");
    expect(subject("check.run", { folder: "" })).toBe("tests");
    expect(subject("check.run", {})).toBe("tests");
  });

  it("runs only the mechanical pass when called from inside a Claude run", async () => {
    const logs: string[] = [];
    const ctx = { ...quietCtx(project), log: (_l: string, m: string) => logs.push(m) };
    process.env.TESTIMUS_IN_CLAUDE = "1";
    try {
      const c = cmd("check.run");
      const r = (await c.run(ctx, c.input.parse({ ids: [LOCAL] }) as never)) as { tests: { id: string }[] };
      expect(r.tests.map((t) => t.id)).toEqual([LOCAL]);
    } finally {
      delete process.env.TESTIMUS_IN_CLAUDE;
    }
    expect(logs).toContain("Called from a Claude run: mechanical pass only.");
  });

  it("refuses to show the check of a test that does not exist", async () => {
    await expect(run("check.show", { id: "local-00000000" })).rejects.toThrow(
      "No test local-00000000 in this project.",
    );
  });
});

describe("docs commands", () => {
  it("names the add job after the file, the upload name or nothing", () => {
    expect(subject("docs.add", { file: "a.docx" })).toBe("a.docx");
    expect(subject("docs.add", { name: "b.docx" })).toBe("b.docx");
    expect(subject("docs.add", {})).toBe("upload");
    expect(subject("docs.convert", { id: DOC })).toBe(DOC);
  });

  it("refuses a document that refers to itself and edits title, version and date", async () => {
    await expect(run("docs.set", { id: DOC, amends: [DOC] })).rejects.toThrow("A document cannot refer to itself.");
    const doc = (await run("docs.set", {
      id: DOC,
      title: "T",
      version: "9",
      date: "2026-01-01",
      kind: "minutes",
    })) as DocJson;
    expect(doc).toMatchObject({ title: "T", version: "9", date: "2026-01-01", kind: "minutes" });
    const linked = (await run("docs.set", { id: DOC, amends: ["SOSIE_211_D401-1_4"] })) as DocJson;
    expect(linked.amends).toEqual(["SOSIE_211_D401-1_4"]);
    const cleared = (await run("docs.set", { id: DOC, amends: [] })) as DocJson;
    expect(cleared.amends).toBeUndefined();
  });

  it("refuses an anchor the document does not have", async () => {
    await expect(run("docs.show", { id: DOC, anchor: "§99.99" })).rejects.toThrow(`No anchor §99.99 in ${DOC}.`);
  });
});

describe("rag.figure", () => {
  it("returns a figure of a document", async () => {
    const f = await run("rag.figure", { docId: DOC, n: "40" });
    expect(f).toMatchObject({ docId: DOC, anchor: "fig:40", exists: true });
  });
});

describe("tests.addImage", () => {
  const png = Buffer.from(
    readFileSync(join(import.meta.dirname, "..", "fixtures", "project", "docs", DOC, "figures", "fig-40.png")),
  );

  it("names its subject with or without a step", () => {
    expect(subject("tests.addImage", { id: LOCAL, step: 2 })).toBe(`${LOCAL} step 2`);
    expect(subject("tests.storeImage", { id: LOCAL, dataBase64: "" })).toBe(LOCAL);
  });

  it("refuses a file outside the project, not a picture, or missing", async () => {
    writeFileSync(join(project, "notes.txt"), "x");
    mkdirSync(join(project, "dir.png"));
    await expect(run("tests.addImage", { id: LOCAL, step: 1, file: "../outside.png" })).rejects.toThrow(
      "../outside.png is outside the project.",
    );
    await expect(run("tests.addImage", { id: LOCAL, step: 1, file: "notes.txt" })).rejects.toThrow(
      "notes.txt is not a picture.",
    );
    await expect(run("tests.addImage", { id: LOCAL, step: 1, file: "missing.png" })).rejects.toThrow(
      "No file missing.png.",
    );
    await expect(run("tests.addImage", { id: LOCAL, step: 1, file: "dir.png" })).rejects.toThrow("No file dir.png.");
  });

  it("refuses a bad figure reference or a figure whose file is gone", async () => {
    await expect(run("tests.addImage", { id: LOCAL, step: 1, figure: "nothing" })).rejects.toThrow(
      '"nothing" is not a figure reference.',
    );
    rmSync(join(project, "docs", DOC, "figures", "fig-40.png"));
    await expect(run("tests.addImage", { id: LOCAL, step: 1, figure: `${DOC}#fig:40` })).rejects.toThrow(
      `The file of ${DOC}#fig:40 is missing`,
    );
  });

  it("embeds a picture in an empty field", async () => {
    writeFileSync(join(project, "shot.png"), png);
    const r = await run("tests.addImage", { id: LOCAL, step: 1, file: "shot.png", field: "Data" });
    expect(r).toMatchObject({ id: LOCAL, step: 1, field: "Data", from: "shot.png" });
    expect(readFileSync(join(project, "tests", LOCAL, "test.md"), "utf8")).toContain(`### Data\n\n![](${r.file})`);
  });

  it("stores a paste in its own command, never with a file or a figure, and defaults the extension to png", async () => {
    const b64 = png.toString("base64");
    await expect(run("tests.addImage", { id: LOCAL, step: 1, dataBase64: b64 })).rejects.toThrow(
      "Give either a file or a figure.",
    );
    const stored = await run("tests.storeImage", { id: LOCAL, dataBase64: b64 });
    expect(stored.file).toMatch(/\.png$/);
    const named = await run("tests.storeImage", { id: LOCAL, dataBase64: b64, name: "photo.jpeg" });
    expect(named.file).toMatch(/\.jpg$/);
    expect(storeImage(project, LOCAL, b64, ".").file).toMatch(/\.png$/);
    await expect(run("tests.storeImage", { id: LOCAL, dataBase64: "data:image/png;base64," })).rejects.toThrow(
      "The picture is empty.",
    );
  });
});

describe("review commands", () => {
  beforeEach(() => {
    cloneTest("local-0000000a", "to-fix");
    cloneTest("local-0000000b", "draft", "/Signalisation");
    cloneTest("local-0000000c", "draft", "/Signalisation");
    cloneTest("local-0000000d", "checked", "/Traction/Sectionneurs");
    const t = new Date("2026-01-01T00:00:00Z");
    for (const id of ["local-0000000b", "local-0000000c"]) utimesSync(join(project, "tests", id, "test.md"), t, t);
  });

  it("sorts the queue by state, anomalies, folder and recency, ties by id", async () => {
    const ids = async (sort: string) =>
      ((await run("review.queue", { sort })).tests as { id: string }[]).map((t) => t.id);
    expect(await ids("state")).toEqual([
      "LFRPS12-1420",
      "local-0000000d",
      "local-0000000a",
      LOCAL,
      "local-0000000b",
      "local-0000000c",
    ]);
    const byAnomalies = await ids("anomalies");
    expect(byAnomalies).toHaveLength(6);
    const byFolder = await ids("folder");
    expect(byFolder.slice(0, 2)).toEqual(["local-0000000b", "local-0000000c"]);
    const recent = await ids("recent");
    expect(recent.slice(-2)).toEqual(["local-0000000b", "local-0000000c"]);
  });

  it("names the fix job after its test", () => {
    expect(subject("review.fix", { id: LOCAL })).toBe(LOCAL);
  });

  it("filters the queue by state, folder and findings", async () => {
    const q = await run("review.queue", { state: ["draft"], folder: "/Signalisation/" });
    expect(q.tests.map((t: { id: string }) => t.id)).toEqual(["local-0000000b", "local-0000000c"]);
    expect(q.counts).toMatchObject({ draft: 2, toFix: 2 });
    const root = await run("review.queue", { folder: "/" });
    expect(root.tests).toHaveLength(6);
    const findings = await run("review.queue", { withFindings: true });
    for (const t of findings.tests) expect(t.errors + t.warnings).toBeGreaterThan(0);
  });
});
