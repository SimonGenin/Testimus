import { useEffect, useMemo, useState } from "react";
import type { TraceScan, TraceView, XrayJson } from "../../../core/types.ts";
import { call, run } from "../../api.ts";
import { useApp } from "../../lib/app.ts";
import { plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { toolLabel } from "../claude/ClaudeDock.tsx";
import { Button, Chip, Modal, Severity, Skeleton } from "../ui/index.ts";

type Proposal = { label: string; patterns: string[]; field: string; why: string };
type Proposed = { ok: boolean; proposal: Proposal | null; summary: string; diagnosis?: { detail: string } };

const EXAMPLES = ["Les exigences (EXI_…)", "Les codes d'alarme", "Les cas d'utilisation", "Les numéros de figure"];

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

function badPattern(patterns: string[]): string | null {
  for (const p of patterns)
    try {
      if (new RegExp(p).test("")) return `${p} matches empty text`;
    } catch (e) {
      return `${p}: ${(e as Error).message}`;
    }
  return null;
}

export function TrackDialog({ initial, onClose }: { initial?: TraceView; onClose: () => void }) {
  const app = useApp();
  const [ask, setAsk] = useState(initial?.ask ?? "");
  const [asking, setAsking] = useState(false);
  const [reading, setReading] = useState("");
  const [why, setWhy] = useState("");
  const [shown, setShown] = useState(!!initial);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [patterns, setPatterns] = useState(initial?.patterns.join("\n") ?? "");
  const [field, setField] = useState(initial?.field ?? "");
  const [scan, setScan] = useState<TraceScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const list = useMemo(() => lines(patterns), [patterns]);
  const bad = list.length ? badPattern(list) : null;
  const custom = app.xray.fields.filter((f) => !f.builtin).map((f) => f.name);
  const inXray = app.xray.fields.some((f) => f.name === field.trim());
  const taken = (app.info?.traces ?? []).find(
    (t) => t.id !== initial?.id && t.field.trim().toLowerCase() === field.trim().toLowerCase(),
  );

  const key = list.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the patterns are compared by their joined text
  useEffect(() => {
    if (!list.length || bad) {
      setScan(null);
      return;
    }
    setScanning(true);
    const t = setTimeout(() => {
      call<TraceScan>("traces.find", { patterns: list, limit: 12 })
        .then(setScan)
        .catch(() => setScan(null))
        .finally(() => setScanning(false));
    }, 300);
    return () => clearTimeout(t);
  }, [key, bad]);

  const propose = async () => {
    if (!ask.trim()) return;
    setAsking(true);
    setReading("Claude is reading the documents…");
    try {
      const r = await run<Proposed>("traces.propose", { ask: ask.trim() }, (e) => {
        if (e.type === "claude" && e.event.type === "tool") setReading(toolLabel(e.event.name, e.event.input));
      });
      if (!r.ok || !r.proposal) {
        setWhy(r.diagnosis?.detail || "Claude gave no proposal: write the pattern yourself below.");
        setShown(true);
        return;
      }
      setWhy(r.proposal.why);
      setShown(true);
      if (!r.proposal.patterns.length) return;
      setLabel(r.proposal.label);
      setPatterns(r.proposal.patterns.join("\n"));
      setField(r.proposal.field || r.proposal.label);
    } catch (e) {
      errorToast(e, "Claude could not look at the documents");
    } finally {
      setAsking(false);
      setReading("");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await call("traces.save", {
        ...(initial ? { id: initial.id } : {}),
        label: label.trim(),
        patterns: list,
        field: field.trim(),
        ...(ask.trim() ? { ask: ask.trim() } : {}),
      });
      app.refreshInfo();
      toast({
        kind: "ok",
        title: `${label.trim()} ids tracked`,
        detail: `Steps now have a « ${field.trim()} » column.`,
      });
      onClose();
    } catch (e) {
      errorToast(e, "Could not track these ids");
    } finally {
      setSaving(false);
    }
  };

  const recheck = async () => {
    setRefreshing(true);
    try {
      await call<XrayJson>("xray.fields", {});
      app.refreshInfo();
    } catch (e) {
      errorToast(e, "Could not read the step fields from Jira");
    } finally {
      setRefreshing(false);
    }
  };

  const ready = !!label.trim() && !!field.trim() && list.length > 0 && !bad && !taken;

  return (
    <Modal
      label={initial ? `Change the tracked ${initial.label} ids` : "Track ids from the documents"}
      title={initial ? `${initial.label} ids` : "Track ids from the documents"}
      subtitle="Ids written in the specifications — requirements, alarm codes, use cases… — become a column of every test step, that the generation fills and Xray receives."
      width={760}
      className="track"
      onClose={onClose}
      foot={
        <>
          <span className="spacer" />
          <Button tone="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button tone="primary" icon="check" disabled={!ready || saving} onClick={() => void save()}>
            {saving ? "Saving…" : initial ? "Save" : "Track these ids"}
          </Button>
        </>
      }
    >
      <div className="track-ask">
        <label className="h track-q" htmlFor="track-ask">
          What should Testimus pick out of the documents?
        </label>
        <div className="track-ask-row">
          <textarea
            id="track-ask"
            className="field"
            rows={2}
            placeholder="In your own words, e.g. « les codes d'alarme ALM-… du chapitre 7 »"
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void propose();
            }}
          />
          <Button
            tone={shown ? "secondary" : "primary"}
            icon="claude"
            disabled={!ask.trim() || asking}
            onClick={() => void propose()}
          >
            {asking ? "Looking…" : "Ask Claude"}
          </Button>
        </div>
        <div className="chips track-examples">
          {EXAMPLES.map((x) => (
            <Chip key={x} small onClick={() => setAsk(x)}>
              {x}
            </Chip>
          ))}
          {!shown && (
            <Button tone="quiet" size="sm" onClick={() => setShown(true)}>
              I know the pattern
            </Button>
          )}
        </div>
        {asking && (
          <p className="track-reading muted" role="status">
            <span className="dot run-dot" /> {reading}
          </p>
        )}
      </div>

      {shown && (
        <section className="track-card" aria-label="What will be tracked">
          {why && <p className="track-why">{why}</p>}
          <div className="track-form">
            <label className="label" htmlFor="track-label">
              Name of one id
            </label>
            <input
              id="track-label"
              className="field"
              placeholder="Exigence, Code alarme…"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <label className="label" htmlFor="track-patterns">
              Pattern <span className="muted">— a regular expression per line</span>
            </label>
            <textarea
              id="track-patterns"
              className="field mono"
              rows={Math.max(1, list.length)}
              placeholder="\bALM-\d{3}\b"
              value={patterns}
              onChange={(e) => setPatterns(e.target.value)}
            />
            {bad && <Severity tone="error">{bad}</Severity>}
            <label className="label" htmlFor="track-field">
              Xray step column
            </label>
            <input
              id="track-field"
              className="field"
              list="track-columns"
              placeholder="The custom step field that will hold them"
              value={field}
              onChange={(e) => setField(e.target.value)}
            />
            <datalist id="track-columns">
              {custom.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {taken && <Severity tone="error">{`« ${taken.field} » already holds the ${taken.label} ids.`}</Severity>}
          </div>

          <div className="track-preview" aria-live="polite">
            <span className="label">Found in the documents</span>
            {!list.length || bad ? (
              <p className="muted">Write a pattern to see what it finds.</p>
            ) : !scan ? (
              <Skeleton w={220} h={14} />
            ) : scan.distinct === 0 ? (
              <Severity tone="warning">Nothing matches in the documents</Severity>
            ) : (
              <>
                <p className="track-count">
                  <strong>{plural(scan.distinct, "id")}</strong> in {plural(scan.docs.length, "document")}
                  {scanning && <span className="muted"> · updating…</span>}
                </p>
                <ul className="track-docs">
                  {scan.docs.map((d) => (
                    <li key={d.doc}>
                      <span className="mono">{d.doc}</span>
                      <span className="track-bar" aria-hidden="true">
                        <span style={{ width: `${(100 * d.distinct) / scan.distinct}%` }} />
                      </span>
                      <span className="muted">{d.distinct}</span>
                    </li>
                  ))}
                </ul>
                <ul className="track-items" aria-label="First ids found">
                  {scan.items.map((it) => (
                    <li key={it.id}>
                      <span className="mono track-id">{it.id}</span>
                      <span className="muted track-where">
                        {it.doc} {it.anchor}
                      </span>
                      <span className="track-ctx">{it.context}</span>
                    </li>
                  ))}
                </ul>
                {scan.distinct > scan.items.length && (
                  <p className="muted">and {scan.distinct - scan.items.length} more</p>
                )}
              </>
            )}
          </div>

          <div className="track-effects">
            <span className="label">What changes</span>
            <ul>
              <li>
                Every test step gets a <strong>{field.trim() || "…"}</strong> column, shown as chips in the editor and
                in Review.
              </li>
              <li>
                Generate lets you pick {label.trim() || "these"} ids to cover; Claude fills the column with the ids each
                step verifies.
              </li>
              <li className="track-xray">
                {!field.trim() ? (
                  <span className="muted">Name the column to see whether Xray has it.</span>
                ) : inXray ? (
                  <Severity tone="ok">{`« ${field.trim()} » is a step field in Xray: the values are pushed`}</Severity>
                ) : (
                  <>
                    <Severity tone="warning">{`« ${field.trim()} » is not a step field in Xray yet`}</Severity>
                    <span>
                      Testimus cannot create it: in Xray, open the project settings → Test Step Fields, add a « Single
                      line text » field named exactly <strong>{field.trim()}</strong>, then check again. Until then the
                      values stay in the tests on this PC and are not pushed.
                    </span>
                    <Button size="sm" icon="pull" disabled={refreshing} onClick={() => void recheck()}>
                      {refreshing ? "Checking…" : "Check Xray again"}
                    </Button>
                  </>
                )}
              </li>
            </ul>
          </div>
        </section>
      )}
    </Modal>
  );
}
