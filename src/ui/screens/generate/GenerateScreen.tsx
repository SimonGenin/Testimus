import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { Job, LocalTestRef, Test, TraceScan } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { type ClaudeStatus, ConnectClaude } from "../../components/claude/ConnectClaude.tsx";
import { JobLog, useJob } from "../../components/shell/JobLog.tsx";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { TracesBar } from "../../components/traces/TracesBar.tsx";
import { Button, DragEdge, Icon } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { plural } from "../../lib/format.ts";
import type { Requirement } from "../../lib/requirements.ts";
import { useSideWidth } from "../../lib/sideWidth.ts";
import { errorToast } from "../../lib/toast.ts";
import { REQUIREMENT, takeHandoff } from "../../lib/traces.ts";
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
import { RequirementPicker } from "./RequirementPicker.tsx";
import { SectionPicker } from "./SectionPicker.tsx";

const LABEL: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

export function GenerateScreen() {
  const app = useApp();
  const [formW, formEdge] = useSideWidth("testimus.genFormWidth", 320, 720, "before");
  const cfg = app.info?.project;
  const [request, setRequest] = useState("");
  const [picked, setPicked] = useState<Record<string, string[]>>(takeHandoff);
  const [sections, setSections] = useState<string[]>([]);
  const [folder, setFolder] = useState("");
  const [known, setKnown] = useState<Record<string, Requirement[]>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [asked, setAsked] = useState<{ label: string; ids: string[] }[]>([]);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [checkingClaude, setCheckingClaude] = useState(false);
  const [landed, setLanded] = useState<Record<string, Landed>>({});
  const [showLog, setShowLog] = useState(false);
  const [now, setNow] = useState(Date.now());
  const chained = useRef<string | null>(null);

  const gen = useJob(jobId);
  const job: Job | null = gen.job;
  const result = job?.status === "done" ? ((job.result ?? null) as GenOutput | null) : null;
  const ids = landedIds(gen.events, result);
  const read = passagesRead(gen.events);
  const running = job?.status === "running";
  const traces = app.info?.traces ?? [];
  const tracesKey = traces.map((t) => `${t.id}=${t.patterns.join("|")}`).join(",");
  const reqs = picked[REQUIREMENT] ?? [];
  const anyPicked = traces.some((t) => (picked[t.id] ?? []).length > 0);

  const claudeCheck = useCallback((refresh = false) => {
    setCheckingClaude(refresh);
    return call<ClaudeStatus>("claude.status", refresh ? { refresh: true, signIn: true } : {})
      .then(setStatus)
      .catch(() => {})
      .finally(() => setCheckingClaude(false));
  }, []);

  useEffect(() => {
    void claudeCheck();
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: the tracked kinds are compared by their key
  useEffect(() => {
    for (const t of traces)
      call<TraceScan>("traces.find", { trace: t.id, limit: 5000 })
        .then((r) =>
          setKnown((cur) => ({ ...cur, [t.id]: r.items.map((i) => ({ id: i.id, text: i.context, doc: i.doc })) })),
        )
        .catch(() => {});
  }, [tracesKey]);

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
    if (job?.status !== "done" || !result?.tests.length || chained.current === job.id) return;
    chained.current = job.id;
    void refresh(result.tests, true);
    app.testsChanged();
    app.refreshInfo();
  }, [job?.status, job?.id]);

  const generate = async () => {
    if (!request.trim() && !anyPicked && !sections.length) return;
    const tracked = traces
      .filter((t) => t.id !== REQUIREMENT && (picked[t.id] ?? []).length)
      .map((t) => ({ trace: t.id, ids: picked[t.id] }));
    setStarting(true);
    try {
      const r = await call<{ jobId?: string }>("gen.tests", {
        request: request.trim(),
        ...(reqs.length ? { requirements: reqs } : {}),
        ...(tracked.length ? { tracked } : {}),
        ...(sections.length ? { sections } : {}),
        ...(folder.trim() ? { folder: folder.trim() } : {}),
      });
      if (r?.jobId) {
        chained.current = null;
        setLanded({});
        setAsked(traces.map((t) => ({ label: t.label, ids: picked[t.id] ?? [] })).filter((a) => a.ids.length));
        setJobId(r.jobId);
      }
    } catch (e) {
      errorToast(e, "Could not start the generation");
    } finally {
      setStarting(false);
    }
  };

  const cancel = () => jobId && call("jobs.cancel", { id: jobId }).catch((e) => errorToast(e, "Could not cancel"));
  const offline = !!status && (!status.installed || status.signedIn === false);
  const empty = !request.trim() && !anyPicked && !sections.length;
  const checkText = result ? checkLine(result.tests, result.checks) : "";
  const checkOf = (id: string) => result?.checks?.find((c) => c.id === id);

  return (
    <div className="screen">
      <ScreenHeader title="Generate" meta="Claude writes tests from the documents, with a source for every claim" />
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
          </div>
          <div className="gen-block">
            <span className="h gen-label">
              Scope <span className="muted">— optional</span>
            </span>
            {traces.map((t) => (
              <div key={t.id} className="gen-trace">
                <label htmlFor={`gen-trace-${t.id}`} className="label">
                  {t.label} ids
                </label>
                <RequirementPicker
                  inputId={`gen-trace-${t.id}`}
                  kind={t.label.toLowerCase()}
                  known={known[t.id] ?? []}
                  values={picked[t.id] ?? []}
                  onChange={(v) => setPicked((cur) => ({ ...cur, [t.id]: v }))}
                />
              </div>
            ))}
            <TracesBar hint="none — ids written in the documents (requirements, alarm codes…) can be picked here once tracked." />
            <span className="label">Document sections</span>
            <SectionPicker values={sections} onChange={setSections} />
            <label htmlFor="gen-folder" className="label">
              Xray folder for the new tests
            </label>
            <input
              id="gen-folder"
              className="field mono"
              list="gen-folders"
              placeholder="Claude picks one of the project's folders"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            />
            <datalist id="gen-folders">
              {(cfg?.folders ?? []).map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>
          <div className="gen-go">
            <Button
              tone={job ? "secondary" : "primary"}
              icon="generate"
              disabled={empty || running || starting || offline}
              onClick={() => void generate()}
            >
              {job ? "Generate again" : "Generate"}
            </Button>
            <span className="muted">
              {LABEL[cfg?.claude.model ?? ""] ?? cfg?.claude.model ?? "Claude"} · effort{" "}
              {cfg?.claude.effort ?? "medium"}
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
                Say what to test, or pick {traces.length ? "ids and " : ""}sections. Every expected result gets a
                source; what cannot be sourced is reported instead of invented.
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
              <Button
                tone="quiet"
                icon={showLog ? "down" : "right"}
                aria-expanded={showLog}
                onClick={() => setShowLog((s) => !s)}
              >
                {showLog ? "Hide" : "Show"} what Claude read and wrote (
                {plural(gen.events.length, "entry").replace("entrys", "entries")})
              </Button>
              {showLog && <JobLog events={gen.events} label="What Claude read and wrote" />}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
