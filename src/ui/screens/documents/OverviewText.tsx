import * as stylex from "@stylexjs/stylex";
import { AnswerText } from "../../components/claude/AnswerText.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  text: { display: "flex", flexDirection: "column", gap: space.s4, maxWidth: size.reading, minWidth: 0 },
  heading: { margin: 0, marginTop: space.s3, color: color.text },
});

type Block = { heading?: { level: number; text: string }; text?: string };

// ponytail: Claude's markdown as React elements — a heading line is a heading (its <!-- doc … --> mark left out), the
// lines between are Claude's words with their sources as chips; ** marks are dropped, never shown
function blocksOf(md: string): Block[] {
  const out: Block[] = [];
  let lines: string[] = [];
  const flush = () => {
    const text = lines.join("\n").trim();
    if (text) out.push({ text });
    lines = [];
  };
  for (const raw of md.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/)) {
    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (!h) {
      lines.push(raw.replace(/\*\*/g, "").replace(/\s+$/, ""));
      continue;
    }
    flush();
    out.push({ heading: { level: h[1].length, text: h[2].trim() } });
  }
  flush();
  return out;
}

export function OverviewText({ text }: { text: string }) {
  const app = useApp();
  return (
    <div data-testid="overview-text" {...stylex.props(styles.text)}>
      {blocksOf(text).map((b, i) =>
        b.heading ? (
          b.heading.level <= 2 ? (
            <h2 key={i} {...stylex.props(type.title, styles.heading)}>
              {b.heading.text}
            </h2>
          ) : (
            <h3 key={i} {...stylex.props(type.titleSm, styles.heading)}>
              {b.heading.text}
            </h3>
          )
        ) : (
          <AnswerText key={i} reading text={b.text ?? ""} onOpenSource={app.openSource} />
        ),
      )}
    </div>
  );
}
