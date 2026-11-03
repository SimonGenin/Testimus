// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { FirstRunScreen } from "../../src/ui/screens/setup/FirstRunScreen.tsx";

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
      return new Response(JSON.stringify(h(input) ?? null), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const named = (n: string) => calls.filter((c) => c.name === n);

const fits = (device: "gpu" | "cpu") => ({
  verdict: "fits",
  device,
  needMB: { vram: 0, ram: 0 },
  freeMB: { vram: null, ram: 0 },
  totalMB: { vram: null, ram: 0 },
  unload: [],
  message: "Fits.",
});

const row = (id: string, label: string, embedding: string, device: "gpu" | "cpu", downloadMB = 0) => ({
  id,
  label,
  intent: `${label} intent`,
  active: false,
  available: true,
  variant: 0,
  embedding,
  reranker: null,
  fit: fits(device),
  skipped: [],
  downloadMB,
  quality: "quality not measured yet",
});

function base(hw: unknown) {
  routes["models.packs"] = () => [
    row("light", "Light", "bge-m3-q8", "cpu"),
    row("performance", "Performance", "qwen3-onnx-fp16", "gpu", 1160),
    row("balanced", "Balanced", "qwen3-4b-gguf", "cpu", 4600),
  ];
  routes["models.catalog"] = () => [
    { id: "bge-m3-q8", label: "BGE-M3", runtimes: ["transformers"] },
    { id: "qwen3-onnx-fp16", label: "Qwen3 0.6B fp16", runtimes: ["transformers"] },
    { id: "qwen3-4b-gguf", label: "Qwen3 4B", runtimes: ["llamacpp"] },
  ];
  routes["models.hardware"] = () => hw;
  routes["models.planPack"] = (i) => ({
    pack: i.pack,
    variant: 0,
    embedding: "qwen3-onnx-fp16",
    reranker: null,
    plan: { download: [], dir: "D:\\models", reindex: true, expected: "" },
  });
  routes["models.usePack"] = () => ({ jobId: "models-usePack-1" });
}

const app = (withProject = true): AppState =>
  ({
    info: withProject ? { dir: "C:/p", project: { name: "P", rag: {} }, xray: { fields: [], prefs: {} } } : null,
    route: { screen: "setup", arg: "pack" },
    navigate: vi.fn(),
    refreshInfo: vi.fn(),
    closeProject: vi.fn(),
    testsChanged: vi.fn(),
  }) as unknown as AppState;

const show = (state = app()) =>
  render(
    <AppContext.Provider value={state}>
      <FirstRunScreen />
    </AppContext.Provider>,
  );

describe("First launch › Search pack", () => {
  it("is the third step: no verdict until the machine is analysed, then the heaviest pack that fits without a GGUF on the CPU", async () => {
    base({
      system: { platform: "darwin", arch: "arm64" },
      ramTotalMB: 32768,
      ramFreeMB: 14336,
      cpu: { model: "Apple M2 Pro", threads: 12 },
      drives: [],
      gpus: [],
    });
    const state = app();
    show(state);
    expect(screen.getByRole("button", { name: /Search pack/ })).toBeInTheDocument();
    const perf = await screen.findByRole("radio", { name: "Performance pack" });
    expect(perf).not.toBeChecked();
    expect(screen.queryByText("Fits")).toBeNull();
    expect(screen.queryByText("Suggested for this PC")).toBeNull();
    expect(screen.getByText(/Not analysed yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Analyse my machine" }));
    await waitFor(() => expect(perf).toBeChecked());
    expect(named("models.hardware").map((c) => c.input)).toEqual([{ refresh: true }]);
    expect(screen.getByText("Suggested for this PC")).toBeInTheDocument();
    expect(screen.getAllByText("Fits")).toHaveLength(3);
    const facts = screen.getByRole("list", { name: "This machine" });
    expect(facts).toHaveTextContent("macOS · arm64");
    expect(facts).toHaveTextContent("Apple M2 Pro, 12 threads");
    expect(facts).toHaveTextContent("32 GB of memory, 14 GB free");
    expect(facts).toHaveTextContent("No GPU Testimus can use here: search runs on the processor");
    expect(screen.getByRole("button", { name: "Analyse again" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use Performance" }));
    await waitFor(() =>
      expect(calls.filter((c) => /^models\.(planPack|usePack)$/.test(c.name)).map((c) => [c.name, c.input])).toEqual([
        ["models.planPack", { pack: "performance" }],
        ["models.usePack", { pack: "performance" }],
      ]),
    );
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("documents"));
  });

  it("says when a pack made for a GPU runs on the processor, and when a model never ran on this system", async () => {
    base({
      system: { platform: "darwin", arch: "x64" },
      ramTotalMB: 65536,
      ramFreeMB: 15360,
      cpu: { model: "Intel(R) Core(TM) i9-9980HK CPU @ 2.40GHz", threads: 16 },
      drives: [],
      gpus: [],
    });
    routes["models.packs"] = () => [
      { ...row("light", "Light", "bge-m3-q8", "cpu"), suggested: true },
      { ...row("performance", "Performance", "qwen3-onnx-fp16", "cpu", 600), variant: 1, processorOnly: true },
      {
        ...row("balanced", "Balanced", "qwen3-onnx-fp16", "cpu", 1100),
        fit: { ...fits("cpu"), verdict: "untested", message: "Not proven on macOS x64." },
      },
    ];
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Analyse my machine" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Light pack" })).toBeChecked());
    expect(screen.getAllByText("Processor only")).toHaveLength(1);
    expect(screen.getByText(/Made for a GPU: here it runs on the processor, several times slower/)).toBeInTheDocument();
    expect(screen.getByText("Untested here")).toBeInTheDocument();
    expect(screen.getByText(/Never run on this system yet: Testimus tries it after the download/)).toBeInTheDocument();
  });

  it("an analysis that fails preselects nothing, and the step can be skipped", async () => {
    base(null);
    routes["models.hardware"] = () => {
      throw new Error("unknown");
    };
    const state = app();
    show(state);
    const light = await screen.findByRole("radio", { name: "Light pack" });
    fireEvent.click(screen.getByRole("button", { name: "Analyse my machine" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Analyse my machine" })).toBeEnabled());
    expect(light).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Use this pack" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(state.navigate).toHaveBeenCalledWith("documents");
    expect(named("models.usePack")).toHaveLength(0);
  });

  it("asks for a project first", () => {
    base(null);
    const state = app(false);
    show(state);
    expect(screen.getByText(/Open or create a project first/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Project" }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "project");
  });
});
