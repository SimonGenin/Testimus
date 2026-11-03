// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../../../src/core/types.ts";
import { DesktopBridge, jobNotice } from "../../../../src/ui/components/shell/DesktopBridge.tsx";
import type { AppState } from "../../../../src/ui/lib/app.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { callsOf, Fail, FakeES, fakeEvents, fakeNet, job, net, status } from "../../cov-uishell-helpers.tsx";
import { app, fakeDesktop, noDesktop } from "../../ui-desktop-helpers.tsx";
import { clearAllToasts, withData } from "./helpers.tsx";

let jobs: Job[] = [];

beforeEach(() => {
  fakeNet();
  fakeEvents();
  setProject("C:\\p");
  jobs = [];
  net.routes["jobs.list"] = () => jobs.filter((j) => j.status === "running");
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

// ponytail: the server's list follows the job's status, as the core's does
const emit = (j: Job) => {
  jobs = [...jobs.filter((x) => x.id !== j.id), j];
  FakeES.emit(status(j));
};

const mount = (over: Partial<AppState> = {}, booted = true) => withData(<DesktopBridge booted={booted} />, over);

describe("DesktopBridge", () => {
  it("titles the page « Testimus — <project> » in the browser too, and renders nothing", () => {
    const { container, rerenderWith } = mount();
    expect(document.title).toBe("Testimus — RATP Sosie");
    expect(container.querySelector("*:not(section)")).toBeNull();
    rerenderWith({ info: null });
    expect(document.title).toBe("Testimus");
  });

  it("titles the window after the Jira key or the folder when the project has no name", () => {
    const base = app().info as NonNullable<AppState["info"]>;
    const { rerenderWith } = mount({ info: { ...base, project: { ...base.project, name: "" } } });
    expect(document.title).toBe("Testimus — LFRPS12");
    rerenderWith({ info: { ...base, dir: "D:\\Sosie", project: { ...base.project, name: "", jiraProject: "" } } });
    expect(document.title).toBe("Testimus — Sosie");
  });

  it("without the bridge: no taskbar", async () => {
    mount();
    await waitFor(() => expect(callsOf("jobs.list")).toHaveLength(1));
    act(() => emit(job({ id: "j1", kind: "generate" })));
    act(() => emit(job({ id: "j1", kind: "generate", status: "done" })));
    expect(window.testimusDesktop).toBeUndefined();
  });

  it("follows Generate, Index, Check and Pull jobs on the taskbar, then clears it", async () => {
    const d = fakeDesktop();
    jobs = [job({ id: "j0", kind: "rag-index", progress: { done: 1, total: 4 } })];
    const { unmount } = mount();
    await waitFor(() => expect(d.setProgress).toHaveBeenLastCalledWith(0.25));
    act(() => {
      emit(job({ id: "j1", kind: "generate" }));
      emit(job({ id: "j9", kind: "chat" }));
    });
    await waitFor(() => expect(d.setProgress).toHaveBeenLastCalledWith(0.13));
    act(() => FakeES.emit({ jobId: "j1", at: "", type: "progress", message: "Writing", done: 1, total: 2 }));
    expect(d.setProgress).toHaveBeenLastCalledWith(0.38);
    act(() => {
      emit(job({ id: "j0", kind: "rag-index", status: "done" }));
      emit(job({ id: "j1", status: "cancelled" }));
    });
    await waitFor(() => expect(d.setProgress).toHaveBeenLastCalledWith(null));
    unmount();
    expect(d.setProgress).toHaveBeenLastCalledWith(null);
  });

  it("notifies the end of a job and a failed Claude run, once each, never a cancel", () => {
    const d = fakeDesktop();
    mount();
    act(() => {
      FakeES.emit(status(job({ id: "a", status: "done", result: { tests: [] } })));
      FakeES.emit(status(job({ id: "a", status: "done", result: { tests: [] } })));
      FakeES.emit(status(job({ id: "b", kind: "fix", status: "failed" })));
      FakeES.emit(status(job({ id: "c", status: "cancelled" })));
    });
    expect(d.notify).toHaveBeenCalledTimes(2);
    expect(d.notify.mock.calls[0][0]).toMatchObject({ title: "Generate tests finished" });
    expect(d.notify.mock.calls[1][0]).toMatchObject({ title: "Claude fix failed" });
    expect(jobNotice(job({ status: "failed", subject: "S" })).title).toBe("Generate tests failed");
  });

  it("opens a folder handed by a second launch, once the app has read its first project", async () => {
    const d = fakeDesktop();
    net.routes["project.open"] = (i) => ({ dir: i.dir });
    const { state } = mount({ route: { screen: "setup" } }, false);
    expect(d.onOpenProject).not.toHaveBeenCalled();
    cleanup();
    const again = withData(<DesktopBridge booted />, { ...state });
    expect(d.onOpenProject).toHaveBeenCalledTimes(1);
    act(() => d.open?.("D:\\Other project"));
    await waitFor(() => expect(again.state.refreshInfo).toHaveBeenCalled());
    expect(callsOf("project.open")[0].input).toEqual({ dir: "D:\\Other project" });
    expect(localStorage.getItem("testimus.project")).toBe("D:\\Other project");
    expect(again.state.testsChanged).toHaveBeenCalled();
    await waitFor(() => expect(again.state.navigate).toHaveBeenCalledWith("documents"));
  });

  it("says when a folder handed by a second launch cannot be opened, and stays on its screen", async () => {
    const d = fakeDesktop();
    net.routes["project.open"] = (i) => {
      if (i.dir === "bad") throw new Fail("not a project");
      return { dir: i.dir };
    };
    const { state } = mount({ route: { screen: "tests" } });
    act(() => d.open?.("D:\\Good"));
    expect(await screen.findByText("Project opened")).toBeInTheDocument();
    expect(state.navigate).not.toHaveBeenCalled();
    act(() => d.open?.("bad"));
    expect(await screen.findByText("Could not open the project")).toBeInTheDocument();
  });

  it("ignores progress it does not follow and survives failing bridge calls", async () => {
    const d = fakeDesktop();
    d.setProgress.mockRejectedValue(new Error("no taskbar"));
    d.notify.mockRejectedValue(new Error("no toasts"));
    jobs = [
      job({ id: "r1", kind: "rag-index" }),
      job({ id: "r1", kind: "rag-index" }),
      job({ id: "c1", kind: "chat" }),
      job({ id: "d1", kind: "check", status: "done" }),
    ];
    const { unmount } = mount();
    await waitFor(() => expect(d.setProgress).toHaveBeenCalledWith(0));
    act(() => {
      FakeES.emit({ jobId: "zz", at: "", type: "progress", message: "x", done: 1, total: 2 });
      FakeES.emit({ jobId: "r1", at: "", type: "progress", message: "x" });
      FakeES.emit({ jobId: "r1", at: "", type: "progress", message: "x", total: 4 });
      FakeES.emit({ jobId: "r1", at: "", type: "log", level: "info", message: "x" });
      emit(job({ id: "r1", kind: "rag-index", status: "done" }));
    });
    expect(d.setProgress).toHaveBeenCalledTimes(2);
    expect(d.notify).toHaveBeenCalledTimes(1);
    net.routes["jobs.list"] = () => {
      throw new Fail("x");
    };
    const before = callsOf("jobs.list").length;
    unmount();
    mount();
    await waitFor(() => expect(callsOf("jobs.list").length).toBeGreaterThan(before));
  });
});
