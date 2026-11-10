// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Test } from "../../../../../src/core/types.ts";
import { DetailsCard } from "../../../../../src/ui/screens/tests/editor/DetailsCard.tsx";
import { EditorBar } from "../../../../../src/ui/screens/tests/editor/EditorBar.tsx";
import { SummaryCard } from "../../../../../src/ui/screens/tests/editor/SummaryCard.tsx";
import { TestDetails } from "../../../../../src/ui/screens/tests/editor/TestDetails.tsx";
import { pushReason } from "../../../../../src/ui/screens/tests/editor/testMenu.ts";
import { iconOf } from "../../../helpers/icons.ts";

afterEach(cleanup);

// ponytail: the old TestHeader is three parts now — the bar (key, folder, save state, Ask Claude, Push, ⋯), the summary
// card (summary, badges, the Jira controls) and the Details card (labels, covers, preconditions, contexts, description,
// folded or not, with its earlier versions); each case of its test is kept against the part that does it

const test0: Test = {
  key: "LFRPS12-7",
  project: "LFRPS12",
  summary: "Sectionneur",
  folder: "/Lot 1",
  labels: ["smoke"],
  status: "Ready",
  description: "Checks it",
  covers: ["LFRPS12-1"],
  clonedFrom: "LFRPS12-3",
  preconditions: ["LFRPS12-50"],
  review: "draft",
  steps: [],
  extra: {},
};

type Bar = ComponentProps<typeof EditorBar>;
type Card = ComponentProps<typeof SummaryCard>;
type Details = ComponentProps<typeof TestDetails>;
type Held = ComponentProps<typeof DetailsCard>;

const PRE = [
  { key: "LFRPS12-50", issueId: "1", summary: "Powered", definition: "" },
  { key: "LFRPS12-40", issueId: "2", summary: "Logged in", definition: "" },
];
const CONTEXTS = [
  { id: "c1", name: "Glossary" },
  { id: "c2", name: "Style" },
];

const header = (
  o: {
    bar?: Partial<Bar>;
    card?: Partial<Card>;
    details?: Partial<Details>;
    held?: Partial<Held>;
    open?: boolean;
    readOnly?: boolean;
  } = {},
  test: Test = test0,
) => {
  let last: Test | null = null;
  const update = vi.fn((fn: (t: Test) => Test) => {
    last = fn(test);
  });
  const h = {
    onDetails: vi.fn(),
    onRestore: vi.fn(),
    onPush: vi.fn(),
    onAsk: vi.fn(),
    onOpenKey: vi.fn(),
    onContexts: vi.fn(),
    onContext: vi.fn(),
    onFolder: vi.fn((f: string) => update((t) => ({ ...t, folder: f }))),
    onFolders: vi.fn(),
    onRetry: vi.fn(),
    select: vi.fn(),
  };
  const view = (p: typeof o, t: Test) => (
    <>
      <EditorBar
        testKey={t.key}
        folder={t.folder}
        folders={["/Lot 1", "/Lot 2"]}
        status={null}
        claude={p.readOnly}
        pushDisabled={false}
        menu={[{ label: "Delete", onSelect: h.select }]}
        onFolders={h.onFolders}
        onFolder={h.onFolder}
        onRetry={h.onRetry}
        onAsk={h.onAsk}
        onPush={h.onPush}
        {...p.bar}
      />
      <SummaryCard
        test={t}
        sync="synced"
        dirty={false}
        remote={null}
        readOnly={p.readOnly}
        onOpenKey={h.onOpenKey}
        update={update}
        {...p.card}
      />
      <DetailsCard
        test={t}
        remote={null}
        before={null}
        open={!!p.open}
        readOnly={p.readOnly}
        onOpen={h.onDetails}
        onRestore={h.onRestore}
        {...p.held}
      >
        <TestDetails
          test={t}
          readOnly={p.readOnly}
          preconditions={PRE}
          contexts={CONTEXTS}
          testContexts={{ effective: ["c1"], own: null }}
          update={update}
          onContexts={h.onContexts}
          onContext={h.onContext}
          {...p.details}
        />
      </DetailsCard>
    </>
  );
  const r = render(view(o, test));
  return {
    ...r,
    ...h,
    update,
    again: (p: typeof o, t: Test = test) => r.rerender(view(p, t)),
    apply: () => last as unknown as Test,
  };
};

const folderButton = () => screen.getByTestId("folder");
const folderBox = () => screen.getByRole("textbox", { name: "Folder" });

describe("the editor's head", () => {
  it("shows Draft and To fix, never Validated (every generated test in Tests is validated)", () => {
    const { again } = header();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    again({}, { ...test0, review: "to-fix" });
    expect(screen.getByText("To fix")).toBeInTheDocument();
    again({}, { ...test0, review: "validated" });
    expect(screen.queryByText("Validated")).toBeNull();
    expect(screen.queryByText("Draft")).toBeNull();
  });

  it("shows the key, folder, status, chips and save state", () => {
    const { again } = header();
    expect(screen.getByTestId("test-key")).toHaveTextContent("LFRPS12-7");
    expect(folderButton()).toHaveTextContent("/Lot 1");
    expect(screen.queryByText("Ready")).toBeNull();
    expect(screen.getByText("smoke · covers LFRPS12-1 · needs LFRPS12-50 · Checks it")).toBeInTheDocument();
    again({ card: { jira: <span>Jira side</span> } });
    expect(screen.getByText("Jira side")).toBeInTheDocument();
    expect(screen.getByText(/^cloned from/)).toHaveTextContent("cloned from LFRPS12-3");
    expect(screen.getByText("In sync")).toBeInTheDocument();
    again({ bar: { status: "saving" } });
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    again({ bar: { status: "saved" } });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    again({ bar: { status: "saved" }, readOnly: true });
    expect(screen.getByText("Claude is editing")).toBeInTheDocument();
    again({ bar: { status: "error" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    again({ bar: { status: "conflict" } });
    expect(screen.getByText("Changed on disk")).toBeInTheDocument();
    again({ bar: { activity: "Refreshing from Jira…" } });
    expect(screen.getByText("Refreshing from Jira…")).toBeInTheDocument();
  });

  it("falls back to local, the root folder, no status and no clone chip", () => {
    header({}, { ...test0, key: undefined, folder: "", clonedFrom: undefined, status: undefined });
    expect(screen.getByTestId("test-key")).toHaveTextContent("local");
    expect(folderButton()).toHaveTextContent("/");
    expect(screen.queryByText(/cloned from/)).toBeNull();
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("shows the Jira check: checking, changed, conflict and unverified", () => {
    const { again } = header({ card: { remote: "checking" } });
    expect(screen.getByText("Checking…")).toBeInTheDocument();
    again({ card: { remote: "remote-changed", sync: "remote-changed" } });
    expect(screen.getByText("Changed in Jira")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Changed in Jira" })).toBeNull();
    expect(screen.getByText("In sync")).toBeInTheDocument();
    again({ card: { remote: "remote-changed", sync: "remote-changed", dirty: true } });
    expect(screen.getByText("Conflict")).toBeInTheDocument();
    expect(screen.getByText("Modified")).toBeInTheDocument();
    again({ card: { remote: "unverified" } });
    expect(screen.getByText("Not verified against Jira")).toBeInTheDocument();
  });

  it("draws the design's icons: Generated claude, Changed in Jira cloud, the clone an external chip", () => {
    const { again } = header({}, { ...test0, generatedBy: "gen-1" });
    expect(iconOf(screen.getByText("Generated"))).toBe("claude");
    expect(iconOf(screen.getByText("LFRPS12-3").parentElement as HTMLElement)).toBe("external");
    again({ card: { remote: "remote-changed", sync: "remote-changed" } }, { ...test0, generatedBy: "gen-1" });
    expect(iconOf(screen.getByText("Changed in Jira"))).toBe("cloud");
  });

  it("opens the test it was cloned from in Jira", () => {
    const { onOpenKey } = header();
    fireEvent.click(screen.getByRole("button", { name: "LFRPS12-3" }));
    expect(onOpenKey).toHaveBeenCalledWith("LFRPS12-3");
  });

  it("changes the folder on leaving and Enter, keeps it on Escape or when unchanged", async () => {
    const { update, apply, onFolders } = header();
    fireEvent.click(folderButton());
    expect(onFolders).toHaveBeenCalled();
    expect(within(screen.getByRole("listbox", { name: "Xray folders" })).getAllByRole("option")).toHaveLength(2);
    fireEvent.change(folderBox(), { target: { value: " /Lot 2 " } });
    fireEvent.keyDown(folderBox(), { key: "Enter" });
    expect(apply().folder).toBe("/Lot 2");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Folder" })).toBeNull());
    fireEvent.click(folderButton());
    fireEvent.change(folderBox(), { target: { value: "  " } });
    fireEvent.mouseDown(screen.getByTestId("test-key"));
    expect(apply().folder).toBe("/");
    update.mockClear();
    fireEvent.click(folderButton());
    fireEvent.keyDown(folderBox(), { key: "a" });
    fireEvent.mouseDown(screen.getByTestId("test-key"));
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(folderButton());
    fireEvent.change(folderBox(), { target: { value: "/Elsewhere" } });
    fireEvent.keyDown(folderBox(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Folder" })).toBeNull());
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(folderButton());
    fireEvent.click(screen.getByRole("option", { name: "/Lot 2" }));
    expect(apply().folder).toBe("/Lot 2");
  });

  it("keeps the summary on one line, asks Claude, pushes and opens the menu", () => {
    const { apply, onAsk, onPush, select } = header();
    const summary = screen.getByRole("textbox", { name: "Summary" });
    expect(summary.tagName).toBe("INPUT");
    expect(fireEvent.keyDown(summary, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(summary, { key: "a" })).toBe(true);
    fireEvent.change(summary, { target: { value: "Line one\r\nline two" } });
    expect(apply().summary).toMatch(/^Line one ?line two$/);
    fireEvent.click(screen.getByRole("button", { name: "Ask Claude" }));
    expect(onAsk).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Push to Jira" }));
    expect(onPush).toHaveBeenCalled();
    const more = screen.getByRole("button", { name: "More actions for this test" });
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-controls", screen.getByRole("menu").id);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(select).toHaveBeenCalled();
  });

  it("in Review › Edit: one bar with the key, « Editing », the save state and Ask Claude — the way back is the top bar's", () => {
    const { onAsk } = header({ bar: { editing: true, status: "saved" } });
    const bar = screen.getByRole("toolbar", { name: "Editing in Review" });
    expect(within(bar).getByTestId("test-key")).toHaveTextContent("LFRPS12-7");
    expect(within(bar).getByText("Editing")).toBeInTheDocument();
    expect(within(bar).getByText("Saved")).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Push to Jira" })).toBeNull();
    expect(within(bar).queryByRole("button", { name: "More actions for this test" })).toBeNull();
    expect(screen.queryByTestId("folder")).toBeNull();
    fireEvent.click(within(bar).getByRole("button", { name: "Ask Claude" }));
    expect(onAsk).toHaveBeenCalled();
    expect(within(bar).queryByRole("button", { name: /Back/ })).toBeNull();
  });

  it("disables push when in sync", () => {
    const reason = pushReason({ busy: false, jiraOff: false, pushing: false, canPush: false });
    header({ bar: { pushDisabled: reason } });
    const push = screen.getByRole("button", { name: "Push to Jira" });
    expect(push).toBeDisabled();
    expect(push).toHaveAccessibleDescription("No local change since the last sync — nothing to push");
  });

  it("disables push while the push plan is open, Claude works or Jira is off, and says why", () => {
    const base = { busy: false, jiraOff: false, pushing: false, canPush: true };
    const { again } = header({ bar: { pushDisabled: pushReason({ ...base, pushing: true }) } });
    const push = () => screen.getByRole("button", { name: "Push to Jira" });
    expect(push()).toBeDisabled();
    expect(push()).toHaveAccessibleDescription("The push plan is open");
    again({ bar: { pushDisabled: pushReason({ ...base, busy: true, pushing: true }) } });
    expect(push()).toHaveAccessibleDescription("Claude is working — wait for it to finish");
    again({ bar: { pushDisabled: pushReason({ ...base, jiraOff: true }) } });
    expect(push()).toHaveAccessibleDescription(/Jira is not connected/);
    again({ bar: { pushDisabled: pushReason(base) } });
    expect(push()).toBeEnabled();
    expect(push()).not.toHaveAccessibleDescription();
  });

  it("toggles the details", () => {
    const { onDetails, again } = header();
    fireEvent.click(screen.getByRole("button", { name: "Show the details" }));
    expect(onDetails).toHaveBeenCalledWith(true);
    again({ open: true });
    expect(screen.queryByText(/smoke · covers/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fold the details" }));
    expect(onDetails).toHaveBeenLastCalledWith(false);
    again({}, { ...test0, labels: [], covers: [], preconditions: [], description: "" });
    expect(screen.getByText("No labels, no description yet")).toBeInTheDocument();
  });

  it("shows the details as Jira has them, and keeps Jira's version of what differs", () => {
    const remote = { ...test0, labels: [], description: "As in Jira" };
    const { onRestore, onDetails, again } = header({ held: { remote } });
    const details = () => screen.getByRole("region", { name: "Details" });
    expect(within(details()).getByText("Modified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jira version" }));
    expect(onDetails).toHaveBeenCalledWith(true);
    again({ open: true, held: { remote } });
    expect(screen.getByRole("button", { name: "Hide Jira version" })).toHaveAttribute("aria-pressed", "true");
    const was = screen.getByRole("region", { name: "Details as Jira has it" });
    expect(within(was).getByText("As in Jira")).toBeInTheDocument();
    expect(within(was).getByText("None")).toBeInTheDocument();
    expect(
      within(was).getByText(/Same as here: Covers, Preconditions. Claude contexts stay in Testimus/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep Jira's version" }));
    expect(onRestore).toHaveBeenCalledWith("jira", remote, ["labels", "description"]);
    expect(screen.queryByRole("region", { name: "Details as Jira has it" })).toBeNull();
  });

  it("shows the details before Claude's run, and puts them back", () => {
    const before = { ...test0, covers: ["LFRPS12-9"], preconditions: [] };
    const { onRestore } = header({ open: true, held: { before } });
    expect(screen.getByText("Changed by Claude")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Before Claude" }));
    const was = screen.getByRole("region", { name: "Details before Claude's run" });
    expect(within(was).getByText("LFRPS12-9")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide before Claude" }));
    expect(screen.queryByRole("region", { name: "Details before Claude's run" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Before Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Put back as before Claude" }));
    expect(onRestore).toHaveBeenCalledWith("claude", before, ["covers", "preconditions"]);
  });

  it("offers no way back while Claude works", () => {
    header({ open: true, readOnly: true, held: { remote: { ...test0, labels: [] } } });
    fireEvent.click(screen.getByRole("button", { name: "Jira version" }));
    expect(screen.queryByRole("button", { name: "Keep Jira's version" })).toBeNull();
  });

  it("edits labels, covers in upper case, the description and preconditions in the details", () => {
    const { apply } = header({ open: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Labels" }), { target: { value: "regress," } });
    expect(apply().labels).toEqual(["smoke", "regress"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Covers" }), { target: { value: "lfrps12-2;" } });
    expect(apply().covers).toEqual(["LFRPS12-1", "LFRPS12-2"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "New" } });
    expect(apply().description).toBe("New");
    const attach = screen.getByRole("combobox", { name: "Preconditions" });
    expect(attach).toHaveAttribute("placeholder", "Attach another…");
    fireEvent.focus(attach);
    fireEvent.click(screen.getByRole("option", { name: "LFRPS12-40" }));
    expect(apply().preconditions).toEqual(["LFRPS12-40", "LFRPS12-50"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove LFRPS12-50" }));
    expect(apply().preconditions).toEqual([]);
  });

  it("shows the preconditions while loading, when none is attachable and when the project has none", () => {
    const { again } = header({ open: true, details: { preconditions: null } });
    expect(screen.getByText(/Loading the project's preconditions/)).toBeInTheDocument();
    again({ open: true, details: { preconditions: [PRE[0]] } });
    fireEvent.focus(screen.getByRole("combobox", { name: "Preconditions" }));
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.queryByText("None in this project")).toBeNull();
    again({ open: true, details: { preconditions: [] } }, { ...test0, preconditions: [] });
    expect(screen.getByText("None in this project")).toBeInTheDocument();
    again({ open: true, details: { preconditions: [PRE[1]] } }, { ...test0, preconditions: [] });
    expect(screen.getByRole("combobox", { name: "Preconditions" })).toHaveAttribute(
      "placeholder",
      "Attach a precondition…",
    );
  });

  it("attaches, detaches and resets Claude contexts", () => {
    const { onContexts, onContext, again } = header({ open: true });
    expect(screen.getByText("Glossary")).toBeInTheDocument();
    const box = () => screen.getByRole("combobox", { name: "Claude contexts" });
    fireEvent.focus(box());
    fireEvent.click(screen.getByRole("option", { name: "Style" }));
    expect(onContexts).toHaveBeenLastCalledWith(["c1", "c2"]);
    expect(onContexts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove Glossary" }));
    expect(onContexts).toHaveBeenLastCalledWith([]);
    expect(screen.queryByRole("button", { name: "Use the project defaults" })).toBeNull();
    again({ open: true, details: { testContexts: { effective: ["c1", "gone"], own: ["c1", "gone"] } } });
    expect(screen.getByText("gone")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use the project defaults" }));
    expect(onContexts).toHaveBeenLastCalledWith(null);
    again({ open: true, details: { testContexts: { effective: [], own: null } } });
    expect(box()).toHaveAttribute("placeholder", "Attach a context…");
    again({ open: true, details: { testContexts: { effective: ["c1", "c2"], own: null } } });
    fireEvent.focus(box());
    expect(screen.queryByRole("option")).toBeNull();
    again({ open: true, details: { contexts: [], testContexts: { effective: [], own: null } } });
    fireEvent.click(screen.getByRole("button", { name: "Context…" }));
    expect(onContext).toHaveBeenCalled();
    again({ open: true, details: { testContexts: null } });
    expect(screen.queryByRole("button", { name: /Remove Glossary/ })).toBeNull();
  });

  it("is read-only while Claude works", () => {
    header({ readOnly: true, open: true, details: { testContexts: { effective: ["c1"], own: ["c1"] } } });
    expect(folderButton()).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Summary" })).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Use the project defaults" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveAttribute("readonly");
  });
});
