import * as stylex from "@stylexjs/stylex";
import {
  cloneElement,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  border,
  color,
  duration,
  easing,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  shadow,
  size,
  space,
  z,
} from "../../styles/tokens.stylex.ts";
import type { ButtonProps } from "./Button.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Kbd } from "./Kbd.tsx";
import { useAnchor } from "./layer.ts";
import { Tooltip } from "./Tooltip.tsx";

const appear = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

const styles = stylex.create({
  wrap: { position: "relative", display: "inline-flex", maxWidth: "100%" },
  wrapOpen: { flexDirection: "column", alignItems: "flex-start", gap: space.s2 },
  wrapOpenEnd: { alignItems: "flex-end" },
  menu: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    minWidth: size.menuMin,
    maxWidth: size.menuMax,
    padding: space.s2,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceRaised,
    boxShadow: shadow.s2,
    color: color.text,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    outline: "none",
  },
  layer: {
    position: "fixed",
    zIndex: z.popover,
    animationName: appear,
    animationDuration: duration.fast,
    animationTimingFunction: easing.enter,
  },
  down: { marginTop: space.s2 },
  up: { marginBottom: space.s2 },
  item: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    flex: 1,
    width: "100%",
    minHeight: size.controlMd,
    margin: 0,
    paddingBlock: space.s1,
    paddingInline: space.s3,
    borderStyle: "none",
    borderRadius: radius.r2,
    backgroundColor: { default: "transparent", ":hover": color.surfaceHover, ":focus": color.surfaceHover },
    color: color.text,
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
    textAlign: "start",
    whiteSpace: "nowrap",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: `calc(-1 * ${border.widthStrong})`,
  },
  active: { backgroundColor: color.surfaceHover },
  danger: {
    color: color.danger,
    backgroundColor: { default: "transparent", ":hover": color.dangerSubtle, ":focus": color.dangerSubtle },
  },
  dangerActive: { backgroundColor: color.dangerSubtle },
  disabled: {
    color: color.textDisabled,
    cursor: "not-allowed",
    backgroundColor: { default: "transparent", ":hover": "transparent", ":focus": color.surfaceHover },
  },
  icon: { display: "inline-flex", color: color.textMuted },
  iconDanger: { color: color.danger },
  iconDisabled: { color: color.textDisabled },
  gap: { flex: "none", width: size.iconMd },
  text: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  label: { overflow: "hidden", textOverflow: "ellipsis" },
  description: {
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
    whiteSpace: "normal",
  },
  hint: {
    paddingInlineStart: space.s5,
    color: color.textSubtle,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontVariantNumeric: "tabular-nums",
  },
  check: { display: "inline-flex", color: color.accentText },
  sep: {
    flex: "none",
    borderStyle: "none",
    height: border.width,
    marginBlock: space.s2,
    marginInline: `calc(-1 * ${space.s2})`,
    backgroundColor: color.border,
  },
  group: { display: "flex", flexDirection: "column" },
  groupLabel: {
    paddingTop: space.s3,
    paddingInline: space.s3,
    paddingBottom: space.s2,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.caption,
    fontWeight: fontWeight.semibold,
    letterSpacing: "0.02em",
    color: color.textSubtle,
  },
  note: {
    paddingBlock: space.s2,
    paddingInline: space.s3,
    color: color.textSubtle,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    whiteSpace: "normal",
  },
});

export type MenuItem = {
  /** a verb or a choice, in sentence case; type-ahead finds it by its first letters */
  label: string;
  icon?: IconName;
  /** a second line under the label (what it will do) */
  description?: string;
  /** words on the right: a count, « saves first », « 1 modified step » */
  hint?: string;
  /** keys on the right */
  shortcut?: string;
  /** a choice: a check on the right, read as a checked item */
  checked?: boolean;
  /** red, last, behind its own separator, and it always confirms */
  danger?: boolean;
  /** true, or the reason (« Only while the test differs from Jira »), shown as a tooltip; the item stays visible */
  disabled?: boolean | string;
  onSelect: () => void;
};

export type MenuEntry = MenuItem | "separator" | { group: string } | { note: string };

export type MenuProps = {
  /** the Button that opens it: the menu gives it its popup state and its toggle */
  trigger: ReactElement<ButtonProps>;
  /** items, "separator", { group: "Sort" } (items after it until the next group), { note: "…" } */
  entries: MenuEntry[];
  /** the menu's accessible name (the trigger's label by default) */
  label?: string;
  /** start: under the trigger's start edge (default) · end: under its end edge (a ⋯ at the right of a bar) */
  align?: "start" | "end";
  /** the catalogue only: drawn open in place */
  debugState?: "open";
  /** the catalogue only: the item drawn as hovered */
  debugActive?: string;
};

type Section = { group?: string; entries: (MenuItem | "separator" | { note: string })[] };

const sections = (entries: MenuEntry[]): Section[] => {
  const out: Section[] = [{ entries: [] }];
  for (const e of entries) {
    if (typeof e === "object" && "group" in e) out.push({ group: e.group, entries: [] });
    else out[out.length - 1].entries.push(e);
  }
  return out.filter((s) => s.group !== undefined || s.entries.length);
};

const TYPE_AHEAD_MS = 500;

// ponytail: a short list of actions or choices on a trigger (SYSTEM.md Menu) — role menu, roving focus on its items
// (arrows, Home/End, type-ahead), Enter or Space acts, Escape and Tab close it and give the focus back to the trigger
export function Menu({ trigger, entries, label, align = "start", debugState, debugActive }: MenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const shown = open || debugState === "open";
  const inline = debugState === "open";
  const wrap = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const startAt = useRef<"first" | "last">("first");
  const typed = useRef({ text: "", at: 0 });
  const placed = useAnchor({
    open: open && !inline,
    anchor: wrap,
    layer: list,
    align,
    onDismiss: () => setOpen(false),
  });
  const items = () => [...(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];

  // biome-ignore lint/correctness/useExhaustiveDependencies: the focus goes in when it opens, once
  useEffect(() => {
    if (!open) return;
    const all = items();
    (startAt.current === "last" ? all.at(-1) : all[0])?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      all[(n + all.length) % all.length]?.focus();
    };
    if (e.key === "ArrowDown") return go(i + 1);
    if (e.key === "ArrowUp") return go(i < 0 ? -1 : i - 1);
    if (e.key === "Home") return go(0);
    if (e.key === "End") return go(-1);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      return close();
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at < TYPE_AHEAD_MS ? t.text + e.key.toLowerCase() : e.key.toLowerCase();
    t.at = now;
    const repeat = [...t.text].every((c) => c === t.text[0]);
    const q = repeat ? t.text[0] : t.text;
    const from = repeat ? i + 1 : Math.max(i, 0);
    for (let k = 0; k < all.length; k++) {
      const el = all[(from + k) % all.length];
      if (el.dataset.label?.toLowerCase().startsWith(q)) {
        el.focus();
        break;
      }
    }
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (open || inline || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    startAt.current = e.key === "ArrowUp" ? "last" : "first";
    setOpen(true);
  };

  const withIcons = entries.some((e) => typeof e === "object" && "label" in e && e.icon);
  const row = (item: MenuItem) => {
    const off = item.disabled !== undefined && item.disabled !== false;
    const hot = debugActive === item.label;
    const el = (
      <button
        key={item.label}
        type="button"
        {...(item.checked === undefined
          ? { role: "menuitem" }
          : { role: "menuitemcheckbox", "aria-checked": item.checked })}
        aria-disabled={off || undefined}
        tabIndex={-1}
        data-label={item.label}
        onMouseEnter={(e) => e.currentTarget.focus()}
        onClick={() => {
          if (off) return;
          close();
          item.onSelect();
        }}
        {...stylex.props(
          styles.item,
          item.danger && styles.danger,
          hot && (item.danger ? styles.dangerActive : styles.active),
          off && styles.disabled,
        )}
      >
        {item.icon ? (
          <span {...stylex.props(styles.icon, item.danger && styles.iconDanger, off && styles.iconDisabled)}>
            <Icon name={item.icon} />
          </span>
        ) : (
          withIcons && <span {...stylex.props(styles.gap)} />
        )}
        <span {...stylex.props(styles.text)}>
          <span {...stylex.props(styles.label)}>{item.label}</span>
          {item.description && <span {...stylex.props(styles.description)}>{item.description}</span>}
        </span>
        {item.hint && <span {...stylex.props(styles.hint)}>{item.hint}</span>}
        {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
        {item.checked && (
          <span {...stylex.props(styles.check)}>
            <Icon name="check" />
          </span>
        )}
      </button>
    );
    return typeof item.disabled === "string" ? (
      <Tooltip key={item.label} label={item.disabled} side="right">
        {el}
      </Tooltip>
    ) : (
      el
    );
  };
  const entry = (e: Section["entries"][number], n: number): ReactNode =>
    e === "separator" ? (
      <hr key={`sep-${n}`} {...stylex.props(styles.sep)} />
    ) : "note" in e ? (
      <div key={`note-${n}`} role="presentation" {...stylex.props(styles.note)}>
        {e.note}
      </div>
    ) : (
      row(e)
    );

  return (
    <span
      ref={wrap}
      onKeyDown={onTriggerKey}
      {...stylex.props(styles.wrap, inline && styles.wrapOpen, inline && align === "end" && styles.wrapOpenEnd)}
    >
      {cloneElement(trigger, {
        ref: button,
        popup: { kind: "menu", open: shown, controls: shown ? id : undefined },
        onClick: (e: MouseEvent<HTMLButtonElement>) => {
          trigger.props.onClick?.(e);
          if (inline) return;
          startAt.current = "first";
          setOpen((v) => !v);
        },
      })}
      {shown && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label ?? trigger.props.label}
          onKeyDown={onListKey}
          style={inline ? undefined : placed.style}
          {...stylex.props(styles.menu, !inline && styles.layer, !inline && (placed.up ? styles.up : styles.down))}
        >
          {sections(entries).map((s, n) =>
            s.group === undefined ? (
              s.entries.map((e, k) => entry(e, n * 1000 + k))
            ) : (
              // biome-ignore lint/a11y/useSemanticElements: a group of menu items is not a form's fieldset
              <div key={`group-${s.group}`} role="group" aria-label={s.group} {...stylex.props(styles.group)}>
                <div role="presentation" {...stylex.props(styles.groupLabel)}>
                  {s.group}
                </div>
                {s.entries.map((e, k) => entry(e, n * 1000 + k))}
              </div>
            ),
          )}
        </div>
      )}
    </span>
  );
}
