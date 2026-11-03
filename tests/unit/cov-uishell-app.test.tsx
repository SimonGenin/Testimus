// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { project, setProject } from "../../src/ui/api.ts";
import { App, parseRoute } from "../../src/ui/app/App.tsx";
import type { DockRequest } from "../../src/ui/components/claude/ClaudeDock.tsx";
import { resetDoctor } from "../../src/ui/lib/doctor.ts";
import { closeToast, useToasts } from "../../src/ui/lib/toast.ts";
import { callsOf, Fail, FakeES, fakeEvents, fakeNet, job, net, status } from "./cov-uishell-helpers.tsx";
import { app as appState, xray } from "./ui-desktop-helpers.tsx";

vi.mock("../../src/ui/screens/tests/TestsScreen.tsx", async () => ({
  TestsScreen: (await import("./cov-uishell-helpers.tsx")).fakeScreen("Tests screen"),
}));
vi.mock("../../src/ui/screens/documents/DocumentsScreen.tsx", async () => ({
  DocumentsScreen: (await import("./cov-uishell-helpers.tsx")).fakeScreen("Documents screen"),
}));
vi.mock("../../src/ui/screens/generate/GenerateScreen.tsx", async () => ({
  GenerateScreen: (await import("./cov-uishell-helpers.tsx")).fakeScreen("Generate screen"),
}));
vi.mock("../../src/ui/screens/review/ReviewScreen.tsx", async () => ({
  ReviewScreen: (await import("./cov-uishell-helpers.tsx")).fakeScreen("Review screen"),
}));
vi.mock("../../src/ui/screens/jobs/JobsScreen.tsx", async () => ({
  JobsScreen: (await import("./cov-uishell-helpers.tsx")).fakeScreen("Jobs screen"),
}));
vi.mock("../../src/ui/screens/doctor/DoctorScreen.tsx", async () => ({
  DoctorScreen: (await import("./cov-uishell-helpers.tsx")).fakeScreen("Doctor screen"),
}));
vi.mock("../../src/ui/screens/import/ImportScreen.tsx", async () => ({
  ImportScreen: (await import("./cov-uishell-helpers.tsx")).fakeScreen("Import screen"),
}));
vi.mock("../../src/ui/screens/settings/SettingsScreen.tsx", async () => ({
  SettingsScreen: (await import("./cov-uishell-helpers.tsx")).fakeScreen("Settings screen"),
}));
vi.mock("../../src/ui/screens/setup/FirstRunScreen.tsx", async () => ({
  FirstRunScreen: (await import("./cov-uishell-helpers.tsx")).fakeScreen("Setup screen"),
}));
vi.mock("../../src/ui/components/claude/ClaudeDock.tsx", () => ({
  ClaudeDock: ({ folded, request, onFold }: { folded: boolean; request?: DockRequest | null; onFold: () => void }) => (
    <aside aria-label="Dock" data-folded={String(folded)} data-request={JSON.stringify(request ?? null)}>
      <button type="button" onClick={onFold}>
        fold dock
      </button>
    </aside>
  ),
}));

let ids: number[] = [];
function Probe() {
  ids = useToasts().map((t) => t.id);
  return null;
}

const info = (over: Record<string, unknown> = {}) => ({ ...appState().info, ...over });

beforeEach(() => {
  fakeNet();
  fakeEvents();
  resetDoctor();
  window.location.hash = "";
  Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true, writable: true });
  net.api = () => ({
    project: "C:\\p",
    mock: true,
    commands: [
      { name: "tests.list", summary: "List the local tests.", mutates: false, job: false, input: {} },
      { name: "rag.index", summary: "Index the documents.", mutates: true, job: true, input: {} },
      {
        name: "xray.pull",
        summary: "Pull a test.",
        mutates: true,
        job: true,
        input: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
      },
    ],
  });
  net.routes["project.info"] = () =>
    info({ counts: { docs: 1, tests: 2, review: { checked: 2, "to-fix": 1 }, jobsRunning: 0 } });
  net.routes["system.setup"] = () => ({ status: { jira: { complete: true }, xray: { complete: true } } });
  net.routes["jobs.list"] = () => [];
  net.routes["system.doctor"] = () => [];
  net.routes["project.list"] = () => [];
});

afterEach(() => {
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
  localStorage.clear();
  sessionStorage.clear();
  window.location.hash = "";
  document.title = "";
});

const mount = () =>
  render(
    <>
      <App />
      <Probe />
    </>,
  );

const dock = () => screen.getByRole("complementary", { name: "Dock" });
const folded = () => dock().getAttribute("data-folded");
const request = () => JSON.parse(dock().getAttribute("data-request") ?? "null") as DockRequest | null;
const hashIs = (h: string) => waitFor(() => expect(window.location.hash).toBe(h));

describe("parseRoute", () => {
  it("reads the screen and its argument from the hash, defaulting to Tests", () => {
    expect(parseRoute("")).toEqual({ screen: "tests", arg: undefined });
    expect(parseRoute("#/nowhere")).toEqual({ screen: "tests", arg: undefined });
    expect(parseRoute("#/documents/D%231.2/x")).toEqual({ screen: "documents", arg: "D#1.2/x" });
    expect(parseRoute("#review")).toEqual({ screen: "review", arg: undefined });
  });
});

describe("App boot", () => {
  it("opens the server's project, reads its fields and shows the counts", async () => {
    mount();
    expect(await screen.findByRole("region", { name: "Tests screen" })).toBeInTheDocument();
    await waitFor(() => expect(project()).toBe("C:\\p"));
    await waitFor(() => expect(screen.getByText(/fields 2/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Review/ })).toHaveTextContent("3");
    expect(callsOf("system.setup")).toHaveLength(1);
    expect(window.location.hash).toBe("");
  });

  it("reads the step columns again from Xray once per opened project, quietly", async () => {
    const x = appState().xray;
    net.routes["xray.fields"] = () => ({
      ...x,
      fields: [...x.fields, { id: "cf9", name: "Retired", type: "text", builtin: false, disabled: true }],
    });
    mount();
    expect(await screen.findByRole("region", { name: "Tests screen" })).toBeInTheDocument();
    await waitFor(() => expect(callsOf("xray.fields")).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Tests screen" })).toHaveTextContent(`fields ${x.fields.length + 1}`),
    );
  });

  it("prefers the remembered project and reads xray.json when the info has no fields", async () => {
    localStorage.setItem("testimus.project", "D:\\remembered");
    net.routes["project.info"] = () => info({ xray: { fields: [] } });
    net.files["xray.json"] = { fields: [{ id: "a", name: "A", type: "text", builtin: true }] };
    mount();
    await waitFor(() => expect(screen.getByText(/fields 1/)).toBeInTheDocument());
    expect(project()).toBe("D:\\remembered");
  });

  it("keeps the default fields when xray.json is missing too", async () => {
    net.routes["project.info"] = () => null;
    mount();
    await waitFor(() => expect(callsOf("file:xray.json")).toHaveLength(1));
    expect(screen.getByText(/fields 3/)).toBeInTheDocument();
  });

  it("falls back to xray.json when the project cannot be read, and says so when that fails too", async () => {
    net.routes["project.info"] = () => {
      throw new Fail("not a project");
    };
    net.files["xray.json"] = { fields: xray.fields };
    const first = mount();
    await waitFor(() => expect(screen.getByText(/fields 2/)).toBeInTheDocument());
    expect(screen.queryByText("Could not read the project")).toBeNull();
    first.unmount();
    delete net.files["xray.json"];
    mount();
    expect(await screen.findByText("Could not read the project")).toBeInTheDocument();
    cleanup();
    net.files["xray.json"] = new Error("network");
    mount();
    expect(await screen.findByText("Could not read the project")).toBeInTheDocument();
  });

  it("says when the core does not answer", async () => {
    net.api = null;
    mount();
    expect(await screen.findByText("Testimus is not answering")).toBeInTheDocument();
  });

  it("sends a first run to Setup: the project step without a project, the access step without credentials", async () => {
    net.api = () => ({ project: null, mock: false });
    const a = mount();
    await hashIs("#/setup/project");
    expect(await screen.findByRole("region", { name: "Setup screen" })).toBeInTheDocument();
    expect(sessionStorage.getItem("testimus.setupShown")).toBe("1");
    a.unmount();
    sessionStorage.clear();
    window.location.hash = "";
    net.api = () => ({ project: "C:\\p", commands: [] });
    net.routes["system.setup"] = () => ({ status: { jira: { complete: true }, xray: { complete: false } } });
    mount();
    await hashIs("#/setup");
  });

  it("does not send to Setup twice in a session, nor when already there, and survives a failed setup read", async () => {
    sessionStorage.setItem("testimus.setupShown", "1");
    net.api = () => ({ project: null, commands: [] });
    const a = mount();
    await waitFor(() => expect(callsOf("api")).toHaveLength(1));
    expect(callsOf("system.setup")).toHaveLength(0);
    a.unmount();
    sessionStorage.clear();
    window.location.hash = "#/setup";
    const b = mount();
    expect(await screen.findByRole("region", { name: "Setup screen" })).toBeInTheDocument();
    await waitFor(() => expect(callsOf("api")).toHaveLength(2));
    expect(callsOf("system.setup")).toHaveLength(0);
    b.unmount();
    window.location.hash = "";
    net.api = () => ({ project: "C:\\p", commands: [] });
    net.routes["system.setup"] = () => {
      throw new Fail("x");
    };
    mount();
    await waitFor(() => expect(callsOf("system.setup")).toHaveLength(1));
    expect(window.location.hash).toBe("");
  });
});

describe("App routing and layout", () => {
  it("shows the screen of the hash and follows its changes", async () => {
    window.location.hash = "#/documents/D%23%C2%A71";
    mount();
    expect(await screen.findByRole("region", { name: "Documents screen" })).toHaveTextContent("arg D#§1");
    for (const [hash, name] of [
      ["#/generate", "Generate screen"],
      ["#/jobs", "Jobs screen"],
      ["#/doctor", "Doctor screen"],
      ["#/import", "Import screen"],
      ["#/settings", "Settings screen"],
      ["#/tests", "Tests screen"],
    ]) {
      act(() => {
        window.location.hash = hash;
      });
      expect(await screen.findByRole("region", { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "same from Tests screen" }));
    expect(window.location.hash).toBe("#/tests");
  });

  it("folds the dock by default and around Review, and keeps the user's choice", async () => {
    mount();
    await screen.findByRole("region", { name: "Tests screen" });
    expect(folded()).toBe("true");
    act(() => {
      window.innerWidth = 1600;
      window.dispatchEvent(new Event("resize"));
    });
    expect(folded()).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "fold dock" }));
    expect(folded()).toBe("false");
    act(() => {
      window.location.hash = "#/review";
    });
    await screen.findByRole("region", { name: "Review screen" });
    await waitFor(() => expect(folded()).toBe("true"));
    act(() => {
      window.location.hash = "#/jobs";
    });
    await screen.findByRole("region", { name: "Jobs screen" });
    await waitFor(() => expect(folded()).toBe("false"));
    fireEvent.click(screen.getByRole("button", { name: "fold dock" }));
    expect(folded()).toBe("true");
    act(() => {
      window.innerWidth = 1600;
      window.dispatchEvent(new Event("resize"));
    });
    expect(folded()).toBe("true");
    act(() => {
      window.location.hash = "#/review";
    });
    await screen.findByRole("region", { name: "Review screen" });
    act(() => {
      window.location.hash = "#/tests";
    });
    await screen.findByRole("region", { name: "Tests screen" });
    await waitFor(() => expect(folded()).toBe("true"));
  });

  it("toggles the palette with Ctrl K and the dock with Ctrl J, ignoring other keys", async () => {
    mount();
    await screen.findByRole("region", { name: "Tests screen" });
    fireEvent.keyDown(window, { key: "k" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true, altKey: true });
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
    fireEvent.keyDown(window, { key: "K", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
    expect(folded()).toBe("true");
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    expect(folded()).toBe("false");
  });

  it("hands Claude requests and jobs from the screens to the dock", async () => {
    mount();
    await screen.findByRole("region", { name: "Tests screen" });
    expect(folded()).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "ask from Tests screen" }));
    expect(folded()).toBe("false");
    expect(request()).toMatchObject({ mode: "test", scope: "step", prompt: "why" });
    fireEvent.click(screen.getByRole("button", { name: "fold dock" }));
    fireEvent.click(screen.getByRole("button", { name: "job from Tests screen" }));
    expect(folded()).toBe("false");
    expect(request()).toMatchObject({ mode: "test", job: { name: "review.fix", testId: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: "changed from Tests screen" }));
    expect(screen.getByText(/nonce 1/)).toBeInTheDocument();
  });

  it("opens a source and goes to its document", async () => {
    net.routes["rag.passage"] = () => {
      throw new Fail("no index");
    };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "source from Tests screen" }));
    expect(await screen.findByRole("dialog", { name: "Source D §1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Source D §1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "source from Tests screen" }));
    fireEvent.click(await screen.findByRole("button", { name: /Open in document/ }));
    await hashIs(`#/documents/${encodeURIComponent("D#§1")}`);
    expect(await screen.findByRole("region", { name: "Documents screen" })).toBeInTheDocument();
  });
});

describe("App palette", () => {
  const open = async () => {
    fireEvent.click(await screen.findByRole("button", { name: /palette from/ }));
    return screen.getByRole("combobox");
  };
  const pick = async (query: string) => {
    const box = await open();
    fireEvent.change(box, { target: { value: query } });
    fireEvent.keyDown(box, { key: "Enter" });
  };

  it("runs the app actions: screens, theme, dock", async () => {
    mount();
    await screen.findByRole("region", { name: "Tests screen" });
    await waitFor(() => expect(callsOf("api")).toHaveLength(1));
    for (const [q, hash] of [
      ["go to documents", "#/documents"],
      ["go to settings", "#/settings"],
      ["system check", "#/doctor"],
      ["import a csv", "#/import"],
    ]) {
      await pick(q);
      await hashIs(hash);
    }
    await pick("theme: dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    await pick("theme: light");
    expect(document.documentElement.dataset.theme).toBe("light");
    await pick("follow the system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    await pick("show or hide claude");
    expect(folded()).toBe("false");
    await pick("show or hide claude");
    expect(folded()).toBe("true");
    await pick("une question libre");
    expect(folded()).toBe("false");
    expect(request()).toMatchObject({ mode: "docs", prompt: "une question libre" });
    await open();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("runs a command without input, telling a job from a direct result", async () => {
    net.routes["tests.list"] = () => [];
    net.routes["rag.index"] = () => ({ jobId: "j1" });
    mount();
    await waitFor(() => expect(callsOf("api")).toHaveLength(1));
    await pick("tests list");
    expect(await screen.findByText("tests.list done")).toBeInTheDocument();
    const infos = callsOf("project.info").length;
    await pick("rag index");
    expect(await screen.findByText("rag.index started")).toBeInTheDocument();
    expect(screen.getByText("Follow it in Jobs.")).toBeInTheDocument();
    await waitFor(() => expect(callsOf("project.info").length).toBe(infos + 1));
    expect(screen.getByText(/nonce 1/)).toBeInTheDocument();
    net.routes["tests.list"] = () => {
      throw new Fail("broken");
    };
    await pick("tests list");
    expect(await screen.findByText("tests.list failed")).toBeInTheDocument();
  });

  it("opens the form of a command with input and goes to Jobs when it starts one", async () => {
    net.routes["xray.pull"] = () => ({ jobId: "p1" });
    mount();
    await waitFor(() => expect(callsOf("api")).toHaveLength(1));
    await pick("xray pull");
    expect(await screen.findByRole("dialog", { name: "xray.pull" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "xray.pull" })).toBeNull();
    await pick("xray pull");
    fireEvent.change(screen.getByLabelText("key"), { target: { value: "LFRPS12-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await hashIs("#/jobs");
    expect(screen.queryByRole("dialog", { name: "xray.pull" })).toBeNull();
  });

  it("copes with a core that lists no commands", async () => {
    net.api = () => ({ project: "C:\\p" });
    mount();
    await waitFor(() => expect(callsOf("api")).toHaveLength(1));
    await open();
    expect(screen.queryByRole("option", { name: /tests list/ })).toBeNull();
  });
});

describe("App jobs", () => {
  it("counts the running jobs and announces a finished check", async () => {
    net.routes["jobs.list"] = () => [job({ id: "a" }), job({ id: "b" })];
    mount();
    const jobs = await screen.findByRole("button", { name: /Jobs/ });
    await waitFor(() => expect(jobs).toHaveTextContent("2"));
    act(() => {
      FakeES.emit(status(job({ id: "c" })));
      FakeES.emit({ jobId: "a", at: "", type: "progress", message: "x" });
    });
    expect(jobs).toHaveTextContent("3");
    act(() => {
      FakeES.emit(status(job({ id: "a", status: "done" })));
      FakeES.emit(
        status(
          job({
            id: "b",
            kind: "check",
            status: "done",
            result: { tests: [{ errors: 1, warnings: 0 }, null, { errors: 0, warnings: 0 }] },
          }),
        ),
      );
    });
    expect(jobs).toHaveTextContent("1");
    expect(await screen.findByText("Check finished — 2 tests, 1 with findings")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Review" }));
    await hashIs("#/review");
    act(() => {
      FakeES.emit(
        status(job({ id: "c", kind: "check", status: "done", result: { tests: [{ errors: 0, warnings: 0 }] } })),
      );
    });
    expect(await screen.findByText("Check finished — 1 test, 0 with findings")).toBeInTheDocument();
    act(() => {
      FakeES.emit(status(job({ id: "d", kind: "check", status: "done" })));
      FakeES.emit(status(job({ id: "e", kind: "check", status: "failed" })));
    });
    expect(await screen.findByText("Check finished — 0 tests, 0 with findings")).toBeInTheDocument();
  });

  it("survives a job list that fails or is empty", async () => {
    net.routes["jobs.list"] = () => {
      throw new Fail("x");
    };
    const a = mount();
    await waitFor(() => expect(callsOf("jobs.list").length).toBeGreaterThan(0));
    a.unmount();
    net.routes["jobs.list"] = () => null;
    mount();
    await waitFor(() => expect(callsOf("jobs.list").length).toBeGreaterThan(1));
    expect(screen.getByRole("button", { name: /Jobs/ })).not.toHaveTextContent(/\d/);
  });
});

describe("App file drops", () => {
  it("keeps the browser from opening a file dropped beside a drop target", async () => {
    mount();
    await screen.findByRole("region", { name: "Tests screen" });
    const drag = (type: string, types: string[] | null) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "dataTransfer", { value: types ? { types } : null });
      document.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(drag("dragover", ["Files"])).toBe(true);
    expect(drag("drop", ["Files"])).toBe(true);
    expect(drag("dragover", ["text/plain"])).toBe(false);
    expect(drag("drop", null)).toBe(false);
  });
});
