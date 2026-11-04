import * as stylex from "@stylexjs/stylex";
import { type MouseEvent, type Ref, useId } from "react";
import { border, color, fontSize, lineHeight, radius, size, space } from "../../styles/tokens.stylex.ts";
import type { ButtonProps } from "./Button.tsx";
import { Field } from "./Field.tsx";
import { halo } from "./halo.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Menu } from "./Menu.tsx";
import { Tooltip } from "./Tooltip.tsx";

const styles = stylex.create({
  wrap: { position: "relative", display: "inline-flex", alignItems: "center", minWidth: 0, maxWidth: "100%" },
  block: { display: "flex", width: "100%" },
  start: { alignSelf: "flex-start" },
  select: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    height: size.controlMd,
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: space.s4,
    paddingInlineEnd: space.s3,
    gap: space.s2,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: { default: color.borderField, ":hover": color.borderControl, ":focus-visible": color.focusRing },
    borderRadius: radius.r2,
    backgroundColor: color.surface,
    color: color.text,
    fontFamily: "inherit",
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    textAlign: "start",
    whiteSpace: "nowrap",
    cursor: "pointer",
    outline: "none",
  },
  value: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  placeholder: { color: color.textSubtle },
  quiet: {
    borderColor: { default: "transparent", ":hover": "transparent", ":focus-visible": color.focusRing },
    backgroundColor: { default: "transparent", ":hover": color.surfaceHover },
    color: { default: color.textMuted, ":hover": color.text },
    paddingInlineStart: space.s2,
  },
  sm: { height: size.controlSm, fontSize: fontSize.small },
  withLead: { paddingInlineStart: `calc(${space.s4} + ${size.iconMd} + ${space.s2})` },
  withPrefix: { paddingInlineStart: space.s1 },
  open: { borderColor: color.focusRing },
  disabled: {
    backgroundColor: color.surfaceSunken,
    borderColor: color.border,
    boxShadow: "none",
    color: color.textDisabled,
    cursor: "not-allowed",
  },
  lead: {
    position: "absolute",
    insetInlineStart: space.s4,
    display: "inline-flex",
    color: color.textMuted,
    pointerEvents: "none",
  },
  prefix: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    paddingInlineStart: space.s4,
    color: color.textMuted,
    fontSize: fontSize.compact,
    whiteSpace: "nowrap",
  },
  chevron: { flex: "none", display: "inline-flex", color: color.textMuted },
  forceHover: { borderColor: color.borderControl },
  forceFocus: { borderColor: color.focusRing },
});

export type SelectOption<V extends string> = {
  value: V;
  label: string;
  /** a few words on the choice (« fast, for short asks »): the second line of the option in the open list, and the
   * hint under a labelled select while it is the chosen one */
  hint?: string;
  disabled?: boolean;
};

export type SelectProps<V extends string> = {
  /** the field's id, when a label outside names it (htmlFor) */
  id?: string;
  value: V | null;
  options: SelectOption<V>[];
  onChange: (value: V) => void;
  /** the accessible name; shown above the field only with `showLabel` */
  label: string;
  /** the label above the field, as Text's (the kit's Field) */
  showLabel?: boolean;
  /** under a labelled select: an example, a consequence (else the chosen option's hint) */
  hint?: string;
  /** boxed (forms) · quiet (toolbars, the dock footer, a sort) */
  appearance?: "boxed" | "quiet";
  size?: "sm" | "md";
  /** a word before the value (« Sort », « Folder ») */
  prefix?: string;
  /** before the value, or before the prefix when there is one (« Sort »: sort) */
  icon?: IconName;
  /** shown while nothing is chosen (« Choose a folder… ») */
  placeholder?: string;
  /** true, or the reason, shown as a tooltip */
  disabled?: boolean | string;
  block?: boolean;
  /** the catalogue only */
  debugState?: "hover" | "focus" | "open";
};

type TriggerProps = {
  id: string;
  label: string;
  shown: string;
  empty: boolean;
  named: boolean;
  describedBy?: string;
  quiet: boolean;
  small: boolean;
  lead: boolean;
  prefixed: boolean;
  off: boolean;
  debugState?: "hover" | "focus" | "open";
  ref?: Ref<HTMLButtonElement>;
  popup?: ButtonProps["popup"];
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
};

// ponytail: the closed field — a select-only combobox (its name is the label, its text the chosen option); Menu hands
// it its ref, its popup state and its toggle, as it does a Button
function Trigger(p: TriggerProps) {
  return (
    <button
      ref={p.ref}
      id={p.id}
      type="button"
      role="combobox"
      aria-label={p.named ? undefined : p.label}
      aria-describedby={p.describedBy}
      aria-haspopup="listbox"
      aria-expanded={p.popup?.open ?? false}
      aria-controls={p.popup?.controls}
      disabled={p.off}
      onClick={p.onClick}
      {...stylex.props(
        styles.select,
        halo.visible,
        p.quiet && styles.quiet,
        p.small && styles.sm,
        p.lead && styles.withLead,
        p.prefixed && styles.withPrefix,
        p.popup?.open && styles.open,
        p.debugState === "hover" && styles.forceHover,
        p.debugState === "focus" && [styles.forceFocus, halo.shown],
        p.off && styles.disabled,
      )}
    >
      <span {...stylex.props(styles.value, p.empty && !p.off && styles.placeholder)}>{p.shown}</span>
      <span aria-hidden="true" {...stylex.props(styles.chevron)}>
        <Icon name="chevron-down" size="sm" />
      </span>
    </button>
  );
}

// ponytail: one value from a short known list; the open list is the kit's Menu (SYSTEM.md Select: « a select never draws
// its own list ») — more than about twelve values or free text is a Text with suggestions, two values a Segmented choice
// or a Switch
export function Select<V extends string>({
  id: givenId,
  value,
  options,
  onChange,
  label,
  showLabel = false,
  hint,
  appearance = "boxed",
  size: s = "md",
  prefix,
  icon,
  placeholder,
  disabled = false,
  block = false,
  debugState,
}: SelectProps<V>) {
  const auto = useId();
  const id = givenId ?? auto;
  const off = disabled !== false;
  const chosen = options.find((o) => o.value === value);
  const shownHint = hint ?? chosen?.hint;
  const field = (
    <span {...stylex.props(styles.wrap, block && styles.block, showLabel && !block && styles.start)}>
      {prefix && (
        <span aria-hidden="true" {...stylex.props(styles.prefix)}>
          {icon && <Icon name={icon} />}
          {prefix}
        </span>
      )}
      {icon && !prefix && (
        <span {...stylex.props(styles.lead)}>
          <Icon name={icon} />
        </span>
      )}
      <Menu
        label={label}
        listbox
        block
        debugState={debugState === "open" ? "open" : undefined}
        entries={options.map((o) => ({
          label: o.label,
          description: o.hint,
          checked: o.value === value,
          disabled: o.disabled,
          onSelect: () => {
            if (o.value !== value) onChange(o.value);
          },
        }))}
        trigger={
          <Trigger
            id={id}
            label={label}
            shown={chosen?.label ?? placeholder ?? "Choose…"}
            empty={!chosen}
            named={showLabel}
            describedBy={showLabel && shownHint ? `${id}-hint` : undefined}
            quiet={appearance === "quiet"}
            small={s === "sm"}
            lead={!!icon && !prefix}
            prefixed={prefix !== undefined}
            off={off}
            debugState={debugState}
          />
        }
      />
    </span>
  );
  const shown = typeof disabled === "string" ? <Tooltip label={disabled}>{field}</Tooltip> : field;
  if (!showLabel) return shown;
  return (
    <Field label={label} htmlFor={id} hint={shownHint} hintId={`${id}-hint`}>
      {shown}
    </Field>
  );
}
