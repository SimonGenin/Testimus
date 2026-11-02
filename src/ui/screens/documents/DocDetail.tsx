import { useCallback, useEffect, useState } from "react";
import type { DocJson, DocRef, FigureEntry } from "../../../core/types.ts";
import { call, project } from "../../api.ts";
import { Button, Chip, Icon, Menu, Severity, Skeleton } from "../../components/ui/index.ts";
import { desktop, pathJoin, reveal } from "../../lib/desktop.ts";
import { message, plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { DocText, FigureChip } from "./DocText.tsx";

type TocEntry = { anchor: string; title: string; level: number };
type Shown = {
  doc: DocJson;
  context: string;
  toc: TocEntry[];
  requirements: string[];
  figures: FigureEntry[];
  md: string;
};

const STATUSES = ["draft", "submitted", "validated", "superseded"] as const;
const BINDINGS = ["mandatory", "applicable", "informative"] as const;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function DocDetail({
  id,
  anchor,
  docs,
  onAnchor,
  onChanged,
  onReindex,
}: {
  id: string;
  anchor: string;
  docs: DocRef[];
  onAnchor: (anchor: string) => void;
  onChanged: () => void;
  onReindex: () => void;
}) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [part, setPart] = useState<{ anchor: string; md: string; focus?: string } | null>(null);
  const [context, setContext] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let dead = false;
    setShown(null);
    setError("");
    call<Shown>("docs.show", { id })
      .then((r) => {
        if (dead) return;
        setShown(r);
        setContext(r.context ?? "");
      })
      .catch((e) => !dead && setError(message(e)));
    return () => {
      dead = true;
    };
  }, [id]);

  const target = anchor || shown?.toc.find((t) => t.level > 1)?.anchor || shown?.toc[0]?.anchor || "";
  useEffect(() => {
    if (!shown || !target) {
      setPart(null);
      return;
    }
    let dead = false;
    const focusOf = target.startsWith("req:") ? target.slice(4) : undefined;
    call<{ md: string }>("docs.show", { id, anchor: target })
      .then((r) => !dead && setPart({ anchor: target, md: r.md, focus: focusOf }))
      .catch((e) => !dead && setPart({ anchor: target, md: `${message(e)}` }));
    return () => {
      dead = true;
    };
  }, [id, shown, target]);

  const set = useCallback(
    async (patch: Partial<DocJson> & { context?: string }, done?: string) => {
      try {
        const doc = await call<DocJson>("docs.set", { id, ...patch });
        setShown((s) => (s ? { ...s, doc, ...(patch.context !== undefined ? { context: patch.context } : {}) } : s));
        if (done) toast({ kind: "ok", title: done });
        onChanged();
      } catch (e) {
        errorToast(e, "Could not save the document");
      }
    },
    [id, onChanged],
  );

  if (error)
    return (
      <aside className="split-side docdetail" aria-label={`${id} details`}>
        <Severity tone="error">This document could not be opened</Severity>
        <p>{error}</p>
      </aside>
    );
  if (!shown)
    return (
      <aside className="split-side docdetail" aria-label={`${id} details`} aria-busy="true">
        <Skeleton w={240} h={11} />
        <Skeleton w={180} h={24} />
        <Skeleton w={300} h={12} />
        <div className="formgrid">
          <Skeleton h={58} />
          <Skeleton h={58} />
        </div>
        <Skeleton h={80} />
      </aside>
    );

  const d = shown.doc;
  const others = docs.filter((x) => x.id !== id);
  const amends = d.amends ?? [];
  const from = d.source.file?.endsWith(".pdf") ? "PDF" : "Word";
  return (
    <aside className="split-side docdetail" aria-label={`${d.code} details`}>
      <div className="docdetail-head">
        <span className="mono muted docdetail-code">
          <span>{d.code}</span> · <span>version {d.version}</span>
          {d.date && (
            <>
              {" · "}
              <span>{d.date}</span>
            </>
          )}
        </span>
        <h2 className="h docdetail-title">{d.title}</h2>
        <span className="muted">
          Converted from {from} · {plural(shown.toc.length, "section")} ·{" "}
          {plural(shown.requirements.length, "requirement id")} · {plural(shown.figures.length, "figure")}
        </span>
        {desktop() && project() && (
          <span>
            <Button
              size="sm"
              tone="quiet"
              icon="external"
              onClick={() => void reveal(pathJoin(project() ?? "", "docs", id))}
            >
              Show in Explorer
            </Button>
          </span>
        )}
      </div>

      <div className="formgrid">
        <div className="formfield">
          <label className="label" htmlFor="doc-status">
            Status
          </label>
          <select
            id="doc-status"
            className="field"
            value={d.status}
            onChange={(e) => void set({ status: e.target.value as DocJson["status"] })}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {cap(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="formfield">
          <label className="label" htmlFor="doc-binding">
            Binding
          </label>
          <select
            id="doc-binding"
            className="field"
            value={d.binding}
            onChange={(e) => void set({ binding: e.target.value as DocJson["binding"] })}
          >
            {BINDINGS.map((s) => (
              <option key={s} value={s}>
                {cap(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="formfield">
          <label className="label" htmlFor="doc-superseded">
            Superseded by
          </label>
          <select
            id="doc-superseded"
            className="field"
            value={d.supersededBy ?? ""}
            onChange={(e) => void set({ supersededBy: e.target.value })}
          >
            <option value="">— none</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} {o.title}
              </option>
            ))}
          </select>
        </div>
        <div className="formfield">
          <span className="label">Amends</span>
          <div className="chips">
            {amends.map((a) => (
              <Chip
                key={a}
                onRemove={() => void set({ amends: amends.filter((x) => x !== a) })}
                removeLabel={`Remove ${a}`}
              >
                <span className="mono">{a}</span>
              </Chip>
            ))}
            <Menu
              label="Documents this one amends"
              trigger={({ open, toggle, id: mid }) => (
                <Button
                  tone="quiet"
                  size="sm"
                  icon="plus"
                  aria-expanded={open}
                  aria-controls={mid}
                  disabled={!others.some((o) => !amends.includes(o.id))}
                  onClick={toggle}
                >
                  Add a document
                </Button>
              )}
              items={others
                .filter((o) => !amends.includes(o.id))
                .map((o) => ({
                  key: o.id,
                  label: `${o.code} ${o.title}`,
                  onSelect: () => void set({ amends: [...amends, o.id] }),
                }))}
            />
          </div>
        </div>
      </div>

      <div className="formfield">
        <label htmlFor="doc-context" className="label">
          Context — what the team knows about this document. Claude reads it every time.
        </label>
        <textarea
          id="doc-context"
          className="field"
          rows={3}
          value={context}
          onChange={(e) => setContext(e.target.value)}
          onBlur={() => context !== shown.context && void set({ context }, "Context saved")}
        />
      </div>

      {d.warnings.length > 0 && (
        <div className="docdetail-warn">
          <span className="label">Conversion warnings</span>
          {d.warnings.map((w) => (
            <p key={w} className="sev s-warn">
              <Icon name="warning" />
              {w}
            </p>
          ))}
        </div>
      )}

      <div className="docdetail-text">
        <div className="sect-head">
          <span className="label">Converted text</span>
          <span className="spacer" />
          <Button size="sm" onClick={onReindex}>
            Reindex
          </Button>
        </div>
        <div className="card doctoc-wrap">
          <nav className="doctoc" aria-label="Sections">
            {shown.toc.map((t) => (
              <button
                key={t.anchor}
                type="button"
                className={t.anchor === target ? "toc toc-on" : "toc"}
                aria-current={t.anchor === target ? "true" : undefined}
                style={{ paddingLeft: 8 + (t.level - 1) * 10 }}
                onClick={() => onAnchor(t.anchor)}
              >
                {t.anchor.startsWith("§") ? `${t.anchor.slice(1)} ` : ""}
                {t.title}
              </button>
            ))}
          </nav>
          <div className="docpart">
            {!part ? (
              <>
                <Skeleton w="60%" h={16} />
                <Skeleton w="95%" h={13} />
                <Skeleton w="85%" h={13} />
              </>
            ) : (
              <DocText
                docId={id}
                md={part.md}
                focus={part.focus}
                onRequirement={(rid) => onAnchor(`req:${rid}`)}
                onFigure={onAnchor}
              />
            )}
          </div>
        </div>
      </div>

      {shown.requirements.length > 0 && (
        <div className="formfield">
          <span className="label">Requirement ids ({shown.requirements.length})</span>
          <div className="chips docreqs">
            {shown.requirements.map((r) => (
              <button
                key={r}
                type="button"
                className={`chip req chip-btn${target === `req:${r}` ? " chip-on" : ""}`}
                onClick={() => onAnchor(`req:${r}`)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {shown.figures.length > 0 && (
        <div className="formfield">
          <span className="label">Figures ({shown.figures.length})</span>
          <div className="chips">
            {shown.figures.map((f) => (
              <FigureChip key={f.anchor} caption={f.caption || f.anchor} onClick={() => onAnchor(f.anchor)} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
