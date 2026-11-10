// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaFile } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DocumentsScreen } from "../../../../src/ui/screens/documents/DocumentsScreen.tsx";
import { api, FakeEventSource, fakeFetch, named, noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { type DocRef, doc, mountDocs } from "./helpers.tsx";

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

const file = (n: number, kind: MediaFile["kind"], over: Partial<MediaFile> = {}): MediaFile => ({
  n,
  name: kind === "image" ? `IMG_00${40 + n}.jpg` : "manoeuvre.mp4",
  file: `files/f${n}`,
  kind,
  sha256: "x",
  state: "analysed",
  ...(kind === "image" ? { figure: `figures/img-${n}.jpg`, takenAt: "2026-10-12T14:03:10" } : { duration: 160 }),
  ...over,
});
const images = (over: Partial<DocRef> = {}) =>
  doc("PHOTOS", {
    title: "Recette TCO",
    kind: "other",
    type: "images",
    observed: !over.reference,
    source: {
      type: "images",
      name: "IMG_0041.jpg",
      file: "files",
      sha256: "",
      files: [file(1, "image"), file(2, "image")],
    },
    ...over,
  });
const video = doc("FILM", {
  title: "Manœuvre au PCC",
  kind: "other",
  type: "video",
  observed: true,
  source: { type: "video", name: "manoeuvre.mp4", file: "files", sha256: "", files: [file(1, "video")] },
});
const text = doc("NOTES", {
  title: "Notes de réunion",
  type: "txt",
  source: { name: "notes.txt", file: "source.txt", sha256: "" },
});

const listOf = () => screen.getByRole("region", { name: "Document list" });
const row = (title: string) => within(listOf()).getByText(title).closest('[role="option"]') as HTMLElement;

const shown = (d: DocRef) => {
  api.routes["docs.show"] = (i) =>
    i.anchor
      ? { md: "", section: "§media" }
      : {
          doc: d,
          type: d.type,
          observed: d.observed,
          context: "",
          contextMtime: null,
          contexts: [],
          toc: [{ anchor: "§media", title: d.title, level: 0 }],
          figures: [],
          md: "",
        };
};
const pictures = {
  doc: "PHOTOS",
  type: "images",
  observed: true,
  videos: [],
  images: [
    {
      ...file(1, "image"),
      anchor: "img:1",
      caption: "IMG_0041.jpg — 2026-10-12 14:03",
      description: "Le TCO de la ligne 3.",
      labels: ["S12"],
    },
    { ...file(2, "image"), anchor: "img:2", caption: "IMG_0042.jpg — 2026-10-12 14:03", description: "", labels: [] },
  ],
};

describe("images, videos and text files are documents", () => {
  it("the list says what each document is, and Observed for images and videos of the real system", async () => {
    api.routes["docs.list"] = () => [images(), video, text, images({ id: "REF", title: "Référence", reference: true })];
    shown(images());
    mountDocs(<DocumentsScreen />);
    await screen.findByText("Recette TCO");
    expect(within(row("Recette TCO")).getByText("Images · 2")).toBeInTheDocument();
    expect(within(row("Recette TCO")).getByText("Observed")).toBeInTheDocument();
    expect(within(row("Manœuvre au PCC")).getByText("Video · 02:40")).toBeInTheDocument();
    expect(within(row("Manœuvre au PCC")).getByText("Observed")).toBeInTheDocument();
    expect(within(row("Notes de réunion")).getByText("Text")).toBeInTheDocument();
    expect(within(row("Notes de réunion")).queryByText("Observed")).toBeNull();
    expect(within(row("Référence")).queryByText("Observed")).toBeNull();
  });

  it("two images picked together ask whether they are one document or one each", async () => {
    api.routes["docs.list"] = () => [text];
    shown(text);
    api.routes["docs.addFiles"] = () => ({ added: [], rejected: [] });
    const { container } = mountDocs(<DocumentsScreen />);
    await screen.findByText("Notes de réunion");
    const zone = container.querySelector('[data-testid="documents-screen"]') as HTMLElement;
    const drop = () =>
      fireEvent.drop(zone, {
        dataTransfer: {
          files: [new File(["a"], "IMG_1.jpg"), new File(["b"], "IMG_2.png"), new File(["c"], "spec.pdf")],
        },
      });
    drop();
    const dialog = await screen.findByRole("dialog", { name: "Add 2 images" });
    expect(within(dialog).getByRole("radio", { name: /One document with the 2 images/ })).toBeChecked();
    const title = within(dialog).getByRole("textbox", { name: "Title" });
    fireEvent.change(title, { target: { value: "Visite du PCC" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add one document" }));
    await waitFor(() => expect(named("docs.addFiles")).toHaveLength(1));
    const first = named("docs.addFiles")[0].input as { files: { name: string }[]; images: string; title: string };
    expect(first.images).toBe("together");
    expect(first.title).toBe("Visite du PCC");
    expect(first.files.map((f) => f.name)).toEqual(["IMG_1.jpg", "IMG_2.png", "spec.pdf"]);
    drop();
    const again = await screen.findByRole("dialog", { name: "Add 2 images" });
    fireEvent.click(within(again).getByRole("radio", { name: /One document per image/ }));
    expect(within(again).queryByRole("textbox", { name: "Title" })).toBeNull();
    fireEvent.click(within(again).getByRole("button", { name: "Add 2 documents" }));
    await waitFor(() => expect(named("docs.addFiles")).toHaveLength(2));
    expect(named("docs.addFiles")[1].input).toMatchObject({ images: "each" });
  });

  it("an images document opens on its pictures: each with its anchor and what Claude saw, one opened large", async () => {
    api.routes["docs.list"] = () => [images()];
    shown(images());
    api.routes["media.show"] = () => pictures;
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "PHOTOS" } });
    const grid = await screen.findByRole("list", { name: "Images" });
    expect(screen.getByRole("tab", { name: /Images/ })).toHaveAttribute("aria-selected", "true");
    expect(within(grid).getByText("img:1")).toBeInTheDocument();
    expect(within(grid).getByText("Le TCO de la ligne 3.")).toBeInTheDocument();
    expect(within(grid).getByText("Not read by Claude yet")).toBeInTheDocument();
    expect(screen.getByText(/2 images · taken 2026-10-12 · read by Claude/)).toBeInTheDocument();
    fireEvent.click(within(grid).getByRole("button", { name: /img:1/ }));
    const large = await screen.findByRole("dialog", { name: "IMG_0041.jpg" });
    expect(within(large).getByText("PHOTOS#img:1")).toBeInTheDocument();
    expect(within(large).getByText("Text in the picture: S12")).toBeInTheDocument();
    fireEvent.click(within(large).getByRole("button", { name: "Remove from the document…" }));
    const ask = await screen.findByRole("alertdialog", { name: "Remove IMG_0041.jpg from the document?" });
    api.routes["media.remove"] = () => ({
      doc: "PHOTOS",
      added: [],
      rejected: [],
      files: [],
      warnings: [],
      citedBy: [],
    });
    fireEvent.click(within(ask).getByRole("button", { name: "Remove the image" }));
    await waitFor(() => expect(named("media.remove")[0]?.input).toEqual({ doc: "PHOTOS", n: 1, index: true }));
  });

  it("the team marks an images document as the reference, and back to observed", async () => {
    api.routes["docs.list"] = () => [images()];
    shown(images());
    api.routes["media.show"] = () => pictures;
    api.routes["docs.set"] = (i) => ({ ...images(), reference: i.reference, contextMtime: null });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "PHOTOS" } });
    fireEvent.click(await screen.findByRole("button", { name: "Reference, not observed" }));
    await waitFor(() => expect(named("docs.set")[0]?.input).toEqual({ id: "PHOTOS", reference: true }));
    expect(await screen.findByRole("button", { name: "Observed, not the reference" })).toBeInTheDocument();
  });

  it("images are added to an images document, never to a video: a video is a document of its own", async () => {
    api.routes["docs.list"] = () => [images(), video];
    shown(images());
    api.routes["media.show"] = () => pictures;
    const page = mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "PHOTOS" } });
    expect(await screen.findByRole("button", { name: "Add images…" })).toBeInTheDocument();
    page.unmount();
    shown(video);
    api.routes["media.show"] = () => ({ doc: "FILM", type: "video", observed: true, videos: [], images: [] });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    expect(await screen.findByRole("button", { name: "Reference, not observed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add images…" })).toBeNull();
  });
});
