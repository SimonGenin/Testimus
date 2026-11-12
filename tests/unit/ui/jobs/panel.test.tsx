// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobEvent } from "../../../../src/core/types.ts";
import { JobPanel } from "../../../../src/ui/components/jobs/JobPanel.tsx";
import { JobState } from "../../../../src/ui/components/jobs/JobState.tsx";
import { kindIcon } from "../../../../src/ui/components/jobs/kinds.ts";
import type { AppState } from "../../../../src/ui/lib/app.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { applyJobEvent } from "../../../../src/ui/lib/data/events.ts";
import { kindLabel } from "../../../../src/ui/lib/jobs.ts";
import { iconsIn } from "../../helpers/icons.ts";
import { callsOf, Fail, FakeES, fakeEvents, fakeNet, job, net, withApp } from "../../helpers/ui-data.tsx";

const toasts = vi.hoisted(() => ({ toast: vi.fn(), errorToast: vi.fn() }));
vi.mock("../../../../src/ui/lib/toast.ts", () => toasts);

const errors = () => toasts.errorToast.mock.calls.map((a) => a[1]);
const end = "2026-11-02T10:01:00Z";

let server: Job[] = [];

function emit(e: JobEvent): void {
  server = applyJobEvent(server, e);
  act(() => FakeES.emit(e));
}

beforeEach(() => {
  fakeNet();
  fakeEvents();
  server = [];
  net.routes["jobs.list"] = () => server;
  net.routes["jobs.show"] = (i) => ({ job: server.find((j) => j.id === i.id) ?? null, events: [] });
  toasts.toast.mockClear();
  toasts.errorToast.mockClear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  setProject(null);
});

function drawer(id: string, over: Partial<AppState> = {}) {
  const onClose = vi.fn();
  const onGo = vi.fn();
  const r = withApp(<JobPanel id={id} onClose={onClose} onGo={onGo} />, over);
  return { ...r, onClose, onGo };
}

const panel = (name: string | RegExp) => screen.findByRole("dialog", { name });

describe("the job panel", () => {
  it("follows a running job: its progress, what it does now, and Cancel", async () => {
    server = [job({ id: "r1", kind: "rag-index", subject: "index", message: "Embedding" })];
    let cancels = 0;
    net.routes["jobs.cancel"] = () => {
      cancels++;
      if (cancels > 1) throw new Fail("already done");
      return null;
    };
    drawer("r1");
    const side = await panel("Index documents");
    expect(within(side).getByText("All documents")).toBeInTheDocument();
    await waitFor(() => expect(within(side).getByText("Embedding")).toBeInTheDocument());
    expect(within(side).getByRole("progressbar", { name: "Progress" })).not.toHaveAttribute("aria-valuenow");
    expect(within(side).queryByText(/Same as/)).toBeNull();
    emit({ jobId: "r1", at: "", type: "progress", message: "Embedding 2 of 4", done: 2, total: 4 });
    await waitFor(() => expect(within(side).getByText("Embedding 2 of 4")).toBeInTheDocument());
    fireEvent.click(within(side).getByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(callsOf("jobs.cancel")).toHaveLength(1));
    fireEvent.click(within(side).getByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(errors()).toContain("Could not cancel the job"));
  });

  it("a finished job leads to what it made and closes on the way there", async () => {
    const made: [Job, string, [string, string]][] = [
      [
        job({ id: "g1", status: "done", endedAt: end, result: { tests: ["local-a", "local-b"] } }),
        "Review these tests",
        ["review", "local-a"],
      ],
      [
        job({
          id: "c1",
          kind: "check",
          status: "done",
          endedAt: end,
          result: { tests: [{ id: "K-1" }, { id: "K-2" }] },
        }),
        "Review these tests",
        ["review", "K-1"],
      ],
      [
        job({ id: "x1", kind: "fix", subject: "K-3", status: "done", endedAt: end, result: { changedSteps: [1] } }),
        "Review this test",
        ["review", "K-3"],
      ],
      [
        job({ id: "p1", kind: "pull", status: "done", endedAt: end, result: { pulled: ["LFRPS12-9"] } }),
        "Open the test",
        ["tests", "LFRPS12-9"],
      ],
      [
        job({ id: "d1", kind: "docs.convert", status: "done", endedAt: end, result: { id: "SPEC-1" } }),
        "Open the document",
        ["documents", "SPEC-1"],
      ],
      [
        job({
          id: "f1",
          kind: "describe-figures",
          status: "done",
          endedAt: end,
          result: { docs: [{ docId: "SPEC-2" }] },
        }),
        "Open the document",
        ["documents", "SPEC-2"],
      ],
    ];
    for (const [j, label, to] of made) {
      server = [j];
      const { onGo, onClose } = drawer(j.id);
      const side = await panel(kindLabel(j.kind));
      fireEvent.click(await within(side).findByRole("button", { name: label }));
      expect(onClose).toHaveBeenCalled();
      expect(onGo).toHaveBeenCalledWith(...to);
      cleanup();
    }
    server = [job({ id: "g2", status: "done", endedAt: end, result: { tests: ["local-a", "local-b"] } })];
    drawer("g2");
    expect(await within(await panel("Generate tests")).findByText("2 tests written")).toBeInTheDocument();
    cleanup();
    server = [job({ id: "e1", status: "done", endedAt: end, result: { tests: [] } })];
    drawer("e1");
    await panel("Generate tests");
    expect(screen.queryByRole("button", { name: /Review these tests/ })).toBeNull();
  });

  it("says what went wrong, where, and what to do; the diagnosis and Run again open in its place", async () => {
    server = [
      job({
        id: "rag-index-0000aaaa",
        kind: "rag-index",
        subject: "index",
        status: "failed",
        endedAt: end,
        error: "Cannot find module 'x/onnxruntime_binding.node'",
        steps: [{ id: "embed", label: "Embed the passages", status: "failed", done: 0, total: 97 }],
        rerun: { name: "rag.index", input: {} },
      }),
      job({
        id: "tri-1",
        kind: "actions.triage",
        subject: "rag-index-0000aaaa",
        status: "done",
        endedAt: end,
        cause: { jobId: "rag-index-0000aaaa", why: "after-failure" },
        result: { summary: "Install the runtime." },
      }),
      job({ id: "rag-index-0000bbbb", kind: "rag-index", subject: "index", status: "running" }),
    ];
    net.routes["jobs.rerun"] = () => ({ jobId: "rag-index-0000bbbb" });
    drawer("rag-index-0000aaaa");
    const side = await panel("Index documents");
    const alert = await within(side).findByRole("alert");
    expect(alert).toHaveTextContent("The search runtime is missing on this machine");
    expect(alert).toHaveTextContent("Step 1 of 1 · Embed the passages · stopped at 0 of 97");
    fireEvent.click(within(alert).getByRole("button", { name: /Technical details/ }));
    expect(within(alert).getByText(/onnxruntime_binding/)).toBeInTheDocument();
    fireEvent.click(await within(alert).findByRole("button", { name: "Open the diagnosis" }));
    const diag = await panel("Claude looks at the problems");
    expect(within(diag).getByText(/After the failure of/)).toBeInTheDocument();
    fireEvent.click(within(diag).getByRole("button", { name: "Index documents" }));
    const back = await panel("Index documents");
    fireEvent.click(within(within(back).getByRole("alert")).getByRole("button", { name: /Run again/ }));
    await waitFor(() => expect(callsOf("jobs.rerun")[0]?.input).toEqual({ id: "rag-index-0000aaaa" }));
    await waitFor(() => expect(within(back).getByRole("button", { name: /Cancel/ })).toBeInTheDocument());
  });

  it("a Jira refusal sends to Settings › Access", async () => {
    server = [job({ id: "j1", kind: "push", status: "failed", endedAt: end, error: "Jira answered 401 Unauthorized" })];
    const { state } = drawer("j1");
    const side = await panel("Push to Jira");
    expect(within(side).queryByRole("button", { name: "Open the system check" })).toBeNull();
    fireEvent.click(await within(side).findByRole("button", { name: "Open Settings › Jira and Xray" }));
    expect(state.navigate).toHaveBeenLastCalledWith("settings", "access");
  });

  it("takes the live state of the job, but not a stale running one", async () => {
    server = [job({ id: "a", status: "running" }), job({ id: "b", status: "done", endedAt: end })];
    net.routes["jobs.show"] = (i) => ({
      job: i.id === "a" ? job({ id: "a", status: "done", result: { tests: ["t1"] } }) : job({ id: "b" }),
      events: [{ jobId: i.id, at: "2026-11-02T10:00:01Z", type: "log", level: "info", message: `log of ${i.id}` }],
    });
    drawer("a");
    const side = await panel("Generate tests");
    await waitFor(() => expect(within(side).getByRole("button", { name: "Review this test" })).toBeInTheDocument());
    cleanup();
    drawer("b");
    const b = await panel("Generate tests");
    fireEvent.click(within(b).getByRole("button", { name: "Show the full log" }));
    await waitFor(() => expect(within(b).getByText("log of b")).toBeInTheDocument());
    expect(within(b).queryByRole("button", { name: /Cancel/ })).toBeNull();
  });

  it("draws the steps, a step's own job opening in its place, and no process or pid", async () => {
    server = [
      job({
        id: "add-1",
        kind: "docs.add",
        subject: "/Users/me/spec.pdf",
        steps: [
          {
            id: "convert",
            label: "Copy and convert",
            status: "running",
            done: 3,
            total: 10,
            message: "Page 3",
            jobId: "conv-1",
          },
          { id: "cited", label: "Re-check the tests citing it", status: "waiting" },
        ],
        processes: [
          { id: "p1", label: "Claude · figures", command: "claude -p", pid: 77, step: "convert", startedAt: end },
        ],
      }),
      job({ id: "conv-1", kind: "docs.convert", subject: "spec", parentId: "add-1" }),
    ];
    drawer("add-1");
    const side = await panel("Add document");
    expect(within(side).getByText("spec.pdf")).toBeInTheDocument();
    const steps = await within(side).findByRole("list", { name: "Steps" });
    expect(within(steps).getByText("Waiting")).toBeInTheDocument();
    expect(within(steps).getByRole("progressbar", { name: "Copy and convert progress" })).toHaveAttribute(
      "aria-valuenow",
      "30",
    );
    expect(within(side).queryByText(/pid 77/)).toBeNull();
    fireEvent.click(await within(steps).findByRole("button", { name: /Convert document/ }));
    const child = await panel("Convert document");
    fireEvent.click(within(child).getByRole("button", { name: "Add document" }));
    expect(await panel("Add document")).toBeInTheDocument();
  });

  it("heads What Claude did with the run's model and effort, else the project's defaults", async () => {
    const ran = (id: string): JobEvent[] => [
      {
        jobId: id,
        at: end,
        type: "claude",
        event: { type: "result", ok: true, text: "ok", durationMs: 4000, tokens: { input: 18000, output: 640 } },
      },
    ];
    server = [
      job({
        id: "fix-1",
        kind: "fix",
        status: "done",
        endedAt: end,
        rerun: { name: "review.fix", input: { id: "local-1", model: "opus", effort: "high" } },
      }),
      job({ id: "fix-2", kind: "fix", status: "done", endedAt: end, rerun: { name: "review.fix", input: {} } }),
    ];
    net.routes["jobs.show"] = (i) => ({ job: server.find((j) => j.id === i.id), events: ran(String(i.id)) });
    const head = async () =>
      (await within(await panel("Claude fix")).findByRole("button", { name: /What Claude did/ })).parentElement;
    drawer("fix-1");
    await waitFor(async () => expect(await head()).toHaveTextContent("opus · high · 0:04 · 18k tokens in · 640 out"));
    cleanup();
    drawer("fix-2");
    await waitFor(async () =>
      expect(await head()).toHaveTextContent("sonnet · medium · 0:04 · 18k tokens in · 640 out"),
    );
  });

  it("marks each changed file as added, modified or deleted, and opens one on its screen", async () => {
    server = [job({ id: "g1", status: "done", endedAt: end })];
    net.routes["jobs.show"] = () => ({
      job: server[0],
      events: [
        {
          jobId: "g1",
          at: "",
          type: "changed",
          paths: ["tests/local-1/test.md", "tests/local-2/test.md", "tests/local-3/test.md"],
          added: ["tests/local-2/test.md"],
          removed: ["tests/local-3/test.md"],
        },
      ],
    });
    setProject("C:\\p");
    net.routes["tests.list"] = () => [
      { id: "local-1", summary: "Un" },
      { id: "local-2", summary: "Deux" },
    ];
    const { onGo, onClose } = drawer("g1");
    const side = await panel("Generate tests");
    const files = await within(side).findByRole("region", { name: "Files changed · 3" });
    await within(files).findAllByText(/^Deux/);
    const rows = within(files).getAllByRole("listitem");
    expect(rows.map((li) => [iconsIn(li), li.textContent])).toEqual([
      [["file", "arrow-right"], "Un › test.mdmodifiedOpen « Un » in Tests"],
      [["plus", "arrow-right"], "Deux › test.mdaddedOpen « Deux » in Tests"],
      [["trash"], "Untitled test › test.mddeleted"],
    ]);
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Open « Deux » in Tests" }));
    expect(onClose).toHaveBeenCalled();
    expect(onGo).toHaveBeenCalledWith("tests", "local-2");
    expect(iconsIn(within(side).getByRole("button", { name: "Show the full log" }))).toEqual(["chevron-right"]);
  });

  it("folds the log, cut by step, the failed step's line in red", async () => {
    server = [
      job({
        id: "x1",
        kind: "rag-index",
        status: "failed",
        endedAt: end,
        error: "out of memory",
        steps: [
          { id: "cut", label: "Cut the documents", status: "done" },
          { id: "embed", label: "Embed the passages", status: "failed" },
        ],
      }),
    ];
    net.routes["jobs.show"] = (i) => ({
      job: server[0],
      events: [
        { jobId: i.id, at: "2026-11-02T10:00:01Z", type: "log", level: "info", message: "Chunking", step: "cut" },
        { jobId: i.id, at: "2026-11-02T10:00:02Z", type: "log", level: "error", message: "No memory", step: "embed" },
      ],
    });
    drawer("x1");
    const side = await panel("Index documents");
    fireEvent.click(await within(side).findByRole("button", { name: "Show the full log" }));
    const log = await within(side).findByRole("log", { name: "Live log" });
    const lines = [...log.querySelectorAll("[data-level]")].map((l) => [l.getAttribute("data-level"), l.textContent]);
    expect(lines).toEqual([
      ["info", "1 · Cut the documents"],
      ["info", expect.stringMatching(/^\d\d:00:01Chunking$/)],
      ["error", "2 · Embed the passages"],
      ["error", expect.stringMatching(/^\d\d:00:02No memory$/)],
    ]);
  });

  it("says when a job is gone, and closes", async () => {
    net.routes["jobs.show"] = () => {
      throw new Fail("No job old-1.");
    };
    const { onClose } = drawer("old-1");
    const side = await panel("Job");
    expect(await within(side).findByText("This job is gone")).toBeInTheDocument();
    fireEvent.click(within(side).getByRole("button", { name: /Close/ }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the words and icons of a job", () => {
  it("draws each job state", () => {
    render(
      <>
        <JobState job={job({ status: "running" })} now={Date.parse("2026-11-02T10:00:03Z")} />
        <JobState job={job({ status: "cancelled" })} now={0} />
        <JobState job={job({ status: "running" })} now={Date.parse("2026-11-02T10:00:03Z")} timed={false} />
      </>,
    );
    expect(screen.getByText(/Running · 0:03/)).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("names a kind in words and gives it the design's icon", () => {
    expect(kindLabel("media.keep")).toBe("Key frame");
    expect(kindLabel("media.propose")).toBe("Transcript corrections");
    expect(kindLabel("analyze")).toBe("Analyze the test");
    expect(kindLabel("mystery")).toBe("mystery");
    for (const kind of ["media.keep", "media.propose", "media.lighten", "docs.convert", "describe-figures"])
      expect(kindIcon(kind), kind).toBe("documents");
    expect(kindIcon("check")).toBe("check-circle");
    expect(kindIcon("models-pull")).toBe("drive");
    expect(kindIcon("models-measure")).toBe("cpu");
    expect(kindIcon("pull")).toBe("download");
    expect(kindIcon("analyze")).toBe("claude");
    expect(kindIcon("mystery")).toBe("jobs");
  });
});
