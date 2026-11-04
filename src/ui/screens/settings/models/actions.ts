import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Fit } from "../../../../core/types.ts";
import { ApiError } from "../../../lib/data/client.ts";
import { execute, key, type Prefix, read } from "../../../lib/data/query.ts";
import { errorToast, toast } from "../../../lib/toast.ts";
import type { Bench } from "./BenchDialog.tsx";
import type { AdviceRow, CatalogRow, Installed, PackRow, RagStatus, UsePackOut } from "./data.ts";
import { isInstalled, size } from "./data.ts";
import { MEASURE } from "./ops.tsx";

export type FitAsk = {
  name: string;
  short: string;
  fit: Fit;
  processorOnly: boolean;
  lighter: string | null;
  go: () => void;
  lighterGo: () => void;
};
export type FolderAsk = { needMB: number; next?: () => void };
export type Plan = { row: PackRow; out: UsePackOut };

type Start = (jobId: string, key: string, kind: string, label: string, then?: (result: unknown) => void) => void;

const MODEL_READS: Prefix[] = [
  ["models.list"],
  ["models.catalog"],
  ["models.packs"],
  ["models.advice"],
  ["rag.status"],
  ["jobs.list"],
];

// ponytail: every gesture of the Models page is one command (or a dry run then the command, for a choice that may
// not fit); what follows a job is told by its end
export function useModelActions(o: {
  packs: PackRow[] | undefined;
  catalog: CatalogRow[] | undefined;
  status: RagStatus | undefined;
  dir: string | null | undefined;
  start: Start;
}) {
  const client = useQueryClient();
  const [fitAsk, setFitAsk] = useState<FitAsk | null>(null);
  const [folder, setFolder] = useState<FolderAsk | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [removing, setRemoving] = useState<{ row: CatalogRow; inst: Installed } | null>(null);
  const [benches, setBenches] = useState<Record<string, Bench>>({});
  const fx = { invalidates: MODEL_READS };

  const planPack = async (row: PackRow) => {
    setPlanning(true);
    try {
      // ponytail: a plan is asked afresh each time (the folder or the models may have changed since)
      client.removeQueries({ queryKey: key("models.planPack", { pack: row.id }) as unknown as readonly unknown[] });
      const out = await read(client, "models.planPack", { pack: row.id });
      if (out.plan.download.length && !out.plan.dir) {
        setFolder({ needMB: out.plan.download.reduce((a, d) => a + d.sizeMB, 0), next: () => void planPack(row) });
        return;
      }
      setPlan({ row, out });
    } catch (e) {
      errorToast(e, `Could not plan the ${row.label} pack`);
    } finally {
      setPlanning(false);
    }
  };

  const choosePack = (row: PackRow) => {
    if (row.fit && (row.fit.verdict !== "fits" || row.processorOnly)) {
      const lighter = o.packs?.find((p) => p.id === row.lighter) ?? null;
      setFitAsk({
        name: `the ${row.label} pack`,
        short: row.label,
        fit: row.fit,
        processorOnly: row.processorOnly,
        lighter: lighter ? `the ${lighter.label} pack` : null,
        go: () => void planPack(row),
        lighterGo: () => lighter && choosePack(lighter),
      });
    } else void planPack(row);
  };

  const confirmPack = async () => {
    if (!plan) return;
    const { row } = plan;
    const downloadOnly = plan.out.plan.download.length > 0;
    setPlanning(true);
    try {
      const { jobId } = await execute(client, "models.usePack", { pack: row.id, downloadOnly }, fx);
      setPlan(null);
      if (downloadOnly) {
        o.start(jobId, row.id, "models-usePack", `Downloading ${row.label}`, () =>
          toast({ tone: "success", title: `${row.label} pack downloaded`, detail: "Use this pack to switch to it." }),
        );
        return;
      }
      toast({ tone: "success", title: `${row.label} pack chosen for this project` });
      o.start(jobId, row.id, "models-usePack", `Installing ${row.label}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "models-dir-unset") {
        setPlan(null);
        setFolder({ needMB: plan.out.plan.download.reduce((a, d) => a + d.sizeMB, 0), next: () => void planPack(row) });
      } else errorToast(e, `Could not ${downloadOnly ? "download" : "use"} the ${row.label} pack`);
    } finally {
      setPlanning(false);
    }
  };

  const install = async (r: CatalogRow, chosen = false) => {
    if (!chosen && o.dir === null) {
      setFolder({ needMB: r.sizeMB, next: () => void install(r, true) });
      return;
    }
    try {
      const out = await execute(client, "models.pull", { model: r.id }, fx);
      o.start(out.jobId, r.id, "models-pull", `Downloading ${r.label}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "models-dir-unset")
        setFolder({ needMB: r.sizeMB, next: () => void install(r, true) });
      else errorToast(e, `Could not install ${r.label}`);
    }
  };

  const applyModel = async (r: CatalogRow, pick: { embedding?: string; reranker?: string }) => {
    try {
      const out = await execute(client, "models.use", pick, fx);
      toast({
        tone: "success",
        title: `${r.label} in use for this project`,
        detail: out.reindex ? "Indexing again" : "",
      });
      if (out.indexJob) o.start(out.indexJob, "index", "rag-index", "Indexing the documents");
    } catch (e) {
      errorToast(e, `Could not use ${r.label}`);
    }
  };

  const chooseModel = async (r: CatalogRow) => {
    const current = o.status && o.status.embedding !== "none" ? o.status.embedding : undefined;
    if (r.kind === "reranker" && !current) {
      toast({
        tone: "danger",
        title: "Choose an embedding model first",
        detail: "A reranker only reorders its results.",
      });
      return;
    }
    const pick = r.kind === "embedding" ? { embedding: r.id } : { reranker: r.id };
    try {
      const dry = await read(client, "models.use", { ...pick, dryRun: true });
      if (dry.fit.verdict === "fits") return void applyModel(r, pick);
      const lighter = o.catalog?.find((c) => c.id === dry.lighter) ?? null;
      setFitAsk({
        name: r.label,
        short: r.label,
        fit: dry.fit,
        processorOnly: false,
        lighter: lighter?.label ?? null,
        go: () => void applyModel(r, pick),
        lighterGo: () => lighter && (isInstalled(lighter.state) ? void chooseModel(lighter) : void install(lighter)),
      });
    } catch (e) {
      errorToast(e, `Could not check whether ${r.label} fits`);
    }
  };

  const verify = async (r: CatalogRow) => {
    try {
      const { jobId } = await execute(client, "models.verify", { model: r.id }, fx);
      o.start(jobId, r.id, "models-verify", "Verifying", (out) => {
        const v = out as { ok: boolean; dims: number; ms: number; message: string };
        toast({
          tone: v.ok ? "success" : "danger",
          title: v.ok ? `${r.label} works` : `${r.label} failed its check`,
          detail: `${v.message} (${v.dims} dimensions, ${v.ms} ms)`,
        });
      });
    } catch (e) {
      errorToast(e, `Could not verify ${r.label}`);
    }
  };

  const remove = async () => {
    if (!removing) return;
    const { row } = removing;
    try {
      const r = await execute(client, "models.remove", { model: row.id }, fx);
      toast({
        tone: "success",
        title: `${row.label} removed`,
        detail: r.removed === "registration" ? "Its folder stays on disk" : `${size(r.freedMB)} freed`,
      });
    } catch (e) {
      errorToast(e, `Could not remove ${row.label}`);
    } finally {
      setRemoving(null);
    }
  };

  const applyAdvice = async (a: AdviceRow) => {
    if ("pack" in a.to) {
      const row = o.packs?.find((p) => p.id === (a.to as { pack: string }).pack);
      if (row) void planPack(row);
      return;
    }
    try {
      const out = await execute(client, "models.use", a.to, fx);
      toast({ tone: "success", title: "Advice applied", detail: out.reindex ? "Indexing again" : "" });
      if (out.indexJob) o.start(out.indexJob, "index", "rag-index", "Indexing the documents");
    } catch (e) {
      errorToast(e, "Could not apply the advice");
    }
  };

  const dismiss = (a: AdviceRow) =>
    void execute(client, "models.dismissAdvice", { id: a.id }, { invalidates: [["models.advice"]] }).catch((e) =>
      errorToast(e, "Could not dismiss the advice"),
    );

  const measure = async (row: PackRow) => {
    setBenches((b) => ({ ...b, [row.id]: { jobId: "", status: "running" } }));
    try {
      const { jobId } = await execute(client, "models.measure", { pack: row.id }, { invalidates: [["jobs.list"]] });
      setBenches((b) => ({ ...b, [row.id]: { jobId, status: "running" } }));
      o.start(jobId, `${MEASURE}${row.id}`, "models-measure", "Measuring");
    } catch (e) {
      setBenches((b) => ({ ...b, [row.id]: { jobId: "", status: "failed", error: (e as Error).message } }));
    }
  };

  const benchEnded = (pack: string, jobId: string, status: Bench["status"], error?: string) =>
    setBenches((b) => ({ ...b, [pack]: { jobId, status, error } }));

  return {
    fitAsk,
    setFitAsk,
    folder,
    setFolder,
    plan,
    setPlan,
    planning,
    removing,
    setRemoving,
    benches,
    planPack,
    choosePack,
    confirmPack,
    install,
    chooseModel,
    verify,
    remove,
    applyAdvice,
    dismiss,
    measure,
    benchEnded,
  };
}
