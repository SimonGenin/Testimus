import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../../lib/data/client.ts";
import { execute } from "../../../lib/data/query.ts";
import { errorToast, toast } from "../../../lib/toast.ts";
import { type FolderAsk, MODEL_READS } from "./actions.ts";
import { FFMPEG, WHISPER } from "./ops.tsx";

type Start = (jobId: string, key: string, kind: string, label: string, then?: (result: unknown) => void) => void;

const NO_FOLDER = "models-dir-unset";

// ponytail: what Settings › Models › Transcription does beside the catalog's own gestures (install, check, remove a
// model: useModelActions) — download the engine or ffmpeg into the runtimes folder, asked for first when there is
// none, and choose the model that hears
export function useSpeechActions(o: {
  /** no runtimes folder yet: a download asks for the models folder first */
  needsFolder: boolean;
  setFolder: (ask: FolderAsk) => void;
  start: Start;
}) {
  const client = useQueryClient();
  const fx = { invalidates: MODEL_READS };

  const refused = (e: unknown, needMB: number, again: () => void, what: string) => {
    if (e instanceof ApiError && e.code === NO_FOLDER) o.setFolder({ needMB, next: again });
    else errorToast(e, `Could not install ${what}`);
  };

  const pullEngine = async (needMB: number, backend?: "cuda" | "cpu", chosen = false): Promise<void> => {
    const again = () => void pullEngine(needMB, backend, true);
    if (!chosen && o.needsFolder) return o.setFolder({ needMB, next: again });
    try {
      const { jobId } = await execute(client, "models.pullWhisper", backend ? { backend } : {}, fx);
      o.start(jobId, WHISPER, "models-pull", "Downloading the transcription engine", () =>
        toast({ tone: "success", title: "Transcription engine installed" }),
      );
    } catch (e) {
      refused(e, needMB, again, "the transcription engine");
    }
  };

  const pullFfmpeg = async (needMB: number, chosen = false): Promise<void> => {
    const again = () => void pullFfmpeg(needMB, true);
    if (!chosen && o.needsFolder) return o.setFolder({ needMB, next: again });
    try {
      const { jobId } = await execute(client, "models.pullFfmpeg", {}, fx);
      o.start(jobId, FFMPEG, "models-pull", "Downloading ffmpeg", () =>
        toast({ tone: "success", title: "ffmpeg installed" }),
      );
    } catch (e) {
      refused(e, needMB, again, "ffmpeg");
    }
  };

  const use = async (model?: { id: string; label: string }): Promise<void> => {
    try {
      await execute(client, "models.useSpeech", model ? { model: model.id } : {}, fx);
      toast({
        tone: "success",
        title: model ? `${model.label} hears the videos` : "Testimus chooses the model again",
        detail: "From the next video heard: a video already heard keeps its transcript.",
      });
    } catch (e) {
      errorToast(e, model ? `Could not use ${model.label}` : "Could not leave the choice to Testimus");
    }
  };

  return { pullEngine, pullFfmpeg, use };
}

export type SpeechActions = ReturnType<typeof useSpeechActions>;
