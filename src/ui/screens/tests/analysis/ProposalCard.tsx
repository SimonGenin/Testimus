import * as stylex from "@stylexjs/stylex";
import type { Source } from "../../../../core/types.ts";
import { Badge, PROPOSAL } from "../../../components/ui/Badge.tsx";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { TextDiff } from "../../../components/ui/TextDiff.tsx";
import { type } from "../../../components/ui/type.ts";
import { relTime } from "../../../lib/format.ts";
import { color, radius, size, space } from "../../../styles/tokens.stylex.ts";
import { StepSource } from "../step/StepSource.tsx";
import type { Decision, ProposalView } from "./useAnalysis.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  head: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  title: { flex: 1, minWidth: 0, margin: 0, overflowWrap: "anywhere" },
  chips: { display: "flex", flexWrap: "wrap", gap: space.s2, minWidth: 0 },
  fields: {
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns: `minmax(0, ${size.thumb}) minmax(0, 1fr)`,
    columnGap: space.s3,
    rowGap: space.s1,
    margin: 0,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
  },
  pair: { display: "contents" },
  label: { margin: 0, color: color.textMuted },
  value: { margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  why: { margin: 0, color: color.textMuted },
  foot: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: space.s3 },
  stale: { flex: 1, margin: 0, color: color.warning },
});

function acceptLabel(p: ProposalView): string {
  if (p.kind === "remove") return "Remove step";
  if (p.kind === "step") return p.now ? `Add after step ${p.now}` : "Add as step 1";
  return "Accept";
}

// ponytail: one proposal of Claude's analysis, to decide on its own — what it does (its badge and title), the change
// itself (the sources it adds, the cell before and after, the new step's columns, the step it takes out), why, and two
// buttons; one that no longer applies says why instead
export function ProposalCard({
  proposal: p,
  removed,
  selected,
  busy,
  locked,
  onDecide,
  onOpenSource,
}: {
  proposal: ProposalView;
  /** a step to remove: its text as the test has it now */
  removed?: string;
  selected?: boolean;
  busy?: boolean;
  /** why nothing can be decided now (Claude is working on the test) */
  locked?: false | string;
  onDecide: (decision: Decision) => void;
  onOpenSource: (s: Source) => void;
}) {
  const sources = p.cites.length > 0 && (
    <div {...stylex.props(styles.chips)}>
      {p.cites.map((s, i) => (
        <StepSource key={i} source={s} onOpen={onOpenSource} />
      ))}
    </div>
  );
  return (
    <Card density="compact" edge={selected ? "claude" : undefined}>
      <div {...stylex.props(styles.body)} data-proposal={p.id}>
        <div {...stylex.props(styles.head)}>
          <Badge {...PROPOSAL[p.kind]} />
          <h4 {...stylex.props(type.compact, type.medium, styles.title)}>{p.title}</h4>
        </div>
        {p.kind === "change" && (
          <TextDiff
            before={p.before ?? ""}
            after={p.value ?? ""}
            label={`${p.column ?? "The cell"}, before and after`}
          />
        )}
        {p.kind === "remove" && removed && <TextDiff before={removed} after="" label="The step taken out" />}
        {p.kind === "step" && p.fields && (
          <dl {...stylex.props(type.compact, styles.fields)}>
            {Object.entries(p.fields).map(([k, v]) => (
              <div key={k} {...stylex.props(styles.pair)}>
                <dt {...stylex.props(styles.label)}>{k}</dt>
                <dd {...stylex.props(styles.value)}>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {sources}
        <p {...stylex.props(type.small, styles.why)}>{p.why}</p>
        {p.undone ? (
          <Banner tone="info" compact>
            Accepted{p.undone.by ? ` by ${p.undone.by}` : ""}
            {p.undone.at ? ` ${relTime(Date.parse(p.undone.at))}` : ""}, then taken out of the test (reverted or
            undone): to decide again.
          </Banner>
        ) : null}
        {p.drops?.length ? (
          <Banner tone="warning" compact>
            Also takes out what the team entered: {p.drops.map((d) => `${d.item} (${d.column})`).join(", ")}.
          </Banner>
        ) : null}
        <div {...stylex.props(styles.foot)}>
          {p.stale ? <p {...stylex.props(type.small, styles.stale)}>{p.stale}</p> : null}
          <Button size="sm" label="Reject" disabled={locked || busy} onClick={() => onDecide("reject")} />
          {!p.stale && (
            <Button
              size="sm"
              variant="primary"
              label={acceptLabel(p)}
              loading={busy}
              disabled={locked}
              onClick={() => onDecide("accept")}
            />
          )}
        </div>
      </div>
    </Card>
  );
}
