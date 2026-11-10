import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { Video, type VideoHandle } from "../../components/ui/Video.tsx";
import { fileUrl, run } from "../../lib/data/client.ts";
import { execute, useRead } from "../../lib/data/query.ts";
import { clock, type MediaShown, momentOf } from "../../lib/media.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { tracked } from "../../lib/uploads.ts";
import { color, container, space } from "../../styles/tokens.stylex.ts";
import { HearAgain, type VideoChoices } from "./HearAgain.tsx";
import { KeyFrames } from "./KeyFrames.tsx";
import { Transcript } from "./Transcript.tsx";
import type { Proposal, SaidLine } from "./TranscriptLine.tsx";
import { VideoReference } from "./VideoReference.tsx";
import { VideoReport } from "./VideoReport.tsx";

const styles = stylex.create({
  box: { flex: 1, minHeight: 0, overflowY: "auto", backgroundColor: color.surface, containerType: "inline-size" },
  inner: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingTop: space.s5,
    paddingInline: space.s7,
    paddingBottom: space.s10,
  },
  top: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s3 },
  facts: { margin: 0, color: color.textMuted, flex: 1, minWidth: 0 },
  row: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 3fr) minmax(0, 2fr)", [container.paneCompact]: "minmax(0, 1fr)" },
    gap: space.s5,
    alignItems: "start",
  },
  player: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  under: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s3 },
  grow: { flex: 1 },
});

const NAMES: Record<string, string> = {
  fr: "French",
  en: "English",
  de: "German",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
  pt: "Portuguese",
};
const spell = (seconds: number) => (seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`);

// ponytail: a video of a document — its player (the range a link cites looped, the chapters and key frames on its
// timeline, the subtitles), what is said beside it under Claude's chapters (a line goes to its moment, is confirmed or
// corrected after listening), its key frames under it with what each shows. A link to a moment or a range (t:04:30,
// t:02:36..02:52, v:…, frame:04:30) opens it there
export function MediaVideo({
  docId,
  shown,
  anchor,
}: {
  docId: string;
  shown: MediaShown | undefined;
  anchor?: string;
}) {
  const client = useQueryClient();
  const asked = anchor ? momentOf(anchor) : null;
  const videos = shown?.videos ?? [];
  const [pick, setPick] = useState<number | null>(asked?.n ?? null);
  const v = videos.find((x) => x.n === pick) ?? videos[0];
  const player = useRef<VideoHandle>(null);
  const [now, setNow] = useState(asked?.at ?? 0);
  const [dialog, setDialog] = useState<"hear" | "reference" | null>(null);
  const [busy, setBusy] = useState<"propose" | "keep" | "light" | null>(null);
  const lines = useRead("media.transcript", v ? { doc: docId, video: v.n } : { doc: docId }, { enabled: !!v });
  const proposals = useRead("media.proposals", v ? { doc: docId, video: v.n } : { doc: docId }, { enabled: !!v });
  const seek = (at: number) => {
    setNow(at);
    player.current?.seek(at);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new link to a moment moves the player there
  useEffect(() => {
    if (asked && asked.to === undefined) seek(asked.at);
  }, [anchor]);

  if (!shown) return <Skeleton lines={4} />;
  if (!v) return <EmptyState icon="play" title="No video" text="This document holds no video." />;
  const at = { doc: docId, video: v.n };
  const act = async (name: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (e) {
      errorToast(e, name);
    }
  };
  const job = (kind: "propose" | "keep" | "light", name: string, work: () => Promise<unknown>) => {
    setBusy(kind);
    void act(name, work).finally(() => setBusy(null));
  };
  const hear = async (c: VideoChoices) => {
    await act("The video could not be heard again", async () => {
      await execute(client, "media.set", {
        ...at,
        spoken: c.spoken,
        ...(c.track === null ? { allTracks: true } : { track: c.track }),
        ...(c.from.trim() || c.to.trim()
          ? { ...(c.from.trim() ? { from: c.from.trim() } : {}), ...(c.to.trim() ? { to: c.to.trim() } : {}) }
          : { whole: true }),
      });
      setDialog(null);
      await tracked(
        { name: v.name, job: "convert", docId, phase: "converting", message: "Hearing the video again" },
        (onStart) => run("media.retranscribe", { ...at, all: c.all, index: true }, undefined, onStart),
      );
    });
  };
  const heard = Object.entries(v.languages)
    .sort((a, b) => b[1] - a[1])
    .map(([l, s]) => `${NAMES[l] ?? l.toUpperCase()} ${spell(s)}`)
    .join(" · ");
  const cited = asked && asked.n === v.n && asked.to !== undefined ? { from: asked.at, to: asked.to } : undefined;
  const tracks = [
    ...(v.subtitles.said ? [{ src: fileUrl(`docs/${docId}/${v.subtitles.said}`), label: "As said", lang: "und" }] : []),
    ...(v.subtitles.translated
      ? [{ src: fileUrl(`docs/${docId}/${v.subtitles.translated}`), label: "Translated", lang: "und" }]
      : []),
  ];
  return (
    <div data-testid="doc-video" {...stylex.props(styles.box)}>
      <div {...stylex.props(styles.inner)}>
        {videos.length > 1 && (
          <Segmented
            label="Video"
            size="sm"
            value={String(v.n)}
            options={videos.map((x) => ({ value: String(x.n), label: x.name }))}
            onChange={(n) => setPick(Number(n))}
          />
        )}
        <div {...stylex.props(styles.top)}>
          <p {...stylex.props(type.small, styles.facts)}>
            {v.transcribed
              ? [heard, v.with && `heard by ${v.with}${v.device === "gpu" ? " on the graphics card" : ""}`]
                  .filter(Boolean)
                  .join(" · ") || "Heard on this PC: nothing is said."
              : v.audio
                ? "Not heard on this PC yet."
                : "This video has no sound."}
          </p>
          <Button size="sm" variant="quiet" label="Reference…" onClick={() => setDialog("reference")} />
          <Button size="sm" icon="refresh" label="Hear again…" disabled={!v.audio} onClick={() => setDialog("hear")} />
        </div>
        {v.report && (
          <VideoReport
            docId={docId}
            video={v.n}
            onApply={(undo) =>
              act("The report was not applied", () =>
                execute(client, "media.applyReport", { ...at, undo, index: true }).then(() =>
                  toast({
                    tone: "success",
                    title: undo ? "The transcript before is back" : "The new transcript is kept",
                  }),
                ),
              )
            }
          />
        )}
        {busy === "light" && (
          <Banner tone="info" compact>
            This PC cannot play the original: a lighter copy is being made, the video plays once it is ready.
          </Banner>
        )}
        <div {...stylex.props(styles.row)}>
          <div {...stylex.props(styles.player)}>
            <Video
              ref={player}
              src={fileUrl(`docs/${docId}/${v.light ?? v.file}`)}
              label={`Video ${v.name}`}
              start={asked?.n === v.n && !cited ? asked.at : undefined}
              range={cited}
              duration={v.duration}
              chapters={v.chapters}
              marks={v.keyFrames.map((k) => ({ at: k.at, label: `${clock(k.at)} ${k.why}`.trim() }))}
              subtitles={tracks}
              onTime={setNow}
              onUnplayable={() => {
                if (!v.light && busy !== "light")
                  job("light", "The lighter copy was not made", () => run("media.lighten", at));
              }}
            />
            <div {...stylex.props(styles.under)}>
              <span {...stylex.props(styles.grow)} />
              <Button
                size="sm"
                icon="image"
                label={`Keep the frame at ${clock(now)}`}
                loading={busy === "keep"}
                onClick={() =>
                  job("keep", "The frame was not kept", () =>
                    run("media.keep", { ...at, at: String(Math.floor(now)) }).then(() =>
                      toast({ tone: "success", title: "Key frame kept", detail: `frame:${clock(now)} can be cited.` }),
                    ),
                  )
                }
              />
            </div>
            <KeyFrames
              docId={docId}
              frames={v.keyFrames}
              now={now}
              onSeek={seek}
              onDescribe={(k, text) =>
                act("The description was not saved", () =>
                  execute(client, "media.describe", { ...at, at: String(k.at), text, index: true }),
                )
              }
            />
          </div>
          <Transcript
            video={v}
            lines={lines.data?.lines}
            loading={lines.isLoading}
            now={now}
            proposals={proposals.data?.proposals ?? []}
            proposing={busy === "propose"}
            onPropose={() => job("propose", "Claude could not read the transcript", () => run("media.propose", at))}
            onSeek={seek}
            onListen={(l: SaidLine) => player.current?.loop({ from: l.at, to: Math.max(l.end, l.at + 1) })}
            onFix={(l, text) =>
              act("The line was not saved", () =>
                execute(client, "media.fix", { ...at, at: String(l.at), ...(text ? { text } : {}), index: true }),
              )
            }
            onUnfix={(l) =>
              act("The line was not given back", () =>
                execute(client, "media.unfix", { ...at, at: String(l.at), index: true }),
              )
            }
            onDecide={(p: Proposal, accept) =>
              act("The proposal was not decided", () =>
                execute(client, "media.decide", { ...at, id: p.id, accept, index: true }),
              )
            }
          />
        </div>
      </div>
      {dialog === "hear" && <HearAgain docId={docId} video={v} onClose={() => setDialog(null)} onHear={hear} />}
      {dialog === "reference" && <VideoReference docId={docId} video={v} onClose={() => setDialog(null)} />}
    </div>
  );
}
