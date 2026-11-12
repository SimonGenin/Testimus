import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { List } from "../../components/ui/List.tsx";
import { Menu } from "../../components/ui/Menu.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { PlanName } from "./PlanName.tsx";
import { merge, type Planned, rename, retheme, themesOf, toggle } from "./planEdits.ts";

const styles = stylex.create({
  meta: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, minWidth: 0 },
  how: { color: color.textSubtle },
});

const NO_THEME = "No theme";

type Overlap = { tests: [number, number]; sections: string[] };
type Editing = { kind: "rename" | "theme"; k: number } | null;

// ponytail: the plan as the tree of its themes — each test ticked or not, renamed, moved to another theme, merged into
// another; two tests that read the same sections say so. Every change is written at once (gen.planSet)
export function PlanList({
  tests,
  overlaps,
  disabled,
  onChange,
}: {
  tests: Planned[];
  overlaps: Overlap[];
  /** why nothing can change now (a run under way) */
  disabled?: string;
  onChange: (tests: Planned[]) => void;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const themes = themesOf(tests);
  const keyOf = (k: number) => String(k);
  const groups = [...themes, ...(tests.some((t) => !t.theme) ? [""] : [])].map((theme) => {
    const keys = tests.flatMap((t, k) => ((t.theme ?? "") === theme ? [keyOf(k)] : []));
    const on = keys.filter((k) => !tests[Number(k)].off).length;
    return { label: theme || NO_THEME, meta: on === keys.length ? String(on) : `${on} of ${keys.length}`, keys };
  });
  const near = (k: number) =>
    overlaps.flatMap((o) => (o.tests[0] === k ? [o.tests[1]] : o.tests[1] === k ? [o.tests[0]] : []));
  return (
    <>
      <List<number>
        label="Planned tests"
        selection="none"
        items={tests.map((_, k) => k)}
        getKey={keyOf}
        groups={groups}
        density="two-line"
        renderItem={(k) => {
          const t = tests[k];
          const twins = near(k);
          return {
            title: `${k + 1}. ${t.summary}`,
            tooltip: t.summary,
            disabled: !!t.off,
            lead: (
              <Checkbox
                bare
                checked={!t.off}
                label={`Write « ${t.summary} »`}
                disabled={disabled ?? false}
                onChange={() => onChange(toggle(tests, k))}
              />
            ),
            meta: (
              <span {...stylex.props(styles.meta)}>
                <span {...stylex.props(type.small, styles.how)}>
                  {[t.technique, t.sections.join(", ") || "whole documents"].filter(Boolean).join(" · ")}
                </span>
                {twins.length > 0 && (
                  <Badge
                    size="sm"
                    tone="warning"
                    icon="alert-triangle"
                    label={`Same sections as ${twins.map((j) => j + 1).join(", ")}`}
                    tooltip="These tests read the same sections: they may write the same steps. Merge them, or keep both."
                  />
                )}
              </span>
            ),
            actions: (
              <>
                <Button
                  variant="quiet"
                  size="xs"
                  iconOnly
                  icon="text"
                  label={`Rename « ${t.summary} »`}
                  disabled={disabled ?? false}
                  onClick={() => setEditing({ kind: "rename", k })}
                />
                <Menu
                  label={`Theme of « ${t.summary} »`}
                  align="end"
                  entries={[
                    ...themes.map((th) => ({
                      label: th,
                      icon: "folder" as const,
                      checked: th === t.theme,
                      onSelect: () => onChange(retheme(tests, k, th)),
                    })),
                    ...(themes.length ? ["separator" as const] : []),
                    { label: "New theme…", icon: "plus" as const, onSelect: () => setEditing({ kind: "theme", k }) },
                  ]}
                  trigger={
                    <Button
                      variant="quiet"
                      size="xs"
                      iconOnly
                      icon="folder"
                      label={`Move « ${t.summary} » to another theme`}
                      disabled={disabled ?? false}
                    />
                  }
                />
                <Menu
                  label={`Merge « ${t.summary} » with`}
                  align="end"
                  entries={tests.flatMap((o, j) =>
                    j === k
                      ? []
                      : [
                          {
                            label: `${j + 1}. ${o.summary}`,
                            ...(twins.includes(j) ? { hint: "same sections" } : {}),
                            onSelect: () => onChange(merge(tests, k, j)),
                          },
                        ],
                  )}
                  trigger={
                    <Button
                      variant="quiet"
                      size="xs"
                      iconOnly
                      icon="layers"
                      label={`Merge « ${t.summary} » with another test`}
                      disabled={disabled ?? (tests.length < 2 ? "Only one test" : false)}
                    />
                  }
                />
              </>
            ),
          };
        }}
      />
      {editing && (
        <PlanName
          title={editing.kind === "rename" ? "Rename the test" : "New theme"}
          label={editing.kind === "rename" ? "Summary" : `Theme of « ${tests[editing.k].summary} »`}
          value={editing.kind === "rename" ? tests[editing.k].summary : ""}
          onClose={() => setEditing(null)}
          onApply={(text) => {
            onChange(editing.kind === "rename" ? rename(tests, editing.k, text) : retheme(tests, editing.k, text));
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

export const planCount = (tests: Planned[]) => {
  const on = tests.filter((t) => !t.off).length;
  const themes = new Set(tests.filter((t) => !t.off).map((t) => t.theme ?? "")).size;
  return { on, themes, line: `${plural(on, "test")} in ${plural(themes, "theme")}` };
};
