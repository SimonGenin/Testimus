import { Badge, Button } from "../../../components/legacy/index.ts";
import { cx } from "../../../lib/format.ts";

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
    <article className={cx("card pack", active && "pack-on")} aria-label="Custom pack">
      <div className="pack-head">
        <h3 className="h pack-title">Custom</h3>
        {active && (
          <Badge tone="ok" icon="check" small>
            In use
          </Badge>
        )}
      </div>
      <p className="muted pack-intent">Pick the embedding and the reranker yourself, among the models on this PC.</p>
      <div className="pack-variant">
        <span className="label">On this PC</span>
        {active && embedding ? (
          <span className="pack-models">
            {label(embedding)}
            <span className="muted"> + </span>
            {reranker ? label(reranker) : <span className="muted">no reranker</span>}
          </span>
        ) : (
          <span className="muted">Not chosen</span>
        )}
      </div>
      <span className="spacer" />
      <div className="pack-foot">
        <Button size="sm" onClick={onChoose}>
          Choose models
        </Button>
      </div>
    </article>
  );
}
