import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { type } from "../ui/type.ts";
import { useTopBar } from "./TopBar.tsx";

const styles = stylex.create({
  alone: { display: "flex", alignItems: "center", gap: space.s3, paddingBlock: space.s3, paddingInline: space.s5 },
  title: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0, margin: 0 },
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
  back: { display: "inline-flex", alignItems: "center", gap: space.s3, flex: "none" },
  rule: {
    alignSelf: "stretch",
    marginBlock: space.s2,
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: border.width,
    borderInlineStartColor: color.border,
  },
});

export type Crumb = string | { label: string; onClick: () => void };

export type Back = {
  /** where it leads (« the run », « review », « LFRPS12-1420 »): the button reads « Back to … »; none, « Back » */
  to?: string;
  /** it leaves this screen (a document opened from a test): the words are shown beside the arrow, the trail does not
   * hold the place it goes back to */
  away?: boolean;
  onClick: () => void;
};

const backLabel = (b: Back) => (b.to ? `Back to ${b.to}` : "Back");

// ponytail: a screen's part of the top bar — the way back when the screen went down into something (a test of a run,
// a test edited in Review, a document read from a test), its title, the trail under it (« Run › Sprint 12 › Test 3 of
// 12 », « Documents › SOSIE_211 · Traction »; a crumb that is a place goes there), a badge and a short state line, and
// its actions, put in the shell's bar; outside the shell (a screen tested alone) it draws them in place. Navigation
// lives here: a screen's own panes hold no « Back »
export function ScreenHeader({
  title,
  back,
  crumbs = [],
  badge,
  meta,
  children,
}: {
  title: string;
  /** the screen is down a level: an arrow before the title takes the user back up */
  back?: Back;
  /** where in the screen: the open document, the run, the kit component; each after a chevron, cut with an ellipsis;
   * one with onClick is a link to that level */
  crumbs?: Crumb[];
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
  const way = back && (
    <span {...stylex.props(styles.back)}>
      <Button
        variant="quiet"
        size="sm"
        icon="arrow-left"
        iconOnly={!back.away}
        label={backLabel(back)}
        onClick={back.onClick}
      />
      <span aria-hidden="true" {...stylex.props(styles.rule)} />
    </span>
  );
  const head = (
    <>
      {title}
      {crumbs.map((c) => {
        const label = typeof c === "string" ? c : c.label;
        return (
          <span key={label} title={label} {...stylex.props(type.regular, styles.crumb)}>
            <Icon name="chevron-right" size="sm" />
            <span {...stylex.props(styles.crumbText)}>
              {typeof c === "string" ? c : <Button variant="link" label={c.label} onClick={c.onClick} />}
            </span>
          </span>
        );
      })}
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
        {way}
        <h1 {...stylex.props(type.titleSm, styles.title)}>{head}</h1>
        {children}
      </header>
    );
  return (
    <>
      {bar.back && way && createPortal(way, bar.back)}
      {bar.title && createPortal(head, bar.title)}
      {bar.actions && children && createPortal(children, bar.actions)}
    </>
  );
}
