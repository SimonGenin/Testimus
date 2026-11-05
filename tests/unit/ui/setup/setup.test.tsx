// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { AccessStep } from "../../../../src/ui/screens/setup/AccessStep.tsx";
import { FirstRunScreen } from "../../../../src/ui/screens/setup/FirstRunScreen.tsx";
import { ProjectStep, projectFolder } from "../../../../src/ui/screens/setup/ProjectStep.tsx";
import { iconsIn } from "../../helpers/icons.ts";
import { choose } from "../../helpers/select.ts";
import { callsOf, deferred, Fail, fakeEvents, fakeNet, net, withApp } from "../../helpers/ui-data.tsx";
import { fakeDesktop, noDesktop } from "../../helpers/ui-desktop.tsx";

const toasts = vi.hoisted(() => ({ toast: vi.fn(), errorToast: vi.fn(), jobToast: vi.fn() }));
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
  toasts.jobToast.mockClear();
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

const check = (id: "jira" | "xray", state: "ok" | "fail" = "ok", detail?: string) => ({
  id,
  label: id,
  state,
  detail: detail ?? (id === "jira" ? "Me Myself on acme.atlassian.net" : "authenticated on xray.cloud.getxray.app"),
});

const access = (checks: ReturnType<typeof check>[], st = status()) => {
  net.routes["system.credentials"] = (i) => (i.check ? { status: st, checks, ok: false } : { status: st });
};

const settingsWith = (atlassian: Record<string, boolean> = {}) => {
  let s = { projects: [], lastProject: "", claude: { exe: "" }, models: { allowRemote: true }, atlassian };
  net.routes["system.settings"] = () => s;
  net.routes["system.set"] = (i) => {
    const { skipJira, skipXray } = i as { skipJira?: boolean; skipXray?: boolean };
    s = {
      ...s,
      atlassian: {
        ...s.atlassian,
        ...(skipJira === undefined ? {} : { skipJira }),
        ...(skipXray === undefined ? {} : { skipXray }),
      },
    };
    return s;
  };
};

const nothingSaved = () => status({ exists: false, complete: false }, { exists: false, complete: false });

describe("First launch screen", () => {
  it("walks the steps and goes back to the app", () => {
    settingsWith();
    const { state } = withApp(<FirstRunScreen />, { route: { screen: "setup" } });
    const pills = within(steps()).getAllByRole("listitem");
    expect(pills.map((p) => p.textContent?.replace(/^\d/, ""))).toEqual([
      "Welcome",
      "Claude",
      "Jira & Xray",
      "Project",
      "Search",
    ]);
    expect(pills[0]).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("heading", { level: 1, name: "Welcome to Testimus" })).toBeInTheDocument();
    fireEvent.click(within(pills[4]).getByRole("button", { name: /Search/ }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "pack");
    fireEvent.click(within(pills[2]).getByRole("button", { name: /Jira & Xray/ }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "access");
    fireEvent.click(within(pills[0]).getByRole("button", { name: /Welcome/ }));
    expect(state.navigate).toHaveBeenCalledWith("setup", undefined);
    fireEvent.click(screen.getByRole("button", { name: "Back to the app" }));
    expect(state.navigate).toHaveBeenCalledWith("documents");
  });

  it("on the project step: back goes to Jira & Xray, opening goes to the search step", async () => {
    settingsWith();
    projects = [{ dir: "C:/q", name: "Q", jiraProject: "Q1", exists: true }];
    net.routes["project.open"] = (i) => ({ dir: i.dir });
    const { state } = withApp(<FirstRunScreen />, { info: null, route: { screen: "setup", arg: "project" } });
    expect(screen.queryByRole("button", { name: "Back to the app" })).toBeNull();
    const pills = within(steps()).getAllByRole("listitem");
    expect(pills[3]).toHaveAttribute("aria-current", "step");
    expect(within(pills[0]).getByRole("img", { name: "Done" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "access");
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("setup", "pack"));
  });

  it("with Jira left out, the Claude step and the project step skip Jira & Xray", async () => {
    settingsWith({ skipJira: true });
    net.routes["claude.status"] = () => ({ installed: false, signedIn: false, detail: "claude: not found" });
    const { state } = withApp(<FirstRunScreen />, { info: null, route: { screen: "setup", arg: "claude" } });
    await screen.findByText("Claude Code is not installed");
    await waitFor(() => expect(callsOf("system.settings").length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(screen.getByRole("button", { name: "Continue without Claude" }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "project");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(state.navigate).toHaveBeenCalledWith("setup", undefined);
    cleanup();
    const again = withApp(<FirstRunScreen />, { info: null, route: { screen: "setup", arg: "project" } });
    await waitFor(() => expect(callsOf("system.settings").length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(again.state.navigate).toHaveBeenCalledWith("setup", "claude");
  });

  it("the ready step has no step bar and opens the app", () => {
    settingsWith();
    const { state } = withApp(<FirstRunScreen />, { info: null, route: { screen: "setup", arg: "ready" } });
    expect(screen.queryByRole("list", { name: "Setup steps" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Testimus is ready" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open the app" }));
    expect(state.navigate).toHaveBeenCalledWith("tests");
  });

  it("on the pack step, Back goes to the project", () => {
    const { state } = withApp(<FirstRunScreen />, { info: null, route: { screen: "setup", arg: "pack" } });
    fireEvent.click(screen.getByRole("button", { name: "Back to Project" }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "project");
  });

  it("asks no project command on the pack step without a project", async () => {
    withApp(<FirstRunScreen />, { info: null, route: { screen: "setup", arg: "pack" } });
    expect(screen.getByText("Open a project first")).toBeInTheDocument();
    expect(screen.getByText("The pack is chosen per project, on this PC.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(net.calls.filter((c) => c.name.startsWith("models."))).toEqual([]);
  });
});

describe("First launch › Access", () => {
  it("access saved on this PC is tested on arrival: two green rows, the form folded, Continue", async () => {
    settingsWith();
    access([check("jira"), check("xray")]);
    const onContinue = vi.fn();
    withApp(<AccessStep onBack={vi.fn()} onContinue={onContinue} />);
    expect(await screen.findByText("Access already saved on this PC was found and tested.")).toBeInTheDocument();
    expect(callsOf("system.credentials").map((c) => c.input)).toEqual([{}, { check: true }]);
    expect(screen.getByText("Connected as Me Myself")).toBeInTheDocument();
    expect(screen.getByText("Key accepted")).toBeInTheDocument();
    expect(screen.getAllByText("Connected")).toHaveLength(2);
    expect(screen.queryByLabelText("Jira site")).toBeNull();
    expect(screen.getByRole("button", { name: "Change the access" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Continue" }).className).toMatch(/primary/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onContinue).toHaveBeenCalled());
    expect(callsOf("system.set")).toHaveLength(0);
  });

  it("Jira without an Xray key: Continue with Jira only leaves Xray out", async () => {
    settingsWith();
    access([check("jira"), check("xray", "fail", "Missing ~/.atlassian/xray_credentials.json.")]);
    const onContinue = vi.fn();
    withApp(<AccessStep onBack={vi.fn()} onContinue={onContinue} />);
    expect(await screen.findByText("Not set")).toBeInTheDocument();
    expect(screen.getByText("Without Xray: tests are read, not pushed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Jira only" }));
    await waitFor(() => expect(onContinue).toHaveBeenCalled());
    expect(callsOf("system.set").map((c) => c.input)).toEqual([{ skipJira: false, skipXray: true }]);
  });

  it("without access: the form open, Continue disabled, and Work without Jira", async () => {
    settingsWith();
    access([], nothingSaved());
    net.routes["system.secrets"] = () => ({});
    const onContinue = vi.fn();
    withApp(<AccessStep onBack={vi.fn()} onContinue={onContinue} />);
    expect(await screen.findByLabelText("Jira site")).toBeInTheDocument();
    expect(callsOf("system.credentials").map((c) => c.input)).toEqual([{}]);
    expect(screen.queryByText(/already saved/)).toBeNull();
    expect(screen.getAllByText("Not set")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveAccessibleDescription(
      "Connect Jira first — or work without it",
    );
    expect(iconsIn(screen.getByRole("button", { name: "Continue" })), "audit icons 98").toEqual(["chevron-right"]);
    fireEvent.click(screen.getByRole("button", { name: "Work without Jira" }));
    await waitFor(() => expect(onContinue).toHaveBeenCalled());
    expect(callsOf("system.set").map((c) => c.input)).toEqual([{ skipJira: true }]);
  });

  it("Jira left out shows both rows as not used", async () => {
    settingsWith({ skipJira: true });
    access([], nothingSaved());
    net.routes["system.secrets"] = () => ({});
    withApp(<AccessStep onBack={vi.fn()} onContinue={vi.fn()} />);
    expect(await screen.findByText("Left out: you chose to work without Jira.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Not used")).toHaveLength(2));
  });

  it("a connection saved in the form turns the rows green", async () => {
    settingsWith();
    access([], nothingSaved());
    net.routes["system.secrets"] = () => ({});
    net.routes["system.doctor"] = () => ({ ok: true, checks: [] });
    net.routes["system.setCredentials"] = () => ({
      status: status(),
      saved: ["baseUrl", "email", "token"],
      checks: [check("jira"), check("xray")],
      ok: true,
    });
    withApp(<AccessStep onBack={vi.fn()} onContinue={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Jira site"), { target: { value: "acme" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@a" } });
    fireEvent.change(screen.getByLabelText("API token"), { target: { value: "t" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test the connection" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    expect(screen.getAllByText("Connected").length).toBeGreaterThanOrEqual(2);
  });

  it("copies a request for the Jira admin", async () => {
    settingsWith();
    access([], nothingSaved());
    net.routes["system.secrets"] = () => ({});
    const writeText = vi.fn((_: string) => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    withApp(<AccessStep onBack={vi.fn()} onContinue={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "me@acme.com" } });
    fireEvent.change(screen.getByLabelText("Jira site"), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy a request for my admin" }));
    await waitFor(() => expect(titles()).toContain("Request copied"));
    const text = writeText.mock.calls[0][0];
    expect(text).toContain("for my Jira user (me@acme.com) on https://acme.atlassian.net?");
    expect(text).toContain("Settings → Apps → Xray → API Keys → Create API Key");
  });

  it("the token page opens in the default browser through the bridge, or in a new tab", async () => {
    const TOKENS = "https://id.atlassian.com/manage-profile/security/api-tokens";
    settingsWith();
    access([], nothingSaved());
    net.routes["system.secrets"] = () => ({});
    const d = fakeDesktop();
    withApp(<AccessStep onBack={() => {}} onContinue={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open API tokens" }));
    expect(d.openExternal).toHaveBeenCalledWith(TOKENS);
    cleanup();
    noDesktop();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    withApp(<AccessStep onBack={() => {}} onContinue={() => {}} />);
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
    expect(screen.getByRole("heading", { name: "Or start a new project" })).toBeInTheDocument();
    expect(within(items[0]).getByRole("button", { name: "Open again" })).toBeInTheDocument();
    expect(within(items[1]).getAllByText("C:/other")).toHaveLength(3);
    expect(
      within(items[1])
        .getAllByRole("tooltip", { hidden: true })
        .some((t) => t.textContent === "C:/other"),
    ).toBe(true);
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
    expect(await screen.findByText("Could not open the project")).toBeInTheDocument();
    expect(screen.getByText("Unknown command project.open")).toBeInTheDocument();
    expect(errors()).not.toContain("Could not open the project");
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
    expect(screen.getByRole("heading", { name: "New project" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Jira project key"), { target: { value: " lfr " } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " RATP: Sosie. " } });
    choose(screen.getByLabelText("Language of the tests"), "English");
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
    fireEvent.change(screen.getByLabelText("Jira project key"), { target: { value: "bhptcc" } });
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

  it("without the bridge: text fields only, and a shared folder opened by its path", async () => {
    net.routes["project.open"] = (i) => ({ dir: i.dir });
    const { state } = withApp(<ProjectStep onBack={() => {}} />);
    expect(screen.getByLabelText("Projects folder")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Browse/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open a project folder…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open a project folder shared with you" }));
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Project folder"), { target: { value: " \\\\srv\\share\\RATP " } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(callsOf("project.open")[0]?.input).toEqual({ dir: "\\\\srv\\share\\RATP" }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("documents"));
  });
});
