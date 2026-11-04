import * as stylex from "@stylexjs/stylex";
import {
  cloneElement,
  type FocusEvent,
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
import { Badge } from "./Badge.tsx";
import { Button, type ButtonProps } from "./Button.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { focusables, useAnchor } from "./layer.ts";

const appear = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

const styles = stylex.create({
  wrap: { position: "relative", display: "inline-flex", maxWidth: "100%" },
  wrapOpen: { flexDirection: "column", alignItems: "flex-start", gap: space.s2 },
  wrapOpenEnd: { alignItems: "flex-end" },
  pop: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    maxWidth: `calc(100vw - ${space.s7})`,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceRaised,
    boxShadow: shadow.s2,
    color: color.text,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    overflow: "hidden",
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
  auto: {},
  sm: { width: `calc(${size.sidebar} + ${space.s10} * 2)` },
  md: { width: size.modalSm },
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingTop: space.s4,
    paddingInlineEnd: space.s4,
    paddingBottom: space.s3,
    paddingInlineStart: space.s5,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  icon: { display: "inline-flex", color: color.textMuted },
  iconClaude: { color: color.claudeText },
  title: {
    flex: 1,
    minWidth: 0,
    margin: 0,
    fontSize: fontSize.titleSm,
    lineHeight: lineHeight.titleSm,
    fontWeight: fontWeight.semibold,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    minHeight: 0,
    overflowY: "auto",
    paddingBlock: space.s4,
    paddingInline: space.s5,
  },
  flush: { gap: 0, paddingBlock: 0, paddingInline: 0 },
  foot: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInlineEnd: space.s4,
    paddingInlineStart: space.s5,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
  },
});

export type PopoverProps = {
  /** the Button that opens it: the popover gives it its popup state and its toggle */
  trigger: ReactElement<ButtonProps>;
  /** in the head, beside the icon and the close button; it names the dialog (« Ask Claude · Step 2 ») */
  title: string;
  icon?: IconName;
  /** a count pill after the title (« Running 3 ») */
  count?: number;
  /** the content: a ClaudeBlock, a List, a Segmented choice, a small form */
  children: ReactNode;
  /** words under the content (« Runs in the dock with this test's contexts ») */
  foot?: ReactNode;
  /** controlled: whether it is open (with onOpenChange); left out, the popover keeps its own state */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** start: under the trigger's start edge · end: under its end edge (default, a button at the right of a bar) */
  align?: "start" | "end";
  /** auto: its content's · sm 396 px (activity, columns) · md 440 px (Ask Claude, a rich picker) */
  width?: "auto" | "sm" | "md";
  /** the content edge to edge (a ClaudeBlock, a List), not padded */
  flush?: boolean;
  /** false: no head (title and close button) — the title still names the dialog; for a picker inside a pane (the
   * dock's « Add context »), where Escape and a press outside close it */
  head?: boolean;
  /** the catalogue only: drawn open in place */
  debugState?: "open";
};

// ponytail: an anchored layer that is not a menu (SYSTEM.md Popover, audit design §2.1) — a non-modal dialog with free
// content: the focus goes into it, Tab moves through its fields, Escape or the close button shut it and give the focus
// back to the trigger, a press outside or the focus leaving shut it too; at the window's edge it slides back in. It
// shares the anchoring of layer.ts with Menu but not Menu's keyboard (roving focus over items), which would break the
// fields inside
export function Popover({
  trigger,
  title,
  icon,
  count,
  children,
  foot,
  open: controlled,
  onOpenChange,
  align = "end",
  width = "auto",
  flush = false,
  head = true,
  debugState,
}: PopoverProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const [own, setOwn] = useState(false);
  const inline = debugState === "open";
  const open = (controlled ?? own) && !inline;
  const shown = open || inline;
  const wrap = useRef<HTMLSpanElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const set = (v: boolean) => {
    if (controlled === undefined) setOwn(v);
    onOpenChange?.(v);
  };
  const placed = useAnchor({ open, anchor: wrap, layer, align, slide: true, onDismiss: () => set(false) });

  useEffect(() => {
    if (!open || !layer.current) return;
    const body = layer.current.querySelector<HTMLElement>("[data-popover-body]");
    const first = body && focusables(body)[0];
    (first ?? layer.current).focus();
  }, [open]);

  const close = () => {
    set(false);
    button.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (open && next && !layer.current?.contains(next) && !wrap.current?.contains(next)) set(false);
  };

  return (
    <span
      ref={wrap}
      {...stylex.props(styles.wrap, inline && styles.wrapOpen, inline && align === "end" && styles.wrapOpenEnd)}
    >
      {cloneElement(trigger, {
        ref: button,
        popup: { kind: "dialog", open: shown, controls: shown ? id : undefined },
        onClick: (e: MouseEvent<HTMLButtonElement>) => {
          trigger.props.onClick?.(e);
          if (!inline) set(!open);
        },
      })}
      {shown && (
        <div
          ref={layer}
          id={id}
          role="dialog"
          aria-labelledby={head ? titleId : undefined}
          aria-label={head ? undefined : title}
          tabIndex={-1}
          onKeyDown={onKey}
          onBlur={onBlur}
          style={inline ? undefined : placed.style}
          {...stylex.props(
            styles.pop,
            styles[width],
            !inline && styles.layer,
            !inline && (placed.up ? styles.up : styles.down),
          )}
        >
          {head && (
            <div {...stylex.props(styles.head)}>
              {icon && (
                <span {...stylex.props(styles.icon, icon === "claude" && styles.iconClaude)}>
                  <Icon name={icon} />
                </span>
              )}
              <h2 id={titleId} {...stylex.props(styles.title)}>
                {title}
                {count !== undefined && (
                  <>
                    {" "}
                    <Badge label={String(count)} count size="sm" />
                  </>
                )}
              </h2>
              <Button variant="quiet" size="xs" iconOnly icon="close" label="Close" onClick={close} />
            </div>
          )}
          <div data-popover-body {...stylex.props(styles.body, flush && styles.flush)}>
            {children}
          </div>
          {foot && <div {...stylex.props(styles.foot)}>{foot}</div>}
        </div>
      )}
    </span>
  );
}
