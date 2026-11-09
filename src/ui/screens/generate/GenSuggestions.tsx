import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import type { GenFixes } from "./useGenFixes.ts";

const styles = stylex.create({
  text: { margin: 0, color: color.textMuted },
  list: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: space.s2 },
  row: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  words: { flex: 1, minWidth: 0, overflowWrap: "anywhere" },
});

// ponytail: what the results leave to Claude, beside the ask — the fixes on the tests are counted (each sits on its
// test's card, at the right; the scope « The n with a fix » asks on them all at once), what is proposed on the
// generation itself (the categories of tests not written) is listed here with its button
export function GenSuggestions({ fixes }: { fixes: GenFixes }) {
  if (!fixes.count && !fixes.general.length) return null;
  return (
    <Card edge="claude" density="compact" title="Claude proposes">
      {fixes.count > 0 && (
        <p {...stylex.props(type.compact, styles.text)}>
          {fixes.count} {fixes.count === 1 ? "fix" : "fixes"} on {plural(fixes.tests.length, "test")}, each on its test
          at the right. To ask for them all at once, pick « The {fixes.tests.length} with a fix » above.
        </p>
      )}
      {fixes.general.length > 0 && (
        <ul {...stylex.props(styles.list)}>
          {fixes.general.map((a) => (
            <li key={a.id} {...stylex.props(styles.row)}>
              <span {...stylex.props(type.compact, styles.words)}>{a.title}</span>
              {a.state === "open" && (
                <Button size="sm" variant="claude-quiet" icon="claude" label="Run" onClick={() => fixes.run(a)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
