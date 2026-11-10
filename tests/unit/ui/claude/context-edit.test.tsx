// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { ContextEdit } from "../../../../src/ui/components/claude/ContextEdit.tsx";
import { contextLine } from "../../../../src/ui/components/claude/contexts.ts";
import { Toaster } from "../../../../src/ui/components/ui/Toast.tsx";
import { useRead } from "../../../../src/ui/lib/data/query.ts";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { callsOf, dataWrapper, deferred, Fail, fakeNet, net } from "../../helpers/ui-data.tsx";
import { fakeDesktop, noDesktop } from "../../helpers/ui-desktop.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

let ids: number[] = [];
function Probe() {
  ids = useToasts().map((t) => t.id);
  useRead("contexts.ofProject", {});
  useRead("claude.preview", { use: "ask-test" });
  return <Toaster />;
}

type Ctx = { id: string; name: string; notes: string; paths: string[]; files: string[]; shared?: boolean };
let store: Ctx[] = [];
let fail: Set<string> = new Set();

const summary = (c: Ctx) => ({
  id: c.id,
  name: c.name,
  paths: c.paths,
  files: c.files,
  hasNotes: !!c.notes,
  shared: !!c.shared,
});
const find = (id: unknown) => {
  const c = store.find((x) => x.id === id);
  if (!c) throw new Fail(`No context ${id}`);
  return c;
};
const guard = (name: string) => {
  if (fail.has(name)) throw new Fail(`${name} broke`);
};

function backend(initial: Ctx[]) {
  store = initial.map((c) => ({ ...c }));
  fail = new Set();
  net.routes["contexts.ofProject"] = () => ({ effective: [] });
  net.routes["claude.preview"] = () => ({ use: "ask-test", kind: "run", name: "", answers: "", pieces: [] });
  net.routes["contexts.show"] = (i) => {
    guard("contexts.show");
    return { ...summary(find(i.id)), notes: find(i.id).notes };
  };
  net.routes["contexts.set"] = (i) => {
    guard("contexts.set");
    const c = find(i.id);
    if (typeof i.name === "string") c.name = i.name;
    if (typeof i.notes === "string") c.notes = i.notes;
    if (Array.isArray(i.paths)) c.paths = i.paths as string[];
    return { ...summary(c), notes: c.notes };
  };
  net.routes["contexts.share"] = (i) => {
    guard("contexts.share");
    const c = find(i.id);
    c.shared = i.shared === true;
    return { ...summary(c), notes: c.notes };
  };
  net.routes["contexts.addFile"] = (i) => {
    guard("contexts.addFile");
    const c = find(i.id);
    c.files = [...c.files, String(i.name)];
    return { ...summary(c), notes: c.notes };
  };
  net.routes["contexts.removeFile"] = (i) => {
    guard("contexts.removeFile");
    const c = find(i.id);
    c.files = c.files.filter((f) => f !== i.name);
    return { ...summary(c), notes: c.notes };
  };
  net.routes["contexts.remove"] = (i) => {
    guard("contexts.remove");
    store = store.filter((c) => c.id !== i.id);
    return null;
  };
}

const glossary: Ctx = { id: "glossary", name: "Glossaire", notes: "SOSIE = ...", paths: ["D:\\Specs"], files: [] };
const bare: Ctx = { id: "bare", name: "", notes: "", paths: [], files: ["plan.pdf"] };

// ponytail: the readers of the contexts outside the editor (a test's or the project's list, the graph of a request)
// read again after each change
const changes = () => callsOf("contexts.ofProject").length - 1;
const graphs = () => callsOf("claude.preview").length - 1;

beforeEach(() => {
  fakeNet();
});

afterEach(() => {
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  cleanup();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
});

function mount(id = "glossary") {
  const close = vi.fn();
  const r = render(
    <>
      <ContextEdit id={id} onClose={close} />
      <Probe />
    </>,
  );
  return { ...r, close };
}

const editor = () => screen.getByRole("dialog", { name: "Edit the context" });
const nameBox = () => screen.getByLabelText(/^Name/);
const notesBox = () => screen.getByLabelText(/^Notes/);

describe("contextLine", () => {
  it("sums up what a context holds", () => {
    expect(contextLine({ files: [], paths: [], hasNotes: false })).toBe("empty");
    expect(contextLine({ files: ["a", "b"], paths: ["p"], hasNotes: true })).toBe("2 files · 1 path · notes");
  });
});

describe("ContextEdit: one saved context, edited where it is ticked", () => {
  it("opens the asked context — its name, notes, paths and files — and says where it is kept", async () => {
    backend([glossary, bare]);
    const a = mount();
    await waitFor(() => expect(nameBox()).toHaveValue("Glossaire"));
    expect(callsOf("contexts.show")[0].input).toEqual({ id: "glossary" });
    expect(editor()).toHaveAccessibleDescription("Notes, files and folders Claude reads before it works.");
    expect(notesBox()).toHaveValue("SOSIE = ...");
    expect(within(editor()).getByText("D:\\Specs")).toBeInTheDocument();
    expect(within(editor()).getByText("In this project")).toBeInTheDocument();
    expect(within(editor()).queryByText("· deleted for every project")).toBeNull();
    fireEvent.click(within(editor()).getByRole("button", { name: "Done" }));
    expect(a.close).toHaveBeenCalledTimes(1);
    a.unmount();
    mount("bare");
    await waitFor(() => expect(within(editor()).getByText("plan.pdf")).toBeInTheDocument());
    expect(nameBox()).toHaveValue("");
  });

  it("saves the name and the notes together, after a pause and on blur; what lists the contexts reads again", async () => {
    backend([glossary]);
    mount();
    await waitFor(() => expect(nameBox()).toHaveValue("Glossaire"));
    fireEvent.change(nameBox(), { target: { value: "Lexique" } });
    expect(callsOf("contexts.set")).toHaveLength(0);
    await waitFor(() => expect(callsOf("contexts.set")).toHaveLength(1), { timeout: 1500 });
    expect(callsOf("contexts.set")[0].input).toEqual({ id: "glossary", name: "Lexique", notes: "SOSIE = ..." });
    await waitFor(() => expect(changes()).toBe(1));
    await waitFor(() => expect(graphs()).toBe(1));
    fireEvent.change(notesBox(), { target: { value: "Nouvelles notes" } });
    fireEvent.blur(notesBox());
    await waitFor(() => expect(callsOf("contexts.set")).toHaveLength(2));
    expect(callsOf("contexts.set")[1].input).toEqual({ id: "glossary", name: "Lexique", notes: "Nouvelles notes" });
    expect(store[0]).toMatchObject({ name: "Lexique", notes: "Nouvelles notes" });
  });

  it("saves pending text when it closes", async () => {
    backend([glossary]);
    const { unmount } = mount();
    await waitFor(() => expect(nameBox()).toHaveValue("Glossaire"));
    fireEvent.change(notesBox(), { target: { value: "dernier mot" } });
    unmount();
    await waitFor(() => expect(store[0].notes).toBe("dernier mot"));
  });

  it("writes text typed in one project to that project, never to the next one", async () => {
    setProject("C:\\p");
    backend([glossary]);
    const { unmount } = mount();
    await waitFor(() => expect(nameBox()).toHaveValue("Glossaire"));
    fireEvent.change(notesBox(), { target: { value: "pour p" } });
    setProject("C:\\other");
    unmount();
    await waitFor(() => expect(store[0].notes).toBe("pour p"));
    const sent = vi
      .mocked(fetch)
      .mock.calls.filter(([u]) => String(u).includes("/contexts/set"))
      .map(([, init]) =>
        decodeURIComponent(((init?.headers ?? {}) as Record<string, string>)["X-Testimus-Project"] ?? ""),
      );
    expect(sent).toEqual(["C:\\p"]);
  });

  it("adds and removes paths, keeping the typed name and notes", async () => {
    backend([glossary]);
    mount();
    await waitFor(() => expect(nameBox()).toHaveValue("Glossaire"));
    const box = screen.getByLabelText("Path to add");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Browse folder/ })).toBeNull();
    fireEvent.change(box, { target: { value: "  D:\\Specs  " } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.keyDown(box, { key: "a" });
    await act(async () => {});
    expect(callsOf("contexts.set")).toHaveLength(0);
    fireEvent.change(box, { target: { value: "D:\\J5" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("D:\\J5")).toBeInTheDocument());
    expect(callsOf("contexts.set")[0].input).toEqual({ id: "glossary", paths: ["D:\\Specs", "D:\\J5"] });
    expect(box).toHaveValue("");
    fireEvent.change(nameBox(), { target: { value: "Typed" } });
    fireEvent.change(box, { target: { value: "D:\\K" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByText("D:\\K")).toBeInTheDocument());
    expect(nameBox()).toHaveValue("Typed");
    fireEvent.click(screen.getByRole("button", { name: "Remove path D:\\Specs" }));
    await waitFor(() => expect(screen.queryByText("D:\\Specs")).toBeNull());
    expect(store[0].paths).toEqual(["D:\\J5", "D:\\K"]);
    fail.add("contexts.set");
    fireEvent.click(screen.getByRole("button", { name: "Remove path D:\\K" }));
    expect(await screen.findByText("Could not remove the path")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "D:\\L" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Could not add the path")).toBeInTheDocument();
  });

  it("browses for a folder in the desktop shell", async () => {
    const d = fakeDesktop({ folder: "C:\\Picked" });
    backend([glossary]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Browse folder/ }));
    await waitFor(() => expect(screen.getByText("C:\\Picked")).toBeInTheDocument());
    d.pickFolder.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: /Browse folder/ }));
    await waitFor(() => expect(d.pickFolder).toHaveBeenCalledTimes(2));
    expect(store[0].paths).toEqual(["D:\\Specs", "C:\\Picked"]);
  });

  it("copies files in, one by one, and removes them", async () => {
    backend([glossary]);
    mount();
    await waitFor(() => expect(nameBox()).toHaveValue("Glossaire"));
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: /Add files/ }));
    expect(click).toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [] } });
    fireEvent.change(input, {
      target: { files: [new File(["abc"], "a.png", { type: "image/png" }), new File(["x"], "b.pdf")] },
    });
    await waitFor(() => expect(screen.getByText("b.pdf")).toBeInTheDocument());
    expect(callsOf("contexts.addFile")[0].input).toEqual({ id: "glossary", name: "a.png", dataBase64: "YWJj" });
    fireEvent.click(screen.getByRole("button", { name: "Remove file a.png" }));
    await waitFor(() => expect(screen.queryByText("a.png")).toBeNull());
    fail.add("contexts.addFile");
    fireEvent.change(input, { target: { files: [new File(["x"], "c.txt")] } });
    expect(await screen.findByText("Could not copy c.txt into the context")).toBeInTheDocument();
    fail.add("contexts.removeFile");
    fireEvent.click(screen.getByRole("button", { name: "Remove file b.pdf" }));
    expect(await screen.findByText("Could not remove b.pdf")).toBeInTheDocument();
  });

  it("moves a context into the shared library, and says so before deleting it", async () => {
    backend([glossary]);
    mount();
    const share = await screen.findByRole("switch", { name: /Shared with every project/ });
    expect(share).toHaveAttribute("aria-checked", "false");
    fireEvent.click(share);
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /Shared with every project/ })).toHaveAttribute("aria-checked", "true"),
    );
    expect(callsOf("contexts.share")[0].input).toEqual({ id: "glossary", shared: true });
    expect(within(editor()).getByText(/In the shared library/)).toBeVisible();
    expect(within(editor()).getByText("· deleted for every project")).toBeVisible();
    expect(screen.queryByText(/glossary/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete context…" }));
    expect(await screen.findByRole("alertdialog", { name: "Delete the context?" })).toHaveTextContent(
      "It is shared: it is deleted for every project, not only this one.",
    );
  });

  it("deletes after a danger confirm naming what goes — the name as typed — then closes; a refused delete says why", async () => {
    backend([glossary]);
    const { close } = mount();
    await waitFor(() => expect(nameBox()).toHaveValue("Glossaire"));
    fireEvent.change(nameBox(), { target: { value: "unsaved" } });
    fail.add("contexts.remove");
    fireEvent.click(screen.getByRole("button", { name: "Delete context…" }));
    expect(callsOf("contexts.remove")).toHaveLength(0);
    const confirm = await screen.findByRole("alertdialog", { name: "Delete the context?" });
    expect(confirm).toHaveTextContent("« unsaved » — its notes, files and paths.");
    expect(confirm).toHaveTextContent("It is deleted from this project.");
    expect(confirm).toHaveTextContent(
      "The tests, documents and project defaults that named it stop taking it. This cannot be undone.",
    );
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete the context" }));
    expect(await within(confirm).findByText(/Could not delete the context: contexts.remove broke/)).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    fail.delete("contexts.remove");
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete the context" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(store).toEqual([]);
    expect(callsOf("contexts.set"), "what was typed in a deleted context is not written").toHaveLength(0);
    await waitFor(() => expect(changes()).toBe(1));
  });

  it("says when the context cannot be opened or saved", async () => {
    backend([glossary]);
    fail.add("contexts.show");
    const a = mount();
    expect(await screen.findByText("Could not open the context")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Name/)).toBeNull();
    expect(within(editor()).queryByRole("button", { name: "Delete context…" })).toBeNull();
    fireEvent.click(within(editor()).getByRole("button", { name: "Done" }));
    expect(a.close).toHaveBeenCalled();
    a.unmount();
    fail.delete("contexts.show");
    mount();
    await waitFor(() => expect(nameBox()).toHaveValue("Glossaire"));
    fail.add("contexts.set");
    fireEvent.change(nameBox(), { target: { value: "x" } });
    fireEvent.blur(nameBox());
    expect(await screen.findByText("Could not save the context")).toBeInTheDocument();
  });

  it("an answer for a context left meanwhile leaves the one now open as it is", async () => {
    const gate = deferred();
    backend([
      { ...glossary, id: "a", name: "A", files: ["x.png"] },
      { ...bare, id: "b", name: "B", files: [] },
    ]);
    net.routes["contexts.removeFile"] = async (i) => {
      await gate.promise;
      return { ...summary(find(i.id)), files: [], notes: "" };
    };
    const Wrapper = dataWrapper();
    const at = (id: string) => (
      <Wrapper>
        <ContextEdit key={id} id={id} onClose={() => {}} />
      </Wrapper>
    );
    const r = rtlRender(at("a"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove file x.png" }));
    r.rerender(at("b"));
    await waitFor(() => expect(nameBox()).toHaveValue("B"));
    await act(async () => gate.resolve(null));
    expect(nameBox()).toHaveValue("B");
    expect(callsOf("contexts.removeFile")[0].input).toEqual({ id: "a", name: "x.png" });
  });
});
