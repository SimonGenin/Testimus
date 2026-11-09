import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { CommandOutput } from "../../../../core/commands/index.ts";
import type { Effort, Job } from "../../../../core/types.ts";
import { useRunningJobs } from "../../../components/shell/Activity.tsx";
import { execute, useRead } from "../../../lib/data/query.ts";
import { message } from "../../../lib/format.ts";
import { errorToast } from "../../../lib/toast.ts";

export type Analysis = NonNullable<CommandOutput<"analysis.show">["analysis"]>;
export type ProposalView = Analysis["proposals"][number];
export type Decision = "accept" | "reject" | "reopen";
type RunOut = CommandOutput<"analysis.run">;

const jobOf = (r: unknown) =>
  r && typeof r === "object" && typeof (r as { jobId?: unknown }).jobId === "string"
    ? (r as { jobId: string }).jobId
    : null;

// ponytail: a test's analysis — the file read through analysis.show (the watcher reads it again when it moves), the
// run that may be going on for it whoever started it (a running analyze job whose subject is the test), and why the
// last run this page followed did not finish
export function useAnalysis(
  testId: string,
  doc: { save: () => Promise<unknown>; expect: () => void; reload: () => Promise<void> },
) {
  const client = useQueryClient();
  const shown = useRead("analysis.show", { id: testId });
  const running = useRunningJobs().find((j) => j.kind === "analyze" && j.subject === testId);
  const [followed, setFollowed] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string[]>([]);
  const ended = useRead("jobs.show", { id: followed ?? "" }, { enabled: !!followed && !running }).data as
    | { job?: Job }
    | undefined;

  useEffect(() => {
    if (running) setFollowed(running.id);
  }, [running]);
  useEffect(() => {
    const job = ended?.job;
    if (!followed || !job || job.status === "running") return;
    setFollowed(null);
    const out = job.result as RunOut | undefined;
    if (job.status === "failed") setFailed(job.error || "The analysis did not finish.");
    else if (job.status === "cancelled") setFailed("The analysis was cancelled.");
    else if (out && !out.ok) setFailed(out.summary || "The analysis did not finish.");
    else setFailed(null);
  }, [ended, followed]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: another test in the same editor starts with no failure
  useEffect(() => {
    setFailed(null);
    setFollowed(null);
  }, [testId]);

  const start = async (input: { note?: string; model?: string; effort?: Effort }) => {
    setFailed(null);
    try {
      await doc.save();
      const out = await execute(client, "analysis.run", { id: testId, ...input }, { invalidates: "none" });
      const id = jobOf(out);
      if (id) setFollowed(id);
    } catch (e) {
      setFailed(message(e));
    }
  };

  const decide = async (ids: string[], decision: Decision) => {
    setDeciding(ids);
    try {
      if (decision === "accept") {
        await doc.save();
        doc.expect();
      }
      await execute(client, "analysis.decide", { id: testId, proposals: ids, decision });
      if (decision === "accept") await doc.reload();
    } catch (e) {
      errorToast(e, decision === "accept" ? "Could not apply the proposal" : "Could not record the decision");
    } finally {
      setDeciding([]);
    }
  };

  return {
    analysis: shown.data?.analysis ?? null,
    loading: shown.isPending,
    running: running ?? null,
    failed,
    deciding,
    start,
    decide,
  };
}
