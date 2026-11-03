import { Badge } from "./Badge.tsx";

export function ClaudeBadge({ added, small }: { added?: boolean; small?: boolean }) {
  return (
    <Badge tone="neutral" icon="claude" small={small}>
      {added ? "Added by Claude" : "Changed by Claude"}
    </Badge>
  );
}
