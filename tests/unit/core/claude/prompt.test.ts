import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { given } from "../../../../src/core/claude/given.ts";
import {
  contextDir,
  readContexts,
  readTestContexts,
  scopedPrompt,
  scopeLines,
  writeTestContexts,
} from "../../../../src/core/claude/prompt.ts";
import { writeJson } from "../../../../src/core/lib/project.ts";
import { writeContextMd } from "../../helpers/context.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
let dir: string;

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-covprompt-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  const full = contextDir(dir, "full");
  mkdirSync(join(full, "files"), { recursive: true });
  writeContextMd(full, { name: "Full", paths: ["D:/specs"], notes: "Some notes" });
  writeFileSync(join(full, "files", "a.pdf"), "");
  const bare = contextDir(dir, "bare");
  mkdirSync(bare, { recursive: true });
  writeFileSync(join(bare, "context.md"), "---\npaths: not a list\n---\n");
  const blank = contextDir(dir, "blank");
  mkdirSync(blank, { recursive: true });
  writeFileSync(join(blank, "context.md"), "   ");
});

afterEach(() => {
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

const withContexts = (ids: string[]) => given(dir, "run", { kind: "none" }, { contexts: ids }).lines;

describe("readContexts", () => {
  it("skips bad and missing ids, defaults the name, the paths, the notes and the files", () => {
    const cs = readContexts(dir, ["full", "bare", "../x", "gone", "blank"]);
    expect(cs.map((c) => c.id)).toEqual(["full", "bare", "blank"]);
    expect(cs[0]).toMatchObject({ name: "Full", text: "Some notes", paths: ["D:/specs"], files: ["a.pdf"] });
    expect(cs[1]).toMatchObject({ name: "bare", text: "", paths: [], files: [] });
  });
});

describe("scopedPrompt", () => {
  it("carries what goes with the run as it is given, and leaves out an empty request", () => {
    const p = scopedPrompt({ kind: "tests", testIds: ["A", "B"] }, "   ", withContexts(["full", "bare", "blank"]));
    expect(p).toContain("Scope: the tests A, B.");
    expect(p).toContain("Files: tests/A/test.md, tests/B/test.md");
    expect(p).toMatch(
      /^- « Full » — its notes are below; files: .*\/contexts\/full\/files\/a\.pdf; also look at: D:\/specs$/m,
    );
    expect(p).toMatch(/^- « bare »$/m);
    expect(p).toMatch(/^- « blank »$/m);
    expect(p).toContain("\n\n« Full »:\nSome notes\n");
    expect(p).not.toContain("\\");
    expect(p).not.toMatch(/\n\n\n/);
  });

  it("without contexts names no reading; a step scope limits the edit", () => {
    const p = scopedPrompt({ kind: "step", testId: "A", step: 2 }, "Do it.", []);
    expect(p).not.toContain("Read first");
    expect(p).toContain('Only "## Step 2" of that file: its columns and its ### Sources.');
    expect(p).toContain("\nDo it.\n");
    expect(scopeLines({ kind: "project" })[0]).toBe("Scope: the whole project — every test and every document.");
  });

  it("reads a test run and changes nothing: the files of the run, its test and step, the answer written out", () => {
    const p = scopedPrompt({ kind: "run", run: "recette-j5", testId: "A", step: 2 }, "Rédige la note.", []);
    expect(p.split("\n")[0]).toBe("Scope: step 2 of the test A of the test run recette-j5 — read only.");
    expect(p).toContain("test-runs/recette-j5/run.json");
    expect(p).toContain("test-runs/recette-j5/results/A.json");
    expect(p).toContain("Change no file: a test run is the testers' — you read it, you never mark a step or a result.");
    expect(p).toContain("the text to paste alone in one fenced block");
    expect(p).not.toContain("Change nothing outside the scope.");
    expect(p).not.toContain("### Attachments");
    expect(p).toContain("\nRédige la note.\n");
    expect(p.trimEnd().endsWith("Reply with the answer.")).toBe(true);
    expect(scopeLines({ kind: "run", run: "recette-j5" })[0]).toBe("Scope: the test run recette-j5 — read only.");
  });

  it("states the scope, the step-only rule, what goes with the run and the 2 to 4 line reply, word for word", () => {
    const shots =
      "The pictures under ### Attachments are files of tests/<id>/images/: Read one when what the screen shows matters.";
    const reply = "Reply in 2 to 4 lines: what changed (which steps) and what you could not do.";
    const full = `${dir.replace(/\\/g, "/")}/contexts/full`;
    const step = scopedPrompt(
      { kind: "step", testId: "LFRPS12-7", step: 3 },
      "  Ajoute la source.  ",
      withContexts(["full"]),
    );
    expect(step.split("\n")).toEqual([
      "Scope: step 3 of test LFRPS12-7.",
      "Files: tests/LFRPS12-7/test.md",
      "Change nothing outside the scope.",
      'Only "## Step 3" of that file: its columns and its ### Sources.',
      shots,
      "",
      "Read first — reference material, never edit it:",
      `- « Full » — its notes are below; files: ${full}/files/a.pdf; also look at: D:/specs`,
      "",
      "« Full »:",
      "Some notes",
      "",
      "Ajoute la source.",
      "",
      reply,
      "",
    ]);
    const test = scopedPrompt({ kind: "test", testId: "LFRPS12-7" }, "Relis.", []);
    expect(test.split("\n")).toEqual([
      "Scope: the whole test LFRPS12-7.",
      "Files: tests/LFRPS12-7/test.md",
      "Change nothing outside the scope.",
      shots,
      "",
      "Relis.",
      "",
      reply,
      "",
    ]);
    const project = scopedPrompt({ kind: "project" }, "", []);
    expect(project.split("\n")).toEqual([
      "Scope: the whole project — every test and every document.",
      "Files: all tests/*/test.md; the documents through rag_search, rag_passage and docs/*/doc.md (read only)",
      "Change nothing outside the scope.",
      'A question is answered from the documents and the tests, changing nothing, each factual sentence ending with its source: [<docId>#<anchor> "<exact quote from doc.md>"]. A request that changes tests follows the edit-test skill.',
      shots,
      "",
      "Reply with the answer, or in 2 to 4 lines: what changed (which tests and steps) and what you could not do.",
      "",
    ]);
    expect(test).not.toContain('Only "## Step');
    expect(project).not.toContain('Only "## Step');
  });
});

describe("a test's own contexts", () => {
  it("are written once each, read back as they are, and taken away with null", () => {
    expect(readTestContexts(dir, "LFRPS12-1420")).toBeNull();
    writeTestContexts(dir, "LFRPS12-1420", ["bare", "bare", "gone"]);
    expect(readTestContexts(dir, "LFRPS12-1420")).toEqual(["bare", "gone"]);
    writeTestContexts(dir, "LFRPS12-1420", []);
    expect(readTestContexts(dir, "LFRPS12-1420")).toEqual([]);
    writeTestContexts(dir, "LFRPS12-1420", null);
    expect(readTestContexts(dir, "LFRPS12-1420")).toBeNull();
  });

  it("a local.json without a list, or with junk in it, reads as no list or as its valid ids", () => {
    const f = join(dir, "tests", "LFRPS12-1420", "local.json");
    writeJson(f, { contexts: "full" });
    expect(readTestContexts(dir, "LFRPS12-1420")).toBeNull();
    writeJson(f, { contexts: ["full", 3, "bad id"] });
    expect(readTestContexts(dir, "LFRPS12-1420")).toEqual(["full"]);
  });
});
