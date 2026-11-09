// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { project, setProject } from "../../../../src/ui/api.ts";
import { ProjectButton } from "../../../../src/ui/components/shell/ProjectButton.tsx";
import type { AppState } from "../../../../src/ui/lib/app.ts";
import { callsOf, Fail, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
import { app, fakeDesktop, noDesktop } from "../../helpers/ui-desktop.tsx";
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

const gone = ["Open a folder…", "Open by Jira key…", "New project…", "Show in Explorer"];

describe("ProjectButton", () => {
  const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /change project|^Open a project$/ }));

  it("lists the known projects, switches to one, and goes to every project from « All projects… »", async () => {
    net.routes["project.list"] = () => ({
      projects: ["D:\\Other", { dir: "C:\\p", name: "Here", jiraProject: "LFRPS12" }, null, 3, { nodir: 1 }],
    });
    const { state } = withData(<ProjectButton />);
    expect(screen.getByRole("button", { name: "Project LFRPS12 RATP Sosie, change project" })).toBeInTheDocument();
    openMenu();
    expect(await screen.findByRole("menuitemcheckbox", { name: /Other/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menuitemcheckbox", { name: /Here/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: /Here/ })).toHaveTextContent("LFRPS12");
    expect(screen.getByRole("menuitemcheckbox", { name: /Other/ })).toHaveTextContent("no key");
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["All projects…"]);
    for (const label of gone) expect(screen.queryByRole("menuitem", { name: label })).toBeNull();
    expect(screen.queryByText(/Don't show/)).toBeNull();
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
    fireEvent.click(await screen.findByRole("menuitem", { name: "All projects…" }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "project/app");
  });

  it("says when no other project is known, and when the list fails", async () => {
    net.routes["project.list"] = () => [];
    withData(<ProjectButton />, { info: null });
    const none = screen.getByRole("button", { name: "Open a project" });
    expect(none).not.toHaveTextContent(/[a-z]/i);
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

  it("in the desktop shell too: only the known projects and « All projects… »", async () => {
    const d = fakeDesktop({ folder: "D:\\Picked" });
    net.routes["project.list"] = () => [];
    const { state } = withData(<ProjectButton />);
    openMenu();
    await waitFor(() => expect(callsOf("project.list").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "No other project known yet",
      "All projects…",
    ]);
    for (const label of gone) expect(screen.queryByRole("menuitem", { name: label })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "All projects…" }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "project/app");
    expect(d.pickFolder).not.toHaveBeenCalled();
    expect(d.reveal).not.toHaveBeenCalled();
  });
});
