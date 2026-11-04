import * as stylex from "@stylexjs/stylex";
import { Button } from "../../../components/ui/Button.tsx";
import { Facts } from "../../../components/ui/Facts.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { type } from "../../../components/ui/type.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import type { PackRow, UsePackOut } from "./data.ts";
import { size } from "./data.ts";
import { Models } from "./PackCard.tsx";

const styles = stylex.create({
  list: { display: "flex", flexDirection: "column", gap: space.s2, margin: 0, padding: 0, listStyle: "none" },
  item: { display: "flex", alignItems: "center", gap: space.s2 },
  muted: { color: color.textMuted },
  dir: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  mono: { wordBreak: "break-all" },
});

export function PackPlanDialog({
  pack,
  out,
  label,
  busy,
  onConfirm,
  onChangeFolder,
  onClose,
}: {
  pack: PackRow;
  out: UsePackOut;
  label: (id: string) => string;
  busy: boolean;
  onConfirm: () => void;
  onChangeFolder: () => void;
  onClose: () => void;
}) {
  const p = out.plan;
  const total = p.download.reduce((a, d) => a + d.sizeMB, 0);
  const download = p.download.length > 0;
  return (
    <Modal
      title={download ? `Download the ${pack.label} pack` : `Use the ${pack.label} pack`}
      subtitle={
        download
          ? "Onto this PC. The project keeps its current pack: use this one once it is downloaded."
          : "For this project, on this PC. Nothing changes for your colleagues."
      }
      footNote={
        download
          ? "You can choose another pack while it downloads."
          : "The previous vectors are kept: switching back is quick."
      }
      busy={busy}
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button
            variant="primary"
            icon={download ? "download" : "check"}
            label={download ? `Download ${size(total)}` : `Use ${pack.label}`}
            loading={busy}
            onClick={onConfirm}
          />
        </>
      }
    >
      <Facts
        divided
        items={[
          { label: "Models", value: <Models embedding={out.embedding} reranker={out.reranker} label={label} /> },
          {
            label: "Downloads",
            value: p.download.length ? (
              <ul {...stylex.props(styles.list)}>
                {p.download.map((d) => (
                  <li key={d.model} {...stylex.props(styles.item)}>
                    <Icon name="download" size="sm" />
                    <span>{label(d.model)}</span>
                    <span {...stylex.props(styles.muted)}>{size(d.sizeMB)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              "Nothing: the models are already on this PC."
            ),
          },
          download && {
            label: "Into",
            value: (
              <span {...stylex.props(styles.dir)}>
                <span {...stylex.props(type.code, styles.mono)}>{p.dir ?? "Not chosen yet"}</span>
                <Button size="sm" variant="quiet" label="Change…" onClick={onChangeFolder} />
              </span>
            ),
          },
          {
            label: "Index",
            value: p.reindex
              ? `${download ? "Once used, the" : "The"} documents are indexed again with the new model (a job; search keeps working on words meanwhile).`
              : "Already indexed with these models: nothing to rebuild.",
          },
          { label: "Expected speed", value: p.expected },
        ]}
      />
    </Modal>
  );
}
