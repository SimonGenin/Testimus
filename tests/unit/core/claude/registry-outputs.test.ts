import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-actions.ts";
import "../../../../src/core/mock/claude-check.ts";
import "../../../../src/core/mock/claude-gen.ts";
import { markIndexedInDb } from "../../helpers/index-state.ts";
import { call, fixtureCopy } from "../registry.ts";

// ponytail: every command that starts Claude, called through the registry against the scripted Claude of --mock; `call`
// fails when an output does not pass the command's own schema

const real = env.spawnClaude;
const realDelay = process.env.TESTIMUS_MOCK_CLAUDE_MS;
let P = "";

beforeEach(() => {
  P = fixtureCopy("claude-outputs");
  markIndexedInDb(P);
  resetProbe();
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "claude" } });
  env.spawnClaude = mockSpawnClaude;
  process.env.TESTIMUS_MOCK_CLAUDE_MS = "0";
});
afterEach(() => {
  env.spawnClaude = real;
  if (realDelay === undefined) delete process.env.TESTIMUS_MOCK_CLAUDE_MS;
  else process.env.TESTIMUS_MOCK_CLAUDE_MS = realDelay;
  resetProbe();
});

const DOC = "SOSIE_211_D401-1_3";
const TEST = "LFRPS12-1420";

describe("claude.*", () => {
  it("status, run on a step, then revert", async () => {
    expect(await call("claude.status", {}, null)).toMatchObject({ installed: true, signedIn: null });
    const r = await call<{ runId: string; ok: boolean; changedTests: string[] }>(
      "claude.run",
      { scope: { kind: "step", testId: TEST, step: 1 }, prompt: "Say what to check first" },
      P,
    );
    expect(r.ok).toBe(true);
    expect(r.changedTests).toEqual([TEST]);
    expect(await call("claude.before", { testId: TEST }, P)).toMatchObject({
      runId: r.runId,
      test: { steps: expect.any(Array) },
    });
    expect(await call("claude.revert", { runId: r.runId }, P)).toEqual({ reverted: [TEST], files: [] });
    expect(await call("claude.before", { testId: TEST }, P)).toBeNull();
  });
});

describe("chat.*", () => {
  it("ask, list, show", async () => {
    const a = await call<{ chatId: string; ok: boolean; sources: unknown[] }>(
      "chat.ask",
      { question: "Que propose le menu contextuel d'un sectionneur ?" },
      P,
    );
    expect(a.ok).toBe(true);
    expect(a.sources.length).toBeGreaterThan(0);
    expect(await call<{ id: string }[]>("chat.list", {}, P)).toEqual([expect.objectContaining({ id: a.chatId })]);
    expect(await call("chat.show", { chatId: a.chatId }, P)).toMatchObject({ id: a.chatId, turns: [{}, {}] });
  });
});

describe("check.* and review.*", () => {
  it("run, show, record; set, queue, fix, evidence", async () => {
    expect(await call("check.run", { ids: [TEST] }, P)).toMatchObject({ semantic: "done", failed: [] });
    expect(await call("check.show", { id: TEST }, P)).toMatchObject({ id: TEST, stale: false });
    expect(await call("check.record", { id: TEST, findings: [] }, P)).toMatchObject({ findings: expect.any(Array) });
    expect(await call("review.set", { id: TEST, decision: "validate" }, P)).toMatchObject({ review: "validated" });
    expect(await call("review.queue", { state: ["validated"] }, P)).toMatchObject({ counts: expect.any(Object) });
    expect(await call("review.fix", { id: TEST, note: "Le step 2 doit nommer les commandes." }, P)).toMatchObject({
      ok: true,
    });
    expect(await call("review.evidence", { testId: TEST }, P)).toMatchObject({ testId: TEST });
  });
});

describe("gen.*, docs.describeFigures", () => {
  it("generate from a section, then describe a document's figures", async () => {
    const g = await call<{ ok: boolean; tests: string[] }>(
      "gen.tests",
      { sections: [`${DOC}#§5.6.6`], check: false },
      P,
    );
    expect(g.ok).toBe(true);
    expect(g.tests.length).toBeGreaterThan(0);
    expect(await call("gen.preview", {}, P)).toMatchObject({ replaces: expect.arrayContaining(g.tests) });
    const f = await call<{ docs: { docId: string }[] }>("docs.describeFigures", { docId: DOC }, P);
    expect(f.docs.map((d) => d.docId)).toEqual([DOC]);
  });
});

describe("actions.*", () => {
  it("propose, show, run, dismiss; triage a document", async () => {
    const a = await call<{ id: string }>(
      "actions.propose",
      {
        title: "Cite the source of step 2",
        scope: { kind: "step", testId: TEST, step: 2 },
        problem: "Step 2 has no source",
        why: "The behaviour is in §5.6.6.",
        plan: ["Find the passage", "Add the source line"],
      },
      P,
    );
    expect(await call("actions.show", { id: a.id }, P)).toMatchObject({ id: a.id, state: "open" });
    expect(await call("actions.run", { id: a.id }, P)).toMatchObject({ ok: true, action: { id: a.id } });
    expect(await call("actions.dismiss", { id: a.id }, P)).toMatchObject({ state: "dismissed" });
    expect(await call("actions.triage", { docId: DOC }, P)).toMatchObject({ ok: true });
  });
});
