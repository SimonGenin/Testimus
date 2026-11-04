import * as stylex from "@stylexjs/stylex";
import type { StepColumn } from "../../../core/types.ts";
import { Badge, type BadgeTone } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { border, color, fontSize, fontWeight, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  block: { display: "flex", flexDirection: "column", gap: space.s3 },
  head: { display: "flex", alignItems: "baseline", gap: space.s2 },
  title: {
    margin: 0,
    fontSize: fontSize.titleSm,
    lineHeight: lineHeight.titleSm,
    fontWeight: fontWeight.semibold,
    color: color.text,
  },
  count: { fontSize: fontSize.small, color: color.textSubtle },
  grow: { flex: 1 },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
  },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderBottomStyle: "solid",
    borderBottomWidth: { default: border.width, ":last-child": 0 },
    borderBottomColor: color.border,
  },
  name: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    fontWeight: fontWeight.semibold,
    color: color.text,
  },
  desc: { fontSize: fontSize.compact, lineHeight: lineHeight.compact, color: color.textMuted },
  none: { fontSize: fontSize.compact, lineHeight: lineHeight.compact, color: color.textSubtle, fontStyle: "italic" },
});

export function columnTag(c: StepColumn): { label: string; tone: BadgeTone } {
  if (c.status === "gone") return { label: "No longer in Xray", tone: "warning" };
  if (c.origin === "local") return { label: "Local only", tone: "warning" };
  if (c.status === "new") return { label: "New in Xray", tone: "warning" };
  return { label: c.builtin ? "Xray · standard" : "Xray", tone: "info" };
}

export function ColumnsView({ columns, onEdit }: { columns: StepColumn[]; onEdit: () => void }) {
  const fresh = columns.filter((c) => c.status === "new").length;
  const filled = columns.filter((c) => c.description).length;
  return (
    <section aria-labelledby="gen-columns" {...stylex.props(styles.block)}>
      <div {...stylex.props(styles.head)}>
        <h2 id="gen-columns" {...stylex.props(styles.title)}>
          Smart columns
        </h2>
        <span {...stylex.props(styles.count)}>
          {columns.length} · {filled} filled by Claude
        </span>
        <span {...stylex.props(styles.grow)} />
        <Button
          size="sm"
          variant={fresh ? "primary" : "quiet"}
          icon="columns"
          label={fresh ? "Define the columns" : "Edit in Settings"}
          onClick={onEdit}
        />
      </div>
      {fresh > 0 && (
        <Banner tone="warning" compact>
          {fresh === 1 ? "A column" : `${fresh} columns`} came from Xray without a description — Claude leaves{" "}
          {fresh === 1 ? "it" : "them"} empty until described.
        </Banner>
      )}
      <ol aria-label="Smart columns" {...stylex.props(styles.list)}>
        {columns.map((c) => {
          const tag = columnTag(c);
          return (
            <li key={c.name} {...stylex.props(styles.item)}>
              <span {...stylex.props(styles.name)}>
                {c.name}
                <Badge size="sm" tone={tag.tone} label={tag.label} />
              </span>
              {c.description ? (
                <span {...stylex.props(styles.desc)}>{c.description}</span>
              ) : (
                <span {...stylex.props(styles.none)}>No description — Claude leaves it empty.</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
