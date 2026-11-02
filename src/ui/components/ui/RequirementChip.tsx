import { Chip } from "./Chip.tsx";

export function RequirementChip({
  id,
  error,
  onRemove,
  onClick,
}: {
  id: string;
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
      removeLabel={`Remove requirement ${id}`}
    >
      <span className="chip-id">{id}</span>
    </Chip>
  );
}
