// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fit } from "../../src/core/types.ts";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { ModelsSection } from "../../src/ui/screens/settings/ModelsSection.tsx";
import {
  bestDrive,
  type CatalogRow,
  type PackRow,
  size,
  suggestPack,
} from "../../src/ui/screens/settings/models/data.ts";

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
      try {
        return new Response(JSON.stringify(h(input) ?? null), { status: 200 });
      } catch (e) {
        const x = e as { message: string; fix?: string };
        return new Response(JSON.stringify({ error: x.message, fix: x.fix }), { status: 400 });
      }
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const named = (n: string) => calls.filter((c) => c.name === n);

const fitOf = (verdict: Fit["verdict"], msg: string, device: Fit["device"] = "gpu"): Fit => ({
  verdict,
  device,
  needMB: { vram: 9000, ram: 0 },
  freeMB: { vram: 7000, ram: 30000 },
  totalMB: { vram: 8192, ram: 32000 },
  unload: [],
  message: msg,
});

const packs = (): PackRow[] => [
  {
    id: "light",
    label: "Light",
    intent: "Works on any PC.",
    active: true,
    available: true,
    variant: 0,
    embedding: "bge-m3-q8",
    reranker: null,
    fit: fitOf("fits", "Fits: BGE-M3 needs about 1.1 GB of memory, 40.5 GB free.", "cpu"),
    skipped: [],
    downloadMB: 0,
    speed: "query 40 ms, index 6 passages/s",
    quality: "quality not measured yet",
  },
  {
    id: "balanced",
    label: "Balanced",
    intent: "Better recall with a reranker.",
    active: false,
    available: true,
    variant: 1,
    embedding: "qwen3-embedding-4b-q4",
    reranker: "bge-reranker-v2-m3-q8",
    fit: fitOf("tight", "Tight: 7.6 GB needed, 7.0 GB usable."),
    skipped: ["Qwen3 Embedding 4B (8-bit) + Qwen3 Reranker 0.6B: 9.2 GB needed, 7.0 GB usable (tight)"],
    downloadMB: 3100,
    quality: "quality not measured yet",
  },
  {
    id: "quality",
    label: "Quality",
    intent: "The most complete search.",
    active: false,
    available: false,
    variant: null,
    embedding: null,
    reranker: null,
    fit: null,
    skipped: ["Qwen3 Embedding 8B (8-bit): RAM too small (refused)"],
    downloadMB: 0,
    quality: "quality not measured yet",
  },
];

const catalogRows = (): CatalogRow[] => [
  {
    id: "bge-m3-q8",
    kind: "embedding",
    label: "BGE-M3 (8-bit, CPU)",
    tier: "light",
    runtimes: ["transformers"],
    quantization: "q8",
    dims: 1024,
    sizeMB: 560,
    state: "installed",
    fit: fitOf("fits", "Fits.", "cpu"),
  },
  {
    id: "qwen3-embedding-8b-q8",
    kind: "embedding",
    label: "Qwen3 Embedding 8B (8-bit)",
    tier: "quality",
    runtimes: ["llamacpp"],
    quantization: "Q8_0",
    dims: 4096,
    sizeMB: 7700,
    state: "installed",
    fit: fitOf("gpu-too-small", "Your GPU has 8 GB. Qwen3 Embedding 8B needs about 9.1 GB: it runs partly on the CPU."),
  },
  {
    id: "qwen3-embedding-4b-q4",
    kind: "embedding",
    label: "Qwen3 Embedding 4B (4-bit)",
    tier: "standard",
    runtimes: ["llamacpp"],
    quantization: "Q4_K_M",
    dims: 2560,
    sizeMB: 2400,
    state: "available",
    fit: fitOf("fits", "Fits."),
  },
  {
    id: "bge-reranker-v2-m3-q8",
    kind: "reranker",
    label: "BGE Reranker v2 M3 (8-bit, CPU)",
    tier: "light",
    runtimes: ["transformers"],
    quantization: "q8",
    dims: 0,
    sizeMB: 560,
    state: "available",
    fit: fitOf("fits", "Fits.", "cpu"),
  },
];

const ragStatus = {
  embedding: "bge-m3-q8",
  reranker: null,
  dims: 1024,
  activation: "machine",
  missing: [],
  exists: true,
  indexEmbedding: "bge-m3-q8",
  profileMatches: true,
  space: { id: "abc123def456", vectors: 10, complete: true },
  degraded: null,
  chunks: 10,
  builtAt: null,
  docs: [],
};

const hardware = {
  at: "2026-11-02T10:00:00Z",
  ramTotalMB: 32000,
  ramFreeMB: 20000,
  cpu: { model: "CPU", threads: 8 },
  gpus: [],
  drives: [
    { root: "C:\\", freeMB: 2000, totalMB: 480000 },
    { root: "D:\\", freeMB: 800000, totalMB: 1900000 },
    { root: "H:\\", freeMB: 12000000, totalMB: 76000000 },
    { root: "I:\\", freeMB: 12000000, totalMB: 76000000 },
  ],
  loaded: [],
};

function base(dir: string | null = "D:\\models") {
  routes["models.catalog"] = () => catalogRows();
  routes["models.list"] = () => [
    {
      model: "bge-m3-q8",
      label: "BGE-M3 (8-bit, CPU)",
      via: "path",
      runtime: "transformers",
      where: "D:\\models\\bge-m3",
      sizeMB: 564,
      state: "installed",
      usedBy: [],
      perf: "query 40 ms",
    },
    {
      model: "qwen3-embedding-8b-q8",
      label: "Qwen3 Embedding 8B (8-bit)",
      via: "download",
      runtime: "llamacpp",
      where: "D:\\models\\Qwen3-8B",
      sizeMB: 7700,
      state: "installed",
      usedBy: [],
    },
  ];
  routes["models.packs"] = () => packs();
  routes["models.advice"] = () => [];
  routes["rag.status"] = () => ragStatus;
  routes["models.hardware"] = () => hardware;
  routes["jobs.list"] = () => [];
  routes["models.usePack"] = (i) => ({
    pack: i.pack,
    variant: 1,
    embedding: "qwen3-embedding-4b-q4",
    reranker: "bge-reranker-v2-m3-q8",
    plan: {
      download: i.pack === "light" ? [] : [{ model: "qwen3-embedding-4b-q4", via: "download", sizeMB: 2400 }],
      dir,
      reindex: true,
      expected: "not measured on this PC yet",
    },
    jobIds: i.dryRun ? [] : ["models-usePack-1a2b"],
    dryRun: !!i.dryRun,
  });
  routes["jobs.show"] = (i) => ({
    job: { id: i.id, kind: "models-usePack", subject: "balanced", status: "done", startedAt: "", result: {} },
    events: [],
  });
}

const app = (withProject = true): AppState =>
  ({
    info: withProject
      ? { dir: "C:/p", project: { name: "P", rag: { embedding: "bge-m3" } }, xray: { fields: [], prefs: {} } }
      : null,
    xray: { fields: [], prefs: { order: [], collapsed: [], hidden: [] } },
    route: { screen: "settings", arg: "models" },
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
    openPalette: vi.fn(),
  }) as unknown as AppState;

const show = (state = app()) =>
  render(
    <AppContext.Provider value={state}>
      <ModelsSection />
    </AppContext.Provider>,
  );

describe("models helpers", () => {
  it("formats sizes", () => {
    expect(size(560)).toBe("560 MB");
    expect(size(1160)).toBe("1.1 GB");
    expect(size(12000)).toBe("12 GB");
  });

  it("suggests the heaviest pack that fits without a GGUF on the CPU, Light when the hardware is unknown", () => {
    const rows = packs();
    rows[1] = { ...rows[1], fit: fitOf("fits", "ok") };
    expect(suggestPack(rows, hardware as never, catalogRows())).toBe("balanced");
    rows[1] = { ...rows[1], fit: fitOf("fits", "ok", "cpu") };
    expect(suggestPack(rows, hardware as never, catalogRows())).toBe("light");
    expect(suggestPack(rows, null, catalogRows())).toBe("light");
    expect(suggestPack(rows, { ...hardware, ramTotalMB: 0 } as never, catalogRows())).toBe("light");
  });

  it("preselects the roomiest local drive, not a share whose figures repeat nor the system drive", () => {
    expect(bestDrive(hardware.drives, 1000)).toBe("D:\\");
    expect(bestDrive([{ root: "C:\\", freeMB: 5000, totalMB: 9000 }], 1000)).toBe("C:\\");
    expect(bestDrive([{ root: "C:\\", freeMB: 500, totalMB: 9000 }], 1000)).toBeNull();
  });
});

describe("Settings › Models — packs", () => {
  it("shows the pack cards first, the active one marked, skipped variants with their numbers, and Custom", async () => {
    base();
    show();
    const light = await screen.findByRole("article", { name: "Light pack" });
    expect(within(light).getByText("In use")).toBeInTheDocument();
    expect(within(light).getByRole("button", { name: "Using the Light pack" })).toBeDisabled();
    expect(within(light).queryByRole("button", { name: "Use the Light pack" })).toBeNull();
    expect(within(light).getByText("Installed")).toBeInTheDocument();
    expect(within(light).getByText("query 40 ms, index 6 passages/s")).toBeInTheDocument();
    const balanced = screen.getByRole("article", { name: "Balanced pack" });
    expect(within(balanced).getByText(/its second choice/)).toBeInTheDocument();
    expect(within(balanced).getByText(/9.2 GB needed, 7.0 GB usable/)).toBeInTheDocument();
    expect(within(balanced).getByText("3.0 GB")).toBeInTheDocument();
    expect(within(balanced).getByText("Not measured on this PC yet")).toBeInTheDocument();
    expect(within(balanced).getAllByText("quality not measured yet")).toHaveLength(1);
    const quality = screen.getByRole("article", { name: "Quality pack" });
    expect(within(quality).getByText("Not available on this PC")).toBeInTheDocument();
    expect(within(quality).getByRole("button", { name: "Use the Quality pack" })).toBeDisabled();
    expect(screen.getByRole("article", { name: "Custom pack" })).toBeInTheDocument();
    expect(screen.getByText("D:\\models")).toBeInTheDocument();
  });

  it("asks before a pack that is not « fits », then shows the dry-run plan, then downloads it", async () => {
    base();
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Use the Balanced pack" }));
    const ask = await screen.findByRole("dialog", { name: "Will The Balanced pack fit?" });
    expect(within(ask).getByText("Tight: 7.6 GB needed, 7.0 GB usable.")).toBeInTheDocument();
    expect(named("models.usePack").filter((c) => c.input.pack === "balanced")).toHaveLength(0);
    fireEvent.click(within(ask).getByRole("button", { name: "Use anyway" }));
    const plan = await screen.findByRole("dialog", { name: "Download the Balanced pack" });
    expect(within(plan).getByText("D:\\models")).toBeInTheDocument();
    expect(within(plan).getByText("2.3 GB")).toBeInTheDocument();
    expect(
      named("models.usePack")
        .filter((c) => c.input.pack === "balanced")
        .map((c) => c.input),
    ).toEqual([{ pack: "balanced", dryRun: true }]);
    fireEvent.click(within(plan).getByRole("button", { name: "Download 2.3 GB" }));
    await waitFor(() =>
      expect(
        named("models.usePack")
          .filter((c) => c.input.pack === "balanced")
          .at(-1)?.input,
      ).toEqual({
        pack: "balanced",
        downloadOnly: true,
      }),
    );
    await waitFor(() => expect(named("jobs.show").some((c) => c.input.id === "models-usePack-1a2b")).toBe(true));
  });

  it("« Choose a lighter one » goes to the next lighter pack", async () => {
    base();
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Use the Balanced pack" }));
    const ask = await screen.findByRole("dialog", { name: "Will The Balanced pack fit?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Choose a lighter one" }));
    await screen.findByRole("dialog", { name: "Use the Light pack" });
    expect(named("models.usePack").some((c) => c.input.pack === "balanced")).toBe(false);
  });

  it("opens the models-folder dialog on the first download, preselects D:, and never sends wait", async () => {
    base(null);
    routes["models.setDir"] = (i) => ({
      dir: i.dir,
      drive: { root: "D:\\", freeMB: 800000 },
      installedMB: 0,
      action: "set",
      files: 0,
      dryRun: !!i.dryRun,
    });
    show();
    await screen.findByText("not chosen yet");
    fireEvent.click(screen.getByRole("button", { name: "Use the Balanced pack" }));
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: /fit/ })).getByRole("button", { name: "Use anyway" }),
    );
    const dlg = await screen.findByRole("dialog", { name: "Models folder" });
    expect(within(dlg).getByText("Where should models be stored?")).toBeInTheDocument();
    await waitFor(() => expect(within(dlg).getByLabelText("Folder")).toHaveValue("D:\\Testimus\\models"));
    expect(within(dlg).getByRole("radio", { name: /^D:\\/ })).toBeChecked();
    expect(within(dlg).getByRole("radio", { name: /^C:\\/ })).toBeDisabled();
    const store = within(dlg).getByRole("button", { name: "Store models here" });
    await waitFor(() => expect(store).toBeEnabled());
    fireEvent.click(store);
    await waitFor(() => expect(named("models.setDir").filter((c) => !c.input.dryRun)).toHaveLength(1));
    for (const c of named("models.setDir")) expect(c.input).not.toHaveProperty("wait");
    expect(named("models.setDir").at(-1)?.input).toEqual({ dir: "D:\\Testimus\\models" });
  });

  it("changing the folder offers Move / Keep / Copy and shows a refusal with its reason", async () => {
    base();
    routes["models.setDir"] = (i) => {
      if (String(i.dir).startsWith("C:")) throw { message: "Not enough room on C:\\: 19 GB free, 1.3 GB needed." };
      return {
        dir: i.dir,
        drive: { root: "D:\\", freeMB: 800000 },
        installedMB: 1200,
        action: i.copy ? "copy" : i.keep ? "keep" : "move",
        files: 9,
        dryRun: !!i.dryRun,
        ...(i.dryRun ? {} : { jobId: "models-move-9" }),
      };
    };
    routes["jobs.show"] = (i) => ({
      job: { id: i.id, kind: "models-move", status: "running", startedAt: "" },
      events: [],
    });
    show();
    await screen.findByText("D:\\models");
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    const dlg = await screen.findByRole("dialog", { name: "Models folder" });
    expect(within(dlg).getByRole("button", { name: "Keep where they are" })).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText("Folder"), { target: { value: "C:\\models" } });
    expect(await within(dlg).findByText(/Not enough room on C:/)).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText("Folder"), { target: { value: "E:\\models" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Copy" }));
    const go = await within(dlg).findByRole("button", { name: "Copy 1.2 GB" });
    fireEvent.click(go);
    await waitFor(() =>
      expect(
        named("models.setDir")
          .filter((c) => !c.input.dryRun)
          .at(-1)?.input,
      ).toEqual({ dir: "E:\\models", copy: true }),
    );
    expect(await screen.findByRole("status", { name: "Copying the models" })).toBeInTheDocument();
  });

  it("refuses a model whose RAM is too small: no « Use anyway »", async () => {
    base();
    routes["models.fit"] = () => fitOf("ram-too-small", "RAM too small: 40 GB needed, 32 GB on this PC.");
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Model catalog" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Qwen3 Embedding 8B (8-bit) for this project" }));
    const ask = await screen.findByRole("dialog", { name: /fit/ });
    expect(within(ask).getByText("RAM too small: 40 GB needed, 32 GB on this PC.")).toBeInTheDocument();
    expect(within(ask).queryByRole("button", { name: "Use anyway" })).toBeNull();
    expect(named("models.use")).toHaveLength(0);
  });
});

describe("Settings › Models — table, advice", () => {
  it("keeps the models table folded until asked; rows have state, fit and actions", async () => {
    base();
    routes["models.fit"] = () =>
      fitOf("gpu-too-small", "Your GPU has 8 GB. Qwen3 Embedding 8B needs about 9.1 GB: it runs partly on the CPU.");
    routes["models.use"] = (i) => ({ choice: i, fit: fitOf("gpu-too-small", ""), reindex: true });
    show();
    const fold = await screen.findByRole("button", { name: "Model catalog" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table", { name: "Model catalog" })).toBeNull();
    fireEvent.click(fold);
    const table = await screen.findByRole("table", { name: "Model catalog" });
    const bge = within(table).getByRole("row", { name: "BGE-M3 (8-bit, CPU)" });
    expect(within(bge).getAllByText("In use")).toHaveLength(2);
    expect(within(bge).getByText("query 40 ms")).toBeInTheDocument();
    const q4 = within(table).getByRole("row", { name: "Qwen3 Embedding 4B (4-bit)" });
    expect(within(q4).getByText("Not installed")).toBeInTheDocument();
    expect(within(q4).getByRole("button", { name: "Install Qwen3 Embedding 4B (4-bit)" })).toBeEnabled();
    const q8 = within(table).getByRole("row", { name: "Qwen3 Embedding 8B (8-bit)" });
    expect(within(q8).getByText("Partly on the CPU")).toBeInTheDocument();
    fireEvent.click(within(q8).getByRole("button", { name: "Use Qwen3 Embedding 8B (8-bit) for this project" }));
    const ask = await screen.findByRole("dialog", { name: /fit/ });
    expect(within(ask).getByText(/runs partly on the CPU/)).toBeInTheDocument();
    fireEvent.click(within(ask).getByRole("button", { name: "Use anyway" }));
    await waitFor(() => expect(named("models.use")).toHaveLength(1));
    expect(named("models.use")[0].input).toEqual({ embedding: "qwen3-embedding-8b-q8", reranker: null });
  });

  it("installs with models.pull and follows the job", async () => {
    base();
    routes["models.pull"] = () => ({ jobId: "models-pull-77" });
    routes["jobs.show"] = (i) => ({
      job: { id: i.id, kind: "models-pull", status: "running", startedAt: "" },
      events: [],
    });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Model catalog" }));
    fireEvent.click(await screen.findByRole("button", { name: "Install Qwen3 Embedding 4B (4-bit)" }));
    expect(await screen.findByRole("status", { name: "Downloading Qwen3 Embedding 4B (4-bit)" })).toBeInTheDocument();
    expect(named("models.pull")[0].input).toEqual({ model: "qwen3-embedding-4b-q4" });
  });

  it("removes after a confirmation that says what is deleted", async () => {
    base();
    routes["models.remove"] = () => ({ model: "qwen3-embedding-8b-q8", removed: "files", freedMB: 7700 });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Model catalog" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove Qwen3 Embedding 8B (8-bit)" }));
    const dlg = await screen.findByRole("dialog", { name: "Remove Qwen3 Embedding 8B (8-bit)?" });
    expect(within(dlg).getByText(/7.5 GB\) are deleted from D:\\models\\Qwen3-8B/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Delete it" }));
    await waitFor(() => expect(named("models.remove")[0]?.input).toEqual({ model: "qwen3-embedding-8b-q8" }));
  });

  it("shows the advice banner with Apply and Dismiss", async () => {
    base();
    routes["models.advice"] = () => [
      {
        id: "adv-1",
        direction: "upgrade",
        from: { pack: "light" },
        to: { pack: "balanced" },
        reason: "Queries take 30 ms (p95), well under the 1 s budget.",
        quality: "quality difference not measured",
      },
    ];
    routes["models.dismiss"] = () => ({ dismissed: "adv-1" });
    show();
    const banner = await screen.findByRole("region", { name: "Advice" });
    expect(within(banner).getByText(/switch to Balanced pack/)).toBeInTheDocument();
    expect(within(banner).getByText("Queries take 30 ms (p95), well under the 1 s budget.")).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole("button", { name: "Apply" }));
    await screen.findByRole("dialog", { name: "Download the Balanced pack" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(banner).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Advice" })).toBeNull());
    expect(named("models.dismiss")[0].input).toEqual({ id: "adv-1" });
  });

  it("without a project: no packs, the shared models only", async () => {
    base();
    show(app(false));
    expect(await screen.findByText(/Open a project to choose its search pack/)).toBeInTheDocument();
    expect(named("models.packs")).toHaveLength(0);
  });

  it("shows an error state when the catalog cannot be read", async () => {
    base();
    routes["models.catalog"] = () => {
      throw { message: "catalog.json is damaged" };
    };
    show();
    expect(await screen.findByText("catalog.json is damaged")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
