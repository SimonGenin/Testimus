import { Chip } from "./Chip.tsx";

export function RequirementChip({
  id,
  kind = "requirement",
  error,
  onRemove,
  onClick,
}: {
  id: string;
  kind?: string;
  error?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
}) {
  return (
    <Chip
      className="req"
      error={error}
      icon={error ? "error" : undefined}
      onClick={onClick}
      onRemove={onRemove}
      removeLabel={`Remove ${kind} ${id}`}
    >
      <span className="chip-id">{id}</span>
    </Chip>
  );
}
