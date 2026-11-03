// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../src/core/types.ts";
import { ModelsSection } from "../../src/ui/screens/settings/ModelsSection.tsx";
import { BenchDialog } from "../../src/ui/screens/settings/models/BenchDialog.tsx";
import type { PackRow } from "../../src/ui/screens/settings/models/data.ts";
import { PackCard } from "../../src/ui/screens/settings/models/PackCard.tsx";
import { clearToasts, failing, models, modelsFetch, mount, modelsNamed as named } from "./cov-uiscreens-helpers.tsx";
import { FakeEventSource } from "./ui-desktop-helpers.tsx";

const at = "2026-11-03T10:00:00.000Z";
let jobs: Record<string, Partial<Job>> = {};
let packs: PackRow[] = [];

const pack = (id: string, over: Partial<PackRow> = {}): PackRow => ({
  id,
  label: id[0].toUpperCase() + id.slice(1),
  intent: `${id} intent`,
  active: false,
  available: true,
  variant: 0,
  embedding: "emb-s",
  reranker: null,
  fit: null,
  skipped: [],
  downloadMB: 0,
  quality: "quality not measured yet",
  measuredHere: false,
  ...over,
});

beforeEach(() => {
  modelsFetch();
  jobs = {};
  packs = [pack("light", { active: true }), pack("balanced", { embedding: "emb-b", reranker: "rr", downloadMB: 900 })];
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
  models.routes["models.catalog"] = () => [];
  models.routes["models.list"] = () => [];
  models.routes["models.packs"] = () => packs;
  models.routes["models.advice"] = () => [];
  models.routes["rag.status"] = () => ({ embedding: "emb-s", reranker: null, activation: "light" });
  models.routes["models.usePack"] = () => null;
  models.routes["jobs.list"] = () => [];
  models.routes["jobs.cancel"] = () => ({ cancelled: true });
  let n = 0;
  models.routes["models.measure"] = () => ({ jobId: n++ ? `ev-${n}` : "ev-1" });
  models.routes["jobs.show"] = (i) => ({
    job: {
      id: i.id,
      kind: "models-measure",
      subject: "light",
      startedAt: at,
      status: "running",
      ...jobs[String(i.id)],
    },
  });
});

afterEach(() => {
  for (const id of Object.keys(jobs)) if (jobs[id].status === "running") end(id, "cancelled");
  cleanup();
  clearToasts();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function end(id: string, status: Job["status"], over: Partial<Job> = {}) {
  jobs[id] = { status, ...over };
  act(() =>
    FakeEventSource.last?.emit({
      jobId: id,
      at,
      type: "status",
      job: { id, kind: "models-measure", subject: "light", startedAt: at, status, ...over },
    }),
  );
}

const progress = (id: string, done: number, total: number) =>
  act(() => FakeEventSource.last?.emit({ jobId: id, at, type: "progress", message: `Behavior ${done}`, done, total }));

const card = (name: string) => screen.getByRole("article", { name: `${name} pack` });
const dialog = () => screen.getByRole("dialog", { name: "Measure the Light pack" });

describe("PackCard › Measure", () => {
  const props = { label: (x: string) => x, op: null, busy: false, onUse: vi.fn(), onCancel: vi.fn() };

  it("offers Measure on a pack installed here, Measure again once measured, the progress while it runs", () => {
    const onMeasure = vi.fn();
    const { rerender } = render(<PackCard {...props} pack={pack("light")} onMeasure={onMeasure} />);
    fireEvent.click(screen.getByRole("button", { name: "Measure the Light pack" }));
    expect(onMeasure).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Measure the Light pack" })).toHaveTextContent(/^Measure$/);
    rerender(
      <PackCard
        {...props}
        pack={pack("light", { quality: "right article first for 60 % …", measuredHere: true })}
        onMeasure={onMeasure}
      />,
    );
    expect(screen.getByRole("button", { name: "Measure the Light pack" })).toHaveTextContent("Measure again");
    rerender(
      <PackCard
        {...props}
        busy
        pack={pack("light")}
        bench={{ jobId: "j", status: "running", message: "", pct: 40 }}
        onMeasure={onMeasure}
      />,
    );
    const running = screen.getByRole("button", { name: "Measuring the Light pack" });
    expect(running).toHaveTextContent("Measuring · 40 %");
    expect(running).toBeEnabled();
    rerender(
      <PackCard
        {...props}
        pack={pack("light")}
        bench={{ jobId: "", status: "running", message: "", pct: null }}
        onMeasure={onMeasure}
      />,
    );
    expect(screen.getByRole("button", { name: "Measuring the Light pack" })).toHaveTextContent("Measuring…");
  });

  it("is disabled until the pack's models are here, and while another model job runs", () => {
    const { rerender } = render(<PackCard {...props} pack={pack("light", { downloadMB: 300 })} onMeasure={vi.fn()} />);
    const b = screen.getByRole("button", { name: "Measure the Light pack" });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("title", "Install the pack's models first (Use this pack)");
    rerender(<PackCard {...props} pack={pack("light", { available: false })} onMeasure={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Measure the Light pack" })).toBeDisabled();
    rerender(<PackCard {...props} busy pack={pack("light")} onMeasure={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Measure the Light pack" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Measure the Light pack" })).not.toHaveAttribute("title");
  });
});

describe("BenchDialog", () => {
  it("before the job is known: Cancel waits for its id", () => {
    render(
      <BenchDialog
        pack={pack("balanced", { reranker: "rr" })}
        bench={undefined}
        label={(x) => `L ${x}`}
        onCancel={vi.fn()}
        onAgain={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("L emb-s + L rr");
    expect(screen.getByRole("status", { name: "Measuring" })).toHaveTextContent("Starting");
    expect(screen.getByRole("button", { name: "Cancel the measure" })).toBeDisabled();
  });
});

describe("Settings › Models › measuring a pack", () => {
  it("starts models.measure on the pack, follows it, keeps it running when closed, reopens it, cancels it", async () => {
    mount(<ModelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Measure the Light pack" }));
    await waitFor(() => expect(named("models.measure")).toHaveLength(1));
    expect(named("models.measure")[0].input).toEqual({ pack: "light" });
    expect(dialog()).toHaveTextContent("Syntec collective agreement");
    expect(dialog()).toHaveTextContent("Your project's documents are not used");
    expect(within(dialog()).getByText("no reranker")).toBeInTheDocument();
    expect(within(dialog()).getByText("Closing this window does not stop the measure.")).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    progress("ev-1", 2, 4);
    expect(await within(dialog()).findByText("Measuring · 50 %")).toBeInTheDocument();
    expect(within(dialog()).getByText("Behavior 2")).toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(card("Light")).getByRole("button", { name: "Measuring the Light pack" })).toHaveTextContent(
      "Measuring · 50 %",
    );
    expect(named("jobs.cancel")).toHaveLength(0);

    fireEvent.click(within(card("Light")).getByRole("button", { name: "Measuring the Light pack" }));
    expect(dialog()).toBeInTheDocument();
    expect(named("models.measure")).toHaveLength(1);

    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel the measure" }));
    await waitFor(() => expect(named("jobs.cancel")).toHaveLength(1));
    expect(named("jobs.cancel")[0].input).toEqual({ id: "ev-1" });
    end("ev-1", "cancelled");
    expect(await within(dialog()).findByText("The measure was cancelled; no result was written.")).toBeInTheDocument();
    expect(screen.queryByText(/the measure stopped/)).toBeNull();
  });

  it("when done: the pack card and the dialog show the new speed and quality from models.packs", async () => {
    mount(<ModelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Measure the Light pack" }));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    const before = named("models.packs").length;
    packs = [
      pack("light", {
        active: true,
        speed: "on this PC: query 68 ms",
        quality:
          "right article first for 60 % of the 100 reference questions, in the top 5 for 91 % (measured by this PC)",
        measuredHere: true,
      }),
      packs[1],
    ];
    end("ev-1", "done", { result: {} });
    expect(await within(dialog()).findByText("Measured")).toBeInTheDocument();
    await waitFor(() => expect(named("models.packs").length).toBeGreaterThan(before));
    expect(await within(dialog()).findByText("on this PC: query 68 ms")).toBeInTheDocument();
    expect(within(card("Light")).getByText(/right article first for 60 %/)).toBeInTheDocument();
    expect(screen.queryByText("Light pack measured")).toBeNull();

    fireEvent.click(within(dialog()).getByRole("button", { name: "Measure again" }));
    await waitFor(() => expect(named("models.measure")).toHaveLength(2));
    expect(within(dialog()).getByRole("status", { name: "Measuring" })).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    end("ev-2", "done", { result: {} });
    expect(await screen.findByText("Light pack measured")).toBeInTheDocument();
    expect(within(card("Light")).getByRole("button", { name: "Measure the Light pack" })).toHaveTextContent(
      "Measure again",
    );
  });

  it("a refused start and a failed job: the reason, Measure again; a job failing while closed is toasted", async () => {
    models.routes["models.measure"] = () => failing("emb-s is not installed on this PC.", "Install it first.");
    mount(<ModelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Measure the Light pack" }));
    expect(await within(dialog()).findByText("The measure stopped")).toBeInTheDocument();
    expect(within(dialog()).getByText(/emb-s is not installed on this PC\./)).toBeInTheDocument();
    models.routes["models.measure"] = () => ({ jobId: "ev-2" });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Measure again" }));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    end("ev-2", "failed", { error: "disk full" });
    expect(await screen.findByText("Light pack: the measure stopped")).toBeInTheDocument();
  });

  it("picks up a measure already running when the screen opens", async () => {
    models.routes["jobs.list"] = () => [
      { id: "ev-9", kind: "models-measure", subject: "light", startedAt: at, status: "running" },
      { id: "ev-0", kind: "rag-eval", subject: "eval", startedAt: at, status: "running" },
    ];
    jobs["ev-9"] = { status: "running" };
    mount(<ModelsSection />);
    const b = await within(await screen.findByRole("article", { name: "Light pack" })).findByRole("button", {
      name: "Measuring the Light pack",
    });
    fireEvent.click(b);
    expect(dialog()).toBeInTheDocument();
    expect(named("models.measure")).toHaveLength(0);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    end("ev-9", "done");
    expect(await screen.findByText("Light pack measured")).toBeInTheDocument();
    expect(within(card("Balanced")).getByRole("button", { name: "Measure the Balanced pack" })).toBeDisabled();
  });
});
