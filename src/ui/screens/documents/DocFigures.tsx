import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { FigureEntry } from "../../../core/types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Tooltip } from "../../components/ui/Tooltip.tsx";
import { fileUrl } from "../../lib/data/client.ts";
import { border, color, fontFamily, fontSize, lineHeight, radius, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  box: { flex: 1, minHeight: 0, overflowY: "auto", backgroundColor: color.surface },
  inner: { display: "flex", flexDirection: "column", gap: space.s5, padding: space.s5 },
  bar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s4,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(${size.menuMax}, 1fr))`,
    gap: space.s4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  tile: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    padding: space.s3,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
    minWidth: 0,
    overflow: "hidden",
  },
  img: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: size.figurePreview,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    overflow: "hidden",
  },
  pic: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" },
  id: { fontFamily: fontFamily.mono, fontSize: fontSize.code, color: color.textSubtle },
});

type Which = "all" | "described" | "bare";

// ponytail: every figure in reading order; a tile's caption opens it in the text
export function DocFigures({
  docId,
  figures,
  onOpen,
}: {
  docId: string;
  figures: FigureEntry[];
  onOpen: (anchor: string) => void;
}) {
  const [which, setWhich] = useState<Which>("all");
  const described = figures.filter((f) => f.description.trim());
  const shown =
    which === "all" ? figures : which === "described" ? described : figures.filter((f) => !f.description.trim());
  return (
    <div {...stylex.props(styles.box)}>
      <div {...stylex.props(styles.inner)}>
        <div {...stylex.props(styles.bar)}>
          <Segmented
            label="Which figures"
            size="sm"
            value={which}
            onChange={setWhich}
            options={[
              { value: "all", label: "All", count: figures.length },
              { value: "described", label: "Described", count: described.length },
              { value: "bare", label: "Not described", count: figures.length - described.length },
            ]}
          />
          <span>In reading order · open one to see it in the text</span>
        </div>
        {shown.length ? (
          <ul aria-label="Figures" {...stylex.props(styles.grid)}>
            {shown.map((f) => (
              <li key={f.anchor} {...stylex.props(styles.tile)}>
                <Tooltip label={f.description.trim() || f.caption || f.anchor}>
                  <span {...stylex.props(styles.img)}>
                    {f.file && (
                      <img
                        src={fileUrl(`docs/${docId}/${f.file}`)}
                        alt=""
                        loading="lazy"
                        {...stylex.props(styles.pic)}
                      />
                    )}
                  </span>
                </Tooltip>
                <span>
                  <Button size="sm" variant="quiet" label={f.caption || f.anchor} onClick={() => onOpen(f.anchor)} />
                </span>
                {f.caption && <span {...stylex.props(styles.id)}>{f.anchor}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact icon="image" title="No figure here." />
        )}
      </div>
    </div>
  );
}
