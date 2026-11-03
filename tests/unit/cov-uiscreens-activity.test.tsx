// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobEvent } from "../../src/core/types.ts";
import { activityOf, coverage, lasted } from "../../src/ui/lib/activity.ts";
import { GenActivity } from "../../src/ui/screens/generate/GenActivity.tsx";
import { landedIds } from "../../src/ui/screens/generate/GenResult.tsx";
import { api, fakeFetch, named } from "./ui-desktop-helpers.tsx";

beforeEach(() => fakeFetch());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let sec = 0;
const at = () => new Date(Date.parse("2026-11-03T11:51:00.000Z") + 1000 * sec++).toISOString();
const tool = (name: string, input: Record<string, unknown> | string): JobEvent => ({
  jobId: "g",
  at: at(),
  type: "claude",
  event: { type: "tool", name, input: typeof input === "string" ? input : JSON.stringify(input) },
});
const DOC = "D:\\P\\docs\\SOSIE_4113_D401-1\\doc.md";
const page = (offset: number | undefined, limit: number | undefined) => tool("Read", { file_path: DOC, offset, limit });

function run(): JobEvent[] {
  sec = 0;
  return [
    { jobId: "g", at: at(), type: "progress", message: "Reading passages" },
    tool("Skill", { skill: "generate-tests" }),
    tool("mcp__testimus__docs_show", { id: "SOSIE_4113_D401-1" }),
    tool("mcp__testimus__tests_list", {}),
    tool("Read", { file_path: "D:\\P\\docs\\SOSIE_4113_D401-1\\context.md" }),
    tool("Read", { file_path: "D:\\P\\CLAUDE.md" }),
    page(undefined, 400),
    { jobId: "g", at: at(), type: "progress", message: "Reading passages (1)" },
    page(400, 700),
    tool("Glob", { pattern: "docs/SOSIE_4113_D401-1/*" }),
    page(1100, 800),
    tool("mcp__testimus__traces_list", {}),
    page(1900, 480),
    tool("mcp__testimus__tests_create", { summary: "Circulation des trains" }),
    tool("mcp__testimus__tests_create", { summary: "Alarmes" }),
    tool("mcp__testimus__tests_create", {}),
    tool("mcp__testimus__tests_show", { id: "local-bcfc0be3" }),
    tool(
      "mcp__testimus__tests_save",
      '{"id":"local-bcfc0be3","test":{"project":"","summary":"Circulation des trains","folder":"/","description":"Vérifie l\'arrêt et le départ des trains selon l\'aspect des s...',
    ),
    tool("mcp__testimus__tests_save", { id: "local-5730416c", test: { summary: "Alarmes" } }),
    tool("mcp__testimus__tests_edit", { id: "local-5730416c", description: "x" }),
    tool("Write", { file_path: "D:\\P\\tests\\local-0000abcd\\test.md" }),
    tool("Edit", { file_path: "D:\\P\\notes.txt" }),
    tool("Read", { file_path: "D:\\P\\tests\\local-0000abcd\\test.md" }),
    tool("Grep", { pattern: "Départ", path: "D:\\P\\src" }),
    tool("mcp__testimus__xray_fields", {}),
    { jobId: "g", at: at(), type: "progress", message: "Writing local-5730416c (2)" },
    { jobId: "g", at: at(), type: "log", level: "warn", message: "The generation changed the existing test X" },
    { jobId: "g", at: at(), type: "claude", event: { type: "text", text: "Done." } },
    { jobId: "g", at: at(), type: "progress", message: "Checking 2 new test(s)" },
    tool("mcp__testimus__tests_check", { id: "local-bcfc0be3" }),
    { jobId: "g", at: at(), type: "progress", message: "Something else" },
    {
      jobId: "g",
      at: at(),
      type: "status",
      job: { id: "g", kind: "generate", status: "done", result: { tests: ["a", "b"] } } as unknown as Job,
    },
  ];
}

describe("activityOf", () => {
  it("folds a generation into phases: lookups stay inside the phase they interrupt", () => {
    const p = activityOf(run());
    expect(p.map((x) => x.kind)).toEqual(["prepare", "read", "plan", "write", "check", "end"]);
    expect(p[0].acts.map((a) => a.text)).toEqual([
      "Opened the generate-tests instructions",
      "Looked up SOSIE_4113_D401-1",
      "Listed the existing tests",
      "Read the team notes on SOSIE_4113_D401-1",
      "Read the project instructions",
    ]);
    expect(p[1].reads).toEqual([
      {
        doc: "SOSIE_4113_D401-1",
        spans: [
          { from: 1, to: 400 },
          { from: 400, to: 1099 },
          { from: 1100, to: 1899 },
          { from: 1900, to: 2379 },
        ],
      },
    ]);
    expect(p[1].acts.map((a) => a.text)).toContain("Listed the tracked ids");
    expect(p[1].acts.map((a) => a.text)).toContain("Listed docs/SOSIE_4113_D401-1/*");
    expect(p[2].planned).toEqual(["Circulation des trains", "Alarmes", "Untitled test"]);
    expect(p[3].written).toEqual([
      { id: "local-bcfc0be3", summary: "Circulation des trains", saves: 1 },
      { id: "local-5730416c", summary: "Alarmes", saves: 2 },
      { id: "local-0000abcd", summary: "", saves: 1 },
    ]);
    expect(p[3].acts.map((a) => a.text)).toEqual([
      "Wrote the steps of “Circulation des trains”",
      "Wrote the steps of “Alarmes”",
      "Corrected “Alarmes”",
      "Wrote local-0000abcd",
      "Edited P/notes.txt",
      "Opened local-0000abcd",
      "Searched the files for “Départ”",
      "Used xray.fields",
      "The generation changed the existing test X",
    ]);
    expect(p[3].acts.at(-1)?.level).toBe("warn");
    expect(p[4].acts.map((a) => a.text)).toEqual([
      "Checking 2 new test(s)",
      "Checked local-bcfc0be3",
      "Something else",
    ]);
    expect(p[5].acts[0].text).toBe("Done · 2 tests written");
  });

  it("names searches, passages, whole reads and failures", () => {
    sec = 0;
    const p = activityOf([
      { jobId: "g", at: at(), type: "log", level: "info", message: "Starting" },
      tool("mcp__testimus__rag_search", { query: "x".repeat(70) }),
      tool("mcp__testimus__rag_passage", { docId: "D", anchor: "§1" }),
      tool("mcp__testimus__rag_figure", { docId: "D", anchor: "fig:2" }),
      tool("mcp__testimus__rag_related", { docId: "D", anchor: "§1" }),
      tool("mcp__testimus__rag_mentions", { term: "DSO" }),
      tool("mcp__testimus__rag_mentions", {}),
      tool("Grep", { pattern: "DSO", path: DOC }),
      tool("Read", { file_path: DOC }),
      tool("mcp__testimus__docs_list", {}),
      tool("mcp__testimus__contexts_list", {}),
      tool("mcp__testimus__docs_show", {}),
      tool("Read", { file_path: "D:\\P\\eval\\x.json" }),
      tool("mcp__testimus__tests_show", {}),
      tool("Skill", {}),
      tool("mcp__testimus__tests_check", {}),
      { jobId: "g", at: at(), type: "claude", event: { type: "result", ok: false, text: "limit", durationMs: 1 } },
      { jobId: "g", at: at(), type: "claude", event: { type: "result", ok: true, text: "", durationMs: 1 } },
      tool("mcp__testimus__tests_save", "not json"),
      {
        jobId: "g",
        at: at(),
        type: "status",
        job: { id: "g", kind: "generate", status: "failed", error: "boom" } as unknown as Job,
      },
      { jobId: "g", at: at(), type: "status", job: { id: "g", kind: "generate", status: "running" } as Job },
    ]);
    expect(p.map((x) => x.kind)).toEqual(["prepare", "read", "check", "write", "end"]);
    expect(p[1].acts.map((a) => a.text)).toEqual([
      `Searched the documents for “${"x".repeat(57)}…”`,
      "Read D §1",
      "Read D fig:2",
      "Looked for what relates to D §1",
      "Looked for every mention of “DSO”",
      "Looked for every mention of “”",
      "Searched for “DSO”",
      "Read SOSIE_4113_D401-1 in one go",
      "Listed the documents",
      "Read the saved contexts",
      "Looked up a document",
      "Read eval/x.json",
      "Opened a test",
      "Opened the skill instructions",
    ]);
    expect(p[1].searches).toBe(7);
    expect(p[2].acts.map((a) => a.text)).toEqual(["Checked a test", "Claude stopped: limit"]);
    expect(p[2].failed).toBe(true);
    expect(p[3].written).toEqual([{ id: "", summary: "", saves: 1 }]);
    expect(p[4]).toMatchObject({ failed: true, acts: [{ text: "Failed · boom", level: "error" }] });
  });

  it("measures what was read: in order, twice, skipped, whole", () => {
    expect(
      coverage([
        { from: 1, to: 400 },
        { from: 400, to: 1000 },
      ]),
    ).toEqual({
      last: 1000,
      read: 1000,
      twice: 1,
      inOrder: true,
      whole: false,
    });
    expect(
      coverage([
        { from: 500, to: 600 },
        { from: 1, to: 100 },
        { from: 1, to: 100 },
        { from: 1, to: null },
      ]),
    ).toEqual({ last: 600, read: 201, twice: 100, inOrder: false, whole: true });
    expect(lasted("2026-01-01T00:00:00Z", "2026-01-01T00:00:07Z")).toBe("7 s");
    expect(lasted("2026-01-01T00:00:00Z", "2026-01-01T00:06:05Z")).toBe("6 min 05 s");
    expect(lasted("2026-01-01T00:00:00Z", "2026-01-01T01:02:00Z")).toBe("1 h 02 min");
    expect(lasted("2026-01-01T00:00:10Z", "2026-01-01T00:00:00Z")).toBe("0 s");
  });

  it("lands the tests saved through tests_save even without a Writing progress", () => {
    expect(landedIds(run())).toEqual(["local-bcfc0be3", "local-5730416c"]);
  });
});

describe("GenActivity", () => {
  it("shows each phase, the reading bar against the document length, and the actions on demand", async () => {
    api.routes["docs.show"] = () => ({ md: Array.from({ length: 4000 }, () => "l").join("\n") });
    const events = run();
    render(<GenActivity events={events} running={false} now={Date.now()} />);
    expect(screen.getByRole("heading", { name: "Got ready" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Opened the generate-tests instructions, looked up SOSIE_4113_D401-1, listed the existing tests, read the team notes on SOSIE_4113_D401-1, read the project instructions.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Read SOSIE_4113_D401-1" })).toBeInTheDocument();
    expect(
      await screen.findByText("Lines 1–2,379 of 4,000, in 4 pages, front to back; nothing read twice."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Lines read: 1 to 400, 400 to 1099, 1100 to 1899, 1900 to 2379 of 4000" }),
    ).toBeInTheDocument();
    expect(named("docs.show")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Planned 3 tests" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wrote the steps of 3 tests" })).toBeInTheDocument();
    expect(screen.getByText("Last written: local-0000abcd; 1 test written more than once.")).toBeInTheDocument();
    expect(screen.getByText("The generation changed the existing test X")).toHaveClass("act-warn");
    expect(screen.getByRole("heading", { name: "Checked the new tests" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Done · 2 tests written" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show the 4 actions" }));
    expect(screen.getByText(/Planned “Alarmes”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide the 4 actions" }));
    expect(screen.queryByText(/Planned “Alarmes”/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "What Claude did" }));
    expect(screen.queryByRole("heading", { name: "Got ready" })).toBeNull();
    expect(screen.queryByRole("button", { name: /raw log/ })).toBeNull();
    const fold = screen.getByRole("button", { name: "What Claude did 6 phases" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(fold);
    expect(screen.getByRole("heading", { name: "Got ready" })).toBeInTheDocument();
  });

  it("while running: the live phase, its pulse, the count against the plan; a failed doc lookup leaves the bar to scale", async () => {
    api.routes["docs.show"] = () => {
      throw new Error("gone");
    };
    sec = 0;
    const events = [
      page(1, 100),
      page(1, 100),
      page(300, 100),
      tool("mcp__testimus__tests_create", { summary: "A" }),
      tool("mcp__testimus__tests_create", { summary: "B" }),
      tool("mcp__testimus__tests_save", { id: "local-aaaaaaaa", test: { summary: "A" } }),
    ];
    const { rerender, container } = render(<GenActivity events={events.slice(0, 3)} running={true} now={Date.now()} />);
    expect(screen.getByRole("heading", { name: "Reading SOSIE_4113_D401-1" })).toBeInTheDocument();
    await waitFor(() => expect(named("docs.show")).toHaveLength(1));
    expect(
      screen.getByText("Lines 1–399, in 3 pages; 199 lines skipped; 100 lines read more than once."),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".readbar-page.is-latest")).toHaveLength(1);
    rerender(<GenActivity events={events} running={true} now={Date.now()} />);
    expect(screen.getByRole("heading", { name: "Writing the steps: 1 of 2 done" })).toBeInTheDocument();
    expect(screen.getByText("Last written: “A”.")).toBeInTheDocument();
    expect(container.querySelector(".is-live .run-dot")).not.toBeNull();
    rerender(
      <GenActivity
        events={[tool("mcp__testimus__rag_search", { query: "q" }), tool("Read", { file_path: DOC })]}
        running={true}
        now={Date.now()}
      />,
    );
    expect(screen.getByText("Read in one go; nothing read twice.")).toBeInTheDocument();
    expect(screen.getByText("Also 1 lookup in the index (searches, passages, related sections).")).toBeInTheDocument();
    rerender(
      <GenActivity events={[tool("mcp__testimus__rag_search", { query: "q" })]} running={true} now={Date.now()} />,
    );
    expect(screen.getByRole("heading", { name: "Searching the documents" })).toBeInTheDocument();
    expect(screen.getByText("1 lookup in the index (searches, passages, related sections).")).toBeInTheDocument();
  });

  it("before anything happens, and for a run with nothing recorded", () => {
    const { rerender } = render(<GenActivity events={[]} running={true} now={Date.now()} />);
    expect(screen.getByText("Claude is starting.")).toBeInTheDocument();
    rerender(<GenActivity events={[]} running={false} now={Date.now()} />);
    expect(screen.getByText("Nothing was recorded for this run.")).toBeInTheDocument();
    sec = 0;
    rerender(
      <GenActivity
        events={[tool("Skill", { skill: "s" }), tool("mcp__testimus__tests_check", { id: "x" })]}
        running={true}
        now={Date.now()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Checking the new tests" })).toBeInTheDocument();
    rerender(<GenActivity events={[tool("mcp__testimus__tests_create", {})]} running={true} now={Date.now()} />);
    expect(screen.getByRole("heading", { name: "Planning 1 test" })).toBeInTheDocument();
    rerender(<GenActivity events={[tool("Skill", { skill: "s" })]} running={true} now={Date.now()} />);
    expect(screen.getByRole("heading", { name: "Getting ready" })).toBeInTheDocument();
  });
});
