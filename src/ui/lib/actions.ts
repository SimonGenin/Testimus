import type { ClaudeAction, ClaudeScope } from "../../core/types.ts";

export type Action = ClaudeAction & { stale: boolean };

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
