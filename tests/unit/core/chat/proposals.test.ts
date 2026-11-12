import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommands } from "../../../../src/core/claude/access.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { propose } from "../../../../src/core/lib/proposals.ts";
import type { Proposal } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

const real = env.spawnClaude;
let calls: ClaudeSpawn[] = [];

// ponytail: Claude answers, and while it runs it calls the propose command its prompt names — as the MCP face would
function answering(text: string, during?: (s: ClaudeSpawn, runId: string) => void) {
  env.spawnClaude = async (s) => {
    calls.push(s);
    during?.(s, s.stdin.match(/runId: "([\w-]+)"/)?.[1] ?? "");
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: text,
      session_id: "s1",
    });
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

const overview = (dir: string) => join(dir, "docs", "OVERVIEW.md");

describe("the chat proposes, the user applies", () => {
  it("a chat run may propose and never write: the three propose commands, none of the writes", () => {
    const chat = runCommands("chat");
    expect(chat).toEqual(expect.arrayContaining(["docs.overviewPropose", "contexts.propose", "columns.propose"]));
    for (const w of ["docs.overviewSave", "contexts.set", "columns.save", "chat.apply", "contexts.learn"])
      expect(chat).not.toContain(w);
    expect(runCommands("learn")).toEqual(["contexts.learn"]);
    for (const k of ["generate", "check", "triage", "action"] as const) {
      expect(runCommands(k)).not.toContain("contexts.learn");
      expect(runCommands(k)).not.toContain("chat.apply");
    }
  });

  it("chat.ask returns its run's proposals; chat.show keeps them under the answer that made them", async () => {
    const dir = fixtureCopy("prop-ask");
    answering("Je propose une section sur le poste de commande.", (s, runId) =>
      propose(s.cwd, {
        kind: "overview",
        target: "overview",
        after: "## Le poste\n\nTCO et PCC.",
        why: "Asked",
        runId,
      }),
    );
    const r = await call<{ chatId: string; proposals: Proposal[] }>(
      "chat.ask",
      { question: "Corrige la vue d'ensemble" },
      dir,
    );
    expect(calls[0].stdin).toMatch(/docs_overviewPropose \{ runId: "run-[\w-]+", text, why \}/);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({
      kind: "overview",
      before: "",
      after: "## Le poste\n\nTCO et PCC.",
      state: "open",
    });
    expect(existsSync(overview(dir))).toBe(false);
    const show = await call<{ turns: { role: string; runId?: string; proposals?: Proposal[] }[] }>(
      "chat.show",
      { chatId: r.chatId },
      dir,
    );
    expect(show.turns[1].runId).toBe(r.proposals[0].runId);
    expect(show.turns[1].proposals?.map((p) => p.id)).toEqual([r.proposals[0].id]);
    expect(show.turns[0].proposals).toBeUndefined();
  });

  it("the overview: Apply writes it through docs.overviewSave, the run's Revert takes it back; Ignore writes nothing", async () => {
    const dir = fixtureCopy("prop-overview");
    await call("docs.overviewSave", { text: "## Le corpus\n\nDeux documents.\n" }, dir);
    const before = readFileSync(overview(dir), "utf8");
    const p = await call<Proposal>(
      "docs.overviewPropose",
      { runId: "run-20261112-aa", text: "## Le corpus\n\nDeux documents, un poste.\n", why: "Plus juste" },
      dir,
    );
    expect(p).toMatchObject({
      kind: "overview",
      name: "How the documents fit together",
      before: "## Le corpus\n\nDeux documents.\n",
    });
    expect(readFileSync(overview(dir), "utf8")).toBe(before);
    const applied = await call<Proposal>("chat.apply", { id: p.id }, dir);
    expect(applied.state).toBe("applied");
    expect(readFileSync(overview(dir), "utf8")).toContain("Deux documents, un poste.");
    await expect(call("chat.apply", { id: p.id }, dir)).rejects.toThrow(/already applied/);
    const r = await call<{ files: string[] }>("claude.revert", { runId: "run-20261112-aa" }, dir);
    expect(r.files).toEqual(["docs/OVERVIEW.md"]);
    expect(readFileSync(overview(dir), "utf8")).toBe(before);

    const q = await call<Proposal>(
      "docs.overviewPropose",
      { runId: "run-20261112-bb", text: "Autre chose", why: "Essai" },
      dir,
    );
    expect((await call<Proposal>("chat.ignore", { id: q.id }, dir)).state).toBe("ignored");
    expect(readFileSync(overview(dir), "utf8")).toBe(before);
    await expect(call("chat.apply", { id: q.id }, dir)).rejects.toThrow(/already ignored/);
  });

  it("a file that moved after the proposal is refused (conflict), and a proposal that changes nothing is refused", async () => {
    const dir = fixtureCopy("prop-conflict");
    await call("docs.overviewSave", { text: "Un.\n" }, dir);
    await expect(call("docs.overviewPropose", { runId: "run-1-a", text: "Un.", why: "Rien" }, dir)).rejects.toThrow(
      /already the text/,
    );
    const p = await call<Proposal>("docs.overviewPropose", { runId: "run-1-a", text: "Deux.\n", why: "x" }, dir);
    const t = Date.now() / 1000 + 5;
    writeFileSync(overview(dir), "---\n---\nÉcrit à la main.\n");
    utimesSync(overview(dir), t, t);
    await expect(call("chat.apply", { id: p.id }, dir)).rejects.toMatchObject({ code: "conflict" });
    expect(readFileSync(overview(dir), "utf8")).toContain("Écrit à la main.");
  });

  it("a context: Apply sets its notes (contexts.set), Revert puts them back", async () => {
    const dir = fixtureCopy("prop-context");
    const c = await call<{ id: string }>("contexts.create", { name: "Glossaire", notes: "TCO : ?" }, dir);
    const p = await call<Proposal>(
      "contexts.propose",
      { runId: "run-2-b", id: c.id, notes: "TCO : tableau de contrôle optique.", why: "Tranché" },
      dir,
    );
    expect(p).toMatchObject({ kind: "context", target: c.id, name: "Glossaire", before: "TCO : ?" });
    await call("chat.apply", { id: p.id }, dir);
    expect((await call<{ notes: string }>("contexts.show", { id: c.id }, dir)).notes).toBe(
      "TCO : tableau de contrôle optique.",
    );
    await call("claude.revert", { runId: "run-2-b" }, dir);
    expect((await call<{ notes: string }>("contexts.show", { id: c.id }, dir)).notes).toBe("TCO : ?");
    await expect(call("contexts.propose", { runId: "run-2-b", id: "nope", notes: "x", why: "y" }, dir)).rejects.toThrow(
      /No context nope/,
    );
  });

  it("a column: Apply saves its description (columns.save); a description changed meanwhile is refused", async () => {
    const dir = fixtureCopy("prop-column");
    const p = await call<Proposal>(
      "columns.propose",
      { runId: "run-3-c", column: "Expected Result", description: "One observation per line.", why: "Habitude" },
      dir,
    );
    expect(p.before).toMatch(/observes/);
    const q = await call<Proposal>(
      "columns.propose",
      { runId: "run-3-c", column: "Data", description: "The object aimed at.", why: "Habitude" },
      dir,
    );
    await call("chat.apply", { id: p.id }, dir);
    const cols = await call<{ name: string; description: string }[]>("columns.list", {}, dir);
    expect(cols.find((c) => c.name === "Expected Result")?.description).toBe("One observation per line.");
    await call("columns.save", { name: "Data", description: "Changed by hand." }, dir);
    await expect(call("chat.apply", { id: q.id }, dir)).rejects.toMatchObject({ code: "conflict" });
  });
});
