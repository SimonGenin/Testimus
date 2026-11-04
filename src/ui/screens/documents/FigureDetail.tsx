import * as stylex from "@stylexjs/stylex";
import type { FigureEntry } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { fileUrl } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import {
  border,
  color,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  space,
} from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  img: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    aspectRatio: "2 / 1",
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    color: color.textSubtle,
    overflow: "hidden",
  },
  pic: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" },
  detail: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    padding: space.s5,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    minWidth: 0,
  },
  figure: { margin: 0, display: "flex", flexDirection: "column", gap: space.s2 },
  caption: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
  kv: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "baseline",
    columnGap: space.s5,
    rowGap: space.s2,
    margin: 0,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
  },
  key: { color: color.textMuted },
  value: { margin: 0, minWidth: 0, overflowWrap: "anywhere", color: color.text },
  mono: { fontFamily: fontFamily.mono, fontSize: fontSize.code, lineHeight: lineHeight.code },
  reading: { display: "flex", flexDirection: "column", gap: space.s2 },
  description: { margin: 0, fontSize: fontSize.compact, lineHeight: lineHeight.compact, color: color.text },
  small: { margin: 0, fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
  labels: { fontWeight: fontWeight.medium, color: color.text },
  acts: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
});

export const isDescribed = (f: FigureEntry) => !!f.description.trim();

export function FigureImage({ docId, figure }: { docId: string; figure: FigureEntry }) {
  return (
    <span {...stylex.props(styles.img)}>
      {figure.file ? (
        <img src={fileUrl(`docs/${docId}/${figure.file}`)} alt="" loading="lazy" {...stylex.props(styles.pic)} />
      ) : null}
    </span>
  );
}

export function DescribedBadge({ figure }: { figure: FigureEntry }) {
  return isDescribed(figure) ? (
    <Badge size="sm" tone="claude" icon="claude" label="Described" />
  ) : (
    <Badge size="sm" icon="circle-dashed" label="Not described" />
  );
}

const sectionLabel = (anchor: string) => (anchor.startsWith("§") ? `§ ${anchor.slice(1)}` : anchor);

// ponytail: the figure picked in the grid — its picture, where it is, what Claude read in it (a description is never
// quotable: a source quotes the caption), and the way to it in the text or to a new reading
export function FigureDetail({
  docId,
  figure,
  busy,
  onOpen,
  onDescribe,
}: {
  docId: string;
  figure: FigureEntry;
  busy: boolean;
  onOpen: (anchor: string) => void;
  onDescribe: () => void;
}) {
  const at = useRead("docs.show", { id: docId, anchor: figure.anchor });
  const section = at.data?.section && at.data.section !== figure.anchor ? at.data.section : "";
  const described = !!figure.description.trim();
  const name = figure.caption || figure.anchor;
  return (
    <aside aria-label={name} {...stylex.props(styles.detail)}>
      <figure {...stylex.props(styles.figure)}>
        <FigureImage docId={docId} figure={figure} />
        {figure.caption && <figcaption {...stylex.props(styles.caption)}>{figure.caption}</figcaption>}
      </figure>
      <dl {...stylex.props(styles.kv)}>
        <dt {...stylex.props(styles.key)}>Anchor</dt>
        <dd {...stylex.props(styles.value, styles.mono)}>
          {docId}#{figure.anchor}
        </dd>
        {section && (
          <>
            <dt {...stylex.props(styles.key)}>Section</dt>
            <dd {...stylex.props(styles.value)}>
              <Button size="xs" variant="quiet" label={sectionLabel(section)} onClick={() => onOpen(section)} />
            </dd>
          </>
        )}
        {figure.kind && (
          <>
            <dt {...stylex.props(styles.key)}>Kind</dt>
            <dd {...stylex.props(styles.value)}>{figure.kind}</dd>
          </>
        )}
      </dl>
      {described ? (
        <Banner tone="claude" icon="claude" title="Claude's reading">
          <span {...stylex.props(styles.reading)}>
            <span {...stylex.props(styles.description)}>{figure.description}</span>
            <span {...stylex.props(styles.small)}>
              {figure.labels?.length ? (
                <>
                  Text in the picture: <span {...stylex.props(styles.labels)}>{figure.labels.join(" · ")}</span>
                </>
              ) : (
                "No text visible in the picture."
              )}
            </span>
            <span {...stylex.props(styles.small)}>Description only — the caption is what a source can quote</span>
          </span>
        </Banner>
      ) : (
        <p {...stylex.props(styles.small)}>
          {figure.file
            ? "Claude has not read this picture yet: search finds it by its caption only."
            : "The conversion kept no picture for this figure: only its caption is in the text."}
        </p>
      )}
      <div {...stylex.props(styles.acts)}>
        <Button size="sm" icon="text" label="Show in the text" onClick={() => onOpen(figure.anchor)} />
        {figure.file && (
          <Button
            size="sm"
            variant="claude-quiet"
            icon="claude"
            label={described ? "Describe again" : "Describe it"}
            loading={busy}
            onClick={onDescribe}
          />
        )}
      </div>
    </aside>
  );
}
