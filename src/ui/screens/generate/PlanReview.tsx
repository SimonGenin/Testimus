import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { PlanList, planCount } from "./PlanList.tsx";
import { PlanQuestions } from "./PlanQuestions.tsx";
import { about } from "./planEdits.ts";
import { usePlan } from "./usePlan.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s5, minWidth: 0 },
  head: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  titles: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0, flex: 1 },
  title: { margin: 0, color: color.text },
  meta: { color: color.textSubtle },
  revise: { display: "flex", flexDirection: "column", gap: space.s3 },
  foot: { display: "flex", justifyContent: "flex-end" },
});

export type PlanGo = { answers: Record<string, string> };

// ponytail: a generation's plan before anything is written (decision 4 of WORKLOAD.md) — what it costs, the questions
// Claude asks, the stale index to read again first, the tests by theme to tick, rename, move or merge; « Revise the
// plan » asks Claude again with the answers and the words, « Write the N tests » starts the writing
export function PlanReview({
  generation,
  failed,
  busy,
  unavailable,
  onRevise,
  onWrite,
}: {
  generation: string;
  /** the last revision did not give a plan: why */
  failed?: string;
  /** a run starts or runs: nothing can be asked meanwhile */
  busy: boolean;
  /** why Claude cannot be asked (not connected) */
  unavailable?: string;
  onRevise: (input: { generation: string; answers: Record<string, string>; request: string }) => void;
  onWrite: (input: { generation: string; answers: Record<string, string>; reindex: boolean }) => void;
}) {
  const p = usePlan(generation);
  const d = p.data;
  if (!d?.plan)
    return (
      <Card>
        <div aria-busy="true" {...stylex.props(styles.body)}>
          <Skeleton kind="title" width="50%" />
          <Skeleton lines={4} />
          <Loading read="gen.show" />
        </div>
      </Card>
    );
  const tests = d.plan.tests;
  const count = planCount(tests);
  const stale = d.stale.length > 0;
  const blocked = unavailable ?? (busy ? "Claude is working on it" : undefined);
  const answered = Object.fromEntries(Object.entries(p.answers).filter(([, v]) => v.trim()));
  const open = d.plan.questions.length - d.plan.questions.filter((q) => answered[q.id]).length;
  const write = () => {
    onWrite({ generation, answers: answered, reindex: stale && p.reindex });
    p.clearAnswers();
  };
  const revise = () => {
    onRevise({ generation, answers: answered, request: p.request.trim() });
    p.clearAnswers();
    p.setRequest("");
  };
  return (
    <section aria-label="Plan" {...stylex.props(styles.body)}>
      <Card density="compact">
        <div {...stylex.props(styles.head)}>
          <Badge tone="claude" icon="list" label="Plan" />
          <div {...stylex.props(styles.titles)}>
            <h2 {...stylex.props(type.title, styles.title)}>{count.line}</h2>
            {d.cost && (
              <span {...stylex.props(type.small, styles.meta)}>
                {plural(count.on, "Claude run")} · {about(d.cost.seconds)} with {d.cost.agents} at a time · nothing is
                written until you say so
              </span>
            )}
          </div>
          <Button
            variant="primary"
            icon="generate"
            label={`Write the ${plural(count.on, "test")}`}
            disabled={blocked ?? (count.on ? false : "Tick a test to write")}
            onClick={write}
          />
        </div>
      </Card>
      {failed && (
        <Banner tone="danger" title="The plan was not revised">
          {failed} The answers are kept; the plan below is the one before.
        </Banner>
      )}
      {stale && (
        <Banner tone="warning" title={`${plural(d.stale.length, "document")} changed since the last index`}>
          <Checkbox
            checked={p.reindex}
            label={`Reindex first (≈ ${d.reindexSeconds} s)`}
            hint="Otherwise what changed in them is not searched while the tests are written."
            onChange={p.setReindex}
          />
        </Banner>
      )}
      <PlanQuestions
        questions={d.plan.questions}
        settled={d.settled}
        answers={p.answers}
        disabled={blocked}
        onAnswer={p.answer}
      />
      {open > 0 && (
        <p {...stylex.props(type.compact, styles.meta)}>
          {plural(open, "question")} not answered: the runs will decide {open === 1 ? "it" : "them"} from the documents.
        </p>
      )}
      <PlanList
        tests={tests}
        overlaps={d.overlaps}
        disabled={blocked ?? (p.saving ? "Saving the plan" : undefined)}
        onChange={(next) => void p.save(next)}
      />
      <Card title="Ask Claude to revise the plan">
        <div {...stylex.props(styles.revise)}>
          <Text
            multiline
            rows={2}
            label="What should change in the plan?"
            placeholder="Optional: another split, a test missing, a theme to rename… Your answers above go with it."
            value={p.request}
            readOnly={!!blocked}
            onChange={p.setRequest}
          />
          <span {...stylex.props(styles.foot)}>
            <Button
              variant="claude"
              icon="claude"
              label="Revise the plan"
              disabled={
                blocked ??
                (!p.request.trim() && !Object.keys(answered).length
                  ? "Answer a question or say what should change"
                  : false)
              }
              onClick={revise}
            />
          </span>
        </div>
      </Card>
    </section>
  );
}
