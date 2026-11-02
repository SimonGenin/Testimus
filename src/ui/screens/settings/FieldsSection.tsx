import { useState } from "react";
import type { ColumnMode, XrayJson } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { Button, Icon, IconButton } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { MODES } from "../../lib/columns.ts";
import { isRequirementField } from "../../lib/fields.ts";
import { cx } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";

export function orderedFields(x: XrayJson): string[] {
  const names = x.fields.map((f) => f.name);
  const ordered = x.prefs.order.filter((n) => names.includes(n));
  return [...ordered, ...names.filter((n) => !ordered.includes(n))];
}

export function FieldsSection() {
  const app = useApp();
  const x = app.xray;
  const [drag, setDrag] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const order = orderedFields(x);

  const save = async (prefs: Partial<XrayJson["prefs"]>) => {
    try {
      await call<XrayJson>("xray.prefs", prefs);
      app.refreshInfo();
      toast({ kind: "ok", title: "Step fields saved" });
    } catch (e) {
      errorToast(e, "Could not save the step fields");
    }
  };

  const move = (name: string, to: number) => {
    const rest = order.filter((n) => n !== name);
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, name);
    void save({ order: rest });
  };

  const off = (name: string) => !!x.fields.find((f) => f.name === name)?.disabled;

  const setMode = (name: string, mode: ColumnMode) =>
    void save({
      collapsed: [...x.prefs.collapsed.filter((n) => n !== name), ...(mode === "collapsed" ? [name] : [])],
      filled: [...(x.prefs.filled ?? []).filter((n) => n !== name), ...(mode === "filled" ? [name] : [])],
      ...(off(name) || x.prefs.open?.length
        ? { open: [...(x.prefs.open ?? []).filter((n) => n !== name), ...(mode === "open" && off(name) ? [name] : [])] }
        : {}),
    });

  const flip = (list: "collapsed" | "hidden", name: string, on: boolean) =>
    void save({
      [list]: on ? [...x.prefs[list].filter((n) => n !== name), name] : x.prefs[list].filter((n) => n !== name),
    });

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await call<XrayJson>("xray.fields", {});
      app.refreshInfo();
      toast({ kind: "ok", title: "Step fields refreshed from Jira", detail: `${r.fields.length} fields` });
    } catch (e) {
      errorToast(e, "Could not read the step fields from Jira");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="card sect" id="settings-fields" aria-labelledby="s-fields">
      <div className="sect-head">
        <h2 id="s-fields" className="h sect-title">
          Step fields
        </h2>
        <span className="spacer" />
        <Button size="sm" icon="pull" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? "Refreshing…" : "Refresh from Jira"}
        </Button>
      </div>
      <p className="muted">
        The fields come from Jira. Choose their order, when each one shows on a step (always, only when the step holds
        something, or folded) and which ones to hide in this project. A test can choose its own from the editor's
        Columns menu.
      </p>
      <div className="frows">
        <div className="frow frow-head" aria-hidden="true">
          <span />
          <span className="muted">Field</span>
          <span className="muted">Kind</span>
          <span className="muted">Shown on a step</span>
          <span className="muted">Hidden</span>
          <span />
        </div>
        <ul className="frows-list" aria-label="Step fields">
          {order.map((name, i) => {
            const f = x.fields.find((ff) => ff.name === name);
            const mode = x.prefs.collapsed.includes(name)
              ? "collapsed"
              : (x.prefs.filled ?? []).includes(name) || (off(name) && !(x.prefs.open ?? []).includes(name))
                ? "filled"
                : "open";
            const foldable = name !== "Action" && name !== "Expected Result";
            const hidden = x.prefs.hidden.includes(name);
            return (
              <li
                key={name}
                className={cx("frow", drag === name && "is-dragging")}
                draggable
                onDragStart={(e) => {
                  setDrag(name);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", name);
                }}
                onDragOver={(e) => drag && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag && drag !== name) move(drag, i);
                  setDrag(null);
                }}
                onDragEnd={() => setDrag(null)}
              >
                <span className="grip" aria-hidden="true">
                  <Icon name="grip" />
                </span>
                <span className="frow-name">{name}</span>
                <span className="muted">
                  {f?.builtin ? "Standard" : `Custom · ${isRequirementField(name) ? "ids" : (f?.type ?? "text")}`}
                  {f?.disabled ? " · off in Xray" : ""}
                  {f?.required ? " · required" : ""}
                </span>
                <select
                  className="field frow-mode"
                  aria-label={`${name} folding`}
                  value={mode}
                  disabled={!foldable}
                  title={foldable ? undefined : `${name} is always open`}
                  onChange={(e) => setMode(name, e.target.value as ColumnMode)}
                >
                  {MODES.map((m) => (
                    <option key={m.value} value={m.value} title={m.title}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <label className="frow-check">
                  <input
                    type="checkbox"
                    checked={hidden}
                    aria-label={`${name} hidden`}
                    onChange={(e) => flip("hidden", name, e.target.checked)}
                  />
                  {hidden ? "Yes" : "No"}
                </label>
                <span className="frow-move">
                  <IconButton
                    icon="up"
                    label={`Move ${name} up`}
                    disabled={i === 0}
                    onClick={() => move(name, i - 1)}
                  />
                  <IconButton
                    icon="down"
                    label={`Move ${name} down`}
                    disabled={i === order.length - 1}
                    onClick={() => move(name, i + 1)}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {x.fetchedAt && <span className="muted">Read from Jira {new Date(x.fetchedAt).toLocaleString("en-GB")}</span>}
    </section>
  );
}
