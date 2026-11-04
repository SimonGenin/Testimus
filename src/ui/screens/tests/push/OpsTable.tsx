import * as stylex from "@stylexjs/stylex";
import type { PlanOp, PushOpResult } from "../../../../core/types.ts";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Icon, type IconName } from "../../../components/ui/Icon.tsx";
import { Table } from "../../../components/ui/Table.tsx";
import { type } from "../../../components/ui/type.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  op: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  icon: { display: "inline-flex", color: color.textMuted },
  cell: { display: "flex", flexDirection: "column", gap: space.s1 },
  error: {
    paddingInlineStart: `calc(${space.s2} + ${space.s4})`,
    color: color.danger,
    overflowWrap: "anywhere",
  },
});

const OP_ICON: Record<PlanOp["kind"], IconName> = {
  create: "plus",
  update: "text",
  upload: "upload",
  embed: "image",
  label: "tag",
  link: "link",
  folder: "folder",
  other: "chevron-right",
};

export type OpState = PushOpResult["status"] | "running";

const STATE: Record<
  OpState,
  { label: string; tone: "success" | "danger" | "info" | "neutral"; icon?: IconName; busy?: boolean }
> = {
  done: { label: "Done", tone: "success", icon: "check-circle" },
  failed: { label: "Failed", tone: "danger", icon: "x-circle" },
  running: { label: "Running", tone: "info", busy: true },
  "not-started": { label: "Not started", tone: "neutral", icon: "circle-dashed" },
};

type Row = { n: number; op: PlanOp };

// the operations of a push, in order: what each does, and while it runs where each one is
export function OpsTable({
  ops,
  state,
  error,
}: {
  ops: PlanOp[];
  /** each operation's state; null: the column is there, still empty (the plan before the push) */
  state?: (i: number) => OpState | null;
  /** what Jira said of the operation it refused */
  error?: (i: number) => string | undefined;
}) {
  return (
    <Table<Row>
      label="Operations"
      dense
      rows={ops.map((op, i) => ({ n: i + 1, op }))}
      getKey={(r) => String(r.n)}
      columns={[
        { key: "n", label: "#", numeric: true, width: "8%" },
        {
          key: "op",
          label: "Operation",
          render: (r) => {
            const why = error?.(r.n - 1);
            return (
              <span {...stylex.props(styles.cell)}>
                <span {...stylex.props(styles.op)}>
                  <span {...stylex.props(styles.icon)}>
                    <Icon name={OP_ICON[r.op.kind] ?? "chevron-right"} size="sm" />
                  </span>
                  {r.op.label}
                </span>
                {why && <span {...stylex.props(type.small, styles.error)}>{why}</span>}
              </span>
            );
          },
        },
        ...(state
          ? [
              {
                key: "state",
                label: "State",
                width: "22%",
                render: (r: Row) => {
                  const at = state(r.n - 1);
                  if (!at) return null;
                  const s = STATE[at];
                  return <Badge label={s.label} tone={s.tone} icon={s.icon} busy={s.busy} size="sm" />;
                },
              },
            ]
          : []),
      ]}
    />
  );
}
