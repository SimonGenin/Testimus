import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ActionTarget, ClaudeAction, Effort } from "../../../core/types.ts";
import { type Action, groupByTarget } from "../../lib/actions.ts";
import { key, useCommand } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { ActionCard } from "./ActionCard.tsx";
import { ActionGroup } from "./ActionGroup.tsx";

export type Pick = { model: string; effort: Effort };

const styles = stylex.create({
  intro: { paddingTop: space.s6 },
});

// ponytail: what the Actions tab keeps while the dock lives — the cards put aside (« Not now », back when the app
// opens again) and the model and effort picked on each card
export function useActionChoices(defaults: Pick) {
  const [later, setLater] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const pickOf = (a: ClaudeAction) => picks[a.id] ?? a.suggest ?? defaults;
  return {
    later,
    putAside: (id: string) => setLater((s) => new Set(s).add(id)),
    pickOf,
    setPick: (a: ClaudeAction, p: Partial<Pick>) => setPicks((all) => ({ ...all, [a.id]: { ...pickOf(a), ...p } })),
  };
}

// ponytail: the Actions tab — every open action Claude proposed, grouped by what it works on (the one on screen
// first: the core's order), each a card to run with its model and effort; Dismiss for good
export function DockActions({
  actions,
  view,
  busy,
  choices,
  contexts,
  onRun,
}: {
  actions: Action[];
  /** the target on screen, as actions.list was asked */
  view?: ActionTarget;
  busy: boolean;
  choices: ReturnType<typeof useActionChoices>;
  contexts?: string[];
  onRun: (a: ClaudeAction, pick: Pick) => void;
}) {
  const dismiss = useCommand("actions.dismiss", {
    invalidates: [["actions.list"]],
    optimistic: (c, input) => {
      const k = key("actions.list", view ? { view } : {});
      const before = c.getQueryData<Action[]>(k);
      c.setQueryData<Action[]>(
        k,
        before?.filter((a) => a.id !== input.id),
      );
      return () => c.setQueryData(k, before);
    },
  });
  const shown = actions.filter((a) => !choices.later.has(a.id));
  if (!shown.length)
    return (
      <div {...stylex.props(styles.intro)}>
        <EmptyState
          icon="list"
          title={actions.length ? "Every action is put aside" : "No Claude action"}
          text={
            actions.length
              ? "They come back when the app is opened again."
              : "When a run sees a problem it can fix later, it proposes it here. Running one changes files like any run, and Revert undoes it."
          }
        />
      </div>
    );
  return (
    <>
      {groupByTarget(shown).map((g) => (
        <ActionGroup key={`${g.target.kind}:${g.target.id}`} group={g}>
          {g.actions.map((a) => (
            <ActionCard
              key={a.id}
              action={a}
              grouped
              ready
              busy={busy}
              model={choices.pickOf(a).model}
              effort={choices.pickOf(a).effort}
              contexts={contexts}
              onModel={(m) => choices.setPick(a, { model: m })}
              onEffort={(e) => choices.setPick(a, { effort: e })}
              onRun={() => onRun(a, choices.pickOf(a))}
              onLater={() => choices.putAside(a.id)}
              onDismiss={() =>
                dismiss.mutate({ id: a.id }, { onError: (e) => errorToast(e, "Could not dismiss the action") })
              }
            />
          ))}
        </ActionGroup>
      ))}
    </>
  );
}
