import type { CheckState, DoctorCheck } from "../../../core/types.ts";
import type { HEALTH } from "../../components/ui/Badge.tsx";

/** a check's word in the kit's HEALTH vocabulary */
export type Look = keyof typeof HEALTH;

const INFO_IDS = new Set(["proxy"]);

export const lookOf = (c: DoctorCheck): Look => (c.state === "ok" && INFO_IDS.has(c.id) ? "info" : c.state);

export const isOpen = (s: CheckState) => s === "warn" || s === "fail";

// ponytail: the order and the names of the sections of the system check (presentation of the rows the core gives)
const GROUPS: { title: string; of: (id: string) => boolean }[] = [
  { title: "Claude", of: (id) => id.startsWith("claude") },
  { title: "Jira and Xray", of: (id) => id === "jira" || id === "xray" },
  { title: "Search models", of: (id) => id.startsWith("model") || id === "llamacpp" },
  { title: "This project", of: (id) => id.startsWith("index") || id.startsWith("disk") },
];

const PC = "Testimus on this PC";

export function sections(checks: DoctorCheck[]): { title: string; checks: DoctorCheck[] }[] {
  const titleOf = (id: string) => GROUPS.find((g) => g.of(id))?.title ?? PC;
  return [PC, ...GROUPS.map((g) => g.title)]
    .map((title) => ({ title, checks: checks.filter((c) => titleOf(c.id) === title) }))
    .filter((s) => s.checks.length > 0);
}

export function counts(checks: DoctorCheck[]): { look: Look; n: number }[] {
  return (["fail", "warn", "ok", "skip", "info"] as Look[])
    .map((look) => ({ look, n: checks.filter((c) => lookOf(c) === look).length }))
    .filter((x) => x.n > 0);
}

// ponytail: a run without the sign-in probe says « not checked » for it — the last real sign-in answer is shown instead
export function merged(plain: DoctorCheck[], probed: DoctorCheck[] | undefined): DoctorCheck[] {
  if (!probed) return plain;
  return plain.map((c) =>
    c.state === "skip" && c.id === "claudeLogin" ? (probed.find((p) => p.id === c.id) ?? c) : c,
  );
}
