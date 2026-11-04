import * as stylex from "@stylexjs/stylex";
import type { Precondition } from "../../../../core/types.ts";
import { Chip } from "../../../components/ui/Chip.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { type } from "../../../components/ui/type.ts";
import { color, radius, space } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  panel: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    paddingBlock: space.s4,
    paddingInline: space.s5,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceSunken,
  },
  one: { display: "flex", flexDirection: "column", gap: space.s2 },
  head: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s3,
    color: color.text,
  },
  muted: { color: color.textMuted },
  grow: { flex: 1 },
  def: {
    boxSizing: "border-box",
    margin: 0,
    paddingInlineStart: `calc(${space.s5} + ${space.s3})`,
    whiteSpace: "pre-wrap",
    color: color.textMuted,
  },
});

// ponytail: the preconditions a test attaches, read-only — they live in Jira; their key opens the issue there
export function PreconditionList({
  keys,
  known,
  onOpen,
}: {
  keys: string[];
  known: Precondition[] | null;
  onOpen: (key: string) => void;
}) {
  return (
    <section aria-label="Preconditions" {...stylex.props(styles.panel)}>
      {keys.map((k) => {
        const p = known?.find((x) => x.key === k);
        return (
          <div key={k} {...stylex.props(styles.one)}>
            <div {...stylex.props(type.compact, styles.head)}>
              <span {...stylex.props(styles.muted)}>
                <Icon name="lock" size="sm" />
              </span>
              <span {...stylex.props(styles.muted)}>Precondition</span>
              <Chip label={k} mono icon="external" onClick={() => onOpen(k)} />
              <span {...stylex.props(type.medium)}>{p?.summary ?? (known === null ? "loading…" : "not loaded")}</span>
              <span {...stylex.props(styles.grow)} />
              <span {...stylex.props(styles.muted)}>Read-only · lives in Jira</span>
            </div>
            {p?.definition && <p {...stylex.props(type.compact, type.ui, styles.def)}>{p.definition}</p>}
          </div>
        );
      })}
    </section>
  );
}
