// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalTestRef, SearchMatch } from "../../../../../src/core/types.ts";
import { setProject } from "../../../../../src/ui/api.ts";
import { AppContext } from "../../../../../src/ui/lib/app.ts";
import { TestList } from "../../../../../src/ui/screens/tests/TestList.tsx";
import { server, stubServer } from "../../../cov-uitests-helpers.ts";
import { app } from "../../../ui-desktop-helpers.tsx";
import { testClient, WithData } from "../data-helpers.tsx";

const ref = (o: Partial<LocalTestRef> & { id: string }): LocalTestRef => ({
  summary: o.id,
  folder: "/",
  review: "draft",
  generated: false,
  edited: false,
  sync: "local",
  dirty: false,
  synced: false,
  mtime: Date.now(),
  stepCount: 1,
  ...o,
});

const REFS = [
  ref({ id: "t-open", summary: "Ouvrir le sectionneur", folder: "/Lot", key: "LFRPS12-7" }),
  ref({ id: "t-close", summary: "Fermer le sectionneur", folder: "" }),
  ref({ id: "t-tk", summary: "Commande TK", folder: "/Lot", generated: true, review: "validated" }),
];

const hit = (o: Partial<SearchMatch> & { id: string }): SearchMatch => ({
  kind: "test",
  title: o.id,
  titleMarks: [],
  marks: [],
  score: 1,
  why: "words",
  ...o,
});

const WORDS = [
  hit({
    id: "t-open",
    title: "Ouvrir le sectionneur",
    titleMarks: [[10, 21]],
    snippet: "Vérifier l'ouverture du sectionneur",
    marks: [
      [24, 35],
      [30, 99],
    ],
    where: "Step 2 · Action",
    step: 2,
  }),
  hit({ id: "t-close", title: "Fermer le sectionneur" }),
  hit({ id: "D-1", kind: "doc", title: "Spécification" }),
  hit({ id: "t-gone", title: "Not in the list" }),
];

let deep: SearchMatch[] = [];

beforeEach(() => {
  stubServer();
  setProject(`C:\\found-${Math.random()}`);
  server.routes["jobs.list"] = () => [];
  deep = [...WORDS, hit({ id: "t-tk", title: "Commande TK", why: "meaning" })];
  server.routes["search.all"] = (i) => ({
    hits: i.meaning ? deep : WORDS,
    totals: {},
    order: ["test"],
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

function show() {
  const onOpen = vi.fn();
  render(
    <WithData client={testClient()}>
      <AppContext.Provider value={app()}>
        <TestList refs={REFS} loading={false} activeId="t-close" onOpen={onOpen} onReload={async () => REFS} />
      </AppContext.Provider>
    </WithData>,
  );
  return onOpen;
}

const filter = (v: string) => fireEvent.change(screen.getByLabelText("Filter tests"), { target: { value: v } });

describe("the local tests a filter finds", () => {
  it("lists the tests found by their words, then the ones similar by meaning, the open one selected", async () => {
    show();
    filter("sectionneur");
    const found = await screen.findByRole("listbox", { name: "Tests found" }, { timeout: 3000 });
    expect(await within(found).findByText("Similar by meaning", {}, { timeout: 3000 })).toBeInTheDocument();
    const options = within(found).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Ouvrir le sectionneur"),
      expect.stringContaining("Fermer le sectionneur"),
      expect.stringContaining("Commande TK"),
    ]);
    expect(within(found).getByText("2 tests")).toBeInTheDocument();
    expect(within(found).getByRole("option", { name: /Fermer/ })).toHaveAttribute("aria-selected", "true");
  });

  it("highlights the matched words in the title and the snippet, says where the snippet is, else the folder", async () => {
    show();
    filter("sectionneur");
    const found = await screen.findByRole("listbox", { name: "Tests found" }, { timeout: 3000 });
    const open = within(found).getByRole("option", { name: /Ouvrir/ });
    const marks = [...open.querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toEqual(["sectionneur", "sectionneur"]);
    expect(within(open).getByText("Step 2 · Action")).toBeInTheDocument();
    expect(within(open).getByText("LFRPS12-7")).toBeInTheDocument();
    const close = within(found).getByRole("option", { name: /Fermer/ });
    expect(close.querySelector("mark")).toBeNull();
    expect(within(close).getByText("/")).toBeInTheDocument();
    expect(within(close).getByText("no key")).toBeInTheDocument();
  });

  it("opens the test a row names", async () => {
    const onOpen = show();
    filter("sectionneur");
    const found = await screen.findByRole("listbox", { name: "Tests found" }, { timeout: 3000 });
    fireEvent.click(within(found).getByRole("option", { name: /Ouvrir/ }));
    expect(onOpen).toHaveBeenCalledWith("t-open");
  });

  it("says no local test matches when the search finds no test of the list", async () => {
    deep = [hit({ id: "D-1", kind: "doc", title: "Spécification" })];
    server.routes["search.all"] = () => ({ hits: deep, totals: {}, order: ["doc"] });
    show();
    filter("zzz");
    expect(await screen.findByText("No local test matches “zzz”.", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Tests found" })).toBeNull();
  });
});
