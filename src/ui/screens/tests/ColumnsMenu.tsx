import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ColumnMode, ColumnModes } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Popover } from "../../components/ui/Popover.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { type Column, collapsible, defaultMode, MODES, modeOf } from "../../lib/columns.ts";
import { color, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  box: { display: "flex", flexDirection: "column", gap: space.s3 },
  row: { display: "flex", flexDirection: "column", gap: space.s1 },
  name: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s2,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    fontWeight: fontWeight.medium,
  },
  hint: { margin: 0, fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
});

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
      icon="columns"
      width="sm"
      open={open}
      onOpenChange={(o) => {
        if (o) setScope(overridden.length ? "test" : "project");
        setOpen(o);
      }}
      trigger={<Button variant="quiet" size="sm" icon="columns" iconAfter="chevron-down" label="Columns" />}
      foot={
        scope === "test"
          ? "Saved for this test only, beside its test.md (local.json) — never part of the test."
          : "Saved in columns.json — every test of the project that does not choose its own."
      }
    >
      <div {...stylex.props(styles.box)}>
        <Segmented
          label="Apply to"
          size="sm"
          value={scope}
          options={[
            { value: "test", label: "this test" },
            { value: "project", label: "all tests" },
          ]}
          onChange={setScope}
        />
        {foldable.map((c) => (
          <div key={c.name} {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.name)}>
              {c.name}
              {!c.known && <Badge label="not in Xray" size="sm" tone="warning" />}
              {c.off && <Badge label="off in Xray" size="sm" tooltip="Switched off in Xray's project settings" />}
              {scope === "test" && testModes?.[c.name] && (
                <Button variant="quiet" size="xs" label="use project's" onClick={() => reset(c)} />
              )}
            </span>
            <Segmented
              label={`${c.name} column`}
              size="sm"
              value={
                scope === "project" ? (projectModes[c.name] ?? defaultMode(c)) : modeOf(c, projectModes, testModes)
              }
              options={MODES.map((m) => ({ value: m.value, label: m.label }))}
              onChange={(m) => set(c, m)}
            />
          </div>
        ))}
        <p {...stylex.props(styles.hint)}>
          Action and Expected Result are always open; each step's own toggle folds one step for this session.
        </p>
        {scope === "project" && overridden.length > 0 && (
          <p {...stylex.props(styles.hint)}>
            This test overrides {overridden.map((c) => c.name).join(", ")} —{" "}
            <Button variant="quiet" size="xs" label="follow the project" onClick={() => onTest(null)} />
          </p>
        )}
      </div>
    </Popover>
  );
}
