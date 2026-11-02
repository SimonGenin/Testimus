import { useEffect, useId, useRef, useState } from "react";
import type { ColumnMode, ColumnModes } from "../../../core/types.ts";
import { Button, Segmented } from "../../components/ui/index.ts";
import { type Column, collapsible, defaultMode, MODES, modeOf } from "../../lib/columns.ts";

// Which step columns fold, for this test or for every test of the project. The step card's own toggle
// still opens or folds one step on top of this, for the session.
export function ColumnsMenu({
  columns,
  projectModes,
  testModes,
  onProject,
  onTest,
}: {
  columns: Column[];
  projectModes: ColumnModes;
  testModes: ColumnModes | null;
  onProject: (modes: ColumnModes) => void;
  onTest: (modes: ColumnModes | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"test" | "project">("project");
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const foldable = columns.filter(collapsible);
  if (!foldable.length) return null;
  const overridden = foldable.filter((c) => testModes?.[c.name]);

  const set = (c: Column, mode: ColumnMode) => {
    if (scope === "project") {
      const next = { ...projectModes, [c.name]: mode };
      if (mode === defaultMode(c)) delete next[c.name];
      onProject(next);
    } else {
      const next = { ...testModes, [c.name]: mode };
      if (mode === (projectModes[c.name] ?? defaultMode(c))) delete next[c.name];
      onTest(Object.keys(next).length ? next : null);
    }
  };
  const reset = (c: Column) => {
    const next = { ...testModes };
    delete next[c.name];
    onTest(Object.keys(next).length ? next : null);
  };

  return (
    <div className="menu colmenu" ref={box}>
      <Button
        tone="quiet"
        size="sm"
        icon="down"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (!open) setScope(overridden.length ? "test" : "project");
          setOpen((v) => !v);
        }}
      >
        Columns
      </Button>
      {open && (
        <div id={id} className="menu-list is-right colmenu-list" role="dialog" aria-label="Step columns">
          <div className="colmenu-head">
            <span className="colmenu-title">Step columns</span>
            <Segmented
              label="Apply to"
              value={scope}
              options={[
                { value: "test", label: "this test" },
                { value: "project", label: "all tests" },
              ]}
              onChange={setScope}
            />
          </div>
          {foldable.map((c) => (
            <div key={c.name} className="colmenu-row">
              <span className="colmenu-name">
                {c.name}
                {!c.known && <span className="colmenu-note">not in Xray</span>}
                {c.off && (
                  <span className="colmenu-note" title="Switched off in Xray's project settings">
                    off in Xray
                  </span>
                )}
                {scope === "test" && testModes?.[c.name] && (
                  <button type="button" className="linkbtn" onClick={() => reset(c)}>
                    use project's
                  </button>
                )}
              </span>
              <Segmented
                label={`${c.name} column`}
                value={
                  scope === "project" ? (projectModes[c.name] ?? defaultMode(c)) : modeOf(c, projectModes, testModes)
                }
                options={MODES.map((m) => ({ value: m.value, label: m.label, title: m.title }))}
                onChange={(m) => set(c, m)}
              />
            </div>
          ))}
          <p className="colmenu-hint muted">
            {scope === "test"
              ? "Saved for this test only, beside its test.md (columns.json) — never part of the test."
              : "Saved in xray.json — every test of the project that does not choose its own."}{" "}
            Action and Expected Result are always open; each step's own toggle folds one step for this session.
          </p>
          {scope === "project" && overridden.length > 0 && (
            <p className="colmenu-hint muted">
              This test overrides {overridden.map((c) => c.name).join(", ")} —{" "}
              <button type="button" className="linkbtn" onClick={() => onTest(null)}>
                follow the project
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
