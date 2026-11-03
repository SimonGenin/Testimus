// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchMatch, SearchResult } from "../../src/core/types.ts";
import { Palette } from "../../src/ui/components/shell/Palette.tsx";
import { jumpTo, rememberHit, takeJump } from "../../src/ui/lib/search.ts";
import { callsOf, fakeNet, net } from "./cov-uishell-helpers.tsx";

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
  order: ["test", "requirement", "document", "passage"],
  meaning: "on",
  unembedded: 0,
  notes: [],
  ...extra,
});

beforeEach(() => {
  fakeNet();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("search palette", () => {
  it("shows the hits grouped, with the step they come from, and opens one with Enter", async () => {
    net.routes["search.all"] = () =>
      result(
        [
          hit({ snippet: "Clic droit sur le sectionneur", marks: [[18, 29]], where: "Step 2 · Action", step: 2 }),
          hit({ kind: "requirement", id: "EXI_1", title: "EXI_1", titleMarks: [], docId: "D", anchor: "req:EXI_1" }),
        ],
        { totals: { test: 9, requirement: 1 } },
      );
    const onHit = vi.fn();
    const onClose = vi.fn();
    render(<Palette commands={[]} actions={[]} onCommand={() => {}} onHit={onHit} onClose={onClose} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), { target: { value: "sectionneur" } });
    expect(await screen.findByText("Step 2 · Action")).toBeInTheDocument();
    expect(screen.getAllByText("Requirements")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "All 9 tests" })).toBeInTheDocument();
    expect(screen.getAllByText("sectionneur")[0].tagName).toBe("MARK");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
    expect(onHit).toHaveBeenCalledWith(expect.objectContaining({ id: "T-1", step: 2 }));
  });

  it("narrows to one kind with Tab, asks for more, and offers to index the tests", async () => {
    net.routes["search.all"] = () => result([hit({ why: "meaning" })], { unembedded: 4 });
    net.routes["search.index"] = () => ({ jobId: "j1" });
    render(<Palette commands={[]} actions={[]} onCommand={() => {}} onHit={() => {}} onClose={() => {}} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "frein" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getByRole("tab", { name: "Tests" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(callsOf("search.all").some((c) => (c.input.in as string[])?.[0] === "test")).toBe(true));
    expect(callsOf("search.all").at(-1)?.input.k).toBe(40);
    expect(await screen.findByText("≈ meaning")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /4 tests not searchable by meaning yet/ }));
    await waitFor(() => expect(callsOf("search.index")).toHaveLength(1));
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
  });

  it("asks words first then meaning, and shows the recent hits when empty", async () => {
    rememberHit(hit({ id: "T-9", title: "Disjoncteur" }));
    net.routes["search.all"] = () => result([]);
    render(<Palette commands={[]} actions={[]} onCommand={() => {}} onHit={() => {}} onClose={() => {}} />);
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Disjoncteur/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzz" } });
    await waitFor(() => expect(callsOf("search.all").map((c) => c.input.meaning)).toEqual([false, true]));
    expect(await screen.findByText("Nothing matches “zzz”.")).toBeInTheDocument();
  });

  it("hands a step to the editor once, for that test only", () => {
    jumpTo("T-1", 3);
    expect(takeJump("T-2")).toBeNull();
    expect(takeJump("T-1")).toBe(3);
    expect(takeJump("T-1")).toBeNull();
  });
});
