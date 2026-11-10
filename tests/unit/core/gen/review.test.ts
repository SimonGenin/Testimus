import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REASON_LABEL, type Skipped, type SkipReason } from "../../../../src/core/claude/gen-reply.ts";
import {
  applyReview,
  hasReview,
  proposeWritable,
  REVIEW_TAG,
  reviewLines,
  reviewPart,
} from "../../../../src/core/claude/gen-review.ts";
import { listActions, stampOf } from "../../../../src/core/lib/actions.ts";
import { loadCorpus } from "../../../../src/core/lib/check.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const DOC = "SOSIE_211_D401-1_3";
const TK = `${DOC}#§5.6.6 "un sectionneur avec TK manœuvré régulièrement ne propose que Propriétés"`;
const BY = { runId: "run-1", model: "opus", effort: "high" as const };
let dir: string;

const left = (item: string, reason: SkipReason, more: Partial<Skipped> = {}): Skipped => ({
  item,
  reason,
  category: REASON_LABEL[reason],
  why: `Why ${item} has no test.`,
  ...more,
});

const A = left("Manœuvre à distance", "no-source", { sources: [TK] });
const B = left("Menu du disjoncteur", "already-tested", { test: "LFRPS12-1398" });
const C = left("Test planifié", "stopped");
const D = left("Ancien élément", "other");
const E = left("TCO à deux rangs", "out-of-scope");
const ALL = [A, B, C, D, E];

const block = (o: unknown) => `Done.\n\n\`\`\`${REVIEW_TAG}\n${typeof o === "string" ? o : JSON.stringify(o)}\n\`\`\``;
const ask = (skipped: Skipped[], revised = false) =>
  reviewPart({ request: "Le sectionneur", tests: ["local-0000aaaa"], skipped, ...(revised ? { revised } : {}) });

const ledger = (generation: string, o: Record<string, unknown>) => {
  mkdirSync(join(dir, ".testimus", "gen"), { recursive: true });
  writeFileSync(
    join(dir, ".testimus", "gen", `${generation}.json`),
    JSON.stringify({ consulted: [], searched: [], input: { request: "r" }, ...o }),
  );
};

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-gen-review-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
});

afterEach(() => {
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("what is asked about a generation, in the request that checks its tests", () => {
  it("a second look at the items another look can overturn, numbered; one already tested, stopped or of an older report is settled without one", () => {
    const r = ask(ALL);
    expect(r.items).toEqual([A, E]);
    const text = r.part.ask.join("\n");
    expect(r.part.ask[0]).toBe("About the generation these tests come from (its request: « Le sectionneur »):");
    expect(text).toContain(`\n1. Manœuvre à distance — No source for the expected result: ${A.why} [${TK}]\n`);
    expect(text).toContain(`\n2. TCO à deux rangs — Outside the request: ${E.why}\n`);
    for (const s of [B, C, D]) expect(text).not.toContain(s.item);
    expect(text).toContain("\nThen propose 3 to 5 requests the user could ask next about these tests as a whole");
    expect(r.part.ask.at(-2)).toBe(
      '{"skipped": [{"n": 1, "verdict": "confirmed | writable | unsure", "why": "…", "sources": ["<docId#anchor \\"quote\\">"]}], "suggestions": [{"label": "…", "prompt": "…", "scope": "change | add"}]}',
    );
    expect(r.part).toMatchObject({ id: "generation review", size: text.length });
  });

  it("with nothing to look at again, only what to ask next; twelve items at most; a revision speaks of the tests changed", () => {
    const none = ask([B, C, D]);
    expect(none.items).toEqual([]);
    expect(none.part.ask.join("\n")).not.toContain("second look");
    expect(none.part.ask[1]).toMatch(/^Propose 3 to 5 requests the user could ask next about these tests as a whole/);
    expect(none.part.ask.at(-2)).toBe('{"suggestions": [{"label": "…", "prompt": "…", "scope": "change | add"}]}');

    const many = Array.from({ length: 14 }, (_, k) => left(`Item ${k + 1}`, "not-observable"));
    expect(ask(many).items).toHaveLength(12);
    expect(ask(many).part.ask.join("\n")).not.toContain("13. Item 13");

    expect(ask([], true).part.ask[1]).toMatch(/could ask next about the tests changed as a whole/);
  });

  it("a generation that wrote no test is asked for the second look alone, and for nothing when no item can be settled", () => {
    const lines = reviewLines({ request: " ", tests: [], skipped: [A, B] });
    expect(lines[0]).toBe("About the generation that wrote no test (its request: « the documents in scope »):");
    expect(lines.join("\n")).toContain("1. Manœuvre à distance — No source for the expected result");
    expect(lines.join("\n")).not.toContain("requests the user could ask next");
    expect(lines.at(-2)).toBe(
      '{"skipped": [{"n": 1, "verdict": "confirmed | writable | unsure", "why": "…", "sources": ["<docId#anchor \\"quote\\">"]}]}',
    );
    expect(hasReview({ tests: [], skipped: [A, B] })).toBe(true);
    expect(hasReview({ tests: [], skipped: [B, C, D] })).toBe(false);
    expect(hasReview({ tests: [], skipped: [] })).toBe(false);
    expect(hasReview({ tests: ["local-0000aaaa"], skipped: [] })).toBe(true);
  });

  it("the gen-review block is read: a verdict per item by its number, the suggestions once each, five at most", () => {
    const r = ask(ALL);
    expect(r.reply()).toBeNull();
    const suggestion = (k: number, scope?: string) => ({
      label: `Check case ${k}`,
      prompt: `Check the case ${k} against §5.6.6.`,
      ...(scope ? { scope } : {}),
    });
    const answered = r.part.answered(
      block({
        skipped: [
          { n: 1, verdict: "writable", why: "§5.6.6 states what the menu shows.", sources: [TK] },
          { n: 2, verdict: "confirmed", why: "Nothing in the request asks for it." },
          { n: 3, verdict: "unsure", why: "There is no third item to judge." },
        ],
        suggestions: [
          suggestion(1, "add"),
          suggestion(1),
          suggestion(2, "change"),
          suggestion(3),
          suggestion(4),
          suggestion(5),
          suggestion(6),
        ],
      }),
    );
    expect(answered).toBe(true);
    expect([...(r.reply()?.verdicts ?? [])]).toEqual([
      [1, { verdict: "writable", why: "§5.6.6 states what the menu shows.", sources: [TK] }],
      [2, { verdict: "confirmed", why: "Nothing in the request asks for it." }],
    ]);
    expect(r.reply()?.suggestions).toEqual([
      { label: "Check case 1", prompt: "Check the case 1 against §5.6.6.", scope: "add" },
      { label: "Check case 2", prompt: "Check the case 2 against §5.6.6." },
      { label: "Check case 3", prompt: "Check the case 3 against §5.6.6." },
      { label: "Check case 4", prompt: "Check the case 4 against §5.6.6." },
      { label: "Check case 5", prompt: "Check the case 5 against §5.6.6." },
    ]);
  });

  it("a reply without the block, or with one that does not fit, is not an answer: the part is asked again", () => {
    const bad = [
      "0 error(s), 0 warning(s).",
      block("{not json"),
      block({ skipped: [{ n: 1, verdict: "maybe", why: "It could perhaps be written." }] }),
      block({ skipped: [{ n: 1, verdict: "confirmed", why: "ok" }] }),
      block({ suggestions: [{ label: "x", prompt: "Do it better." }] }),
    ];
    for (const reply of bad) {
      const r = ask(ALL);
      expect(r.part.answered(reply), reply).toBe(false);
      expect(r.reply()).toBeNull();
    }
    const empty = ask(ALL);
    expect(empty.part.answered(block({}))).toBe(true);
    expect(empty.reply()).toEqual({ verdicts: new Map(), suggestions: [] });
  });
});

describe("what the second look changes", () => {
  it("« writable » stands only on a passage that exists and holds its quote; without one it is « unsure »", () => {
    const r = ask(ALL);
    r.part.answered(
      block({
        skipped: [
          {
            n: 1,
            verdict: "writable",
            why: "§5.6.6 states what the menu shows.",
            sources: [TK, `${DOC}#§5.6.6 "a quote the section does not hold"`, 'NOPE#§1 "x"', "not a source"],
          },
          { n: 2, verdict: "writable", why: "A passage is said to state it.", sources: [`${DOC}#§9.9 "nowhere"`] },
        ],
      }),
    );
    const reply = r.reply();
    if (!reply) throw new Error("no reply");
    const out = applyReview(ALL, r.items, reply, loadCorpus(dir));
    expect(out.map((s) => s.item)).toEqual(ALL.map((s) => s.item));
    expect(out[0].review).toEqual({ verdict: "writable", why: "§5.6.6 states what the menu shows.", sources: [TK] });
    expect(out[4].review).toEqual({
      verdict: "unsure",
      why: "A passage is said to state it. (the passage it cites could not be found in the documents)",
    });
    for (const k of [1, 2, 3]) expect(out[k]).toEqual(ALL[k]);
  });

  it("a reason that holds, or that could not be settled, is kept as Claude said it", () => {
    const r = ask([A, E]);
    r.part.answered(
      block({
        skipped: [
          { n: 1, verdict: "confirmed", why: "Searched again: no passage states it." },
          { n: 2, verdict: "unsure", why: "Two passages could be read either way.", sources: ["anything"] },
        ],
      }),
    );
    const reply = r.reply();
    if (!reply) throw new Error("no reply");
    const out = applyReview([A, E], r.items, reply, loadCorpus(dir));
    expect(out[0].review).toEqual({ verdict: "confirmed", why: "Searched again: no passage states it." });
    expect(out[1].review).toEqual({
      verdict: "unsure",
      why: "Two passages could be read either way.",
      sources: ["anything"],
    });
  });
});

describe("the action a second look leaves", () => {
  const writable = (item: string): Skipped =>
    left(item, "no-source", { review: { verdict: "writable", why: "§5.6.6 states it.", sources: [TK] } });

  it("only for an item found writable, with its passage: placed on the generation, for Opus", () => {
    const skipped = [
      writable("Défaut de la TK pendant la manœuvre"),
      left("Manœuvre à distance", "no-source", { review: { verdict: "confirmed", why: "It holds." } }),
      left("Fermeture", "no-source", { review: { verdict: "unsure", why: "Not settled.", sources: [TK] } }),
      left("Sans passage", "no-source", { review: { verdict: "writable", why: "Said writable, no passage." } }),
      left("Jamais regardé", "not-observable"),
    ];
    ledger("gen-1", { tests: [], skipped });
    const logs: string[] = [];
    expect(proposeWritable(dir, "gen-1", skipped, BY, (_l, m) => logs.push(m))).toBe(1);
    expect(logs).toEqual([]);
    const actions = listActions(dir);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      title: "Write the test left out: Défaut de la TK pendant la manœuvre",
      where: "gen:gen-1",
      scope: { kind: "project" },
      problem: `No test for « Défaut de la TK pendant la manœuvre » (No source for the expected result: Why Défaut de la TK pendant la manœuvre has no test.). A second look found the passage: ${TK}`,
      why: "§5.6.6 states it.",
      plan: [
        `Read ${DOC}#§5.6.6 and what it refers to`,
        "Write the test with tests_create in the generation's folder, that passage as the source of its expected result",
        "Run check_run on the new test: no finding is left",
      ],
      proposedBy: { run: "check", runId: "run-1", model: "opus", effort: "high" },
      suggest: { model: "opus", effort: "high" },
      target: { kind: "generation", id: "gen-1" },
    });
  });

  it("a long item is cut so the title stays within 80 characters; nothing writable, nothing proposed", () => {
    const long = writable(
      "Valeurs affichées dans la fenêtre Propriétés du sectionneur après une autorisation d'ouverture annulée",
    );
    ledger("gen-2", { tests: [], skipped: [long] });
    expect(proposeWritable(dir, "gen-2", [long], BY, () => {})).toBe(1);
    const [a] = listActions(dir);
    expect(a.title).toHaveLength(80);
    expect(a.title).toMatch(/^Write the test left out: Valeurs affichées dans la fenêtre Propriétés .+…$/);
    expect(proposeWritable(dir, "gen-2", [A, B, C, D, E], BY, () => {})).toBe(0);
    expect(listActions(dir)).toHaveLength(1);
  });

  it("an action that cannot be proposed is a warning, never a throw", () => {
    const logs: string[] = [];
    const item = writable("Défaut de la TK");
    expect(proposeWritable(dir, "no-ledger", [item], BY, (level, m) => logs.push(`${level}: ${m}`))).toBe(0);
    expect(logs).toEqual([
      "warn: No Claude action for « Défaut de la TK »: gen:no-ledger does not exist in this project.",
    ]);
    expect(listActions(dir)).toEqual([]);
  });

  it("a generation's stamp is its items left out: deleting one of its tests does not move it, an item settled does", () => {
    ledger("gen-3", { tests: ["local-0000aaaa", "local-0000bbbb"], skipped: [A] });
    const stamp = stampOf(dir, "gen:gen-3");
    expect(stamp).not.toBe("gone");
    ledger("gen-3", { tests: ["local-0000aaaa"], skipped: [A] });
    expect(stampOf(dir, "gen:gen-3")).toBe(stamp);
    ledger("gen-3", { tests: ["local-0000aaaa"], skipped: [] });
    expect(stampOf(dir, "gen:gen-3")).not.toBe(stamp);
    expect(stampOf(dir, "gen:nope")).toBe("gone");
  });
});
