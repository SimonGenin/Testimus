import * as stylex from "@stylexjs/stylex";
import { plural } from "../../lib/format.ts";
import { nameTests, useTestNames } from "../../lib/labels.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { Spinner } from "../ui/Spinner.tsx";
import { elapsed } from "../ui/Timer.tsx";
import { type } from "../ui/type.ts";
import type { Turn } from "./turns.ts";

const styles = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  now: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0, color: color.textMuted },
  mark: { display: "inline-flex", flex: "none", color: color.claudeText },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  skills: { display: "inline-flex", gap: space.s2 },
  steps: {
    listStyle: "none",
    margin: 0,
    marginInlineStart: space.s3,
    paddingBlock: 0,
    paddingInlineStart: space.s4,
    borderInlineStartWidth: border.width,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: color.border,
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    color: color.textMuted,
  },
  step: { display: "flex", alignItems: "baseline", gap: space.s3, minWidth: 0 },
  at: { marginInlineStart: "auto", flex: "none", color: color.textSubtle },
});

export const worked = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
};

// ponytail: what Claude did in a turn, in two lines at most — while it works, the step under way and the skills it
// opened; once it is done, one folded line (how long, how many steps). Every step is under the fold, with its time
export function DockActivity({ turn: t }: { turn: Turn }) {
  const names = useTestNames();
  if (!t.tools.length) return null;
  const skills = [...new Set(t.tools.flatMap((x) => (x.skill ? [x.skill] : [])))];
  const current = t.running ? t.tools.find((x) => !x.done) : undefined;
  const took = t.meta && !t.running ? `Worked ${worked(t.meta.durationMs)} · ` : "";
  return (
    <div {...stylex.props(styles.wrap)}>
      {current && (
        <div {...stylex.props(type.compact, styles.now)}>
          <span {...stylex.props(styles.mark)}>
            <Spinner size="sm" />
          </span>
          <span {...stylex.props(styles.label)}>{nameTests(current.label, names)}…</span>
        </div>
      )}
      <Disclosure
        quiet
        icon={t.running ? undefined : "check"}
        summary={`${took}${plural(t.tools.length, "step")}`}
        meta={
          skills.length > 0 && (
            <span {...stylex.props(styles.skills)}>
              {skills.map((s) => (
                <Badge key={s} tone="claude" icon="claude" size="sm" label={s} tooltip={`Claude used the ${s} skill`} />
              ))}
            </span>
          )
        }
      >
        <ol aria-label="Claude's work" {...stylex.props(type.small, styles.steps)}>
          {t.tools.map((x, i) => (
            <li key={i} {...stylex.props(styles.step)}>
              <span {...stylex.props(styles.label)}>{nameTests(x.label, names)}</span>
              {x.at && t.startedAt && (
                <span {...stylex.props(type.tabular, styles.at)}>{elapsed((x.at - t.startedAt) / 1000)}</span>
              )}
            </li>
          ))}
        </ol>
      </Disclosure>
    </div>
  );
}
