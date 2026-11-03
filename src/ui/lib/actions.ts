import { useCallback, useEffect, useState } from "react";
import type { ClaudeAction, ClaudeScope } from "../../core/types.ts";
import { call, events } from "../api.ts";

export type Action = ClaudeAction & { stale: boolean };
export type ActionFilter = { docId?: string; testId?: string; jobId?: string };

export const ACTIONS_EVENT = "testimus:actions";

export const actionsChanged = () => window.dispatchEvent(new Event(ACTIONS_EVENT));

// ponytail: a job that ends may have proposed, run or outdated an action — every list reads again then
const ENDS = new Set(["done", "failed", "cancelled"]);

export function useActions(filter: ActionFilter | null): Action[] {
  const [list, setList] = useState<Action[]>([]);
  const key = filter ? JSON.stringify(filter) : "";
  const load = useCallback(() => {
    if (!key) {
      setList([]);
      return;
    }
    call<Action[]>("actions.list", JSON.parse(key))
      .then((r) => setList(r ?? []))
      .catch(() => setList([]));
  }, [key]);
  useEffect(() => {
    load();
    window.addEventListener(ACTIONS_EVENT, load);
    const stop = events((e) => {
      if (e.type === "status" && ENDS.has(e.job.status)) load();
    });
    return () => {
      window.removeEventListener(ACTIONS_EVENT, load);
      stop();
    };
  }, [load]);
  return list;
}

// ponytail: a look by Claude is only asked for when Claude is there — without it, no job fails for nothing
export function triageWhenClaude(input: { docId?: string; jobId?: string; model?: string; effort?: string }): void {
  call<{ installed: boolean; signedIn: boolean | null }>("claude.status", {})
    .then((s) => {
      if (s?.installed && s.signedIn !== false) return call("actions.triage", input);
    })
    .catch(() => {});
}

export const forProblem = (list: Action[], text: string) => list.find((a) => a.problem === text);

const RUN_WORD: Record<string, string> = {
  import: "during the import",
  check: "during the check",
  generate: "during the generation",
  job: "after a failed job",
  action: "during another action",
};

function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function originLine(a: Pick<ClaudeAction, "proposedBy">, now = Date.now()): string {
  const p = a.proposedBy;
  return [
    `Proposed by ${p.model ? cap(p.model) : "Claude"}${p.effort ? ` · ${p.effort}` : ""}`,
    RUN_WORD[p.run] ?? "",
    ago(p.at, now),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function scopeWords(s: ClaudeScope): string {
  if (s.kind === "step") return `${s.testId} · step ${s.step}`;
  if (s.kind === "test") return `${s.testId} · whole test`;
  if (s.kind === "doc") return `${s.docId} · whole document`;
  if (s.kind === "tests") return `${s.testIds.length} tests`;
  return "Whole project";
}
