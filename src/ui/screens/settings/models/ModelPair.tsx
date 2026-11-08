import * as stylex from "@stylexjs/stylex";
import { type } from "../../../components/ui/type.ts";
import { color } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({ muted: { color: color.textMuted } });

// An embedding and its reranker by name, « no reranker » when there is none
export function ModelPair({
  embedding,
  reranker,
  label,
}: {
  embedding: string;
  reranker: string | null;
  label: (id: string) => string;
}) {
  return (
    <span {...stylex.props(type.compact, type.medium)}>
      {label(embedding)}
      <span {...stylex.props(type.regular, styles.muted)}>{reranker ? " + " : " · "}</span>
      {reranker ? label(reranker) : <span {...stylex.props(type.regular, styles.muted)}>no reranker</span>}
    </span>
  );
}
