// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent, Test, XrayJson } from "../../src/core/types.ts";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { resetDoctor } from "../../src/ui/lib/doctor.ts";
import { DoctorScreen } from "../../src/ui/screens/doctor/DoctorScreen.tsx";
import { DocumentsScreen } from "../../src/ui/screens/documents/DocumentsScreen.tsx";
import { GenerateScreen } from "../../src/ui/screens/generate/GenerateScreen.tsx";
import { ReviewScreen } from "../../src/ui/screens/review/ReviewScreen.tsx";
import { ColumnsSection } from "../../src/ui/screens/settings/ColumnsSection.tsx";

type Handler = (input: Record<string, unknown>) => unknown;
type Call = { name: string; input: Record<string, unknown> };

let calls: Call[] = [];
let routes: Record<string, Handler> = {};

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeEventSource.last = this;
  }
  close() {}
  static emit(e: JobEvent) {
    act(() => FakeEventSource.last?.onmessage?.({ data: JSON.stringify(e) }));
  }
}

beforeEach(() => {
  calls = [];
  routes = {};
  resetDoctor();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      if (!m) return new Response("", { status: 404 });
      const name = `${m[1]}.${m[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ name, input });
      const h = routes[name];
      if (!h) return new Response(JSON.stringify({ error: `Unknown command ${name}` }), { status: 404 });
      return new Response(JSON.stringify(h(input) ?? null), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const xray: XrayJson = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "data", name: "Data", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
    { id: "cf", name: "Exigence", type: "text-single", builtin: false },
  ],
  prefs: { order: ["Action", "Data", "Expected Result", "Exigence"], collapsed: ["Data"], hidden: [] },
};

function appState(over: Partial<AppState> = {}): AppState {
  return {
    info: {
      dir: "C:/p",
      project: {
        name: "RATP Sosie",
        jiraProject: "LFRPS12",
        language: "fr",
        labelPrefix: "testimus-",
        folders: ["/Traction/Sectionneurs"],
        rag: { embedding: "bge-m3", reranker: null },
        claude: { model: "sonnet", effort: "medium", presets: [], contexts: [] },
      },
      xray,
    },
    xray,
    route: { screen: "review" },
    focus: null,
    claudeRunning: null,
    lastRun: null,
    testsNonce: 0,
    navigate: vi.fn(),
    setFocus: vi.fn(),
    setClaudeRunning: vi.fn(),
    setLastRun: vi.fn(),
    testsChanged: vi.fn(),
    refreshInfo: vi.fn(),
    closeProject: vi.fn(),
    openSource: vi.fn(),
    askClaude: vi.fn(),
    runInDock: vi.fn(),
    openPalette: vi.fn(),
    ...over,
  };
}

const wrap = (app: AppState, node: ReactNode) => render(<AppContext.Provider value={app}>{node}</AppContext.Provider>);

const named = (name: string) => calls.filter((c) => c.name === name);

const test1420: Test = {
  key: "LFRPS12-1420",
  project: "LFRPS12",
  summary: "Sectionneur sans TK — menu contextuel",
  folder: "/Traction/Sectionneurs",
  labels: [],
  description: "",
  covers: [],
  preconditions: [],
  review: "checked",
  steps: [
    {
      fields: { Action: "Ouvrir la vue de traction.", "Expected Result": "La vue s'affiche." },
      sources: [{ docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6", quote: "Selon le type de sectionneur" }],
      images: [],
    },
    {
      fields: {
        Action: "Clic droit sur le sectionneur S 12.",
        "Expected Result": "Le menu propose Propriétés.",
        Exigence: "EXI_MOP_SPF_511_A_1670, EXI_MOP_SPF_510_A_20",
      },
      sources: [{ docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6", quote: "Selon le type de sectionneur" }],
      images: [],
    },
  ],
  extra: {},
};

function reviewRoutes() {
  routes["review.queue"] = () => ({
    tests: [
      {
        id: "LFRPS12-1420",
        key: "LFRPS12-1420",
        summary: test1420.summary,
        folder: "/Traction/Sectionneurs",
        review: "checked",
        unchecked: false,
        errors: 1,
        warnings: 1,
        infos: 0,
        stale: false,
        mtime: 1,
      },
      {
        id: "local-3f9a12c0",
        summary: "Sectionneur avec TK — manœuvre régulière",
        folder: "/Traction/Sectionneurs",
        review: "to-fix",
        unchecked: true,
        errors: 0,
        warnings: 0,
        infos: 0,
        stale: false,
        mtime: 2,
      },
    ],
    counts: { checked: 1, toFix: 1, draft: 0, unchecked: 1 },
  });
  routes["tests.show"] = (i) => ({ id: i.id, test: test1420, sync: "synced" });
  routes["check.show"] = (i) => ({
    id: i.id,
    stale: false,
    check: {
      at: "2026-10-30T10:02:00.000Z",
      testHash: "x",
      findings: [
        {
          kind: "negative-missing",
          severity: "warning",
          message: "Aucun step ne vérifie le cas avec TK.",
          sources: ["SOSIE_211_D401-1_3#§5.6.6"],
        },
        {
          step: 2,
          kind: "contradicted",
          severity: "error",
          message: "Le passage porte sur le TCO à deux rangs.",
          sources: ["SOSIE_211_D401-1_3#§5.6.6"],
        },
      ],
    },
  });
  routes["claude.status"] = () => ({ installed: true, signedIn: true });
  routes["rag.passage"] = (i) => ({
    docId: "SOSIE_211_D401-1_3",
    anchor: String(i.ref).split("#")[1],
    path: "5 > 5.6 > 5.6.6",
    title: "Sectionneur (S)",
    text: "Selon le type de sectionneur, le menu contextuel diffère.",
    figures: [],
    doc: { code: "SOSIE_211_D401-1_3", title: "Traction", version: "01.01", status: "validated" },
  });
  routes["review.set"] = (i) => ({ id: i.id, review: i.decision === "validate" ? "validated" : "to-fix" });
}

describe("Review screen", () => {
  it("renders the queue, places findings on their step and validates with V", async () => {
    reviewRoutes();
    const app = appState();
    wrap(app, <ReviewScreen />);
    const queue = await screen.findByRole("complementary", { name: "Review queue" });
    await waitFor(() => expect(within(queue).getAllByRole("button", { name: /Sectionneur/ })).toHaveLength(2));
    expect(within(queue).getByText("Not in Jira yet")).toBeInTheDocument();
    expect(within(queue).getByText("Not checked yet")).toBeInTheDocument();

    const step2 = await screen.findByRole("article", { name: "Step 2" });
    expect(within(step2).getByText(/Error · Contradicted/)).toBeInTheDocument();
    expect(screen.getByText("Whole test")).toBeInTheDocument();
    expect(named("rag.passage")).toHaveLength(0);
    fireEvent.click(within(step2).getAllByRole("button", { name: /§5\.6\.6/ })[0]);
    await waitFor(() => expect(named("rag.passage").length).toBeGreaterThan(0));
    expect(named("rag.passage")[0].input.ref).toMatch(/^SOSIE_211_D401-1_3#/);
    expect(screen.getByTitle("1 error still open")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "v" });
    await waitFor(() => expect(named("review.set")).toHaveLength(1));
    expect(named("review.set")[0].input).toEqual({ id: "LFRPS12-1420", decision: "validate" });
    await waitFor(() => expect(app.navigate).toHaveBeenCalledWith("review", "local-3f9a12c0"));
  });

  it("asks for a note before marking To fix, then hands the fix to Claude", async () => {
    reviewRoutes();
    const app = appState();
    wrap(app, <ReviewScreen />);
    await screen.findByRole("article", { name: "Step 2" });
    // ponytail: the shortcut listens once the loaded test is rendered — under a loaded worker that can lag a frame
    const dialog = await waitFor(() => {
      if (!screen.queryByRole("dialog", { name: "Mark as To fix" })) fireEvent.keyDown(window, { key: "f" });
      return screen.getByRole("dialog", { name: "Mark as To fix" });
    });
    expect(screen.getByRole("button", { name: /^Validate(?!d)/ })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: /Mark To fix/ }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("note is required");
    expect(named("review.set")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/Note for the author/), {
      target: { value: "Retirer EXI_MOP_SPF_510_A_20 du step 2." },
    });
    expect(within(dialog).getByRole("checkbox")).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: /Mark To fix/ }));
    await waitFor(() => expect(named("review.set")).toHaveLength(1));
    expect(named("review.set")[0].input).toEqual({
      id: "LFRPS12-1420",
      decision: "to-fix",
      note: "Retirer EXI_MOP_SPF_510_A_20 du step 2.",
    });
    await waitFor(() =>
      expect(app.runInDock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "review.fix",
          testId: "LFRPS12-1420",
          input: { id: "LFRPS12-1420", note: "Retirer EXI_MOP_SPF_510_A_20 du step 2." },
        }),
      ),
    );
  });
});

describe("Generate screen", () => {
  it("shows the tests as they land from the job events", async () => {
    const written: string[] = [];
    const show = (summary: string): Test => ({ ...test1420, key: undefined, summary, review: "draft" });
    routes["claude.status"] = () => ({ installed: true, signedIn: true });
    routes["jobs.list"] = () => [];
    routes["docs.list"] = () => [];
    routes["gen.tests"] = () => ({ jobId: "job-gen" });
    routes["jobs.show"] = () => ({
      job: { id: "job-gen", kind: "generate", subject: "x", status: "running", startedAt: new Date().toISOString() },
      events: [],
    });
    routes["tests.list"] = () =>
      written.map((id) => ({
        id,
        summary: id,
        folder: "/",
        review: "draft",
        sync: "local",
        dirty: false,
        synced: false,
        mtime: 1,
        stepCount: 2,
      }));
    routes["tests.show"] = (i) => ({
      id: i.id,
      test: show(i.id === "local-aaaaaaaa" ? "Premier test" : "Second test"),
    });
    wrap(appState({ route: { screen: "generate" } }), <GenerateScreen />);
    fireEvent.change(screen.getByLabelText("What should be tested?"), { target: { value: "Les sectionneurs" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(named("gen.tests")).toHaveLength(1));
    expect(named("gen.tests")[0].input).toMatchObject({
      request: "Les sectionneurs",
      model: "sonnet",
      effort: "medium",
    });
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    await screen.findByText("Getting ready");

    const at = new Date().toISOString();
    FakeEventSource.emit({ jobId: "job-gen", at, type: "progress", message: "Writing local-aaaaaaaa (1)" });
    expect(await screen.findByLabelText("Claude is writing a test")).toBeInTheDocument();
    written.push("local-aaaaaaaa");
    FakeEventSource.emit({ jobId: "job-gen", at, type: "progress", message: "Writing local-bbbbbbbb (2)" });
    expect(await screen.findByText("Premier test")).toBeInTheDocument();
    expect(named("tests.show").map((c) => c.input.id)).not.toContain("local-bbbbbbbb");

    written.push("local-bbbbbbbb");
    FakeEventSource.emit({
      jobId: "job-gen",
      at,
      type: "status",
      job: {
        id: "job-gen",
        kind: "generate",
        subject: "x",
        status: "done",
        startedAt: at,
        endedAt: at,
        result: {
          runId: "r1",
          ok: true,
          summary: "",
          tests: ["local-aaaaaaaa", "local-bbbbbbbb"],
          checks: [
            { id: "local-aaaaaaaa", ok: true, review: "checked", errors: 0, warnings: 0 },
            { id: "local-bbbbbbbb", ok: false, review: "draft", errors: 2, warnings: 1 },
          ],
          changed: [],
          skipped: [{ item: "Alarme de sectionneur", why: "no passage describes the alarm" }],
          reportFound: true,
          durationMs: 1000,
        },
      },
    });
    expect(await screen.findByText("Second test")).toBeInTheDocument();
    expect(screen.getByText("2 tests written")).toBeInTheDocument();
    expect(screen.getByText(/no passage describes the alarm/)).toBeInTheDocument();
    expect(screen.getByText(/All 2 tests went through the check: 1 has findings/)).toBeInTheDocument();
    const head = (title: string) =>
      screen.getByRole("region", { name: title }).querySelector(".gcard-head") as HTMLElement;
    expect(within(head("Second test")).getByText("2 errors")).toBeInTheDocument();
    expect(within(head("Premier test")).getByText("No findings")).toBeInTheDocument();
    expect(named("check.run")).toHaveLength(0);
  });
});

describe("Documents screen", () => {
  it("lists the documents with their index state", async () => {
    const doc = (id: string, title: string, indexed: string) => ({
      id,
      code: id,
      title,
      version: "01.01",
      date: "",
      kind: "spec",
      status: "validated",
      source: { path: "", sha256: "", file: "source.docx" },
      convertedWith: "",
      convertedAt: "2026-11-02T10:00:00.000Z",
      warnings: indexed === "stale" ? ["2 Word comments were dropped"] : [],
      indexed,
    });
    routes["docs.list"] = () => [
      doc("SOSIE_211_D401-1_3", "Traction", "fresh"),
      doc("SOSIE_211_D401-1_4", "Signalisation", "stale"),
    ];
    routes["docs.show"] = (i) => ({
      doc: doc(String(i.id), "Traction", "fresh"),
      context: "",
      toc: [{ anchor: "§5", title: "Traction", level: 1 }],
      figures: [],
      md: "## 5 Traction",
    });
    wrap(appState({ route: { screen: "documents" } }), <DocumentsScreen />);
    const list = await screen.findByRole("region", { name: "Document list" });
    await waitFor(() => expect(within(list).getByText("Up to date")).toBeInTheDocument());
    expect(within(list).getByText("Reindex needed")).toBeInTheDocument();
    expect(within(list).getByText("Up to date").querySelector("svg")).not.toBeNull();
  });

  it("an added document waits, not converted and not indexed, until the team converts it", async () => {
    const doc = {
      id: "SOSIE_211_D401-1_5",
      code: "SOSIE_211_D401-1_5",
      title: "Itinéraires",
      version: "01.02",
      date: "",
      kind: "spec",
      status: "draft",
      source: { path: "", sha256: "", file: "source.docx" },
      convertedWith: "",
      convertedAt: "",
      warnings: [],
      indexed: "missing",
    };
    let added = false;
    routes["docs.list"] = () => (added ? [doc] : []);
    routes["docs.show"] = () => ({ doc, context: "", toc: [], figures: [], md: "" });
    routes["docs.add"] = () => {
      added = true;
      return { id: doc.id };
    };
    const app = appState({ route: { screen: "documents" } });
    const again = wrap(app, <DocumentsScreen />);
    await screen.findByRole("heading", { name: "Start with the specifications" });
    fireEvent.click(screen.getByRole("button", { name: "Add from a path" }));
    fireEvent.change(screen.getByLabelText("Path of the file"), {
      target: { value: "C:/docs/SOSIE_211_D401-1_5.docx" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "Document list" })).getByText("Not converted")).toBeVisible(),
    );
    const list = screen.getByRole("region", { name: "Document list" });
    expect(app.navigate).toHaveBeenCalledWith("documents", doc.id);
    expect(within(list).queryByText(/stopped/)).not.toBeInTheDocument();
    expect(within(list).queryByText("New document")).not.toBeInTheDocument();
    expect(within(list).getAllByText("Itinéraires")).toHaveLength(1);
    expect(named("rag.index")).toHaveLength(0);
    again.unmount();

    wrap(app, <DocumentsScreen />);
    const fresh = await screen.findByRole("region", { name: "Document list" });
    await waitFor(() => expect(within(fresh).getByText("Itinéraires")).toBeInTheDocument());
    expect(within(fresh).getByText("Not converted")).toBeInTheDocument();
  });
});

describe("System check", () => {
  it("shows each check as an icon and a word, with what to do", async () => {
    routes["system.doctor"] = () => ({
      ok: false,
      checks: [
        { id: "claude", label: "Claude Code CLI", state: "ok", detail: "claude 2.1.0" },
        {
          id: "claudeLogin",
          label: "Claude signed in",
          state: "warn",
          detail: "Claude is installed but not signed in.",
          fix: "Type claude, then /login.",
          action: { label: "Check Claude sign-in", command: "system.doctor", input: { claude: true } },
        },
        { id: "jira", label: "Jira reachable", state: "fail", detail: "401", fix: "Check the token." },
      ],
    });
    wrap(appState({ route: { screen: "doctor" } }), <DoctorScreen />);
    const list = await screen.findByRole("list", { name: "Checks" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    const rows = within(list).getAllByRole("listitem");
    const words = rows.map((r) => r.querySelector(".badge"));
    expect(words.map((w) => w?.textContent)).toEqual(["OK", "To do", "Failed"]);
    for (const w of words) expect(w?.querySelector("svg")).not.toBeNull();
    expect(rows[1]).toHaveTextContent("What to do: Type claude, then /login.");
    fireEvent.click(screen.getByRole("button", { name: "Check Claude sign-in" }));
    await waitFor(() => expect(named("system.doctor").some((c) => c.input.claude === true)).toBe(true));
  });
});

describe("Settings", () => {
  it("saves the step column preferences through xray.prefs", async () => {
    routes["xray.prefs"] = (i) => ({ ...xray, prefs: { ...xray.prefs, ...i } });
    const base = appState({ route: { screen: "settings" } });
    const columns = ["Action", "Data", "Expected Result", "Exigence"].map((name) => ({
      name,
      origin: "xray",
      builtin: name !== "Exigence",
      status: "ok",
      description: "",
    }));
    const app = { ...base, info: { ...base.info, columns } } as AppState;
    wrap(app, <ColumnsSection />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Exigence hidden" }));
    await waitFor(() => expect(named("xray.prefs")).toHaveLength(1));
    expect(named("xray.prefs")[0].input).toEqual({ hidden: ["Exigence"] });
    fireEvent.change(screen.getByRole("combobox", { name: "Data folding" }), { target: { value: "filled" } });
    await waitFor(() => expect(named("xray.prefs")).toHaveLength(2));
    expect(named("xray.prefs")[1].input).toEqual({ collapsed: [], filled: ["Data"] });
    expect(screen.getByRole("combobox", { name: "Action folding" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Exigence up" }));
    await waitFor(() => expect(named("xray.prefs")).toHaveLength(3));
    expect(named("xray.prefs")[2].input).toEqual({ order: ["Action", "Data", "Exigence", "Expected Result"] });
    expect(app.refreshInfo).toHaveBeenCalled();
  });
});
