import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actionPrompt, proposeLines, triagePrompt } from "../../src/core/claude/actions.ts";
import { checkPrompt } from "../../src/core/claude/check.ts";
import { mcpAccess } from "../../src/core/claude/run.ts";
import { invoke } from "../../src/core/commands/index.ts";
import { type ClaudeSpawn, env } from "../../src/core/env.ts";
import { listActions, proposeAction, stampOf, whereOf } from "../../src/core/lib/actions.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../src/core/lib/project.ts";
import type { ClaudeAction } from "../../src/core/types.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/project/", import.meta.url));
const DOC = "SOSIE_211_D401-1_3";
const TEST = "LFRPS12-1420";

function copyFixture(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "testimus-actions-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

const line = (m: unknown) => JSON.stringify(m);
const result = (r: string) =>
  line({ type: "result", subtype: "success", is_error: false, result: r, session_id: "s-1", duration_ms: 500 });

let seen: ClaudeSpawn[] = [];
const real = env.spawnClaude;

function fake(answer: string, during?: (s: ClaudeSpawn) => void | Promise<void>) {
  env.spawnClaude = async (s) => {
    seen.push(s);
    await during?.(s);
    const lines = [line({ type: "system", subtype: "init", session_id: "s-1" }), result(answer)];
    for (const l of lines) s.onLine?.(l);
    return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
  };
}

const runIdOf = (prompt: string) => prompt.match(/runId: "([\w-]+)"/)?.[1] ?? "";

let dir = "";
beforeEach(() => {
  seen = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  dir = copyFixture();
});
afterEach(() => {
  env.spawnClaude = real;
});

const proposal = (over: Partial<ClaudeAction> = {}) => ({
  title: "Cite the source of step 2",
  scope: { kind: "step" as const, testId: TEST, step: 2 },
  problem: "Step 2 has no source",
  why: "The behaviour is in §5.6.6.",
  plan: ["Find the passage", "Add the source line"],
  proposedBy: { run: "check", model: "opus", effort: "high" as const, at: "2026-11-03T10:00:00Z" },
  ...over,
});

describe("the action store", () => {
  it("places a problem from the scope, and stamps the state it was seen on", () => {
    expect(whereOf({ kind: "step", testId: TEST, step: 1 })).toBe(`test:${TEST}`);
    expect(whereOf({ kind: "doc", docId: DOC })).toBe(`doc:${DOC}`);
    expect(whereOf({ kind: "tests", testIds: [TEST] })).toBe("project");
    expect(stampOf(dir, `doc:${DOC}`)).toMatch(/^[0-9a-f]{16}$/);
    expect(stampOf(dir, "doc:NOPE")).toBe("gone");
    expect(stampOf(dir, "job:job-1")).toBe("gone");
    expect(stampOf(dir, "project")).toBe("project");
  });

  it("keeps one open action per problem, hides it once the test changed, and remembers a dismissal", () => {
    const a = proposeAction(dir, proposal());
    const b = proposeAction(dir, proposal({ title: "Add the missing source" }));
    expect(b.id).toBe(a.id);
    expect(listActions(dir).map((x) => x.title)).toEqual(["Add the missing source"]);
    expect(listActions(dir, { testId: TEST })).toHaveLength(1);
    expect(listActions(dir, { docId: DOC })).toHaveLength(0);

    const f = join(dir, "tests", TEST, "test.md");
    writeFileSync(f, `${readFileSync(f, "utf8")}\n`);
    expect(listActions(dir)).toEqual([]);
    expect(listActions(dir, { all: true })[0].stale).toBe(true);

    const c = proposeAction(dir, proposal());
    expect(c.id).not.toBe(a.id);
    return invoke("actions.dismiss", { id: c.id }, { project: dir }).then(() => {
      expect(proposeAction(dir, proposal()).ignored).toBe(true);
      expect(listActions(dir)).toEqual([]);
    });
  });

  it("refuses a place that does not exist", () => {
    expect(() => proposeAction(dir, proposal({ scope: { kind: "doc", docId: "NOPE" } }))).toThrow(/does not exist/);
  });
});

describe("prompts", () => {
  it("tell the proposing run its runId and the shape of a proposal", () => {
    const lines = proposeLines("run-1", "a finding").join("\n");
    expect(lines).toContain('runId: "run-1"');
    expect(lines).toContain("actions_propose");
    expect(checkPrompt(TEST, [], "fr", "run-2")).toContain('runId: "run-2"');
    expect(checkPrompt(TEST, [], "fr")).not.toContain("actions_propose");
    const t = triagePrompt("run-3", [{ where: `doc:${DOC}`, text: "Figure 41 is lost" }], "the document", "fr");
    expect(t).toMatch(/^Testimus triage/);
    expect(t).toContain(`- [doc:${DOC}] Figure 41 is lost`);
  });

  it("gives an action its problem, plan and the rule about Jira", () => {
    const a = proposeAction(dir, proposal());
    const p = actionPrompt(dir, a, []);
    expect(p).toMatch(/^Testimus Claude action act-/);
    expect(p).toContain("Problem (test:LFRPS12-1420): Step 2 has no source");
    expect(p).toContain("- Add the source line");
    expect(p).toContain("Never write to Jira");
  });
});

describe("tool access of an action", () => {
  it("is the whole command set minus another Claude run, Jira writes and the machine", async () => {
    const a = await mcpAccess("action");
    const has = (n: string) => a.allow.includes(`mcp__testimus__${n}`);
    for (const n of ["docs_convert", "docs_set", "project_set", "tests_save", "columns_save", "check_run", "xray_plan"])
      expect(has(n), n).toBe(true);
    for (const n of ["claude_run", "actions_run", "gen_tests", "chat_ask", "xray_push", "system_setup", "project_open"])
      expect(has(n), n).toBe(false);
  });
});

describe("actions.propose, actions.run and the revert", () => {
  it("records which run proposed it, from that run's runId", async () => {
    fake("1 action", async (s) => {
      const runId = runIdOf(s.stdin);
      await invoke(
        "actions.propose",
        {
          runId,
          where: `doc:${DOC}`,
          problem: "Figure 41 is a shape drawn in Word: only its labels survive",
          title: "Recover figure 41 from the PDF",
          why: "The PDF rendering has the drawing.",
          plan: ["Find the PDF", "Convert again"],
          scope: { kind: "doc", docId: DOC },
        },
        { project: dir },
      );
    });
    const r = (await invoke("actions.triage", { docId: DOC, model: "haiku", effort: "low" }, { project: dir })) as {
      proposed: ClaudeAction[];
    };
    expect(seen[0].stdin).toContain("Figure 41 is a shape drawn in Word");
    expect(r.proposed).toHaveLength(1);
    expect(r.proposed[0].proposedBy).toMatchObject({ run: "import", model: "haiku", effort: "low" });
  });

  it("runs with the whole command set, snapshots the document folder, and reverts it", async () => {
    const a = proposeAction(dir, proposal({ scope: { kind: "doc", docId: DOC }, where: `doc:${DOC}` }));
    const ctxFile = join(dir, "docs", DOC, "context.md");
    const before = readFileSync(ctxFile, "utf8");
    const pdf = join(dir, "docs", DOC, "source.pdf");
    fake("Done: the PDF is attached.", (s) => {
      writeFileSync(ctxFile, "changed by the action\n");
      writeFileSync(pdf, "%PDF-1.4");
      expect(s.args.join(" ")).toContain("mcp__testimus__docs_convert");
    });
    const r = (await invoke("actions.run", { id: a.id, model: "sonnet", effort: "high" }, { project: dir })) as {
      runId: string;
      ok: boolean;
      action: ClaudeAction;
    };
    expect(r.ok).toBe(true);
    expect(r.action.state).toBe("done");
    expect(r.action.last).toMatchObject({ ok: true, model: "sonnet", effort: "high" });
    expect(seen[0].stdin).toMatch(/^Testimus Claude action/);

    const back = (await invoke("claude.revert", { runId: r.runId }, { project: dir })) as { files: string[] };
    expect(back.files.sort()).toEqual([`docs/${DOC}/context.md`, `docs/${DOC}/source.pdf`]);
    expect(readFileSync(ctxFile, "utf8")).toBe(before);
    expect(existsSync(pdf)).toBe(false);
  });

  it("refuses to revert a file edited after the action, unless forced", async () => {
    const a = proposeAction(dir, proposal({ scope: { kind: "project" }, where: "project" }));
    const pj = join(dir, "project.json");
    const before = readFileSync(pj, "utf8");
    fake("Done.", () => writeFileSync(pj, before.replace('"language"', '"language2"')));
    const r = (await invoke("actions.run", { id: a.id }, { project: dir })) as { runId: string };
    writeFileSync(pj, "{}\n");
    await expect(invoke("claude.revert", { runId: r.runId }, { project: dir })).rejects.toThrow(
      /project\.json changed/,
    );
    await invoke("claude.revert", { runId: r.runId, force: true }, { project: dir });
    expect(readFileSync(pj, "utf8")).toBe(before);
  });

  it("keeps the action open when the run fails", async () => {
    const a = proposeAction(dir, proposal());
    env.spawnClaude = async () => ({ code: 1, stdout: "", stderr: "boom" });
    const r = (await invoke("actions.run", { id: a.id }, { project: dir })) as { ok: boolean; action: ClaudeAction };
    expect(r.ok).toBe(false);
    expect(r.action.state).toBe("open");
    expect(r.action.last?.ok).toBe(false);
  });
});

describe("docs.convert --pdf", () => {
  it("refuses a file that is not a PDF", async () => {
    await expect(invoke("docs.convert", { id: DOC, pdf: join(dir, "project.json") }, { project: dir })).rejects.toThrow(
      /Not a \.pdf/,
    );
  });
});
