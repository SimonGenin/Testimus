import { useEffect, useState } from "react";
import { call } from "../../api.ts";
import { Badge, Button, Icon, Skeleton } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { useDraft } from "../../lib/drafts.ts";
import { cx, message } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import type { CatalogRow, Hardware, PackRow, UsePackOut } from "../settings/models/data.ts";
import { machineSummary, size, suggestPack } from "../settings/models/data.ts";
import { FitChip, PROCESSOR_ONLY } from "../settings/models/FitChip.tsx";
import { FolderDialog } from "../settings/models/FolderDialog.tsx";

const UNTESTED = "Never run on this system yet: Testimus tries it after the download and refuses it if it fails.";

export function PackStep({ onBack }: { onBack: () => void }) {
  const app = useApp();
  const [packs, setPacks] = useState<PackRow[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [chosen, setChosen, suggest] = useDraft("setup.pack", "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [machine, setMachine] = useState<Hardware | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [folderNeed, setFolderNeed] = useState<number | null>(null);
  const hasProject = !!app.info;

  useEffect(() => {
    if (!hasProject) return;
    Promise.all([
      call<PackRow[]>("models.packs", {}),
      call<CatalogRow[]>("models.catalog", {}).catch(() => [] as CatalogRow[]),
    ])
      .then(([p, c]) => {
        setPacks(p ?? []);
        setCatalog(c ?? []);
      })
      .catch((e) => setError(message(e)));
  }, [hasProject]);

  const analyse = async () => {
    setAnalysing(true);
    try {
      const hw = await call<Hardware>("models.hardware", { refresh: true });
      const p = await call<PackRow[]>("models.packs", {});
      const s = p.find((x) => x.suggested)?.id ?? suggestPack(p, hw, catalog);
      setPacks(p);
      setMachine(hw);
      setSuggested(s);
      suggest(s);
    } catch (e) {
      errorToast(e, "Could not analyse this machine");
    } finally {
      setAnalysing(false);
    }
  };

  const label = (id: string) => catalog.find((c) => c.id === id)?.label ?? id;
  const pack = packs?.find((p) => p.id === chosen);
  const done = () => app.navigate("documents");

  const use = async () => {
    if (!pack) return;
    setBusy(true);
    try {
      const plan = await call<UsePackOut>("models.usePack", { pack: pack.id, dryRun: true });
      if (plan.plan.download.length && !plan.plan.dir) {
        setFolderNeed(plan.plan.download.reduce((a, d) => a + d.sizeMB, 0));
        return;
      }
      await call<UsePackOut>("models.usePack", { pack: pack.id });
      toast({
        kind: "ok",
        title: `${pack.label} pack chosen`,
        detail: plan.plan.download.length ? "Downloading in the background: see Jobs" : "Indexing follows",
      });
      done();
    } catch (e) {
      errorToast(e, `Could not use the ${pack.label} pack`);
    } finally {
      setBusy(false);
    }
  };

  if (!hasProject)
    return (
      <section className="setup-form" aria-labelledby="pack-h">
        <h1 id="pack-h" className="h setup-title">
          Choose how documents are searched
        </h1>
        <p className="muted">Open or create a project first: the pack is chosen per project, on this PC.</p>
        <div className="setup-actions">
          <Button onClick={onBack}>Back to Project</Button>
        </div>
      </section>
    );

  return (
    <section className="setup-form" aria-labelledby="pack-h">
      <h1 id="pack-h" className="h setup-title">
        Choose how documents are searched
      </h1>
      <p className="muted">
        Search runs on this PC and documents never leave it. Analyse the machine to see which packs it runs and the most
        it runs comfortably; you can change it any time in Settings › Models.
      </p>
      <div className="machinecheck" aria-live="polite">
        {machine ? (
          <ul className="machinecheck-facts" aria-label="This machine">
            {machineSummary(machine).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">Not analysed yet: until then, no pack is said to fit.</p>
        )}
        <Button icon="system" disabled={analysing || !packs} onClick={() => void analyse()}>
          {analysing ? "Analysing…" : machine ? "Analyse again" : "Analyse my machine"}
        </Button>
      </div>
      {error ? (
        <div className="problem" role="alert">
          <span className="sev s-err">
            <Icon name="error" />
            The packs could not be read
          </span>
          <p>{error}</p>
        </div>
      ) : !packs ? (
        <div className="packpick" role="status" aria-busy="true" aria-label="Loading the packs">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={64} r={8} />
          ))}
        </div>
      ) : (
        <fieldset className="packpick" aria-label="Search packs">
          {packs.map((p) => (
            <label key={p.id} className={cx("packopt", chosen === p.id && "packopt-on", !p.available && "packopt-off")}>
              <input
                type="radio"
                name="pack"
                checked={chosen === p.id}
                disabled={!p.available}
                onChange={() => setChosen(p.id)}
                aria-label={`${p.label} pack`}
              />
              <span className="packopt-body">
                <span className="packopt-head">
                  <span className="h packopt-title">{p.label}</span>
                  {p.id === suggested && (
                    <Badge tone="info" icon="check" small>
                      Suggested for this PC
                    </Badge>
                  )}
                  {p.active && (
                    <Badge tone="ok" small>
                      In use
                    </Badge>
                  )}
                  <span className="spacer" />
                  {machine && <FitChip fit={p.fit} processorOnly={p.processorOnly} />}
                </span>
                <span className="muted">{p.intent}</span>
                <span className="packopt-models">
                  {p.available && p.embedding
                    ? `${label(p.embedding)}${p.reranker ? ` + ${label(p.reranker)}` : ""} · ${
                        p.downloadMB ? `${size(p.downloadMB)} to download` : "nothing to download"
                      }`
                    : p.fit?.verdict === "unsupported"
                      ? p.fit.message
                      : `Not available on this PC${p.skipped[0] ? `: ${p.skipped[0]}` : ""}`}
                </span>
                {machine && p.available && (p.processorOnly || p.fit?.verdict === "untested") && (
                  <span className="sev s-warn packopt-warn">
                    <Icon name="warning" />
                    {[p.processorOnly && PROCESSOR_ONLY, p.fit?.verdict === "untested" && UNTESTED]
                      .filter(Boolean)
                      .join(" ")}
                  </span>
                )}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="setup-actions">
        <Button tone="quiet" icon="left" onClick={onBack}>
          Back
        </Button>
        <span className="spacer" />
        <Button tone="quiet" onClick={done}>
          Skip for now
        </Button>
        <Button tone="primary" disabled={!pack || busy} onClick={() => void use()}>
          {pack ? `Use ${pack.label}` : "Use this pack"}
        </Button>
      </div>
      {folderNeed !== null && (
        <FolderDialog
          current={null}
          needMB={folderNeed}
          onClose={() => setFolderNeed(null)}
          onApplied={() => {
            setFolderNeed(null);
            void use();
          }}
        />
      )}
    </section>
  );
}
