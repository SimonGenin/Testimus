import * as stylex from "@stylexjs/stylex";
import type { Source } from "../../../core/types.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { clock, momentOf } from "../../lib/media.ts";
import { color, radius, space } from "../../styles/tokens.stylex.ts";
import { type } from "../ui/type.ts";

const styles = stylex.create({
  box: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  pic: {
    display: "block",
    width: "100%",
    aspectRatio: "16 / 9",
    objectFit: "cover",
    borderRadius: radius.r1,
    backgroundColor: color.surfaceSunken,
  },
  line: {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 3,
    overflow: "hidden",
    overflowWrap: "anywhere",
  },
});

type Cited = Pick<Source, "docId" | "anchor">;

// ponytail: what a video source shows before it is opened — the key frame nearest to the moment or the range it cites
// (inside the range first) and the first line it cites: the line being said then, or for what is seen the key frame's
// description. It is the content of the chip's tooltip, mounted on hover: nothing is read for a chip nobody points at,
// and no sound plays before a click
export function VideoPreview({ source }: { source: Cited }) {
  const m = momentOf(source.anchor);
  const n = m?.n ?? 1;
  const from = m?.at ?? 0;
  const to = m?.to ?? from;
  const shown = useRead("media.show", { doc: source.docId }, { enabled: !!m, optional: true });
  const v = shown.data?.videos.find((x) => x.n === n);
  const said = useRead(
    "media.transcript",
    { doc: source.docId, video: n, from: String(Math.max(0, from - 20)), to: String(to + 30) },
    { enabled: m?.kind === "t" && !!v, optional: true },
  );
  if (!m || !v) return null;
  const away = (at: number) => (at < from ? from - at : at > to ? at - to : 0);
  const near = v.keyFrames.reduce<(typeof v.keyFrames)[number] | undefined>(
    (best, k) => (!best || away(k.at) < away(best.at) ? k : best),
    undefined,
  );
  const lines = said.data?.lines ?? [];
  const line = lines.findLast((l) => l.at <= from + 0.999) ?? lines.find((l) => l.at < Math.max(to, from + 1));
  const first =
    m.kind === "t"
      ? line && { at: line.at, text: line.text }
      : near?.description && away(near.at) <= 0.5
        ? { at: near.at, text: near.description }
        : undefined;
  if (!near && !first) return null;
  return (
    <span {...stylex.props(styles.box)}>
      {near && (
        <img
          src={fileUrl(`docs/${shown.data?.doc ?? source.docId}/${near.figure}`)}
          alt=""
          {...stylex.props(styles.pic)}
        />
      )}
      {first && (
        <span {...stylex.props(type.small, styles.line)}>
          <span {...stylex.props(type.tabular)}>{clock(first.at)}</span> {first.text}
        </span>
      )}
    </span>
  );
}

// ponytail: the preview of a source in a video, nothing for any other source — what a chip is given as its `preview`
export const videoPreview = (source: Cited) => (momentOf(source.anchor) ? <VideoPreview source={source} /> : undefined);
