import * as stylex from "@stylexjs/stylex";
import type { StepImage } from "../../../../core/types.ts";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { type } from "../../../components/ui/type.ts";
import { border, color, radius, size, space } from "../../../styles/tokens.stylex.ts";
import { MOVE } from "./moved.ts";
import { fileName } from "./stepText.ts";

const styles = stylex.create({
  place: { marginInline: space.s4, marginBottom: space.s3 },
  box: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, padding: space.s3 },
  label: {
    flexBasis: "100%",
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    color: color.textMuted,
  },
  thumb: { position: "relative", display: "inline-flex" },
  img: {
    width: size.thumb,
    height: size.thumb,
    objectFit: "cover",
    borderRadius: radius.r1,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    cursor: "zoom-in",
  },
  tools: { position: "absolute", top: space.s1, right: space.s1, display: "flex", gap: space.s1 },
});

// ponytail: pictures the step carries that no field embeds (Xray attachments) — dragged into a field they become a
// block, opened they go to the viewer, detached they leave with an Undo
export function StepOrphans({
  n,
  orphans,
  readOnly,
  url,
  onOpen,
  onDetach,
}: {
  n: number;
  orphans: StepImage[];
  readOnly?: boolean;
  url: (file: string) => string;
  onOpen: (file: string) => void;
  onDetach: (im: StepImage) => void;
}) {
  return (
    <div {...stylex.props(styles.place)}>
      <Card dashed padded={false}>
        <div {...stylex.props(styles.box)}>
          <span {...stylex.props(type.small, styles.label)}>
            <Badge label="Not embedded" icon="attach" size="sm" />
            {orphans.length} attachment{orphans.length > 1 ? "s" : ""} — drag into a field
          </span>
          {orphans.map((im) => (
            <span key={im.file} {...stylex.props(styles.thumb)}>
              <img
                src={url(im.file)}
                alt={fileName(im.file)}
                title={fileName(im.file)}
                draggable={!readOnly}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(MOVE, JSON.stringify({ step: n, file: im.file }));
                }}
                onClick={() => onOpen(im.file)}
                {...stylex.props(styles.img)}
              />
              <span {...stylex.props(styles.tools)}>
                <Button
                  variant="secondary"
                  size="xs"
                  iconOnly
                  icon="zoom-in"
                  label={`Open ${fileName(im.file)} in the viewer`}
                  onClick={() => onOpen(im.file)}
                />
                {!readOnly && (
                  <Button
                    variant="secondary"
                    size="xs"
                    iconOnly
                    icon="close"
                    label={`Detach ${fileName(im.file)} from step ${n}`}
                    onClick={() => onDetach(im)}
                  />
                )}
              </span>
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
