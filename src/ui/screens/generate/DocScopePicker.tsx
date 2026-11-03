import type { DocRef } from "../../../core/types.ts";
import { Skeleton } from "../../components/ui/index.ts";
import { cx, plural } from "../../lib/format.ts";
import type { DocScope } from "../../lib/scope.ts";
import { SectionTree } from "./SectionTree.tsx";

export function DocScopePicker({
  docs,
  scopes,
  onChange,
}: {
  docs: DocRef[] | null;
  scopes: Record<string, DocScope>;
  onChange: (next: Record<string, DocScope>) => void;
}) {
  if (!docs)
    return (
      <div className="card dscope" aria-busy="true">
        <Skeleton w="70%" h={14} />
        <Skeleton w="60%" h={14} />
      </div>
    );
  if (!docs.length) return <p className="muted">No document yet — add one in Documents.</p>;
  const set = (id: string, s: DocScope) => onChange({ ...scopes, [id]: s });
  const of = (id: string): DocScope => scopes[id] ?? "all";
  const inScope = docs.filter((d) => of(d.id) !== "none").length;
  const narrowed = docs.filter((d) => Array.isArray(of(d.id))).length;
  return (
    <div className="card dscope">
      <div className="dscope-head">
        <span className="muted">
          {inScope} of {plural(docs.length, "document")}
          {narrowed ? ` · ${narrowed} narrowed to sections` : ""}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="linkbtn"
          onClick={() => onChange(Object.fromEntries(docs.map((d) => [d.id, "all"])))}
        >
          Select all
        </button>
        <button
          type="button"
          className="linkbtn"
          onClick={() => onChange(Object.fromEntries(docs.map((d) => [d.id, "none"])))}
        >
          Select none
        </button>
      </div>
      <ul className="dscope-list" aria-label="Documents in scope">
        {docs.map((d) => {
          const s = of(d.id);
          const some = Array.isArray(s);
          const total = d.stats?.sections;
          return (
            <li key={d.id} className={cx("dscope-doc", some && "is-narrowed")}>
              <div className="dscope-row">
                <label className="dscope-label">
                  <input
                    type="checkbox"
                    checked={s === "all" || (some && s.length > 0)}
                    ref={(el) => {
                      if (el) el.indeterminate = some;
                    }}
                    onChange={() => set(d.id, s === "none" ? "all" : "none")}
                  />
                  <span className="dscope-text">
                    <span className="dscope-title">{d.title || d.code}</span>
                    <span className="mono muted dscope-meta">
                      {d.code}
                      {" · "}
                      {s === "all" ? (
                        `whole document${total ? ` · ${plural(total, "section")}` : ""}`
                      ) : s === "none" ? (
                        "left out"
                      ) : (
                        <span className="dscope-some">
                          {s.length ? `${plural(s.length, "section")} picked` : "no section picked yet"}
                        </span>
                      )}
                    </span>
                  </span>
                </label>
                {some ? (
                  <button type="button" className="linkbtn" onClick={() => set(d.id, "all")}>
                    Back to the whole document
                  </button>
                ) : (
                  <button type="button" className="linkbtn" onClick={() => set(d.id, [])}>
                    Only some sections…
                  </button>
                )}
              </div>
              {some && <SectionTree docId={d.id} picked={s} onChange={(a) => set(d.id, a)} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
