import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, type ReactNode, useRef } from "react";
import {
  border,
  color,
  duration,
  easing,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { Badge } from "./Badge.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Tooltip } from "./Tooltip.tsx";

const styles = stylex.create({
  tabs: {
    display: "flex",
    gap: space.s6,
    paddingBlock: 0,
    paddingInline: space.s6,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
    overflowX: "auto",
    scrollbarWidth: "none",
  },
  tabsSm: { gap: space.s4, paddingInline: space.s4 },
  tab: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    height: size.tab,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.r1,
    backgroundColor: "transparent",
    color: { default: color.textMuted, ":hover": color.text },
    fontFamily: "inherit",
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    fontWeight: fontWeight.medium,
    whiteSpace: "nowrap",
    cursor: "pointer",
    transitionProperty: "color",
    transitionDuration: duration.instant,
    transitionTimingFunction: easing.standard,
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: `calc(-1 * ${border.widthStrong})`,
  },
  tabSm: { height: size.row },
  fill: { flex: 1, justifyContent: "center" },
  on: { color: color.text },
  bar: {
    position: "absolute",
    insetInline: 0,
    bottom: `calc(-1 * ${border.width})`,
    height: border.widthStrong,
    backgroundColor: color.accent,
    borderStartStartRadius: radius.r1,
    borderStartEndRadius: radius.r1,
  },
  hover: { color: color.text },
  focus: { outline: `${border.widthStrong} solid ${color.focusRing}` },
  disabled: { color: color.textDisabled, cursor: "not-allowed" },
  steps: { display: "flex", alignItems: "center", gap: space.s3, margin: 0, padding: 0, listStyle: "none" },
  step: { display: "inline-flex", alignItems: "center", gap: space.s3 },
  line: { width: space.s8, height: border.width, backgroundColor: color.borderStrong, marginInlineEnd: space.s1 },
  stepButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s3,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.full,
    backgroundColor: "transparent",
    color: { default: color.textMuted, ":hover": color.text },
    fontFamily: "inherit",
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    fontWeight: fontWeight.medium,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: border.widthStrong,
  },
  num: {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.controlSm,
    height: size.controlSm,
    borderRadius: radius.full,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.borderField,
    backgroundColor: color.surface,
    fontSize: fontSize.small,
    fontVariantNumeric: "tabular-nums",
  },
  numOn: { backgroundColor: color.accent, borderColor: color.accent, color: color.onAccent },
  numDone: { backgroundColor: color.successSubtle, borderColor: color.successBorder, color: color.success },
});

export type Tab<V extends string> = {
  value: V;
  label: string;
  count?: number;
  icon?: IconName;
  /** true, or why it cannot be opened now */
  disabled?: boolean | string;
};

export type TabsProps<V extends string> = {
  /** what the views are of (« Test list », « Setup steps »): the tab list's accessible name */
  label: string;
  value: V;
  tabs: Tab<V>[];
  onChange: (value: V) => void;
  /** tabs (default): views of one thing, the active one underlined · steps: numbered stages of a flow (first launch),
   * the ones before the current one marked done */
  variant?: "tabs" | "steps";
  /** md 36 px (default) · sm 32 px, in sidebars and the dock */
  size?: "sm" | "md";
  /** equal widths */
  fill?: boolean;
  /** the panels' id prefix: tab « x » controls the element `${panelId}-x` (see TabPanel) */
  panelId?: string;
  /** the catalogue only: a tab shown hovered or focused */
  debugState?: { value: V; state: "hover" | "focus" };
};

const enabled = <V extends string>(t: Tab<V>) => t.disabled === undefined || t.disabled === false;

// ponytail: switches between views of the same thing and never triggers an action; arrows, Home and End move between
// tabs and open the one they land on (WAI tabs, automatic activation)
export function Tabs<V extends string>({
  label,
  value,
  tabs,
  onChange,
  variant = "tabs",
  size: s = "md",
  fill = false,
  panelId,
  debugState,
}: TabsProps<V>) {
  const refs = useRef(new Map<V, HTMLButtonElement>());
  if (variant === "steps") {
    const at = tabs.findIndex((t) => t.value === value);
    return (
      <ol aria-label={label} {...stylex.props(styles.steps)}>
        {tabs.map((t, i) => (
          <li key={t.value} aria-current={i === at ? "step" : undefined} {...stylex.props(styles.step)}>
            {i > 0 && <span aria-hidden="true" {...stylex.props(styles.line)} />}
            <button
              type="button"
              disabled={!enabled(t)}
              onClick={() => onChange(t.value)}
              {...stylex.props(
                styles.stepButton,
                i === at && styles.on,
                !enabled(t) && styles.disabled,
                debugState?.value === t.value && styles[debugState.state],
              )}
            >
              <span {...stylex.props(styles.num, i === at && styles.numOn, i < at && styles.numDone)}>
                {i < at ? <Icon name="check" size="sm" label="Done" /> : i + 1}
              </span>
              {t.label}
            </button>
          </li>
        ))}
      </ol>
    );
  }
  const move = (e: KeyboardEvent, from: number) => {
    const open = tabs.map((t, i) => (enabled(t) ? i : -1)).filter((i) => i >= 0);
    const k = open.indexOf(from);
    const to =
      e.key === "ArrowRight"
        ? open[(k + 1) % open.length]
        : e.key === "ArrowLeft"
          ? open[(k - 1 + open.length) % open.length]
          : e.key === "Home"
            ? open[0]
            : e.key === "End"
              ? open[open.length - 1]
              : undefined;
    if (to === undefined) return;
    e.preventDefault();
    onChange(tabs[to].value);
    refs.current.get(tabs[to].value)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} {...stylex.props(styles.tabs, s === "sm" && styles.tabsSm)}>
      {tabs.map((t, i) => {
        const on = t.value === value;
        const tab = (
          <button
            key={t.value}
            ref={(el) => {
              if (el) refs.current.set(t.value, el);
              else refs.current.delete(t.value);
            }}
            type="button"
            role="tab"
            id={panelId ? `${panelId}-tab-${t.value}` : undefined}
            aria-selected={on}
            aria-controls={panelId ? `${panelId}-${t.value}` : undefined}
            aria-disabled={enabled(t) ? undefined : true}
            tabIndex={on ? 0 : -1}
            onClick={() => enabled(t) && onChange(t.value)}
            onKeyDown={(e) => move(e, i)}
            {...stylex.props(
              styles.tab,
              s === "sm" && styles.tabSm,
              fill && styles.fill,
              on && styles.on,
              !enabled(t) && styles.disabled,
              debugState?.value === t.value && styles[debugState.state],
            )}
          >
            {t.icon && <Icon name={t.icon} />}
            {t.label}
            {t.count !== undefined && (
              <Badge label={String(t.count)} count size="sm" tone={on ? "accent" : "neutral"} />
            )}
            {on && <span aria-hidden="true" {...stylex.props(styles.bar)} />}
          </button>
        );
        return typeof t.disabled === "string" ? (
          <Tooltip key={t.value} label={t.disabled}>
            {tab}
          </Tooltip>
        ) : (
          tab
        );
      })}
    </div>
  );
}

// ponytail: the panel a tab controls, labelled by it
export function TabPanel({ panelId, value, children }: { panelId: string; value: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${panelId}-${value}`} aria-labelledby={`${panelId}-tab-${value}`}>
      {children}
    </div>
  );
}
