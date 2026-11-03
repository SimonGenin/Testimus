import type { ReactNode } from "react";
import type { ClaudeAction, Effort } from "../../../core/types.ts";
import { originLine, scopeWords } from "../../lib/actions.ts";
import { Button, Chip, Icon } from "../ui/index.ts";
import { EFFORTS, ModelPicker } from "./ModelPicker.tsx";

const RANK: Record<string, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };

export function ActionCard({
  action,
  ready,
  busy,
  model,
  effort,
  meta,
  onModel,
  onEffort,
  onRun,
  onLater,
  onDismiss,
  children,
}: {
  action: ClaudeAction;
  ready: boolean;
  busy: boolean;
  model: string;
  effort: Effort;
  meta?: string;
  onModel: (m: string) => void;
  onEffort: (e: Effort) => void;
  onRun: () => void;
  onLater: () => void;
  onDismiss: () => void;
  children?: ReactNode;
}) {
  const by = action.proposedBy;
  const low = !!by.effort && RANK[by.effort] < RANK.high;
  return (
    <section className="acard" aria-label={`Claude action: ${action.title}`}>
      <div className="acard-top">
        <Icon name="claude" />
        <span>Claude action</span>
        <span className="spacer" />
        <span className="mono acard-meta">{meta ?? (by.run ? `from the ${by.run}` : "")}</span>
      </div>
      <div className="acard-body">
        <h3 className="h acard-title">{action.title}</h3>
        <Chip small>{scopeWords(action.scope)}</Chip>
        {ready ? (
          <>
            <dl className="acard-kv">
              <dt>Why</dt>
              <dd>{action.problem}</dd>
              <dt>Plan</dt>
              <dd>
                {action.why}
                {action.plan.length > 0 && (
                  <ul>
                    {action.plan.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
              </dd>
              <dt>Access</dt>
              <dd>Every Testimus command. Jira writes stop at a plan: you push.</dd>
            </dl>
            <div className="acard-ctrls">
              <ModelPicker value={model} className="btn btn-sm select" onChange={onModel} />
              <select
                className="btn btn-sm select"
                aria-label="Effort"
                value={effort}
                onChange={(e) => onEffort(e.target.value as Effort)}
              >
                {EFFORTS.map((x) => (
                  <option key={x} value={x}>
                    Effort: {x}
                  </option>
                ))}
              </select>
              <span className="spacer" />
              <Button size="sm" tone="quiet" onClick={onDismiss} title="The button goes and does not come back">
                Dismiss
              </Button>
              <Button size="sm" onClick={onLater}>
                Not now
              </Button>
              <Button size="sm" tone="primary" icon="claude" disabled={busy} onClick={onRun}>
                Run action
              </Button>
            </div>
            <span className="muted acard-hint">
              {originLine(action)}.{low ? " A higher effort is usually worth it for a fix." : ""}
            </span>
          </>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
