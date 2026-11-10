import { z } from "zod";
import { command, UserError } from "../command.ts";
import { FFMPEG_ASSET, FFMPEG_BUILD, installedFfmpeg } from "../lib/ffmpeg.ts";
import { nvidiaReady, WHISPER_CUDA_DRIVER } from "../lib/fit/placement.ts";
import { machineProfile } from "../lib/machine/profile.ts";
import { needEntry } from "../lib/models-catalog.ts";
import { catalogView } from "../lib/models-install.ts";
import { readSettings, writeSettings } from "../lib/project.ts";
import { activeSpeech, speechAdvice, speechModels } from "../lib/video/engine.ts";
import {
  chooseWhisperBackend,
  installedWhisper,
  pullWhisper,
  VAD_MODEL,
  WHISPER_ASSETS,
  WHISPER_BUILD,
} from "../lib/whisper.ts";
import { fit, modelId, state } from "./models-schemas.ts";

const MB = 1024 * 1024;
const backend = z.enum(["cuda", "cpu"]).describe("cuda: the NVIDIA build (685 MB); cpu: the processor build (9 MB)");

export const commands = [
  command({
    name: "models.pullWhisper",
    summary:
      "Download the transcription engine (whisper.cpp, pinned build, SHA-256 checked) with its voice detector into the runtimes folder: the NVIDIA build on a PC with an NVIDIA card, else the processor build; a job, no admin rights.",
    input: z.object({
      backend: z.enum(["auto", "cuda", "cpu"]).default("auto").describe("auto = from this PC's graphics card"),
    }),
    output: z.object({
      dir: z.string().describe("Folder of the engine"),
      build: z.string().describe("whisper.cpp build"),
      backend,
    }),
    mutates: true,
    global: true,
    job: "models-pull",
    subject: () => "whisper.cpp",
    async run(ctx, input) {
      const chosen =
        input.backend === "auto" ? chooseWhisperBackend(await machineProfile().catch(() => null)) : input.backend;
      const w = await pullWhisper(chosen, ctx.signal, (p) =>
        ctx.progress({
          message: `whisper.cpp ${p.file}`,
          done: Math.round(p.loaded / MB),
          total: Math.round(p.total / MB),
        }),
      );
      return { dir: w.dir, build: w.build, backend: w.backend };
    },
  }),
  command({
    name: "models.speech",
    summary:
      "What this PC transcribes videos with: the engine (whisper.cpp) and ffmpeg — installed or not, which build, what to download —, and the transcription models of the catalog, each with its state, its size, whether it fits this PC, how fast it hears here (measured, else estimated), which one is advised and which one is used.",
    input: z.object({}),
    output: z.object({
      engine: z
        .object({
          installed: z.boolean().describe("Whether whisper.cpp is on this PC"),
          build: z.string().describe("The build installed, else the one Testimus downloads"),
          backend: backend.nullable().describe("The build installed (null: none)"),
          advised: backend.describe("The build that fits this PC's graphics card"),
          card: z.boolean().describe("Whether this PC has an NVIDIA card the engine can use"),
          downloadMB: z.number().describe("Size of the advised build's download, MB"),
          detector: z.string().describe("The voice detector that comes with it"),
          dir: z.string().optional().describe("Its folder"),
        })
        .describe("The transcription engine"),
      ffmpeg: z
        .object({
          installed: z.boolean().describe("Whether ffmpeg is on this PC"),
          build: z.string().describe("The build installed, else the one Testimus downloads"),
          downloadMB: z.number().describe("Size of the download, MB"),
        })
        .describe("ffmpeg, which reads the videos"),
      active: modelId.nullable().describe("The model this PC transcribes with (null: none installed)"),
      chosen: modelId.nullable().describe("The model chosen in the settings (null: the best one installed is used)"),
      models: z
        .array(
          z.object({
            id: modelId,
            label: z.string().describe("Its name"),
            licence: z.string().describe("Its licence"),
            sizeMB: z.number().describe("Download size, MB"),
            languages: z.number().describe("Languages it hears"),
            state,
            installed: z.boolean().describe("Whether its file is on this PC"),
            where: z.string().optional().describe("Its file"),
            fit,
            device: z.enum(["gpu", "cpu"]).describe("Where it would run here"),
            speed: z.number().describe("Seconds of video heard in a second on this PC"),
            measured: z.boolean().describe("True when the speed was measured here, false when it is a guess"),
            advised: z.boolean().describe("The one that suits this PC"),
            active: z.boolean().describe("The one in use"),
          }),
        )
        .describe("The transcription models, best first"),
    }),
    mutates: false,
    global: true,
    async run() {
      const machine = await machineProfile();
      const w = installedWhisper();
      const ff = installedFfmpeg();
      const advised = chooseWhisperBackend(machine);
      const view = new Map((await catalogView("speech", machine)).map((r) => [r.id, r]));
      const advice = new Map(speechAdvice(machine, w?.backend ?? advised).map((a) => [a.id, a]));
      const active = activeSpeech();
      return {
        engine: {
          installed: !!w,
          build: w?.build ?? WHISPER_BUILD,
          backend: w?.backend ?? null,
          advised,
          card: nvidiaReady(machine, WHISPER_CUDA_DRIVER),
          downloadMB: Math.round(WHISPER_ASSETS[advised].size / MB),
          detector: VAD_MODEL.name,
          ...(w ? { dir: w.dir } : {}),
        },
        ffmpeg: {
          installed: !!ff,
          build: ff?.build ?? FFMPEG_BUILD,
          downloadMB: Math.round(FFMPEG_ASSET.size / MB),
        },
        active: active?.entry.id ?? null,
        chosen: readSettings().models.speech ?? null,
        models: speechModels().flatMap((m) => {
          const row = view.get(m.entry.id);
          const a = advice.get(m.entry.id);
          if (!row || !a) return [];
          return [
            {
              id: m.entry.id,
              label: m.entry.label,
              licence: m.entry.licence,
              sizeMB: m.entry.size.downloadMB,
              languages: 99,
              state: row.state,
              installed: !!m.path,
              ...(m.path ? { where: m.path } : {}),
              fit: a.fit,
              device: a.device,
              speed: a.speed,
              measured: a.measured,
              advised: a.recommended,
              active: active?.entry.id === m.entry.id,
            },
          ];
        }),
      };
    },
  }),
  command({
    name: "models.useSpeech",
    summary:
      "Choose the model this PC transcribes videos with (a choice of this PC, kept in its settings); without a model, the best one installed is used again. A video already heard is not heard again by itself: media.retranscribe does.",
    input: z.object({
      model: modelId
        .optional()
        .describe("Catalog id of a transcription model installed here; leave out to let Testimus choose"),
    }),
    output: z.object({ active: modelId.nullable().describe("The model now used (null: none installed)") }),
    mutates: true,
    global: true,
    positional: ["model"],
    async run(_ctx, input) {
      const s = readSettings();
      if (input.model) {
        const entry = needEntry(input.model);
        if (entry.kind !== "speech")
          throw new UserError(`${entry.label} is not a transcription model.`, "testimus models speech lists them.");
        if (!speechModels().find((m) => m.entry.id === entry.id)?.path)
          throw new UserError(
            `${entry.label} is not on this PC.`,
            `Install it first: testimus models pull ${entry.id}.`,
          );
        writeSettings({ ...s, models: { ...s.models, speech: entry.id } });
      } else {
        const { speech: _dropped, ...models } = s.models;
        writeSettings({ ...s, models });
      }
      return { active: activeSpeech()?.entry.id ?? null };
    },
  }),
];
