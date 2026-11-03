// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fit, Job } from "../../src/core/types.ts";
import { ModelsSection } from "../../src/ui/screens/settings/ModelsSection.tsx";
import type { CatalogRow, Installed, PackRow } from "../../src/ui/screens/settings/models/data.ts";
import { clearToasts, failing, models, modelsFetch, mount, modelsNamed as named } from "./cov-uiscreens-helpers.tsx";
import { FakeEventSource } from "./ui-desktop-helpers.tsx";

vi.mock("../../src/ui/screens/settings/models/FolderDialog.tsx", () => ({
  FolderDialog: ({
    current,
    needMB,
    onApplied,
    onClose,
  }: {
    current: string | null;
    needMB: number;
    onApplied: (dir: string, jobId: string | null, action: string) => void;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="Folder stub">
      <span>
        folder {current ?? "none"} need {needMB}
      </span>
      <button type="button" onClick={() => onApplied("D:\\models", null, "set")}>
        Apply folder
      </button>
      <button type="button" onClick={() => onApplied("E:\\models", "mv-1", "move")}>
        Apply with move
      </button>
      <button type="button" onClick={() => onApplied("E:\\models", "cp-1", "copy")}>
        Apply with copy
      </button>
      <button type="button" onClick={onClose}>
        Close folder
      </button>
    </div>
  ),
}));

const at = "2026-11-02T10:00:00.000Z";
let jobs: Record<string, Partial<Job>> = {};

beforeEach(() => {
  modelsFetch();
  jobs = {};
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  Element.prototype.scrollIntoView = vi.fn();
  models.routes["jobs.show"] = (i) => ({
    job: { id: i.id, kind: "x", subject: "", startedAt: at, status: "running", ...jobs[String(i.id)] },
  });
});

afterEach(() => {
  for (const id of Object.keys(jobs)) end(id, "cancelled");
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
      job: { id, kind: "x", subject: "", startedAt: at, status, ...over },
    }),
  );
}

const progress = (id: string, done?: number, total?: number) =>
  act(() => FakeEventSource.last?.emit({ jobId: id, at, type: "progress", message: `step ${done}`, done, total }));

const fitOf = (verdict: Fit["verdict"], message: string = verdict): Fit => ({
  verdict,
  device: "gpu",
  needMB: { vram: 0, ram: 0 },
  freeMB: { vram: null, ram: 0 },
  totalMB: { vram: null, ram: 0 },
  unload: [],
  message,
});

const pack = (id: string, over: Partial<PackRow> = {}): PackRow => ({
  id,
  label: id[0].toUpperCase() + id.slice(1),
  intent: `${id} intent`,
  active: false,
  available: true,
  variant: 0,
  embedding: "emb-s",
  reranker: null,
  fit: fitOf("fits"),
  skipped: [],
  downloadMB: 0,
  quality: "q",
  ...over,
});

const model = (id: string, over: Partial<CatalogRow> = {}): CatalogRow => ({
  id,
  kind: "embedding",
  label: `M ${id}`,
  tier: "t",
  runtimes: ["transformers"],
  quantization: "q8",
  dims: 1024,
  sizeMB: 500,
  state: "available",
  fit: fitOf("fits"),
  ...over,
});

const inst = (id: string, over: Partial<Installed> = {}): Installed => ({
  model: id,
  label: id,
  via: "download",
  runtime: "transformers",
  where: `D:\\models\\${id}`,
  sizeMB: 500,
  state: "installed",
  usedBy: [],
  ...over,
});

type Base = {
  packs?: PackRow[] | null;
  catalog?: CatalogRow[] | null;
  installed?: Installed[] | null;
  advice?: unknown[] | null;
  status?: Record<string, unknown> | null;
  dir?: string | null;
  running?: Partial<Job>[] | null;
};

function base(b: Base = {}) {
  models.routes["models.catalog"] = () =>
    b.catalog === undefined ? [model("emb-s", { state: "installed" })] : b.catalog;
  models.routes["models.list"] = () => (b.installed === undefined ? [] : b.installed);
  models.routes["models.packs"] = () => (b.packs === undefined ? [pack("light", { active: true })] : b.packs);
  models.routes["models.advice"] = () => (b.advice === undefined ? [] : b.advice);
  models.routes["rag.status"] = () =>
    b.status === undefined ? { embedding: "emb-s", reranker: null, activation: "light" } : b.status;
  models.routes["models.usePack"] = (i) =>
    i.dryRun
      ? {
          pack: i.pack,
          variant: 0,
          embedding: "emb-s",
          reranker: null,
          plan: { download: [], dir: b.dir === undefined ? "D:\\m" : b.dir, reindex: true, expected: "fast" },
          jobIds: [],
          dryRun: true,
        }
      : null;
  models.routes["jobs.list"] = () => (b.running === undefined ? [] : b.running);
}

const openTable = () => fireEvent.click(screen.getByRole("button", { name: "Model catalog" }));

describe("Settings › Models section", () => {
  it("without a project: the shared models only, no folder", async () => {
    base();
    mount(<ModelsSection />, { info: null });
    expect(screen.getByText(/Open a project to choose its search pack/)).toBeInTheDocument();
    expect(screen.getByText("see a project")).toBeInTheDocument();
    expect(await screen.findByText("1 in the catalog · 0 on this PC")).toBeInTheDocument();
    expect(named("models.packs")).toHaveLength(0);
    expect(named("jobs.list")).toHaveLength(0);
  });

  it("empty answers everywhere, a folder not chosen yet, and the catalog loading", async () => {
    base({ catalog: null, installed: null, packs: null, advice: null, status: null, dir: null, running: null });
    models.routes["models.usePack"] = () => null;
    mount(<ModelsSection />);
    expect(screen.getByRole("status", { name: "Loading the packs" })).toBeInTheDocument();
    expect(await screen.findByText("not chosen yet")).toBeInTheDocument();
    expect(screen.getByText("0 in the catalog · 0 on this PC")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Custom pack" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose…" })).toBeInTheDocument();
  });

  it("shows the catalog skeleton while it loads, and an error with Try again", async () => {
    base();
    delete models.routes["models.catalog"];
    mount(<ModelsSection />);
    expect(screen.getByText("Loading the catalog")).toBeInTheDocument();
    openTable();
    expect(screen.getByRole("button", { name: "Model catalog" })).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("The models could not be read")).toBeInTheDocument();
    expect(screen.getByText("Unknown command models.catalog")).toBeInTheDocument();
    base();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("The models could not be read")).toBeNull());
    openTable();
    expect(screen.getByRole("button", { name: "Model catalog" })).toHaveAttribute("aria-expanded", "false");
  });

  it("follows the jobs already running: install, download, move, copy, index — with progress and failures", async () => {
    base({
      packs: [pack("balanced"), pack("light", { active: true })],
      catalog: [model("emb-s"), model("big")],
      running: [
        { id: "up-1", kind: "models-usePack", subject: "balanced" },
        { id: "pull-1", kind: "models-pull", subject: "big" },
        { id: "mv-1", kind: "models-move", subject: "" },
        { id: "ix-1", kind: "rag-index", subject: "" },
        { id: "other", kind: "check", subject: "" },
      ],
    });
    mount(<ModelsSection />);
    expect(await screen.findByRole("status", { name: "Installing Balanced" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Moving the models" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Indexing the documents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change…" })).toBeDisabled();
    openTable();
    expect(screen.getByRole("status", { name: "Downloading big" })).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    progress("up-1", 1, 4);
    expect(await screen.findByText("Installing Balanced · 25 %")).toBeInTheDocument();
    progress("up-1");
    await waitFor(() => expect(screen.getByText("Installing Balanced")).toBeInTheDocument());
    end("mv-1", "failed", { error: "disk full" });
    expect(await screen.findByText("Moving the models: stopped")).toBeInTheDocument();
    end("ix-1", "done");
    end("up-1", "done", { result: { indexJob: "ix-2" } });
    expect(await screen.findByRole("status", { name: "Indexing the documents" })).toBeInTheDocument();
    end("ix-2", "done");
    end("pull-1", "done", { result: null });
    await waitFor(() => expect(screen.queryByRole("status", { name: /Installing|Downloading|Indexing/ })).toBeNull());
  });

  it("a copy job, a usePack job without an index, and cancelling a job", async () => {
    base({
      running: [
        { id: "cp-1", kind: "models-copy", subject: "" },
        { id: "up-2", kind: "models-usePack", subject: "light" },
      ],
    });
    mount(<ModelsSection />);
    const copy = await screen.findByRole("status", { name: "Copying the models" });
    fireEvent.click(within(copy).getByRole("button", { name: "Cancel: Copying the models" }));
    expect(await screen.findByText("Could not cancel")).toBeInTheDocument();
    models.routes["jobs.cancel"] = () => ({});
    fireEvent.click(within(copy).getByRole("button", { name: "Cancel: Copying the models" }));
    await waitFor(() => expect(named("jobs.cancel")).toHaveLength(2));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    end("up-2", "done", { result: {} });
    end("cp-1", "done");
    await waitFor(() => expect(screen.queryByRole("status", { name: "Copying the models" })).toBeNull());
  });

  it("ignores running jobs that cannot be listed", async () => {
    base();
    delete models.routes["jobs.list"];
    mount(<ModelsSection />);
    expect(await screen.findByText("D:\\m")).toBeInTheDocument();
  });

  it("uses a pack that fits: plan, cancel, confirm, then follows its jobs", async () => {
    base({ packs: [pack("balanced", { reranker: "rr" }), pack("light", { active: true })] });
    models.routes["models.usePack"] = (i) => ({
      pack: i.pack,
      variant: 0,
      embedding: "emb-s",
      reranker: "rr",
      plan: { download: [], dir: "D:\\m", reindex: true, expected: "fast" },
      jobIds: i.dryRun ? [] : ["rag-index-9", "up-9"],
      dryRun: !!i.dryRun,
    });
    mount(<ModelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Use the Balanced pack" }));
    const dlg = await screen.findByRole("dialog", { name: "Use the Balanced pack" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Use the Balanced pack" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use the Balanced pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Balanced" }));
    expect(await screen.findByText("Balanced pack chosen for this project")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Indexing the documents" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Installing Balanced" })).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    end("up-9", "done", { result: { indexJob: null } });
    end("rag-index-9", "done");
  });

  it("a pack with downloads is only downloaded; another pack stays choosable meanwhile", async () => {
    base({ packs: [pack("balanced", { downloadMB: 300 }), pack("light")] });
    models.routes["models.usePack"] = (i) => ({
      pack: i.pack,
      variant: 0,
      embedding: "emb-s",
      reranker: null,
      plan: {
        download: i.pack === "balanced" ? [{ model: "emb-s", sizeMB: 300 }] : [],
        dir: "D:\\m",
        reindex: true,
        expected: "",
      },
      jobIds: i.dryRun ? [] : ["dl-1"],
      dryRun: !!i.dryRun,
    });
    mount(<ModelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Use the Balanced pack" }));
    const dlg = await screen.findByRole("dialog", { name: "Download the Balanced pack" });
    expect(within(dlg).getByText(/Once used, the documents are indexed again/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Download 300 MB" }));
    expect(await screen.findByRole("status", { name: "Downloading Balanced" })).toBeInTheDocument();
    expect(named("models.usePack").at(-1)?.input).toEqual({ pack: "balanced", downloadOnly: true });
    expect(screen.queryByText("Balanced pack chosen for this project")).toBeNull();
    expect(screen.getByRole("button", { name: "Use the Light pack" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Use the Light pack" }));
    expect(await screen.findByRole("dialog", { name: "Use the Light pack" })).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    end("dl-1", "done", { result: { indexJob: null } });
    expect(await screen.findByText("Balanced pack downloaded")).toBeInTheDocument();
  });

  it("a plan that needs a folder asks for one, then plans again; Change… in the plan too", async () => {
    let dir: string | null = null;
    base({ packs: [pack("balanced")], dir: null });
    models.routes["models.usePack"] = (i) => ({
      pack: i.pack,
      variant: 0,
      embedding: "emb-s",
      reranker: null,
      plan: {
        download: [
          { model: "a", sizeMB: 100 },
          { model: "b", sizeMB: 200 },
        ],
        dir,
        reindex: false,
        expected: "",
      },
      jobIds: [],
      dryRun: true,
    });
    mount(<ModelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Use the Balanced pack" }));
    expect(await screen.findByText("folder none need 300")).toBeInTheDocument();
    dir = "D:\\models";
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    expect(await screen.findByText("Models folder saved")).toBeInTheDocument();
    const dlg = await screen.findByRole("dialog", { name: "Download the Balanced pack" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Change…" }));
    expect(await screen.findByText("folder D:\\models need 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    expect(await screen.findByRole("dialog", { name: "Download the Balanced pack" })).toBeInTheDocument();
  });

  it("a confirm refused for want of a folder asks for one; other refusals are reported", async () => {
    base({ packs: [pack("balanced")] });
    let refusal = "Choose where models are stored first.";
    models.routes["models.usePack"] = (i) =>
      i.dryRun
        ? {
            pack: i.pack,
            variant: 0,
            embedding: "emb-s",
            reranker: null,
            plan: { download: [{ model: "a", sizeMB: 50 }], dir: "D:\\m", reindex: true, expected: "" },
            jobIds: [],
            dryRun: true,
          }
        : failing(refusal);
    mount(<ModelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Use the Balanced pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download 50 MB" }));
    expect(await screen.findByText("folder D:\\m need 50")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Download the Balanced pack" })).getByRole("button", {
        name: "Cancel",
      }),
    );
    refusal = "Disk full";
    fireEvent.click(screen.getByRole("button", { name: "Use the Balanced pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download 50 MB" }));
    expect(await screen.findByText("Could not download the Balanced pack")).toBeInTheDocument();
  });

  it("a plan that cannot be made is reported", async () => {
    base({ packs: [pack("balanced")] });
    mount(<ModelsSection />);
    await screen.findByRole("button", { name: "Use the Balanced pack" });
    models.routes["models.usePack"] = () => failing("no");
    fireEvent.click(screen.getByRole("button", { name: "Use the Balanced pack" }));
    expect(await screen.findByText("Could not plan the Balanced pack")).toBeInTheDocument();
  });

  it("a pack that does not fit asks first: cancel, lighter, use anyway; no lighter at the bottom", async () => {
    base({
      packs: [
        pack("balanced", { fit: fitOf("tight", "Tight fit") }),
        pack("light", { fit: fitOf("unknown", "Unknown GPU") }),
      ],
    });
    mount(<ModelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Use the Balanced pack" }));
    let ask = screen.getByRole("dialog", { name: "Will The Balanced pack fit?" });
    expect(within(ask).getByText("Lighter choice: the Light pack.")).toBeInTheDocument();
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Use the Balanced pack" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a lighter one" }));
    ask = screen.getByRole("dialog", { name: "Will The Light pack fit?" });
    expect(within(ask).getByRole("button", { name: "Choose a lighter one" })).toBeDisabled();
    fireEvent.click(within(ask).getByRole("button", { name: "Use anyway" }));
    expect(await screen.findByRole("dialog", { name: "Use the Light pack" })).toBeInTheDocument();
  });

  it("installs a model: asks for a folder first when none is chosen, then follows the download", async () => {
    base({ catalog: [model("big", { sizeMB: 900 })], dir: null });
    models.routes["models.pull"] = () => ({ jobId: "pull-7" });
    mount(<ModelsSection />);
    await screen.findByText("not chosen yet");
    openTable();
    fireEvent.click(screen.getByRole("button", { name: "Install M big" }));
    expect(screen.getByText("folder none need 900")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply with move" }));
    expect(await screen.findByRole("status", { name: "Downloading M big" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Moving the models" })).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    end("pull-7", "done");
    end("mv-1", "done");
  });

  it("an install without a job, refused for want of a folder, or refused outright", async () => {
    base({ catalog: [model("big")] });
    let answer: unknown = {};
    models.routes["models.pull"] = () => answer;
    mount(<ModelsSection />);
    await screen.findByText("D:\\m");
    openTable();
    fireEvent.click(screen.getByRole("button", { name: "Install M big" }));
    await waitFor(() => expect(named("models.pull")).toHaveLength(1));
    answer = failing("Choose where models are stored");
    fireEvent.click(screen.getByRole("button", { name: "Install M big" }));
    expect(await screen.findByText("folder D:\\m need 500")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply with copy" }));
    await waitFor(() => expect(named("models.pull")).toHaveLength(3));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    end("cp-1", "done");
    answer = failing("offline");
    fireEvent.click(await screen.findByRole("button", { name: "Install M big" }));
    expect(await screen.findByText("Could not install M big")).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    end("cp-1", "done");
  });

  it("uses a model that fits and reindexes, a reranker keeps the embedding", async () => {
    base({
      catalog: [
        model("emb-s", { state: "active" }),
        model("emb-b", { state: "installed" }),
        model("rr", { kind: "reranker", state: "installed" }),
      ],
      status: { embedding: "emb-s", reranker: "old-rr", activation: "machine" },
      packs: [pack("light")],
    });
    models.routes["models.fit"] = () => fitOf("fits");
    models.routes["models.use"] = () => ({ reindex: true });
    models.routes["jobs.list"] = (i) => (i.running ? [{ id: "ix-5", kind: "rag-index" }] : []);
    mount(<ModelsSection />);
    expect((await screen.findAllByText(/M emb-s/, { selector: ".pack-models" })).length).toBeGreaterThan(0);
    openTable();
    expect(screen.getByRole("button", { name: "Use M emb-s for this project" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use M rr for this project" }));
    expect(await screen.findByText("M rr in use for this project")).toBeInTheDocument();
    expect(named("models.fit")[0].input).toEqual({ embedding: "emb-s", reranker: "rr" });
    expect(named("models.use")[0].input).toEqual({ embedding: "emb-s", reranker: "rr" });
    expect(await screen.findAllByRole("status", { name: "Indexing the documents" })).not.toHaveLength(0);
    models.routes["models.use"] = () => ({ reindex: false });
    fireEvent.click(screen.getByRole("button", { name: "Use M emb-b for this project" }));
    await waitFor(() => expect(named("models.use")[1]?.input).toEqual({ embedding: "emb-b", reranker: "old-rr" }));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    end("ix-5", "done");
  });

  it("a reranker without an embedding is refused; a failing fit or use is reported", async () => {
    base({
      catalog: [model("rr", { kind: "reranker", state: "installed" }), model("emb-b", { state: "installed" })],
      status: { embedding: "none", reranker: null, activation: "none" },
    });
    mount(<ModelsSection />);
    await screen.findByText("1 in the catalog · 0 on this PC".replace("1", "2"));
    openTable();
    fireEvent.click(screen.getByRole("button", { name: "Use M rr for this project" }));
    expect(await screen.findByText("Choose an embedding model first")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use M emb-b for this project" }));
    expect(await screen.findByText("Could not check whether M emb-b fits")).toBeInTheDocument();
    models.routes["models.fit"] = () => fitOf("fits");
    fireEvent.click(screen.getByRole("button", { name: "Use M emb-b for this project" }));
    expect(await screen.findByText("Could not use M emb-b")).toBeInTheDocument();
    expect(named("models.fit").at(-1)?.input).toEqual({ embedding: "emb-b" });
  });

  it("a model that does not fit offers the lighter one: installed is used, missing is installed", async () => {
    base({
      catalog: [
        model("huge", { state: "installed", sizeMB: 9000 }),
        model("mid", { state: "installed", sizeMB: 3000 }),
        model("small", { state: "available", sizeMB: 1000 }),
        model("tiny-bad", { state: "installed", sizeMB: 10, fit: fitOf("tight") }),
        model("rr", { kind: "reranker", state: "installed", sizeMB: 1 }),
      ],
      status: null,
    });
    models.routes["models.fit"] = (i) =>
      i.embedding === "small" ? fitOf("fits") : fitOf("gpu-too-small", "Partly on the CPU");
    models.routes["models.use"] = () => ({ reindex: false });
    models.routes["models.pull"] = () => ({});
    mount(<ModelsSection />);
    await screen.findByText(/in the catalog/);
    openTable();
    fireEvent.click(screen.getByRole("button", { name: "Use M huge for this project" }));
    let ask = await screen.findByRole("dialog", { name: "Will M huge fit?" });
    expect(within(ask).getByText("Lighter choice: M mid.")).toBeInTheDocument();
    fireEvent.click(within(ask).getByRole("button", { name: "Choose a lighter one" }));
    ask = await screen.findByRole("dialog", { name: "Will M mid fit?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Choose a lighter one" }));
    await waitFor(() => expect(named("models.pull")[0]?.input).toEqual({ model: "small" }));
    fireEvent.click(screen.getByRole("button", { name: "Use M tiny-bad for this project" }));
    ask = await screen.findByRole("dialog", { name: "Will M tiny-bad fit?" });
    expect(within(ask).getByRole("button", { name: "Choose a lighter one" })).toBeDisabled();
    fireEvent.click(within(ask).getByRole("button", { name: "Use anyway" }));
    expect(await screen.findByText("M tiny-bad in use for this project")).toBeInTheDocument();
  });

  it("verifies a model: works, fails its check, cannot be verified", async () => {
    base({ catalog: [model("emb-s", { state: "installed" })] });
    let v: unknown = { ok: true, dims: 1024, ms: 40, message: "One sentence embedded" };
    models.routes["models.verify"] = () => v;
    mount(<ModelsSection />);
    await screen.findByText(/in the catalog/);
    openTable();
    fireEvent.click(screen.getByRole("button", { name: "Verify M emb-s" }));
    expect(await screen.findByText("M emb-s works")).toBeInTheDocument();
    expect(screen.getByText("One sentence embedded (1024 dimensions, 40 ms)")).toBeInTheDocument();
    v = { ok: false, dims: 0, ms: 1, message: "NaN" };
    fireEvent.click(await screen.findByRole("button", { name: "Verify M emb-s" }));
    expect(await screen.findByText("M emb-s failed its check")).toBeInTheDocument();
    v = failing("broken");
    fireEvent.click(await screen.findByRole("button", { name: "Verify M emb-s" }));
    expect(await screen.findByText("Could not verify M emb-s")).toBeInTheDocument();
  });

  it("removes a downloaded model or forgets a folder one, after a confirmation", async () => {
    base({
      catalog: [model("dl", { state: "installed" }), model("fold", { state: "installed" })],
      installed: [inst("dl", { sizeMB: 2048 }), inst("fold", { via: "path", where: "\\\\share\\fold" })],
    });
    let removed: unknown = { removed: "files", freedMB: 2048 };
    models.routes["models.remove"] = () => removed;
    mount(<ModelsSection />);
    expect(await screen.findByText("2 in the catalog · 2 on this PC")).toBeInTheDocument();
    openTable();
    fireEvent.click(screen.getByRole("button", { name: "Remove M dl" }));
    let dlg = screen.getByRole("dialog", { name: "Remove M dl?" });
    expect(within(dlg).getByText("Its files (2.0 GB) are deleted from D:\\models\\dl.")).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove M dl" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete it" }));
    expect(await screen.findByText("2.0 GB freed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove M fold" }));
    dlg = screen.getByRole("dialog", { name: "Remove M fold?" });
    expect(within(dlg).getByText(/the folder \\\\share\\fold stays on disk/)).toBeInTheDocument();
    removed = { removed: "registration", freedMB: 0 };
    fireEvent.click(within(dlg).getByRole("button", { name: "Forget it" }));
    expect(await screen.findByText("Its folder stays on disk")).toBeInTheDocument();
    removed = failing("locked");
    fireEvent.click(screen.getByRole("button", { name: "Remove M fold" }));
    fireEvent.click(screen.getByRole("button", { name: "Forget it" }));
    expect(await screen.findByText("Could not remove M fold")).toBeInTheDocument();
  });

  it("advice: a pack advice plans the pack, a model advice is applied and reindexes, dismiss", async () => {
    const advice = [
      {
        id: "a1",
        direction: "upgrade",
        from: { pack: "light" },
        to: { pack: "balanced" },
        reason: "More GPU",
        quality: "+5%",
      },
    ];
    base({ packs: [pack("balanced"), pack("light", { active: true })], advice });
    mount(<ModelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("dialog", { name: "Use the Balanced pack" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Advice" })).getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Could not dismiss the advice")).toBeInTheDocument();
    models.routes["models.dismiss"] = () => ({});
    fireEvent.click(within(screen.getByRole("region", { name: "Advice" })).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Advice" })).toBeNull());
  });

  it("advice for a missing pack does nothing; a model advice reindexes or fails", async () => {
    let n = 0;
    base({
      advice: [
        { id: "x", direction: "upgrade", from: { pack: "light" }, to: { pack: "quality" }, reason: "r", quality: "q" },
      ],
    });
    mount(<ModelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
    expect(named("models.usePack").filter((c) => c.input.pack === "quality")).toHaveLength(0);
    cleanup();
    base({
      advice: [
        {
          id: "y",
          direction: "downgrade",
          from: { pack: "light" },
          to: { embedding: "e2", reranker: null },
          reason: "r",
          quality: "q",
        },
      ],
    });
    models.routes["models.use"] = () => {
      n++;
      if (n === 2) throw new Error("nope");
      return { reindex: n === 1 };
    };
    models.routes["jobs.list"] = () => [];
    mount(<ModelsSection />);
    const apply = await screen.findByRole("button", { name: "Apply" });
    delete models.routes["jobs.list"];
    fireEvent.click(apply);
    expect(await screen.findByText("Advice applied")).toBeInTheDocument();
    expect(screen.getByText("Indexing again")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("Could not apply the advice")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(named("models.use")).toHaveLength(3));
  });

  it("Custom is in use when no pack is: Choose models opens the catalog; the folder can be changed", async () => {
    base({
      packs: [pack("light")],
      status: { embedding: "emb-s", reranker: null, activation: "machine" },
    });
    mount(<ModelsSection />);
    const custom = await screen.findByRole("article", { name: "Custom pack" });
    await waitFor(() => expect(within(custom).getByText("In use")).toBeInTheDocument());
    fireEvent.click(within(custom).getByRole("button", { name: "Choose models" }));
    expect(screen.getByRole("button", { name: "Model catalog" })).toHaveAttribute("aria-expanded", "true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Add from a folder…"), { target: { value: "D:\\x" } });
    models.routes["models.add"] = () => ({ model: "x", path: "D:\\x", dims: 1 });
    const before = named("models.catalog").length;
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(named("models.catalog").length).toBeGreaterThan(before));
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(screen.getByText("folder D:\\m need 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    expect(await screen.findByText("D:\\models", { selector: ".mono" })).toBeInTheDocument();
  });
});
