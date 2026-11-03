import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, useRef } from "react";
import {
  border,
  color,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  shadow,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Tooltip } from "./Tooltip.tsx";

const styles = stylex.create({
  group: {
    boxSizing: "border-box",
    display: "inline-flex",
    gap: space.s1,
    padding: space.s1,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
  },
  option: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s2,
    height: `calc(${size.controlMd} - 2 * ${space.s1} - 2 * ${border.width})`,
    margin: 0,
    paddingBlock: 0,
    paddingInline: space.s3,
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
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: 0,
  },
  sm: {
    height: `calc(${size.controlSm} - 2 * ${space.s1} - 2 * ${border.width})`,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
  },
  iconOnly: { paddingInline: space.s2 },
  on: {
    backgroundColor: color.surface,
    color: color.text,
    boxShadow: `${shadow.s1}, 0 0 0 ${border.width} ${color.borderStrong}`,
  },
  disabled: { color: color.textDisabled, cursor: "not-allowed" },
  forceHover: { color: color.text },
  forceFocus: { outline: `${border.widthStrong} solid ${color.focusRing}` },
  count: { fontVariantNumeric: "tabular-nums", fontWeight: fontWeight.regular, color: color.textSubtle },
});

export type SegmentedOption<V extends string> = {
  value: V;
  /** a short noun; with iconOnly it is the accessible name and the tooltip */
  label: string;
  icon?: IconName;
  iconOnly?: boolean;
  /** a number after the label (« All 5 »), kept apart so the label stays short */
  count?: number;
  /** true, or the reason, shown as a tooltip */
  disabled?: boolean | string;
};

type ForcedOption<V extends string> = { value: V; state: "hover" | "focus" };

export type SegmentedProps<V extends string> = {
  value: V;
  /** two to five views or modes, all visible */
  options: SegmentedOption<V>[];
  onChange: (value: V) => void;
  /** the group's accessible name (« Step layout ») */
  label: string;
  size?: "sm" | "md";
  /** the catalogue only: the option shown hovered or focused */
  debugState?: ForcedOption<V>;
};

const NEXT: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

// ponytail: one of two to five views, all visible — a radiogroup: Tab enters on the chosen option, the arrows move and
// choose (skipping disabled options); a choice that starts an action is buttons (SYSTEM.md)
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
  size: s = "md",
  debugState,
}: SegmentedProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const current = options.findIndex((o) => o.value === value);
  const stop = enabled.includes(current) ? current : (enabled[0] ?? -1);
  const choose = (i: number) => {
    refs.current[i]?.focus();
    if (options[i].value !== value) onChange(options[i].value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (enabled.length === 0) return;
    const at = enabled.indexOf(refs.current.indexOf(e.target as HTMLButtonElement));
    let to: number | undefined;
    if (e.key in NEXT) to = enabled[(at + NEXT[e.key] + enabled.length) % enabled.length];
    else if (e.key === "Home") to = enabled[0];
    else if (e.key === "End") to = enabled[enabled.length - 1];
    if (to === undefined) return;
    e.preventDefault();
    choose(to);
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} {...stylex.props(styles.group)}>
      {options.map((o, i) => {
        const on = o.value === value;
        const off = o.disabled !== undefined && o.disabled !== false;
        const forced = debugState?.value === o.value ? debugState.state : undefined;
        const button = (
          // biome-ignore lint/a11y/useSemanticElements: the radio group pattern with a roving tab stop, drawn as segments
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.iconOnly ? o.label : undefined}
            disabled={off}
            tabIndex={i === stop ? 0 : -1}
            onClick={() => choose(i)}
            {...stylex.props(
              styles.option,
              s === "sm" && styles.sm,
              o.iconOnly && styles.iconOnly,
              forced === "hover" && styles.forceHover,
              forced === "focus" && styles.forceFocus,
              on && styles.on,
              off && styles.disabled,
            )}
          >
            {o.icon && <Icon name={o.icon} size="sm" />}
            {!o.iconOnly && o.label}
            {!o.iconOnly && o.count !== undefined && (
              <>
                {" "}
                <span {...stylex.props(styles.count)}>{o.count}</span>
              </>
            )}
          </button>
        );
        const tip = typeof o.disabled === "string" ? o.disabled : o.iconOnly ? o.label : null;
        return tip ? (
          <Tooltip key={o.value} label={tip}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
