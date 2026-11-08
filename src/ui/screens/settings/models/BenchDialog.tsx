import * as stylex from "@stylexjs/stylex";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Facts } from "../../../components/ui/Facts.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { useCancel } from "../jobs.ts";
import { Hint, Stack } from "../Section.tsx";
import type { PackRow } from "./data.ts";
import { ModelPair } from "./ModelPair.tsx";
import { OpLine } from "./OpLine.tsx";

const styles = stylex.create({ plain: { margin: 0 } });

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
      footNote={running ? "Closing this window does not stop the measure: it goes on in Jobs." : undefined}
      onClose={onClose}
      actions={
        <>
          {running ? (
            <Button
              variant="quiet"
              icon="stop"
              label="Cancel"
              disabled={!bench?.jobId}
              onClick={() => bench && cancel(bench.jobId)}
            />
          ) : (
            <Button variant="quiet" label="Measure again" onClick={onAgain} />
          )}
          <Button variant="primary" label="Close" onClick={onClose} />
        </>
      }
    >
      <Stack>
        <p {...stylex.props(styles.plain)}>
          Testimus ships a reference document: the Syntec collective agreement, 90 articles, with 100 questions whose
          answering article is known. It searches that document with these models and counts how often the right article
          comes first, and how often it is in the top 5. The search times become this PC's speed for the pack.
        </p>
        <Hint>Your project's documents are not used: the same test on every PC makes the packs comparable.</Hint>
        <Facts
          divided
          items={[
            !!pack.embedding && {
              label: "Models",
              value: <ModelPair embedding={pack.embedding} reranker={pack.reranker} label={label} />,
            },
            running && {
              label: "Progress",
              value: (
                <OpLine
                  op={{ key: pack.id, jobId: bench?.jobId ?? "", label: "Measuring", kind: "models-measure" }}
                  cancellable={false}
                />
              ),
            },
          ]}
        />
        {bench?.status === "done" && (
          <Banner tone="success" title="Measured">
            <span>
              Speed: {pack.speed ?? "Not measured on this PC yet"} · Quality: {pack.quality}
            </span>
          </Banner>
        )}
        {bench?.status === "cancelled" && (
          <Banner tone="neutral">The measure was cancelled; no result was written.</Banner>
        )}
        {bench?.status === "failed" && (
          <Banner tone="danger" title="The measure stopped">
            {bench.error}
          </Banner>
        )}
      </Stack>
    </Modal>
  );
}
