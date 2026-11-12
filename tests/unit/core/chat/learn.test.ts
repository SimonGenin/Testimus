import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { learnConversations } from "../../../../src/core/lib/contexts.ts";
import { DEFAULT_SETTINGS, readProject, writeProject, writeSettings } from "../../../../src/core/lib/project.ts";
import { call, fixtureCopy } from "../registry.ts";

const real = env.spawnClaude;
let calls: ClaudeSpawn[] = [];

function replies(text: string, during?: (s: ClaudeSpawn) => void) {
  env.spawnClaude = async (s) => {
    calls.push(s);
    during?.(s);
    const line = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, session_id: "s" });
    s.onLine?.(line);
    return { code: 0, stdout: `${line}\n`, stderr: "" };
  };
}

beforeEach(() => {
  calls = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
});
afterEach(() => {
  env.spawnClaude = real;
});

const file = (dir: string) => join(dir, "contexts", "conversations", "context.md");
const arg = (s: ClaudeSpawn, flag: string) => s.args[s.args.indexOf(flag) + 1];

describe("contexts.learn", () => {
  it("creates the conversations context the first time and attaches it to the project's defaults, once", async () => {
    const dir = fixtureCopy("learn-cmd");
    const c = await call<{ id: string; name: string; notes: string }>(
      "contexts.learn",
      { text: "## Vocabulaire\n\n- TCO : tableau de contrôle optique." },
      dir,
    );
    expect(c).toMatchObject({ id: "conversations", name: "Conversations" });
    expect(readProject(dir).claude.contexts).toEqual(["conversations"]);
    const p = readProject(dir);
    writeProject(dir, { ...p, claude: { ...p.claude, contexts: [] } });
    await call("contexts.learn", { text: "- Une seule observation par ligne." }, dir);
    expect(readProject(dir).claude.contexts).toEqual([]);
    expect(readFileSync(file(dir), "utf8")).toMatch(/name: Conversations[\s\S]*- Une seule observation par ligne\.$/);
  });

  it("refuses a text over 4,000 characters, a source of the documents, a date — so Claude condenses and keeps none", async () => {
    const dir = fixtureCopy("learn-rules");
    await expect(call("contexts.learn", { text: "x".repeat(4001) }, dir)).rejects.toThrow(/4000 at most/);
    await expect(
      call("contexts.learn", { text: 'Voir SOSIE_211_D401-1_3#§5.6.6 "Selon le type"' }, dir),
    ).rejects.toThrow(/cites a document/);
    await expect(call("contexts.learn", { text: "Décidé le 2026-11-12." }, dir)).rejects.toThrow(/date/);
    await expect(call("contexts.learn", { text: "Décidé le 12/11/2026." }, dir)).rejects.toThrow(/date/);
    expect(existsSync(file(dir))).toBe(false);
    expect(learnConversations(dir, `${"y".repeat(3990)}\r\n`).notes).toHaveLength(3990);
  });
});

describe("chat.learn", () => {
  it("a short run (Sonnet, low) given the context and the last exchange rewrites it through contexts.learn; Revert puts it back", async () => {
    const dir = fixtureCopy("learn-run");
    replies("Le menu dépend du type de sectionneur.");
    const chat = await call<{ chatId: string }>("chat.ask", { question: "Que veut dire TCO ?" }, dir);
    learnConversations(dir, "- Les tests sont écrits en français.");
    replies("J'ai gardé le sens de TCO.", (s) =>
      learnConversations(s.cwd, "- Les tests sont écrits en français.\n- TCO : tableau de contrôle optique."),
    );
    calls = [];
    const r = await call<{ ok: boolean; learned: boolean; runId: string; summary: string }>(
      "chat.learn",
      { chatId: chat.chatId },
      dir,
    );
    expect(r).toMatchObject({ ok: true, learned: true, summary: "J'ai gardé le sens de TCO." });
    const s = calls[0];
    expect(arg(s, "--model")).toBe("sonnet");
    expect(arg(s, "--effort")).toBe("low");
    expect(arg(s, "--allowedTools")).toBe("mcp__testimus__contexts_learn,Read");
    expect(s.stdin).toContain("The context today:\n- Les tests sont écrits en français.");
    expect(s.stdin).toContain("User: Que veut dire TCO ?\nClaude: Le menu dépend du type de sectionneur.");
    expect(s.stdin).toMatch(/At most 4000 characters/);
    expect(s.stdin).not.toContain("« Conversations »:");
    expect(readFileSync(file(dir), "utf8")).toContain("TCO : tableau de contrôle optique.");
    await call("claude.revert", { runId: r.runId }, dir);
    expect(readFileSync(file(dir), "utf8")).not.toContain("TCO");
    expect(readFileSync(file(dir), "utf8")).toContain("Les tests sont écrits en français.");
  });

  it("a run that keeps nothing changes nothing, and a conversation without an answer starts no run", async () => {
    const dir = fixtureCopy("learn-nothing");
    replies("Réponse.");
    const chat = await call<{ chatId: string }>("chat.ask", { question: "Bonjour ?" }, dir);
    replies("Nothing to keep");
    const r = await call<{ learned: boolean }>("chat.learn", { chatId: chat.chatId, model: "haiku" }, dir);
    expect(r.learned).toBe(false);
    expect(arg(calls[calls.length - 1], "--model")).toBe("haiku");
    expect(existsSync(file(dir))).toBe(false);
  });

  it("the conversations context goes with every other run while it is attached, like any context", async () => {
    const dir = fixtureCopy("learn-given");
    learnConversations(dir, "- Une observation par ligne.");
    replies("Oui.");
    await call("chat.ask", { question: "Et alors ?" }, dir);
    expect(calls[0].stdin).toContain("« Conversations »:\n- Une observation par ligne.");
    calls = [];
    await call("chat.ask", { question: "Et sans ?", without: ["context:conversations"] }, dir);
    expect(calls[0].stdin).not.toContain("Une observation par ligne");
  });
});
