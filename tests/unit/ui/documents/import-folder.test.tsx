// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DocumentsScreen } from "../../../../src/ui/screens/documents/DocumentsScreen.tsx";
import { api, FakeEventSource, fakeDesktop, fakeFetch, named, noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { doc, mountDocs, refuse, startsJob } from "./helpers.tsx";

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

const file = (rel: string, over: Record<string, unknown> = {}) => ({
  path: `/c/J5/${rel}`,
  rel,
  size: 10,
  importable: true,
  ...over,
});

const scan = (dir: string) => ({
  dir,
  recursive: true,
  files: [
    file("A_01_00.docx", { id: "A", twin: "A_01_00.pdf" }),
    file("A_01_00.pdf", { importable: false, reason: "twin", why: "the rendering of A_01_00.docx, added with it" }),
    file("B.pdf", { id: "B" }),
    file("C_01_00.docx", { importable: false, id: "C", reason: "in-project", why: "already in the project" }),
    file("Thumbs.db", { importable: false, reason: "not-a-document", why: "not a document" }),
    file("~$A_01_00.docx", { importable: false, reason: "lock-file", why: "Word's lock file" }),
  ],
  documents: 2,
  leftAside: 2,
  truncated: false,
});

function serve() {
  api.routes["docs.list"] = () => [doc("C")];
  api.routes["rag.status"] = () => ({});
  api.routes["docs.show"] = () => ({ doc: doc("C"), context: "", toc: [], figures: [], md: "" });
  api.routes["contexts.list"] = () => [];
  api.routes["docs.scanFolder"] = (i) => scan(String(i.dir));
  api.routes["docs.addFolder"] = startsJob("add-1", "docs.add", "J5");
}

describe("Import a folder", () => {
  it("the images of one folder are one document, a video and a text file one each", async () => {
    serve();
    api.routes["docs.scanFolder"] = (i) => ({
      dir: String(i.dir),
      recursive: true,
      files: [
        file("Notes.txt", { id: "Notes" }),
        file("PCC/IMG_1.jpg", { id: "PCC", group: "PCC" }),
        file("PCC/IMG_2.jpg", { id: "PCC", group: "PCC" }),
        file("PCC/film.mp4", { id: "film" }),
      ],
      documents: 3,
      leftAside: 0,
      truncated: false,
    });
    mountDocs(<DocumentsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Import a folder…" }));
    const dialog = await screen.findByRole("dialog", { name: "Import a folder" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder" }), { target: { value: "/c/J5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Read the folder" }));
    const pcc = await within(dialog).findByRole("checkbox", { name: "2 images from PCC" });
    expect(pcc).toBeChecked();
    expect(within(dialog).getByText("one images document")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Notes.txt" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "PCC/film.mp4" })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Notes.txt" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Import 2 documents" }));
    await waitFor(() =>
      expect(named("docs.addFolder")[0]?.input).toMatchObject({
        files: ["PCC/IMG_1.jpg", "PCC/IMG_2.jpg", "PCC/film.mp4"],
      }),
    );
  });

  it("in a browser the folder is typed; its documents are ticked, the rest left aside with the reason; the ticked ones are imported", async () => {
    serve();
    mountDocs(<DocumentsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Import a folder…" }));
    const dialog = await screen.findByRole("dialog", { name: "Import a folder" });
    expect(within(dialog).getByRole("button", { name: "Read the folder" })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder" }), { target: { value: "/c/J5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Read the folder" }));
    await waitFor(() => expect(named("docs.scanFolder")[0]?.input).toEqual({ dir: "/c/J5", recursive: true }));
    expect(
      await within(dialog).findByText(
        "6 files found (sub-folders included) · 2 can be imported · 1 already in the project · 2 left aside",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "A_01_00.docx" })).toBeChecked();
    expect(within(dialog).getByText("+ the .pdf of the same name, as its twin")).toBeInTheDocument();
    expect(within(dialog).queryByText("A_01_00.pdf")).toBeNull();
    const there = within(dialog).getByRole("checkbox", { name: "C_01_00.docx" });
    expect(there).not.toBeChecked();
    expect(there).toBeDisabled();
    expect(within(dialog).getByText("Already in the project")).toBeInTheDocument();
    expect(within(dialog).getByText("Left aside · 2")).toBeInTheDocument();
    expect(within(dialog).getByText("Word's lock file")).toBeInTheDocument();
    expect(within(dialog).getByText("not a document")).toBeInTheDocument();
    expect(within(dialog).getByText("Copied, converted, then indexed in the background.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "B.pdf" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Import 1 document" }));
    await waitFor(() =>
      expect(named("docs.addFolder")[0]?.input).toEqual({
        dir: "/c/J5",
        recursive: true,
        files: ["A_01_00.docx"],
        triage: true,
        index: true,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import a folder" })).toBeNull());
    expect(await screen.findByText("Importing 1 document — started")).toBeInTheDocument();
  });

  it("in the desktop app the folder comes from the folder dialog, and a refused path says why", async () => {
    serve();
    fakeDesktop({ folder: "/c/J5" });
    mountDocs(<DocumentsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Import a folder…" }));
    const dialog = await screen.findByRole("dialog", { name: "Import a folder" });
    expect(within(dialog).queryByRole("textbox", { name: "Folder" })).toBeNull();
    expect(await within(dialog).findByText("/c/J5")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Import 2 documents" })).toBeInTheDocument();
    cleanup();

    noDesktop();
    serve();
    refuse("docs.scanFolder", () => true, { error: "A network path (\\\\server\\share) is not read." });
    mountDocs(<DocumentsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Import a folder…" }));
    const again = await screen.findByRole("dialog", { name: "Import a folder" });
    fireEvent.change(within(again).getByRole("textbox", { name: "Folder" }), { target: { value: "\\\\srv\\s" } });
    fireEvent.click(within(again).getByRole("button", { name: "Read the folder" }));
    expect(await within(again).findByText(/A network path/)).toBeInTheDocument();
    expect(named("docs.addFolder")).toHaveLength(0);
  });
});
