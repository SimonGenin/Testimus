import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genPrompt, languageName } from "../../../../src/core/claude/gen-prompt.ts";
import { byCategory, inCategoryOrder, parseGenReport } from "../../../../src/core/claude/gen-reply.ts";
import { generateTests, stampTest } from "../../../../src/core/claude/generate.ts";
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
    expect(text).toContain("project.json folders (none)");
    expect(text).toContain('Language of the tests: sv (project.json language "sv")');
    expect(text).not.toContain("Context to read");
  });

  it("lists the contexts with their notes, files and paths", () => {
    const c = join(dir, "contexts", "ctx1");
    mkdirSync(join(c, "files"), { recursive: true });
    writeContextMd(c, { name: "Plan", paths: ["D:/plans"], notes: "notes" });
    writeFileSync(join(c, "files", "p.pdf"), "");
    mkdirSync(join(dir, "contexts", "ctx2"), { recursive: true });
    const text = genPrompt(dir, { request: "x" }, ["ctx1", "ctx2"]);
    expect(text).toContain("Context to read before you start");
    expect(text).toMatch(
      /- Plan — notes: \S+\/contexts\/ctx1\/context\.md; files: \S+\/ctx1\/files\/p\.pdf; also look at: D:\/plans/,
    );
    expect(text).toMatch(/^- ctx2$/m);
  });
});

describe("gen-report parsing, the edges", () => {
  it("skips a block that is not an object and keeps only named skipped items", () => {
    const r = parseGenReport(
      [
        "```gen-report",
        '{"tests": [], "skipped": [{"item": "A", "why": 3}, {"item": "  "}, {"why": "x"}, null, 5]}',
        "```",
        "```gen-report",
        "[1, 2]",
        "```",
      ].join("\n"),
    );
    expect(r.found).toBe(true);
    expect(r.skipped).toEqual([{ item: "A", category: "Other", why: "" }]);
    expect(parseGenReport('```gen-report\n"text"\n```').found).toBe(false);
    expect(parseGenReport('```gen-report\n{"skipped": "no"}\n```').skipped).toEqual([]);
  });

  it("keeps the sources of a skipped item written docId#anchor, and drops the rest", () => {
    const report = {
      skipped: [
        { item: "A", category: "  No   source ", why: "w", sources: ['D1#§2 "le texte"', "D1", 3, "  "] },
        { item: "B", category: 4, why: "w", sources: ["nothing"] },
      ],
    };
    expect(parseGenReport(`\`\`\`gen-report\n${JSON.stringify(report)}\n\`\`\``).skipped).toEqual([
      { item: "A", category: "No source", why: "w", sources: ['D1#§2 "le texte"'] },
      { item: "B", category: "Other", why: "w" },
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
  it("logs the error, keeps the diagnosis and writes nothing", async () => {
    env.spawnClaude = async (s): Promise<ClaudeOut> => {
      const l = JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Invalid API key · Please run /login",
      });
      s.onLine?.(l);
      return { code: 1, stdout: `${l}\n`, stderr: "" };
    };
    const r = await generateTests(dir, { request: "Menu" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.tests).toEqual([]);
    expect(r.diagnosis?.kind).toBe("login");
    expect(logs.some((m) => m.startsWith("error: Invalid API key"))).toBe(true);
    expect(logs.some((m) => m.includes("no gen-report block"))).toBe(false);
  });
});

describe("the items not written, grouped by category", () => {
  it("one group per category, the largest first, then in Claude's order; the results carry them in that order", () => {
    const s = (item: string, category: string) => ({ item, category, why: "" });
    const skipped = [s("R2", "Hors périmètre"), s("B", "Pas de source"), s("C", "Other"), s("D", "Pas de source")];
    expect(byCategory(skipped).map((g) => [g.category, g.items.map((x) => x.item)])).toEqual([
      ["Pas de source", ["B", "D"]],
      ["Hors périmètre", ["R2"]],
      ["Other", ["C"]],
    ]);
    expect(inCategoryOrder(skipped).map((x) => x.item)).toEqual(["B", "D", "R2", "C"]);
  });
});
