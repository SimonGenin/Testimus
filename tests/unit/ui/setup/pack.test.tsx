// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstRunScreen } from "../../../../src/ui/screens/setup/FirstRunScreen.tsx";
import { PackStep } from "../../../../src/ui/screens/setup/PackStep.tsx";
import { callsOf, fakeEvents, fakeNet, net, withApp } from "../../cov-uishell-helpers.tsx";

const toasts = vi.hoisted(() => ({ toast: vi.fn(), errorToast: vi.fn() }));
vi.mock("../../../../src/ui/lib/toast.ts", () => toasts);

vi.mock("../../../../src/ui/screens/settings/models/FolderDialog.tsx", () => ({
  FolderDialog: ({ needMB, onClose, onApplied }: { needMB: number; onClose: () => void; onApplied: () => void }) => (
    <div role="dialog" aria-label="Folder">
      <span>need {needMB}</span>
      <button type="button" onClick={onClose}>
        Close folder
      </button>
      <button type="button" onClick={onApplied}>
        Apply folder
      </button>
    </div>
  ),
}));

const details = () => toasts.toast.mock.calls.map((a) => a[0].detail);
const errors = () => toasts.errorToast.mock.calls.map((a) => a[1]);

beforeEach(() => {
  fakeNet();
  fakeEvents();
  toasts.toast.mockClear();
  toasts.errorToast.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const radio = (name: string) => screen.getByRole("radio", { name: new RegExp(`^${name}\\b`) });
const card = (name: string) => radio(name).closest("label") as HTMLElement;

const fit = { verdict: "fits", device: "cpu", needMB: {}, freeMB: {}, totalMB: {}, unload: [], message: "Fits." };
const pack = (over: Record<string, unknown>) => ({
  id: "light",
  label: "Light",
  intent: "Small",
  active: false,
  available: true,
  variant: 0,
  embedding: "e1",
  reranker: null,
  fit,
  skipped: [],
  downloadMB: 0,
  quality: "",
  ...over,
});
const packPlan = (download: { sizeMB: number }[], dir: string | null) => (i: Record<string, unknown>) => ({
  pack: i.pack,
  variant: 0,
  embedding: "e1",
  reranker: null,
  plan: { download, dir, reindex: true, expected: "" },
});

describe("First launch › Search pack", () => {
  it("describes each pack: suggested, in use, models, download, unavailable", async () => {
    net.routes["models.packs"] = () => [
      pack({ id: "quality", label: "Quality", available: false, embedding: null, skipped: ["needs a GPU"] }),
      pack({ id: "balanced", label: "Balanced", available: false, skipped: [] }),
      pack({ id: "performance", label: "Performance", suggested: true, reranker: "r1", downloadMB: 2048 }),
      pack({ id: "light", active: true }),
    ];
    net.routes["models.catalog"] = () => [{ id: "e1", label: "Embed One", runtimes: ["transformers"] }];
    net.routes["models.hardware"] = () => ({
      ramTotalMB: 16384,
      ramFreeMB: 8192,
      cpu: { model: "Core", threads: 8 },
      gpus: [{ name: "RTX", vramTotalMB: 8192, vramUsedMB: 1024 }],
      drives: [],
    });
    withApp(<PackStep onBack={vi.fn()} />);
    await screen.findByRole("radiogroup", { name: "Search packs" });
    fireEvent.click(screen.getByRole("button", { name: "Analyse my machine" }));
    expect(await screen.findByText("RTX, 8.0 GB (7.0 GB free)")).toBeInTheDocument();
    expect(screen.getByText("Windows")).toBeInTheDocument();
    expect(radio("Performance")).toBeChecked();
    expect(card("Performance")).toHaveTextContent("Suggested for this PC");
    expect(screen.getByText("Not available on this PC: needs a GPU")).toBeInTheDocument();
    expect(screen.getByText("Not available on this PC")).toBeInTheDocument();
    expect(screen.getByText("Embed One + r1 · 2.0 GB to download")).toBeInTheDocument();
    expect(screen.getByText("Embed One · nothing to download")).toBeInTheDocument();
    expect(card("Light")).toHaveTextContent("In use");
    expect(radio("Quality")).toBeDisabled();
    fireEvent.click(radio("Light"));
    expect(screen.getByRole("button", { name: "Use Light" })).toBeEnabled();
  });

  it("shows the loading state, then the error when the packs cannot be read", async () => {
    withApp(<PackStep onBack={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Loading the packs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this pack" })).toBeDisabled();
    expect(await screen.findByText("The packs could not be read")).toBeInTheDocument();
    expect(screen.getByText("Unknown command models.packs")).toBeInTheDocument();
  });

  it("an empty answer leaves no pack to use", async () => {
    net.routes["models.packs"] = () => null;
    net.routes["models.catalog"] = () => null;
    withApp(<PackStep onBack={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading the packs" })).toBeNull());
    expect(screen.getByRole("button", { name: "Use this pack" })).toBeDisabled();
    expect(screen.getByRole("radiogroup", { name: "Search packs" })).toBeEmptyDOMElement();
  });

  it("asks for a models folder before a download, then uses the pack", async () => {
    let dir: string | null = null;
    net.routes["models.packs"] = () => [pack({ downloadMB: 300 })];
    net.routes["models.catalog"] = () => [];
    net.routes["models.planPack"] = (i) => packPlan([{ sizeMB: 100 }, { sizeMB: 200 }], dir)(i);
    net.routes["models.usePack"] = () => ({ jobId: "models-usePack-1" });
    const { state } = withApp(<PackStep onBack={vi.fn()} />);
    await screen.findByRole("radiogroup", { name: "Search packs" });
    fireEvent.click(radio("Light"));
    fireEvent.click(screen.getByRole("button", { name: "Use Light" }));
    expect(await screen.findByText("need 300")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close folder" }));
    expect(screen.queryByRole("dialog", { name: "Folder" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use Light" }));
    await screen.findByText("need 300");
    dir = "D:/models";
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("documents"));
    expect(details()).toContain("Downloading in the background: see Jobs");
    expect(callsOf("models.usePack").at(-1)?.input).toEqual({ pack: "light" });
  });

  it("uses a pack with nothing to download, and reports a failure", async () => {
    net.routes["models.packs"] = () => [pack({})];
    net.routes["models.catalog"] = () => [];
    net.routes["models.planPack"] = packPlan([], null);
    net.routes["models.usePack"] = () => ({ jobId: "models-usePack-2" });
    const { state } = withApp(<PackStep onBack={vi.fn()} />);
    await screen.findByRole("radiogroup", { name: "Search packs" });
    fireEvent.click(radio("Light"));
    fireEvent.click(screen.getByRole("button", { name: "Use Light" }));
    await waitFor(() => expect(details()).toContain("Indexing follows"));
    expect(state.navigate).toHaveBeenCalledWith("documents");
    delete net.routes["models.usePack"];
    fireEvent.click(screen.getByRole("button", { name: "Use Light" }));
    await waitFor(() => expect(errors()).toContain("Could not use the Light pack"));
  });

  it("Back calls back", async () => {
    const onBack = vi.fn();
    net.routes["models.packs"] = () => [];
    withApp(<PackStep onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });
});

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
  net.routes["models.packs"] = () => [
    row("light", "Light", "bge-m3-q8", "cpu"),
    row("performance", "Performance", "qwen3-onnx-fp16", "gpu", 1160),
    row("balanced", "Balanced", "qwen3-4b-gguf", "cpu", 4600),
  ];
  net.routes["models.catalog"] = () => [
    { id: "bge-m3-q8", label: "BGE-M3", runtimes: ["transformers"] },
    { id: "qwen3-onnx-fp16", label: "Qwen3 0.6B fp16", runtimes: ["transformers"] },
    { id: "qwen3-4b-gguf", label: "Qwen3 4B", runtimes: ["llamacpp"] },
  ];
  net.routes["models.hardware"] = () => hw;
  net.routes["models.planPack"] = (i) => ({
    pack: i.pack,
    variant: 0,
    embedding: "qwen3-onnx-fp16",
    reranker: null,
    plan: { download: [], dir: "D:\\models", reindex: true, expected: "" },
  });
  net.routes["models.usePack"] = () => ({ jobId: "models-usePack-1" });
}

const show = (withProject = true) =>
  withApp(<FirstRunScreen />, {
    route: { screen: "setup", arg: "pack" },
    ...(withProject ? {} : { info: null }),
  });

describe("First launch › Search pack, as the third step", () => {
  it("no verdict until the machine is analysed, then the heaviest pack that fits without a GGUF on the CPU", async () => {
    base({
      system: { platform: "darwin", arch: "arm64" },
      ramTotalMB: 32768,
      ramFreeMB: 14336,
      cpu: { model: "Apple M2 Pro", threads: 12 },
      drives: [],
      gpus: [],
    });
    const { state } = show();
    expect(screen.getByRole("button", { name: /Search pack/ })).toBeInTheDocument();
    await screen.findByRole("radiogroup", { name: "Search packs" });
    const perf = radio("Performance");
    expect(perf).not.toBeChecked();
    expect(screen.queryByText("Fits")).toBeNull();
    expect(screen.queryByText("Suggested for this PC")).toBeNull();
    expect(screen.getByText(/Not analysed yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Analyse my machine" }));
    await waitFor(() => expect(radio("Performance")).toBeChecked());
    expect(callsOf("models.hardware").map((c) => c.input)).toEqual([{ refresh: true }]);
    expect(screen.getByText("Suggested for this PC")).toBeInTheDocument();
    expect(screen.getAllByText("Fits")).toHaveLength(3);
    const facts = screen.getByLabelText("This machine");
    expect(facts).toHaveTextContent("macOS · arm64");
    expect(facts).toHaveTextContent("Apple M2 Pro, 12 threads");
    expect(facts).toHaveTextContent("32 GB of memory, 14 GB free");
    expect(facts).toHaveTextContent("No GPU Testimus can use here: search runs on the processor");
    expect(screen.getByRole("button", { name: "Analyse again" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use Performance" }));
    await waitFor(() =>
      expect(
        net.calls.filter((c) => /^models\.(planPack|usePack)$/.test(c.name)).map((c) => [c.name, c.input]),
      ).toEqual([
        ["models.planPack", { pack: "performance" }],
        ["models.usePack", { pack: "performance" }],
      ]),
    );
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("documents"));
  });

  it("reads the machine again on Analyse again", async () => {
    base({ ramTotalMB: 8192, ramFreeMB: 4096, cpu: { model: "Core", threads: 4 }, drives: [], gpus: [] });
    show();
    await screen.findByRole("radiogroup", { name: "Search packs" });
    fireEvent.click(screen.getByRole("button", { name: "Analyse my machine" }));
    fireEvent.click(await screen.findByRole("button", { name: "Analyse again" }));
    await waitFor(() => expect(callsOf("models.hardware")).toHaveLength(2));
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
    net.routes["models.packs"] = () => [
      { ...row("light", "Light", "bge-m3-q8", "cpu"), suggested: true },
      { ...row("performance", "Performance", "qwen3-onnx-fp16", "cpu", 600), variant: 1, processorOnly: true },
      {
        ...row("balanced", "Balanced", "qwen3-onnx-fp16", "cpu", 1100),
        fit: { ...fits("cpu"), verdict: "untested", message: "Not proven on macOS x64." },
      },
    ];
    show();
    await screen.findByRole("radiogroup", { name: "Search packs" });
    fireEvent.click(screen.getByRole("button", { name: "Analyse my machine" }));
    await waitFor(() => expect(radio("Light")).toBeChecked());
    expect(screen.getAllByText("Processor only")).toHaveLength(1);
    expect(screen.getByText(/Made for a GPU: here it runs on the processor, several times slower/)).toBeInTheDocument();
    expect(within(card("Balanced")).getByText("Untested here")).toBeInTheDocument();
    expect(screen.getByText(/Never run on this system yet: Testimus tries it after the download/)).toBeInTheDocument();
  });

  it("an analysis that fails preselects nothing, and the step can be skipped", async () => {
    base(null);
    net.routes["models.hardware"] = () => {
      throw new Error("unknown");
    };
    const { state } = show();
    await screen.findByRole("radiogroup", { name: "Search packs" });
    fireEvent.click(screen.getByRole("button", { name: "Analyse my machine" }));
    await waitFor(() => expect(errors()).toContain("Could not analyse this machine"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Analyse my machine" })).toBeEnabled());
    expect(radio("Light")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Use this pack" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(state.navigate).toHaveBeenCalledWith("documents");
    expect(callsOf("models.usePack")).toHaveLength(0);
  });

  it("asks for a project first", () => {
    base(null);
    const { state } = show(false);
    expect(screen.getByText(/Open or create a project first/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Project" }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "project");
    expect(callsOf("models.packs")).toHaveLength(0);
  });
});
