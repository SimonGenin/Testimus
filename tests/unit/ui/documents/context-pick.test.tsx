// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandOutput } from "../../../../src/core/commands/index.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { DocContext } from "../../../../src/ui/screens/documents/DocContext.tsx";
import { callsOf, dataWrapper, Fail, fakeNet, net } from "../../cov-uishell-helpers.tsx";

type Shown = CommandOutput<"docs.show">;

let titles: string[] = [];
let ids: number[] = [];
function Probe() {
  const t = useToasts();
  titles = t.map((x) => x.title);
  ids = t.map((x) => x.id);
  return null;
}

const CTX = [
  { id: "c-ops", name: "Operator positions", paths: [], files: [], hasNotes: true },
  { id: "c-sig", name: "Signalling glossary", paths: [], files: [], hasNotes: true },
];

beforeEach(() => {
  fakeNet();
  setProject("D:/p");
  net.routes["contexts.list"] = () => CTX;
  net.routes["docs.set"] = () => ({ contextMtime: 9 });
  net.routes["contexts.create"] = (i) => ({ id: "c-new", name: i.name, notes: i.notes, paths: [], files: [] });
});
afterEach(() => {
  cleanup();
  for (const id of ids) closeToast(id);
  vi.unstubAllGlobals();
});

const show = (shown: Partial<Shown>, disabled = false) =>
  render(
    <>
      <Probe />
      <DocContext
        id="D-1"
        shown={{ context: "", contextMtime: 5, contexts: [], ...shown } as Shown}
        disabled={disabled}
      />
    </>,
    { wrapper: dataWrapper() },
  );

describe("the saved contexts a document is read with", () => {
  it("shows each one by its name, or its id while the names are not known", async () => {
    show({ contexts: ["c-ops", "c-old"] });
    expect(await screen.findByRole("button", { name: "Operator positions" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "c-old" })).toBeInTheDocument();
  });

  it("switching a context off leaves it out of the document", async () => {
    show({ contexts: ["c-ops", "c-sig"] });
    fireEvent.click(await screen.findByRole("button", { name: "Operator positions" }));
    await waitFor(() => expect(callsOf("docs.set")).toHaveLength(1));
    expect(callsOf("docs.set")[0].input).toEqual({ id: "D-1", contexts: ["c-sig"] });
  });

  it("« Use a saved context… » picks the document's contexts", async () => {
    show({ contexts: [] });
    fireEvent.click(screen.getByRole("button", { name: "Use a saved context…" }));
    const dialog = screen.getByRole("dialog", { name: "Saved contexts" });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Signalling glossary/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Use 1" }));
    await waitFor(() => expect(callsOf("docs.set")[0]?.input).toEqual({ id: "D-1", contexts: ["c-sig"] }));
    expect(screen.queryByRole("dialog", { name: "Saved contexts" })).toBeNull();
  });

  it("« Manage contexts… » swaps the picker for the contexts manager, which closes back to the document", async () => {
    show({ contexts: [] });
    fireEvent.click(screen.getByRole("button", { name: "Use a saved context…" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Saved contexts" })).getByRole("button", { name: "Manage contexts…" }),
    );
    const manager = await screen.findByRole("dialog", { name: "Contexts" });
    expect(screen.queryByRole("dialog", { name: "Saved contexts" })).toBeNull();
    fireEvent.keyDown(manager, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Contexts" })).toBeNull());
    expect(callsOf("docs.set")).toHaveLength(0);
  });

  it("saves the note as a context: the document then takes it and its note is emptied", async () => {
    show({ context: "Les positions de l'opérateur", contexts: ["c-ops"] });
    fireEvent.click(screen.getByRole("button", { name: "Save as context…" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Save as context" })).getByRole("button", { name: "Save" }),
    );
    await waitFor(() => expect(callsOf("docs.set")).toHaveLength(1));
    expect(callsOf("docs.set")[0].input).toEqual({ id: "D-1", contexts: ["c-ops", "c-new"], context: "" });
  });

  it("cannot save an empty note as a context, nor use contexts while disabled", () => {
    show({ context: "  " });
    expect(screen.getByRole("button", { name: "Save as context…" })).toBeDisabled();
    expect(screen.getByText("Write a note first")).toBeInTheDocument();
    cleanup();
    show({ context: "x" }, true);
    expect(screen.getByRole("button", { name: "Use a saved context…" })).toBeDisabled();
  });

  it("says when the document could not take the contexts", async () => {
    net.routes["docs.set"] = () => {
      throw new Fail("doc.json is locked");
    };
    show({ contexts: ["c-ops"] });
    fireEvent.click(await screen.findByRole("button", { name: "Operator positions" }));
    await waitFor(() => expect(titles).toContain("Could not save the document"));
  });
});
