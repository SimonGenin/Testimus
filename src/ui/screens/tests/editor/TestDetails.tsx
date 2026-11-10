import * as stylex from "@stylexjs/stylex";
import type { Precondition, Test } from "../../../../core/types.ts";
import { Button } from "../../../components/ui/Button.tsx";
import { ChipField } from "../../../components/ui/ChipField.tsx";
import { type FieldAutosave, Text } from "../../../components/ui/Text.tsx";
import { type } from "../../../components/ui/type.ts";
import { border, breakpoint, color, space } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  grid: {
    boxSizing: "border-box",
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
    color: color.textMuted,
  },
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2 },
  note: { color: color.textMuted },
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
  onContext,
}: {
  test: Test;
  readOnly?: boolean;
  saveState?: FieldAutosave;
  preconditions: Precondition[] | null;
  contexts: ContextRef[];
  testContexts: TestContexts | null;
  update: (fn: (t: Test) => Test) => void;
  onContexts: (ids: string[] | null) => void;
  /** opens what a run on this test is given: its saved contexts are ticked, made and edited there */
  onContext: () => void;
}) {
  const eff = testContexts?.effective ?? [];
  const known = new Map(contexts.map((c) => [c.id, c.name]));
  const pre = preconditions ?? [];
  return (
    <div {...stylex.props(styles.grid)}>
      <ChipField
        label="Labels"
        showLabel
        placeholder="Add a label…"
        values={test.labels}
        onChange={readOnly ? undefined : (labels) => update((t) => ({ ...t, labels }))}
      />
      <ChipField
        label="Covers"
        showLabel
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
          icon="plus"
          placeholder={test.preconditions.length ? "Attach another…" : "Attach a precondition…"}
          values={test.preconditions}
          choices={pre.map((p) => ({ value: p.key, label: p.key }))}
          onChange={readOnly ? undefined : (keys) => update((t) => ({ ...t, preconditions: [...keys].sort() }))}
        />
        {preconditions === null ? (
          <span {...stylex.props(type.small, styles.note)}>Loading the project's preconditions…</span>
        ) : !pre.length ? (
          <span {...stylex.props(type.small, styles.note)}>None in this project</span>
        ) : null}
      </div>
      <div {...stylex.props(styles.field)}>
        <ChipField
          label="Claude contexts"
          showLabel
          appearance="inline"
          icon="plus"
          chip={{ icon: "context", tone: "claude" }}
          placeholder={eff.length ? "Attach another…" : "Attach a context…"}
          values={eff}
          choices={contexts.map((c) => ({ value: c.id, label: c.name }))}
          onChange={readOnly || !testContexts ? undefined : (ids) => onContexts(ids)}
        />
        <span {...stylex.props(styles.row)}>
          <span {...stylex.props(type.small, styles.note)}>
            {testContexts?.own != null
              ? "This test's own list"
              : eff.length
                ? `Project defaults · ${eff.map((id) => known.get(id) ?? id).join(", ")}`
                : "Project defaults · none yet"}
          </span>
          {testContexts?.own != null && !readOnly && (
            <Button variant="quiet" size="xs" label="Use the project defaults" onClick={() => onContexts(null)} />
          )}
          <Button variant="quiet" size="xs" icon="context" label="Context…" onClick={onContext} />
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
