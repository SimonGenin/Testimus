import { useEffect, useState } from "react";
import type { CredsStatus } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { Button, Severity, Skeleton } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { useDoctor } from "../../lib/doctor.ts";

export function AccessSection() {
  const app = useApp();
  const [st, setSt] = useState<CredsStatus | null>(null);
  const doctor = useDoctor();
  useEffect(() => {
    call<{ status: CredsStatus }>("system.setup", {})
      .then((r) => setSt(r.status))
      .catch(() => {});
  }, []);
  const state = (id: string, complete: boolean) => {
    const c = doctor.checks.find((x) => x.id === id);
    if (!complete) return <Severity tone="warning">Missing</Severity>;
    if (!c || c.state === "skip") return <Severity tone="info">Saved</Severity>;
    return c.state === "ok" ? (
      <Severity tone="ok">Connected</Severity>
    ) : (
      <span title={c.fix}>
        <Severity tone="error">{c.detail.slice(0, 60)}</Severity>
      </span>
    );
  };
  const edit = () => app.navigate("setup");
  return (
    <section className="card sect" id="settings-access" aria-labelledby="s-access">
      <h2 id="s-access" className="h sect-title">
        Access
      </h2>
      {!st ? (
        <Skeleton h={40} />
      ) : (
        <>
          <div className="accrow">
            <span className="accrow-name">Jira</span>
            <span className="muted">
              {st.jira.baseUrl ? st.jira.baseUrl.replace(/^https?:\/\//, "").replace(/\/wiki\/?$/, "") : "No site"}
              {st.jira.email ? ` · ${st.jira.email}` : ""}
            </span>
            {state("jira", st.jira.complete)}
            <Button size="sm" onClick={edit}>
              Edit
            </Button>
          </div>
          <div className="accrow">
            <span className="accrow-name">Xray</span>
            <span className="muted">
              {st.xray.complete ? "Client ID and secret saved" : "Client ID or secret missing"}
            </span>
            {state("xray", st.xray.complete)}
            <Button size="sm" onClick={edit}>
              Edit
            </Button>
          </div>
          <span className="muted mono accfile">{st.jira.file}</span>
        </>
      )}
    </section>
  );
}
