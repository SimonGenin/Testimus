import * as stylex from "@stylexjs/stylex";
import { Badge, RUN_STATUS } from "../../components/ui/Badge.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { day } from "./runs.ts";

const styles = stylex.create({
  list: { display: "flex", flexDirection: "column", gap: space.s2, margin: 0, padding: 0, listStyle: "none" },
  row: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  name: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  when: { flex: "none", color: color.textMuted },
  none: { margin: 0, color: color.textMuted },
});

// ponytail: the same test in the other runs that hold it — did it pass last time? (runs.history, newest first)
export function RunHistory({ test, run }: { test: string; run: string }) {
  const read = useRead("runs.history", { test });
  if (!read.data) return <Loading read="runs.history" />;
  const others = read.data.runs.filter((r) => r.run !== run);
  if (!others.length)
    return <p {...stylex.props(type.small, styles.none)}>This test is in no other run of the project.</p>;
  return (
    <ul aria-label="This test in other runs" {...stylex.props(styles.list)}>
      {others.map((r) => (
        <li key={r.run} {...stylex.props(type.compact, styles.row)}>
          <Badge {...RUN_STATUS[r.status]} size="sm" />
          <span title={r.name} {...stylex.props(styles.name)}>
            {r.name}
          </span>
          <span {...stylex.props(type.small, styles.when)}>
            {[day(r.updatedAt ?? r.createdAt), r.updatedBy].filter(Boolean).join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
