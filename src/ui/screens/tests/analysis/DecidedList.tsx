import * as stylex from "@stylexjs/stylex";
import { Badge, PROPOSAL } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { type } from "../../../components/ui/type.ts";
import { border, color, space } from "../../../styles/tokens.stylex.ts";
import type { ProposalView } from "./useAnalysis.ts";

const styles = stylex.create({
  list: { margin: 0, padding: 0, listStyle: "none" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minWidth: 0,
    paddingBlock: space.s3,
    paddingInline: space.s5,
    borderTopStyle: { default: "solid", ":first-child": "none" },
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  title: { flex: 1, minWidth: 0, overflowWrap: "anywhere" },
  where: { color: color.textSubtle },
});

const whereOf = (p: ProposalView) =>
  p.kind === "step" ? (p.after ? `after step ${p.after}` : "before step 1") : `step ${p.step}`;

// ponytail: what was decided, one line each — an accepted proposal is in the test now (an ordinary edit, undone in the
// editor), a rejected one may be reconsidered
export function DecidedList({
  proposals,
  busy,
  locked,
  onReopen,
}: {
  proposals: ProposalView[];
  busy: string[];
  locked?: false | string;
  onReopen: (id: string) => void;
}) {
  return (
    <Card density="compact" padded={false}>
      <ul {...stylex.props(styles.list)}>
        {proposals.map((p) => (
          <li key={p.id} {...stylex.props(styles.row)}>
            <Badge {...PROPOSAL[p.state === "accepted" ? "accepted" : "rejected"]} size="sm" />
            <span {...stylex.props(type.compact, styles.title)}>
              {p.title} <span {...stylex.props(styles.where)}>· {whereOf(p)}</span>
            </span>
            {p.state === "rejected" && (
              <Button
                size="sm"
                variant="link"
                label="Reconsider"
                disabled={locked || busy.includes(p.id)}
                onClick={() => onReopen(p.id)}
              />
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
