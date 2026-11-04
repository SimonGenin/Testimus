// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../../../src/core/types.ts";
import { App } from "../../../../src/ui/app/App.tsx";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { FakeES, fakeEvents, fakeNet, job, net, status } from "../../helpers/ui-data.tsx";
import { app as appState } from "../../helpers/ui-desktop.tsx";

vi.mock("../../../../src/ui/screens/tests/TestsScreen.tsx", async () => {
  const { useApp } = await import("../../../../src/ui/lib/app.ts");
  return { TestsScreen: () => <output aria-label="Claude lock">{useApp().claudeRunning ?? "none"}</output> };
});
vi.mock("../../../../src/ui/components/claude/ClaudeDock.tsx", async () => {
  const { useApp } = await import("../../../../src/ui/lib/app.ts");
  return {
    ClaudeDock: () => {
      const a = useApp();
      return (
        <>
          <button type="button" onClick={() => a.setClaudeRunning("t1")}>
            dock asks
          </button>
          <button type="button" onClick={() => a.setClaudeRunning("t1", "j-dock")}>
            dock started
          </button>
        </>
      );
    },
  };
});

let jobs: Job[] = [];

beforeEach(() => {
  fakeNet();
  fakeEvents();
  jobs = [];
  window.location.hash = "";
  net.api = () => ({ project: "C:\\p", mock: true, commands: [] });
  net.routes["project.info"] = () => appState().info;
  net.routes["system.credentials"] = () => ({ status: { jira: { complete: true }, xray: { complete: true } } });
  net.routes["jobs.list"] = () => jobs;
  net.routes["system.doctor"] = () => [];
  net.routes["project.list"] = () => [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
  localStorage.clear();
  sessionStorage.clear();
});

const boot = async () => {
  render(
    <DataProvider>
      <App />
    </DataProvider>,
  );
  return await screen.findByLabelText("Claude lock");
};

const claudeOn = (id: string, testId?: string): Job =>
  job({
    id,
    kind: "claude",
    subject: testId ?? "the project",
    rerun: { name: "claude.run", input: { scope: testId ? { kind: "test", testId } : { kind: "project" } } },
  });

describe("App › the « Claude is working » lock is read from the running jobs (review #2, PARITY #15)", () => {
  it("a Claude run started elsewhere (CLI, MCP, another window) locks, and its end unlocks", async () => {
    jobs = [job({ id: "pull-1", kind: "pull" }), claudeOn("c1", "t9")];
    const lock = await boot();
    await waitFor(() => expect(lock).toHaveTextContent("t9"));
    act(() => FakeES.emit(status({ ...claudeOn("c1", "t9"), status: "done" })));
    await waitFor(() => expect(lock).toHaveTextContent("none"));
  });

  it("a fix names its test, a run on the whole project locks every test, other jobs do not lock", async () => {
    jobs = [job({ id: "f1", kind: "fix", subject: "K-1", rerun: { name: "review.fix", input: { id: "K-1" } } })];
    const lock = await boot();
    await waitFor(() => expect(lock).toHaveTextContent("K-1"));
    const fix = jobs[0];
    jobs = [];
    act(() => FakeES.emit(status({ ...fix, status: "failed" })));
    await waitFor(() => expect(lock).toHaveTextContent("none"));
    jobs = [claudeOn("c2")];
    act(() => FakeES.emit(status(claudeOn("c2"))));
    await waitFor(() => expect(lock).toHaveTextContent("*project*"));
    jobs = [job({ id: "g1", kind: "generate" })];
    act(() => FakeES.emit(status({ ...claudeOn("c2"), status: "done" })));
    act(() => FakeES.emit(status(job({ id: "g1", kind: "generate" }))));
    await waitFor(() => expect(lock).toHaveTextContent("none"));
  });

  it("the dock's run locks before its job is known, and its end unlocks even when the dock never says so", async () => {
    const lock = await boot();
    expect(lock).toHaveTextContent("none");
    fireEvent.click(screen.getByRole("button", { name: "dock asks" }));
    expect(lock).toHaveTextContent("t1");
    fireEvent.click(screen.getByRole("button", { name: "dock started" }));
    expect(lock).toHaveTextContent("t1");
    act(() => FakeES.emit(status(claudeOn("j-dock"))));
    await waitFor(() => expect(lock).toHaveTextContent("t1"));
    act(() => FakeES.emit(status({ ...claudeOn("j-dock"), status: "done" })));
    await waitFor(() => expect(lock).toHaveTextContent("none"));
  });

  it("a job the dock started that ended before its id came back does not leave the lock on", async () => {
    const lock = await boot();
    fireEvent.click(screen.getByRole("button", { name: "dock asks" }));
    act(() => FakeES.emit(status({ ...claudeOn("j-dock", "t1"), status: "done" })));
    fireEvent.click(screen.getByRole("button", { name: "dock started" }));
    await waitFor(() => expect(lock).toHaveTextContent("none"));
  });
});
