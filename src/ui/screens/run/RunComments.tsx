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
  side: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
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

function CommentCard({ c, onSend, onAsk }: { c: Comment; onSend: Send; onAsk?: (q: Comment) => void }) {
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
              {onAsk && (
                <Button size="sm" variant="claude-quiet" icon="claude" label="Ask Claude" onClick={() => onAsk(c)} />
              )}
            </>
          ))}
      </div>
    </Card>
  );
}

// ponytail: what the testers said about the test — a remark or a question first (about the step being played), then
// what was said, newest last; a question stays open until someone answers it
export function RunComments({
  comments,
  steps,
  step: current,
  onSend,
  onAsk,
}: {
  comments: Comment[];
  steps: number;
  /** the step being played: what a new remark is about until another is picked */
  step?: number;
  onSend: Send;
  /** ask Claude about an open question */
  onAsk?: (q: Comment) => void;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"comment" | "question">("comment");
  const [picked, setStep] = useState<string | null>(null);
  const step = picked ?? (current ? String(current) : "test");
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
    <div {...stylex.props(styles.side)}>
      <Text
        multiline
        rows={2}
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
        <span {...stylex.props(styles.spacer)} />
        <Select
          size="sm"
          appearance="quiet"
          label="About"
          icon="target"
          value={step}
          onChange={setStep}
          options={[
            { value: "test", label: "The whole test" },
            ...Array.from({ length: steps }, (_, i) => ({ value: String(i + 1), label: `Step ${i + 1}` })),
          ]}
        />
        <Button size="sm" label="Add" loading={busy} disabled={!text.trim()} onClick={add} />
      </div>
      {comments.map((c) => (
        <CommentCard key={c.id} c={c} onSend={onSend} onAsk={onAsk} />
      ))}
      <p {...stylex.props(type.small, styles.explain)}>
        A question stays open until someone answers it, here or after an import. Claude reads the questions; it never
        answers on its own.
      </p>
    </div>
  );
}
