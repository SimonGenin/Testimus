import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Card } from "../../components/ui/Card.tsx";
import { color, fontSize, fontWeight, letterSpacing, lineHeight, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s6, padding: space.s5 },
  head: { display: "flex", flexDirection: "column", gap: space.s3 },
  title: {
    margin: 0,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    letterSpacing: letterSpacing.display,
    fontWeight: fontWeight.semibold,
    color: color.text,
  },
  lead: { margin: 0, color: color.textMuted, fontSize: fontSize.body, lineHeight: lineHeight.body },
  foot: { flex: 1, width: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  grow: { flex: 1 },
});

// ponytail: one step of the first launch — a card with its title, what it is for, its content and its way on
export function StepCard({
  id,
  title,
  lead,
  children,
  back,
  actions,
}: {
  id: string;
  title: string;
  lead?: ReactNode;
  children?: ReactNode;
  back?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <Card
        footer={
          back || actions ? (
            <div {...stylex.props(styles.foot)}>
              {back}
              <span {...stylex.props(styles.grow)} />
              {actions}
            </div>
          ) : undefined
        }
      >
        <div {...stylex.props(styles.body)}>
          <div {...stylex.props(styles.head)}>
            <h1 id={id} {...stylex.props(styles.title)}>
              {title}
            </h1>
            {lead && <p {...stylex.props(styles.lead)}>{lead}</p>}
          </div>
          {children}
        </div>
      </Card>
    </section>
  );
}
