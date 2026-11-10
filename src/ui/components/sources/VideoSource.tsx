import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Source } from "../../../core/types.ts";
import { fileUrl, run } from "../../lib/data/client.ts";
import { execute, useRead } from "../../lib/data/query.ts";
import { clock, momentAnchor, momentOf } from "../../lib/media.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { color, radius, space } from "../../styles/tokens.stylex.ts";
import { Banner } from "../ui/Banner.tsx";
import { Button } from "../ui/Button.tsx";
import { Loading } from "../ui/Loading.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { type } from "../ui/type.ts";
import { Video, type VideoRange } from "../ui/Video.tsx";

const styles = stylex.create({
  box: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  head: { margin: 0, color: color.textMuted },
  lines: { display: "flex", flexDirection: "column", gap: space.s1, margin: 0, padding: 0, listStyle: "none" },
  line: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr)",
    columnGap: space.s4,
    paddingBlock: space.s2,
    paddingInline: space.s4,
    borderRadius: radius.r2,
    color: color.textSubtle,
  },
  cited: { backgroundColor: color.accentSubtle, color: color.text },
  time: { color: "inherit" },
  citedTime: { color: color.accentText },
  said: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0, overflowWrap: "anywhere" },
  beside: { color: color.textMuted },
  mark: { backgroundColor: color.highlight, color: color.highlightText, borderRadius: radius.r1 },
  seen: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
    gap: space.s4,
    alignItems: "start",
  },
  pic: { display: "block", width: "100%", borderRadius: radius.r2, backgroundColor: color.surfaceSunken },
  moved: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s3, color: color.warning },
  grow: { flex: 1 },
  plain: { margin: 0 },
});

/** the test and the step a source backs, and that step's sources — what a moved range is written back to */
export type CitedIn = { test?: string; step?: number; sources?: Source[] };

export const isVideoSource = (anchor: string) => momentOf(anchor) !== null;

const written = (s: Source) =>
  `${s.docId}#${s.anchor} "${s.quote}"${s.column ? ` @${s.column}${s.item ? ` "${s.item}"` : ""}` : ""}`;

// ponytail: the words of a quote marked in what is said, compared as the check compares them — on the letters and
// digits alone; nothing is marked when they are not there
function marked(text: string, quote: string) {
  const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const q = bare(quote);
  if (!q) return [text];
  const at: number[] = [];
  let flat = "";
  [...text].forEach((ch, i) => {
    const b = bare(ch);
    if (!b) return;
    flat += b;
    for (let k = 0; k < b.length; k++) at.push(i);
  });
  const part = [q, ...(q.length > 24 ? [q.slice(0, Math.floor(q.length / 2)), q.slice(-Math.floor(q.length / 2))] : [])]
    .map((x) => ({ x, i: flat.indexOf(x) }))
    .find((m) => m.i >= 0);
  if (!part) return [text];
  const from = at[part.i];
  const to = at[part.i + part.x.length - 1] + 1;
  return [
    text.slice(0, from),
    <mark key="q" {...stylex.props(styles.mark)}>
      {text.slice(from, to)}
    </mark>,
    text.slice(to),
  ];
}

// ponytail: a source in a video, made to be checked in ten seconds — the range it cites plays in a loop, as soon as it
// is opened (a moment alone opens paused on its line), with the project's margin around it (project.json video.margin,
// read before the player is drawn so the loop starts where it will stay), drawn on the timeline, with what is said
// under the picture (the cited lines lit, the quote marked, a
// translation beside a line said in another language) or, for what is seen, the key frames of the range and their
// descriptions. Opened from a step, the range's bounds can be dragged and the source written back to the test
export function VideoSource({ source, from, size = "sm" }: { source: Source; from?: CitedIn; size?: "sm" | "md" }) {
  const client = useQueryClient();
  const m = momentOf(source.anchor);
  const n = m?.n ?? 1;
  const shown = useRead("media.show", { doc: source.docId });
  const v = shown.data?.videos.find((x) => x.n === n);
  const around = m ? { from: String(Math.max(0, m.at - 20)), to: String((m.to ?? m.at) + 30) } : {};
  const said = useRead("media.transcript", { doc: source.docId, video: n, ...around }, { enabled: !!m && !!v });
  const info = useRead("project.info", {}, { enabled: !!m });
  const [moved, setMoved] = useState<{ of: string; range: VideoRange } | null>(null);
  const [lightening, setLightening] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!m) return null;
  if (shown.isError) return <p {...stylex.props(styles.plain)}>This video could not be shown: {shown.error.message}</p>;
  if (!shown.data || info.isPending)
    return (
      <div role="status" aria-busy="true" aria-label="Loading the video">
        <Skeleton lines={3} />
        <Loading read="media.show" />
      </div>
    );
  if (!v)
    return (
      <p {...stylex.props(styles.plain)}>
        {source.docId} has no video {n}.
      </p>
    );
  const lines = said.data?.lines ?? [];
  const here = lines.findLast((l) => l.at <= m.at + 0.999);
  const next = lines.find((l) => l.at > (here?.at ?? m.at));
  const own: VideoRange =
    m.to !== undefined
      ? { from: m.at, to: m.to }
      : m.kind === "frame"
        ? { from: m.at, to: m.at + 1 }
        : { from: here?.at ?? m.at, to: next?.at ?? here?.end ?? m.at + 8 };
  const key = `${source.docId}#${source.anchor}`;
  const range = moved?.of === key ? moved.range : own;
  const seen = v.keyFrames.filter((k) => k.at >= range.from - 0.5 && k.at <= range.to + 0.5);
  const adjustable = m.kind !== "frame" && !!from?.test && !!from.step && !!from.sources?.length;
  const tracks = [
    ...(v.subtitles.said
      ? [{ src: fileUrl(`docs/${source.docId}/${v.subtitles.said}`), label: "As said", lang: "und" }]
      : []),
    ...(v.subtitles.translated
      ? [{ src: fileUrl(`docs/${source.docId}/${v.subtitles.translated}`), label: "Translated", lang: "und" }]
      : []),
  ];
  const save = async () => {
    if (!from?.test || !from.step || !from.sources || !moved) return;
    const anchor = momentAnchor(m.kind === "v" ? "v" : "t", n, moved.range.from, moved.range.to);
    setSaving(true);
    try {
      await execute(client, "tests.edit", {
        id: from.test,
        steps: [
          {
            op: "sources",
            step: from.step,
            sources: from.sources.map((s) =>
              s.docId === source.docId && s.anchor === source.anchor && s.quote === source.quote
                ? written({ ...s, anchor })
                : written(s),
            ),
          },
        ],
      });
      toast({
        tone: "success",
        title: "Source saved",
        detail: `${source.docId} ${clock(moved.range.from)} → ${clock(moved.range.to)}`,
      });
      setMoved(null);
    } catch (e) {
      errorToast(e, "The source was not saved");
    } finally {
      setSaving(false);
    }
  };
  const lighten = () => {
    if (lightening || v.light) return;
    setLightening(true);
    run("media.lighten", { doc: source.docId, video: n })
      .catch((e) => errorToast(e, "The lighter copy was not made"))
      .finally(() => setLightening(false));
  };
  return (
    <div {...stylex.props(styles.box)}>
      {lightening && (
        <Banner tone="info" compact>
          This PC cannot play the original: a lighter copy is being made, the video plays once it is ready.
        </Banner>
      )}
      <Video
        src={fileUrl(`docs/${source.docId}/${v.light ?? v.file}`)}
        label={`Video ${v.name}`}
        size={size}
        duration={v.duration}
        sound={v.sound}
        range={range}
        margin={info.data?.project.video?.margin}
        autoPlay={m.to !== undefined}
        onRange={adjustable ? (r) => setMoved({ of: key, range: r }) : undefined}
        chapters={v.chapters}
        marks={v.keyFrames.map((k) => ({ at: k.at, label: `${clock(k.at)} ${k.why}`.trim() }))}
        subtitles={tracks}
        onUnplayable={lighten}
      />
      {moved?.of === key && (
        <div {...stylex.props(type.small, styles.moved)}>
          <span>
            Range moved to {clock(moved.range.from)} → {clock(moved.range.to)}
          </span>
          <span {...stylex.props(styles.grow)} />
          <Button size="sm" variant="quiet" label="Put it back" onClick={() => setMoved(null)} />
          <Button size="sm" variant="primary" label="Save the range" loading={saving} onClick={() => void save()} />
        </div>
      )}
      {m.kind !== "t" && seen.length > 0 && (
        <>
          <h3 {...stylex.props(type.caption, styles.head)}>What is seen</h3>
          {seen.map((k) => (
            <div key={k.anchor} {...stylex.props(styles.seen)}>
              <img
                src={fileUrl(`docs/${source.docId}/${k.figure}`)}
                alt=""
                loading="lazy"
                {...stylex.props(styles.pic)}
              />
              <span {...stylex.props(styles.said)}>
                <span {...stylex.props(type.code, styles.beside)}>{clock(k.at)}</span>
                <span {...stylex.props(type.reading)}>{marked(k.description, source.quote)}</span>
              </span>
            </div>
          ))}
        </>
      )}
      {m.kind !== "t" && !seen.length && (
        <Banner tone="warning" compact>
          No key frame falls in this range: nothing seen there can be quoted yet.
        </Banner>
      )}
      {lines.length > 0 && (
        <>
          <h3 {...stylex.props(type.caption, styles.head)}>What is said</h3>
          <ul aria-label="What is said" {...stylex.props(styles.lines)}>
            {lines.map((l) => {
              const cited = m.kind === "t" && l.at >= range.from - 0.5 && l.at < range.to;
              return (
                <li
                  key={l.anchor}
                  aria-current={cited ? "true" : undefined}
                  {...stylex.props(styles.line, cited && styles.cited)}
                >
                  <span {...stylex.props(type.code, styles.time, cited && styles.citedTime)}>{clock(l.at)}</span>
                  <span {...stylex.props(styles.said)}>
                    <span {...stylex.props(type.reading)}>{cited ? marked(l.text, source.quote) : l.text}</span>
                    {l.translation && (
                      <span {...stylex.props(type.small, styles.beside)}>
                        {(l.lang ?? "").toUpperCase()} · {l.translation}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
