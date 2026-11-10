import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Effort, Source, Test } from "../../../../core/types.ts";
import { cap, effortOptions, useModelChoice } from "../../../components/claude/ModelPicker.tsx";
import { useClaudeStatus } from "../../../components/claude/useClaudeStatus.ts";
import { useNow } from "../../../components/claude/useNow.ts";
import { useRunContext } from "../../../components/claude/useRunContext.tsx";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { ClaudeBlock } from "../../../components/ui/ClaudeBlock.tsx";
import { EmptyState } from "../../../components/ui/EmptyState.tsx";
import { Pane } from "../../../components/ui/Pane.tsx";
import { Segmented } from "../../../components/ui/Segmented.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { type } from "../../../components/ui/type.ts";
import { execute } from "../../../lib/data/query.ts";
import { plural, relTime } from "../../../lib/format.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { firstLine } from "../step/stepText.ts";
import { ColumnsRead } from "./ColumnsRead.tsx";
import { DecidedList } from "./DecidedList.tsx";
import { ProposalCard } from "./ProposalCard.tsx";
import type { ProposalView, useAnalysis } from "./useAnalysis.ts";

const styles = stylex.create({
  pane: { flex: 1, minWidth: 0, minHeight: 0, display: "flex", backgroundColor: color.surface },
  body: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingBlock: space.s5,
    paddingInline: space.s6,
  },
  intro: { display: "flex", flexDirection: "column", gap: space.s2 },
  text: { margin: 0, overflowWrap: "anywhere" },
  muted: { margin: 0, color: color.textMuted },
  meta: { margin: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, color: color.textSubtle },
  group: { display: "flex", flexDirection: "column", gap: space.s3 },
  groupHead: { margin: 0, color: color.textSubtle },
  items: { margin: 0, paddingInlineStart: space.s5 },
  foot: { flex: 1, margin: 0, color: color.textSubtle },
});

type Tab = "open" | "accepted" | "rejected";

const groupOf = (p: ProposalView) =>
  p.kind === "step" ? (p.after ? `After step ${p.after}` : "Before step 1") : `Step ${p.step}`;

function byPlace(list: ProposalView[]): [string, ProposalView[]][] {
  const out = new Map<string, ProposalView[]>();
  const order = (p: ProposalView) => (p.kind === "step" ? (p.after ?? 0) + 0.5 : (p.step ?? 0));
  for (const p of [...list].sort((a, b) => order(a) - order(b))) {
    const k = groupOf(p);
    out.set(k, [...(out.get(k) ?? []), p]);
  }
  return [...out];
}

// ponytail: Claude's analysis of the test, a tab beside the editor's — before one exists, the box that starts it; while it
// runs, the same box with its timer and Cancel; then Claude's reading, the proposals to decide grouped by the step they
// are about, what was decided, the items no document holds and how each column was treated
export function AnalysisPane({
  testId,
  test,
  state,
  defaults,

  locked,
  onSelect,
  onOpenSource,
  onClose,
}: {
  testId: string;
  test: Test;
  state: ReturnType<typeof useAnalysis>;
  defaults: { model: string; effort: Effort };

  locked: false | string;
  onSelect: (p: ProposalView) => void;
  onOpenSource: (s: Source) => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { analysis, running, failed, deciding, start, decide } = state;
  const [tab, setTab] = useState<Tab>("open");
  const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [model, setModel] = useState(defaults.model);
  const [effort, setEffort] = useState<Effort>(defaults.effort);
  const [look, setLook] = useState("");
  const choice = useModelChoice(model, setModel);
  const { status } = useClaudeStatus();
  const offline = !!status && (!status.installed || status.signedIn === false);
  const now = useNow(!!running, 1000);
  const seconds = running ? Math.max(0, Math.round((now - Date.parse(running.startedAt)) / 1000)) : null;

  const open = analysis?.proposals.filter((p) => p.state === "open") ?? [];
  const accepted = analysis?.proposals.filter((p) => p.state === "accepted") ?? [];
  const rejected = analysis?.proposals.filter((p) => p.state === "rejected") ?? [];
  const sources = open.filter((p) => p.kind === "source" && !p.stale);
  const shown = tab === "open" ? open : tab === "accepted" ? accepted : rejected;

  const ask = (!analysis && !state.loading) || asking || !!running;
  const given = useRunContext({ use: "analyze", scope: { kind: "test", testId }, note: look, enabled: ask });
  const block = ask && (
    <ClaudeBlock
      id="analysis-note"
      ariaLabel="Look especially at"
      value={look}
      onChange={setLook}
      context={given.context}
      placeholder="Look especially at… (optional)"
      allowEmpty
      model={{ value: choice.selected, shown: cap(model), options: choice.options, onChange: choice.pick }}
      effort={{ value: effort, options: effortOptions, onChange: (e) => setEffort(e as Effort) }}
      submitLabel="Analyze"
      running={seconds}
      onCancel={running ? () => void execute(client, "jobs.cancel", { id: running.id }) : undefined}
      unavailable={offline ? "Claude is not connected" : locked || undefined}
      onSubmit={(note) => {
        setAsking(false);
        setTab("open");
        setLook("");
        void start({ ...(note.trim() ? { note } : {}), model, effort, ...given.run });
      }}
    />
  );

  return (
    <div {...stylex.props(styles.pane)}>
      <Pane
        as="aside"
        title="Analysis against the documents"
        fill
        actions={
          <Button size="sm" variant="quiet" iconOnly icon="close" label="Close the analysis" onClick={onClose} />
        }
        footer={
          analysis && (open.length || accepted.length || rejected.length) ? (
            <>
              <p {...stylex.props(type.small, styles.foot)}>
                {open.length} to decide · {accepted.length} accepted · {rejected.length} rejected
              </p>
              {sources.length > 1 && tab === "open" && (
                <Button
                  size="sm"
                  label={`Accept the ${sources.length} sources`}
                  disabled={locked || deciding.length > 0}
                  onClick={() =>
                    void decide(
                      sources.map((p) => p.id),
                      "accept",
                    )
                  }
                />
              )}
            </>
          ) : undefined
        }
      >
        <div {...stylex.props(styles.body)}>
          {failed && !running && (
            <Banner
              tone="warning"
              title="The analysis stopped."
              actions={
                <Button
                  size="sm"
                  label="Try again"
                  disabled={locked}
                  onClick={() => void start({ model, effort, ...given.run })}
                />
              }
            >
              {failed}
            </Banner>
          )}
          {ask && (
            <div {...stylex.props(styles.intro)}>
              {!analysis && (
                <p {...stylex.props(type.compact, styles.muted)}>
                  Claude reads this test and the documents, links what it finds to its passages and proposes changes.
                  Nothing changes until you accept it.
                </p>
              )}
              {block}
            </div>
          )}
          {state.loading && <Skeleton lines={4} />}
          {analysis && !running && (
            <>
              <div {...stylex.props(styles.intro)}>
                <p {...stylex.props(type.compact, styles.text)}>{analysis.summary}</p>
                <p {...stylex.props(type.small, styles.meta)}>
                  {analysis.run && <span>{cap(analysis.run.model)} ·</span>}
                  <span>{relTime(Date.parse(analysis.at))}</span>
                  {!asking && (
                    <>
                      <span>·</span>
                      <Button size="sm" variant="link" label="Analyze again" onClick={() => setAsking(true)} />
                    </>
                  )}
                </p>
              </div>
              {analysis.proposals.length > 0 && (
                <Segmented
                  label="Show the proposals"
                  size="sm"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "open", label: "To decide", count: open.length },
                    { value: "accepted", label: "Accepted", count: accepted.length },
                    { value: "rejected", label: "Rejected", count: rejected.length },
                  ]}
                />
              )}
              {!analysis.proposals.length && (
                <EmptyState
                  compact
                  icon="validated"
                  title="The test matches the documents"
                  text="Claude proposes no source and no change."
                />
              )}
              {analysis.proposals.length > 0 && !shown.length && (
                <p {...stylex.props(type.compact, styles.muted)}>
                  {tab === "open" ? "Nothing left to decide." : `No proposal ${tab}.`}
                </p>
              )}
              {tab === "open" &&
                byPlace(open).map(([place, list]) => (
                  <section key={place} aria-label={place} {...stylex.props(styles.group)}>
                    <h3 {...stylex.props(type.small, styles.groupHead)}>
                      {list[0].stale ? (
                        place
                      ) : (
                        <Button
                          size="sm"
                          variant="link"
                          label={place}
                          onClick={() => {
                            setPicked(place);
                            onSelect(list[0]);
                          }}
                        />
                      )}
                    </h3>
                    {list.map((p) => {
                      const removed = p.kind === "remove" && p.now ? test.steps[p.now - 1] : undefined;
                      return (
                        <ProposalCard
                          key={p.id}
                          proposal={p}
                          removed={
                            removed
                              ? Object.values(removed.fields).filter(Boolean).map(firstLine).join("\n")
                              : undefined
                          }
                          selected={picked === place}
                          busy={deciding.includes(p.id)}
                          locked={locked}
                          onDecide={(d) => void decide([p.id], d)}
                          onOpenSource={onOpenSource}
                        />
                      );
                    })}
                  </section>
                ))}
              {tab !== "open" && shown.length > 0 && (
                <DecidedList
                  proposals={shown}
                  busy={deciding}
                  locked={locked}
                  onReopen={(id) => void decide([id], "reopen")}
                />
              )}
              {analysis.unfound.length > 0 && (
                <Banner tone="warning" compact title={`${plural(analysis.unfound.length, "item")} in no document`}>
                  <ul {...stylex.props(styles.items)}>
                    {analysis.unfound.map((u) => (
                      <li key={`${u.step}-${u.item}`}>
                        {u.item} ({u.column}, step {u.step}) — kept as it is
                      </li>
                    ))}
                  </ul>
                </Banner>
              )}
              <ColumnsRead columns={analysis.columns} />
            </>
          )}
        </div>
      </Pane>
      {given.dialog}
    </div>
  );
}
