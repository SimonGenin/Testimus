// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DocDetail } from "../../../../src/ui/screens/documents/DocDetail.tsx";
import { clearToasts } from "../../cov-uiscreens-helpers.tsx";
import { api, FakeEventSource, fakeDesktop, fakeFetch, named, noDesktop } from "../../ui-desktop-helpers.tsx";
import { at, doc, emit, mountDocs, refuse } from "./helpers.tsx";

beforeEach(() => {
  fakeFetch();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  setProject(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const shown = (over: Record<string, unknown> = {}) => ({
  doc: doc("D1", {
    date: "2026-01-02",
    source: { name: "", sha256: "", file: "x.pdf" },
    converted: { with: "", at, warnings: ["2 comments dropped"] },
    amends: ["D2"],
  }),
  context: "known",
  toc: [
    { anchor: "§5", title: "Traction", level: 1 },
    { anchor: "§5.6", title: "Sectionneur", level: 2 },
    { anchor: "§partie-sportive", title: "Partie Sportive", level: 1 },
  ],
  figures: [
    { file: "f", anchor: "fig:fig-1", caption: "Vue", description: "" },
    { file: "g", anchor: "fig:fig-2", caption: "", description: "" },
  ],
  md: "",
  ...over,
});

const show = (anchor = "", over: Record<string, unknown> = {}) => {
  const onAnchor = vi.fn();
  const onRemoved = vi.fn();
  api.routes["docs.show"] = (i) => (i.anchor ? { md: `Part ${i.anchor}` } : shown(over));
  mountDocs(<DocDetail id="D1" anchor={anchor} onAnchor={onAnchor} onRemoved={onRemoved} />);
  return { onAnchor, onRemoved };
};

const toc = () => screen.getByRole("navigation", { name: "Sections" });
const more = () => fireEvent.click(screen.getByRole("button", { name: "More actions for this document" }));
const status = () => screen.getByRole("radiogroup", { name: "Status" });

describe("DocDetail", () => {
  it("shows the document, its facts and the first sub-section by default", async () => {
    const { onAnchor } = show();
    expect(await screen.findByRole("heading", { name: "Title D1" })).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "C-D1 details" });
    expect(within(region).getByRole("complementary", { name: "Document settings" })).toBeInTheDocument();
    expect(screen.getByText("2026-01-02")).toBeInTheDocument();
    expect(screen.getByText(/Converted from PDF · 3 sections · 2 figures/)).toBeInTheDocument();
    expect(screen.getByText("2 comments dropped")).toBeInTheDocument();
    expect(await screen.findByText("Part §5.6")).toBeInTheDocument();
    const sub = within(toc()).getByRole("option", { name: "5.6 Sectionneur" });
    expect(sub).toHaveAttribute("aria-selected", "true");
    expect(within(toc()).getByRole("option", { name: "5 Traction" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(within(toc()).getByRole("option", { name: "5 Traction" }));
    expect(onAnchor).toHaveBeenCalledWith("§5");
    fireEvent.click(within(toc()).getByRole("option", { name: "Partie Sportive" }));
    expect(onAnchor).toHaveBeenCalledWith("§partie-sportive");
    expect(screen.queryByRole("button", { name: "Reindex" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the document list" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sections" })).toBeNull();
  });

  it("indents the contents by depth", async () => {
    show();
    await screen.findByText("Part §5.6");
    const chapter = within(toc()).getByRole("option", { name: "5 Traction" });
    const sub = within(toc()).getByRole("option", { name: "5.6 Sectionneur" });
    expect(chapter.firstElementChild?.getAttribute("style") ?? "").not.toContain("width");
    expect(sub.firstElementChild?.getAttribute("style")).toContain("* 1)");
  });

  it("reads the document again when a job changed its files, keeping it shown meanwhile", async () => {
    show();
    expect(await screen.findByText("Part §5.6")).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    const whole = () => named("docs.show").filter((c) => !c.input.anchor).length;
    emit({ jobId: "j", at, type: "changed", paths: ["docs/D2/doc.md", "docs/D10/doc.md"] });
    expect(whole()).toBe(1);
    api.routes["docs.show"] = (i) => (i.anchor ? { md: `New ${i.anchor}` } : shown());
    emit({ jobId: "j", at, type: "changed", paths: ["docs/D1/doc.md"] });
    expect(screen.getByRole("heading", { name: "Title D1" })).toBeInTheDocument();
    expect(await screen.findByText("New §5.6")).toBeInTheDocument();
    await waitFor(() => expect(whole()).toBe(2));
  });

  it("opens an anchor that is no section: no section is marked and there is nothing to step to", async () => {
    show("page:3");
    expect(await screen.findByText("Part page:3")).toBeInTheDocument();
    expect(within(toc()).queryByRole("option", { selected: true })).toBeNull();
    expect(screen.queryByText(/section \d+ of/)).toBeNull();
    expect(screen.getByRole("button", { name: "Previous section" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next section" })).toBeDisabled();
  });

  it("steps to the previous and next section, with the chapter it belongs to", async () => {
    const { onAnchor } = show();
    expect(await screen.findByText("Traction · section 2 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous section" }));
    expect(onAnchor).toHaveBeenLastCalledWith("§5");
    fireEvent.click(screen.getByRole("button", { name: "Next section" }));
    expect(onAnchor).toHaveBeenLastCalledWith("§partie-sportive");
    cleanup();
    show("§5");
    expect(await screen.findByText("section 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous section" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next section" })).toBeEnabled();
    cleanup();
    show("§partie-sportive");
    expect(await screen.findByText(/section 3 of 3$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous section" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next section" })).toBeDisabled();
  });

  it("the Figures view lists the figures, filters them, and opens one in the text", async () => {
    const { onAnchor } = show("", {
      figures: [
        { file: "figures/f.png", anchor: "fig:fig-1", caption: "Vue", description: "Une vue de traction" },
        { file: "", anchor: "fig:fig-2", caption: "", description: " " },
      ],
    });
    await screen.findByText("Part §5.6");
    const views = screen.getByRole("tablist", { name: "Document views" });
    expect(within(views).getByRole("tab", { name: "Text" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(views).getByRole("tab", { name: /^Figures/ }));
    expect(within(views).getByRole("tab", { name: /^Figures/ })).toHaveTextContent("Figures2");
    expect(screen.queryByText("Part §5.6")).toBeNull();
    const grid = () => screen.getByRole("list", { name: "Figures" });
    const figs = () => within(grid()).queryAllByRole("button");
    expect(figs()).toHaveLength(2);
    const tiles = within(grid()).getAllByRole("listitem");
    const tip = (tile: HTMLElement) => within(tile).getByRole("tooltip", { hidden: true }).textContent;
    const name = (tile: HTMLElement) => within(tile).getByRole("button").textContent;
    expect(name(tiles[0])).toBe("Vue");
    expect(tiles[0]).toHaveTextContent("fig:fig-1");
    expect(tip(tiles[0])).toBe("Une vue de traction");
    expect(tiles[0].querySelector("img")).toHaveAttribute("src", "/files/docs/D1/figures/f.png");
    expect(name(tiles[1])).toBe("fig:fig-2");
    expect(tip(tiles[1])).toBe("fig:fig-2");
    expect(tiles[1].querySelector("img")).toBeNull();
    const which = screen.getByRole("radiogroup", { name: "Which figures" });
    expect(within(which).getByRole("radio", { name: /^All/ })).toHaveTextContent("All 2");
    fireEvent.click(within(which).getByRole("radio", { name: /^Described/ }));
    expect(figs().map((b) => b.textContent)).toEqual(["Vue"]);
    fireEvent.click(within(which).getByRole("radio", { name: /^Not described/ }));
    expect(figs().map((b) => b.textContent)).toEqual(["fig:fig-2"]);
    expect(screen.queryByText("No figure here.")).toBeNull();
    fireEvent.click(figs()[0]);
    expect(onAnchor).toHaveBeenLastCalledWith("fig:fig-2");
    expect(within(views).getByRole("tab", { name: "Text" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Part §5.6")).toBeInTheDocument();
  });

  it("the Figures view says when a filter leaves no figure; a tile is named by its caption, then its anchor", async () => {
    show("", {
      figures: [
        { file: "", anchor: "fig:a", caption: "Plan", description: "" },
        { file: "", anchor: "fig:b", caption: "", description: "" },
      ],
    });
    await screen.findByText("Part §5.6");
    fireEvent.click(screen.getByRole("tab", { name: /^Figures/ }));
    const grid = screen.getByRole("list", { name: "Figures" });
    expect(
      within(grid)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Plan", "fig:b"]);
    fireEvent.click(screen.getByRole("radio", { name: /^Described/ }));
    expect(screen.queryByRole("list", { name: "Figures" })).toBeNull();
    expect(screen.getByText("No figure here.")).toBeInTheDocument();
  });

  it("a document without figures has no Figures view", async () => {
    show("", { figures: [] });
    await screen.findByText("Part §5.6");
    expect(screen.queryByRole("tablist", { name: "Document views" })).toBeNull();
    expect(screen.getByText(/· 0 figures/)).toBeInTheDocument();
  });

  it("falls back on the first section, and on nothing", async () => {
    show("", {
      toc: [{ anchor: "intro", title: "Intro", level: 1 }],
      figures: [],
      context: undefined,
    });
    expect(await screen.findByText("Part intro")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Intro" })).toBeInTheDocument();
    expect(screen.getByLabelText("Note for this document")).toHaveValue("");
    cleanup();
    show("", { toc: [] });
    await screen.findByRole("heading", { name: "Title D1" });
    expect(named("docs.show").filter((c) => c.input.anchor)).toHaveLength(1);
    expect(screen.getByText(/Converted from PDF · 0 sections/)).toBeInTheDocument();
  });

  it("shows the reason when a part cannot be read, and when the document cannot be opened", async () => {
    api.routes["docs.show"] = () => shown();
    refuse("docs.show", (i) => !!i.anchor, { error: "no such anchor" });
    mountDocs(<DocDetail id="D1" anchor="§9" onAnchor={vi.fn()} onRemoved={vi.fn()} />);
    expect(await screen.findByText("no such anchor")).toBeInTheDocument();
    cleanup();
    delete api.routes["docs.show"];
    mountDocs(<DocDetail id="DX" anchor="" onAnchor={vi.fn()} onRemoved={vi.fn()} />);
    expect(screen.getByRole("region", { name: "DX details" })).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByText("This document could not be opened")).toBeInTheDocument();
    expect(screen.getByText("Unknown command docs.show")).toBeInTheDocument();
  });

  it("saves the status, the note (against the version it was read at) and the saved contexts", async () => {
    let saved = doc("D1");
    api.routes["docs.set"] = (i) => {
      saved = { ...saved, ...(i as Partial<DocRef>) };
      return { ...saved, contextMtime: 42 };
    };
    api.routes["contexts.list"] = () => [{ id: "glossary", name: "Glossary", shared: false }];
    show("", { contexts: ["glossary"], contextMtime: 7 });
    await screen.findByRole("heading", { name: "Title D1" });
    expect(
      within(status())
        .getAllByRole("radio")
        .map((o) => o.textContent),
    ).toEqual(["Draft", "Submitted", "Validated"]);
    expect(within(status()).getByRole("radio", { name: "Validated", checked: true })).toBeInTheDocument();
    expect(screen.queryByLabelText("Binding")).toBeNull();
    expect(screen.queryByLabelText("Superseded by")).toBeNull();
    fireEvent.click(within(status()).getByRole("radio", { name: "Validated" }));
    fireEvent.click(within(status()).getByRole("radio", { name: "Draft" }));
    await waitFor(() => expect(named("docs.set")[0]?.input).toEqual({ id: "D1", status: "draft" }));
    await waitFor(() =>
      expect(within(status()).getByRole("radio", { name: "Draft", checked: true })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Amends")).toBeNull();
    expect(screen.getByText(/what the team knows about this document/i)).toBeInTheDocument();
    const ctx = screen.getByLabelText("Note for this document");
    fireEvent.blur(ctx);
    expect(named("docs.set")).toHaveLength(1);
    fireEvent.change(ctx, { target: { value: "new note" } });
    fireEvent.blur(ctx);
    await waitFor(() => expect(named("docs.set")[1]?.input).toEqual({ id: "D1", context: "new note", ifMtime: 7 }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    fireEvent.blur(ctx);
    expect(named("docs.set")).toHaveLength(2);
    fireEvent.change(ctx, { target: { value: "unsaved note" } });
    fireEvent.click(await screen.findByRole("button", { name: "Glossary" }));
    await waitFor(() => expect(named("docs.set")).toHaveLength(4));
    expect(named("docs.set")[2]?.input).toEqual({ id: "D1", context: "unsaved note", ifMtime: 42 });
    expect(named("docs.set")[3]?.input).toEqual({ id: "D1", contexts: [] });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Glossary" })).toBeNull());
  });

  it("leaving a saved context out with the note untouched saves the list alone", async () => {
    api.routes["docs.set"] = (i) => ({ ...doc("D1"), ...(i as Partial<DocRef>), contextMtime: null });
    api.routes["contexts.list"] = () => [{ id: "glossary", name: "Glossary", shared: false }];
    show("", { contexts: ["glossary"] });
    fireEvent.click(await screen.findByRole("button", { name: "Glossary" }));
    await waitFor(() => expect(named("docs.set")[0]?.input).toEqual({ id: "D1", contexts: [] }));
    expect(named("docs.set")).toHaveLength(1);
  });

  it("a note changed on disk while it is edited is a conflict: keep mine saves without the version", async () => {
    api.routes["docs.set"] = () => ({ ...doc("D1"), contextMtime: 9 });
    refuse("docs.set", (i) => i.ifMtime !== undefined, { error: "changed", code: "conflict" }, 409);
    show("", { contextMtime: 6 });
    const ctx = await screen.findByLabelText("Note for this document");
    fireEvent.change(ctx, { target: { value: "mine" } });
    fireEvent.blur(ctx);
    expect(await screen.findByRole("button", { name: "Keep mine" })).toBeInTheDocument();
    expect(screen.getAllByText("Changed on disk").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    await waitFor(() => expect(named("docs.set").at(-1)?.input).toEqual({ id: "D1", context: "mine" }));
  });

  it("⋯ › Delete asks, then removes the document; Cancel and a failure leave it", async () => {
    let fail = true;
    api.routes["docs.remove"] = (i) => ({
      removed: "D1",
      folder: "docs/D1",
      unlinked: [],
      citedBy: [],
      dryRun: !!i.dryRun,
    });
    refuse("docs.remove", (i) => fail && !i.dryRun, { error: "locked" });
    const { onRemoved } = show();
    await screen.findByRole("heading", { name: "Title D1" });
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("alertdialog", { name: "Delete this document?" })).toHaveTextContent(/from the index/);
    expect(await screen.findByText("No test cites it.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(named("docs.remove").map((c) => c.input)).toEqual([{ id: "D1", dryRun: true }]);
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).not.toHaveAttribute("aria-busy"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Could not delete the document")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onRemoved).not.toHaveBeenCalled();
    fail = false;
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).not.toHaveAttribute("aria-busy"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(named("docs.remove").at(-1)?.input).toEqual({ id: "D1" });
    expect(screen.getByText("C-D1 deleted")).toBeInTheDocument();
  });

  it("Delete lists the tests that cite the document, then says they were re-checked", async () => {
    const t = (n: number, review = "draft") => ({ id: `local-${n}`, summary: `Test ${n}`, review, steps: 1 });
    const cited = [{ ...t(0, "validated"), key: "T-1" }, ...Array.from({ length: 9 }, (_, i) => t(i + 1))];
    api.routes["docs.remove"] = (i) => ({
      removed: "D1",
      folder: "docs/D1",
      unlinked: ["D2"],
      citedBy: cited,
      dryRun: !!i.dryRun,
    });
    const { onRemoved } = show();
    await screen.findByRole("heading", { name: "Title D1" });
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("aria-busy", "true");
    const list = await screen.findByRole("list", { name: "Tests that cite this document" });
    const dialog = screen.getByRole("alertdialog", { name: "Delete this document?" });
    expect(dialog).toHaveTextContent("10 tests cite it, 1 of them validated");
    expect(within(list).getAllByRole("listitem")).toHaveLength(8);
    expect(within(list).getByText("T-1")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("and 2 more");
    expect(dialog).toHaveTextContent("This document amends it and will no longer name it: D2");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(screen.getByText(/10 tests citing it were re-checked/)).toBeInTheDocument();
  });

  it("Delete still works when the citing tests cannot be listed; one citing test reads in the singular", async () => {
    api.routes["docs.remove"] = () => ({
      removed: "D1",
      folder: "",
      unlinked: [],
      citedBy: [{ id: "a", summary: "A", review: "draft", steps: 2 }],
    });
    refuse("docs.remove", (i) => !!i.dryRun, { error: "tests unreadable" });
    const { onRemoved } = show();
    await screen.findByRole("heading", { name: "Title D1" });
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText(/could not be listed: tests unreadable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(screen.getByText(/1 test citing it was re-checked: its sources/)).toBeInTheDocument();
  });

  it("Delete with one citing test and several amending documents", async () => {
    api.routes["docs.remove"] = (i) => ({
      removed: "D1",
      folder: "",
      unlinked: ["D2", "D3"],
      citedBy: [{ id: "a", summary: "A", review: "draft", steps: 1 }],
      dryRun: !!i.dryRun,
    });
    show();
    await screen.findByRole("heading", { name: "Title D1" });
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete this document?" });
    await waitFor(() => expect(dialog).toHaveTextContent("1 test cites it."));
    expect(dialog).toHaveTextContent("These documents amend it and will no longer name it: D2, D3");
  });

  it("reports a failed save and shows Word documents without a date or amends", async () => {
    show("", { doc: doc("D1", { source: { name: "", sha256: "", file: "" } }) });
    await screen.findByRole("heading", { name: "Title D1" });
    expect(screen.getByText(/Converted from Word/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Conversion warnings" })).toBeNull();
    fireEvent.click(within(status()).getByRole("radio", { name: "Draft" }));
    expect(await screen.findByText("Could not save the document")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(status()).getByRole("radio", { name: "Validated", checked: true })).toBeInTheDocument(),
    );
  });

  it("shows the document folder in Explorer on the desktop, from ⋯", async () => {
    const d = fakeDesktop();
    setProject("C:\\proj");
    show();
    await screen.findByRole("heading", { name: "Title D1" });
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Show in Explorer" }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith("C:\\proj\\docs\\D1"));
  });

  it("ignores answers that arrive after leaving", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    api.routes["docs.show"] = (i) => (i.anchor ? { md: "late" } : shown());
    const f = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        await gate;
        return f(url, init);
      }),
    );
    const { unmount } = mountDocs(<DocDetail id="D1" anchor="" onAnchor={vi.fn()} onRemoved={vi.fn()} />);
    unmount();
    release();
    await waitFor(() => expect(named("docs.show")).toHaveLength(1));
  });
});
