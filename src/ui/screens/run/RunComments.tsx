import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Badge, QUESTION } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { clock, type RunResult } from "./runs.ts";

const styles = stylex.create({
  side: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    padding: space.s6,
    minHeight: 0,
    overflowY: "auto",
  },
  title: { margin: 0 },
  body: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s2 },
  meta: { color: color.textMuted },
  text: { margin: 0, whiteSpace: "pre-wrap" },
  answer: { margin: 0, paddingInlineStart: space.s4, whiteSpace: "pre-wrap", color: color.textMuted },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  spacer: { flex: 1 },
  explain: { margin: 0, color: color.textSubtle },
});

type Comment = RunResult["comments"][number];
type Send = (c: { text: string; kind: "comment" | "question"; step?: number; answers?: string }) => Promise<void>;

function Answer({ q, onSend }: { q: Comment; onSend: Send }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) return <Button size="sm" variant="quiet" label="Answer" onClick={() => setOpen(true)} />;
  return (
    <>
      <Text multiline rows={2} ariaLabel="Answer" value={text} onChange={setText} autoFocus />
      <div {...stylex.props(styles.row)}>
        <Button size="sm" variant="quiet" label="Cancel" onClick={() => setOpen(false)} />
        <Button
          size="sm"
          label="Send the answer"
          disabled={!text.trim()}
          onClick={() => onSend({ text, kind: "question", answers: q.id }).then(() => setOpen(false))}
        />
      </div>
    </>
  );
}

function CommentCard({ c, onSend }: { c: Comment; onSend: Send }) {
  const what = [c.kind === "question" ? "Question" : "Comment", c.step && `step ${c.step}`, c.by, clock(c.at)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card density="compact">
      <div {...stylex.props(styles.body)}>
        <span {...stylex.props(type.small, styles.meta)}>{what}</span>
        <p {...stylex.props(type.body, styles.text)}>{c.text}</p>
        {c.answer && (
          <p {...stylex.props(type.body, styles.answer)}>
            {c.answer}
            <span {...stylex.props(type.small, styles.meta)}> — {c.answeredBy}</span>
          </p>
        )}
        {c.kind === "question" &&
          (c.answer ? (
            <Badge {...QUESTION.answered} size="sm" />
          ) : (
            <>
              <Badge {...QUESTION.open} size="sm" />
              <Answer q={c} onSend={onSend} />
            </>
          ))}
      </div>
    </Card>
  );
}

// ponytail: what the testers said about the test — remarks and questions, newest last; a question stays open until
// someone answers it
export function RunComments({ comments, steps, onSend }: { comments: Comment[]; steps: number; onSend: Send }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"comment" | "question">("comment");
  const [step, setStep] = useState("test");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await onSend({ text, kind, ...(step !== "test" ? { step: Number(step) } : {}) });
      setText("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside aria-label="Comments and questions" {...stylex.props(styles.side)}>
      <h3 {...stylex.props(type.titleSm, styles.title)}>Comments and questions</h3>
      {comments.map((c) => (
        <CommentCard key={c.id} c={c} onSend={onSend} />
      ))}
      <Text
        multiline
        rows={3}
        ariaLabel="Add a comment or a question"
        placeholder="Add a comment or a question…"
        value={text}
        onChange={setText}
      />
      <div {...stylex.props(styles.row)}>
        <Segmented
          size="sm"
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "comment", label: "Comment" },
            { value: "question", label: "Question" },
          ]}
        />
        <Select
          size="sm"
          appearance="quiet"
          label="About"
          value={step}
          onChange={setStep}
          options={[
            { value: "test", label: "The whole test" },
            ...Array.from({ length: steps }, (_, i) => ({ value: String(i + 1), label: `Step ${i + 1}` })),
          ]}
        />
        <span {...stylex.props(styles.spacer)} />
        <Button size="sm" label="Add" loading={busy} disabled={!text.trim()} onClick={add} />
      </div>
      <p {...stylex.props(type.small, styles.explain)}>
        A question stays open until someone answers it, here or after an import. Claude reads the questions; it never
        answers on its own.
      </p>
    </aside>
  );
}
