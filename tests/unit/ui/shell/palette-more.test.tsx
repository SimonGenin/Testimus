// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchMatch, SearchResult } from "../../../../src/core/types.ts";
import { Palette } from "../../../../src/ui/components/shell/Palette.tsx";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { callsOf, Fail, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
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

const hit = (id: string): SearchMatch => ({
  kind: "test",
  id,
  title: `Sectionneur ${id}`,
  titleMarks: [],
  marks: [],
  score: 1,
  why: "words",
});

const result = (hits: SearchMatch[], extra: Partial<SearchResult> = {}): SearchResult => ({
  hits,
  totals: { test: hits.length },
  order: ["test", "document", "passage"],
  meaning: "on",
  unembedded: 0,
  notes: [],
  ...extra,
});

const palette = (onClose = vi.fn()) =>
  withData(<Palette commands={[]} actions={[]} onCommand={() => {}} onHit={() => {}} onClose={onClose} />);

describe("search palette, the rest of its ways", () => {
  it("« 7 more tests » (the more icon) narrows the search to the tests, the palette stays open", async () => {
    net.routes["search.all"] = () => result([hit("T-1"), hit("T-2")], { totals: { test: 9 } });
    palette();
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), { target: { value: "sectionneur" } });
    const more = await screen.findByRole("option", { name: "7 more tests" });
    expect(more.querySelector('[data-icon="more"]')).not.toBeNull();
    fireEvent.click(more);
    expect(screen.getByRole("tab", { name: /^Tests/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(callsOf("search.all").some((c) => (c.input.in as string[])?.[0] === "test")).toBe(true));
    expect(screen.queryByRole("option", { name: "7 more tests" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Search" })).toBeInTheDocument();
  });

  it("« Choose a search pack » closes the palette and opens Settings › Search", async () => {
    net.routes["rag.status"] = () => ({ degraded: "No embedding model", activation: "none", chunks: 4 });
    net.routes["search.all"] = () => result([hit("T-1")]);
    const onClose = vi.fn();
    const { state } = palette(onClose);
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), { target: { value: "frein" } });
    fireEvent.click(await screen.findByRole("button", { name: "Choose a search pack" }));
    expect(onClose).toHaveBeenCalled();
    expect(state.navigate).toHaveBeenCalledWith("settings", "search");
  });

  it("says when the tests could not be indexed by meaning", async () => {
    net.routes["search.all"] = () => result([hit("T-1")], { unembedded: 3 });
    net.routes["search.index"] = () => {
      throw new Fail("no search pack installed");
    };
    palette();
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), { target: { value: "frein" } });
    fireEvent.click(await screen.findByRole("button", { name: /3 tests not searchable by meaning yet/ }));
    expect(await screen.findByText("Could not index the tests")).toBeInTheDocument();
    expect(screen.getByText("no search pack installed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /3 tests not searchable by meaning yet/ })).toBeEnabled();
  });
});
