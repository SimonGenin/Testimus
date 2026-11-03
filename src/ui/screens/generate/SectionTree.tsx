import { useEffect, useMemo, useState } from "react";
import { call } from "../../api.ts";
import { Icon, Skeleton } from "../../components/legacy/index.ts";
import { cx } from "../../lib/format.ts";
import { flip, ownText, parents, type TocEntry, tick } from "../../lib/scope.ts";

const number = (a: string) => (a.startsWith("§") ? a.slice(1) : "");

export function SectionTree({
  docId,
  picked,
  onChange,
}: {
  docId: string;
  picked: string[];
  onChange: (anchors: string[]) => void;
}) {
  const [toc, setToc] = useState<TocEntry[] | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [text, setText] = useState<Record<string, string[] | "loading" | "error">>({});
  useEffect(() => {
    call<{ toc: TocEntry[] }>("docs.show", { id: docId })
      .then((r) => setToc(r?.toc ?? []))
      .catch(() => setToc([]));
  }, [docId]);
  const up = useMemo(() => (toc ? parents(toc) : []), [toc]);

  if (!toc)
    return (
      <div className="stree" aria-busy="true">
        <Skeleton w="60%" h={14} />
        <Skeleton w="45%" h={14} />
      </div>
    );
  if (!toc.length) return <p className="muted stree-empty">This document has no headings to pick from.</p>;

  const hasKids = (i: number) => up.some((p) => p === i);
  const shown = (i: number) => {
    for (let p = up[i]; p >= 0; p = up[p]) if (!open.has(p)) return false;
    return true;
  };
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const read = (anchor: string) => {
    if (text[anchor]) {
      const { [anchor]: _, ...rest } = text;
      setText(rest);
      return;
    }
    setText((t) => ({ ...t, [anchor]: "loading" }));
    call<{ md: string }>("docs.show", { id: docId, anchor })
      .then((r) => setText((t) => ({ ...t, [anchor]: ownText(r?.md ?? "") })))
      .catch(() => setText((t) => ({ ...t, [anchor]: "error" })));
  };

  const base = Math.min(...toc.map((t) => t.level));
  return (
    <ul className="stree" aria-label="Sections">
      {toc.map((t, i) => {
        if (!shown(i)) return null;
        const state = tick(toc, up, picked, i);
        const body = text[t.anchor];
        return (
          <li key={t.anchor} style={{ paddingLeft: (t.level - base) * 22 }}>
            <div className="stree-row">
              {hasKids(i) ? (
                <button
                  type="button"
                  className="stree-tw"
                  aria-expanded={open.has(i)}
                  aria-label={`${open.has(i) ? "Fold" : "Unfold"} ${t.title}`}
                  onClick={() => toggle(i)}
                >
                  <Icon name={open.has(i) ? "down" : "right"} />
                </button>
              ) : (
                <span className="stree-tw" aria-hidden="true" />
              )}
              <label className="stree-label">
                <input
                  type="checkbox"
                  checked={state === "on"}
                  ref={(el) => {
                    if (el) el.indeterminate = state === "mixed";
                  }}
                  onChange={() => onChange(flip(toc, up, picked, i))}
                />
                {number(t.anchor) && <span className="mono stree-num">{number(t.anchor)}</span>}
                <span className={cx(state === "on" && "stree-on")}>{t.title}</span>
              </label>
              <button
                type="button"
                className="linkbtn stree-read"
                aria-expanded={!!body}
                onClick={() => read(t.anchor)}
              >
                {body ? "Hide text" : "Text"}
              </button>
            </div>
            {body === "loading" && (
              <div className="stree-text">
                <Skeleton w="80%" h={12} />
              </div>
            )}
            {body === "error" && (
              <div className="stree-text">
                <p className="muted">Could not read this section — try again.</p>
              </div>
            )}
            {Array.isArray(body) && (
              <div className="stree-text">
                {body.length ? (
                  body.map((p, k) => <p key={k}>{p}</p>)
                ) : (
                  <p className="muted">No text under this heading — only sub-sections.</p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
