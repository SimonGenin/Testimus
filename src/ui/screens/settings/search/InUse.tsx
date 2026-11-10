import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { type } from "../../../components/ui/type.ts";
import { useApp } from "../../../lib/app.ts";
import { useRead } from "../../../lib/data/query.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { Fact, Group, Row } from "../Section.tsx";
import { useModelLabel } from "./labels.ts";

const styles = stylex.create({
  line: { display: "flex", alignItems: "center", gap: space.s2, flexWrap: "wrap", minWidth: 0 },
  muted: { margin: 0, color: color.textMuted },
});

// ponytail: the embedding and the reranker this PC searches with — chosen per kind in Models for every project, so
// only read out here; a model chosen but not installed says so
export function InUse() {
  const app = useApp();
  const st = useRead("rag.status", {});
  const label = useModelLabel();
  const s = st.data;
  const models = () => app.navigate("settings", "models");
  return (
    <Group id="models" title="Search models">
      <Row>
        <Fact label="In use" hint="This project's choice on this PC.">
          {st.isError ? (
            <p {...stylex.props(type.small, styles.muted)}>Unknown: the index state could not be read.</p>
          ) : !s ? (
            <Skeleton width="60%" />
          ) : (
            <span {...stylex.props(styles.line)}>
              <Badge
                label={s.embedding === "none" ? "No embedding model" : `Embedding: ${label(s.embedding)}`}
                tone={s.embedding === "none" ? "warning" : "neutral"}
              />
              <Badge label={`Reranker: ${s.reranker ? label(s.reranker) : "none"}`} />
            </span>
          )}
          {s && s.missing.length > 0 && (
            <span {...stylex.props(styles.line)}>
              <Badge
                label={`Not on this PC: ${s.missing.map(label).join(", ")}`}
                tone="warning"
                icon="alert-triangle"
              />
              <span {...stylex.props(type.small, styles.muted)}>Another choice is used until it is installed.</span>
            </span>
          )}
          <p {...stylex.props(type.small, styles.muted)}>
            Chosen in <Button variant="link" label="Models" onClick={models} />, where the ones best for this PC come
            first.
          </p>
        </Fact>
      </Row>
    </Group>
  );
}
