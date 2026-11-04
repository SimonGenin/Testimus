import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Icon } from "../ui/Icon.tsx";
import { type } from "../ui/type.ts";
import { useTopBar } from "./TopBar.tsx";

const styles = stylex.create({
  alone: { display: "flex", alignItems: "center", gap: space.s3, paddingBlock: space.s3, paddingInline: space.s5 },
  title: { display: "flex", alignItems: "center", gap: space.s3, margin: 0 },
  crumb: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
    overflow: "hidden",
    color: color.textMuted,
  },
  crumbText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  meta: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: color.textMuted },
});

// ponytail: a screen's part of the top bar — its title, the trail under it (« Documents › SOSIE_211 · Traction »,
// « Kit › Modal »), a badge and a short state line, and its actions, put in the shell's bar; outside the shell (a
// screen tested alone) it draws them in place
export function ScreenHeader({
  title,
  crumbs = [],
  badge,
  meta,
  children,
}: {
  title: string;
  /** where in the screen: the open document, the kit component; each after a chevron, cut with an ellipsis */
  crumbs?: string[];
  badge?: ReactNode;
  meta?: string;
  children?: ReactNode;
}) {
  const bar = useTopBar();
  const claim = bar?.claim;
  useEffect(() => {
    if (!claim) return;
    claim(1);
    return () => claim(-1);
  }, [claim]);
  const head = (
    <>
      {title}
      {crumbs.map((c) => (
        <span key={c} title={c} {...stylex.props(type.regular, styles.crumb)}>
          <Icon name="chevron-right" size="sm" />
          <span {...stylex.props(styles.crumbText)}>{c}</span>
        </span>
      ))}
      {badge}
      {meta && (
        <span title={meta} {...stylex.props(type.small, type.regular, styles.meta)}>
          {meta}
        </span>
      )}
    </>
  );
  if (!bar)
    return (
      <header {...stylex.props(styles.alone)}>
        <h1 {...stylex.props(type.titleSm, styles.title)}>{head}</h1>
        {children}
      </header>
    );
  return (
    <>
      {bar.title && createPortal(head, bar.title)}
      {bar.actions && children && createPortal(children, bar.actions)}
    </>
  );
}
