import type { CheckState, DoctorCheck } from "../../core/types.ts";

export const worst = (checks: DoctorCheck[]): CheckState =>
  checks.some((c) => c.state === "fail")
    ? "fail"
    : checks.some((c) => c.state === "warn")
      ? "warn"
      : checks.length && checks.every((c) => c.state === "skip")
        ? "skip"
        : "ok";
