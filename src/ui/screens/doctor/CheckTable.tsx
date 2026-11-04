import * as stylex from "@stylexjs/stylex";
import type { DoctorAction, DoctorCheck } from "../../../core/types.ts";
import { Badge, HEALTH } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import type { IconName } from "../../components/ui/Icon.tsx";
import { Table } from "../../components/ui/Table.tsx";
import { type } from "../../components/ui/type.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { isOpen, lookOf, pathPieces } from "./checks.ts";

const styles = stylex.create({
  section: { display: "flex", flexDirection: "column", gap: space.s5 },
  title: { margin: 0, color: color.text },
  label: { color: color.text },
  result: { display: "flex", flexDirection: "column", gap: space.s1, color: color.textMuted, overflowWrap: "anywhere" },
  open: { color: color.text },
  todo: { color: color.text },
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
        {pathPieces(check.detail).map((p, i) =>
          p.path ? (
            <span key={i} {...stylex.props(type.code)}>
              {p.text}
            </span>
          ) : (
            p.text
          ),
        )}
        {!open && check.state === "skip" && check.fix && !check.action ? ` — ${check.fix}` : ""}
      </span>
      {open && words && (
        <span {...stylex.props(styles.todo)}>
          <span {...stylex.props(type.strong)}>What to do:</span> {check.fix}
        </span>
      )}
    </div>
  );
}

export function CheckTable({
  title,
  checks,
  loading = false,
  busy,
  onAct,
}: {
  title: string;
  checks: DoctorCheck[];
  /** the check runs: the section and its columns, skeleton rows in them */
  loading?: boolean;
  busy: (c: DoctorCheck) => boolean;
  onAct: (c: DoctorCheck, a: DoctorAction) => void;
}) {
  return (
    <section aria-label={title} {...stylex.props(styles.section)}>
      <h2 {...stylex.props(type.titleSm, styles.title)}>{title}</h2>
      <Table<DoctorCheck>
        label={title}
        rows={checks}
        loading={loading}
        getKey={(c) => c.id}
        columns={[
          {
            key: "state",
            label: "State",
            width: `calc(${space.s11} * 2)`,
            render: (c) => <Badge {...HEALTH[lookOf(c)]} />,
          },
          {
            key: "label",
            label: "Check",
            width: `calc(${size.sidebar} - ${space.s8})`,
            render: (c) => <span {...stylex.props(type.medium, styles.label)}>{c.label}</span>,
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
