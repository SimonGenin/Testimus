import * as stylex from "@stylexjs/stylex";
import { type MouseEvent, type Ref, useId } from "react";
import { border, color, fontSize, lineHeight, radius, size, space } from "../../styles/tokens.stylex.ts";
import type { ButtonProps } from "./Button.tsx";
import { Field } from "./Field.tsx";
import { halo } from "./halo.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Menu } from "./Menu.tsx";
import { Tooltip } from "./Tooltip.tsx";

// ponytail: kit.css .select — one control: icon, prefix, value and chevron inside its edge
const styles = stylex.create({
  wrap: { display: "inline-flex", minWidth: 0, maxWidth: "100%" },
  block: { display: "flex", width: "100%" },
  start: { alignSelf: "flex-start" },
  select: {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    minWidth: 0,
    maxWidth: "100%",
    height: size.controlMd,
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: space.s4,
    paddingInlineEnd: space.s3,
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
  fill: { display: "flex", flex: 1, width: "100%" },
  value: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  valueQuiet: { flex: "none" },
  placeholder: { color: color.textSubtle },
  prefix: { flex: "none", color: color.textMuted },
  icon: { flex: "none", display: "inline-flex", color: color.textMuted },
  quiet: {
    borderColor: { default: "transparent", ":hover": "transparent", ":focus-visible": color.focusRing },
    backgroundColor: { default: "transparent", ":hover": color.surfaceHover },
    color: { default: color.textMuted, ":hover": color.text },
    paddingInlineStart: space.s2,
  },
  sm: { height: size.controlSm, fontSize: fontSize.small, lineHeight: lineHeight.small },
  open: { borderColor: color.focusRing },
  quietOpen: { backgroundColor: color.surfaceHover, color: color.text },
  disabled: {
    backgroundColor: color.surfaceSunken,
    borderColor: color.border,
    boxShadow: "none",
    color: color.textDisabled,
    cursor: "not-allowed",
  },
  disabledQuiet: { backgroundColor: "transparent", borderColor: "transparent" },
  forceHover: { borderColor: color.borderControl },
  forceHoverQuiet: { backgroundColor: color.surfaceHover, color: color.text },
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
  /** before the prefix or the value (« Sort »: sort) */
  icon?: IconName;
  /** shown while nothing is chosen (« Choose a folder… ») */
  placeholder?: string;
  /** true, or the reason, shown as a tooltip */
  disabled?: boolean | string;
  block?: boolean;
  /** the catalogue only */
  debugState?: "hover" | "focus" | "open";
};

export type SelectTriggerProps = {
  id?: string;
  /** the accessible name (read out unless a label outside names the field) */
  label: string;
  /** the chosen option's label, or the placeholder */
  shown: string;
  empty?: boolean;
  /** a label outside names it (htmlFor) */
  named?: boolean;
  describedBy?: string;
  appearance?: "boxed" | "quiet";
  size?: "sm" | "md";
  prefix?: string;
  icon?: IconName;
  disabled?: boolean;
  block?: boolean;
  debugState?: "hover" | "focus" | "open";
  ref?: Ref<HTMLButtonElement>;
  popup?: ButtonProps["popup"];
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
};

// ponytail: the closed field of a select — a select-only combobox (its name is the label, its text the chosen option);
// Menu hands it its ref, its popup state and its toggle, as it does a Button. GroupSelect draws its field with it too
export function SelectTrigger(p: SelectTriggerProps) {
  const quiet = p.appearance === "quiet";
  const open = p.popup?.open === true;
  // ponytail: under a Menu of several groups (GroupSelect) it is a menu button named by what it shows
  const menu = p.popup?.kind === "menu";
  return (
    <button
      ref={p.ref}
      id={p.id}
      type="button"
      role={menu ? undefined : "combobox"}
      aria-label={p.named || menu ? undefined : p.label}
      aria-describedby={p.describedBy}
      aria-haspopup={menu ? "menu" : "listbox"}
      aria-expanded={open}
      aria-controls={p.popup?.controls}
      disabled={p.disabled}
      onClick={p.onClick}
      {...stylex.props(
        styles.select,
        halo.visible,
        quiet && styles.quiet,
        p.size === "sm" && styles.sm,
        p.block && styles.fill,
        open && (quiet ? styles.quietOpen : styles.open),
        p.debugState === "hover" && (quiet ? styles.forceHoverQuiet : styles.forceHover),
        p.debugState === "focus" && [styles.forceFocus, halo.shown],
        p.disabled && styles.disabled,
        p.disabled && quiet && styles.disabledQuiet,
      )}
    >
      {p.icon && (
        <span aria-hidden="true" {...stylex.props(styles.icon)}>
          <Icon name={p.icon} size="sm" />
        </span>
      )}
      {p.prefix && (
        <span aria-hidden="true" {...stylex.props(styles.prefix)}>
          {p.prefix}
        </span>
      )}
      <span
        {...stylex.props(
          styles.value,
          quiet && !p.block && styles.valueQuiet,
          p.empty && !p.disabled && styles.placeholder,
        )}
      >
        {p.shown}
      </span>
      <span aria-hidden="true" {...stylex.props(styles.icon)}>
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
      <Menu
        label={label}
        listbox
        block={block}
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
          <SelectTrigger
            id={id}
            label={label}
            shown={chosen?.label ?? placeholder ?? "Choose…"}
            empty={!chosen}
            named={showLabel}
            describedBy={showLabel && shownHint ? `${id}-hint` : undefined}
            appearance={appearance}
            size={s}
            prefix={prefix}
            icon={icon}
            disabled={off}
            block={block}
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
