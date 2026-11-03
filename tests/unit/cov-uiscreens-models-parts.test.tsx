// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fit } from "../../src/core/types.ts";
import { AddFolder } from "../../src/ui/screens/settings/models/AddFolder.tsx";
import { AdviceBanner } from "../../src/ui/screens/settings/models/AdviceBanner.tsx";
import { CustomCard } from "../../src/ui/screens/settings/models/CustomCard.tsx";
import {
  bestDrive,
  type CatalogRow,
  choiceLabel,
  defaultFolder,
  folderPicker,
  type PackRow,
  size,
  suggestPack,
} from "../../src/ui/screens/settings/models/data.ts";
import { FitChip } from "../../src/ui/screens/settings/models/FitChip.tsx";
import { FitConfirm } from "../../src/ui/screens/settings/models/FitConfirm.tsx";
import { FolderDialog } from "../../src/ui/screens/settings/models/FolderDialog.tsx";
import { ModelsTable } from "../../src/ui/screens/settings/models/ModelsTable.tsx";
import { OpLine } from "../../src/ui/screens/settings/models/OpLine.tsx";
import { PackCard } from "../../src/ui/screens/settings/models/PackCard.tsx";
import { PackPlanDialog } from "../../src/ui/screens/settings/models/PackPlanDialog.tsx";
import { clearToasts, failing, models, modelsFetch, mount, modelsNamed as named } from "./cov-uiscreens-helpers.tsx";
import { fakeDesktop, noDesktop } from "./ui-desktop-helpers.tsx";

beforeEach(() => {
  modelsFetch();
});

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
  id,
  label: id[0].toUpperCase() + id.slice(1),
  intent: "",
  active: false,
  available: true,
  variant: 0,
  embedding: "e",
  reranker: null,
  fit: fitOf("fits"),
  skipped: [],
  downloadMB: 0,
  quality: "q",
  measuredHere: false,
  ...over,
});

const row = (id: string, over: Partial<CatalogRow> = {}): CatalogRow => ({
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
});

describe("models data helpers", () => {
  it("sizes, labels, defaults", () => {
    expect(size(2 * 1024 * 1024)).toBe("2.0 TB");
    expect(size(20480)).toBe("20 GB");
    expect(size(-3)).toBe("0 MB");
    expect(choiceLabel(null, (x) => x)).toBe("Not set");
    expect(choiceLabel({ embedding: "e", reranker: "r" } as never, (x) => x.toUpperCase())).toBe("E + R");
    expect(choiceLabel({ embedding: "e", reranker: null } as never, (x) => x)).toBe("e");
    expect(defaultFolder("D:\\\\")).toBe("D:\\Testimus\\models");
  });

  it("suggestPack skips GGUF on the CPU, unavailable and non-fitting packs", () => {
    const hw = { ramTotalMB: 16000, drives: [], gpus: [] } as never;
    const cat = [row("g", { runtimes: ["llamacpp"] }), row("t")];
    expect(
      suggestPack(
        [
          pack("quality", { available: false }),
          pack("balanced", { fit: fitOf("tight") }),
          pack("performance", { embedding: "t", reranker: "g", fit: fitOf("fits", "", { device: "cpu" }) }),
          pack("light", { embedding: null, fit: fitOf("fits", "", { device: "cpu" }) }),
        ],
        hw,
        cat,
      ),
    ).toBe("light");
    expect(suggestPack([pack("balanced", { embedding: "g" })], hw, cat)).toBe("balanced");
    expect(suggestPack([], hw, cat)).toBe("light");
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
  it("FitChip is empty without a fit", () => {
    const { container } = render(<FitChip fit={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("OpLine with a percent and a cancel, or neither", () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <OpLine op={{ key: "k", jobId: "j", label: "Downloading", message: "half", pct: 50 }} onCancel={onCancel} />,
    );
    expect(screen.getByText("Downloading · 50 %")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel: Downloading" }));
    expect(onCancel).toHaveBeenCalledWith("j");
    rerender(<OpLine op={{ key: "k", jobId: "", label: "Verifying", message: "", pct: null }} onCancel={onCancel} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("AdviceBanner up and down", () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    const advice = {
      id: "a",
      direction: "downgrade" as const,
      from: { pack: "balanced" },
      to: { embedding: "e", reranker: null },
      reason: "Too slow",
      quality: "-3%",
    };
    render(
      <AdviceBanner
        advice={advice as never}
        label={(x) => `L-${x}`}
        busy={false}
        onApply={onApply}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText(/A lighter choice suits this PC: switch to L-e/)).toBeInTheDocument();
    expect(screen.getByText(/now Balanced pack/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onApply).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("CustomCard active with or without a reranker, and inactive", () => {
    const onChoose = vi.fn();
    const { rerender } = render(
      <CustomCard active embedding="e" reranker="r" label={(x) => `L-${x}`} onChoose={onChoose} />,
    );
    expect(screen.getByText("In use")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("L-e + L-r");
    rerender(<CustomCard active embedding="e" reranker={null} label={(x) => x} onChoose={onChoose} />);
    expect(screen.getByText("no reranker")).toBeInTheDocument();
    rerender(<CustomCard active={false} embedding="e" reranker={null} label={(x) => x} onChoose={onChoose} />);
    expect(screen.getByText("Not chosen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose models" }));
    expect(onChoose).toHaveBeenCalled();
  });

  it("FitConfirm: refused, partly on the CPU with its own message, unload list, no lighter", () => {
    const props = { title: "Big", lighter: null, onUse: vi.fn(), onLighter: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<FitConfirm {...props} fit={fitOf("ram-too-small", "No RAM")} />);
    expect(screen.getByText("Big cannot run on this PC")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use anyway" })).toBeNull();
    expect(screen.getByRole("button", { name: "Choose a lighter one" })).toBeDisabled();
    rerender(
      <FitConfirm {...props} fit={fitOf("gpu-too-small", "It runs on the processor", { unload: ["a", "b"] })} />,
    );
    expect(screen.queryByText(/several times slower/)).toBeNull();
    expect(screen.getByText("a, b")).toBeInTheDocument();
    rerender(<FitConfirm {...props} fit={fitOf("gpu-too-small", "GPU small")} lighter="Small" />);
    expect(screen.getByText(/several times slower/)).toBeInTheDocument();
    expect(screen.getByText("Lighter choice: Small.")).toBeInTheDocument();
  });

  it("PackCard: a variant beyond the first, measured speed, nothing left, unavailable", () => {
    const onUse = vi.fn();
    const { rerender } = render(
      <PackCard
        pack={pack("balanced", { variant: 2, reranker: "r", speed: "fast", skipped: ["x"] })}
        label={(x) => x}
        op={null}
        busy={false}
        onUse={onUse}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("On this PC (its third choice)")).toBeInTheDocument();
    expect(screen.getByText("fast")).toBeInTheDocument();
    expect(screen.getByText("Installed")).toBeInTheDocument();
    expect(screen.getByText("Skipped: x")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use the Balanced pack" }));
    expect(onUse).toHaveBeenCalled();
    rerender(
      <PackCard
        pack={pack("quality", { available: false, embedding: null, skipped: ["y"] })}
        label={(x) => x}
        op={{ key: "quality", jobId: "j", label: "Installing", message: "", pct: null }}
        busy={false}
        onUse={onUse}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Not available on this PC")).toBeInTheDocument();
    expect(screen.getByText("y")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Installing" })).toBeInTheDocument();
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
      jobIds: [],
      dryRun: true,
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
    expect(screen.getByText("Not chosen yet")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("L-e + L-r");
    expect(screen.getByText(/nothing to rebuild/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(onChangeFolder).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download 2.0 GB" }));
    expect(onConfirm).toHaveBeenCalled();
    rerender(
      <PackPlanDialog
        pack={pack("balanced")}
        out={{ ...out, plan: { ...out.plan, download: [], dir: "D:\\m" } }}
        label={(x) => x}
        busy
        onConfirm={onConfirm}
        onChangeFolder={onChangeFolder}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Use Balanced" })).toBeDisabled();
  });

  it("ModelsTable: perf, verify, remove, downloading", () => {
    const onVerify = vi.fn();
    const onRemove = vi.fn();
    const inst = {
      model: "a",
      label: "A",
      via: "path" as const,
      runtime: "t",
      where: "\\\\s\\a",
      sizeMB: 10,
      state: "installed" as const,
      usedBy: [],
      perf: "40 ms",
    };
    render(
      <ModelsTable
        rows={[row("a", { state: "installed", kind: "reranker" }), row("b", { state: "downloading" })]}
        installed={[inst]}
        inUse={[]}
        ops={[]}
        busy={false}
        onInstall={vi.fn()}
        onUse={vi.fn()}
        onVerify={onVerify}
        onRemove={onRemove}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("40 ms")).toBeInTheDocument();
    expect(screen.getByText(/Reranker · light/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verify Label a" }));
    expect(onVerify).toHaveBeenCalled();
    const a = screen.getByRole("row", { name: "Label a" });
    const remove = within(a).getAllByRole("button").at(-1) as HTMLElement;
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), inst);
    expect(screen.getByRole("button", { name: "Install Label b" })).toBeDisabled();
  });
});

describe("AddFolder", () => {
  it("adds a typed folder with Enter, copying it, and says what was added", async () => {
    models.routes["models.add"] = (i) => ({ model: "m1", path: String(i.path), dims: 768 });
    const onAdded = vi.fn();
    mount(<AddFolder onAdded={onAdded} />);
    const field = screen.getByLabelText("Add from a folder…");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(named("models.add")).toHaveLength(0);
    fireEvent.change(field, { target: { value: " D:\\m\\bge " } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.keyDown(field, { key: "a" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(await screen.findByText("m1 added")).toBeInTheDocument();
    expect(screen.getByText("D:\\m\\bge · 768 dimensions")).toBeInTheDocument();
    expect(named("models.add")[0].input).toEqual({ path: "D:\\m\\bge", copy: true });
    expect(onAdded).toHaveBeenCalled();
    expect(field).toHaveValue("");
  });

  it("reports a refused folder and shows Checking… meanwhile", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    models.routes["models.add"] = () => failing("Not a model folder");
    models.gate = gate;
    mount(<AddFolder onAdded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Add from a folder…"), { target: { value: "D:\\x" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("button", { name: "Checking…" })).toBeDisabled();
    release();
    expect(await screen.findByText("This folder could not be added")).toBeInTheDocument();
  });

  it("Browse… fills the field from the desktop picker; a cancel keeps it", async () => {
    const d = fakeDesktop({ folder: null });
    mount(<AddFolder onAdded={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Browse for a model folder" }));
    await waitFor(() => expect(d.pickFolder).toHaveBeenCalled());
    expect(screen.getByLabelText("Add from a folder…")).toHaveValue("");
    d.pickFolder.mockResolvedValue("E:\\models\\x");
    fireEvent.click(screen.getByRole("button", { name: "Browse for a model folder" }));
    await waitFor(() => expect(screen.getByLabelText("Add from a folder…")).toHaveValue("E:\\models\\x"));
  });
});

describe("FolderDialog", () => {
  const hw = (drives: { root: string; freeMB: number; totalMB: number }[]) => () => ({
    ramTotalMB: 1,
    gpus: [],
    drives,
  });

  it("first choice: preselects a drive, refuses a short one, types, browses and stores", async () => {
    models.routes["models.hardware"] = hw([
      { root: "C:\\", freeMB: 5000, totalMB: 0 },
      { root: "D:\\", freeMB: 9000, totalMB: 10000 },
      { root: "E:\\", freeMB: 10, totalMB: 100 },
    ]);
    models.routes["models.planDir"] = (i) => ({
      dir: i.dir,
      drive: { root: String(i.dir).slice(0, 3), freeMB: 9000 },
      installedMB: 0,
      action: "set",
      files: 0,
    });
    models.routes["models.setDir"] = () => ({ jobId: "models-dir-1" });
    models.routes["jobs.show"] = (i) => ({
      job: {
        id: i.id,
        kind: "models-dir",
        subject: "D:\\Picked",
        startedAt: "",
        status: "done",
        result: { dir: "D:\\Picked", action: "set", cancelled: false },
      },
    });
    const d = fakeDesktop({ folder: "D:\\Picked" });
    const onApplied = vi.fn();
    mount(<FolderDialog current={null} needMB={1000} onApplied={onApplied} onClose={vi.fn()} />);
    expect(screen.getByText("Where should models be stored?")).toBeInTheDocument();
    expect(screen.getByText(/This download needs 1000 MB/)).toBeInTheDocument();
    const field = screen.getByLabelText("Folder");
    await waitFor(() => expect(field).toHaveValue("D:\\Testimus\\models"));
    expect(screen.getByRole("radio", { name: "E:\\ 10 MB free" })).toBeDisabled();
    expect(screen.getByText("Not enough room")).toBeInTheDocument();
    expect(await screen.findByText(/free on D:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "C:\\ 4.9 GB free" }));
    expect(field).toHaveValue("C:\\Testimus\\models");
    fireEvent.change(field, { target: { value: "relative" } });
    expect(screen.getByText(/Type a full path/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Store models here" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(field).toHaveValue("D:\\Picked"));
    expect(d.pickFolder).toHaveBeenCalledWith({ title: "Models folder", defaultPath: "relative" });
    d.pickFolder.mockResolvedValue(null);
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(d.pickFolder).toHaveBeenCalledTimes(2));
    expect(field).toHaveValue("D:\\Picked");
    const store = screen.getByRole("button", { name: "Store models here" });
    await waitFor(() => expect(store).toBeEnabled());
    fireEvent.click(store);
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith("D:\\Picked", null, "set"));
    expect(named("models.setDir").at(-1)?.input).toEqual({ dir: "D:\\Picked" });
  });

  it("an empty browse starts without a default path; drives unreadable", async () => {
    const d = fakeDesktop({ folder: null });
    mount(<FolderDialog current={null} needMB={0} onApplied={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/The drives could not be read/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(d.pickFolder).toHaveBeenCalledWith({ title: "Models folder", defaultPath: undefined }));
  });

  it("changing: move, copy or keep what is downloaded; refusals and a failed apply", async () => {
    models.routes["models.hardware"] = () => ({ ramTotalMB: 1, gpus: [] });
    let refuse = false;
    models.routes["models.planDir"] = (i) => {
      if (refuse) return failing("Folder is read-only", "Pick another");
      return {
        dir: i.dir,
        drive: { root: "F:\\", freeMB: 4000 },
        installedMB: 3000,
        action: i.copy ? "copy" : i.keep ? "keep" : "move",
        files: 1,
      };
    };
    models.routes["models.setDir"] = () => (refuse ? failing("Folder is read-only") : { jobId: "mv-1" });
    const onApplied = vi.fn();
    const onClose = vi.fn();
    mount(<FolderDialog current={"C:\\old"} needMB={0} onApplied={onApplied} onClose={onClose} />);
    expect(screen.getByText("Change the models folder")).toBeInTheDocument();
    expect(screen.getByText("C:\\old")).toBeInTheDocument();
    await waitFor(() => expect(named("models.hardware")).toHaveLength(1));
    expect(screen.getByRole("group", { name: "Drives" })).toBeEmptyDOMElement();
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "\\\\srv\\models" } });
    expect(await screen.findByText(/in 1 file\. Moved in a job/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move 2.9 GB" })).toBeEnabled();
    const seg = screen.getByRole("group", { name: "The models already downloaded" });
    fireEvent.click(within(seg).getByRole("button", { name: "Copy" }));
    expect(await screen.findByText(/Copied in a job/)).toBeInTheDocument();
    expect(named("models.planDir").at(-1)?.input).toEqual({ dir: "\\\\srv\\models", copy: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy 2.9 GB" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith("\\\\srv\\models", "mv-1", "copy"));
    fireEvent.click(within(seg).getByRole("button", { name: "Keep where they are" }));
    expect(await screen.findByText(/They stay where they are/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled();
    refuse = true;
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect(await screen.findByText("Folder is read-only")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "G:\\m" } });
    expect(await screen.findByText("Pick another")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("a plan with nothing downloaded yet, one file and several", async () => {
    let installedMB = 0;
    let files = 2;
    models.routes["models.hardware"] = hw([]);
    models.routes["models.planDir"] = (i) => ({
      dir: i.dir,
      drive: { root: "F:\\", freeMB: 4000 },
      installedMB,
      action: "move",
      files,
    });
    mount(<FolderDialog current={"C:\\old"} needMB={0} onApplied={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "F:\\a" } });
    expect(await screen.findByText(/free on F:/)).toBeInTheDocument();
    expect(screen.queryByText(/Downloaded so far/)).toBeNull();
    expect(screen.getByRole("button", { name: "Use this folder" })).toBeInTheDocument();
    installedMB = 10;
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "F:\\b" } });
    expect(await screen.findByText(/in 2 files\./)).toBeInTheDocument();
    files = 1;
  });
});
