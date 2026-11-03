import * as stylex from "@stylexjs/stylex";
import type { PlanOp, PushOpResult } from "../../../../core/types.ts";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Icon, type IconName } from "../../../components/ui/Icon.tsx";
import { Table } from "../../../components/ui/Table.tsx";
import { color, space } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  op: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  icon: { display: "inline-flex", color: color.textMuted },
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

const STATE: Record<OpState, { label: string; tone: "success" | "danger" | "info" | "neutral"; busy?: boolean }> = {
  done: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  running: { label: "Running", tone: "info", busy: true },
  "not-started": { label: "Not started", tone: "neutral" },
};

type Row = { n: number; op: PlanOp };

// the operations of a push, in order: what each does, and while it runs where each one is
export function OpsTable({ ops, state }: { ops: PlanOp[]; state?: (i: number) => OpState }) {
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
          render: (r) => (
            <span {...stylex.props(styles.op)}>
              <span {...stylex.props(styles.icon)}>
                <Icon name={OP_ICON[r.op.kind] ?? "chevron-right"} size="sm" />
              </span>
              {r.op.label}
            </span>
          ),
        },
        ...(state
          ? [
              {
                key: "state",
                label: "State",
                width: "22%",
                render: (r: Row) => {
                  const s = STATE[state(r.n - 1)];
                  return <Badge label={s.label} tone={s.tone} busy={s.busy} size="sm" />;
                },
              },
            ]
          : []),
      ]}
    />
  );
}
