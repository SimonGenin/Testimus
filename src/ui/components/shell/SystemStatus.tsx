import { useQuery } from "@tanstack/react-query";
import type { CheckState, DoctorCheck } from "../../../core/types.ts";
import { key, useRead } from "../../lib/data/query.ts";
import { shownChecks, worst } from "../../lib/doctor.ts";
import type { BadgeTone } from "../ui/Badge.tsx";
import { RailItem } from "../ui/RailItem.tsx";

const LOOK: Record<CheckState | "unknown", { label: string; tone: BadgeTone }> = {
  ok: { label: "All good", tone: "success" },
  warn: { label: "To do", tone: "warning" },
  fail: { label: "Failed", tone: "danger" },
  skip: { label: "Not checked", tone: "neutral" },
  unknown: { label: "Not checked", tone: "neutral" },
};

const checksOf = (v: unknown): DoctorCheck[] =>
  Array.isArray(v) ? v : ((v as { checks?: DoctorCheck[] } | undefined)?.checks ?? []);

// ponytail: the system's state at the foot of the rail — the worst row of the last check (the same read as the System
// check screen; a Claude sign-in probe made there replaces its « not checked » row), a click opens the check
export function SystemStatus({ current, onOpen }: { current?: boolean; onOpen: () => void }) {
  const plain = useRead("system.doctor", {});
  const probe = useQuery<unknown>({ queryKey: key("system.doctor", { claude: true }), enabled: false });
  const checks = shownChecks(
    checksOf(plain.data),
    plain.dataUpdatedAt,
    probe.data ? checksOf(probe.data) : undefined,
    probe.dataUpdatedAt,
  );
  const state: CheckState | "unknown" = plain.data ? worst(checks) : "unknown";
  const l = LOOK[state];
  return (
    <RailItem
      label={l.label}
      dot={l.tone}
      current={current}
      ariaLabel={`System: ${l.label}. Open the system check`}
      onClick={onOpen}
    />
  );
}
