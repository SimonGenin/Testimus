import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Fit } from "../../../../core/types.ts";
import { ApiError } from "../../../lib/data/client.ts";
import { execute, key, type Prefix, read } from "../../../lib/data/query.ts";
import { errorToast, toast } from "../../../lib/toast.ts";
import type { CatalogRow, Installed, PackRow, RagStatus, UsePackOut } from "./data.ts";
import { isInstalled, size } from "./data.ts";

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
/** the plan of a single model's choice, confirmed before it acts (as a pack's plan is): what it downloads or changes */
export type ModelAsk = {
  title: string;
  text: string;
  consequences: [number | string, string][];
  verb: string;
  icon: "download" | "check";
  go: () => Promise<void>;
};
/** accept: « Use anyway » was chosen on the way, so the system check counts this fit as accepted */
export type Plan = { row: PackRow; out: UsePackOut; accept?: boolean };

type Pick = { embedding?: string; reranker?: string | null; accept?: boolean };

const NO_FOLDER = "models-dir-unset";

/** what downloading, checking or removing a model needs of it: a search model's catalog row, or a transcription model */
export type ModelRef = { id: string; label: string; sizeMB: number; fit?: Fit | null; kind?: string };

type Start = (jobId: string, key: string, kind: string, label: string, then?: (result: unknown) => void) => void;

export const MODEL_READS: Prefix[] = [
  ["models.list"],
  ["models.catalog"],
  ["models.packs"],
  ["models.usage"],
  ["models.advice"],
  ["models.speech"],
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
  /** a pack with downloads is downloaded and then used in the same job (First launch), not only downloaded */
  thenUse?: boolean;
  /** the pack's job started: the caller says so (First launch) instead of following it here */
  onPackStarted?: (row: PackRow, jobId: string, out: UsePackOut) => void;
}) {
  const client = useQueryClient();
  const [fitAsk, setFitAsk] = useState<FitAsk | null>(null);
  const [ask, setAsk] = useState<ModelAsk | null>(null);
  const [folder, setFolder] = useState<FolderAsk | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [removing, setRemoving] = useState<{ row: ModelRef; inst: Installed } | null>(null);
  const fx = { invalidates: MODEL_READS };

  const planPack = async (row: PackRow, accept = false) => {
    setPlanning(true);
    try {
      // ponytail: a plan is asked afresh each time (the folder or the models may have changed since)
      client.removeQueries({ queryKey: key("models.planPack", { pack: row.id }) as unknown as readonly unknown[] });
      const out = await read(client, "models.planPack", { pack: row.id });
      if (out.plan.download.length && !out.plan.dir) {
        setFolder({
          needMB: out.plan.download.reduce((a, d) => a + d.sizeMB, 0),
          next: () => void planPack(row, accept),
        });
        return;
      }
      setPlan({ row, out, accept });
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
        go: () => void planPack(row, true),
        lighterGo: () => lighter && choosePack(lighter),
      });
    } else void planPack(row);
  };

  const confirmPack = async () => {
    if (!plan) return;
    const { row } = plan;
    const downloadOnly = !o.thenUse && plan.out.plan.download.length > 0;
    setPlanning(true);
    try {
      const { jobId } = await execute(
        client,
        "models.usePack",
        { pack: row.id, downloadOnly, ...(plan.accept ? { accept: true } : {}) },
        fx,
      );
      setPlan(null);
      if (o.onPackStarted) {
        o.onPackStarted(row, jobId, plan.out);
        return;
      }
      if (downloadOnly) {
        o.start(jobId, row.id, "models-usePack", `Downloading ${row.label}`, () =>
          toast({ tone: "success", title: `${row.label} pack downloaded`, detail: "Use this pack to switch to it." }),
        );
        return;
      }
      toast({ tone: "success", title: `${row.label} pack chosen for this project` });
      o.start(jobId, row.id, "models-usePack", `Installing ${row.label}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === NO_FOLDER) {
        setPlan(null);
        setFolder({
          needMB: plan.out.plan.download.reduce((a, d) => a + d.sizeMB, 0),
          next: () => void planPack(row, plan.accept),
        });
      } else errorToast(e, `Could not ${downloadOnly ? "download" : "use"} the ${row.label} pack`);
    } finally {
      setPlanning(false);
    }
  };

  // ponytail: then — the model is used once its download is done (« Download and use »)
  const pull = async (r: ModelRef, then?: () => void) => {
    try {
      const out = await execute(client, "models.pull", { model: r.id }, fx);
      setAsk(null);
      o.start(out.jobId, r.id, "models-pull", `Downloading ${r.label}`, then && (() => then()));
    } catch (e) {
      if (!(e instanceof ApiError && e.code === NO_FOLDER)) throw e;
      setAsk(null);
      setFolder({ needMB: r.sizeMB, next: () => askPull(r, then) });
    }
  };

  const askPull = (r: ModelRef, then?: () => void) =>
    setAsk({
      title: then ? `Download and use ${r.label}?` : `Download ${r.label}?`,
      text: `Onto this PC${o.dir ? `, into ${o.dir}` : ""}. ${then ? "It is used as soon as it is downloaded." : "Nothing changes for the project until you use it."}`,
      consequences: [[size(r.sizeMB), "to download"]],
      verb: `Download ${size(r.sizeMB)}`,
      icon: "download",
      go: () => pull(r, then),
    });

  const install = (r: ModelRef, then?: () => void, chosen = false) => {
    if (!chosen && o.dir === null) {
      setFolder({ needMB: r.sizeMB, next: () => install(r, then, true) });
      return;
    }
    if (r.fit && r.fit.verdict !== "fits")
      setFitAsk({
        name: r.label,
        short: r.label,
        fit: r.fit,
        processorOnly: false,
        lighter: null,
        go: () => askPull(r, then),
        lighterGo: () => {},
      });
    else askPull(r, then);
  };

  const applyModels = async (name: string, pick: Pick) => {
    const out = await execute(client, "models.use", pick, fx);
    setAsk(null);
    toast({
      tone: "success",
      title: `${name} in use for this project`,
      detail: out.reindex ? "Indexing again" : "",
    });
    if (out.indexJob) o.start(out.indexJob, "index", "rag-index", "Indexing the documents");
  };

  // ponytail: download: the model is not on this PC yet — the plan says so, and the download comes first, then the use
  const askUse = (name: string, pick: Pick, reindex: boolean, download?: CatalogRow) => {
    const docs = o.status?.docs?.length ?? 0;
    const apply = () => applyModels(name, pick).catch((e) => errorToast(e, `Could not use ${name}`));
    setAsk({
      title: download ? `Download and use ${name}?` : `Use ${name} for this project?`,
      text: "On this PC only: nothing changes for your colleagues.",
      consequences: [
        ...(download ? [[size(download.sizeMB), "to download first"] as [string, string]] : []),
        reindex
          ? [
              docs || "The",
              `${docs === 1 ? "document is" : "documents are"} indexed again with it (a job; search keeps working on words meanwhile)`,
            ]
          : ["No", "index to rebuild: the documents keep their vectors"],
      ],
      verb: download ? `Download ${size(download.sizeMB)} and use` : `Use ${name}`,
      icon: download ? "download" : "check",
      go: () => (download ? pull(download, () => void apply()) : applyModels(name, pick)),
    });
  };

  // ponytail: a single model goes the way a pack goes — does it fit (FitConfirm when not), then its plan, confirmed
  const chooseModels = async (
    name: string,
    pick: Pick,
    lighterOf: (id: string | null) => { label: string; go: () => void } | null = () => null,
    download?: CatalogRow,
  ) => {
    try {
      const dry = await read(client, "models.use", { ...pick, dryRun: true });
      if (dry.fit.verdict === "fits") return askUse(name, pick, dry.reindex, download);
      const lighter = lighterOf(dry.lighter);
      setFitAsk({
        name,
        short: name,
        fit: dry.fit,
        processorOnly: false,
        lighter: lighter?.label ?? null,
        go: () => askUse(name, { ...pick, accept: true }, dry.reindex, download),
        lighterGo: () => lighter?.go(),
      });
    } catch (e) {
      errorToast(e, `Could not check whether ${name} fits`);
    }
  };

  // ponytail: a reranker of null is « None »; a model not on this PC is downloaded first, the folder asked for first
  const chooseModel = async (r: CatalogRow | null, chosen = false) => {
    const current = o.status && o.status.embedding !== "none" ? o.status.embedding : undefined;
    if ((!r || r.kind === "reranker") && !current) {
      toast({
        tone: "danger",
        title: "Choose an embedding model first",
        detail: "A reranker only reorders its results.",
      });
      return;
    }
    if (!r) return chooseModels("No reranker", { reranker: null });
    const download = isInstalled(r.state) ? undefined : r;
    if (download && !chosen && o.dir === null) {
      setFolder({ needMB: r.sizeMB, next: () => void chooseModel(r, true) });
      return;
    }
    const pick = r.kind === "embedding" ? { embedding: r.id } : { reranker: r.id };
    await chooseModels(
      r.label,
      pick,
      (id) => {
        const lighter = o.catalog?.find((c) => c.id === id);
        return lighter ? { label: lighter.label, go: () => void chooseModel(lighter) } : null;
      },
      download,
    );
  };

  const verify = async (r: ModelRef) => {
    try {
      const { jobId } = await execute(client, "models.verify", { model: r.id }, fx);
      o.start(jobId, r.id, "models-verify", `Verifying ${r.label}`, (out) => {
        const v = out as { ok: boolean; dims: number; ms: number; message: string };
        toast({
          tone: v.ok ? "success" : "danger",
          title: v.ok ? `${r.label} works` : `${r.label} failed its check`,
          detail: v.dims ? `${v.message} (${v.dims} dimensions, ${v.ms} ms)` : v.message,
        });
      });
    } catch (e) {
      errorToast(e, `Could not verify ${r.label}`);
    }
  };

  const remove = async () => {
    if (!removing) return;
    const { row } = removing;
    const r = await execute(client, "models.remove", { model: row.id }, fx);
    setRemoving(null);
    toast({
      tone: "success",
      title: `${row.label} removed`,
      detail: r.removed === "registration" ? "Its folder stays on disk" : `${size(r.freedMB)} freed`,
    });
  };

  return {
    fitAsk,
    setFitAsk,
    ask,
    setAsk,
    folder,
    setFolder,
    plan,
    setPlan,
    planning,
    removing,
    setRemoving,
    planPack,
    choosePack,
    confirmPack,
    install,
    chooseModel,
    verify,
    remove,
  };
}
