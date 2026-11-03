import { useState } from "react";
import type { CredsStatus } from "../../../core/types.ts";
import { Severity } from "../../components/legacy/index.ts";
import { useDoctor } from "../../lib/doctor.ts";
import { cx } from "../../lib/format.ts";
import { ConnectAtlassian } from "./ConnectAtlassian.tsx";

type FileState = CredsStatus["xray"];

export function fileState(f: FileState): "found" | "missing" | "invalid" {
  if (!f.exists) return "missing";
  return f.invalid || !f.complete ? "invalid" : "found";
}

const MARK = { found: "✓", missing: "✕", invalid: "!" } as const;

export function AccessSection() {
  const [st, setSt] = useState<CredsStatus | null>(null);
  const doctor = useDoctor();
  const link = (id: string, f: FileState) => {
    const c = doctor.checks.find((x) => x.id === id);
    if (fileState(f) !== "found" || !c || c.state === "skip") return null;
    return c.state === "ok" ? (
      <Severity tone="ok">Connected</Severity>
    ) : (
      <span title={c.fix}>
        <Severity tone="error">{c.detail.slice(0, 60)}</Severity>
      </span>
    );
  };
  const row = (id: "jira" | "xray", name: string, f: FileState) => {
    const s = fileState(f);
    return (
      <div key={id} className="credrow">
        <span className={cx("credmark", `cred-${s}`)} aria-hidden="true">
          {MARK[s]}
        </span>
        <span className="accrow-name">{name}</span>
        <span className="mono credpath" title={f.file}>
          {f.file}
        </span>
        <span className={cx("credstate", `cred-${s}`)} title={f.problem}>
          {s === "found"
            ? "found · valid"
            : s === "missing"
              ? "missing"
              : `invalid${f.problem ? ` — ${f.problem}` : ""}`}
        </span>
        {link(id, f)}
      </div>
    );
  };
  return (
    <section className="card sect" id="settings-access" aria-labelledby="s-access">
      <h2 id="s-access" className="h sect-title">
        Access
      </h2>
      {st && (
        <div className="credrows">
          {row("jira", "Jira", st.jira)}
          {row("xray", "Xray", st.xray)}
        </div>
      )}
      <ConnectAtlassian onStatus={setSt} />
    </section>
  );
}
