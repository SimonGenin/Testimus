// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DocDetail } from "../../../../src/ui/screens/documents/DocDetail.tsx";
import { scrolling } from "../../helpers/scrolling.ts";
import { api, FakeEventSource, fakeDesktop, fakeFetch, named, noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { at, boxes, doc, emit, mountDocs, refuse } from "./helpers.tsx";

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

  it("the Figures view lists the figures, filters them, details the picked one and opens it in the text", async () => {
    api.routes["docs.show"] = (i) =>
      i.anchor === "fig:fig-1"
        ? { md: "", section: "§5.6" }
        : i.anchor
          ? { md: `Part ${i.anchor}` }
          : shown({
              figures: [
                {
                  file: "figures/f.png",
                  anchor: "fig:fig-1",
                  caption: "Vue",
                  description: "Une vue de traction",
                  labels: ["S 12", "Ouvrir"],
                  kind: "screen",
                },
                { file: "", anchor: "fig:fig-2", caption: "", description: " " },
              ],
            });
    const onAnchor = vi.fn();
    mountDocs(<DocDetail id="D1" anchor="" onAnchor={onAnchor} onRemoved={vi.fn()} />);
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
    const name = (tile: HTMLElement) => within(tile).getByRole("button").getAttribute("aria-label");
    expect(name(tiles[0])).toBe("Vue");
    expect(tiles[0]).toHaveTextContent("fig:fig-1");
    expect(tiles[0]).toHaveTextContent("screen");
    expect(tiles[0]).toHaveTextContent("Described");
    expect(tiles[0].querySelector("img")).toHaveAttribute("src", "/files/docs/D1/figures/f.png");
    expect(name(tiles[1])).toBe("fig:fig-2");
    expect(tiles[1]).toHaveTextContent("Not described");
    expect(tiles[1].querySelector("img")).toBeNull();
    expect(within(tiles[0]).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    const detail = screen.getByRole("complementary", { name: "Vue" });
    expect(detail).toHaveTextContent("D1#fig:fig-1");
    expect(detail).toHaveTextContent("Une vue de traction");
    expect(detail).toHaveTextContent("Text in the picture: S 12 · Ouvrir");
    expect(detail).toHaveTextContent("Description only — the caption is what a source can quote");
    fireEvent.click(await within(detail).findByRole("button", { name: "§ 5.6" }));
    expect(onAnchor).toHaveBeenLastCalledWith("§5.6");
    fireEvent.click(within(views).getByRole("tab", { name: /^Figures/ }));
    const which = screen.getByRole("radiogroup", { name: "Which figures" });
    expect(within(which).getByRole("radio", { name: /^All/ })).toHaveTextContent("All 2");
    fireEvent.click(within(which).getByRole("radio", { name: /^Described/ }));
    expect(figs().map((b) => b.getAttribute("aria-label"))).toEqual(["Vue"]);
    fireEvent.click(within(which).getByRole("radio", { name: /^Not described/ }));
    expect(figs().map((b) => b.getAttribute("aria-label"))).toEqual(["fig:fig-2"]);
    const bare = screen.getByRole("complementary", { name: "fig:fig-2" });
    expect(bare).toHaveTextContent("The conversion kept no picture for this figure");
    expect(within(bare).queryByRole("button", { name: /^Describe/ })).toBeNull();
    fireEvent.click(within(bare).getByRole("button", { name: "Show in the text" }));
    expect(onAnchor).toHaveBeenLastCalledWith("fig:fig-2");
    expect(within(views).getByRole("tab", { name: "Text" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Part §5.6")).toBeInTheDocument();
  });

  it("a figure anchor opens the whole section that holds it, its text and pictures, the figure set apart", async () => {
    api.routes["docs.show"] = (i) => {
      if (i.anchor === "fig:fig-2" && i.brief) return { ...shown(), section: "§5.6" };
      if (i.anchor === "§5.6")
        return {
          md: "Avant la figure.\n\n![Plan](figures/a.png) <!-- fig fig-1 -->\n\n![Coupe](figures/b.png) <!-- fig fig-2 -->\n\nAprès la figure.",
        };
      if (i.anchor) return { md: `Part ${i.anchor}` };
      return shown();
    };
    mountDocs(<DocDetail id="D1" anchor="fig:fig-2" onAnchor={vi.fn()} onRemoved={vi.fn()} />);
    expect(await screen.findByText("Après la figure.")).toBeInTheDocument();
    expect(screen.getByText("Avant la figure.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Coupe" }).closest("[data-target]")).not.toBeNull();
    expect(screen.getByRole("img", { name: "Plan" }).closest("[data-target]")).toBeNull();
    expect(named("docs.show").some((c) => c.input.anchor === "fig:fig-2" && !c.input.brief)).toBe(false);
  });

  it("a tile picks its figure; Describe asks Claude for the figures not described, Describe again for one", async () => {
    api.routes["docs.describeFigures"] = () => ({ jobId: "describe-figures-1234abcd" });
    show("", {
      figures: [
        { file: "figures/a.png", anchor: "fig:a", caption: "Plan", description: "Un plan" },
        { file: "figures/b.png", anchor: "fig:b", caption: "Coupe", description: "" },
        { file: "figures/c.png", anchor: "fig:c", caption: "Vue", description: "" },
      ],
    });
    await screen.findByText("Part §5.6");
    fireEvent.click(screen.getByRole("tab", { name: /^Figures/ }));
    const grid = screen.getByRole("list", { name: "Figures" });
    fireEvent.click(within(grid).getByRole("button", { name: "Coupe" }));
    expect(within(grid).getByRole("button", { name: "Coupe" })).toHaveAttribute("aria-pressed", "true");
    expect(within(grid).getByRole("button", { name: "Plan" })).not.toHaveAttribute("aria-pressed");
    const detail = screen.getByRole("complementary", { name: "Coupe" });
    expect(detail).toHaveTextContent("Claude has not read this picture yet");
    fireEvent.click(within(detail).getByRole("button", { name: "Describe it" }));
    await waitFor(() =>
      expect(named("docs.describeFigures").at(-1)?.input).toEqual({ docId: "D1", force: false, anchors: ["fig:b"] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Describe 2 figures" }));
    await waitFor(() => expect(named("docs.describeFigures").at(-1)?.input).toEqual({ docId: "D1", force: false }));
    expect(await screen.findByText("Claude describes 2 figures")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Open in Jobs" }).length).toBeGreaterThan(0);
    fireEvent.click(within(grid).getByRole("button", { name: "Plan" }));
    expect(
      within(screen.getByRole("complementary", { name: "Plan" })).getByRole("button", { name: "Describe again" }),
    ).toBeInTheDocument();
  });

  it("Describe waits for Claude when it is missing or signed out", async () => {
    api.routes["claude.status"] = () => ({ installed: true, signedIn: false });
    show("", { figures: [{ file: "figures/b.png", anchor: "fig:b", caption: "Coupe", description: "" }] });
    await screen.findByText("Part §5.6");
    fireEvent.click(screen.getByRole("tab", { name: /^Figures/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Describe 1 figure" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Describe 1 figure" })).toHaveAccessibleDescription(
      "Claude is not connected",
    );
    expect(screen.getByRole("button", { name: "Describe it" })).toBeDisabled();
  });

  it("a figure in the text shows in Figures, picked", async () => {
    api.routes["docs.show"] = (i) =>
      i.anchor === "§5.6"
        ? { md: "![Coupe](figures/b.png) <!-- fig b -->" }
        : i.anchor
          ? { md: "" }
          : shown({
              figures: [
                { file: "figures/a.png", anchor: "fig:a", caption: "Plan", description: "" },
                { file: "figures/b.png", anchor: "fig:b", caption: "Coupe", description: "" },
              ],
            });
    const { tops } = boxes({
      '[data-testid="doc-figures"]': { top: 100, bottom: 300, height: 200 },
      "[data-picked]": { top: 900, bottom: 1000, height: 100 },
    });
    scrolling('[data-testid="doc-figures"]');
    mountDocs(<DocDetail id="D1" anchor="" onAnchor={vi.fn()} onRemoved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Show Coupe in Figures" }));
    expect(screen.getByRole("tab", { name: /^Figures/ })).toHaveAttribute("aria-selected", "true");
    const grid = screen.getByRole("list", { name: "Figures" });
    expect(within(grid).getByRole("button", { name: "Coupe" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("complementary", { name: "Coupe" })).toBeInTheDocument();
    expect(tops.get(screen.getByTestId("doc-figures"))).toBe(750);
  });

  it("the Figures view says what each filter leaves out; a tile is named by its caption, then its anchor", async () => {
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
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Plan", "fig:b"]);
    expect(screen.queryByRole("button", { name: /^Describe \d/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /^Described/ }));
    expect(screen.queryByRole("list", { name: "Figures" })).toBeNull();
    expect(screen.getByText("No figure is described yet")).toBeInTheDocument();
    cleanup();
    show("", { figures: [{ file: "", anchor: "fig:a", caption: "Plan", description: "Un plan" }] });
    await screen.findByText("Part §5.6");
    fireEvent.click(screen.getByRole("tab", { name: /^Figures/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^Not described/ }));
    expect(screen.getByText("Every figure is described")).toBeInTheDocument();
    expect(screen.getByText(/« Describe again » on a figure asks for a new reading/)).toBeInTheDocument();
  });

  it("a document without figures still has its Figures view, which says there is none", async () => {
    show("", { figures: [] });
    await screen.findByText("Part §5.6");
    const views = screen.getByRole("tablist", { name: "Document views" });
    expect(within(views).getByRole("tab", { name: /^Figures/ })).toHaveTextContent("Figures0");
    expect(screen.getByText(/· 0 figures/)).toBeInTheDocument();
    fireEvent.click(within(views).getByRole("tab", { name: /^Figures/ }));
    expect(screen.getByText("No figure in this document")).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: "Remove Glossary" }));
    await waitFor(() => expect(named("docs.set")).toHaveLength(4));
    expect(named("docs.set")[2]?.input).toEqual({ id: "D1", context: "unsaved note", ifMtime: 42 });
    expect(named("docs.set")[3]?.input).toEqual({ id: "D1", contexts: [] });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove Glossary" })).toBeNull());
  });

  it("leaving a saved context out with the note untouched saves the list alone", async () => {
    api.routes["docs.set"] = (i) => ({ ...doc("D1"), ...(i as Partial<DocRef>), contextMtime: null });
    api.routes["contexts.list"] = () => [{ id: "glossary", name: "Glossary", shared: false }];
    show("", { contexts: ["glossary"] });
    fireEvent.click(await screen.findByRole("button", { name: "Remove Glossary" }));
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

  it("⋯ › Delete asks, then removes the document; Cancel leaves it, a failure stays in the dialog", async () => {
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete this document…" }));
    expect(await screen.findByText("No test cites it.")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: "Delete this document?" })).toHaveTextContent(/from the index/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(named("docs.remove").map((c) => c.input)).toEqual([{ id: "D1", dryRun: true }]);
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete this document…" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await within(screen.getByRole("alertdialog")).findByText(/locked/)).toBeInTheDocument();
    expect(onRemoved).not.toHaveBeenCalled();
    fail = false;
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled());
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
      passages: 6,
      dryRun: !!i.dryRun,
    });
    const { onRemoved } = show();
    await screen.findByRole("heading", { name: "Title D1" });
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete this document…" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    const list = await screen.findByRole("list", { name: "Tests that cite this document" });
    const dialog = screen.getByRole("alertdialog", { name: "Delete this document?" });
    const row = (text: RegExp) => within(dialog).getByText(text).closest("li");
    expect(row(/^tests cite it, 1 of them validated: they stay as they are/)).toHaveTextContent(/^10\s*tests cite/);
    expect(row(/^passages removed from the index, in every vector space$/)).toHaveTextContent(/^6\s*passages/);
    expect(row(/^folder deleted: the copy of x\.pdf, doc\.md, 0 figures and its Claude context$/)).toHaveTextContent(
      /^1\s*folder/,
    );
    expect(dialog).toHaveTextContent("C-D1 · Title D1 · 01.01");
    expect(dialog).toHaveTextContent(
      "This cannot be undone: to get it back, add x.pdf again (status and context start over).",
    );
    const counts = row(/^passages removed/)?.parentElement as HTMLElement;
    const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(counts, list)).toBe(true);
    expect(follows(list, within(dialog).getByText(/^This cannot be undone/))).toBe(true);
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete this document…" }));
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete this document…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete this document?" });
    await waitFor(() =>
      expect(
        within(dialog)
          .getByText(/^test cites it: they stay/)
          .closest("li"),
      ).toHaveTextContent(/^1\s*test/),
    );
    expect(
      within(dialog)
        .getByText(/^passages removed/)
        .closest("li"),
    ).toHaveTextContent(/^0\s*passages/);
    expect(dialog).toHaveTextContent("These documents amend it and will no longer name it: D2, D3");
  });

  it("puts the Claude action proposed for a conversion warning under it, and runs it in the dock", async () => {
    const action = (id: string, over: Record<string, unknown>) => ({
      id,
      title: `Fix ${id}`,
      scope: { kind: "doc", docId: "D1" },
      where: "doc:D1",
      problem: "2 comments dropped",
      why: "",
      plan: [],
      stamp: "",
      proposedBy: { run: "import", model: "", effort: "", at },
      state: "open",
      at,
      stale: false,
      target: { kind: "document", id: "D1", name: "Traction" },
      ...over,
    });
    api.routes["actions.list"] = (i) => {
      expect(i).toEqual({ docId: "D1" });
      return [
        action("a1", { problem: "another warning" }),
        action("a2", { state: "running" }),
        action("a3", { where: "doc:D2" }),
        action("a4", {}),
      ];
    };
    const runInDock = vi.fn();
    api.routes["docs.show"] = () => shown();
    mountDocs(<DocDetail id="D1" anchor="" onAnchor={vi.fn()} onRemoved={vi.fn()} />, { runInDock });
    const list = await screen.findByRole("list", { name: "Conversion warnings" });
    const run = await within(list).findByRole("button", { name: "Fix a4" });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    expect(within(list).getByText("on document « Traction »")).toBeInTheDocument();
    fireEvent.click(run);
    expect(runInDock).toHaveBeenCalledWith({ name: "actions.run", input: { id: "a4" }, label: "Fix a4", testId: "" });
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
