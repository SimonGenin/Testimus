import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { JobEvent, PushOpResult, PushPlanView, Review } from "../../../core/types.ts";
import { ApiError, run } from "../../lib/data/client.ts";
import { invalidate, useRead } from "../../lib/data/query.ts";
import { message, plural } from "../../lib/format.ts";
import { toast } from "../../lib/toast.ts";
import { PushPlan } from "./push/PushPlan.tsx";
import { PushProgress } from "./push/PushProgress.tsx";

export type PushResult = {
  ok: boolean;
  id: string;
  plan?: PushPlanView;
  ops: PushOpResult[];
  failedAt?: number;
  error?: string;
};

export type Plan = PushPlanView & { planHash?: string };
export type Failure = { message: string; fix?: string };

// ponytail: Jira writes are plans first — the plan is read (xray.plan, never kept), confirming it runs xray.push as a
// job, op by op; a stop shows where and why, and resumes from that operation
export function PushDialog({
  testId,
  testKey,
  summary,
  review,
  onDone,
  onClose,
  onCompare,
}: {
  testId: string;
  testKey?: string;
  summary: string;
  review?: Review;
  onDone: (id: string) => void;
  onClose: () => void;
  onCompare?: () => void;
}) {
  const client = useQueryClient();
  const planQ = useRead("xray.plan", { id: testId });
  const [phase, setPhase] = useState<"plan" | "running" | "failed">("plan");
  const [newer, setNewer] = useState<Plan | null>(null);
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<PushResult | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [from, setFrom] = useState(0);
  const plan = newer ?? (planQ.data as Plan | undefined) ?? null;

  const push = async (start: number) => {
    setPhase("running");
    setFrom(start);
    setDone(start);
    setFailure(null);
    const onEvent = (e: JobEvent) => {
      if (e.type === "progress" && e.done !== undefined) setDone(e.done);
    };
    try {
      const r = await run<PushResult>(
        "xray.push",
        {
          id: testId,
          from: start || undefined,
          planHash: plan?.planHash,
          // ponytail: the plan shows the Jira change and confirming it is the decision, as in Xray Editor — no extra tick
          overwriteRemote: plan?.remoteChanged ? true : undefined,
        },
        onEvent,
      );
      void invalidate(client, [
        ["tests.show", { id: testId }],
        ["tests.show", { id: r.id || testId }],
        ["tests.list"],
        ["xray.status"],
        ["xray.folders"],
      ]);
      setResult(r);
      if (r.plan) setNewer({ ...r.plan, planHash: (r.plan as Plan).planHash ?? plan?.planHash });
      if (!r.ok) {
        setFailure({
          message: r.error ?? r.ops.find((o) => o.status === "failed")?.error ?? "Jira refused an operation.",
        });
        setPhase("failed");
        return;
      }
      const ops = plural(r.ops.filter((o) => o.status === "done").length || (plan?.ops.length ?? 0), "operation");
      // ponytail: Jira took the push but the copy could not be read back — the local file is behind, and the user
      // is told so with the way out (Xray Editor's « Pushed, but the pull afterwards failed »)
      if (r.error)
        toast({
          kind: "error",
          title: `Pushed ${r.id || testKey || "the test"}, but the local copy was not refreshed`,
          detail: `${r.error} — use « Download from Jira » to bring it up to date.`,
        });
      else toast({ kind: "ok", title: `Pushed ${r.id || testKey || "the test"}`, detail: ops });
      onDone(r.id || testId);
    } catch (e) {
      setFailure({ message: message(e), fix: e instanceof ApiError ? e.fix : undefined });
      setPhase("failed");
    }
  };

  if (phase !== "plan")
    return (
      <PushProgress
        name={testKey ?? "this test"}
        reference={testKey ?? testId}
        summary={summary}
        ops={plan?.ops ?? []}
        running={phase === "running"}
        done={done}
        from={from}
        result={result}
        failure={failure}
        onClose={onClose}
        onResume={(at) => void push(at)}
      />
    );

  const loadError = planQ.error && !plan ? { message: message(planQ.error), fix: planQ.error.fix } : null;
  return (
    <PushPlan
      testId={testId}
      testKey={testKey}
      summary={summary}
      review={review ?? plan?.review ?? "validated"}
      plan={plan}
      error={loadError}
      onCompare={onCompare}
      onClose={onClose}
      onConfirm={() => void push(0)}
    />
  );
}
