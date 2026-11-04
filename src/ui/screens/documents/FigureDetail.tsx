import * as stylex from "@stylexjs/stylex";
import type { FigureEntry } from "../../../core/types.ts";
import { Answer } from "../../components/ui/Answer.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Facts } from "../../components/ui/Facts.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { color, radius, space } from "../../styles/tokens.stylex.ts";

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
  figure: { margin: 0, display: "flex", flexDirection: "column", gap: space.s2 },
  caption: { color: color.textMuted },
  reading: { display: "flex", flexDirection: "column", gap: space.s2 },
  description: { margin: 0, color: color.text },
  small: { margin: 0, color: color.textMuted },
  labels: { color: color.text },
  acts: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
});

export const isDescribed = (f: FigureEntry) => !!f.description.trim();

export function FigureImage({ docId, figure }: { docId: string; figure: FigureEntry }) {
  return (
    <span {...stylex.props(styles.img)}>
      {figure.file ? (
        <img src={fileUrl(`docs/${docId}/${figure.file}`)} alt="" loading="lazy" {...stylex.props(styles.pic)} />
      ) : (
        <Icon name="image" size="lg" />
      )}
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
    <aside aria-label={name}>
      <Card density="compact">
        <figure {...stylex.props(styles.figure)}>
          <FigureImage docId={docId} figure={figure} />
          {figure.caption && <figcaption {...stylex.props(type.small, styles.caption)}>{figure.caption}</figcaption>}
        </figure>
        <Facts
          items={[
            {
              label: "Anchor",
              value: (
                <span {...stylex.props(type.code)}>
                  {docId}#{figure.anchor}
                </span>
              ),
            },
            !!section && {
              label: "Section",
              value: <Button variant="link" label={sectionLabel(section)} onClick={() => onOpen(section)} />,
            },
            !!figure.kind && { label: "Kind", value: figure.kind },
          ]}
        />
        {described ? (
          <Answer title="Claude's reading" meta="Description only — the caption is what a source can quote">
            <span {...stylex.props(styles.reading)}>
              <span {...stylex.props(type.compact, styles.description)}>{figure.description}</span>
              <span {...stylex.props(type.small, styles.small)}>
                {figure.labels?.length ? (
                  <>
                    Text in the picture:{" "}
                    <span {...stylex.props(type.medium, styles.labels)}>{figure.labels.join(" · ")}</span>
                  </>
                ) : (
                  "No text visible in the picture."
                )}
              </span>
            </span>
          </Answer>
        ) : (
          <p {...stylex.props(type.small, styles.small)}>
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
      </Card>
    </aside>
  );
}
