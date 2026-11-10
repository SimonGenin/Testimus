import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Table } from "../../../components/ui/Table.tsx";
import { type } from "../../../components/ui/type.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { IN_USE, type ModelState, STATE, size } from "./data.ts";
import { OpLine } from "./OpLine.tsx";
import type { Op } from "./ops.tsx";

const styles = stylex.create({
  name: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  sub: { color: color.textMuted },
  why: { color: color.warning },
  off: { color: color.textDisabled },
  acts: { display: "flex", alignItems: "center", gap: space.s1, flexWrap: "wrap", justifyContent: "flex-end" },
});

// ponytail: On this PC — a model installed here (or checked, or broken) is a badge, one that is not is plain words
export function Here({ state }: { state: ModelState }) {
  if (state === "available") return <span {...stylex.props(type.small, styles.sub)}>{STATE.available.label}</span>;
  return <Badge {...STATE[state === "active" ? "installed" : state]} size="sm" />;
}

/** one model as a row of its kind's table: what it is, where it runs here, its download, whether it is on this PC */
export type ModelLine = {
  id: string;
  label: string;
  note?: ReactNode;
  /** why it may not run well here, or why it is not offered — said in the warning colour under its name */
  why?: string | null;
  /** greyed: not offered here (its Use is disabled with the reason) */
  off?: boolean;
  runsOn: string;
  sizeMB: number | null;
  /** On this PC: installed, downloading, not installed */
  here: ReactNode;
  inUse: boolean;
  /** its long work (a download, a check): shown in place of its actions */
  op: Op | null;
  use?: { disabled: boolean | string; onClick: () => void } | null;
  check?: () => void;
  remove?: () => void;
};

// ponytail: every model of a kind but the one advised (which has its own row above), one row each with its one gesture
// — Use, or « In use »; a model on this PC can be checked and removed from its row
export function ModelTable({
  label,
  lines,
  extra,
  busy,
}: {
  label: string;
  lines: ModelLine[];
  /** a column of the kind's own before « On this PC » (transcription: how long an hour of video takes) */
  extra?: { label: string; render: (l: ModelLine) => ReactNode };
  busy: boolean;
}) {
  const muted = (l: ModelLine) => (l.off ? styles.off : null);
  return (
    <Table<ModelLine>
      label={label}
      rows={lines}
      getKey={(l) => l.id}
      flush
      middle
      columns={[
        {
          key: "model",
          label: "Model",
          width: "40%",
          render: (l) => (
            <span {...stylex.props(styles.name, muted(l))}>
              <span {...stylex.props(type.medium)}>{l.label}</span>
              {l.note && <span {...stylex.props(type.small, styles.sub, muted(l))}>{l.note}</span>}
              {l.why && <span {...stylex.props(type.small, l.off ? styles.off : styles.why)}>{l.why}</span>}
            </span>
          ),
        },
        { key: "runs", label: "Runs on", render: (l) => <span {...stylex.props(muted(l))}>{l.runsOn}</span> },
        {
          key: "size",
          label: "Download",
          numeric: true,
          render: (l) => <span {...stylex.props(muted(l))}>{l.sizeMB === null ? "" : size(l.sizeMB)}</span>,
        },
        ...(extra ? [{ key: "extra", label: extra.label, render: extra.render }] : []),
        { key: "here", label: "On this PC", render: (l) => l.here },
        {
          key: "action",
          label: "Action",
          render: (l) => {
            if (l.op) return <OpLine op={l.op} compact />;
            return (
              <span {...stylex.props(styles.acts)}>
                {l.check && (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="verify"
                    iconOnly
                    label="Check"
                    disabled={busy}
                    onClick={l.check}
                  />
                )}
                {l.remove && (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="trash"
                    iconOnly
                    label="Remove"
                    disabled={l.inUse ? "In use: choose another model first" : busy}
                    onClick={l.remove}
                  />
                )}
                {l.inUse ? (
                  <Badge {...IN_USE} size="sm" />
                ) : (
                  l.use && <Button size="sm" label="Use" disabled={l.use.disabled} onClick={l.use.onClick} />
                )}
              </span>
            );
          },
        },
      ]}
    />
  );
}
