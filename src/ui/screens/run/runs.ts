import type { CommandOutput } from "../../../core/commands/index.ts";
import { initials, plural } from "../../lib/format.ts";

export type RunView = CommandOutput<"runs.show">;
export type RunTestView = RunView["tests"][number];
export type RunResult = RunTestView["result"];
export type RunStatus = RunResult["status"];
export type RunSummary = CommandOutput<"runs.list">["runs"][number];

export const STATUS_ORDER: RunStatus[] = ["passed", "problem", "blocked", "not-run"];

// ponytail: the route of the Run screen — `#/run` (the list), `#/run/<run>` (a run and its tests), `#/run/<run>/<test>`
// (running one test)
export function routeOf(arg: string | undefined): { run: string; test: string } {
  const [run = "", ...rest] = (arg ?? "").split("/");
  return { run, test: rest.join("/") };
}

export function stepsLine(r: RunResult): string {
  const ok = r.steps.filter((s) => s.ok === true).length;
  const nok = r.steps.filter((s) => s.ok === false).length;
  if (!nok) return `${ok} / ${r.steps.length}${ok && ok === r.steps.length ? " OK" : ""}`;
  return `${ok} OK · ${nok} NOK`;
}

export function notesLine(r: RunResult): string {
  if (r.status === "blocked" && r.blockedReason) return `« ${r.blockedReason} »`;
  const comments = r.comments.filter((c) => c.kind === "comment").length;
  const questions = r.comments.filter((c) => c.kind === "question").length;
  const parts = [comments && plural(comments, "comment"), questions && plural(questions, "question")].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

export function clock(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function day(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export const byLine = (r: RunResult) => (r.updatedBy ? `${initials(r.updatedBy)} · ${clock(r.updatedAt)}` : "—");

export function listMeta(r: RunSummary): string {
  const run = r.total - r.counts.notRun;
  const problems = r.counts.problem ? ` · ${plural(r.counts.problem, "problem")}` : "";
  if (r.finished) return `${r.counts.passed} passed${problems} · ${day(r.updatedAt ?? r.createdAt)}`;
  return `${run} of ${r.total} run${problems} · ${r.createdBy}`;
}

// ponytail: the next test to play — the first not run after the one given, else from the start
export function nextNotRun(tests: RunTestView[], after?: string): RunTestView | undefined {
  const at = after ? tests.findIndex((t) => t.id === after) : -1;
  return [...tests.slice(at + 1), ...tests.slice(0, at + 1)].find((t) => t.result.status === "not-run");
}
