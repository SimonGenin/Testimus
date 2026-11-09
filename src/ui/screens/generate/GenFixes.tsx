import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
import { type } from "../../components/ui/type.ts";
import type { Action } from "../../lib/actions.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  list: {
    listStyle: "none",
    margin: 0,
    paddingBlockStart: space.s3,
    paddingInline: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  row: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  lead: { display: "inline-flex", flexShrink: 0, color: color.claudeText },
  words: { flex: 1, minWidth: 0, margin: 0, display: "flex", flexDirection: "column" },
  title: { overflowWrap: "anywhere" },
  why: { color: color.textMuted, overflowWrap: "anywhere" },
  clamp: { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" },
  failed: { color: color.warning },
  tools: { display: "flex", alignItems: "center", gap: space.s1, flexShrink: 0 },
});

// ponytail: the fixes Claude proposes on one test, on that test's card — the action's title says the change (the test
// is the card's), Fix runs it in the dock, × dismisses it for good; a running one says so, one whose run failed says
// why and offers it again
export function GenFixes({
  fixes,
  onFix,
  onDismiss,
}: {
  fixes: Action[];
  onFix: (a: Action) => void;
  onDismiss: (a: Action) => void;
}) {
  if (!fixes.length) return null;
  return (
    <ul aria-label="Fixes Claude proposes" {...stylex.props(styles.list)}>
      {fixes.map((a) => {
        const failed = a.state === "open" && a.last && !a.last.ok;
        return (
          <li key={a.id} {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.lead)}>
              {a.state === "running" ? (
                <Spinner size="sm" label="Claude is fixing it" />
              ) : (
                <Icon name="claude" size="sm" />
              )}
            </span>
            <p {...stylex.props(type.compact, styles.words)}>
              <span {...stylex.props(styles.title)}>{a.title}</span>
              {a.state === "running" ? (
                <span {...stylex.props(type.small, styles.why)}>Claude is fixing it — follow it in the dock</span>
              ) : failed ? (
                <span {...stylex.props(type.small, styles.failed)}>Did not finish: {a.last?.summary}</span>
              ) : (
                a.problem && (
                  <span title={a.problem} {...stylex.props(type.small, styles.why, styles.clamp)}>
                    {a.problem}
                  </span>
                )
              )}
            </p>
            {a.state === "open" && (
              <span {...stylex.props(styles.tools)}>
                <Button
                  size="sm"
                  variant="claude-quiet"
                  label={failed ? "Try again" : "Fix"}
                  onClick={() => onFix(a)}
                />
                <Button
                  size="sm"
                  variant="quiet"
                  iconOnly
                  icon="close"
                  label={`Dismiss « ${a.title} »`}
                  onClick={() => onDismiss(a)}
                />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
