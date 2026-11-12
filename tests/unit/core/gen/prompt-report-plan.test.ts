import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePlan } from "../../../../src/core/claude/gen-plan.ts";
import {
  checkGenInput,
  genPrompt,
  indexGate,
  PLAN_MARKER,
  plannedInput,
  prompts,
  scopeIndex,
} from "../../../../src/core/claude/gen-prompt.ts";
import { PLAN_TAG, parseGenReport, REPORT_TAG, type Skipped, STOPPED } from "../../../../src/core/claude/gen-reply.ts";
import { toolStep } from "../../../../src/core/claude/generate.ts";
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
const report = (o: unknown) => `\`\`\`${REPORT_TAG}\n${typeof o === "string" ? o : JSON.stringify(o)}\n\`\`\``;
const SEARCH_LINE = "Search before you design, as section 1 of the skill says:";
const PLANNED_LINE =
  "The plan already searched the scope: read the sections above in full, follow what they refer to (rag_related), and search again only for a term they bring that the plan could not have seen.";

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
    expect(p).toContain("\nSections in scope: SOSIE_211_D401-1_3#§5.6.6\n");
    expect(p).toContain("Smart columns — write each as ### <column> in every step, following its description:");
    expect(p).toContain("\nXray folder of the tests: /Traction/Sectionneurs\n");
    expect(p).toContain("\nLanguage of the tests: French.\n");
    expect(p).toContain(`\`\`\`${REPORT_TAG}\n{"tests"`);
    expect(p.startsWith("Scope:")).toBe(false);
  });

  it("holds what is this run's alone: how a test is written stays in the skill, said once", () => {
    const p = genPrompt(dir, { request: "Menu contextuel des sectionneurs", sections: ["SOSIE_211_D401-1_3#§5.6.6"] });
    expect(p).not.toContain("review: draft");
    expect(p).not.toMatch(/rename or delete/);
    const skill = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "..", "templates/project/.claude/skills/generate-tests/SKILL.md"),
      "utf8",
    );
    expect(norm(skill)).toContain("`review: draft`");
    expect(norm(skill)).toMatch(/Only new tests: never change, rename or delete an existing one/);
  });

  it("without a folder offers the project's folders; without words says so", () => {
    const p = genPrompt(dir, { request: " ", docs: ["SOSIE_211_D401-1_3"] });
    expect(p).toContain(
      "\nXray folder of the tests: none given — the closest of /Traction/Sectionneurs, /Traction/Disjoncteurs, /Signalisation, else /\n",
    );
    expect(p).toContain("Request: (none in words");
    expect(p).toContain("\nDocuments in scope, each in full (test the behaviors they specify): SOSIE_211_D401-1_3\n");
    expect(p).not.toContain("Sections in scope");
  });

  it("a run of its own searches before it designs; a planned test reads its sections, the plan searched already", () => {
    const whole = genPrompt(dir, { request: "Le sectionneur", sections: ["SOSIE_211_D401-1_3#§5.6.6"] });
    expect(whole).toContain(`\n\n${SEARCH_LINE} one rag_mentions per term of the scope`);
    expect(whole).not.toContain("The plan already searched");
    const part = genPrompt(dir, { request: "Ouvrir le sectionneur", sections: ["SOSIE_211_D401-1_3#§5.6.6"] }, [], {
      n: 2,
      of: 4,
      request: "Le sectionneur",
    });
    expect(part).toContain(
      `This is test 2 of 4 of a plan for: Le sectionneur. Write exactly this one test. What the other tests of the plan take is theirs: it is not left out, never report it.\nSections in scope: SOSIE_211_D401-1_3#§5.6.6\n\n${PLANNED_LINE}\n`,
    );
    expect(part).not.toContain(SEARCH_LINE);
    const template = (id: string) => prompts.find((t) => t.id === id)?.text() ?? "";
    expect(template("generate")).toContain(SEARCH_LINE);
    expect(template("generate-add")).toContain(SEARCH_LINE);
    expect(template("generate-planned")).toContain(PLANNED_LINE);
    expect(template("generate-planned")).not.toContain(SEARCH_LINE);
  });

  it("refuses an empty request and a malformed section", () => {
    expect(() => checkGenInput({ request: "  ", docs: [" "], sections: [] })).toThrow(/Nothing to generate/);
    expect(() => checkGenInput({ request: "x", sections: ["§5.6.6"] })).toThrow(/Not a document section: §5.6.6/);
    expect(() => checkGenInput({ request: "", sections: ["DOC#§5.6.6"] })).not.toThrow();
  });

  it("refuses a scope search cannot find, and names what changed since the last index", () => {
    rmSync(join(dir, "index"), { recursive: true, force: true });
    expect(() => indexGate(dir, { request: "x" })).toThrow(/The index does not exist yet/);
    markIndexed(dir, [
      "SOSIE_211_D401-1_3",
      "Manoeuvre_d_un_sectionneur_au_PCC",
      "Notes_de_reunion",
      "RECETTE_TCO_12-10",
    ]);
    expect(() => indexGate(dir, { request: "x" })).toThrow(/Not indexed: SOSIE_211_D401-1_4\. Search cannot find it/);
    expect(() => indexGate(dir, { request: "", sections: ["SOSIE_211_D401-1_4#§1"] })).toThrow(/Not indexed/);
    expect(indexGate(dir, { request: "", docs: ["SOSIE_211_D401-1_3"] })).toEqual([]);
    markIndexed(dir);
    const md = join(dir, "docs", "SOSIE_211_D401-1_4", "doc.md");
    writeFileSync(md, `${readFileSync(md, "utf8")}\nUne phrase ajoutée.\n`);
    expect(indexGate(dir, { request: "x" })).toEqual(["SOSIE_211_D401-1_4"]);
  });

  it("a document left out of the run is not searched: not indexed, it stops nothing", () => {
    markIndexed(dir, [
      "SOSIE_211_D401-1_3",
      "Manoeuvre_d_un_sectionneur_au_PCC",
      "Notes_de_reunion",
      "RECETTE_TCO_12-10",
    ]);
    const without = ["doc:SOSIE_211_D401-1_4", "context:glossary", "overview"];
    expect(indexGate(dir, { request: "x", without })).toEqual([]);
    const scope = scopeIndex(dir, { without });
    expect(scope.searched).not.toContain("SOSIE_211_D401-1_4");
    expect(scope.searched).toContain("SOSIE_211_D401-1_3");
    expect(scope.unindexed).toEqual([]);
    expect(scopeIndex(dir, {}).unindexed).toEqual(["SOSIE_211_D401-1_4"]);
    expect(() => indexGate(dir, { request: "x", docs: ["SOSIE_211_D401-1_4"], without })).toThrow(
      /No converted document to generate from/,
    );
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
  const B = {
    item: "Menu B",
    reason: "no-source",
    why: "No passage states what the menu B shows.",
    sources: ['D#§1 "Le menu B est décrit plus loin"'],
    searched: ["menu B"],
    read: ["D#§1", "D#§2"],
    unblock: "A passage that lists what the menu B holds.",
  };

  it("reads the last tagged block: each item with its reason, what was searched and read, what would let it be written", () => {
    const t = [
      "Done.",
      report({ tests: ["local-00000001"], skipped: [] }),
      "Corrected:",
      report({
        tests: ["local-1a2b3c4d"],
        skipped: [B, { item: "Menu C", reason: "already-tested", why: "LFRPS12-1398 opens it.", test: "LFRPS12-1398" }],
        covered: ["Menu A"],
      }),
    ].join("\n");
    expect(parseGenReport(t)).toEqual({
      found: true,
      tests: ["local-1a2b3c4d"],
      skipped: [
        { ...B, category: "No source for the expected result" },
        {
          item: "Menu C",
          reason: "already-tested",
          category: "Already tested",
          why: "LFRPS12-1398 opens it.",
          test: "LFRPS12-1398",
        },
      ],
      covered: ["Menu A"],
      errors: [],
    });
    expect(parseGenReport(report({}))).toEqual({ found: true, tests: [], skipped: [], covered: [], errors: [] });
  });

  it("a reason asks for its proof: what was searched, the passage that asks for it, the test that verifies it", () => {
    const item = { item: "Menu B", why: "No passage states what the menu B shows." };
    const errors = (o: Record<string, unknown>) => parseGenReport(report({ skipped: [{ ...item, ...o }] })).errors;
    expect(errors({ reason: "no-source" })).toEqual([
      "skipped.0.searched: no-source: say what you searched before giving up",
      "skipped.0.unblock: no-source: say what would let the test be written",
      'skipped.0.sources: give the passage that asks for it: docId#anchor "quote"',
    ]);
    expect(errors({ reason: "missing-material", sources: B.sources, searched: ["x"], unblock: "short" })).toEqual([
      "skipped.0.unblock: missing-material: say what would let the test be written",
    ]);
    expect(errors({ reason: "already-tested" })).toEqual([
      "skipped.0.test: already-tested: name the test that verifies it",
    ]);
    expect(errors({ reason: "documents-disagree", sources: B.sources })).toEqual([
      "skipped.0.sources: documents-disagree: cite the two passages, each in sources",
    ]);
    expect(errors({ reason: "not-observable" })).toEqual([
      'skipped.0.sources: give the passage that asks for it: docId#anchor "quote"',
    ]);
    expect(errors({ reason: "stopped", sources: B.sources })[0]).toMatch(/^skipped\.0\.reason: Invalid option/);
    expect(errors({ reason: "out-of-scope", sources: B.sources })).toEqual([]);
  });

  it("only the tagged block is a report, and a reply without one says so", () => {
    expect(parseGenReport('x\n```json\n{"skipped": []}\n```')).toEqual({
      found: false,
      errors: ["no ```gen-report block in the reply"],
      tests: [],
      skipped: [],
      covered: [],
    });
    const broken = parseGenReport(report("{not json"));
    expect(broken.found).toBe(false);
    expect(broken.errors).toEqual([expect.stringMatching(/^the gen-report block is not valid JSON: /)]);
    expect(parseGenReport("Tests written.").errors).toEqual(["no ```gen-report block in the reply"]);
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
      `The scope holds 16 sections. When it takes more than one test, ${PLAN_MARKER} instead: write no test and end your reply with its ${PLAN_TAG} block.`,
    );
    expect(genPrompt(dir, { request: "x", sections: ["BIG_DOC#§1"] })).toContain(
      `The scope holds 1 section. When it takes more than one test, ${PLAN_MARKER}`,
    );
    const t = { summary: "Boutons 0 à 7", technique: "partition", sections: ["BIG_DOC#§1"] };
    const part = genPrompt(dir, plannedInput({ request: "Tout le document", docs: ["BIG_DOC"] }, t), [], {
      n: 1,
      of: 2,
      request: "Tout le document",
    });
    expect(part).toContain("Request: Boutons 0 à 7 (partition)");
    expect(part).toContain("This is test 1 of 2 of a plan for: Tout le document. Write exactly this one test.");
    expect(part).toContain("\nSections in scope: BIG_DOC#§1\n");
    expect(part).not.toContain(PLAN_MARKER);
    expect(part).not.toContain("Documents in scope");
    expect(plannedInput({ request: "", docs: ["BIG_DOC"] }, { ...t, sections: [] }).docs).toEqual(["BIG_DOC"]);
  });

  it("reads the last test-plan block; a planned test needs a summary, its sections are docId#anchor", () => {
    const block = (o: unknown) => `\`\`\`${PLAN_TAG}\n${JSON.stringify(o)}\n\`\`\``;
    const server = {
      item: "Fonction serveur",
      reason: "not-observable",
      why: "§4.5 describes a server function: nothing on the screen changes.",
      sources: ['DOC#§4.5 "Le serveur rafraîchit le cache"'],
    };
    const t = [
      block({ tests: [{ summary: "Old one" }] }),
      block({
        tests: [{ summary: " Test A ", technique: "états", sections: ["DOC#§2", "§3"] }, { summary: "Test B" }],
        skipped: [server],
      }),
    ].join("\n");
    expect(parsePlan(t)).toEqual({
      found: true,
      tests: [
        { summary: "Test A", technique: "états", sections: ["DOC#§2"] },
        { summary: "Test B", technique: "", sections: [] },
      ],
      skipped: [{ ...server, category: "Nothing a tester can observe" }],
      questions: [],
    });
    expect(parsePlan(block({ tests: [] }))).toMatchObject({
      found: false,
      errors: ["tests: Too small: expected array to have >=1 items"],
    });
    expect(parsePlan(block({ tests: [{ summary: "" }, "B"] }))).toMatchObject({
      found: false,
      tests: [],
      errors: [
        "tests.0.summary: Too small: expected string to have >=3 characters",
        "tests.1: Invalid input: expected object, received string",
      ],
    });
    expect(parsePlan("```test-plan\nnot json\n```").found).toBe(false);
    expect(parsePlan("Two tests.").errors).toEqual(["no ```test-plan block in the reply"]);
  });

  it("writes each planned test in its own run, adds them up, and one revert removes them all", async () => {
    bigDoc();
    const b15 = {
      item: "Bouton 15",
      reason: "not-observable",
      why: "The lamp of button 15 is inside the cabinet: no tester sees it.",
      sources: ['BIG_DOC#§16 "Le bouton 15 s\'allume."'],
    };
    const b9 = {
      item: "Bouton 9",
      reason: "no-source",
      why: "No passage says what the screen shows once button 9 is lit.",
      sources: ['BIG_DOC#§10 "Le bouton 9 s\'allume."'],
      searched: ["bouton 9"],
      unblock: "A passage that says what the screen shows then.",
    };
    const plan = {
      tests: [
        { summary: "Boutons 0 à 7", sections: ["BIG_DOC#§1"] },
        { summary: "Boutons 8 à 14", sections: [] },
      ],
      skipped: [b15],
    };
    const planReply = `Deux tests.\n\`\`\`${PLAN_TAG}\n${JSON.stringify(plan)}\n\`\`\``;
    const ids = ["local-0000a001", "local-0000b002"];
    const nth = (s: ClaudeSpawn) => Number(s.stdin.match(/This is test (\d) of 2/)?.[1] ?? 0);
    fake(
      (s) => {
        if (s.stdin.includes(PLAN_MARKER))
          return [tool("mcp__testimus__docs_show", { id: "BIG_DOC" }), result(planReply)];
        const id = ids[nth(s) - 1];
        const skipped = nth(s) === 2 ? [b9, b15] : [];
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
      reportErrors?: string[];
      costUsd: number;
      summary: string;
    };
    expect(seen).toHaveLength(3);
    expect(seen[1].stdin).toContain("Request: Boutons 0 à 7");
    expect(seen[2].stdin).toContain("This is test 2 of 2 of a plan for: Tout le document.");
    expect(seen[0].stdin).toContain(SEARCH_LINE);
    expect(seen[1].stdin).toContain(PLANNED_LINE);
    expect(seen[1].stdin).not.toContain(SEARCH_LINE);
    expect(seen[2].stdin).toContain(SEARCH_LINE);
    expect(seen[2].stdin).not.toContain(PLANNED_LINE);
    expect(seen[1].stdin).toContain("\nSections in scope: BIG_DOC#§1\n");
    expect(seen[2].stdin).toContain(
      "\nDocuments in scope, each in full (find in them what the request is about): BIG_DOC\n",
    );
    expect(r.ok).toBe(true);
    expect(r.planned).toBe(2);
    expect([...r.tests].sort()).toEqual(ids);
    expect(r.skipped).toEqual([
      { ...b15, category: "Nothing a tester can observe" },
      {
        ...b9,
        category: "No source for the expected result",
        doubts: ["The run gave up without a single search of the documents."],
      },
    ]);
    expect(r.reportFound).toBe(true);
    expect(r.reportErrors).toBeUndefined();
    expect(r.costUsd).toBe(0.75);
    expect(r.summary.startsWith("Plan: 2 test(s).")).toBe(true);
    for (const id of ids) expect(readTest(dir, id).test.review).toBe("draft");

    const rev = (await invoke("claude.revert", { runId: r.runId }, { project: dir })) as { reverted: string[] };
    expect([...rev.reverted].sort()).toEqual(ids);
    for (const id of ids) expect(existsSync(join(dir, "tests", id))).toBe(false);
  });

  it("against the --mock Claude: a plan of two tests, then two runs that write one test each", async () => {
    bigDoc();
    env.spawnClaude = mockSpawnClaude;
    const r = (await invoke(
      "gen.tests",
      { request: "Tout le document", docs: ["BIG_DOC"], check: false },
      { project: dir },
    )) as { ok: boolean; planned: number; tests: string[]; skipped: Skipped[] };
    expect(r.ok).toBe(true);
    expect(r.planned).toBe(2);
    expect(r.tests).toHaveLength(2);
    expect(r.skipped.map((s) => [s.item, s.reason])).toEqual([
      ["Manœuvre à distance d'un sectionneur avec TK", "no-source"],
      ["Défaut de la TK pendant la manœuvre", "no-source"],
      ["EXI_MOP_SPF_510_A_20", "out-of-scope"],
    ]);
  });

  it("a plan without tests is asked again once, in the same session, then runs nothing more", async () => {
    bigDoc();
    const reply = 'Rien à planifier.\n```test-plan\n{"tests": []}\n```';
    fake(() => [result(reply)]);
    const r = (await invoke(
      "gen.tests",
      { request: "Tout le document", docs: ["BIG_DOC"], check: false },
      { project: dir },
    )) as { planned: number; tests: string[]; reportFound: boolean; reportErrors?: string[] };
    expect(seen).toHaveLength(2);
    expect(seen[1].stdin).toBe(
      "Your reply cannot be read: tests: Too small: expected array to have >=1 items.\nDo no other work: reply with the corrected ```test-plan block only, valid JSON, nothing after it.\n",
    );
    expect(seen[1].args[seen[1].args.indexOf("--resume") + 1]).toBe("s");
    expect(r.planned).toBe(0);
    expect(r.tests).toEqual([]);
    expect(r.reportFound).toBe(false);
    expect(r.reportErrors).toEqual(["no ```gen-report block in the reply"]);
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
    expect(r.skipped[0]).toEqual({
      item: "Bouton 2",
      reason: "stopped",
      category: STOPPED,
      why: "not written: the generation stopped on a failed run — resume it",
    });
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
    const closing = {
      item: "Fermeture du disjoncteur",
      reason: "no-source",
      why: "Le §5.6.7 nomme Fermer et ne dit pas ce que l'écran montre ensuite.",
      sources: ['SOSIE_211_D401-1_3#§5.6.7 "Son menu contextuel propose Ouvrir, Fermer et Propriétés"'],
      searched: ["fermeture disjoncteur"],
      read: ["SOSIE_211_D401-1_3#§5.6.7"],
      unblock: "Un passage qui décrit l'écran après la fermeture, ou une note de l'équipe.",
    };
    const reply = `Écrit ${id}.\n${report({ tests: [id], skipped: [closing] })}`;
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
    expect(r.skipped).toEqual([{ ...closing, category: "No source for the expected result" }]);
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
      () => [result(`Rien à écrire.\n${report({ tests: [], skipped: [] })}`)],
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

  it("reports an existing test the run changed; a reply without its report is asked for it once, then said unreadable", async () => {
    const logs: string[] = [];
    const off = subscribe((e) => {
      if (e.type === "log") logs.push(e.message);
    });
    const isGen = (s: ClaudeSpawn) => s.stdin.startsWith("Use the generate-tests skill");
    fake(
      (s) =>
        isGen(s)
          ? [tool("Edit", { file_path: join(s.cwd, "tests", "LFRPS12-1398", "test.md") }), result("Rien à écrire.")]
          : [result("Toujours rien.")],
      (s) => {
        if (!isGen(s)) return;
        const f = join(s.cwd, "tests", "LFRPS12-1398", "test.md");
        writeFileSync(f, `${readFileSync(f, "utf8")}\n`);
      },
    );
    const r = (await invoke("gen.tests", { request: "x" }, { project: dir })) as {
      tests: string[];
      changed: string[];
      skipped: unknown[];
      reportFound: boolean;
      reportErrors?: string[];
    };
    off();
    expect(r).toMatchObject({
      tests: [],
      changed: ["LFRPS12-1398"],
      skipped: [],
      reportFound: false,
      reportErrors: ["no ```gen-report block in the reply"],
    });
    expect(seen).toHaveLength(2);
    expect(seen[1].stdin).toBe(
      "Your reply cannot be read: no ```gen-report block in the reply.\nDo no other work: reply with the corrected ```gen-report block only, valid JSON, nothing after it.\n",
    );
    expect(seen[1].args[seen[1].args.indexOf("--resume") + 1]).toBe("s");
    expect(
      logs.some((m) =>
        m.includes("changed the existing test « Disjoncteur — ouverture à distance » — Revert puts it back"),
      ),
    ).toBe(true);
    expect(logs).toContain("The reply of generate has no gen-report block: Claude is asked for it again.");
    expect(logs).toContain(
      "A run's report could not be read (no ```gen-report block in the reply): what it left without a test is not known. Ask the generation again for it.",
    );
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
