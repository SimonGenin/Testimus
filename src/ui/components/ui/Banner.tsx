import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { border, color, fontSize, fontWeight, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "./Icon.tsx";

const styles = stylex.create({
  banner: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "flex-start",
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderStyle: "solid",
    borderWidth: border.width,
    borderRadius: radius.r3,
    color: color.text,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
  },
  compact: { paddingBlock: space.s2, paddingInline: space.s3, borderRadius: radius.r2 },
  icon: { display: "inline-flex", marginTop: space.s1 },
  body: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s1 },
  title: { fontWeight: fontWeight.semibold },
  actions: { display: "flex", gap: space.s3, alignItems: "center", flexWrap: "wrap", alignSelf: "center" },
  info: { backgroundColor: color.infoSubtle, borderColor: color.infoBorder },
  success: { backgroundColor: color.successSubtle, borderColor: color.successBorder },
  warning: { backgroundColor: color.warningSubtle, borderColor: color.warningBorder },
  danger: { backgroundColor: color.dangerSubtle, borderColor: color.dangerBorder },
  claude: { backgroundColor: color.claudeSubtle, borderColor: color.claudeBorder },
  neutral: { backgroundColor: color.surfaceSunken, borderColor: color.border },
  iconInfo: { color: color.info },
  iconSuccess: { color: color.success },
  iconWarning: { color: color.warning },
  iconDanger: { color: color.danger },
  iconClaude: { color: color.claudeText },
  iconNeutral: { color: color.textMuted },
});

export type BannerTone = "info" | "success" | "warning" | "danger" | "claude" | "neutral";

const ICON: Record<BannerTone, IconName> = {
  info: "info",
  success: "check-circle",
  warning: "alert-triangle",
  danger: "alert-circle",
  claude: "claude",
  neutral: "info",
};

const TONE_ICON = {
  info: styles.iconInfo,
  success: styles.iconSuccess,
  warning: styles.iconWarning,
  danger: styles.iconDanger,
  claude: styles.iconClaude,
  neutral: styles.iconNeutral,
} as const;

export type BannerProps = {
  /** what it says: info (default) · success · warning · danger · claude (Claude did or does it) · neutral */
  tone?: BannerTone;
  title?: string;
  children: ReactNode;
  /** buttons on the right (Reload from disk, Keep mine, Reindex…) */
  actions?: ReactNode;
  icon?: IconName;
  /** inside a field or a card: tighter */
  compact?: boolean;
};

// ponytail: a notice that belongs to a place and stays while it is true; a danger or warning one is announced
export function Banner({ tone = "info", title, children, actions, icon, compact = false }: BannerProps) {
  const urgent = tone === "danger" || tone === "warning";
  return (
    <div role={urgent ? "alert" : "status"} {...stylex.props(styles.banner, styles[tone], compact && styles.compact)}>
      <span {...stylex.props(styles.icon, TONE_ICON[tone])}>
        <Icon name={icon ?? ICON[tone]} />
      </span>
      <div {...stylex.props(styles.body)}>
        {title && <span {...stylex.props(styles.title)}>{title}</span>}
        <span>{children}</span>
      </div>
      {actions && <div {...stylex.props(styles.actions)}>{actions}</div>}
    </div>
  );
}
