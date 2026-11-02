import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateTests, genPrompt, languageName, parseGenReport, stampTest } from "../../src/core/claude/generate.ts";
import type { Ctx } from "../../src/core/command.ts";
import { type ClaudeOut, env } from "../../src/core/env.ts";
import { DEFAULT_SETTINGS, readProject, writeJson, writeProject, writeSettings } from "../../src/core/lib/project.ts";
import { readTest } from "../../src/core/lib/store.ts";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "project");
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
    writeJson(join(c, "context.json"), { name: "Plan", paths: ["D:/plans"] });
    writeFileSync(join(c, "notes.md"), "notes");
    writeFileSync(join(c, "files", "p.pdf"), "");
    mkdirSync(join(dir, "contexts", "ctx2"), { recursive: true });
    const text = genPrompt(dir, { request: "x" }, ["ctx1", "ctx2"]);
    expect(text).toContain("Context to read before you start");
    expect(text).toMatch(
      /- Plan — notes: \S+\/contexts\/ctx1\/notes\.md; files: \S+\/ctx1\/files\/p\.pdf; also look at: D:\/plans/,
    );
    expect(text).toMatch(/^- ctx2$/m);
  });
});

describe("gen-report parsing, the edges", () => {
  it("skips a block that is not an object and keeps only named uncovered items", () => {
    const r = parseGenReport(
      [
        "```gen-report",
        '{"tests": [], "uncovered": [{"item": "A", "why": 3}, {"item": "  "}, {"why": "x"}, null, 5]}',
        "```",
        "```gen-report",
        "[1, 2]",
        "```",
      ].join("\n"),
    );
    expect(r.found).toBe(true);
    expect(r.uncovered).toEqual([{ item: "A", why: "" }]);
    expect(parseGenReport('```gen-report\n"text"\n```').found).toBe(false);
    expect(parseGenReport('```gen-report\n{"uncovered": "no"}\n```').uncovered).toEqual([]);
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
