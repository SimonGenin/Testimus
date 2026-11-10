import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Facts } from "../ui/Facts.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Raw } from "../ui/Raw.tsx";
import { type } from "../ui/type.ts";
import { HOW, ICON, type Piece, tokens } from "./pieces.ts";

const styles = stylex.create({
  piece: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  head: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  icon: { display: "inline-flex", color: color.textSubtle },
  name: { flex: 1, minWidth: 0, margin: 0, overflowWrap: "anywhere" },
  actions: { display: "inline-flex", gap: space.s2, flex: "none" },
  why: { margin: 0, color: color.textMuted },
  tools: { display: "flex", flexWrap: "wrap", gap: space.s2, margin: 0, padding: 0, listStyle: "none" },
  searched: { margin: 0, color: color.textMuted },
});

// ponytail: one piece of a Claude run, read beside the list — why it is there, how it reaches Claude and how big it is,
// its file, then what it says: its text as Claude gets it, the tools by name, or for a document how it is searched
export function GivenPiece({ piece: p, actions, fixed }: { piece: Piece; actions?: ReactNode; fixed?: string }) {
  const names = p.kind === "tools" && p.detail ? p.detail.split(/,\s*/).filter(Boolean) : null;
  return (
    <article aria-label={p.name} {...stylex.props(styles.piece)}>
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.icon)}>
          <Icon name={ICON[p.kind]} size="lg" />
        </span>
        <h3 {...stylex.props(type.titleSm, styles.name)}>{p.name}</h3>
        {actions && <span {...stylex.props(styles.actions)}>{actions}</span>}
      </div>
      {p.why && <p {...stylex.props(type.compact, styles.why)}>{p.why}</p>}
      <Facts
        label={`About « ${p.name} »`}
        items={[
          { label: "Given", value: [HOW[p.how].word, p.chars ? tokens(p.chars) : ""].filter(Boolean).join(" · ") },
          !!p.path && {
            label: p.how === "auto" ? "Loaded from" : "File",
            value: <span {...stylex.props(type.mono)}>{p.path}</span>,
          },
          !!p.detail && !names && { label: "Details", value: p.detail },
          !p.on && { label: "This run", value: "Left out" },
          !!fixed && { label: "Chosen", value: fixed },
        ]}
      />
      {names ? (
        <ul aria-label="The tools" {...stylex.props(styles.tools)}>
          {names.map((n) => (
            <li key={n}>
              <Badge label={n} size="sm" />
            </li>
          ))}
        </ul>
      ) : p.text ? (
        <Raw text={p.text} label={`${p.name}, in full`} />
      ) : p.how === "search" ? (
        <p {...stylex.props(type.compact, styles.searched)}>
          Claude searches it as it works and reads only the passages it needs. It is never sent whole.
        </p>
      ) : null}
    </article>
  );
}
