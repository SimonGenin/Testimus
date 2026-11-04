import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { useCancel } from "../jobs.ts";
import { Hint, Stack } from "../Section.tsx";
import type { PackRow } from "./data.ts";
import { OpLine } from "./OpLine.tsx";
import { Models } from "./PackCard.tsx";

export type Bench = { jobId: string; status: "running" | "done" | "failed" | "cancelled"; error?: string };

// ponytail: the same reference document on every PC makes the packs comparable; closing the dialog leaves the
// measure running (its card says so)
export function BenchDialog({
  pack,
  bench,
  label,
  onAgain,
  onClose,
}: {
  pack: PackRow;
  bench: Bench | undefined;
  label: (id: string) => string;
  onAgain: () => void;
  onClose: () => void;
}) {
  const cancel = useCancel();
  const running = !bench || bench.status === "running";
  return (
    <Modal
      title={`Measure the ${pack.label} pack`}
      subtitle="On Testimus's reference document, on this PC."
      footNote={running ? "Closing this window does not stop the measure." : undefined}
      onClose={onClose}
      actions={
        <>
          {running ? (
            <Button
              variant="quiet"
              label="Cancel the measure"
              disabled={!bench?.jobId}
              onClick={() => bench && cancel(bench.jobId)}
            />
          ) : (
            <Button variant="quiet" label="Measure again" onClick={onAgain} />
          )}
        </>
      }
    >
      <Stack>
        <p>
          Testimus ships a reference document: the Syntec collective agreement, 90 articles, with 100 questions whose
          answering article is known. It searches that document with these models and counts how often the right article
          comes first, and how often it is in the top 5. The search times become this PC's speed for the pack.
        </p>
        <Hint>Your project's documents are not used: the same test on every PC makes the packs comparable.</Hint>
        {pack.embedding && <Models embedding={pack.embedding} reranker={pack.reranker} label={label} />}
        {running && (
          <OpLine
            op={{ key: pack.id, jobId: bench?.jobId ?? "", label: "Measuring", kind: "models-measure" }}
            cancellable={false}
          />
        )}
        {bench?.status === "done" && (
          <Banner tone="success" title="Measured">
            <span role="status">
              Speed: {pack.speed ?? "Not measured on this PC yet"} · Quality: {pack.quality}
            </span>
          </Banner>
        )}
        {bench?.status === "cancelled" && (
          <Banner tone="neutral">
            <span role="status">The measure was cancelled; no result was written.</span>
          </Banner>
        )}
        {bench?.status === "failed" && (
          <Banner tone="danger" title="The measure stopped">
            <span role="alert">{bench.error}</span>
          </Banner>
        )}
      </Stack>
    </Modal>
  );
}
