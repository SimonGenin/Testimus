import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeSkipped } from "../../../../src/core/claude/gen-again.ts";
import {
  dedupeSkipped,
  REASON_LABEL,
  type Skipped,
  type SkipReason,
  skipDoubts,
} from "../../../../src/core/claude/gen-reply.ts";
import { loadCorpus } from "../../../../src/core/lib/check.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const DOC = "SOSIE_211_D401-1_3";
const MAGENTA = `${DOC}#§5.6.6 "L'état ouvert ou fermé du sectionneur est visible sans ouvrir de fenêtre"`;
const TK = `${DOC}#§5.6.6 "un sectionneur avec TK manœuvré régulièrement ne propose que Propriétés"`;

const left = (item: string, reason: SkipReason, more: Partial<Skipped> = {}): Skipped => ({
  item,
  reason,
  category: REASON_LABEL[reason],
  why: `Why ${item} has no test.`,
  ...more,
});
const items = (xs: Skipped[]) => xs.map((s) => s.item);

describe("the same behavior reported by the plan and by several runs is one item", () => {
  it("same reason and the same words, accents and case aside: one, the fuller report kept", () => {
    const short = left("État Invalide", "no-source", { sources: [MAGENTA] });
    const full = left("etat invalide", "no-source", {
      why: "Searched the state twice: no passage states what the symbol shows then.",
      sources: [TK],
      searched: ["état invalide"],
      read: [`${DOC}#§5.6.6`],
    });
    expect(dedupeSkipped([short, full])).toEqual([full]);
    expect(dedupeSkipped([full, short])).toEqual([full]);
  });

  it("same reason and an identical source line — the same passage and the same quote — is one item, « no source » too", () => {
    const why = "No passage states what the symbol shows then.";
    const a = left("État Invalide", "no-source", { why, sources: [MAGENTA] });
    const b = left("Carré magenta de l'état invalide", "no-source", { why, sources: [TK, MAGENTA] });
    const c = left("Symbole d'un sectionneur invalide", "no-source", {
      why,
      sources: [`${DOC}#§5.6.6  "L'ÉTAT ouvert ou fermé du sectionneur est visible sans ouvrir de fenêtre" `],
    });
    expect(items(dedupeSkipped([a, b, c]))).toEqual(["État Invalide"]);
    const observable = left("Fenêtre invalide", "not-observable", { sources: [MAGENTA] });
    expect(items(dedupeSkipped([a, observable]))).toEqual(["État Invalide", "Fenêtre invalide"]);
  });

  it("« no source » items that only share a section stay apart: one section asks for several behaviors", () => {
    const a = left("Manœuvre à distance", "no-source", { sources: [TK] });
    const b = left("Défaut de la TK", "no-source", { sources: [MAGENTA] });
    expect(items(dedupeSkipped([a, b]))).toEqual(["Manœuvre à distance", "Défaut de la TK"]);
  });

  it("for another reason, the same passage under other words is the same item", () => {
    const a = left("Rafraîchissement du cache", "not-observable", { sources: [TK] });
    const b = left("Cache serveur", "not-observable", { sources: [`${DOC}#§5.6.6 "another quote of the section"`] });
    const elsewhere = left("Journal serveur", "not-observable", { sources: [`${DOC}#§5.6.7 "x"`] });
    expect(items(dedupeSkipped([a, b, elsewhere]))).toEqual(["Rafraîchissement du cache", "Journal serveur"]);
  });

  it("another reason is another item, even under the same words", () => {
    const a = left("Fermeture", "no-source", { sources: [TK] });
    const b = left("Fermeture", "out-of-scope", { sources: [TK] });
    expect(dedupeSkipped([a, b])).toEqual([a, b]);
  });

  it("an item a run says a test of this very generation verifies is not left out at all", () => {
    const mine = left("Menu sans TK", "already-tested", { test: "local-0000aaaa" });
    const theirs = left("Menu du disjoncteur", "already-tested", { test: "LFRPS12-1398" });
    expect(dedupeSkipped([mine, theirs], ["local-0000aaaa"])).toEqual([theirs]);
    expect(dedupeSkipped([mine, theirs])).toEqual([mine, theirs]);
  });
});

describe("an item left out before stays unless this run wrote it or reported it again", () => {
  it("covered goes, reported again takes its new reason, the rest is kept in front", () => {
    const before = [left("A", "no-source"), left(" b ", "no-source"), left("C", "out-of-scope")];
    const now = [left("B", "missing-material"), left("D", "not-observable")];
    expect(mergeSkipped(before, now, ["a"]).map((s) => [s.item, s.reason])).toEqual([
      ["C", "out-of-scope"],
      ["B", "missing-material"],
      ["D", "not-observable"],
    ]);
  });
});

describe("what Testimus can check about an item without a model", () => {
  let dir: string;
  const opened = { consulted: [`${DOC}#§5.6.6`], searched: [{ tool: "rag_search", query: "sectionneur" }] };

  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), "testimus-left-out-")), "LFRPS12");
    cpSync(FIXTURE, dir, { recursive: true });
  });
  afterEach(() => rmSync(join(dir, ".."), { recursive: true, force: true }));

  const doubts = (s: Skipped, ledger = opened) => skipDoubts(dir, s, loadCorpus(dir), ledger);

  it("an item whose proof holds raises no doubt", () => {
    const s = left("Manœuvre à distance", "no-source", {
      sources: [TK],
      searched: ["manœuvre"],
      read: [`${DOC}#§5.6.6`, `${DOC}#fig:40`],
    });
    expect(doubts(s)).toEqual([]);
  });

  it("a source that does not hold: no such document, no such anchor, a quote the section does not have, not a source", () => {
    const s = left("X", "out-of-scope", {
      sources: ['NOPE#§1 "x"', `${DOC}#§9.9 "x"`, `${DOC}#§5.6.7 "ne propose que Propriétés"`, "voir le chapitre 5"],
    });
    expect(doubts(s)).toEqual([
      "Its source does not hold: NOPE is not a document of this project.",
      `Its source does not hold: ${DOC} has no anchor §9.9.`,
      `Its source does not hold: the quote "ne propose que Propriétés" is not under ${DOC}#§5.6.7.`,
      'Its source does not hold: "voir le chapitre 5" is not docId#anchor "quote".',
    ]);
  });

  it("a test said to verify it that is not in the project; passages said read and never opened", () => {
    expect(doubts(left("Menu", "already-tested", { test: "LFRPS12-9999" }))).toEqual([
      'It names "LFRPS12-9999", which is not a test of this project.',
    ]);
    expect(doubts(left("Menu", "already-tested", { test: "LFRPS12-1398" }))).toEqual([]);
    const unread = left("X", "not-observable", { sources: [TK], read: [`${DOC}#§5.6.7`, `${DOC}#§5.6.6`] });
    expect(doubts(unread)).toEqual([`The run says it read ${DOC}#§5.6.7, and never opened it.`]);
    const two = left("X", "not-observable", { sources: [TK], read: [`${DOC}#§5.6.7`, `${DOC}_4#§4`] });
    expect(doubts(two)).toEqual([`The run says it read ${DOC}#§5.6.7, ${DOC}_4#§4, and never opened them.`]);
  });

  it("a passage counts as opened when a section that holds it was: its figure, its sub-section", () => {
    const parent = { consulted: [`${DOC}#§5.6`], searched: opened.searched };
    const s = left("X", "not-observable", { sources: [TK], read: [`${DOC}#§5.6.6`, `${DOC}#fig:40`] });
    expect(doubts(s, parent)).toEqual([]);
  });

  it("giving up for want of a source without a single search is said; another reason does not need one", () => {
    const none = { consulted: opened.consulted, searched: [] };
    expect(doubts(left("X", "no-source", { sources: [TK] }), none)).toEqual([
      "The run gave up without a single search of the documents.",
    ]);
    expect(doubts(left("X", "missing-material", { sources: [TK] }), none)).toHaveLength(1);
    expect(doubts(left("X", "out-of-scope", { sources: [TK] }), none)).toEqual([]);
  });
});
