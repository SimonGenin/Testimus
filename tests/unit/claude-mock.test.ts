import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../src/core/claude/status.ts";
import { find, invoke } from "../../src/core/commands/index.ts";
import { env } from "../../src/core/env.ts";
import { showJob } from "../../src/core/jobs.ts";
import { mockSpawnClaude } from "../../src/core/mock/claude.ts";
import type { ClaudeEvent } from "../../src/core/types.ts";
import { callTool } from "../../src/faces/mcp.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/project/", import.meta.url));
const real = env.spawnClaude;

function copyFixture(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "testimus-mockc-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  env.spawnClaude = mockSpawnClaude;
  resetProbe();
});
afterEach(() => {
  env.spawnClaude = real;
  delete process.env.TESTIMUS_MOCK_CLAUDE;
});

describe("scripted Claude (serve --mock)", () => {
  it("claude.run on a step streams, edits that step, and can be reverted", async () => {
    const dir = copyFixture();
    const file = join(dir, "tests", "LFRPS12-1420", "test.md");
    const before = readFileSync(file, "utf8");
    const events: ClaudeEvent[] = [];
    const r = (await invoke(
      "claude.run",
      { scope: { kind: "step", testId: "LFRPS12-1420", step: 2 }, prompt: "Rephrase." },
      { project: dir, onClaude: (e) => events.push(e) },
    )) as {
      ok: boolean;
      runId: string;
      changedTests: string[];
      changedSteps: Record<string, number[]>;
      sessionId: string;
    };
    expect(r).toMatchObject({ ok: true, changedTests: ["LFRPS12-1420"], changedSteps: { "LFRPS12-1420": [2] } });
    expect(r.sessionId).toMatch(/^mock-session-/);
    expect(readFileSync(file, "utf8")).toContain("Clic droit sur le sectionneur S 12 de la vue de traction. Vérifier");
    await invoke("claude.revert", { runId: r.runId }, { project: dir });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("chat.ask cites fixture sources that exist verbatim in doc.md", async () => {
    const dir = copyFixture();
    const r = (await invoke("chat.ask", { question: "Que propose le menu ?" }, { project: dir })) as {
      ok: boolean;
      sources: { docId: string; anchor: string; quote: string }[];
      chatId: string;
    };
    expect(r.ok).toBe(true);
    expect(r.sources.length).toBe(2);
    const doc = readFileSync(join(dir, "docs", "SOSIE_211_D401-1_3", "doc.md"), "utf8");
    for (const s of r.sources) expect(doc).toContain(s.quote);
    const again = (await invoke("chat.ask", { question: "Et ?", chatId: r.chatId }, { project: dir })) as {
      sessionId: string;
    };
    const first = (await invoke("chat.show", { chatId: r.chatId }, { project: dir })) as { sessionId: string };
    expect(again.sessionId).toBe(first.sessionId);
  });

  it("simulates a missing and a signed-out Claude", async () => {
    process.env.TESTIMUS_MOCK_CLAUDE = "absent";
    expect(await invoke("claude.status", {}, { project: null })).toMatchObject({
      installed: false,
      diagnosis: { kind: "connect" },
    });
    process.env.TESTIMUS_MOCK_CLAUDE = "logged-out";
    resetProbe();
    expect(await invoke("claude.status", { signIn: true }, { project: null })).toMatchObject({
      installed: true,
      signedIn: false,
      diagnosis: { kind: "login" },
    });
    const dir = copyFixture();
    expect(await invoke("chat.ask", { question: "Q" }, { project: dir })).toMatchObject({
      ok: false,
      diagnosis: { kind: "login" },
    });
  });

  it("cancel stops the scripted run and reports Cancelled", async () => {
    const dir = copyFixture();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);
    const r = await invoke(
      "claude.run",
      { scope: { kind: "test", testId: "LFRPS12-1398" }, prompt: "x" },
      { project: dir, signal: ctrl.signal },
    );
    expect(r).toMatchObject({ ok: false, summary: "Cancelled" });
  });

  it("the MCP face turns job progress into progress notifications when asked", async () => {
    const dir = copyFixture();
    const sent: { method: string; params?: Record<string, unknown> }[] = [];
    const r = await callTool(
      find("claude.run"),
      dir,
      { scope: { kind: "test", testId: "LFRPS12-1398" }, prompt: "x" },
      {
        mcpReq: {
          signal: new AbortController().signal,
          _meta: { progressToken: "tok" },
          notify: async (n) => {
            sent.push(n);
          },
        },
      },
    );
    expect(r).toMatchObject({ ok: true });
    expect(sent[0]).toEqual({
      method: "notifications/progress",
      params: { progressToken: "tok", progress: 1, message: "Claude on LFRPS12-1398" },
    });
    expect(showJob(dir, "nope")).toBeNull();
  });
});
