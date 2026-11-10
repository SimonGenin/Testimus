import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Raw } from "../../components/ui/Raw.tsx";
import { type } from "../../components/ui/type.ts";
import { desktop, reveal } from "../../lib/desktop.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { type Given, slots, tokens } from "./given.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  facts: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0, margin: 0 },
  muted: { color: color.textMuted },
  path: { color: color.textMuted, overflowWrap: "anywhere" },
  foot: { margin: 0, color: color.textMuted },
});

const copy = (p: Given) =>
  navigator.clipboard
    .writeText(p.text)
    .then(() => toast({ tone: "neutral", title: `“${p.name}” copied` }))
    .catch((e) => errorToast(e, "Could not copy the text"));

// ponytail: one piece runs share, read only — a skill, a project file (CLAUDE.md, how the documents fit together), a
// template or a probe Testimus builds that is no run of its own: who sends it, where it lives, what it weighs, and its
// whole text
export function PromptCard({ prompt: p }: { prompt: Given }) {
  const filled = p.origin === "built" ? slots(p.text) : [];
  return (
    <Card
      title={p.name}
      actions={
        <>
          <Button size="sm" icon="copy" label="Copy" onClick={() => void copy(p)} />
          {desktop() && p.file && (
            <Button
              size="sm"
              icon="folder-open"
              label="Show in Explorer"
              onClick={() => void reveal(p.file as string)}
            />
          )}
        </>
      }
      footer={
        filled.length > 0 && (
          <p {...stylex.props(type.small, styles.foot)}>
            Built by Testimus for each run: the parts in braces are filled then — {filled.join(", ")}.
          </p>
        )
      }
    >
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(type.small, styles.facts)}>
          <span {...stylex.props(styles.muted)}>Used by: {p.usedBy.join(" · ")}</span>
          <span {...stylex.props(type.code, styles.path)}>{p.path ?? "Built per run — not a file"}</span>
          {p.text.length > 0 && <span {...stylex.props(type.tabular, styles.muted)}>{tokens(p.text.length)}</span>}
        </p>
        <Raw text={p.text} label={`Text of ${p.name}`} maxLines={32} empty="(empty)" />
      </div>
    </Card>
  );
}
