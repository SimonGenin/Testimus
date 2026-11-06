import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.tsx";
import { type } from "../../../components/ui/type.ts";
import { border, color, radius, shadow, size, space } from "../../../styles/tokens.stylex.ts";
import { stripMarker } from "../markers.stylex.ts";
import { MOVE, type Moved } from "./moved.ts";

const styles = stylex.create({
  frame: {
    borderWidth: 0,
    padding: 0,
    margin: 0,
    minWidth: 0,
    position: "relative",
    zIndex: { default: "auto", ":hover": 1, ":focus-within": 1 },
  },
  // ponytail: a strip is its own 8 px gap between two blocks (or beside a picture or a table at a field's edge) and
  // never lies over a block — text is selected anywhere on it; next to a text block, its tools add the rest
  strip: {
    position: "relative",
    height: space.s3,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    height: size.controlMd,
    justifyContent: "flex-start",
    paddingInlineStart: space.s3,
    color: color.textSubtle,
  },
  line: {
    boxSizing: "border-box",
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
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
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
    pointerEvents: {
      default: "none",
      [stylex.when.ancestor(":hover", stripMarker)]: "auto",
      [stylex.when.ancestor(":focus-within", stripMarker)]: "auto",
    },
  },
});

const takes = (e: React.DragEvent) => ["Files", MOVE].some((t) => e.dataTransfer.types.includes(t));

// ponytail: the strip between two blocks (and the whole of an empty field) — it shows « Text · Image · Table » on hover or
// focus and takes a dropped picture, file or block where it is
export function BlockInsert({
  empty,
  onText,
  onImage,
  onTable,
  onDrop,
}: {
  empty?: boolean;
  onText: () => void;
  onImage: (files: File[]) => void;
  onTable: () => void;
  onDrop: (drop: { moved: Moved } | { files: File[] }) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <fieldset
      aria-label="Insert a block"
      data-testid="block-insert"
      data-over={over || undefined}
      {...stylex.props(stripMarker, styles.frame)}
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
      <div {...stylex.props(styles.strip, empty && [type.small, styles.empty])}>
        <span aria-hidden="true" {...stylex.props(styles.line, over && styles.over)} />
        {empty && <span {...stylex.props(styles.hint)}>Empty — type, paste an image or add a table</span>}
        <span {...stylex.props(styles.btns)} onMouseDown={(e) => e.preventDefault()}>
          <Button variant="quiet" size="sm" icon="text" label="Text" onClick={onText} />
          <Button
            variant="quiet"
            size="sm"
            icon="image"
            label="Image"
            pick={{ accept: "image/*", multiple: true, onFiles: onImage }}
          />
          <Button variant="quiet" size="sm" icon="table" label="Table" onClick={onTable} />
        </span>
      </div>
    </fieldset>
  );
}
