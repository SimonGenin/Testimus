import { useState } from "react";
import { JobHistory } from "../../../components/jobs/JobHistory.tsx";
import { Card } from "../../../components/ui/Card.tsx";

// ponytail: under the steps, folded — what was done to this test (written, checked, analyzed, fixed, pulled, pushed),
// read only once opened
export function HistoryCard({ testId }: { testId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="History of the test" data-testid="history-card">
      <Card title="History" fold={{ open, onOpenChange: setOpen }} padded={false}>
        {open && <JobHistory about={`tests/${testId}`} label="What was done to this test" />}
      </Card>
    </section>
  );
}
