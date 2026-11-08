import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { Video, type VideoHandle } from "../../components/ui/Video.tsx";
import { fileUrl } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { clock, type MediaShown, momentOf } from "../../lib/media.ts";
import { color, container, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Transcript } from "./Transcript.tsx";

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
  row: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 3fr) minmax(0, 2fr)", [container.paneCompact]: "minmax(0, 1fr)" },
    gap: space.s5,
    alignItems: "start",
  },
  player: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  head: { margin: 0, color: color.textMuted },
  frames: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(calc(${size.sidebar} / 2), 1fr))`,
    gap: space.s3,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  pic: {
    display: "block",
    width: "100%",
    aspectRatio: "16 / 9",
    borderRadius: radius.r1,
    objectFit: "cover",
    backgroundColor: color.surfaceSunken,
  },
  line: { color: color.text, overflowWrap: "anywhere" },
  anchor: { color: color.textSubtle },
});

// ponytail: a video of a document — its player, the timed transcript and the chapters beside it (a line goes to its
// moment, the line being said is marked), its key frames under it (each an anchor frame:mm:ss a source cites); a link to
// a moment (t:04:30, frame:04:30) opens it there
export function MediaVideo({
  docId,
  shown,
  anchor,
}: {
  docId: string;
  shown: MediaShown | undefined;
  anchor?: string;
}) {
  const asked = anchor ? momentOf(anchor) : null;
  const videos = shown?.videos ?? [];
  const [pick, setPick] = useState<number | null>(asked?.n ?? null);
  const v = videos.find((x) => x.n === pick) ?? videos[0];
  const player = useRef<VideoHandle>(null);
  const [now, setNow] = useState(asked?.at ?? 0);
  const lines = useRead("media.transcript", v ? { doc: docId, video: v.n } : { doc: docId }, { enabled: !!v });
  const seek = (at: number) => {
    setNow(at);
    player.current?.seek(at);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new link to a moment moves the player there
  useEffect(() => {
    if (asked) seek(asked.at);
  }, [anchor]);

  if (!shown) return <Skeleton lines={4} />;
  if (!v) return <EmptyState icon="play" title="No video" text="This document holds no video." />;
  const url = fileUrl(`docs/${docId}/${v.file}`);
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
        <div {...stylex.props(styles.row)}>
          <div {...stylex.props(styles.player)}>
            <Video
              ref={player}
              src={url}
              label={`Video ${v.name}`}
              start={asked?.n === v.n ? asked.at : undefined}
              onTime={setNow}
            />
            {v.keyFrames.length > 0 && (
              <>
                <h3 {...stylex.props(type.caption, styles.head)}>Key frames · {v.keyFrames.length}</h3>
                <ul aria-label="Key frames" {...stylex.props(styles.frames)}>
                  {v.keyFrames.map((k) => (
                    <li key={k.anchor}>
                      <Card density="tight" label={`${k.anchor} ${k.why}`.trim()} onOpen={() => seek(k.at)}>
                        <img
                          src={fileUrl(`docs/${docId}/${k.figure}`)}
                          alt=""
                          loading="lazy"
                          {...stylex.props(styles.pic)}
                        />
                        <span {...stylex.props(type.small, styles.line)}>
                          <span {...stylex.props(type.code, styles.anchor)}>{k.anchor}</span> {k.why || clock(k.at)}
                        </span>
                      </Card>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <Transcript video={v} lines={lines.data?.lines} loading={lines.isLoading} now={now} onSeek={seek} />
        </div>
      </div>
    </div>
  );
}
