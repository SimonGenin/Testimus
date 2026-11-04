import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import type { ClaudeAction, ClaudeScope, Effort } from "../../../core/types.ts";
import { originLine, scopeWords } from "../../lib/actions.ts";
import { useRead } from "../../lib/data/query.ts";
import { border, color, fontSize, fontWeight, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Select } from "../ui/Select.tsx";
import { useContexts } from "./contexts.ts";
import { CustomModel, cap, effortOptions, useModelChoice } from "./ModelPicker.tsx";

const styles = stylex.create({
  card: {
    flex: "none",
    display: "flex",
    flexDirection: "column",
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
    overflow: "hidden",
  },
  body: { display: "flex", flexDirection: "column", gap: space.s3, padding: space.s4 },
  title: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.s3,
    margin: 0,
    fontSize: fontSize.titleSm,
    lineHeight: lineHeight.titleSm,
    fontWeight: fontWeight.semibold,
    color: color.text,
  },
  spark: { display: "inline-flex", marginBlockStart: space.s1, color: color.claude },
  text: { margin: 0, fontSize: fontSize.body, lineHeight: lineHeight.body, color: color.text },
  origin: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textSubtle },
  kv: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    columnGap: space.s4,
    rowGap: space.s2,
    margin: 0,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
  },
  dt: { color: color.textSubtle, fontWeight: fontWeight.medium },
  dd: { margin: 0, color: color.text },
  plan: { margin: 0, paddingInlineStart: space.s5 },
  picks: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  foot: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
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
      <dl {...stylex.props(styles.kv)}>
        <dt {...stylex.props(styles.dt)}>Plan</dt>
        <dd {...stylex.props(styles.dd)}>
          {action.why}
          {action.plan.length > 0 && (
            <ul {...stylex.props(styles.plan)}>
              {action.plan.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </dd>
        <dt {...stylex.props(styles.dt)}>Access</dt>
        <dd {...stylex.props(styles.dd)}>Every Testimus command · read and edit the project files</dd>
        <dt {...stylex.props(styles.dt)}>Context</dt>
        <dd {...stylex.props(styles.dd)}>{names === null ? "…" : names.length ? names.join(", ") : "None"}</dd>
      </dl>
      <div {...stylex.props(styles.picks)}>
        <Select
          label="Model"
          size="sm"
          appearance="quiet"
          icon="cpu"
          value={choice.selected}
          options={choice.options}
          onChange={choice.pick}
        />
        <Select
          label="Effort"
          size="sm"
          appearance="quiet"
          value={effort}
          options={effortOptions}
          onChange={onEffort}
        />
        <CustomModel choice={choice} />
      </div>
      {s && <span {...stylex.props(styles.origin)}>Suggested for this task: {`${cap(s.model)} · ${s.effort}`}.</span>}
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
    <section aria-label={`Claude action: ${action.title}`} {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.body)}>
        <h3 {...stylex.props(styles.title)}>
          <span {...stylex.props(styles.spark)}>
            <Icon name="claude" />
          </span>
          {action.title}
        </h3>
        <span>
          <Badge tone="claude" size="sm" label={scopeWords(action.scope)} />
        </span>
        {ready ? (
          <>
            <p {...stylex.props(styles.text)}>{action.problem}</p>
            <span {...stylex.props(styles.origin)}>{originLine(action)}</span>
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
            {meta && <span {...stylex.props(styles.origin)}>{meta}</span>}
            {children}
          </>
        )}
      </div>
      {ready && (
        <div {...stylex.props(styles.foot)}>
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
        </div>
      )}
    </section>
  );
}
