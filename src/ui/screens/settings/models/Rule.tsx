import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Icon } from "../../../components/ui/Icon.tsx";
import { type } from "../../../components/ui/type.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { Row } from "../Section.tsx";

const styles = stylex.create({
  rule: { display: "flex", alignItems: "flex-start", gap: space.s2, margin: 0, color: color.textMuted },
});

// ponytail: a constraint of a kind, said where it matters — between its advised row and its table
export function Rule({ children }: { children: ReactNode }) {
  return (
    <Row>
      <p {...stylex.props(type.small, styles.rule)}>
        <Icon name="info" size="sm" />
        <span>{children}</span>
      </p>
    </Row>
  );
}
