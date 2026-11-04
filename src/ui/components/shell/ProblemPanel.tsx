import * as stylex from "@stylexjs/stylex";
import { useApp } from "../../lib/app.ts";
import { ApiError } from "../../lib/data/client.ts";
import { message } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Banner } from "../ui/Banner.tsx";
import { Button } from "../ui/Button.tsx";
import { type } from "../ui/type.ts";

const ACCESS = /\b(401|403)\b|token|refused|unauthori[sz]ed|credentials|authenticat/i;
const JIRA = /jira|xray|atlassian/i;

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s2, margin: 0 },
  p: { margin: 0 },
  untouched: { margin: 0, color: color.textMuted },
});

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

// ponytail: a failure that stops a piece of work — what happened, what to do, where to look, and Retry
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
    <div role="alert">
      <Banner
        tone="danger"
        title={p.title}
        actions={
          <>
            {p.access ? (
              <Button size="sm" label="Open Settings › Access" onClick={() => app.navigate("settings", "access")} />
            ) : (
              <Button size="sm" label="Open the system check" onClick={() => app.navigate("doctor")} />
            )}
            {onRetry && <Button size="sm" variant="quiet" label="Retry" onClick={onRetry} />}
          </>
        }
      >
        <div {...stylex.props(styles.body)}>
          <p {...stylex.props(styles.p)}>
            {doing} stopped: {p.detail}
          </p>
          <p {...stylex.props(styles.p)}>
            <span {...stylex.props(type.strong)}>What to do:</span>{" "}
            {p.fix ??
              (p.access
                ? "create a new API token on your Atlassian account, then paste it in Settings › Access."
                : p.jira
                  ? "check your network or proxy, then retry. The system check shows what is reachable."
                  : "retry; if it fails again, the system check says what is missing.")}
          </p>
          {p.jira && <p {...stylex.props(styles.untouched)}>{untouched}</p>}
        </div>
      </Banner>
    </div>
  );
}
