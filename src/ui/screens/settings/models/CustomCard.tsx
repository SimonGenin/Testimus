import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { type } from "../../../components/ui/type.ts";
import { border, color, space } from "../../../styles/tokens.stylex.ts";
import { ModelPair } from "./ModelPair.tsx";

const styles = stylex.create({
  card: { display: "flex", flexDirection: "column", minWidth: 0 },
  head: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  body: { display: "flex", flexDirection: "column", gap: space.s5 },
  intent: { margin: 0, color: color.textMuted },
  variant: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingTop: space.s3,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  small: { color: color.textMuted },
});

export function CustomCard({
  active,
  embedding,
  reranker,
  label,
  onChoose,
}: {
  active: boolean;
  embedding: string | null;
  reranker: string | null;
  label: (id: string) => string;
  onChoose: () => void;
}) {
  return (
    <article aria-label="Custom pack" {...stylex.props(styles.card)}>
      <Card
        fill
        selected={active}
        title={
          <span {...stylex.props(styles.head)}>
            <span {...stylex.props(type.title)}>Custom</span>
            {active && <Badge label="In use" tone="success" icon="check" size="sm" />}
          </span>
        }
        footer={<Button size="sm" icon="list" label="Open the catalog" onClick={onChoose} />}
      >
        <div {...stylex.props(styles.body)}>
          <p {...stylex.props(type.compact, styles.intent)}>
            Pick the embedding and the reranker yourself, among the models on this PC.
          </p>
          <div {...stylex.props(styles.variant)}>
            <span {...stylex.props(type.small, styles.small)}>On this PC</span>
            {active && embedding ? (
              <ModelPair embedding={embedding} reranker={reranker} label={label} />
            ) : (
              <span {...stylex.props(type.small, styles.small)}>Not chosen</span>
            )}
          </div>
        </div>
      </Card>
    </article>
  );
}
