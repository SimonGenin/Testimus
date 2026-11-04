import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import type { StepColumn } from "../../../core/types.ts";
import { AdditionalContext } from "../../components/claude/AdditionalContext.tsx";
import { toolLabel } from "../../components/claude/ClaudeDock.tsx";
import { Badge, type BadgeTone } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { execute, type Key } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { border, color, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { useCancel, useJob } from "./jobs.ts";
import { Hint, Stack } from "./Section.tsx";

const styles = stylex.create({
  title: { display: "inline-flex", alignItems: "center", gap: space.s2, color: color.claudeText },
  acts: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  reading: { flex: 1, minWidth: 0, fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
  said: { margin: 0, whiteSpace: "pre-wrap", fontSize: fontSize.body, lineHeight: lineHeight.body },
  list: { display: "flex", flexDirection: "column", gap: space.s4, margin: 0, padding: 0, listStyle: "none" },
  prop: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingTop: space.s4,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  head: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  name: { flex: 1, fontWeight: fontWeight.semibold },
  line: { margin: 0, fontSize: fontSize.compact, lineHeight: lineHeight.compact },
  word: { marginRight: space.s2, fontWeight: fontWeight.medium, color: color.textMuted },
  empty: { fontStyle: "italic", color: color.textMuted },
});

type Suggested = CommandOutput<"columns.suggest">;
type Proposal = Suggested["proposals"][number];

const said = (summary: string) => summary.replace(/```[\s\S]*?(```|$)/g, "").trim();

function tagOf(p: Proposal): { label: string; tone: BadgeTone } {
  if (p.kind === "new") return { label: "New local column", tone: "warning" };
  if (p.kind === "local") return { label: "Local only", tone: "neutral" };
  return { label: p.builtin ? "Xray · standard" : "Xray", tone: "neutral" };
}

const draft = (f: string): Key => [project(), "settings.columns.claude", { f }];

function Asking({ jobId, onAnswer }: { jobId: string; onAnswer: (r: Suggested | null) => void }) {
  const cancel = useCancel();
  const [reading, setReading] = useState("Claude is reading the columns, the tests and the documents…");
  useJob(
    jobId,
    (job) => {
      if (job.status === "done") onAnswer(job.result as Suggested);
      else {
        if (job.status === "failed")
          errorToast(new Error(job.error ?? "The run failed."), "Claude could not look at the columns");
        onAnswer(null);
      }
    },
    (e) => {
      if (e.type === "claude" && e.event.type === "tool") setReading(toolLabel(e.event.name, e.event.input));
    },
  );
  return (
    <div {...stylex.props(styles.acts)}>
      <span role="status" {...stylex.props(styles.reading)}>
        {reading}
      </span>
      <Button size="sm" variant="quiet" label="Cancel" onClick={() => cancel(jobId)} />
    </div>
  );
}

// ponytail: Claude proposes, nothing changes until a proposal is applied (columns.save, one per column)
export function ColumnsClaude({ columns }: { columns: StepColumn[] }) {
  const client = useQueryClient();
  const [ask, setAsk] = useDraft(draft("ask"));
  const [picked, setPicked] = useDraft(draft("contexts"), "[]");
  const ids = JSON.parse(picked) as string[];
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ text: string; proposals: Proposal[] } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const suggest = async () => {
    setStarting(true);
    setAnswer(null);
    try {
      const r = await execute(client, "columns.suggest", { ask: ask.trim(), contexts: ids }, { invalidates: "none" });
      setJobId(r.jobId);
    } catch (e) {
      errorToast(e, "Claude could not look at the columns");
    } finally {
      setStarting(false);
    }
  };

  const answered = (r: Suggested | null) => {
    setJobId(null);
    if (!r) return;
    setAnswer({
      text: r.ok ? said(r.summary) : r.diagnosis?.detail || said(r.summary) || "Claude gave no proposal.",
      proposals: r.proposals,
    });
  };

  const drop = (names: string[]) =>
    setAnswer((a) => a && { ...a, proposals: a.proposals.filter((p) => !names.includes(p.name)) });

  const apply = async (list: Proposal[]) => {
    setSaving(list.length === 1 ? list[0].name : "*");
    const done: string[] = [];
    try {
      for (const p of list) {
        await execute(
          client,
          "columns.save",
          { name: p.name, description: p.description },
          {
            invalidates: [["project.info"], ["columns.list"]],
          },
        );
        done.push(p.name);
      }
      toast({
        kind: "ok",
        title:
          list.length === 1
            ? `${list[0].name}: ${list[0].kind === "new" ? "added" : "described"}`
            : `${plural(done.length, "column")} updated`,
      });
    } catch (e) {
      errorToast(e, "Could not save the column");
    } finally {
      drop(done);
      setSaving(null);
    }
  };

  const proposals = (answer?.proposals ?? []).filter(
    (p) => p.kind === "new" || columns.some((c) => c.name === p.name && c.description !== p.description),
  );
  const asking = starting || !!jobId;

  return (
    <Card
      title={
        <span {...stylex.props(styles.title)}>
          <Icon name="claude" />
          Ask Claude about the columns
        </span>
      }
    >
      <Stack>
        <Hint>
          Claude reads the columns, Xray's step fields, the tests, the documents and the contexts, and proposes what
          each column should hold. Nothing changes until you apply a proposal.
        </Hint>
        <AdditionalContext
          id="colclaude-ask"
          of="the columns"
          placeholder="What the columns should hold, in your words — e.g. « each step should say which operator position it uses ». Empty: review them all."
          ids={ids}
          note={ask}
          disabled={asking}
          onIds={(next) => setPicked(JSON.stringify(next))}
          onNote={setAsk}
        />
        <div {...stylex.props(styles.acts)}>
          <Button
            variant="claude"
            size="sm"
            icon="claude"
            label={asking ? "Claude is looking…" : answer ? "Ask again" : "Ask Claude"}
            disabled={asking}
            onClick={() => void suggest()}
          />
        </div>
        {jobId && <Asking jobId={jobId} onAnswer={answered} />}
        {answer && (
          <Stack>
            {answer.text && <p {...stylex.props(styles.said)}>{answer.text}</p>}
            {proposals.length > 1 && (
              <div {...stylex.props(styles.acts)}>
                <Button
                  size="sm"
                  icon="check"
                  label={saving === "*" ? "Applying…" : `Apply all ${proposals.length}`}
                  disabled={!!saving}
                  onClick={() => void apply(proposals)}
                />
                <Button size="sm" variant="quiet" label="Dismiss" disabled={!!saving} onClick={() => setAnswer(null)} />
              </div>
            )}
            {proposals.length > 0 ? (
              <ul aria-label="Claude's proposals" {...stylex.props(styles.list)}>
                {proposals.map((p) => {
                  const tag = tagOf(p);
                  return (
                    <li key={p.name} aria-label={p.name} {...stylex.props(styles.prop)}>
                      <div {...stylex.props(styles.head)}>
                        <span {...stylex.props(styles.name)}>{p.name}</span>
                        <Badge label={tag.label} tone={tag.tone} size="sm" />
                        <Button
                          size="sm"
                          variant="primary"
                          icon="check"
                          label={saving === p.name ? "Applying…" : p.kind === "new" ? "Add the column" : "Apply"}
                          disabled={!!saving}
                          onClick={() => void apply([p])}
                        />
                        <Button
                          size="sm"
                          variant="quiet"
                          label="Dismiss"
                          disabled={!!saving}
                          onClick={() => drop([p.name])}
                        />
                      </div>
                      {p.current !== null && (
                        <p {...stylex.props(styles.line)}>
                          <span {...stylex.props(styles.word)}>Today</span>
                          {p.current || <span {...stylex.props(styles.empty)}>empty — Claude never fills it</span>}
                        </p>
                      )}
                      <p {...stylex.props(styles.line)}>
                        <span {...stylex.props(styles.word)}>Proposed</span>
                        {p.description || <span {...stylex.props(styles.empty)}>empty — Claude stops filling it</span>}
                      </p>
                      {p.why && <Hint>{p.why}</Hint>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              answer.proposals.length === 0 && <Hint>No change proposed.</Hint>
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
