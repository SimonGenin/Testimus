// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalTestRef } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { DataProvider } from "../../src/ui/lib/data/provider.tsx";
import { ClaudeSection } from "../../src/ui/screens/settings/ClaudeSection.tsx";
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

describe("Settings › Claude program", () => {
  beforeEach(() => {
    api.routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    api.routes["system.set"] = (i) => ({ claude: { exe: i.claudeExe ?? "" }, models: { allowRemote: true } });
    api.routes["claude.status"] = () => ({ installed: true, version: "2.1.0", signedIn: null, exe: "claude" });
  });

  it("Browse… picks claude.exe and saves it", async () => {
    const d = fakeDesktop({ files: ["C:\\Users\\me\\.local\\bin\\claude.exe"] });
    within(<ClaudeSection />, { info: null });
    const browse = screen.getByRole("button", { name: "Browse for the Claude program" });
    await waitFor(() => expect(browse).toBeEnabled());
    fireEvent.click(browse);
    await waitFor(() => expect(named("system.set")).toHaveLength(1));
    await waitFor(() => expect(named("claude.status").at(-1)?.input).toEqual({ refresh: true }));
    expect(d.pickFiles).toHaveBeenCalledWith({
      title: "Choose the Claude program",
      filters: process.platform === "win32" ? [{ name: "Programs", extensions: ["exe", "cmd"] }] : [],
      multiple: false,
    });
    expect(named("system.set")[0].input).toEqual({ claudeExe: "C:\\Users\\me\\.local\\bin\\claude.exe" });
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
    <DataProvider>
      <TestList refs={refs} loading={false} activeId={activeId} onOpen={() => {}} onReload={async () => refs} />
    </DataProvider>
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
