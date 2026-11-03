import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { covers, ledgerOf, readLedger } from "../../../../src/core/claude/ledger.ts";
import { toolCalls } from "../../../../src/core/claude/stream.ts";
import { writeJson } from "../../../../src/core/lib/project.ts";

const PROJECT = join(import.meta.dirname, "..", "..", "..", "fixtures", "evidence", "project");
const ABS = PROJECT;

let n = 0;
const line = (o: unknown) => JSON.stringify(o);
const use = (name: string, input: Record<string, unknown>) => {
  const id = `toolu_${++n}`;
  return {
    id,
    line: line({
      type: "assistant",
      message: { id: `msg_${n}`, role: "assistant", content: [{ type: "tool_use", id, name, input }] },
      session_id: "s1",
    }),
  };
};
const result = (id: string, text: string, error = false) =>
  line({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }], is_error: error }],
    },
    session_id: "s1",
  });

// ponytail: the shape claude -p --output-format stream-json --verbose writes: init, assistant tool_use, user tool_result,
// text, result
function stream(): string {
  const calls: [string, Record<string, unknown>, string, boolean?][] = [
    ["Skill", { skill: "generate-tests" }, "ok"],
    ["mcp__testimus__rag_search", { query: "vue ligne postes", k: 10 }, "[]"],
    ["mcp__testimus__rag_mentions", { term: "poste" }, "{}"],
    ["mcp__testimus__rag_passage", { ref: "SPEC_A#2.2" }, "{}"],
    ["mcp__testimus__rag_passage", { ref: "SPEC_B#§ 4.1" }, "{}"],
    ["mcp__testimus__rag_passage", { ref: "SPEC_A#§9.9" }, "No anchor", true],
    ["mcp__testimus__rag_related", { ref: "SPEC_A#§3.2" }, "{}"],
    ["mcp__testimus__rag_related", { ref: "EXI_MOP_SPF_100_A_20" }, "{}"],
    ["mcp__testimus__rag_figure", { docId: "SPEC_A", n: "fig:1" }, "{}"],
    ["Read", { file_path: `${ABS}\\docs\\SPEC_A\\doc.md`, offset: 12, limit: 3 }, "…"],
    ["Read", { file_path: `${ABS}\\docs\\SPEC_A\\doc.md`, offset: 30, limit: 5 }, "…"],
    ["Read", { file_path: "docs/PA1_SPEC_A/doc.md" }, "…"],
    ["Read", { file_path: `${ABS}\\docs\\SPEC_A\\figures\\fig-1.png` }, "[image]"],
    ["Read", { file_path: `${ABS}\\tests\\local-1\\test.md` }, "…"],
    ["Grep", { pattern: "double clic", path: "docs", output_mode: "content", "-n": true }, "docs/SPEC_A/doc.md:40:…"],
    ["Grep", { pattern: "summary", path: "tests" }, "…"],
    ["mcp__testimus__tests_create", { summary: "x" }, '{"id":"local-1"}'],
  ];
  const out = [line({ type: "system", subtype: "init", session_id: "s1", tools: ["Read"], mcp_servers: [] })];
  for (const [name, input, text, error] of calls) {
    const u = use(name, input);
    out.push(u.line, result(u.id, text, !!error));
  }
  out.push(line({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } }));
  out.push(line({ type: "result", subtype: "success", is_error: false, result: "Done.", total_cost_usd: 0.1 }));
  return out.join("\n");
}

describe("evidence ledger (SPEC-RAG §5.3)", () => {
  const ledger = ledgerOf(PROJECT, toolCalls(stream()));

  it("takes what the run opened from its tool calls: passages, related refs, figures, Read ranges of doc.md", () => {
    expect(ledger.consulted).toEqual([
      "SPEC_A#§2.2",
      "SPEC_B#§4.1",
      "SPEC_A#§3.2",
      "SPEC_A#fig:1",
      "SPEC_A#§2",
      "SPEC_A#§2.1",
      "PA1_SPEC_A#§commentaires-majeurs",
      "PA1_SPEC_A#§commentaires-mineurs",
    ]);
  });

  it("leaves out failed calls and files that are not documents", () => {
    expect(ledger.consulted.join(" ")).not.toMatch(/§9\.9|local-1/);
  });

  it("records the searches: rag_search, rag_mentions, Grep on the documents", () => {
    expect(ledger.searched).toEqual([
      { tool: "rag_search", query: "vue ligne postes" },
      { tool: "rag_mentions", query: "poste" },
      { tool: "Grep", query: "double clic" },
    ]);
  });

  it("a section read covers its sub-sections, not its parent", () => {
    expect(covers(["D#§5.6"], "D#§5.6.6")).toBe(true);
    expect(covers(["D#§5.6.6"], "D#§5.6")).toBe(false);
    expect(covers(["D#§5.6"], "E#§5.6.6")).toBe(false);
    expect(covers(["D#fig:1"], "D#fig:1")).toBe(true);
  });

  it("reads the ledger of a job back, and nothing for a bad id", () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-ledger-"));
    try {
      writeJson(join(dir, ".testimus", "gen", "generate-0001.json"), {
        consulted: ["D#§1", 2],
        searched: [{ tool: "rag_search", query: "q" }],
      });
      expect(readLedger(dir, "generate-0001")).toEqual({
        jobId: "generate-0001",
        consulted: ["D#§1"],
        searched: [{ tool: "rag_search", query: "q" }],
      });
      expect(readLedger(dir, "../x")).toBeNull();
      expect(readLedger(dir, "generate-none")).toBeNull();
      expect(readLedger(dir, undefined)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ledgerOf, the edges", () => {
  it("opens a ref once, skips empty refs, a missing document and an unmatched figure", () => {
    const l = ledgerOf(PROJECT, [
      { name: "mcp__testimus__rag_passage", input: { ref: "SPEC_B#§4.1" } },
      { name: "mcp__testimus__rag_passage", input: { ref: "SPEC_B#§4.1" } },
      { name: "mcp__testimus__rag_passage", input: { ref: "" } },
      { name: "mcp__testimus__rag_related", input: {} },
      { name: "mcp__testimus__rag_figure", input: { docId: "SPEC_A" } },
      { name: "mcp__testimus__rag_figure", input: { docId: "SPEC_A", n: 2 } },
      { name: "mcp__testimus__rag_passage", input: { ref: "NOPE#§9" } },
      { name: "mcp__testimus__rag_passage", input: { ref: "EXI_MOP_SPF_510_A_20" } },
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
    expect(l.consulted.slice(0, 3)).toEqual(["SPEC_B#§4.1", "SPEC_A#fig:2", "NOPE#§9"]);
    expect(l.consulted.slice(3).every((r) => r.startsWith("SPEC_A#§"))).toBe(true);
    expect(l.searched).toEqual([
      { tool: "Grep", query: "y" },
      { tool: "rag_search", query: "q" },
    ]);
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
