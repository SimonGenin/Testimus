import { type ReactNode, useEffect, useState } from "react";
import type { ClaudeAction, ClaudeScope, Effort } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { originLine, scopeWords } from "../../lib/actions.ts";
import { Button, Chip, Icon } from "../legacy/index.ts";
import { cap, EFFORTS, ModelPicker } from "./ModelPicker.tsx";

// ponytail: the contexts the run attaches when none is picked — the test's own list, else the project's defaults
// (claude/actions.ts runAction), by name
function useActionContexts(scope: ClaudeScope, defaults: string[] | undefined): string[] | null {
  const [names, setNames] = useState<string[] | null>(null);
  const testId = "testId" in scope ? scope.testId : "";
  const key = (defaults ?? []).join(",");
  useEffect(() => {
    let on = true;
    Promise.all([
      testId
        ? call<{ effective: string[] }>("contexts.ofTest", { testId }).then((r) => r.effective)
        : Promise.resolve(key ? key.split(",") : []),
      call<{ id: string; name: string }[]>("contexts.list", {}),
    ])
      .then(([ids, all]) => {
        if (on) setNames(ids.flatMap((id) => all.find((c) => c.id === id)?.name ?? []));
      })
      .catch(() => {
        if (on) setNames(null);
      });
    return () => {
      on = false;
    };
  }, [testId, key]);
  return names;
}

export function ActionCard({
  action,
  ready,
  busy,
  model,
  effort,
  contexts,
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
  contexts?: string[];
  meta?: string;
  onModel: (m: string) => void;
  onEffort: (e: Effort) => void;
  onRun: () => void;
  onLater: () => void;
  onDismiss: () => void;
  children?: ReactNode;
}) {
  const by = action.proposedBy;
  const s = action.suggest;
  const names = useActionContexts(action.scope, contexts);
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
                    {action.plan.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
              </dd>
              <dt>Access</dt>
              <dd>Every Testimus command · read and edit the project files</dd>
              <dt>Context</dt>
              <dd>{names === null ? "…" : names.length ? names.join(", ") : "None"}</dd>
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
            </div>
            <div className="acard-btns">
              <Button size="sm" tone="quiet" onClick={onDismiss} title="The button goes and does not come back">
                Dismiss
              </Button>
              <span className="spacer" />
              <Button size="sm" onClick={onLater}>
                Not now
              </Button>
              <Button size="sm" tone="primary" icon="claude" disabled={busy} onClick={onRun}>
                Run action
              </Button>
            </div>
            <span className="muted acard-hint">
              {originLine(action)}.{s ? ` Suggested for this task: ${cap(s.model)} · ${s.effort}.` : ""}
            </span>
          </>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
