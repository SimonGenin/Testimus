// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useRead } from "../../../../src/ui/lib/data/query.ts";
import { gpuFacts, machineSummary } from "../../../../src/ui/screens/settings/models/data.ts";
import { PcGroup } from "../../../../src/ui/screens/settings/models/PcGroup.tsx";
import { calls, Fail, fakeNet, inputs, mountSettings, net, reset } from "./helpers.tsx";

type Hw = Parameters<typeof machineSummary>[0];
type Gpu = Hw["gpus"][number];

const gpu = (name: string, over: Partial<Gpu> = {}): Gpu => ({
  name,
  vendor: /nvidia/i.test(name) ? "nvidia" : "intel",
  vramTotalMB: null,
  vramUsedMB: null,
  source: "wmi",
  integrated: false,
  usable: true,
  ...over,
});
const laptop = (over: Partial<Hw> = {}): Hw => ({
  at: "2026-11-05T10:00:00.000Z",
  system: { platform: "win32", arch: "x64" },
  ramTotalMB: 32768,
  ramFreeMB: 18432,
  cpu: { model: "Intel(R) Core(TM) i7-1185G7", threads: 8 },
  gpus: [
    gpu("NVIDIA GeForce RTX 3050 Laptop GPU", { vramTotalMB: 4096, vramUsedMB: 300, source: "nvidia-smi" }),
    gpu("Intel(R) Iris(R) Xe Graphics", { integrated: true }),
    gpu("Intel(R) UHD Graphics 620", { integrated: true, usable: false }),
  ],
  drives: [],
  loaded: [],
  ...over,
});

beforeEach(() => {
  fakeNet();
  net.routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true }, projects: [] });
  net.routes["system.set"] = (i) => ({ claude: { exe: "" }, models: { allowRemote: i.allowRemote ?? true } });
});
afterEach(reset);

const pc = () => <PcGroup dir="D:\m" ops={[]} busy={false} onFolder={() => {}} />;

// the reads the page keeps open beside the group: every model is judged against the PC
function Judged() {
  useRead("models.catalog", {});
  useRead("models.speech", {});
  useRead("models.packs", {});
  useRead("models.advice", {});
  return null;
}

describe("what This PC says of each GPU", () => {
  it("the one the models run on, then each other one and why it is not used", () => {
    expect(gpuFacts(laptop())).toEqual([
      { label: "GPU", value: "NVIDIA GeForce RTX 3050 Laptop GPU, 4.0 GB (3.7 GB free) — the models run on it" },
      {
        label: "Other GPU",
        value:
          "Intel(R) Iris(R) Xe Graphics, integrated (uses the PC's memory) — not used while the GPU above is there",
      },
      {
        label: "Other GPU",
        value:
          "Intel(R) UHD Graphics 620, integrated (uses the PC's memory) — not used: slower than the processor for models",
      },
    ]);
  });

  it("no GPU at all, or none Testimus can use: search runs on the processor", () => {
    expect(gpuFacts(laptop({ gpus: [] }))).toEqual([
      { label: "GPU", value: "No GPU found: search runs on the processor" },
    ]);
    const uhd = laptop({ gpus: [gpu("Intel(R) UHD Graphics 620", { integrated: true, usable: false })] });
    expect(machineSummary(uhd)[3]).toBe("No GPU Testimus can use here: search runs on the processor");
    expect(gpuFacts(uhd).map((f) => f.label)).toEqual(["GPU", "Other GPU"]);
  });

  it("the summary names the GPU the models run on, not an unusable one listed first", () => {
    const m = laptop({ gpus: [gpu("Intel(R) UHD Graphics 620", { usable: false }), gpu("AMD Radeon RX 6600")] });
    expect(machineSummary(m)[3]).toBe("AMD Radeon RX 6600");
  });
});

describe("Settings › Models › This PC", () => {
  it("shows the PC as Testimus read it and when", async () => {
    net.routes["models.hardware"] = () => laptop();
    mountSettings(pc());
    await screen.findByText("Windows · x64");
    const group = screen.getByRole("region", { name: "This PC" });
    for (const text of [
      "Windows · x64",
      "Intel(R) Core(TM) i7-1185G7, 8 threads",
      "32 GB of memory, 18 GB free",
      "NVIDIA GeForce RTX 3050 Laptop GPU, 4.0 GB (3.7 GB free) — the models run on it",
    ])
      expect(within(group).getByText(text, { exact: false })).toBeInTheDocument();
    expect(within(group).getByText(/^5 Nov, \d\d:\d\d$/)).toBeInTheDocument();
  });

  it("Analyse again reads the PC afresh, then has every model judged again", async () => {
    net.routes["models.hardware"] = (i) => (i.refresh ? laptop({ ramFreeMB: 4096 }) : laptop());
    for (const r of ["models.catalog", "models.packs", "models.advice"]) net.routes[r] = () => [];
    net.routes["models.speech"] = () => ({ models: [] });
    mountSettings(
      <>
        {pc()}
        <Judged />
      </>,
    );
    await screen.findByText("32 GB of memory, 18 GB free");
    await waitFor(() => expect(calls("models.advice")).toHaveLength(1));
    const before = ["models.catalog", "models.speech", "models.packs"].map((r) => calls(r).length);
    fireEvent.click(screen.getByRole("button", { name: "Analyse again" }));
    await screen.findByText("32 GB of memory, 4.0 GB free");
    expect(inputs("models.hardware")).toContainEqual({ refresh: true });
    expect(await screen.findByText("This PC analysed again")).toBeInTheDocument();
    await waitFor(() =>
      expect(["models.catalog", "models.speech", "models.packs"].map((r, i) => calls(r).length > before[i])).toEqual([
        true,
        true,
        true,
      ]),
    );
    await waitFor(() => expect(calls("models.advice")).toHaveLength(2));
  });

  it("says when the PC could not be read, and Analyse again tries anew", async () => {
    let fail = true;
    net.routes["models.hardware"] = () => {
      if (fail) throw new Fail("nvidia-smi hung");
      return laptop();
    };
    mountSettings(pc());
    expect(await screen.findByText(/This PC could not be read: nvidia-smi hung/)).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Analyse again" }));
    expect(await screen.findByText("32 GB of memory, 18 GB free")).toBeInTheDocument();
  });

  it("Allow downloads from Hugging Face is this PC's setting, saved as it is switched", async () => {
    net.routes["models.hardware"] = () => laptop();
    mountSettings(pc());
    const sw = await screen.findByRole("switch", { name: "Allow downloads from Hugging Face" });
    await waitFor(() => expect(sw).toBeEnabled());
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Behind a proxy that blocks them/)).toBeInTheDocument();
    fireEvent.click(sw);
    await waitFor(() => expect(inputs("system.set")).toEqual([{ allowRemote: false }]));
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
  });

  it("Add a model from a folder… opens the form under the folder, and closes it again", async () => {
    net.routes["models.hardware"] = () => laptop();
    mountSettings(pc());
    const add = await screen.findByRole("button", { name: "Add a model from a folder…" });
    expect(screen.queryByRole("textbox", { name: /^Add from a folder/ })).toBeNull();
    fireEvent.click(add);
    expect(add).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: /^Add from a folder/ })).toBeInTheDocument();
    fireEvent.click(add);
    expect(screen.queryByRole("textbox", { name: /^Add from a folder/ })).toBeNull();
  });
});
