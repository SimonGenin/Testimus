// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fit, Job } from "../../../../src/core/types.ts";
import { ModelsSection } from "../../../../src/ui/screens/settings/ModelsSection.tsx";
import type { CatalogRow, Installed } from "../../../../src/ui/screens/settings/models/data.ts";
import { iconsIn } from "../../helpers/icons.ts";
import { calls, emit, Fail, fakeNet, inputs, job, mountSettings, net, reset, status } from "./helpers.tsx";

vi.mock("../../../../src/ui/screens/settings/models/FolderDialog.tsx", () => ({
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
      <button
        type="button"
        onClick={() =>
          onApplied("E:\\models", srv.start({ kind: "models-dir", subject: "move to E:\\models" }), "move")
        }
      >
        Apply with move
      </button>
      <button
        type="button"
        onClick={() =>
          onApplied("E:\\models", srv.start({ kind: "models-dir", subject: "copy to E:\\models" }), "copy")
        }
      >
        Apply with copy
      </button>
      <button type="button" onClick={onClose}>
        Close folder
      </button>
    </div>
  ),
}));

let seq = 0;
const jobs = new Map<string, Job>();

// ponytail: the server's jobs — started by a command, listed while running, ended by the test (which tells the page)
const srv = {
  start(o: Partial<Job>): string {
    const id = o.id ?? `${o.kind ?? "job"}-${String(++seq).padStart(8, "0")}`;
    jobs.set(id, job({ ...o, id, status: "running" }));
    return id;
  },
  async end(id: string, s: Job["status"], over: Partial<Job> = {}) {
    const j = { ...(jobs.get(id) ?? job({ id })), status: s, ...over };
    jobs.set(id, j);
    await emit(status(j));
  },
};

const fitOf = (verdict: Fit["verdict"], message: string = verdict, over: Partial<Fit> = {}): Fit => ({
  verdict,
  device: "gpu",
  needMB: { vram: 1434, ram: 600 },
  freeMB: { vram: null, ram: 0 },
  totalMB: { vram: null, ram: 0 },
  unload: [],
  message,
  ...over,
});

const model = (id: string, over: Partial<CatalogRow> = {}): CatalogRow => ({
  id,
  kind: "embedding",
  label: `M ${id}`,
  tier: "light",
  runtimes: ["transformers"],
  quantization: "q8",
  dims: 1024,
  sizeMB: 500,
  state: "available",
  fit: fitOf("fits"),
  advised: false,
  reason: null,
  pair: null,
  aside: null,
  ...over,
});

const inst = (id: string, over: Partial<Installed> = {}): Installed =>
  ({
    model: id,
    label: id,
    via: "download",
    runtime: "transformers",
    where: `D:\\models\\${id}`,
    sizeMB: 500,
    state: "installed",
    usedBy: [],
    ...over,
  }) as Installed;

type Base = {
  catalog?: CatalogRow[];
  installed?: Installed[];
  status?: Record<string, unknown>;
  dir?: string | null;
  llama?: { build: string; backend: string } | null;
};

function base(b: Base = {}) {
  const dir = b.dir === undefined ? "D:\\m" : b.dir;
  net.routes["models.catalog"] = () => b.catalog ?? [model("emb-s", { state: "installed" })];
  net.routes["models.list"] = () => b.installed ?? [];
  net.routes["rag.status"] = () => b.status ?? { embedding: "emb-s", reranker: null, activation: "light" };
  net.routes["models.dirs"] = () => ({
    dir,
    runtimesDir: dir ? `${dir}\\runtimes` : null,
    llamacpp: b.llama === undefined ? { build: "b12032", backend: "cuda" } : b.llama,
  });
  net.routes["models.hardware"] = () => ({
    at: "2026-11-05T10:00:00.000Z",
    ramTotalMB: 16000,
    ramFreeMB: 9000,
    cpu: { model: "Intel(R) Core(TM) i5-1145G7", threads: 8 },
    gpus: [],
    loaded: [],
    drives: [
      { root: "C:\\", freeMB: 5000, totalMB: 100000 },
      { root: "D:\\", freeMB: 655360, totalMB: 1900000 },
    ],
  });
  net.routes["models.speech"] = () => ({
    engine: {
      installed: true,
      build: "v1.8.4",
      backend: "cuda",
      advised: "cuda",
      card: true,
      downloadMB: 685,
      detector: "Silero",
    },
    ffmpeg: { installed: true, build: "7.1.1", downloadMB: 88 },
    active: null,
    chosen: null,
    models: [],
  });
  net.routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true }, projects: [] });
  net.routes["jobs.list"] = () => [...jobs.values()].filter((j) => j.status === "running");
  net.routes["jobs.show"] = (i) => ({ job: jobs.get(String(i.id)) ?? job({ id: String(i.id) }), events: [] });
  net.routes["jobs.cancel"] = () => ({ cancelled: true });
}

beforeEach(() => {
  fakeNet();
  jobs.clear();
});

afterEach(reset);

const group = (name: string) => screen.findByRole("region", { name: new RegExp(`^${name}`) });
const tableOf = (name: string) => screen.getByRole("table", { name });
const rowOf = (table: string, label: string) =>
  within(tableOf(table)).getByRole("row", { name: new RegExp(label.replace(/[()]/g, "\\$&")) });
const advisedRow = async (name: string) => {
  const g = await group(name);
  return (await within(g).findByText("Advised for this PC")).parentElement?.parentElement as HTMLElement;
};

describe("Settings › Models", () => {
  it("without a project: the models one by one, Use waiting for a project, no job list, no index state", async () => {
    base({ catalog: [model("emb-s", { state: "installed" }), model("emb-b")] });
    mountSettings(<ModelsSection />, { info: null });
    expect(await screen.findByText("D:\\m")).toBeInTheDocument();
    await screen.findByRole("table", { name: "Embedding models" });
    expect(within(rowOf("Embedding models", "M emb-b")).getByRole("button", { name: "Use" })).toBeDisabled();
    expect(within(await group("Embeddings")).queryByText("In use")).toBeNull();
    expect(calls("jobs.list")).toHaveLength(0);
    expect(calls("rag.status")).toHaveLength(0);
    expect(inputs("models.catalog")).toEqual([{}]);
    expect(calls("models.packs")).toHaveLength(0);
    expect(calls("models.advice")).toHaveLength(0);
  });

  it("a folder not chosen yet; the models wait for the catalog", async () => {
    base({ dir: null });
    let answer = (_v: unknown) => {};
    net.routes["models.catalog"] = () => new Promise((r) => (answer = r));
    mountSettings(<ModelsSection />);
    expect(await screen.findByText("Not chosen yet — Testimus asks on the first download.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose…" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Embedding models" })).toBeNull();
    answer([model("emb-s", { state: "installed" })]);
    expect(await screen.findByRole("table", { name: "Embedding models" })).toBeInTheDocument();
  });

  it("says how much room is left on the models folder's drive", async () => {
    base();
    mountSettings(<ModelsSection />);
    expect(await screen.findByText("D:\\m")).toBeInTheDocument();
    expect(await screen.findByText("· 640 GB free on D:")).toBeInTheDocument();
  });

  it("shows an error with Try again when the models cannot be read, never stale rows", async () => {
    base();
    net.routes["models.catalog"] = () => {
      throw new Fail("catalog.json is damaged");
    };
    mountSettings(<ModelsSection />);
    expect(await screen.findByText("The models could not be read")).toBeInTheDocument();
    expect(screen.getByText("catalog.json is damaged")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Embedding models" })).toBeNull();
    base();
    expect(iconsIn(screen.getByRole("button", { name: "Try again" })), "audit icons 110").toEqual(["refresh"]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("The models could not be read")).toBeNull());
    expect(await screen.findByRole("table", { name: "Embedding models" })).toBeInTheDocument();
  });

  it("each kind: what it is for, the model in use in its head, the advised one first with why, then every other one", async () => {
    base({
      catalog: [
        model("bge", { label: "BGE-M3 (8-bit, CPU)", state: "installed", fit: fitOf("fits", "", { device: "cpu" }) }),
        model("qwen", {
          label: "Qwen3 Embedding 0.6B (16-bit, DirectML)",
          tier: "standard",
          sizeMB: 1160,
          advised: true,
          reason: "Fits: Qwen3 Embedding 0.6B needs about 1.4 GB; the GPU has 16.0 GB, 13.5 GB free.",
        }),
        model("q8b", { label: "Qwen3 Embedding 8B (4-bit)", tier: "quality", runtimes: ["llamacpp"] }),
        model("rr", {
          kind: "reranker",
          label: "Qwen3 Reranker 0.6B (8-bit, GGUF)",
          advised: true,
          reason: "Both fit.",
        }),
        model("rr-b", { kind: "reranker", label: "BGE Reranker v2 M3 (8-bit, CPU)" }),
      ],
      status: { embedding: "bge", reranker: null, activation: "machine" },
      installed: [inst("bge", { sizeMB: 564 })],
    });
    mountSettings(<ModelsSection />);
    const emb = await group("Embeddings");
    expect(within(emb).getByText(/so search finds it by meaning as well as by its words/)).toBeInTheDocument();
    await waitFor(() => expect(within(emb).getAllByText("BGE-M3 (8-bit, CPU)").length).toBe(2));
    const adv = await advisedRow("Embeddings");
    expect(within(adv).getByText("Qwen3 Embedding 0.6B (16-bit, DirectML)")).toBeInTheDocument();
    expect(within(adv).getByText(/^Fits: Qwen3 Embedding 0\.6B needs about 1\.4 GB/)).toBeInTheDocument();
    expect(adv).toHaveTextContent("Download 1.1 GB");
    expect(adv).toHaveTextContent("On the card 1.4 GB");
    expect(within(adv).getByRole("button", { name: "Download and use" })).toBeEnabled();
    expect(within(emb).getByText(/the vectors of a model already used are kept/)).toBeInTheDocument();
    const table = tableOf("Embedding models");
    expect(within(table).queryByRole("row", { name: /Qwen3 Embedding 0\.6B/ })).toBeNull();
    const bge = rowOf("Embedding models", "BGE-M3 (8-bit, CPU)");
    expect(within(bge).getByText("In use")).toBeInTheDocument();
    expect(within(bge).getByText("Processor, 600 MB")).toBeInTheDocument();
    expect(within(bge).getByText("564 MB")).toBeInTheDocument();
    expect(within(bge).getByText("Installed")).toBeInTheDocument();
    expect(within(bge).getByText("Light: runs on any PC · no llama.cpp needed")).toBeInTheDocument();
    const big = rowOf("Embedding models", "Qwen3 Embedding 8B (4-bit)");
    expect(within(big).getByText("Not installed")).toBeInTheDocument();
    expect(within(big).getByText("Card, 1.4 GB")).toBeInTheDocument();
    expect(within(big).getByText(/runs through llama\.cpp/)).toBeInTheDocument();
    expect(within(big).getByRole("button", { name: "Use" })).toBeEnabled();

    const rr = await group("Reranker");
    expect(within(rr).getAllByText("None").length).toBeGreaterThan(0);
    expect(within(await advisedRow("Reranker")).getByText("Qwen3 Reranker 0.6B (8-bit, GGUF)")).toBeInTheDocument();
    expect(within(await advisedRow("Reranker")).getByText("Both fit.")).toBeInTheDocument();
    const none = rowOf("Reranker models", "None");
    expect(within(none).getByText("In use")).toBeInTheDocument();
    expect(within(none).getByText("Search ranks by words and meaning only.")).toBeInTheDocument();
    expect(within(rr).getByText(/shares the card with the embedding/)).toBeInTheDocument();
    expect(within(rr).getByText("llama.cpp b12032, cuda")).toBeInTheDocument();
    expect(within(rr).getByText(/Runs the GGUF models/)).toBeInTheDocument();
    expect(within(rr).queryByRole("button", { name: "Download llama.cpp" })).toBeNull();

    const llm = await group("LLM");
    expect(within(llm).getByText("Soon")).toBeInTheDocument();
    expect(within(llm).queryByRole("button")).toBeNull();
  });

  it("the advised model already in use says so and offers nothing more", async () => {
    base({
      catalog: [model("emb-s", { state: "active", advised: true, reason: "Fits." }), model("emb-b")],
      status: { embedding: "emb-s", reranker: null, activation: "machine" },
    });
    mountSettings(<ModelsSection />);
    const adv = await advisedRow("Embeddings");
    await waitFor(() => expect(within(adv).getByText("In use")).toBeInTheDocument());
    expect(within(adv).queryByRole("button")).toBeNull();
    expect(within(tableOf("Embedding models")).queryByRole("row", { name: /M emb-s/ })).toBeNull();
  });

  it("a reranker that does not fit beside the embedding says why; one that cannot, or is not offered, waits greyed", async () => {
    base({
      catalog: [
        model("emb-s", { state: "installed", fit: fitOf("fits", "", { device: "cpu" }) }),
        model("tight", { kind: "reranker", pair: fitOf("tight", "Tight: both need 9.6 GB; 9.0 GB usable.") }),
        model("huge", { kind: "reranker", pair: fitOf("ram-too-small", "RAM too small: 40 GB needed.") }),
        model("cpu", {
          kind: "reranker",
          pair: fitOf("fits"),
          aside: "Not offered while the embedding runs on the processor: every query would wait for both.",
        }),
      ],
    });
    mountSettings(<ModelsSection />);
    await screen.findByRole("table", { name: "Reranker models" });
    const tight = rowOf("Reranker models", "M tight");
    expect(within(tight).getByText("Tight: both need 9.6 GB; 9.0 GB usable.")).toBeInTheDocument();
    expect(within(tight).getByRole("button", { name: "Use" })).toBeEnabled();
    const huge = rowOf("Reranker models", "M huge");
    expect(within(huge).getByText("RAM too small: 40 GB needed.")).toBeInTheDocument();
    expect(within(huge).getByRole("button", { name: "Use" })).toBeDisabled();
    const cpu = rowOf("Reranker models", "M cpu");
    expect(within(cpu).getByText(/^Not offered while the embedding runs on the processor/)).toBeInTheDocument();
    expect(within(cpu).getByRole("button", { name: "Use" })).toBeDisabled();
    expect(inputs("models.catalog")).toContainEqual({ beside: "emb-s" });
  });

  it("no reranker advised: None is, with why; a reranker in use can be dropped for None", async () => {
    base({
      catalog: [
        model("emb-s", {
          state: "installed",
          advised: true,
          reason: "Fits.",
          fit: fitOf("fits", "", { device: "cpu" }),
        }),
        model("rr", { kind: "reranker", state: "installed" }),
      ],
      status: { embedding: "emb-s", reranker: "rr", activation: "machine" },
    });
    net.routes["models.use"] = () => ({ fit: fitOf("fits"), reindex: false, indexJob: null, lighter: null });
    mountSettings(<ModelsSection />);
    const adv = await advisedRow("Reranker");
    expect(within(adv).getByText("None")).toBeInTheDocument();
    expect(
      within(adv).getByText(/With the embedding advised on the processor, a reranker would slow every query/),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf("Reranker models", "M rr")).getByText("In use")).toBeInTheDocument());
    expect(within(tableOf("Reranker models")).queryByRole("row", { name: /^None/ })).toBeNull();
    fireEvent.click(within(adv).getByRole("button", { name: "Use" }));
    const plan = await screen.findByRole("alertdialog", { name: "Use No reranker for this project?" });
    expect(inputs("models.use")).toEqual([{ reranker: null, dryRun: true }]);
    fireEvent.click(within(plan).getByRole("button", { name: "Use No reranker" }));
    await waitFor(() => expect(inputs("models.use").at(-1)).toEqual({ reranker: null }));
  });

  it("llama.cpp not installed: downloaded from the Reranker group, its job followed there", async () => {
    base({ llama: null });
    net.routes["models.pullRuntime"] = () => ({ jobId: srv.start({ kind: "models-pull", subject: "llama.cpp" }) });
    mountSettings(<ModelsSection />);
    const rr = await group("Reranker");
    await waitFor(() => expect(within(rr).getByText("llama.cpp not installed")).toBeInTheDocument());
    fireEvent.click(within(rr).getByRole("button", { name: "Download llama.cpp" }));
    await waitFor(() => expect(inputs("models.pullRuntime")).toEqual([{}]));
    expect(await within(rr).findByRole("status", { name: "Downloading llama.cpp" })).toBeInTheDocument();
    const id = [...jobs.keys()].find((k) => k.startsWith("models-pull")) as string;
    await srv.end(id, "done", { result: {} });
    expect(await screen.findByText("llama.cpp installed")).toBeInTheDocument();
  });

  it("follows the jobs already running: download, move, index — with progress and failures", async () => {
    base({ catalog: [model("emb-s", { state: "installed" }), model("big")] });
    const pull = srv.start({ kind: "models-pull", subject: "big" });
    const mv = srv.start({ kind: "models-dir", subject: "move to E:\\m" });
    const ix = srv.start({ kind: "rag-index", subject: "" });
    srv.start({ kind: "check", subject: "" });
    mountSettings(<ModelsSection />);
    expect(await screen.findByRole("status", { name: "Moving the models" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Indexing the documents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change…" })).toBeDisabled();
    expect(
      await within(await waitFor(() => rowOf("Embedding models", "M big"))).findByRole("status", {
        name: "Downloading M big",
      }),
    ).toBeInTheDocument();
    await emit({ jobId: pull, at: "", type: "progress", message: "half", done: 1, total: 4 });
    expect(await screen.findByText("Downloading M big · 25 %")).toBeInTheDocument();
    await srv.end(mv, "failed", { error: "disk full" });
    expect(await screen.findByText("Moving the models: stopped")).toBeInTheDocument();
    await srv.end(ix, "done");
    await srv.end(pull, "done", { result: null });
    await waitFor(() => expect(screen.queryByRole("status", { name: /Downloading|Indexing|Moving/ })).toBeNull());
  });

  it("a copy job and cancelling a job, a refused cancel said", async () => {
    base();
    const cp = srv.start({ kind: "models-dir", subject: "copy to E:\\m" });
    net.routes["jobs.cancel"] = () => {
      throw new Fail("Not running here.");
    };
    mountSettings(<ModelsSection />);
    const copy = await screen.findByRole("status", { name: "Copying the models" });
    fireEvent.click(within(copy).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Could not cancel the job")).toBeInTheDocument();
    net.routes["jobs.cancel"] = () => ({ cancelled: true });
    fireEvent.click(within(copy).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(inputs("jobs.cancel")).toEqual([{ id: cp }, { id: cp }]));
    await srv.end(cp, "cancelled");
    await waitFor(() => expect(screen.queryByRole("status", { name: "Copying the models" })).toBeNull());
  });

  it("running jobs that cannot be listed are ignored", async () => {
    base();
    delete net.routes["jobs.list"];
    mountSettings(<ModelsSection />);
    expect(await screen.findByText("D:\\m")).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "Embedding models" })).toBeInTheDocument();
  });

  it("the folder can be changed, the change closed or saved", async () => {
    base();
    mountSettings(<ModelsSection />);
    await screen.findByText("D:\\m");
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(screen.getByText("folder D:\\m need 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    expect(await screen.findByText("Models folder saved")).toBeInTheDocument();
  });

  it("adds a model from a folder and reads the catalog again", async () => {
    base();
    net.routes["models.add"] = () => ({ model: "x", path: "D:\\x", dims: 1 });
    mountSettings(<ModelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a model from a folder…" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /^Add from a folder/ }), {
      target: { value: "D:\\x" },
    });
    const before = calls("models.catalog").length;
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls("models.catalog").length).toBeGreaterThan(before));
  });
});

describe("Settings › Models › using a model", () => {
  it("uses a model here that fits and reindexes; a reranker keeps the embedding", async () => {
    base({
      catalog: [
        model("emb-s", { state: "active" }),
        model("emb-b", { state: "installed" }),
        model("rr", { kind: "reranker", state: "installed" }),
      ],
      status: { embedding: "emb-s", reranker: "old-rr", activation: "machine" },
    });
    let reindex = true;
    net.routes["models.use"] = (i) => ({
      fit: fitOf("fits"),
      reindex,
      indexJob: i.dryRun || !reindex ? null : srv.start({ kind: "rag-index", subject: "" }),
      lighter: null,
    });
    mountSettings(<ModelsSection />);
    await waitFor(() => expect(within(rowOf("Embedding models", "M emb-s")).getByText("In use")).toBeInTheDocument());
    expect(within(rowOf("Embedding models", "M emb-s")).queryByRole("button", { name: "Use" })).toBeNull();
    fireEvent.click(within(rowOf("Reranker models", "M rr")).getByRole("button", { name: "Use" }));
    let plan = await screen.findByRole("alertdialog", { name: "Use M rr for this project?" });
    expect(plan).toHaveTextContent("indexed again with it");
    expect(inputs("models.use")).toEqual([{ reranker: "rr", dryRun: true }]);
    fireEvent.click(within(plan).getByRole("button", { name: "Use M rr" }));
    expect(await screen.findByText("M rr in use for this project")).toBeInTheDocument();
    expect(inputs("models.use")).toEqual([{ reranker: "rr", dryRun: true }, { reranker: "rr" }]);
    expect(await screen.findByRole("status", { name: "Indexing the documents" })).toBeInTheDocument();
    reindex = false;
    fireEvent.click(within(rowOf("Embedding models", "M emb-b")).getByRole("button", { name: "Use" }));
    plan = await screen.findByRole("alertdialog", { name: "Use M emb-b for this project?" });
    expect(plan).toHaveTextContent("Noindex to rebuild");
    fireEvent.click(within(plan).getByRole("button", { name: "Use M emb-b" }));
    await waitFor(() => expect(inputs("models.use")[3]).toEqual({ embedding: "emb-b" }));
  });

  it("Download and use: the plan says the download first, the model is downloaded in a job, then used", async () => {
    base({
      catalog: [model("emb-s", { state: "installed" }), model("adv", { sizeMB: 1160, advised: true, reason: "Fits." })],
    });
    net.routes["models.use"] = () => ({ fit: fitOf("fits"), reindex: true, indexJob: null, lighter: null });
    net.routes["models.pull"] = (i) => ({ jobId: srv.start({ kind: "models-pull", subject: String(i.model) }) });
    mountSettings(<ModelsSection />);
    const adv = await advisedRow("Embeddings");
    fireEvent.click(within(adv).getByRole("button", { name: "Download and use" }));
    const plan = await screen.findByRole("alertdialog", { name: "Download and use M adv?" });
    expect(plan).toHaveTextContent("1.1 GBto download first");
    expect(plan).toHaveTextContent("indexed again with it");
    expect(calls("models.pull")).toHaveLength(0);
    fireEvent.click(within(plan).getByRole("button", { name: "Download 1.1 GB and use" }));
    await waitFor(() => expect(inputs("models.pull")).toEqual([{ model: "adv" }]));
    expect(await within(adv).findByRole("status", { name: "Downloading M adv" })).toBeInTheDocument();
    expect(inputs("models.use")).toEqual([{ embedding: "adv", dryRun: true }]);
    const id = [...jobs.keys()].find((k) => k.startsWith("models-pull")) as string;
    await srv.end(id, "done", { result: {} });
    await waitFor(() => expect(inputs("models.use").at(-1)).toEqual({ embedding: "adv" }));
    expect(await screen.findByText("M adv in use for this project")).toBeInTheDocument();
  });

  it("without a models folder, Download and use asks for one first; a pull refused for want of one asks too", async () => {
    base({ catalog: [model("emb-s", { state: "installed" }), model("big", { sizeMB: 900 })], dir: null });
    net.routes["models.use"] = () => ({ fit: fitOf("fits"), reindex: false, indexJob: null, lighter: null });
    let refusal: Fail | null = new Fail("Choose where models are stored", { code: "models-dir-unset" });
    net.routes["models.pull"] = (i) => {
      if (refusal) throw refusal;
      return { jobId: srv.start({ kind: "models-pull", subject: String(i.model) }) };
    };
    mountSettings(<ModelsSection />);
    await screen.findByText("Not chosen yet — Testimus asks on the first download.");
    fireEvent.click(
      within(await waitFor(() => rowOf("Embedding models", "M big"))).getByRole("button", { name: "Use" }),
    );
    expect(screen.getByText("folder none need 900")).toBeInTheDocument();
    expect(calls("models.use")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Apply with move" }));
    let plan = await screen.findByRole("alertdialog", { name: "Download and use M big?" });
    expect(screen.getByRole("status", { name: "Moving the models" })).toBeInTheDocument();
    fireEvent.click(within(plan).getByRole("button", { name: "Download 900 MB and use" }));
    expect(await screen.findByText("folder none need 900")).toBeInTheDocument();
    refusal = null;
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    plan = await screen.findByRole("alertdialog", { name: "Download and use M big?" });
    fireEvent.click(within(plan).getByRole("button", { name: "Download 900 MB" }));
    await waitFor(() => expect(inputs("models.pull")).toEqual([{ model: "big" }, { model: "big" }]));
    expect(await screen.findByRole("status", { name: "Downloading M big" })).toBeInTheDocument();
    refusal = new Fail("offline");
    net.routes["models.dirs"] = () => ({ dir: "E:\\models", runtimesDir: "E:\\models\\runtimes", llamacpp: null });
    for (const k of [...jobs.keys()]) await srv.end(k, "done");
    expect(await screen.findByText("E:\\models")).toBeInTheDocument();
    fireEvent.click(
      await waitFor(() => within(rowOf("Embedding models", "M big")).getByRole("button", { name: "Use" })),
    );
    plan = await screen.findByRole("alertdialog", { name: "Download and use M big?" });
    fireEvent.click(within(plan).getByRole("button", { name: "Download 900 MB and use" }));
    expect(await within(plan).findByText("offline")).toBeInTheDocument();
  });

  it("a reranker without an embedding is refused; a failing fit or use is said", async () => {
    base({
      catalog: [model("rr", { kind: "reranker", state: "installed" }), model("emb-b", { state: "installed" })],
      status: { embedding: "none", reranker: null, activation: "none" },
    });
    mountSettings(<ModelsSection />);
    fireEvent.click(within(await waitFor(() => rowOf("Reranker models", "M rr"))).getByRole("button", { name: "Use" }));
    expect(await screen.findByText("Choose an embedding model first")).toBeInTheDocument();
    fireEvent.click(within(rowOf("Embedding models", "M emb-b")).getByRole("button", { name: "Use" }));
    expect(await screen.findByText("Could not check whether M emb-b fits")).toBeInTheDocument();
    net.routes["models.use"] = (i) => {
      if (i.dryRun) return { fit: fitOf("fits"), reindex: true, indexJob: null, lighter: null };
      throw new Fail("no");
    };
    fireEvent.click(within(rowOf("Embedding models", "M emb-b")).getByRole("button", { name: "Use" }));
    const plan = await screen.findByRole("alertdialog", { name: "Use M emb-b for this project?" });
    fireEvent.click(within(plan).getByRole("button", { name: "Use M emb-b" }));
    expect(await within(plan).findByText("no")).toBeInTheDocument();
    expect(inputs("models.use").at(-1)).toEqual({ embedding: "emb-b" });
  });

  it("a model that does not fit asks first: RAM too small has no Use anyway; the lighter one is downloaded and used", async () => {
    base({
      catalog: [
        model("huge", { state: "installed", sizeMB: 9000 }),
        model("mid", { state: "installed", sizeMB: 3000 }),
        model("small", { state: "available", sizeMB: 1000 }),
        model("tiny-bad", { state: "installed", sizeMB: 10 }),
        model("ram", { state: "installed" }),
      ],
      status: { embedding: "huge", reranker: null, activation: "machine" },
    });
    const lighter: Record<string, string | null> = { huge: "mid", mid: "small" };
    net.routes["models.use"] = (i) => ({
      fit:
        i.embedding === "small"
          ? fitOf("fits")
          : i.embedding === "tiny-bad"
            ? fitOf("tight")
            : i.embedding === "ram"
              ? fitOf("ram-too-small", "RAM too small: 40 GB needed, 32 GB on this PC.")
              : fitOf("gpu-too-small", "Your GPU has 8 GB: it runs partly on the CPU."),
      reindex: false,
      indexJob: null,
      lighter: lighter[String(i.embedding)] ?? null,
    });
    net.routes["models.pull"] = (i) => ({ jobId: srv.start({ kind: "models-pull", subject: String(i.model) }) });
    mountSettings(<ModelsSection />);
    fireEvent.click(
      within(await waitFor(() => rowOf("Embedding models", "M ram"))).getByRole("button", { name: "Use" }),
    );
    let ask = await screen.findByRole("dialog", { name: "M ram cannot run on this PC" });
    expect(ask).toHaveTextContent("RAM too small: 40 GB needed, 32 GB on this PC.");
    expect(within(ask).queryByRole("button", { name: "Use anyway" })).toBeNull();
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(within(rowOf("Embedding models", "M huge")).getByText("In use")).toBeInTheDocument());
    fireEvent.click(within(rowOf("Embedding models", "M mid")).getByRole("button", { name: "Use" }));
    ask = await screen.findByRole("dialog", { name: "Use M mid anyway?" });
    expect(ask).toHaveTextContent(/runs partly on the CPU/);
    expect(within(ask).getByText("Lighter choice: M small.")).toBeInTheDocument();
    fireEvent.click(within(ask).getByRole("button", { name: "Choose a lighter one" }));
    const download = await screen.findByRole("alertdialog", { name: "Download and use M small?" });
    fireEvent.click(within(download).getByRole("button", { name: "Download 1000 MB and use" }));
    await waitFor(() => expect(inputs("models.pull")[0]).toEqual({ model: "small" }));
    expect(await screen.findByRole("status", { name: "Downloading M small" })).toBeInTheDocument();
    for (const k of [...jobs.keys()]) await srv.end(k, "done");
    await waitFor(() => expect(inputs("models.use").at(-1)).toEqual({ embedding: "small" }));
    await waitFor(() =>
      expect(within(rowOf("Embedding models", "M tiny-bad")).getByRole("button", { name: "Use" })).toBeEnabled(),
    );
    fireEvent.click(within(rowOf("Embedding models", "M tiny-bad")).getByRole("button", { name: "Use" }));
    ask = await screen.findByRole("dialog", { name: "Use M tiny-bad anyway?" });
    expect(within(ask).getByRole("button", { name: "Choose a lighter one" })).toBeDisabled();
    fireEvent.click(within(ask).getByRole("button", { name: "Use anyway" }));
    const plan = await screen.findByRole("alertdialog", { name: "Use M tiny-bad for this project?" });
    fireEvent.click(within(plan).getByRole("button", { name: "Use M tiny-bad" }));
    expect(await screen.findByText("M tiny-bad in use for this project")).toBeInTheDocument();
    expect(inputs("models.use").filter((c) => !c.dryRun)).toEqual([
      { embedding: "small" },
      { embedding: "tiny-bad", accept: true },
    ]);
  });

  it("checks a model in a job: works, fails its check, cannot be checked", async () => {
    base({ catalog: [model("emb-s", { state: "installed" })] });
    let v: unknown = { ok: true, dims: 1024, ms: 40, message: "One sentence embedded" };
    net.routes["models.verify"] = (i) => {
      if (v instanceof Fail) throw v;
      const id = srv.start({ kind: "models-verify", subject: String(i.model) });
      jobs.set(id, { ...(jobs.get(id) as Job), status: "done", result: v });
      return { jobId: id };
    };
    mountSettings(<ModelsSection />);
    const check = () => within(rowOf("Embedding models", "M emb-s")).getByRole("button", { name: "Check" });
    fireEvent.click(await waitFor(check));
    expect(await screen.findByText("M emb-s works")).toBeInTheDocument();
    expect(screen.getByText("One sentence embedded (1024 dimensions, 40 ms)")).toBeInTheDocument();
    v = { ok: false, dims: 0, ms: 1, message: "NaN" };
    fireEvent.click(await waitFor(check));
    expect(await screen.findByText("M emb-s failed its check")).toBeInTheDocument();
    v = new Fail("broken");
    fireEvent.click(await waitFor(check));
    expect(await screen.findByText("Could not verify M emb-s")).toBeInTheDocument();
  });

  it("removes a downloaded model or forgets a folder one, after a confirmation", async () => {
    base({
      catalog: [model("dl", { state: "installed" }), model("fold", { state: "installed" })],
      installed: [inst("dl", { sizeMB: 2048 }), inst("fold", { via: "path", where: "\\\\share\\fold" })],
      status: { embedding: "none", reranker: null, activation: "none" },
    });
    let removed: unknown = { removed: "files", freedMB: 2048 };
    net.routes["models.remove"] = () => {
      if (removed instanceof Fail) throw removed;
      return removed;
    };
    mountSettings(<ModelsSection />);
    fireEvent.click(
      within(await waitFor(() => rowOf("Embedding models", "M dl"))).getByRole("button", { name: "Remove" }),
    );
    let dlg = screen.getByRole("alertdialog", { name: "Remove M dl?" });
    expect(within(dlg).getByText("Its files (2.0 GB) are deleted from D:\\models\\dl.")).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(rowOf("Embedding models", "M dl")).getByRole("button", { name: "Remove" }));
    dlg = screen.getByRole("alertdialog", { name: "Remove M dl?" });
    expect(iconsIn(within(dlg).getByRole("button", { name: "Remove" }))).toEqual(["trash"]);
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("2.0 GB freed")).toBeInTheDocument();
    expect(inputs("models.remove")).toEqual([{ model: "dl" }]);
    fireEvent.click(within(rowOf("Embedding models", "M fold")).getByRole("button", { name: "Remove" }));
    dlg = screen.getByRole("alertdialog", { name: "Remove M fold?" });
    expect(within(dlg).getByText(/the folder \\\\share\\fold stays on disk/)).toBeInTheDocument();
    removed = { removed: "registration", freedMB: 0 };
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Its folder stays on disk")).toBeInTheDocument();
    removed = new Fail("locked");
    fireEvent.click(
      await waitFor(() => within(rowOf("Embedding models", "M fold")).getByRole("button", { name: "Remove" })),
    );
    dlg = screen.getByRole("alertdialog", { name: "Remove M fold?" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove" }));
    expect(await within(dlg).findByText("locked")).toBeInTheDocument();
  });
});
