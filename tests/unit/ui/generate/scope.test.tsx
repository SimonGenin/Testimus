// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef } from "../../../../src/core/types.ts";
import { type DocScope, flip, ownText, parents, scopeOf, tick } from "../../../../src/ui/lib/scope.ts";
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
  indexing = false,
  onAdd = undefined as (() => void) | undefined,
}) {
  const [v, setV] = useState(initial);
  return (
    <>
      <DocScopePicker docs={docs} scopes={v} indexing={indexing} onChange={setV} onAddDocuments={onAdd} />
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
    fireEvent.click(screen.getByRole("button", { name: "Add documents" }));
    expect(onAdd).toHaveBeenCalled();
    cleanup();
    api.routes["docs.show"] = () => null;
    renderData(<ScopeHost docs={[docRef("D1", "")]} initial={{ D1: [] }} />);
    expect(await screen.findByText("This document has no headings to pick from.")).toBeInTheDocument();
    expect(screen.getAllByText(/C-D1/).length).toBeGreaterThan(0);
  });

  it("each converted document says its index state", () => {
    const converted = { converted: { with: "", at: "x", warnings: [] } } as Partial<DocRef>;
    const docs = [
      docRef("D1", "Fresh", undefined, { ...converted, indexed: "fresh" } as Partial<DocRef>),
      docRef("D2", "Missing", undefined, { ...converted, indexed: "missing" } as Partial<DocRef>),
      docRef("D3", "Stale", undefined, { ...converted, indexed: "stale" } as Partial<DocRef>),
      docRef("D4", "Raw"),
    ];
    renderData(<ScopeHost docs={docs} />);
    const row = (t: string) => screen.getByRole("checkbox", { name: new RegExp(t) }).closest("li") as HTMLElement;
    expect(within(row("Fresh")).getByText("Indexed")).toBeInTheDocument();
    expect(within(row("Missing")).getByText("Not indexed")).toBeInTheDocument();
    expect(within(row("Stale")).getByText("Not up to date")).toBeInTheDocument();
    expect(within(row("Raw")).queryByText(/index/i)).toBeNull();
    cleanup();
    renderData(<ScopeHost docs={docs} indexing />);
    expect(screen.getAllByText("Indexing…")).toHaveLength(3);
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
    expect(screen.getByRole("button", { name: "Edit in Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
