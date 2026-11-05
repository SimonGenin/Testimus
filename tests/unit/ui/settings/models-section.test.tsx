// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fit, Job } from "../../../../src/core/types.ts";
import { ModelsSection } from "../../../../src/ui/screens/settings/ModelsSection.tsx";
import type { CatalogRow, Installed, PackRow } from "../../../../src/ui/screens/settings/models/data.ts";
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

const fitOf = (verdict: Fit["verdict"], message: string = verdict, device: Fit["device"] = "gpu"): Fit => ({
  verdict,
  device,
  needMB: { vram: 0, ram: 0 },
  freeMB: { vram: null, ram: 0 },
  totalMB: { vram: null, ram: 0 },
  unload: [],
  message,
});

const pack = (id: string, over: Partial<PackRow> = {}): PackRow => ({
  processorOnly: false,
  lighter: null,
  suggested: false,
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
  measuredHere: false,
  ...over,
});

const model = (id: string, over: Partial<CatalogRow> = {}): CatalogRow =>
  ({
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
  }) as CatalogRow;

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
  packs?: PackRow[];
  catalog?: CatalogRow[];
  installed?: Installed[];
  advice?: unknown[];
  status?: Record<string, unknown>;
  dir?: string | null;
};

let packs: PackRow[] = [];

function base(b: Base = {}) {
  packs = b.packs ?? [pack("light", { active: true })];
  const dir = b.dir === undefined ? "D:\\m" : b.dir;
  net.routes["models.catalog"] = () => b.catalog ?? [model("emb-s", { state: "installed" })];
  net.routes["models.list"] = () => b.installed ?? [];
  net.routes["models.packs"] = () => packs;
  net.routes["models.advice"] = () => b.advice ?? [];
  net.routes["rag.status"] = () => b.status ?? { embedding: "emb-s", reranker: null, activation: "light" };
  net.routes["models.dirs"] = () => ({ dir, runtimesDir: null });
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
  net.routes["models.planPack"] = (i) => ({
    pack: i.pack,
    variant: 0,
    embedding: "emb-s",
    reranker: null,
    plan: { download: [], dir, reindex: true, expected: "fast" },
  });
  net.routes["models.usePack"] = (i) => ({ jobId: srv.start({ kind: "models-usePack", subject: String(i.pack) }) });
  net.routes["models.measure"] = (i) => ({ jobId: srv.start({ kind: "models-measure", subject: String(i.pack) }) });
  net.routes["jobs.list"] = () => [...jobs.values()].filter((j) => j.status === "running");
  net.routes["jobs.show"] = (i) => ({ job: jobs.get(String(i.id)) ?? job({ id: String(i.id) }), events: [] });
  net.routes["jobs.cancel"] = () => ({ cancelled: true });
}

beforeEach(() => {
  fakeNet();
  jobs.clear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(reset);

const openCatalog = () => fireEvent.click(screen.getByRole("button", { name: "Model catalog" }));
const card = (name: string) => screen.getByRole("article", { name: `${name} pack` });
const use = async (name: string) =>
  fireEvent.click(
    within(await screen.findByRole("article", { name: `${name} pack` })).getByRole("button", { name: "Use this pack" }),
  );
const rowOf = (label: string) =>
  within(screen.getByRole("table", { name: "Model catalog" })).getByRole("row", {
    name: new RegExp(label.replace(/[()]/g, "\\$&")),
  });

describe("Settings › Models", () => {
  it("without a project: the shared models only, no pack, no job list", async () => {
    base();
    mountSettings(<ModelsSection />, { info: null });
    expect(screen.getByText(/Open a project to choose its search pack/)).toBeInTheDocument();
    expect(await screen.findByText("1 in the catalog · 0 on this PC")).toBeInTheDocument();
    expect(await screen.findByText("D:\\m")).toBeInTheDocument();
    expect(calls("models.packs")).toHaveLength(0);
    expect(calls("jobs.list")).toHaveLength(0);
    expect(calls("rag.status")).toHaveLength(0);
  });

  it("empty answers, a folder not chosen yet, packs and the catalog loading", async () => {
    base({ catalog: [], dir: null, packs: [] });
    let answer = (_v: unknown) => {};
    net.routes["models.packs"] = () => new Promise((r) => (answer = r));
    mountSettings(<ModelsSection />);
    expect(screen.getByRole("status", { name: "Loading the packs" })).toBeInTheDocument();
    expect(screen.getByText("Loading the catalog")).toBeInTheDocument();
    expect(await screen.findByText("Not chosen yet — Testimus asks on the first download.")).toBeInTheDocument();
    expect(await screen.findByText("0 in the catalog · 0 on this PC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose…" })).toBeInTheDocument();
    answer([]);
    expect(await screen.findByRole("article", { name: "Custom pack" })).toBeInTheDocument();
  });

  it("says how much room is left on the models folder's drive", async () => {
    base();
    mountSettings(<ModelsSection />);
    expect(await screen.findByText("D:\\m")).toBeInTheDocument();
    expect(await screen.findByText("· 640 GB free on D:")).toBeInTheDocument();
  });

  it("shows an error with Try again when the models cannot be read, never stale cards", async () => {
    base();
    net.routes["models.catalog"] = () => {
      throw new Fail("catalog.json is damaged");
    };
    mountSettings(<ModelsSection />);
    expect(await screen.findByText("The models could not be read")).toBeInTheDocument();
    expect(screen.getByText("catalog.json is damaged")).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Light pack" })).toBeNull();
    base();
    expect(iconsIn(screen.getByRole("button", { name: "Try again" })), "audit icons 110").toEqual(["refresh"]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("The models could not be read")).toBeNull());
    expect(await screen.findByRole("article", { name: "Light pack" })).toBeInTheDocument();
  });

  it("shows the pack cards, the active one marked, skipped variants, Custom, and the folder", async () => {
    base({
      packs: [
        pack("light", { active: true, speed: "query 40 ms, index 6 passages/s" }),
        pack("balanced", {
          variant: 1,
          reranker: "rr",
          downloadMB: 3100,
          skipped: ["Qwen3 Embedding 4B (8-bit) + Qwen3 Reranker 0.6B: 9.2 GB needed, 7.0 GB usable (tight)"],
        }),
        pack("quality", { available: false, embedding: null, fit: null, variant: null }),
      ],
    });
    mountSettings(<ModelsSection />);
    const light = await screen.findByRole("article", { name: "Light pack" });
    expect(within(light).getByText("In use")).toBeInTheDocument();
    expect(within(light).queryByRole("button", { name: /Use this pack|Using this pack/ })).toBeNull();
    expect(within(light).getByRole("button", { name: /^Measure/ })).toBeInTheDocument();
    expect(within(light).getByText("Installed")).toBeInTheDocument();
    expect(within(light).getByText("query 40 ms, index 6 passages/s")).toBeInTheDocument();
    const balanced = card("Balanced");
    expect(within(balanced).getByText(/its second choice/)).toBeInTheDocument();
    expect(within(balanced).getByText(/9.2 GB needed, 7.0 GB usable/)).toBeInTheDocument();
    expect(within(balanced).getByText("3.0 GB")).toBeInTheDocument();
    expect(within(balanced).getByText("Not measured on this PC yet")).toBeInTheDocument();
    const quality = card("Quality");
    expect(within(quality).getByText("Not available on this PC")).toBeInTheDocument();
    expect(within(quality).getByRole("button", { name: "Use this pack" })).toBeDisabled();
    expect(card("Custom")).toBeInTheDocument();
    expect(screen.getByText("D:\\m")).toBeInTheDocument();
  });

  it("a pack card says how the project measures beside the reference (audit M-S1)", async () => {
    base({
      packs: [
        pack("balanced", {
          quality: "Recall 0.71 on the reference document",
          projectQuality: "Recall 0.82 on 12 behaviors",
        }),
        pack("light"),
      ],
    });
    mountSettings(<ModelsSection />);
    const facts = (name: string) => {
      const a = card(name);
      const terms = within(a)
        .getAllByRole("term")
        .map((t) => t.textContent);
      const values = within(a)
        .getAllByRole("definition")
        .map((d) => d.textContent);
      return Object.fromEntries(terms.map((t, i) => [t, values[i]]));
    };
    await screen.findByRole("article", { name: "Balanced pack" });
    expect(facts("Balanced")).toMatchObject({
      Quality: "Recall 0.71 on the reference document",
      "On this project": "Recall 0.82 on 12 behaviors",
    });
    expect(facts("Light")).not.toHaveProperty("On this project");
  });

  it("follows the jobs already running: install, download, move, index — with progress and failures", async () => {
    base({ packs: [pack("balanced"), pack("light", { active: true })], catalog: [model("emb-s"), model("big")] });
    const up = srv.start({ kind: "models-usePack", subject: "balanced" });
    const pull = srv.start({ kind: "models-pull", subject: "big" });
    const mv = srv.start({ kind: "models-dir", subject: "move to E:\\m" });
    const ix = srv.start({ kind: "rag-index", subject: "" });
    srv.start({ kind: "check", subject: "" });
    mountSettings(<ModelsSection />);
    expect(await screen.findByRole("status", { name: "Installing Balanced" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Moving the models" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Indexing the documents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change…" })).toBeDisabled();
    openCatalog();
    expect(await screen.findByRole("status", { name: "Downloading M big" })).toBeInTheDocument();
    await emit({ jobId: up, at: "", type: "progress", message: "step 1", done: 1, total: 4 });
    expect(await screen.findByText("Installing Balanced · 25 %")).toBeInTheDocument();
    await srv.end(mv, "failed", { error: "disk full" });
    expect(await screen.findByText("Moving the models: stopped")).toBeInTheDocument();
    await srv.end(ix, "done");
    const ix2 = srv.start({ kind: "rag-index", subject: "" });
    await srv.end(up, "done", { result: {} });
    expect(await screen.findByRole("status", { name: "Indexing the documents" })).toBeInTheDocument();
    await srv.end(ix2, "done");
    await srv.end(pull, "done", { result: null });
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: /Installing|Downloading|Indexing|Moving/ })).toBeNull(),
    );
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
    expect(await screen.findByRole("article", { name: "Light pack" })).toBeInTheDocument();
  });

  it("uses a pack that fits: plan, cancel, confirm, then follows its job and the index after it", async () => {
    base({ packs: [pack("balanced", { reranker: "rr" }), pack("light", { active: true })] });
    mountSettings(<ModelsSection />);
    await use("Balanced");
    const dlg = await screen.findByRole("dialog", { name: "Use the Balanced pack" });
    expect(inputs("models.planPack")).toEqual([{ pack: "balanced" }]);
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Use the Balanced pack" })).toBeNull();
    await use("Balanced");
    fireEvent.click(await screen.findByRole("button", { name: "Use Balanced" }));
    expect(await screen.findByText("Balanced pack chosen for this project")).toBeInTheDocument();
    expect(await screen.findByRole("status", { name: "Installing Balanced" })).toBeInTheDocument();
    expect(inputs("models.usePack").at(-1)).toEqual({ pack: "balanced", downloadOnly: false });
    const up = calls("jobs.show")[0].input.id as string;
    const ix = srv.start({ kind: "rag-index", subject: "" });
    await srv.end(up, "done", { result: { indexJob: ix } });
    expect(await screen.findByRole("status", { name: "Indexing the documents" })).toBeInTheDocument();
    await srv.end(ix, "done");
    await waitFor(() => expect(screen.queryByRole("status", { name: "Indexing the documents" })).toBeNull());
  });

  it("a pack with downloads is only downloaded; another pack stays choosable meanwhile", async () => {
    base({ packs: [pack("balanced", { downloadMB: 300 }), pack("light")] });
    net.routes["models.planPack"] = (i) => ({
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
    });
    mountSettings(<ModelsSection />);
    await use("Balanced");
    const dlg = await screen.findByRole("dialog", { name: "Download the Balanced pack" });
    expect(within(dlg).getByText(/Once used, the documents are indexed again/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Download 300 MB" }));
    expect(await screen.findByRole("status", { name: "Downloading Balanced" })).toBeInTheDocument();
    expect(inputs("models.usePack").at(-1)).toEqual({ pack: "balanced", downloadOnly: true });
    expect(screen.queryByText("Balanced pack chosen for this project")).toBeNull();
    const light = within(card("Light")).getByRole("button", { name: "Use this pack" });
    expect(light).toBeEnabled();
    fireEvent.click(light);
    const plan = await screen.findByRole("dialog", { name: "Use the Light pack" });
    fireEvent.click(within(plan).getByRole("button", { name: "Cancel" }));
    const dl = [...jobs.keys()].find((k) => k.startsWith("models-usePack")) as string;
    await srv.end(dl, "done", { result: {} });
    expect(await screen.findByText("Balanced pack downloaded")).toBeInTheDocument();
  });

  it("a plan that needs a folder asks for one, then plans again; Change… in the plan too", async () => {
    let dir: string | null = null;
    base({ packs: [pack("balanced")], dir: null });
    net.routes["models.planPack"] = (i) => ({
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
    });
    mountSettings(<ModelsSection />);
    await use("Balanced");
    expect(await screen.findByText("folder none need 300")).toBeInTheDocument();
    dir = "D:\\models";
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    expect(await screen.findByText("Models folder saved")).toBeInTheDocument();
    const dlg = await screen.findByRole("dialog", { name: "Download the Balanced pack" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Change…" }));
    expect(await screen.findByText(/^folder .* need 0$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    expect(await screen.findByRole("dialog", { name: "Download the Balanced pack" })).toBeInTheDocument();
  });

  it("a confirm refused for want of a folder asks for one; other refusals are said", async () => {
    base({ packs: [pack("balanced")] });
    let refusal = new Fail("Choose where models are stored", { code: "models-dir-unset" });
    net.routes["models.planPack"] = (i) => ({
      pack: i.pack,
      variant: 0,
      embedding: "emb-s",
      reranker: null,
      plan: { download: [{ model: "a", sizeMB: 50 }], dir: "D:\\m", reindex: true, expected: "" },
    });
    net.routes["models.usePack"] = () => {
      throw refusal;
    };
    mountSettings(<ModelsSection />);
    await use("Balanced");
    fireEvent.click(await screen.findByRole("button", { name: "Download 50 MB" }));
    expect(await screen.findByText("folder D:\\m need 50")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Download the Balanced pack" })).getByRole("button", {
        name: "Cancel",
      }),
    );
    refusal = new Fail("Choose where models are stored (in words only, without the code)");
    await use("Balanced");
    fireEvent.click(await screen.findByRole("button", { name: "Download 50 MB" }));
    expect(await screen.findByText("Could not download the Balanced pack")).toBeInTheDocument();
  });

  it("a plan that cannot be made is said", async () => {
    base({ packs: [pack("balanced")] });
    net.routes["models.planPack"] = () => {
      throw new Fail("no");
    };
    mountSettings(<ModelsSection />);
    await use("Balanced");
    expect(await screen.findByText("Could not plan the Balanced pack")).toBeInTheDocument();
  });

  it("a pack that does not fit asks first: cancel, lighter, use anyway; no lighter at the bottom", async () => {
    base({
      packs: [
        pack("balanced", { fit: fitOf("tight", "Tight: 7.6 GB needed, 7.0 GB usable."), lighter: "light" }),
        pack("light", { fit: fitOf("unknown", "Unknown GPU"), lighter: null }),
      ],
    });
    mountSettings(<ModelsSection />);
    await use("Balanced");
    let ask = screen.getByRole("dialog", { name: "Use the Balanced pack anyway?" });
    expect(ask).toHaveTextContent("Tight: 7.6 GB needed, 7.0 GB usable.");
    expect(within(ask).getByText("Lighter choice: the Light pack.")).toBeInTheDocument();
    expect(calls("models.planPack")).toHaveLength(0);
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    await use("Balanced");
    fireEvent.click(screen.getByRole("button", { name: "Choose a lighter one" }));
    ask = screen.getByRole("dialog", { name: "Use the Light pack anyway?" });
    expect(within(ask).getByRole("button", { name: "Choose a lighter one" })).toBeDisabled();
    fireEvent.click(within(ask).getByRole("button", { name: "Use anyway" }));
    expect(await screen.findByRole("dialog", { name: "Use the Light pack" })).toBeInTheDocument();
    expect(calls("models.usePack").filter((c) => c.input.pack === "balanced")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Use Light" }));
    await waitFor(() => expect(inputs("models.usePack").at(-1)).toMatchObject({ pack: "light", accept: true }));
  });

  it("a pack made for a GPU that runs on the processor here asks first, though it fits", async () => {
    base({
      packs: [
        pack("balanced", {
          fit: fitOf("fits", "Fits on the processor.", "cpu"),
          processorOnly: true,
          lighter: "light",
        }),
        pack("light"),
      ],
    });
    mountSettings(<ModelsSection />);
    await use("Balanced");
    const ask = screen.getByRole("dialog", { name: "Use the Balanced pack on the processor?" });
    expect(ask).toHaveTextContent("Processor only");
    expect(within(ask).getByText("Lighter choice: the Light pack.")).toBeInTheDocument();
    expect(calls("models.planPack")).toHaveLength(0);
    fireEvent.click(within(ask).getByRole("button", { name: "Use anyway" }));
    expect(await screen.findByRole("dialog", { name: "Use the Balanced pack" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await use("Light");
    expect(await screen.findByRole("dialog", { name: "Use the Light pack" })).toBeInTheDocument();
  });
});

describe("Settings › Models › the catalog", () => {
  it("is folded until asked; rows have state, size, fit, where and the measured speed", async () => {
    base({
      catalog: [model("bge", { label: "BGE-M3 (8-bit, CPU)", state: "installed" }), model("q4", { label: "Qwen3 4B" })],
      installed: [inst("bge", { perf: "query 40 ms", sizeMB: 564 })],
      status: { embedding: "bge", reranker: null, activation: "machine" },
    });
    mountSettings(<ModelsSection />);
    const fold = await screen.findByRole("button", { name: "Model catalog" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table", { name: "Model catalog" })).toBeNull();
    fireEvent.click(fold);
    await screen.findByRole("table", { name: "Model catalog" });
    const bge = rowOf("BGE-M3 (8-bit, CPU)");
    expect(within(bge).getAllByText("In use")).toHaveLength(2);
    expect(within(bge).getByText("query 40 ms")).toBeInTheDocument();
    expect(within(bge).getByText("564 MB")).toBeInTheDocument();
    expect(within(bge).getByText("D:\\models\\bge")).toBeInTheDocument();
    const q4 = rowOf("Qwen3 4B");
    expect(within(q4).getByText("Not installed")).toBeInTheDocument();
    expect(within(q4).getByRole("button", { name: "Install" })).toBeEnabled();
    fireEvent.click(fold);
    expect(screen.queryByRole("table", { name: "Model catalog" })).toBeNull();
  });

  it("installs a model: asks for a folder first when none is chosen, then follows the download and the move", async () => {
    base({ catalog: [model("big", { sizeMB: 900 })], dir: null });
    net.routes["models.pull"] = (i) => ({ jobId: srv.start({ kind: "models-pull", subject: String(i.model) }) });
    mountSettings(<ModelsSection />);
    await screen.findByText("Not chosen yet — Testimus asks on the first download.");
    openCatalog();
    fireEvent.click(within(await waitFor(() => rowOf("M big"))).getByRole("button", { name: "Install" }));
    expect(screen.getByText("folder none need 900")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply with move" }));
    const plan = await screen.findByRole("alertdialog", { name: "Download M big?" });
    expect(plan).toHaveTextContent("900 MBto download");
    expect(calls("models.pull")).toHaveLength(0);
    fireEvent.click(within(plan).getByRole("button", { name: "Download 900 MB" }));
    expect(await screen.findByRole("status", { name: "Downloading M big" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Moving the models" })).toBeInTheDocument();
    expect(inputs("models.pull")).toEqual([{ model: "big" }]);
  });

  it("an install refused for want of a folder asks for one; refused outright is said in its plan", async () => {
    base({ catalog: [model("big")] });
    let refusal: Fail | null = new Fail("Choose where models are stored", { code: "models-dir-unset" });
    net.routes["models.pull"] = (i) => {
      if (refusal) throw refusal;
      return { jobId: srv.start({ kind: "models-pull", subject: String(i.model) }) };
    };
    mountSettings(<ModelsSection />);
    await screen.findByText("D:\\m");
    openCatalog();
    fireEvent.click(within(await waitFor(() => rowOf("M big"))).getByRole("button", { name: "Install" }));
    const download = () => screen.findByRole("alertdialog", { name: "Download M big?" });
    expect(await download()).toHaveTextContent("into D:\\m");
    fireEvent.click(within(await download()).getByRole("button", { name: "Download 500 MB" }));
    expect(await screen.findByText("folder D:\\m need 500")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog", { name: "Download M big?" })).toBeNull();
    refusal = null;
    fireEvent.click(screen.getByRole("button", { name: "Apply with copy" }));
    fireEvent.click(within(await download()).getByRole("button", { name: "Download 500 MB" }));
    await waitFor(() => expect(calls("models.pull")).toHaveLength(2));
    expect(await screen.findByRole("status", { name: "Copying the models" })).toBeInTheDocument();
    refusal = new Fail("offline");
    for (const k of [...jobs.keys()]) await srv.end(k, "done");
    fireEvent.click(await waitFor(() => within(rowOf("M big")).getByRole("button", { name: "Install" })));
    const plan = await download();
    fireEvent.click(within(plan).getByRole("button", { name: "Download 500 MB" }));
    expect(await within(plan).findByText("offline")).toBeInTheDocument();
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
    let reindex = true;
    net.routes["models.use"] = (i) => ({
      fit: fitOf("fits"),
      reindex,
      indexJob: i.dryRun || !reindex ? null : srv.start({ kind: "rag-index", subject: "" }),
      lighter: null,
    });
    mountSettings(<ModelsSection />);
    openCatalog();
    expect(await waitFor(() => within(rowOf("M emb-s")).getByRole("button", { name: "In use" }))).toBeDisabled();
    fireEvent.click(within(rowOf("M rr")).getByRole("button", { name: "Use" }));
    let plan = await screen.findByRole("alertdialog", { name: "Use M rr for this project?" });
    expect(plan).toHaveTextContent("indexed again with it");
    expect(inputs("models.use")).toEqual([{ reranker: "rr", dryRun: true }]);
    fireEvent.click(within(plan).getByRole("button", { name: "Use M rr" }));
    expect(await screen.findByText("M rr in use for this project")).toBeInTheDocument();
    expect(inputs("models.use")).toEqual([{ reranker: "rr", dryRun: true }, { reranker: "rr" }]);
    expect(await screen.findByRole("status", { name: "Indexing the documents" })).toBeInTheDocument();
    reindex = false;
    fireEvent.click(within(rowOf("M emb-b")).getByRole("button", { name: "Use" }));
    plan = await screen.findByRole("alertdialog", { name: "Use M emb-b for this project?" });
    expect(plan).toHaveTextContent("Noindex to rebuild");
    fireEvent.click(within(plan).getByRole("button", { name: "Use M emb-b" }));
    await waitFor(() => expect(inputs("models.use")[3]).toEqual({ embedding: "emb-b" }));
  });

  it("a reranker without an embedding is refused; a failing fit or use is said", async () => {
    base({
      catalog: [model("rr", { kind: "reranker", state: "installed" }), model("emb-b", { state: "installed" })],
      status: { embedding: "none", reranker: null, activation: "none" },
    });
    mountSettings(<ModelsSection />);
    await screen.findByText("2 in the catalog · 0 on this PC");
    openCatalog();
    fireEvent.click(within(await waitFor(() => rowOf("M rr"))).getByRole("button", { name: "Use" }));
    expect(await screen.findByText("Choose an embedding model first")).toBeInTheDocument();
    fireEvent.click(within(rowOf("M emb-b")).getByRole("button", { name: "Use" }));
    expect(await screen.findByText("Could not check whether M emb-b fits")).toBeInTheDocument();
    net.routes["models.use"] = (i) => {
      if (i.dryRun) return { fit: fitOf("fits"), reindex: true, indexJob: null, lighter: null };
      throw new Fail("no");
    };
    fireEvent.click(within(rowOf("M emb-b")).getByRole("button", { name: "Use" }));
    const plan = await screen.findByRole("alertdialog", { name: "Use M emb-b for this project?" });
    fireEvent.click(within(plan).getByRole("button", { name: "Use M emb-b" }));
    expect(await within(plan).findByText("no")).toBeInTheDocument();
    expect(inputs("models.use").at(-1)).toEqual({ embedding: "emb-b" });
  });

  it("a model that does not fit asks first: RAM too small has no Use anyway; the lighter one is used or installed", async () => {
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
    openCatalog();
    fireEvent.click(within(await waitFor(() => rowOf("M ram"))).getByRole("button", { name: "Use" }));
    let ask = await screen.findByRole("dialog", { name: "M ram cannot run on this PC" });
    expect(ask).toHaveTextContent("RAM too small: 40 GB needed, 32 GB on this PC.");
    expect(within(ask).queryByRole("button", { name: "Use anyway" })).toBeNull();
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(rowOf("M huge")).getByRole("button", { name: "In use" }));
    fireEvent.click(within(rowOf("M mid")).getByRole("button", { name: "Use" }));
    ask = await screen.findByRole("dialog", { name: "Use M mid anyway?" });
    expect(ask).toHaveTextContent(/runs partly on the CPU/);
    expect(within(ask).getByText("Lighter choice: M small.")).toBeInTheDocument();
    fireEvent.click(within(ask).getByRole("button", { name: "Choose a lighter one" }));
    const download = await screen.findByRole("alertdialog", { name: "Download M small?" });
    fireEvent.click(within(download).getByRole("button", { name: "Download 1000 MB" }));
    await waitFor(() => expect(inputs("models.pull")[0]).toEqual({ model: "small" }));
    expect(await screen.findByRole("status", { name: "Downloading M small" })).toBeInTheDocument();
    for (const k of [...jobs.keys()]) await srv.end(k, "done");
    await waitFor(() => expect(within(rowOf("M tiny-bad")).getByRole("button", { name: "Use" })).toBeEnabled());
    fireEvent.click(within(rowOf("M tiny-bad")).getByRole("button", { name: "Use" }));
    ask = await screen.findByRole("dialog", { name: "Use M tiny-bad anyway?" });
    expect(within(ask).getByRole("button", { name: "Choose a lighter one" })).toBeDisabled();
    fireEvent.click(within(ask).getByRole("button", { name: "Use anyway" }));
    const plan = await screen.findByRole("alertdialog", { name: "Use M tiny-bad for this project?" });
    fireEvent.click(within(plan).getByRole("button", { name: "Use M tiny-bad" }));
    expect(await screen.findByText("M tiny-bad in use for this project")).toBeInTheDocument();
    expect(inputs("models.use").filter((c) => !c.dryRun)).toEqual([{ embedding: "tiny-bad", accept: true }]);
  });

  it("verifies a model in a job: works, fails its check, cannot be verified", async () => {
    base({ catalog: [model("emb-s", { state: "installed" })] });
    let v: unknown = { ok: true, dims: 1024, ms: 40, message: "One sentence embedded" };
    net.routes["models.verify"] = (i) => {
      if (v instanceof Fail) throw v;
      const id = srv.start({ kind: "models-verify", subject: String(i.model) });
      jobs.set(id, { ...(jobs.get(id) as Job), status: "done", result: v });
      return { jobId: id };
    };
    mountSettings(<ModelsSection />);
    openCatalog();
    fireEvent.click(within(await waitFor(() => rowOf("M emb-s"))).getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("M emb-s works")).toBeInTheDocument();
    expect(screen.getByText("One sentence embedded (1024 dimensions, 40 ms)")).toBeInTheDocument();
    v = { ok: false, dims: 0, ms: 1, message: "NaN" };
    fireEvent.click(await waitFor(() => within(rowOf("M emb-s")).getByRole("button", { name: "Verify" })));
    expect(await screen.findByText("M emb-s failed its check")).toBeInTheDocument();
    v = new Fail("broken");
    fireEvent.click(await waitFor(() => within(rowOf("M emb-s")).getByRole("button", { name: "Verify" })));
    expect(await screen.findByText("Could not verify M emb-s")).toBeInTheDocument();
  });

  it("removes a downloaded model or forgets a folder one, after a confirmation", async () => {
    base({
      catalog: [model("dl", { state: "installed" }), model("fold", { state: "installed" })],
      installed: [inst("dl", { sizeMB: 2048 }), inst("fold", { via: "path", where: "\\\\share\\fold" })],
    });
    let removed: unknown = { removed: "files", freedMB: 2048 };
    net.routes["models.remove"] = () => {
      if (removed instanceof Fail) throw removed;
      return removed;
    };
    mountSettings(<ModelsSection />);
    expect(await screen.findByText("2 in the catalog · 2 on this PC")).toBeInTheDocument();
    openCatalog();
    fireEvent.click(within(await waitFor(() => rowOf("M dl"))).getByRole("button", { name: "Remove" }));
    let dlg = screen.getByRole("alertdialog", { name: "Remove M dl?" });
    expect(within(dlg).getByText("Its files (2.0 GB) are deleted from D:\\models\\dl.")).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(rowOf("M dl")).getByRole("button", { name: "Remove" }));
    dlg = screen.getByRole("alertdialog", { name: "Remove M dl?" });
    expect(iconsIn(within(dlg).getByRole("button", { name: "Remove" }))).toEqual(["trash"]);
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("2.0 GB freed")).toBeInTheDocument();
    expect(inputs("models.remove")).toEqual([{ model: "dl" }]);
    fireEvent.click(within(rowOf("M fold")).getByRole("button", { name: "Remove" }));
    dlg = screen.getByRole("alertdialog", { name: "Remove M fold?" });
    expect(within(dlg).getByText(/the folder \\\\share\\fold stays on disk/)).toBeInTheDocument();
    removed = { removed: "registration", freedMB: 0 };
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Its folder stays on disk")).toBeInTheDocument();
    removed = new Fail("locked");
    fireEvent.click(await waitFor(() => within(rowOf("M fold")).getByRole("button", { name: "Remove" })));
    dlg = screen.getByRole("alertdialog", { name: "Remove M fold?" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove" }));
    expect(await within(dlg).findByText("locked")).toBeInTheDocument();
  });

  it("adds a model from a folder and reads the catalog again", async () => {
    base();
    net.routes["models.add"] = () => ({ model: "x", path: "D:\\x", dims: 1 });
    mountSettings(<ModelsSection />);
    openCatalog();
    fireEvent.change(await screen.findByRole("textbox", { name: /^Add from a folder/ }), {
      target: { value: "D:\\x" },
    });
    const before = calls("models.catalog").length;
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls("models.catalog").length).toBeGreaterThan(before));
  });
});

describe("Settings › Models › advice and the folder", () => {
  it("a pack advice plans the pack; dismiss is said when refused, then gone", async () => {
    const advice = [
      {
        id: "a1",
        direction: "upgrade",
        from: { pack: "light" },
        to: { pack: "balanced" },
        reason: "Queries take 30 ms (p95), well under the 1 s budget.",
        quality: "+5%",
      },
    ];
    base({ packs: [pack("balanced"), pack("light", { active: true })], advice });
    mountSettings(<ModelsSection />);
    const banner = await screen.findByRole("region", { name: "Advice" });
    expect(within(banner).getByText(/switch to Balanced pack/)).toBeInTheDocument();
    expect(within(banner).getByText(/Queries take 30 ms \(p95\)/)).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("dialog", { name: "Use the Balanced pack" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(banner).getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Could not dismiss the advice")).toBeInTheDocument();
    net.routes["models.dismissAdvice"] = () => ({ dismissed: "a1" });
    net.routes["models.advice"] = () => [];
    fireEvent.click(within(banner).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Advice" })).toBeNull());
    expect(inputs("models.dismissAdvice").at(-1)).toEqual({ id: "a1" });
  });

  it("advice for a missing pack does nothing; a model advice is checked, planned, then reindexes or fails", async () => {
    base({
      advice: [
        { id: "x", direction: "upgrade", from: { pack: "light" }, to: { pack: "quality" }, reason: "r", quality: "q" },
      ],
    });
    const r = mountSettings(<ModelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
    await new Promise((res) => setTimeout(res, 20));
    expect(calls("models.planPack")).toHaveLength(0);
    r.unmount();
    let n = 0;
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
    net.routes["models.use"] = (i) => {
      if (i.dryRun) return { fit: fitOf("fits"), reindex: true, indexJob: null, lighter: null };
      n++;
      if (n === 2) throw new Fail("nope");
      return { fit: fitOf("fits"), reindex: true, indexJob: srv.start({ kind: "rag-index" }), lighter: null };
    };
    mountSettings(<ModelsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
    let plan = await screen.findByRole("alertdialog", { name: "Use e2 for this project?" });
    expect(inputs("models.use")).toEqual([{ embedding: "e2", reranker: null, dryRun: true }]);
    fireEvent.click(within(plan).getByRole("button", { name: "Use e2" }));
    expect(await screen.findByText("e2 in use for this project")).toBeInTheDocument();
    expect(screen.getByText("Indexing again")).toBeInTheDocument();
    expect(inputs("models.use")[1]).toEqual({ embedding: "e2", reranker: null });
    expect(await screen.findByRole("status", { name: "Indexing the documents" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    plan = await screen.findByRole("alertdialog", { name: "Use e2 for this project?" });
    fireEvent.click(within(plan).getByRole("button", { name: "Use e2" }));
    expect(await within(plan).findByText("nope")).toBeInTheDocument();
  });

  it("Custom is in use when no pack is: Open the catalog opens it; the folder can be changed", async () => {
    base({ packs: [pack("light")], status: { embedding: "emb-s", reranker: null, activation: "machine" } });
    mountSettings(<ModelsSection />);
    const custom = await screen.findByRole("article", { name: "Custom pack" });
    await waitFor(() => expect(within(custom).getByText("In use")).toBeInTheDocument());
    fireEvent.click(within(custom).getByRole("button", { name: "Open the catalog" }));
    expect(screen.getByRole("button", { name: "Model catalog" })).toHaveAttribute("aria-expanded", "true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(screen.getByText("folder D:\\m need 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    expect(await screen.findByText("Models folder saved")).toBeInTheDocument();
  });
});

describe("Settings › Models › measuring a pack", () => {
  const dialog = () => screen.getByRole("dialog", { name: "Measure the Light pack" });
  const close = () => within(dialog()).getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement;
  const measureOf = (name: string) => within(card(name)).getByRole("button", { name: /^Measur/ });

  it("starts models.measure on the pack, follows it, keeps it running when closed, reopens it, cancels it", async () => {
    base({ packs: [pack("light", { active: true }), pack("balanced", { downloadMB: 10 })] });
    mountSettings(<ModelsSection />);
    await screen.findByRole("article", { name: "Light pack" });
    expect(measureOf("Light")).toHaveTextContent(/^Measure$/);
    expect(measureOf("Balanced")).toBeDisabled();
    fireEvent.click(measureOf("Light"));
    await waitFor(() => expect(inputs("models.measure")).toEqual([{ pack: "light" }]));
    expect(dialog()).toHaveTextContent("Syntec collective agreement");
    expect(dialog()).toHaveTextContent("Your project's documents are not used");
    expect(within(dialog()).getByText("no reranker")).toBeInTheDocument();
    expect(within(dialog()).getByText("Models")).toBeInTheDocument();
    expect(within(dialog()).getByText("Progress")).toBeInTheDocument();
    expect(
      within(dialog()).getByText("Closing this window does not stop the measure: it goes on in Jobs."),
    ).toBeInTheDocument();
    const ev = [...jobs.keys()].find((k) => k.startsWith("models-measure")) as string;
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Cancel" })).toBeEnabled());
    await emit({ jobId: ev, at: "", type: "progress", message: "Behavior 2", done: 2, total: 4 });
    expect(await within(dialog()).findByText("Measuring · 50 %")).toBeInTheDocument();
    expect(within(dialog()).getByText("Behavior 2")).toBeInTheDocument();
    expect(within(dialog()).getAllByRole("button", { name: "Close" })).toHaveLength(2);
    fireEvent.click(close());
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(measureOf("Light")).toHaveTextContent("Measuring · 50 %"));
    expect(calls("jobs.cancel")).toHaveLength(0);
    fireEvent.click(measureOf("Light"));
    expect(dialog()).toBeInTheDocument();
    expect(calls("models.measure")).toHaveLength(1);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(inputs("jobs.cancel")).toEqual([{ id: ev }]));
    await srv.end(ev, "cancelled");
    expect(await within(dialog()).findByText("The measure was cancelled; no result was written.")).toBeInTheDocument();
    expect(screen.queryByText(/the measure stopped/)).toBeNull();
  });

  it("when done: the card and the dialog show the new speed and quality; again, then done while closed is said", async () => {
    base({ packs: [pack("light", { active: true }), pack("balanced")] });
    mountSettings(<ModelsSection />);
    fireEvent.click(await waitFor(() => measureOf("Light")));
    await waitFor(() => expect(calls("models.measure")).toHaveLength(1));
    const ev = [...jobs.keys()].find((k) => k.startsWith("models-measure")) as string;
    packs = [
      pack("light", {
        active: true,
        speed: "on this PC: query 68 ms",
        quality: "right article first for 60 %",
        measuredHere: true,
      }),
      pack("balanced"),
    ];
    await srv.end(ev, "done", { result: {} });
    expect(await within(dialog()).findByText("Measured")).toBeInTheDocument();
    expect(await within(dialog()).findByText(/on this PC: query 68 ms/)).toBeInTheDocument();
    expect(within(card("Light")).getByText(/right article first for 60 %/)).toBeInTheDocument();
    expect(screen.queryByText("Light pack measured")).toBeNull();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Measure again" }));
    await waitFor(() => expect(calls("models.measure")).toHaveLength(2));
    expect(within(dialog()).getByRole("status", { name: "Measuring" })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Cancel" })).toBeEnabled());
    fireEvent.click(close());
    const ev2 = [...jobs.keys()].filter((k) => k.startsWith("models-measure"))[1];
    await srv.end(ev2, "done", { result: {} });
    expect(await screen.findByText("Light pack measured")).toBeInTheDocument();
    await waitFor(() => expect(measureOf("Light")).toHaveTextContent("Measure again"));
  });

  it("a refused start and a failed job: the reason, Measure again; a job failing while closed is said", async () => {
    base({ packs: [pack("light", { active: true })] });
    net.routes["models.measure"] = () => {
      throw new Fail("emb-s is not installed on this PC.", { fix: "Install it first." });
    };
    mountSettings(<ModelsSection />);
    fireEvent.click(await waitFor(() => measureOf("Light")));
    expect(await within(dialog()).findByText("The measure stopped")).toBeInTheDocument();
    expect(within(dialog()).getByText(/emb-s is not installed on this PC\./)).toBeInTheDocument();
    net.routes["models.measure"] = (i) => ({ jobId: srv.start({ kind: "models-measure", subject: String(i.pack) }) });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Measure again" }));
    await waitFor(() => expect(calls("models.measure")).toHaveLength(2));
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Cancel" })).toBeEnabled());
    fireEvent.click(close());
    const ev = [...jobs.keys()].find((k) => k.startsWith("models-measure")) as string;
    await srv.end(ev, "failed", { error: "disk full" });
    expect(await screen.findByText("Light pack: the measure stopped")).toBeInTheDocument();
  });

  it("picks up a measure already running when the screen opens", async () => {
    base({ packs: [pack("light", { active: true }), pack("balanced", { downloadMB: 10 })] });
    const ev = srv.start({ kind: "models-measure", subject: "light" });
    srv.start({ kind: "rag-eval", subject: "eval" });
    mountSettings(<ModelsSection />);
    await waitFor(() => expect(measureOf("Light")).toHaveTextContent(/Measuring/));
    expect(measureOf("Balanced")).toBeDisabled();
    fireEvent.click(measureOf("Light"));
    expect(dialog()).toBeInTheDocument();
    expect(calls("models.measure")).toHaveLength(0);
    fireEvent.click(close());
    await srv.end(ev, "done");
    expect(await screen.findByText("Light pack measured")).toBeInTheDocument();
  });
});
