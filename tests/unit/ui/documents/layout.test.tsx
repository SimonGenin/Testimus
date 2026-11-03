// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef } from "../../../../src/core/types.ts";
import type { Action } from "../../../../src/ui/lib/actions.ts";
import { DocDetail } from "../../../../src/ui/screens/documents/DocDetail.tsx";
import { DocumentsScreen } from "../../../../src/ui/screens/documents/DocumentsScreen.tsx";
import { foldOf } from "../../../../src/ui/screens/documents/layout.ts";
import { clearToasts } from "../../cov-uiscreens-helpers.tsx";
import { api, FakeEventSource, fakeFetch } from "../../ui-desktop-helpers.tsx";
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
        if (el.getAttribute("data-testid") !== "docs-body") return;
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

const fold = (c: HTMLElement) => c.querySelector('[data-testid="docs-body"]')?.getAttribute("data-fold");
const edge = (name: string) => screen.getByRole("separator", { name });
const drawer = (name: string) => screen.queryByRole("dialog", { name });
const scrim = (name: string) => fireEvent.mouseDown(screen.getByRole("dialog", { name }).parentElement as HTMLElement);
const pressEscape = (name: string) => fireEvent.keyDown(screen.getByRole("dialog", { name }), { key: "Escape" });

describe("foldOf", () => {
  it("folds the outer columns first as the screen narrows", () => {
    expect([Number.POSITIVE_INFINITY, 1300, 1299, 1052, 1051, 752, 751, 0].map((w) => foldOf(w))).toEqual([
      "wide",
      "wide",
      "medium",
      "medium",
      "small",
      "small",
      "tiny",
      "tiny",
    ]);
  });

  it("wider columns fold sooner, narrower ones later", () => {
    expect(foldOf(1300, { list: 300, toc: 256, side: 300 })).toBe("medium");
    expect(foldOf(1160, { list: 200, toc: 200, side: 260 })).toBe("wide");
    expect(foldOf(700, { list: 248, toc: 180, side: 300 })).toBe("small");
  });
});

describe("Documents screen resizing", () => {
  it("wide: the list, the contents and the settings have their own edges, at the widths last chosen", async () => {
    listed();
    localStorage.setItem("testimus.docsListWidth", "300");
    localStorage.setItem("testimus.docsTocWidth", "200");
    localStorage.setItem("testimus.docsSideWidth", "360");
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    expect(edge("Resize the document list")).toHaveAttribute("aria-valuenow", "300");
    expect(edge("Resize the sections")).toHaveAttribute("aria-valuenow", "200");
    expect(edge("Resize the settings")).toHaveAttribute("aria-valuenow", "360");
  });

  it("a drag grows a column only into the room the text can spare, and is kept", async () => {
    listed();
    sized(1400);
    const { container } = mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    const side = edge("Resize the settings");
    fireEvent.pointerDown(side, { clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(side, { clientX: 700, pointerId: 1 });
    expect(side).toHaveAttribute("aria-valuenow", "400");
    fireEvent.pointerUp(side, { pointerId: 1 });
    expect(fold(container)).toBe("wide");
    expect(localStorage.getItem("testimus.docsSideWidth")).toBe("400");
    fireEvent.doubleClick(side);
    expect(side).toHaveAttribute("aria-valuenow", "300");
    expect(localStorage.getItem("testimus.docsSideWidth")).toBeNull();
  });
});

describe("Documents screen folding", () => {
  it("wide: the list stays beside the text; no drawer buttons", async () => {
    listed();
    const { container } = mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    expect(fold(container)).toBe("wide");
    expect(screen.getByRole("region", { name: "Document list" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show the document list" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sections" })).toBeNull();
  });

  it("medium: the list is a drawer opened from the detail; a pick, Escape, the scrim or the button closes it", async () => {
    listed();
    const body = sized(1100);
    const { container, app: a } = mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    expect(fold(container)).toBe("medium");
    expect(screen.queryByRole("region", { name: "Document list" })).toBeNull();
    expect(screen.queryByRole("separator", { name: "Resize the document list" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sections" })).toBeNull();
    const show = screen.getByRole("button", { name: "Show the document list" });
    expect(show).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(show);
    expect(drawer("Documents")).not.toBeNull();
    expect(show).toHaveAttribute("aria-expanded", "true");
    scrim("Documents");
    expect(drawer("Documents")).toBeNull();

    fireEvent.click(show);
    pressEscape("Documents");
    expect(drawer("Documents")).toBeNull();

    fireEvent.click(show);
    fireEvent.click(show);
    expect(drawer("Documents")).toBeNull();

    fireEvent.click(show);
    const rows = within(screen.getByRole("region", { name: "Document list" })).getAllByRole("option");
    fireEvent.click(rows[1]);
    expect(a.navigate).toHaveBeenCalledWith("documents", "D2");
    expect(drawer("Documents")).toBeNull();

    fireEvent.click(show);
    body.resize(1400);
    expect(fold(container)).toBe("wide");
    expect(drawer("Documents")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the document list" })).toBeNull();
    cleanup();
    expect(body.disconnect).toHaveBeenCalled();
  });

  it("a folded screen without a document to show offers to open the list", async () => {
    listed();
    sized(900);
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "NOPE" } });
    fireEvent.click(await screen.findByRole("button", { name: "Show the document list" }));
    expect(drawer("Documents")).not.toBeNull();
    expect(await screen.findByText("Title D1")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: / details$/ })).toBeNull();
  });

  it("small: Details opens the settings as a drawer; the button, Escape, the scrim or a wider screen closes it", async () => {
    listed({ converted: { with: "", at, warnings: ["2 comments dropped"] } });
    const body = sized(900);
    const { container } = mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    expect(fold(container)).toBe("small");
    expect(screen.queryByRole("button", { name: "Sections" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Document settings" })).toBeNull();
    const region = screen.getByRole("region", { name: "C-D1 details" });
    const details = within(region).getByRole("button", { name: "Details" });
    expect(details).toHaveAttribute("aria-expanded", "false");
    expect(within(region).getByTestId("details-warned")).toHaveAttribute("title", "Conversion warnings");

    fireEvent.click(details);
    expect(drawer("About this document")).not.toBeNull();
    expect(screen.getByRole("complementary", { name: "Document settings" })).toBeInTheDocument();
    expect(details).toHaveAttribute("aria-expanded", "true");
    scrim("About this document");
    expect(drawer("About this document")).toBeNull();

    fireEvent.click(details);
    fireEvent.click(details);
    expect(drawer("About this document")).toBeNull();

    fireEvent.click(details);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "About this document" }), { key: "Enter" });
    expect(drawer("About this document")).not.toBeNull();
    pressEscape("About this document");
    expect(drawer("About this document")).toBeNull();

    fireEvent.click(details);
    body.resize(1100);
    expect(drawer("About this document")).toBeNull();
    expect(within(region).queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Document settings" })).toBeInTheDocument();
  });

  it("tiny: Sections opens the contents as a drawer; a picked section, the scrim, Escape or a wider screen closes it", async () => {
    listed();
    const body = sized(600);
    const { container, app: a } = mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    await screen.findByText("Part §1.1");
    expect(fold(container)).toBe("tiny");
    const region = screen.getByRole("region", { name: "C-D1 details" });
    const sections = within(region).getByRole("button", { name: "Sections" });
    const details = within(region).getByRole("button", { name: "Details" });
    expect(within(region).queryByTestId("details-warned")).toBeNull();
    expect(sections).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();

    fireEvent.click(sections);
    expect(drawer("Contents")).not.toBeNull();
    expect(sections).toHaveAttribute("aria-expanded", "true");
    scrim("Contents");
    expect(drawer("Contents")).toBeNull();

    fireEvent.click(sections);
    fireEvent.click(details);
    expect(drawer("Contents")).toBeNull();
    expect(drawer("About this document")).not.toBeNull();
    fireEvent.click(sections);
    expect(drawer("Contents")).not.toBeNull();

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
    expect(within(region).getByRole("button", { name: "Details" })).toBeInTheDocument();
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
    ...o,
  });

  it("stay in Ask Claude: neither the list nor the settings show them", async () => {
    listed({ converted: { with: "", at, warnings: ["2 comments dropped", "1 table split"] } });
    api.routes["actions.list"] = () => [action()];
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D1" } });
    const list = await screen.findByRole("region", { name: "Document list" });
    const settings = await screen.findByRole("complementary", { name: "Document settings" });
    expect(await within(settings).findByText("2 comments dropped")).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "Recover the figures" })).toBeNull();
    expect(within(settings).queryByRole("button", { name: "Recover the figures" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Claude actions/ })).toBeNull();
  });
});

describe("DocDetail folded", () => {
  it("a document that cannot be opened still offers the list", async () => {
    const onShowList = vi.fn();
    mountDocs(
      <DocDetail
        id="DX"
        anchor=""
        fold="medium"
        listOpen
        onShowList={onShowList}
        onAnchor={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    expect(await screen.findByText("This document could not be opened")).toBeInTheDocument();
    const show = screen.getByRole("button", { name: "Show the document list" });
    expect(show).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(show);
    expect(onShowList).toHaveBeenCalled();
  });

  it("a document not converted yet has Details but no Sections when tiny", async () => {
    api.routes["docs.show"] = () => ({
      doc: doc("D3", { converted: undefined }),
      context: "",
      toc: [],
      figures: [],
      md: "",
    });
    mountDocs(<DocDetail id="D3" anchor="" fold="tiny" onAnchor={vi.fn()} onRemoved={vi.fn()} />);
    expect(await screen.findByText("Not converted yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sections" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
  });
});
