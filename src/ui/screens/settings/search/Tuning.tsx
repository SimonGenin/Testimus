import * as stylex from "@stylexjs/stylex";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { size, space } from "../../../styles/tokens.stylex.ts";
import { Column, Hint } from "../Section.tsx";
import { useRetrievalDraft } from "./draft.ts";
import { Ranking } from "./Ranking.tsx";
import { TryIt } from "./TryIt.tsx";
import { Words } from "./Words.tsx";

const styles = stylex.create({
  columns: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, calc(${size.reading} * 5 / 8)), 1fr))`,
    gap: space.s5,
    alignItems: "start",
  },
  bar: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  grow: { flex: 1, minWidth: 0 },
});

// ponytail: how passages are found, edited as a draft — the ranking and the words on the left, Try it on the right
// with the same draft (side by side from five eighths of a reading width each, narrower than Columns asks: Try it is
// read beside the settings it tries); Save puts it in project.json, for the whole team
export function Tuning() {
  const draft = useRetrievalDraft();
  const data = draft.read.data;
  if (draft.read.isError)
    return (
      <Banner tone="danger" title="The search settings could not be read">
        {draft.read.error.message}
      </Banner>
    );
  if (!data || !draft.value) return <Skeleton lines={6} />;
  return (
    <div {...stylex.props(styles.columns)}>
      <Column>
        <Ranking draft={draft} reranker={data.reranker} />
        <Words draft={draft} glossary={data.glossary} />
        {draft.dirty && (
          <div {...stylex.props(styles.bar)}>
            <span {...stylex.props(styles.grow)}>
              <Hint>Not saved: Try it and Measure use these settings; the team's searches do not yet.</Hint>
            </span>
            <Button variant="quiet" label="Discard" disabled={draft.saving} onClick={draft.discard} />
            <Button
              variant="primary"
              label="Save to project.json"
              loading={draft.saving}
              onClick={() => void draft.save()}
            />
          </div>
        )}
        <Card title="Filters a search can use">
          <Hint>
            By document, by kind (text · figure), by section prefix (§5.6), by date of the document. Claude's search
            tool takes the same filters.
          </Hint>
        </Card>
      </Column>
      <Column>
        <TryIt draft={draft.value} />
      </Column>
    </div>
  );
}
