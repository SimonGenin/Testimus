// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../src/ui/api.ts";
import { resetDoctor } from "../../src/ui/lib/doctor.ts";
import { FirstRunScreen } from "../../src/ui/screens/setup/FirstRunScreen.tsx";
import { PackStep } from "../../src/ui/screens/setup/PackStep.tsx";
import { ProjectStep, projectFolder } from "../../src/ui/screens/setup/ProjectStep.tsx";
import { clearToasts, mount } from "./cov-uiscreens-helpers.tsx";
import { api, fakeDesktop, fakeFetch, named, noDesktop } from "./ui-desktop-helpers.tsx";

vi.mock("../../src/ui/screens/settings/models/FolderDialog.tsx", () => ({
  FolderDialog: ({ needMB, onClose, onApplied }: { needMB: number; onClose: () => void; onApplied: () => void }) => (
    <div role="dialog" aria-label="Folder">
      <span>need {needMB}</span>
      <button type="button" onClick={onClose}>
        Close folder
      </button>
      <button type="button" onClick={onApplied}>
        Apply folder
      </button>
    </div>
  ),
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

const status = (jira: Record<string, unknown> = {}, xray: Record<string, unknown> = {}) => ({
  jira: { file: "f", exists: true, complete: true, baseUrl: "https://acme.atlassian.net/wiki", email: "me@a", ...jira },
  xray: { file: "x", exists: true, complete: true, ...xray },
});

describe("First launch screen", () => {
  it("walks the steps and goes back to the app", () => {
    api.routes["system.setup"] = () => ({ status: status() });
    const { app: a } = mount(<FirstRunScreen />, { route: { screen: "setup" } });
    const steps = screen.getByRole("list", { name: "Setup steps" });
    const pills = within(steps).getAllByRole("listitem");
    expect(pills[0]).toHaveAttribute("aria-current", "step");
    fireEvent.click(within(pills[2]).getByRole("button"));
    expect(a.navigate).toHaveBeenCalledWith("setup", "pack");
    fireEvent.click(within(pills[0]).getByRole("button"));
    expect(a.navigate).toHaveBeenCalledWith("setup", undefined);
    fireEvent.click(screen.getByRole("button", { name: "Back to the app" }));
    expect(a.navigate).toHaveBeenCalledWith("tests");
  });

  it("on the project step: back goes to Access, opening goes to the pack", async () => {
    api.routes["project.list"] = () => ({ projects: [{ dir: "C:/q", name: "Q", jiraProject: "Q1", exists: true }] });
    api.routes["project.open"] = (i) => ({ dir: i.dir });
    const { app: a } = mount(<FirstRunScreen />, { info: null, route: { screen: "setup", arg: "project" } });
    expect(screen.queryByRole("button", { name: "Back to the app" })).toBeNull();
    expect(within(screen.getByRole("list", { name: "Setup steps" })).getAllByRole("listitem")[0]).toHaveClass(
      "is-done",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(a.navigate).toHaveBeenCalledWith("setup", undefined);
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("setup", "pack"));
  });

  it("on the access step, Continue and Skip go to the project", async () => {
    api.routes["system.setup"] = () => ({ status: status() });
    const { app: a } = mount(<FirstRunScreen />, { route: { screen: "setup" } });
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(a.navigate).toHaveBeenNthCalledWith(1, "setup", "project");
    expect(a.navigate).toHaveBeenNthCalledWith(2, "setup", "project");
  });

  it("on the pack step, Back goes to the project", () => {
    const { app: a } = mount(<FirstRunScreen />, { info: null, route: { screen: "setup", arg: "pack" } });
    fireEvent.click(screen.getByRole("button", { name: "Back to Project" }));
    expect(a.navigate).toHaveBeenCalledWith("setup", "project");
  });
});

describe("First launch › Project", () => {
  const known = [
    { dir: "C:\\p", name: "Current", jiraProject: "LFRPS12", exists: true },
    { dir: "C:/other", name: "", jiraProject: "BHP", exists: true },
    { dir: "C:/gone", name: "Gone", jiraProject: "X", exists: false },
  ];

  it("lists the known projects and opens one, then the documents", async () => {
    api.routes["project.list"] = () => ({ projects: known });
    api.routes["project.open"] = (i) => ({ dir: i.dir });
    const { app: a } = mount(<ProjectStep onBack={vi.fn()} />);
    const list = await screen.findByRole("list", { name: "Known projects" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveClass("is-on");
    expect(within(items[0]).getByRole("button", { name: "Open again" })).toBeInTheDocument();
    expect(within(items[1]).getAllByText("C:/other")).toHaveLength(2);
    expect(within(items[2]).getByText("Folder not found")).toBeInTheDocument();
    fireEvent.click(within(items[1]).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("documents"));
    expect(a.refreshInfo).toHaveBeenCalled();
    expect(a.testsChanged).toHaveBeenCalled();
  });

  it("hides a project with Don't show, and reports a hide that fails", async () => {
    api.routes["project.list"] = () => ({ projects: known });
    api.routes["project.forget"] = (i) => ({ dir: i.dir, forgotten: true });
    mount(<ProjectStep onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for C:/other" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Don't show" }));
    await waitFor(() => expect(screen.queryByText("C:/other", { selector: ".setup-proj-dir" })).toBeNull());
    expect(named("project.forget")[0].input).toEqual({ dir: "C:/other" });
    delete api.routes["project.forget"];
    fireEvent.click(screen.getByRole("button", { name: "More actions for Gone" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Don't show" }));
    expect(await screen.findByText("Could not hide the project")).toBeInTheDocument();
    expect(screen.getByText("Gone")).toBeInTheDocument();
  });

  it("deletes a project folder after a confirmation", async () => {
    api.routes["project.list"] = () => ({ projects: known });
    api.routes["project.delete"] = (i) => ({ dir: i.dir, deleted: true });
    const { app: a } = mount(<ProjectStep onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for C:/other" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete the project folder?" });
    expect(within(dialog).getByText(/Nothing is deleted in Jira/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(named("project.delete")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "More actions for C:/other" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete the folder" }));
    expect(await screen.findByText("Project C:/other deleted")).toBeInTheDocument();
    expect(named("project.delete")[0].input).toEqual({ dir: "C:/other" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions for C:/other" })).toBeNull();
    expect(a.closeProject).not.toHaveBeenCalled();
  });

  it("deletes the open project and closes it", async () => {
    api.routes["project.list"] = () => ({ projects: known });
    api.routes["project.delete"] = (i) => ({ dir: i.dir, deleted: true });
    const { app: a } = mount(<ProjectStep onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for Current" }));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete the project folder?" });
    expect(within(dialog).getByText(/It is the open project/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete the folder" }));
    expect(await screen.findByText("Project Current deleted")).toBeInTheDocument();
    expect(named("project.delete")[0].input).toEqual({ dir: "C:\\p" });
    expect(a.closeProject).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "More actions for Current" })).toBeNull();
  });

  it("removes a project whose folder is gone without a confirmation", async () => {
    api.routes["project.list"] = () => ({ projects: known });
    api.routes["project.delete"] = (i) => ({ dir: i.dir, deleted: false });
    const { app: a } = mount(<ProjectStep onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for Gone" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText("Project Gone removed")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(named("project.delete")[0].input).toEqual({ dir: "C:/gone" });
    expect(screen.queryByRole("button", { name: "More actions for Gone" })).toBeNull();
    expect(a.closeProject).not.toHaveBeenCalled();
  });

  it("reports a delete that fails and keeps the project", async () => {
    api.routes["project.list"] = () => ({ projects: known });
    mount(<ProjectStep onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for C:/other" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete the folder" }));
    expect(await screen.findByText("Could not delete the project")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "More actions for C:/other" })).toBeInTheDocument();
  });

  it("reports a project that cannot be opened", async () => {
    api.routes["project.list"] = () => ({ projects: known });
    mount(<ProjectStep onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open again" }));
    expect(await screen.findByText("Could not open the project")).toBeInTheDocument();
    expect(screen.getAllByText("Unknown command project.open").length).toBeGreaterThan(0);
  });

  it("shows no list when the list is empty or unreadable", async () => {
    api.routes["project.list"] = () => null;
    mount(<ProjectStep onBack={vi.fn()} />);
    await waitFor(() => expect(named("project.list")).toHaveLength(1));
    await waitFor(() => expect(document.querySelector(".skeleton, [class*='skel']")).toBeNull());
    expect(screen.queryByRole("list", { name: "Known projects" })).toBeNull();
    cleanup();
    delete api.routes["project.list"];
    mount(<ProjectStep onBack={vi.fn()} />, { info: null });
    await waitFor(() => expect(named("project.list")).toHaveLength(2));
    expect(screen.queryByRole("list", { name: "Known projects" })).toBeNull();
  });

  it("creates a project in its own folder under the projects folder, then opens it", async () => {
    api.routes["project.list"] = () => ({ projects: [], root: "D:\\Testimus\\Projects" });
    api.routes["project.init"] = () => ({});
    api.routes["project.open"] = (i) => ({ dir: i.dir });
    const onOpened = vi.fn();
    mount(<ProjectStep onBack={vi.fn()} onOpened={onOpened} />);
    await waitFor(() => expect(screen.getByLabelText("Projects folder")).toHaveValue("D:\\Testimus\\Projects"));
    const create = screen.getByRole("button", { name: "Create the project" });
    expect(create).toBeDisabled();
    expect(screen.getByText(/gets its own folder in it/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Jira project"), { target: { value: " lfr " } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " RATP: Sosie. " } });
    fireEvent.change(screen.getByLabelText("Language of the tests"), { target: { value: "en" } });
    expect(screen.getByText("D:\\Testimus\\Projects\\RATP Sosie")).toBeInTheDocument();
    fireEvent.click(create);
    await waitFor(() => expect(onOpened).toHaveBeenCalled());
    expect(named("project.init")[0].input).toEqual({
      dir: "D:\\Testimus\\Projects\\RATP Sosie",
      jiraProject: "LFR",
      name: "RATP: Sosie.",
      language: "en",
    });
    expect(named("project.open")[0].input).toEqual({ dir: "D:\\Testimus\\Projects\\RATP Sosie" });
  });

  it("names the project folder with the separator of the projects folder", () => {
    expect(projectFolder("D:\\Testimus\\Projects\\", "Aller")).toBe("D:\\Testimus\\Projects\\Aller");
    expect(projectFolder("/Users/ana/Testimus/Projects/", "Aller")).toBe("/Users/ana/Testimus/Projects/Aller");
    expect(projectFolder("/Users/ana", "")).toBe("");
  });

  it("without a name the folder is the Jira key; a typed projects folder wins; a failed creation says why", async () => {
    api.routes["project.list"] = () => ({ projects: [] });
    mount(<ProjectStep onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Projects folder"), { target: { value: " E:\\Mine\\ " } });
    fireEvent.change(screen.getByLabelText("Jira project"), { target: { value: "bhptcc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the project" }));
    expect(await screen.findByText("Unknown command project.init")).toBeInTheDocument();
    expect(named("project.init")[0].input).toEqual({ dir: "E:\\Mine\\BHPTCC", jiraProject: "BHPTCC", language: "fr" });
    expect(screen.getByRole("button", { name: "Create the project" })).toBeEnabled();
  });

  it("the Browse button is disabled while busy", async () => {
    fakeDesktop();
    api.routes["project.list"] = () => ({ projects: known });
    let release = () => {};
    api.routes["project.open"] = (i) => ({ dir: i.dir });
    const f = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("project/open"))
          await new Promise<void>((r) => {
            release = r;
          });
        return f(url, init);
      }),
    );
    mount(<ProjectStep onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Browse for the projects folder" })).toBeDisabled());
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Browse for the projects folder" })).toBeEnabled());
  });
});

describe("First launch › Search pack", () => {
  const fit = { verdict: "fits", device: "cpu", needMB: {}, freeMB: {}, totalMB: {}, unload: [], message: "Fits." };
  const pack = (over: Record<string, unknown>) => ({
    id: "light",
    label: "Light",
    intent: "Small",
    active: false,
    available: true,
    variant: 0,
    embedding: "e1",
    reranker: null,
    fit,
    skipped: [],
    downloadMB: 0,
    quality: "",
    ...over,
  });
  const packPlan = (download: { sizeMB: number }[], dir: string | null) => (i: Record<string, unknown>) => ({
    pack: i.pack,
    variant: 0,
    embedding: "e1",
    reranker: null,
    plan: { download, dir, reindex: true, expected: "" },
  });

  it("describes each pack: suggested, in use, models, download, unavailable", async () => {
    api.routes["models.packs"] = () => [
      pack({ id: "quality", label: "Quality", available: false, embedding: null, skipped: ["needs a GPU"] }),
      pack({ id: "balanced", label: "Balanced", available: false, skipped: [] }),
      pack({ id: "performance", label: "Performance", suggested: true, reranker: "r1", downloadMB: 2048 }),
      pack({ id: "light", active: true }),
    ];
    api.routes["models.catalog"] = () => [{ id: "e1", label: "Embed One", runtimes: ["transformers"] }];
    api.routes["models.hardware"] = () => ({
      ramTotalMB: 16384,
      ramFreeMB: 8192,
      cpu: { model: "Core", threads: 8 },
      gpus: [{ name: "RTX", vramTotalMB: 8192, vramUsedMB: 1024 }],
      drives: [],
    });
    mount(<PackStep onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Analyse my machine" }));
    expect(await screen.findByText("RTX, 8.0 GB (7.0 GB free)")).toBeInTheDocument();
    expect(screen.getByText("Windows")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Performance pack" })).toBeChecked();
    expect(screen.getByText("Not available on this PC: needs a GPU")).toBeInTheDocument();
    expect(screen.getByText("Not available on this PC")).toBeInTheDocument();
    expect(screen.getByText("Embed One + r1 · 2.0 GB to download")).toBeInTheDocument();
    expect(screen.getByText("Embed One · nothing to download")).toBeInTheDocument();
    expect(screen.getByText("In use")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Quality pack" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Light pack" }));
    expect(screen.getByRole("button", { name: "Use Light" })).toBeEnabled();
  });

  it("shows the loading state, then the error when the packs cannot be read", async () => {
    mount(<PackStep onBack={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Loading the packs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this pack" })).toBeDisabled();
    expect(await screen.findByText("The packs could not be read")).toBeInTheDocument();
    expect(screen.getByText("Unknown command models.packs")).toBeInTheDocument();
  });

  it("an empty answer leaves no pack to use", async () => {
    api.routes["models.packs"] = () => null;
    api.routes["models.catalog"] = () => null;
    mount(<PackStep onBack={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading the packs" })).toBeNull());
    expect(screen.getByRole("button", { name: "Use this pack" })).toBeDisabled();
    expect(screen.getByRole("group", { name: "Search packs" })).toBeEmptyDOMElement();
  });

  it("asks for a models folder before a download, then uses the pack", async () => {
    let dir: string | null = null;
    api.routes["models.packs"] = () => [pack({ downloadMB: 300 })];
    api.routes["models.catalog"] = () => [];
    api.routes["models.hardware"] = () => null;
    api.routes["models.planPack"] = (i) => packPlan([{ sizeMB: 100 }, { sizeMB: 200 }], dir)(i);
    api.routes["models.usePack"] = () => ({ jobId: "models-usePack-1" });
    const { app: a } = mount(<PackStep onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Light pack" }));
    fireEvent.click(screen.getByRole("button", { name: "Use Light" }));
    expect(await screen.findByText("need 300")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close folder" }));
    expect(screen.queryByRole("dialog", { name: "Folder" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use Light" }));
    await screen.findByText("need 300");
    dir = "D:/models";
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("documents"));
    expect(await screen.findByText("Downloading in the background: see Jobs")).toBeInTheDocument();
    expect(named("models.usePack").at(-1)?.input).toEqual({ pack: "light" });
  });

  it("uses a pack with nothing to download, and reports a failure", async () => {
    api.routes["models.packs"] = () => [pack({})];
    api.routes["models.catalog"] = () => [];
    api.routes["models.hardware"] = () => null;
    api.routes["models.planPack"] = packPlan([], null);
    api.routes["models.usePack"] = () => ({ jobId: "models-usePack-2" });
    const { app: a } = mount(<PackStep onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Light pack" }));
    fireEvent.click(screen.getByRole("button", { name: "Use Light" }));
    expect(await screen.findByText("Indexing follows")).toBeInTheDocument();
    expect(a.navigate).toHaveBeenCalledWith("documents");
    delete api.routes["models.usePack"];
    fireEvent.click(screen.getByRole("button", { name: "Use Light" }));
    expect(await screen.findByText("Could not use the Light pack")).toBeInTheDocument();
  });

  it("Back calls back", async () => {
    const onBack = vi.fn();
    api.routes["models.packs"] = () => [];
    mount(<PackStep onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });
});
