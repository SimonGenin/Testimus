import { useState } from "react";
import type { ColumnMode, ColumnShow, StepColumn, XrayJson } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { Button } from "../../components/legacy/index.ts";
import { useApp } from "../../lib/app.ts";
import { useDraft } from "../../lib/drafts.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { ColumnRow } from "./ColumnRow.tsx";
import { ColumnsClaude } from "./ColumnsClaude.tsx";

export function ColumnsSection() {
  const app = useApp();
  const x = app.xray;
  const columns = (app.info?.columns ?? []) as StepColumn[];
  const [drag, setDrag] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useDraft("settings.column.adding", false);
  const [name, setName] = useDraft("settings.column.name", "");
  const [desc, setDesc] = useDraft("settings.column.desc", "");
  const order = columns.map((c) => c.name);

  const saveLayout = async (name: "columns.order" | "columns.setModes", input: Record<string, unknown>) => {
    try {
      await call<StepColumn[]>(name, input);
      app.refreshInfo();
    } catch (e) {
      errorToast(e, "Could not save the smart columns");
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

  const saveReference = async (column: string, referenceSource: boolean) => {
    try {
      await call("columns.save", { name: column, referenceSource });
      app.refreshInfo();
      toast({
        kind: "ok",
        title: referenceSource ? `${column} links its items to their sources` : `${column} is plain text again`,
      });
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

  const move = (column: string, to: number) => {
    const rest = order.filter((n) => n !== column);
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, column);
    void saveLayout("columns.order", { names: rest });
  };

  const off = (n: string) => !!x.fields.find((f) => f.name === n)?.disabled;
  const shown = (c: StepColumn): ColumnMode =>
    c.mode !== "hidden" ? c.mode : c.name === "Data" || off(c.name) ? "filled" : "open";
  const setMode = (n: string, mode: ColumnShow) => void saveLayout("columns.setModes", { modes: { [n]: mode } });
  const setHidden = (c: StepColumn, on: boolean) => setMode(c.name, on ? "hidden" : shown(c));

  const refresh = async () => {
    setRefreshing(true);
    try {
      await call<XrayJson>("xray.refreshFields", {});
      app.refreshInfo();
      toast({ kind: "ok", title: "Smart columns read again from Xray" });
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
          Smart columns
        </h2>
        <span className="spacer" />
        {x.fetchedAt && <span className="muted">Read from Xray {new Date(x.fetchedAt).toLocaleString("en-GB")}</span>}
        <Button size="sm" icon="pull" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? "Reading…" : "Read again from Xray"}
        </Button>
      </div>
      <p className="muted">
        Each step of a test is made of these columns. The description is what Claude is told to write in it — leave it
        empty and Claude never fills the column.
      </p>
      {(fresh.length > 0 || gone.length > 0) && (
        <p className="colrow-banner" role="status">
          {fresh.length > 0 && `New in Xray, not described yet: ${fresh.join(", ")}. `}
          {gone.length > 0 && `No longer in Xray, kept as local columns: ${gone.join(", ")}.`}
        </p>
      )}
      <ColumnsClaude columns={columns} />
      <ul className="colrows" aria-label="Smart columns">
        {columns.map((c, i) => (
          <ColumnRow
            key={c.name}
            column={c}
            mode={shown(c)}
            hidden={c.mode === "hidden"}
            disabled={false}
            first={i === 0}
            last={i === columns.length - 1}
            dragging={drag === c.name}
            onDescribe={(t) => void saveDescription(c.name, t)}
            onMode={(m) => setMode(c.name, m)}
            onHidden={(h) => setHidden(c, h)}
            onReferenceSource={(on) => void saveReference(c.name, on)}
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
        ))}
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
    </section>
  );
}
