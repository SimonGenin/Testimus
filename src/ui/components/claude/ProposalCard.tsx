import * as stylex from "@stylexjs/stylex";
import type { Proposal } from "../../../core/types.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { TextDiff } from "../ui/TextDiff.tsx";
import { type } from "../ui/type.ts";
import type { ShownProposal } from "./turns.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  why: { margin: 0, color: color.textMuted },
  foot: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
});

const WHAT: Record<Proposal["kind"], string> = {
  overview: "How the documents fit together",
  context: "Context",
  column: "Column",
};

const titleOf = (p: Proposal) => (p.kind === "overview" ? WHAT.overview : `${WHAT[p.kind]} « ${p.name} »`);

// ponytail: a change Claude proposed in the chat to a file it may not write — what and why, the diff of before and
// after; nothing is written until Apply (chat.apply), Ignore closes it, and an applied one is taken back by the run's
// Revert
export function ProposalCard({
  proposal: p,
  busy,
  onApply,
  onIgnore,
  onRevert,
}: {
  proposal: ShownProposal;
  /** true while one of its buttons is at work, or the reason they wait */
  busy: boolean | string;
  onApply: () => void;
  onIgnore: () => void;
  onRevert: () => void;
}) {
  const badge = p.reverted ? (
    <Badge tone="neutral" icon="undo" label="Reverted" />
  ) : p.state === "applied" ? (
    <Badge tone="success" icon="check-circle" label="Applied" />
  ) : p.state === "ignored" ? (
    <Badge tone="neutral" icon="close" label="Ignored" />
  ) : (
    <Badge tone="claude" icon="claude" label="Proposed" />
  );
  return (
    <Card
      sunken
      density="compact"
      title={titleOf(p)}
      actions={badge}
      footer={
        <div {...stylex.props(styles.foot)}>
          {p.state === "open" && (
            <>
              <Button size="sm" variant="claude" icon="check" label="Apply" disabled={busy} onClick={onApply} />
              <Button size="sm" variant="quiet" label="Ignore" disabled={busy} onClick={onIgnore} />
            </>
          )}
          {p.state === "applied" && !p.reverted && (
            <Button size="sm" icon="undo" label="Revert" disabled={busy} onClick={onRevert} />
          )}
        </div>
      }
    >
      <div {...stylex.props(styles.body)}>
        {p.why && <p {...stylex.props(type.compact, styles.why)}>{p.why}</p>}
        <TextDiff before={p.before} after={p.after} label={`Proposed change to ${titleOf(p)}`} />
      </div>
    </Card>
  );
}
