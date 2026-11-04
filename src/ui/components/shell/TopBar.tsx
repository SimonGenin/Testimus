import * as stylex from "@stylexjs/stylex";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { border, breakpoint, color, size, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { type } from "../ui/type.ts";
import { Activity } from "./Activity.tsx";

const styles = stylex.create({
  bar: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: space.s4,
    height: size.topbar,
    paddingBlock: 0,
    paddingInlineStart: space.s6,
    paddingInlineEnd: space.s4,
    borderBottomWidth: border.width,
    borderBottomStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.surface,
    minWidth: 0,
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minWidth: 0,
    margin: 0,
    color: color.text,
    whiteSpace: "nowrap",
  },
  palette: {
    flex: "none",
    display: "flex",
    width: { default: size.paletteButton, [breakpoint.wide]: size.paletteButtonCompact, [breakpoint.dock]: "auto" },
  },
  slot: { display: "contents" },
  spacer: { flex: 1, minWidth: 0 },
  actions: { display: "flex", alignItems: "center", gap: space.s2, flex: "none" },
});

export type TopBarSlots = {
  title: HTMLElement | null;
  actions: HTMLElement | null;
  claim: (by: number) => void;
};

export const TopBarContext = createContext<TopBarSlots | null>(null);

export const useTopBar = () => useContext(TopBarContext);

export function useTopBarSlots() {
  const [title, setTitle] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [claimed, setClaimed] = useState(0);
  const claim = useCallback((by: number) => setClaimed((n) => n + by), []);
  const value = useMemo<TopBarSlots>(() => ({ title, actions, claim }), [title, actions, claim]);
  return { value, claimed, setTitle, setActions };
}

// ponytail: the bar on top of every screen — its title (a screen may put its own, with a badge and a short line,
// through ScreenHeader), the screen's actions, the running work and the palette; the slots are filled by portals
export function TopBar({
  title,
  onPalette,
  slots,
}: {
  title: string;
  onPalette: () => void;
  slots: ReturnType<typeof useTopBarSlots>;
}) {
  return (
    <header {...stylex.props(styles.bar)}>
      <h1 {...stylex.props(type.titleSm, styles.title)}>
        {slots.claimed === 0 && title}
        <span ref={slots.setTitle} {...stylex.props(styles.slot)} />
      </h1>
      <span {...stylex.props(styles.spacer)} />
      <span ref={slots.setActions} {...stylex.props(styles.actions)} />
      <Activity />
      <span {...stylex.props(styles.palette)}>
        <Button variant="field" icon="search" label="Search everything" shortcut="Ctrl K" block onClick={onPalette} />
      </span>
    </header>
  );
}
