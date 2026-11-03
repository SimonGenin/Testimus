import type { Source } from "../../../core/types.ts";
import { type ItemLink, sourceLabel } from "../../lib/fields.ts";
import { Chip } from "./Chip.tsx";
import { SourceChip } from "./SourceChip.tsx";

const refOf = (s: Source) => `${s.docId}#${s.anchor}`;
const titleOf = (s: Source) => `${refOf(s)}${s.quote ? ` "${s.quote}"` : ""}`;

export function ItemLinks({
  column,
  links,
  selected,
  onOpen,
}: {
  column: string;
  links: ItemLink[];
  selected?: string;
  onOpen?: (s: Source) => void;
}) {
  return (
    <div className="item-links" data-column={column}>
      {links.map((l, i) => {
        if (!l.item)
          return l.sources.map((s, k) => (
            <SourceChip key={`${i}-${k}`} source={s} on={selected === refOf(s)} onOpen={onOpen} />
          ));
        if (l.sources.length === 1) {
          const s = l.sources[0];
          return (
            <Chip
              key={i}
              icon={s.anchor.startsWith("fig:") ? "image" : "link"}
              className="item-link"
              on={selected === refOf(s)}
              title={titleOf(s)}
              onClick={onOpen && (() => onOpen(s))}
            >
              <span className="mono item-name">{l.item}</span>
              <span className="item-at">{sourceLabel(s)}</span>
            </Chip>
          );
        }
        return (
          <span key={i} className="item-group">
            <span className="mono item-name">{l.item}</span>
            {l.sources.map((s, k) => (
              <SourceChip key={k} source={s} inline on={selected === refOf(s)} onOpen={onOpen} />
            ))}
          </span>
        );
      })}
    </div>
  );
}
