// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalTestRef } from "../../src/core/types.ts";
import { project, setProject } from "../../src/ui/api.ts";
import { Toasts } from "../../src/ui/components/legacy/index.ts";
import { ProjectButton } from "../../src/ui/components/shell/ProjectButton.tsx";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { ClaudeSection } from "../../src/ui/screens/settings/ClaudeSection.tsx";
import { AccessStep } from "../../src/ui/screens/setup/AccessStep.tsx";
import { ProjectStep } from "../../src/ui/screens/setup/ProjectStep.tsx";
import { TestList } from "../../src/ui/screens/tests/TestList.tsx";
import { api, app, fakeDesktop, fakeFetch, named, noDesktop } from "./ui-desktop-helpers.tsx";

beforeEach(() => {
  fakeFetch();
  setProject("C:\\p");
});

afterEach(() => {
  cleanup();
  noDesktop();
  setProject(null);
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const within = (ui: ReactNode, over: Partial<AppState> = {}) => {
  const a = app(over);
  render(<AppContext.Provider value={a}>{ui}</AppContext.Provider>);
  return a;
};

describe("First launch › Project", () => {
  beforeEach(() => {
    api.routes["project.list"] = () => ({ projects: [] });
  });

  it("Browse… puts the picked folder in the field", async () => {
    const d = fakeDesktop({ folder: "D:\\Tests\\Nouveau" });
    within(<ProjectStep onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Browse for the projects folder" }));
    await waitFor(() => expect(screen.getByLabelText("Projects folder")).toHaveValue("D:\\Tests\\Nouveau"));
    expect(d.pickFolder).toHaveBeenCalledWith({ title: "Choose where the project goes" });
  });

  it("a cancelled dialog leaves the field alone", async () => {
    const d = fakeDesktop({ folder: null });
    within(<ProjectStep onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText("Projects folder"), { target: { value: "C:\\typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Browse for the projects folder" }));
    await waitFor(() => expect(d.pickFolder).toHaveBeenCalled());
    expect(screen.getByLabelText("Projects folder")).toHaveValue("C:\\typed");
  });

  it("without the bridge: the text field only", () => {
    within(<ProjectStep onBack={() => {}} />);
    expect(screen.getByLabelText("Projects folder")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Browse/ })).toBeNull();
  });
});

describe("Project menu", () => {
  beforeEach(() => {
    api.routes["project.list"] = () => ({ projects: [{ dir: "C:\\p", name: "RATP Sosie", jiraProject: "LFRPS12" }] });
    api.routes["project.open"] = (i) => ({ dir: i.dir });
  });

  const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /^Project LFRPS12/ }));

  it("Open a folder… picks a folder and opens it as the project", async () => {
    fakeDesktop({ folder: "D:\\Projets\\BHPTCC" });
    const a = within(<ProjectButton />);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open a folder…" }));
    await waitFor(() => expect(named("project.open")).toHaveLength(1));
    expect(named("project.open")[0].input).toEqual({ dir: "D:\\Projets\\BHPTCC" });
    await waitFor(() => expect(a.refreshInfo).toHaveBeenCalled());
    expect(project()).toBe("D:\\Projets\\BHPTCC");
    expect(localStorage.getItem("testimus.project")).toBe("D:\\Projets\\BHPTCC");
  });

  it("Show in Explorer reveals the project folder", async () => {
    const d = fakeDesktop();
    within(<ProjectButton />);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Show in Explorer" }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith("C:\\p"));
  });

  it("a refused reveal says so", async () => {
    const d = fakeDesktop();
    d.reveal.mockResolvedValue(false);
    within(
      <>
        <ProjectButton />
        <Toasts />
      </>,
    );
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Show in Explorer" }));
    expect(await screen.findByText("Could not show it in Explorer")).toBeInTheDocument();
  });

  it("without the bridge: neither item", async () => {
    within(<ProjectButton />);
    openMenu();
    await screen.findByRole("menuitem", { name: "New or other project…" });
    expect(screen.queryByRole("menuitem", { name: "Open a folder…" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Show in Explorer" })).toBeNull();
  });
});

describe("First launch › Access", () => {
  const TOKENS = "https://id.atlassian.com/manage-profile/security/api-tokens";
  beforeEach(() => {
    api.routes["system.setup"] = () => ({
      status: {
        jira: { file: "", exists: false, complete: false },
        xray: { file: "", exists: false, complete: false },
      },
      saved: [],
      checks: [],
      ok: false,
    });
  });

  it("the token page opens in the default browser through the bridge", async () => {
    const d = fakeDesktop();
    within(<AccessStep onContinue={() => {}} onSkip={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open API tokens" }));
    expect(d.openExternal).toHaveBeenCalledWith(TOKENS);
  });

  it("without the bridge the token page opens in a new tab", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    within(<AccessStep onContinue={() => {}} onSkip={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open API tokens" }));
    expect(open).toHaveBeenCalledWith(TOKENS, "_blank", "noopener,noreferrer");
  });
});

describe("Settings › Claude program", () => {
  beforeEach(() => {
    api.routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    api.routes["system.saveSettings"] = (i) => ({ claude: { exe: i.claudeExe ?? "" }, models: { allowRemote: true } });
    api.routes["claude.status"] = () => ({ installed: true, version: "2.1.0", signedIn: null, exe: "claude" });
  });

  it("Browse… picks claude.exe and saves it", async () => {
    const d = fakeDesktop({ files: ["C:\\Users\\me\\.local\\bin\\claude.exe"] });
    within(<ClaudeSection />, { info: null });
    const browse = screen.getByRole("button", { name: "Browse for the Claude program" });
    await waitFor(() => expect(browse).toBeEnabled());
    fireEvent.click(browse);
    await waitFor(() => expect(named("system.saveSettings")).toHaveLength(1));
    await waitFor(() => expect(named("claude.status").at(-1)?.input).toEqual({ refresh: true }));
    expect(d.pickFiles).toHaveBeenCalledWith({
      title: "Choose the Claude program",
      filters: process.platform === "win32" ? [{ name: "Programs", extensions: ["exe", "cmd"] }] : [],
      multiple: false,
    });
    expect(named("system.saveSettings")[0].input).toEqual({ claudeExe: "C:\\Users\\me\\.local\\bin\\claude.exe" });
    expect(screen.getByLabelText("Claude program")).toHaveValue("C:\\Users\\me\\.local\\bin\\claude.exe");
  });

  it("without the bridge: the text field only", () => {
    within(<ClaudeSection />, { info: null });
    expect(screen.getByLabelText("Claude program")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Browse/ })).toBeNull();
  });
});

describe("Tests › Show in Explorer", () => {
  const refs: LocalTestRef[] = [
    {
      id: "local-3f9a12c0",
      summary: "Disjoncteur",
      folder: "/",
      review: "draft",
      sync: "local",
      dirty: false,
      synced: false,
      mtime: 0,
      stepCount: 2,
    } as LocalTestRef,
  ];
  const list = (activeId: string) => (
    <TestList refs={refs} loading={false} activeId={activeId} onOpen={() => {}} onReload={async () => refs} />
  );

  it("reveals the open test's test.md", async () => {
    const d = fakeDesktop();
    within(list("local-3f9a12c0"));
    fireEvent.click(screen.getByRole("button", { name: "Show the test in Explorer" }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith("C:\\p\\tests\\local-3f9a12c0\\test.md"));
  });

  it("is disabled with no test open, and absent without the bridge", () => {
    fakeDesktop();
    within(list(""));
    expect(screen.getByRole("button", { name: "Show the test in Explorer" })).toBeDisabled();
    cleanup();
    noDesktop();
    within(list("local-3f9a12c0"));
    expect(screen.queryByRole("button", { name: "Show the test in Explorer" })).toBeNull();
  });
});
