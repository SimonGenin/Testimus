import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Loading } from "../../../components/ui/Loading.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { type } from "../../../components/ui/type.ts";
import { useApp } from "../../../lib/app.ts";
import { useRead } from "../../../lib/data/query.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { Fact, Group, Hint, Row } from "../Section.tsx";
import { AdvisedRow } from "./AdvisedRow.tsx";
import type { FolderAsk, ModelRef } from "./actions.ts";
import { aboutSpeech, hourIn, type Installed, roomOf, runsOn, type SpeechModel, size } from "./data.ts";
import { useEngineActions } from "./engines.ts";
import { MeasureDialog } from "./MeasureDialog.tsx";
import { Here, type ModelLine, ModelTable } from "./ModelTable.tsx";
import { OpLine } from "./OpLine.tsx";
import { FFMPEG, type Op, WHISPER } from "./ops.tsx";

const styles = stylex.create({
  head: { display: "flex", alignItems: "center", gap: space.s2 },
  muted: { color: color.textMuted },
  line: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2 },
});

const BACKEND = { cuda: "NVIDIA build", cpu: "processor build" } as const;

const speedOf = (m: SpeechModel) =>
  m.speed > 0 ? `${hourIn(m.speed)}${m.measured ? ", measured" : ""}` : "Not measured";

// ponytail: what this PC hears videos with, one model at a time like the search models — the one advised first, the
// others under it — then the engine (whisper.cpp) and ffmpeg; installing, checking and removing a model are the
// models' own gestures (the section's useModelActions), so a download asks for the folder and the fit the same way
export function TranscriptionGroup({
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
  start: Parameters<typeof useEngineActions>[0]["start"];
  onFolder: (ask: FolderAsk) => void;
  /** then: the model is used once it is downloaded */
  onInstall: (m: ModelRef, then?: () => void) => void;
  onVerify: (m: ModelRef) => void;
  onRemove: (m: ModelRef, inst: Installed) => void;
}) {
  const app = useApp();
  const speech = useRead("models.speech", {});
  const act = useEngineActions({ needsFolder, setFolder: onFolder, start });
  const [measuring, setMeasuring] = useState(false);
  const s = speech.data;
  const active = s?.models.find((m) => m.active);
  const advised = s?.models.find((m) => m.advised) ?? null;
  const onProcessor = !!s && !s.engine.card && s.engine.backend !== "cuda";

  const use = (m: SpeechModel) => (m.installed ? void act.use(m) : onInstall(m, () => void act.use(m)));
  const lineOf = (m: SpeechModel): ModelLine => {
    const inst = installed.find((i) => i.model === m.id);
    return {
      id: m.id,
      label: m.label,
      note: aboutSpeech(m),
      why: m.fit.verdict === "fits" ? null : m.fit.message,
      runsOn: runsOn(m.fit),
      sizeMB: m.sizeMB,
      here: <Here state={m.state} />,
      inUse: m.active,
      op: ops.find((o) => o.key === m.id) ?? null,
      use: { disabled: busy || m.state === "downloading", onClick: () => use(m) },
      ...(m.installed ? { check: () => onVerify(m) } : {}),
      ...(m.installed && inst ? { remove: () => onRemove({ ...m, kind: "speech" }, inst) } : {}),
    };
  };

  const measure = (
    <Button
      size="sm"
      icon="verify"
      label="Measure on my videos…"
      disabled={app.info ? false : "Open a project first"}
      onClick={() => setMeasuring(true)}
    />
  );
  const engineOp = ops.find((o) => o.key === WHISPER) ?? null;
  const ffmpegOp = ops.find((o) => o.key === FFMPEG) ?? null;
  return (
    <Group
      id="models-transcription"
      title="Transcription"
      note="Hears what is said in a video, on this PC: the sound never leaves it. How each project's videos are heard is in its Videos page."
      actions={
        s && (
          <span {...stylex.props(styles.head)}>
            <span {...stylex.props(type.small, styles.muted)}>In use</span>
            <Badge label={active?.label ?? "None installed"} size="sm" />
          </span>
        )
      }
    >
      {!s ? (
        <Row>
          {speech.isError ? (
            <Hint>The transcription models could not be read: {speech.error.message}</Hint>
          ) : (
            <>
              <Skeleton kind="block" />
              <Loading read="models.speech" />
            </>
          )}
        </Row>
      ) : (
        <>
          {advised && (
            <AdvisedRow
              name={advised.label}
              hint={`${aboutSpeech(advised)}. ${advised.fit.message}`}
              facts={[["Download", size(advised.sizeMB)], roomOf(advised.fit), ["An hour of video", speedOf(advised)]]}
              inUse={advised.active}
              op={ops.find((o) => o.key === advised.id) ?? null}
            >
              {!advised.active && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={advised.installed ? "check" : "download"}
                  label={advised.installed ? "Use" : "Download and use"}
                  disabled={busy || advised.state === "downloading"}
                  onClick={() => use(advised)}
                />
              )}
              {measure}
            </AdvisedRow>
          )}
          {!advised && <Row>{measure}</Row>}
          <Row flush>
            <ModelTable
              label="Transcription models"
              lines={s.models.filter((m) => m !== advised).map(lineOf)}
              extra={{
                label: "An hour of video",
                render: (l) => {
                  const m = s.models.find((x) => x.id === l.id);
                  return m && <span {...stylex.props(type.tabular)}>{speedOf(m)}</span>;
                },
              }}
              busy={busy}
            />
            {s.chosen && (
              <div {...stylex.props(styles.line)}>
                <Hint>
                  You chose {s.models.find((m) => m.id === s.chosen)?.label ?? s.chosen} yourself. Left to Testimus, the
                  best model installed is used.
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
          </Row>
          <Row>
            <Fact
              label="Engine"
              hint={`whisper.cpp ${s.engine.build}, with the ${s.engine.detector} voice detector: silence and noise are never transcribed.`}
            >
              {engineOp ? (
                <OpLine op={engineOp} />
              ) : (
                <div {...stylex.props(styles.line)}>
                  {s.engine.installed ? (
                    <Badge
                      label={`whisper.cpp, ${s.engine.backend ? BACKEND[s.engine.backend] : "installed"}`}
                      tone="success"
                      icon="check"
                      size="sm"
                    />
                  ) : (
                    <Badge label="Not installed" icon="download" size="sm" />
                  )}
                  {!s.engine.installed ? (
                    <Button
                      size="sm"
                      icon="download"
                      label={`Install the ${BACKEND[s.engine.advised]}, ${size(s.engine.downloadMB)}`}
                      disabled={busy}
                      onClick={() => void act.pullEngine(s.engine.downloadMB)}
                    />
                  ) : (
                    s.engine.backend === "cpu" &&
                    s.engine.card && (
                      <Button
                        size="sm"
                        icon="download"
                        label={`Install the NVIDIA build${s.engine.advised === "cuda" ? `, ${size(s.engine.downloadMB)}` : ""}`}
                        disabled={busy}
                        onClick={() => void act.pullEngine(s.engine.downloadMB, "cuda")}
                      />
                    )
                  )}
                </div>
              )}
              {s.engine.installed && s.engine.backend === "cpu" && s.engine.card ? (
                <Hint>
                  This PC has an NVIDIA card: with that build a video is heard far faster than on the processor.
                </Hint>
              ) : (
                !s.engine.installed && (
                  <Hint>Without it a video keeps its pictures and has no transcript. No admin rights.</Hint>
                )
              )}
              {onProcessor && (
                <Hint>
                  On a PC without an NVIDIA card a video is heard 4 to 8 times faster than it plays. Saying which
                  language is spoken (
                  <Button
                    variant="link"
                    label="Settings › Videos"
                    disabled={app.info ? false : "Open a project first"}
                    onClick={() => app.navigate("settings", "videos")}
                  />
                  ) makes it about twice as fast.
                </Hint>
              )}
            </Fact>
          </Row>
          <Row>
            <Fact label="ffmpeg" hint="Reads a video's sound and frames. Without it a video is kept but not read.">
              {ffmpegOp ? (
                <OpLine op={ffmpegOp} />
              ) : (
                <div {...stylex.props(styles.line)}>
                  {s.ffmpeg.installed ? (
                    <Badge label={`Installed, ${s.ffmpeg.build}`} tone="success" icon="check" size="sm" />
                  ) : (
                    <>
                      <Badge label="Not installed" icon="download" size="sm" />
                      <Button
                        size="sm"
                        icon="download"
                        label={`Install, ${size(s.ffmpeg.downloadMB)}`}
                        disabled={busy}
                        onClick={() => void act.pullFfmpeg(s.ffmpeg.downloadMB)}
                      />
                    </>
                  )}
                </div>
              )}
            </Fact>
          </Row>
        </>
      )}
      {measuring && s && <MeasureDialog models={s.models} onClose={() => setMeasuring(false)} />}
    </Group>
  );
}
