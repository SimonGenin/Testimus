import { Button, Icon, Modal } from "../../../components/legacy/index.ts";
import type { PackRow, UsePackOut } from "./data.ts";
import { size } from "./data.ts";

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
  const title = download ? `Download the ${pack.label} pack` : `Use the ${pack.label} pack`;
  return (
    <Modal
      label={title}
      title={title}
      subtitle={
        download
          ? "Onto this PC. The project keeps its current pack: use this one once it is downloaded."
          : "For this project, on this PC. Nothing changes for your colleagues."
      }
      width={560}
      onClose={onClose}
      foot={
        <>
          <span className="muted foot-hint">
            {download
              ? "You can choose another pack while it downloads."
              : "The previous vectors are kept: switching back is quick."}
          </span>
          <span className="spacer" />
          <Button tone="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button tone="primary" disabled={busy} onClick={onConfirm}>
            {download ? `Download ${size(total)}` : `Use ${pack.label}`}
          </Button>
        </>
      }
    >
      <div className="plan-row">
        <span className="label">Models</span>
        <span>
          {label(out.embedding)}
          <span className="muted"> + </span>
          {out.reranker ? label(out.reranker) : <span className="muted">no reranker</span>}
        </span>
      </div>
      <div className="plan-row">
        <span className="label">Downloads</span>
        {p.download.length ? (
          <ul className="plan-list">
            {p.download.map((d) => (
              <li key={d.model}>
                <Icon name="pull" size={14} />
                <span>{label(d.model)}</span>
                <span className="muted">{size(d.sizeMB)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span>Nothing: the models are already on this PC.</span>
        )}
      </div>
      {p.download.length > 0 && (
        <div className="plan-row">
          <span className="label">Into</span>
          <span className="plan-dir">
            <span className="mono">{p.dir ?? "Not chosen yet"}</span>
            <Button size="sm" tone="quiet" onClick={onChangeFolder}>
              Change…
            </Button>
          </span>
        </div>
      )}
      <div className="plan-row">
        <span className="label">Index</span>
        <span>
          {p.reindex
            ? `${download ? "Once used, the" : "The"} documents are indexed again with the new model (a job; search keeps working on words meanwhile).`
            : "Already indexed with these models: nothing to rebuild."}
        </span>
      </div>
      <div className="plan-row">
        <span className="label">Expected speed</span>
        <span>{p.expected}</span>
      </div>
    </Modal>
  );
}
