import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ask, listChats, sourceRefs } from "../../src/core/claude/chat.ts";
import { checkOne, checkTests, promoteChecked } from "../../src/core/claude/check.ts";
import { describeFigures, figuresPrompt, parseFigures } from "../../src/core/claude/figures.ts";
import { fixTest } from "../../src/core/claude/fix.ts";
import { claudeHeaders, headersPrompt, parseHeaders, projectOfDoc } from "../../src/core/claude/headers.ts";
import { contextDirs, mcpServer, runClaude } from "../../src/core/claude/run.ts";
import {
  changedStepNumbers,
  finishSnapshot,
  markLeft,
  readRun,
  revert,
  takeSnapshot,
} from "../../src/core/claude/snapshot.ts";
import { checkSignedIn, claudeExe, claudeVersion, resetProbe } from "../../src/core/claude/status.ts";
import type { Ctx } from "../../src/core/command.ts";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../src/core/env.ts";
import { readDoc } from "../../src/core/lib/docs.ts";
import {
  DEFAULT_SETTINGS,
  readJson,
  readProject,
  writeJson,
  writeProject,
  writeSettings,
} from "../../src/core/lib/project.ts";
import type { Chunk, FigureEntry } from "../../src/core/types.ts";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "project");
const D3 = "SOSIE_211_D401-1_3";
const real = env.spawnClaude;
const realPath = process.env.PATH;
let dir: string;
let seen: ClaudeSpawn[];
let logs: string[];

const exeName = process.platform === "win32" ? "claude.exe" : "claude";
const line = (m: unknown) => JSON.stringify(m);
const resultLine = (r: string, ok = true) =>
  line({
    type: "result",
    subtype: ok ? "success" : "error_during_execution",
    is_error: !ok,
    result: r,
    duration_ms: 3,
    total_cost_usd: 0.01,
  });

function answer(out: Partial<ClaudeOut> | ((s: ClaudeSpawn) => Promise<ClaudeOut>)) {
  env.spawnClaude = async (s) => {
    seen.push(s);
    if (typeof out === "function") return await out(s);
    return { code: 0, stdout: "", stderr: "", ...out };
  };
}

function ctxOf(signal = new AbortController().signal): Ctx {
  return {
    project: dir,
    signal,
    progress() {},
    log(_l, m) {
      logs.push(m);
    },
    claude() {},
  };
}

const aborted = () => {
  const ac = new AbortController();
  ac.abort();
  return ac.signal;
};

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-covruns-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  seen = [];
  logs = [];
  resetProbe();
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
});

afterEach(() => {
  env.spawnClaude = real;
  process.env.PATH = realPath;
  delete process.env.TESTIMUS_HOME_BIN;
  resetProbe();
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("claudeExe", () => {
  it("finds claude on PATH, then in ~/.local/bin, else the bare name", () => {
    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "  " } });
    const bin = join(dir, "..", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, exeName), "");
    process.env.PATH = bin;
    expect(claudeExe()).toBe(join(bin, exeName));
    process.env.PATH = join(dir, "..", "nothing");
    const local = join(env.homeDir(), ".local", "bin");
    mkdirSync(local, { recursive: true });
    writeFileSync(join(local, exeName), "");
    expect(claudeExe()).toBe(join(local, exeName));
    rmSync(join(local, exeName));
    delete process.env.PATH;
    expect(claudeExe()).toBe("claude");
  });
});

describe("status probes", () => {
  it("version: a failure without stderr reads stdout, then the exit code; a thrown non-error is said", async () => {
    answer({ code: 2, stdout: "only stdout\n" });
    expect(await claudeVersion(true)).toEqual({ ok: false, text: "only stdout" });
    answer({ code: 3 });
    expect(await claudeVersion(true)).toEqual({ ok: false, text: "claude exited with code 3" });
    answer(async () => {
      throw "plain";
    });
    expect(await claudeVersion(true)).toEqual({ ok: false, text: "plain" });
  });

  it("sign-in: a spawn that throws, and a silent failure", async () => {
    answer(async () => {
      throw "nope";
    });
    expect(await checkSignedIn()).toMatchObject({ signedIn: false, text: "nope" });
    answer(async () => {
      throw new Error("spawn claude ENOENT");
    });
    expect((await checkSignedIn()).diagnosis?.kind).toBe("connect");
    answer({ code: 1 });
    expect(await checkSignedIn()).toMatchObject({ signedIn: false, text: "claude exited with code 1" });
    answer({ code: 1, stdout: `${resultLine("", false)}\n`, stderr: "  bad  " });
    expect((await checkSignedIn()).text).toBe("bad");
  });
});

describe("snapshot edges", () => {
  it("a project scope without a tests folder snapshots nothing; markLeft before finish does nothing", () => {
    const empty = join(dir, "..", "empty");
    mkdirSync(empty);
    const rec = takeSnapshot(empty, "run-a", { kind: "project" });
    expect(rec.before).toEqual({});
    markLeft(empty, "run-a", ["x"]);
    expect(readRun(empty, "run-a").after).toBeUndefined();
    expect(() => readRun(empty, "../x")).toThrow(/No Claude run/);
  });

  it("drops an invalid written id, records a deleted test, and revert skips ids it does not know", () => {
    takeSnapshot(dir, "run-b", { kind: "tests", testIds: ["LFRPS12-1398", "LFRPS12-1398", "LFRPS12-1420"] });
    rmSync(join(dir, "tests", "LFRPS12-1398"), { recursive: true });
    const rec = finishSnapshot(dir, "run-b", ["bad id", "LFRPS12-1398"]);
    expect(rec.written).toEqual(["LFRPS12-1398"]);
    expect(rec.after).toEqual({ "LFRPS12-1398": null });
    expect(rec.changedSteps["LFRPS12-1398"].length).toBeGreaterThan(0);
    expect(revert(dir, "run-b", { ids: ["LFRPS12-9999"] })).toEqual([]);
    expect(revert(dir, "run-b")).toEqual(["LFRPS12-1398"]);
    expect(existsSync(join(dir, "tests", "LFRPS12-1398", "test.md"))).toBe(true);
  });

  it("revert leaves a test the run did not change even when it changed later", () => {
    takeSnapshot(dir, "run-c", { kind: "test", testId: "LFRPS12-1420" });
    finishSnapshot(dir, "run-c");
    const f = join(dir, "tests", "LFRPS12-1420", "test.md");
    writeFileSync(f, `${readFileSync(f, "utf8")}\nlater\n`);
    expect(revert(dir, "run-c")).toEqual([]);
    expect(readFileSync(f, "utf8")).toContain("later");
  });

  it("compares steps against a missing side", () => {
    expect(changedStepNumbers("## Step 1\na\n## Step 2\nb\n", null)).toEqual([1, 2]);
    expect(changedStepNumbers(null, null)).toEqual([]);
  });
});

describe("chat edges", () => {
  it("lists nothing without chats, then sorts by last update and skips broken files", () => {
    expect(listChats(dir)).toEqual([]);
    const chats = join(dir, ".testimus", "chats");
    writeJson(join(chats, "chat-1.json"), { id: "chat-1", title: "a", updatedAt: "2026-01-01", turns: [] });
    writeJson(join(chats, "chat-2.json"), { id: "chat-2", title: "b", updatedAt: "2026-02-01", turns: [{}] });
    writeJson(join(chats, "chat-3.json"), { title: "no id" });
    writeFileSync(join(chats, "notes.txt"), "x");
    expect(listChats(dir).map((c) => c.id)).toEqual(["chat-2", "chat-1"]);
  });

  it("reads sources quoted with curly quotes and guillemets, once each", () => {
    expect(sourceRefs('A [D#§1.2. “un texte”] B [D#page:4 : « autre »] C D#fig:3, "x" D#§1.2 “un texte”')).toEqual([
      { docId: "D", anchor: "§1.2", quote: "un texte" },
      { docId: "D", anchor: "page:4", quote: "autre" },
      { docId: "D", anchor: "fig:3", quote: "x" },
    ]);
  });

  it("a failed answer keeps no assistant turn and gives no sources", async () => {
    answer({ code: 1, stdout: `${resultLine("Credit balance is too low", false)}\n` });
    const r = await ask({ project: dir, question: "  Quoi ?  ", model: "haiku", effort: "low" });
    expect(r).toMatchObject({ ok: false, answer: "Credit balance is too low", sources: [] });
    expect(r.diagnosis?.kind).toBe("credit");
  });
});

describe("check edges", () => {
  it("a cancelled batch keeps the last check or runs the mechanical one, without Claude", async () => {
    const r = await checkTests(ctxOf(aborted()), dir, ["LFRPS12-1420", "LFRPS12-1398"], true);
    expect(seen).toEqual([]);
    expect(r.map((x) => [x.id, x.ok, x.summary])).toEqual([
      ["LFRPS12-1420", false, "Cancelled"],
      ["LFRPS12-1398", false, "Cancelled"],
    ]);
  });

  it("a semantic run during which the test changes by other hands warns and keeps it; a finished run without check_record fails", async () => {
    answer(async (s) => {
      const f = join(s.cwd, "tests", "LFRPS12-1420", "test.md");
      writeFileSync(f, `${readFileSync(f, "utf8")}\n`);
      return { code: 0, stdout: `${resultLine("done")}\n`, stderr: "" };
    });
    const r = await checkOne(ctxOf(), dir, "LFRPS12-1420", true);
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/check_record was not called/);
    expect(logs.some((m) => m.includes("LFRPS12-1420 changed while LFRPS12-1420"))).toBe(true);
    expect(promoteChecked(ctxOf(), dir, r)).toBe(r.review);
  });

  it("a failed run carries its diagnosis", async () => {
    answer({ code: 1, stdout: `${resultLine("Invalid API key · Please run /login", false)}\n` });
    const r = await checkOne(ctxOf(), dir, "LFRPS12-1398", true);
    expect(r.diagnosis?.kind).toBe("login");
    expect(r.check.findings.some((f) => f.message.includes("did not finish"))).toBe(true);
  });
});

describe("figures edges", () => {
  it("prompts with the id when there is no code, and lists a figure without caption or section", () => {
    const p = figuresPrompt(
      { id: "X", code: "", title: "" },
      [{ anchor: "fig:1", file: "a.png", caption: "", section: "" }],
      "xx",
    );
    expect(p).toContain("for the document X.");
    expect(p).toContain("- fig:1 — docs/X/a.png\n");
    expect(p).toContain("in xx");
  });

  it("reads a bare object and skips list entries without a description", () => {
    expect(parseFigures('voici {"fig:1": {"description": "Un carré."}}')).toEqual({
      "fig:1": { description: "Un carré." },
    });
    expect(
      parseFigures(
        '```json\n[null, {"anchor": "fig:2", "description": " "}, {"anchor": "3", "description": "Rond"}]\n```',
      ),
    ).toEqual({ "fig:3": { description: "Rond" } });
    expect(parseFigures("```figures\nnot json\n```")).toEqual({});
  });

  it("refuses an unknown document; a cancelled job describes nothing", async () => {
    await expect(describeFigures(dir, "../x", ctxOf())).rejects.toThrow(/No document/);
    const r = await describeFigures(dir, D3, ctxOf(aborted()), { force: true });
    expect(r).toMatchObject({ described: 0, missing: ["fig:40"], runIds: [] });
    expect(seen).toEqual([]);
  });

  it("keeps a figures.json entry doc.md no longer shows", async () => {
    const file = join(dir, "docs", D3, "figures.json");
    const entries = readJson<FigureEntry[]>(file, []);
    writeJson(file, [...entries, { file: "figures/old.png", anchor: "fig:99", caption: "Old", description: "Gone" }]);
    rmSync(join(dir, "docs", D3, "doc.json"));
    answer({ code: 0, stdout: `${resultLine('```figures\n{"fig:40": {"description": "Neuf."}}\n```')}\n` });
    const r = await describeFigures(dir, D3, ctxOf(), { force: true, model: "haiku" });
    expect(r.described).toBe(1);
    expect(seen[0].stdin).toContain(`for the document ${D3}.`);
    const next = readJson<FigureEntry[]>(file, []);
    expect(next.map((e) => [e.anchor, e.description])).toEqual([
      ["fig:40", "Neuf."],
      ["fig:99", "Gone"],
    ]);
  });
});

describe("headers edges", () => {
  const chunk = (id: string, text: string, path = ""): Chunk =>
    ({ id, docId: D3, anchor: "§1", path, text, header: `H ${id}` }) as Chunk;

  it("prompts with a placeholder id without chunks and cuts a long passage", () => {
    expect(headersPrompt({ id: "X", code: "", title: "" }, [], "fr")).toContain('{"<id>": "…"}');
    const p = headersPrompt({ id: "X", code: "C", title: "T" }, [chunk("c1", "y".repeat(1300))], "fr");
    expect(p).toContain("=== c1 (§1)");
    expect(p).toContain(`${"y".repeat(1200)}…`);
  });

  it("skips a list block and a broken block, and answers empty headers without a usable block", () => {
    const cs = [chunk("a", "t"), chunk("b", "t")];
    expect(parseHeaders('```headers\n["a"]\n```\n```headers\n{bad\n```', cs)).toEqual(["", ""]);
    expect(parseHeaders('```json\n{"a": "  un   deux ", "b": 3}\n```', cs)).toEqual(["un deux", ""]);
  });

  it("finds no project for a document nobody knows; a cancelled run throws; nothing to do without chunks", async () => {
    const doc = readDoc(dir, D3);
    expect(projectOfDoc({ ...doc, converted: { with: "", at: "other", warnings: [] } })).toBeNull();
    const p = readProject(dir);
    writeProject(dir, { ...p, rag: { ...p.rag, claudeHeaders: true } as typeof p.rag });
    expect(await claudeHeaders(doc, [], new AbortController().signal, dir)).toEqual([]);
    await expect(claudeHeaders(doc, [chunk("a", "t")], aborted(), dir)).rejects.toThrow("Cancelled.");
    answer({ code: 0, stdout: `${resultLine('```headers\n{"a": "Situé."}\n```')}\n` });
    expect(await claudeHeaders(doc, [chunk("a", "t"), chunk("b", "t")], new AbortController().signal, dir)).toEqual([
      "H a\nSitué.",
      "",
    ]);
  });
});

describe("runClaude edges", () => {
  it("the MCP server is the installed exe as is, or the shim inside a bin folder", () => {
    process.env.TESTIMUS_HOME_BIN = "C:/T/bin/testimus.exe";
    expect(mcpServer()).toMatchObject({ command: "C:/T/bin/testimus.exe", args: ["mcp"] });
    process.env.TESTIMUS_HOME_BIN = "C:/T/bin/testimus.bat";
    expect(mcpServer()).toMatchObject({ command: "cmd", args: ["/c", "C:/T/bin/testimus.bat", "mcp"] });
  });

  it("context dirs: the context folder, a folder path, and the folder of a file path", () => {
    const c = join(dir, "contexts", "c1");
    mkdirSync(c, { recursive: true });
    writeJson(join(c, "context.json"), { name: "C1", paths: ["docs", "docs/missing.txt", "nowhere/x/y.txt"] });
    expect(contextDirs(dir, ["c1", "bad id", "gone"]).sort()).toEqual([c, join(dir, "docs")].sort());
  });

  it("a spawn that throws a non-error, stdout noise as the summary, and the system line left out of raw", async () => {
    answer(async () => {
      throw "kaput";
    });
    const a = await runClaude({ kind: "chat", project: dir, prompt: "p", model: "haiku", effort: "low" });
    expect(a).toMatchObject({ ok: false, summary: "kaput" });
    answer({
      code: 1,
      stdout: `${line({ type: "system", subtype: "init", session_id: "s9" })}\nsomething broke\n`,
    });
    const b = await runClaude({
      kind: "chat",
      project: dir,
      prompt: "p",
      model: "haiku",
      effort: "low",
      jobId: "job-1",
    });
    expect(b).toMatchObject({ ok: false, summary: "something broke", sessionId: "s9" });
    expect(b.raw).not.toContain('"type":"system"');
  });

  it("a successful run with an empty result has an empty summary and no diagnosis", async () => {
    answer({ code: 0, stdout: `${resultLine("")}\n` });
    const r = await runClaude({ kind: "chat", project: dir, prompt: "p", model: "haiku", effort: "low" });
    expect(r).toMatchObject({ ok: true, summary: "", diagnosis: undefined });
  });

  it("a cancelled run says Cancelled", async () => {
    answer({ code: 130, stdout: "" });
    const r = await runClaude({
      kind: "run",
      project: dir,
      prompt: "p",
      model: "haiku",
      effort: "low",
      signal: aborted(),
    });
    expect(r).toMatchObject({ ok: false, summary: "Cancelled" });
  });
});

describe("fix edges", () => {
  it("without any note asks to fix the findings; a failed run keeps the state and carries its diagnosis", async () => {
    answer({ code: 1, stdout: `${resultLine("Claude usage limit reached.", false)}\n` });
    const r = await fixTest(ctxOf(), dir, "LFRPS12-1420", { semantic: false });
    expect(seen[0].stdin).toContain("No reviewer's note: fix what the findings ask.");
    expect(r).toMatchObject({ ok: false, review: "checked", changedSteps: [] });
    expect(r.diagnosis?.kind).toBe("limit");
  });

  it("a fix that changes a validated test with only the mechanical re-check sends it back to to-fix", async () => {
    answer(async (s) => {
      const f = join(s.cwd, "tests", "LFRPS12-1398", "test.md");
      writeFileSync(f, `${readFileSync(f, "utf8")}\n`);
      return { code: 0, stdout: `${resultLine("fixed")}\n`, stderr: "" };
    });
    const r = await fixTest(ctxOf(), dir, "LFRPS12-1398", { note: "x", semantic: false });
    expect(r).toMatchObject({ ok: true, review: "to-fix" });
    expect(r.message).toMatch(/only the mechanical check ran/);
  });

  it("a fix that changes only the summary reports the test changed and no step", async () => {
    answer(async (s) => {
      const f = join(s.cwd, "tests", "LFRPS12-1398", "test.md");
      writeFileSync(
        f,
        readFileSync(f, "utf8").replace(
          "summary: Disjoncteur — ouverture à distance",
          "summary: Disjoncteur — ouverture depuis le PCC",
        ),
      );
      return { code: 0, stdout: `${resultLine("renamed")}\n`, stderr: "" };
    });
    const r = await fixTest(ctxOf(), dir, "LFRPS12-1398", { note: "summary", semantic: false });
    expect(r).toMatchObject({ ok: true, changedTests: ["LFRPS12-1398"], changedSteps: [] });
  });
});
