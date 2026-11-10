import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Raw } from "../../components/ui/Raw.tsx";
import { type } from "../../components/ui/type.ts";
import { desktop, reveal } from "../../lib/desktop.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { type Given, ORIGIN, slots, tokens } from "./given.ts";
import { Fact, Group, Hint, Row } from "./Section.tsx";

const styles = stylex.create({
  title: { display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: space.s3 },
  path: { color: color.textMuted, overflowWrap: "anywhere" },
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
    <section aria-label={p.name}>
      <Group
        title={
          <span {...stylex.props(styles.title)}>
            {p.name}
            <Badge size="sm" tone={p.origin === "skill" ? "claude" : "neutral"} label={ORIGIN[p.origin]} />
          </span>
        }
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
            <Hint>Built by Testimus for each run: the parts in braces are filled then — {filled.join(", ")}.</Hint>
          )
        }
      >
        <Row>
          <Fact label="Used by">{p.usedBy.join(" · ")}</Fact>
        </Row>
        <Row>
          <Fact label="Where it is">
            <span {...stylex.props(type.code, styles.path)}>{p.path ?? "Built per run — not a file"}</span>
          </Fact>
        </Row>
        {p.text.length > 0 && (
          <Row>
            <Fact label="Weight">
              <span {...stylex.props(type.tabular)}>{tokens(p.text.length)}</span>
            </Fact>
          </Row>
        )}
        <Row>
          <Raw text={p.text} label={`Text of ${p.name}`} maxLines={32} empty="(empty)" />
        </Row>
      </Group>
    </section>
  );
}
