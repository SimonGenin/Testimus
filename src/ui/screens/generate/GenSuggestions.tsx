import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  caption: { margin: 0, color: color.textMuted },
  list: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: space.s2 },
});

// ponytail: the Claude actions the core left for this generation — its tests' findings, its categories of tests not
// written (actions.list by generation); each runs in the dock like any action, snapshotted
export function GenSuggestions({ generation }: { generation: string }) {
  const app = useApp();
  const actions = (useRead("actions.list", { generation }).data ?? []).filter((a) => a.state === "open");
  if (!actions.length) return null;
  return (
    <section aria-label="Suggested by the results" {...stylex.props(styles.wrap)}>
      <h3 {...stylex.props(type.caption, styles.caption)}>Suggested by the results</h3>
      <ul {...stylex.props(styles.list)}>
        {actions.map((a) => (
          <li key={a.id}>
            <Button
              variant="claude-quiet"
              icon="claude"
              block="start"
              label={a.title}
              onClick={() => app.runInDock({ name: "actions.run", input: { id: a.id }, label: a.title, testId: "" })}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
