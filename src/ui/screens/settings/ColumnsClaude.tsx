import { useState } from "react";
import type { StepColumn } from "../../../core/types.ts";
import { call, run } from "../../api.ts";
import { AdditionalContext } from "../../components/claude/AdditionalContext.tsx";
import { toolLabel } from "../../components/claude/ClaudeDock.tsx";
import { Button, Icon } from "../../components/legacy/index.ts";
import { useApp } from "../../lib/app.ts";
import { useDraft } from "../../lib/drafts.ts";
import { cx, plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";

type Proposal = {
  name: string;
  kind: "xray" | "local" | "new";
  builtin: boolean;
  current: string | null;
  description: string;
  why: string;
};
type Suggested = { ok: boolean; proposals: Proposal[]; summary: string; diagnosis?: { detail: string } };

const said = (summary: string) => summary.replace(/```[\s\S]*?(```|$)/g, "").trim();

function tagOf(p: Proposal): { label: string; tone: string } {
  if (p.kind === "new") return { label: "New local column", tone: "warn" };
  if (p.kind === "local") return { label: "Local only", tone: "warn" };
  return { label: p.builtin ? "Xray · standard" : "Xray", tone: "info" };
}

export function ColumnsClaude({ columns }: { columns: StepColumn[] }) {
  const app = useApp();
  const [ask, setAsk] = useDraft("settings.columns.claude.ask", "");
  const [ids, setIds] = useDraft<string[]>("settings.columns.claude.contexts", []);
  const [asking, setAsking] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [reading, setReading] = useState("");
  const [answer, setAnswer] = useState<{ text: string; proposals: Proposal[] } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const suggest = async () => {
    setAsking(true);
    setAnswer(null);
    setReading("Claude is reading the columns, the tests and the documents…");
    try {
      const r = await run<Suggested>(
        "columns.suggest",
        { ask: ask.trim(), contexts: ids },
        (e) => {
          if (e.type === "claude" && e.event.type === "tool") setReading(toolLabel(e.event.name, e.event.input));
        },
        setJobId,
      );
      setAnswer({
        text: r.ok ? said(r.summary) : r.diagnosis?.detail || said(r.summary) || "Claude gave no proposal.",
        proposals: r.proposals,
      });
    } catch (e) {
      errorToast(e, "Claude could not look at the columns");
    } finally {
      setAsking(false);
      setJobId(null);
      setReading("");
    }
  };

  const cancel = () => jobId && call("jobs.cancel", { id: jobId }).catch((e) => errorToast(e, "Could not cancel"));

  const drop = (names: string[]) =>
    setAnswer((a) => a && { ...a, proposals: a.proposals.filter((p) => !names.includes(p.name)) });

  const apply = async (list: Proposal[]) => {
    setSaving(list.length === 1 ? list[0].name : "*");
    const done: string[] = [];
    try {
      for (const p of list) {
        await call("columns.save", { name: p.name, description: p.description });
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
      app.refreshInfo();
      setSaving(null);
    }
  };

  const proposals = (answer?.proposals ?? []).filter(
    (p) => p.kind === "new" || columns.some((c) => c.name === p.name && c.description !== p.description),
  );

  return (
    <section className="colclaude" aria-label="Ask Claude about the columns">
      <div className="colclaude-head">
        <Icon name="claude" />
        <span className="h colclaude-title">Ask Claude</span>
        <span className="muted">
          Claude reads the columns, Xray's step fields, the tests, the documents and the contexts, and proposes what
          each column should hold. Nothing changes until you apply a proposal.
        </span>
      </div>
      <AdditionalContext
        id="colclaude-ask"
        of="the columns"
        placeholder="What the columns should hold, in your words — e.g. « each step should say which operator position it uses ». Empty: review them all."
        ids={ids}
        note={ask}
        disabled={asking}
        onIds={setIds}
        onNote={setAsk}
      />
      <div className="colclaude-acts">
        <Button tone="primary" size="sm" icon="claude" disabled={asking} onClick={() => void suggest()}>
          {asking ? "Claude is looking…" : answer ? "Ask again" : "Ask Claude"}
        </Button>
        {asking && (
          <>
            <span className="muted colclaude-reading" role="status">
              {reading}
            </span>
            <Button tone="quiet" size="sm" disabled={!jobId} onClick={() => void cancel()}>
              Cancel
            </Button>
          </>
        )}
      </div>
      {answer && (
        <div className="colclaude-answer">
          {answer.text && <p className="colclaude-said">{answer.text}</p>}
          {proposals.length > 1 && (
            <div className="colclaude-acts">
              <Button size="sm" icon="check" disabled={!!saving} onClick={() => void apply(proposals)}>
                {saving === "*" ? "Applying…" : `Apply all ${proposals.length}`}
              </Button>
              <Button size="sm" tone="quiet" disabled={!!saving} onClick={() => setAnswer(null)}>
                Dismiss
              </Button>
            </div>
          )}
          {proposals.length > 0 ? (
            <ul className="colclaude-list" aria-label="Claude's proposals">
              {proposals.map((p) => {
                const tag = tagOf(p);
                return (
                  <li key={p.name} className="colclaude-prop">
                    <div className="colrow-head">
                      <span className="colrow-name">{p.name}</span>
                      <span className={cx("tagpill", `tagpill-${tag.tone}`)}>{tag.label}</span>
                      <span className="spacer" />
                      <Button size="sm" tone="primary" icon="check" disabled={!!saving} onClick={() => void apply([p])}>
                        {saving === p.name ? "Applying…" : p.kind === "new" ? "Add the column" : "Apply"}
                      </Button>
                      <Button size="sm" tone="quiet" disabled={!!saving} onClick={() => drop([p.name])}>
                        Dismiss
                      </Button>
                    </div>
                    {p.current !== null && (
                      <p className="colclaude-was">
                        <span className="label">Today</span> {p.current || <em>empty — Claude never fills it</em>}
                      </p>
                    )}
                    <p className="colclaude-now">
                      <span className="label">Proposed</span>{" "}
                      {p.description || <em>empty — Claude stops filling it</em>}
                    </p>
                    {p.why && <p className="muted colclaude-why">{p.why}</p>}
                  </li>
                );
              })}
            </ul>
          ) : (
            answer.proposals.length === 0 && <p className="muted">No change proposed.</p>
          )}
        </div>
      )}
    </section>
  );
}
