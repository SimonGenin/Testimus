import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { ScreenHeader } from "../components/shell/ScreenHeader.tsx";
import { EmptyState } from "../components/ui/EmptyState.tsx";
import type { IconName } from "../components/ui/Icon.tsx";

const styles = stylex.create({
  screen: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
  center: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" },
});

export function Placeholder({
  title,
  icon,
  lead,
  children,
}: {
  title: string;
  icon: IconName;
  lead: string;
  children?: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.screen)}>
      <ScreenHeader title={title} />
      <div {...stylex.props(styles.center)}>
        <EmptyState icon={icon} title={title} text={lead} actions={children} />
      </div>
    </div>
  );
}
