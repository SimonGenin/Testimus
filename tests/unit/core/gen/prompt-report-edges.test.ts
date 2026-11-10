import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genPrompt, STEPS_LINE } from "../../../../src/core/claude/gen-prompt.ts";
import {
  asSkipped,
  byCategory,
  inCategoryOrder,
  parseGenReport,
  type Skipped,
} from "../../../../src/core/claude/gen-reply.ts";
import { generateTests, stampTest } from "../../../../src/core/claude/generate.ts";
import { given } from "../../../../src/core/claude/given.ts";
import { languageName } from "../../../../src/core/claude/language.ts";
import type { Ctx } from "../../../../src/core/command.ts";
import { type ClaudeOut, env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, readProject, writeProject, writeSettings } from "../../../../src/core/lib/project.ts";
import { readTest } from "../../../../src/core/lib/store.ts";
import { writeContextMd } from "../../helpers/context.ts";
import { markIndexedInDb as markIndexed } from "../../helpers/index-state.ts";
import "../../../../src/core/commands/index.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const real = env.spawnClaude;
let dir: string;
let logs: string[];

const ctx = (): Ctx => ({
  project: dir,
  signal: new AbortController().signal,
  progress() {},
  log(level, m) {
    logs.push(`${level}: ${m}`);
  },
  claude() {},
});

const block = (o: unknown) => `\`\`\`gen-report\n${typeof o === "string" ? o : JSON.stringify(o)}\n\`\`\``;

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-covgen-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  markIndexed(dir);
  logs = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
});

afterEach(() => {
  env.spawnClaude = real;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("generation prompt, the edges", () => {
  it("names an unknown language by its code and says when the project has no folders", () => {
    expect(languageName("EN")).toBe("English");
    expect(languageName("sv")).toBe("sv");
    const p = readProject(dir);
    writeProject(dir, { ...p, language: "sv", folders: [] });
    const text = genPrompt(dir, { request: "x" });
    expect(text).toContain("\nXray folder of the tests: none given — /\n");
    expect(text).toContain("\nLanguage of the tests: sv.\n");
    expect(text).not.toContain("Read first");
  });

  it("carries what goes with the run after its own facts: the contexts with their notes, files and paths", () => {
    const c = join(dir, "contexts", "ctx1");
    mkdirSync(join(c, "files"), { recursive: true });
    writeContextMd(c, { name: "Plan", paths: ["D:/plans"], notes: "notes" });
    writeFileSync(join(c, "files", "p.pdf"), "");
    mkdirSync(join(dir, "contexts", "ctx2"), { recursive: true });
    const g = given(dir, "generate", { kind: "project" }, { contexts: ["ctx1", "ctx2"] });
    const text = genPrompt(dir, { request: "x" }, g.lines);
    expect(text).toContain("\n\nRead first — reference material, never edit it:\n");
    expect(text).toMatch(
      /^- « Plan » — its notes are below; files: \S+\/contexts\/ctx1\/files\/p\.pdf; also look at: D:\/plans$/m,
    );
    expect(text).toMatch(/^- « ctx2 »$/m);
    expect(text).toContain("\n\n« Plan »:\nnotes\n");
    const at = (s: string) => text.indexOf(s);
    expect(at(STEPS_LINE)).toBeGreaterThan(0);
    expect(at("Read first")).toBeGreaterThan(at(STEPS_LINE));
    expect(at("End your reply with the report of the skill")).toBeGreaterThan(at("« Plan »:"));
  });
});

describe("gen-report parsing, the edges", () => {
  it("reads the last block only: one that is not an object is not a report, and the block before it is not read instead", () => {
    const r = parseGenReport([block({ tests: ["local-00000001"], skipped: [] }), block("[1, 2]")].join("\n"));
    expect(r).toEqual({
      found: false,
      errors: ["(block): Invalid input: expected object, received array"],
      tests: [],
      skipped: [],
      covered: [],
    });
    expect(parseGenReport(block('"text"')).errors).toEqual([
      "(block): Invalid input: expected object, received string",
    ]);
    expect(parseGenReport(block({ skipped: "no" })).errors).toEqual([
      "skipped: Invalid input: expected array, received string",
    ]);
  });

  it("names each item that is not one, field by field, and keeps none of the report", () => {
    const r = parseGenReport(
      block({ tests: [], skipped: [{ item: "A", why: 3 }, { item: "  " }, { why: "x" }, null, 5] }),
    );
    expect(r.found).toBe(false);
    expect(r.skipped).toEqual([]);
    const reasons =
      'Invalid option: expected one of "no-source"|"not-observable"|"already-tested"|"out-of-scope"|"documents-disagree"|"missing-material"';
    expect(r.errors).toEqual([
      "skipped.0.item: Too small: expected string to have >=3 characters",
      `skipped.0.reason: ${reasons}`,
      "skipped.0.why: Invalid input: expected string, received number",
      "skipped.1.item: Too small: expected string to have >=3 characters",
      `skipped.1.reason: ${reasons}`,
      "skipped.1.why: Invalid input: expected string, received undefined",
      "skipped.2.item: Invalid input: expected string, received undefined",
      `skipped.2.reason: ${reasons}`,
      "skipped.2.why: Too small: expected string to have >=20 characters",
      "skipped.3: Invalid input: expected object, received null",
      "skipped.4: Invalid input: expected object, received number",
    ]);
  });

  it("keeps the sources of a skipped item as the run wrote them; a ledger written before the reasons keeps those written docId#anchor", () => {
    const item = {
      item: "Item A",
      reason: "out-of-scope",
      why: "The request is about the menu, not this.",
      sources: ['D1#§2 "le texte"', " D1 "],
    };
    expect(parseGenReport(block({ skipped: [item] })).skipped).toEqual([
      {
        item: "Item A",
        reason: "out-of-scope",
        category: "Outside the request",
        why: "The request is about the menu, not this.",
        sources: ['D1#§2 "le texte"', "D1"],
      },
    ]);
    expect(parseGenReport(block({ skipped: [{ ...item, sources: ['D1#§2 "le texte"', 3] }] })).errors).toEqual([
      "skipped.0.sources.1: Invalid input: expected string, received number",
    ]);
    expect(parseGenReport(block({ skipped: [{ ...item, sources: ["  "] }] })).errors).toEqual([
      "skipped.0.sources.0: Too small: expected string to have >=1 characters",
    ]);
    const old = [
      { item: "A", category: "  No   source ", why: "w", sources: ['D1#§2 "le texte"', "D1", 3, "  "] },
      { item: "B", category: 4, why: "w", sources: ["nothing"] },
    ];
    expect(asSkipped(old)).toEqual([
      { item: "A", reason: "other", category: "No source", why: "w", sources: ['D1#§2 "le texte"'] },
      { item: "B", reason: "other", category: "Other", why: "w" },
    ]);
  });
});

describe("stampTest", () => {
  it("writes once, then leaves an already stamped test alone", () => {
    const id = "local-3f9a12c0";
    const f = join(dir, "tests", id, "test.md");
    stampTest(dir, id, "generate-00000001", "/Traction");
    const once = readFileSync(f, "utf8");
    expect(readTest(dir, id).test).toMatchObject({ review: "draft", generatedBy: "generate-00000001" });
    stampTest(dir, id, "generate-00000001", "/Elsewhere");
    expect(readFileSync(f, "utf8")).toBe(once);
  });
});

describe("generateTests, a failed run", () => {
  it("logs the error, keeps the diagnosis, writes nothing and asks nothing again", async () => {
    let runs = 0;
    env.spawnClaude = async (s): Promise<ClaudeOut> => {
      runs++;
      const l = JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Invalid API key · Please run /login",
        session_id: "s-9",
      });
      s.onLine?.(l);
      return { code: 1, stdout: `${l}\n`, stderr: "" };
    };
    const r = await generateTests(dir, { request: "Menu" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.tests).toEqual([]);
    expect(r.diagnosis?.kind).toBe("login");
    expect(runs).toBe(1);
    expect(r.reportFound).toBe(false);
    expect(logs.filter((m) => m.startsWith("error: "))).toEqual(["error: Invalid API key · Please run /login"]);
    expect(logs.some((m) => m.includes("report could not be read"))).toBe(false);
    expect(logs.some((m) => m.includes("is asked for it again"))).toBe(false);
  });
});

describe("the items not written, grouped by category", () => {
  it("one group per category, the largest first, then in Claude's order; the results carry them in that order", () => {
    const s = (item: string, category: string): Skipped => ({ item, reason: "other", category, why: "" });
    const skipped = [s("R2", "Hors périmètre"), s("B", "Pas de source"), s("C", "Other"), s("D", "Pas de source")];
    expect(byCategory(skipped).map((g) => [g.category, g.items.map((x) => x.item)])).toEqual([
      ["Pas de source", ["B", "D"]],
      ["Hors périmètre", ["R2"]],
      ["Other", ["C"]],
    ]);
    expect(inCategoryOrder(skipped).map((x) => x.item)).toEqual(["B", "D", "R2", "C"]);
  });
});
