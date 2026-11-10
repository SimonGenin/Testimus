import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import type { JobEvent, StepColumn } from "../../../core/types.ts";
import { toolLabel } from "../../components/claude/ClaudeDock.tsx";
import { DiagnosisText } from "../../components/claude/DiagnosisText.tsx";
import { claudeSaid, noteRun, useClaudeStatus } from "../../components/claude/useClaudeStatus.ts";
import { useRunContext } from "../../components/claude/useRunContext.tsx";
import { Answer } from "../../components/ui/Answer.tsx";
import { Badge, COLUMN, type Word } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import { Facts } from "../../components/ui/Facts.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { execute, type Key, useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { useCancel, useJob, useRunning } from "./jobs.ts";
import { Hint, Stack } from "./Section.tsx";

const styles = stylex.create({
  title: { display: "inline-flex", alignItems: "center", gap: space.s2, color: color.claudeText },
  reading: { flex: 1, minWidth: 0, color: color.textMuted },
  intro: { margin: 0, color: color.textMuted },
  said: { margin: 0, whiteSpace: "pre-wrap" },
  list: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none" },
  prop: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    paddingBottom: space.s4,
    paddingTop: { default: space.s4, ":first-child": space.s2 },
    borderTopStyle: "solid",
    borderTopWidth: { default: border.width, ":first-child": 0 },
    borderTopColor: color.border,
  },
  head: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  btns: { display: "flex", gap: space.s2, marginInlineStart: "auto" },
  today: { color: color.textMuted, textDecorationColor: color.textSubtle },
  empty: { color: color.textMuted },
  why: { display: "flex", gap: space.s2, color: color.textMuted },
});

type Suggested = CommandOutput<"columns.suggest">;
type Proposal = Suggested["proposals"][number];

const reply = (summary: string) => summary.replace(/```[\s\S]*?(```|$)/g, "").trim();

function tagOf(p: Proposal): Word {
  if (p.kind === "new") return COLUMN["new-local"];
  if (p.kind === "local") return COLUMN.local;
  return p.builtin ? COLUMN.standard : COLUMN.xray;
}

const draft = (f: string): Key => [project(), "settings.columns.claude", { f }];

type Answered = { text: string; proposals: Proposal[] };

const READING = "Claude is reading the columns, the tests and the documents…";

// ponytail: Claude proposes, nothing changes until a proposal is applied (columns.save, one per column); the run and
// its answer are kept for the page (a paid run), so leaving the section and coming back finds them — a run still going
// is found again in jobs.list, one that ended meanwhile is read from jobs.show
export function ColumnsClaude({ columns }: { columns: StepColumn[] }) {
  const app = useApp();
  const client = useQueryClient();
  const cancel = useCancel();
  const { status } = useClaudeStatus();
  const offline = !!status && (!status.installed || status.signedIn === false);
  const [ask, setAsk] = useDraft(draft("ask"));
  // ponytail: what was ticked for the run is kept with the question, like the run and its answer
  const given = useRunContext({
    use: "columns",
    scope: { kind: "project" },
    note: ask,
    draftKey: draft("context"),
    onSaved: () => setAsk(""),
    enabled: !!app.info,
  });
  const [starting, setStarting] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [kept, setJob, clearJob] = useDraft(draft("job"));
  const [said, setSaid, clearSaid] = useDraft(draft("answer"));
  const answer = said ? (JSON.parse(said) as Answered) : null;
  const setAnswer = (next: Answered | null) => (next ? setSaid(JSON.stringify(next)) : clearSaid());
  const [saving, setSaving] = useState<string | null>(null);
  const [reading, setReading] = useState(READING);
  const ended = useRef(new Set<string>());
  const found = useRunning("columns", !!app.info);
  const jobId = kept || (found && !ended.current.has(found.id) ? found.id : null);
  const shown = useRead("jobs.show", { id: jobId ?? "" }, { enabled: !!jobId });
  const { job } = useJob(
    jobId,
    (j) => {
      ended.current.add(j.id);
      clearJob();
      setReading(READING);
      const r = j.result as Suggested | undefined;
      noteRun(client, {
        ok: j.status === "done" && !!r?.ok,
        diagnosis: r?.diagnosis,
        said: claudeSaid((shown.data?.events ?? []) as JobEvent[]),
      });
      if (j.status === "done" && r) answered(r);
      else if (j.status === "failed")
        errorToast(new Error(j.error ?? "The run failed."), "Claude could not look at the columns");
    },
    (e) => {
      if (e.type === "claude" && e.event.type === "tool") setReading(toolLabel(e.event.name, e.event.input));
    },
  );
  const asking = starting || !!jobId;
  const since = job?.startedAt && !Number.isNaN(Date.parse(job.startedAt)) ? Date.parse(job.startedAt) : startedAt;
  const now = useNow(1000, asking);

  const suggest = async () => {
    setStarting(true);
    setStartedAt(Date.now());
    setAnswer(null);
    try {
      const r = await execute(
        client,
        "columns.suggest",
        { ask: ask.trim(), ...given.run },
        { invalidates: [["jobs.list"]] },
      );
      setJob(r.jobId);
    } catch (e) {
      errorToast(e, "Claude could not look at the columns");
    } finally {
      setStarting(false);
    }
  };

  function answered(r: Suggested) {
    setAnswer({
      text: r.ok ? reply(r.summary) : r.diagnosis?.detail || reply(r.summary) || "Claude gave no proposal.",
      proposals: r.proposals,
    });
  }

  const drop = (names: string[]) =>
    answer && setAnswer({ ...answer, proposals: answer.proposals.filter((p) => !names.includes(p.name)) });

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
        tone: "success",
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

  return (
    <>
      <Card
        title={
          <span {...stylex.props(styles.title)}>
            <Icon name="claude" />
            Ask Claude to review the columns
          </span>
        }
      >
        <Stack>
          <p {...stylex.props(type.compact, styles.intro)}>
            Claude reads the columns, Xray's step fields, the tests and the documents, then proposes what each column
            should hold. Nothing changes until you apply a proposal.
          </p>
          <ClaudeBlock
            id="colclaude-ask"
            ariaLabel="What the columns should hold"
            placeholder="What the columns should hold, in your words, e.g. each step should say which operator position it uses. Empty: review them all."
            value={ask}
            onChange={setAsk}
            allowEmpty
            submitLabel={answer ? "Ask again" : "Ask Claude"}
            onSubmit={() => void suggest()}
            running={asking ? Math.max(0, (now - since) / 1000) : null}
            onCancel={jobId ? () => cancel(jobId) : undefined}
            unavailable={
              offline ? (status?.installed ? "Claude is not signed in" : "Claude is not connected") : undefined
            }
            context={given.context}
          />
          {given.dialog}
          {jobId && (
            <span role="status" {...stylex.props(type.small, styles.reading)}>
              {reading}
            </span>
          )}
        </Stack>
      </Card>
      {answer && (
        <Answer
          title="Claude's proposals"
          footer={
            proposals.length > 1 && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  icon="check"
                  label={saving === "*" ? "Applying…" : `Apply all ${proposals.length}`}
                  disabled={!!saving}
                  onClick={() => void apply(proposals)}
                />
                <Button
                  size="sm"
                  variant="quiet"
                  label="Dismiss all"
                  disabled={!!saving}
                  onClick={() => setAnswer(null)}
                />
              </>
            )
          }
        >
          {answer.text && (
            <p {...stylex.props(styles.said)}>
              <DiagnosisText text={answer.text} />
            </p>
          )}
          {proposals.length > 0 ? (
            <ul aria-label="Claude's proposals" {...stylex.props(styles.list)}>
              {proposals.map((p) => (
                <li key={p.name} aria-label={p.name} {...stylex.props(styles.prop)}>
                  <div {...stylex.props(styles.head)}>
                    <span {...stylex.props(type.titleSm)}>{p.name}</span>
                    <Badge {...tagOf(p)} size="sm" />
                    <span {...stylex.props(styles.btns)}>
                      <Button
                        size="sm"
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
                    </span>
                  </div>
                  <Facts
                    items={[
                      p.current !== null && {
                        label: "Today",
                        value: p.current ? (
                          <del {...stylex.props(styles.today)}>{p.current}</del>
                        ) : (
                          <span {...stylex.props(styles.empty)}>empty — Claude never fills it</span>
                        ),
                      },
                      {
                        label: "Proposed",
                        value: p.description || (
                          <span {...stylex.props(styles.empty)}>empty — Claude stops filling it</span>
                        ),
                      },
                    ]}
                  />
                  {p.why && (
                    <span {...stylex.props(type.small, styles.why)}>
                      <Icon name="quote" size="sm" />
                      <span>{p.why}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            answer.proposals.length === 0 && <Hint>No change proposed.</Hint>
          )}
        </Answer>
      )}
    </>
  );
}
