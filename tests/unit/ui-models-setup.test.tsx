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
  routes["models.usePack"] = (i) => ({
    pack: i.pack,
    variant: 0,
    embedding: "qwen3-onnx-fp16",
    reranker: null,
    plan: { download: [], dir: "D:\\models", reindex: true, expected: "" },
    jobIds: i.dryRun ? [] : ["rag-index-1"],
    dryRun: !!i.dryRun,
  });
}

const app = (withProject = true): AppState =>
  ({
    info: withProject ? { dir: "C:/p", project: { name: "P", rag: {} }, xray: { fields: [], prefs: {} } } : null,
    route: { screen: "setup", arg: "pack" },
    navigate: vi.fn(),
    refreshInfo: vi.fn(),
    testsChanged: vi.fn(),
  }) as unknown as AppState;

const show = (state = app()) =>
  render(
    <AppContext.Provider value={state}>
      <FirstRunScreen />
    </AppContext.Provider>,
  );

describe("First launch › Search pack", () => {
  it("is the third step and preselects the heaviest pack that fits without a GGUF on the CPU", async () => {
    base({ ramTotalMB: 32000, drives: [], gpus: [] });
    const state = app();
    show(state);
    expect(screen.getByRole("button", { name: /Search pack/ })).toBeInTheDocument();
    const perf = await screen.findByRole("radio", { name: "Performance pack" });
    expect(perf).toBeChecked();
    expect(screen.getByText("Suggested for this PC")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use Performance" }));
    await waitFor(() =>
      expect(named("models.usePack").map((c) => c.input)).toEqual([
        { pack: "performance", dryRun: true },
        { pack: "performance" },
      ]),
    );
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("documents"));
  });

  it("suggests Light when the hardware is unknown, and can be skipped", async () => {
    base(null);
    routes["models.hardware"] = () => {
      throw new Error("unknown");
    };
    const state = app();
    show(state);
    expect(await screen.findByRole("radio", { name: "Light pack" })).toBeChecked();
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
