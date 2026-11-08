import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../../core/commands/index.ts";
import type { Job } from "../../../../core/types.ts";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { execute } from "../../../lib/data/query.ts";
import { errorToast } from "../../../lib/toast.ts";
import { useJob, useRunning } from "../jobs.ts";
import { OpLine } from "../models/OpLine.tsx";
import { Stack } from "../Section.tsx";
import type { Retrieval } from "./draft.ts";

type Result = CommandOutput<"rag.measure">;
type Ended = { status: Job["status"]; result?: Result; error?: string };

const n3 = (x: number) => x.toFixed(3);
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${n3(Math.abs(x))}`;

function Verdict({ ended }: { ended: Ended }) {
  if (ended.status === "cancelled") return <Banner tone="neutral">The measure was cancelled.</Banner>;
  if (ended.status !== "done" || !ended.result)
    return (
      <Banner tone="danger" title="The measure stopped">
        {ended.error ?? "The job failed."}
      </Banner>
    );
  const m = ended.result;
  return (
    <Banner
      tone={m.adopt ? "success" : "neutral"}
      title={m.adopt ? "Better on the benchmark" : "Not better than the saved settings"}
    >
      Evidence found in the top {m.k}: {n3(m.baseline.recall)} saved → {n3(m.candidate.recall)} with these settings (
      {signed(m.diff)}, 95 % interval {signed(m.low)} to {signed(m.high)}, {m.n} behaviors). {m.why}
    </Banner>
  );
}

// ponytail: rag.measure — the saved settings and these, each through rag.eval on the project's benchmark, then
// rag.compare; a measure found running (another tab, a reload) is followed too
export function Measure({ draft }: { draft: Retrieval }) {
  const client = useQueryClient();
  const running = useRunning("rag-measure");
  const [mine, setMine] = useState<string | null>(null);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [starting, setStarting] = useState(false);
  const jobId = mine ?? running?.id ?? null;
  useJob(jobId, (job) => {
    setEnded({ status: job.status, result: job.result as Result | undefined, error: job.error });
    setMine(null);
  });
  const start = async () => {
    setStarting(true);
    setEnded(null);
    try {
      const { jobId: id } = await execute(
        client,
        "rag.measure",
        { retrieval: draft },
        { invalidates: [["jobs.list"]] },
      );
      setMine(id);
    } catch (e) {
      errorToast(e, "Could not start the measure");
    } finally {
      setStarting(false);
    }
  };
  const busy = starting || !!jobId;
  return (
    <Stack>
      {jobId ? (
        <OpLine op={{ key: "measure", jobId, label: "Measuring on the benchmark", kind: "rag-measure" }} />
      ) : (
        ended && <Verdict ended={ended} />
      )}
      <div>
        <Button
          size="sm"
          label="Measure on the benchmark"
          loading={starting}
          disabled={busy}
          onClick={() => void start()}
        />
      </div>
    </Stack>
  );
}
