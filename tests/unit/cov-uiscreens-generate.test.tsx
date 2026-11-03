// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckFile, DocRef, Job, JobEvent, LocalTestRef, Test } from "../../src/core/types.ts";
import { type DocScope, flip, ownText, parents, scopeOf, tick } from "../../src/ui/lib/scope.ts";
import { ColumnsView } from "../../src/ui/screens/generate/ColumnsView.tsx";
import { DocScopePicker } from "../../src/ui/screens/generate/DocScopePicker.tsx";
import { GenerateScreen } from "../../src/ui/screens/generate/GenerateScreen.tsx";
import {
  checkLine,
  GenCard,
  type GenOutput,
  GenSummary,
  landedIds,
  passagesRead,
  RunHead,
} from "../../src/ui/screens/generate/GenResult.tsx";
import { clearToasts, mount } from "./cov-uiscreens-helpers.tsx";
import { api, app, FakeEventSource, fakeFetch, named, xray } from "./ui-desktop-helpers.tsx";

beforeEach(() => {
  fakeFetch();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  clearToasts();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const at = "2026-11-02T10:00:00.000Z";

const test = (summary: string, fields: Record<string, string>[] = [{ Action: "a" }]): Test =>
  ({
    summary,
    folder: "/",
    labels: [],
    description: "",
    covers: [],
    preconditions: [],
    review: "draft",
    steps: fields.map((f) => ({ fields: f, sources: [], images: [] })),
    extra: {},
  }) as unknown as Test;

const output = (over: Partial<GenOutput> = {}): GenOutput => ({
  runId: "r",
  ok: true,
  summary: "",
  tests: [],
  changed: [],
  skipped: [],
  reportFound: true,
  durationMs: 1,
  ...over,
});

const job = (over: Partial<Job> = {}): Job => ({
  id: "j1",
  kind: "generate",
  subject: "x",
  status: "running",
  startedAt: at,
  ...over,
});

const ref = (id: string, over: Partial<LocalTestRef> = {}): LocalTestRef => ({
  id,
  summary: id,
  folder: "/",
  review: "draft",
  generated: false,
  edited: false,
  sync: "local",
  dirty: false,
  synced: false,
  mtime: 1,
  stepCount: 1,
  ...over,
});

const emit = (e: JobEvent) => act(() => FakeEventSource.last?.emit(e));

describe("Generate › result helpers", () => {
  it("landedIds, passagesRead and checkLine read the events and the result", () => {
    const events: JobEvent[] = [
      { jobId: "j", at, type: "progress", message: "Writing LOCAL-AAAAAAAA" },
      { jobId: "j", at, type: "progress", message: "Writing local-aaaaaaaa again" },
      { jobId: "j", at, type: "progress", message: "Reading passages (12)" },
      { jobId: "j", at, type: "progress", message: "Reading passages (3)" },
      { jobId: "j", at, type: "log", level: "info", message: "Writing local-bbbbbbbb" },
    ];
    expect(landedIds(events, output({ tests: ["local-aaaaaaaa", "local-cccccccc"] }))).toEqual([
      "local-aaaaaaaa",
      "local-cccccccc",
    ]);
    expect(landedIds(events)).toEqual(["local-aaaaaaaa"]);
    expect(passagesRead(events)).toBe(12);
    expect(checkLine(["a"], undefined)).toBe("");
    expect(checkLine(["a"], [{ id: "a", ok: false, review: "draft", errors: 0, warnings: 2 }])).toBe(
      "All 1 test went through the check: 1 has findings.",
    );
    expect(checkLine(["a", "b"], [{ id: "a", ok: true, review: "draft", errors: 0, warnings: 0 }])).toBe(
      "All 2 tests went through the check: 0 have findings.",
    );
  });

  it("GenCard: placeholders while writing or loading", () => {
    const cb = { open: true, onToggle: vi.fn(), onOpen: vi.fn(), onSource: vi.fn() };
    render(<GenCard item={{ id: "x" }} writing checking={false} xray={xray} {...cb} />);
    expect(screen.getByRole("status", { name: "Claude is writing a test" })).toHaveTextContent("Writing…");
    cleanup();
    render(<GenCard item={{ id: "x" }} writing={false} checking={false} xray={xray} {...cb} />);
    expect(screen.getByRole("status", { name: "Loading a test" })).toHaveTextContent("Loading…");
  });

  it("GenCard: the steps are shown open, fold, and open in Review", () => {
    const onOpen = vi.fn();
    const onSource = vi.fn();
    const t = test("Tournois", [{ Action: "Lancer le tournoi", "Expected Result": "Le tableau s'affiche" }]);
    t.steps[0].sources = [{ docId: "D1", anchor: "§1", quote: "q" }];
    const check: CheckFile = {
      at,
      testHash: "h",
      findings: [
        { kind: "quote-not-found", severity: "error", message: "Quote absent", sources: [], step: 1 },
        { kind: "source-missing", severity: "warning", message: "Nothing on the goal", sources: [] },
      ],
    };
    const onToggle = vi.fn();
    const card1 = (open: boolean) => (
      <GenCard
        item={{ id: "x", test: t, check }}
        writing={false}
        checking={false}
        xray={xray}
        open={open}
        onToggle={onToggle}
        onOpen={onOpen}
        onSource={onSource}
      />
    );
    const { rerender } = render(card1(true));
    const card = screen.getByRole("region", { name: "Tournois" });
    expect(card).toHaveTextContent("Lancer le tournoi");
    expect(card).toHaveTextContent("Le tableau s'affiche");
    expect(card).toHaveTextContent("Quote absent");
    expect(card).toHaveTextContent("Nothing on the goal");
    fireEvent.click(screen.getByRole("button", { name: /D1/ }));
    expect(onSource).toHaveBeenCalledWith(expect.objectContaining({ docId: "D1", anchor: "§1" }));
    fireEvent.click(screen.getByRole("button", { name: "Fold step 1" }));
    expect(screen.getByRole("button", { name: "Expand step 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand step 1" }));
    expect(screen.getByRole("button", { name: "Fold step 1" })).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Tournois" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(card1(false));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(card).not.toHaveTextContent("Lancer le tournoi");
    fireEvent.click(screen.getByRole("button", { name: "Open in Review" }));
    expect(onOpen).toHaveBeenCalled();
    cleanup();
    render(
      <GenCard
        item={{ id: "x", test: test("Vide", []) }}
        writing={false}
        checking={false}
        xray={xray}
        open
        onToggle={onToggle}
        onOpen={onOpen}
        onSource={onSource}
      />,
    );
    expect(screen.getByText("This test has no steps yet.")).toBeInTheDocument();
  });

  it("GenCard: findings from the check, then from the test list", () => {
    const onOpen = vi.fn();
    const t = test("", []);
    const show = (props: Partial<Parameters<typeof GenCard>[0]>) => {
      cleanup();
      render(
        <GenCard
          item={{ id: "x", test: t }}
          writing={false}
          checking={false}
          xray={xray}
          open
          onToggle={vi.fn()}
          onOpen={onOpen}
          onSource={vi.fn()}
          {...props}
        />,
      );
    };
    show({ check: { id: "x", ok: false, review: "to-fix", errors: 2, warnings: 0 } });
    expect(screen.getByText("Untitled test")).toBeInTheDocument();
    expect(screen.getByText("2 errors")).toBeInTheDocument();
    show({ check: { id: "x", ok: false, review: "draft", errors: 0, warnings: 1 } });
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    show({ check: { id: "x", ok: true, review: "checked", errors: 0, warnings: 0 } });
    expect(screen.getByText("No findings")).toBeInTheDocument();
    show({ checking: true });
    expect(screen.getByText("Checking…")).toBeInTheDocument();
    show({});
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    const findings = (f: Partial<NonNullable<LocalTestRef["findings"]>>) =>
      show({
        item: {
          id: "x",
          test: test("T", []),
          ref: ref("x", { findings: { errors: 0, warnings: 0, infos: 0, stale: false, ...f } }),
        },
      });
    findings({ errors: 3 });
    expect(screen.getByText("3 errors").closest(".sev")).toHaveClass("s-err");
    findings({ errors: 1, stale: true });
    expect(screen.getByText("1 error").closest(".sev")).toHaveClass("s-stale");
    findings({ warnings: 2 });
    expect(screen.getByText("2 warnings").closest(".sev")).toHaveClass("s-warn");
    findings({ warnings: 2, stale: true });
    expect(screen.getByText("2 warnings").closest(".sev")).toHaveClass("s-stale");
    findings({});
    expect(screen.getByText("No findings")).toBeInTheDocument();
  });

  it("RunHead: nothing, running, done, failed, cancelled", () => {
    const onCancel = vi.fn();
    const onReview = vi.fn();
    const head = (j: Job | null, count: number, result: GenOutput | null = null) => {
      cleanup();
      return render(
        <RunHead
          job={j}
          now={Date.parse(at) + 65000}
          result={result}
          read={1}
          count={count}
          doing="Reading the documents"
          onCancel={onCancel}
          onReview={onReview}
        />,
      );
    };
    expect(head(null, 0).container).toBeEmptyDOMElement();
    head(job(), 0);
    expect(screen.getByText("Reading the documents")).toBeInTheDocument();
    expect(screen.getByText("1:05 · 1 passage read")).toBeInTheDocument();
    head(job(), 2);
    expect(screen.getByText("2 tests so far")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    head(job({ status: "done", endedAt: at }), 0, output());
    expect(screen.getByText("0 tests written")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review these tests" })).toBeNull();
    head(job({ status: "done", endedAt: at }), 1, null);
    fireEvent.click(screen.getByRole("button", { name: "Review these tests" }));
    expect(onReview).toHaveBeenCalledTimes(1);
    head(
      job({ status: "done", endedAt: at }),
      1,
      output({ ok: false, diagnosis: { kind: "k", title: "Claude ran out", detail: "" } }),
    );
    expect(screen.getByText("Claude ran out")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review these tests" }));
    expect(onReview).toHaveBeenCalledTimes(2);
    head(job({ status: "failed" }), 0);
    expect(screen.getByText("The generation stopped")).toBeInTheDocument();
    head(job({ status: "cancelled" }), 0);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    head(job({ status: "cancelled" }), 3);
    expect(screen.getByText("Cancelled · 3 tests kept")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resume/ })).toBeNull();
  });

  it("RunHead: a stopped plan offers to resume what is left", () => {
    const onResume = vi.fn();
    render(
      <RunHead
        job={job({ status: "cancelled", endedAt: at })}
        now={Date.parse(at)}
        result={null}
        read={0}
        count={2}
        doing=""
        left={3}
        onCancel={() => {}}
        onReview={() => {}}
        onResume={onResume}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume · 3 tests left" }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("RunHead: fold all and unfold all once a test is there", () => {
    const onFoldAll = vi.fn();
    const head = (count: number, allFolded: boolean, j = job()) => {
      cleanup();
      render(
        <RunHead
          job={j}
          now={Date.parse(at)}
          result={null}
          read={0}
          count={count}
          doing=""
          allFolded={allFolded}
          onCancel={() => {}}
          onReview={() => {}}
          onFoldAll={onFoldAll}
        />,
      );
    };
    head(0, false);
    expect(screen.queryByRole("button", { name: "Fold all" })).toBeNull();
    head(2, false);
    fireEvent.click(screen.getByRole("button", { name: "Fold all" }));
    expect(onFoldAll).toHaveBeenLastCalledWith(true);
    head(2, true, job({ status: "done", endedAt: at }));
    fireEvent.click(screen.getByRole("button", { name: "Unfold all" }));
    expect(onFoldAll).toHaveBeenLastCalledWith(false);
    head(2, false, job({ status: "cancelled", endedAt: at }));
    expect(screen.getByRole("button", { name: "Fold all" })).toBeInTheDocument();
  });

  it("GenSummary: missing report, skipped items, changed tests", () => {
    const { rerender } = render(
      <GenSummary
        result={output({
          reportFound: false,
          skipped: [{ item: "R2 alarm", why: "no passage" }],
          changed: ["T9", "T8"],
        })}
        checked="checked line"
      />,
    );
    expect(screen.getByText(/checked line/)).toBeInTheDocument();
    expect(screen.getByText(/Claude did not say what it could not write a test for/)).toBeInTheDocument();
    expect(screen.getByText("R2 alarm")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText(/Claude also changed 2 existing tests: T9, T8/)).toBeInTheDocument();
    rerender(<GenSummary result={output({ reportFound: false, ok: false })} checked="" />);
    expect(screen.queryByText(/did not say/)).toBeNull();
    expect(screen.queryByText(/also changed/)).toBeNull();
  });
});

const toc = [
  { anchor: "§5", title: "Traction", level: 2 },
  { anchor: "§5.6", title: "Objets", level: 3 },
  { anchor: "§5.6.6", title: "Sectionneur", level: 4 },
  { anchor: "§5.6.7", title: "Disjoncteur", level: 4 },
  { anchor: "§6", title: "Signaux", level: 2 },
];

describe("Generate › scope helpers", () => {
  const up = parents(toc);

  it("parents, ticks and flips: a section takes its sub-sections, unticking one keeps its siblings", () => {
    expect(up).toEqual([-1, 0, 1, 1, -1]);
    expect(tick(toc, up, [], 0)).toBe("off");
    let picked = flip(toc, up, [], 2);
    expect(picked).toEqual(["§5.6.6"]);
    expect(tick(toc, up, picked, 0)).toBe("mixed");
    picked = flip(toc, up, picked, 0);
    expect(picked).toEqual(["§5"]);
    expect(tick(toc, up, picked, 3)).toBe("on");
    picked = flip(toc, up, picked, 3);
    expect(picked).toEqual(["§5.6.6"]);
    expect(flip(toc, up, ["§6"], 4)).toEqual([]);
  });

  it("ownText keeps the heading's own paragraphs, figures as captions, markers out", () => {
    const md =
      "#### 5.6.6 S <!-- § 5.6.6 -->\n\n<!-- req X -->\nX : le **sectionneur**.\n\n![Figure 40](f.png) <!-- fig 40 -->\n\n##### 5.6.6.1 Sub\n\nlater";
    expect(ownText(md)).toEqual(["X : le sectionneur.", "[Figure 40]"]);
    expect(ownText("")).toEqual([]);
  });

  it("scopeOf: whole documents, picked sections, documents left out", () => {
    expect(scopeOf({ B: ["§1", "§2"], C: "none" }, ["A", "B", "C"])).toEqual({
      docs: ["A"],
      sections: ["B#§1", "B#§2"],
    });
  });
});

function ScopeHost({ initial = {} as Record<string, DocScope>, docs = [] as DocRef[] | null }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <DocScopePicker docs={docs} scopes={v} onChange={setV} />
      <output data-testid="v">{JSON.stringify(v)}</output>
    </>
  );
}

const docRef = (id: string, title: string, sections?: number) =>
  ({
    id,
    code: `C-${id}`,
    title,
    status: "validated",
    stats: sections ? { sections } : undefined,
  }) as unknown as DocRef;

describe("Generate › documents", () => {
  const value = () => JSON.parse(screen.getByTestId("v").textContent ?? "{}");

  it("every document whole by default; left out, back, narrowed to sections with their text", async () => {
    api.routes["docs.show"] = (i) => {
      if (i.anchor === "§5.6.6") return { md: "#### 5.6.6 S\n\nLe sectionneur est représenté." };
      if (i.anchor === "§5.6.7") throw new Error("gone");
      if (i.anchor) return { md: "## 5 T\n\n### 5.6 O" };
      return { toc };
    };
    render(<ScopeHost docs={[docRef("D1", "Traction", 62), docRef("D2", "Signaux")]} />);
    expect(screen.getByText("2 of 2 documents")).toBeInTheDocument();
    expect(screen.getByText(/whole document · 62 sections/)).toBeInTheDocument();
    const d2 = screen.getByRole("checkbox", { name: /Signaux/ });
    expect(d2).toBeChecked();
    fireEvent.click(d2);
    expect(value()).toEqual({ D2: "none" });
    expect(screen.getByText(/left out/)).toBeInTheDocument();
    fireEvent.click(d2);
    expect(value()).toEqual({ D2: "all" });
    fireEvent.click(screen.getAllByRole("button", { name: "Only some sections…" })[0]);
    expect(screen.getByText("no section picked yet")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Unfold Traction" }));
    fireEvent.click(screen.getByRole("button", { name: "Unfold Objets" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Sectionneur/ }));
    expect(value().D1).toEqual(["§5.6.6"]);
    expect(screen.getByText("1 section picked")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Objets/ })).toHaveProperty("indeterminate", true);
    const texts = screen.getAllByRole("button", { name: "Text" });
    fireEvent.click(texts[2]);
    expect(await screen.findByText("Le sectionneur est représenté.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide text" }));
    expect(screen.queryByText("Le sectionneur est représenté.")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Text" })[1]);
    expect(await screen.findByText("No text under this heading — only sub-sections.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Text" })[2]);
    expect(await screen.findByText("Could not read this section — try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fold Objets" }));
    expect(screen.queryByRole("checkbox", { name: /Sectionneur/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to the whole document" }));
    expect(value().D1).toBe("all");
    fireEvent.click(screen.getByRole("button", { name: "Select none" }));
    expect(value()).toEqual({ D1: "none", D2: "none" });
    expect(screen.getByText("0 of 2 documents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(value()).toEqual({ D1: "all", D2: "all" });
  });

  it("loading, no document, a document without headings", async () => {
    const { container } = render(<ScopeHost docs={null} />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    cleanup();
    render(<ScopeHost docs={[]} />);
    expect(screen.getByText("No document yet — add one in Documents.")).toBeInTheDocument();
    cleanup();
    api.routes["docs.show"] = () => null;
    render(<ScopeHost docs={[docRef("D1", "")]} initial={{ D1: [] }} />);
    expect(await screen.findByText("This document has no headings to pick from.")).toBeInTheDocument();
    expect(screen.getByText("C-D1")).toBeInTheDocument();
  });
});

describe("Generate › smart columns", () => {
  it("lists each column with its origin and what Claude writes; new ones ask to define", () => {
    const onEdit = vi.fn();
    render(
      <ColumnsView
        columns={[
          { name: "Action", origin: "xray", builtin: true, status: "ok", description: "One gesture" },
          { name: "Exigence", origin: "xray", builtin: false, status: "ok", description: "What the step checks" },
          { name: "Version", origin: "xray", builtin: false, status: "new", description: "" },
          { name: "Note", origin: "local", builtin: false, status: "ok", description: "" },
          { name: "Old", origin: "local", builtin: false, status: "gone", description: "x" },
        ]}
        onEdit={onEdit}
      />,
    );
    expect(screen.getByText("Xray · standard")).toBeInTheDocument();
    expect(screen.getByText("New in Xray")).toBeInTheDocument();
    expect(screen.getByText("Local only")).toBeInTheDocument();
    expect(screen.getByText("No longer in Xray")).toBeInTheDocument();
    expect(screen.getByText("What the step checks")).toBeInTheDocument();
    expect(screen.getAllByText("No description — Claude leaves it empty.")).toHaveLength(2);
    expect(screen.getByText(/A column came from Xray without a description/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Define the columns" }));
    expect(onEdit).toHaveBeenCalled();
    cleanup();
    render(
      <ColumnsView
        columns={[
          { name: "A", origin: "xray", builtin: false, status: "new", description: "" },
          { name: "B", origin: "xray", builtin: false, status: "new", description: "" },
        ]}
        onEdit={onEdit}
      />,
    );
    expect(screen.getByText(/2 columns came from Xray without a description — Claude leaves them/)).toBeInTheDocument();
    cleanup();
    render(<ColumnsView columns={[]} onEdit={onEdit} />);
    expect(screen.getByRole("button", { name: "Edit in Settings" })).toBeInTheDocument();
  });
});

describe("Generate screen", () => {
  const base = () => {
    api.routes["claude.status"] = () => ({ installed: true, signedIn: true });
    api.routes["jobs.list"] = () => [];
    api.routes["contexts.list"] = () => [];
    api.routes["docs.list"] = () => [{ id: "D1", code: "C1", title: "Traction", status: "validated" }];
    api.routes["docs.show"] = () => ({ toc: [{ anchor: "§1", title: "Intro", level: 1 }] });
  };
  const info = (claude: Record<string, unknown> | null, folders?: string[]) => {
    const a = app();
    return {
      ...a.info,
      project: {
        ...a.info?.project,
        folders,
        claude: claude ? { ...a.info?.project.claude, ...claude } : undefined,
      },
    } as unknown as NonNullable<ReturnType<typeof app>["info"]>;
  };

  it("opens on the last generation, already done, with its log", async () => {
    base();
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
    const { app: a } = mount(<GenerateScreen />, { info: info({ model: "claude-x" }) });
    expect(await screen.findByText("Premier")).toBeInTheDocument();
    expect(screen.getByText("It hit the limit")).toBeInTheDocument();
    expect(screen.getByText("Project default: Claude-x / medium")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate again" })).toBeInTheDocument();
    expect(a.testsChanged).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open in Review" }));
    expect(a.navigate).toHaveBeenCalledWith("review", "local-aaaaaaaa");
    fireEvent.click(screen.getByRole("button", { name: "Review these tests" }));
    expect(a.navigate).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("region", { name: "What Claude did" })).toBeInTheDocument();
    const log = screen.getByRole("button", { name: "Show the raw log (1 event)" });
    fireEvent.click(log);
    expect(screen.getByRole("log", { name: "Raw log" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide the raw log (1 event)" }));
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("shows a failed run with its error and nothing written", async () => {
    base();
    api.routes["jobs.list"] = () => null;
    mount(<GenerateScreen />, { info: null });
    expect(screen.getByText("Project default: Opus / high")).toBeInTheDocument();
    await waitFor(() => expect(named("jobs.list").filter((c) => !c.input?.running)).toHaveLength(1));
    expect(screen.getByText("Tests appear here as Claude writes them")).toBeInTheDocument();
    cleanup();
    api.routes["jobs.list"] = () => [job({ id: "g1", status: "failed" })];
    api.routes["jobs.show"] = () => ({ job: job({ id: "g1", status: "failed", error: "Claude crashed" }), events: [] });
    mount(<GenerateScreen />, { info: info({ model: "opus", effort: "high" }, ["/A"]) });
    expect(await screen.findByText("Claude crashed")).toBeInTheDocument();
    expect(screen.getByText("Project default: Opus / high")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show the raw log (0 events)" })).toBeInTheDocument();
    cleanup();
    api.routes["jobs.list"] = () => [job({ id: "g2", status: "done" })];
    api.routes["jobs.show"] = () => ({ job: job({ id: "g2", status: "done", endedAt: at }), events: [] });
    mount(<GenerateScreen />);
    expect(await screen.findByText("0 tests written")).toBeInTheDocument();
  });

  it("asks to connect Claude when it is missing, and checks again", async () => {
    base();
    api.routes["claude.status"] = (i) =>
      i.refresh ? { installed: true, signedIn: false } : { installed: false, signedIn: null };
    const { app: a } = mount(<GenerateScreen />);
    expect(await screen.findByText("Claude isn't installed on this PC yet")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("What should be tested?"), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Claude isn't signed in on this PC yet")).toBeInTheDocument();
    expect(named("claude.status").at(-1)?.input).toEqual({ refresh: true, signIn: true });
    fireEvent.click(screen.getByRole("button", { name: "Open system check" }));
    expect(a.navigate).toHaveBeenCalledWith("doctor");
  });

  it("an unreadable Claude status does not block generating", async () => {
    base();
    delete api.routes["claude.status"];
    mount(<GenerateScreen />);
    await waitFor(() => expect(named("claude.status")).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("What should be tested?"), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("sends the scope, the context, the model; reports a refused start and ignores an answer without a job", async () => {
    base();
    api.routes["contexts.list"] = () => [{ id: "g", name: "Glossaire", paths: [], files: [], hasNotes: true }];
    mount(<GenerateScreen />, { info: info({ model: "sonnet", effort: "medium", contexts: ["g"] }) });
    const go = screen.getByRole("button", { name: "Generate" });
    await screen.findByText("Traction");
    expect(go).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Select none" }));
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Only some sections…" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Intro/ }));
    expect(go).toBeEnabled();
    fireEvent.change(screen.getByLabelText("What should be tested?"), { target: { value: " PCC " } });
    expect(await screen.findByRole("button", { name: "Leave Glossaire out of this run" })).toBeInTheDocument();
    expect(screen.getByText("1 saved context")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "opus" } });
    fireEvent.change(screen.getByLabelText("Effort"), { target: { value: "max" } });
    fireEvent.click(go);
    expect(await screen.findByText("Could not start the generation")).toBeInTheDocument();
    expect(named("gen.tests")[0].input).toEqual({
      request: "PCC",
      sections: ["D1#§1"],
      contexts: ["g"],
      model: "opus",
      effort: "max",
    });
    api.routes["gen.tests"] = () => ({});
    fireEvent.click(go);
    await waitFor(() => expect(named("gen.tests")).toHaveLength(2));
    expect(screen.getByText("Tests appear here as Claude writes them")).toBeInTheDocument();
    cleanup();
    mount(<GenerateScreen />, { info: info({ model: "sonnet", effort: "medium" }) });
    expect(screen.getByLabelText("Model")).toHaveValue("opus");
    expect(screen.getByLabelText("Effort")).toHaveValue("max");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Model")).toHaveValue("sonnet");
    expect(screen.getByLabelText("Effort")).toHaveValue("medium");
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("asks before replacing Claude's tests not validated yet: cancel, review, or delete and generate", async () => {
    base();
    api.routes["gen.tests"] = () => ({ jobId: "j2" });
    api.routes["jobs.show"] = () => ({
      job: job({ id: "j2", status: "done", endedAt: at, result: output({ discarded: ["local-aaaaaaaa"] }) }),
      events: [],
    });
    api.routes["tests.list"] = () => [
      ref("local-aaaaaaaa", { generated: true, review: "checked" }),
      ref("local-bbbbbbbb", { generated: true, review: "validated" }),
      ref("LFRPS12-1", { generated: true, review: "draft", key: "LFRPS12-1" }),
      ref("local-cccccccc"),
    ];
    const { app: a } = mount(<GenerateScreen />);
    await screen.findByText("Traction");
    const go = screen.getByRole("button", { name: "Generate" });
    fireEvent.click(go);
    const dialog = await screen.findByRole("dialog", { name: "Replace the tests not validated yet?" });
    expect(dialog).toHaveTextContent("deletes the 1 test Claude wrote that is not validated yet");
    expect(dialog).toHaveTextContent("this test and its screenshots");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(named("gen.tests")).toHaveLength(0);
    fireEvent.click(go);
    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    expect(a.navigate).toHaveBeenCalledWith("review", "local-aaaaaaaa");
    fireEvent.click(go);
    fireEvent.click(await screen.findByRole("button", { name: "Delete and generate" }));
    await waitFor(() => expect(named("gen.tests")).toHaveLength(1));
    expect(named("gen.tests")[0].input).toMatchObject({ docs: ["D1"], discard: true });
    expect(await screen.findByText("1 test not validated yet was deleted before this run.")).toBeInTheDocument();
    expect(a.testsChanged).toHaveBeenCalled();
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
    const { app: a } = mount(<GenerateScreen />);
    fireEvent.change(screen.getByLabelText("What should be tested?"), { target: { value: " Les sectionneurs " } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByRole("heading", { name: "Getting ready" })).toBeInTheDocument();
    expect(screen.getByText("Claude is starting.")).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    await new Promise((r) => setTimeout(r, 1100));
    refs = [ref("local-aaaaaaaa"), ref("local-bbbbbbbb")];
    emit({ jobId: "j1", at, type: "progress", message: "Writing local-aaaaaaaa" });
    emit({ jobId: "j1", at, type: "progress", message: "Writing local-bbbbbbbb" });
    emit({ jobId: "j1", at, type: "progress", message: "Writing local-cccccccc" });
    expect(await screen.findByText("First")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Claude is writing a test" })).toBeInTheDocument();
    expect(screen.getByText("Checking…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate again" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Could not cancel")).toBeInTheDocument();
    api.routes["jobs.cancel"] = () => ({});
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(named("jobs.cancel")).toHaveLength(2));
    expect(named("jobs.cancel")[1].input).toEqual({ id: "j1" });
    delete api.routes["tests.list"];
    emit({
      jobId: "j1",
      at,
      type: "status",
      job: job({
        status: "done",
        endedAt: at,
        result: output({ tests: ["local-aaaaaaaa", "local-bbbbbbbb", "local-cccccccc"] }),
      }),
    });
    expect(await screen.findByText("3 tests written")).toBeInTheDocument();
    await waitFor(() => expect(a.testsChanged).toHaveBeenCalled());
    expect(a.refreshInfo).toHaveBeenCalled();
    expect(screen.getAllByRole("status", { name: "Loading a test" }).length).toBeGreaterThan(0);
  });
});
