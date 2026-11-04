import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPrompt,
  contextDir,
  effectiveContexts,
  projectContexts,
  readContexts,
  readTestContexts,
  scopeLines,
  writeTestContexts,
} from "../../../../src/core/claude/prompt.ts";
import { readProject, writeJson, writeProject } from "../../../../src/core/lib/project.ts";
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

describe("readContexts", () => {
  it("skips bad and missing ids, defaults the name, the paths, the notes and the files", () => {
    const cs = readContexts(dir, ["full", "bare", "../x", "gone", "blank"]);
    expect(cs.map((c) => c.id)).toEqual(["full", "bare", "blank"]);
    expect(cs[0]).toMatchObject({ name: "Full", text: "Some notes", paths: ["D:/specs"], files: ["a.pdf"] });
    expect(cs[1]).toMatchObject({ name: "bare", text: "", paths: [], files: [] });
  });
});

describe("buildPrompt", () => {
  it("lists each context with what it holds, and leaves out an empty request", () => {
    const p = buildPrompt(
      { kind: "tests", testIds: ["A", "B"] },
      "   ",
      readContexts(dir, ["full", "bare", "blank"]),
      dir,
    );
    expect(p).toContain("Scope: the tests A, B.");
    expect(p).toContain("Files: tests/A/test.md, tests/B/test.md");
    expect(p).toMatch(
      /- Full — notes: .*\/contexts\/full\/context\.md; files: .*\/contexts\/full\/files\/a\.pdf; also look at: D:\/specs/,
    );
    expect(p).toMatch(/^- bare$/m);
    expect(p).toMatch(/^- blank$/m);
    expect(p).not.toContain("\\");
    expect(p).not.toMatch(/\n\n\n/);
  });

  it("without contexts names no context section; a step scope limits the edit", () => {
    const p = buildPrompt({ kind: "step", testId: "A", step: 2 }, "Do it.", [], dir);
    expect(p).not.toContain("Context to read");
    expect(p).toContain('Only edit "## Step 2"');
    expect(p).toContain("\nDo it.\n");
    expect(scopeLines({ kind: "project" })[0]).toBe("Scope: the whole project — every test and every document.");
  });

  it("states the scope, the step-only rule, the contexts and the 2-4 line reply, word for word (PARITY #84)", () => {
    const format =
      "Follow the test.md format of CLAUDE.md exactly. Every claim keeps or gets its source line: " +
      '`<docId>#<anchor> "<exact quote from doc.md>"` — use rag_search and rag_passage to find them.';
    const shots =
      "The screenshots listed under ### Attachments are files in tests/<id>/images/ — open them with Read when what the screen shows matters.";
    const reply = "When finished, reply in 2-4 lines: what you changed (which steps) and anything you could not do.";
    const full = `${dir.replace(/\\/g, "/")}/contexts/full`;
    const step = buildPrompt(
      { kind: "step", testId: "LFRPS12-7", step: 3 },
      "  Ajoute la source.  ",
      readContexts(dir, ["full"]),
      dir,
    );
    expect(step.split("\n")).toEqual([
      "Scope: step 3 of test LFRPS12-7.",
      "Files: tests/LFRPS12-7/test.md",
      "Only modify what the scope allows.",
      'Only edit "## Step 3" of that file (its fields and its ### Sources); do not touch other steps.',
      format,
      shots,
      "",
      "Context to read before you start (reference material, do not edit it):",
      `- Full — notes: ${full}/context.md; files: ${full}/files/a.pdf; also look at: D:/specs`,
      "",
      "Ajoute la source.",
      "",
      reply,
      "",
    ]);
    const test = buildPrompt({ kind: "test", testId: "LFRPS12-7" }, "Relis.", [], dir);
    expect(test.split("\n")).toEqual([
      "Scope: the whole test LFRPS12-7.",
      "Files: tests/LFRPS12-7/test.md",
      "Only modify what the scope allows.",
      format,
      shots,
      "",
      "Relis.",
      "",
      reply,
      "",
    ]);
    const project = buildPrompt({ kind: "project" }, "", [], dir);
    expect(project.split("\n")).toEqual([
      "Scope: the whole project — every test and every document.",
      "Files: all tests/*/test.md; the documents through rag_search, rag_passage and docs/*/doc.md (read only)",
      "Only modify what the scope allows.",
      "When the request is a question, answer it from the documents and the tests and change nothing; " +
        'put the source of every factual sentence at its end: [<docId>#<anchor> "<exact quote from doc.md>"].',
      format,
      shots,
      "",
      "When finished, give the answer, or reply in 2-4 lines: what you changed (which tests and steps) and anything you could not do.",
      "",
    ]);
    expect(test).not.toContain("Only edit");
    expect(project).not.toContain("Only edit");
  });
});

describe("per-test contexts", () => {
  it("the project's list applies until the test has its own; ids whose folder is gone drop out", () => {
    const p = readProject(dir);
    writeProject(dir, { ...p, claude: { ...p.claude, contexts: ["full", "gone"] } });
    expect(readTestContexts(dir, "LFRPS12-1420")).toBeNull();
    expect(effectiveContexts(dir)).toEqual(["full"]);
    expect(effectiveContexts(dir, "LFRPS12-1420")).toEqual(["full"]);
    writeTestContexts(dir, "LFRPS12-1420", ["bare", "bare", "gone"]);
    expect(readTestContexts(dir, "LFRPS12-1420")).toEqual(["bare", "gone"]);
    expect(effectiveContexts(dir, "LFRPS12-1420")).toEqual(["bare"]);
    writeTestContexts(dir, "LFRPS12-1420", []);
    expect(effectiveContexts(dir, "LFRPS12-1420")).toEqual([]);
    writeTestContexts(dir, "LFRPS12-1420", null);
    expect(readTestContexts(dir, "LFRPS12-1420")).toBeNull();
  });

  it("the whole project attaches the project's list and every test's own, each once", () => {
    const p = readProject(dir);
    writeProject(dir, { ...p, claude: { ...p.claude, contexts: ["full", "gone"] } });
    expect(projectContexts(dir)).toEqual(["full"]);
    writeTestContexts(dir, "LFRPS12-1420", ["bare", "full"]);
    writeTestContexts(dir, "LFRPS12-1398", ["bare", "blank"]);
    expect(projectContexts(dir)).toEqual(["full", "bare", "blank"]);
    rmSync(join(dir, "tests"), { recursive: true, force: true });
    expect(projectContexts(dir)).toEqual(["full"]);
  });

  it("a local.json without a list, or with junk in it, reads as no list or as its valid ids", () => {
    const f = join(dir, "tests", "LFRPS12-1420", "local.json");
    writeJson(f, { contexts: "full" });
    expect(readTestContexts(dir, "LFRPS12-1420")).toBeNull();
    writeJson(f, { contexts: ["full", 3, "bad id"] });
    expect(readTestContexts(dir, "LFRPS12-1420")).toEqual(["full"]);
  });
});
