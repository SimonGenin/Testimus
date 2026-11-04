import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "../../core/types.ts";
import { PROJECT_RUN } from "../components/claude/turns.ts";
import { project } from "../lib/data/client.ts";
import { onAnyEvent } from "../lib/data/events.ts";

// the jobs in which Claude edits tests: a run (claude.run, actions.run) and a fix (review.fix)
const EDITS = new Set(["claude", "fix"]);

// ponytail: the test a running job edits, from the input it was started with — a run on the project, an action, or a
// job whose input was too large to keep, locks every test
function testOf(j: Job): string {
  const input = (j.rerun?.input ?? {}) as { id?: unknown; scope?: { kind?: string; testId?: unknown } };
  if (j.rerun?.name === "review.fix" && typeof input.id === "string") return input.id;
  if (j.rerun?.name === "claude.run" && (input.scope?.kind === "test" || input.scope?.kind === "step"))
    return typeof input.scope.testId === "string" ? input.scope.testId : PROJECT_RUN;
  return PROJECT_RUN;
}

type Asked = { testId: string; jobId?: string; project: string | null };

// ponytail: « Claude is working » is a fact of the server — a running Claude job of the open project, whoever started
// it (the dock, the CLI, MCP, another window). The dock only says what it asked for until its job is known, and the
// test it is on; the job's end unlocks even when the dock is gone (PARITY #15)
export function useClaudeLock(running: Job[]): {
  claudeRunning: string | null;
  setClaudeRunning: (testId: string | null, jobId?: string) => void;
} {
  const [asked, setAsked] = useState<Asked | null>(null);
  const tests = useRef(new Map<string, string>());
  const ended = useRef(new Set<string>());
  const [, setSeen] = useState(0);

  useEffect(
    () =>
      onAnyEvent((e) => {
        if (e.type !== "status" || e.job.status === "running") return;
        ended.current.add(e.jobId);
        setSeen((n) => n + 1);
      }),
    [],
  );

  const setClaudeRunning = useCallback((testId: string | null, jobId?: string) => {
    if (testId && jobId) tests.current.set(jobId, testId);
    setAsked(testId ? { testId, jobId, project: project() } : null);
  }, []);

  const editing = running.find((j) => EDITS.has(j.kind) && !ended.current.has(j.id));
  const handedOver = !!asked?.jobId && running.some((j) => j.id === asked.jobId);
  useEffect(() => {
    if (handedOver) setAsked(null);
  }, [handedOver]);

  const waiting =
    asked && asked.project === project() && !(asked.jobId && ended.current.has(asked.jobId)) ? asked.testId : null;
  const fromJobs = editing ? (tests.current.get(editing.id) ?? testOf(editing)) : null;
  return { claudeRunning: fromJobs ?? waiting, setClaudeRunning };
}
