// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Test } from "../../src/core/types.ts";
import { TestHeader } from "../../src/ui/screens/tests/TestHeader.tsx";

afterEach(cleanup);

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

type Props = ComponentProps<typeof TestHeader>;

const header = (over: Partial<Props> = {}, test: Test = test0) => {
  let last: Test | null = null;
  const h = {
    update: vi.fn((fn: (t: Test) => Test) => {
      last = fn(test);
    }),
    onDetails: vi.fn(),
    onPush: vi.fn(),
    onAsk: vi.fn(),
    onRemote: vi.fn(),
    onContexts: vi.fn(),
    onManageContexts: vi.fn(),
  };
  const props: Props = {
    test,
    sync: "synced",
    dirty: false,
    remote: null,
    saving: "idle",
    folders: ["/Lot 1", "/Lot 2"],
    details: false,
    preconditions: [
      { key: "LFRPS12-50", issueId: "1", summary: "Powered", definition: "" },
      { key: "LFRPS12-40", issueId: "2", summary: "Logged in", definition: "" },
    ],
    contexts: [
      { id: "c1", name: "Glossary" },
      { id: "c2", name: "Style" },
    ],
    testContexts: { effective: ["c1"], own: null },
    canPush: true,
    menu: [{ key: "del", label: "Delete", onSelect: vi.fn() }],
    ...h,
    ...over,
  };
  const r = render(<TestHeader {...props} />);
  return { ...r, ...h, props, apply: () => last as unknown as Test };
};

describe("TestHeader", () => {
  it("shows the key, folder, status, chips and save state", () => {
    const { rerender, props } = header();
    expect(screen.getByText("LFRPS12-7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lot 1/ })).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("smoke")).toBeInTheDocument();
    expect(screen.getByText("LFRPS12-1")).toBeInTheDocument();
    expect(screen.getByText("LFRPS12-3")).toBeInTheDocument();
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    rerender(<TestHeader {...props} saving="saving" />);
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    rerender(<TestHeader {...props} saving="saved" />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    rerender(<TestHeader {...props} saving="saved" readOnly />);
    expect(screen.getByText("Claude is editing…")).toBeInTheDocument();
  });

  it("falls back to local, the root folder, no status and no clone chip", () => {
    header({}, { ...test0, key: undefined, folder: "", clonedFrom: undefined, status: undefined });
    expect(screen.getByText("local")).toBeInTheDocument();
    expect(screen.getByTitle(/Change the folder/)).toHaveTextContent("/");
    expect(screen.queryByText(/cloned from/)).toBeNull();
    expect(document.querySelector(".status-chip")).toBeNull();
  });

  it("shows the Jira check: checking, changed, conflict and unverified", () => {
    const { rerender, props, onRemote } = header({ remote: "checking" });
    expect(screen.getByRole("status")).toHaveTextContent("checking…");
    rerender(<TestHeader {...props} remote="remote-changed" sync="remote-changed" />);
    fireEvent.click(screen.getByRole("button", { name: "changed in Jira" }));
    expect(onRemote).toHaveBeenCalled();
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    rerender(<TestHeader {...props} remote="remote-changed" sync="remote-changed" dirty />);
    expect(screen.getByRole("button", { name: "conflict" })).toHaveClass("is-conflict");
    expect(screen.getByText("Modified")).toBeInTheDocument();
    rerender(<TestHeader {...props} remote="unverified" />);
    expect(screen.getByTitle("Not verified against Jira")).toBeInTheDocument();
  });

  it("changes the folder on blur and Enter, keeps it on Escape or when unchanged", () => {
    const { update, apply } = header();
    fireEvent.click(screen.getByTitle(/Change the folder/));
    let input = screen.getByLabelText("Folder");
    expect(document.querySelectorAll("#testimus-folders option")).toHaveLength(2);
    fireEvent.change(input, { target: { value: " /Lot 2 " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(apply().folder).toBe("/Lot 2");
    fireEvent.click(screen.getByTitle(/Change the folder/));
    input = screen.getByLabelText("Folder");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.blur(input);
    expect(apply().folder).toBe("/");
    update.mockClear();
    fireEvent.click(screen.getByTitle(/Change the folder/));
    input = screen.getByLabelText("Folder");
    fireEvent.keyDown(input, { key: "a" });
    fireEvent.blur(input);
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle(/Change the folder/));
    fireEvent.keyDown(screen.getByLabelText("Folder"), { key: "Escape" });
    expect(screen.queryByLabelText("Folder")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps the summary on one line, asks Claude, pushes and opens the menu", () => {
    const { apply, onAsk, onPush, props } = header();
    const summary = screen.getByLabelText("Summary");
    expect(fireEvent.keyDown(summary, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(summary, { key: "a" })).toBe(true);
    fireEvent.change(summary, { target: { value: "Line one\r\nline two" } });
    expect(apply().summary).toBe("Line one line two");
    fireEvent.click(screen.getByRole("button", { name: "Ask Claude" }));
    expect(onAsk).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Push to Jira" }));
    expect(onPush).toHaveBeenCalled();
    const more = screen.getByRole("button", { name: "More actions for this test" });
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-controls", screen.getByRole("menu").id);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect((props.menu[0] as { onSelect: () => void }).onSelect).toHaveBeenCalled();
  });

  it("disables push when in sync", () => {
    header({ canPush: false });
    const push = screen.getByRole("button", { name: "Push to Jira" });
    expect(push).toBeDisabled();
    expect(push).toHaveAttribute("title", "No local change since the last sync — nothing to push");
  });

  it("disables push while the push plan is open or Claude works, and says why", () => {
    const { rerender, props } = header({ pushing: true });
    const push = screen.getByRole("button", { name: "Push to Jira" });
    expect(push).toBeDisabled();
    expect(push).toHaveAttribute("title", "The push plan is open");
    rerender(<TestHeader {...props} pushing={false} readOnly />);
    expect(push).toBeDisabled();
    expect(push).toHaveAttribute("title", "Claude is working — wait for it to finish");
    rerender(<TestHeader {...props} pushing={false} />);
    expect(push).toBeEnabled();
    expect(push).not.toHaveAttribute("title");
  });

  it("toggles the details", () => {
    const { onDetails, rerender, props } = header();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(onDetails).toHaveBeenCalledWith(true);
    rerender(<TestHeader {...props} details />);
    expect(screen.queryByText("smoke", { selector: ".testhead-chips *" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(onDetails).toHaveBeenLastCalledWith(false);
  });

  it("edits labels, covers in upper case, the description and preconditions in the details", () => {
    const { apply } = header({ details: true });
    fireEvent.change(screen.getByLabelText("Labels"), { target: { value: "regress," } });
    expect(apply().labels).toEqual(["smoke", "regress"]);
    fireEvent.change(screen.getByLabelText("Covers"), { target: { value: "lfrps12-2;" } });
    expect(apply().covers).toEqual(["LFRPS12-1", "LFRPS12-2"]);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "New" } });
    expect(apply().description).toBe("New");
    const attach = screen.getByRole("combobox", { name: "Attach precondition" });
    expect(attach).toHaveTextContent("attach…");
    fireEvent.change(attach, { target: { value: "LFRPS12-40" } });
    expect(apply().preconditions).toEqual(["LFRPS12-40", "LFRPS12-50"]);
    fireEvent.click(screen.getByRole("button", { name: "Detach LFRPS12-50" }));
    expect(apply().preconditions).toEqual([]);
  });

  it("shows the preconditions while loading, when none is attachable and when the project has none", () => {
    const { rerender, props } = header({ details: true, preconditions: null });
    expect(screen.getByText("loading…")).toBeInTheDocument();
    rerender(
      <TestHeader {...props} preconditions={[{ key: "LFRPS12-50", issueId: "1", summary: "", definition: "" }]} />,
    );
    expect(screen.queryByRole("combobox", { name: "Attach precondition" })).toBeNull();
    expect(screen.queryByText("none in this project")).toBeNull();
    rerender(<TestHeader {...props} preconditions={[]} test={{ ...test0, preconditions: [] }} />);
    expect(screen.getByText("none in this project")).toBeInTheDocument();
    rerender(
      <TestHeader
        {...props}
        test={{ ...test0, preconditions: [] }}
        preconditions={[{ key: "LFRPS12-40", issueId: "2", summary: "x", definition: "" }]}
      />,
    );
    const attach = screen.getByRole("combobox", { name: "Attach precondition" });
    expect(attach).toHaveTextContent("attach a precondition…");
    fireEvent.change(attach, { target: { value: "" } });
  });

  it("attaches, detaches and resets Claude contexts", () => {
    const { onContexts, rerender, props } = header({ details: true });
    expect(screen.getByText("Glossary")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Attach context" }), { target: { value: "c2" } });
    expect(onContexts).toHaveBeenLastCalledWith(["c1", "c2"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Attach context" }), { target: { value: "" } });
    expect(onContexts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Detach Glossary" }));
    expect(onContexts).toHaveBeenLastCalledWith([]);
    expect(screen.queryByRole("button", { name: "reset to project defaults" })).toBeNull();
    rerender(<TestHeader {...props} testContexts={{ effective: ["c1", "gone"], own: ["c1", "gone"] }} />);
    expect(screen.getByText("gone")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "reset to project defaults" }));
    expect(onContexts).toHaveBeenLastCalledWith(null);
    rerender(<TestHeader {...props} testContexts={{ effective: [], own: null }} />);
    expect(screen.getByRole("combobox", { name: "Attach context" })).toHaveTextContent("attach a context…");
    rerender(<TestHeader {...props} testContexts={{ effective: ["c1", "c2"], own: null }} />);
    expect(screen.queryByRole("combobox", { name: "Attach context" })).toBeNull();
    rerender(<TestHeader {...props} contexts={[]} testContexts={{ effective: [], own: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Manage contexts…" }));
    expect(props.onManageContexts).toHaveBeenCalled();
    rerender(<TestHeader {...props} testContexts={null} />);
    expect(screen.queryByRole("combobox", { name: "Attach context" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Detach Glossary/ })).toBeNull();
  });

  it("is read-only while Claude works", () => {
    header({ readOnly: true, details: true, testContexts: { effective: ["c1"], own: ["c1"] } });
    expect(screen.getByTitle(/Change the folder/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Push to Jira" })).toBeDisabled();
    expect(screen.getByLabelText("Summary")).toHaveAttribute("readonly");
    expect(screen.queryByLabelText("Labels")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "reset to project defaults" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Detach/ })).toBeNull();
  });
});
