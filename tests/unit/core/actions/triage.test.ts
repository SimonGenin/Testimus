import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { showJob, startJob, waitJob } from "../../../../src/core/jobs.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { call, fixtureCopy } from "../registry.ts";

const real = env.spawnClaude;
let P = "";
let seen: ClaudeSpawn[] = [];

const answer = (s: ClaudeSpawn, text: string) => {
  const l = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, session_id: "s" });
  s.onLine?.(l);
  return { code: 0, stdout: `${l}\n`, stderr: "" };
};

function claudeHere() {
  env.spawnClaude = async (s) => {
    seen.push(s);
    if (s.args.includes("--version")) return { code: 0, stdout: "2.1.0 (Claude Code)\n", stderr: "" };
    return answer(s, "0 actions proposed.");
  };
}

function claudeAbsent() {
  env.spawnClaude = async (s) => {
    seen.push(s);
    throw new Error("spawn claude ENOENT");
  };
}

async function failedJob(kind: string): Promise<string> {
  const { job, done } = startJob(kind, "the subject", P, async () => {
    throw new Error("it broke");
  });
  await done.catch(() => {});
  return job.id;
}

beforeEach(() => {
  P = fixtureCopy("triage");
  seen = [];
  resetProbe();
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "claude" } });
});
afterEach(() => {
  env.spawnClaude = real;
  resetProbe();
});

type Decision = { triage: string | null; why: string };

describe("actions.triageFailed: the core decides whether Claude looks at a failed job", () => {
  it("starts one cheap triage job for a failed documents job, linked to it, once", async () => {
    claudeHere();
    const failed = await failedJob("docs.convert");
    const d = await call<Decision>("actions.triageFailed", { jobId: failed }, P);
    expect(d.triage).toMatch(/^actions-triage-/);
    const shown = showJob(P, d.triage ?? "");
    expect(shown?.job).toMatchObject({
      kind: "actions.triage",
      cause: { jobId: failed, why: "after-failure" },
      rerun: { name: "actions.triage", input: { jobId: failed } },
    });
    expect(await waitJob(d.triage ?? "")).toMatchObject({ ok: true, summary: "0 actions proposed." });
    const run = seen.find((s) => !s.args.includes("--version"));
    expect(run?.args[run.args.indexOf("--effort") + 1]).toBe("low");
    expect(run?.stdin).toContain(`[job:${failed}] docs.convert the subject failed: it broke`);

    expect(await call<Decision>("actions.triageFailed", { jobId: failed }, P)).toEqual({
      triage: null,
      why: `Claude already looked at the job ${failed}.`,
    });
  });

  it("never shows Claude a Claude run, a Jira call or a job that did not fail", async () => {
    claudeHere();
    for (const kind of ["claude", "xray.pull", "actions.triage"]) {
      const id = await failedJob(kind);
      const d = await call<Decision>("actions.triageFailed", { jobId: id }, P);
      expect(d.triage).toBeNull();
      expect(d.why).toContain(`A ${kind} job is not shown to Claude`);
    }
    const { job, done } = startJob("check", "fine", P, async () => ({}));
    await done;
    expect(await call<Decision>("actions.triageFailed", { jobId: job.id }, P)).toEqual({
      triage: null,
      why: `The job ${job.id} did not fail (done).`,
    });
    expect(seen).toEqual([]);
  });

  it("does nothing without Claude, and refuses an unknown job", async () => {
    claudeAbsent();
    const failed = await failedJob("rag.index");
    expect(await call<Decision>("actions.triageFailed", { jobId: failed }, P)).toEqual({
      triage: null,
      why: "Claude Code is not connected.",
    });
    await expect(call("actions.triageFailed", { jobId: "nope" }, P)).rejects.toThrow("No job nope in this project.");
  });
});

describe("actions.triage without Claude", () => {
  it("says nothing was looked at instead of failing", async () => {
    claudeAbsent();
    const failed = await failedJob("generate");
    const r = await call("actions.triage", { jobId: failed }, P);
    expect(r).toEqual({
      ok: false,
      summary: "Claude Code is not connected: nothing was looked at.",
      proposed: [],
      skipped: true,
    });
    expect(seen.every((s) => s.args.includes("--version"))).toBe(true);
  });

  it("a document without warnings has nothing to look at", async () => {
    claudeHere();
    const r = await call("actions.triage", { docId: "SOSIE_211_D401-1_4" }, P);
    expect(r).toMatchObject({ ok: true, summary: "No problem to look at.", proposed: [], skipped: true });
  });

  it("needs a document or a job, not both", async () => {
    await expect(call("actions.triage", {}, P)).rejects.toThrow("Give either docId or jobId.");
  });
});
