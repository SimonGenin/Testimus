// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fit } from "../../../../src/core/types.ts";
import { absolutePath } from "../../../../src/ui/lib/desktop.ts";
import { AddFolder } from "../../../../src/ui/screens/settings/models/AddFolder.tsx";
import {
  aboutModel,
  aboutSpeech,
  bestDrive,
  type CatalogRow,
  choiceLabel,
  defaultFolder,
  folderPicker,
  hourIn,
  onDrive,
  type PackRow,
  roomOf,
  runsOn,
  type SpeechModel,
  size,
} from "../../../../src/ui/screens/settings/models/data.ts";
import { FitConfirm, fitNumbers, fitTitle } from "../../../../src/ui/screens/settings/models/FitConfirm.tsx";
import { FolderDialog } from "../../../../src/ui/screens/settings/models/FolderDialog.tsx";
import { Here, type ModelLine, ModelTable } from "../../../../src/ui/screens/settings/models/ModelTable.tsx";
import { OpLine } from "../../../../src/ui/screens/settings/models/OpLine.tsx";
import { PackCard } from "../../../../src/ui/screens/settings/models/PackCard.tsx";
import { PackPlanDialog } from "../../../../src/ui/screens/settings/models/PackPlanDialog.tsx";
import { iconsIn } from "../../helpers/icons.ts";
import { fakeDesktop } from "../../helpers/ui-desktop.tsx";
import { calls, Fail, fakeJob, fakeNet, hold, inputs, label, mountSettings, net, reset } from "./helpers.tsx";

beforeEach(fakeNet);
afterEach(reset);

const fitOf = (verdict: Fit["verdict"], message = "m", over: Partial<Fit> = {}): Fit => ({
  verdict,
  device: "gpu",
  needMB: { vram: 0, ram: 0 },
  freeMB: { vram: null, ram: 0 },
  totalMB: { vram: null, ram: 0 },
  unload: [],
  message,
  ...over,
});

const pack = (id: string, over: Partial<PackRow> = {}): PackRow => ({
  processorOnly: false,
  lighter: null,
  suggested: false,
  id,
  label: id[0].toUpperCase() + id.slice(1),
  intent: "",
  active: false,
  chosen: false,
  available: true,
  variant: 0,
  embedding: "e",
  reranker: null,
  models: [{ id: "e", label: "Embed", kind: "embedding", installed: true }],
  device: "cpu",
  installed: "all",
  fit: fitOf("fits"),
  notes: [],
  downloadMB: 0,
  quality: "q",
  measuredHere: false,
  ...over,
});

const row = (id: string, over: Partial<CatalogRow> = {}): CatalogRow =>
  ({
    id,
    kind: "embedding",
    label: `Label ${id}`,
    tier: "light",
    runtimes: ["transformers"],
    quantization: "q8",
    dims: 1024,
    sizeMB: 500,
    state: "available",
    fit: fitOf("fits"),
    ...over,
  }) as CatalogRow;

describe("models data helpers", () => {
  it("sizes, labels, defaults", () => {
    expect(size(2 * 1024 * 1024)).toBe("2.0 TB");
    expect(size(20480)).toBe("20 GB");
    expect(size(-3)).toBe("0 MB");
    expect(choiceLabel(null, (x) => x)).toBe("Not set");
    expect(choiceLabel({ pack: "balanced" }, (x) => x)).toBe("Balanced pack");
    expect(choiceLabel({ embedding: "e", reranker: "r" } as never, (x) => x.toUpperCase())).toBe("E + R");
    expect(choiceLabel({ embedding: "e", reranker: null } as never, (x) => x)).toBe("e");
    expect(defaultFolder("D:\\\\")).toBe("D:\\Testimus\\models");
    expect(defaultFolder("/Volumes/X/")).toBe("/Volumes/X/Testimus/models");
    expect(onDrive("D:\\m", "D:\\")).toBe(true);
    expect(onDrive("/Volumes/X/m", "/Volumes/X")).toBe(true);
    expect(onDrive("/Users/m", "/Volumes/X")).toBe(false);
  });

  it("folderPicker uses the bridge when there is one", async () => {
    expect(folderPicker()).toBeNull();
    const d = fakeDesktop({ folder: "E:\\m" });
    const pick = folderPicker();
    expect(await pick?.({ title: "t" })).toBe("E:\\m");
    expect(d.pickFolder).toHaveBeenCalledWith({ title: "t" });
    (window.testimusDesktop as unknown as { pickFolder?: unknown }).pickFolder = undefined;
    expect(folderPicker()).toBeNull();
  });

  it("formats sizes, preselects the roomiest local drive, accepts folders on Windows and on macOS or Linux", () => {
    expect(size(560)).toBe("560 MB");
    expect(size(1160)).toBe("1.1 GB");
    expect(size(12000)).toBe("12 GB");
    const drives = [
      { root: "C:\\", freeMB: 2000, totalMB: 480000 },
      { root: "D:\\", freeMB: 800000, totalMB: 1900000 },
      { root: "H:\\", freeMB: 12000000, totalMB: 76000000 },
      { root: "I:\\", freeMB: 12000000, totalMB: 76000000 },
    ];
    expect(bestDrive(drives as never, 1000)).toBe("D:\\");
    expect(bestDrive([{ root: "C:\\", freeMB: 5000, totalMB: 9000 }] as never, 1000)).toBe("C:\\");
    expect(bestDrive([{ root: "C:\\", freeMB: 500, totalMB: 9000 }] as never, 1000)).toBeNull();
    expect(defaultFolder("/Users/ana")).toBe("/Users/ana/Testimus/models");
    expect(["D:\\x", "d:/x", "\\\\server\\x", "/Users/ana/x"].every(absolutePath)).toBe(true);
    expect(["x", "Testimus\\models", "~/x"].some(absolutePath)).toBe(false);
    expect(onDrive("/Users/anabel/x", "/Users/ana")).toBe(false);
    expect(onDrive("d:/x", "D:\\")).toBe(true);
  });

  it("bestDrive falls back on the system drive, then on a share", () => {
    expect(bestDrive([{ root: "C:\\", freeMB: 900, totalMB: 1000 }] as never, 100)).toBe("C:\\");
    expect(
      bestDrive(
        [
          { root: "X:\\", freeMB: 900, totalMB: 1000 },
          { root: "Y:\\", freeMB: 900, totalMB: 1000 },
        ] as never,
        100,
      ),
    ).toBe("X:\\");
    expect(bestDrive([], 100)).toBeNull();
  });
});

describe("small model widgets", () => {
  it("OpLine shows the job's progress and cancels it; without a job, no cancel", async () => {
    const j = fakeJob({ id: "models-pull-00000001", kind: "models-pull", message: "Starting" });
    net.routes["jobs.cancel"] = () => ({ cancelled: true });
    const r = mountSettings(<OpLine op={{ key: "k", jobId: j.id, label: "Downloading", kind: "models-pull" }} />);
    await j.progress("half", 5, 10);
    expect(await screen.findByText("Downloading · 50 %")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Downloading" })).toHaveAttribute("aria-valuenow", "50");
    const stop = within(screen.getByRole("status", { name: "Downloading" })).getByRole("button", { name: "Cancel" });
    expect(stop).toHaveTextContent("Cancel");
    expect(iconsIn(stop)).toEqual(["stop"]);
    fireEvent.click(stop);
    await waitFor(() => expect(inputs("jobs.cancel")).toEqual([{ id: j.id }]));
    r.unmount();
    const c = mountSettings(
      <OpLine op={{ key: "k", jobId: j.id, label: "Downloading", kind: "models-pull" }} compact />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).not.toHaveTextContent("Cancel");
    c.unmount();
    mountSettings(<OpLine op={{ key: "k", jobId: "", label: "Verifying", kind: "models-verify" }} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("FitConfirm: refused, partly on the CPU with its own message, unload list, no lighter", () => {
    const props = { name: "Big", short: "Big", lighter: null, onUse: vi.fn(), onLighter: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<FitConfirm {...props} fit={fitOf("ram-too-small", "No RAM")} />);
    expect(screen.getByRole("dialog", { name: "Big cannot run on this PC" })).toBeInTheDocument();
    expect(screen.getByText("RAM too small")).toBeInTheDocument();
    expect(iconsIn(screen.getByText("RAM too small")), "audit icons 101").toEqual(["alert-circle"]);
    expect(screen.queryByRole("button", { name: "Use anyway" })).toBeNull();
    expect(screen.getByRole("button", { name: "Choose a lighter one" })).toBeDisabled();
    rerender(
      <FitConfirm {...props} fit={fitOf("gpu-too-small", "It runs on the processor", { unload: ["a", "b"] })} />,
    );
    expect(screen.getByRole("dialog", { name: "Use Big anyway?" })).toBeInTheDocument();
    expect(screen.getByText("Partly on the processor")).toBeInTheDocument();
    expect(screen.queryByText(/several times slower/)).toBeNull();
    expect(screen.getByText("a, b")).toBeInTheDocument();
    rerender(<FitConfirm {...props} fit={fitOf("gpu-too-small", "GPU small")} lighter="Small" />);
    expect(screen.getByText(/several times slower/)).toBeInTheDocument();
    expect(screen.getByText("Lighter choice: Small.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use anyway" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a lighter one" }));
    expect(props.onUse).toHaveBeenCalled();
    expect(props.onLighter).toHaveBeenCalled();
  });

  it("FitConfirm: what it needs against what is free, on the GPU or in memory; a GPU pack on the processor", () => {
    const props = {
      name: "the Q pack",
      short: "Q",
      lighter: null,
      onUse: vi.fn(),
      onLighter: vi.fn(),
      onClose: vi.fn(),
    };
    const gpu = fitOf("gpu-too-small", "m", {
      needMB: { vram: 4710, ram: 0 },
      freeMB: { vram: 3789, ram: 9000 },
      totalMB: { vram: 4096, ram: 16000 },
    });
    expect(fitNumbers(gpu)).toEqual([
      ["4.6 GB", "needed on the GPU"],
      ["3.7 GB", "free on this PC's GPU (4.0 GB in all)"],
    ]);
    const { rerender } = render(<FitConfirm {...props} fit={gpu} />);
    const ask = screen.getByRole("dialog", { name: "Use the Q pack anyway?" });
    expect(ask).toHaveTextContent("4.6 GBneeded on the GPU");
    const cpu = fitOf("fits", "Runs on the processor.", {
      device: "cpu",
      needMB: { vram: 0, ram: 2355 },
      freeMB: { vram: null, ram: 4096 },
      totalMB: { vram: null, ram: 6144 },
    });
    expect(fitNumbers(cpu)).toEqual([
      ["2.3 GB", "of memory needed"],
      ["4.0 GB", "free on this PC's memory (6.0 GB in all)"],
    ]);
    rerender(<FitConfirm {...props} fit={cpu} processorOnly />);
    expect(screen.getByRole("dialog", { name: "Use the Q pack on the processor?" })).toBeInTheDocument();
    expect(screen.getByText("Processor only")).toBeInTheDocument();
    expect(screen.getAllByText(/Made for a GPU/)).toHaveLength(2);
    expect(fitNumbers(fitOf("unknown"))).toEqual([]);
    expect(fitTitle("x", "X", fitOf("unsupported"), true)).toBe("X cannot run on this PC");
  });

  it("PackCard says what the core says: models and where they run, installed, in use, the notes", () => {
    const { rerender } = render(
      <PackCard
        pack={pack("quality", {
          active: true,
          models: [
            { id: "e", label: "Embed 8B", kind: "embedding", installed: true },
            { id: "r", label: "Rerank 4B", kind: "reranker", installed: true },
          ],
          device: "gpu",
          notes: [
            "Chosen here: the first variant that fits (12.0 GB GPU).",
            "Variant « big » not chosen: needs 16 GB.",
          ],
        })}
      />,
    );
    const card = screen.getByRole("article", { name: "Quality pack" });
    expect(card).toHaveTextContent("Embed 8B + Rerank 4B · GPU");
    expect(within(card).getByText("In use")).toBeInTheDocument();
    expect(within(card).getByText("Installed")).toBeInTheDocument();
    expect(within(card).queryByText("Not in use")).toBeNull();
    expect(within(within(card).getByRole("list", { name: "On this PC" })).getAllByRole("listitem")).toHaveLength(2);
    rerender(<PackCard pack={pack("light", { processorOnly: true, fit: fitOf("tight", "Tight: close programs.") })} />);
    const light = screen.getByRole("article", { name: "Light pack" });
    expect(within(light).getByText("Not in use")).toBeInTheDocument();
    expect(within(light).getByText("Processor only")).toBeInTheDocument();
    expect(within(light).getByText("Tight")).toBeInTheDocument();
    rerender(
      <PackCard
        pack={pack("light", { installed: "none", downloadMB: 560, notes: ["Fits this PC · 560 MB to download."] })}
        judged={false}
      />,
    );
    expect(screen.getByText("Not installed")).toBeInTheDocument();
    expect(screen.getByText("560 MB to download")).toBeInTheDocument();
    expect(screen.queryByText("Fits this PC · 560 MB to download.")).toBeNull();
    rerender(
      <PackCard
        pack={pack("quality", {
          available: false,
          models: [],
          device: null,
          notes: ["Not available on this PC: no runtime here."],
        })}
      />,
    );
    expect(screen.getByText("Not available on this PC: no runtime here.")).toBeInTheDocument();
    expect(screen.queryByText("Installed")).toBeNull();
  });

  it("PackCard as a radio among packs, suggested", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<PackCard pack={pack("balanced")} pick={{ checked: false, onSelect }} suggested />);
    expect(screen.getByText("Suggested for this PC")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio"));
    expect(onSelect).toHaveBeenCalledWith("balanced");
    rerender(<PackCard pack={pack("balanced", { speed: "fast" })} facts />);
    expect(screen.getByText("fast")).toBeInTheDocument();
  });

  it("PackPlanDialog: downloads into a folder not chosen yet, a reranker, nothing to reindex", () => {
    const onChangeFolder = vi.fn();
    const onConfirm = vi.fn();
    const out = {
      pack: "balanced",
      variant: 0,
      embedding: "e",
      reranker: "r",
      plan: { download: [{ model: "e", sizeMB: 2048 }], dir: null, reindex: false, expected: "fast" },
    };
    const { rerender } = render(
      <PackPlanDialog
        pack={pack("balanced")}
        out={out}
        label={(x) => `L-${x}`}
        busy={false}
        onConfirm={onConfirm}
        onChangeFolder={onChangeFolder}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Download the Balanced pack" })).toBeInTheDocument();
    expect(screen.getByText("Not chosen yet")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("L-e + L-r");
    expect(screen.getByText(/nothing to rebuild/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(onChangeFolder).toHaveBeenCalled();
    expect(iconsIn(screen.getByRole("button", { name: "Download 2.0 GB" })), "audit icons 112").toEqual(["download"]);
    fireEvent.click(screen.getByRole("button", { name: "Download 2.0 GB" }));
    expect(onConfirm).toHaveBeenCalled();
    rerender(
      <PackPlanDialog
        pack={pack("balanced")}
        out={{ ...out, plan: { ...out.plan, download: [], dir: "D:\\m", reindex: true } }}
        label={(x) => x}
        busy
        onConfirm={onConfirm}
        onChangeFolder={onChangeFolder}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Use the Balanced pack" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Balanced" })).toHaveAttribute("aria-busy", "true");
    onConfirm.mockClear();
    rerender(
      <PackPlanDialog
        pack={pack("balanced")}
        out={{ ...out, plan: { ...out.plan, download: [], dir: "D:\\m", reindex: true } }}
        label={(x) => x}
        busy={false}
        onConfirm={onConfirm}
        onChangeFolder={onChangeFolder}
        onClose={vi.fn()}
      />,
    );
    expect(iconsIn(screen.getByRole("button", { name: "Use Balanced" }))).toEqual(["check"]);
    expect(screen.getByText(/The documents are indexed again/)).toBeInTheDocument();
  });

  it("ModelTable: what each model is and its one gesture; check and remove on this PC; a job on a row; in use", () => {
    const use = vi.fn();
    const check = vi.fn();
    const remove = vi.fn();
    const line = (id: string, over: Partial<ModelLine> = {}): ModelLine => ({
      id,
      label: `Label ${id}`,
      note: `about ${id}`,
      runsOn: "Card, 1.4 GB",
      sizeMB: 1100,
      here: <Here state="available" />,
      inUse: false,
      op: null,
      use: { disabled: false, onClick: () => use(id) },
      ...over,
    });
    mountSettings(
      <ModelTable
        label="Embedding models"
        busy={false}
        extra={{ label: "An hour of video", render: (l) => `hour ${l.id}` }}
        lines={[
          line("a", { here: <Here state="verified" />, check, remove }),
          line("b", {
            here: <Here state="downloading" />,
            op: { key: "b", jobId: "", label: "Downloading b", kind: "models-pull" },
          }),
          line("c", { here: <Here state="active" />, inUse: true, remove }),
          line("d", { why: "Tight: 7.6 GB needed, 7.0 GB usable." }),
          line("e", { off: true, why: "Not offered here.", use: { disabled: "Not offered here", onClick: vi.fn() } }),
        ]}
      />,
    );
    const table = screen.getByRole("table", { name: "Embedding models" });
    expect(within(table).getByRole("columnheader", { name: "An hour of video" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "On this PC" })).toBeInTheDocument();
    const a = within(table).getByRole("row", { name: /Label a/ });
    expect(within(a).getByText("about a")).toBeInTheDocument();
    expect(within(a).getByText("Card, 1.4 GB")).toBeInTheDocument();
    expect(within(a).getByText("1.1 GB")).toBeInTheDocument();
    expect(within(a).getByText("hour a")).toBeInTheDocument();
    expect(within(a).getByText("Verified")).toBeInTheDocument();
    fireEvent.click(within(a).getByRole("button", { name: "Check" }));
    expect(check).toHaveBeenCalled();
    fireEvent.click(within(a).getByRole("button", { name: "Remove" }));
    expect(remove).toHaveBeenCalled();
    fireEvent.click(within(a).getByRole("button", { name: "Use" }));
    expect(use).toHaveBeenCalledWith("a");
    const b = within(table).getByRole("row", { name: /Label b/ });
    expect(within(b).getByText("Downloading")).toBeInTheDocument();
    expect(within(b).getByRole("status", { name: "Downloading b" })).toBeInTheDocument();
    expect(within(b).queryByRole("button", { name: "Use" })).toBeNull();
    const c = within(table).getByRole("row", { name: /Label c/ });
    expect(within(c).getByText("In use")).toBeInTheDocument();
    expect(within(c).getByText("Installed")).toBeInTheDocument();
    expect(within(c).queryByRole("button", { name: "Use" })).toBeNull();
    expect(within(c).getByRole("button", { name: "Remove" })).toBeDisabled();
    const d = within(table).getByRole("row", { name: /Label d/ });
    expect(within(d).getByText("Not installed")).toBeInTheDocument();
    expect(within(d).getByText("Tight: 7.6 GB needed, 7.0 GB usable.")).toBeInTheDocument();
    expect(within(d).queryByRole("button", { name: "Check" })).toBeNull();
    const e = within(table).getByRole("row", { name: /Label e/ });
    expect(within(e).getByText("Not offered here.")).toBeInTheDocument();
    expect(within(e).getByRole("button", { name: "Use" })).toBeDisabled();
  });

  it("ModelTable: busy waits every check and remove", () => {
    mountSettings(
      <ModelTable
        label="Reranker models"
        busy
        lines={[
          {
            id: "a",
            label: "A",
            runsOn: "",
            sizeMB: null,
            here: null,
            inUse: false,
            op: null,
            use: { disabled: true, onClick: vi.fn() },
            check: vi.fn(),
            remove: vi.fn(),
          },
        ]}
      />,
    );
    for (const name of ["Use", "Check", "Remove"]) expect(screen.getByRole("button", { name })).toBeDisabled();
  });

  it("where a model runs, what it takes there, what it is, and how long an hour of video takes", () => {
    const gpu = fitOf("fits", "m", { device: "gpu", needMB: { vram: 1434, ram: 600 } });
    const cpu = fitOf("fits", "m", { device: "cpu", needMB: { vram: 0, ram: 1169 } });
    expect(runsOn(gpu)).toBe("Card, 1.4 GB");
    expect(runsOn(cpu)).toBe("Processor, 1.1 GB");
    expect(roomOf(gpu)).toEqual(["On the card", "1.4 GB"]);
    expect(roomOf(cpu)).toEqual(["In memory", "1.1 GB"]);
    expect(aboutModel(row("a"))).toBe("Light: runs on any PC · no llama.cpp needed");
    expect(aboutModel(row("b", { tier: "quality", runtimes: ["llamacpp"] }))).toBe(
      "The most precise, and the heaviest · runs through llama.cpp",
    );
    expect(aboutModel(row("c", { tier: "other" }))).toBe("other · no llama.cpp needed");
    const m = { label: "Whisper large-v3 turbo", languages: 99, licence: "MIT" } as SpeechModel;
    expect(aboutSpeech(m)).toBe("The best text · 99 languages · MIT");
    expect(aboutSpeech({ ...m, label: "Whisper small" })).toMatch(/^For a modest PC/);
    expect(aboutSpeech({ ...m, label: "Whisper medium" })).toBe("99 languages · MIT");
    expect(hourIn(39)).toBe("About 2 min");
    expect(hourIn(120)).toBe("Under a minute");
    expect(hourIn(0.5)).toBe("About 2 h");
  });
});

describe("AddFolder", () => {
  it("adds a typed folder with Enter, copying it, and says what was added", async () => {
    net.routes["models.add"] = (i) => ({ model: "m1", path: String(i.path), dims: 768 });
    mountSettings(<AddFolder />);
    const field = screen.getByRole("textbox", { name: label("Add from a folder…") });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(calls("models.add")).toHaveLength(0);
    fireEvent.change(field, { target: { value: " D:\\m\\bge " } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Copy it into my models folder/ }));
    fireEvent.keyDown(field, { key: "a" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(await screen.findByText("m1 added")).toBeInTheDocument();
    expect(screen.getByText("D:\\m\\bge · 768 dimensions")).toBeInTheDocument();
    expect(inputs("models.add")[0]).toEqual({ path: "D:\\m\\bge", copy: true });
    await waitFor(() => expect(field).toHaveValue(""));
    fireEvent.click(screen.getByRole("checkbox", { name: /Copy it into my models folder/ }));
  });

  it("reports a refused folder and shows Checking… meanwhile", async () => {
    net.routes["models.add"] = () => {
      throw new Fail("Not a model folder");
    };
    mountSettings(<AddFolder />);
    fireEvent.change(screen.getByRole("textbox", { name: label("Add from a folder…") }), {
      target: { value: "D:\\x" },
    });
    const release = hold();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("button", { name: "Checking…" })).toHaveAttribute("aria-busy", "true");
    release();
    expect(await screen.findByText("This folder could not be added")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: label("Add from a folder…") }), { target: { value: "" } });
  });

  it("Browse… fills the field from the desktop picker; a cancel keeps it", async () => {
    const d = fakeDesktop({ folder: null });
    mountSettings(<AddFolder />);
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(d.pickFolder).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: label("Add from a folder…") })).toHaveValue("");
    d.pickFolder.mockResolvedValue("E:\\models\\x");
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: label("Add from a folder…") })).toHaveValue("E:\\models\\x"),
    );
    fireEvent.change(screen.getByRole("textbox", { name: label("Add from a folder…") }), { target: { value: "" } });
  });
});

describe("FolderDialog", () => {
  const hw = (drives: { root: string; freeMB: number; totalMB: number }[]) => () => ({
    ramTotalMB: 1,
    gpus: [],
    drives,
  });
  const folder = () => screen.getByRole("textbox", { name: label("Folder") });

  it("first choice: preselects a drive, refuses a short one, types, browses and stores once the folder is saved", async () => {
    net.routes["models.hardware"] = hw([
      { root: "C:\\", freeMB: 5000, totalMB: 0 },
      { root: "D:\\", freeMB: 9000, totalMB: 10000 },
      { root: "E:\\", freeMB: 10, totalMB: 100 },
    ]);
    net.routes["models.planDir"] = (i) => ({
      dir: i.dir,
      drive: { root: String(i.dir).slice(0, 3), freeMB: 9000 },
      installedMB: 0,
      action: "set",
      files: 0,
    });
    const j = fakeJob({ id: "models-dir-00000001", kind: "models-dir", subject: "D:\\Picked" });
    net.routes["models.setDir"] = () => ({ jobId: j.id });
    const d = fakeDesktop({ folder: "D:\\Picked" });
    const onApplied = vi.fn();
    mountSettings(<FolderDialog current={null} needMB={1000} onApplied={onApplied} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Where should models be stored?" })).toBeInTheDocument();
    expect(screen.getByText(/This download needs 1000 MB/)).toBeInTheDocument();
    await waitFor(() => expect(folder()).toHaveValue("D:\\Testimus\\models"));
    expect(screen.getByRole("radio", { name: /^E:\\ / })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /^D:\\ / })).toBeChecked();
    expect(screen.getByText("10 MB free of 100 MB")).toBeInTheDocument();
    expect(screen.getByText("8.8 GB free of 9.8 GB")).toBeInTheDocument();
    expect(screen.getByText("4.9 GB free")).toBeInTheDocument();
    expect(screen.getByText("Drives")).toBeInTheDocument();
    expect(screen.getByText("Not enough room")).toBeInTheDocument();
    expect(await screen.findByText(/free on D:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /^C:\\ / }));
    expect(folder()).toHaveValue("C:\\Testimus\\models");
    fireEvent.change(folder(), { target: { value: "relative" } });
    expect(screen.getByText(/Type a full path/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Store models here" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(folder()).toHaveValue("D:\\Picked"));
    expect(d.pickFolder).toHaveBeenCalledWith({ title: "Models folder", defaultPath: "relative" });
    d.pickFolder.mockResolvedValue(null);
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(d.pickFolder).toHaveBeenCalledTimes(2));
    expect(folder()).toHaveValue("D:\\Picked");
    const store = screen.getByRole("button", { name: "Store models here" });
    await waitFor(() => expect(store).toBeEnabled());
    fireEvent.click(store);
    await waitFor(() => expect(inputs("models.setDir")).toEqual([{ dir: "D:\\Picked" }]));
    expect(onApplied).not.toHaveBeenCalled();
    await j.finish({ status: "done", result: { dir: "D:\\Picked", action: "set", cancelled: false } });
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith("D:\\Picked", null, "set"));
  });

  it("an empty browse starts without a default path; drives unreadable", async () => {
    const d = fakeDesktop({ folder: null });
    mountSettings(<FolderDialog current={null} needMB={0} onApplied={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/The drives could not be read/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(d.pickFolder).toHaveBeenCalledWith({ title: "Models folder", defaultPath: undefined }));
  });

  it("a folder whose saving job fails says why and stays open", async () => {
    net.routes["models.hardware"] = hw([]);
    net.routes["models.planDir"] = (i) => ({
      dir: i.dir,
      drive: { root: "F:\\", freeMB: 4000 },
      installedMB: 0,
      action: "set",
      files: 0,
    });
    const j = fakeJob({ id: "models-dir-00000002", kind: "models-dir" });
    net.routes["models.setDir"] = () => ({ jobId: j.id });
    const onApplied = vi.fn();
    mountSettings(<FolderDialog current={null} needMB={0} onApplied={onApplied} onClose={vi.fn()} />);
    fireEvent.change(folder(), { target: { value: "F:\\m" } });
    const store = screen.getByRole("button", { name: "Store models here" });
    await waitFor(() => expect(store).toBeEnabled());
    fireEvent.click(store);
    await waitFor(() => expect(calls("models.setDir")).toHaveLength(1));
    await j.finish({ status: "failed", error: "F: is full", fix: "Pick another drive" });
    expect(await screen.findByText(/F: is full Pick another drive/)).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("changing: move, copy or keep what is downloaded; refusals and a failed apply", async () => {
    net.routes["models.hardware"] = () => ({ ramTotalMB: 1, gpus: [], drives: [] });
    let refuse = false;
    net.routes["models.planDir"] = (i) => {
      if (refuse) throw new Fail("Folder is read-only", { fix: "Pick another" });
      return {
        dir: i.dir,
        drive: { root: "F:\\", freeMB: 4000 },
        installedMB: 3000,
        action: i.copy ? "copy" : i.keep ? "keep" : "move",
        files: 1,
      };
    };
    net.routes["models.setDir"] = () => {
      if (refuse) throw new Fail("Folder is read-only");
      return { jobId: "models-dir-0000000f" };
    };
    const onApplied = vi.fn();
    const onClose = vi.fn();
    mountSettings(<FolderDialog current={"C:\\old"} needMB={0} onApplied={onApplied} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Change the models folder" })).toBeInTheDocument();
    expect(screen.getByText("Now: C:\\old")).toBeInTheDocument();
    await waitFor(() => expect(calls("models.hardware")).toHaveLength(1));
    expect(await screen.findByRole("radiogroup", { name: "Drives" })).toBeEmptyDOMElement();
    fireEvent.change(folder(), { target: { value: "\\\\srv\\models" } });
    expect(await screen.findByText(/in 1 file\. Moved in a job/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled();
    expect(screen.getByText("Moving 2.9 GB is followed as a job in Jobs.")).toBeInTheDocument();
    const how = screen.getByRole("radiogroup", { name: "The models already downloaded" });
    fireEvent.click(within(how).getByRole("radio", { name: /^Copy/ }));
    expect(await screen.findByText(/Copied in a job/)).toBeInTheDocument();
    expect(inputs("models.planDir").at(-1)).toEqual({ dir: "\\\\srv\\models", copy: true });
    expect(screen.getByText("Copying 2.9 GB is followed as a job in Jobs.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith("\\\\srv\\models", "models-dir-0000000f", "copy"));
    fireEvent.click(within(how).getByRole("radio", { name: /^Keep them where they are/ }));
    expect(await screen.findByText(/They stay where they are/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled();
    refuse = true;
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect(await screen.findByText(/Folder is read-only/)).toBeInTheDocument();
    fireEvent.change(folder(), { target: { value: "G:\\m" } });
    expect(await screen.findByText(/Pick another/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("a plan with nothing downloaded yet, one file and several", async () => {
    let installedMB = 0;
    net.routes["models.hardware"] = hw([]);
    net.routes["models.planDir"] = (i) => ({
      dir: i.dir,
      drive: { root: "F:\\", freeMB: 4000 },
      installedMB,
      action: "move",
      files: 2,
    });
    mountSettings(<FolderDialog current={"C:\\old"} needMB={0} onApplied={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(folder(), { target: { value: "F:\\a" } });
    expect(await screen.findByText(/free on F:/)).toBeInTheDocument();
    expect(screen.queryByText(/Downloaded so far/)).toBeNull();
    expect(screen.getByRole("button", { name: "Use this folder" })).toBeInTheDocument();
    installedMB = 10;
    fireEvent.change(folder(), { target: { value: "F:\\b" } });
    expect(await screen.findByText(/in 2 files\./)).toBeInTheDocument();
  });
});
