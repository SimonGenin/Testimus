import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { clock, type VideoShown } from "../../lib/media.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { type Proposal, type SaidLine, TranscriptLine, type TranscriptLineProps } from "./TranscriptLine.tsx";

const styles = stylex.create({
  side: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  head: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s3 },
  title: { margin: 0, color: color.textMuted, flex: 1 },
  note: { margin: 0, color: color.textMuted },
  list: { display: "flex", flexDirection: "column", gap: space.s1, margin: 0, padding: 0, listStyle: "none" },
  chapter: {
    display: "flex",
    alignItems: "baseline",
    gap: space.s3,
    paddingTop: space.s4,
    paddingInline: space.s3,
    color: color.textSubtle,
  },
  chapterNow: { color: color.accentText },
});

// ponytail: the line being said at `now` — the last one that started by then
const current = (lines: SaidLine[], now: number) => lines.findLast((l) => l.at <= now + 0.25)?.anchor ?? null;

export type TranscriptProps = {
  video: VideoShown;
  lines: SaidLine[] | undefined;
  loading: boolean;
  now: number;
  proposals: Proposal[];
  /** Claude reads the transcript and proposes corrections; absent when Claude is not there */
  onPropose?: () => void;
  proposing: boolean;
} & Pick<TranscriptLineProps, "onSeek" | "onListen" | "onFix" | "onUnfix" | "onDecide">;

// ponytail: beside the player — what is said, line by line under Claude's chapters (a chapter is a way in, never
// quotable; a line is quotable at its second). The line being said is lit as the video plays; the lines to listen to
// are counted in the head
export function Transcript({ video, lines, loading, now, proposals, onPropose, proposing, ...act }: TranscriptProps) {
  const said = lines ?? [];
  const at = current(said, now);
  const chapter = video.chapters.findLast((c) => c.at <= now + 0.25);
  const byLine = new Map(proposals.map((p) => [Math.floor(p.from), p]));
  const toHear = said.filter((l) => l.unsure && l.by !== "human").length;
  const heads = new Map<string, VideoShown["chapters"][number]>();
  for (const c of video.chapters) {
    const first = said.find((l) => l.at >= c.at - 0.5);
    if (first && !heads.has(first.anchor)) heads.set(first.anchor, c);
  }
  return (
    <section aria-label="Transcript" {...stylex.props(styles.side)}>
      <div {...stylex.props(styles.head)}>
        <h3 {...stylex.props(type.caption, styles.title)}>
          {said.length
            ? `Transcript · ${said.length} line${said.length > 1 ? "s" : ""}${toHear ? ` · ${toHear} to listen to` : ""}`
            : "Transcript"}
        </h3>
        {onPropose && said.length > 0 && (
          <Button
            size="sm"
            variant="claude-quiet"
            icon="claude"
            label="Propose corrections"
            loading={proposing}
            onClick={onPropose}
          />
        )}
      </div>
      {loading && !said.length ? (
        <>
          <Skeleton lines={4} />
          <Loading read="media.transcript" />
        </>
      ) : !said.length ? (
        <p {...stylex.props(type.small, styles.note)}>
          {video.pieces
            ? `Being heard: ${video.pieces.done} of ${video.pieces.total} pieces done.`
            : video.transcribed
              ? "Nothing is said in this video."
              : video.audio
                ? "Not heard on this PC yet: the transcription engine or its model is not installed (Settings › Models › Transcription)."
                : "This video has no sound."}
        </p>
      ) : (
        <ol aria-label="What is said" {...stylex.props(styles.list)}>
          {said.flatMap((l) => {
            const head = heads.get(l.anchor);
            return [
              ...(head
                ? [
                    <li
                      key={`c-${head.at}`}
                      {...stylex.props(type.caption, styles.chapter, chapter?.at === head.at && styles.chapterNow)}
                    >
                      <Button
                        size="xs"
                        variant="quiet"
                        label={head.title}
                        aria-current={chapter?.at === head.at ? "true" : undefined}
                        onClick={() => act.onSeek(head.at)}
                      />
                      <span {...stylex.props(type.code)}>{clock(head.at)}</span>
                    </li>,
                  ]
                : []),
              <TranscriptLine
                key={l.anchor}
                line={l}
                now={at === l.anchor}
                proposal={byLine.get(Math.floor(l.at))}
                {...act}
              />,
            ];
          })}
        </ol>
      )}
      {video.pieces && said.length > 0 && (
        <p {...stylex.props(type.small, styles.note)}>
          Being heard: {video.pieces.done} of {video.pieces.total} pieces done — the lines come as they are heard.
        </p>
      )}
    </section>
  );
}
