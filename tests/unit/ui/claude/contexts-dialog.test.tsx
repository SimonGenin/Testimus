// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { ContextsDialog, contextLine } from "../../../../src/ui/components/claude/ContextsDialog.tsx";
import { Toaster } from "../../../../src/ui/components/ui/Toast.tsx";
import { useRead } from "../../../../src/ui/lib/data/query.ts";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { callsOf, dataWrapper, Fail, fakeNet, net } from "../../helpers/ui-data.tsx";
import { fakeDesktop, noDesktop } from "../../helpers/ui-desktop.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

let ids: number[] = [];
function Probe() {
  ids = useToasts().map((t) => t.id);
  useRead("contexts.ofProject", {});
  return <Toaster />;
}

type Ctx = { id: string; name: string; notes: string; paths: string[]; files: string[] };
let store: Ctx[] = [];
let fail: Set<string> = new Set();
let n = 0;

const summary = (c: Ctx) => ({ id: c.id, name: c.name, paths: c.paths, files: c.files, hasNotes: !!c.notes });
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
  n = 0;
  net.routes["contexts.ofProject"] = () => ({ effective: [] });
  net.routes["contexts.list"] = () => {
    guard("contexts.list");
    return store.map(summary);
  };
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
  net.routes["contexts.create"] = () => {
    guard("contexts.create");
    const c = { id: `new-${++n}`, name: "", notes: "", paths: [], files: [] };
    store.push(c);
    return { ...summary(c), notes: "" };
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
const empty: Ctx = { id: "bare", name: "", notes: "", paths: [], files: ["plan.pdf"] };

// ponytail: a reader of the contexts outside the dialog (the dock, Settings › Claude, a test header) reads again after
// each change
const changes = () => callsOf("contexts.ofProject").length - 1;

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

function mount(initialId?: string) {
  const close = vi.fn();
  const r = render(
    <>
      <ContextsDialog initialId={initialId} onClose={close} />
      <Probe />
    </>,
  );
  return { ...r, close };
}

const option = (name: RegExp) => screen.getByRole("option", { name });
const nameBox = () => screen.getByLabelText(/^Name/);
const notesBox = () => screen.getByLabelText(/^Notes/);

describe("contextLine", () => {
  it("sums up what a context holds", () => {
    expect(contextLine({ files: [], paths: [], hasNotes: false })).toBe("empty");
    expect(contextLine({ files: ["a", "b"], paths: ["p"], hasNotes: true })).toBe("2 files · 1 path · notes");
  });
});

describe("ContextsDialog", () => {
  it("says when there is no context yet and creates one", async () => {
    backend([]);
    const { close } = mount();
    expect(await screen.findByText("No context yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /New context/ }));
    expect(await screen.findByText("contexts/new-1/")).toBeInTheDocument();
    expect(option(/new-1/)).toHaveAttribute("aria-selected", "true");
    expect(option(/new-1/)).toHaveTextContent("empty");
    await waitFor(() => expect(changes()).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalled();
  });

  it("opens the asked context, or the first one when it is not there", async () => {
    backend([glossary, empty]);
    const a = mount("bare");
    await waitFor(() => expect(option(/bare/)).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByText("plan.pdf")).toBeInTheDocument();
    a.unmount();
    mount("missing");
    await waitFor(() => expect(option(/Glossaire/)).toHaveAttribute("aria-selected", "true"));
    expect(option(/Glossaire/)).toHaveTextContent("1 path · notes");
    expect(option(/bare/)).toHaveTextContent("1 file");
  });

  it("saves the name and notes after a pause, on blur and before switching", async () => {
    backend([glossary, empty]);
    mount();
    await waitFor(() => expect(nameBox()).toHaveValue("Glossaire"));
    fireEvent.change(nameBox(), { target: { value: "" } });
    expect(option(/glossary/)).toBeInTheDocument();
    fireEvent.change(nameBox(), { target: { value: "Lexique" } });
    expect(option(/Lexique/)).toBeInTheDocument();
    await waitFor(() => expect(callsOf("contexts.set")).toHaveLength(1));
    expect(callsOf("contexts.set")[0].input).toEqual({ id: "glossary", name: "Lexique", notes: "SOSIE = ..." });
    await waitFor(() => expect(changes()).toBe(1));
    fireEvent.change(notesBox(), { target: { value: "Nouvelles notes" } });
    fireEvent.blur(notesBox());
    await waitFor(() => expect(callsOf("contexts.set")).toHaveLength(2));
    fireEvent.blur(nameBox());
    fireEvent.change(nameBox(), { target: { value: "Lexique 2" } });
    fireEvent.click(option(/bare/));
    await waitFor(() => expect(option(/bare/)).toHaveAttribute("aria-selected", "true"));
    expect(callsOf("contexts.set")).toHaveLength(3);
    expect(store[0].name).toBe("Lexique 2");
    const shows = callsOf("contexts.show").length;
    fireEvent.click(option(/bare/));
    await act(async () => {});
    expect(callsOf("contexts.show")).toHaveLength(shows);
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
      .map(([, init]) => decodeURIComponent((init?.headers as Record<string, string>)["X-Testimus-Project"] ?? ""));
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

  it("deletes on one click, as Xray Editor does, then shows the next context or none", async () => {
    backend([glossary, empty]);
    mount();
    await waitFor(() => expect(nameBox()).toHaveValue("Glossaire"));
    fireEvent.change(nameBox(), { target: { value: "unsaved" } });
    fireEvent.click(screen.getByRole("button", { name: /Delete context/ }));
    await waitFor(() => expect(option(/bare/)).toHaveAttribute("aria-selected", "true"));
    expect(callsOf("contexts.set")).toHaveLength(0);
    fail.add("contexts.remove");
    fireEvent.click(screen.getByRole("button", { name: /Delete context/ }));
    expect(await screen.findByText("Could not delete the context")).toBeInTheDocument();
    fail.delete("contexts.remove");
    fireEvent.click(screen.getByRole("button", { name: /Delete context/ }));
    expect(await screen.findByText("No context yet")).toBeInTheDocument();
  });

  it("says when the contexts cannot be listed, opened, saved or created", async () => {
    backend([glossary]);
    fail.add("contexts.list");
    const a = mount();
    expect(await screen.findByText("Could not list the contexts")).toBeInTheDocument();
    expect(screen.getByText("No context yet")).toBeInTheDocument();
    a.unmount();
    fail.delete("contexts.list");
    fail.add("contexts.show");
    const b = mount();
    expect(await screen.findByText("Could not open the context")).toBeInTheDocument();
    b.unmount();
    fail.delete("contexts.show");
    mount();
    await waitFor(() => expect(nameBox()).toHaveValue("Glossaire"));
    fail.add("contexts.set");
    fireEvent.change(nameBox(), { target: { value: "x" } });
    fireEvent.blur(nameBox());
    expect(await screen.findByText("Could not save the context")).toBeInTheDocument();
    fail.add("contexts.create");
    fireEvent.click(screen.getByRole("button", { name: /New context/ }));
    expect(await screen.findByText("Could not create the context")).toBeInTheDocument();
  });

  it("reads an empty list answer as no context", async () => {
    backend([]);
    net.routes["contexts.list"] = () => null;
    mount();
    expect(await screen.findByText("No context yet")).toBeInTheDocument();
  });
});
