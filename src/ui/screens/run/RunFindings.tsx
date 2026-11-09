import * as stylex from "@stylexjs/stylex";
import { Badge, QUESTION, RUN_STATUS } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { PanelSection, RunPanel } from "./RunPanel.tsx";
import { RunShot } from "./RunShot.tsx";
import { clock, day, type RunView } from "./runs.ts";

const styles = stylex.create({
  item: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  head: { display: "flex", alignItems: "flex-start", gap: space.s2, minWidth: 0 },
  test: { margin: 0, overflowWrap: "anywhere" },
  step: { color: color.danger },
  note: { margin: 0, color: color.textMuted, whiteSpace: "pre-wrap" },
  shots: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: space.s2 },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s1 },
  none: { margin: 0, color: color.textMuted },
  hint: { display: "flex", alignItems: "flex-start", gap: space.s2, margin: 0, color: color.textMuted },
});

// ponytail: what the run found, beside it — each NOK step with what happened and its screenshots, the blocked tests and
// why, the questions still open; a line opens its test, Claude summarizes the whole for a report
export function RunFindings({
  width,
  run,
  onOpenTest,
  onAsk,
}: {
  /** px, once the tester widened it */
  width?: number;
  run: RunView;
  onOpenTest: (testId: string) => void;
  onAsk: (prompt?: string) => void;
}) {
  const shot = (testId: string, file: string) => fileUrl(`test-runs/${run.slug}/results/${testId}/${file}`);
  const noks = run.tests.flatMap((t) =>
    t.result.steps.flatMap((s, i) => (s.ok === false ? [{ t, n: i + 1, note: s.note ?? "" }] : [])),
  );
  const blocked = run.tests.filter((t) => t.result.status === "blocked");
  const questions = run.tests.flatMap((t) =>
    t.result.comments.filter((c) => c.kind === "question" && !c.answer).map((q) => ({ t, q })),
  );
  return (
    <RunPanel
      label="What the run found"
      width={width}
      foot={
        <div {...stylex.props(styles.item)}>
          <Button
            variant="claude-quiet"
            icon="claude"
            block
            label="Summarize this run for a report"
            onClick={() =>
              onAsk(
                "Summarize this test run for a release report: what passed, each problem with the step and what happened, what is blocked and why, and the open questions.",
              )
            }
          />
          <p {...stylex.props(type.small, styles.hint)}>
            <Icon name="info" size="sm" />
            Claude reads the run and its notes; it never marks a result.
          </p>
        </div>
      }
    >
      <PanelSection title="Problems to look at" count={noks.length}>
        {noks.length ? (
          noks.map(({ t, n, note }) => {
            const files = t.result.attachments.filter((a) => a.step === n).map((a) => a.file);
            return (
              <Card key={`${t.id}-${n}`} density="compact">
                <div {...stylex.props(styles.item)}>
                  <div {...stylex.props(styles.head)}>
                    <Badge {...RUN_STATUS[t.result.status === "not-run" ? "problem" : t.result.status]} size="sm" />
                    <span {...stylex.props(type.compact, type.medium, styles.test)}>{t.summary}</span>
                  </div>
                  <span {...stylex.props(type.small, type.strong, styles.step)}>Step {n} · NOK</span>
                  {note && <p {...stylex.props(type.small, styles.note)}>{note}</p>}
                  {files.length > 0 && (
                    <div {...stylex.props(styles.shots)}>
                      {files.slice(0, 2).map((f) => (
                        <RunShot key={f} fill file={f} url={shot(t.id, f)} onOpen={() => onOpenTest(t.id)} />
                      ))}
                    </div>
                  )}
                  <div {...stylex.props(styles.row)}>
                    <Button
                      size="sm"
                      variant="quiet"
                      icon="arrow-right"
                      label="Open the test"
                      onClick={() => onOpenTest(t.id)}
                    />
                    <Button
                      size="sm"
                      variant="claude-quiet"
                      icon="claude"
                      label="Draft a bug"
                      onClick={() =>
                        onAsk(
                          `Draft a bug report for step ${n} of the test « ${t.summary} » (${t.id}): title, steps to reproduce, expected, observed, from the step, its note and its screenshots.`,
                        )
                      }
                    />
                  </div>
                </div>
              </Card>
            );
          })
        ) : (
          <p {...stylex.props(type.small, styles.none)}>No NOK step yet.</p>
        )}
      </PanelSection>
      {blocked.length > 0 && (
        <PanelSection title="Blocked" count={blocked.length}>
          {blocked.map((t) => (
            <Card key={t.id} density="compact" onOpen={() => onOpenTest(t.id)} label={`Open ${t.summary}`}>
              <div {...stylex.props(styles.item)}>
                <div {...stylex.props(styles.head)}>
                  <Badge {...RUN_STATUS.blocked} size="sm" />
                  <span {...stylex.props(type.compact, type.medium, styles.test)}>{t.summary}</span>
                </div>
                {t.result.blockedReason && <p {...stylex.props(type.small, styles.note)}>{t.result.blockedReason}</p>}
              </div>
            </Card>
          ))}
        </PanelSection>
      )}
      <PanelSection title="Open questions" count={questions.length}>
        {questions.length ? (
          questions.map(({ t, q }) => (
            <Card key={q.id} density="compact">
              <div {...stylex.props(styles.item)}>
                <div {...stylex.props(styles.head)}>
                  <Badge {...QUESTION.open} size="sm" />
                  <span {...stylex.props(type.small, styles.none)}>
                    {[q.by, `${day(q.at)} ${clock(q.at)}`, q.step && `step ${q.step}`].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <p {...stylex.props(type.compact, styles.test)}>{q.text}</p>
                <span {...stylex.props(type.small, styles.none)}>{t.summary}</span>
                <div {...stylex.props(styles.row)}>
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="arrow-right"
                    label="Open the test"
                    onClick={() => onOpenTest(t.id)}
                  />
                  <Button
                    size="sm"
                    variant="claude-quiet"
                    icon="claude"
                    label="Ask Claude"
                    onClick={() => onAsk(`Answer this question of a tester on « ${t.summary} »: ${q.text}`)}
                  />
                </div>
              </div>
            </Card>
          ))
        ) : (
          <p {...stylex.props(type.small, styles.none)}>No open question.</p>
        )}
      </PanelSection>
    </RunPanel>
  );
}
