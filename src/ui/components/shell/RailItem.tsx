import type { ReactNode } from "react";
import { Icon, type IconName } from "../ui/index.ts";

export function RailItem({
  label,
  icon,
  current,
  count,
  onClick,
}: {
  label: ReactNode;
  icon: IconName;
  current?: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className="rail-item" aria-current={current ? "page" : undefined} onClick={onClick}>
      <Icon name={icon} size={20} />
      <span>{label}</span>
      {!!count && <span className="count">{count}</span>}
    </button>
  );
}
