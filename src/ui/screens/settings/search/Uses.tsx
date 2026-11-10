import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import type { CommandOutput } from "../../../../core/commands/index.ts";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { Loading } from "../../../components/ui/Loading.tsx";
import { Table } from "../../../components/ui/Table.tsx";
import { type } from "../../../components/ui/type.ts";
import { useRead } from "../../../lib/data/query.ts";
import { plural } from "../../../lib/format.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { Hint, Stack } from "../Section.tsx";

const styles = stylex.create({
  cell: { display: "inline-flex", alignItems: "center", gap: space.s2, flexWrap: "wrap" },
  muted: { color: color.textMuted },
  title: { margin: 0 },
});

type Use = CommandOutput<"models.usage">[number];

const muted = (text: string) => <span {...stylex.props(type.small, styles.muted)}>{text}</span>;

function words(u: Use): ReactNode {
  if (u.words === "always") return <Badge label="Always" tone="success" size="sm" />;
  if (u.words === "builds") return <Badge label="Builds it" size="sm" />;
  return muted("—");
}

function embedding(u: Use): ReactNode {
  if (u.embedding.use === "no") return muted("—");
  return u.embedding.label ?? muted("None on this PC: words only");
}

function reranker(u: Use): ReactNode {
  if (u.reranker.use === "no")
    return (
      <span {...stylex.props(styles.cell)}>
        <Badge label="Never" size="sm" />
        {u.reranker.why && muted(u.reranker.why)}
      </span>
    );
  return u.reranker.label ?? muted("None in the models in use");
}

// ponytail: folded at the foot of the page — one line per user of the search, as the core declares it beside each
// user's code (models.usage): the words, the embedding and the reranker each one really takes here, and when; then
// the filters a search takes
export function Uses() {
  const [open, setOpen] = useState(false);
  const usage = useRead("models.usage", {});
  return (
    <Card
      title="Where search is used, and the filters it takes"
      actions={usage.data && <Badge label={plural(usage.data.length, "place")} size="sm" />}
      fold={{ open, onOpenChange: setOpen }}
    >
      <Stack>
        {usage.isError ? (
          <Banner tone="danger" title="Who uses what could not be read">
            {usage.error.message}
          </Banner>
        ) : (
          <Table<Use>
            label="Who uses what on this PC"
            dense
            loading={!usage.data}
            rows={usage.data ?? []}
            getKey={(u) => u.id}
            columns={[
              { key: "who", label: "Who" },
              { key: "words", label: "Words (BM25)", render: words },
              { key: "embedding", label: "Embedding", render: embedding },
              { key: "reranker", label: "Reranker", render: reranker },
              { key: "when", label: "When", render: (u) => muted(u.when) },
            ]}
          />
        )}
        {!usage.data && !usage.error && <Loading read="models.usage" />}
        <Hint>
          Every search finds the same evidence by its words and the documents' structure; the models only rank it.
        </Hint>
        <h3 {...stylex.props(type.label, styles.title)}>Filters a search can use</h3>
        <Hint>
          By document, by kind (text · figure), by section prefix (§5.6), by date of the document. Claude's search tool
          takes the same filters.
        </Hint>
      </Stack>
    </Card>
  );
}
