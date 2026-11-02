import { useState } from "react";
import type { TraceView } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { CoverageDialog } from "../../components/traces/CoverageDialog.tsx";
import { TrackDialog } from "../../components/traces/TrackDialog.tsx";
import { Button, Modal, Severity } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";

export function TracesSection() {
  const app = useApp();
  const traces = app.info?.traces ?? [];
  const [open, setOpen] = useState<TraceView | "new" | null>(null);
  const [stop, setStop] = useState<TraceView | null>(null);
  const [coverage, setCoverage] = useState<string | null>(null);

  const remove = async (t: TraceView) => {
    try {
      await call("traces.remove", { id: t.id });
      app.refreshInfo();
      toast({ kind: "ok", title: `${t.label} ids no longer tracked` });
    } catch (e) {
      errorToast(e, "Could not stop tracking them");
    } finally {
      setStop(null);
    }
  };

  if (!app.info) return null;
  return (
    <section className="card sect" id="settings-traces" aria-labelledby="s-traces">
      <div className="sect-head">
        <h2 id="s-traces" className="h sect-title">
          Tracked ids
        </h2>
        <span className="spacer" />
        <Button size="sm" icon="plus" onClick={() => setOpen("new")}>
          Track ids…
        </Button>
      </div>
      <p className="muted">
        Ids the documents write — requirements, alarm codes, use cases… Each kind is a column of the test steps: the
        generation fills it with what each step verifies, Generate lets you pick ids to cover, and Xray receives it as a
        step field. A project that tracks nothing works the same, without these columns.
      </p>
      {traces.length === 0 ? (
        <p className="muted">Nothing tracked in this project.</p>
      ) : (
        <ul className="traces-list" aria-label="Tracked ids">
          {traces.map((t) => (
            <li key={t.id} className="traces-row">
              <div className="traces-main">
                <span className="traces-name">{t.label}</span>
                <span className="mono muted traces-pat">{t.patterns.join("  |  ")}</span>
                {t.origin === "detected" && (
                  <span className="muted">Found in this project's documents and settings — saving it confirms it.</span>
                )}
              </div>
              <span>
                {plural(t.found, "id")} in {plural(t.docs, "document")}
              </span>
              <span>
                Column <strong>{t.field}</strong>{" "}
                {t.column === "in-xray" ? (
                  <Severity tone="ok">In Xray</Severity>
                ) : (
                  <Severity tone="warning">Not in Xray yet</Severity>
                )}
              </span>
              <span className="traces-acts">
                <Button size="sm" tone="quiet" icon="checked" onClick={() => setCoverage(t.id)}>
                  Coverage
                </Button>
                <Button size="sm" tone="quiet" icon="edit" onClick={() => setOpen(t)}>
                  Change
                </Button>
                <Button size="sm" tone="quiet" icon="trash" onClick={() => setStop(t)}>
                  Stop tracking
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && <TrackDialog initial={open === "new" ? undefined : open} onClose={() => setOpen(null)} />}
      {coverage && <CoverageDialog initial={coverage} onClose={() => setCoverage(null)} />}
      {stop && (
        <Modal
          label={`Stop tracking ${stop.label} ids`}
          title={`Stop tracking ${stop.label} ids?`}
          width={480}
          onClose={() => setStop(null)}
          foot={
            <>
              <span className="spacer" />
              <Button tone="quiet" onClick={() => setStop(null)}>
                Keep them
              </Button>
              <Button tone="danger" onClick={() => void remove(stop)}>
                Stop tracking
              </Button>
            </>
          }
        >
          <p>
            The « {stop.field} » column stops being an id column and Generate no longer offers them. The values already
            written in the tests stay as they are, in test.md and in Xray.
          </p>
        </Modal>
      )}
    </section>
  );
}
