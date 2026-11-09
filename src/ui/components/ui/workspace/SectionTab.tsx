import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, type PointerEvent, useState } from "react";
import { border, color, focus, radius, size, space } from "../../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "../Icon.tsx";
import { type } from "../type.ts";

const styles = stylex.create({
  tab: {
    boxSizing: "border-box",
    position: "relative",
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: space.snug,
    height: `calc(${size.controlLg} - ${space.s2})`,
    maxWidth: size.menuMax,
    marginBottom: `calc(-1 * ${border.width})`,
    paddingInline: space.s3,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: "transparent",
    borderTopLeftRadius: radius.r2,
    borderTopRightRadius: radius.r2,
    backgroundColor: { default: "transparent", ":hover": color.surfaceHover },
    color: { default: color.textMuted, ":hover": color.text },
    cursor: "pointer",
    touchAction: "none",
    userSelect: "none",
    whiteSpace: "nowrap",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: `calc(-1 * ${focus.offset})`,
  },
  on: {
    borderColor: color.border,
    borderBottomColor: color.surface,
    backgroundColor: { default: color.surface, ":hover": color.surface },
    color: color.text,
  },
  claude: { color: { default: color.claudeText, ":hover": color.claudeText } },
  lifted: { opacity: 0.45 },
  grip: { display: "inline-flex", color: color.textSubtle, marginInlineStart: `calc(-1 * ${space.s2})` },
  gripHidden: { visibility: "hidden" },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  count: {
    flex: "none",
    minWidth: size.iconMd,
    paddingInline: space.snug,
    borderRadius: radius.full,
    backgroundColor: color.surfaceSunken,
    color: color.textMuted,
    textAlign: "center",
  },
});

export type SectionTabProps = {
  id: string;
  panelId: string;
  label: string;
  icon: IconName;
  count?: number;
  claude?: boolean;
  active: boolean;
  /** this tab is being dragged elsewhere */
  lifted?: boolean;
  onSelect: () => void;
  onPress: (e: PointerEvent) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
};

// ponytail: one tab of a section — its icon (a collapsed section is read from its icons), its name, its count; a grip
// shows on the active tab and under the pointer: the tab is dragged to another section, or with Alt Shift and an arrow
export function SectionTab({
  id,
  panelId,
  label,
  icon,
  count,
  claude = false,
  active,
  lifted = false,
  onSelect,
  onPress,
  onKeyDown,
}: SectionTabProps) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      data-ws-tab=""
      onClick={onSelect}
      onPointerDown={(e) => {
        // ponytail: a press may become a drag — the browser must not start a text selection or move the focus on it
        e.preventDefault();
        onPress(e);
      }}
      onPointerEnter={() => setOver(true)}
      onPointerLeave={() => setOver(false)}
      onKeyDown={onKeyDown}
      {...stylex.props(
        type.compact,
        type.medium,
        styles.tab,
        active && styles.on,
        claude && styles.claude,
        lifted && styles.lifted,
      )}
    >
      <span aria-hidden="true" {...stylex.props(styles.grip, !(over || active) && styles.gripHidden)}>
        <Icon name="grip" size="sm" />
      </span>
      <Icon name={icon} />
      <span {...stylex.props(styles.label)}>{label}</span>
      {count !== undefined && count > 0 && <span {...stylex.props(type.micro, styles.count)}>{count}</span>}
    </button>
  );
}
