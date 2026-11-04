import type { CheckState, DoctorCheck } from "../../core/types.ts";

export const worst = (checks: DoctorCheck[]): CheckState =>
  checks.some((c) => c.state === "fail")
    ? "fail"
    : checks.some((c) => c.state === "warn")
      ? "warn"
      : checks.length && checks.every((c) => c.state === "skip")
        ? "skip"
        : "ok";

// ponytail: the rows the system check and the rail's dot both show — a sign-in probe newer than the plain run is the
// whole answer; otherwise the plain run, its « not checked » sign-in row replaced by the last probe's answer
export function shownChecks(
  plain: DoctorCheck[],
  plainAt: number,
  probed: DoctorCheck[] | undefined,
  probedAt = 0,
): DoctorCheck[] {
  if (!probed) return plain;
  if (probedAt > plainAt) return probed;
  return plain.map((c) =>
    c.state === "skip" && c.id === "claudeLogin" ? (probed.find((p) => p.id === c.id) ?? c) : c,
  );
}
