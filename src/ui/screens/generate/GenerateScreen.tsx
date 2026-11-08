import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { DocRef, Job, StepColumn } from "../../../core/types.ts";
import { claudeSaid, noteRun, useClaudeStatus } from "../../components/claude/useClaudeStatus.ts";
import { useNow } from "../../components/claude/useNow.ts";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { ResizeHandle } from "../../components/ui/ResizeHandle.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { useApp } from "../../lib/app.ts";
import { discardAutosave } from "../../lib/data/autosave.ts";
import { execute, key, read, useCommand, useRead } from "../../lib/data/query.ts";
import { usePaneWidth } from "../../lib/panes.ts";
import { unready } from "../../lib/scope.ts";
import { errorToast } from "../../lib/toast.ts";
import { useReindex } from "../../lib/uploads.ts";
import { border, breakpoint, color, space } from "../../styles/tokens.stylex.ts";
import { useCancel } from "../settings/jobs.ts";
import { AskChanges, type AskInput } from "./AskChanges.tsx";
import { ReplaceTests } from "./ReplaceTests.tsx";
import { RequestForm } from "./RequestForm.tsx";
import { ResultPane } from "./ResultPane.tsx";
import { useGenerateForm } from "./useGenerateForm.ts";
import { useGeneration } from "./useGeneration.ts";

const FORM = { min: 320, max: 720, initial: 576 };
// ponytail: the document work Generate waits for, by what runs
const WORK: Record<string, "index" | "convert" | "add"> = {
  "rag-index": "index",
  "docs.convert": "convert",
  "docs.add": "add",
};
const WAIT: Record<"index" | "convert" | "add", string> = {
  index: "Wait for the index to finish",
  convert: "Wait for the conversion to finish",
  add: "Wait for the documents to be added",
};

const styles = stylex.create({
  screen: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: color.canvas },
  panes: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: { default: "row", [breakpoint.narrow]: "column" },
    overflow: { default: "hidden", [breakpoint.narrow]: "auto" },
  },
  form: (width: string) => ({
    boxSizing: "border-box",
    flexShrink: 0,
    width: { default: width, [breakpoint.narrow]: "auto" },
    minHeight: 0,
    borderRightStyle: "solid",
    borderRightWidth: { default: border.width, [breakpoint.narrow]: 0 },
    borderRightColor: color.border,
  }),
  handle: { display: { default: "flex", [breakpoint.narrow]: "none" } },
  waiting: {
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingBlock: space.s6,
    paddingInline: space.s7,
  },
  result: { flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" },
});

export function GenerateScreen() {
  const app = useApp();
  const client = useQueryClient();
  const formPane = usePaneWidth("genFormWidth", FORM);
  const info = useRead("project.info", {});
  const docsRead = useRead("docs.list", {});
  const docs = (docsRead.data ?? null) as DocRef[] | null;
  const jobs = useRead("jobs.list", {});
  const running = ((jobs.data ?? []) as Job[]).filter((j) => j.status === "running");
  const docJob = running.find((j) => WORK[j.kind] && WORK[j.kind] !== "index");
  const indexJob = docJob ?? running.find((j) => WORK[j.kind] === "index");
  const reindex = useReindex();
  // ponytail: whether an index run reads a document is docs.list's to say (its indexing), not the page's
  const indexing = reindex.indexing || !!docs?.some((d) => d.indexing);
  const work = docJob ? WORK[docJob.kind] : indexing ? "index" : null;
  const docWork = { converting: running.filter((j) => j.kind === "docs.convert").map((j) => j.subject) };
  const form = useGenerateForm(info.data, docs ?? undefined, docWork);
  const gen = useGeneration();
  const scopeInput = { docs: form.scope.docs, sections: form.scope.sections };
  const preview = useRead("gen.preview", scopeInput, { enabled: !!docs });
  const [ask, setAsk] = useState<{ refresh?: boolean; signIn?: boolean }>({});
  const { read: claude, status: known } = useClaudeStatus(ask);
  const start = useCommand("gen.tests", { invalidates: [["jobs.list"]] });
  const cancel = useCancel();
  const [replacing, setReplacing] = useState<string[] | null>(null);
  const [fresh, setFresh] = useState(0);
  const revise = useCommand("gen.revise", { invalidates: [["jobs.list"]] });
  // ponytail: once a generation is done its column asks for changes (« New request » brings the form back); a run
  // started from one column keeps that column while it runs
  const [mode, setMode] = useState<"form" | "ask">("ask");
  const [from, setFrom] = useState<"form" | "ask" | null>(null);
  const [lastGen, setLastGen] = useState<string | null>(null);
  const done = gen.result?.generation ?? null;
  useEffect(() => {
    if (done) setLastGen(done);
  }, [done]);
  const generation = done ?? lastGen;
  const asking = gen.running ? from === "ask" && !!generation : mode === "ask" && !!generation;
  const now = useNow(asking && gen.running, 1000);

  const status = known ?? null;
  const offline = !!status && (!status.installed || status.signedIn === false);
  const nameOf = (id: string) => docs?.find((d) => d.id === id)?.code || id;
  // ponytail: a document not indexed is left out of the scope and said once; an empty scope still searches every
  // document, so one not indexed blocks it even then
  const unindexed = preview.data?.unindexed ?? [];
  const out = (docs ?? []).filter((d) => unready(d, docWork) === "not-indexed").map((d) => d.id);
  const missing = unindexed.filter((id) => !out.includes(id)).map(nameOf);
  const leftOut = out.map(nameOf);
  const stale = (preview.data?.stale ?? []).map(nameOf);
  const noneConverted = !!docs?.length && !docs.some((d) => d.converted?.at);
  const blocked = info.isPending
    ? "Reading the project…"
    : work
      ? WAIT[work]
      : form.empty
        ? docs && !docs.length
          ? "Add a document first"
          : noneConverted
            ? "Convert a document first"
            : "Say what to test, or pick a document"
        : offline
          ? "Claude is not connected"
          : unindexed.length
            ? "A document is not indexed: reindex first"
            : null;

  // ponytail: a generation started here that failed on Claude's sign-in shows the connect card, like the dock
  const startedHere = useRef<string | null>(null);
  const ended = gen.job && gen.job.id === startedHere.current && gen.job.status !== "running" ? gen.job : null;
  useEffect(() => {
    if (!ended) return;
    startedHere.current = null;
    const diagnosis = (ended.result as { diagnosis?: { kind: string } } | undefined)?.diagnosis;
    noteRun(client, { ok: ended.status === "done" && !diagnosis, diagnosis, said: claudeSaid(gen.events) });
  });

  const begin = async (input: Parameters<typeof start.mutateAsync>[0], replaced: string[] = []) => {
    try {
      const r = await start.mutateAsync(input);
      for (const id of replaced) discardAutosave(key("tests.show", { id }));
      if (r?.jobId) {
        setFresh((n) => n + 1);
        startedHere.current = r.jobId;
        setMode("ask");
        setFrom("form");
        gen.follow(r.jobId);
      }
    } catch (e) {
      errorToast(e, input.resume ? "Could not resume the generation" : "Could not start the generation");
    }
  };

  const askChanges = async (input: AskInput) => {
    try {
      const r = await revise.mutateAsync(input);
      if (r?.jobId) {
        setFresh((n) => n + 1);
        startedHere.current = r.jobId;
        setFrom("ask");
        gen.follow(r.jobId);
      }
    } catch (e) {
      errorToast(e, "Could not ask Claude for the changes");
    }
  };

  // ponytail: « Run again » after a failed run is that job again, with the input it kept (jobs.rerun, as in Jobs) —
  // the form stays as it is
  const rerun = async () => {
    if (!gen.jobId) return;
    try {
      const r = await execute(client, "jobs.rerun", { id: gen.jobId }, { invalidates: [["jobs.list"]] });
      if (r?.jobId) {
        setFresh((n) => n + 1);
        startedHere.current = r.jobId;
        gen.follow(r.jobId);
      }
    } catch (e) {
      errorToast(e, "Could not run the generation again");
    }
  };

  // ponytail: a new generation replaces Claude's tests still waiting in review — gen.preview says which
  const generate = async () => {
    if (blocked || gen.running || start.isPending) return;
    const replaces =
      preview.data?.replaces ??
      (await read(client, "gen.preview", scopeInput)
        .then((r) => r.replaces)
        .catch(() => [] as string[]));
    if (replaces.length) setReplacing(replaces);
    else void begin(form.input());
  };

  const columns = (info.data?.columns ?? []) as StepColumn[];
  return (
    <div {...stylex.props(styles.screen)}>
      <ScreenHeader title="Generate">
        {asking && !gen.running && (
          <Button size="sm" variant="quiet" icon="generate" label="New request" onClick={() => setMode("form")} />
        )}
      </ScreenHeader>
      <div {...stylex.props(styles.panes)}>
        <div {...stylex.props(styles.form(`${formPane.width}px`))}>
          {gen.loading && mode === "ask" ? (
            <div {...stylex.props(styles.waiting)}>
              <Skeleton kind="title" width="40%" />
              <Skeleton lines={4} />
              <Skeleton kind="block" />
              <Loading read="jobs.list" />
            </div>
          ) : asking && generation ? (
            <AskChanges
              key={generation}
              generation={generation}
              running={gen.running && gen.job ? Math.round((now - Date.parse(gen.job.startedAt)) / 1000) : null}
              unavailable={offline ? "Claude is not connected" : undefined}
              defaults={{ model: form.runModel, effort: form.runEffort }}
              onAsk={(input) => void askChanges(input)}
            />
          ) : (
            <RequestForm
              form={form}
              docs={docs}
              columns={columns}
              folders={info.data?.project.folders ?? []}
              gate={{
                missing,
                leftOut,
                stale,
                work,
                docWork,
                progress: indexJob?.progress,
                onShowJob: indexJob ? () => app.navigate("jobs", indexJob.id) : undefined,
                onReindex: reindex.reindex,
                failure: reindex.failure,
              }}
              hasJob={!!gen.job}
              running={gen.running}
              starting={start.isPending}
              blocked={blocked}
              unavailable={offline ? "Claude is not connected" : undefined}
              onGenerate={() => void generate()}
              onColumns={() => app.navigate("settings", "columns")}
              onAddDocuments={() => app.navigate("documents")}
            />
          )}
        </div>
        <span {...stylex.props(styles.handle)}>
          <ResizeHandle label="Resize the request panel" {...formPane.handle} />
        </span>
        <section aria-label="Result" {...stylex.props(styles.result)}>
          <ResultPane
            key={fresh}
            gen={gen}
            status={offline ? status : null}
            checking={claude.isFetching && !!ask.refresh}
            noDocs={!!docs && !docs.length}
            starting={start.isPending}
            onCheckClaude={() => (ask.refresh ? void claude.refetch() : setAsk({ refresh: true, signIn: true }))}
            onCancel={() => gen.jobId && cancel(gen.jobId)}
            onRetry={gen.job?.rerun ? () => void rerun() : undefined}
            onResume={(generation) =>
              void begin({ resume: generation, model: form.runModel, effort: form.runEffort } as Parameters<
                typeof start.mutateAsync
              >[0])
            }
          />
        </section>
      </div>
      {replacing && (
        <ReplaceTests
          ids={replacing}
          onReview={(id) => {
            setReplacing(null);
            app.navigate("review", id);
          }}
          onConfirm={() => {
            setReplacing(null);
            void begin({ ...form.input(), discard: true }, replacing);
          }}
          onClose={() => setReplacing(null)}
        />
      )}
    </div>
  );
}
