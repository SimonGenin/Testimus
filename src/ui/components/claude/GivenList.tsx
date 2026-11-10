import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Icon } from "../ui/Icon.tsx";
import { List } from "../ui/List.tsx";
import { type } from "../ui/type.ts";
import { CONTEXTS, HOW, ICON, type Piece, type PieceGroup, tokensShort } from "./pieces.ts";

const styles = stylex.create({
  groups: { display: "flex", flexDirection: "column", gap: space.s4, paddingBlock: space.s3 },
  group: { display: "flex", flexDirection: "column", minWidth: 0 },
  head: { display: "flex", alignItems: "baseline", gap: space.s3, margin: 0, paddingInline: space.s5 },
  meta: { color: color.textSubtle },
  note: { marginInlineStart: "auto", color: color.textSubtle },
  lead: { display: "inline-flex", alignItems: "center", gap: space.s3 },
  room: { display: "inline-block", width: size.iconMd },
  why: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  size: { display: "inline-flex", alignItems: "center", gap: space.s3 },
  how: { color: color.textSubtle },
  off: { color: color.textDisabled, textDecorationLine: "line-through" },
  empty: { margin: 0, paddingInline: space.s5, paddingBlock: space.s2, color: color.textSubtle },
  library: { paddingInline: space.s5, paddingTop: space.s2 },
});

const EMPTY = "Contexts are notes written once and given to Claude on every run: a house style, a glossary.";

// ponytail: the pieces of a Claude run, group by group, each a row picked to be read beside — the ones that can be
// left out with their checkbox (the box alone: the row says the name), the others with the room of one so names line
// up; how it is given and its size at the end of the row, struck out when it is off
export function GivenList({
  groups,
  picked,
  onPick,
  canTick,
  onTick,
  disabled,
  library,
  fixed,
}: {
  groups: PieceGroup[];
  picked: string | null;
  onPick: (id: string) => void;
  canTick: (p: Piece) => boolean;
  onTick: (id: string, on: boolean) => void;
  /** nothing can be ticked for now: the reason */
  disabled: string | false;
  /** under the saved contexts: New context, Save the text as a context, Copy from another project */
  library: ReactNode;
  /** said in a group's head when a piece could be left out but not here (« Chosen for each run ») */
  fixed?: string;
}) {
  return (
    <div {...stylex.props(styles.groups)}>
      {groups.map((g) => {
        const ticks = g.pieces.filter(canTick);
        const note = fixed && g.pieces.some((p) => !p.locked && !canTick(p)) ? fixed : undefined;
        return (
          <section key={g.label} aria-label={g.label} {...stylex.props(styles.group)}>
            <h3 {...stylex.props(type.caption, styles.head)}>
              {g.label}
              {ticks.length > 0 && (
                <span {...stylex.props(type.regular, type.tabular, styles.meta)}>
                  {ticks.filter((p) => p.on).length} of {ticks.length} ticked
                </span>
              )}
              {note && <span {...stylex.props(type.regular, styles.note)}>{note}</span>}
            </h3>
            <List
              label={g.label}
              items={g.pieces}
              getKey={(p) => p.id}
              selected={picked}
              onSelect={onPick}
              empty={g.label === CONTEXTS ? <p {...stylex.props(type.small, styles.empty)}>{EMPTY}</p> : undefined}
              renderItem={(p) => ({
                title: p.name,
                meta: p.why || p.detail ? <span {...stylex.props(styles.why)}>{p.why || p.detail}</span> : undefined,
                depth: p.parent && g.pieces.some((x) => x.id === p.parent) ? 1 : undefined,
                lead: (
                  <span {...stylex.props(styles.lead)}>
                    {canTick(p) ? (
                      <Checkbox
                        bare
                        checked={p.on}
                        label={p.name}
                        onChange={(on) => onTick(p.id, on)}
                        disabled={disabled}
                      />
                    ) : (
                      <span {...stylex.props(styles.room)} />
                    )}
                    <Icon name={ICON[p.kind]} />
                  </span>
                ),
                trail:
                  HOW[p.how].short || p.chars ? (
                    <span {...stylex.props(styles.size)}>
                      {HOW[p.how].short && <span {...stylex.props(styles.how)}>{HOW[p.how].short}</span>}
                      {p.chars > 0 && <span {...stylex.props(!p.on && styles.off)}>{tokensShort(p.chars)}</span>}
                    </span>
                  ) : undefined,
              })}
            />
            {g.label === CONTEXTS && <div {...stylex.props(styles.library)}>{library}</div>}
          </section>
        );
      })}
    </div>
  );
}
