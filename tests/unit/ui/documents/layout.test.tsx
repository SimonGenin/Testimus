// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef } from "../../../../src/core/types.ts";
import type { Action } from "../../../../src/ui/lib/actions.ts";
import { DocDetail } from "../../../../src/ui/screens/documents/DocDetail.tsx";
import { DocumentsScreen } from "../../../../src/ui/screens/documents/DocumentsScreen.tsx";
import { TEXT, tocFits } from "../../../../src/ui/screens/documents/layout.ts";
import { api, FakeEventSource, fakeFetch } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { at, doc, mountDocs } from "./helpers.tsx";

beforeEach(() => {
  fakeFetch();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  clearToasts();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Entry = { contentRect: { width: number } };

function sized(width: number) {
  const body = { resize: (_w: number) => {}, disconnect: vi.fn() };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      cb: (e: Entry[]) => void;
      constructor(cb: (e: Entry[]) => void) {
        this.cb = cb;
      }
      observe(el: Element) {
        if (!el.getAttribute("aria-label")?.endsWith(" details")) return;
        body.resize = (w) => act(() => this.cb([{ contentRect: { width: w } }]));
        this.cb([{ contentRect: { width } }]);
      }
      disconnect() {
        body.disconnect();
      }
    },
  );
  return body;
}

const listed = (over: Partial<DocRef> = {}) => {
  const docs = [doc("D1", over), doc("D2")];
  api.routes["docs.list"] = () => docs;
  api.routes["rag.status"] = () => ({ exists: true, degraded: null });
  api.routes["docs.show"] = (i) =>
    i.anchor
      ? { md: `Part ${i.anchor}` }
      : {
          doc: docs.find((d) => d.id === i.id),
          context: "",
          toc: [
            { anchor: "§1", title: "One", level: 1 },
            { anchor: "§1.1", title: "Sub", level: 2 },
          ],
          figures: [],
          md: "",
        };
};

const edge = (name: string) => screen.getByRole("separator", { name });
const drawer = (name: string) => screen.queryByRole("dialog", { name });
const scrim = (name: string) => fireEvent.mouseDown(screen.getByRole("dialog", { name }).parentElement as HTMLElement);
const pressEscape = (name: string) => fireEvent.keyDown(screen.getByRole("dialog", { name }), { key: "Escape" });

describe("tocFits", () => {
  it("keeps the contents beside the text while both fit in the document's section", () => {
    expect(TEXT).toBe(496);
    expect([Number.POSITIVE_INFINITY, 752, 751, 0].map((w) => tocFits(w))).toEqual([true, true, false, false]);
    expect(tocFits(700, 180)).toBe(true);
    expect(tocFits(700, 300)).toBe(false);
  });
});

describe("Documents screen sections", () => {
  it("the list, the document and its details are tabs of three sections; Claude sits beside the details", async () => {
    listed({ converted: { with: "", at, warnings: ["2 comments dropped"] } });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    for (const name of ["Documents", "Document", "Details", "Claude"])
      expect(screen.getByRole("tab", { name: new RegExp(`^${name}(?![a-z])`) })).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "Document list" });
    const region = screen.getByRole("region", { name: "C-D1 details" });
    const settings = screen.getByRole("complementary", { name: "Document settings" });
    expect(list.contains(region)).toBe(false);
    expect(region.contains(settings)).toBe(false);
    expect(within(settings).getByText("2 comments dropped")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show the document list" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sections" })).toBeNull();
  });

  it("the list folds to its strip and back, and a pick from it opens the document", async () => {
    listed();
    const { app: a } = mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    const bar = screen.getByRole("tablist", { name: /Documents$/ }).parentElement as HTMLElement;
    fireEvent.click(within(bar).getByRole("button", { name: "Collapse this section" }));
    expect(screen.queryByRole("region", { name: "Document list" })).toBeNull();
    const strip = screen.getByRole("navigation", { name: "Section 1, collapsed" });
    fireEvent.click(within(strip).getByRole("button", { name: "Documents, 2" }));
    const rows = within(screen.getByRole("region", { name: "Document list" })).getAllByRole("option");
    fireEvent.click(rows[1]);
    expect(a.navigate).toHaveBeenCalledWith("documents", "D2");
  });

  it("a link to a document that is not there says so in the document's section, the list still beside it", async () => {
    listed();
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "NOPE" } });
    expect(await screen.findByText("Document not found")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Document list" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: / details$/ })).toBeNull();
  });
});

describe("The contents beside the text", () => {
  it("keep the width last chosen; a drag grows them only into the room the text can spare, and is kept", async () => {
    listed();
    localStorage.setItem("testimus.docsTocWidth", "200");
    sized(800);
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    const toc = edge("Resize the sections");
    expect(toc).toHaveAttribute("aria-valuenow", "200");
    expect(toc).toHaveAttribute("aria-valuemax", String(800 - TEXT));
    fireEvent.pointerDown(toc, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(toc, { clientX: 600, pointerId: 1 });
    expect(toc).toHaveAttribute("aria-valuenow", String(800 - TEXT));
    fireEvent.pointerUp(toc, { pointerId: 1 });
    expect(localStorage.getItem("testimus.docsTocWidth")).toBe(String(800 - TEXT));
    fireEvent.doubleClick(toc);
    expect(toc).toHaveAttribute("aria-valuenow", "256");
    expect(localStorage.getItem("testimus.docsTocWidth")).toBeNull();
  });

  it("a narrow section: Sections opens them as a drawer; a picked section, the scrim, Escape or a wider section closes it", async () => {
    listed();
    const body = sized(600);
    const { app: a } = mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    const region = screen.getByRole("region", { name: "C-D1 details" });
    const sections = within(region).getByRole("button", { name: "Sections" });
    expect(sections).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();

    fireEvent.click(sections);
    expect(drawer("Contents")).not.toBeNull();
    expect(sections).toHaveAttribute("aria-expanded", "true");
    scrim("Contents");
    expect(drawer("Contents")).toBeNull();

    fireEvent.click(sections);
    fireEvent.click(sections);
    expect(drawer("Contents")).toBeNull();

    fireEvent.click(sections);
    const toc = screen.getByRole("navigation", { name: "Sections" });
    fireEvent.click(within(toc).getByRole("option", { name: "1 One" }));
    expect(a.navigate).toHaveBeenCalledWith("documents", "D1#§1");
    expect(drawer("Contents")).toBeNull();

    fireEvent.click(sections);
    pressEscape("Contents");
    expect(drawer("Contents")).toBeNull();

    fireEvent.click(sections);
    body.resize(900);
    expect(drawer("Contents")).toBeNull();
    expect(within(region).queryByRole("button", { name: "Sections" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeInTheDocument();
    cleanup();
    expect(body.disconnect).toHaveBeenCalled();
  });
});

describe("Claude actions on documents", () => {
  const action = (o: Partial<Action> = {}): Action => ({
    id: "act-1",
    title: "Recover the figures",
    scope: { kind: "doc", docId: "D1" },
    where: "doc:D1",
    problem: "2 comments dropped",
    why: "The PDF has them.",
    plan: ["Convert again"],
    stamp: "s",
    proposedBy: { run: "import", model: "opus", effort: "low", at },
    state: "open",
    at,
    stale: false,
    target: { kind: "document", id: "D1", name: "Traction" },
    ...o,
  });

  it("are not in the list; the one proposed for a conversion warning shows under it in the settings", async () => {
    listed({ converted: { with: "", at, warnings: ["2 comments dropped", "1 table split"] } });
    api.routes["actions.list"] = () => [action()];
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    const list = await screen.findByRole("region", { name: "Document list" });
    const settings = await screen.findByRole("complementary", { name: "Document settings" });
    expect(await within(settings).findByText("2 comments dropped")).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "Recover the figures" })).toBeNull();
    expect(await within(settings).findByRole("button", { name: "Recover the figures" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Claude actions/ })).toBeNull();
  });
});

describe("DocDetail alone", () => {
  it("a document that cannot be opened says so, with no button for the list (the list is its own section)", async () => {
    mountDocs(<DocDetail id="DX" anchor="" onAnchor={vi.fn()} onRemoved={vi.fn()} />);
    expect(await screen.findByText("This document could not be opened")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show the document list" })).toBeNull();
  });

  it("a document not converted yet has no Sections, even in a narrow section", async () => {
    sized(600);
    api.routes["docs.show"] = () => ({
      doc: doc("D3", { converted: undefined }),
      context: "",
      toc: [],
      figures: [],
      md: "",
    });
    mountDocs(<DocDetail id="D3" anchor="" onAnchor={vi.fn()} onRemoved={vi.fn()} />);
    expect(await screen.findByText("Not converted yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sections" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
  });
});
