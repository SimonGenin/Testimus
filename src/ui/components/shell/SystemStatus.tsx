import { useEffect } from "react";
import type { CheckState } from "../../../core/types.ts";
import { runDoctor, useDoctor, worst } from "../../lib/doctor.ts";
import type { BadgeTone } from "../ui/Badge.tsx";
import { RailItem } from "../ui/RailItem.tsx";

const LOOK: Record<CheckState | "unknown", { label: string; tone: BadgeTone }> = {
  ok: { label: "All good", tone: "success" },
  warn: { label: "Check", tone: "warning" },
  fail: { label: "Needs you", tone: "danger" },
  skip: { label: "Not checked", tone: "neutral" },
  unknown: { label: "Checking", tone: "neutral" },
};

// ponytail: the system's state at the foot of the rail — the worst row of the last check, a click opens the check
export function SystemStatus({ current, onOpen }: { current?: boolean; onOpen: () => void }) {
  const doctor = useDoctor();
  useEffect(() => {
    void runDoctor();
  }, []);
  const state: CheckState | "unknown" = doctor.at ? worst(doctor.checks) : "unknown";
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
