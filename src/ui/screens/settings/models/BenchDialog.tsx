import { Button, Icon, Modal } from "../../../components/ui/index.ts";
import type { PackRow } from "./data.ts";
import { OpLine } from "./OpLine.tsx";

export type Bench = {
  jobId: string;
  status: "running" | "done" | "failed" | "cancelled";
  message: string;
  pct: number | null;
  error?: string;
};

export function BenchDialog({
  pack,
  bench,
  label,
  onCancel,
  onAgain,
  onClose,
}: {
  pack: PackRow;
  bench: Bench | undefined;
  label: (id: string) => string;
  onCancel: (jobId: string) => void;
  onAgain: () => void;
  onClose: () => void;
}) {
  const running = !bench || bench.status === "running";
  return (
    <Modal
      label={`Measure the ${pack.label} pack`}
      title={`Measure the ${pack.label} pack`}
      subtitle="On Testimus's reference document, on this PC."
      width={560}
      onClose={onClose}
      foot={
        <>
          <span className="muted foot-hint">{running ? "Closing this window does not stop the measure." : ""}</span>
          <span className="spacer" />
          {running ? (
            <Button tone="quiet" disabled={!bench?.jobId} onClick={() => bench && onCancel(bench.jobId)}>
              Cancel the measure
            </Button>
          ) : (
            <Button tone="quiet" onClick={onAgain}>
              Measure again
            </Button>
          )}
          <Button tone="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <p className="bench-intro">
        Testimus ships a reference document: the Syntec collective agreement, 90 articles, with 100 questions whose
        answering article is known. It searches that document with these models and counts how often the right article
        comes first, and how often it is in the top 5. The search times become this PC's speed for the pack.
      </p>
      <p className="muted bench-intro">
        Your project's documents are not used: the same test on every PC makes the packs comparable.
      </p>
      <div className="plan-row">
        <span className="label">Models</span>
        <span>
          {pack.embedding ? label(pack.embedding) : "—"}
          <span className="muted"> + </span>
          {pack.reranker ? label(pack.reranker) : <span className="muted">no reranker</span>}
        </span>
      </div>
      {running && (
        <div className="bench-state">
          <OpLine
            op={{
              key: pack.id,
              jobId: bench?.jobId ?? "",
              label: "Measuring",
              message: bench?.message ?? "Starting",
              pct: bench?.pct ?? null,
            }}
          />
        </div>
      )}
      {bench?.status === "done" && (
        <>
          <p className="sev s-ok bench-state" role="status">
            <Icon name="check" />
            Measured
          </p>
          <div className="plan-row">
            <span className="label">Speed</span>
            <span>{pack.speed ?? "Not measured on this PC yet"}</span>
          </div>
          <div className="plan-row">
            <span className="label">Quality</span>
            <span>{pack.quality}</span>
          </div>
        </>
      )}
      {bench?.status === "cancelled" && (
        <p className="muted bench-state" role="status">
          The measure was cancelled; no result was written.
        </p>
      )}
      {bench?.status === "failed" && (
        <div className="problem bench-state" role="alert">
          <span className="sev s-err">
            <Icon name="error" />
            The measure stopped
          </span>
          <p>{bench.error}</p>
        </div>
      )}
    </Modal>
  );
}
