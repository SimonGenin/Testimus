// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobEvent, LocalTestRef, Test } from "../../src/core/types.ts";
import type { AppState } from "../../src/ui/lib/app.ts";
import { GenerateScreen } from "../../src/ui/screens/generate/GenerateScreen.tsx";
import {
  Coverage,
  checkLine,
  GenCard,
  type GenOutput,
  landedIds,
  passagesRead,
  RunHead,
} from "../../src/ui/screens/generate/GenResult.tsx";
import { RequirementPicker } from "../../src/ui/screens/generate/RequirementPicker.tsx";
import { SectionPicker } from "../../src/ui/screens/generate/SectionPicker.tsx";
import { clearToasts, mount } from "./cov-uiscreens-helpers.tsx";
import { api, app, FakeEventSource, fakeFetch, named } from "./ui-desktop-helpers.tsx";

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
  uncovered: [],
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
    render(<GenCard item={{ id: "x" }} writing checking={false} onOpen={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Claude is writing a test" })).toHaveTextContent("Writing…");
    cleanup();
    render(<GenCard item={{ id: "x" }} writing={false} checking={false} onOpen={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Loading a test" })).toHaveTextContent("Loading…");
  });

  it("GenCard: findings from the check, then from the test list, and the requirements", () => {
    const onOpen = vi.fn();
    const t = test("", [{ Exigence: "EXI_A_1, EXI_A_2" }, { Exigence: "OTHER_9" }]);
    const show = (props: Partial<Parameters<typeof GenCard>[0]>) => {
      cleanup();
      render(<GenCard item={{ id: "x", test: t }} writing={false} checking={false} onOpen={onOpen} {...props} />);
    };
    show({ check: { id: "x", ok: false, review: "to-fix", errors: 2, warnings: 0 } });
    expect(screen.getByText("Untitled test")).toBeInTheDocument();
    expect(screen.getByText("2 errors")).toBeInTheDocument();
    expect(screen.getByText("…_1")).toBeInTheDocument();
    expect(screen.getByText("…_2")).toBeInTheDocument();
    expect(screen.getByText("OTHER_9")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalled();
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
          test: test("T"),
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
  });

  it("Coverage: requirements covered, missing report, uncovered items, changed tests", () => {
    const { rerender } = render(
      <Coverage
        asked={[{ label: "Requirement", ids: ["R1", "R2"] }]}
        result={output({
          reportFound: false,
          uncovered: [{ item: "R2 alarm", why: "no passage" }],
          changed: ["T9", "T8"],
        })}
        checked="checked line"
      />,
    );
    expect(screen.getByText("1 of 2 requirement ids covered.")).toBeInTheDocument();
    expect(screen.getByText(/checked line/)).toBeInTheDocument();
    expect(screen.getByText(/Claude did not say what it could not cover/)).toBeInTheDocument();
    expect(screen.getByText("R2 alarm")).toBeInTheDocument();
    expect(screen.getByText(/Claude also changed 2 existing tests: T9, T8/)).toBeInTheDocument();
    rerender(<Coverage asked={[]} result={output({ reportFound: false, ok: false })} checked="" />);
    expect(screen.queryByText(/covered\./)).toBeNull();
    expect(screen.queryByText(/did not say/)).toBeNull();
    expect(screen.queryByText(/also changed/)).toBeNull();
  });
});

const known = [
  { id: "EXI_1", text: "Alarme sonore", doc: "D" },
  { id: "EXI_2", text: "", doc: "D" },
  { id: "EXI_3", text: "Alarme visuelle", doc: "D" },
];

function Host({ initial = [] as string[], list = known }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <RequirementPicker inputId="p" kind="requirement" known={list} values={v} onChange={setV} />
      <output data-testid="v">{v.join("|")}</output>
    </>
  );
}

function SectionHost() {
  const [v, setV] = useState<string[]>([]);
  return (
    <>
      <SectionPicker values={v} onChange={setV} />
      <output data-testid="v">{v.join("|")}</output>
    </>
  );
}

describe("Generate › requirement picker", () => {
  const value = () => screen.getByTestId("v").textContent;
  const box = () => screen.getByRole("combobox");

  it("suggests by id or by word, moves with the arrows and adds with Enter", () => {
    render(<Host />);
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "ArrowUp" });
    fireEvent.change(box(), { target: { value: "alarme" } });
    const opts = within(screen.getByRole("listbox", { name: "Matching requirement ids" })).getAllByRole("option");
    expect(opts).toHaveLength(2);
    expect(opts[0]).toHaveAttribute("aria-selected", "true");
    expect(box()).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box(), { key: "ArrowUp" });
    fireEvent.keyDown(box(), { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0]).toHaveClass("is-on");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(value()).toBe("EXI_3");
    expect(box()).toHaveValue("");
    fireEvent.change(box(), { target: { value: "exi_" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["EXI_1Alarme sonore", "EXI_2"]);
    fireEvent.mouseDown(screen.getAllByRole("option")[1]);
    fireEvent.click(screen.getAllByRole("option")[1]);
    expect(value()).toBe("EXI_3|EXI_2");
  });

  it("adds a typed list, skips duplicates, flags unknown ids, removes with Backspace or the chip", () => {
    render(<Host initial={["EXI_1"]} />);
    fireEvent.change(box(), { target: { value: "EXI_1, NEW_9; NEW_9 EXI_2" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(value()).toBe("EXI_1|NEW_9|EXI_2");
    expect(screen.getByRole("button", { name: "Remove requirement NEW_9" }).previousSibling).toHaveClass("chip-err");
    fireEvent.change(box(), { target: { value: "EXI_1" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(value()).toBe("EXI_1|NEW_9|EXI_2");
    fireEvent.change(box(), { target: { value: "x" } });
    fireEvent.keyDown(box(), { key: "Backspace" });
    expect(value()).toBe("EXI_1|NEW_9|EXI_2");
    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.keyDown(box(), { key: "Backspace" });
    expect(value()).toBe("EXI_1|NEW_9");
    fireEvent.click(screen.getByRole("button", { name: "Remove requirement EXI_1" }));
    expect(value()).toBe("NEW_9");
    fireEvent.keyDown(box(), { key: "a" });
  });

  it("without known requirements nothing is flagged; Backspace on empty values does nothing", () => {
    render(<Host initial={["X"]} list={[]} />);
    expect(screen.getByRole("button", { name: "Remove requirement X" }).previousSibling).not.toHaveClass("chip-err");
    fireEvent.keyDown(box(), { key: "Backspace" });
    fireEvent.keyDown(box(), { key: "Backspace" });
    expect(value()).toBe("");
    expect(box()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Generate › section picker", () => {
  it("lists current documents, opens a table of contents and picks sections", async () => {
    api.routes["docs.list"] = () => [
      { id: "D1", code: "C1", title: "Traction", status: "validated" },
      { id: "D0", code: "C0", title: "Old", status: "superseded" },
      { id: "D9", code: "C9", title: "Older", status: "validated", supersededBy: "D1" },
      { id: "D2", code: "C2", title: "Empty", status: "draft" },
      { id: "D3", code: "C3", title: "Broken", status: "draft" },
    ];
    let releaseToc = () => {};
    const tocReady = new Promise<void>((r) => {
      releaseToc = r;
    });
    api.routes["docs.show"] = (i) => {
      if (i.id === "D1")
        return {
          toc: [
            { anchor: "§5.6", title: "Sectionneur", level: 1 },
            { anchor: "fig-2", title: "Figure", level: 2 },
          ],
        };
      if (i.id === "D2") return null;
      throw new Error("gone");
    };
    const f = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("docs/show") && String(init?.body).includes("D1")) await tocReady;
        return f(url, init);
      }),
    );
    const { container } = render(<SectionHost />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    const d1 = await screen.findByRole("button", { name: /C1/ });
    expect(screen.queryByText("Old")).toBeNull();
    expect(screen.queryByText("Older")).toBeNull();
    fireEvent.click(d1);
    expect(d1).toHaveAttribute("aria-expanded", "true");
    releaseToc();
    const sec = await screen.findByRole("checkbox", { name: "5.6 Sectionneur" });
    fireEvent.click(sec);
    fireEvent.click(screen.getByRole("checkbox", { name: "Figure" }));
    expect(screen.getByTestId("v")).toHaveTextContent("D1#§5.6|D1#fig-2");
    expect(screen.getByText("2 picked")).toBeInTheDocument();
    fireEvent.click(sec);
    expect(screen.getByTestId("v")).toHaveTextContent("D1#fig-2");
    fireEvent.click(d1);
    expect(d1).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /C2/ }));
    fireEvent.click(screen.getByRole("button", { name: /C3/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /C3/ })).toHaveAttribute("aria-expanded", "true"));
    await waitFor(() => expect(container.querySelectorAll(".sec .skel, .sec [class*='skel']")).toHaveLength(0));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("says when there is no document, whether the list is empty or unreadable", async () => {
    api.routes["docs.list"] = () => null;
    render(<SectionHost />);
    expect(await screen.findByText("No document yet — add one in Documents.")).toBeInTheDocument();
    cleanup();
    delete api.routes["docs.list"];
    render(<SectionHost />);
    expect(await screen.findByText("No document yet — add one in Documents.")).toBeInTheDocument();
  });
});

describe("Generate screen", () => {
  const base = () => {
    api.routes["claude.status"] = () => ({ installed: true, signedIn: true });
    api.routes["jobs.list"] = () => [];
    api.routes["docs.list"] = () => [{ id: "D1", code: "C1", title: "Traction", status: "validated" }];
    api.routes["docs.show"] = () => ({ toc: [{ anchor: "§1", title: "Intro", level: 1 }], requirements: ["EXI_1"] });
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
    expect(screen.getByText(/claude-x · effort medium/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate again" })).toBeInTheDocument();
    expect(a.testsChanged).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Premier/ }));
    expect(a.navigate).toHaveBeenCalledWith("review", "local-aaaaaaaa");
    fireEvent.click(screen.getByRole("button", { name: "Review these tests" }));
    expect(a.navigate).toHaveBeenCalledTimes(2);
    const log = screen.getByRole("button", { name: /Show what Claude read and wrote \(1 entry\)/ });
    fireEvent.click(log);
    expect(screen.getByRole("log", { name: "What Claude read and wrote" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Hide what Claude read and wrote/ }));
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("shows a failed run with its error and nothing written", async () => {
    base();
    api.routes["jobs.list"] = () => null;
    mount(<GenerateScreen />, { info: null });
    expect(screen.getByText(/Claude · effort medium/)).toBeInTheDocument();
    await waitFor(() => expect(named("jobs.list").filter((c) => !c.input?.running)).toHaveLength(1));
    expect(screen.getByText("Tests appear here as Claude writes them")).toBeInTheDocument();
    cleanup();
    api.routes["jobs.list"] = () => [job({ id: "g1", status: "failed" })];
    api.routes["jobs.show"] = () => ({ job: job({ id: "g1", status: "failed", error: "Claude crashed" }), events: [] });
    mount(<GenerateScreen />, { info: info({ model: "opus", effort: "high" }, ["/A"]) });
    expect(await screen.findByText("Claude crashed")).toBeInTheDocument();
    expect(screen.getByText(/Opus · effort high/)).toBeInTheDocument();
    expect(document.querySelectorAll("#gen-folders option")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /\(0 entries\)/ })).toBeInTheDocument();
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

  it("offers each tracked kind, sends the other kinds as tracked ids and reports their coverage", async () => {
    base();
    const traces = [
      { id: "requirement", label: "Requirement", patterns: ["EXI_\\d+"], field: "Exigence" },
      { id: "alarm", label: "Alarm", patterns: ["ALM-\\d+"], field: "Alarme" },
      { id: "usecase", label: "Use case", patterns: ["UC\\d+"], field: "UC" },
    ];
    api.routes["traces.find"] = (i) => {
      if (i.trace === "usecase") throw new Error("scan failed");
      return {
        total: 1,
        distinct: 1,
        docs: [],
        items: [{ id: i.trace === "alarm" ? "ALM-12" : "EXI_1", doc: "D1", anchor: "§1", context: "Alarme feu" }],
      };
    };
    api.routes["gen.tests"] = () => ({ jobId: "g9" });
    api.routes["jobs.show"] = () => ({
      job: job({
        id: "g9",
        status: "done",
        endedAt: at,
        result: output({ uncovered: [{ item: "ALM-12 fire", why: "no passage" }] }),
      }),
      events: [],
    });
    mount(<GenerateScreen />, { info: { ...app().info, traces } as AppState["info"] });
    await waitFor(() => expect(named("traces.find")).toHaveLength(3));
    expect(named("traces.find")[1].input).toEqual({ trace: "alarm", limit: 5000 });
    const alarm = screen.getByLabelText("Alarm ids");
    fireEvent.change(alarm, { target: { value: "feu" } });
    fireEvent.click(await screen.findByRole("option", { name: /ALM-12/ }));
    const go = screen.getByRole("button", { name: "Generate" });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    expect(await screen.findByText("0 of 1 alarm id covered.")).toBeInTheDocument();
    expect(named("gen.tests")[0].input).toEqual({ request: "", tracked: [{ trace: "alarm", ids: ["ALM-12"] }] });
  });

  it("sends the scope, reports a refused start, and ignores an answer without a job", async () => {
    base();
    const req = { id: "requirement", label: "Requirement", patterns: ["EXI_d+"], field: "Exigence" };
    mount(<GenerateScreen />, { info: { ...app().info, traces: [req] } as AppState["info"] });
    const go = screen.getByRole("button", { name: "Generate" });
    expect(go).toBeDisabled();
    const reqs = screen.getByPlaceholderText("Add by id or by word");
    fireEvent.change(reqs, { target: { value: "EXI_7" } });
    fireEvent.keyDown(reqs, { key: "Enter" });
    expect(go).toBeEnabled();
    fireEvent.click(await screen.findByRole("button", { name: /C1/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "1 Intro" }));
    fireEvent.change(screen.getByLabelText("Xray folder for the new tests"), { target: { value: " /T " } });
    fireEvent.click(go);
    expect(await screen.findByText("Could not start the generation")).toBeInTheDocument();
    expect(named("gen.tests")[0].input).toEqual({
      request: "",
      requirements: ["EXI_7"],
      sections: ["D1#§1"],
      folder: "/T",
    });
    api.routes["gen.tests"] = () => ({});
    fireEvent.click(go);
    await waitFor(() => expect(named("gen.tests")).toHaveLength(2));
    expect(screen.getByText("Tests appear here as Claude writes them")).toBeInTheDocument();
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
    expect(await screen.findByText("Reading the documents")).toBeInTheDocument();
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
