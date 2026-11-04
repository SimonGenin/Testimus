import * as stylex from "@stylexjs/stylex";
import { useSyncExternalStore } from "react";
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
import { Button } from "./Button.tsx";
import { Icon, type IconName } from "./Icon.tsx";

const enter = stylex.keyframes({
  from: { opacity: 0, transform: `translateY(${space.s3})` },
  to: { opacity: 1, transform: "none" },
});

const styles = stylex.create({
  stack: {
    boxSizing: "border-box",
    position: "fixed",
    insetInlineEnd: space.s5,
    bottom: space.s5,
    zIndex: z.toast,
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    width: size.toast,
    maxWidth: `calc(100vw - ${space.s7})`,
    pointerEvents: "none",
  },
  toast: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "flex-start",
    gap: space.s3,
    width: size.toast,
    maxWidth: "100%",
    paddingBlock: space.s4,
    paddingInline: space.s5,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceRaised,
    boxShadow: shadow.s2,
    color: color.text,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    pointerEvents: "auto",
    animationName: enter,
    animationDuration: duration.base,
    animationTimingFunction: easing.enter,
  },
  danger: { boxShadow: `${shadow.s2}, inset 0 0 0 ${border.width} ${color.dangerBorder}` },
  icon: { display: "inline-flex", marginTop: border.width, color: color.textMuted },
  iconSuccess: { color: color.success },
  iconWarning: { color: color.warning },
  iconDanger: { color: color.danger },
  iconClaude: { color: color.claude },
  body: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s1 },
  title: { fontWeight: fontWeight.medium, overflowWrap: "anywhere" },
  text: { color: color.textMuted, fontSize: fontSize.small, lineHeight: lineHeight.small, overflowWrap: "anywhere" },
  actions: { display: "flex", alignItems: "center", gap: space.s2, marginTop: `calc(-1 * ${space.s1})` },
});

export type ToastTone = "neutral" | "success" | "warning" | "danger" | "claude";

export type ToastProps = {
  /** neutral (default) · success · warning · danger (stays until dismissed) · claude (a run finished in the background) */
  tone?: ToastTone;
  /** what happened, in a few words (« LFRPS12-1398 pulled ») */
  title: string;
  /** a second line: the detail, or what to do */
  text?: string;
  /** one action (Undo, Open, Retry); it closes the toast. With a time limit its label counts down (« Undo · 5 s ») */
  action?: { label: string; onAction: () => void };
  /** seconds before it leaves by itself; 6 by default, danger stays */
  seconds?: number;
  /** when it leaves without its action: time out, dismissed, or pushed out by a fourth one (an Undo commits here) */
  onExpire?: () => void;
};

type Item = ToastProps & { id: number; left: number };

const MAX = 3;
const SECONDS = 6;

const ICON: Record<ToastTone, IconName> = {
  neutral: "info",
  success: "check-circle",
  warning: "alert-triangle",
  danger: "alert-circle",
  claude: "claude",
};

const TONE_ICON = {
  neutral: null,
  success: styles.iconSuccess,
  warning: styles.iconWarning,
  danger: styles.iconDanger,
  claude: styles.iconClaude,
} as const;

let items: Item[] = [];
let seq = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

const emit = () => {
  if (!items.some((t) => Number.isFinite(t.left)) && timer) {
    clearInterval(timer);
    timer = undefined;
  }
  for (const l of listeners) l();
};

const tick = () => {
  items = items.map((t) => (Number.isFinite(t.left) ? { ...t, left: t.left - 1 } : t));
  const gone = items.filter((t) => t.left <= 0);
  items = items.filter((t) => t.left > 0);
  for (const t of gone) t.onExpire?.();
  emit();
};

// ponytail: the one way to tell a passing result (SYSTEM.md Toast) — never for a save (Text shows it), never the only
// trace of an error that blocks work (that is a Banner); at most three, the newest at the bottom
export function toast(options: ToastProps): number {
  const id = ++seq;
  const left = options.seconds ?? (options.tone === "danger" ? Number.POSITIVE_INFINITY : SECONDS);
  const all = [...items, { ...options, id, left }];
  const out = all.slice(0, -MAX);
  items = all.slice(-MAX);
  for (const t of out) t.onExpire?.();
  if (!timer && items.some((t) => Number.isFinite(t.left))) timer = setInterval(tick, 1000);
  emit();
  return id;
}

/** removes a toast, as its close button does (its onExpire runs: an Undo that is not taken commits) */
export function dismissToast(id: number): void {
  const t = items.find((x) => x.id === id);
  items = items.filter((x) => x.id !== id);
  t?.onExpire?.();
  emit();
}

const act = (t: Item) => {
  items = items.filter((x) => x.id !== t.id);
  emit();
  t.action?.onAction();
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

// ponytail: one toast as drawn; the catalogue shows it alone, Toaster stacks the live ones
export function Toast({
  tone = "neutral",
  title,
  text,
  action,
  left,
  onAction,
  onDismiss,
}: Omit<ToastProps, "seconds" | "onExpire"> & { left?: number; onAction?: () => void; onDismiss?: () => void }) {
  const counting = left !== undefined && Number.isFinite(left);
  return (
    <div
      {...{ role: tone === "danger" ? "alert" : "status", "aria-label": title }}
      {...stylex.props(styles.toast, tone === "danger" && styles.danger)}
    >
      <span {...stylex.props(styles.icon, TONE_ICON[tone])}>
        <Icon name={ICON[tone]} />
      </span>
      <div {...stylex.props(styles.body)}>
        <span {...stylex.props(styles.title)}>{title}</span>
        {text && <span {...stylex.props(styles.text)}>{text}</span>}
      </div>
      <div {...stylex.props(styles.actions)}>
        {action && (
          <Button
            variant="quiet"
            size="sm"
            label={action.label}
            countdown={counting ? left : undefined}
            onClick={onAction ?? action.onAction}
          />
        )}
        <Button variant="quiet" size="xs" iconOnly icon="close" label="Dismiss" onClick={onDismiss} />
      </div>
    </div>
  );
}

/** the live toasts (for an adapter or a test); the stack reads the same store */
export function useToasts(): readonly Item[] {
  return useSyncExternalStore(
    subscribe,
    () => items,
    () => items,
  );
}

// ponytail: the stack, bottom right, once in the app shell
export function Toaster() {
  const list = useToasts();
  return (
    <section aria-label="Notifications" {...stylex.props(styles.stack)}>
      {list.map((t) => (
        <Toast
          key={t.id}
          tone={t.tone}
          title={t.title}
          text={t.text}
          action={t.action}
          left={t.action ? t.left : undefined}
          onAction={() => act(t)}
          onDismiss={() => dismissToast(t.id)}
        />
      ))}
    </section>
  );
}
