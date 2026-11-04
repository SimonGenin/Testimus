import * as stylex from "@stylexjs/stylex";
import type { DoctorAction, DoctorCheck } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import type { IconName } from "../../components/ui/Icon.tsx";
import { Table } from "../../components/ui/Table.tsx";
import { color, fontSize, fontWeight, lineHeight, size, space } from "../../styles/tokens.stylex.ts";
import { isOpen, LOOK, lookOf } from "./checks.ts";

const styles = stylex.create({
  section: { display: "flex", flexDirection: "column", gap: space.s3 },
  title: {
    margin: 0,
    fontSize: fontSize.titleSm,
    lineHeight: lineHeight.titleSm,
    fontWeight: fontWeight.semibold,
    color: color.text,
  },
  label: { fontWeight: fontWeight.medium, color: color.text },
  result: { display: "flex", flexDirection: "column", gap: space.s1, color: color.textMuted },
  open: { color: color.text },
  todo: { color: color.text },
  strong: { fontWeight: fontWeight.semibold },
  fix: { display: "flex", justifyContent: "flex-end", whiteSpace: "nowrap" },
});

// ponytail: a fix's button says what it does by its command — a download, a folder to choose, an index to run again
const FIX_ICON: Record<string, IconName> = {
  "system.doctor": "claude",
  "models.pull": "download",
  "models.pullRuntime": "download",
  "models.setDir": "folder",
  "models.add": "folder",
  "rag.index": "refresh",
};

function Result({ check }: { check: DoctorCheck }) {
  const open = isOpen(check.state);
  // ponytail: a re-check button does not do the fix itself, so the words saying what to do stay beside it
  const recheck = check.action?.command === "system.doctor";
  const words = check.fix && (!check.action || recheck);
  return (
    <div {...stylex.props(styles.result)}>
      <span {...stylex.props(open && styles.open)}>
        {check.detail}
        {!open && check.state === "skip" && check.fix && !check.action ? ` — ${check.fix}` : ""}
      </span>
      {open && words && (
        <span {...stylex.props(styles.todo)}>
          <span {...stylex.props(styles.strong)}>What to do:</span> {check.fix}
        </span>
      )}
    </div>
  );
}

export function CheckTable({
  title,
  checks,
  busy,
  onAct,
}: {
  title: string;
  checks: DoctorCheck[];
  busy: (c: DoctorCheck) => boolean;
  onAct: (c: DoctorCheck, a: DoctorAction) => void;
}) {
  return (
    <section aria-label={title} {...stylex.props(styles.section)}>
      <h2 {...stylex.props(styles.title)}>{title}</h2>
      <Table<DoctorCheck>
        label={title}
        rows={checks}
        getKey={(c) => c.id}
        columns={[
          {
            key: "state",
            label: "State",
            width: `calc(${space.s11} * 2)`,
            render: (c) => <Badge {...LOOK[lookOf(c)]} size="sm" />,
          },
          {
            key: "label",
            label: "Check",
            width: `calc(${size.sidebar} - ${space.s8})`,
            render: (c) => <span {...stylex.props(styles.label)}>{c.label}</span>,
          },
          { key: "detail", label: "Result", render: (c) => <Result check={c} /> },
          {
            key: "fix",
            label: "Fix",
            width: "1%",
            render: (c) =>
              c.action && (
                <span {...stylex.props(styles.fix)}>
                  <Button
                    size="sm"
                    icon={FIX_ICON[c.action.command]}
                    label={c.action.label}
                    loading={busy(c)}
                    onClick={() => c.action && onAct(c, c.action)}
                  />
                </span>
              ),
          },
        ]}
      />
    </section>
  );
}
