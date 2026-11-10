import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Badge } from "../../../components/ui/Badge.tsx";
import { type } from "../../../components/ui/type.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { Fact, Row } from "../Section.tsx";
import { IN_USE } from "./data.ts";
import { OpLine } from "./OpLine.tsx";
import type { Op } from "./ops.tsx";

const styles = stylex.create({
  name: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2 },
  facts: { display: "flex", flexWrap: "wrap", columnGap: space.s5, rowGap: space.s1, color: color.textMuted },
  value: { color: color.text },
  line: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2 },
});

// ponytail: the first row of a kind — the model that suits this PC best, why (the core's words, with the numbers),
// what it takes, and the one gesture that gets it (« Download and use », « Use »), or « In use » when it already is
export function AdvisedRow({
  name,
  hint,
  facts,
  inUse,
  op,
  children,
}: {
  name: string;
  hint: ReactNode;
  facts: [string, string][];
  inUse: boolean;
  op: Op | null;
  children?: ReactNode;
}) {
  return (
    <Row>
      <Fact label="Advised for this PC" hint={hint}>
        <span {...stylex.props(styles.name)}>
          <span {...stylex.props(type.titleSm)}>{name}</span>
          {inUse && <Badge {...IN_USE} size="sm" />}
        </span>
        {facts.length > 0 && (
          <span {...stylex.props(type.small, styles.facts)}>
            {facts.map(([k, v]) => (
              <span key={k}>
                {k} <span {...stylex.props(type.medium, styles.value)}>{v}</span>
              </span>
            ))}
          </span>
        )}
        {op ? <OpLine op={op} /> : children && <div {...stylex.props(styles.line)}>{children}</div>}
      </Fact>
    </Row>
  );
}
