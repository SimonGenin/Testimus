import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { clock, type VideoShown } from "../../lib/media.ts";
import { color, radius, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  head: { margin: 0, color: color.textMuted },
  frames: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(calc(${size.sidebar} / 1.6), 1fr))`,
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
  text: { color: color.text, overflowWrap: "anywhere" },
  anchor: { color: color.textSubtle },
  human: { color: color.success },
  row: { display: "flex", alignItems: "center", gap: space.s2, flexWrap: "wrap" },
  grow: { flex: 1 },
  edit: { display: "flex", flexDirection: "column", gap: space.s2 },
});

type Frame = VideoShown["keyFrames"][number];

// ponytail: the key frames of a video — each an anchor a source cites (frame:mm:ss, or a range v:from..to that holds
// it) with what it shows, the text a source quotes for what is seen without a word. A click goes to its moment; the
// description is Claude's reading and can be corrected: corrected, it is a person's and Claude never rewrites it
export function KeyFrames({
  docId,
  frames,
  now,
  onSeek,
  onDescribe,
}: {
  docId: string;
  frames: Frame[];
  now: number;
  onSeek: (at: number) => void;
  onDescribe: (frame: Frame, text: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<{ anchor: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!frames.length) return null;
  const near = frames.findLast((k) => k.at <= now + 0.25)?.anchor;
  const save = (k: Frame, text: string) => {
    setBusy(true);
    void onDescribe(k, text)
      .then(() => setEditing(null))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <h3 {...stylex.props(type.caption, styles.head)}>Key frames · {frames.length}</h3>
      <ul aria-label="Key frames" {...stylex.props(styles.frames)}>
        {frames.map((k) => (
          <li key={k.anchor}>
            <Card
              density="tight"
              selected={near === k.anchor}
              label={editing?.anchor === k.anchor ? undefined : `${k.anchor} ${k.why}`.trim()}
              onOpen={editing?.anchor === k.anchor ? undefined : () => onSeek(k.at)}
              footer={
                editing?.anchor === k.anchor ? undefined : (
                  <div {...stylex.props(styles.row)}>
                    {k.fixed && <span {...stylex.props(type.small, styles.human)}>Corrected by a person</span>}
                    <span {...stylex.props(styles.grow)} />
                    <Button
                      size="xs"
                      variant="quiet"
                      label={k.description ? "Correct" : "Describe"}
                      onClick={() => setEditing({ anchor: k.anchor, text: k.description })}
                    />
                  </div>
                )
              }
            >
              <img src={fileUrl(`docs/${docId}/${k.figure}`)} alt="" loading="lazy" {...stylex.props(styles.pic)} />
              {editing?.anchor === k.anchor ? (
                <div {...stylex.props(styles.edit)}>
                  <Text
                    ariaLabel={`What the frame at ${clock(k.at)} shows`}
                    multiline
                    autoFocus
                    value={editing.text}
                    onChange={(text) => setEditing({ anchor: k.anchor, text })}
                  />
                  <div {...stylex.props(styles.row)}>
                    {k.fixed && (
                      <Button
                        size="xs"
                        variant="quiet"
                        label="Give back to Claude"
                        disabled={busy}
                        onClick={() => save(k, "")}
                      />
                    )}
                    <span {...stylex.props(styles.grow)} />
                    <Button size="xs" variant="quiet" label="Cancel" onClick={() => setEditing(null)} />
                    <Button
                      size="xs"
                      variant="primary"
                      label="Save"
                      loading={busy}
                      disabled={!editing.text.trim()}
                      onClick={() => save(k, editing.text)}
                    />
                  </div>
                </div>
              ) : (
                <span {...stylex.props(type.small, styles.text)}>
                  <span {...stylex.props(type.code, styles.anchor)}>{clock(k.at)}</span>{" "}
                  {k.description || k.why || "Not described yet."}
                </span>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
