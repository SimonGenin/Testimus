import * as stylex from "@stylexjs/stylex";
import type { Column } from "../../../lib/workspace/layout.ts";
import type { WorkspaceController } from "../../../lib/workspace/useWorkspace.ts";
import { border, color, radius, size, space } from "../../../styles/tokens.stylex.ts";
import { Button } from "../Button.tsx";
import { type } from "../type.ts";

const styles = stylex.create({
  strip: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s2,
    width: size.controlLg,
    paddingBlock: space.snug,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceSunken,
    overflowY: "auto",
    scrollbarWidth: "none",
  },
  rule: { flex: "none", width: space.s5, height: border.width, backgroundColor: color.border },
  slot: { position: "relative", display: "inline-flex" },
  count: {
    position: "absolute",
    top: `calc(-1 * ${space.s1})`,
    right: `calc(-1 * ${space.s2})`,
    minWidth: size.iconSm,
    paddingInline: space.s1,
    borderRadius: radius.full,
    backgroundColor: color.accentSubtle,
    color: color.accentText,
    textAlign: "center",
    pointerEvents: "none",
  },
  dot: {
    position: "absolute",
    top: space.s1,
    right: space.s1,
    width: size.dot,
    height: size.dot,
    borderRadius: radius.full,
    pointerEvents: "none",
  },
  neutral: { backgroundColor: color.neutral },
  info: { backgroundColor: color.info },
  success: { backgroundColor: color.success },
  warning: { backgroundColor: color.warning },
  danger: { backgroundColor: color.danger },
  claude: { backgroundColor: color.claude },
  accent: { backgroundColor: color.accent },
});

// ponytail: a collapsed column — one button per tab, its icon with its count or its state dot (the name in the
// tooltip), the tab that was shown kept pressed; a click opens its section on that tab. Also a place to drop a tab
export function SectionStrip({
  ws,
  column,
  index,
  auto,
}: {
  ws: WorkspaceController;
  column: Column;
  index: number;
  /** folded because the window is too narrow, not by the user: opening it gives it the focus, another column folds */
  auto: boolean;
}) {
  const first = column.sections[0];
  const open = (sectionId: string, tab?: string) => {
    ws.focus(sectionId);
    if (tab) ws.select(sectionId, tab);
    else ws.collapse(sectionId, false);
  };
  return (
    <nav
      aria-label={`Section ${index + 1}, collapsed`}
      data-ws-section={first.id}
      data-ws-strip=""
      {...stylex.props(styles.strip)}
    >
      <Button
        variant="quiet"
        size="sm"
        icon={index === 0 ? "panel-left" : "panel-right"}
        iconOnly
        label={auto ? "Show this section (the window is narrow)" : "Expand this section"}
        onClick={() => open(first.id)}
      />
      {column.sections.flatMap((s) => [
        <span key={`rule-${s.id}`} aria-hidden="true" {...stylex.props(styles.rule)} />,
        ...s.tabs.map((id) => {
          const t = ws.tab(id);
          if (!t) return null;
          const name = t.count ? `${t.label}, ${t.count}` : t.label;
          return (
            <span key={id} {...stylex.props(styles.slot)}>
              <Button
                variant="quiet"
                size="md"
                icon={t.icon}
                iconOnly
                label={name}
                pressed={s.active === id}
                onClick={() => open(s.id, id)}
              />
              {t.count !== undefined && t.count > 0 ? (
                <span aria-hidden="true" {...stylex.props(type.micro, styles.count)}>
                  {t.count}
                </span>
              ) : (
                t.dot && <span aria-hidden="true" {...stylex.props(styles.dot, styles[t.dot])} />
              )}
            </span>
          );
        }),
      ])}
    </nav>
  );
}
