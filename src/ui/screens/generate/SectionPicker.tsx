import { useEffect, useState } from "react";
import type { DocRef } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { Icon, Skeleton } from "../../components/ui/index.ts";
import { cx } from "../../lib/format.ts";

type TocEntry = { anchor: string; title: string; level: number };

export function SectionPicker({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [docs, setDocs] = useState<DocRef[] | null>(null);
  const [open, setOpen] = useState<Record<string, TocEntry[] | "loading">>({});
  useEffect(() => {
    call<DocRef[]>("docs.list", {})
      .then((r) => setDocs((r ?? []).filter((d) => d.status !== "superseded" && !d.supersededBy)))
      .catch(() => setDocs([]));
  }, []);

  const toggleDoc = (id: string) => {
    if (open[id]) {
      const { [id]: _, ...rest } = open;
      setOpen(rest);
      return;
    }
    setOpen((o) => ({ ...o, [id]: "loading" }));
    call<{ toc: TocEntry[] }>("docs.show", { id })
      .then((r) => setOpen((o) => ({ ...o, [id]: r?.toc ?? [] })))
      .catch(() => setOpen((o) => ({ ...o, [id]: [] })));
  };

  const flip = (ref: string, on: boolean) => onChange(on ? [...values, ref] : values.filter((v) => v !== ref));

  if (!docs)
    return (
      <div className="card secpick" aria-busy="true">
        <Skeleton w="70%" h={14} />
        <Skeleton w="60%" h={14} />
      </div>
    );
  if (!docs.length) return <p className="muted">No document yet — add one in Documents.</p>;
  return (
    <div className="card secpick">
      {docs.map((d) => {
        const toc = open[d.id];
        const picked = values.filter((v) => v.startsWith(`${d.id}#`)).length;
        return (
          <div key={d.id}>
            <button type="button" className="sec sec-doc" aria-expanded={!!toc} onClick={() => toggleDoc(d.id)}>
              <Icon name={toc ? "down" : "right"} />
              <span className="mono">{d.code}</span>
              <span className="sec-title" title={d.title}>
                {d.title}
              </span>
              {picked > 0 && <span className="muted">{picked} picked</span>}
            </button>
            {toc === "loading" && (
              <div className="sec">
                <Skeleton w="50%" h={12} />
              </div>
            )}
            {Array.isArray(toc) &&
              toc.map((t) => {
                const ref = `${d.id}#${t.anchor}`;
                return (
                  <label key={t.anchor} className={cx("sec")} style={{ paddingLeft: 12 + t.level * 16 }}>
                    <input
                      type="checkbox"
                      checked={values.includes(ref)}
                      onChange={(e) => flip(ref, e.target.checked)}
                    />
                    <span>
                      {t.anchor.startsWith("§") ? `${t.anchor.slice(1)} ` : ""}
                      {t.title}
                    </span>
                  </label>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
