import { ApiError } from "../../api.ts";
import { useApp } from "../../lib/app.ts";
import { message } from "../../lib/format.ts";
import { Button, Severity } from "../legacy/index.ts";

const ACCESS = /\b(401|403)\b|token|refused|unauthori[sz]ed|credentials|authenticat/i;
const JIRA = /jira|xray|atlassian/i;

export function problemOf(e: unknown): { title: string; detail: string; fix?: string; access: boolean; jira: boolean } {
  const detail = message(e);
  const fix = e instanceof ApiError ? e.fix : undefined;
  const all = `${detail} ${fix ?? ""}`;
  const jira = JIRA.test(all);
  const access = jira && ACCESS.test(all);
  return {
    title: access ? "Jira refused your access" : jira ? "Jira did not answer" : "This did not work",
    detail,
    fix,
    access,
    jira,
  };
}

export function ProblemPanel({
  error,
  doing,
  onRetry,
  untouched = "Your local tests are untouched. Nothing was written to Jira.",
}: {
  error: unknown;
  doing: string;
  onRetry?: () => void;
  untouched?: string;
}) {
  const app = useApp();
  const p = problemOf(error);
  return (
    <div className="problem" role="alert">
      <Severity tone="error">{p.title}</Severity>
      <p>
        {doing} stopped: {p.detail}
      </p>
      <p>
        <strong>What to do:</strong>{" "}
        {p.fix ??
          (p.access
            ? "create a new API token on your Atlassian account, then paste it in Settings › Access."
            : p.jira
              ? "check your network or proxy, then retry. The system check shows what is reachable."
              : "retry; if it fails again, the system check says what is missing.")}
      </p>
      <div className="problem-actions">
        {p.access ? (
          <Button size="sm" onClick={() => app.navigate("settings", "access")}>
            Open Settings › Access
          </Button>
        ) : (
          <Button size="sm" onClick={() => app.navigate("doctor")}>
            Open the system check
          </Button>
        )}
        {onRetry && (
          <Button size="sm" tone="quiet" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
      {p.jira && <p className="muted">{untouched}</p>}
    </div>
  );
}
