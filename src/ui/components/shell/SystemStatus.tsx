import { useEffect } from "react";
import type { CheckState } from "../../../core/types.ts";
import { runDoctor, useDoctor, worst } from "../../lib/doctor.ts";
import { cx } from "../../lib/format.ts";

const LOOK: Record<CheckState | "unknown", { label: string; cls: string }> = {
  ok: { label: "All good", cls: "st-ok" },
  warn: { label: "Check", cls: "st-warn" },
  fail: { label: "Needs you", cls: "st-err" },
  skip: { label: "Not checked", cls: "st-unknown" },
  unknown: { label: "Checking", cls: "st-unknown" },
};

export function SystemStatus({ current, onOpen }: { current?: boolean; onOpen: () => void }) {
  const doctor = useDoctor();
  useEffect(() => {
    void runDoctor();
  }, []);
  const state: CheckState | "unknown" = doctor.at ? worst(doctor.checks) : "unknown";
  const l = LOOK[state];
  return (
    <button
      type="button"
      className={cx("rail-item rail-status", l.cls)}
      aria-current={current ? "page" : undefined}
      aria-label={`System: ${l.label}. Open the system check`}
      onClick={onOpen}
    >
      <span className="rail-status-word">
        <span className="dot" />
        {l.label}
      </span>
      <span className="muted rail-status-sub">System</span>
    </button>
  );
}
