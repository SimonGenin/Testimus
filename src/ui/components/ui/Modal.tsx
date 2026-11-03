import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
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
import { Banner } from "./Banner.tsx";
import { Button } from "./Button.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { focusables } from "./layer.ts";

const fade = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const rise = stylex.keyframes({
  from: { opacity: 0, transform: `translateY(${space.s3})` },
  to: { opacity: 1, transform: "none" },
});
const fromLeft = stylex.keyframes({ from: { transform: "translateX(-100%)" }, to: { transform: "none" } });
const fromRight = stylex.keyframes({ from: { transform: "translateX(100%)" }, to: { transform: "none" } });

const styles = stylex.create({
  scrim: {
    boxSizing: "border-box",
    position: "fixed",
    inset: 0,
    zIndex: z.modal,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: "10vh",
    paddingInline: space.s5,
    paddingBottom: space.s5,
    backgroundColor: color.scrim,
    animationName: fade,
    animationDuration: duration.slow,
    animationTimingFunction: easing.enter,
  },
  scrimDrawer: {
    zIndex: z.drawer,
    alignItems: "stretch",
    paddingTop: 0,
    paddingInline: 0,
    paddingBottom: 0,
    animationDuration: duration.base,
  },
  scrimLeft: { justifyContent: "flex-start" },
  scrimRight: { justifyContent: "flex-end" },
  scrimInline: { position: "relative", inset: "auto", zIndex: "auto", width: "100%", paddingTop: space.s8 },
  scrimInlineDrawer: { paddingTop: 0, height: size.modalSm },
  panel: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    width: size.modalMd,
    maxWidth: "100%",
    maxHeight: "80vh",
    borderRadius: radius.r4,
    backgroundColor: color.surfaceRaised,
    boxShadow: shadow.s3,
    color: color.text,
    fontSize: fontSize.body,
    lineHeight: lineHeight.body,
    overflow: "hidden",
    outline: "none",
    animationName: rise,
    animationDuration: duration.slow,
    animationTimingFunction: easing.enter,
  },
  sm: { width: size.modalSm },
  md: {},
  lg: { width: size.modalLg, maxHeight: "84vh" },
  drawer: {
    width: size.sidebar,
    maxWidth: `calc(100% - ${space.s9})`,
    maxHeight: "none",
    height: "100%",
    borderRadius: 0,
    animationDuration: duration.base,
    animationTimingFunction: easing.standard,
  },
  drawerLeft: { animationName: fromLeft },
  drawerRight: { animationName: fromRight },
  panelInline: { maxHeight: size.modalSm },
  head: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.s4,
    paddingTop: space.s6,
    paddingInline: space.s7,
    paddingBottom: space.s4,
  },
  headDrawer: {
    alignItems: "center",
    gap: space.s3,
    paddingTop: space.s4,
    paddingInlineStart: space.s5,
    paddingInlineEnd: space.s4,
    paddingBottom: space.s3,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  headIcon: { display: "inline-flex", marginTop: `calc(${space.s1} + ${border.width})`, color: color.textMuted },
  headIconWarning: { color: color.warning },
  headIconDanger: { color: color.danger },
  titles: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s1 },
  title: {
    margin: 0,
    fontSize: fontSize.title,
    lineHeight: lineHeight.title,
    fontWeight: fontWeight.semibold,
  },
  titleDrawer: { fontSize: fontSize.titleSm, lineHeight: lineHeight.titleSm },
  sub: { color: color.textMuted, fontSize: fontSize.compact, lineHeight: lineHeight.compact },
  close: { marginTop: `calc(-1 * ${space.s1})`, marginInlineEnd: `calc(-1 * ${space.s3})` },
  closeDrawer: { marginTop: 0, marginInlineEnd: 0 },
  form: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
  body: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingTop: 0,
    paddingInline: space.s7,
    paddingBottom: space.s6,
  },
  bodyDrawer: { paddingTop: space.s4, paddingInline: space.s5, paddingBottom: space.s5, gap: space.s4 },
  bodyConfirm: {
    paddingInlineStart: `calc(${space.s7} + ${size.iconMd} + ${space.s4})`,
    paddingBottom: space.s5,
  },
  flush: { gap: 0, paddingTop: 0, paddingInline: 0, paddingBottom: 0 },
  foot: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s4,
    paddingInline: space.s7,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
    backgroundColor: color.surfaceRaised,
  },
  footConfirm: { borderTopWidth: 0, paddingTop: 0, paddingBottom: space.s6 },
  footNote: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    color: color.textMuted,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
  },
  buttons: { display: "flex", alignItems: "center", gap: space.s3, marginInlineStart: "auto" },
  consequences: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    listStyle: "none",
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
  },
  consequence: { display: "flex", alignItems: "baseline", gap: space.s3 },
  count: { minWidth: "2ch", textAlign: "end", fontVariantNumeric: "tabular-nums", fontWeight: fontWeight.semibold },
});

export type ModalProps = {
  /** the dialog's name, shown in its head; a question for a confirmation (« Delete the local copy? ») */
  title: string;
  subtitle?: ReactNode;
  icon?: IconName;
  /** sm 440 px (confirmations) · md 640 px (forms, plans; default) · lg 960 px (managers, the lightbox) */
  size?: "sm" | "md" | "lg";
  /** a confirmation: question title, consequences, Cancel and the verb; danger (red verb, focus on Cancel) only when
   * something is lost — the one place a danger button lives */
  confirm?: { verb: string; danger?: boolean; onConfirm: () => void | Promise<void> };
  /** what will happen, with numbers: [[2, "modified steps are lost"], [1, "added step is lost"]] */
  consequences?: [number | string, string][];
  /** words on the left of the foot (« Saved in ~/.atlassian », « Same as testimus xray push 12 ») */
  footNote?: ReactNode;
  /** buttons on the right of the foot, the primary last */
  actions?: ReactNode;
  /** the work runs: close, Escape and the scrim do nothing, the verb spins, the foot says not to close */
  busy?: boolean;
  /** shown as a danger banner at the top of the body; the dialog stays open */
  error?: string | null;
  /** the body and the foot are a form: Enter in a field submits (give a Button type="submit") */
  onSubmit?: () => void;
  /** no padding around the body: a lightbox's well, a list edge to edge */
  flush?: boolean;
  /** no head: the title only names the dialog (the palette, whose search field is its head); implies flush */
  frameless?: boolean;
  /** a side panel over the scrim instead of a centred dialog: the tests list or the documents' panes when narrow */
  drawer?: "left" | "right";
  /** Cancel, the close button, Escape and a press on the scrim */
  onClose: () => void;
  children?: ReactNode;
  /** the catalogue only: drawn in place, without taking the focus */
  debugState?: "open";
};

const BUSY_NOTE = "Do not close Testimus until this is done";

// ponytail: a task to finish or abandon before going back (SYSTEM.md Modal) — aria-modal, Tab kept inside, Escape and the
// close button cancel except while busy, the focus goes back to what opened it; a confirmation is an option of it
export function Modal({
  title,
  subtitle,
  icon,
  size: s = "md",
  confirm,
  consequences,
  footNote,
  actions,
  busy = false,
  error,
  onSubmit,
  flush = false,
  frameless = false,
  drawer,
  onClose,
  children,
  debugState,
}: ModalProps) {
  const id = useId();
  const inline = debugState === "open";
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const verb = useRef<HTMLButtonElement>(null);
  const [opener] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement)));
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const working = busy || pending;

  // biome-ignore lint/correctness/useExhaustiveDependencies: once — the focus goes in when it opens and back when it closes
  useEffect(() => {
    if (inline) return;
    const p = panel.current;
    if (p && !p.contains(document.activeElement)) {
      const first = confirm ? (confirm.danger ? cancel.current : verb.current) : null;
      (first ?? p).focus();
    }
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const shut = () => {
    if (!working) onClose();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (inline) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      shut();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const all = focusables(panel.current);
    const now = document.activeElement;
    if (!all.length) {
      e.preventDefault();
      return;
    }
    if (e.shiftKey && (now === all[0] || now === panel.current)) {
      e.preventDefault();
      all[all.length - 1].focus();
    } else if (!e.shiftKey && now === all[all.length - 1]) {
      e.preventDefault();
      all[0].focus();
    }
  };

  const run = async () => {
    if (!confirm) return;
    setFailed(null);
    const r = confirm.onConfirm();
    if (!(r instanceof Promise)) return;
    setPending(true);
    try {
      await r;
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
    setPending(false);
  };

  const shownError = error ?? failed;
  const headIcon = icon ?? (confirm ? (confirm.danger ? "alert-circle" : "alert-triangle") : undefined);
  const note = footNote ?? (working ? BUSY_NOTE : undefined);
  const hasFoot = note !== undefined || actions !== undefined || confirm !== undefined;

  const head = !frameless && (
    <div {...stylex.props(styles.head, drawer && styles.headDrawer)}>
      {headIcon && (
        <span
          {...stylex.props(
            styles.headIcon,
            confirm && styles.headIconWarning,
            confirm?.danger && styles.headIconDanger,
          )}
        >
          <Icon name={headIcon} />
        </span>
      )}
      <div {...stylex.props(styles.titles)}>
        <h2 id={`${id}-title`} {...stylex.props(styles.title, drawer && styles.titleDrawer)}>
          {title}
        </h2>
        {subtitle && (
          <div id={`${id}-sub`} {...stylex.props(styles.sub)}>
            {subtitle}
          </div>
        )}
      </div>
      <span {...stylex.props(styles.close, drawer && styles.closeDrawer)}>
        <Button variant="quiet" size="sm" iconOnly icon="close" label="Close" disabled={working} onClick={shut} />
      </span>
    </div>
  );

  const body = (
    <div
      {...stylex.props(
        styles.body,
        drawer && styles.bodyDrawer,
        confirm && !drawer && styles.bodyConfirm,
        (flush || frameless) && styles.flush,
      )}
    >
      {shownError && (
        <Banner tone="danger" compact>
          {shownError}
        </Banner>
      )}
      {children}
      {consequences && consequences.length > 0 && (
        <ul {...stylex.props(styles.consequences)}>
          {consequences.map(([n, what]) => (
            <li key={`${n} ${what}`} {...stylex.props(styles.consequence)}>
              <span {...stylex.props(styles.count)}>{n}</span>
              <span>{what}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const foot = hasFoot && (
    <div {...stylex.props(styles.foot, confirm && styles.footConfirm)}>
      {note !== undefined && <div {...stylex.props(styles.footNote)}>{note}</div>}
      <div {...stylex.props(styles.buttons)}>
        {confirm ? (
          <>
            <Button ref={cancel} label="Cancel" disabled={working} onClick={shut} />
            <Button
              ref={verb}
              variant={confirm.danger ? "danger" : "primary"}
              label={confirm.verb}
              loading={working}
              onClick={run}
            />
          </>
        ) : (
          actions
        )}
      </div>
    </div>
  );

  return (
    <div
      onMouseDown={(e) => {
        if (!inline && e.target === e.currentTarget) shut();
      }}
      {...stylex.props(
        styles.scrim,
        drawer && styles.scrimDrawer,
        drawer === "left" && styles.scrimLeft,
        drawer === "right" && styles.scrimRight,
        inline && styles.scrimInline,
        inline && drawer && styles.scrimInlineDrawer,
      )}
    >
      <div
        ref={panel}
        {...{
          role: confirm ? "alertdialog" : "dialog",
          "aria-modal": true,
          "aria-labelledby": frameless ? undefined : `${id}-title`,
          "aria-label": frameless ? title : undefined,
          "aria-describedby": subtitle && !frameless ? `${id}-sub` : undefined,
        }}
        aria-busy={working || undefined}
        tabIndex={-1}
        onKeyDown={onKey}
        {...stylex.props(
          styles.panel,
          styles[s],
          drawer && styles.drawer,
          drawer === "left" && styles.drawerLeft,
          drawer === "right" && styles.drawerRight,
          inline && !drawer && styles.panelInline,
        )}
      >
        {head}
        {onSubmit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
            {...stylex.props(styles.form)}
          >
            {body}
            {foot}
          </form>
        ) : (
          <>
            {body}
            {foot}
          </>
        )}
      </div>
    </div>
  );
}
