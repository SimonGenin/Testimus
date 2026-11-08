import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkGenInput,
  genPrompt,
  indexGate,
  PLAN_MARKER,
  PLAN_TAG,
  plannedInput,
  REPORT_TAG,
} from "../../../../src/core/claude/gen-prompt.ts";
import { parseGenReport, parsePlan, type Skipped } from "../../../../src/core/claude/gen-reply.ts";
import { STOPPED, toolStep } from "../../../../src/core/claude/generate.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { subscribe } from "../../../../src/core/jobs.ts";
import { DEFAULT_SETTINGS, readJson, writeSettings } from "../../../../src/core/lib/project.ts";
import { readTest } from "../../../../src/core/lib/store.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-gen.ts";
import type { JobEvent } from "../../../../src/core/types.ts";
import { markIndexedInDb as markIndexed } from "../../helpers/index-state.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const DOC_MD = readFileSync(join(FIXTURE, "docs", "SOSIE_211_D401-1_3", "doc.md"), "utf8");
const real = env.spawnClaude;
let dir: string;
let seen: ClaudeSpawn[];

const line = (m: unknown) => JSON.stringify(m);
const tool = (name: string, input: unknown) =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name, input }] } });
const text = (t: string) => line({ type: "assistant", message: { content: [{ type: "text", text: t }] } });
const result = (r: string) =>
  line({
    type: "result",
    subtype: "success",
    is_error: false,
    result: r,
    session_id: "s",
    duration_ms: 9,
    total_cost_usd: 0.25,
  });

const NEW_MD = `---
summary: Disjoncteur — menu contextuel
folder: /
labels: []
review: to-fix
---

## Description

Vérifie le menu du disjoncteur.

## Step 1

### Action

Clic droit sur le disjoncteur.

### Expected Result

Le menu propose Ouvrir, Fermer et Propriétés.

### Sources

- SOSIE_211_D401-1_3#§5.6.7 "Son menu contextuel propose Ouvrir, Fermer et Propriétés"
`;

function fake(lines: (s: ClaudeSpawn) => string[], during?: (s: ClaudeSpawn) => void) {
  env.spawnClaude = async (s): Promise<ClaudeOut> => {
    seen.push(s);
    during?.(s);
    const ls = lines(s);
    for (const l of ls) s.onLine?.(l);
    return { code: 0, stdout: `${ls.join("\n")}\n`, stderr: "" };
  };
}

const norm = (s: string) => s.replace(/\s+/g, " ");

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-gen-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  markIndexed(dir);
  seen = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
});

afterEach(() => {
  env.spawnClaude = real;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("generation prompt", () => {
  it("names the skill, the request, the scope, the folder, the language and the report block", () => {
    const p = genPrompt(dir, {
      request: "Menu contextuel des sectionneurs",
      sections: ["SOSIE_211_D401-1_3#§5.6.6", " SOSIE_211_D401-1_3#§5.6.6"],
      folder: "/Traction/Sectionneurs",
    });
    expect(p).toMatch(/^Use the generate-tests skill/);
    expect(p).toContain("Request: Menu contextuel des sectionneurs");
    expect(p).toContain("rag_passage and in doc.md): SOSIE_211_D401-1_3#§5.6.6\n");
    expect(p).toContain("Smart columns — write each as ### <column> in every step, following its description:");
    expect(p).toContain("Target Xray folder: /Traction/Sectionneurs");
    expect(p).toContain('Language of the tests: French (project.json language "fr").');
    expect(p).toContain("review: draft");
    expect(p).toContain("Never modify, rename or delete an existing test.");
    expect(p).toContain(`\`\`\`${REPORT_TAG}\n{"tests"`);
    expect(p.startsWith("Scope:")).toBe(false);
  });

  it("without a folder offers the project's folders; without words says so", () => {
    const p = genPrompt(dir, { request: " ", docs: ["SOSIE_211_D401-1_3"] });
    expect(p).toContain(
      "pick the closest of project.json folders (/Traction/Sectionneurs, /Traction/Disjoncteurs, /Signalisation)",
    );
    expect(p).toContain("Request: (none in words");
    expect(p).not.toContain("Document sections");
  });

  it("refuses an empty request and a malformed section", () => {
    expect(() => checkGenInput({ request: "  ", docs: [" "], sections: [] })).toThrow(/Nothing to generate/);
    expect(() => checkGenInput({ request: "x", sections: ["§5.6.6"] })).toThrow(/Not a document section: §5.6.6/);
    expect(() => checkGenInput({ request: "", sections: ["DOC#§5.6.6"] })).not.toThrow();
  });

  it("refuses a scope search cannot find, and names what changed since the last index", () => {
    rmSync(join(dir, "index"), { recursive: true, force: true });
    expect(() => indexGate(dir, { request: "x" })).toThrow(/The index does not exist yet/);
    markIndexed(dir, ["SOSIE_211_D401-1_3"]);
    expect(() => indexGate(dir, { request: "x" })).toThrow(/Not indexed: SOSIE_211_D401-1_4\. Search cannot find it/);
    expect(() => indexGate(dir, { request: "", sections: ["SOSIE_211_D401-1_4#§1"] })).toThrow(/Not indexed/);
    expect(indexGate(dir, { request: "", docs: ["SOSIE_211_D401-1_3"] })).toEqual([]);
    markIndexed(dir);
    const md = join(dir, "docs", "SOSIE_211_D401-1_4", "doc.md");
    writeFileSync(md, `${readFileSync(md, "utf8")}\nUne phrase ajoutée.\n`);
    expect(indexGate(dir, { request: "x" })).toEqual(["SOSIE_211_D401-1_4"]);
  });

  it("gen.tests fails before any Claude run when a document in scope is not indexed", async () => {
    markIndexed(dir, ["SOSIE_211_D401-1_3"]);
    fake(() => [result("never")]);
    await expect(invoke("gen.tests", { request: "", docs: ["SOSIE_211_D401-1_4"] }, { project: dir })).rejects.toThrow(
      /Not indexed: SOSIE_211_D401-1_4/,
    );
    expect(seen).toEqual([]);
  });
});

describe("gen-report parsing", () => {
  it("reads the last tagged block", () => {
    const t = [
      "Done.",
      "```gen-report",
      '{"tests": ["local-00000001"], "skipped": []}',
      "```",
      "Corrected:",
      "```gen-report",
      '{"tests": ["local-1a2b3c4d"], "skipped": [{"item": "Menu B", "why": "no source"}, "Menu C", {"why": "no item"}]}',
      "```",
    ].join("\n");
    expect(parseGenReport(t)).toEqual({
      found: true,
      tests: ["local-1a2b3c4d"],
      skipped: [
        { item: "Menu B", category: "Other", why: "no source" },
        { item: "Menu C", category: "Other", why: "" },
      ],
      consulted: [],
    });
    const withConsulted = ["```gen-report", '{"tests": [], "consulted": ["D#§1", 3]}', "```"].join("\n");
    expect(parseGenReport(withConsulted).consulted).toEqual(["D#§1"]);
  });

  it("accepts an untagged json block holding skipped, and says when there is no report", () => {
    expect(parseGenReport('x\n```json\n{"skipped": [{"item": "A", "why": "w"}]}\n```').skipped).toEqual([
      { item: "A", category: "Other", why: "w" },
    ]);
    expect(parseGenReport('```json\n{"other": 1}\n```').found).toBe(false);
    expect(parseGenReport("```gen-report\n{not json\n```")).toEqual({
      found: false,
      tests: [],
      skipped: [],
      consulted: [],
    });
    expect(parseGenReport("Tests written.").found).toBe(false);
  });

  it("classifies tool events for progress", () => {
    expect(toolStep({ type: "tool", name: "mcp__testimus__rag_search", input: "{}" })).toEqual({ kind: "read" });
    expect(toolStep({ type: "tool", name: "mcp__testimus__rag_passage", input: "{}" })).toEqual({ kind: "read" });
    expect(
      toolStep({
        type: "tool",
        name: "Write",
        input: '{"file_path":"D:\\\\p\\\\tests\\\\local-1A2B3C4D\\\\test.md","content":"…',
      }),
    ).toEqual({ kind: "write", testId: "local-1a2b3c4d" });
    expect(toolStep({ type: "tool", name: "Edit", input: '{"file_path":"tests/LFRPS12-1420/test.md"}' })).toBeNull();
    expect(
      toolStep({ type: "tool", name: "mcp__testimus__tests_save", input: '{"id":"local-1A2B3C4D","test":{"summ...' }),
    ).toEqual({ kind: "write", testId: "local-1a2b3c4d" });
    expect(toolStep({ type: "tool", name: "mcp__testimus__tests_edit", input: '{"id":"LFRPS12-1420"}' })).toBeNull();
    expect(toolStep({ type: "tool", name: "mcp__testimus__tests_create", input: '{"summary":"A"}' })).toBeNull();
    expect(toolStep({ type: "tool", name: "Read", input: '{"file_path":"docs/DOC/doc.md"}' })).toEqual({
      kind: "read",
    });
    expect(toolStep({ type: "text", text: "rag_search" })).toBeNull();
  });
});

describe("planned generation", () => {
  const bigDoc = () => {
    mkdirSync(join(dir, "docs", "BIG_DOC"), { recursive: true });
    writeFileSync(
      join(dir, "docs", "BIG_DOC", "doc.md"),
      [
        "# Big",
        "",
        ...Array.from(
          { length: 16 },
          (_, k) => `## ${k + 1} Bouton ${k} <!-- § ${k + 1} -->\n\nLe bouton ${k} s'allume.\n`,
        ),
      ].join("\n"),
    );
    const fixture = JSON.parse(readFileSync(join(FIXTURE, "docs", "SOSIE_211_D401-1_3", "doc.json"), "utf8"));
    writeFileSync(
      join(dir, "docs", "BIG_DOC", "doc.json"),
      JSON.stringify({ ...fixture, id: "BIG_DOC", code: "BIG_DOC", title: "Big" }),
    );
    markIndexed(dir);
  };

  it("asks for a plan whenever a request takes more than one test, never inside a planned test", () => {
    bigDoc();
    expect(genPrompt(dir, { request: "Tout le document", docs: ["BIG_DOC"] })).toContain(
      `The scope holds 16 sections. When testing it takes more than one test, ${PLAN_MARKER} instead: write no test, and end your reply with its ${PLAN_TAG} block`,
    );
    expect(genPrompt(dir, { request: "x", sections: ["BIG_DOC#§1"] })).toContain(
      `The scope holds 1 section. When testing it takes more than one test, ${PLAN_MARKER}`,
    );
    const t = { summary: "Boutons 0 à 7", technique: "partition", sections: ["BIG_DOC#§1"] };
    const part = genPrompt(dir, plannedInput({ request: "Tout le document", docs: ["BIG_DOC"] }, t), [], undefined, {
      n: 1,
      of: 2,
      request: "Tout le document",
    });
    expect(part).toContain("Request: Boutons 0 à 7 (partition)");
    expect(part).toContain("This is test 1 of 2 of a plan for: Tout le document. Write exactly this one test;");
    expect(part).toContain("BIG_DOC#§1");
    expect(part).not.toContain(PLAN_MARKER);
    expect(part).not.toContain("Documents in scope");
    expect(plannedInput({ request: "", docs: ["BIG_DOC"] }, { ...t, sections: [] }).docs).toEqual(["BIG_DOC"]);
  });

  it("reads the last test-plan block; a planned test needs a summary, its sections are docId#anchor", () => {
    const block = (o: unknown) => `\`\`\`${PLAN_TAG}\n${JSON.stringify(o)}\n\`\`\``;
    const t = [
      block({ tests: [{ summary: "Old" }] }),
      block({
        tests: [{ summary: " A ", technique: "états", sections: ["DOC#§2", "§3"] }, { summary: "" }, "B"],
        skipped: [{ item: "Fonction serveur", category: "Not observable", why: "not observable by a manual tester" }],
      }),
    ].join("\n");
    expect(parsePlan(t)).toEqual({
      found: true,
      tests: [{ summary: "A", technique: "états", sections: ["DOC#§2"] }],
      skipped: [{ item: "Fonction serveur", category: "Not observable", why: "not observable by a manual tester" }],
    });
    expect(parsePlan(block({ tests: [] })).found).toBe(false);
    expect(parsePlan("```test-plan\nnot json\n```").found).toBe(false);
  });

  it("writes each planned test in its own run, adds them up, and one revert removes them all", async () => {
    bigDoc();
    const plan = {
      tests: [
        { summary: "Boutons 0 à 7", sections: ["BIG_DOC#§1"] },
        { summary: "Boutons 8 à 14", sections: [] },
      ],
      skipped: [{ item: "Bouton 15", category: "Not observable", why: "not observable by a manual tester" }],
    };
    const planReply = `Deux tests.\n\`\`\`${PLAN_TAG}\n${JSON.stringify(plan)}\n\`\`\``;
    const ids = ["local-0000a001", "local-0000b002"];
    const nth = (s: ClaudeSpawn) => Number(s.stdin.match(/This is test (\d) of 2/)?.[1] ?? 0);
    fake(
      (s) => {
        if (s.stdin.includes(PLAN_MARKER))
          return [tool("mcp__testimus__docs_show", { id: "BIG_DOC" }), result(planReply)];
        const id = ids[nth(s) - 1];
        const skipped = nth(s) === 2 ? [{ item: "Bouton 9", category: "No source", why: "no passage" }] : [];
        const reply = `Écrit ${id}.\n\`\`\`gen-report\n${JSON.stringify({ tests: [id], skipped })}\n\`\`\``;
        return [tool("Write", { file_path: join(dir, "tests", id, "test.md"), content: "…" }), result(reply)];
      },
      (s) => {
        if (!nth(s)) return;
        const id = ids[nth(s) - 1];
        mkdirSync(join(s.cwd, "tests", id), { recursive: true });
        writeFileSync(join(s.cwd, "tests", id, "test.md"), NEW_MD);
      },
    );
    const r = (await invoke(
      "gen.tests",
      { request: "Tout le document", docs: ["BIG_DOC"], check: false },
      { project: dir },
    )) as {
      runId: string;
      ok: boolean;
      tests: string[];
      planned: number;
      skipped: unknown[];
      reportFound: boolean;
      costUsd: number;
      summary: string;
    };
    expect(seen).toHaveLength(3);
    expect(seen[1].stdin).toContain("Request: Boutons 0 à 7");
    expect(seen[2].stdin).toContain("This is test 2 of 2 of a plan for: Tout le document.");
    expect(r.ok).toBe(true);
    expect(r.planned).toBe(2);
    expect([...r.tests].sort()).toEqual(ids);
    expect(r.skipped).toEqual([
      { item: "Bouton 15", category: "Not observable", why: "not observable by a manual tester" },
      { item: "Bouton 9", category: "No source", why: "no passage" },
    ]);
    expect(r.reportFound).toBe(true);
    expect(r.costUsd).toBe(0.75);
    expect(r.summary.startsWith("Plan: 2 test(s).")).toBe(true);
    for (const id of ids) expect(readTest(dir, id).test.review).toBe("draft");

    const rev = (await invoke("claude.revert", { runId: r.runId }, { project: dir })) as { reverted: string[] };
    expect([...rev.reverted].sort()).toEqual(ids);
    for (const id of ids) expect(existsSync(join(dir, "tests", id))).toBe(false);
  });

  it("against the --mock Claude: a plan of two tests, then two runs that write two tests each", async () => {
    bigDoc();
    env.spawnClaude = mockSpawnClaude;
    const r = (await invoke(
      "gen.tests",
      { request: "Tout le document", docs: ["BIG_DOC"], check: false },
      { project: dir },
    )) as { ok: boolean; planned: number; tests: string[]; skipped: unknown[] };
    expect(r.ok).toBe(true);
    expect(r.planned).toBe(2);
    expect(r.tests).toHaveLength(4);
    expect(r.skipped.length).toBeGreaterThan(0);
  });

  it("a plan without tests runs nothing more", async () => {
    bigDoc();
    const reply = 'Rien à planifier.\n```test-plan\n{"tests": []}\n```';
    fake(() => [result(reply)]);
    const r = (await invoke(
      "gen.tests",
      { request: "Tout le document", docs: ["BIG_DOC"], check: false },
      { project: dir },
    )) as { planned: number; tests: string[]; reportFound: boolean };
    expect(seen).toHaveLength(1);
    expect(r.planned).toBe(0);
    expect(r.tests).toEqual([]);
    expect(r.reportFound).toBe(false);
  });

  const planOf = (n: number) => ({
    tests: Array.from({ length: n }, (_, k) => ({ summary: `Bouton ${k + 1}`, sections: ["BIG_DOC#§1"] })),
  });
  const idOf = (n: number) => `local-${String(n).padStart(8, "0")}`;
  const nthOf = (s: ClaudeSpawn) => Number(s.stdin.match(/This is test (\d+) of/)?.[1] ?? 0);

  function planned(n: number, fails: (k: number) => boolean = () => false) {
    let active = 0;
    const most = { n: 0 };
    env.spawnClaude = async (s): Promise<ClaudeOut> => {
      seen.push(s);
      const k = nthOf(s);
      if (!k) {
        const l = result(`Plan.\n\`\`\`${PLAN_TAG}\n${JSON.stringify(planOf(n))}\n\`\`\``);
        s.onLine?.(l);
        return { code: 0, stdout: `${l}\n`, stderr: "" };
      }
      if (fails(k)) {
        const l = line({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached" });
        s.onLine?.(l);
        return { code: 1, stdout: `${l}\n`, stderr: "" };
      }
      active++;
      most.n = Math.max(most.n, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      const id = idOf(k);
      mkdirSync(join(s.cwd, "tests", id), { recursive: true });
      writeFileSync(join(s.cwd, "tests", id, "test.md"), NEW_MD);
      const ls = [
        tool("Write", { file_path: join(s.cwd, "tests", id, "test.md"), content: "…" }),
        result(`\`\`\`gen-report\n${JSON.stringify({ tests: [id], skipped: [] })}\n\`\`\``),
      ];
      for (const l of ls) s.onLine?.(l);
      return { code: 0, stdout: `${ls.join("\n")}\n`, stderr: "" };
    };
    return most;
  }

  it("writes every planned test, however many, agents.max runs at a time", async () => {
    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" }, agents: { max: 3, adaptive: false } });
    bigDoc();
    const most = planned(35);
    const r = (await invoke(
      "gen.tests",
      { request: "Tout le document", docs: ["BIG_DOC"], check: false },
      { project: dir },
    )) as { ok: boolean; planned: number; tests: string[]; remaining: number; summary: string };
    expect(r.ok).toBe(true);
    expect(r.planned).toBe(35);
    expect(r.tests).toHaveLength(35);
    expect(r.remaining).toBe(0);
    expect(most.n).toBe(3);
    expect(seen.some((s) => s.stdin.includes("This is test 35 of 35"))).toBe(true);
    expect(r.summary.startsWith("Plan: 35 test(s).")).toBe(true);
  });

  it("a failed run stops the plan; what is left is skipped, and a resume writes it under the same generation", async () => {
    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" }, agents: { max: 3, adaptive: false } });
    bigDoc();
    planned(5, (k) => k === 2);
    const r = (await invoke(
      "gen.tests",
      { request: "Tout le document", docs: ["BIG_DOC"], check: false },
      { project: dir },
    )) as { ok: boolean; runId: string; generation: string; tests: string[]; remaining: number; skipped: Skipped[] };
    expect(r.ok).toBe(false);
    expect([...r.tests].sort()).toEqual([idOf(1), idOf(3)]);
    expect(r.remaining).toBe(3);
    expect(r.skipped.map((s) => s.item)).toEqual(["Bouton 2", "Bouton 4", "Bouton 5"]);
    expect(r.skipped[0].why).toContain("stopped on a failed run");
    expect(r.skipped[0].category).toBe(STOPPED);
    const ledger = readJson<{ done: number[]; plan: { tests: unknown[] } }>(
      join(dir, ".testimus", "gen", `${r.generation}.json`),
      { done: [], plan: { tests: [] } },
    );
    expect(ledger.done).toEqual([0, 2]);
    expect(ledger.plan.tests).toHaveLength(5);

    seen = [];
    planned(5);
    const again = (await invoke("gen.tests", { resume: r.generation, check: false }, { project: dir })) as {
      ok: boolean;
      generation: string;
      tests: string[];
      remaining: number;
      planned: number;
    };
    expect(seen.map(nthOf)).toEqual([2, 4, 5]);
    expect(seen[0].stdin).toContain("This is test 2 of 5 of a plan for: Tout le document.");
    expect(again).toMatchObject({ ok: true, generation: r.generation, remaining: 0, planned: 3 });
    expect([...again.tests].sort()).toEqual([idOf(2), idOf(4), idOf(5)]);
    for (const k of [1, 2, 3, 4, 5]) expect(readTest(dir, idOf(k)).test.generatedBy).toBe(r.generation);
    expect(
      readJson<{ tests: string[] }>(join(dir, ".testimus", "gen", `${r.generation}.json`), { tests: [] }).tests.sort(),
    ).toEqual([1, 2, 3, 4, 5].map(idOf));

    const rev = (await invoke("claude.revert", { runId: r.runId }, { project: dir })) as { reverted: string[] };
    expect([...rev.reverted].sort()).toEqual([1, 2, 3, 4, 5].map(idOf));
    await expect(invoke("gen.tests", { resume: "nope" }, { project: dir })).rejects.toThrow(/No plan to resume/);
  });
});

describe("gen.tests", () => {
  it("runs Claude on the project, stamps every new test draft + generated_by, returns the skipped items", async () => {
    const id = "local-0badcafe";
    const events: JobEvent[] = [];
    const off = subscribe((e) => events.push(e));
    const reply = `Écrit ${id}.\n\`\`\`gen-report\n{"tests": ["${id}"], "skipped": [{"item": "Fermeture du disjoncteur", "why": "absent des documents"}]}\n\`\`\``;
    fake(
      () => [
        tool("mcp__testimus__rag_search", { query: "disjoncteur" }),
        tool("mcp__testimus__rag_passage", { ref: "SOSIE_211_D401-1_3#§5.6.7" }),
        tool("Write", { file_path: join(dir, "tests", id, "test.md"), content: "…" }),
        text(reply),
        result(reply),
      ],
      (s) => {
        mkdirSync(join(s.cwd, "tests", id), { recursive: true });
        writeFileSync(join(s.cwd, "tests", id, "test.md"), NEW_MD);
      },
    );
    const r = (await invoke(
      "gen.tests",
      { request: "Menu du disjoncteur", folder: "/Traction/Disjoncteurs", check: false },
      { project: dir },
    )) as {
      runId: string;
      tests: string[];
      changed: string[];
      skipped: unknown[];
      costUsd: number;
      ok: boolean;
      reportFound: boolean;
      consulted: number;
    };
    off();
    expect(r.ok).toBe(true);
    expect(r.tests).toEqual([id]);
    expect(r.consulted).toBe(1);
    expect(r.changed).toEqual([]);
    expect(r.skipped).toEqual([{ item: "Fermeture du disjoncteur", category: "Other", why: "absent des documents" }]);
    expect(r.reportFound).toBe(true);
    expect(r.costUsd).toBe(0.25);

    const jobId = events.find((e) => e.type === "status")?.jobId as string;
    expect(jobId).toMatch(/^generate-[0-9a-f]{8}$/);
    const { test } = readTest(dir, id);
    expect(test.review).toBe("draft");
    expect(test.generatedBy).toBe(jobId);
    expect(test.folder).toBe("/Traction/Disjoncteurs");
    expect(test.project).toBe("LFRPS12");

    expect(seen).toHaveLength(1);
    expect(seen[0].cwd).toBe(dir);
    expect(seen[0].stdin).toMatch(/^Use the generate-tests skill/);
    expect(seen[0].args).toContain("--mcp-config");
    const progress = events.filter((e) => e.type === "progress").map((e) => (e as { message: string }).message);
    expect(progress).toEqual(
      expect.arrayContaining(["Reading passages", "Reading passages (1)", "Reading passages (2)", `Writing ${id} (1)`]),
    );
    expect(events.some((e) => e.type === "claude" && e.event.type === "tool")).toBe(true);
    const ledger = readJson<{ tests: string[]; consulted: string[]; searched: unknown[] }>(
      join(dir, ".testimus", "gen", `${jobId}.json`),
      { tests: [], consulted: [], searched: [] },
    );
    expect(ledger.tests).toEqual([id]);
    expect(ledger.consulted).toEqual(["SOSIE_211_D401-1_3#§5.6.7"]);
    expect(ledger.searched).toEqual([{ tool: "rag_search", query: "disjoncteur" }]);

    const rev = (await invoke("claude.revert", { runId: r.runId }, { project: dir })) as { reverted: string[] };
    expect(rev.reverted).toEqual([id]);
    expect(existsSync(join(dir, "tests", id))).toBe(false);
  });

  it("with discard, deletes Claude's tests not validated yet before the run, and keeps the validated and the pushed", async () => {
    const validated = join(dir, "tests", "local-0000beef");
    mkdirSync(validated, { recursive: true });
    writeFileSync(
      join(validated, "test.md"),
      NEW_MD.replace("review: to-fix", "review: validated\ngenerated_by: gen-tests-1a2b3c4d"),
    );
    const logs: string[] = [];
    const off = subscribe((e) => {
      if (e.type === "log") logs.push(e.message);
    });
    let during: boolean[] = [];
    fake(
      () => [result("Rien à écrire.")],
      (s) => {
        during = ["local-3f9a12c0", "local-0000beef", "LFRPS12-1420", "LFRPS12-1398"].map((id) =>
          existsSync(join(s.cwd, "tests", id)),
        );
      },
    );
    const r = (await invoke("gen.tests", { request: "x", discard: true, check: false }, { project: dir })) as {
      discarded: string[];
    };
    off();
    expect(r.discarded).toEqual(["local-3f9a12c0"]);
    expect(during).toEqual([false, true, true, true]);
    expect(logs.some((m) => m.includes("Deleted 1 test(s) not validated yet: local-3f9a12c0"))).toBe(true);

    const kept = (await invoke("gen.tests", { request: "x", check: false }, { project: dir })) as {
      discarded: string[];
    };
    expect(kept.discarded).toEqual([]);
  });

  it("reports an existing test the run changed, and works without a report block", async () => {
    const logs: string[] = [];
    const off = subscribe((e) => {
      if (e.type === "log") logs.push(e.message);
    });
    fake(
      (s) => [tool("Edit", { file_path: join(s.cwd, "tests", "LFRPS12-1398", "test.md") }), result("Rien à écrire.")],
      (s) => {
        const f = join(s.cwd, "tests", "LFRPS12-1398", "test.md");
        writeFileSync(f, `${readFileSync(f, "utf8")}\n`);
      },
    );
    const r = (await invoke("gen.tests", { request: "x" }, { project: dir })) as {
      tests: string[];
      changed: string[];
      skipped: unknown[];
      reportFound: boolean;
    };
    off();
    expect(r).toMatchObject({ tests: [], changed: ["LFRPS12-1398"], skipped: [], reportFound: false });
    expect(
      logs.some((m) =>
        m.includes("changed the existing test « Disjoncteur — ouverture à distance » — Revert puts it back"),
      ),
    ).toBe(true);
    expect(logs.some((m) => m.includes("no gen-report block"))).toBe(true);
  });

  it("end to end against the --mock Claude: two sourced tests, one quote that is not verbatim, a figure embedded", async () => {
    env.spawnClaude = mockSpawnClaude;
    const before = readdirSync(join(dir, "tests"));
    const r = (await invoke(
      "gen.tests",
      {
        request: "Menu contextuel des sectionneurs",
        sections: ["SOSIE_211_D401-1_3#§5.6.6"],
        folder: "/Traction/Sectionneurs",
      },
      { project: dir },
    )) as { tests: string[]; skipped: Skipped[]; ok: boolean; costUsd: number; consulted: number };
    expect(r.ok).toBe(true);
    expect(r.tests).toHaveLength(2);
    const by = readTest(dir, r.tests[0]).test.generatedBy as string;
    const ledger = readJson<{ consulted: string[]; searched: { tool: string }[] }>(
      join(dir, ".testimus", "gen", `${by}.json`),
      { consulted: [], searched: [] },
    );
    expect(ledger.consulted).toEqual(
      expect.arrayContaining([
        "SOSIE_211_D401-1_3#§5.6.6",
        "SOSIE_211_D401-1_3#fig:40",
        "SOSIE_211_D401-1_3#§5",
        "SOSIE_211_D401-1_3#§5.6.7",
      ]),
    );
    expect(r.consulted).toBe(ledger.consulted.length);
    expect(ledger.searched.map((x) => x.tool)).toEqual(["rag_search", "rag_search"]);
    expect(
      readdirSync(join(dir, "tests"))
        .filter((d) => !before.includes(d))
        .sort(),
    ).toEqual([...r.tests].sort());
    expect(r.skipped).toHaveLength(3);
    expect(new Set(r.skipped.map((s) => s.category)).size).toBe(2);
    expect(r.costUsd).toBeGreaterThan(0);

    const notFound = r.tests.map((id) => {
      const { test, warnings } = readTest(dir, id);
      expect(warnings).toEqual([]);
      expect(test.review).toBe("draft");
      expect(test.generatedBy).toMatch(/^generate-/);
      expect(test.folder).toBe("/Traction/Sectionneurs");
      for (const s of test.steps) {
        expect(s.fields.Action).toBeTruthy();
        expect(s.sources.length).toBeGreaterThan(0);
      }
      return test.steps.flatMap((s) => s.sources).filter((s) => !norm(DOC_MD).includes(norm(s.quote)));
    });
    expect(notFound.map((n) => n.length).sort()).toEqual([0, 1]);

    const menu = r.tests.find((id) => readTest(dir, id).test.summary.startsWith("Sectionneur sans TK")) as string;
    const withFigure = readTest(dir, menu).test.steps[0];
    expect(withFigure.images).toHaveLength(1);
    expect(withFigure.fields["Expected Result"]).toContain(`![](${withFigure.images[0].file})`);
    expect(existsSync(join(dir, "tests", menu, withFigure.images[0].file))).toBe(true);
  }, 20000);
});
