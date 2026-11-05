// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef } from "../../../../src/core/types.ts";
import {
  type DocScope,
  type DocWork,
  flip,
  ownText,
  parents,
  scopeOf,
  tick,
  unready,
} from "../../../../src/ui/lib/scope.ts";
import { ColumnsView } from "../../../../src/ui/screens/generate/ColumnsView.tsx";
import { DocScopePicker } from "../../../../src/ui/screens/generate/DocScopePicker.tsx";
import { api } from "../../helpers/ui-desktop.tsx";
import { docRef, toc } from "./fixtures.ts";
import { freshPage, renderData } from "./harness.tsx";

beforeEach(freshPage);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Generate › scope helpers", () => {
  const up = parents(toc);

  it("parents, ticks and flips: a section takes its sub-sections, unticking one keeps its siblings", () => {
    expect(up).toEqual([-1, 0, 1, 1, -1]);
    expect(tick(toc, up, [], 0)).toBe("off");
    let picked = flip(toc, up, [], 2);
    expect(picked).toEqual(["§5.6.6"]);
    expect(tick(toc, up, picked, 0)).toBe("mixed");
    picked = flip(toc, up, picked, 0);
    expect(picked).toEqual(["§5"]);
    expect(tick(toc, up, picked, 3)).toBe("on");
    picked = flip(toc, up, picked, 3);
    expect(picked).toEqual(["§5.6.6"]);
    expect(flip(toc, up, ["§6"], 4)).toEqual([]);
  });

  it("ownText keeps the heading's own paragraphs, figures as captions, markers out", () => {
    const md =
      "#### 5.6.6 S <!-- § 5.6.6 -->\n\n<!-- req X -->\nX : le **sectionneur**.\n\n![Figure 40](f.png) <!-- fig 40 -->\n\n##### 5.6.6.1 Sub\n\nlater";
    expect(ownText(md)).toEqual(["X : le sectionneur.", "[Figure 40]"]);
    expect(ownText("")).toEqual([]);
  });

  it("scopeOf: whole documents, picked sections, documents left out", () => {
    expect(scopeOf({ B: ["§1", "§2"], C: "none" }, ["A", "B", "C"])).toEqual({
      docs: ["A"],
      sections: ["B#§1", "B#§2"],
    });
  });
});

function ScopeHost({
  initial = {} as Record<string, DocScope>,
  docs = [] as DocRef[] | null,
  work = { converting: [], indexing: false } as DocWork,
  onAdd = undefined as (() => void) | undefined,
}) {
  const [v, setV] = useState(initial);
  return (
    <>
      <DocScopePicker docs={docs} scopes={v} work={work} onChange={setV} onAddDocuments={onAdd} />
      <output data-testid="v">{JSON.stringify(v)}</output>
    </>
  );
}

describe("Generate › documents", () => {
  const value = () => JSON.parse(screen.getByTestId("v").textContent ?? "{}");

  it("every document whole by default; left out, back, narrowed to sections with their text", async () => {
    api.routes["docs.show"] = (i) => {
      if (i.anchor === "§5.6.6") return { md: "#### 5.6.6 S\n\nLe sectionneur est représenté." };
      if (i.anchor === "§5.6.7") throw new Error("gone");
      if (i.anchor) return { md: "## 5 T\n\n### 5.6 O" };
      return { toc };
    };
    renderData(<ScopeHost docs={[docRef("D1", "Traction", 62), docRef("D2", "Signaux")]} />);
    expect(screen.getByText("2 of 2 documents")).toBeInTheDocument();
    expect(screen.getByText(/whole document · 62 sections/)).toBeInTheDocument();
    const d2 = screen.getByRole("checkbox", { name: /Signaux/ });
    expect(d2).toBeChecked();
    fireEvent.click(d2);
    expect(value()).toEqual({ D2: "none" });
    expect(screen.getByText(/left out/)).toBeInTheDocument();
    fireEvent.click(d2);
    expect(value()).toEqual({ D2: "all" });
    fireEvent.click(screen.getAllByRole("button", { name: "Only some sections…" })[0]);
    expect(screen.getByText(/no section picked yet/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Unfold Traction" }));
    fireEvent.click(screen.getByRole("button", { name: "Unfold Objets" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Sectionneur/ }));
    expect(value().D1).toEqual(["§5.6.6"]);
    expect(screen.getByText(/1 section picked/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Objets/ })).toHaveProperty("indeterminate", true);
    expect(screen.getByRole("checkbox", { name: "5 Traction" })).toHaveProperty("indeterminate", true);
    const texts = () => within(screen.getByRole("list", { name: "Sections" })).getAllByRole("button", { name: "Text" });
    fireEvent.click(texts()[2]);
    expect(await screen.findByText("Le sectionneur est représenté.")).toBeInTheDocument();
    fireEvent.click(texts()[2]);
    await waitFor(() => expect(screen.queryByText("Le sectionneur est représenté.")).toBeNull());
    fireEvent.click(texts()[1]);
    expect(await screen.findByText("No text under this heading — only sub-sections.")).toBeInTheDocument();
    fireEvent.click(texts()[1]);
    fireEvent.click(texts()[3]);
    expect(await screen.findByText("Could not read this section — try again.")).toBeInTheDocument();
    fireEvent.click(texts()[3]);
    fireEvent.click(screen.getByRole("button", { name: "Fold Objets" }));
    expect(screen.queryByRole("checkbox", { name: /Sectionneur/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to the whole document" }));
    expect(value().D1).toBe("all");
    fireEvent.click(screen.getByRole("button", { name: "Select none" }));
    expect(value()).toEqual({ D1: "none", D2: "none" });
    expect(screen.getByText("0 of 2 documents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(value()).toEqual({ D1: "all", D2: "all" });
  });

  it("a narrowed document ticked again takes the whole document", () => {
    renderData(<ScopeHost docs={[docRef("D1", "Traction")]} initial={{ D1: ["§5"] }} />);
    expect(screen.getByText("1 of 1 document · 1 narrowed to sections")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Traction/ }));
    expect(value()).toEqual({ D1: "all" });
  });

  it("loading, no document, a document without headings", async () => {
    const { container } = renderData(<ScopeHost docs={null} />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    cleanup();
    const onAdd = vi.fn();
    renderData(<ScopeHost docs={[]} onAdd={onAdd} />);
    expect(screen.getByText("No document yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to Documents" }));
    expect(onAdd).toHaveBeenCalled();
    cleanup();
    api.routes["docs.show"] = () => null;
    renderData(<ScopeHost docs={[docRef("D1", "")]} initial={{ D1: [] }} />);
    expect(await screen.findByText("This document has no headings to pick from.")).toBeInTheDocument();
    expect(screen.getAllByText(/C-D1/).length).toBeGreaterThan(0);
  });

  it("each converted document says its index state; one search cannot read is shown, never picked", () => {
    const converted = { converted: { with: "", at: "x", warnings: [] } } as Partial<DocRef>;
    const docs = [
      docRef("D1", "Fresh", undefined, { ...converted, indexed: "fresh" } as Partial<DocRef>),
      docRef("D2", "Missing", undefined, { ...converted, indexed: "missing" } as Partial<DocRef>),
      docRef("D3", "Stale", undefined, { ...converted, indexed: "stale" } as Partial<DocRef>),
      docRef("D4", "Raw", undefined, { converted: undefined }),
    ];
    renderData(<ScopeHost docs={docs} />);
    const row = (t: string) => screen.getByRole("checkbox", { name: new RegExp(t) }).closest("li") as HTMLElement;
    const box = (t: string) => screen.getByRole("checkbox", { name: new RegExp(t) });
    expect(within(row("Fresh")).getByText("Indexed")).toBeInTheDocument();
    expect(within(row("Missing")).getByText("Not indexed")).toBeInTheDocument();
    expect(within(row("Missing")).getByText(/not indexed · reindex to use it/)).toBeInTheDocument();
    expect(within(row("Stale")).getByText("Not up to date")).toBeInTheDocument();
    expect(within(row("Raw")).getByText("Not converted")).toBeInTheDocument();
    for (const t of ["Raw", "Missing"]) {
      expect(box(t)).toBeDisabled();
      expect(box(t)).not.toBeChecked();
      expect(within(row(t)).queryByRole("button", { name: "Only some sections…" })).toBeNull();
    }
    expect(box("Stale")).toBeEnabled();
    expect(screen.getByText("2 of 4 documents")).toBeInTheDocument();
    cleanup();
    renderData(<ScopeHost docs={docs} work={{ converting: ["D1"], indexing: true }} initial={{ D1: ["§5"] }} />);
    expect(within(row("Fresh")).getByText("Converting…")).toBeInTheDocument();
    expect(within(row("Fresh")).getByText(/being converted · available once indexed/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Sections" })).toBeNull();
    expect(screen.getAllByText("Indexing…")).toHaveLength(2);
    expect(within(row("Stale")).getByText(/being indexed/)).toBeInTheDocument();
    for (const t of ["Fresh", "Missing", "Stale"]) expect(box(t)).toBeDisabled();
    expect(screen.getByText("0 of 4 documents")).toBeInTheDocument();
  });

  it("unready: converting first, then not converted, then the index state while an index runs or not", () => {
    const d = (indexed: DocRef["indexed"], at?: string) =>
      ({ id: "A", indexed, converted: at ? { at } : undefined }) as DocRef;
    const idle = { converting: [], indexing: false };
    const busy = { converting: [], indexing: true };
    expect(unready(d("fresh", "x"), { converting: ["A"], indexing: false })).toBe("converting");
    expect(unready(d("missing"), busy)).toBe("not-converted");
    expect(unready(d("fresh", "x"), busy)).toBeNull();
    expect(unready(d("stale", "x"), idle)).toBeNull();
    expect(unready(d("stale", "x"), busy)).toBe("indexing");
    expect(unready(d("missing", "x"), busy)).toBe("indexing");
    expect(unready(d("missing", "x"), idle)).toBe("not-indexed");
  });
});

describe("Generate › smart columns", () => {
  it("lists each column with its origin and what Claude writes; new ones ask to define", () => {
    const onEdit = vi.fn();
    render(
      <ColumnsView
        columns={[
          { name: "Action", origin: "xray", builtin: true, status: "ok", description: "One gesture", mode: "open" },
          {
            name: "Exigence",
            origin: "xray",
            builtin: false,
            status: "ok",
            description: "What the step checks",
            mode: "open",
          },
          { name: "Version", origin: "xray", builtin: false, status: "new", description: "", mode: "open" },
          { name: "Note", origin: "local", builtin: false, status: "ok", description: "", mode: "open" },
          { name: "Old", origin: "local", builtin: false, status: "gone", description: "x", mode: "open" },
        ]}
        onEdit={onEdit}
      />,
    );
    expect(screen.getByText("Xray · standard")).toBeInTheDocument();
    expect(screen.getByText("New in Xray")).toBeInTheDocument();
    expect(screen.getByText("Local only")).toBeInTheDocument();
    expect(screen.getByText("No longer in Xray")).toBeInTheDocument();
    expect(
      screen.getByText("New in Xray").closest("span")?.querySelector('[data-icon="alert-triangle"]'),
    ).not.toBeNull();
    expect(screen.getByText("Local only").closest("span")?.querySelector('[data-icon="drive"]')).not.toBeNull();
    expect(screen.getByText("What the step checks")).toBeInTheDocument();
    expect(screen.getByText("5 · 3 filled by Claude")).toBeInTheDocument();
    expect(screen.getAllByText("No description — Claude leaves it empty.")).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent(/A column came from Xray without a description/);
    fireEvent.click(screen.getByRole("button", { name: "Define the columns" }));
    expect(onEdit).toHaveBeenCalled();
    cleanup();
    render(
      <ColumnsView
        columns={[
          { name: "A", origin: "xray", builtin: false, status: "new", description: "", mode: "open" },
          { name: "B", origin: "xray", builtin: false, status: "new", description: "", mode: "open" },
        ]}
        onEdit={onEdit}
      />,
    );
    expect(screen.getByText(/2 columns came from Xray without a description — Claude leaves them/)).toBeInTheDocument();
    cleanup();
    render(<ColumnsView columns={[]} onEdit={onEdit} />);
    expect(
      screen.getByRole("button", { name: "Define the columns" }).querySelector('[data-icon="settings"]'),
    ).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
