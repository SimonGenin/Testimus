import type { ReactNode } from "react";
import { Icon, type IconName } from "../components/legacy/index.ts";
import { ScreenHeader } from "../components/shell/ScreenHeader.tsx";

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
    <div className="screen">
      <ScreenHeader title={title} />
      <div className="placeholder">
        <Icon name={icon} size={40} />
        <h2 className="h">{title}</h2>
        <p className="muted">{lead}</p>
        {children}
      </div>
    </div>
  );
}
