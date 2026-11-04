import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Button } from "../../../components/ui/Button.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { color, fontFamily, fontSize, lineHeight, space } from "../../../styles/tokens.stylex.ts";
import type { PackRow, UsePackOut } from "./data.ts";
import { size } from "./data.ts";
import { Models } from "./PackCard.tsx";

const styles = stylex.create({
  rows: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: space.s5,
    rowGap: space.s4,
    margin: 0,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
  },
  dt: { color: color.textMuted },
  dd: { margin: 0, minWidth: 0 },
  list: { display: "flex", flexDirection: "column", gap: space.s2, margin: 0, padding: 0, listStyle: "none" },
  item: { display: "flex", alignItems: "center", gap: space.s2 },
  muted: { color: color.textMuted },
  dir: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  mono: { fontFamily: fontFamily.mono, wordBreak: "break-all" },
});

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt {...stylex.props(styles.dt)}>{term}</dt>
      <dd {...stylex.props(styles.dd)}>{children}</dd>
    </>
  );
}

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
          <Button variant="quiet" label="Cancel" onClick={onClose} />
          <Button
            variant="primary"
            label={download ? `Download ${size(total)}` : `Use ${pack.label}`}
            loading={busy}
            onClick={onConfirm}
          />
        </>
      }
    >
      <dl {...stylex.props(styles.rows)}>
        <Row term="Models">
          <Models embedding={out.embedding} reranker={out.reranker} label={label} />
        </Row>
        <Row term="Downloads">
          {p.download.length ? (
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
          )}
        </Row>
        {download && (
          <Row term="Into">
            <span {...stylex.props(styles.dir)}>
              <span {...stylex.props(styles.mono)}>{p.dir ?? "Not chosen yet"}</span>
              <Button size="sm" variant="quiet" label="Change…" onClick={onChangeFolder} />
            </span>
          </Row>
        )}
        <Row term="Index">
          {p.reindex
            ? `${download ? "Once used, the" : "The"} documents are indexed again with the new model (a job; search keeps working on words meanwhile).`
            : "Already indexed with these models: nothing to rebuild."}
        </Row>
        <Row term="Expected speed">{p.expected}</Row>
      </dl>
    </Modal>
  );
}
