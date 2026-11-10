// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fit, Job } from "../../../../src/core/types.ts";
import { ModelsSection } from "../../../../src/ui/screens/settings/ModelsSection.tsx";
import type { CatalogRow, Installed, Speech, SpeechModel } from "../../../../src/ui/screens/settings/models/data.ts";
import { calls, emit, Fail, fakeNet, inputs, job, mountSettings, net, reset, status } from "./helpers.tsx";

vi.mock("../../../../src/ui/screens/settings/models/FolderDialog.tsx", () => ({
  FolderDialog: ({
    current,
    needMB,
    onApplied,
  }: {
    current: string | null;
    needMB: number;
    onApplied: (dir: string, jobId: string | null, action: string) => void;
  }) => (
    <div role="dialog" aria-label="Folder stub">
      <span>
        folder {current ?? "none"} need {needMB}
      </span>
      <button
        type="button"
        onClick={() => {
          dir = "D:\\models";
          onApplied("D:\\models", null, "set");
        }}
      >
        Apply folder
      </button>
    </div>
  ),
}));

let seq = 0;
let dir: string | null = "D:\\m";
let speech: Speech;
const jobs = new Map<string, Job>();

const srv = {
  start(o: Partial<Job>): string {
    const id = `${o.kind ?? "job"}-${String(++seq).padStart(8, "0")}`;
    jobs.set(id, job({ ...o, id, status: "running" }));
    return id;
  },
  async end(id: string, s: Job["status"], over: Partial<Job> = {}) {
    const j = { ...(jobs.get(id) ?? job({ id })), status: s, ...over };
    jobs.set(id, j);
    await emit(status(j));
  },
};

const fitOf = (verdict: Fit["verdict"], over: Partial<Fit> = {}): Fit => ({
  verdict,
  device: "gpu",
  needMB: { vram: 900, ram: 1300 },
  freeMB: { vram: 12600, ram: 20000 },
  totalMB: { vram: 16000, ram: 32000 },
  unload: [],
  message: `${verdict} in words`,
  ...over,
});

const heard = (id: string, over: Partial<SpeechModel> = {}): SpeechModel => ({
  id,
  label: `Whisper ${id}`,
  licence: "MIT",
  sizeMB: 834,
  languages: 99,
  state: "available",
  installed: false,
  fit: fitOf("fits"),
  device: "gpu",
  speed: 39,
  measured: false,
  advised: false,
  active: false,
  ...over,
});

const said = (over: Partial<Speech> = {}): Speech => ({
  engine: {
    installed: true,
    build: "v1.8.4",
    backend: "cuda",
    advised: "cuda",
    card: true,
    downloadMB: 685,
    detector: "Silero 6.2",
  },
  ffmpeg: { installed: true, build: "7.1.1", downloadMB: 88 },
  active: null,
  chosen: null,
  models: [],
  ...over,
});

const row = (id: string, over: Partial<CatalogRow> = {}): CatalogRow =>
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

let catalog: CatalogRow[] = [];
let installed: Installed[] = [];

beforeEach(() => {
  fakeNet();
  jobs.clear();
  dir = "D:\\m";
  speech = said();
  catalog = [row("emb-s", { state: "installed" })];
  installed = [];
  net.routes["models.speech"] = () => speech;
  net.routes["models.catalog"] = () => catalog;
  net.routes["models.list"] = () => installed;
  net.routes["models.packs"] = () => [];
  net.routes["models.advice"] = () => [];
  net.routes["rag.status"] = () => ({ embedding: "emb-s", reranker: null, activation: "light" });
  net.routes["models.dirs"] = () => ({ dir, runtimesDir: dir ? `${dir}\\runtimes` : null });
  net.routes["models.hardware"] = () => ({
    at: "2026-11-10T10:00:00.000Z",
    ramTotalMB: 32000,
    ramFreeMB: 20000,
    cpu: { model: "Intel(R) Core(TM) Ultra 9 285K", threads: 24 },
    gpus: [],
    loaded: [],
    drives: [{ root: "D:\\", freeMB: 655360, totalMB: 1900000 }],
  });
  net.routes["jobs.list"] = () => [...jobs.values()].filter((j) => j.status === "running");
  net.routes["jobs.show"] = (i) => ({ job: jobs.get(String(i.id)) ?? job({ id: String(i.id) }), events: [] });
  net.routes["jobs.cancel"] = () => ({ cancelled: true });
  net.routes["models.pullWhisper"] = () => ({ jobId: srv.start({ kind: "models-pull", subject: "whisper.cpp" }) });
  net.routes["models.pullFfmpeg"] = () => ({ jobId: srv.start({ kind: "models-pull", subject: "ffmpeg" }) });
  net.routes["models.pull"] = (i) => ({ jobId: srv.start({ kind: "models-pull", subject: String(i.model) }) });
  net.routes["models.useSpeech"] = (i) => ({ active: i.model ?? null });
});

afterEach(reset);

const part = () => screen.findByRole("region", { name: "Transcription" });
const engine = () => screen.findByRole("region", { name: "Engine · whisper.cpp" });
const ffmpeg = () => screen.findByRole("region", { name: "ffmpeg" });
const table = () => screen.findByRole("table", { name: "Transcription models" });
const rowOf = async (label: string) => within(await table()).getByRole("row", { name: new RegExp(label) });
const running = (kind: string) => [...jobs.values()].find((j) => j.kind === kind && j.status === "running") as Job;

describe("Settings › Models › Transcription: the engine and ffmpeg", () => {
  it("says the sound never leaves this PC, and what the engine installed is", async () => {
    mountSettings(<ModelsSection />);
    expect(within(await part()).getByText(/the sound never leaves it/)).toBeInTheDocument();
    const card = await engine();
    expect(within(card).getByText("Installed")).toBeInTheDocument();
    expect(within(card).getByText("v1.8.4 · NVIDIA (CUDA 12.4)")).toBeInTheDocument();
    expect(within(card).getByText(/^Silero 6\.2 — silence and noise/)).toBeInTheDocument();
    expect(within(card).queryByRole("button")).toBeNull();
    const ff = await ffmpeg();
    expect(within(ff).getByText("Installed")).toBeInTheDocument();
    expect(within(ff).getByText("7.1.1")).toBeInTheDocument();
    expect(within(ff).queryByRole("button")).toBeNull();
    expect(within(await part()).getByText(/^Measure on your own videos: type a few minutes/)).toBeInTheDocument();
  });

  it("an engine not installed is downloaded: its job is followed there, cancelled there, then the part is read again", async () => {
    speech = said({
      engine: { ...said().engine, installed: false, backend: null, advised: "cpu", card: false, downloadMB: 9 },
    });
    mountSettings(<ModelsSection />);
    const card = await engine();
    expect(within(card).getByText("Not installed")).toBeInTheDocument();
    expect(within(card).getByText(/This PC gets the processor build\./)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Install · 9 MB" }));
    await waitFor(() => expect(inputs("models.pullWhisper")).toEqual([{}]));
    const line = await within(card).findByRole("status", { name: "Downloading the transcription engine" });
    const id = running("models-pull").id;
    await emit({ jobId: id, at: "", type: "progress", message: "whisper.cpp main", done: 3, total: 9 });
    expect(await within(card).findByText("Downloading the transcription engine · 33 %")).toBeInTheDocument();
    fireEvent.click(within(line).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(inputs("jobs.cancel")).toEqual([{ id }]));
    const before = calls("models.speech").length;
    speech = said({ engine: { ...said().engine, backend: "cpu", advised: "cpu", card: false } });
    await srv.end(id, "done", { result: {} });
    expect(await screen.findByText("Transcription engine installed")).toBeInTheDocument();
    await waitFor(() => expect(calls("models.speech").length).toBeGreaterThan(before));
    expect(await within(card).findByText("v1.8.4 · processor")).toBeInTheDocument();
  });

  it("ffmpeg not installed says what it is for and is downloaded", async () => {
    speech = said({ ffmpeg: { installed: false, build: "7.1.1", downloadMB: 88 } });
    mountSettings(<ModelsSection />);
    const card = await ffmpeg();
    expect(within(card).getByText("Not installed")).toBeInTheDocument();
    expect(within(card).getByText(/^Reads the videos: their sound, their frames\./)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Install · 88 MB" }));
    await waitFor(() => expect(inputs("models.pullFfmpeg")).toEqual([{}]));
    expect(await within(card).findByRole("status", { name: "Downloading ffmpeg" })).toBeInTheDocument();
    await srv.end(running("models-pull").id, "done", { result: {} });
    expect(await screen.findByText("ffmpeg installed")).toBeInTheDocument();
  });

  it("a download found running when the page opens is followed in its card", async () => {
    speech = said({ ffmpeg: { installed: false, build: "7.1.1", downloadMB: 88 } });
    srv.start({ kind: "models-pull", subject: "ffmpeg" });
    srv.start({ kind: "models-pull", subject: "whisper.cpp" });
    mountSettings(<ModelsSection />);
    expect(await within(await ffmpeg()).findByRole("status", { name: "Downloading ffmpeg" })).toBeInTheDocument();
    expect(
      await within(await engine()).findByRole("status", { name: "Downloading the transcription engine" }),
    ).toBeInTheDocument();
    expect(within(await ffmpeg()).queryByRole("button", { name: /^Install/ })).toBeNull();
  });

  it("without a models folder an install asks for it first, then downloads; a refusal for want of one asks too", async () => {
    dir = null;
    speech = said({
      engine: { ...said().engine, installed: false, backend: null },
      ffmpeg: { installed: false, build: "7.1.1", downloadMB: 88 },
    });
    mountSettings(<ModelsSection />);
    await screen.findByText("Not chosen yet — Testimus asks on the first download.");
    fireEvent.click(within(await engine()).getByRole("button", { name: "Install · 685 MB" }));
    expect(await screen.findByText("folder none need 685")).toBeInTheDocument();
    expect(calls("models.pullWhisper")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    await waitFor(() => expect(inputs("models.pullWhisper")).toEqual([{}]));
    await srv.end(running("models-pull").id, "done", { result: {} });

    let refusal: Fail | null = new Fail("No models folder is chosen yet", { code: "models-dir-unset" });
    net.routes["models.pullFfmpeg"] = () => {
      if (refusal) throw refusal;
      return { jobId: srv.start({ kind: "models-pull", subject: "ffmpeg" }) };
    };
    const install = () => within(screen.getByRole("region", { name: "ffmpeg" })).getByRole("button", { name: /^Inst/ });
    await waitFor(() => expect(install()).toBeEnabled());
    fireEvent.click(install());
    expect(await screen.findByText("folder D:\\models need 88")).toBeInTheDocument();
    refusal = null;
    fireEvent.click(screen.getByRole("button", { name: "Apply folder" }));
    await waitFor(() => expect(calls("models.pullFfmpeg")).toHaveLength(2));
    expect(await screen.findByRole("status", { name: "Downloading ffmpeg" })).toBeInTheDocument();
    await srv.end(running("models-pull").id, "done", { result: {} });
    refusal = new Fail("The download site does not answer.");
    await waitFor(() => expect(install()).toBeEnabled());
    fireEvent.click(install());
    expect(await screen.findByText("Could not install ffmpeg")).toBeInTheDocument();
  });

  it("the processor build on a PC with an NVIDIA card is offered the card's build", async () => {
    speech = said({ engine: { ...said().engine, backend: "cpu", advised: "cuda", card: true, downloadMB: 685 } });
    mountSettings(<ModelsSection />);
    const card = await engine();
    expect(within(card).getByText("v1.8.4 · processor")).toBeInTheDocument();
    expect(within(card).getByText(/heard far faster than on the processor/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Install the NVIDIA build · 685 MB" }));
    await waitFor(() => expect(inputs("models.pullWhisper")).toEqual([{ backend: "cuda" }]));
    expect(screen.queryByText(/4 to 8 times faster than it plays/)).toBeNull();
  });

  it("without an NVIDIA card: no card build offered, and what to expect of the processor is said, with the way to Videos", async () => {
    speech = said({ engine: { ...said().engine, backend: "cpu", advised: "cpu", card: false, downloadMB: 9 } });
    const { app } = mountSettings(<ModelsSection />);
    const card = await engine();
    expect(within(card).queryByRole("button", { name: /NVIDIA build/ })).toBeNull();
    const hint = within(await part()).getByText(/4 to 8 times faster than it plays/);
    expect(hint).toHaveTextContent(/makes it about twice as fast/);
    fireEvent.click(within(await part()).getByRole("button", { name: "Settings › Project › Videos" }));
    expect(app.navigate).toHaveBeenCalledWith("settings", "project-videos");
  });

  it("a part that cannot be read says so, and the rest of the page stays", async () => {
    net.routes["models.speech"] = () => {
      throw new Fail("The catalog has no speech entry.");
    };
    mountSettings(<ModelsSection />);
    expect(
      await screen.findByText("The transcription models could not be read: The catalog has no speech entry."),
    ).toBeInTheDocument();
    expect(await screen.findByText("1 in the catalog · 0 on this PC")).toBeInTheDocument();
  });
});

describe("Settings › Models › Transcription: the models", () => {
  const turbo = heard("turbo", {
    label: "Whisper large-v3 turbo",
    state: "verified",
    installed: true,
    where: "D:\\m\\ggml-large-v3-turbo-q8_0.bin",
    measured: true,
    advised: true,
    active: true,
  });
  const small = heard("small", {
    label: "Whisper small",
    sizeMB: 252,
    speed: 7.46,
    device: "cpu",
    fit: fitOf("tight", { device: "cpu", needMB: { vram: 0, ram: 800 }, freeMB: { vram: null, ram: 2048 } }),
  });
  const inst = (id: string, over: Partial<Installed> = {}): Installed =>
    ({
      model: id,
      label: id,
      via: "download",
      runtime: "whisper",
      where: `D:\\m\\${id}.bin`,
      sizeMB: 834,
      state: "installed",
      usedBy: [],
      ...over,
    }) as Installed;

  it("a row says what the model is, its state, its size, whether it fits and how fast it hears here", async () => {
    speech = said({ active: "turbo", models: [turbo, small] });
    mountSettings(<ModelsSection />);
    const t = await rowOf("Whisper large-v3 turbo");
    expect(within(t).getByText("Advised for this PC")).toBeInTheDocument();
    expect(within(t).getByText("The best text · 99 languages · MIT")).toBeInTheDocument();
    expect(within(t).getByText("In use")).toBeInTheDocument();
    expect(within(t).getByText("834 MB")).toBeInTheDocument();
    expect(within(t).getByText("Fits")).toBeInTheDocument();
    expect(within(t).getByText("900 MB on the card, 12 GB free")).toBeInTheDocument();
    expect(within(t).getByText("× 39")).toBeInTheDocument();
    expect(within(t).getByText("measured · an hour in about 2 min")).toBeInTheDocument();
    expect(within(t).queryByRole("button", { name: "Use" })).toBeNull();
    expect(within(t).queryByRole("button", { name: "Install" })).toBeNull();
    expect(within(t).getByRole("button", { name: "Check" })).toBeEnabled();

    const s = await rowOf("Whisper small");
    expect(within(s).queryByText("Advised for this PC")).toBeNull();
    expect(
      within(s).getByText("For a modest PC: faster, more mistakes on the project's own words · 99 languages · MIT"),
    ).toBeInTheDocument();
    expect(within(s).getByText("Not installed")).toBeInTheDocument();
    expect(within(s).getByText("252 MB")).toBeInTheDocument();
    expect(within(s).getByText("Tight")).toBeInTheDocument();
    expect(within(s).getByText("800 MB of memory, 2.0 GB free")).toBeInTheDocument();
    expect(within(s).getByText("× 7.5")).toBeInTheDocument();
    expect(within(s).getByText("estimated · an hour in about 8 min")).toBeInTheDocument();
    expect(within(s).getByRole("button", { name: "Install" })).toBeEnabled();
    expect(within(s).queryByRole("button", { name: /^(Use|Check|Remove)$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Let Testimus choose" })).toBeNull();
  });

  it("installs a model through the catalog's own plan, and follows the download in its row", async () => {
    speech = said({ models: [heard("small", { label: "Whisper small", sizeMB: 252 })] });
    mountSettings(<ModelsSection />);
    fireEvent.click(within(await rowOf("Whisper small")).getByRole("button", { name: "Install" }));
    const plan = await screen.findByRole("alertdialog", { name: "Download Whisper small?" });
    expect(calls("models.pull")).toHaveLength(0);
    fireEvent.click(within(plan).getByRole("button", { name: "Download 252 MB" }));
    await waitFor(() => expect(inputs("models.pull")).toEqual([{ model: "small" }]));
    expect(
      await within(await rowOf("Whisper small")).findByRole("status", { name: "Downloading Whisper small" }),
    ).toBeInTheDocument();
  });

  it("a model that does not fit this PC asks before it is downloaded", async () => {
    speech = said({ models: [small] });
    mountSettings(<ModelsSection />);
    fireEvent.click(within(await rowOf("Whisper small")).getByRole("button", { name: "Install" }));
    const ask = await screen.findByRole("dialog", { name: "Use Whisper small anyway?" });
    expect(ask).toHaveTextContent("tight in words");
    fireEvent.click(within(ask).getByRole("button", { name: "Use anyway" }));
    expect(await screen.findByRole("alertdialog", { name: "Download Whisper small?" })).toBeInTheDocument();
  });

  it("Use chooses the model that hears; a model chosen by hand can be left to Testimus again", async () => {
    const other = heard("small", { label: "Whisper small", state: "installed", installed: true });
    speech = said({ active: "turbo", models: [turbo, other] });
    net.routes["models.useSpeech"] = (i) => {
      speech = said({
        active: "small",
        chosen: i.model ? "small" : null,
        models: [
          { ...turbo, active: false },
          { ...other, active: true },
        ],
      });
      return { active: "small" };
    };
    mountSettings(<ModelsSection />);
    fireEvent.click(within(await rowOf("Whisper small")).getByRole("button", { name: "Use" }));
    await waitFor(() => expect(inputs("models.useSpeech")).toEqual([{ model: "small" }]));
    expect(await screen.findByText("Whisper small hears the videos")).toBeInTheDocument();
    expect(calls("models.use")).toHaveLength(0);
    expect(await screen.findByText(/^You chose Whisper small yourself\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Let Testimus choose" }));
    await waitFor(() => expect(inputs("models.useSpeech")).toEqual([{ model: "small" }, {}]));
    expect(await screen.findByText("Testimus chooses the model again")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Let Testimus choose" })).toBeNull());

    net.routes["models.useSpeech"] = () => {
      throw new Fail("Whisper large-v3 turbo is not on this PC.");
    };
    fireEvent.click(within(await rowOf("Whisper large-v3 turbo")).getByRole("button", { name: "Use" }));
    expect(await screen.findByText("Could not use Whisper large-v3 turbo")).toBeInTheDocument();
  });

  it("Check verifies the model in a job and says its result in words", async () => {
    speech = said({ active: "turbo", models: [turbo] });
    net.routes["models.verify"] = (i) => {
      const id = srv.start({ kind: "models-verify", subject: String(i.model) });
      jobs.set(id, {
        ...(jobs.get(id) as Job),
        status: "done",
        result: { ok: true, dims: 0, ms: 3, message: "Whisper large-v3 turbo is whole and its engine is on this PC." },
      });
      return { jobId: id };
    };
    mountSettings(<ModelsSection />);
    fireEvent.click(within(await rowOf("Whisper large-v3 turbo")).getByRole("button", { name: "Check" }));
    await waitFor(() => expect(inputs("models.verify")).toEqual([{ model: "turbo" }]));
    expect(await screen.findByText("Whisper large-v3 turbo works")).toBeInTheDocument();
    expect(screen.getByText("Whisper large-v3 turbo is whole and its engine is on this PC.")).toBeInTheDocument();
  });

  it("Remove asks first, says the transcripts stay, then removes the model", async () => {
    speech = said({ active: "turbo", models: [turbo] });
    installed = [inst("turbo")];
    net.routes["models.remove"] = () => ({ model: "turbo", removed: "files", freedMB: 834 });
    mountSettings(<ModelsSection />);
    fireEvent.click(await waitFor(async () => within(await rowOf("turbo")).getByRole("button", { name: "Remove" })));
    const ask = screen.getByRole("alertdialog", { name: "Remove Whisper large-v3 turbo?" });
    expect(within(ask).getByText("Its files (834 MB) are deleted from D:\\m\\turbo.bin.")).toBeInTheDocument();
    expect(within(ask).getByText("The videos it heard keep their transcript.")).toBeInTheDocument();
    expect(within(ask).queryByText(/Vector spaces/)).toBeNull();
    fireEvent.click(within(ask).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(inputs("models.remove")).toEqual([{ model: "turbo" }]));
    expect(await screen.findByText("834 MB freed")).toBeInTheDocument();
  });

  it("« Measure… » lists the videos with a reference and their last measures, measures one with the model in use, and compares by language", async () => {
    speech = said({ active: "turbo", models: [turbo, heard("small", { label: "Whisper small" })] });
    let measured = false;
    const film = (measures: unknown[]) => ({ doc: "FILM", video: 1, name: "manoeuvre.mp4", language: "fr", measures });
    net.routes["media.measures"] = () => ({
      videos: [
        film(
          measured
            ? [{ model: "turbo", at: "2026-11-10T10:00:00.000Z", wer: 0.064, jargon: 0.5, timing: 0.4 }]
            : [{ model: "small", at: "2026-11-09T10:00:00.000Z", wer: 0.21 }],
        ),
        { doc: "REUNION", video: 2, name: "reunion.m4a", measures: [] },
      ],
      byLanguage: measured ? [{ language: "fr", model: "turbo", videos: 1, wer: 0.064, jargon: 0.5 }] : [],
    });
    net.routes["media.measure"] = () => {
      measured = true;
      return { doc: "FILM", video: 1, at: "", from: 0, to: 22, words: 5, rows: [] };
    };
    mountSettings(<ModelsSection />);
    fireEvent.click(await within(await part()).findByRole("button", { name: "Measure…" }));
    const dialog = await screen.findByRole("dialog", { name: "Measure the transcription models" });
    const videos = await within(dialog).findByRole("table", { name: "Videos with a reference transcript" });
    const row = await within(videos).findByRole("row", { name: /manoeuvre\.mp4/ });
    expect(within(row).getByText("French")).toBeInTheDocument();
    expect(within(row).getByText("Whisper small: 21 % of the words wrong · 09/11/2026")).toBeInTheDocument();
    expect(
      within(within(videos).getByRole("row", { name: /reunion\.m4a/ })).getByText("Not measured yet"),
    ).toBeVisible();
    expect(within(dialog).queryByRole("table", { name: "The models by language" })).toBeNull();
    const before = calls("media.measures").length;
    fireEvent.click(within(row).getByRole("button", { name: "Measure with Whisper large-v3 turbo" }));
    await waitFor(() => expect(inputs("media.measure")).toEqual([{ doc: "FILM", video: 1, models: ["turbo"] }]));
    expect(await screen.findByText("manoeuvre.mp4 measured")).toBeInTheDocument();
    await waitFor(() => expect(calls("media.measures").length).toBeGreaterThan(before));
    expect(
      await within(dialog).findByText(
        "Whisper large-v3 turbo: 6.4 % of the words wrong, 50 % of the project's words right, anchors off by 0.4 s · 10/11/2026",
      ),
    ).toBeInTheDocument();
    const by = within(dialog).getByRole("table", { name: "The models by language" });
    const fr = within(by).getByRole("row", { name: /French/ });
    expect(within(fr).getByText("Whisper large-v3 turbo")).toBeInTheDocument();
    expect(within(fr).getByText("6.4 %")).toBeInTheDocument();
    expect(within(fr).getByText("50 %")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Measure the transcription models" })).toBeNull());
  });

  it("« Measure… » without a reference says so; without a model in use nothing is measured; a failure is said", async () => {
    speech = said({ models: [heard("small", { label: "Whisper small" })] });
    net.routes["media.measures"] = () => ({ videos: [], byLanguage: [] });
    const first = mountSettings(<ModelsSection />);
    fireEvent.click(await within(await part()).findByRole("button", { name: "Measure…" }));
    expect(await screen.findByText("No video has a reference transcript yet.")).toBeInTheDocument();
    expect(screen.getByText(/A video gets a reference in Documents › Video › Reference…/)).toBeInTheDocument();
    first.unmount();

    net.routes["media.measures"] = () => ({
      videos: [{ doc: "FILM", video: 1, name: "manoeuvre.mp4", measures: [] }],
      byLanguage: [],
    });
    const second = mountSettings(<ModelsSection />);
    fireEvent.click(await within(await part()).findByRole("button", { name: "Measure…" }));
    expect(await screen.findByRole("button", { name: "Measure" })).toBeDisabled();
    second.unmount();

    speech = said({ active: "turbo", models: [turbo] });
    net.routes["media.measure"] = () => {
      throw new Fail("The transcription engine is not on this PC.");
    };
    const third = mountSettings(<ModelsSection />);
    fireEvent.click(await within(await part()).findByRole("button", { name: "Measure…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Measure with Whisper large-v3 turbo" }));
    expect(await screen.findByText("manoeuvre.mp4 could not be measured")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Measure with Whisper large-v3 turbo" })).toBeEnabled(),
    );
    third.unmount();

    net.routes["media.measures"] = () => {
      throw new Fail("The project's documents cannot be listed.");
    };
    mountSettings(<ModelsSection />);
    fireEvent.click(await within(await part()).findByRole("button", { name: "Measure…" }));
    expect(
      await screen.findByText("The measures could not be read: The project's documents cannot be listed."),
    ).toBeInTheDocument();
  });

  it("the model catalog below lists the search models only", async () => {
    catalog = [
      row("emb-s", { state: "installed" }),
      row("turbo", { kind: "speech", label: "Whisper large-v3 turbo", state: "installed" }),
    ];
    installed = [inst("turbo")];
    speech = said({ active: "turbo", models: [turbo] });
    mountSettings(<ModelsSection />);
    expect(await screen.findByText("1 in the catalog · 0 on this PC")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Model catalog" }));
    const all = await screen.findByRole("table", { name: "Model catalog" });
    expect(within(all).getByRole("row", { name: /M emb-s/ })).toBeInTheDocument();
    expect(within(all).queryByRole("row", { name: /Whisper/ })).toBeNull();
    expect(await rowOf("Whisper large-v3 turbo")).toBeInTheDocument();
  });
});
