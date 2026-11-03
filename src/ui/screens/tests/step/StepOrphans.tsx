import * as stylex from "@stylexjs/stylex";
import type { StepImage } from "../../../../core/types.ts";
import { Button } from "../../../components/ui/Button.tsx";
import { border, color, fontSize, lineHeight, radius, size, space } from "../../../styles/tokens.stylex.ts";
import { MOVE } from "./moved.ts";
import { fileName } from "./stepText.ts";

const styles = stylex.create({
  box: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    marginInline: space.s4,
    marginBottom: space.s3,
    padding: space.s3,
    borderStyle: "dashed",
    borderWidth: border.width,
    borderColor: color.borderControl,
    borderRadius: radius.r2,
  },
  label: { flexBasis: "100%", fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
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
  x: { position: "absolute", top: space.s1, right: space.s1 },
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
    <div {...stylex.props(styles.box)}>
      <span {...stylex.props(styles.label)}>
        {orphans.length} attachment{orphans.length > 1 ? "s" : ""} not embedded — drag into a field
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
          {!readOnly && (
            <span {...stylex.props(styles.x)}>
              <Button
                variant="secondary"
                size="xs"
                iconOnly
                icon="close"
                label={`Detach ${fileName(im.file)} from step ${n}`}
                onClick={() => onDetach(im)}
              />
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
