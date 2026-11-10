// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Test } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { ClaudeDock } from "../../../../src/ui/components/claude/ClaudeDock.tsx";
import { AppContext, type AppState } from "../../../../src/ui/lib/app.ts";
import { clearDrafts } from "../../../../src/ui/lib/data/autosave.ts";
import { ContextSection } from "../../../../src/ui/screens/settings/ContextSection.tsx";
import { TestEditor } from "../../../../src/ui/screens/tests/TestEditor.tsx";
import { piece, previewOf } from "../../helpers/fake-preview.ts";
import { callsOf, dataWrapper, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
import { app } from "../../helpers/ui-desktop.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

type Ctx = { id: string; name: string; notes: string; paths: string[]; files: string[] };
let store: Record<string, Ctx> = {};
// ponytail: the test's own list as the server holds it (null: it takes the project's defaults)
let own: string[] | null = null;
const DEFAULTS = ["ctx-b"];
const detail = (id: string) => ({ ...store[id], hasNotes: !!store[id].notes.trim(), shared: false });
const attached = () => ({ effective: own ?? DEFAULTS, own });

const shown: Test = {
  key: "LFRPS12-7",
  project: "LFRPS12",
  summary: "Sectionneur",
  folder: "/",
  labels: [],
  description: "",
  covers: [],
  preconditions: [],
  review: "draft",
  steps: [{ fields: { Action: "One", "Expected Result": "Done" }, sources: [], images: [] }],
  extra: {},
};

beforeEach(() => {
  fakeNet();
  fakeEvents();
  localStorage.clear();
  setProject("/p/contexts-refresh");
  own = null;
  store = {
    "ctx-a": { id: "ctx-a", name: "House style", notes: "", paths: [], files: [] },
    "ctx-b": { id: "ctx-b", name: "Glossary", notes: "", paths: [], files: [] },
  };
  const r = net.routes;
  r["claude.status"] = () => ({ installed: true, version: "2.1.0", signedIn: true, exe: "claude" });
  r["system.settings"] = () => ({ claude: { exe: "claude" } });
  r["claude.prompts"] = () => [];
  r["claude.preview"] = (i) =>
    previewOf(
      [
        piece("instruction", "Ask Claude"),
        ...Object.values(store).map((c) =>
          piece(`context:${c.id}`, c.name || "Untitled context", { on: attached().effective.includes(c.id) }),
        ),
      ],
      i,
    );
  r["contexts.list"] = () => Object.keys(store).map(detail);
  r["project.info"] = () => ({ ...state().info, columns: [], fieldOrder: [], counts: {} });
  r["contexts.show"] = (i) => ({ ...detail(String(i.id)), notes: store[String(i.id)].notes });
  r["contexts.set"] = (i) => {
    const c = store[String(i.id)];
    Object.assign(c, Object.fromEntries(Object.entries(i).filter(([k]) => k !== "id")));
    return { ...detail(c.id), notes: c.notes };
  };
  r["contexts.ofProject"] = () => ({ effective: DEFAULTS });
  r["contexts.ofTest"] = attached;
  r["contexts.setTest"] = (i) => {
    own = i.contexts as string[] | null;
    return attached();
  };
  r["tests.show"] = (i) => ({ id: i.id, test: shown, mtime: 1 });
  r["tests.folds"] = () => ({ own: null });
  r["xray.preconditions"] = () => [];
  r["xray.folders"] = () => ({ name: "/", path: "/", testsCount: 0, totalCount: 0, folders: [] });
  r["xray.status"] = (i) => ({ tests: [{ id: i.id, sync: "synced", remote: "unchanged" }] });
});

afterEach(() => {
  cleanup();
  clearDrafts();
  vi.unstubAllGlobals();
  setProject(null);
});

const state = (): AppState => {
  const base = app().info as NonNullable<AppState["info"]>;
  return app({
    route: { screen: "tests", arg: "t1" },
    info: { ...base, project: { ...base.project, claude: { ...base.project.claude, contexts: DEFAULTS } } },
  });
};

// ponytail: the three places a saved context is listed — the graph of the dock's next run, the test's header, and
// Settings › Context
const everywhere = async () => {
  render(
    <AppContext.Provider value={state()}>
      <ClaudeDock />
      <TestEditor testId="t1" onSaved={vi.fn()} onOpen={vi.fn()} />
      <ContextSection />
    </AppContext.Provider>,
  );
  await screen.findByLabelText("Action of step 1");
  const details = screen.queryByRole("button", { name: "Details" });
  if (details) fireEvent.click(details);
  return {
    dock: screen.getByRole("complementary", { name: "Claude" }),
    settings: await screen.findByRole("listbox", { name: "What Claude is given" }),
  };
};

const graphOfTest = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Context…" }));
  const graph = await screen.findByRole("dialog", { name: "Context" });
  await within(graph).findByRole("group", { name: "What Claude is given" });
  return graph;
};
const done = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

describe("a saved context changed where it is ticked shows at once everywhere it is listed (audit M-C2)", () => {
  it("renamed in its editor, from the test's Context: the test header, the graphs and Settings › Context all say the new name", async () => {
    const { dock, settings } = await everywhere();
    expect(await screen.findByRole("button", { name: "Remove Glossary" })).toBeInTheDocument();
    expect(await within(settings).findByRole("option", { name: /Glossary/ })).toBeInTheDocument();

    const graph = await graphOfTest();
    const row = within(graph).getByRole("checkbox", { name: "Glossary" }).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByText("Glossary"));
    fireEvent.click(
      within(within(graph).getByRole("article", { name: "Glossary" })).getByRole("button", { name: "Edit" }),
    );
    const editor = await screen.findByRole("dialog", { name: "Edit the context" });
    const name = await within(editor).findByRole("textbox", { name: /^Name/ });
    await waitFor(() => expect(name).toHaveValue("Glossary"));
    fireEvent.change(name, { target: { value: "Lexique" } });
    fireEvent.blur(name);
    await waitFor(() => expect(store["ctx-b"].name).toBe("Lexique"));
    done(editor);

    expect(await within(graph).findByRole("checkbox", { name: "Lexique" })).toBeChecked();
    done(graph);
    expect(await screen.findByRole("button", { name: "Remove Lexique" })).toBeInTheDocument();
    expect(await within(settings).findByRole("option", { name: /Lexique/ })).toBeInTheDocument();
    fireEvent.click(within(dock).getByRole("button", { name: /^Context/ }));
    const ofDock = await screen.findByRole("dialog", { name: "Context" });
    expect(await within(ofDock).findByRole("checkbox", { name: "Lexique" })).toBeChecked();
    expect(screen.queryByText(/Glossary/)).toBeNull();
  });

  it("created in the test's Context: attached to the test, named in its header and listed in Settings › Context at once", async () => {
    net.routes["contexts.create"] = () => {
      store["ctx-n"] = { id: "ctx-n", name: "New context", notes: "", paths: [], files: [] };
      return { ...detail("ctx-n"), notes: "" };
    };
    const { settings } = await everywhere();
    await within(settings).findByRole("option", { name: /Glossary/ });
    expect(within(settings).queryByRole("option", { name: /New context/ })).toBeNull();
    fireEvent.focus(await screen.findByRole("combobox", { name: "Claude contexts" }));
    expect(screen.queryByRole("option", { name: "New context" })).toBeNull();

    const graph = await graphOfTest();
    fireEvent.click(within(graph).getByRole("button", { name: "New context" }));
    const editor = await screen.findByRole("dialog", { name: "Edit the context" });
    await waitFor(() =>
      expect(callsOf("contexts.setTest")[0]?.input).toEqual({ testId: "t1", contexts: ["ctx-b", "ctx-n"] }),
    );
    done(editor);
    expect(await within(graph).findByRole("checkbox", { name: "New context" })).toBeChecked();
    done(graph);
    expect(await screen.findByRole("button", { name: "Remove New context" })).toBeInTheDocument();
    expect(await within(settings).findByRole("option", { name: /New context/ })).toBeInTheDocument();
  });
});
