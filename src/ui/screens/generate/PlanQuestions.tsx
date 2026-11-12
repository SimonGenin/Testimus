import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { RadioGroup } from "../../components/ui/RadioGroup.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import type { Question } from "./planEdits.ts";
import { SkippedRefs } from "./SkippedRefs.tsx";

const styles = stylex.create({
  list: { display: "flex", flexDirection: "column", gap: space.s4 },
  one: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  text: { margin: 0, color: color.text },
  why: { margin: 0, color: color.textMuted },
  settled: { margin: 0, paddingInlineStart: space.s5, display: "flex", flexDirection: "column", gap: space.s2 },
  answer: { color: color.textMuted },
});

const OTHER = "\u0000other";

// ponytail: what Claude asks before writing — each question with why and its passages, a proposed answer to tick or
// the user's own words; an answer goes with « Revise the plan » or « Write », and every run holds to it
export function PlanQuestions({
  questions,
  settled,
  answers,
  disabled,
  onAnswer,
}: {
  questions: Question[];
  settled: { text: string; answer: string }[];
  answers: Record<string, string>;
  disabled?: string;
  onAnswer: (id: string, text: string) => void;
}) {
  const [own, setOwn] = useState<Set<string>>(new Set());
  if (!questions.length && !settled.length) return null;
  const answered = questions.filter((q) => answers[q.id]?.trim()).length;
  return (
    <div {...stylex.props(styles.list)}>
      {questions.length > 0 && (
        <Card
          title={`Questions to settle before writing (${questions.length})`}
          actions={
            <Badge
              size="sm"
              tone={answered === questions.length ? "success" : "neutral"}
              label={`${answered} answered`}
            />
          }
        >
          <div {...stylex.props(styles.list)}>
            {questions.map((q) => {
              const a = answers[q.id] ?? "";
              const proposed = q.answers.includes(a) && !own.has(q.id);
              const value = proposed ? a : own.has(q.id) || a ? OTHER : null;
              return (
                <section key={q.id} aria-label={q.text} {...stylex.props(styles.one)}>
                  <p {...stylex.props(type.body, type.strong, styles.text)}>{q.text}</p>
                  {q.why && <p {...stylex.props(type.compact, styles.why)}>{q.why}</p>}
                  <SkippedRefs lines={q.sources} compact />
                  <RadioGroup
                    label={`Answer to « ${q.text} »`}
                    value={value}
                    disabled={disabled}
                    options={[
                      ...q.answers.map((x) => ({ value: x, label: x })),
                      { value: OTHER, label: "Something else…" },
                    ]}
                    onChange={(v) => {
                      const mine = v === OTHER;
                      setOwn((s) => {
                        const n = new Set(s);
                        if (mine) n.add(q.id);
                        else n.delete(q.id);
                        return n;
                      });
                      onAnswer(q.id, mine ? (proposed ? "" : a) : v);
                    }}
                  />
                  {value === OTHER && (
                    <Text
                      label="Your answer"
                      value={a}
                      readOnly={!!disabled}
                      placeholder="In your words: what the tests should hold to"
                      onChange={(t) => onAnswer(q.id, t)}
                    />
                  )}
                </section>
              );
            })}
          </div>
        </Card>
      )}
      {settled.length > 0 && (
        <Disclosure summary={`Settled (${settled.length})`} quiet>
          <ul {...stylex.props(type.compact, styles.settled)}>
            {settled.map((s) => (
              <li key={s.text}>
                {s.text} <span {...stylex.props(styles.answer)}>→ {s.answer}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}
