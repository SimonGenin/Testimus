// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Folder, Job, JobEvent, LocalTestRef, RemoteTestRef } from "../../../../../src/core/types.ts";
import { setProject } from "../../../../../src/ui/api.ts";
import { Toaster } from "../../../../../src/ui/components/ui/Toast.tsx";
import { AppContext, type AppState } from "../../../../../src/ui/lib/app.ts";
import { closeToast, toast } from "../../../../../src/ui/lib/toast.ts";
import { abandonPulls } from "../../../../../src/ui/screens/tests/pulls.ts";
import { TestList } from "../../../../../src/ui/screens/tests/TestList.tsx";
import { TestsScreen } from "../../../../../src/ui/screens/tests/TestsScreen.tsx";
import { layoutOf } from "../../../helpers/layout.ts";
import { testClient, WithData } from "../data-helpers.tsx";

type Handler = (input: Record<string, unknown>) => unknown;
type Call = { name: string; input: Record<string, unknown>; project: string | null };

let calls: Call[] = [];
let seq = 0;
let home = "C:/p";
let routes: Record<string, Handler> = {};

// ponytail: api.ts keeps one stream for every listener, and a pull abandoned by an earlier test still
// listens — the event goes to whichever stream is open, not to the last one built
class FakeEventSource {
  static open: FakeEventSource[] = [];
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeEventSource.open.push(this);
  }
  close() {
    FakeEventSource.open = FakeEventSource.open.filter((x) => x !== this);
  }
  static emit(e: JobEvent) {
    act(() => FakeEventSource.open.at(-1)?.onmessage?.({ data: JSON.stringify(e) }));
  }
}

class FakeIO {
  static all: FakeIO[] = [];
  el: Element | null = null;
  dead = false;
  cb: (entries: { isIntersecting: boolean }[]) => void;
  opts: { rootMargin?: string };
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void, opts: { rootMargin?: string }) {
    this.cb = cb;
    this.opts = opts;
    FakeIO.all.push(this);
  }
  observe(el: Element) {
    this.el = el;
  }
  disconnect() {
    this.dead = true;
  }
  static fire() {
    for (const io of FakeIO.all.filter((x) => !x.dead && x.el)) act(() => io.cb([{ isIntersecting: true }]));
  }
}

beforeEach(() => {
  calls = [];
  routes = {};
  FakeIO.all = [];
  localStorage.clear();
  // ponytail: the list's view (tab, boxes, folds) is kept per project for the page's life — each case its own project
  home = `C:/p-${++seq}`;
  setProject(home);
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      if (!m) return new Response("", { status: 404 });
      const name = `${m[1]}.${m[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const p = init?.headers?.["X-Testimus-Project"];
      calls.push({ name, input, project: p ? decodeURIComponent(p) : null });
      const h = routes[name];
      if (!h) return new Response(JSON.stringify({ error: `Unknown command ${name}` }), { status: 404 });
      try {
        return new Response(JSON.stringify((await h(input)) ?? null), { status: 200 });
      } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400 });
      }
    }),
  );
});

afterEach(() => {
  abandonPulls();
  const last = toast({ tone: "neutral", title: "" });
  for (let i = 1; i <= last; i++) closeToast(i, true);
  cleanup();
  setProject(null);
  vi.unstubAllGlobals();
});

const named = (name: string) => calls.filter((c) => c.name === name);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

const ref = (over: Partial<LocalTestRef> & { id: string }): LocalTestRef => ({
  summary: over.id,
  folder: "/",
  labels: [],
  review: "draft",
  generated: false,
  edited: false,
  sync: "local",
  dirty: false,
  synced: false,
  mtime: Date.now(),
  stepCount: 1,
  ...over,
});

const remote = (key: string, summary: string, status = "Ready", stepCount = 3): RemoteTestRef => ({
  key,
  issueId: key,
  summary,
  status,
  labels: [],
  folder: "/Traction",
  stepCount,
});

const tree: Folder = {
  name: "/",
  path: "/",
  testsCount: 0,
  totalCount: 260,
  folders: [
    {
      name: "Traction",
      path: "/Traction",
      testsCount: 250,
      totalCount: 258,
      folders: [{ name: "Disjoncteurs", path: "/Traction/Disjoncteurs", testsCount: 8, totalCount: 8, folders: [] }],
    },
    { name: "Vide", path: "/Vide", testsCount: 0, totalCount: 0, folders: [] },
    { name: "Freinage", path: "/Freinage", testsCount: 2, totalCount: 2, folders: [] },
  ],
};

const slice = (folder: string, page: number, total: number) => ({
  tests: Array.from({ length: Math.min(100, total - page * 100) }, (_, i) =>
    remote(`LFRPS12-${page * 100 + i + 1}`, `${folder} test ${page * 100 + i + 1}`),
  ),
  total,
});

const local1398 = ref({
  id: "LFRPS12-1398",
  key: "LFRPS12-1398",
  summary: "Disjoncteur ouvert",
  folder: "/Traction",
  sync: "synced",
  synced: true,
});

// the file behind a row: the delete reads it again to know what it would lose
const fileOf = (summary: string) => ({
  key: "LFRPS12-1398",
  project: "LFRPS12",
  summary,
  folder: "/Traction",
  labels: [],
  description: "",
  covers: [],
  preconditions: [],
  review: "draft",
  steps: [{ fields: { Action: "Ouvrir" }, sources: [], images: [] }],
  extra: {},
});

function list(props: Partial<Parameters<typeof TestList>[0]> = {}) {
  const refs = props.refs ?? [local1398];
  return render(
    <WithData client={testClient()}>
      <AppContext.Provider value={appState({ screen: "tests" }, () => {}, "D:/P")}>
        <TestList refs={refs} loading={false} activeId="" onOpen={() => {}} onReload={async () => refs} {...props} />
      </AppContext.Provider>
    </WithData>,
  );
}

const folder = (name: RegExp) => screen.findByRole("treeitem", { name });
const opt = (name: RegExp) => screen.findByRole("option", { name });
const tipIn = (row: HTMLElement) =>
  within(row)
    .queryAllByRole("tooltip")
    .map((t) => t.textContent);
const rowAction = (row: HTMLElement, name: string) => {
  fireEvent.focus(row);
  return within(row).getByRole("button", { name });
};
// ponytail: the list is the screen's first section; its width is what the edge after it says
const listEdge = () => screen.getByRole("separator", { name: "Resize sections 1 and 2" });
const listWidth = () => listEdge().getAttribute("aria-valuenow");
const keptLayout = () => JSON.parse(localStorage.getItem("testimus.layoutTests") ?? "null");
const toJira = () => fireEvent.click(screen.getByRole("tab", { name: /^Jira/ }));
const search = (v: string) => fireEvent.change(screen.getByLabelText("Filter tests"), { target: { value: v } });
const jira = (v: string) => fireEvent.change(screen.getByLabelText("Search Jira"), { target: { value: v } });

describe("Tests sidebar › tabs and tree", () => {
  it("counts the local tests and the Jira tree, with a bar while the tree loads", async () => {
    const t = deferred<Folder>();
    routes["xray.folders"] = () => t.promise;
    list({ refs: [local1398, ref({ id: "local-1" })] });
    expect(screen.getByRole("tab", { name: /^Local/ })).toHaveTextContent(/^Local ?2$/);
    const jira = screen.getByRole("tab", { name: /^Jira/ });
    expect(jira).toHaveTextContent(/^Jira$/);
    t.resolve(tree);
    await waitFor(() => expect(jira).toHaveTextContent(/^Jira ?260$/));
  });

  it("draws 5 folder skeleton rows while the tree loads", () => {
    routes["xray.folders"] = () => new Promise(() => {});
    routes["xray.search"] = () => new Promise(() => {});
    list();
    toJira();
    const sk = screen.getByRole("status", { name: "Loading folders" });
    expect(sk.querySelectorAll('ul > li[role="presentation"] > [aria-hidden="true"]')).toHaveLength(5);
  });

  it("names the root Test Repository and shows direct/total counts", async () => {
    routes["xray.folders"] = () => tree;
    routes["xray.search"] = () => ({ tests: [], total: 0 });
    list();
    toJira();
    const root = await folder(/^Test Repository/);
    expect(within(root).getByText("0/260")).toHaveAttribute(
      "title",
      "0 directly in this folder, 260 including sub-folders",
    );
    const traction = await folder(/^Traction/);
    expect(traction).toHaveTextContent("250/258");
    expect(await folder(/^Freinage/)).toHaveTextContent(/Freinage2$/);
  });

  it("creates a new test in the folder picked on the Jira tab, else in the open test's folder", async () => {
    routes["xray.folders"] = () => tree;
    routes["xray.search"] = () => ({ tests: [], total: 0 });
    routes["tests.create"] = () => ({ id: "local-new" });
    list({ activeId: "LFRPS12-1398" });
    const create = () => screen.getAllByRole("button", { name: "New test" })[0];
    fireEvent.click(create());
    await waitFor(() => expect(named("tests.create")[0]?.input.folder).toBe("/Traction"));
    toJira();
    fireEvent.click(await folder(/^Freinage/));
    fireEvent.click(create());
    await waitFor(() => expect(named("tests.create")[1]?.input.folder).toBe("/Freinage"));
    search("frein");
    fireEvent.click(create());
    await waitFor(() => expect(named("tests.create")[2]?.input.folder).toBe("/Freinage"));
    jira("frein");
    fireEvent.click(create());
    await waitFor(() => expect(named("tests.create")[3]?.input.folder).toBe("/Traction"));
  });
});

describe("Tests sidebar › the folder list", () => {
  it("loads 100-test slices as the sentinel comes into view, once per slice, and says when all are in", async () => {
    routes["xray.folders"] = () => tree;
    const pending: Record<number, ReturnType<typeof deferred<unknown>>> = {};
    routes["xray.search"] = (i) => {
      if (i.folder !== "/Traction") return { tests: [], total: 0 };
      const d = deferred<unknown>();
      pending[i.page as number] = d;
      return d.promise;
    };
    list();
    toJira();
    fireEvent.click(await folder(/^Traction/));
    const sk = await screen.findByRole("status", { name: "Loading tests in /Traction" });
    expect(sk.querySelectorAll('ul > li[role="presentation"]')).toHaveLength(6);
    await waitFor(() => expect(pending[0]).toBeDefined());
    pending[0].resolve(slice("/Traction", 0, 250));
    expect(await screen.findByText("100 of 250")).toBeInTheDocument();
    expect(screen.getByText("/Traction")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading more tests in /Traction" })).toBeInTheDocument();
    FakeIO.fire();
    FakeIO.fire();
    await waitFor(() => expect(pending[1]).toBeDefined());
    expect(named("xray.search").filter((c) => c.input.folder === "/Traction" && c.input.page === 1)).toHaveLength(1);
    pending[1].resolve(slice("/Traction", 1, 250));
    expect(await screen.findByText("200 of 250")).toBeInTheDocument();
    FakeIO.fire();
    await waitFor(() => expect(pending[2]).toBeDefined());
    pending[2].resolve(slice("/Traction", 2, 250));
    expect(await screen.findByText("250 of 250")).toBeInTheDocument();
    expect(screen.getByText(/all 250 loaded/)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /Loading more/ })).toBeNull();
    // ponytail: the 250 rows by role, then each row's text — the same check as by accessible name, which computes the
    // style of every node of every row and took seconds alone in jsdom, the most of this test under load
    const rows = screen.getAllByRole("option");
    expect(rows).toHaveLength(250);
    for (const row of rows) expect(row).toHaveTextContent(/\/Traction test \d+/);
  });

  it("drops a slice that lands after another folder was opened", async () => {
    routes["xray.folders"] = () => tree;
    const traction = deferred<unknown>();
    routes["xray.search"] = (i) =>
      i.folder === "/Traction"
        ? traction.promise
        : i.folder === "/Freinage"
          ? slice("/Freinage", 0, 2)
          : { tests: [], total: 0 };
    list();
    toJira();
    fireEvent.click(await folder(/^Traction/));
    await waitFor(() => expect(named("xray.search").some((c) => c.input.folder === "/Traction")).toBe(true));
    fireEvent.click(await folder(/^Freinage/));
    expect(await screen.findByText("2 of 2")).toBeInTheDocument();
    traction.resolve(slice("/Traction", 0, 250));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("option", { name: /\/Traction test/ })).toBeNull();
    expect(screen.getAllByRole("option", { name: /\/Freinage test/ })).toHaveLength(2);
  });

  it("shows a Jira row's status pill, its step count, and whether it is local", async () => {
    routes["xray.folders"] = () => tree;
    routes["xray.search"] = (i) =>
      i.folder === "/Freinage"
        ? {
            tests: [
              remote("LFRPS12-9", "Nine", "In Review", 4),
              remote("LFRPS12-1398", "Disjoncteur ouvert", "Done", 1),
              remote("LFRPS12-7", "Seven", "Open", 0),
            ],
            total: 3,
          }
        : { tests: [], total: 0 };
    list();
    toJira();
    fireEvent.click(await folder(/^Freinage/));
    const nine = await opt(/Nine/);
    expect(tipIn(nine)).toContain("Not pulled yet — opening it downloads it into the project");
    expect(within(nine).getByText("In Review")).toBeInTheDocument();
    expect(within(nine).getByText("4 steps")).toBeInTheDocument();
    const local = await opt(/Disjoncteur ouvert/);
    expect(within(local).getByText("Done")).toBeInTheDocument();
    expect(within(local).getByText("In sync")).toBeInTheDocument();
    expect(tipIn(local)).not.toContain("Not pulled yet — opening it downloads it into the project");
    expect(within(await opt(/Seven/)).getByText("Open")).toBeInTheDocument();
  });

  it("says an empty folder is empty without asking Jira, and offers a local test", async () => {
    routes["xray.folders"] = () => tree;
    routes["xray.search"] = () => ({ tests: [], total: 0 });
    routes["tests.create"] = () => ({ id: "local-new" });
    list();
    toJira();
    fireEvent.click(await folder(/^Vide/));
    expect(await screen.findByText("No tests in this folder")).toBeInTheDocument();
    expect(screen.getByText("/Vide is empty. Pick another folder, or create a test locally.")).toBeInTheDocument();
    expect(named("xray.search").some((c) => c.input.folder === "/Vide")).toBe(false);
    fireEvent.click(screen.getAllByRole("button", { name: "New test" }).at(-1) as HTMLElement);
    await waitFor(() => expect(named("tests.create")[0]?.input.folder).toBe("/Vide"));
  });
});

describe("Tests sidebar › search", () => {
  it("filters local tests and offers a one-click Jira search", async () => {
    routes["xray.folders"] = () => tree;
    routes["xray.search"] = (i) =>
      i.text ? { tests: [remote("LFRPS12-5", "Disjoncteur fermé")], total: 1 } : { tests: [], total: 0 };
    list({ refs: [local1398, ref({ id: "local-1", summary: "Freinage" })] });
    search("disj");
    expect(await folder(/Disjoncteur ouvert/)).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: /^Freinage/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search Jira for “disj”" }));
    expect(screen.getByRole("tab", { name: /^Jira/ })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("search “disj”")).toBeInTheDocument();
    expect(await screen.findByText("1 found")).toBeInTheDocument();
    expect(named("xray.search").filter((c) => c.input.text === "disj")).toHaveLength(1);
  });

  it("Enter in the search box searches Jira at once", async () => {
    routes["xray.folders"] = () => tree;
    routes["xray.search"] = () => ({ tests: [remote("LFRPS12-5", "Disjoncteur fermé")], total: 1 });
    list({ refs: [local1398] });
    search("fermé");
    expect(screen.getByRole("tab", { name: /^Local/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Filter tests" }), { key: "Enter" });
    expect(screen.getByRole("tab", { name: /^Jira/ })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("1 found")).toBeInTheDocument();
  });

  it("any text in « Search Jira » jumps to the Jira tab and asks Jira, as Xray Editor's top-bar search", async () => {
    routes["xray.folders"] = () => tree;
    routes["xray.search"] = () => ({ tests: [], total: 0 });
    list();
    jira("1420");
    expect(screen.getByRole("tab", { name: /^Jira/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(named("xray.search").some((c) => c.input.text === "1420")).toBe(true));
    fireEvent.click(screen.getByRole("tab", { name: /^Local/ }));
    jira("sectionneur");
    expect(screen.getByRole("tab", { name: /^Jira/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(named("xray.search").some((c) => c.input.text === "sectionneur")).toBe(true));
  });

  it("« Filter tests » narrows the Jira folders and the listed Jira tests without asking Jira", async () => {
    routes["xray.folders"] = () => ({ ...tree, testsCount: 2 });
    routes["xray.search"] = (i) =>
      i.text
        ? { tests: [], total: 0 }
        : { tests: [remote("LFRPS12-1", "Essai frein"), remote("LFRPS12-2", "Disjoncteur")], total: 2 };
    list();
    toJira();
    expect(await opt(/Essai frein/)).toBeInTheDocument();
    search("disj");
    expect(screen.queryByRole("option", { name: /Essai frein/ })).toBeNull();
    expect(await opt(/^Disjoncteur.*LFRPS12-2/)).toBeInTheDocument();
    expect(await folder(/^Disjoncteurs/)).toBeInTheDocument();
    expect(named("xray.search").filter((c) => c.input.text)).toHaveLength(0);
  });

  it("debounces the Jira search, shows skeletons and never stale rows, and filters folder names", async () => {
    routes["xray.folders"] = () => ({ ...tree, testsCount: 1 });
    const answers: Record<string, ReturnType<typeof deferred<unknown>>> = {};
    routes["xray.search"] = (i) => {
      if (!i.text) return slice("/", 0, 1);
      const d = deferred<unknown>();
      answers[i.text as string] = d;
      return d.promise;
    };
    list();
    toJira();
    expect(await opt(/\/ test 1/)).toBeInTheDocument();
    jira("d");
    jira("di");
    jira("disj");
    expect(screen.queryByRole("option", { name: /\/ test 1/ })).toBeNull();
    expect(screen.getByRole("status", { name: "Searching Jira for disj" })).toBeInTheDocument();
    await waitFor(() => expect(answers.disj).toBeDefined());
    expect(Object.keys(answers)).toEqual(["disj"]);
    answers.disj.resolve({ tests: [remote("LFRPS12-5", "Disjoncteur fermé")], total: 1 });
    expect(await opt(/Disjoncteur fermé/)).toBeInTheDocument();
    search("disj");
    expect(tipIn(await folder(/^Disjoncteurs/))).toContain("/Traction/Disjoncteurs");
    expect(screen.queryByRole("treeitem", { name: /^Traction/ })).toBeNull();
    fireEvent.click(await folder(/^Disjoncteurs/));
    expect(screen.getByLabelText("Search Jira")).toHaveValue("");
    expect(screen.getByLabelText("Filter tests")).toHaveValue("");
    expect(await folder(/^Disjoncteurs/)).toHaveAttribute("aria-selected", "true");
  });
});

describe("Tests sidebar › local rows", () => {
  it("deletes a pushed, unchanged copy at once and says so", async () => {
    routes["tests.remove"] = () => ({ removed: true });
    routes["tests.show"] = () => ({ test: fileOf("Disjoncteur ouvert"), remote: fileOf("Disjoncteur ouvert") });
    const onDeleted = vi.fn();
    list({ onDeleted });
    fireEvent.click(rowAction(await folder(/^Disjoncteur ouvert/), "Delete the local copy of LFRPS12-1398"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("LFRPS12-1398"));
    expect(named("tests.remove")[0].input).toEqual({ id: "LFRPS12-1398" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks first for the only copy or unpushed changes", async () => {
    routes["tests.remove"] = () => ({ removed: true });
    routes["tests.show"] = () => ({ test: { ...fileOf("Brouillon"), key: undefined }, remote: null });
    const onDeleted = vi.fn();
    list({ refs: [ref({ id: "local-1", summary: "Brouillon" })], onDeleted });
    fireEvent.click(rowAction(await folder(/^Brouillon/), "Delete the local copy of Brouillon"));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete the local copy?" });
    expect(within(dialog).getByText(/never pushed, so this is the only copy/)).toBeInTheDocument();
    expect(named("tests.remove")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("local-1"));
  });
});

function appState(route: AppState["route"], navigate: AppState["navigate"], dir: string): AppState {
  return {
    info: {
      dir,
      project: { jiraProject: "LFRPS12" } as never,
      xray: layoutOf([], { order: [], collapsed: [], hidden: [] }),
    },
    xray: layoutOf([], { order: [], collapsed: [], hidden: [] }),
    route,
    focus: null,
    claudeRunning: null,
    lastRun: null,
    testsNonce: 0,
    navigate,
    setFocus: vi.fn(),
    setClaudeRunning: vi.fn(),
    setLastRun: vi.fn(),
    testsChanged: vi.fn(),
    refreshInfo: vi.fn(),
    closeProject: vi.fn(),
    openSource: vi.fn(),
    askClaude: vi.fn(),
    runInDock: vi.fn(),
    askAbout: vi.fn(),
    openPalette: vi.fn(),
  };
}

const nav = vi.fn();
let switchProject: (dir: string) => void = () => {};

function Harness() {
  const [route, setRoute] = useState<AppState["route"]>({ screen: "tests" });
  const [dir, setDir] = useState(home);
  const [client] = useState(testClient);
  switchProject = (d) => {
    setProject(d);
    setDir(d);
  };
  const navigate = (screen: AppState["route"]["screen"], arg?: string) => {
    nav(screen, arg);
    setRoute({ screen, arg });
  };
  return (
    <WithData client={client}>
      <AppContext.Provider value={appState(route, navigate, dir)}>
        <TestsScreen />
        <Toaster />
      </AppContext.Provider>
    </WithData>
  );
}

describe("Tests screen › pull queue", () => {
  let locals: LocalTestRef[];
  let jobs: Record<string, Job>;
  let n: number;

  beforeEach(() => {
    nav.mockReset();
    locals = [];
    jobs = {};
    n = 0;
    routes["tests.list"] = () => locals;
    routes["xray.folders"] = () => tree;
    routes["xray.search"] = (i) =>
      i.folder === "/Freinage"
        ? { tests: [remote("LFRPS12-8", "Eight"), remote("LFRPS12-9", "Nine")], total: 2 }
        : { tests: [], total: 0 };
    routes["xray.pull"] = (i) => {
      const id = `job-${++n}`;
      jobs[id] = {
        id,
        kind: "pull",
        subject: String(i.key),
        status: "running",
        startedAt: new Date().toISOString(),
      };
      return { jobId: id };
    };
    routes["jobs.show"] = (i) => ({ job: jobs[i.id as string], events: [] });
    routes["jobs.cancel"] = () => ({ cancelled: true });
    routes["jobs.list"] = () => Object.values(jobs).reverse();
  });

  // ponytail: the server keeps what its jobs said (jobs.list answers with it), and the stream carries it
  const say = (e: Extract<JobEvent, { type: "progress" }>) => {
    jobs[e.jobId] = { ...jobs[e.jobId], message: e.message };
    FakeEventSource.emit(e);
  };

  const finish = (id: string, result: unknown, status: Job["status"] = "done", error?: string) => {
    jobs[id] = { ...jobs[id], status, result, error, endedAt: new Date().toISOString() };
    FakeEventSource.emit({ jobId: id, at: "", type: "status", job: jobs[id] });
  };

  const openFreinage = async () => {
    render(<Harness />);
    toJira();
    fireEvent.click(await folder(/^Freinage/));
  };

  it("switches to a pulling pane at once, follows the progress, and opens the test in place", async () => {
    await openFreinage();
    fireEvent.click(await opt(/Nine/));
    expect(nav).toHaveBeenLastCalledWith("tests", "LFRPS12-9");
    const main = screen.getByRole("main");
    const line = () => within(main).getByRole("status", { name: "Pull progress" });
    expect(within(main).getByRole("region", { name: "Pulling LFRPS12-9" })).toBeInTheDocument();
    expect(within(main).getByText("Nine")).toBeInTheDocument();
    expect(line()).toHaveTextContent("contacting Jira…");
    expect(within(await opt(/Nine/)).getByText("Pulling…")).toBeInTheDocument();
    await waitFor(() => expect(named("xray.pull")).toHaveLength(1));
    say({ jobId: "job-1", at: "", type: "progress", message: "LFRPS12-9: image 3 of 12 downloaded" });
    await waitFor(() => expect(line()).toHaveTextContent("image 3 of 12 downloaded"));
    locals = [ref({ id: "LFRPS12-9", key: "LFRPS12-9", summary: "Nine", sync: "synced", synced: true })];
    routes["tests.show"] = () => new Promise(() => {});
    finish("job-1", { pulled: ["LFRPS12-9"], skipped: [], failed: [] });
    await waitFor(() => expect(within(main).queryByRole("region", { name: "Pulling LFRPS12-9" })).toBeNull());
    expect(nav).toHaveBeenCalledTimes(1);
    await waitFor(async () => expect(await opt(/^Nine/)).toHaveTextContent("In sync"));
  });

  it("queues pulls, follows the last row clicked, and lands the others quietly", async () => {
    await openFreinage();
    fireEvent.click(await opt(/Eight/));
    fireEvent.click(await opt(/Nine/));
    await waitFor(() => expect(named("xray.pull")).toHaveLength(2));
    const main = screen.getByRole("main");
    expect(within(main).getByRole("region", { name: "Pulling LFRPS12-9" })).toBeInTheDocument();
    expect(await within(main).findByText("1 more pulling in the background")).toBeInTheDocument();
    say({ jobId: "job-1", at: "", type: "progress", message: "LFRPS12-8: steps fetched" });
    await waitFor(() =>
      expect(within(main).getByRole("status", { name: "Pull progress" })).toHaveTextContent("waiting for a free slot…"),
    );
    locals = [ref({ id: "LFRPS12-8", key: "LFRPS12-8", summary: "Eight", sync: "synced", synced: true })];
    const lists = named("tests.list").length;
    finish("job-1", { pulled: ["LFRPS12-8"], skipped: [], failed: [] });
    await waitFor(() => expect(named("tests.list").length).toBeGreaterThan(lists));
    expect(within(main).getByRole("region", { name: "Pulling LFRPS12-9" })).toBeInTheDocument();
    expect(nav.mock.calls.map((c) => c[1])).toEqual(["LFRPS12-8", "LFRPS12-9"]);
  });

  it("reports an unwatched failure as a toast and a watched one as an error pane with Retry and Back", async () => {
    await openFreinage();
    fireEvent.click(await opt(/Eight/));
    fireEvent.click(await opt(/Nine/));
    await waitFor(() => expect(named("xray.pull")).toHaveLength(2));
    finish("job-1", null, "failed", "Jira said 500");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not pull LFRPS12-8");
    finish("job-2", null, "failed", "Jira said 404");
    const main = screen.getByRole("main");
    expect(await within(main).findByText("Could not pull LFRPS12-9")).toBeInTheDocument();
    expect(within(main).getByText("Jira said 404")).toBeInTheDocument();
    fireEvent.click(within(main).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(named("xray.pull")).toHaveLength(3));
    expect(within(main).getByRole("region", { name: "Pulling LFRPS12-9" })).toBeInTheDocument();
    finish("job-3", null, "failed", "again");
    fireEvent.click(await within(main).findByRole("button", { name: "Back" }));
    expect(nav).toHaveBeenLastCalledWith("tests", undefined);
    expect(within(main).getByText("No test yet")).toBeInTheDocument();
  });

  it("cancels a pull, and a project switch abandons every pull and closes the test", async () => {
    await openFreinage();
    fireEvent.click(await opt(/Eight/));
    await waitFor(() => expect(named("xray.pull")).toHaveLength(1));
    await waitFor(() => expect(named("jobs.show").length).toBeGreaterThan(0));
    fireEvent.click(within(screen.getByRole("main")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(named("jobs.cancel")[0]?.input).toEqual({ id: "job-1" }));
    expect(nav).toHaveBeenLastCalledWith("tests", undefined);

    fireEvent.click(await opt(/Nine/));
    await waitFor(() => expect(named("xray.pull")).toHaveLength(2));
    await waitFor(() => expect(named("jobs.show").some((c) => c.input.id === "job-2")).toBe(true));
    act(() => switchProject("C:/q"));
    await waitFor(() => expect(named("jobs.cancel")).toHaveLength(2));
    expect(named("jobs.cancel")[1]).toMatchObject({ input: { id: "job-2" }, project: home });
    expect(nav).toHaveBeenLastCalledWith("tests", undefined);
    expect(screen.getByRole("tab", { name: /^Local/ })).toHaveAttribute("aria-selected", "true");
    finish("job-2", { pulled: ["LFRPS12-9"], skipped: [], failed: [] });
    expect(screen.queryByRole("heading", { name: /Pulling/ })).toBeNull();
  });
});

describe("Tests screen › layout", () => {
  beforeEach(() => {
    nav.mockReset();
    routes["tests.list"] = () => [local1398];
    routes["xray.folders"] = () => new Promise(() => {});
  });

  it("resizes the list's column with no ceiling but the room, remembers it, and resets on double-click", () => {
    render(<Harness />);
    const edge = listEdge();
    fireEvent.pointerDown(edge, { clientX: 0 });
    fireEvent.pointerMove(edge, { clientX: 900 });
    expect(listWidth()).toBe("1220");
    fireEvent.pointerMove(edge, { clientX: 20 });
    fireEvent.pointerUp(edge);
    expect(listWidth()).toBe("340");
    expect(keptLayout().columns[0].width).toBe(340);
    fireEvent.doubleClick(edge);
    expect(listWidth()).toBe("320");
    expect(keptLayout().columns[0].width).toBe(320);
  });

  it("folds the list's section to its strip, opens it from the strip's expand button, and opens a test", async () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByRole("button", { name: "Collapse this section" })[0]);
    const strip = screen.getByRole("navigation", { name: "Section 1, collapsed" });
    expect(screen.queryByRole("separator", { name: "Resize sections 1 and 2" })).toBeNull();
    expect(keptLayout().columns[0].sections[0].collapsed).toBe(true);
    fireEvent.click(within(strip).getByRole("button", { name: "Expand this section" }));
    expect(screen.queryByRole("navigation", { name: "Section 1, collapsed" })).toBeNull();
    expect(keptLayout().columns[0].sections[0].collapsed).toBe(false);
    routes["tests.show"] = () => new Promise(() => {});
    fireEvent.click(await folder(/Disjoncteur ouvert/));
    expect(nav).toHaveBeenCalledWith("tests", local1398.id);
  });

  it("puts Jira's folders and tests side by side in a wider list column, or one above the other, and remembers it", () => {
    render(<Harness />);
    expect(listWidth()).toBe("320");
    expect(screen.queryByRole("radiogroup", { name: "Folders and tests" })).toBeNull();
    toJira();
    expect(listWidth()).toBe("640");
    expect(screen.getByRole("radio", { name: "Side by side" })).toBeChecked();
    expect(screen.getByRole("separator", { name: "Resize the folders" })).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
    fireEvent.click(screen.getByRole("radio", { name: "One above the other" }));
    expect(localStorage.getItem("testimus.jiraLayout")).toBe("rows");
    expect(listWidth()).toBe("320");
    expect(screen.getByRole("separator", { name: "Resize the folders and the tests" })).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Side by side" }));
    expect(localStorage.getItem("testimus.jiraLayout")).toBeNull();
    expect(listWidth()).toBe("640");
    fireEvent.click(screen.getByRole("tab", { name: /^Local/ }));
    expect(listWidth()).toBe("320");
  });

  it("splits Jira's panes by a share of the sidebar: dragged, kept, and back to half on double-click", () => {
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
    try {
      render(<Harness />);
      toJira();
      const edge = screen.getByRole("separator", { name: "Resize the folders" });
      const first = edge.previousElementSibling as HTMLElement;
      expect(first.style.flexBasis).toBe("50%");
      fireEvent.pointerDown(edge, { clientX: 0 });
      fireEvent.pointerMove(edge, { clientX: 900 });
      expect(first.style.flexBasis).toBe("80%");
      fireEvent.pointerMove(edge, { clientX: 60 });
      fireEvent.pointerUp(edge);
      expect(first.style.flexBasis).toBe("60%");
      expect(localStorage.getItem("testimus.jiraColumnsShare")).toBe("60");
      fireEvent.doubleClick(edge);
      expect(first.style.flexBasis).toBe("50%");
      expect(localStorage.getItem("testimus.jiraColumnsShare")).toBeNull();
    } finally {
      if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
    }
  });

  it("shows the local tests in two panes too — side by side or one above the other — or as one tree, and remembers it", async () => {
    routes["tests.list"] = () => [
      local1398,
      ref({ id: "root-1", summary: "À la racine" }),
      ref({ id: "urg-1", summary: "Freinage d'urgence", folder: "/Freinage/Urgence" }),
    ];
    render(<Harness />);
    expect(await screen.findByRole("radio", { name: "One tree" })).toBeChecked();
    expect(listWidth()).toBe("320");
    fireEvent.click(screen.getByRole("radio", { name: "Side by side" }));
    expect(localStorage.getItem("testimus.localLayout")).toBe("columns");
    expect(listWidth()).toBe("640");
    expect(screen.getByRole("separator", { name: "Resize the folders" })).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
    const folders = screen.getByRole("tree", { name: "Local folders" });
    const tests = (where: string) => screen.getByRole("listbox", { name: `Local tests in ${where}` });
    expect(within(tests("Test Repository")).getByRole("option", { name: /À la racine/ })).toBeInTheDocument();
    expect(within(tests("Test Repository")).queryByRole("option", { name: /Disjoncteur/ })).toBeNull();
    fireEvent.click(within(folders).getByRole("treeitem", { name: /^Traction/ }));
    expect(within(tests("/Traction")).getByRole("option", { name: /Disjoncteur ouvert/ })).toBeInTheDocument();
    expect(screen.getByTestId("local-range")).toHaveTextContent("1");
    fireEvent.click(within(folders).getByRole("treeitem", { name: /^Freinage/ }));
    expect(screen.getByText("No test directly in this folder")).toBeInTheDocument();
    expect(screen.getByText("1 test in its sub-folders.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "One above the other" }));
    expect(listWidth()).toBe("320");
    expect(screen.getByRole("separator", { name: "Resize the folders and the tests" })).toBeInTheDocument();
    search("Disjoncteur");
    expect(screen.queryByRole("tree", { name: "Local folders" })).toBeNull();
    search("");
    fireEvent.click(screen.getByRole("radio", { name: "One tree" }));
    expect(localStorage.getItem("testimus.localLayout")).toBeNull();
    expect(screen.queryByRole("tree", { name: "Local folders" })).toBeNull();
    expect(screen.getByRole("tree", { name: "Local tests" })).toBeInTheDocument();
  });

  it("picks the open test's folder in the local panes, and puts New test in the folder picked", async () => {
    localStorage.setItem("testimus.localLayout", "columns");
    const urgent = ref({ id: "urg-1", summary: "Freinage d'urgence", folder: "/Freinage/Urgence" });
    routes["tests.create"] = () => ({ id: "new-1" });
    list({ refs: [local1398, urgent], activeId: "urg-1" });
    const tests = screen.getByRole("listbox", { name: "Local tests in /Freinage/Urgence" });
    expect(within(tests).getByRole("option", { name: /Freinage d'urgence/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(
      within(screen.getByRole("tree", { name: "Local folders" })).getByRole("treeitem", { name: /^Traction/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "New test" }));
    await waitFor(() => expect(named("tests.create")).toHaveLength(1));
    expect(named("tests.create")[0].input).toMatchObject({ folder: "/Traction" });
  });

  it("the empty pane is the Jira/Xray connection form while access is incomplete (Xray Editor's connect screen)", async () => {
    const creds = (complete: boolean) => ({
      status: {
        jira: { file: "j", exists: true, complete, invalid: false },
        xray: { file: "x", exists: complete, complete, invalid: false },
      },
      saved: [],
      checks: [],
      ok: complete,
    });
    routes["system.credentials"] = routes["system.setCredentials"] = () => creds(false);
    const first = render(<Harness />);
    expect(await screen.findByRole("heading", { name: "Connect to Jira and Xray" })).toBeInTheDocument();
    first.unmount();
    routes["system.credentials"] = routes["system.setCredentials"] = () => creds(true);
    render(<Harness />);
    expect(await screen.findByText("No test open")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Connect to Jira and Xray" })).toBeNull();
  });
});
