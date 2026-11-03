import { Button } from "../../../components/ui/index.ts";
import type { CatalogRow, Installed, Op } from "./data.ts";
import { isInstalled, size } from "./data.ts";
import { FitChip } from "./FitChip.tsx";
import { OpLine } from "./OpLine.tsx";
import { StateChip } from "./StateChip.tsx";

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
  onCancel,
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
  onCancel: (jobId: string) => void;
}) {
  return (
    <div className="mtable-wrap">
      <table className="tbl mtable" aria-label="Model catalog">
        <thead>
          <tr>
            <th>Model</th>
            <th>State</th>
            <th>Size</th>
            <th>Fit</th>
            <th>
              <span className="sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const inst = installed.find((i) => i.model === r.id);
            const op = ops.find((o) => o.key === r.id);
            const here = isInstalled(r.state) || !!inst;
            const used = inUse.includes(r.id);
            return (
              <tr key={r.id} aria-label={r.label}>
                <td>
                  <div className="mname">
                    <span className="mname-label">{r.label}</span>
                    <span className="muted mono mname-id">
                      {r.kind === "embedding" ? "Embedding" : "Reranker"} · {r.tier} · {r.runtimes.join(", ")}
                    </span>
                    {inst && (
                      <span className="muted mono mname-where" title={inst.where}>
                        {inst.where}
                      </span>
                    )}
                    {inst?.perf && <span className="muted mperf">{inst.perf}</span>}
                  </div>
                </td>
                <td>
                  <StateChip state={used ? "active" : r.state} />
                </td>
                <td className="num-cell">{size(inst?.sizeMB ?? r.sizeMB)}</td>
                <td>
                  <FitChip fit={r.fit} />
                </td>
                <td>
                  {op ? (
                    <OpLine op={op} onCancel={onCancel} />
                  ) : (
                    <div className="mactions">
                      {!here ? (
                        <Button
                          size="sm"
                          icon="pull"
                          disabled={busy || r.state === "downloading"}
                          aria-label={`Install ${r.label}`}
                          onClick={() => onInstall(r)}
                        >
                          Install
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy || used}
                          aria-label={`Use ${r.label} for this project`}
                          onClick={() => onUse(r)}
                        >
                          {used ? "In use" : "Use"}
                        </Button>
                      )}
                      {here && (
                        <Button
                          size="sm"
                          icon="check"
                          disabled={busy}
                          title="Load the model and embed one sentence to check it works"
                          aria-label={`Verify ${r.label}`}
                          onClick={() => onVerify(r)}
                        >
                          Verify
                        </Button>
                      )}
                      {inst && (
                        <Button
                          size="sm"
                          icon="trash"
                          className="btn-remove"
                          disabled={busy || used}
                          title={used ? "In use for this project: choose another model first" : undefined}
                          aria-label={`Remove ${r.label}`}
                          onClick={() => onRemove(r, inst)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
