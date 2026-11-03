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

export const NO_SET = /No behavior set/i;

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
  const noSet = bench?.status === "failed" && NO_SET.test(bench.error ?? "");
  return (
    <Modal
      label={`Measure the ${pack.label} pack`}
      title={`Measure the ${pack.label} pack`}
      subtitle="On this project, on this PC."
      width={560}
      onClose={onClose}
      foot={
        <>
          <span className="muted foot-hint">
            {running
              ? "Closing this window does not stop the measure."
              : bench.status === "done"
                ? "The report is kept in .testimus/eval/."
                : ""}
          </span>
          <span className="spacer" />
          {running ? (
            <Button tone="quiet" disabled={!bench?.jobId} onClick={() => bench && onCancel(bench.jobId)}>
              Cancel the measure
            </Button>
          ) : (
            !noSet && (
              <Button tone="quiet" onClick={onAgain}>
                Measure again
              </Button>
            )
          )}
          <Button tone="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <p className="bench-intro">
        Testimus searches the project's documents with these models for every behavior of the project's behavior set and
        counts how much of the evidence each search finds. The search times become this PC's speed for the pack.
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
      {noSet && (
        <div className="problem bench-state" role="alert">
          <span className="sev s-warn">
            <Icon name="warning" />
            This project has no behavior set yet
          </span>
          <p>
            Quality is measured against <span className="mono">eval/behaviors.jsonl</span> in the project folder: one
            line per behavior a tester checks, with the document passages a test of it needs (its evidence). Add that
            file, then measure again.
          </p>
          <p className="muted">
            Claude Code can draft it from the documents with Testimus's rag-eval skill; a tester then confirms each
            line. Until then every result is marked provisional.
          </p>
        </div>
      )}
      {bench?.status === "failed" && !noSet && (
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
