import { useState } from "react";
import type { Screen } from "../../lib/app.ts";
import { kindLabel, subjectLabel } from "../../lib/jobs.ts";
import { useNow } from "../../lib/now.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Loading } from "../ui/Loading.tsx";
import { Modal } from "../ui/Modal.tsx";
import { JobView } from "./JobView.tsx";
import { kindIcon } from "./kinds.ts";
import { useJobDetail } from "./useJobDetail.ts";

// ponytail: one job beside the screen, wherever it was opened from (a toast, the activity of the top bar, a test's or
// a document's history, a screen that started it) — a job it links to (its origin, a step's own job, the diagnosis)
// opens in its place; going to what it made closes it
export function JobDrawer({
  id: first,
  onClose,
  onGo,
}: {
  id: string;
  onClose: () => void;
  onGo: (screen: Screen, id?: string) => void;
}) {
  const [id, setId] = useState(first);
  const d = useJobDetail(id, setId);
  const now = useNow(1000, d.job?.status === "running");
  const go = (screen: Screen, to?: string) => {
    onClose();
    onGo(screen, to);
  };
  return (
    <Modal
      title={d.job ? kindLabel(d.job.kind) : "Job"}
      subtitle={d.job ? subjectLabel(d.job, d.byId) || undefined : undefined}
      icon={d.job ? kindIcon(d.job.kind) : "jobs"}
      drawer="right"
      onClose={onClose}
    >
      {d.job ? (
        <JobView
          job={d.job}
          events={d.events}
          byId={d.byId}
          diagnosis={d.diagnosis}
          now={now}
          onCancel={d.cancel}
          onAgain={d.again}
          onOpen={setId}
          onGo={go}
        />
      ) : d.failed ? (
        <EmptyState icon="info" title="This job is gone" text="Its log was deleted: a finished job is kept 30 days." />
      ) : (
        <Loading read="jobs.show" />
      )}
    </Modal>
  );
}
