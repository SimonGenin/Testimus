// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandOutput } from "../../../../src/core/commands/index.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { DocContext } from "../../../../src/ui/screens/documents/DocContext.tsx";
import { type Piece, piece, previewOf } from "../../helpers/fake-preview.ts";
import { callsOf, dataWrapper, Fail, fakeNet, net } from "../../helpers/ui-data.tsx";

type Shown = CommandOutput<"docs.show">;

let titles: string[] = [];
let ids: number[] = [];
function Probe() {
  const t = useToasts();
  titles = t.map((x) => x.title);
  ids = t.map((x) => x.id);
  return null;
}

const SAVED = [
  { id: "c-ops", name: "Operator positions" },
  { id: "c-sig", name: "Signalling glossary" },
];

// ponytail: the document's own list as the server holds it — docs.set writes it, claude.preview says it back
let own: string[] = [];
let extra: Piece[] = [];
const given = () => [
  piece("instruction", "Ask Claude on a document"),
  piece("overview", "How the documents fit together"),
  ...SAVED.map((c) =>
    piece(`context:${c.id}`, c.name, { on: own.includes(c.id), why: "Attached to the document D-1" }),
  ),
  ...extra.map((p) => ({ ...p, on: own.includes(p.id.slice("context:".length)) })),
  piece("doc:D-1", "Spécifications J5", { why: "A document of this run" }),
];

beforeEach(() => {
  fakeNet();
  setProject("D:/p");
  own = [];
  extra = [];
  net.routes["claude.preview"] = (i) => previewOf(given(), i);
  net.routes["docs.set"] = (i) => {
    if (Array.isArray(i.contexts)) own = i.contexts as string[];
    return { contextMtime: 9 };
  };
  net.routes["contexts.create"] = (i) => {
    extra.push(piece("context:c-new", String(i.name)));
    return { id: "c-new", name: i.name, notes: i.notes, paths: [], files: [] };
  };
});
afterEach(() => {
  cleanup();
  for (const id of ids) closeToast(id);
  vi.unstubAllGlobals();
});

const show = (shown: Partial<Shown>, disabled = false) => {
  own = shown.contexts ?? [];
  return render(
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
};

const context = () => screen.getByRole("button", { name: /^Context/ });
const graph = async () => {
  fireEvent.click(context());
  const dialog = await screen.findByRole("dialog", { name: "Context" });
  await within(dialog).findByRole("group", { name: "What Claude is given" });
  return dialog;
};
const box = (dialog: HTMLElement, name: string) => within(dialog).getByRole("checkbox", { name });
const sets = () => callsOf("docs.set").map((c) => c.input);

describe("the saved contexts a document is read with", () => {
  it("the note's Context says what a run on this document is given, its saved contexts ticked by name", async () => {
    show({ contexts: ["c-ops"] });
    await waitFor(() => expect(context()).toHaveTextContent(/^Context4$/));
    expect(callsOf("claude.preview")[0].input).toEqual({ use: "ask-doc", scope: { kind: "doc", docId: "D-1" } });
    const dialog = await graph();
    expect(dialog).toHaveAccessibleDescription(
      "What Claude is given in every run on this document. The saved contexts ticked here go with all of them.",
    );
    expect(dialog).toHaveTextContent("The ticked contexts are kept for every run on this document.");
    expect(box(dialog, "Operator positions")).toBeChecked();
    expect(box(dialog, "Operator positions").closest("li")).toHaveTextContent("Attached to the document D-1");
    expect(box(dialog, "Signalling glossary")).not.toBeChecked();
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(2);
    for (const name of ["How the documents fit together", "Spécifications J5"]) {
      fireEvent.click(within(dialog).getByText(name, { selector: "li *" }));
      expect(within(dialog).getByRole("article", { name })).toHaveTextContent(
        "ChosenFor each run, where you write to Claude",
      );
    }
    expect(screen.queryByRole("button", { name: "Add context" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("unticking a context leaves it out of the document", async () => {
    show({ contexts: ["c-ops", "c-sig"] });
    const dialog = await graph();
    fireEvent.click(box(dialog, "Operator positions"));
    await waitFor(() => expect(sets()).toHaveLength(1));
    expect(sets()[0]).toEqual({ id: "D-1", contexts: ["c-sig"] });
    await waitFor(() => expect(box(dialog, "Operator positions")).not.toBeChecked());
    expect(box(dialog, "Signalling glossary")).toBeChecked();
    await waitFor(() => expect(context()).toHaveTextContent(/^Context4$/));
  });

  it("ticking a saved context puts it in the document's list, with the ones it had", async () => {
    show({ contexts: ["c-ops"] });
    const dialog = await graph();
    fireEvent.click(box(dialog, "Signalling glossary"));
    await waitFor(() => expect(sets()[0]).toEqual({ id: "D-1", contexts: ["c-ops", "c-sig"] }));
    await waitFor(() => expect(box(dialog, "Signalling glossary")).toBeChecked());
    expect(within(dialog).queryByRole("button", { name: "Back to the defaults" })).toBeNull();
  });

  it("« Edit » opens a saved context's editor, which closes back to the graph and changes nothing of the document", async () => {
    net.routes["contexts.show"] = () => ({
      id: "c-ops",
      name: "Operator positions",
      notes: "PCC, PCL",
      paths: [],
      files: [],
      hasNotes: true,
    });
    show({ contexts: ["c-ops"] });
    const dialog = await graph();
    fireEvent.click(
      within(within(dialog).getByRole("article", { name: "Operator positions" })).getByRole("button", { name: "Edit" }),
    );
    const editor = await screen.findByRole("dialog", { name: "Edit the context" });
    expect(await within(editor).findByRole("textbox", { name: /^Name/ })).toHaveValue("Operator positions");
    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit the context" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "Context" })).toBeInTheDocument();
    expect(sets()).toHaveLength(0);
  });

  it("saves the note (the box's text) as a context: the document then takes it and its note is emptied", async () => {
    show({ context: "Les positions de l'opérateur", contexts: ["c-ops"] });
    const dialog = await graph();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save the text as a context…" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Save as context" })).getByRole("button", { name: "Save" }),
    );
    await waitFor(() => expect(sets()).toHaveLength(2));
    expect(callsOf("contexts.create")[0].input).toMatchObject({
      name: "Les positions de l'opérateur",
      notes: "Les positions de l'opérateur",
    });
    expect(sets()).toEqual([
      { id: "D-1", contexts: ["c-ops", "c-new"] },
      { id: "D-1", context: "" },
    ]);
    await waitFor(() => expect(box(dialog, "Les positions de l'opérateur")).toBeChecked());
  });

  it("cannot save an empty note as a context, nor open the Context while disabled", async () => {
    show({ context: "  " });
    const dialog = await graph();
    expect(within(dialog).getByRole("button", { name: "Save the text as a context…" })).toBeDisabled();
    cleanup();
    show({ context: "x", contexts: ["c-ops"] }, true);
    expect(context()).toBeDisabled();
    expect(screen.queryByRole("dialog", { name: "Context" })).toBeNull();
  });

  it("says when the document could not take the contexts", async () => {
    net.routes["docs.set"] = () => {
      throw new Fail("doc.json is locked");
    };
    show({ contexts: ["c-ops"] });
    const dialog = await graph();
    fireEvent.click(box(dialog, "Operator positions"));
    await waitFor(() => expect(titles).toContain("Could not save the document"));
    expect(box(dialog, "Operator positions")).toBeChecked();
  });
});

// ponytail: the project a call went to (its X-Testimus-Project header)
const sentTo = (path: string) =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([u]) => String(u).includes(path))
    .map(([, init]) =>
      decodeURIComponent(((init?.headers ?? {}) as Record<string, string>)["X-Testimus-Project"] ?? ""),
    );

describe("the note of a document", () => {
  it("typed in one project is written to that project, never to the next one", async () => {
    const r = show({});
    fireEvent.change(screen.getByLabelText("Note for this document"), { target: { value: "for p" } });
    setProject("D:/other");
    r.unmount();
    await waitFor(() => expect(callsOf("docs.set")).toHaveLength(1));
    expect(callsOf("docs.set")[0].input).toMatchObject({ id: "D-1", context: "for p" });
    expect(sentTo("/docs/set")).toEqual(["D:/p"]);
  });
});
