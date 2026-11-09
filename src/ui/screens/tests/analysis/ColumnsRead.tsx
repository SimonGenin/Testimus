import * as stylex from "@stylexjs/stylex";
import { Badge, COLUMN_ROLE } from "../../../components/ui/Badge.tsx";
import { Disclosure } from "../../../components/ui/Disclosure.tsx";
import { type } from "../../../components/ui/type.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import type { Analysis } from "./useAnalysis.ts";

const styles = stylex.create({
  list: { display: "flex", flexDirection: "column", gap: space.s3, margin: 0, padding: 0, listStyle: "none" },
  row: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  head: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  name: { flex: 1, minWidth: 0, overflowWrap: "anywhere" },
  why: { margin: 0, color: color.textMuted },
});

// ponytail: how Claude treated each column of the test — what the team typed in a column kept as written stays word
// for word, whatever the proposals say; folded, its summary names the kept ones
export function ColumnsRead({ columns }: { columns: Analysis["columns"] }) {
  if (!columns.length) return null;
  const kept = columns.filter((c) => c.role === "keep").map((c) => c.name);
  return (
    <Disclosure
      summary="How Claude read the columns"
      meta={kept.length ? `${kept.join(", ")} kept as written` : undefined}
    >
      <ul {...stylex.props(styles.list)}>
        {columns.map((c) => (
          <li key={c.name} {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.head)}>
              <span {...stylex.props(type.compact, type.medium, styles.name)}>{c.name}</span>
              <Badge {...COLUMN_ROLE[c.role]} size="sm" />
            </span>
            {c.why && <p {...stylex.props(type.small, styles.why)}>{c.why}</p>}
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
