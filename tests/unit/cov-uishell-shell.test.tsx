// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "../../src/core/types.ts";
import { ApiError, project, setProject } from "../../src/ui/api.ts";
import { DesktopBridge } from "../../src/ui/components/shell/DesktopBridge.tsx";
import { JobLog, useJob } from "../../src/ui/components/shell/JobLog.tsx";
import { Palette } from "../../src/ui/components/shell/Palette.tsx";
import { ProblemPanel, problemOf } from "../../src/ui/components/shell/ProblemPanel.tsx";
import { ProjectButton } from "../../src/ui/components/shell/ProjectButton.tsx";
import { Rail } from "../../src/ui/components/shell/Rail.tsx";
import { ScreenHeader } from "../../src/ui/components/shell/ScreenHeader.tsx";
import { SystemStatus } from "../../src/ui/components/shell/SystemStatus.tsx";
import { ThemeToggle } from "../../src/ui/components/shell/ThemeToggle.tsx";
import { Toasts } from "../../src/ui/components/ui/index.ts";
import type { AppState } from "../../src/ui/lib/app.ts";
import { resetDoctor } from "../../src/ui/lib/doctor.ts";
import { setThemeEverywhere } from "../../src/ui/lib/theme.ts";
import { closeToast, useToasts } from "../../src/ui/lib/toast.ts";
import { Placeholder } from "../../src/ui/screens/Placeholder.tsx";
import {
  callsOf,
  deferred,
  Fail,
  FakeES,
  fakeEvents,
  fakeNet,
  job,
  net,
  status,
  withApp,
} from "./cov-uishell-helpers.tsx";
import { app, fakeDesktop, noDesktop } from "./ui-desktop-helpers.tsx";

let ids: number[] = [];
function Probe() {
  ids = useToasts().map((t) => t.id);
  return <Toasts />;
}

beforeEach(() => {
  fakeNet();
  fakeEvents();
});

afterEach(() => {
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
  localStorage.clear();
  document.title = "";
});

const at = (s: number) => `2026-11-02T10:00:${String(s).padStart(2, "0")}.000Z`;
const prog = (message: string, s: number, jobId = "j1"): JobEvent => ({ jobId, at: at(s), type: "progress", message });

function JobProbe({ id }: { id: string | null }) {
  const r = useJob(id);
  return (
    <div>
      <span data-testid="status">{r.job?.status ?? "none"}</span>
      <span data-testid="error">{r.error}</span>
      <span data-testid="events">{r.events.map((e) => (e.type === "progress" ? e.message : e.type)).join(",")}</span>
    </div>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

describe("useJob", () => {
  it("does nothing without a job", () => {
    render(<JobProbe id={null} />);
    expect(text("status")).toBe("none");
    expect(callsOf("jobs.show")).toHaveLength(0);
  });

  it("merges the events seen before the log was read, then follows the stream", async () => {
    const gate = deferred();
    net.routes["jobs.show"] = async () => {
      await gate.promise;
      return { job: job(), events: [prog("a", 1), prog("b", 2)] };
    };
    render(<JobProbe id="j1" />);
    act(() => {
      FakeES.emit(prog("b", 2));
      FakeES.emit(prog("c", 3));
      FakeES.emit(prog("other", 3, "j2"));
    });
    await act(async () => gate.resolve(null));
    await waitFor(() => expect(text("events")).toMatch(/^a,b/));
    expect(text("status")).toBe("running");
    act(() => FakeES.emit(prog("d", 4)));
    expect(text("events")).toMatch(/^a,b,(c,)?d$/);
    act(() => FakeES.emit(status(job({ status: "done" }), at(5))));
    expect(text("status")).toBe("done");
    expect(text("events")).toMatch(/^a,b,(c,)?d,status$/);
  });

  it("reads a running job back now and then, keeping the longer log and a finished status", async () => {
    vi.useFakeTimers();
    let n = 0;
    net.routes["jobs.show"] = () => {
      n++;
      if (n === 1) return { job: job(), events: [prog("a", 1)] };
      if (n === 2) return { job: job(), events: [prog("a", 1), prog("b", 2), prog("c", 3)] };
      return { events: [] };
    };
    render(<JobProbe id="j1" />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(text("events")).toBe("a");
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(text("events")).toBe("a,b,c");
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(text("events")).toBe("a,b,c");
    act(() => FakeES.emit(status(job({ status: "failed" }))));
    expect(text("status")).toBe("failed");
    const before = n;
    await act(() => vi.advanceTimersByTimeAsync(4500));
    expect(n).toBe(before);
  });

  it("keeps a finished status from the stream when an older read lands", async () => {
    const gate = deferred();
    net.routes["jobs.show"] = async () => {
      await gate.promise;
      return { job: job(), events: [] };
    };
    render(<JobProbe id="j1" />);
    act(() => FakeES.emit(status(job({ status: "done" }))));
    await act(async () => gate.resolve(null));
    await waitFor(() => expect(callsOf("jobs.show")).toHaveLength(1));
    await act(async () => {});
    expect(text("status")).toBe("done");
  });

  it("says why the log could not be read, and ignores answers after unmount", async () => {
    net.routes["jobs.show"] = () => {
      throw new Fail("no such job");
    };
    const { unmount } = render(<JobProbe id="gone" />);
    await waitFor(() => expect(text("error")).toBe("no such job"));
    unmount();
    const gate = deferred();
    net.routes["jobs.show"] = async () => {
      await gate.promise;
      return { job: job(), events: [] };
    };
    const second = render(<JobProbe id="j1" />);
    second.unmount();
    await act(async () => gate.resolve(null));
    vi.stubGlobal("fetch", () => Promise.reject("offline"));
    render(<JobProbe id="j2" />);
    await waitFor(() => expect(text("error")).toBe("offline"));
  });
});

describe("JobLog", () => {
  it("shows an empty log, colours warnings and errors, and sticks to the bottom until scrolled up", () => {
    const { rerender } = render(<JobLog events={[]} />);
    expect(screen.getByText("Nothing logged yet.")).toBeInTheDocument();
    const log = screen.getByRole("log", { name: "Live log" });
    Object.defineProperty(log, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(log, "clientHeight", { value: 100, configurable: true });
    const events: JobEvent[] = [
      { jobId: "j1", at: at(1), type: "log", level: "warn", message: "slow" },
      { jobId: "j1", at: at(2), type: "log", level: "error", message: "broken" },
    ];
    rerender(<JobLog events={events} label="Import log" />);
    expect(screen.getByText("slow").parentElement ?? screen.getByText("slow")).toBeInTheDocument();
    expect(document.querySelector(".log-warn")).toHaveTextContent("slow");
    expect(document.querySelector(".log-error")).toHaveTextContent("broken");
    expect(log.scrollTop).toBe(500);
    log.scrollTop = 0;
    fireEvent.scroll(log);
    rerender(<JobLog events={[...events, { jobId: "j1", at: at(3), type: "log", level: "info", message: "more" }]} />);
    expect(log.scrollTop).toBe(0);
  });
});

describe("Palette", () => {
  const commands = [
    { name: "tests.list", summary: "List the local tests.", mutates: false, job: false, input: {} },
    { name: "odd.thing", summary: "", mutates: false, job: false, input: {} },
  ];

  it("moves with the arrows, picks with the mouse and asks the documents", () => {
    const onCommand = vi.fn();
    const onAsk = vi.fn();
    const onClose = vi.fn();
    const run = vi.fn();
    render(
      <Palette
        commands={commands}
        actions={[{ id: "a", label: "Go somewhere", run }]}
        onCommand={onCommand}
        onAsk={onAsk}
        onClose={onClose}
      />,
    );
    const input = screen.getByRole("combobox");
    expect(screen.getByRole("option", { name: /odd\.thing/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.mouseEnter(screen.getAllByRole("option")[1]);
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(run).toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "  quel menu  " } });
    const askOption = screen.getByRole("option", { name: /Ask the documents/ });
    fireEvent.mouseEnter(askOption);
    expect(askOption).toHaveAttribute("aria-selected", "true");
    fireEvent.click(askOption);
    expect(onAsk).toHaveBeenCalledWith("quel menu");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("says when nothing matches, ignores Enter then, and closes on the backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(<Palette commands={commands} actions={[]} onCommand={() => {}} onClose={onClose} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches “zzz”.")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("picks the ask entry with Enter when it is the only one", () => {
    const onAsk = vi.fn();
    render(<Palette commands={[]} actions={[]} onCommand={() => {}} onAsk={onAsk} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "alarme" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onAsk).toHaveBeenCalledWith("alarme");
  });
});

describe("ProblemPanel", () => {
  it("tells a Jira access problem from a Jira outage and a local failure", () => {
    expect(problemOf(new ApiError("Jira answered 401")).access).toBe(true);
    expect(problemOf(new ApiError("Xray timed out")).title).toBe("Jira did not answer");
    expect(problemOf(new Error("disk full")).title).toBe("This did not work");
    expect(problemOf(new ApiError("refused", "check your Jira token")).access).toBe(true);
  });

  it("points to Settings › Access for a refused token", () => {
    const retry = vi.fn();
    const { state } = withApp(<ProblemPanel error={new ApiError("Jira 403")} doing="Pull" onRetry={retry} />);
    expect(screen.getByText(/create a new API token/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was written to Jira/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings › Access" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", "access");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });

  it("points to the system check otherwise, with the core's own fix when there is one", () => {
    const { state } = withApp(
      <>
        <ProblemPanel error={new ApiError("Jira unreachable")} doing="Push" untouched="Nothing changed." />
        <ProblemPanel error={new ApiError("No index", "run rag index")} doing="Search" />
        <ProblemPanel error="weird" doing="Thing" />
      </>,
    );
    expect(screen.getByText(/check your network or proxy/)).toBeInTheDocument();
    expect(screen.getByText("Nothing changed.")).toBeInTheDocument();
    expect(screen.getByText("run rag index")).toBeInTheDocument();
    expect(screen.getByText(/retry; if it fails again/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Open the system check" })[0]);
    expect(state.navigate).toHaveBeenCalledWith("doctor");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

describe("ProjectButton", () => {
  const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /change project/ }));

  it("lists the known projects and switches to one", async () => {
    net.routes["project.list"] = () => ({
      projects: ["D:\\Other", { dir: "C:\\p", name: "Here", jiraProject: "LFRPS12" }, null, 3, { nodir: 1 }],
    });
    const { state } = withApp(
      <>
        <ProjectButton />
        <Probe />
      </>,
    );
    expect(screen.getByRole("button", { name: "Project LFRPS12 RATP Sosie, change project" })).toBeInTheDocument();
    openMenu();
    expect(await screen.findByRole("menuitem", { name: /Other/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Here/ })).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("menuitem", { name: /Open a folder/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /Other/ }));
    expect(project()).toBe("D:\\Other");
    expect(localStorage.getItem("testimus.project")).toBe("D:\\Other");
    expect(state.refreshInfo).toHaveBeenCalled();
    expect(state.testsChanged).toHaveBeenCalled();
    openMenu();
    openMenu();
    expect(callsOf("project.list")).toHaveLength(2);
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
    const { state } = withApp(<ProjectButton />);
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
    withApp(
      <>
        <ProjectButton />
        <Probe />
      </>,
      { info: null },
    );
    expect(screen.getByRole("button", { name: "Project — No project, change project" })).toBeInTheDocument();
    openMenu();
    expect(screen.getByRole("menuitem", { name: "No other project known yet" })).toBeDisabled();
    openMenu();
    net.routes["project.list"] = () => {
      throw new Fail("core down");
    };
    openMenu();
    expect(await screen.findByText("Could not list the projects")).toBeInTheDocument();
  });

  it("names a project without a name after its folder", () => {
    const base = app().info as NonNullable<AppState["info"]>;
    withApp(<ProjectButton />, {
      info: { ...base, dir: "D:\\Projets\\Sosie", project: { ...base.project, name: "", jiraProject: "" } },
    });
    expect(screen.getByRole("button", { name: "Project — Sosie, change project" })).toBeInTheDocument();
  });

  it("in the desktop shell: opens a folder and shows the project in Explorer", async () => {
    const d = fakeDesktop({ folder: "D:\\Picked" });
    net.routes["project.list"] = () => [];
    net.routes["project.open"] = (i) => ({ dir: i.dir });
    const { state } = withApp(
      <>
        <ProjectButton />
        <Probe />
      </>,
    );
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
    withApp(<ProjectButton />, { info: null });
    openMenu();
    expect(screen.getByRole("menuitem", { name: /Open a folder/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Show in Explorer/ })).toBeNull();
  });
});

describe("Rail, system status, theme and headers", () => {
  beforeEach(() => resetDoctor());

  it("navigates from the rail and shows counts and the current screen", async () => {
    net.routes["system.doctor"] = () => [{ id: "node", label: "Node", state: "fail", detail: "" }];
    net.routes["project.list"] = () => [];
    const { state } = withApp(<Rail counts={{ review: 3, jobs: 0 }} />, { route: { screen: "doctor" } });
    expect(screen.getByRole("button", { name: /Review/ })).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /Jobs/ })).not.toHaveTextContent(/\d/);
    fireEvent.click(screen.getByRole("button", { name: /Tests/ }));
    expect(state.navigate).toHaveBeenCalledWith("tests");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(state.navigate).toHaveBeenCalledWith("settings");
    const sys = await screen.findByRole("button", { name: "System: Needs you. Open the system check" });
    expect(sys).toHaveAttribute("aria-current", "page");
    fireEvent.click(sys);
    expect(state.navigate).toHaveBeenCalledWith("doctor");
  });

  it("shows Checking until the first answer, then the worst state", async () => {
    const gate = deferred();
    net.routes["system.doctor"] = async () => {
      await gate.promise;
      return [{ id: "a", label: "A", state: "warn", detail: "" }];
    };
    render(<SystemStatus onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /System: Checking/ })).not.toHaveAttribute("aria-current");
    await act(async () => gate.resolve(null));
    expect(await screen.findByRole("button", { name: /System: Check\./ })).toHaveClass("st-warn");
  });

  it("follows a theme set elsewhere", () => {
    render(<ThemeToggle />);
    act(() => setThemeEverywhere("dark"));
    expect(screen.getByRole("button", { name: "Theme: Dark. Switch to System" })).toBeInTheDocument();
  });

  it("renders a screen header with or without meta, and a placeholder", () => {
    const { state } = withApp(
      <>
        <ScreenHeader title="Jobs" meta="2 running">
          <button type="button">Extra</button>
        </ScreenHeader>
        <Placeholder title="Soon" icon="jobs" lead="Not built yet">
          <span>child</span>
        </Placeholder>
      </>,
    );
    expect(screen.getByTitle("2 running")).toBeInTheDocument();
    expect(screen.getByText("Not built yet")).toBeInTheDocument();
    expect(screen.getByText("child")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Search or run a command/ })[0]);
    expect(state.openPalette).toHaveBeenCalled();
  });
});

describe("DesktopBridge, the remaining paths", () => {
  const mount = (over: Partial<AppState> = {}) =>
    withApp(
      <>
        <DesktopBridge booted />
        <Probe />
      </>,
      over,
    );

  it("titles the window after the Jira key or the folder when the project has no name", () => {
    const base = app().info as NonNullable<AppState["info"]>;
    const { rerenderWith } = mount({ info: { ...base, project: { ...base.project, name: "" } } });
    expect(document.title).toBe("Testimus — LFRPS12");
    rerenderWith({ info: { ...base, dir: "D:\\Sosie", project: { ...base.project, name: "", jiraProject: "" } } });
    expect(document.title).toBe("Testimus — Sosie");
  });

  it("says when a folder handed by a second launch cannot be opened, and stays on its screen", async () => {
    const d = fakeDesktop();
    net.routes["jobs.list"] = () => null;
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
    net.routes["jobs.list"] = () => [
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
      FakeES.emit(status(job({ id: "r1", kind: "rag-index", status: "done" })));
    });
    expect(d.setProgress).toHaveBeenCalledTimes(2);
    expect(d.notify).toHaveBeenCalledTimes(1);
    net.routes["jobs.list"] = () => {
      throw new Fail("x");
    };
    unmount();
    mount();
    await waitFor(() => expect(callsOf("jobs.list")).toHaveLength(2));
  });
});
