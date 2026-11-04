import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { DocRef, Job, StepColumn } from "../../../core/types.ts";
import { claudeSaid, noteRun, useClaudeStatus } from "../../components/claude/useClaudeStatus.ts";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { ResizeHandle } from "../../components/ui/ResizeHandle.tsx";
import { useApp } from "../../lib/app.ts";
import { discardAutosave } from "../../lib/data/autosave.ts";
import { key, read, useCommand, useRead } from "../../lib/data/query.ts";
import { usePaneWidth } from "../../lib/panes.ts";
import { errorToast } from "../../lib/toast.ts";
import { border, breakpoint, color } from "../../styles/tokens.stylex.ts";
import { ReplaceTests } from "./ReplaceTests.tsx";
import { RequestForm } from "./RequestForm.tsx";
import { ResultPane } from "./ResultPane.tsx";
import { useGenerateForm } from "./useGenerateForm.ts";
import { useGeneration } from "./useGeneration.ts";

const FORM = { min: 320, max: 720, initial: 576 };
const INDEXING = new Set(["rag-index", "docs.add", "docs.convert"]);

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
  result: { flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" },
});

export function GenerateScreen() {
  const app = useApp();
  const client = useQueryClient();
  const formPane = usePaneWidth("genFormWidth", FORM);
  const info = useRead("project.info", {});
  const docsRead = useRead("docs.list", {});
  const docs = (docsRead.data ?? null) as DocRef[] | null;
  const form = useGenerateForm(info.data, docs ?? undefined);
  const gen = useGeneration();
  const jobs = useRead("jobs.list", {});
  const indexing = ((jobs.data ?? []) as Job[]).some((j) => j.status === "running" && INDEXING.has(j.kind));
  const scopeInput = { docs: form.scope.docs, sections: form.scope.sections };
  const preview = useRead("gen.preview", scopeInput, { enabled: !!docs });
  const [ask, setAsk] = useState<{ refresh?: boolean; signIn?: boolean }>({});
  const { read: claude, status: known } = useClaudeStatus(ask);
  const start = useCommand("gen.tests", { invalidates: [["jobs.list"]] });
  const reindex = useCommand("rag.index", { invalidates: [["jobs.list"]] });
  const cancel = useCommand("jobs.cancel", { invalidates: [["jobs.list"], ["jobs.show"]] });
  const [replacing, setReplacing] = useState<string[] | null>(null);
  const [fresh, setFresh] = useState(0);

  const status = known ?? null;
  const offline = !!status && (!status.installed || status.signedIn === false);
  const nameOf = (id: string) => docs?.find((d) => d.id === id)?.code || id;
  const missing = (preview.data?.unindexed ?? []).map(nameOf);
  const stale = (preview.data?.stale ?? []).map(nameOf);
  const blocked = info.isPending
    ? "Reading the project…"
    : form.empty
      ? docs && !docs.length
        ? "Add a document first"
        : "Say what to test, or pick a document"
      : offline
        ? "Claude is not connected"
        : indexing
          ? "Wait for the index to finish"
          : missing.length
            ? "A document of the scope is not indexed"
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
        gen.follow(r.jobId);
      }
    } catch (e) {
      errorToast(e, input.resume ? "Could not resume the generation" : "Could not start the generation");
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
      <ScreenHeader title="Generate" />
      <div {...stylex.props(styles.panes)}>
        <div {...stylex.props(styles.form(`${formPane.width}px`))}>
          <RequestForm
            form={form}
            docs={docs}
            columns={columns}
            folders={info.data?.project.folders ?? []}
            gate={{
              missing,
              stale,
              indexing,
              onReindex: () => reindex.mutateAsync({}).catch((e) => errorToast(e, "Could not reindex")),
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
            onCancel={() =>
              gen.jobId && cancel.mutateAsync({ id: gen.jobId }).catch((e) => errorToast(e, "Could not cancel"))
            }
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
          onReview={() => {
            setReplacing(null);
            app.navigate("review", replacing[0]);
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
