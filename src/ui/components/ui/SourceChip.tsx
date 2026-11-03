import type { Source } from "../../../core/types.ts";
import { sourcePlace } from "../../lib/fields.ts";
import { Chip } from "./Chip.tsx";

export function SourceChip({
  source,
  quote = true,
  inline,
  on,
  onOpen,
}: {
  source: Source;
  quote?: boolean;
  inline?: boolean;
  on?: boolean;
  onOpen?: (s: Source) => void;
}) {
  const figure = source.anchor.startsWith("fig:");
  return (
    <Chip
      icon={inline ? undefined : figure ? "image" : "link"}
      small={inline}
      on={on}
      className={inline ? "chip-inline" : undefined}
      title={`${source.docId}#${source.anchor}${source.quote ? ` "${source.quote}"` : ""}`}
      onClick={onOpen && (() => onOpen(source))}
    >
      <span className="mono src-doc">{source.docId}</span>{" "}
      <span className="mono src-at">{sourcePlace(source.anchor)}</span>
      {quote && !inline && source.quote && <span className="q">« {source.quote} »</span>}
    </Chip>
  );
}
