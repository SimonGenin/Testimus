// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { AccessStep } from "../../../../src/ui/screens/setup/AccessStep.tsx";
import { FirstRunScreen } from "../../../../src/ui/screens/setup/FirstRunScreen.tsx";
import { ProjectStep, projectFolder } from "../../../../src/ui/screens/setup/ProjectStep.tsx";
import { callsOf, deferred, Fail, fakeEvents, fakeNet, net, withApp } from "../../cov-uishell-helpers.tsx";
import { fakeDesktop, noDesktop } from "../../ui-desktop-helpers.tsx";

const toasts = vi.hoisted(() => ({ toast: vi.fn(), errorToast: vi.fn() }));
vi.mock("../../../../src/ui/lib/toast.ts", () => toasts);

const titles = () => toasts.toast.mock.calls.map((a) => a[0].title);
const errors = () => toasts.errorToast.mock.calls.map((a) => a[1]);

type Known = { dir: string; name: string; jiraProject: string; exists: boolean };
let projects: Known[] = [];

beforeEach(() => {
  fakeNet();
  fakeEvents();
  toasts.toast.mockClear();
  toasts.errorToast.mockClear();
  projects = [];
  net.routes["project.list"] = () => ({ projects, root: "", last: "" });
});

afterEach(() => {
  cleanup();
  noDesktop();
  setProject(null);
  localStorage.clear();
  vi.unstubAllGlobals();
});

const status = (jira: Record<string, unknown> = {}, xray: Record<string, unknown> = {}) => ({
  jira: { file: "f", exists: true, complete: true, baseUrl: "https://acme.atlassian.net/wiki", email: "me@a", ...jira },
  xray: { file: "x", exists: true, complete: true, ...xray },
});

const steps = () => screen.getByRole("list", { name: "Setup steps" });

describe("First launch screen", () => {
  it("walks the steps and goes back to the app", () => {
    net.routes["system.credentials"] = net.routes["system.setCredentials"] = () => ({ status: status() });
    const { state } = withApp(<FirstRunScreen />, { route: { screen: "setup" } });
    const pills = within(steps()).getAllByRole("listitem");
    expect(pills[0]).toHaveAttribute("aria-current", "step");
    fireEvent.click(within(pills[2]).getByRole("button", { name: /Search pack/ }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "pack");
    fireEvent.click(within(pills[0]).getByRole("button", { name: /Access/ }));
    expect(state.navigate).toHaveBeenCalledWith("setup", undefined);
    fireEvent.click(screen.getByRole("button", { name: "Back to the app" }));
    expect(state.navigate).toHaveBeenCalledWith("tests");
  });

  it("on the project step: back goes to Access, opening goes to the pack", async () => {
    projects = [{ dir: "C:/q", name: "Q", jiraProject: "Q1", exists: true }];
    net.routes["project.open"] = (i) => ({ dir: i.dir });
    const { state } = withApp(<FirstRunScreen />, { info: null, route: { screen: "setup", arg: "project" } });
    expect(screen.queryByRole("button", { name: "Back to the app" })).toBeNull();
    const pills = within(steps()).getAllByRole("listitem");
    expect(pills[1]).toHaveAttribute("aria-current", "step");
    expect(within(pills[0]).getByRole("img", { name: "Done" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(state.navigate).toHaveBeenCalledWith("setup", undefined);
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("setup", "pack"));
  });

  it("on the access step, Continue and Skip go to the project", async () => {
    net.routes["system.credentials"] = net.routes["system.setCredentials"] = () => ({ status: status() });
    const { state } = withApp(<FirstRunScreen />, { route: { screen: "setup" } });
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(state.navigate).toHaveBeenNthCalledWith(1, "setup", "project");
    expect(state.navigate).toHaveBeenNthCalledWith(2, "setup", "project");
  });

  it("on the pack step, Back goes to the project", () => {
    const { state } = withApp(<FirstRunScreen />, { info: null, route: { screen: "setup", arg: "pack" } });
    fireEvent.click(screen.getByRole("button", { name: "Back to Project" }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "project");
  });

  it("asks no project command on the pack step without a project", async () => {
    withApp(<FirstRunScreen />, { info: null, route: { screen: "setup", arg: "pack" } });
    expect(screen.getByText(/Open or create a project first/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(net.calls.filter((c) => c.name.startsWith("models."))).toEqual([]);
  });
});

describe("First launch › Access", () => {
  it("the found banner, Continue and Skip, and the banner gone once all is ok", async () => {
    let n = 0;
    net.routes["system.credentials"] = net.routes["system.setCredentials"] = () =>
      n++ === 0 ? { status: status() } : { status: status(), saved: [], ok: true, checks: [] };
    const onContinue = vi.fn();
    const onSkip = vi.fn();
    withApp(<AccessStep onContinue={onContinue} onSkip={onSkip} />);
    expect(await screen.findByText(/We found the access you already use/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" }).className).toMatch(/primary/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onContinue).toHaveBeenCalled();
    expect(onSkip).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save and test the connection" }));
    await waitFor(() => expect(screen.queryByText(/We found the access/)).toBeNull());
  });

  it("without access: no banner, a secondary Continue", async () => {
    net.routes["system.credentials"] = net.routes["system.setCredentials"] = () => ({
      status: status({ complete: false }),
    });
    net.routes["system.secrets"] = () => ({});
    withApp(<AccessStep onContinue={vi.fn()} onSkip={vi.fn()} />);
    await screen.findByLabelText("Jira site");
    expect(screen.queryByText(/We found the access/)).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" }).className).not.toMatch(/primary/);
  });

  it("the token page opens in the default browser through the bridge, or in a new tab", async () => {
    const TOKENS = "https://id.atlassian.com/manage-profile/security/api-tokens";
    net.routes["system.credentials"] = net.routes["system.setCredentials"] = () => ({
      status: {
        jira: { file: "", exists: false, complete: false },
        xray: { file: "", exists: false, complete: false },
      },
      saved: [],
      checks: [],
      ok: false,
    });
    net.routes["system.secrets"] = () => ({});
    const d = fakeDesktop();
    withApp(<AccessStep onContinue={() => {}} onSkip={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open API tokens" }));
    expect(d.openExternal).toHaveBeenCalledWith(TOKENS);
    cleanup();
    noDesktop();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    withApp(<AccessStep onContinue={() => {}} onSkip={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open API tokens" }));
    expect(open).toHaveBeenCalledWith(TOKENS, "_blank", "noopener,noreferrer");
  });
});

describe("First launch › Project", () => {
  const known = (): Known[] => [
    { dir: "C:\\p", name: "Current", jiraProject: "LFRPS12", exists: true },
    { dir: "C:/other", name: "", jiraProject: "BHP", exists: true },
    { dir: "C:/gone", name: "Gone", jiraProject: "X", exists: false },
  ];
  const forgets = () => {
    net.routes["project.forget"] = (i) => {
      projects = projects.filter((p) => p.dir !== i.dir);
      return { dir: i.dir, forgotten: true };
    };
  };
  const deletes = (deleted = true) => {
    net.routes["project.delete"] = (i) => {
      projects = projects.filter((p) => p.dir !== i.dir);
      return { dir: i.dir, deleted };
    };
  };
  const list = () => screen.findByRole("list", { name: "Known projects" });
  const more = (name: string) => screen.getByRole("button", { name: `More actions for ${name}` });

  it("lists the known projects and opens one, then the documents", async () => {
    projects = known();
    net.routes["project.open"] = (i) => ({ dir: i.dir });
    const { state } = withApp(<ProjectStep onBack={vi.fn()} />);
    const items = within(await list()).getAllByRole("listitem");
    expect(within(items[0]).getByRole("button", { name: "Open again" })).toBeInTheDocument();
    expect(within(items[1]).getAllByText("C:/other")).toHaveLength(2);
    expect(within(items[1]).getByText("BHP")).toBeInTheDocument();
    expect(within(items[2]).getByText("Folder not found")).toBeInTheDocument();
    fireEvent.click(within(items[1]).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("documents"));
    expect(callsOf("project.open")[0].input).toEqual({ dir: "C:/other" });
    expect(state.refreshInfo).toHaveBeenCalled();
    expect(state.testsChanged).toHaveBeenCalled();
  });

  it("hides a project with Don't show, and reports a hide that fails", async () => {
    projects = known();
    forgets();
    withApp(<ProjectStep onBack={vi.fn()} />);
    await list();
    fireEvent.click(more("C:/other"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Don't show/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "More actions for C:/other" })).toBeNull());
    expect(callsOf("project.forget")[0].input).toEqual({ dir: "C:/other" });
    net.routes["project.forget"] = () => {
      throw new Fail("locked");
    };
    fireEvent.click(more("Gone"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Don't show/ }));
    await waitFor(() => expect(errors()).toContain("Could not hide the project"));
    await waitFor(() => expect(screen.getByText("Gone")).toBeInTheDocument());
  });

  it("deletes a project folder after a confirmation", async () => {
    projects = known();
    deletes();
    const { state } = withApp(<ProjectStep onBack={vi.fn()} />);
    await list();
    fireEvent.click(more("C:/other"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete/ }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete the project folder?" });
    expect(within(dialog).getByText(/Nothing is deleted in Jira/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(callsOf("project.delete")).toHaveLength(0);
    fireEvent.click(more("C:/other"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete the folder" }));
    await waitFor(() => expect(titles()).toContain("Project C:/other deleted"));
    expect(callsOf("project.delete")[0].input).toEqual({ dir: "C:/other" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByRole("button", { name: "More actions for C:/other" })).toBeNull();
    expect(state.closeProject).not.toHaveBeenCalled();
  });

  it("deletes the open project and closes it", async () => {
    projects = known();
    deletes();
    const { state } = withApp(<ProjectStep onBack={vi.fn()} />);
    await list();
    fireEvent.click(more("Current"));
    expect(screen.getByRole("menuitem", { name: /^Delete/ })).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete/ }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete the project folder?" });
    expect(within(dialog).getByText(/It is the open project/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete the folder" }));
    await waitFor(() => expect(titles()).toContain("Project Current deleted"));
    expect(callsOf("project.delete")[0].input).toEqual({ dir: "C:\\p" });
    expect(state.closeProject).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("button", { name: "More actions for Current" })).toBeNull());
  });

  it("removes a project whose folder is gone without a confirmation", async () => {
    projects = known();
    deletes(false);
    const { state } = withApp(<ProjectStep onBack={vi.fn()} />);
    await list();
    fireEvent.click(more("Gone"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete/ }));
    await waitFor(() => expect(titles()).toContain("Project Gone removed"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(callsOf("project.delete")[0].input).toEqual({ dir: "C:/gone" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "More actions for Gone" })).toBeNull());
    expect(state.closeProject).not.toHaveBeenCalled();
  });

  it("reports a delete that fails and keeps the project", async () => {
    projects = known();
    withApp(<ProjectStep onBack={vi.fn()} />);
    await list();
    fireEvent.click(more("C:/other"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete the folder" }));
    await waitFor(() => expect(errors()).toContain("Could not delete the project"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(more("C:/other")).toBeInTheDocument());
  });

  it("reports a project that cannot be opened", async () => {
    projects = known();
    withApp(<ProjectStep onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open again" }));
    await waitFor(() => expect(errors()).toContain("Could not open the project"));
    expect(screen.getByText("Unknown command project.open")).toBeInTheDocument();
  });

  it("shows no list when the list is empty or unreadable", async () => {
    net.routes["project.list"] = () => null;
    withApp(<ProjectStep onBack={vi.fn()} />);
    await waitFor(() => expect(callsOf("project.list")).toHaveLength(1));
    await screen.findByRole("button", { name: "Create the project" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Your projects" })).toBeNull());
    expect(screen.queryByRole("list", { name: "Known projects" })).toBeNull();
    cleanup();
    delete net.routes["project.list"];
    withApp(<ProjectStep onBack={vi.fn()} />, { info: null });
    await waitFor(() => expect(callsOf("project.list")).toHaveLength(2));
    expect(screen.queryByRole("list", { name: "Known projects" })).toBeNull();
  });

  it("creates a project in its own folder under the projects folder, then opens it", async () => {
    net.routes["project.list"] = () => ({ projects: [], root: "D:\\Testimus\\Projects", last: "" });
    net.routes["project.init"] = (i) => ({ dir: i.dir });
    const onOpened = vi.fn();
    withApp(<ProjectStep onBack={vi.fn()} onOpened={onOpened} />);
    await waitFor(() => expect(screen.getByLabelText("Projects folder")).toHaveValue("D:\\Testimus\\Projects"));
    const create = screen.getByRole("button", { name: "Create the project" });
    expect(create).toBeDisabled();
    expect(screen.getByText(/gets its own folder in it/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Jira project"), { target: { value: " lfr " } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " RATP: Sosie. " } });
    fireEvent.change(screen.getByLabelText("Language of the tests"), { target: { value: "en" } });
    expect(screen.getByText(/D:\\Testimus\\Projects\\RATP Sosie$/)).toBeInTheDocument();
    fireEvent.click(create);
    await waitFor(() => expect(onOpened).toHaveBeenCalled());
    expect(callsOf("project.init")[0].input).toEqual({
      dir: "D:\\Testimus\\Projects\\RATP Sosie",
      jiraProject: "LFR",
      name: "RATP: Sosie.",
      language: "en",
    });
    expect(callsOf("project.open")).toEqual([]);
  });

  it("names the project folder with the separator of the projects folder", () => {
    expect(projectFolder("D:\\Testimus\\Projects\\", "Aller")).toBe("D:\\Testimus\\Projects\\Aller");
    expect(projectFolder("/Users/ana/Testimus/Projects/", "Aller")).toBe("/Users/ana/Testimus/Projects/Aller");
    expect(projectFolder("/Users/ana", "")).toBe("");
  });

  it("without a name the folder is the Jira key; a typed projects folder wins; a failed creation says why", async () => {
    withApp(<ProjectStep onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Projects folder"), { target: { value: " E:\\Mine\\ " } });
    fireEvent.change(screen.getByLabelText("Jira project"), { target: { value: "bhptcc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the project" }));
    expect(await screen.findByText("Unknown command project.init")).toBeInTheDocument();
    expect(callsOf("project.init")[0].input).toEqual({
      dir: "E:\\Mine\\BHPTCC",
      jiraProject: "BHPTCC",
      language: "fr",
    });
    expect(screen.getByRole("button", { name: "Create the project" })).toBeEnabled();
  });

  it("keeps what was typed when the screen comes back", async () => {
    const first = withApp(<ProjectStep onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kept" } });
    first.unmount();
    withApp(<ProjectStep onBack={vi.fn()} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Kept");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
  });

  it("the Browse button is disabled while busy", async () => {
    fakeDesktop();
    projects = known();
    const gate = deferred();
    net.routes["project.open"] = async (i) => {
      await gate.promise;
      return { dir: i.dir };
    };
    withApp(<ProjectStep onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Browse…" })).toBeDisabled());
    gate.resolve(null);
    await waitFor(() => expect(screen.getByRole("button", { name: "Browse…" })).toBeEnabled());
  });

  it("Browse… puts the picked folder in the field; a cancelled dialog leaves it alone", async () => {
    const d = fakeDesktop({ folder: "D:\\Tests\\Nouveau" });
    withApp(<ProjectStep onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(screen.getByLabelText("Projects folder")).toHaveValue("D:\\Tests\\Nouveau"));
    expect(d.pickFolder).toHaveBeenCalledWith({ title: "Choose where the project goes" });
    d.pickFolder.mockResolvedValueOnce(null);
    fireEvent.change(screen.getByLabelText("Projects folder"), { target: { value: "C:\\typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(d.pickFolder).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Projects folder")).toHaveValue("C:\\typed");
    fireEvent.change(screen.getByLabelText("Projects folder"), { target: { value: "" } });
  });

  it("on the desktop: opens a project folder and shows a known one in Explorer", async () => {
    const d = fakeDesktop({ folder: "E:\\Projects\\Old" });
    projects = known();
    net.routes["project.open"] = (i) => ({ dir: i.dir });
    const { state } = withApp(<ProjectStep onBack={() => {}} />);
    await list();
    fireEvent.click(screen.getByRole("button", { name: "Open a project folder…" }));
    await waitFor(() => expect(callsOf("project.open")[0]?.input).toEqual({ dir: "E:\\Projects\\Old" }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("documents"));
    fireEvent.click(more("Current"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show in Explorer" }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith("C:\\p"));
  });

  it("without the bridge: the text field only", () => {
    withApp(<ProjectStep onBack={() => {}} />);
    expect(screen.getByLabelText("Projects folder")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Browse/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Open a project folder/ })).toBeNull();
  });
});
