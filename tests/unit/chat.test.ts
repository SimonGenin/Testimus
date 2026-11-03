import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sourceRefs } from "../../src/core/claude/chat.ts";
import { invoke } from "../../src/core/commands/index.ts";
import { type ClaudeSpawn, env } from "../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../src/core/lib/project.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/project/", import.meta.url));
const real = env.spawnClaude;
let calls: ClaudeSpawn[] = [];

function copyFixture(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "testimus-chat-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function answers(...replies: { text: string; session: string; error?: boolean }[]) {
  let i = 0;
  env.spawnClaude = async (s) => {
    calls.push(s);
    const r = replies[Math.min(i++, replies.length - 1)];
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: !!r.error,
      result: r.text,
      session_id: r.session,
      total_cost_usd: 0.02,
    });
    s.onLine?.(line);
    return { code: r.error ? 1 : 0, stdout: `${line}\n`, stderr: "" };
  };
}

beforeEach(() => {
  calls = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
});
afterEach(() => {
  env.spawnClaude = real;
});

const ANSWER =
  'Le menu diffère selon le type [SOSIE_211_D401-1_3#§5.6.6 "Selon le type de sectionneur, le menu contextuel diffère"]. ' +
  'Sans TK : [SOSIE_211_D401-1_3#§5.6.6 "Le menu contextuel d\'un sectionneur sans TK propose"].';

describe("source refs", () => {
  it('parses docId#anchor "quote" in the three anchor kinds and the usual quote marks', () => {
    expect(sourceRefs(ANSWER)).toEqual([
      {
        docId: "SOSIE_211_D401-1_3",
        anchor: "§5.6.6",
        quote: "Selon le type de sectionneur, le menu contextuel diffère",
      },
      {
        docId: "SOSIE_211_D401-1_3",
        anchor: "§5.6.6",
        quote: "Le menu contextuel d'un sectionneur sans TK propose",
      },
    ]);
    expect(
      sourceRefs("voir D401#fig:40 « Figure 40 – Représentation » et D401#fig:40 « Figure 40 – Représentation »"),
    ).toEqual([{ docId: "D401", anchor: "fig:40", quote: "Figure 40 – Représentation" }]);
    expect(sourceRefs("no source here, nor here#§1 without quote")).toEqual([]);
  });
});

describe("chat.ask", () => {
  it("runs the ask-docs skill read-only, stores the conversation, then resumes its session", async () => {
    const dir = copyFixture();
    answers({ text: ANSWER, session: "sess-1" }, { text: "Oui.", session: "sess-1" });
    const first = (await invoke(
      "chat.ask",
      { question: "Que propose le menu d'un sectionneur ?" },
      { project: dir },
    )) as {
      chatId: string;
      sessionId: string;
      ok: boolean;
      sources: unknown[];
    };
    expect(first).toMatchObject({ ok: true, sessionId: "sess-1", answer: ANSWER, costUsd: 0.02 });
    expect(first.sources).toHaveLength(2);
    expect(calls[0].stdin).toContain("ask-docs");
    expect(calls[0].stdin).toContain("Question: Que propose le menu d'un sectionneur ?");
    expect(calls[0].args).not.toContain("--resume");
    const tools = calls[0].args[calls[0].args.indexOf("--tools") + 1];
    expect(tools).toBe("Read,Glob,Grep,Skill");

    await invoke("chat.ask", { question: "Et avec TK ?", chatId: first.chatId }, { project: dir });
    expect(calls[1].args.slice(-2)).toEqual(["--resume", "sess-1"]);

    const show = (await invoke("chat.show", { chatId: first.chatId }, { project: dir })) as {
      sessionId: string;
      turns: { role: string }[];
    };
    expect(show.sessionId).toBe("sess-1");
    expect(show.turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(await invoke("chat.list", {}, { project: dir })).toEqual([
      { id: first.chatId, title: "Que propose le menu d'un sectionneur ?", updatedAt: expect.any(String), turns: 4 },
    ]);
    await expect(invoke("chat.show", { chatId: "chat-nope" }, { project: dir })).rejects.toThrow(/No chat/);
  });

  it("restarts the conversation when Claude no longer knows the session", async () => {
    const dir = copyFixture();
    answers({ text: "Premier.", session: "old" });
    const first = (await invoke("chat.ask", { question: "Q1" }, { project: dir })) as { chatId: string };
    answers(
      { text: "No conversation found with session ID: old", session: "x", error: true },
      { text: "Ok.", session: "new" },
    );
    calls = [];
    const r = await invoke("chat.ask", { question: "Q2", chatId: first.chatId }, { project: dir });
    expect(calls).toHaveLength(2);
    expect(calls[1].args).not.toContain("--resume");
    expect(r).toMatchObject({ ok: true, sessionId: "new", answer: "Ok." });
  });

  it("a failed answer is reported, not stored as the assistant's", async () => {
    const dir = copyFixture();
    answers({ text: "Claude usage limit reached. Your limit resets at 3pm.", session: "s", error: true });
    const r = (await invoke("chat.ask", { question: "Q" }, { project: dir })) as { chatId: string };
    expect(r).toMatchObject({ ok: false, sources: [], diagnosis: { kind: "limit" } });
    const show = (await invoke("chat.show", { chatId: r.chatId }, { project: dir })) as { turns: unknown[] };
    expect(show.turns).toHaveLength(1);
  });
});
