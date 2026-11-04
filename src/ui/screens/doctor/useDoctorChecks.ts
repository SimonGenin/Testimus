import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { CommandName } from "../../../core/commands/index.ts";
import type { DoctorAction, DoctorCheck } from "../../../core/types.ts";
import { execute, useRead } from "../../lib/data/query.ts";
import { shownChecks } from "../../lib/doctor.ts";
import { errorToast, toast } from "../../lib/toast.ts";

type Running = { check: DoctorCheck; action: DoctorAction; jobId: string | null };

const jobOf = (r: unknown) =>
  r && typeof r === "object" && typeof (r as { jobId?: unknown }).jobId === "string"
    ? (r as { jobId: string }).jobId
    : null;

// ponytail: the system check — its rows (system.doctor, the sign-in probe only when asked), and a row's fix run as its
// command; a fix that is a job is followed through jobs.show (kept fresh by the event bridge) before the check runs again
export function useDoctorChecks() {
  const client = useQueryClient();
  const plain = useRead("system.doctor", {});
  const [probe, setProbe] = useState(false);
  const signIn = useRead("system.doctor", { claude: true }, { enabled: probe });
  const [running, setRunning] = useState<Running | null>(null);
  const followed = useRead("jobs.show", { id: running?.jobId ?? "" }, { enabled: !!running?.jobId }).data;
  const status = running?.jobId ? followed?.job?.status : undefined;

  const ended = (r: Running, error?: string) => {
    setRunning(null);
    if (error) errorToast(new Error(error), `${r.action.label} failed`);
    else toast({ tone: "success", title: `${r.check.label}: done`, detail: r.action.label });
    void plain.refetch();
  };

  useEffect(() => {
    if (!running?.jobId || !status || status === "running") return;
    ended(running, status === "done" ? undefined : followed?.job?.error || "The job did not finish.");
  });

  const run = async (check: DoctorCheck, action: DoctorAction, input: Record<string, unknown>) => {
    if (running) return;
    const r: Running = { check, action, jobId: null };
    setRunning(r);
    try {
      const out = await execute(client, action.command as CommandName, input as never, { invalidates: "none" });
      const jobId = jobOf(out);
      if (jobId) setRunning({ ...r, jobId });
      else ended(r);
    } catch (e) {
      ended(r, e instanceof Error ? e.message : String(e));
    }
  };

  const checkSignIn = () => {
    if (probe) void signIn.refetch();
    else setProbe(true);
  };

  return {
    checks: plain.data
      ? shownChecks(plain.data.checks, plain.dataUpdatedAt, signIn.data?.checks, signIn.dataUpdatedAt)
      : null,
    at: Math.max(plain.dataUpdatedAt, signIn.dataUpdatedAt),
    checking: plain.isFetching,
    error: plain.error?.message,
    again: () => void plain.refetch(),
    signingIn: signIn.isFetching,
    checkSignIn,
    busyId: running?.check.id ?? null,
    fixing: running,
    run,
  };
}
