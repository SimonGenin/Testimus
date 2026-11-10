import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { size, space } from "../../../styles/tokens.stylex.ts";
import { Hint } from "../Section.tsx";
import { useRetrievalDraft } from "./draft.ts";
import { Ranking } from "./Ranking.tsx";
import { TryIt } from "./TryIt.tsx";
import { Words } from "./Words.tsx";

const styles = stylex.create({
  split: { display: "flex", gap: space.s6, alignItems: "flex-start", flexWrap: "wrap" },
  left: {
    flexGrow: 3,
    flexShrink: 1,
    flexBasis: `calc(${size.reading} * 3 / 4)`,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
  },
  right: {
    flexGrow: 2,
    flexShrink: 1,
    flexBasis: `calc(${size.reading} / 2)`,
    minWidth: 0,
    position: "sticky",
    top: space.s6,
  },
  bar: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  grow: { flex: 1, minWidth: 0 },
});

// ponytail: how passages are found, edited as a draft — the ranking and the words on the left (then what the page
// adds there), Try it on the right with the same draft, staying in view while the left scrolls; once the pane is too
// narrow for both, Try it goes under them. Save puts the draft in project.json
export function Tuning({ children }: { children?: ReactNode }) {
  const draft = useRetrievalDraft();
  const data = draft.read.data;
  return (
    <div {...stylex.props(styles.split)}>
      <div {...stylex.props(styles.left)}>
        {draft.read.isError ? (
          <Banner tone="danger" title="The search settings could not be read">
            {draft.read.error.message}
          </Banner>
        ) : !data || !draft.value ? (
          <Skeleton lines={6} />
        ) : (
          <>
            <Ranking draft={draft} reranker={data.reranker} />
            <Words draft={draft} glossary={data.glossary} />
            {draft.dirty && (
              <div {...stylex.props(styles.bar)}>
                <span {...stylex.props(styles.grow)}>
                  <Hint>Not saved: Try it and Measure use these settings; the other searches do not yet.</Hint>
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
          </>
        )}
        {children}
      </div>
      {draft.value && (
        <div {...stylex.props(styles.right)}>
          <TryIt draft={draft.value} />
        </div>
      )}
    </div>
  );
}
