import { useCallback, useEffect, useRef, useState } from "react";
import type { Fit, Job } from "../../../core/types.ts";
import { ApiError, call, run, waitJob } from "../../api.ts";
import { Button, Icon, Skeleton } from "../../components/legacy/index.ts";
import { useApp } from "../../lib/app.ts";
import { message } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { AddFolder } from "./models/AddFolder.tsx";
import { AdviceBanner } from "./models/AdviceBanner.tsx";
import { type Bench, BenchDialog } from "./models/BenchDialog.tsx";
import { ConfirmDialog } from "./models/ConfirmDialog.tsx";
import { CustomCard } from "./models/CustomCard.tsx";
import type { AdviceRow, CatalogRow, Installed, Op, PackRow, RagStatus, SetDirOut, UsePackOut } from "./models/data.ts";
import { isInstalled, size } from "./models/data.ts";
import { FitConfirm } from "./models/FitConfirm.tsx";
import { FolderDialog } from "./models/FolderDialog.tsx";
import { ModelsTable } from "./models/ModelsTable.tsx";
import { OpLine } from "./models/OpLine.tsx";
import { PackCard } from "./models/PackCard.tsx";
import { PackPlanDialog } from "./models/PackPlanDialog.tsx";

type FitAsk = { title: string; fit: Fit; lighter: string | null; go: () => void; lighterGo: () => void };
type FolderAsk = { needMB: number; next?: () => void };
type Plan = { row: PackRow; out: UsePackOut };
type UseOut = { fit: Fit; reindex: boolean; indexJob: string | null; lighter: string | null };

const GLOBAL_OPS = ["index", "dir", "llama.cpp"];

const pctOf = (done?: number, total?: number) => (total ? Math.round(((done ?? 0) / total) * 100) : null);
const packLabel = (id: string) => `${id.charAt(0).toUpperCase()}${id.slice(1)}`;

export function ModelsSection() {
  const app = useApp();
  const hasProject = !!app.info;
  const [packs, setPacks] = useState<PackRow[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogRow[] | null>(null);
  const [installed, setInstalled] = useState<Installed[]>([]);
  const [advice, setAdvice] = useState<AdviceRow[]>([]);
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [dir, setDir] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [ops, setOps] = useState<Op[]>([]);
  const [open, setOpen] = useState(false);
  const [fitAsk, setFitAsk] = useState<FitAsk | null>(null);
  const [folder, setFolder] = useState<FolderAsk | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [removing, setRemoving] = useState<{ row: CatalogRow; inst: Installed } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [benches, setBenches] = useState<Record<string, Bench>>({});
  const [benchOf, setBenchOf] = useState<string | null>(null);
  const shownBench = useRef<string | null>(null);
  const table = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [c, l, p, a, s, d] = await Promise.allSettled([
      call<CatalogRow[]>("models.catalog", {}),
      call<Installed[]>("models.list", {}),
      hasProject ? call<PackRow[]>("models.packs", {}) : Promise.resolve([]),
      hasProject ? call<AdviceRow[]>("models.advice", {}) : Promise.resolve([]),
      hasProject ? call<RagStatus>("rag.status", {}) : Promise.resolve(null),
      call<{ dir: string | null }>("models.dirs", {}),
    ]);
    if (c.status === "fulfilled") setCatalog(c.value ?? []);
    if (l.status === "fulfilled") setInstalled(l.value ?? []);
    if (p.status === "fulfilled") setPacks(p.value ?? []);
    if (a.status === "fulfilled") setAdvice(a.value ?? []);
    if (s.status === "fulfilled") setStatus(s.value);
    if (d.status === "fulfilled") setDir(d.value?.dir ?? null);
    const failed = [c, p].find((x) => x.status === "rejected") as PromiseRejectedResult | undefined;
    setError(failed ? message(failed.reason) : "");
  }, [hasProject]);

  const patchOp = useCallback(
    (key: string, p: Partial<Op>) => setOps((o) => o.map((x) => (x.key === key ? { ...x, ...p } : x))),
    [],
  );
  const dropOp = useCallback((key: string) => setOps((o) => o.filter((x) => x.key !== key)), []);

  const track = useCallback(
    (jobId: string, key: string, label: string, then?: (result: unknown) => void) => {
      setOps((o) => [...o.filter((x) => x.key !== key), { key, jobId, label, message: "Starting", pct: null }]);
      waitJob(jobId, (e) => {
        if (e.type === "progress") patchOp(key, { message: e.message, pct: pctOf(e.done, e.total) });
      })
        .then((r) => {
          dropOp(key);
          then?.(r);
        })
        .catch((e) => {
          dropOp(key);
          errorToast(e, `${label}: stopped`);
        })
        .finally(() => void load());
    },
    [load, patchOp, dropOp],
  );

  const followBench = useCallback(
    (packId: string, jobId: string, title: string) => {
      const patch = (p: Partial<Bench>) =>
        setBenches((b) => (b[packId]?.jobId === jobId ? { ...b, [packId]: { ...b[packId], ...p } } : b));
      setBenches((b) => ({ ...b, [packId]: { jobId, status: "running", message: "Starting", pct: null } }));
      waitJob(jobId, (e) => {
        if (e.type === "progress") patch({ message: e.message, pct: pctOf(e.done, e.total) });
      })
        .then(() => {
          patch({ status: "done" });
          if (shownBench.current !== packId) toast({ kind: "ok", title: `${title} measured` });
        })
        .catch((e) => {
          const cancelled = !!(e as { cancelled?: boolean }).cancelled;
          patch({ status: cancelled ? "cancelled" : "failed", error: message(e) });
          if (!cancelled && shownBench.current !== packId) errorToast(e, `${title}: the measure stopped`);
        })
        .finally(() => void load());
    },
    [load],
  );

  const afterPack = useCallback(
    (r: unknown) => {
      const ix = (r as { indexJob?: string | null } | null)?.indexJob;
      if (ix) track(ix, "index", "Indexing the documents");
    },
    [track],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per project; running jobs are picked up again
  useEffect(() => {
    void load();
    if (!hasProject) return;
    call<Job[]>("jobs.list", { running: true })
      .then((jobs) => {
        for (const j of jobs ?? []) {
          if (j.kind === "models-usePack") track(j.id, j.subject, `Installing ${packLabel(j.subject)}`, afterPack);
          else if (j.kind === "models-pull") track(j.id, j.subject, `Downloading ${j.subject}`);
          else if (j.kind === "models-dir")
            track(
              j.id,
              "dir",
              j.subject.startsWith("copy ")
                ? "Copying the models"
                : j.subject.startsWith("move ")
                  ? "Moving the models"
                  : "Changing the models folder",
            );
          else if (j.kind === "rag-index") track(j.id, "index", "Indexing the documents");
          else if (j.kind === "models-measure") followBench(j.subject, j.id, `${packLabel(j.subject)} pack`);
        }
      })
      .catch(() => {});
  }, [app.info?.dir]);

  const label = useCallback((id: string) => catalog?.find((c) => c.id === id)?.label ?? id, [catalog]);
  const cancel = (jobId: string) => call("jobs.cancel", { id: jobId }).catch((e) => errorToast(e, "Could not cancel"));

  const showBench = (id: string | null) => {
    shownBench.current = id;
    setBenchOf(id);
  };

  const measure = async (row: PackRow) => {
    showBench(row.id);
    if (benches[row.id]?.status === "running") return;
    setBenches((b) => ({ ...b, [row.id]: { jobId: "", status: "running", message: "Starting", pct: null } }));
    try {
      const out = await call<{ jobId: string }>("models.measure", { pack: row.id });
      followBench(row.id, out.jobId, `${row.label} pack`);
    } catch (e) {
      setBenches((b) => ({
        ...b,
        [row.id]: { jobId: "", status: "failed", message: "", pct: null, error: message(e) },
      }));
    }
  };

  const planPack = async (row: PackRow) => {
    setPlanning(true);
    try {
      const out = await call<UsePackOut>("models.planPack", { pack: row.id });
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
    if (row.fit && row.fit.verdict !== "fits") {
      const lighter = packs?.find((p) => p.id === row.lighter) ?? null;
      setFitAsk({
        title: `The ${row.label} pack`,
        fit: row.fit,
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
      const { jobId } = await call<{ jobId: string }>("models.usePack", { pack: row.id, downloadOnly });
      setPlan(null);
      if (downloadOnly) {
        track(jobId, row.id, `Downloading ${row.label}`, () =>
          toast({ kind: "ok", title: `${row.label} pack downloaded`, detail: "Use this pack to switch to it." }),
        );
        return;
      }
      toast({ kind: "ok", title: `${row.label} pack chosen for this project` });
      track(jobId, row.id, `Installing ${row.label}`, afterPack);
      void load();
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
    if (!chosen && dir === null) {
      setFolder({ needMB: r.sizeMB, next: () => void install(r, true) });
      return;
    }
    try {
      const out = await call<{ jobId?: string }>("models.pull", { model: r.id });
      if (out?.jobId) track(out.jobId, r.id, `Downloading ${r.label}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "models-dir-unset")
        setFolder({ needMB: r.sizeMB, next: () => void install(r, true) });
      else errorToast(e, `Could not install ${r.label}`);
    }
  };

  const chooseModel = async (r: CatalogRow) => {
    const current = status && status.embedding !== "none" ? status.embedding : undefined;
    if (r.kind === "reranker" && !current) {
      toast({
        kind: "error",
        title: "Choose an embedding model first",
        detail: "A reranker only reorders its results.",
      });
      return;
    }
    const pick = r.kind === "embedding" ? { embedding: r.id } : { reranker: r.id };
    const go = async () => {
      try {
        const out = await call<UseOut>("models.use", pick);
        toast({ kind: "ok", title: `${r.label} in use for this project`, detail: out.reindex ? "Indexing again" : "" });
        await load();
        if (out.indexJob) track(out.indexJob, "index", "Indexing the documents");
      } catch (e) {
        errorToast(e, `Could not use ${r.label}`);
      }
    };
    try {
      const dry = await call<UseOut>("models.use", { ...pick, dryRun: true });
      if (dry.fit.verdict === "fits") return void go();
      const lighter = catalog?.find((c) => c.id === dry.lighter) ?? null;
      setFitAsk({
        title: r.label,
        fit: dry.fit,
        lighter: lighter?.label ?? null,
        go: () => void go(),
        lighterGo: () => lighter && (isInstalled(lighter.state) ? void chooseModel(lighter) : void install(lighter)),
      });
    } catch (e) {
      errorToast(e, `Could not check whether ${r.label} fits`);
    }
  };

  const verify = async (r: CatalogRow) => {
    setOps((o) => [...o, { key: r.id, jobId: "", label: "Verifying", message: "Loading the model", pct: null }]);
    try {
      const v = await run<{ ok: boolean; dims: number; ms: number; message: string }>("models.verify", {
        model: r.id,
      });
      toast({
        kind: v.ok ? "ok" : "error",
        title: v.ok ? `${r.label} works` : `${r.label} failed its check`,
        detail: `${v.message} (${v.dims} dimensions, ${v.ms} ms)`,
      });
    } catch (e) {
      errorToast(e, `Could not verify ${r.label}`);
    } finally {
      dropOp(r.id);
      void load();
    }
  };

  const remove = async () => {
    if (!removing) return;
    const { row } = removing;
    setRemoving(null);
    try {
      const r = await call<{ removed: string; freedMB: number }>("models.remove", { model: row.id });
      toast({
        kind: "ok",
        title: `${row.label} removed`,
        detail: r.removed === "registration" ? "Its folder stays on disk" : `${size(r.freedMB)} freed`,
      });
    } catch (e) {
      errorToast(e, `Could not remove ${row.label}`);
    }
    void load();
  };

  const applyAdvice = async (a: AdviceRow) => {
    if ("pack" in a.to) {
      const row = packs?.find((p) => p.id === (a.to as { pack: string }).pack);
      if (row) return void planPack(row);
    } else
      try {
        const out = await call<UseOut>("models.use", a.to);
        toast({ kind: "ok", title: "Advice applied", detail: out.reindex ? "Indexing again" : "" });
        await load();
        if (out.indexJob) track(out.indexJob, "index", "Indexing the documents");
      } catch (e) {
        errorToast(e, "Could not apply the advice");
      }
  };

  const dismiss = async (a: AdviceRow) => {
    try {
      await call("models.dismissAdvice", { id: a.id });
      setAdvice((x) => x.filter((y) => y.id !== a.id));
    } catch (e) {
      errorToast(e, "Could not dismiss the advice");
    }
  };

  const folderApplied = (d: string, jobId: string | null, action: SetDirOut["action"]) => {
    const next = folder?.next;
    setFolder(null);
    setDir(d);
    if (jobId) track(jobId, "dir", action === "move" ? "Moving the models" : "Copying the models");
    else toast({ kind: "ok", title: "Models folder saved", detail: d });
    next?.();
  };

  const inUse = status && status.embedding !== "none" ? [status.embedding, status.reranker ?? ""].filter(Boolean) : [];
  const customActive = !!packs && !packs.some((p) => p.active) && status?.activation === "machine";
  const busy = ops.some((o) => !GLOBAL_OPS.includes(o.key) || o.key === "dir") || planning;
  const packBusy = ops.some((o) => o.key === "dir") || planning;
  const globalOps = ops.filter((o) => GLOBAL_OPS.includes(o.key));
  const top = advice[0];
  const benchPack = packs?.find((p) => p.id === benchOf) ?? null;
  const here = installed.length;

  return (
    <section className="card sect" id="settings-models" aria-labelledby="s-models">
      <h2 id="s-models" className="h sect-title">
        Models
      </h2>
      <div className="models-dir">
        <Icon name="folder" />
        <span className="muted">Models folder</span>
        {dir === undefined && hasProject ? (
          <Skeleton w={160} h={12} />
        ) : dir ? (
          <span className="mono" title={dir}>
            {dir}
          </span>
        ) : (
          <span className="muted">{hasProject ? "not chosen yet" : "see a project"}</span>
        )}
        <Button size="sm" tone="quiet" disabled={busy} onClick={() => setFolder({ needMB: 0 })}>
          {dir ? "Change…" : "Choose…"}
        </Button>
      </div>
      <p className="muted">
        Search models run on this PC; documents never leave it. A pack picks the best models this PC can run; your
        colleagues choose their own.
      </p>
      {globalOps.map((o) => (
        <OpLine key={o.key} op={o} onCancel={cancel} />
      ))}
      {error && (
        <div className="problem" role="alert">
          <span className="sev s-err">
            <Icon name="error" />
            The models could not be read
          </span>
          <p>{error}</p>
          <div className="problem-actions">
            <Button size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        </div>
      )}
      {top && (
        <AdviceBanner
          advice={top}
          label={label}
          busy={packBusy}
          onApply={() => void applyAdvice(top)}
          onDismiss={() => void dismiss(top)}
        />
      )}
      {!hasProject ? (
        <p className="muted">Open a project to choose its search pack. The models below are shared by every project.</p>
      ) : !packs ? (
        <div className="packs" role="status" aria-busy="true" aria-label="Loading the packs">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="card pack">
              <Skeleton w={90} h={18} />
              <Skeleton w="90%" h={12} />
              <Skeleton w="70%" h={12} />
              <Skeleton w="60%" h={22} />
              <Skeleton w={110} h={30} />
            </div>
          ))}
        </div>
      ) : (
        <div className="packs">
          {packs.map((p) => (
            <PackCard
              key={p.id}
              pack={p}
              label={label}
              op={ops.find((o) => o.key === p.id) ?? null}
              busy={packBusy}
              onUse={() => choosePack(p)}
              onCancel={cancel}
              bench={benches[p.id]}
              onMeasure={() => void measure(p)}
            />
          ))}
          <CustomCard
            active={customActive}
            embedding={status?.embedding !== "none" ? (status?.embedding ?? null) : null}
            reranker={status?.reranker ?? null}
            label={label}
            onChoose={() => {
              setOpen(true);
              requestAnimationFrame(() => table.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }));
            }}
          />
        </div>
      )}
      <div className="models-fold" ref={table}>
        <button
          type="button"
          className="fold-btn"
          aria-label="Model catalog"
          aria-expanded={open}
          aria-controls="models-table"
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name={open ? "down" : "right"} />
          <span className="h">Models</span>
          <span className="muted">
            {catalog ? `${catalog.length} in the catalog · ${here} on this PC` : "Loading the catalog"}
          </span>
        </button>
        {open && (
          <div id="models-table" className="models-body">
            {!catalog ? (
              <Skeleton h={120} />
            ) : (
              <ModelsTable
                rows={catalog}
                installed={installed}
                inUse={inUse}
                ops={ops}
                busy={busy}
                onInstall={(r) => void install(r)}
                onUse={(r) => void chooseModel(r)}
                onVerify={(r) => void verify(r)}
                onRemove={(row, inst) => setRemoving({ row, inst })}
                onCancel={cancel}
              />
            )}
            <AddFolder onAdded={() => void load()} />
          </div>
        )}
      </div>
      {fitAsk && (
        <FitConfirm
          title={fitAsk.title}
          fit={fitAsk.fit}
          lighter={fitAsk.lighter}
          onClose={() => setFitAsk(null)}
          onUse={() => {
            setFitAsk(null);
            fitAsk.go();
          }}
          onLighter={() => {
            setFitAsk(null);
            fitAsk.lighterGo();
          }}
        />
      )}
      {plan && (
        <PackPlanDialog
          pack={plan.row}
          out={plan.out}
          label={label}
          busy={planning}
          onClose={() => setPlan(null)}
          onConfirm={() => void confirmPack()}
          onChangeFolder={() => {
            const row = plan.row;
            setPlan(null);
            setFolder({ needMB: 0, next: () => void planPack(row) });
          }}
        />
      )}
      {benchPack && (
        <BenchDialog
          pack={benchPack}
          bench={benches[benchPack.id]}
          label={label}
          onCancel={cancel}
          onAgain={() => void measure(benchPack)}
          onClose={() => showBench(null)}
        />
      )}
      {folder && (
        <FolderDialog
          current={dir ?? null}
          needMB={folder.needMB}
          onApplied={folderApplied}
          onClose={() => setFolder(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.row.label}?`}
          confirm={removing.inst.via === "path" ? "Forget it" : "Delete it"}
          onConfirm={() => void remove()}
          onClose={() => setRemoving(null)}
        >
          <p>
            {removing.inst.via === "download"
              ? `Its files (${size(removing.inst.sizeMB)}) are deleted from ${removing.inst.where}.`
              : `Testimus forgets it; the folder ${removing.inst.where} stays on disk.`}
          </p>
          <p className="muted">
            Vector spaces built with it stay in the index until you drop them (Settings › Search).
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
