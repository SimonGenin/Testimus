import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import {
  awaitsReview,
  type DocRef,
  type Effort,
  type Job,
  type LocalTestRef,
  type StepColumn,
  type Test,
} from "../../../core/types.ts";
import { call } from "../../api.ts";
import { ActionCount } from "../../components/claude/ActionCount.tsx";
import { AdditionalContext } from "../../components/claude/AdditionalContext.tsx";
import { type ClaudeStatus, ConnectClaude } from "../../components/claude/ConnectClaude.tsx";
import { cap, EFFORTS, ModelPicker } from "../../components/claude/ModelPicker.tsx";
import { useJob } from "../../components/shell/JobLog.tsx";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Button, DragEdge, Icon } from "../../components/ui/index.ts";
import { useActions } from "../../lib/actions.ts";
import { activityOf, DOING } from "../../lib/activity.ts";
import { useApp } from "../../lib/app.ts";
import { useDraft } from "../../lib/drafts.ts";
import { discardEditor } from "../../lib/editorBus.ts";
import { plural } from "../../lib/format.ts";
import { type DocScope, scopeOf } from "../../lib/scope.ts";
import { useSideWidth } from "../../lib/sideWidth.ts";
import { errorToast } from "../../lib/toast.ts";
import { REQUIREMENT, takeHandoff } from "../../lib/traces.ts";
import { ColumnsView } from "./ColumnsView.tsx";
import { DocScopePicker } from "./DocScopePicker.tsx";
import { GenActivity } from "./GenActivity.tsx";
import {
  Coverage,
  checkLine,
  GenCard,
  type GenOutput,
  type Landed,
  landedIds,
  passagesRead,
  RunHead,
} from "./GenResult.tsx";
import { ReplaceTests } from "./ReplaceTests.tsx";

// ponytail: the model and effort chosen here stay for the next generation until the app is closed; the project
// defaults change only from Settings
let chosen: { model: string; effort: Effort } | null = null;

export function GenerateScreen() {
  const app = useApp();
  const genActs = useActions({});
  const [formW, formEdge] = useSideWidth("testimus.genFormWidth", 320, 720, "before");
  const cfg = app.info?.project;
  const columns = (app.info?.columns ?? []) as StepColumn[];
  const traces = app.info?.traces ?? [];
  const [request, setRequest] = useDraft("generate.request", "");
  const [handed, setHanded] = useDraft<Record<string, string[]>>("generate.handed", {});
  const [docs, setDocs] = useState<DocRef[] | null>(null);
  const [scopes, setScopes] = useDraft<Record<string, DocScope>>("generate.scopes", {});
  const [contexts, setContexts] = useDraft<string[] | null>("generate.contexts", null);
  const [note, setNote] = useDraft("generate.note", "");
  const [model, setModel] = useState(chosen?.model ?? "");
  const [effort, setEffort] = useState<Effort | "">(chosen?.effort ?? "");
  const [jobId, setJobId] = useState<string | null>(null);
  const [asked, setAsked] = useState<{ label: string; ids: string[] }[]>([]);
  const [starting, setStarting] = useState(false);
  const [replacing, setReplacing] = useState<string[] | null>(null);
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [checkingClaude, setCheckingClaude] = useState(false);
  const [landed, setLanded] = useState<Record<string, Landed>>({});
  const [now, setNow] = useState(Date.now());
  const chained = useRef<string | null>(null);

  const gen = useJob(jobId);
  const job: Job | null = gen.job;
  const result = job?.status === "done" ? ((job.result ?? null) as GenOutput | null) : null;
  const ids = landedIds(gen.events, result);
  const read = passagesRead(gen.events);
  const running = job?.status === "running";
  const doing = DOING[activityOf(gen.events).at(-1)?.kind ?? "prepare"];
  const runModel = model || cfg?.claude.model || "opus";
  const runEffort: Effort = effort || cfg?.claude.effort || "high";
  const ctxIds = contexts ?? cfg?.claude.contexts ?? [];
  const handedIds = Object.entries(handed).filter(([, v]) => v.length);

  const claudeCheck = useCallback((refresh = false) => {
    setCheckingClaude(refresh);
    return call<ClaudeStatus>("claude.status", refresh ? { refresh: true, signIn: true } : {})
      .then(setStatus)
      .catch(() => {})
      .finally(() => setCheckingClaude(false));
  }, []);

  // ponytail: ids handed by another screen replace the draft, once
  useEffect(() => {
    const h = takeHandoff();
    if (Object.keys(h).length) setHanded(h);
  }, []);

  useEffect(() => {
    void claudeCheck();
    call<DocRef[]>("docs.list", {})
      .then((r) => setDocs(r ?? []))
      .catch(() => setDocs([]));
    call<Job[]>("jobs.list", {})
      .then((jobs) => {
        const last = (jobs ?? []).find((j) => j.kind === "generate");
        if (last) {
          chained.current = last.id;
          setJobId(last.id);
        }
      })
      .catch(() => {});
  }, [claudeCheck]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const refresh = useCallback(async (want: string[], all: boolean) => {
    if (!want.length) return;
    const refs = await call<LocalTestRef[]>("tests.list", {}).catch(() => [] as LocalTestRef[]);
    // ponytail: a test Claude is still writing is not on disk yet — only the ones tests.list sees are opened
    const there = want.filter((id) => refs.some((r) => r.id === id));
    const shows = await Promise.all(
      there.map((id) =>
        call<{ test: Test }>("tests.show", { id })
          .then((r) => [id, r.test] as const)
          .catch(() => [id, undefined] as const),
      ),
    );
    setLanded((cur) => {
      const next = { ...cur };
      for (const [id, test] of shows)
        if (test || all) next[id] = { id, test: test ?? cur[id]?.test, ref: refs.find((r) => r.id === id) };
      return next;
    });
  }, []);

  const idsKey = ids.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: ids are compared by their joined key
  useEffect(() => {
    const done = running ? ids.slice(0, -1) : ids;
    const want = done.filter((id) => !landed[id]?.test);
    void refresh(want, !running);
  }, [idsKey, running]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when this screen's generation ends
  useEffect(() => {
    if (job?.status !== "done" || !(result?.tests.length || result?.discarded?.length) || chained.current === job.id)
      return;
    chained.current = job.id;
    void refresh(result.tests, true);
    app.testsChanged();
    app.refreshInfo();
  }, [job?.status, job?.id]);

  const scope = scopeOf(
    scopes,
    (docs ?? []).map((d) => d.id),
  );
  const empty = !request.trim() && !scope.docs.length && !scope.sections.length && !handedIds.length;

  const pickModel = (m: string) => {
    setModel(m);
    chosen = { model: m, effort: runEffort };
  };
  const pickEffort = (e: Effort) => {
    setEffort(e);
    chosen = { model: runModel, effort: e };
  };
  const resetRun = () => {
    chosen = null;
    setModel("");
    setEffort("");
  };

  const generate = async (replace: string[] = []) => {
    if (empty) return;
    const reqs = handed[REQUIREMENT] ?? [];
    const tracked = handedIds.filter(([k]) => k !== REQUIREMENT).map(([trace, v]) => ({ trace, ids: v }));
    setStarting(true);
    try {
      const r = await call<{ jobId?: string }>("gen.tests", {
        request: request.trim(),
        ...(scope.docs.length ? { docs: scope.docs } : {}),
        ...(scope.sections.length ? { sections: scope.sections } : {}),
        ...(reqs.length ? { requirements: reqs } : {}),
        ...(tracked.length ? { tracked } : {}),
        contexts: ctxIds,
        ...(note.trim() ? { note: note.trim() } : {}),
        model: runModel,
        effort: runEffort,
        ...(replace.length ? { discard: true } : {}),
      });
      for (const id of replace) discardEditor(id);
      if (replace.length) app.testsChanged();
      if (r?.jobId) {
        chained.current = null;
        setLanded({});
        setAsked(handedIds.map(([k, v]) => ({ label: traces.find((t) => t.id === k)?.label ?? k, ids: v })));
        setJobId(r.jobId);
      }
    } catch (e) {
      errorToast(e, "Could not start the generation");
    } finally {
      setStarting(false);
    }
  };

  // ponytail: a new generation replaces Claude's tests still waiting in review — the same rule as gen.tests discard
  const askThenGenerate = async () => {
    if (empty) return;
    const refs = await call<LocalTestRef[]>("tests.list", {}).catch(() => [] as LocalTestRef[]);
    const ids = refs.filter((t) => awaitsReview(t) && !t.key).map((t) => t.id);
    if (ids.length) setReplacing(ids);
    else void generate();
  };

  const cancel = () => jobId && call("jobs.cancel", { id: jobId }).catch((e) => errorToast(e, "Could not cancel"));
  const offline = !!status && (!status.installed || status.signedIn === false);
  const checkText = result ? checkLine(result.tests, result.checks) : "";
  const checkOf = (id: string) => result?.checks?.find((c) => c.id === id);
  const narrowed = Object.values(scopes).filter(Array.isArray).length;
  const inScope = scope.docs.length + new Set(scope.sections.map((s) => s.split("#")[0])).size;
  const isDefault = !model && !effort;

  return (
    <div className="screen">
      <ScreenHeader title="Generate" meta="Claude writes tests from the documents, with a source for every claim">
        <ActionCount actions={genActs.filter((a) => a.proposedBy.run === "generate")} />
      </ScreenHeader>
      <div className="gen" style={formW ? ({ "--genform-size": `${formW}px` } as CSSProperties) : undefined}>
        <section className="gen-form" aria-label="Request">
          <div className="gen-block">
            <label htmlFor="gen-request" className="h gen-label">
              What should be tested?
            </label>
            <textarea
              id="gen-request"
              className="field"
              rows={3}
              placeholder="A feature, a screen, an operator procedure… in your own words"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
            />
            <span className="muted gen-hint">Optional: empty means cover what the documents below specify.</span>
            {handedIds.map(([k, v]) => (
              <div key={k} className="gen-handed">
                <span>
                  From Coverage: {plural(v.length, `${(traces.find((t) => t.id === k)?.label ?? k).toLowerCase()} id`)}{" "}
                  to cover
                </span>
                <button type="button" className="linkbtn" onClick={() => setHanded({ ...handed, [k]: [] })}>
                  Clear
                </button>
              </div>
            ))}
          </div>

          <div className="gen-block">
            <span className="h gen-label">Documents</span>
            <DocScopePicker docs={docs} scopes={scopes} onChange={setScopes} />
          </div>

          <div className="gen-block">
            <span className="h gen-label">
              Additional context <span className="muted">— optional</span>
            </span>
            <AdditionalContext id="gen-note" ids={ctxIds} note={note} onIds={setContexts} onNote={setNote} />
          </div>

          <ColumnsView columns={columns} onEdit={() => app.navigate("settings", "columns")} />

          <div className="gen-block gen-run">
            <span className="h gen-label">Run</span>
            <div className="gen-run-pick">
              <label className="gen-run-field">
                <span className="label">Model</span>
                <ModelPicker value={runModel} className="field select" onChange={pickModel} />
              </label>
              <label className="gen-run-field">
                <span className="label">Effort</span>
                <select
                  className="field select"
                  value={runEffort}
                  onChange={(e) => pickEffort(e.target.value as Effort)}
                >
                  {EFFORTS.map((x) => (
                    <option key={x} value={x}>
                      {cap(x)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <span className="muted gen-hint">
              Project default: {cap(cfg?.claude.model ?? "opus")} / {cfg?.claude.effort ?? "high"}
              {!isDefault && (
                <>
                  {" · "}
                  <button type="button" className="linkbtn" onClick={resetRun}>
                    Reset
                  </button>
                </>
              )}
            </span>
            <ul className="gen-recap muted">
              <li>
                {plural(inScope, "document")} in scope
                {narrowed ? ` · ${narrowed} narrowed to sections` : ""}
              </li>
              <li>
                {plural(columns.length, "column")} · {columns.filter((c) => c.description).length} filled by Claude
              </li>
              {(ctxIds.length > 0 || note.trim()) && (
                <li>
                  {ctxIds.length ? plural(ctxIds.length, "saved context") : ""}
                  {ctxIds.length && note.trim() ? " + " : ""}
                  {note.trim() ? "a note" : ""}
                </li>
              )}
            </ul>
            <div className="gen-go">
              <Button
                tone={job ? "secondary" : "primary"}
                icon="generate"
                disabled={empty || running || starting || offline}
                onClick={() => void askThenGenerate()}
              >
                {job ? "Generate again" : "Generate"}
              </Button>
            </div>
            <span className="muted gen-hint">
              Tests are created on this PC as drafts. Claude suggests an Xray folder; change it in the test before you
              push.
            </span>
          </div>
        </section>

        <DragEdge className="side-edge" label="Resize the request panel" {...formEdge} />
        <section className="gen-result" aria-label="Result">
          {offline && status ? (
            <div className="card gen-offline">
              <ConnectClaude
                status={status}
                checking={checkingClaude}
                onCheck={() => void claudeCheck(true)}
                onDoctor={() => app.navigate("doctor")}
              />
            </div>
          ) : !jobId ? (
            <div className="empty">
              <Icon name="generate" size={40} />
              <h2 className="h">Tests appear here as Claude writes them</h2>
              <p>
                Pick the documents (all of them by default), say what to test if you want, and generate. Every expected
                result gets a source; what cannot be sourced is reported instead of invented.
              </p>
            </div>
          ) : (
            <>
              <div className="card gen-summary">
                <RunHead
                  job={job}
                  now={now}
                  result={result}
                  read={read}
                  count={ids.length}
                  doing={doing}
                  onCancel={() => void cancel()}
                  onReview={() => app.navigate("review", ids[0])}
                />
                {result && <Coverage asked={asked} result={result} checked={checkText} />}
                {job?.status === "failed" && <p>{job.error}</p>}
                {result?.diagnosis && <p className="muted">{result.diagnosis.detail}</p>}
              </div>
              {ids.length > 0 && (
                <section className="card gen-cards" aria-label="Tests written" aria-live="polite">
                  {ids.map((id, i) => (
                    <GenCard
                      key={id}
                      item={landed[id] ?? { id }}
                      check={checkOf(id)}
                      writing={running && i === ids.length - 1}
                      checking={running && i < ids.length - 1}
                      onOpen={() => app.navigate("review", id)}
                    />
                  ))}
                </section>
              )}
              <GenActivity events={gen.events} running={running} now={now} />
            </>
          )}
        </section>
      </div>
      {replacing && (
        <ReplaceTests
          count={replacing.length}
          onReview={() => {
            setReplacing(null);
            app.navigate("review", replacing[0]);
          }}
          onConfirm={() => {
            setReplacing(null);
            void generate(replacing);
          }}
          onClose={() => setReplacing(null)}
        />
      )}
    </div>
  );
}
