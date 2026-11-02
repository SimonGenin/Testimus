import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { covers, ledgerOf, readLedger } from "../../src/core/claude/ledger.ts";
import { writeJson } from "../../src/core/lib/project.ts";

const PROJECT = join(import.meta.dirname, "..", "fixtures", "evidence", "project");
const SOSIE = join(import.meta.dirname, "..", "fixtures", "project");

describe("ledgerOf, the edges", () => {
  it("opens a ref once, skips empty refs, a missing document and an unmatched figure", () => {
    const l = ledgerOf(PROJECT, [
      { name: "mcp__testimus__rag_passage", input: { ref: "SPEC_B#§4.1" } },
      { name: "mcp__testimus__rag_passage", input: { ref: "SPEC_B#§4.1" } },
      { name: "mcp__testimus__rag_passage", input: { ref: "" } },
      { name: "mcp__testimus__rag_related", input: {} },
      { name: "mcp__testimus__rag_figure", input: { docId: "SPEC_A" } },
      { name: "mcp__testimus__rag_figure", input: { docId: "SPEC_A", n: 2 } },
      { name: "mcp__testimus__rag_passage", input: { ref: "NOPE#req:X" } },
      { name: "mcp__testimus__rag_passage", input: { ref: "SPEC_A#req:UNKNOWN_REQ" } },
      { name: "Read", input: { file_path: "docs/MISSING/doc.md" } },
      { name: "Read", input: { file_path: "docs/MISSING/figures/fig-1.png" } },
      { name: "Read", input: { file_path: "docs/SPEC_A/figures/none.png" } },
      { name: "Read", input: { file_path: "docs/SPEC_A/doc.md", offset: -3, limit: 0 } },
      { name: "Grep", input: { path: "tests", pattern: "x" } },
      { name: "Grep", input: { path: "tests", glob: "**/doc.md", pattern: "y" } },
      { name: "mcp__testimus__rag_search", input: { query: "" } },
      { name: "mcp__testimus__rag_search", input: { query: "q" } },
      { name: "mcp__testimus__rag_search", input: { query: "q" } },
      { name: "Other", input: {} },
    ]);
    expect(l.consulted.slice(0, 4)).toEqual(["SPEC_B#§4.1", "SPEC_A#fig:2", "NOPE#req:X", "SPEC_A#req:UNKNOWN_REQ"]);
    expect(l.consulted.slice(4).every((r) => r.startsWith("SPEC_A#§"))).toBe(true);
    expect(l.searched).toEqual([
      { tool: "Grep", query: "y" },
      { tool: "rag_search", query: "q" },
    ]);
  });

  it("finds a bare requirement id in every document that holds it, and nothing without a docs folder", () => {
    const l = ledgerOf(SOSIE, [{ name: "mcp__testimus__rag_passage", input: { ref: "EXI_MOP_SPF_510_A_20" } }]);
    expect(l.consulted[0]).toBe("SOSIE_211_D401-1_3#req:EXI_MOP_SPF_510_A_20");
    const empty = mkdtempSync(join(tmpdir(), "testimus-ledger-"));
    try {
      expect(ledgerOf(empty, [{ name: "mcp__testimus__rag_related", input: { ref: "REQ_1" } }]).consulted).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("readLedger keeps valid searches only, and refuses a ledger without consulted", () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-ledger-"));
    try {
      writeJson(join(dir, ".testimus", "gen", "a.json"), {
        consulted: [],
        searched: [null, { tool: "x" }, { tool: "t", query: "q" }],
      });
      writeJson(join(dir, ".testimus", "gen", "b.json"), { consulted: [] });
      writeJson(join(dir, ".testimus", "gen", "c.json"), { searched: [] });
      expect(readLedger(dir, "a")?.searched).toEqual([{ tool: "t", query: "q" }]);
      expect(readLedger(dir, "b")?.searched).toEqual([]);
      expect(readLedger(dir, "c")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("covers only sections, not other anchors", () => {
    expect(covers(["D#fig:1"], "D#fig:2")).toBe(false);
    expect(covers([], "D#§1")).toBe(false);
  });
});
