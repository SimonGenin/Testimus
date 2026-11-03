// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { project, setProject } from "../../../../src/ui/api.ts";
import { ProjectButton } from "../../../../src/ui/components/shell/ProjectButton.tsx";
import type { AppState } from "../../../../src/ui/lib/app.ts";
import { callsOf, Fail, fakeEvents, fakeNet, net } from "../../cov-uishell-helpers.tsx";
import { app, fakeDesktop, noDesktop } from "../../ui-desktop-helpers.tsx";
import { clearAllToasts, withData } from "./helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
});

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
  localStorage.clear();
  document.title = "";
});

describe("ProjectButton", () => {
  const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /change project/ }));

  it("lists the known projects and switches to one", async () => {
    net.routes["project.list"] = () => ({
      projects: ["D:\\Other", { dir: "C:\\p", name: "Here", jiraProject: "LFRPS12" }, null, 3, { nodir: 1 }],
    });
    const { state } = withData(<ProjectButton />);
    expect(screen.getByRole("button", { name: "Project LFRPS12 RATP Sosie, change project" })).toBeInTheDocument();
    openMenu();
    expect(await screen.findByRole("menuitemcheckbox", { name: /Other/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menuitemcheckbox", { name: /Here/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("menuitem", { name: /Open a folder/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Other/ }));
    expect(project()).toBe("D:\\Other");
    expect(localStorage.getItem("testimus.project")).toBe("D:\\Other");
    expect(state.refreshInfo).toHaveBeenCalled();
    expect(state.testsChanged).toHaveBeenCalled();
    const reads = callsOf("project.list").length;
    openMenu();
    await waitFor(() => expect(callsOf("project.list").length).toBe(reads + 1));
    openMenu();
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /New or other project/ }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "project");
  });

  it("opens a project by its Jira key from the menu", async () => {
    net.routes["project.list"] = () => [];
    net.routes["project.openKey"] = (i) => ({
      dir: "D:WorkBHPTCC",
      name: "BHPTCC",
      jiraProject: "BHPTCC",
      created: true,
      key: i.key,
    });
    net.routes["project.open"] = (i) => ({ dir: i.dir, name: "BHPTCC", jiraProject: "BHPTCC" });
    const { state } = withData(<ProjectButton />);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Open by Jira key/ }));
    const dlg = screen.getByRole("dialog", { name: "Open a project by its Jira key" });
    fireEvent.change(within(dlg).getByLabelText("Jira project key"), { target: { value: "bhptcc" } });
    expect(within(dlg).getByLabelText("Jira project key")).toHaveValue("BHPTCC");
    fireEvent.click(within(dlg).getByRole("button", { name: "Go" }));
    await waitFor(() => expect(callsOf("project.openKey")[0]?.input).toEqual({ key: "BHPTCC" }));
    await waitFor(() => expect(project()).toBe("D:WorkBHPTCC"));
    expect(state.refreshInfo).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Open a project by its Jira key" })).toBeNull());
  });

  it("says when no other project is known, and when the list fails", async () => {
    net.routes["project.list"] = () => [];
    withData(<ProjectButton />, { info: null });
    expect(
      screen.getByRole("button", { name: "Project not connected to Jira No project, change project" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(callsOf("project.list")).toHaveLength(1));
    openMenu();
    expect(screen.getByRole("menuitem", { name: "No other project known yet" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    openMenu();
    net.routes["project.list"] = () => {
      throw new Fail("core down");
    };
    openMenu();
    expect(await screen.findByText("Could not list the projects")).toBeInTheDocument();
  });

  it("names a project without a name after its folder", () => {
    const base = app().info as NonNullable<AppState["info"]>;
    withData(<ProjectButton />, {
      info: { ...base, dir: "D:\\Projets\\Sosie", project: { ...base.project, name: "", jiraProject: "" } },
    });
    expect(
      screen.getByRole("button", { name: "Project not connected to Jira Sosie, change project" }),
    ).toBeInTheDocument();
  });

  it("in the desktop shell: opens a folder and shows the project in Explorer", async () => {
    const d = fakeDesktop({ folder: "D:\\Picked" });
    net.routes["project.list"] = () => [];
    net.routes["project.open"] = (i) => ({ dir: i.dir });
    const { state } = withData(<ProjectButton />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Show in Explorer/ }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith("C:\\p"));
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Open a folder/ }));
    await waitFor(() => expect(state.refreshInfo).toHaveBeenCalled());
    expect(callsOf("project.open")[0].input).toEqual({ dir: "D:\\Picked" });
    d.pickFolder.mockResolvedValueOnce(null);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Open a folder/ }));
    await waitFor(() => expect(d.pickFolder).toHaveBeenCalledTimes(2));
    expect(callsOf("project.open")).toHaveLength(1);
    net.routes["project.open"] = () => {
      throw new Fail("not a project");
    };
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Open a folder/ }));
    expect(await screen.findByText("Could not open the project")).toBeInTheDocument();
  });

  it("in the desktop shell without a project: no Show in Explorer", () => {
    fakeDesktop();
    net.routes["project.list"] = () => [];
    withData(<ProjectButton />, { info: null });
    openMenu();
    expect(screen.getByRole("menuitem", { name: /Open a folder/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Show in Explorer/ })).toBeNull();
  });
});

describe("Project menu", () => {
  beforeEach(() => {
    setProject("C:\\p");
    net.routes["project.list"] = () => ({ projects: [{ dir: "C:\\p", name: "RATP Sosie", jiraProject: "LFRPS12" }] });
    net.routes["project.open"] = (i) => ({ dir: i.dir });
  });

  const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /^Project LFRPS12/ }));

  it("Open a folder… picks a folder and opens it as the project", async () => {
    fakeDesktop({ folder: "D:\\Projets\\BHPTCC" });
    const { state: a } = withData(<ProjectButton />);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open a folder…" }));
    await waitFor(() => expect(callsOf("project.open")).toHaveLength(1));
    expect(callsOf("project.open")[0].input).toEqual({ dir: "D:\\Projets\\BHPTCC" });
    await waitFor(() => expect(a.refreshInfo).toHaveBeenCalled());
    expect(project()).toBe("D:\\Projets\\BHPTCC");
    expect(localStorage.getItem("testimus.project")).toBe("D:\\Projets\\BHPTCC");
  });

  it("Show in Explorer reveals the project folder", async () => {
    const d = fakeDesktop();
    withData(<ProjectButton />);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Show in Explorer" }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith("C:\\p"));
  });

  it("a refused reveal says so", async () => {
    const d = fakeDesktop();
    d.reveal.mockResolvedValue(false);
    withData(<ProjectButton />);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Show in Explorer" }));
    expect(await screen.findByText("Could not show it in Explorer")).toBeInTheDocument();
  });

  it("without the bridge: neither item", async () => {
    withData(<ProjectButton />);
    openMenu();
    await screen.findByRole("menuitem", { name: "New or other project…" });
    expect(screen.queryByRole("menuitem", { name: "Open a folder…" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Show in Explorer" })).toBeNull();
  });
});
