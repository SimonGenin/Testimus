import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ColumnMode, ColumnModes } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Popover } from "../../components/ui/Popover.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { type } from "../../components/ui/type.ts";
import { type Column, collapsible, defaultMode, MODES, modeOf } from "../../lib/columns.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  box: { display: "flex", flexDirection: "column", gap: space.s3 },
  head: { display: "flex", alignItems: "center", gap: space.s3 },
  title: { flex: 1 },
  row: { display: "flex", alignItems: "center", gap: space.s4 },
  words: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s1 },
  name: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s2,
  },
  what: { color: color.textMuted },
  builtin: { flex: "none", color: color.textMuted },
  hint: { margin: 0, color: color.textMuted },
  follow: { display: "flex", alignItems: "center", gap: space.s2, flexWrap: "wrap" },
});

const LABEL: Record<ColumnMode, string> = { open: "Open", filled: "When filled", collapsed: "Collapsed" };

const what = (c: Column, mode: ColumnMode) =>
  c.off
    ? "Off in Xray · kept, folded unless filled"
    : (MODES.find((m) => m.value === mode)?.title ?? "") + (c.kind === "line" ? " · one line" : "");

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
  const foldable = columns.filter(collapsible);
  if (!foldable.length) return null;
  const fixed = columns.filter((c) => !collapsible(c));
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
    <Popover
      title="Step columns"
      head={false}
      width="md"
      open={open}
      onOpenChange={(o) => {
        if (o) setScope(overridden.length ? "test" : "project");
        setOpen(o);
      }}
      trigger={<Button variant="quiet" size="sm" icon="columns" iconAfter="chevron-down" label="Columns" />}
      foot={
        scope === "test"
          ? "Saved for this test only, beside its test.md (local.json) — never part of the test. Each step's own toggle folds one step for this session."
          : "Saved in columns.json — every test of the project that does not choose its own. Each step's own toggle folds one step for this session."
      }
    >
      <div {...stylex.props(styles.box)}>
        <div {...stylex.props(styles.head)}>
          <span {...stylex.props(type.titleSm, styles.title)}>Step columns</span>
          <Segmented
            label="Apply to"
            size="sm"
            value={scope}
            options={[
              { value: "test", label: "This test" },
              { value: "project", label: "All tests" },
            ]}
            onChange={setScope}
          />
        </div>
        {fixed.map((c) => (
          <div key={c.name} {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.words)}>
              <span {...stylex.props(type.compact, type.medium, styles.name)}>{c.name}</span>
              <span {...stylex.props(type.small, styles.what)}>Always open</span>
            </span>
            <span {...stylex.props(type.small, styles.builtin)}>built in</span>
          </div>
        ))}
        {foldable.map((c) => {
          const mode =
            scope === "project" ? (projectModes[c.name] ?? defaultMode(c)) : modeOf(c, projectModes, testModes);
          return (
            <div key={c.name} {...stylex.props(styles.row)}>
              <span {...stylex.props(styles.words)}>
                <span {...stylex.props(type.compact, type.medium, styles.name)}>
                  {c.name}
                  {!c.known && <Badge label="not in Xray" size="sm" tone="warning" icon="alert-triangle" />}
                  {scope === "test" && testModes?.[c.name] && (
                    <Button variant="quiet" size="xs" label="Use the project's" onClick={() => reset(c)} />
                  )}
                </span>
                <span {...stylex.props(type.small, styles.what)}>{what(c, mode)}</span>
              </span>
              <Segmented
                label={`${c.name} column`}
                size="sm"
                value={mode}
                options={MODES.map((m) => ({ value: m.value, label: LABEL[m.value] }))}
                onChange={(m) => set(c, m)}
              />
            </div>
          );
        })}
        {overridden.length > 0 && (
          <p {...stylex.props(type.small, styles.hint, styles.follow)}>
            {scope === "project" && `This test overrides ${overridden.map((c) => c.name).join(", ")}.`}
            <Button variant="quiet" size="xs" icon="undo" label="Follow the project" onClick={() => onTest(null)} />
          </p>
        )}
      </div>
    </Popover>
  );
}
