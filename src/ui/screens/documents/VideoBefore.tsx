import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { MediaFile } from "../../../core/types.ts";
import { type } from "../../components/ui/type.ts";
import { execute, useRead } from "../../lib/data/query.ts";
import { clock, isSound } from "../../lib/media.ts";
import { errorToast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { type Heard, HeardFields, heardInput } from "./HeardFields.tsx";
import { VideoEstimate } from "./VideoEstimate.tsx";

const styles = stylex.create({
  video: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  name: { margin: 0, color: color.textMuted, overflowWrap: "anywhere" },
});

// ponytail: a video before its first conversion — what will be heard of it (kept on the video as soon as it is chosen,
// so the estimate under it follows the part chosen) and what it will take
export function VideoBefore({
  docId,
  file,
  leftOut,
  named,
}: {
  docId: string;
  file: MediaFile;
  /** the document is never given to Claude */
  leftOut: boolean;
  /** the document holds several files: the video's name stands above its choices */
  named: boolean;
}) {
  const client = useQueryClient();
  const estimate = useRead("media.estimate", { doc: docId, video: file.n }).data;
  const [heard, setHeard] = useState<Heard>({
    spoken: file.spoken ?? [],
    track: file.track ?? null,
    from: file.range ? clock(file.range.from) : "",
    to: file.range ? clock(file.range.to) : "",
  });
  const duration = estimate?.duration ?? file.duration ?? 0;
  const kept = useRef(JSON.stringify(heard));
  const sound = isSound(file.name);
  const keep = async (next: Heard) => {
    const now = JSON.stringify(next);
    if (now === kept.current) return;
    try {
      await execute(
        client,
        "media.set",
        { doc: docId, video: file.n, ...heardInput(next, duration) },
        { invalidates: [["media.estimate", { doc: docId }]] },
      );
      kept.current = now;
    } catch (e) {
      errorToast(e, "The choice was not kept");
    }
  };
  return (
    <section aria-label={file.name} {...stylex.props(styles.video)}>
      {named && <h4 {...stylex.props(type.small, type.strong, styles.name)}>{file.name}</h4>}
      <HeardFields
        value={heard}
        tracks={Array.from({ length: estimate?.tracks ?? 0 }, () => ({}))}
        duration={duration}
        sound={sound}
        onChange={setHeard}
        onSettle={(next) => void keep(next)}
      />
      <VideoEstimate docId={docId} video={file.n} sound={sound} leftOut={leftOut} />
    </section>
  );
}
