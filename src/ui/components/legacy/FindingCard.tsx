import type { ReactNode } from "react";
import type { Finding } from "../../../core/types.ts";
import { cx } from "../../lib/format.ts";
import { Severity } from "./Severity.tsx";

const WORD: Record<Finding["severity"], string> = { error: "Error", warning: "Warning", info: "Info" };

export const kindLabel = (k: string) => {
  const s = k.replace(/-/g, " ");
  return s[0].toUpperCase() + s.slice(1);
};

export function FindingCard({
  finding,
  stale,
  scope,
  children,
}: {
  finding: Finding;
  stale?: boolean;
  scope?: ReactNode;
  children?: ReactNode;
}) {
  const head = `${WORD[finding.severity]} · ${kindLabel(finding.kind)}`;
  return (
    <div
      className={cx(
        "find",
        !stale && `f-${finding.severity === "warning" ? "warn" : finding.severity === "error" ? "err" : "info"}`,
        stale && "f-stale",
      )}
      role="note"
    >
      <div className="find-head">
        <Severity tone={stale ? "stale" : finding.severity}>{stale ? `Out of date · ${head}` : head}</Severity>
        {scope && <span className="label find-scope">{scope}</span>}
      </div>
      <p>{finding.message}</p>
      {stale && <p className="muted">The test changed after this check. Run the check again to confirm.</p>}
      {children}
    </div>
  );
}
