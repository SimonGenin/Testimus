// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Test } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { ClaudeDock } from "../../../../src/ui/components/claude/ClaudeDock.tsx";
import { AppContext, type AppState } from "../../../../src/ui/lib/app.ts";
import { resetDoctor } from "../../../../src/ui/lib/doctor.ts";
import { ClaudeSection } from "../../../../src/ui/screens/settings/ClaudeSection.tsx";
import { TestEditor } from "../../../../src/ui/screens/tests/TestEditor.tsx";
import { dataWrapper, fakeEvents, fakeNet, net } from "../../cov-uishell-helpers.tsx";
import { app } from "../../ui-desktop-helpers.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

type Ctx = { id: string; name: string; notes: string; paths: string[]; files: string[] };
let store: Record<string, Ctx> = {};
const detail = (id: string) => ({ ...store[id], hasNotes: !!store[id].notes.trim(), shared: false });

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
  resetDoctor();
  localStorage.clear();
  setProject("/p/contexts-refresh");
  store = {
    "ctx-a": { id: "ctx-a", name: "House style", notes: "", paths: [], files: [] },
    "ctx-b": { id: "ctx-b", name: "Glossary", notes: "", paths: [], files: [] },
  };
  const r = net.routes;
  r["claude.status"] = () => ({ installed: true, version: "2.1.0", signedIn: true, exe: "claude" });
  r["system.settings"] = () => ({ claude: { exe: "claude" } });
  r["contexts.list"] = () => Object.keys(store).map(detail);
  r["contexts.show"] = (i) => detail(String(i.id));
  r["contexts.set"] = (i) => {
    const c = store[String(i.id)];
    Object.assign(c, Object.fromEntries(Object.entries(i).filter(([k]) => k !== "id")));
    return detail(c.id);
  };
  r["contexts.ofProject"] = () => ({ effective: ["ctx-b"] });
  r["contexts.ofTest"] = () => ({ effective: ["ctx-b"], own: null });
  r["tests.show"] = (i) => ({ id: i.id, test: shown, mtime: 1 });
  r["tests.columns"] = () => ({ own: null });
  r["xray.preconditions"] = () => [];
  r["xray.folders"] = () => ({ name: "/", path: "/", testsCount: 0, totalCount: 0, folders: [] });
  r["xray.status"] = (i) => ({ tests: [{ id: i.id, sync: "synced", remote: "unchanged" }] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

const state = (): AppState => {
  const base = app().info as NonNullable<AppState["info"]>;
  return app({
    route: { screen: "tests", arg: "t1" },
    info: { ...base, project: { ...base.project, claude: { ...base.project.claude, contexts: ["ctx-b"] } } },
  });
};

describe("a context changed in the Contexts dialog shows at once everywhere it is listed (audit M-C2)", () => {
  it("renamed from Settings › Claude: the dock, the test header and the default contexts all say the new name", async () => {
    render(
      <AppContext.Provider value={state()}>
        <ClaudeDock folded={false} onFold={() => {}} />
        <TestEditor testId="t1" onSaved={vi.fn()} onOpen={vi.fn()} />
        <ClaudeSection />
      </AppContext.Provider>,
    );
    const dock = screen.getByRole("complementary", { name: "Claude" });
    expect(await within(dock).findByRole("button", { name: "Glossary" })).toBeInTheDocument();
    const defaults = await screen.findByRole("group", { name: "Default contexts" });
    expect(within(defaults).getByRole("button", { name: "Glossary" })).toBeInTheDocument();
    await screen.findByLabelText("Action of step 1");
    const details = screen.queryByRole("button", { name: "Details" });
    if (details) fireEvent.click(details);
    expect(await screen.findByRole("button", { name: "Detach Glossary" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Manage contexts…" }));
    const dialog = await screen.findByRole("dialog", { name: "Contexts" });
    fireEvent.click(await within(dialog).findByRole("option", { name: /Glossary/ }));
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: /^Name/ })).toHaveValue("Glossary"));
    const name = within(dialog).getByRole("textbox", { name: /^Name/ });
    fireEvent.change(name, { target: { value: "Lexique" } });
    fireEvent.blur(name);
    await waitFor(() => expect(store["ctx-b"].name).toBe("Lexique"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(await within(dock).findByRole("button", { name: "Lexique" })).toBeInTheDocument();
    expect(await within(defaults).findByRole("button", { name: "Lexique" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Detach Lexique" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Glossary/ })).toBeNull();
  });

  it("created in the dialog: offered at once in the default contexts and in the test's « Attach context »", async () => {
    net.routes["contexts.create"] = () => {
      store["ctx-n"] = { id: "ctx-n", name: "New context", notes: "", paths: [], files: [] };
      return detail("ctx-n");
    };
    render(
      <AppContext.Provider value={state()}>
        <ClaudeDock folded={false} onFold={() => {}} />
        <TestEditor testId="t1" onSaved={vi.fn()} onOpen={vi.fn()} />
        <ClaudeSection />
      </AppContext.Provider>,
    );
    const defaults = await screen.findByRole("group", { name: "Default contexts" });
    await screen.findByLabelText("Action of step 1");
    const details = screen.queryByRole("button", { name: "Details" });
    if (details) fireEvent.click(details);
    const attach = await screen.findByRole("combobox", { name: "Attach context" });
    expect(within(attach).queryByRole("option", { name: "New context" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage contexts…" }));
    const dialog = await screen.findByRole("dialog", { name: "Contexts" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "New context" }));
    await waitFor(() => expect(store["ctx-n"]).toBeDefined());
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(await within(defaults).findByRole("button", { name: "New context" })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(screen.getByRole("combobox", { name: "Attach context" })).getByRole("option", { name: "New context" }),
      ).toBeInTheDocument(),
    );
  });
});
