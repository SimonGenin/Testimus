import * as stylex from "@stylexjs/stylex";
import { ActionGroup } from "../../components/claude/ActionGroup.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { type } from "../../components/ui/type.ts";
import { type Action, groupByTarget } from "../../lib/actions.ts";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  caption: { margin: 0, color: color.textMuted },
  list: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: space.s1 },
});

// ponytail: the Claude actions the core left for this generation — its tests' findings, its categories of tests not
// written (actions.list by generation, the generation first) — under what each works on; each runs in the dock like any
// action, snapshotted
export function GenSuggestions({ generation }: { generation: string }) {
  const app = useApp();
  const read = useRead("actions.list", { generation, view: { kind: "generation", id: generation } });
  const actions = ((read.data ?? []) as Action[]).filter((a) => a.state === "open");
  if (!actions.length) return null;
  return (
    <section aria-label="Suggested by the results" {...stylex.props(styles.wrap)}>
      <h3 {...stylex.props(type.caption, styles.caption)}>Suggested by the results</h3>
      {groupByTarget(actions).map((g) => (
        <ActionGroup key={`${g.target.kind}:${g.target.id}`} group={g} dense>
          <ul {...stylex.props(styles.list)}>
            {g.actions.map((a) => (
              <li key={a.id}>
                <Button
                  variant="claude-quiet"
                  icon="claude"
                  block="start"
                  label={a.title}
                  onClick={() =>
                    app.runInDock({ name: "actions.run", input: { id: a.id }, label: a.title, testId: "" })
                  }
                />
              </li>
            ))}
          </ul>
        </ActionGroup>
      ))}
    </section>
  );
}
