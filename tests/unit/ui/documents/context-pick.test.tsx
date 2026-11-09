// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandOutput } from "../../../../src/core/commands/index.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { DocContext } from "../../../../src/ui/screens/documents/DocContext.tsx";
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
  it("shows each one by its name, or its id while the names are not known, each removable", async () => {
    show({ contexts: ["c-ops", "c-old"] });
    expect(await screen.findByText("Operator positions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Operator positions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove c-old" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Operator positions", pressed: true })).toBeNull();
  });

  it("removing a context leaves it out of the document", async () => {
    show({ contexts: ["c-ops", "c-sig"] });
    fireEvent.click(await screen.findByRole("button", { name: "Remove Operator positions" }));
    await waitFor(() => expect(callsOf("docs.set")).toHaveLength(1));
    expect(callsOf("docs.set")[0].input).toEqual({ id: "D-1", contexts: ["c-sig"] });
  });

  it("« + » ticks a saved context in or out of the document, as in Generate", async () => {
    show({ contexts: ["c-ops"] });
    fireEvent.click(screen.getByRole("button", { name: "Add context" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: /Operator positions/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Signalling glossary/ }));
    await waitFor(() => expect(callsOf("docs.set")[0]?.input).toEqual({ id: "D-1", contexts: ["c-ops", "c-sig"] }));
  });

  it("« Manage contexts… » opens the contexts manager, which closes back to the document", async () => {
    show({ contexts: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add context" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Manage contexts…" }));
    const manager = await screen.findByRole("dialog", { name: "Contexts" });
    fireEvent.keyDown(manager, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Contexts" })).toBeNull());
    expect(callsOf("docs.set")).toHaveLength(0);
  });

  it("saves the note (the box's text) as a context: the document then takes it and its note is emptied", async () => {
    show({ context: "Les positions de l'opérateur", contexts: ["c-ops"] });
    fireEvent.click(screen.getByRole("button", { name: "Add context" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Save the text as a context…" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Save as context" })).getByRole("button", { name: "Save" }),
    );
    await waitFor(() => expect(callsOf("docs.set")).toHaveLength(1));
    expect(callsOf("docs.set")[0].input).toEqual({ id: "D-1", contexts: ["c-ops", "c-new"], context: "" });
  });

  it("cannot save an empty note as a context, nor change the contexts while disabled", async () => {
    show({ context: "  " });
    fireEvent.click(screen.getByRole("button", { name: "Add context" }));
    expect(await screen.findByRole("menuitem", { name: "Save the text as a context…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    cleanup();
    show({ context: "x", contexts: ["c-ops"] }, true);
    expect(screen.getByRole("button", { name: "Add context" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove c-ops" })).toBeDisabled();
  });

  it("says when the document could not take the contexts", async () => {
    net.routes["docs.set"] = () => {
      throw new Fail("doc.json is locked");
    };
    show({ contexts: ["c-ops"] });
    fireEvent.click(await screen.findByRole("button", { name: "Remove Operator positions" }));
    await waitFor(() => expect(titles).toContain("Could not save the document"));
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
