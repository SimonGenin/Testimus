// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { versionLabel } from "../../../../src/ui/lib/version.ts";
import { SettingsScreen } from "../../../../src/ui/screens/settings/SettingsScreen.tsx";
import { iconsIn } from "../../helpers/icons.ts";
import { calls, fakeNet, info, mountSettings, net, reset } from "./helpers.tsx";

vi.mock("../../../../src/ui/screens/settings/ModelsSection.tsx", () => ({
  ModelsSection: () => <section aria-label="Models stub">Models stub</section>,
}));

const scrolled: Element[] = [];
const real = Element.prototype.scrollIntoView;

beforeEach(() => {
  fakeNet();
  net.routes["project.info"] = () => info();
  net.routes["project.notes"] = () => ({ file: "C:\\p\\CLAUDE.md", text: "", mtime: 1 });
  net.routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true }, projects: [] });
  net.routes["claude.status"] = () => ({ installed: true, version: "2.1.0", signedIn: null });
  net.routes["contexts.list"] = () => [];
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});

afterEach(() => {
  reset();
  Element.prototype.scrollIntoView = real;
});

const nav = () => screen.getByRole("listbox", { name: "Settings sections" });
const option = (name: string) => within(nav()).getByRole("option", { name });

describe("Settings screen", () => {
  it("lists the sections, marks the current one and navigates", () => {
    const { app } = mountSettings(<SettingsScreen />, { route: { screen: "settings", arg: "access" } });
    expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeInTheDocument();
    expect(option("Access")).toHaveAttribute("aria-selected", "true");
    expect(option("Project")).toHaveAttribute("aria-selected", "false");
    fireEvent.click(option("Appearance"));
    expect(app.navigate).toHaveBeenCalledWith("settings", "appearance");
    expect(screen.getByRole("heading", { name: "Access", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText("Models stub")).not.toBeInTheDocument();
  });

  it("shows one section per page", () => {
    mountSettings(<SettingsScreen />, { route: { screen: "settings", arg: "models" } });
    expect(screen.getByText("Models stub")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(within(nav()).queryByRole("option", { name: "Claude dock" })).toBeNull();
  });

  it("defaults to Project, and says to open a project without one", () => {
    const { app: state } = mountSettings(<SettingsScreen />, { info: null, route: { screen: "documents" } });
    expect(option("Project needs a project")).toHaveAttribute("aria-selected", "true");
    expect(option("Search needs a project")).toBeInTheDocument();
    expect(option("Claude")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Project" })).toBeInTheDocument();
    const empty = screen.getByText("No project open").closest("div")?.parentElement;
    expect(iconsIn(empty)[0], "audit icons 103: the empty state's folder").toBe("folder");
    expect(screen.getByText(/Open a project to change its settings/)).toBeInTheDocument();
    const open = screen.getByRole("button", { name: "Open a project…" });
    expect(iconsIn(open)).toEqual(["folder-open"]);
    fireEvent.click(open);
    expect(state.navigate).toHaveBeenCalledWith("setup", "project");
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
    expect(calls("project.info")).toHaveLength(0);
    expect(calls("project.notes")).toHaveLength(0);
  });

  it("without a project, a page that works without one says nothing about it", () => {
    mountSettings(<SettingsScreen />, { info: null, route: { screen: "settings", arg: "appearance" } });
    expect(screen.getByRole("heading", { level: 2, name: "Appearance" })).toBeInTheDocument();
    expect(screen.queryByText(/Open a project to change its settings/)).not.toBeInTheDocument();
  });

  it("without an argument on the settings route: Project, no scroll", () => {
    mountSettings(<SettingsScreen />, { route: { screen: "settings" } });
    expect(option("Project")).toHaveAttribute("aria-selected", "true");
    expect(scrolled).toEqual([]);
  });

  it("an unknown section falls back to Project", () => {
    mountSettings(<SettingsScreen />, { route: { screen: "settings", arg: "nowhere" } });
    expect(option("Project")).toHaveAttribute("aria-selected", "true");
  });

  it("shows the version beside the title, and says changes save as they are made", () => {
    mountSettings(<SettingsScreen />, { route: { screen: "settings" } });
    expect(screen.getByRole("heading", { level: 1, name: /^Settings/ })).toBeInTheDocument();
    expect(screen.getByText(versionLabel(__VERSION__))).toBeInTheDocument();
    expect(screen.getByText("Changes save as you make them")).toBeInTheDocument();
    expect(iconsIn(screen.getByText("Changes save as you make them")), "audit icons 102").toEqual(["check"]);
  });

  it("the section list can be resized and keeps its width", () => {
    mountSettings(<SettingsScreen />, { route: { screen: "settings" } });
    const edge = screen.getByRole("separator", { name: "Resize the section list" });
    fireEvent.keyDown(edge, { key: "ArrowRight" });
    expect(Number(edge.getAttribute("aria-valuenow"))).toBeGreaterThan(225);
  });
});

describe("Settings › the list names the sections only", () => {
  it("lists no card under an open section: Models stays the one marked", () => {
    mountSettings(<SettingsScreen />, { route: { screen: "settings", arg: "models-packs" } });
    expect(option("Models")).toHaveAttribute("aria-selected", "true");
    for (const card of ["This machine", "Models folder", "Packs", "Model catalog"])
      expect(within(nav()).queryByRole("option", { name: card })).toBeNull();
    expect(within(nav()).getAllByRole("option")).toHaveLength(7);
  });

  it("lists no card under Claude either", () => {
    mountSettings(<SettingsScreen />, { route: { screen: "settings", arg: "claude" } });
    expect(option("Claude")).toHaveAttribute("aria-selected", "true");
    for (const card of ["Connection", "Claude dock", "Quick asks", "Contexts"])
      expect(within(nav()).queryByRole("option", { name: card })).toBeNull();
  });
});

describe("Settings › anchors: #/settings/claude-dock, -quickasks, -contexts, a field (audit M-C3)", () => {
  for (const [arg, card, entry] of [
    ["claude-dock", "Claude dock", "Claude"],
    ["claude-quickasks", "Quick asks", "Claude"],
    ["claude-contexts", "Contexts", "Claude"],
  ] as const)
    it(`#/settings/${arg} opens the Claude section, marks « ${entry} » and scrolls to the « ${card} » card`, async () => {
      mountSettings(<SettingsScreen />, { route: { screen: "settings", arg } });
      expect(option(entry)).toHaveAttribute("aria-selected", "true");
      const region = await screen.findByRole("region", { name: card });
      await waitFor(() => expect(scrolled.some((el) => el.contains(region))).toBe(true));
    });

  it("#/settings/claude scrolls to the Connection to Claude card and marks Claude", () => {
    mountSettings(<SettingsScreen />, { route: { screen: "settings", arg: "claude" } });
    expect(option("Claude")).toHaveAttribute("aria-selected", "true");
    expect(scrolled[0]).toContainElement(screen.getByRole("region", { name: "Connection to Claude" }));
  });

  it("without a project, Claude works and its section says its project cards need one", () => {
    const { app: state } = mountSettings(<SettingsScreen />, {
      info: null,
      route: { screen: "settings", arg: "claude" },
    });
    expect(option("Claude")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/open one to set them/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open a project…" }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "project");
  });

  it("#/settings/project-jira opens Project and focuses the Jira project key", async () => {
    mountSettings(<SettingsScreen />, { route: { screen: "settings", arg: "project-jira" } });
    expect(option("Project")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByRole("textbox", { name: /^Jira project key/ })).toHaveFocus());
  });

  it("the screen opens a sub-section and focuses a field it points at (#/settings/claude-exe)", () => {
    const at = vi.fn();
    Element.prototype.scrollIntoView = at;
    mountSettings(<SettingsScreen />, { info: null, route: { screen: "settings", arg: "claude-exe" } });
    expect(option("Claude")).toHaveAttribute("aria-selected", "true");
    expect(at).toHaveBeenCalledWith({ block: "center" });
    expect(screen.getByLabelText(/^Claude program/)).toHaveFocus();
  });
});
