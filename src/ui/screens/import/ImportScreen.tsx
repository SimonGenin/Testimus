import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanOp } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { ProblemPanel } from "../../components/shell/ProblemPanel.tsx";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Badge, Button, Icon, Modal, Severity, Skeleton } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { baseName, desktop, pickFiles } from "../../lib/desktop.ts";
import { dropDraft, useDraft } from "../../lib/drafts.ts";
import { cx, plural } from "../../lib/format.ts";
import { parseCsvRows } from "../../lib/requirements.ts";
import { errorToast, toast } from "../../lib/toast.ts";

type CsvTest = { summary: string; folder: string; steps: { fields: Record<string, string> }[]; row: number };
type Preview = {
  headers: string[];
  mapping: Record<string, string>;
  tests: CsvTest[];
  warnings: string[];
  written: string[];
  plan?: PlanOp[];
  jobId?: string;
  warning?: string;
};

export const stillImporting = (r: Preview): { jobId: string; warning: string } | null =>
  r.jobId
    ? {
        jobId: r.jobId,
        warning:
          r.warning ??
          r.warnings.find((w) => /still importing/i.test(w)) ??
          `Xray is still importing (job ${r.jobId}).`,
      }
    : null;
type Mode = "local" | "direct";
type CsvFile = { name: string; text?: string; path?: string };

const csvSource = (f: CsvFile) => (f.path ? { file: f.path } : { text: f.text });

export function firstValues(p: Preview): string[] {
  const t = p.tests[0];
  const fields = t?.steps[0]?.fields ?? {};
  return p.headers.map((h) => {
    const to = p.mapping[h];
    if (!t || !to) return "";
    if (to === "#summary") return t.summary;
    if (to === "#folder") return t.folder;
    return to.startsWith("#") ? "" : (fields[to] ?? "");
  });
}

const SPECIAL: { value: string; label: string }[] = [
  { value: "#step", label: "Step number (starts a new test at 1)" },
  { value: "#summary", label: "Test summary" },
  { value: "#description", label: "Test description" },
  { value: "#folder", label: "Xray folder" },
  { value: "#labels", label: "Labels" },
  { value: "#ignore", label: "Ignore" },
];

function Steps({ at }: { at: number }) {
  const names = ["File", "Columns", "Preview", "Import"];
  return (
    <ol className="steps" aria-label="Progress">
      {names.map((n, i) => (
        <li
          key={n}
          className={cx("step-pill", i < at && "is-done", i <= at && "is-on")}
          aria-current={i === at ? "step" : undefined}
        >
          <span className="step-n">{i < at ? <Icon name="check" size={12} /> : i + 1}</span>
          {n}
        </li>
      ))}
    </ol>
  );
}

export function ImportScreen() {
  const app = useApp();
  // ponytail: an import answer that lands after the user left this screen does not pull them back to its tests
  const here = useRef(true);
  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);
  const [file, setFile] = useDraft<CsvFile | null>("import.file", null);
  const [mapping, setMapping] = useDraft<Record<string, string>>("import.mapping", {});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useDraft<Mode>("import.mode", "local");
  const [folder, setFolder] = useDraft("import.folder", "");
  const [plan, setPlan] = useState<PlanOp[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [waiting, setWaiting] = useState<{ jobId: string; warning: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const fields = app.xray.fields;
  const remembered = app.info?.project.csvMapping ?? {};

  const rows = file?.text ? parseCsvRows(file.text.replace(/^﻿/, "")) : [];
  const head = file?.text?.split("\n")[0] ?? "";
  const sep = (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ";" : ",";

  const runPreview = useCallback(async (f: CsvFile, m: Record<string, string>, dir: string) => {
    setLoading(true);
    setFailure(null);
    try {
      const r = await call<Preview>("xray.importCsv", {
        mode: "preview",
        ...csvSource(f),
        name: f.name.replace(/\.csv$/i, ""),
        ...(Object.keys(m).length ? { mapping: m } : {}),
        ...(dir.trim() ? { folder: dir.trim() } : {}),
      });
      setPreview(r);
      setMapping(r.mapping ?? {});
    } catch (e) {
      setPreview(null);
      setFailure(e);
    } finally {
      setLoading(false);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mapping is re-sent only when the user changes it
  useEffect(() => {
    if (!file) return;
    const t = setTimeout(() => void runPreview(file, mapping, folder), 250);
    return () => clearTimeout(t);
  }, [file, folder, runPreview]);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    try {
      setPreview(null);
      setMapping({});
      setFile({ name: f.name, text: await f.text() });
    } catch (e) {
      errorToast(e, "Could not read the file");
    }
  };

  const browse = () => {
    if (!desktop()) {
      picker.current?.click();
      return;
    }
    void pickFiles("Choose a CSV file", [{ name: "CSV", extensions: ["csv"] }], false).then(([path]) => {
      if (!path) return;
      setPreview(null);
      setMapping({});
      setFile({ name: baseName(path), path });
    });
  };

  const remap = (header: string, target: string) => {
    const next = { ...mapping, [header]: target };
    setMapping(next);
    if (file) void runPreview(file, next, folder);
  };

  const input = () => ({
    ...(file ? csvSource(file) : {}),
    name: file?.name.replace(/\.csv$/i, ""),
    mapping,
    ...(folder.trim() ? { folder: folder.trim() } : {}),
  });

  const importLocal = async () => {
    setImporting(true);
    setFailure(null);
    try {
      const r = await call<Preview>("xray.importCsv", { ...input(), mode: "local" });
      toast({
        kind: "ok",
        title: `${plural(r.written.length, "test")} imported`,
        detail: "In the Local tab — written by your team, so no review needed.",
      });
      dropDraft("import.file", "import.mapping", "import.folder");
      app.testsChanged();
      app.refreshInfo();
      if (r.written.length) {
        void call("check.run", { ids: r.written, semantic: false }).catch(() => {});
        if (here.current) app.navigate("tests", r.written[0]);
      }
    } catch (e) {
      setFailure(e);
    } finally {
      setImporting(false);
    }
  };

  const planDirect = async () => {
    setImporting(true);
    setFailure(null);
    try {
      const r = await call<Preview>("xray.importCsv", { ...input(), mode: "direct", dryRun: true });
      setPlan(r.plan ?? []);
    } catch (e) {
      setFailure(e);
    } finally {
      setImporting(false);
    }
  };

  const importDirect = async (jobId?: string) => {
    setPlan(null);
    setImporting(true);
    setFailure(null);
    try {
      const r = await call<Preview>(
        "xray.importCsv",
        jobId ? { mode: "direct", jobId } : { ...input(), mode: "direct" },
      );
      const still = stillImporting(r);
      setWaiting(still);
      if (still) return;
      toast({
        kind: "ok",
        title: `${plural(r.written.length, "test")} created in Jira`,
        detail: "Pulled into the project.",
      });
      dropDraft("import.file", "import.mapping", "import.folder");
      app.testsChanged();
      app.refreshInfo();
      if (r.written[0] && here.current) app.navigate("tests", r.written[0]);
    } catch (e) {
      setFailure(e);
    } finally {
      setImporting(false);
    }
  };

  const tests = preview?.tests.filter((t) => t.steps.length) ?? [];
  const first = file?.text ? (rows[1] ?? []) : preview ? firstValues(preview) : [];
  const stepCount = tests.reduce((n, t) => n + t.steps.length, 0);
  const generic = preview?.warnings.filter((w) => !tests.some((t) => w.startsWith(`"${t.summary}"`))) ?? [];
  const at = !file ? 0 : !preview ? 1 : 2;
  const isRemembered = !!preview && preview.headers.some((h) => remembered[h]);

  return (
    <div className="screen">
      <ScreenHeader title="Import CSV" meta="Bring in tests made elsewhere" />
      <div className="scroll">
        <div className="imp">
          <Steps at={importing ? 3 : at} />
          <input
            ref={picker}
            type="file"
            accept=".csv,text/csv"
            hidden
            aria-label="Choose a CSV file"
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {!file ? (
            <div
              className="card imp-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void choose(e.dataTransfer.files[0]);
              }}
            >
              <Icon name="pull" size={32} />
              <h2 className="h">Choose a CSV of test steps</h2>
              <p className="muted">
                One row per step: Step, Action, Expected Result, Exigence… The columns are mapped to your Xray fields
                next, and the mapping is remembered.
              </p>
              <Button tone="primary" onClick={browse}>
                Choose a file
              </Button>
            </div>
          ) : (
            <>
              <div className="card imp-file">
                <Icon name="documents" />
                <span className="mono" title={file.path}>
                  {file.name}
                </span>
                <span className="muted">
                  {file.text
                    ? `${plural(Math.max(0, rows.length - 1), "row")}${preview ? ` · ${plural(tests.length, "test")}` : ""} · separator « ${sep} »`
                    : file.path}
                </span>
                <span className="spacer" />
                <Button tone="quiet" size="sm" onClick={browse}>
                  Choose another file
                </Button>
              </div>

              {failure !== null && !preview && (
                <ProblemPanel
                  error={failure}
                  doing="Reading the CSV"
                  onRetry={() => void runPreview(file, mapping, folder)}
                />
              )}

              <section className="card imp-sect" aria-label="Columns">
                <div className="sect-head">
                  <h2 className="h sect-title">Columns</h2>
                  {isRemembered && <Badge>Remembered from your last import</Badge>}
                </div>
                {!preview ? (
                  <div aria-busy="true">
                    <Skeleton w="90%" h={14} />
                    <Skeleton w="80%" h={14} />
                    <Skeleton w="85%" h={14} />
                  </div>
                ) : (
                  <table className="tbl imp-tbl">
                    <thead>
                      <tr>
                        <th scope="col">CSV column</th>
                        <th scope="col">First value</th>
                        <th scope="col">Becomes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.headers.map((h, i) => (
                        <tr key={h}>
                          <td className="mono">{h}</td>
                          <td className="muted imp-first">{first[i] ?? ""}</td>
                          <td>
                            <select
                              className="field"
                              aria-label={`${h} becomes`}
                              value={mapping[h] ?? "#ignore"}
                              onChange={(e) => remap(h, e.target.value)}
                            >
                              {fields.map((f) => (
                                <option key={f.name} value={f.name}>
                                  {f.name}
                                  {f.builtin ? "" : " (custom field)"}
                                </option>
                              ))}
                              {SPECIAL.map((s) => (
                                <option key={s.value} value={s.value}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="card imp-sect" aria-label="Preview" aria-busy={loading}>
                <div className="sect-head">
                  <h2 className="h sect-title">Preview</h2>
                  {preview && (
                    <span className="muted">
                      {plural(tests.length, "test")} · {plural(stepCount, "step")}
                    </span>
                  )}
                </div>
                {generic.map((w) => (
                  <div key={w} className="imp-warn">
                    <Severity tone="warning">
                      {/Source Reference/i.test(w) ? "Source Reference ignored" : "Note"}
                    </Severity>
                    <p>{w}</p>
                  </div>
                ))}
                <div className="imp-tests">
                  {tests.map((t, i) => {
                    const own = preview?.warnings.filter((w) => w.startsWith(`"${t.summary}"`)) ?? [];
                    return (
                      <div key={i} className="imp-test">
                        <span>{t.summary}</span>
                        {own.length ? (
                          <span title={own.join("\n")}>
                            <Severity tone="warning">
                              {own[0].replace(`"${t.summary}" `, "").replace(/^s/, "S")}
                            </Severity>
                          </span>
                        ) : (
                          <span className="muted">{plural(t.steps.length, "step")}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="imp-go" aria-label="Import">
                <h2 className="h sect-title">Where should they go?</h2>
                <div className="formfield imp-folder">
                  <label className="label" htmlFor="imp-folder">
                    Xray folder (when the CSV has none)
                  </label>
                  <input
                    id="imp-folder"
                    className="field mono"
                    list="imp-folders"
                    placeholder="/"
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                  />
                  <datalist id="imp-folders">
                    {(app.info?.project.folders ?? []).map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </div>
                <div role="radiogroup" aria-label="Import mode" className="imp-modes">
                  <label className={cx("opt", mode === "local" && "opt-on")}>
                    <input type="radio" name="imp-mode" checked={mode === "local"} onChange={() => setMode("local")} />
                    <span>
                      <span className="opt-title">Import locally</span> <span className="muted">— recommended</span>
                      <br />
                      <span className="muted">
                        Tests arrive in <span className="mono">{folder.trim() || tests[0]?.folder || "/"}</span>, in the
                        Local tab: written by your team, they need no review before Jira.
                      </span>
                    </span>
                  </label>
                  <label className={cx("opt", mode === "direct" && "opt-on")}>
                    <input
                      type="radio"
                      name="imp-mode"
                      checked={mode === "direct"}
                      onChange={() => setMode("direct")}
                    />
                    <span>
                      <span className="opt-title">Import directly into Xray</span>
                      <br />
                      <span className="muted">
                        Creates the {plural(tests.length, "test")} in Jira now. You see the plan before anything is
                        sent.
                      </span>
                    </span>
                  </label>
                </div>
                {waiting && (
                  <div className="find" role="status">
                    <span className="sev s-run">
                      <span className="dot run-dot" />
                      Xray is still importing
                    </span>
                    <p>{waiting.warning}</p>
                    <p className="muted">
                      The tests are being created in Jira. Check again to pull them — importing the CSV again would
                      create them twice.
                    </p>
                    <div>
                      <Button
                        size="sm"
                        icon="revert"
                        disabled={importing}
                        onClick={() => void importDirect(waiting.jobId)}
                      >
                        Check again
                      </Button>
                    </div>
                  </div>
                )}
                {failure !== null && preview && (
                  <ProblemPanel
                    error={failure}
                    doing={mode === "direct" ? "Importing into Xray" : "Importing"}
                    onRetry={() => void (mode === "direct" ? planDirect() : importLocal())}
                  />
                )}
                <div className="imp-actions">
                  <Button tone="quiet" onClick={() => setFile(null)}>
                    Back
                  </Button>
                  <Button
                    tone="primary"
                    disabled={!tests.length || importing || loading || !!waiting}
                    onClick={() => void (mode === "local" ? importLocal() : planDirect())}
                  >
                    {importing
                      ? "Importing…"
                      : mode === "local"
                        ? `Import ${plural(tests.length, "test")} locally`
                        : `Plan the import of ${plural(tests.length, "test")}`}
                  </Button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
      {plan && (
        <Modal
          label="Import plan"
          title="Import into Xray"
          subtitle="Nothing has been sent yet."
          width={560}
          onClose={() => setPlan(null)}
          foot={
            <>
              <span className="spacer" />
              <Button tone="quiet" onClick={() => setPlan(null)}>
                Cancel
              </Button>
              <Button tone="primary" onClick={() => void importDirect()}>
                Import into Xray
              </Button>
            </>
          }
        >
          <ol className="imp-plan">
            {plan.map((p, i) => (
              <li key={i}>{p.label}</li>
            ))}
          </ol>
          {preview && preview.warnings.length > 0 && (
            <p className="muted">
              {plural(preview.warnings.length, "warning")} in the preview — they go to Jira as they are.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
