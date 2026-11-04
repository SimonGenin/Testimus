// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchMatch, SearchResult } from "../../../../src/core/types.ts";
import { CommandForm, formValue, hasInput, plannedFirst } from "../../../../src/ui/components/shell/CommandForm.tsx";
import { Palette } from "../../../../src/ui/components/shell/Palette.tsx";
import type { CommandInfo } from "../../../../src/ui/lib/data/client.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { jumpTo, rememberHit, takeJump } from "../../../../src/ui/lib/search.ts";
import { callsOf, fakeEvents, fakeNet, net } from "../../cov-uishell-helpers.tsx";
import { clearAllToasts, withData } from "./helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
  localStorage.clear();
  setProject("C:\\p");
});

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
  localStorage.clear();
});

const cmd = (name: string, summary: string, properties: Record<string, object> = {}): CommandInfo => ({
  name,
  summary,
  mutates: false,
  job: false,
  input: { type: "object", properties, required: [] },
});

const commands = [
  cmd("xray.push", "Push a local test to Jira", { id: { type: "string" } }),
  cmd("xray.pull", "Pull tests from Jira", { key: { type: "string" } }),
  cmd("tests.list", "List the local tests"),
  cmd("system.version", "Testimus and Node versions"),
];

const options = () => screen.getAllByRole("option").map((o) => o.textContent ?? "");

const hit = (h: Partial<SearchMatch>): SearchMatch => ({
  kind: "test",
  id: "T-1",
  title: "Sectionneur sans TK",
  titleMarks: [[0, 11]],
  marks: [],
  score: 1,
  why: "words",
  ...h,
});

const result = (hits: SearchMatch[], extra: Partial<SearchResult> = {}): SearchResult => ({
  hits,
  totals: { test: hits.filter((h) => h.kind === "test").length },
  order: ["test", "document", "passage"],
  meaning: "on",
  unembedded: 0,
  notes: [],
  ...extra,
});

describe("command palette", () => {
  it("lists every command and the app actions when empty, grouped", () => {
    withData(
      <Palette
        commands={commands}
        actions={[{ id: "go-tests", label: "Go to Tests", group: "Go to", run: () => {} }]}
        onCommand={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getAllByRole("option")).toHaveLength(5);
    expect(screen.getByRole("group", { name: "Go to" })).toHaveTextContent("Go to Tests");
    expect(within(screen.getByRole("group", { name: "Commands" })).getAllByRole("option")).toHaveLength(4);
    expect(screen.getByRole("option", { name: /xray\.push/ })).toHaveTextContent("needs input");
    expect(screen.getByRole("option", { name: /tests\.list/ })).not.toHaveTextContent("needs input");
  });

  it("filters by name and summary words", () => {
    withData(<Palette commands={commands} actions={[]} onCommand={() => {}} onAsk={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pu" } });
    const shown = options();
    expect(shown.filter((o) => o.includes("xray"))).toHaveLength(2);
    expect(shown.some((o) => o.includes("tests.list"))).toBe(false);
    expect(shown[shown.length - 1]).toContain("Ask Claude");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "jira push" } });
    expect(options().filter((o) => o.includes("xray"))).toEqual([expect.stringContaining("xray.push")]);
  });

  it("runs the highlighted entry with Enter", () => {
    const onCommand = vi.fn();
    const onClose = vi.fn();
    withData(<Palette commands={commands} actions={[]} onCommand={onCommand} onClose={onClose} />);
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "version" } });
    expect(box).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0].id);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
    expect(onCommand).toHaveBeenCalledWith(commands[3]);
  });

  it("knows which commands need a form and builds their input", () => {
    expect(hasInput(commands[0])).toBe(true);
    expect(hasInput(commands[2])).toBe(false);
    const schema = {
      type: "object",
      properties: {
        id: { type: "string" },
        from: { type: "number" },
        dryRun: { type: "boolean" },
        keys: { type: "array", items: { type: "string" } },
      },
    };
    expect(formValue(schema, { id: "LFRPS12-1420", from: "3", dryRun: true, keys: "A-1, A-2" })).toEqual({
      id: "LFRPS12-1420",
      from: 3,
      dryRun: true,
      keys: ["A-1", "A-2"],
    });
  });

  it("moves with the arrows, picks with the mouse and asks the documents", () => {
    const onAsk = vi.fn();
    const onClose = vi.fn();
    const run = vi.fn();
    withData(
      <Palette
        commands={[
          { name: "tests.list", summary: "List the local tests.", mutates: false, job: false, input: {} },
          { name: "odd.thing", summary: "", mutates: false, job: false, input: {} },
        ]}
        actions={[{ id: "a", label: "Go somewhere", run }]}
        onCommand={() => {}}
        onAsk={onAsk}
        onClose={onClose}
      />,
    );
    const input = screen.getByRole("combobox");
    expect(screen.getByRole("option", { name: /odd\.thing/ })).toBeInTheDocument();
    for (let i = 0; i < 3; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
    for (let i = 0; i < 3; i++) fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.mouseEnter(screen.getAllByRole("option")[1]);
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(run).toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "  quel menu  " } });
    const askOption = screen.getByRole("option", { name: /Ask Claude/ });
    fireEvent.mouseEnter(askOption);
    expect(askOption).toHaveAttribute("aria-selected", "true");
    fireEvent.click(askOption);
    expect(onAsk).toHaveBeenCalledWith("quel menu");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("says when nothing matches, ignores Enter then, clears the field, and closes on the backdrop", () => {
    const onClose = vi.fn();
    withData(<Palette commands={commands} actions={[]} onCommand={() => {}} onClose={onClose} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches “zzz”.")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(input).toHaveValue("");
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("picks the ask entry with Enter when it is the only one", () => {
    const onAsk = vi.fn();
    withData(<Palette commands={[]} actions={[]} onCommand={() => {}} onAsk={onAsk} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "alarme" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onAsk).toHaveBeenCalledWith("alarme");
  });
});

describe("search palette", () => {
  it("shows the hits grouped, with the step they come from, and opens one with Enter", async () => {
    net.routes["search.all"] = () =>
      result(
        [
          hit({ snippet: "Clic droit sur le sectionneur", marks: [[18, 29]], where: "Step 2 · Action", step: 2 }),
          hit({ kind: "document", id: "D", title: "Spécification", titleMarks: [], docId: "D" }),
        ],
        { totals: { test: 9, document: 1 } },
      );
    const onHit = vi.fn();
    const onClose = vi.fn();
    withData(<Palette commands={[]} actions={[]} onCommand={() => {}} onHit={onHit} onClose={onClose} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), { target: { value: "sectionneur" } });
    expect(await screen.findByText("Step 2 · Action")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Documents" })).toHaveTextContent("Spécification");
    expect(screen.getByRole("tab", { name: /^Tests/ })).toHaveTextContent("9");
    expect(screen.getByRole("button", { name: "All 9 tests" })).toBeInTheDocument();
    expect(screen.getAllByText("sectionneur")[0].tagName).toBe("MARK");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
    expect(onHit).toHaveBeenCalledWith(expect.objectContaining({ id: "T-1", step: 2 }));
  });

  it("narrows to one kind with Tab, asks for more, and offers to index the tests", async () => {
    net.routes["search.all"] = () => result([hit({ why: "meaning" })], { unembedded: 4 });
    net.routes["search.index"] = () => ({ jobId: "j1" });
    withData(<Palette commands={[]} actions={[]} onCommand={() => {}} onHit={() => {}} onClose={() => {}} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "frein" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getByRole("tab", { name: /^Tests/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(callsOf("search.all").some((c) => (c.input.in as string[])?.[0] === "test")).toBe(true));
    expect(callsOf("search.all").at(-1)?.input.k).toBe(40);
    expect(await screen.findByText("≈ meaning")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /4 tests not searchable by meaning yet/ }));
    await waitFor(() => expect(callsOf("search.index")).toHaveLength(1));
    expect(await screen.findByText("Indexing the tests by meaning")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
  });

  it("asks words first then meaning, says which, and shows the recent hits when empty", async () => {
    rememberHit(hit({ id: "T-9", title: "Disjoncteur" }));
    net.routes["search.all"] = (i) => result([], { meaning: i.meaning ? "on" : "off" });
    withData(<Palette commands={[]} actions={[]} onCommand={() => {}} onHit={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("group", { name: "Recent" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Disjoncteur/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzz" } });
    await waitFor(() => expect(callsOf("search.all").map((c) => c.input.meaning)).toEqual([false, true]));
    expect(await screen.findByText("Nothing matches “zzz”.")).toBeInTheDocument();
    expect(await screen.findByText("Words + meaning")).toBeInTheDocument();
  });

  it("says when the search is by words only", async () => {
    net.routes["search.all"] = () => result([hit({})], { meaning: "unavailable", notes: ["No search pack."] });
    withData(<Palette commands={[]} actions={[]} onCommand={() => {}} onHit={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "frein" } });
    expect(await screen.findByText("Words only")).toBeInTheDocument();
    expect(screen.queryByText("≈ meaning")).toBeNull();
  });

  it("hands a step to the editor once, for that test only", () => {
    jumpTo("T-1", 3);
    expect(takeJump("T-2")).toBeNull();
    expect(takeJump("T-1")).toBe(3);
    expect(takeJump("T-1")).toBeNull();
  });
});

describe("palette never writes to Jira blind", () => {
  it("knows which commands are planned first", () => {
    expect(plannedFirst("xray.push", { id: "LFRPS12-1420" })).toBe("push");
    expect(plannedFirst("xray.push", { id: "LFRPS12-1420", dryRun: true })).toBeNull();
    expect(plannedFirst("xray.fields", {})).toBeNull();
  });

  it("opens the push plan dialog and pushes with its planHash", async () => {
    net.routes["xray.plan"] = () => ({
      testId: "LFRPS12-1420",
      ops: [{ kind: "update", label: "Update the summary" }],
      warnings: [],
      remoteChanged: false,
      review: "validated",
      planHash: "h-7",
    });
    net.routes["xray.push"] = () => ({
      ok: true,
      id: "LFRPS12-1420",
      ops: [{ label: "Update the summary", status: "done" }],
    });
    const push: CommandInfo = {
      name: "xray.push",
      summary: "xray.push",
      mutates: true,
      job: true,
      input: { type: "object", properties: { id: { type: "string" } } },
    };
    withData(<CommandForm command={push} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("id (optional)"), { target: { value: "LFRPS12-1420" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const confirm = await screen.findByRole("button", { name: "Confirm push" });
    expect(callsOf("xray.push")).toHaveLength(0);
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(callsOf("xray.push")).toHaveLength(1));
    expect(callsOf("xray.push")[0].input).toEqual({ id: "LFRPS12-1420", planHash: "h-7" });
  });
});
