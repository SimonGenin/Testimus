// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobEvent } from "../../../../src/core/types.ts";
import { JobDrawer } from "../../../../src/ui/components/jobs/JobDrawer.tsx";
import { groupLine } from "../../../../src/ui/components/shell/ActivityGroup.tsx";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { applyJobEvent } from "../../../../src/ui/lib/data/events.ts";
import { quietLine, quietOf } from "../../../../src/ui/lib/jobs.ts";
import { callsOf, fakeEvents, fakeNet, job, net, withApp } from "../../helpers/ui-data.tsx";

vi.mock("../../../../src/ui/lib/toast.ts", () => ({ toast: vi.fn(), errorToast: vi.fn() }));

const end = "2026-11-02T10:01:00Z";
let server: Job[] = [];

beforeEach(() => {
  fakeNet();
  fakeEvents();
  server = [];
  net.routes["jobs.list"] = () => server;
  net.routes["jobs.show"] = (i) => ({ job: server.find((j) => j.id === i.id) ?? null, events: [] });
});

afterEach(() => {
  cleanup();
  setProject(null);
});

const drawer = (id: string) => withApp(<JobDrawer id={id} onClose={vi.fn()} onGo={vi.fn()} />);
const panel = (name: string | RegExp) => screen.findByRole("dialog", { name });
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

describe("a job's events on the page", () => {
  it("applies one step that moved, adds one not declared, and moves the last sign at most every 15 s", () => {
    const a = job({
      id: "j1",
      lastEventAt: "2026-11-02T10:00:00.000Z",
      steps: [
        { id: "a", label: "A", status: "running" },
        { id: "b", label: "B", status: "waiting" },
      ],
    });
    const moved = applyJobEvent([a], {
      jobId: "j1",
      at: "2026-11-02T10:00:05.000Z",
      type: "step",
      step: { id: "a", label: "A", status: "done" },
    })[0];
    expect(moved.steps?.map((s) => s.status)).toEqual(["done", "waiting"]);
    expect(moved.lastEventAt).toBe("2026-11-02T10:00:00.000Z");
    const added = applyJobEvent([moved], {
      jobId: "j1",
      at: "2026-11-02T10:00:20.000Z",
      type: "step",
      step: { id: "c", label: "C", status: "running" },
    })[0];
    expect(added.steps?.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(added.lastEventAt).toBe("2026-11-02T10:00:20.000Z");
    const same = [added];
    expect(
      applyJobEvent(same, {
        jobId: "j1",
        at: "2026-11-02T10:00:21.000Z",
        type: "claude",
        event: { type: "text", text: "x" },
      }),
    ).toBe(same);
    expect(
      applyJobEvent(same, { jobId: "j1", at: "2026-11-02T10:01:00.000Z", type: "log", level: "info", message: "m" })[0]
        .lastEventAt,
    ).toBe("2026-11-02T10:01:00.000Z");
    expect(applyJobEvent(same, { jobId: "zz", at: "", type: "log", level: "info", message: "m" })).toBe(same);
  });

  it("says a silent job's last sign past 2 min, and stuck past 10 min with no program running nor a queue", () => {
    const now = Date.parse("2026-11-02T11:00:00Z");
    const at = (min: number) => new Date(now - min * 60_000).toISOString();
    expect(quietOf(job({ lastEventAt: at(1) }), now)).toBeNull();
    expect(quietOf(job({ status: "done", lastEventAt: at(30) }), now)).toBeNull();
    expect(quietOf(job({}), now)).toBeNull();
    const q = quietOf(job({ lastEventAt: at(3) }), now);
    expect(q).toEqual({ minutes: 3, stuck: false });
    expect(quietLine(q as { minutes: number; stuck: boolean })).toBe("Last sign 3 min ago");
    expect(quietOf(job({ lastEventAt: at(12) }), now)).toEqual({ minutes: 12, stuck: true });
    expect(quietLine({ minutes: 12, stuck: true })).toBe("May be stuck · last sign 12 min ago");
    const busy = job({
      lastEventAt: at(12),
      processes: [{ id: "p1", label: "ffmpeg", command: "ffmpeg", startedAt: at(20) }],
    });
    expect(quietOf(busy, now)?.stuck).toBe(false);
    expect(quietOf(job({ lastEventAt: at(12), message: "Waiting to convert (5 at a time)" }), now)).toBeNull();
    expect(
      quietOf(job({ lastEventAt: at(12), steps: [{ id: "queue", label: "Wait", status: "running" }] }), now),
    ).toBeNull();
    expect(quietOf(job({ lastEventAt: at(3), stuck: true }), now)?.stuck).toBe(true);
  });

  it("counts the jobs of a batch by where they are", () => {
    const kid = (o: Partial<Job>) => job({ kind: "docs.convert", parentId: "add", ...o });
    expect(
      groupLine([
        kid({ id: "1", status: "done" }),
        kid({ id: "2" }),
        kid({ id: "3", message: "Waiting to convert (5 at a time)" }),
        kid({ id: "4", status: "failed" }),
      ]),
    ).toBe("4 conversions: 2 done, 1 running, 1 queued");
    expect(groupLine([job({ id: "x", kind: "odd" }), job({ id: "y", kind: "other" })])).toBe("2 jobs: 2 running");
  });
});

describe("the job panel at scale", () => {
  it("says the last sign of a quiet job, and a stuck one with Cancel in evidence", async () => {
    server = [job({ id: "q1", kind: "pull", subject: "LFRPS12", lastEventAt: ago(3) })];
    drawer("q1");
    const side = await panel("Pull from Jira");
    expect(await within(side).findByText("Last sign 3 min ago")).toBeInTheDocument();
    expect(within(side).queryByText("This job may be stuck")).toBeNull();
    cleanup();
    server = [job({ id: "q2", kind: "pull", subject: "LFRPS12", lastEventAt: ago(11) })];
    drawer("q2");
    const stuck = await panel("Pull from Jira");
    expect(await within(stuck).findByText("This job may be stuck")).toBeInTheDocument();
    expect(within(stuck).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("reads a finished job's runs from their folders only when What Claude did is opened", async () => {
    server = [
      job({
        id: "g1",
        status: "done",
        endedAt: end,
        processes: [
          {
            id: "p1",
            label: "Claude · generate",
            command: "claude -p",
            startedAt: end,
            endedAt: end,
            exit: 0,
            run: { id: "run-1", model: "opus" },
          },
        ],
      }),
    ];
    const said: JobEvent[] = [
      { jobId: "g1", at: end, type: "claude", event: { type: "tool", name: "Read", input: "{}" }, process: "p1" },
      {
        jobId: "g1",
        at: end,
        type: "claude",
        event: { type: "result", ok: true, text: "Wrote it", durationMs: 4000 },
        process: "p1",
      },
    ];
    net.routes["jobs.activity"] = () => ({ events: said });
    drawer("g1");
    const side = await panel("Generate tests");
    const fold = await within(side).findByRole("button", { name: /What Claude did/ });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(callsOf("jobs.activity")).toHaveLength(0);
    fireEvent.click(fold);
    await waitFor(() => expect(callsOf("jobs.activity")).toHaveLength(1));
    await waitFor(() => expect(fold.parentElement).toHaveTextContent("0:04"));
  });

  it("past 50 files shows the folders with their counts, each opening on its files; a log that kept only folders too", async () => {
    const paths = Array.from({ length: 60 }, (_, i) => `docs/D${i % 3}/f${i}.md`);
    server = [job({ id: "c1", kind: "docs.add", status: "done", endedAt: end })];
    net.routes["jobs.show"] = () => ({
      job: server[0],
      events: [
        { jobId: "c1", at: "", type: "changed", paths: [...paths, "project.json"] },
        { jobId: "c1", at: "", type: "changed", paths: [], count: 300, folders: [{ path: "docs/D9", files: 300 }] },
      ],
    });
    drawer("c1");
    const side = await panel("Add document");
    const files = await within(side).findByRole("region", { name: "Files changed · 361" });
    expect(within(files).queryByText("f0.md")).toBeNull();
    const d0 = within(files).getByRole("button", { name: /^D0/ });
    expect(d0.parentElement).toHaveTextContent("20 files");
    fireEvent.click(d0);
    expect(await within(files).findAllByText(/› f\d+\.md/)).toHaveLength(20);
    expect(within(files).getByText("· 300 files").closest("li")).toHaveTextContent("D9");
    expect(within(files).getByRole("button", { name: /project\.json/ })).toBeInTheDocument();
    act(() => {});
  });
});
