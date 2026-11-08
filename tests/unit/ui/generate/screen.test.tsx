// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef, Job, LocalTestRef } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { GenerateScreen } from "../../../../src/ui/screens/generate/GenerateScreen.tsx";
import { checkedRun, pickRun, runChoice } from "../../helpers/run-choice.ts";
import { api, FakeEventSource, named, xray } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { at, job, output, ref, test } from "./fixtures.ts";
import { emit, freshPage, mountData } from "./harness.tsx";

beforeEach(freshPage);

afterEach(() => {
  cleanup();
  clearToasts();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const project = (
  claude: Record<string, unknown> | null = { model: "sonnet", effort: "medium" },
  folders: string[] = [],
) => ({
  dir: "C:\\p",
  project: {
    name: "RATP Sosie",
    jiraProject: "LFRPS12",
    language: "fr",
    labelPrefix: "testimus-",
    folders,
    rag: {},
    claude: claude ? { presets: [], contexts: [], ...claude } : undefined,
  },
  xray,
  columns: [],
});

const docOf = (id: string, title: string, indexed = "fresh"): DocRef =>
  ({
    id,
    code: id,
    title,
    status: "validated",
    converted: { with: "", at, warnings: [] },
    indexed,
  }) as unknown as DocRef;

// ponytail: the fake gen.preview applies the core's rule to the fake documents: the scope, or every converted one
const preview =
  (docs: () => DocRef[], replaces: () => string[] = () => []) =>
  (i: Record<string, unknown>) => {
    const scope = new Set([
      ...((i.docs as string[]) ?? []),
      ...((i.sections as string[]) ?? []).map((s) => s.split("#")[0]),
    ]);
    const searched = docs().filter((d) => d.converted?.at && (!scope.size || scope.has(d.id)));
    return {
      replaces: replaces(),
      searched: searched.map((d) => d.id),
      unindexed: searched.filter((d) => d.indexed === "missing").map((d) => d.id),
      stale: searched.filter((d) => d.indexed === "stale").map((d) => d.id),
    };
  };

const base = (info: ReturnType<typeof project> | null = project()) => {
  const docs = [
    {
      id: "D1",
      code: "C1",
      title: "Traction",
      status: "validated",
      converted: { with: "", at, warnings: [] },
      indexed: "fresh",
    } as unknown as DocRef,
  ];
  api.routes["project.info"] = () => info;
  api.routes["claude.status"] = () => ({ installed: true, signedIn: true });
  api.routes["jobs.list"] = () => [];
  api.routes["contexts.list"] = () => [];
  api.routes["docs.list"] = () => docs;
  api.routes["docs.show"] = () => ({ toc: [{ anchor: "§1", title: "Intro", level: 1 }] });
  api.routes["gen.preview"] = preview(() => docs);
};

const go = (name: RegExp | string = /^Generate/) => screen.getByRole("button", { name });

describe("Generate screen", () => {
  it("opens on the last generation, already done, with its log", async () => {
    base(project({ model: "claude-x", effort: "medium" }));
    api.routes["jobs.list"] = () => [{ id: "other", kind: "rag-index" }, job({ id: "g0", status: "done" })];
    api.routes["jobs.show"] = () => ({
      job: job({
        id: "g0",
        status: "done",
        endedAt: at,
        result: output({ tests: ["local-aaaaaaaa"], diagnosis: { kind: "k", title: "t", detail: "It hit the limit" } }),
      }),
      events: [{ jobId: "g0", at, type: "progress", message: "Writing local-aaaaaaaa" }],
    });
    api.routes["tests.list"] = () => [ref("local-aaaaaaaa")];
    api.routes["tests.show"] = () => ({ test: test("Premier") });
    const { app: a } = mountData(<GenerateScreen />);
    expect(await screen.findByRole("region", { name: /^Premier/ })).toBeInTheDocument();
    expect(screen.getByText("It hit the limit")).toBeInTheDocument();
    expect(runChoice()).toHaveAccessibleName("Claude-x · medium");
    expect(checkedRun("Model")).toBe("Project default · Claude-x");
    expect(checkedRun("Effort")).toBe("Project default · medium");
    expect(go(/^Generate again/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("region", { name: /^Premier/ })).getByRole("button", { name: "Review" }));
    expect(a.navigate).toHaveBeenCalledWith("review", "local-aaaaaaaa");
    fireEvent.click(screen.getByRole("button", { name: /Review these tests/ }));
    expect(a.navigate).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "What Claude did" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "What Claude did" }));
    expect(screen.getByRole("region", { name: "What Claude did" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show raw output (1 event)" }));
    expect(screen.getByRole("log", { name: "Raw output" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide raw output (1 event)" }));
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("shows a failed run with its error and nothing written", async () => {
    base(project(null));
    api.routes["jobs.list"] = () => null;
    mountData(<GenerateScreen />);
    expect(await screen.findByText("Tests appear here as Claude writes them")).toBeInTheDocument();
    await waitFor(() => expect(runChoice()).toHaveAccessibleName("Opus · high"));
    expect(checkedRun("Model")).toBe("Project default · Opus");
    cleanup();
    api.routes["jobs.list"] = () => [job({ id: "g1", status: "failed" })];
    api.routes["jobs.show"] = () => ({ job: job({ id: "g1", status: "failed", error: "Claude crashed" }), events: [] });
    mountData(<GenerateScreen />);
    expect(await screen.findByText("Claude crashed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "What Claude did" }));
    expect(screen.getByRole("button", { name: "Show raw output (0 events)" })).toBeInTheDocument();
    cleanup();
    api.routes["jobs.list"] = () => [job({ id: "g2", status: "done" })];
    api.routes["jobs.show"] = () => ({ job: job({ id: "g2", status: "done", endedAt: at }), events: [] });
    mountData(<GenerateScreen />);
    expect(await screen.findByText("0 tests written")).toBeInTheDocument();
  });

  it("« Run again » after a failed run runs that job again (jobs.rerun) and follows it; the form stays", async () => {
    base();
    const failed = job({
      id: "g1",
      status: "failed",
      endedAt: at,
      error: "Claude crashed",
      rerun: { name: "gen.tests", input: { request: "old" } },
    } as Partial<Job>);
    api.routes["jobs.list"] = () => [failed];
    api.routes["jobs.show"] = (i) =>
      i.id === "g1" ? { job: failed, events: [] } : { job: job({ id: "g9" }), events: [] };
    api.routes["jobs.rerun"] = () => ({ jobId: "g9" });
    const { app: a } = mountData(<GenerateScreen />);
    fireEvent.change(await screen.findByLabelText("What should be tested?"), { target: { value: "new words" } });
    fireEvent.click(await screen.findByRole("button", { name: "Run again" }));
    await waitFor(() => expect(named("jobs.rerun").map((c) => c.input)).toEqual([{ id: "g1" }]));
    expect(named("gen.tests")).toHaveLength(0);
    expect(await screen.findByRole("heading", { name: "Getting ready" })).toBeInTheDocument();
    expect(screen.getByLabelText("What should be tested?")).toHaveValue("new words");
    expect(screen.queryByText("g9")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open the job" }));
    expect(a.navigate).toHaveBeenCalledWith("jobs", "g9");
  });

  it("documents not converted yet are not in scope: Generate says to convert one first", async () => {
    base();
    api.routes["docs.list"] = () => [{ id: "D1", code: "C1", title: "Brut", status: "draft" } as unknown as DocRef];
    const { app: a } = mountData(<GenerateScreen />);
    expect(await screen.findByText("No document is converted yet")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Brut/ })).toBeDisabled();
    expect(screen.getByText("Not converted")).toBeInTheDocument();
    expect(screen.getByText("0 documents in scope")).toBeInTheDocument();
    await waitFor(() => expect(go()).toHaveAccessibleDescription("Convert a document first"));
    fireEvent.click(screen.getByRole("button", { name: "Go to Documents" }));
    expect(a.navigate).toHaveBeenCalledWith("documents");
  });

  it("with no document, says Generate needs one and leads to Documents", async () => {
    base();
    api.routes["docs.list"] = () => [];
    const { app: a } = mountData(<GenerateScreen />);
    expect(await screen.findByText("Generate needs a document")).toBeInTheDocument();
    expect(go()).toBeDisabled();
    expect(go()).toHaveAccessibleDescription("Add a document first");
    for (const to of screen.getAllByRole("button", { name: "Go to Documents" })) {
      expect(to.querySelector("[data-icon]")).toHaveAttribute("data-icon", "documents");
      fireEvent.click(to);
    }
    expect(a.navigate).toHaveBeenCalledWith("documents");
    expect(screen.queryByRole("region", { name: "Smart columns" })).toBeNull();
  });

  it("says Xray folder for a project on Jira, Folder for one without", async () => {
    base();
    api.routes["docs.list"] = () => [];
    mountData(<GenerateScreen />);
    expect(await screen.findByLabelText("Xray folder")).toBeInTheDocument();
    cleanup();
    const local = project();
    mountData(<GenerateScreen />, { info: { ...local, project: { ...local.project, jiraProject: "" } } as never });
    expect(await screen.findByLabelText("Folder")).toBeInTheDocument();
    expect(screen.getByText("You can change it in each test.")).toBeInTheDocument();
  });

  it("asks to connect Claude when it is missing, and checks again", async () => {
    base();
    api.routes["claude.status"] = (i) =>
      i.refresh ? { installed: true, signedIn: false } : { installed: false, signedIn: null };
    const { app: a } = mountData(<GenerateScreen />);
    expect(await screen.findByText("Claude isn't installed on this PC yet")).toBeInTheDocument();
    expect(go()).toBeDisabled();
    expect(screen.getAllByText("Claude is not connected").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Claude is installed but not signed in")).toBeInTheDocument();
    expect(named("claude.status").at(-1)?.input).toEqual({ refresh: true, signIn: true });
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(named("claude.status").filter((c) => c.input.refresh)).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Open the system check" }));
    expect(a.navigate).toHaveBeenCalledWith("doctor");
  });

  it("leaves a document not indexed out of the scope, warns when one is out of date, and reindexes from here", async () => {
    base();
    let built = false;
    const docs = () => [
      docOf("D1", "Traction", built ? "fresh" : "missing"),
      docOf("D2", "Signaux", "stale"),
      { id: "D3", code: "D3", title: "Brouillon", indexed: "missing" } as unknown as DocRef,
    ];
    api.routes["docs.list"] = docs;
    api.routes["gen.preview"] = preview(docs);
    api.routes["rag.index"] = () => {
      built = true;
      return { jobId: "ix" };
    };
    mountData(<GenerateScreen />);
    expect(await screen.findByText("Not indexed", { selector: "*:not(li *)" })).toBeInTheDocument();
    expect(
      screen.getByText(/D1 is not indexed: search cannot find it, so it stays out of the scope/),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Traction/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Traction/ })).not.toBeChecked();
    await waitFor(() => expect(named("gen.preview").at(-1)?.input).toEqual({ docs: ["D2"], sections: [] }));
    expect(go()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Reindex" }));
    await waitFor(() => expect(named("rag.index")).toHaveLength(1));
    emit({ jobId: "ix", at, type: "status", job: job({ id: "ix", kind: "rag-index", status: "done", endedAt: at }) });
    expect(await screen.findByText("Index not up to date")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Traction/ })).toBeChecked());
    expect(screen.getByText(/D2 changed since the last index/)).toBeInTheDocument();
    expect(go()).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Signaux/ }));
    await waitFor(() => expect(screen.queryByText("Index not up to date")).toBeNull());
  });

  it("a reindex that cannot start says so", async () => {
    base();
    const docs = () => [docOf("D1", "Traction", "stale")];
    api.routes["docs.list"] = docs;
    api.routes["gen.preview"] = preview(docs);
    mountData(<GenerateScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Reindex" }));
    expect(await screen.findByText("Indexing failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss the indexing failure of All documents" })).toBeInTheDocument();
  });

  it("an unreadable Claude status does not block generating", async () => {
    base();
    delete api.routes["claude.status"];
    mountData(<GenerateScreen />);
    await waitFor(() => expect(named("claude.status")).toHaveLength(1));
    fireEvent.change(await screen.findByLabelText("What should be tested?"), { target: { value: "x" } });
    await waitFor(() => expect(go()).toBeEnabled());
  });

  it("sends the scope, the contexts, the folder, the model; reports a refused start and ignores an answer without a job", async () => {
    base(project({ model: "sonnet", effort: "medium", contexts: ["g"] }, ["/Traction/Sectionneurs", "/Signalisation"]));
    api.routes["contexts.list"] = () => [
      { id: "g", name: "Glossaire", paths: [], files: [], hasNotes: true },
      { id: "h", name: "Habilitations", paths: [], files: [], hasNotes: true },
    ];
    mountData(<GenerateScreen />);
    await screen.findByText("Traction");
    await waitFor(() => expect(go()).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Select none" }));
    expect(go()).toBeDisabled();
    expect(go()).toHaveAccessibleDescription("Say what to test, or pick a document");
    expect(go()).not.toHaveTextContent("Ctrl+Enter");
    fireEvent.click(screen.getByRole("button", { name: "Only some sections…" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Intro/ }));
    expect(go()).toBeEnabled();
    expect(go()).toHaveTextContent("Ctrl+Enter");
    fireEvent.change(screen.getByLabelText("What should be tested?"), { target: { value: " PCC " } });
    expect(await screen.findByRole("button", { name: "Glossaire", pressed: true })).toBeInTheDocument();
    expect(screen.getByText(/1 saved context/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add context" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Habilitations/ }));
    expect(await screen.findByText(/2 saved contexts/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Habilitations", pressed: true }));
    expect(screen.getByRole("button", { name: "Habilitations", pressed: false })).toBeInTheDocument();
    pickRun("Opus");
    pickRun("Max");
    fireEvent.click(screen.getByRole("button", { name: "Choose…" }));
    fireEvent.click(
      await screen
        .findByRole("menuitemcheckbox", { name: /\/Signalisation/ })
        .catch(() => screen.findByRole("menuitem", { name: /\/Signalisation/ })),
    );
    expect(screen.getByLabelText("Xray folder")).toHaveValue("/Signalisation");
    expect(screen.getByText("Tests land on this PC as drafts in /Signalisation.")).toBeInTheDocument();
    fireEvent.click(go());
    expect(await screen.findByText("Could not start the generation")).toBeInTheDocument();
    expect(named("gen.tests")[0].input).toEqual({
      request: "PCC",
      sections: ["D1#§1"],
      contexts: ["g"],
      folder: "/Signalisation",
      model: "opus",
      effort: "max",
    });
    api.routes["gen.tests"] = () => ({});
    fireEvent.click(go());
    await waitFor(() => expect(named("gen.tests")).toHaveLength(2));
    expect(screen.getByText("Tests appear here as Claude writes them")).toBeInTheDocument();
    cleanup();
    mountData(<GenerateScreen />);
    expect(await screen.findByText("Traction")).toBeInTheDocument();
    expect(runChoice()).toHaveAccessibleName("Opus · max");
    expect(checkedRun("Model")).toBe("Opus");
    expect(screen.getByLabelText("What should be tested?")).toHaveValue(" PCC ");
    pickRun("Project default · Sonnet");
    pickRun("Project default · medium");
    expect(runChoice()).toHaveAccessibleName("Sonnet · medium");
    expect(checkedRun("Effort")).toBe("Project default · medium");
  });

  it("takes a model the list does not know, typed in, once it is valid", async () => {
    base();
    api.routes["gen.tests"] = () => ({});
    mountData(<GenerateScreen />);
    await screen.findByText("Traction");
    pickRun("Custom…");
    const typed = screen.getByLabelText("Custom model");
    fireEvent.change(typed, { target: { value: "bad model" } });
    fireEvent.blur(typed);
    expect(screen.getByLabelText("Custom model")).toBeInTheDocument();
    fireEvent.change(typed, { target: { value: "claude-opus-4-1" } });
    fireEvent.keyDown(typed, { key: "Enter" });
    expect(screen.queryByLabelText("Custom model")).toBeNull();
    expect(runChoice()).toHaveAccessibleName(/^Claude-opus-4-1 · /);
    fireEvent.click(go());
    await waitFor(() => expect(named("gen.tests")).toHaveLength(1));
    expect(named("gen.tests")[0].input.model).toBe("claude-opus-4-1");
  });

  it("Ctrl+Enter in the request generates", async () => {
    base();
    api.routes["gen.tests"] = () => ({});
    mountData(<GenerateScreen />);
    await screen.findByText("Traction");
    const box = screen.getByLabelText("What should be tested?");
    fireEvent.change(box, { target: { value: "Le sectionneur" } });
    await waitFor(() => expect(go()).toBeEnabled());
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(named("gen.tests")).toHaveLength(1));
    expect(named("gen.tests")[0].input.request).toBe("Le sectionneur");
  });

  it("asks before replacing Claude's tests not validated yet: cancel, review, or delete and generate", async () => {
    base();
    api.routes["gen.tests"] = () => ({ jobId: "j2" });
    api.routes["jobs.show"] = () => ({
      job: job({ id: "j2", status: "done", endedAt: at, result: output({ discarded: ["local-aaaaaaaa"] }) }),
      events: [],
    });
    api.routes["gen.preview"] = () => ({
      replaces: ["local-aaaaaaaa", "local-bbbbbbbb"],
      searched: ["D1"],
      unindexed: [],
      stale: [],
    });
    api.routes["tests.list"] = () => [
      ref("local-aaaaaaaa", { summary: "Ouverture du sectionneur", stepCount: 4, edited: true }),
      ref("local-bbbbbbbb", { summary: "Fermeture du sectionneur", review: "to-fix" }),
      ref("LFRPS12-1", { summary: "Kept, in Jira", key: "LFRPS12-1" }),
    ];
    const { app: a } = mountData(<GenerateScreen />);
    await screen.findByText("Traction");
    await waitFor(() => expect(go()).toBeEnabled());
    fireEvent.click(go());
    const dialog = await screen.findByRole("alertdialog", { name: "Delete 2 tests before generating?" });
    const rows = within(dialog).getByRole("listbox", { name: "Tests to delete" });
    await waitFor(() => expect(within(rows).getAllByRole("option")).toHaveLength(2));
    const [first, second] = within(rows).getAllByRole("option");
    expect(first).toHaveTextContent("Ouverture du sectionneur");
    expect(first).toHaveTextContent("local-aaaaaaaa · 4 steps");
    expect(first).toHaveTextContent("Edited by you");
    expect(first).toHaveTextContent("Draft");
    expect(second).toHaveTextContent("Fermeture du sectionneur");
    expect(second).toHaveTextContent("To fix");
    expect(second).not.toHaveTextContent("Edited by you");
    expect(dialog).not.toHaveTextContent("Kept, in Jira");
    expect(dialog).toHaveTextContent("You edited 1 of them since Claude wrote them: those changes are lost too.");
    expect(dialog).toHaveTextContent("Kept: validated tests and every test already in Jira.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(named("gen.tests")).toHaveLength(0);
    expect(named("gen.preview")[0].input).toEqual({ docs: ["D1"], sections: [] });
    fireEvent.click(go());
    fireEvent.click(await screen.findByRole("option", { name: /Fermeture du sectionneur/ }));
    expect(a.navigate).toHaveBeenCalledWith("review", "local-bbbbbbbb");
    fireEvent.click(go());
    fireEvent.click(await screen.findByRole("button", { name: "Delete and generate" }));
    await waitFor(() => expect(named("gen.tests")).toHaveLength(1));
    expect(named("gen.tests")[0].input).toMatchObject({ docs: ["D1"], discard: true });
    expect(await screen.findByText("1 test not validated yet was deleted before this run.")).toBeInTheDocument();
  });

  it("a generation that fails on Claude's sign-in ends red and shows how to sign in, until a check finds it signed in", async () => {
    base();
    api.routes["claude.status"] = (i) =>
      i.signIn
        ? { installed: true, signedIn: true }
        : { installed: true, signedIn: null, detail: "2.1.0 (Claude Code)" };
    api.routes["gen.tests"] = () => ({ jobId: "j1" });
    const said = "Invalid API key · Please run /login";
    const diagnosis = {
      kind: "login",
      title: "Claude Code is not signed in.",
      detail: "Run `claude` once in a terminal and sign in with your Claude account, then retry.",
    };
    const ended = job({ status: "done", endedAt: at, result: output({ ok: false, diagnosis }) });
    const events = [
      { jobId: "j1", at, type: "progress" as const, message: "Deleted 1 test(s) not validated yet" },
      {
        jobId: "j1",
        at,
        type: "claude" as const,
        event: { type: "result" as const, ok: false, text: said, durationMs: 10 },
      },
      { jobId: "j1", at, type: "status" as const, job: ended },
    ];
    api.routes["jobs.show"] = () => ({ job: ended, events });
    mountData(<GenerateScreen />);
    fireEvent.change(await screen.findByLabelText("What should be tested?"), { target: { value: "Les sectionneurs" } });
    await waitFor(() => expect(go()).toBeEnabled());
    fireEvent.click(go());
    expect(await screen.findByText("Claude is installed but not signed in")).toBeInTheDocument();
    expect(screen.getByText(`claude -p: ${said}`)).toBeInTheDocument();
    expect(go(/^Generate/)).toBeDisabled();
    expect(screen.getAllByText("Claude is not connected").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.queryByText("Claude is installed but not signed in")).toBeNull());
    expect(named("claude.status").at(-1)?.input).toEqual({ refresh: true, signIn: true });
    fireEvent.click(screen.getByRole("button", { name: "What Claude did before it stopped" }));
    const end = await screen.findByRole("heading", { name: "Stopped · 0 tests written" });
    expect(within(end.closest("li") as HTMLElement).getByRole("img", { name: "Failed" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Done/ })).toBeNull();
    const code = screen.getByText("claude", { selector: "code" });
    expect(code.parentElement).toHaveTextContent(
      "Run claude once in a terminal and sign in with your Claude account, then retry.",
    );
    expect(screen.getByRole("button", { name: /What Claude did/ }).parentElement).toHaveTextContent(
      "What Claude did before it stoppedsonnet · medium",
    );
  });

  it("follows a run: ticks the clock, opens what landed, cancels, then ends", async () => {
    base();
    api.routes["gen.tests"] = () => ({ jobId: "j1" });
    api.routes["jobs.show"] = () => ({ job: job(), events: [] });
    let refs: LocalTestRef[] = [];
    api.routes["tests.list"] = () => refs;
    api.routes["tests.show"] = (i) => {
      if (i.id === "local-bbbbbbbb") throw new Error("gone");
      return { test: test("First") };
    };
    mountData(<GenerateScreen />);
    fireEvent.change(await screen.findByLabelText("What should be tested?"), {
      target: { value: " Les sectionneurs " },
    });
    await waitFor(() => expect(go()).toBeEnabled());
    fireEvent.click(go());
    expect(await screen.findByRole("heading", { name: "Getting ready" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "What Claude is doing" }));
    expect(screen.getByText("Claude is starting.")).toBeInTheDocument();
    expect(screen.getByLabelText("What should be tested?")).toHaveAttribute("readonly");
    const landing = screen.getByRole("region", { name: "Tests written" });
    expect(landing).toHaveTextContent("Read only while Claude writes");
    expect(within(landing).getByText("No test written yet")).toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "Time since it started" })).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    await new Promise((r) => setTimeout(r, 1100));
    refs = [ref("local-aaaaaaaa"), ref("local-bbbbbbbb")];
    emit({ jobId: "j1", at, type: "progress", message: "Writing local-aaaaaaaa" });
    emit({ jobId: "j1", at, type: "progress", message: "Writing local-bbbbbbbb" });
    emit({ jobId: "j1", at, type: "progress", message: "Writing local-cccccccc" });
    emit({ jobId: "j1", at, type: "changed", paths: ["tests/local-aaaaaaaa/test.md", "tests/local-bbbbbbbb/test.md"] });
    expect((await screen.findAllByRole("region", { name: /^First/ })).length).toBeGreaterThan(0);
    expect(within(landing).getAllByText("Written")).toHaveLength(2);
    expect(within(landing).getAllByText("Writing")).toHaveLength(1);
    expect(go(/^Claude is writing/)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Could not cancel the job")).toBeInTheDocument();
    api.routes["jobs.cancel"] = () => ({});
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(named("jobs.cancel")).toHaveLength(2));
    expect(named("jobs.cancel")[1].input).toEqual({ id: "j1" });
    delete api.routes["tests.list"];
    const done = job({
      status: "done",
      endedAt: at,
      result: output({ tests: ["local-aaaaaaaa", "local-bbbbbbbb", "local-cccccccc"] }),
    });
    api.routes["jobs.show"] = () => ({ job: done, events: [] });
    emit({ jobId: "j1", at, type: "status", job: done });
    expect(await screen.findByText("3 tests written")).toBeInTheDocument();
    expect(screen.getAllByRole("status", { name: "Loading a test" }).length).toBeGreaterThan(0);
    expect(go(/^Generate again/)).toBeEnabled();
  });

  it("resumes a stopped plan with the model and effort of this run", async () => {
    base();
    api.routes["jobs.list"] = () => [job({ id: "g3", status: "cancelled" })];
    api.routes["jobs.show"] = () => ({
      job: job({
        id: "g3",
        status: "cancelled",
        endedAt: at,
        result: output({ generation: "gen-1", remaining: 2 }),
      }),
      events: [],
    });
    mountData(<GenerateScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume · 2 tests left" }));
    expect(await screen.findByText("Could not resume the generation")).toBeInTheDocument();
    expect(named("gen.tests")[0].input).toEqual({ resume: "gen-1", model: "sonnet", effort: "medium" });
    api.routes["gen.tests"] = () => ({ jobId: "g4" });
    api.routes["jobs.show"] = (i) => ({ job: job({ id: String(i.id) }), events: [] });
    fireEvent.click(screen.getByRole("button", { name: "Resume · 2 tests left" }));
    expect(await screen.findByRole("heading", { name: "Getting ready" })).toBeInTheDocument();
  });

  it("starts with everything folded — the tests, what Claude did, what was not covered — and folds it all again", async () => {
    base();
    api.routes["jobs.list"] = () => [job({ id: "g0", status: "done" })];
    api.routes["jobs.show"] = () => ({
      job: job({
        id: "g0",
        status: "done",
        endedAt: at,
        result: output({
          tests: ["local-aaaaaaaa", "local-bbbbbbbb"],
          skipped: [{ item: "Alarme", why: "no passage" }],
        }),
      }),
      events: [],
    });
    api.routes["tests.list"] = () => [ref("local-aaaaaaaa"), ref("local-bbbbbbbb")];
    api.routes["tests.show"] = (i) => ({
      test: test(i.id === "local-aaaaaaaa" ? "Un" : "Deux", [{ Action: `do ${i.id}` }]),
    });
    mountData(<GenerateScreen />);
    expect(await screen.findByRole("region", { name: /^Deux/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deux" })).toBeNull();
    const folds = [
      ["What Claude did", "What Claude did"],
      ["Not written · 1", "Not written"],
    ];
    const shut = () => {
      for (const [b] of folds)
        expect(screen.getByRole("button", { name: b })).toHaveAttribute("aria-expanded", "false");
    };
    shut();
    fireEvent.click(screen.getByRole("button", { name: "Unfold all" }));
    for (const [, r] of folds) expect(screen.getByRole("region", { name: r })).toBeInTheDocument();
    expect(screen.queryByText("do local-aaaaaaaa")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fold all" }));
    shut();
    fireEvent.click(screen.getByRole("button", { name: "Not written · 1" }));
    expect(screen.getByRole("region", { name: "Not written" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fold all" }));
    shut();
  });
});

describe("Generate while an index runs (audit M-G1)", () => {
  const indexJob = (status: Job["status"]) =>
    job({ id: "ix", kind: "rag-index", status, endedAt: status === "running" ? undefined : at });

  it("is disabled while the index it started runs, says Indexing · N %, and comes back with the documents read again", async () => {
    base();
    let built = false;
    let running = false;
    const reading = { state: "running", percent: 0, done: 0, total: 3 } as const;
    const docs = () => [
      { ...docOf("D1", "Traction", built ? "fresh" : "stale"), ...(running && !built ? { indexing: reading } : {}) },
    ];
    api.routes["docs.list"] = docs;
    api.routes["gen.preview"] = preview(docs);
    api.routes["jobs.list"] = () => (running ? [indexJob("running")] : []);
    api.routes["rag.index"] = () => {
      running = true;
      return { jobId: "ix" };
    };
    mountData(<GenerateScreen />);
    expect(await screen.findByText("Index not up to date")).toBeInTheDocument();
    await waitFor(() => expect(go()).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Reindex" }));
    await waitFor(() => expect(go()).toBeDisabled());
    expect(go()).toHaveAccessibleDescription("Wait for the index to finish");
    expect(await screen.findByText("Indexing · 0 %")).toBeInTheDocument();
    expect(screen.queryByText("Index not up to date")).toBeNull();
    expect(named("rag.index")).toHaveLength(1);
    const listed = named("docs.list").length;
    built = true;
    running = false;
    emit({ jobId: "ix", at, type: "status", job: indexJob("done") });
    await waitFor(() => expect(go()).toBeEnabled());
    await waitFor(() => expect(named("docs.list").length).toBeGreaterThan(listed));
    await waitFor(() => expect(screen.queryByText("Index not up to date")).toBeNull());
  });

  it("is disabled too while an index started from another screen runs", async () => {
    base();
    let running = true;
    api.routes["docs.list"] = () => [docOf("D1", "Traction")];
    api.routes["jobs.list"] = () => (running ? [{ ...indexJob("running"), progress: { done: 40, total: 97 } }] : []);
    const { app: a } = mountData(<GenerateScreen />);
    await screen.findByText("Traction");
    fireEvent.change(screen.getByLabelText("What should be tested?"), { target: { value: "x" } });
    await waitFor(() => expect(go()).toBeDisabled());
    const bar = screen.getByRole("progressbar", { name: "Index" });
    expect(bar).toHaveAttribute("aria-valuenow", "41");
    expect(bar).toHaveAttribute("aria-valuetext", "40 of 97 · Generate waits for it to finish.");
    fireEvent.click(screen.getByRole("button", { name: "Open in Jobs" }));
    expect(a.navigate).toHaveBeenCalledWith("jobs", "ix");
    running = false;
    emit({ jobId: "ix", at, type: "status", job: indexJob("done") });
    await waitFor(() => expect(go()).toBeEnabled());
  });
});

describe("Generate › the tests land from the job events (was ui-screens)", () => {
  it("shows the tests as they land from the job events", async () => {
    setProject("/landing");
    base();
    const written: string[] = [];
    api.routes["docs.list"] = () => [];
    api.routes["gen.tests"] = () => ({ jobId: "job-gen" });
    api.routes["jobs.show"] = () => ({
      job: { id: "job-gen", kind: "generate", subject: "x", status: "running", startedAt: new Date().toISOString() },
      events: [],
    });
    api.routes["tests.list"] = () => written.map((id) => ref(id, { stepCount: 2 }));
    api.routes["tests.show"] = (i) => ({
      id: i.id,
      test: test(i.id === "local-aaaaaaaa" ? "Premier test" : "Second test"),
    });
    mountData(<GenerateScreen />);
    fireEvent.change(await screen.findByLabelText("What should be tested?"), { target: { value: "Les sectionneurs" } });
    await waitFor(() => expect(go()).toBeEnabled());
    fireEvent.click(go());
    await waitFor(() => expect(named("gen.tests")).toHaveLength(1));
    expect(named("gen.tests")[0].input).toMatchObject({
      request: "Les sectionneurs",
      model: "sonnet",
      effort: "medium",
    });
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    await screen.findByRole("heading", { name: "Getting ready" });

    const now = new Date().toISOString();
    const A = "local-aaaaaaaa";
    const B = "local-bbbbbbbb";
    const head = (name: RegExp) => screen.getByRole("button", { name });
    emit({
      jobId: "job-gen",
      at: now,
      type: "progress",
      message: `Writing ${A} (1)`,
      gen: [
        { id: A, state: "writing" },
        { summary: "Le test prévu", state: "waiting" },
      ],
    });
    written.push(A);
    await waitFor(() => expect(head(/^Premier test/)).toHaveAttribute("aria-expanded", "true"));
    const premier = screen.getByRole("region", { name: /^Premier test/ });
    expect(within(premier).getByText("Writing")).toBeInTheDocument();
    expect(within(premier).getByText("Step 1")).toBeInTheDocument();
    const fields = within(premier).getAllByRole("textbox");
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) expect(f).toHaveAttribute("readonly");
    expect(head(/^Le test prévu/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("region", { name: /^Le test prévu/ })).toHaveTextContent("Waiting");

    emit({
      jobId: "job-gen",
      at: now,
      type: "progress",
      message: `Writing ${B} (2)`,
      gen: [
        { id: A, state: "written" },
        { id: B, summary: "Le test prévu", state: "writing" },
      ],
    });
    await waitFor(() => expect(head(/^Premier test/)).toHaveAttribute("aria-expanded", "false"));
    await waitFor(() => expect(head(/^Second test/)).toHaveAttribute("aria-expanded", "true"));
    expect(named("tests.show").map((c) => c.input.id)).toContain(B);
    fireEvent.click(head(/^Premier test/));
    emit({ jobId: "job-gen", at: now, type: "changed", paths: [`tests/${B}/test.md`] });
    expect(head(/^Premier test/)).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Fold all" }));
    expect(head(/^Premier test/)).toHaveAttribute("aria-expanded", "false");
    expect(head(/^Second test/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Fold all" })).toBeNull();

    written.push("local-bbbbbbbb");
    emit({ jobId: "job-gen", at: now, type: "changed", paths: ["tests/local-bbbbbbbb/test.md"] });
    const done = {
      id: "job-gen",
      kind: "generate",
      subject: "x",
      status: "done",
      startedAt: now,
      endedAt: now,
      result: {
        runId: "r1",
        ok: true,
        summary: "",
        tests: ["local-aaaaaaaa", "local-bbbbbbbb"],
        checks: [
          { id: "local-aaaaaaaa", ok: true, review: "draft", errors: 0, warnings: 0 },
          { id: "local-bbbbbbbb", ok: false, review: "draft", errors: 2, warnings: 1 },
        ],
        changed: [],
        skipped: [{ item: "Alarme de sectionneur", why: "no passage describes the alarm" }],
        reportFound: true,
        durationMs: 1000,
      },
    } as Job;
    api.routes["jobs.show"] = () => ({ job: done, events: [] });
    emit({ jobId: "job-gen", at: now, type: "status", job: done });
    expect(await screen.findByRole("region", { name: /^Second test/ })).toBeInTheDocument();
    expect(screen.getByText("2 tests written")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not written · 1" }));
    expect(screen.getByText(/no passage describes the alarm/)).toBeInTheDocument();
    expect(screen.getByText(/All 2 tests went through the check: 1 has findings/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /^Second test/ })).getByText("2 errors")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: /^Premier test/ })).getAllByText("No findings").length,
    ).toBeGreaterThan(0);
    expect(named("check.run")).toHaveLength(0);
  });
});
