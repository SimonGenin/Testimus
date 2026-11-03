import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.tsx";
import { border, color, fontSize, lineHeight, radius, shadow, size, space } from "../../../styles/tokens.stylex.ts";
import { stripMarker } from "../markers.stylex.ts";
import { type Moved, MOVE } from "./moved.ts";

const styles = stylex.create({
  strip: {
    position: "relative",
    height: space.s5,
    marginBlock: `calc(-1 * ${space.s2})`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    height: size.controlMd,
    marginBlock: 0,
    justifyContent: "flex-start",
    paddingInlineStart: space.s3,
    color: color.textSubtle,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
  },
  line: {
    position: "absolute",
    insetInline: space.s3,
    top: "50%",
    borderTopStyle: "dashed",
    borderTopWidth: border.width,
    borderTopColor: {
      default: "transparent",
      [stylex.when.ancestor(":hover", stripMarker)]: color.borderControl,
      [stylex.when.ancestor(":focus-within", stripMarker)]: color.borderControl,
    },
  },
  over: { borderTopColor: color.accent, borderTopStyle: "solid" },
  hint: {
    opacity: {
      default: 1,
      [stylex.when.ancestor(":hover", stripMarker)]: 0,
      [stylex.when.ancestor(":focus-within", stripMarker)]: 0,
    },
  },
  btns: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    paddingInline: space.s2,
    borderRadius: radius.full,
    backgroundColor: color.surfaceRaised,
    boxShadow: shadow.s2,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", stripMarker)]: 1,
      [stylex.when.ancestor(":focus-within", stripMarker)]: 1,
    },
  },
  btnsEmpty: { position: "absolute", left: "50%", transform: "translateX(-50%)" },
});

const takes = (e: React.DragEvent) => ["Files", MOVE].some((t) => e.dataTransfer.types.includes(t));

// ponytail: the strip between two blocks (and the whole of an empty field) — it shows « Text · Image · Table » on hover or
// focus and takes a dropped picture, file or block where it is
export function BlockInsert({
  empty,
  table,
  onText,
  onImage,
  onTable,
  onDrop,
}: {
  empty?: boolean;
  table: boolean;
  onText: () => void;
  onImage: () => void;
  onTable: () => void;
  onDrop: (drop: { moved: Moved } | { files: File[] }) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      role="group"
      aria-label="Insert a block"
      data-testid="block-insert"
      data-over={over || undefined}
      {...stylex.props(stripMarker, styles.strip, empty && styles.empty)}
      onDragOver={(e) => {
        if (!takes(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        if (!takes(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const moved = e.dataTransfer.getData(MOVE);
        if (moved) onDrop({ moved: JSON.parse(moved) as Moved });
        else onDrop({ files: Array.from(e.dataTransfer.files) });
      }}
    >
      <span aria-hidden="true" {...stylex.props(styles.line, over && styles.over)} />
      {empty && <span {...stylex.props(styles.hint)}>Empty — type, paste an image or add a table</span>}
      <span {...stylex.props(styles.btns, empty && styles.btnsEmpty)} onMouseDown={(e) => e.preventDefault()}>
        <Button variant="quiet" size="sm" icon="text" label="Text" onClick={onText} />
        <Button variant="quiet" size="sm" icon="image" label="Image" onClick={onImage} />
        {table && <Button variant="quiet" size="sm" icon="table" label="Table" onClick={onTable} />}
      </span>
    </div>
  );
}
