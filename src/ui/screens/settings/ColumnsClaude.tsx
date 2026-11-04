import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import type { StepColumn } from "../../../core/types.ts";
import { toolLabel } from "../../components/claude/ClaudeDock.tsx";
import { ContextsDialog } from "../../components/claude/ContextsDialog.tsx";
import { DiagnosisText } from "../../components/claude/DiagnosisText.tsx";
import { SaveContext } from "../../components/claude/SaveContext.tsx";
import { Answer } from "../../components/ui/Answer.tsx";
import { Badge, COLUMN, type Word } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import { Facts } from "../../components/ui/Facts.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Menu, type MenuEntry } from "../../components/ui/Menu.tsx";
import { type } from "../../components/ui/type.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { execute, type Key, useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { useCancel, useJob } from "./jobs.ts";
import { Hint, Stack } from "./Section.tsx";

const styles = stylex.create({
  title: { display: "inline-flex", alignItems: "center", gap: space.s2, color: color.claudeText },
  acts: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
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

const said = (summary: string) => summary.replace(/```[\s\S]*?(```|$)/g, "").trim();

function tagOf(p: Proposal): Word {
  if (p.kind === "new") return COLUMN["new-local"];
  if (p.kind === "local") return COLUMN.local;
  return p.builtin ? COLUMN.standard : COLUMN.xray;
}

const draft = (f: string): Key => [project(), "settings.columns.claude", { f }];

function Asking({ jobId, onAnswer }: { jobId: string; onAnswer: (r: Suggested | null) => void }) {
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
    <span role="status" {...stylex.props(type.small, styles.reading)}>
      {reading}
    </span>
  );
}

// ponytail: Claude proposes, nothing changes until a proposal is applied (columns.save, one per column)
export function ColumnsClaude({ columns }: { columns: StepColumn[] }) {
  const client = useQueryClient();
  const cancel = useCancel();
  const list = useRead("contexts.list", {});
  const all = list.data ?? [];
  const [ask, setAsk] = useDraft(draft("ask"));
  const [picked, setPicked] = useDraft(draft("contexts"), "[]");
  const ids = JSON.parse(picked) as string[];
  const setIds = (next: string[]) => setPicked(JSON.stringify(next));
  const [dialog, setDialog] = useState<"save" | "manage" | null>(null);
  const [starting, setStarting] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ text: string; proposals: Proposal[] } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const asking = starting || !!jobId;
  const now = useNow(1000, asking);
  const name = (id: string) => all.find((c) => c.id === id)?.name ?? id;
  const add: MenuEntry[] = [
    ...all
      .filter((c) => !ids.includes(c.id))
      .map((c) => ({ label: c.name, icon: "context" as const, onSelect: () => setIds([...ids, c.id]) })),
    ...(all.some((c) => !ids.includes(c.id)) ? (["separator"] as MenuEntry[]) : []),
    { label: "Manage contexts…", onSelect: () => setDialog("manage") },
  ];

  const suggest = async () => {
    setStarting(true);
    setStartedAt(Date.now());
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
            Ask Claude about the columns
          </span>
        }
      >
        <Stack>
          <p {...stylex.props(type.compact, styles.intro)}>
            Claude reads the columns, Xray's step fields, the tests, the documents and the contexts, and proposes what
            each column should hold. Nothing changes until you apply a proposal.
          </p>
          <ClaudeBlock
            id="colclaude-ask"
            ariaLabel="What the columns should hold"
            placeholder="What the columns should hold, in your words — e.g. « each step should say which operator position it uses ». Empty: review them all."
            value={ask}
            onChange={setAsk}
            allowEmpty
            submitLabel={answer ? "Ask again" : "Ask Claude"}
            onSubmit={() => void suggest()}
            running={asking ? Math.max(0, (now - startedAt) / 1000) : null}
            onCancel={jobId ? () => cancel(jobId) : undefined}
            contexts={ids.map((x) => ({ id: x, label: name(x), on: true }))}
            onContext={(x, on) => {
              if (!on) setIds(ids.filter((y) => y !== x));
            }}
            addContext={
              <Menu
                label="Add context"
                entries={add}
                trigger={
                  <Button size="sm" variant="quiet" icon="plus" iconOnly label="Add context" disabled={asking} />
                }
              />
            }
          />
          <div {...stylex.props(styles.acts)}>
            <Button
              size="sm"
              variant="quiet"
              icon="context"
              label="Save the request as a context…"
              disabled={asking ? true : !ask.trim() ? "Write a request first" : false}
              onClick={() => setDialog("save")}
            />
          </div>
          {jobId && <Asking jobId={jobId} onAnswer={answered} />}
        </Stack>
      </Card>
      {dialog === "save" && (
        <SaveContext
          note={ask}
          onSaved={(id) => {
            setIds([...ids, id]);
            setAsk("");
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "manage" && <ContextsDialog onClose={() => setDialog(null)} />}
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
