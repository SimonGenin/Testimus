import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import type { ClaudeAction, ClaudeScope, Effort } from "../../../core/types.ts";
import { originLine, scopeWords } from "../../lib/actions.ts";
import { useRead } from "../../lib/data/query.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { Facts } from "../ui/Facts.tsx";
import { GroupSelect } from "../ui/GroupSelect.tsx";
import { Icon } from "../ui/Icon.tsx";
import { type } from "../ui/type.ts";
import { useContexts } from "./contexts.ts";
import { CustomModel, cap, effortOptions, useModelChoice } from "./ModelPicker.tsx";

const styles = stylex.create({
  card: { flex: "none", display: "flex", flexDirection: "column" },
  title: { display: "inline-flex", alignItems: "flex-start", gap: space.s3 },
  spark: { display: "inline-flex", marginBlockStart: space.s1, color: color.claude },
  text: { margin: 0, color: color.text },
  origin: { color: color.textSubtle },
  plan: { margin: 0, paddingInlineStart: space.s5 },
  picks: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  grow: { flex: 1 },
});

// ponytail: the contexts the run attaches when none is picked — the test's own list, else the project's defaults
// (claude/actions.ts runAction), by name
function useActionContexts(scope: ClaudeScope, defaults: string[] | undefined): string[] | null {
  const testId = "testId" in scope ? scope.testId : "";
  const own = useRead("contexts.ofTest", { testId }, { enabled: !!testId });
  const all = useContexts();
  const ids = testId ? (own.data as { effective?: string[] } | undefined)?.effective : (defaults ?? []);
  if (!all || !ids) return null;
  return ids.flatMap((id) => all.find((c) => c.id === id)?.name ?? []);
}

function Details({
  action,
  contexts,
  model,
  effort,
  onModel,
  onEffort,
}: {
  action: ClaudeAction;
  contexts?: string[];
  model: string;
  effort: Effort;
  onModel: (m: string) => void;
  onEffort: (e: Effort) => void;
}) {
  const names = useActionContexts(action.scope, contexts);
  const choice = useModelChoice(model, onModel);
  const s = action.suggest;
  return (
    <>
      <Facts
        size="sm"
        items={[
          {
            label: "Plan",
            value: (
              <>
                {action.why}
                {action.plan.length > 0 && (
                  <ul {...stylex.props(styles.plan)}>
                    {action.plan.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
              </>
            ),
          },
          { label: "Access", value: "Every Testimus command · read and edit the project files" },
          { label: "Context", value: names === null ? "…" : names.length ? names.join(", ") : "None" },
        ]}
      />
      <div {...stylex.props(styles.picks)}>
        <GroupSelect
          label="Model and effort"
          groups={[
            { label: "Model", value: choice.selected, options: choice.options, onChange: choice.pick },
            { label: "Effort", value: effort, options: effortOptions, onChange: (e) => onEffort(e as Effort) },
          ]}
        />
        <CustomModel choice={choice} />
      </div>
      {s && (
        <span {...stylex.props(type.small, styles.origin)}>
          Suggested for this task: {`${cap(s.model)} · ${s.effort}`}.
        </span>
      )}
    </>
  );
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
  const [open, setOpen] = useState(false);
  return (
    <div {...stylex.props(styles.card)}>
      <Card
        title={
          <span {...stylex.props(styles.title)}>
            <span {...stylex.props(styles.spark)}>
              <Icon name="claude" label="Claude action:" />
            </span>{" "}
            {action.title}
          </span>
        }
        footer={
          ready && (
            <>
              <Button
                size="sm"
                variant="claude"
                icon="play"
                label="Run"
                disabled={busy ? "Claude is working — wait for it to finish" : false}
                onClick={onRun}
              />
              <Button size="sm" variant="quiet" label="Show" expanded={open} onClick={() => setOpen((o) => !o)} />
              <Button size="sm" variant="quiet" label="Not now" onClick={onLater} />
              <span {...stylex.props(styles.grow)} />
              <Button size="sm" variant="quiet" icon="close" label="Dismiss" onClick={onDismiss} />
            </>
          )
        }
      >
        <span>
          <Badge tone="claude" size="sm" label={scopeWords(action.scope)} />
        </span>
        {ready ? (
          <>
            <p {...stylex.props(type.compact, styles.text)}>{action.problem}</p>
            <span {...stylex.props(type.small, styles.origin)}>{originLine(action)}</span>
            {open && (
              <Details
                action={action}
                contexts={contexts}
                model={model}
                effort={effort}
                onModel={onModel}
                onEffort={onEffort}
              />
            )}
          </>
        ) : (
          <>
            {meta && <span {...stylex.props(type.small, styles.origin)}>{meta}</span>}
            {children}
          </>
        )}
      </Card>
    </div>
  );
}
