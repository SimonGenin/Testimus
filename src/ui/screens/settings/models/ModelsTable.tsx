import * as stylex from "@stylexjs/stylex";
import { Button } from "../../../components/ui/Button.tsx";
import { Table } from "../../../components/ui/Table.tsx";
import { color, fontFamily, fontSize, lineHeight, space } from "../../../styles/tokens.stylex.ts";
import type { CatalogRow, Installed } from "./data.ts";
import { isInstalled, size } from "./data.ts";
import { FitChip } from "./FitChip.tsx";
import { OpLine } from "./OpLine.tsx";
import type { Op } from "./ops.tsx";
import { StateChip } from "./StateChip.tsx";

const styles = stylex.create({
  name: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  sub: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    color: color.textMuted,
  },
  perf: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
  acts: { display: "flex", gap: space.s2, flexWrap: "wrap" },
});

export function ModelsTable({
  rows,
  installed,
  inUse,
  ops,
  busy,
  onInstall,
  onUse,
  onVerify,
  onRemove,
}: {
  rows: CatalogRow[];
  installed: Installed[];
  inUse: string[];
  ops: Op[];
  busy: boolean;
  onInstall: (r: CatalogRow) => void;
  onUse: (r: CatalogRow) => void;
  onVerify: (r: CatalogRow) => void;
  onRemove: (r: CatalogRow, i: Installed) => void;
}) {
  const instOf = (r: CatalogRow) => installed.find((i) => i.model === r.id);
  return (
    <Table<CatalogRow>
      label="Model catalog"
      dense
      rows={rows}
      getKey={(r) => r.id}
      columns={[
        {
          key: "model",
          label: "Model",
          render: (r) => {
            const inst = instOf(r);
            return (
              <span {...stylex.props(styles.name)}>
                <span>{r.label}</span>
                <span {...stylex.props(styles.sub)}>
                  {r.kind === "embedding" ? "Embedding" : "Reranker"} · {r.tier} · {r.runtimes.join(", ")}
                </span>
                {inst && (
                  <span title={inst.where} {...stylex.props(styles.sub)}>
                    {inst.where}
                  </span>
                )}
                {inst?.perf && <span {...stylex.props(styles.perf)}>{inst.perf}</span>}
              </span>
            );
          },
        },
        {
          key: "state",
          label: "State",
          render: (r) => <StateChip state={inUse.includes(r.id) ? "active" : r.state} />,
        },
        { key: "size", label: "Size", numeric: true, render: (r) => size(instOf(r)?.sizeMB ?? r.sizeMB) },
        { key: "fit", label: "Fit", render: (r) => <FitChip fit={r.fit} /> },
        {
          key: "actions",
          label: "Actions",
          render: (r) => {
            const inst = instOf(r);
            const op = ops.find((o) => o.key === r.id);
            if (op) return <OpLine op={op} />;
            const here = isInstalled(r.state) || !!inst;
            const used = inUse.includes(r.id);
            return (
              <span {...stylex.props(styles.acts)}>
                {!here ? (
                  <Button
                    size="sm"
                    icon="download"
                    label="Install"
                    disabled={busy || r.state === "downloading"}
                    onClick={() => onInstall(r)}
                  />
                ) : (
                  <Button size="sm" label={used ? "In use" : "Use"} disabled={busy || used} onClick={() => onUse(r)} />
                )}
                {here && <Button size="sm" icon="check" label="Verify" disabled={busy} onClick={() => onVerify(r)} />}
                {inst && (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="trash"
                    label="Remove"
                    disabled={used ? "In use for this project: choose another model first" : busy}
                    onClick={() => onRemove(r, inst)}
                  />
                )}
              </span>
            );
          },
        },
      ]}
    />
  );
}
