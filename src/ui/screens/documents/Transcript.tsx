import * as stylex from "@stylexjs/stylex";
import { List } from "../../components/ui/List.tsx";
import { type } from "../../components/ui/type.ts";
import { clock, type VideoShown } from "../../lib/media.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  side: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  head: { margin: 0, color: color.textMuted },
  time: { color: color.textSubtle },
  note: { margin: 0, color: color.textMuted },
});

type Line = { anchor: string; at: number; end: number; text: string };

// ponytail: the line being said at `now` — the last one that started by then
const current = (lines: Line[], now: number) => lines.findLast((l) => l.at <= now + 0.25)?.anchor ?? null;

// ponytail: beside the player — Claude's chapters (never quotable) and Whisper's transcript, each line its anchor
// t:mm:ss, quotable verbatim; a line or a chapter goes to its moment, the line being said is picked
export function Transcript({
  video,
  lines,
  loading,
  now,
  onSeek,
}: {
  video: VideoShown;
  lines: Line[] | undefined;
  loading: boolean;
  now: number;
  onSeek: (at: number) => void;
}) {
  const said = lines ?? [];
  const chapter = video.chapters.findLast((c) => c.at <= now + 0.25);
  return (
    <section aria-label="Chapters and transcript" {...stylex.props(styles.side)}>
      {video.chapters.length > 0 && (
        <>
          <h3 {...stylex.props(type.caption, styles.head)}>Chapters (by Claude)</h3>
          <List
            label="Chapters"
            items={video.chapters}
            getKey={(c) => String(c.at)}
            selected={chapter ? String(chapter.at) : null}
            onSelect={(k) => onSeek(Number(k))}
            renderItem={(c) => ({
              title: c.title,
              wrap: true,
              lead: <span {...stylex.props(type.code, styles.time)}>{clock(c.at)}</span>,
            })}
          />
        </>
      )}
      <h3 {...stylex.props(type.caption, styles.head)}>Transcript (local, Whisper)</h3>
      {!loading && !said.length ? (
        <p {...stylex.props(type.small, styles.note)}>
          {video.transcribed
            ? "Nothing was said in this video."
            : "Not transcribed on this PC: its speech model is not installed (Settings › Models), or the video has no sound."}
        </p>
      ) : (
        <List
          label="Transcript"
          items={said}
          getKey={(l) => l.anchor}
          selected={current(said, now)}
          onSelect={(k) => {
            const l = said.find((x) => x.anchor === k);
            if (l) onSeek(l.at);
          }}
          loading={loading ? 4 : false}
          renderItem={(l) => ({
            title: l.text,
            wrap: true,
            lead: <span {...stylex.props(type.code, styles.time)}>{l.anchor}</span>,
          })}
        />
      )}
    </section>
  );
}
