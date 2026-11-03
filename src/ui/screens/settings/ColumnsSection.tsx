import { useState } from "react";
import type { ColumnMode, StepColumn, TraceView, XrayJson } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { CoverageDialog } from "../../components/traces/CoverageDialog.tsx";
import { TrackDialog } from "../../components/traces/TrackDialog.tsx";
import { Button, Modal } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { useDraft } from "../../lib/drafts.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { traceOfField } from "../../lib/traces.ts";
import { ColumnRow } from "./ColumnRow.tsx";

export function ColumnsSection() {
  const app = useApp();
  const x = app.xray;
  const columns = (app.info?.columns ?? []) as StepColumn[];
  const [drag, setDrag] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [track, setTrack] = useState<{ column: string; trace?: TraceView } | null>(null);
  const [untrack, setUntrack] = useState<TraceView | null>(null);
  const [coverage, setCoverage] = useState<string | null>(null);
  const [adding, setAdding] = useDraft("settings.column.adding", false);
  const [name, setName] = useDraft("settings.column.name", "");
  const [desc, setDesc] = useDraft("settings.column.desc", "");
  const order = columns.map((c) => c.name);

  const savePrefs = async (prefs: Partial<XrayJson["prefs"]>) => {
    try {
      await call<XrayJson>("xray.prefs", prefs);
      app.refreshInfo();
    } catch (e) {
      errorToast(e, "Could not save the step columns");
    }
  };

  const saveDescription = async (column: string, description: string) => {
    try {
      await call("columns.save", { name: column, description });
      app.refreshInfo();
      toast({ kind: "ok", title: `${column} saved` });
    } catch (e) {
      errorToast(e, "Could not save the column");
    }
  };

  const add = async () => {
    try {
      await call("columns.save", { name: name.trim(), description: desc });
      app.refreshInfo();
      toast({ kind: "ok", title: `Column ${name.trim()} added`, detail: "Kept in test.md, never pushed to Xray." });
      setName("");
      setDesc("");
      setAdding(false);
    } catch (e) {
      errorToast(e, "Could not add the column");
    }
  };

  const remove = async (column: string) => {
    try {
      await call("columns.remove", { name: column });
      app.refreshInfo();
      toast({ kind: "ok", title: `Column ${column} removed`, detail: "What the tests hold in it stays in test.md." });
    } catch (e) {
      errorToast(e, "Could not remove the column");
    }
  };

  const stopIds = async (t: TraceView) => {
    try {
      await call("traces.remove", { id: t.id });
      app.refreshInfo();
      toast({ kind: "ok", title: `${t.field} is free text again` });
    } catch (e) {
      errorToast(e, "Could not change the column");
    } finally {
      setUntrack(null);
    }
  };

  const move = (column: string, to: number) => {
    const rest = order.filter((n) => n !== column);
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, column);
    void savePrefs({ order: rest });
  };

  const off = (n: string) => !!x.fields.find((f) => f.name === n)?.disabled;
  const modeOf = (n: string): ColumnMode =>
    x.prefs.collapsed.includes(n)
      ? "collapsed"
      : (x.prefs.filled ?? []).includes(n) || (off(n) && !(x.prefs.open ?? []).includes(n))
        ? "filled"
        : "open";
  const setMode = (n: string, mode: ColumnMode) =>
    void savePrefs({
      collapsed: [...x.prefs.collapsed.filter((m) => m !== n), ...(mode === "collapsed" ? [n] : [])],
      filled: [...(x.prefs.filled ?? []).filter((m) => m !== n), ...(mode === "filled" ? [n] : [])],
      ...(off(n) || x.prefs.open?.length
        ? { open: [...(x.prefs.open ?? []).filter((m) => m !== n), ...(mode === "open" && off(n) ? [n] : [])] }
        : {}),
    });
  const setHidden = (n: string, on: boolean) =>
    void savePrefs({
      hidden: on ? [...x.prefs.hidden.filter((m) => m !== n), n] : x.prefs.hidden.filter((m) => m !== n),
    });

  const refresh = async () => {
    setRefreshing(true);
    try {
      await call<XrayJson>("xray.fields", {});
      app.refreshInfo();
      toast({ kind: "ok", title: "Step columns read again from Xray" });
    } catch (e) {
      errorToast(e, "Could not read the step fields from Jira");
    } finally {
      setRefreshing(false);
    }
  };

  if (!app.info) return null;
  const fresh = columns.filter((c) => c.status === "new").map((c) => c.name);
  const gone = columns.filter((c) => c.status === "gone").map((c) => c.name);
  return (
    <section className="card sect" id="settings-columns" aria-labelledby="s-columns">
      <div className="sect-head">
        <h2 id="s-columns" className="h sect-title">
          Step columns
        </h2>
        <span className="spacer" />
        {x.fetchedAt && <span className="muted">Read from Xray {new Date(x.fetchedAt).toLocaleString("en-GB")}</span>}
        <Button size="sm" icon="pull" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? "Reading…" : "Read again from Xray"}
        </Button>
      </div>
      <p className="muted">
        Each step of a test is made of these columns. The description is what Claude is told to write in it — leave it
        empty and Claude never fills the column. An id list column holds ids the documents write (requirements, alarm
        codes…): it is checked against the documents, and a generation covers every id of its scope.
      </p>
      {(fresh.length > 0 || gone.length > 0) && (
        <p className="colrow-banner" role="status">
          {fresh.length > 0 && `New in Xray, not described yet: ${fresh.join(", ")}. `}
          {gone.length > 0 && `No longer in Xray, kept as local columns: ${gone.join(", ")}.`}
        </p>
      )}
      <ul className="colrows" aria-label="Step columns">
        {columns.map((c, i) => {
          const trace = traceOfField(c.name);
          return (
            <ColumnRow
              key={c.name}
              column={c}
              trace={trace}
              mode={modeOf(c.name)}
              hidden={x.prefs.hidden.includes(c.name)}
              disabled={false}
              first={i === 0}
              last={i === columns.length - 1}
              dragging={drag === c.name}
              onDescribe={(t) => void saveDescription(c.name, t)}
              onKind={(k) => {
                if (k === "ids" && !trace) setTrack({ column: c.name });
                if (k === "text" && trace) setUntrack(trace);
              }}
              onPattern={() => trace && setTrack({ column: c.name, trace })}
              onCoverage={() => trace && setCoverage(trace.id)}
              onMode={(m) => setMode(c.name, m)}
              onHidden={(h) => setHidden(c.name, h)}
              onMove={(by) => move(c.name, i + by)}
              onRemove={c.origin === "local" ? () => void remove(c.name) : undefined}
              drag={{
                draggable: true,
                onDragStart: (e) => {
                  setDrag(c.name);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", c.name);
                },
                onDragOver: (e) => drag && e.preventDefault(),
                onDrop: (e) => {
                  e.preventDefault();
                  if (drag && drag !== c.name) move(drag, i);
                  setDrag(null);
                },
                onDragEnd: () => setDrag(null),
              }}
            />
          );
        })}
      </ul>
      {adding ? (
        <div className="colrow-add">
          <label className="label" htmlFor="col-new-name">
            Name of the local column
          </label>
          <input
            id="col-new-name"
            className="field"
            value={name}
            placeholder="Remarque testeur…"
            onChange={(e) => setName(e.target.value)}
          />
          <label className="label" htmlFor="col-new-desc">
            What Claude writes in it
          </label>
          <textarea
            id="col-new-desc"
            className="field"
            rows={2}
            value={desc}
            placeholder="Empty: Claude leaves it empty"
            onChange={(e) => setDesc(e.target.value)}
          />
          <div className="colrow-add-acts">
            <Button tone="primary" size="sm" disabled={!name.trim()} onClick={() => void add()}>
              Add the column
            </Button>
            <Button tone="quiet" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="colrow-add-acts">
          <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
            Add a local column
          </Button>
          <span className="muted">
            Local columns are kept in test.md and never pushed. Add the field in Xray and it becomes an Xray column.
          </span>
        </div>
      )}
      {track && <TrackDialog initial={track.trace} column={track.column} onClose={() => setTrack(null)} />}
      {coverage && <CoverageDialog initial={coverage} onClose={() => setCoverage(null)} />}
      {untrack && (
        <Modal
          label={`${untrack.field} as free text`}
          title={`Make ${untrack.field} free text?`}
          width={480}
          onClose={() => setUntrack(null)}
          foot={
            <>
              <span className="spacer" />
              <Button tone="quiet" onClick={() => setUntrack(null)}>
                Keep the id list
              </Button>
              <Button tone="danger" onClick={() => void stopIds(untrack)}>
                Make it free text
              </Button>
            </>
          }
        >
          <p>
            Its ids are no longer checked against the documents nor counted in Coverage. The values already written in
            the tests stay as they are, in test.md and in Xray.
          </p>
        </Modal>
      )}
    </section>
  );
}
