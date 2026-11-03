// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { XrayJson } from "../../src/core/types.ts";
import type { CommandInfo } from "../../src/ui/api.ts";
import { CommandForm, plannedFirst } from "../../src/ui/components/shell/CommandForm.tsx";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { ImportScreen, stillImporting } from "../../src/ui/screens/import/ImportScreen.tsx";

type Call = { name: string; input: Record<string, unknown> };
let calls: Call[] = [];
let routes: Record<string, (input: Record<string, unknown>) => unknown> = {};

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      const name = `${m?.[1]}.${m?.[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ name, input });
      const h = routes[name];
      if (!h) return new Response(JSON.stringify({ error: `Unknown command ${name}` }), { status: 404 });
      return new Response(JSON.stringify((await h(input)) ?? null), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const named = (n: string) => calls.filter((c) => c.name === n);

const xray: XrayJson = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  prefs: { order: ["Action", "Expected Result"], collapsed: [], hidden: [] },
};

const app = (): AppState => ({
  info: {
    dir: "C:/p",
    project: {
      name: "RATP Sosie",
      jiraProject: "LFRPS12",
      language: "fr",
      labelPrefix: "testimus-",
      folders: [],
      rag: { embedding: "bge-m3", reranker: null },
      claude: { model: "sonnet", effort: "medium", presets: [], contexts: [] },
    },
    xray,
  } as unknown as AppState["info"],
  xray,
  route: { screen: "import" },
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
  openSource: vi.fn(),
  askClaude: vi.fn(),
  runInDock: vi.fn(),
  openAction: vi.fn(),
  openPalette: vi.fn(),
});

const command = (name: string, props: Record<string, { type: string; enum?: string[] }>): CommandInfo => ({
  name,
  summary: name,
  mutates: true,
  job: name === "xray.push",
  input: { type: "object", properties: props } as CommandInfo["input"],
});

const preview = {
  headers: ["Action", "Expected Result"],
  mapping: { Action: "Action", "Expected Result": "Expected Result" },
  tests: [
    { summary: "Sectionneur", folder: "", row: 2, steps: [{ fields: { Action: "Ouvrir", "Expected Result": "Vu" } }] },
  ],
  warnings: [],
  written: [],
};

describe("palette never writes to Jira blind", () => {
  it("knows which commands are planned first", () => {
    expect(plannedFirst("xray.push", { id: "LFRPS12-1420" })).toBe("push");
    expect(plannedFirst("xray.push", { id: "LFRPS12-1420", dryRun: true })).toBeNull();
    expect(plannedFirst("xray.importCsv", { mode: "direct", file: "a.csv" })).toBe("import");
    expect(plannedFirst("xray.importCsv", { mode: "direct", jobId: "X-9" })).toBeNull();
    expect(plannedFirst("xray.importCsv", { mode: "local", file: "a.csv" })).toBeNull();
  });

  it("opens the push plan dialog and pushes with its planHash", async () => {
    routes["xray.plan"] = () => ({
      testId: "LFRPS12-1420",
      ops: [{ kind: "update", label: "Update the summary" }],
      warnings: [],
      remoteChanged: false,
      review: "validated",
      planHash: "h-7",
    });
    routes["xray.push"] = () => ({
      ok: true,
      id: "LFRPS12-1420",
      ops: [{ label: "Update the summary", status: "done" }],
    });
    render(<CommandForm command={command("xray.push", { id: { type: "string" } })} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("id (optional)"), { target: { value: "LFRPS12-1420" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const confirm = await screen.findByRole("button", { name: "Confirm push" });
    expect(named("xray.push")).toHaveLength(0);
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(named("xray.push")).toHaveLength(1));
    expect(named("xray.push")[0].input).toEqual({ id: "LFRPS12-1420", planHash: "h-7" });
  });

  it("plans a direct CSV import with dryRun before sending it", async () => {
    routes["xray.importCsv"] = (i) =>
      i.dryRun ? { ...preview, plan: [{ kind: "create", label: "Create 1 test in LFRPS12" }] } : preview;
    render(
      <CommandForm
        command={command("xray.importCsv", {
          mode: { type: "string", enum: ["preview", "local", "direct"] },
          file: { type: "string" },
        })}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("mode (optional)"), { target: { value: "direct" } });
    fireEvent.change(screen.getByLabelText("file (optional)"), { target: { value: "C:/a.csv" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText("Create 1 test in LFRPS12");
    expect(named("xray.importCsv").map((c) => c.input)).toEqual([{ mode: "direct", file: "C:/a.csv", dryRun: true }]);
    fireEvent.click(screen.getByRole("button", { name: "Import into Xray" }));
    await waitFor(() => expect(named("xray.importCsv")).toHaveLength(2));
    expect(named("xray.importCsv")[1].input).toEqual({ mode: "direct", file: "C:/a.csv" });
  });
});

describe("direct import still running in Xray", () => {
  it("reads the job and its warning", () => {
    expect(stillImporting({ ...preview, jobId: "X-9", warning: "Xray is still importing" })).toEqual({
      jobId: "X-9",
      warning: "Xray is still importing",
    });
    expect(stillImporting(preview)).toBeNull();
  });

  it("opens Review on the first draft, unless the user left the screen before the import answered", async () => {
    let answer: (v: unknown) => void = () => {};
    routes["xray.importCsv"] = (i) =>
      i.mode === "preview"
        ? preview
        : new Promise((f) => {
            answer = f;
          });
    routes["check.run"] = () => ({});
    const state = app();
    const r = render(
      <AppContext.Provider value={state}>
        <ImportScreen />
      </AppContext.Provider>,
    );
    const csv = new File(["Action,Expected Result\nOuvrir,Vu\n"], "tests.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [csv] } });
    fireEvent.click(await screen.findByRole("button", { name: "Import 1 test locally" }));
    await waitFor(() => expect(named("xray.importCsv").at(-1)?.input).toMatchObject({ mode: "local" }));
    answer({ ...preview, written: ["local-0000aaaa"] });
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("review", "local-0000aaaa"));

    fireEvent.click(screen.getByRole("button", { name: "Import 1 test locally" }));
    await waitFor(() => expect(named("xray.importCsv").filter((c) => c.input.mode === "local")).toHaveLength(2));
    r.unmount();
    answer({ ...preview, written: ["local-0000bbbb"] });
    await waitFor(() => expect(state.testsChanged).toHaveBeenCalledTimes(2));
    expect(state.navigate).toHaveBeenCalledTimes(1);
  });

  it("shows « Xray is still importing » and checks again with the job id", async () => {
    const note = "Xray is still importing (job X-9, PENDING) — run the import again with jobId X-9.";
    let checks = 0;
    routes["xray.importCsv"] = (i) => {
      if (i.mode === "preview") return preview;
      if (i.dryRun) return { ...preview, plan: [{ kind: "create", label: "Create 1 test in LFRPS12" }] };
      if (i.jobId) {
        checks++;
        return { ...preview, headers: [], tests: [], written: ["LFRPS12-2001"] };
      }
      return { ...preview, warnings: [note], jobId: "X-9" };
    };
    const state = app();
    render(
      <AppContext.Provider value={state}>
        <ImportScreen />
      </AppContext.Provider>,
    );
    const csv = new File(["Action,Expected Result\nOuvrir,Vu\n"], "tests.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Choose a CSV file"), { target: { files: [csv] } });
    fireEvent.click(await screen.findByRole("radio", { name: /Import directly into Xray/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Plan the import of 1 test" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import into Xray" }));
    expect(await screen.findByText("Xray is still importing")).toBeInTheDocument();
    expect(screen.getByText(note)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(checks).toBe(1));
    expect(named("xray.importCsv").at(-1)?.input).toEqual({ mode: "direct", jobId: "X-9" });
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("tests", "LFRPS12-2001"));
    expect(screen.queryByText("Xray is still importing")).not.toBeInTheDocument();
  });
});
