import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Table } from "../../../components/ui/Table.tsx";
import { type } from "../../../components/ui/type.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import type { Installed, SpeechModel } from "./data.ts";
import { ADVISED, FIT, fitMemory, hourIn, STATE, size, speedFactor } from "./data.ts";
import { OpLine } from "./OpLine.tsx";
import type { Op } from "./ops.tsx";

const styles = stylex.create({
  name: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  head: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  cell: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s1, minWidth: 0 },
  muted: { color: color.textMuted },
  acts: { display: "flex", gap: space.s2, flexWrap: "wrap", justifyContent: "flex-end" },
});

// ponytail: what a model is good for, said from its name — the catalog has no sentence for it
function about(m: SpeechModel): string {
  const what = /turbo/i.test(m.label)
    ? "The best text"
    : /small/i.test(m.label)
      ? "For a modest PC: faster, more mistakes on the project's own words"
      : "";
  return [what, `${m.languages} languages`, m.licence].filter(Boolean).join(" · ");
}

const stateOf = (m: SpeechModel) => (m.active ? STATE.active : m.state === "active" ? STATE.installed : STATE[m.state]);

// ponytail: the transcription models of the catalog as this PC has them — the one that hears is « In use », whoever
// chose it; a row's long work shows in its place, as in the model catalog
export function SpeechModels({
  models,
  installed,
  ops,
  busy,
  onInstall,
  onUse,
  onVerify,
  onRemove,
}: {
  models: SpeechModel[];
  installed: Installed[];
  ops: Op[];
  busy: boolean;
  onInstall: (m: SpeechModel) => void;
  onUse: (m: SpeechModel) => void;
  onVerify: (m: SpeechModel) => void;
  onRemove: (m: SpeechModel, i: Installed) => void;
}) {
  return (
    <Table<SpeechModel>
      label="Transcription models"
      rows={models}
      getKey={(m) => m.id}
      middle
      empty="The catalog has no transcription model."
      columns={[
        {
          key: "model",
          label: "Model",
          width: "32%",
          render: (m) => (
            <span {...stylex.props(styles.name)}>
              <span {...stylex.props(styles.head)}>
                <span {...stylex.props(type.medium)}>{m.label}</span>
                {m.advised && <Badge {...ADVISED} size="sm" />}
              </span>
              <span {...stylex.props(type.small, styles.muted)}>{about(m)}</span>
            </span>
          ),
        },
        { key: "state", label: "State", render: (m) => <Badge {...stateOf(m)} size="sm" /> },
        { key: "size", label: "Size", numeric: true, render: (m) => size(m.sizeMB) },
        {
          key: "fit",
          label: "On this PC",
          render: (m) => (
            <span {...stylex.props(styles.cell)}>
              <Badge {...FIT[m.fit.verdict]} size="sm" tooltip={m.fit.message} />
              <span {...stylex.props(type.small, styles.muted)}>{fitMemory(m.fit)}</span>
            </span>
          ),
        },
        {
          key: "speed",
          label: "Speed here",
          render: (m) =>
            m.speed > 0 ? (
              <span {...stylex.props(styles.cell)}>
                <span {...stylex.props(type.tabular)}>{speedFactor(m.speed)}</span>
                <span {...stylex.props(type.small, styles.muted)}>
                  {m.measured ? "measured" : "estimated"} · {hourIn(m.speed)}
                </span>
              </span>
            ) : (
              <span {...stylex.props(type.small, styles.muted)}>Not measured</span>
            ),
        },
        {
          key: "actions",
          label: "Actions",
          render: (m) => {
            const op = ops.find((o) => o.key === m.id);
            if (op) return <OpLine op={op} compact />;
            const inst = installed.find((i) => i.model === m.id);
            return (
              <span {...stylex.props(styles.acts)}>
                {!m.installed ? (
                  <Button
                    size="sm"
                    icon="download"
                    label="Install"
                    disabled={busy || m.state === "downloading"}
                    onClick={() => onInstall(m)}
                  />
                ) : (
                  !m.active && <Button size="sm" label="Use" disabled={busy} onClick={() => onUse(m)} />
                )}
                {m.installed && (
                  <Button size="sm" variant="quiet" label="Check" disabled={busy} onClick={() => onVerify(m)} />
                )}
                {m.installed && inst && (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="trash"
                    label="Remove"
                    disabled={busy}
                    onClick={() => onRemove(m, inst)}
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
