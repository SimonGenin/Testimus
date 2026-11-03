import * as stylex from "@stylexjs/stylex";
import type { Precondition, Test } from "../../../../core/types.ts";
import { Button } from "../../../components/ui/Button.tsx";
import { ChipField } from "../../../components/ui/ChipField.tsx";
import { type SaveState, Text } from "../../../components/ui/Text.tsx";
import { border, breakpoint, color, fontSize, fontWeight, lineHeight, space } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: { default: "repeat(2, minmax(0, 1fr))", [breakpoint.narrow]: "minmax(0, 1fr)" },
    gap: space.s4,
    columnGap: space.s5,
    paddingTop: space.s4,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  wide: { gridColumn: "1 / -1" },
  field: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  label: {
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.medium,
    color: color.textMuted,
  },
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2 },
  note: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
});

export type ContextRef = { id: string; name: string };
export type TestContexts = { effective: string[]; own: string[] | null };

// ponytail: what a test carries besides its steps — labels, the issues it covers, the Jira preconditions it needs, the
// contexts Claude reads for it, its description
export function TestDetails({
  test,
  readOnly,
  saveState,
  preconditions,
  contexts,
  testContexts,
  update,
  onContexts,
  onManageContexts,
}: {
  test: Test;
  readOnly?: boolean;
  saveState?: SaveState;
  preconditions: Precondition[] | null;
  contexts: ContextRef[];
  testContexts: TestContexts | null;
  update: (fn: (t: Test) => Test) => void;
  onContexts: (ids: string[] | null) => void;
  onManageContexts: () => void;
}) {
  const eff = testContexts?.effective ?? [];
  const known = new Map(contexts.map((c) => [c.id, c.name]));
  const pre = preconditions ?? [];
  return (
    <div {...stylex.props(styles.grid)}>
      <ChipField
        label="Labels"
        showLabel
        appearance="inline"
        placeholder="Add a label…"
        values={test.labels}
        onChange={readOnly ? undefined : (labels) => update((t) => ({ ...t, labels }))}
      />
      <ChipField
        label="Covers"
        showLabel
        appearance="inline"
        mono
        placeholder="Add an issue key…"
        values={test.covers}
        onChange={
          readOnly ? undefined : (covers) => update((t) => ({ ...t, covers: covers.map((k) => k.toUpperCase()) }))
        }
      />
      <div {...stylex.props(styles.field)}>
        <ChipField
          label="Preconditions"
          showLabel
          appearance="inline"
          mono
          placeholder={test.preconditions.length ? "Attach another…" : "Attach a precondition…"}
          values={test.preconditions}
          choices={pre.map((p) => ({ value: p.key, label: p.key }))}
          onChange={readOnly ? undefined : (keys) => update((t) => ({ ...t, preconditions: [...keys].sort() }))}
        />
        {preconditions === null ? (
          <span {...stylex.props(styles.note)}>Loading the project's preconditions…</span>
        ) : !pre.length ? (
          <span {...stylex.props(styles.note)}>None in this project</span>
        ) : null}
      </div>
      <div {...stylex.props(styles.field)}>
        <ChipField
          label="Claude contexts"
          showLabel
          appearance="inline"
          placeholder={eff.length ? "Attach another…" : "Attach a context…"}
          values={eff}
          choices={contexts.map((c) => ({ value: c.id, label: c.name }))}
          onChange={readOnly || !testContexts ? undefined : (ids) => onContexts(ids)}
        />
        <span {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.note)}>
            {testContexts?.own != null
              ? "This test's own list"
              : eff.length
                ? `Project defaults · ${eff.map((id) => known.get(id) ?? id).join(", ")}`
                : "Project defaults · none yet"}
          </span>
          {testContexts?.own != null && !readOnly && (
            <Button variant="quiet" size="xs" label="Reset to project defaults" onClick={() => onContexts(null)} />
          )}
          <Button variant="quiet" size="xs" icon="context" label="Manage contexts…" onClick={onManageContexts} />
        </span>
      </div>
      <div {...stylex.props(styles.wide)}>
        <Text
          label="Description"
          multiline
          appearance="inline"
          placeholder="What this test verifies, and the technique used"
          value={test.description}
          readOnly={readOnly}
          autosave={saveState}
          onChange={(description) => update((t) => ({ ...t, description }))}
        />
      </div>
    </div>
  );
}
