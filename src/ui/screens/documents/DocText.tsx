import type { ReactNode } from "react";
import { fileUrl } from "../../api.ts";
import { Chip, RequirementChip } from "../../components/ui/index.ts";

const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").trim();
const squeeze = (s: string) => s.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] ? <strong key={k++}>{m[1]}</strong> : <em key={k++}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function DocText({
  docId,
  md,
  focus,
  requirements,
  onRequirement,
  onFigure,
}: {
  docId: string;
  md: string;
  focus?: string;
  requirements?: RegExp | null;
  onRequirement?: (id: string) => void;
  onFigure: (anchor: string) => void;
}) {
  const blocks = md.split(/\n{2,}/).filter((b) => clean(b));
  return (
    <div className="doctext">
      {blocks.map((raw, i) => {
        const b = clean(raw);
        const head = b.match(/^(#{1,6})\s+(.*)$/);
        if (head && !b.includes("\n"))
          return (
            <h4 key={i} className="h doctext-h" data-level={head[1].length}>
              {head[2]}
            </h4>
          );
        const img = b.match(/^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)$/);
        if (img) {
          const fig = raw.match(/<!--\s*fig\s+([\w-]+)\s*-->/)?.[1];
          return (
            <figure key={i} className="passage-fig">
              <img src={fileUrl(`docs/${docId}/${img[2]}`)} alt={img[1]} />
              <figcaption className="muted">
                {fig ? (
                  <button type="button" className="linkbtn" onClick={() => onFigure(`fig:${fig}`)}>
                    {img[1]}
                  </button>
                ) : (
                  img[1]
                )}
              </figcaption>
            </figure>
          );
        }
        if (/^\|/.test(b))
          return (
            <pre key={i} className="doctext-table">
              {b}
            </pre>
          );
        const ids = requirements ? [...new Set(b.match(requirements) ?? [])] : [];
        const hot = !!focus && squeeze(b).includes(squeeze(focus).slice(0, 60));
        return (
          <div key={i} className={hot ? "doctext-p is-focus" : "doctext-p"}>
            <p>{inline(b)}</p>
            {ids.length > 0 && onRequirement && (
              <div className="chips">
                {ids.map((id) => (
                  <RequirementChip key={id} id={id} onClick={() => onRequirement(id)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {!blocks.length && <p className="muted">This part of the document is empty.</p>}
    </div>
  );
}

export function FigureChip({ caption, onClick }: { caption: string; onClick: () => void }) {
  return (
    <Chip icon="image" onClick={onClick}>
      {caption}
    </Chip>
  );
}
