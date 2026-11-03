import { useCallback, useEffect, useState } from "react";
import type { DocJson, DocRef, FigureEntry, TraceItem, TraceScan, TraceView } from "../../../core/types.ts";
import { call, project } from "../../api.ts";
import { Button, Chip, Icon, IconButton, Menu, Severity, Skeleton } from "../../components/ui/index.ts";
import { desktop, pathJoin, reveal } from "../../lib/desktop.ts";
import { message, plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { REQUIREMENT, tracesNow } from "../../lib/traces.ts";
import { DocText, FigureChip } from "./DocText.tsx";
import { RemoveDoc } from "./RemoveDoc.tsx";

type TocEntry = { anchor: string; title: string; level: number };
type Shown = {
  doc: DocJson;
  context: string;
  toc: TocEntry[];
  requirements: string[];
  figures: FigureEntry[];
  md: string;
};

const STATUSES: DocJson["status"][] = ["draft", "submitted", "validated"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const LEGACY: TraceView = {
  id: REQUIREMENT,
  label: "Requirement",
  patterns: [],
  field: "",
  origin: "detected",
  column: "local",
  found: 0,
  docs: 1,
};

export function DocDetail({
  id,
  anchor,
  docs,
  onAnchor,
  onChanged,
  onReindex,
  onRemoved,
}: {
  id: string;
  anchor: string;
  docs: DocRef[];
  onAnchor: (anchor: string) => void;
  onChanged: () => void;
  onReindex: () => void;
  onRemoved: () => void;
}) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [ask, setAsk] = useState(false);
  const [part, setPart] = useState<{ anchor: string; md: string; focus?: string } | null>(null);
  const [context, setContext] = useState("");
  const [error, setError] = useState("");
  const [scanned, setScanned] = useState<{ trace: TraceView; items: TraceItem[] }[]>([]);
  // ponytail: until the project says what it tracks (tracesNow() null), a document shows its requirement anchors
  const known = tracesNow();
  const traces = known ?? [];
  const tracesKey = traces.map((t) => `${t.id}=${t.patterns.join("|")}`).join(",");
  const tracksReqs = !known || traces.some((t) => t.id === REQUIREMENT);
  const found =
    known || !shown
      ? scanned
      : [
          {
            trace: { ...LEGACY, found: shown.requirements.length },
            items: shown.requirements.map((r) => ({ id: r, doc: id, anchor: `req:${r}`, context: "" })),
          },
        ];

  // biome-ignore lint/correctness/useExhaustiveDependencies: the tracked kinds are compared by their key
  useEffect(() => {
    let dead = false;
    Promise.all(
      traces.map((trace) =>
        call<TraceScan>("traces.find", { trace: trace.id, doc: id, limit: 2000 })
          .then((r) => ({ trace, items: r.items }))
          .catch(() => ({ trace, items: [] as TraceItem[] })),
      ),
    ).then((r) => !dead && setScanned(r));
    return () => {
      dead = true;
    };
  }, [id, tracesKey]);

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
        <div className="docdetail-top">
          <span className="mono muted docdetail-code">
            <span>{d.code}</span> · <span>version {d.version}</span>
            {d.date && (
              <>
                {" · "}
                <span>{d.date}</span>
              </>
            )}
          </span>
          <Menu
            label="More actions for this document"
            align="right"
            items={[{ key: "delete", label: "Delete", icon: "trash", danger: true, onSelect: () => setAsk(true) }]}
            trigger={({ open, toggle, id: mid }) => (
              <IconButton
                icon="more"
                label="More actions for this document"
                aria-expanded={open}
                aria-controls={open ? mid : undefined}
                onClick={toggle}
              />
            )}
          />
        </div>
        <h2 className="h docdetail-title">{d.title}</h2>
        <span className="muted">
          Converted from {from} · {plural(shown.toc.length, "section")} ·{" "}
          {found.map((f) => `${plural(f.items.length, `${f.trace.label.toLowerCase()} id`)} · `).join("")}
          {plural(shown.figures.length, "figure")}
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
                {/^§\d+(\.\d+)*$/.test(t.anchor) ? `${t.anchor.slice(1)} ` : ""}
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
                onRequirement={tracksReqs ? (rid) => onAnchor(`req:${rid}`) : undefined}
                onFigure={onAnchor}
              />
            )}
          </div>
        </div>
      </div>

      {found
        .filter((f) => f.items.length > 0)
        .map((f) => {
          const to = (it: TraceItem) =>
            f.trace.id === REQUIREMENT && shown.requirements.includes(it.id) ? `req:${it.id}` : it.anchor;
          return (
            <div key={f.trace.id} className="formfield">
              <span className="label">
                {f.trace.label} ids ({f.items.length})
              </span>
              <div className="chips docreqs">
                {f.items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    title={it.context}
                    className={`chip req chip-btn${target === to(it) ? " chip-on" : ""}`}
                    onClick={() => to(it) && onAnchor(to(it))}
                  >
                    {it.id}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

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

      {ask && <RemoveDoc doc={d} onClose={() => setAsk(false)} onRemoved={onRemoved} />}
    </aside>
  );
}
