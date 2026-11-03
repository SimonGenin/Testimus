import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diagnose, trouble } from "../../src/core/claude/diagnose.ts";
import {
  checkSignedIn,
  claudeAnswered,
  claudeVersion,
  resetProbe,
  VERSION_TIMEOUT_MS,
} from "../../src/core/claude/status.ts";
import { invoke } from "../../src/core/commands/index.ts";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../src/core/lib/project.ts";

const real = env.spawnClaude;
let calls: ClaudeSpawn[] = [];

function canned(out: Partial<ClaudeOut> | (() => never)) {
  env.spawnClaude = async (s) => {
    calls.push(s);
    if (typeof out === "function") out();
    return { code: 0, stdout: "", stderr: "", ...(out as Partial<ClaudeOut>) };
  };
}

const setExe = (exe: string) => writeSettings({ ...DEFAULT_SETTINGS, claude: { exe } });

beforeEach(() => {
  calls = [];
  resetProbe();
  setExe("C:/bin/claude.exe");
});
afterEach(() => {
  env.spawnClaude = real;
});

describe("diagnose (ported from Xray Editor)", () => {
  it("picks what went wrong from what the CLI said", () => {
    expect(trouble("claude executable not found on PATH")).toBe("connect");
    expect(trouble("spawn claude ENOENT")).toBe("connect");
    expect(trouble("'claude' is not recognized as an internal or external command")).toBe("connect");

    expect(trouble("Invalid API key · Please run /login")).toBe("login");
    expect(trouble("OAuth token has expired. Please sign in again.")).toBe("login");
    expect(trouble('API Error: 401 {"error":{"message":"unauthorized"}}')).toBe("login");

    expect(trouble("Credit balance is too low to run this request")).toBe("credit");
    expect(trouble("Your organization has insufficient funds — billing required")).toBe("credit");

    expect(trouble("Claude usage limit reached. Your limit resets at 3pm.")).toBe("limit");
    expect(trouble("API Error: 429 too many requests")).toBe("limit");

    expect(trouble("fetch failed: getaddrinfo ENOTFOUND api.anthropic.com")).toBe("network");
    expect(trouble('API Error: 529 {"type":"overloaded_error"}')).toBe("network");
    expect(trouble("unable to verify the first certificate")).toBe("network");

    expect(trouble("I rephrased step 1 and left the ids alone.")).toBe(null);
    expect(trouble("")).toBe(null);
  });

  it("says it in the user's terms", () => {
    expect(diagnose("Invalid API key · Please run /login")).toMatchObject({ kind: "login", title: expect.any(String) });
    expect(diagnose("all good")).toBeUndefined();
  });

  it("gives each kind its exact plain-word title and detail (PARITY #81)", () => {
    expect(diagnose("spawn claude ENOENT")).toEqual({
      kind: "connect",
      title: "Claude Code is not installed or not found.",
      detail: "Install the Claude Code CLI, sign in once in a terminal, or set its path in Settings.",
    });
    expect(diagnose("Not logged in · Please run /login")).toEqual({
      kind: "login",
      title: "Claude Code is not signed in.",
      detail: "Run `claude` once in a terminal and sign in with your Claude account, then retry.",
    });
    expect(diagnose("Credit balance is too low")).toEqual({
      kind: "credit",
      title: "Your Claude account has no credit left.",
      detail: "Check the plan or the billing of the account Claude Code is signed in with.",
    });
    expect(diagnose("Claude usage limit reached. Your limit resets at 3pm.")).toEqual({
      kind: "limit",
      title: "Claude usage limit reached.",
      detail: "Wait until the limit resets (the message below says when), then retry.",
    });
    expect(diagnose("fetch failed: getaddrinfo ENOTFOUND api.anthropic.com")).toEqual({
      kind: "network",
      title: "Claude could not be reached.",
      detail: "Check the network or the proxy (HTTPS_PROXY), then retry. Overloaded servers clear up in minutes.",
    });
    expect(diagnose("Claude wrote something odd")).toBeUndefined();
  });
});

describe("version probe", () => {
  it("answers once per exe, is refreshable, and never throws", async () => {
    canned({ stdout: "2.1.316 (Claude Code)\nsecond line\n" });
    expect(await claudeVersion()).toEqual({ ok: true, text: "2.1.316 (Claude Code)" });
    await claudeVersion();
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["--version"]);
    expect(calls[0].exe).toBe("C:/bin/claude.exe");

    setExe("D:/tools/claude.cmd");
    await claudeVersion();
    expect(calls).toHaveLength(2);
    await claudeVersion(true);
    expect(calls).toHaveLength(3);

    canned({ code: 1, stderr: "claude executable not found on PATH" });
    expect(await claudeVersion(true)).toEqual({ ok: false, text: "claude executable not found on PATH" });

    canned(() => {
      throw new Error("spawn claude ENOENT");
    });
    expect(await claudeVersion(true)).toMatchObject({ ok: false, text: "spawn claude ENOENT" });

    canned({ code: 1 });
    expect(await claudeVersion(true)).toEqual({ ok: false, text: "claude exited with code 1" });
    claudeAnswered();
    expect(await claudeVersion()).toMatchObject({ ok: true });
  });
});

describe("version probe limits (N7)", () => {
  const hang = () => {
    env.spawnClaude = (s) =>
      new Promise<ClaudeOut>((resolve) => {
        calls.push(s);
        s.signal?.addEventListener("abort", () => resolve({ code: 130, stdout: "", stderr: "killed" }), {
          once: true,
        });
      });
  };

  it("gives up after the timeout and kills the claude that hangs; the failure is not kept", async () => {
    vi.useFakeTimers();
    try {
      hang();
      const p = claudeVersion();
      await vi.advanceTimersByTimeAsync(VERSION_TIMEOUT_MS + 10);
      expect(await p).toEqual({ ok: false, text: "claude --version did not answer in 10 s" });
      expect(calls[0].signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    canned({ stdout: "2.1.316 (Claude Code)\n" });
    expect(await claudeVersion()).toEqual({ ok: true, text: "2.1.316 (Claude Code)" });
    expect(calls).toHaveLength(2);
    await claudeVersion();
    expect(calls).toHaveLength(2);
  });

  it("a failure is asked again; concurrent askers share one claude --version", async () => {
    canned({ code: 1, stderr: "boom" });
    const [a, b] = await Promise.all([claudeVersion(), claudeVersion()]);
    expect(a).toEqual({ ok: false, text: "boom" });
    expect(b).toBe(a);
    expect(calls).toHaveLength(1);
    await claudeVersion();
    expect(calls).toHaveLength(2);
  });

  it("a caller's cancel ends its own wait, not the shared probe", async () => {
    hang();
    const ctl = new AbortController();
    const mine = claudeVersion(false, ctl.signal);
    const other = claudeVersion();
    ctl.abort();
    await expect(mine).rejects.toThrow(/Cancelled/);
    expect(calls[0].signal?.aborted).toBe(false);
    resetProbe();
    void other;
  });
});

describe("claude.status", () => {
  it("not installed: the diagnosis and the two commands to connect", async () => {
    canned(() => {
      throw new Error("spawn claude ENOENT");
    });
    const s = (await invoke("claude.status", {}, { project: null })) as Record<string, unknown>;
    expect(s).toMatchObject({ installed: false, signedIn: false, diagnosis: { kind: "connect" } });
    expect((s.connect as { cmd: string }[]).map((c) => c.cmd)).toEqual([
      "irm https://claude.ai/install.ps1 | iex",
      "claude",
    ]);
  });

  it("installed, sign-in unchecked unless asked; then a tiny run decides", async () => {
    canned({ stdout: "2.1.316 (Claude Code)\n" });
    expect(await invoke("claude.status", {}, { project: null })).toMatchObject({
      installed: true,
      version: "2.1.316",
      signedIn: null,
    });
    const ok = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok", session_id: "x" });
    canned({ stdout: `${ok}\n` });
    expect(await checkSignedIn()).toMatchObject({ signedIn: true, text: "ok" });
    expect(calls.at(-1)?.stdin).toBe("reply ok");
    const bad = JSON.stringify({ type: "result", is_error: true, result: "Invalid API key · Please run /login" });
    canned({ code: 1, stdout: `${bad}\n` });
    expect(await invoke("claude.status", { signIn: true }, { project: null })).toMatchObject({
      installed: true,
      signedIn: false,
      diagnosis: { kind: "login" },
    });
  });
});
