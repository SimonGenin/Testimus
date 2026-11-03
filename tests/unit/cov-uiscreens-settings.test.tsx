// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../src/ui/api.ts";
import { resetDoctor } from "../../src/ui/lib/doctor.ts";
import { ColumnsSection } from "../../src/ui/screens/settings/ColumnsSection.tsx";
import { ProjectSection, saveProject } from "../../src/ui/screens/settings/ProjectSection.tsx";
import { SearchSection } from "../../src/ui/screens/settings/SearchSection.tsx";
import { SettingsScreen } from "../../src/ui/screens/settings/SettingsScreen.tsx";
import { clearToasts, mount } from "./cov-uiscreens-helpers.tsx";
import { layoutOf } from "./layout-helpers.ts";
import { api, app, fakeFetch, named, noDesktop } from "./ui-desktop-helpers.tsx";

vi.mock("../../src/ui/screens/settings/ModelsSection.tsx", () => ({
  ModelsSection: () => <section id="settings-models">Models stub</section>,
}));

beforeEach(() => {
  fakeFetch();
  resetDoctor();
});

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  setProject(null);
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const info = (project: Record<string, unknown> = {}) => {
  const a = app();
  return { ...a.info, project: { ...a.info?.project, ...project } } as NonNullable<ReturnType<typeof app>["info"]>;
};

describe("Settings screen", () => {
  it("lists the sections, marks the current one and navigates", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { app: a } = mount(<SettingsScreen />, { route: { screen: "settings", arg: "claude" } });
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getByRole("button", { name: "Claude" })).toHaveAttribute("aria-current", "true");
    expect(within(nav).getByRole("button", { name: "Project" })).not.toHaveAttribute("aria-current");
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    fireEvent.click(within(nav).getByRole("button", { name: "Access" }));
    expect(a.navigate).toHaveBeenCalledWith("settings", "access");
    expect(screen.getByRole("region", { name: "Connection to Claude" })).toBeInTheDocument();
    expect(screen.queryByText("Models stub")).not.toBeInTheDocument();
    expect(document.querySelector("#settings-access")).toBeNull();
  });

  it("shows one section per page", () => {
    mount(<SettingsScreen />, { route: { screen: "settings", arg: "models" } });
    expect(screen.getByText("Models stub")).toBeInTheDocument();
    expect(document.querySelectorAll(".settings-body > section")).toHaveLength(1);
  });

  it("defaults to Project, and says to open a project without one", () => {
    mount(<SettingsScreen />, { info: null, route: { screen: "documents" } });
    expect(screen.getByRole("button", { name: "Project" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByText(/Open a project to change its settings/)).toBeInTheDocument();
  });

  it("without a project, a page that works without one says nothing about it", () => {
    mount(<SettingsScreen />, { info: null, route: { screen: "settings", arg: "appearance" } });
    expect(screen.getByRole("region", { name: "Appearance and this PC" })).toBeInTheDocument();
    expect(screen.queryByText(/Open a project to change its settings/)).not.toBeInTheDocument();
  });

  it("without an argument on the settings route: Project, no scroll", () => {
    mount(<SettingsScreen />, { route: { screen: "settings" } });
    expect(screen.getByRole("button", { name: "Project" })).toHaveAttribute("aria-current", "true");
  });

  it("an unknown section falls back to Project", () => {
    mount(<SettingsScreen />, { route: { screen: "settings", arg: "nowhere" } });
    expect(screen.getByRole("button", { name: "Project" })).toHaveAttribute("aria-current", "true");
  });
});

describe("Settings › Project", () => {
  it("saves the Jira key and the prefix on blur, only when changed", async () => {
    api.routes["project.set"] = () => ({});
    const { app: a } = mount(<ProjectSection />);
    const key = screen.getByLabelText("Jira project");
    fireEvent.blur(key);
    fireEvent.change(key, { target: { value: "   " } });
    fireEvent.blur(key);
    expect(named("project.set")).toHaveLength(0);
    fireEvent.change(key, { target: { value: " bhptcc " } });
    expect(key).toHaveValue(" BHPTCC ");
    fireEvent.blur(key);
    await waitFor(() => expect(named("project.set")[0]?.input).toEqual({ jiraProject: "BHPTCC" }));
    expect(await screen.findByText("Jira project saved")).toBeInTheDocument();
    expect(a.refreshInfo).toHaveBeenCalled();

    const prefix = screen.getByLabelText("Review label prefix");
    fireEvent.blur(prefix);
    fireEvent.change(prefix, { target: { value: "  " } });
    fireEvent.blur(prefix);
    expect(named("project.set")).toHaveLength(1);
    fireEvent.change(prefix, { target: { value: "tm-" } });
    expect(screen.getByText("tm-validated")).toBeInTheDocument();
    fireEvent.blur(prefix);
    await waitFor(() => expect(named("project.set")[1]?.input).toEqual({ labelPrefix: "tm-" }));
  });

  it("saves the language and shows a language outside the list", async () => {
    api.routes["project.set"] = () => ({});
    mount(<ProjectSection />, { info: info({ language: "de" }) });
    const lang = screen.getByLabelText("Language of the tests");
    expect(within(lang).getByRole("option", { name: "de" })).toBeInTheDocument();
    fireEvent.change(lang, { target: { value: "en" } });
    await waitFor(() => expect(named("project.set")[0]?.input).toEqual({ language: "en" }));
  });

  it("falls back on empty values and renders nothing without a project", () => {
    const { container } = mount(<ProjectSection />, { info: null });
    expect(container.querySelector("#settings-project")).toBeNull();
    cleanup();
    mount(<ProjectSection />, { info: info({ jiraProject: undefined, labelPrefix: undefined }) });
    expect(screen.getByLabelText("Jira project")).toHaveValue("");
    expect(screen.getByLabelText("Review label prefix")).toHaveValue("testimus-");
  });

  it("saveProject reports a failure", async () => {
    const refresh = vi.fn();
    mount(<span />);
    await saveProject({ x: 1 }, refresh, "Thing");
    expect(refresh).not.toHaveBeenCalled();
    expect(await screen.findByText("Could not save thing")).toBeInTheDocument();
  });
});

describe("Settings › Smart columns", () => {
  const xray = layoutOf(
    [
      { id: "action", name: "Action", type: "text", builtin: true },
      { id: "result", name: "Expected Result", type: "text", builtin: true },
      { id: "cf1", name: "Exigence", type: "text-single", builtin: false },
      { id: "cf2", name: "Note", type: "", builtin: false },
    ],
    { order: ["Expected Result", "Gone"], collapsed: ["Note"], hidden: ["Action"] },
    [],
    "2026-11-01T10:00:00Z",
  ) as unknown as ReturnType<typeof app>["xray"];
  const col = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    origin: "xray",
    builtin: name === "Action" || name === "Expected Result",
    status: "ok",
    description: `${name} text`,
    mode: "open",
    ...over,
  });
  const columns = [
    col("Expected Result"),
    col("Action", { mode: "hidden" }),
    col("Exigence", { status: "new", description: "", mode: "filled" }),
    col("Note", { mode: "collapsed" }),
    col("Remarque", { origin: "local", status: "gone", description: "" }),
  ];
  const withColumns = (cols: unknown[] = columns) =>
    ({ ...app().info, columns: cols }) as ReturnType<typeof app>["info"];

  it("shows each column with its origin, folding, hidden flag, and moves them", async () => {
    api.routes["columns.setModes"] = () => [];
    api.routes["columns.order"] = () => [];
    const { app: a } = mount(<ColumnsSection />, { xray, info: withColumns() });
    const rows = within(screen.getByRole("list", { name: "Smart columns" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Xray · standard");
    expect(rows[2]).toHaveTextContent("New in Xray");
    expect(rows[4]).toHaveTextContent("No longer in Xray");
    expect(screen.getByRole("status")).toHaveTextContent(
      "New in Xray, not described yet: Exigence. No longer in Xray, kept as local columns: Remarque.",
    );
    expect(screen.getByText(/Read from Xray/)).toBeInTheDocument();
    const action = screen.getByLabelText("Action folding");
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute("title", "Action is always open");
    expect(screen.getByLabelText("Exigence folding")).toHaveValue("filled");
    const note = screen.getByLabelText("Note folding");
    expect(note).toHaveValue("collapsed");
    fireEvent.change(note, { target: { value: "open" } });
    await waitFor(() => expect(named("columns.setModes")[0]?.input).toEqual({ modes: { Note: "open" } }));
    fireEvent.change(screen.getByLabelText("Exigence folding"), { target: { value: "collapsed" } });
    await waitFor(() => expect(named("columns.setModes")[1]?.input).toEqual({ modes: { Exigence: "collapsed" } }));
    fireEvent.click(screen.getByLabelText("Action hidden"));
    await waitFor(() => expect(named("columns.setModes")[2]?.input).toEqual({ modes: { Action: "open" } }));
    fireEvent.click(screen.getByLabelText("Note hidden"));
    await waitFor(() => expect(named("columns.setModes")[3]?.input).toEqual({ modes: { Note: "hidden" } }));
    expect(screen.getByRole("button", { name: "Move Expected Result up" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Action up" }));
    await waitFor(() =>
      expect(named("columns.order")[0]?.input).toEqual({
        names: ["Action", "Expected Result", "Exigence", "Note", "Remarque"],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move Action down" }));
    await waitFor(() =>
      expect(named("columns.order")[1]?.input).toEqual({
        names: ["Expected Result", "Exigence", "Action", "Note", "Remarque"],
      }),
    );
    expect(a.refreshInfo).toHaveBeenCalled();
  });

  it("drags a column onto another, ignores a drop on itself", async () => {
    api.routes["columns.order"] = () => [];
    mount(<ColumnsSection />, { xray, info: withColumns() });
    const rows = within(screen.getByRole("list", { name: "Smart columns" })).getAllByRole("listitem");
    const dataTransfer = { effectAllowed: "", setData: vi.fn() };
    fireEvent.dragOver(rows[1]);
    fireEvent.dragStart(rows[3], { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "Note");
    expect(rows[3]).toHaveClass("is-dragging");
    fireEvent.dragOver(rows[0]);
    fireEvent.drop(rows[3]);
    expect(named("columns.order")).toHaveLength(0);
    fireEvent.dragStart(rows[3], { dataTransfer });
    fireEvent.drop(rows[0]);
    await waitFor(() =>
      expect(named("columns.order")[0]?.input).toEqual({
        names: ["Note", "Expected Result", "Action", "Exigence", "Remarque"],
      }),
    );
    fireEvent.dragStart(rows[1], { dataTransfer });
    fireEvent.dragEnd(rows[1]);
    expect(rows[1]).not.toHaveClass("is-dragging");
    fireEvent.drop(rows[2]);
    expect(named("columns.order")).toHaveLength(1);
  });

  it("saves a description on blur, adds and removes a local column, and reports failures", async () => {
    const { app: a } = mount(<ColumnsSection />, { xray, info: withColumns() });
    const box = screen.getByLabelText("What Claude writes in Action");
    expect(box).toHaveValue("Action text");
    fireEvent.blur(box);
    expect(named("columns.save")).toHaveLength(0);
    fireEvent.change(box, { target: { value: " Un geste " } });
    fireEvent.blur(box);
    expect(await screen.findByText("Could not save the column")).toBeInTheDocument();
    api.routes["columns.save"] = () => [];
    fireEvent.change(box, { target: { value: "Un geste" } });
    fireEvent.blur(box);
    expect(await screen.findByText("Action saved")).toBeInTheDocument();
    expect(named("columns.save").at(-1)?.input).toEqual({ name: "Action", description: "Un geste" });
    fireEvent.click(screen.getByRole("button", { name: "Add a local column" }));
    expect(screen.getByRole("button", { name: "Add the column" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a local column" }));
    fireEvent.change(screen.getByLabelText("Name of the local column"), { target: { value: " Remarque testeur " } });
    fireEvent.change(screen.getByLabelText("What Claude writes in it"), { target: { value: "Rien" } });
    fireEvent.click(screen.getByRole("button", { name: "Add the column" }));
    expect(await screen.findByText("Column Remarque testeur added")).toBeInTheDocument();
    expect(named("columns.save").at(-1)?.input).toEqual({ name: "Remarque testeur", description: "Rien" });
    expect(screen.queryByLabelText("Name of the local column")).toBeNull();
    delete api.routes["columns.save"];
    fireEvent.click(screen.getByRole("button", { name: "Add a local column" }));
    fireEvent.change(screen.getByLabelText("Name of the local column"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Add the column" }));
    expect(await screen.findByText("Could not add the column")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove the column Action" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove the column Remarque" }));
    expect(await screen.findByText("Could not remove the column")).toBeInTheDocument();
    api.routes["columns.remove"] = () => [];
    fireEvent.click(screen.getByRole("button", { name: "Remove the column Remarque" }));
    expect(await screen.findByText("Column Remarque removed")).toBeInTheDocument();
    expect(named("columns.remove").at(-1)?.input).toEqual({ name: "Remarque" });
    expect(a.refreshInfo).toHaveBeenCalled();
  });

  it("reads Xray again and reports failures; nothing without a project", async () => {
    mount(<ColumnsSection />, { xray: { ...xray, fetchedAt: undefined } as typeof xray, info: withColumns([]) });
    expect(screen.queryByText(/Read from Xray/)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Read again from Xray" }));
    expect(await screen.findByText("Could not read the step fields from Jira")).toBeInTheDocument();
    let release = () => {};
    api.routes["xray.refreshFields"] = () => ({ fields: [] });
    const slow = new Promise<void>((r) => {
      release = r;
    });
    const f = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (...args: Parameters<typeof fetch>) => {
        await slow;
        return f(...args);
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Read again from Xray" }));
    expect(await screen.findByRole("button", { name: "Reading…" })).toBeDisabled();
    release();
    expect(await screen.findByText("Smart columns read again from Xray")).toBeInTheDocument();
    cleanup();
    const { container } = mount(<ColumnsSection />, { info: null });
    expect(container.querySelector("#settings-columns")).toBeNull();
  });
});

describe("Settings › Search", () => {
  const status = (over: Record<string, unknown> = {}) => ({
    embedding: "e1",
    reranker: null,
    dims: 1024,
    activation: "none",
    missing: [],
    exists: true,
    indexEmbedding: "e1",
    profileMatches: true,
    space: null,
    degraded: null,
    chunks: 4,
    builtAt: null,
    docs: [
      { docId: "D1", indexed: "stale" },
      { docId: "D2", indexed: "fresh" },
    ],
    ...over,
  });
  const space = {
    id: "s1",
    model: "e1",
    runtime: "transformers",
    dims: 1024,
    chunks: 4,
    complete: true,
    active: false,
    builtAt: "not a date",
    lastUsed: null,
    sizeMB: 1,
  };

  it("says how many documents are behind, with no reranker", async () => {
    api.routes["rag.status"] = () => status();
    api.routes["rag.spaces"] = () => [space];
    mount(<SearchSection />);
    expect(await screen.findByText("1 document to reindex")).toBeInTheDocument();
    expect(screen.getByText("no reranker")).toBeInTheDocument();
    expect(screen.getByText("None: lexical search only")).toBeInTheDocument();
    const row = await screen.findByRole("row", { name: "Space s1" });
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("says when the vectors are for another model, when there is no index, and without a model", async () => {
    api.routes["rag.status"] = () => status({ profileMatches: false });
    api.routes["rag.spaces"] = () => null;
    mount(<SearchSection />);
    expect(await screen.findByText("Vectors missing for this model — reindex")).toBeInTheDocument();
    expect(await screen.findByText(/None yet/)).toBeInTheDocument();
    cleanup();
    api.routes["rag.status"] = () => status({ exists: false, embedding: "none" });
    mount(<SearchSection />);
    expect(await screen.findByText("No index yet")).toBeInTheDocument();
    expect(screen.getByText("No embedding model")).toBeInTheDocument();
  });

  it("shows why the state could not be read", async () => {
    mount(<SearchSection />);
    expect(
      await screen.findByText(/The index state could not be read: Unknown command rag.status/),
    ).toBeInTheDocument();
    expect(await screen.findByText(/None yet/)).toBeInTheDocument();
  });

  it("reindexes, showing the run, then rereads", async () => {
    api.routes["rag.status"] = () => status();
    api.routes["rag.spaces"] = () => [];
    api.routes["rag.index"] = () => ({ jobId: "j1" });
    api.routes["jobs.show"] = () => ({ job: { id: "j1", status: "running" } });
    mount(<SearchSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Reindex" }));
    expect(await screen.findByText("Indexing…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reindex" })).toBeDisabled();
    api.routes["jobs.show"] = () => ({ job: { id: "j1", status: "done", result: {} } });
    await waitFor(() => expect(screen.queryByText("Indexing…")).toBeNull(), { timeout: 4000 });
    expect(named("rag.status").length).toBeGreaterThan(1);
  });

  it("cancels a drop, and reports a failed drop", async () => {
    api.routes["rag.status"] = () => status();
    api.routes["rag.spaces"] = () => [space];
    mount(<SearchSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Drop space s1" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Drop space s1" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Drop 1 MB" }));
    expect(await screen.findByText("Could not drop the vector space")).toBeInTheDocument();
  });

  it("drops and says how much was freed", async () => {
    api.routes["rag.status"] = () => status();
    api.routes["rag.spaces"] = () => [space];
    api.routes["rag.dropSpace"] = () => ({ dropped: "s1", freedMB: 1 });
    mount(<SearchSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Drop space s1" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Drop 1 MB" }));
    expect(await screen.findByText("s1 · 1 MB freed")).toBeInTheDocument();
  });

  it("shows a failure that is not an Error, and survives an empty catalog", async () => {
    api.routes["models.catalog"] = () => null;
    const f = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("rag/status")) throw "offline";
        return f(url, init);
      }),
    );
    mount(<SearchSection />);
    expect(await screen.findByText(/could not be read: offline/)).toBeInTheDocument();
  });

  it("is absent without a project", () => {
    const { container } = mount(<SearchSection />, { info: null });
    expect(container.querySelector("#settings-search")).toBeNull();
  });
});
