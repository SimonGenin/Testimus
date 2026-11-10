import * as stylex from "@stylexjs/stylex";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Loading } from "../../../components/ui/Loading.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { type } from "../../../components/ui/type.ts";
import { useApp } from "../../../lib/app.ts";
import { useRead } from "../../../lib/data/query.ts";
import { color, size as sizes, space } from "../../../styles/tokens.stylex.ts";
import { Hint } from "../Section.tsx";
import type { FolderAsk, ModelRef } from "./actions.ts";
import type { Installed } from "./data.ts";
import { FfmpegCard } from "./FfmpegCard.tsx";
import { FFMPEG, type Op, WHISPER } from "./ops.tsx";
import { SpeechEngine } from "./SpeechEngine.tsx";
import { SpeechModels } from "./SpeechModels.tsx";
import { useSpeechActions } from "./speech.ts";

const styles = stylex.create({
  part: { display: "flex", flexDirection: "column", gap: space.s5, minWidth: 0 },
  head: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  title: { margin: 0 },
  intro: { margin: 0, maxWidth: sizes.reading, color: color.textMuted },
  engines: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${sizes.sidebar}), 1fr))`,
    gap: space.s5,
  },
  chosen: { display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: space.s3, rowGap: space.s2 },
});

// ponytail: what this PC hears videos with — the engine, ffmpeg and the transcription models, each with what it is
// here and its one gesture; installing, checking and removing a model are the catalog's own gestures (the section's
// useModelActions), so a download asks for the folder and says whether it fits the same way everywhere
export function TranscriptionCard({
  installed,
  ops,
  busy,
  needsFolder,
  start,
  onFolder,
  onInstall,
  onVerify,
  onRemove,
}: {
  installed: Installed[];
  ops: Op[];
  busy: boolean;
  needsFolder: boolean;
  start: Parameters<typeof useSpeechActions>[0]["start"];
  onFolder: (ask: FolderAsk) => void;
  onInstall: (m: ModelRef) => void;
  onVerify: (m: ModelRef) => void;
  onRemove: (m: ModelRef, inst: Installed) => void;
}) {
  const app = useApp();
  const speech = useRead("models.speech", {});
  const act = useSpeechActions({ needsFolder, setFolder: onFolder, start });
  const s = speech.data;
  const chosen = s?.chosen ? s.models.find((m) => m.id === s.chosen) : undefined;
  const onProcessor = !!s && !s.engine.card && s.engine.backend !== "cuda";
  return (
    <section aria-labelledby="s-models-transcription" {...stylex.props(styles.part)}>
      <div {...stylex.props(styles.head)}>
        <h3 id="s-models-transcription" {...stylex.props(type.title, styles.title)}>
          Transcription
        </h3>
        <p {...stylex.props(type.compact, styles.intro)}>
          What is said in a video is heard on this PC: the sound never leaves it. A video already heard is heard again
          only when you ask.
        </p>
      </div>
      {!s ? (
        speech.isError ? (
          <Hint>The transcription models could not be read: {speech.error.message}</Hint>
        ) : (
          <>
            <Skeleton kind="block" />
            <Loading read="models.speech" />
          </>
        )
      ) : (
        <>
          <div {...stylex.props(styles.engines)}>
            <SpeechEngine
              engine={s.engine}
              op={ops.find((o) => o.key === WHISPER) ?? null}
              busy={busy}
              onInstall={(backend) => void act.pullEngine(s.engine.downloadMB, backend)}
            />
            <FfmpegCard
              ffmpeg={s.ffmpeg}
              op={ops.find((o) => o.key === FFMPEG) ?? null}
              busy={busy}
              onInstall={() => void act.pullFfmpeg(s.ffmpeg.downloadMB)}
            />
          </div>
          <SpeechModels
            models={s.models}
            installed={installed}
            ops={ops}
            busy={busy}
            onInstall={onInstall}
            onUse={(m) => void act.use(m)}
            onVerify={onVerify}
            onRemove={(m, inst) => onRemove({ ...m, kind: "speech" }, inst)}
          />
          {s.chosen && (
            <div {...stylex.props(styles.chosen)}>
              <Hint>
                You chose {chosen?.label ?? s.chosen} yourself. Left to Testimus, the best model installed is used.
              </Hint>
              <Button
                size="sm"
                variant="quiet"
                label="Let Testimus choose"
                disabled={busy}
                onClick={() => void act.use()}
              />
            </div>
          )}
          {onProcessor && (
            <Banner tone="info" compact>
              On a PC without an NVIDIA card a video is heard 4 to 8 times faster than it plays. Saying which language
              is spoken (
              <Button
                variant="link"
                label="Settings › Project › Videos"
                disabled={app.info ? false : "Open a project first"}
                onClick={() => app.navigate("settings", "project-videos")}
              />
              ) makes it about twice as fast.
            </Banner>
          )}
          <Hint>
            Measure on your own videos: type a few minutes of a video as you hear them in Documents › Video › Reference;
            the models installed are then held against it.
          </Hint>
        </>
      )}
    </section>
  );
}
