import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Job } from "../../../../core/types.ts";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { EmptyState } from "../../../components/ui/EmptyState.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { Spinner } from "../../../components/ui/Spinner.tsx";
import { type } from "../../../components/ui/type.ts";
import { fileUrl } from "../../../lib/data/client.ts";
import { execute, useRead } from "../../../lib/data/query.ts";
import { message } from "../../../lib/format.ts";
import { color, radius, space } from "../../../styles/tokens.stylex.ts";

import type { Found, FoundPicture } from "./FindPicture.tsx";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  wait: { display: "flex", alignItems: "center", gap: space.s3, color: color.textMuted },
  pick: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  img: {
    display: "block",
    maxWidth: "100%",
    maxHeight: "40vh",
    objectFit: "contain",
    alignSelf: "flex-start",
    borderRadius: radius.r1,
  },
  why: { margin: 0, overflowWrap: "anywhere" },
  from: { margin: 0, color: color.textSubtle, overflowWrap: "anywhere" },
  foot: { display: "flex", justifyContent: "flex-end" },
});

const jobOf = (r: unknown) =>
  r && typeof r === "object" && typeof (r as { jobId?: unknown }).jobId === "string"
    ? (r as { jobId: string }).jobId
    : null;

// ponytail: the search of Find a picture, asked when its dialog opens: waiting, why it failed, none found, or the
// pictures with what each shows and their Add
export function PictureSearch({
  testId,
  step,
  onAdd,
  onClose,
}: {
  testId: string;
  step: number;
  onAdd?: (p: FoundPicture) => Promise<void>;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const asked = useRef(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const shown = useRead("jobs.show", { id: jobId ?? "" }, { enabled: !!jobId }).data as { job?: Job } | undefined;
  const job = jobId ? shown?.job : undefined;
  const out = job?.status === "done" ? (job.result as Found | undefined) : undefined;
  const failed =
    error ??
    (job?.status === "failed"
      ? job.error || "The search did not finish."
      : job?.status === "cancelled"
        ? "The search was cancelled."
        : out && !out.ok
          ? out.summary || "The search did not finish."
          : null);
  const running = !failed && !out;

  // biome-ignore lint/correctness/useExhaustiveDependencies: once — the dialog is the search
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void start();
  }, []);

  const start = async () => {
    try {
      const r = await execute(client, "tests.findImage", { id: testId, step }, { invalidates: "none" });
      const id = jobOf(r);
      if (id) setJobId(id);
      else setError("The search did not start.");
    } catch (e) {
      setError(message(e));
    }
  };

  const add = async (p: FoundPicture) => {
    setAdding(p.figure);
    try {
      if (onAdd) await onAdd(p);
      else await execute(client, "tests.addImage", { id: testId, step, figure: p.figure, field: p.field });
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setAdding(null);
    }
  };

  return (
    <Modal
      title={`A picture for step ${step}`}
      subtitle="Claude looks in the documents' figures, then the photos, then the videos."
      icon="image"
      onClose={onClose}
      busy={!!adding}
    >
      <div {...stylex.props(styles.body)}>
        {failed && (
          <Banner tone="warning" title="No picture was looked for." compact>
            {failed}
          </Banner>
        )}
        {running && (
          <p {...stylex.props(type.compact, styles.wait)}>
            <Spinner size="sm" label="Looking" />
            Claude is looking for this step's screen…
          </p>
        )}
        {out?.ok && !out.pictures.length && (
          <EmptyState
            icon="image"
            title="No picture shows this step"
            text="Nothing in the documents, the photos or the videos shows this screen as the step needs it. The step can go without one."
            compact
          />
        )}
        {out?.ok &&
          out.pictures.map((p) => (
            <Card key={p.figure} density="compact">
              <div {...stylex.props(styles.pick)}>
                <img src={fileUrl(p.file)} alt={p.why} {...stylex.props(styles.img)} />
                <p {...stylex.props(type.compact, styles.why)}>{p.why}</p>
                <p {...stylex.props(type.small, styles.from)}>
                  {p.figure} · in {p.field}
                </p>
                <div {...stylex.props(styles.foot)}>
                  <Button
                    size="sm"
                    variant="primary"
                    icon="plus"
                    label={`Add to step ${step}`}
                    loading={adding === p.figure}
                    disabled={!!adding && adding !== p.figure}
                    onClick={() => void add(p)}
                  />
                </div>
              </div>
            </Card>
          ))}
      </div>
    </Modal>
  );
}
