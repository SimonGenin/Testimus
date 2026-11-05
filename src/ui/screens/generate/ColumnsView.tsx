import * as stylex from "@stylexjs/stylex";
import type { StepColumn } from "../../../core/types.ts";
import { Badge, COLUMN, type Word } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { type } from "../../components/ui/type.ts";
import { border, color, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  block: { display: "flex", flexDirection: "column", gap: space.s3 },
  head: { display: "flex", alignItems: "center", gap: space.s2, minHeight: size.controlSm },
  title: { margin: 0, color: color.text },
  count: { color: color.textSubtle },
  grow: { flex: 1 },
  list: { listStyle: "none", margin: 0, padding: 0 },
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
  name: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, color: color.text },
  desc: { color: color.textMuted },
  none: { color: color.textSubtle },
});

export function columnTag(c: StepColumn): Word {
  if (c.status === "gone") return COLUMN.gone;
  if (c.origin === "local") return COLUMN.local;
  if (c.status === "new") return COLUMN["new-in-xray"];
  return c.builtin ? COLUMN.standard : COLUMN.xray;
}

export function ColumnsView({ columns, onEdit }: { columns: StepColumn[]; onEdit: () => void }) {
  const fresh = columns.filter((c) => c.status === "new").map((c) => c.name);
  const filled = columns.filter((c) => c.description).length;
  return (
    <section aria-labelledby="gen-columns" {...stylex.props(styles.block)}>
      <div {...stylex.props(styles.head)}>
        <h2 id="gen-columns" {...stylex.props(type.titleSm, styles.title)}>
          Smart columns
        </h2>
        <span {...stylex.props(type.small, styles.count)}>
          {columns.length} · {filled} filled by Claude
        </span>
        <span {...stylex.props(styles.grow)} />
        <Button size="sm" variant="quiet" icon="settings" label="Define the columns" onClick={onEdit} />
      </div>
      {fresh.length > 0 && (
        <Banner tone="warning" compact>
          Found in Xray, not described yet: {fresh.join(", ")} — Claude leaves {fresh.length === 1 ? "it" : "them"}{" "}
          empty until described in « Define the columns ».
        </Banner>
      )}
      <Card padded={false}>
        <ol aria-label="Smart columns" {...stylex.props(styles.list)}>
          {columns.map((c) => (
            <li key={c.name} {...stylex.props(type.compact, styles.item)}>
              <span {...stylex.props(type.strong, styles.name)}>
                {c.name}
                <Badge size="sm" {...columnTag(c)} />
              </span>
              {c.description ? (
                <span {...stylex.props(styles.desc)}>{c.description}</span>
              ) : (
                <span {...stylex.props(styles.none)}>No description — Claude leaves it empty.</span>
              )}
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}
