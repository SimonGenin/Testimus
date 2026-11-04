import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { color, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { useTopBar } from "./TopBar.tsx";

const styles = stylex.create({
  alone: { display: "flex", alignItems: "center", gap: space.s3, paddingBlock: space.s3, paddingInline: space.s5 },
  title: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    margin: 0,
    fontSize: fontSize.titleSm,
    lineHeight: lineHeight.titleSm,
    fontWeight: fontWeight.semibold,
  },
  meta: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: color.textMuted,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.regular,
  },
});

// ponytail: a screen's part of the top bar — its title (with a badge and a short state line) and its actions, put
// in the shell's bar; outside the shell (a screen tested alone) it draws them in place
export function ScreenHeader({
  title,
  badge,
  meta,
  children,
}: {
  title: string;
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
      {badge}
      {meta && (
        <span title={meta} {...stylex.props(styles.meta)}>
          {meta}
        </span>
      )}
    </>
  );
  if (!bar)
    return (
      <header {...stylex.props(styles.alone)}>
        <h1 {...stylex.props(styles.title)}>{head}</h1>
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
