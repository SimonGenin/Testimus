import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DocJson, FigureEntry, TraceItem, TraceScan, TraceView } from "../../../core/types.ts";
import { call, project } from "../../api.ts";
import { ActionButton } from "../../components/claude/ActionButton.tsx";
import { ActionCount } from "../../components/claude/ActionCount.tsx";
import { AdditionalContext } from "../../components/claude/AdditionalContext.tsx";
import { Button, Icon, IconButton, Menu, Severity, Skeleton } from "../../components/ui/index.ts";
import { forProblem, useActions } from "../../lib/actions.ts";
import { baseName, desktop, pathJoin, reveal } from "../../lib/desktop.ts";
import { cx, message, plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { idPattern, REQUIREMENT, tracesNow } from "../../lib/traces.ts";
import { settled, useUploads } from "../../lib/uploads.ts";
import { ConvertDoc } from "./ConvertDoc.tsx";
import { DocReading } from "./DocReading.tsx";
import { DocText, FigureChip } from "./DocText.tsx";
import { RemoveDoc } from "./RemoveDoc.tsx";

type TocEntry = { anchor: string; title: string; level: number };
type Shown = {
  doc: DocJson;
  context: string;
  contexts?: string[];
  toc: TocEntry[];
  requirements: string[];
  figures: FigureEntry[];
  md: string;
};

const STATUSES: DocJson["status"][] = ["draft", "submitted", "validated"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const ACTS = ["wheel", "pointerdown", "keydown", "touchstart"] as const;

function into(box: HTMLElement, el: HTMLElement, center = false) {
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (center) return r.top - b.top - Math.max(0, (b.height - r.height) / 2);
  if (r.top < b.top) return r.top - b.top;
  return r.bottom > b.bottom ? r.bottom - b.bottom : 0;
}

export function DocDetail({
  id,
  anchor,
  quote = "",
  onAnchor,
  onChanged,
  onRemoved,
}: {
  id: string;
  anchor: string;
  quote?: string;
  onAnchor: (anchor: string) => void;
  onChanged: () => void;
  onRemoved: () => void;
}) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [ask, setAsk] = useState(false);
  const [again, setAgain] = useState(false);
  const [part, setPart] = useState<{ anchor: string; md: string; section?: string } | null>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState("");
  const [ctxIds, setCtxIds] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [scanned, setScanned] = useState<{ trace: TraceView; items: TraceItem[] }[]>([]);
  const traces = tracesNow() ?? [];
  const tracesKey = traces.map((t) => `${t.id}=${t.patterns.join("|")}`).join(",");
  const requirements = idPattern(traces.find((t) => t.id === REQUIREMENT));
  const acts = useActions({ docId: id });
  const running = useUploads().find((u) => u.docId === id && u.job === "convert" && !settled(u));
  const [opened, setOpened] = useState(false);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      setOpened(true);
    }
  }, [running]);

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
        sent.current = null;
        setCtxIds(null);
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
    call<{ md: string; section?: string }>("docs.show", { id, anchor: target })
      .then((r) => !dead && setPart({ anchor: target, md: r.md, section: r.section }))
      .catch((e) => !dead && setPart({ anchor: target, md: `${message(e)}` }));
    return () => {
      dead = true;
    };
  }, [id, shown, target]);

  const current = (part?.anchor === target && part.section) || target;
  const focus = quote || (target.startsWith("req:") ? target.slice(4) : undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new focus moves the highlighted paragraph in the DOM
  useLayoutEffect(() => {
    const box = textBox.current;
    if (!part || !box) return;
    const nav = box.querySelector<HTMLElement>(".doctoc");
    const on = box.querySelector<HTMLElement>(".toc-on");
    if (nav && on) nav.scrollTop += into(nav, on);
    const text = box.querySelector<HTMLElement>(".docpart");
    const hot = box.querySelector<HTMLElement>(".is-focus");
    const go = () => {
      if (text) text.scrollTop = hot ? text.scrollTop + into(text, hot, true) : 0;
      if (anchor) box.scrollIntoView?.({ block: "nearest", behavior: "instant" });
    };
    go();
    const shown = box.querySelector(".doctext");
    if (!hot || !shown || typeof ResizeObserver === "undefined") return;
    // ponytail: figures and fonts that arrive after the first paint move the line; follow them until the reader acts
    const watch = new ResizeObserver(go);
    watch.observe(shown);
    const stop = () => {
      watch.disconnect();
      for (const k of ACTS) window.removeEventListener(k, stop, true);
    };
    for (const k of ACTS) window.addEventListener(k, stop, true);
    return stop;
  }, [part, focus, anchor]);

  const set = useCallback(
    async (patch: Partial<DocJson> & { context?: string; contexts?: string[] }, done?: string) => {
      try {
        const doc = await call<DocJson>("docs.set", { id, ...patch });
        setShown((s) =>
          s
            ? {
                ...s,
                doc,
                ...(patch.context !== undefined ? { context: patch.context } : {}),
                ...(patch.contexts ? { contexts: patch.contexts } : {}),
              }
            : s,
        );
        if (done) toast({ kind: "ok", title: done });
        onChanged();
      } catch (e) {
        errorToast(e, "Could not save the document");
      }
    },
    [id, onChanged],
  );

  // ponytail: « Save as context… » attaches the new context and empties the note in one go — both are saved together
  // biome-ignore lint/correctness/useExhaustiveDependencies: saved when the list changes, with the note as it is then
  useEffect(() => {
    if (ctxIds) void set({ contexts: ctxIds, ...(context !== shown?.context ? { context } : {}) });
  }, [ctxIds]);

  // ponytail: leaving the screen unmounts the note without a blur — what was typed is saved from the cleanup, once:
  // a blur just before has already sent it
  const sent = useRef<string | null>(null);
  const saveNote = (done?: string) => {
    if (!shown || context === (shown.context ?? "") || context === sent.current) return;
    sent.current = context;
    void set({ context }, done);
  };
  const onLeave = useRef(saveNote);
  onLeave.current = saveNote;
  useEffect(() => () => onLeave.current(), []);

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
  const from = d.source.file?.endsWith(".pdf") ? "PDF" : "Word";
  const converted = !!d.convertedAt;
  return (
    <aside className={cx("split-side docdetail", opened && "docdetail-open")} aria-label={`${d.code} details`}>
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
          <ActionCount actions={acts} />
          {!running && (
            <Menu
              label="More actions for this document"
              align="right"
              items={[
                ...(converted ? [{ key: "convert", label: "Convert again…", onSelect: () => setAgain(true) }] : []),
                { key: "delete", label: "Delete", icon: "trash", danger: true, onSelect: () => setAsk(true) },
              ]}
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
          )}
        </div>
        <h2 className="h docdetail-title">{d.title}</h2>
        {running ? (
          <span className="muted">
            Converting from {from} · {baseName(d.source.path.replace(/^upload: /, ""))}
          </span>
        ) : converted ? (
          <span className="muted">
            Converted from {from} · {plural(shown.toc.length, "section")} ·{" "}
            {scanned.map((f) => `${plural(f.items.length, `${f.trace.label.toLowerCase()} id`)} · `).join("")}
            {plural(shown.figures.length, "figure")}
          </span>
        ) : (
          <span className="muted">
            {from} file, not converted · {baseName(d.source.path.replace(/^upload: /, ""))}
          </span>
        )}
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
            disabled={!!running}
            onChange={(e) => void set({ status: e.target.value as DocJson["status"] })}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {cap(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="formfield">
        <span className="label">
          Claude context{" "}
          <span className="muted">— what the team knows about this document. Claude reads it every time.</span>
        </span>
        <AdditionalContext
          id="doc-context"
          of="this document"
          ids={ctxIds ?? shown.contexts ?? []}
          note={context}
          disabled={!!running}
          onIds={setCtxIds}
          onNote={setContext}
          onNoteBlur={() => saveNote("Context saved")}
        />
      </div>

      {running && <DocReading docId={id} upload={running} />}
      {!running && !converted && <ConvertDoc doc={d} onChanged={onChanged} />}
      {!running && converted && again && (
        <ConvertDoc doc={d} again onClose={() => setAgain(false)} onChanged={onChanged} />
      )}

      {!running && d.warnings.length > 0 && (
        <div className="docdetail-warn">
          <span className="label">Conversion warnings</span>
          {d.warnings.map((w) => {
            const a = forProblem(acts, w);
            return (
              <div key={w} className="with-cab">
                <p className="sev s-warn">
                  <Icon name="warning" />
                  {w}
                </p>
                {a && <ActionButton action={a} />}
              </div>
            );
          })}
        </div>
      )}

      {!running && converted && (
        <div className="docdetail-text">
          <div className="sect-head">
            <span className="label">Converted text</span>
          </div>
          <div ref={textBox} className="card doctoc-wrap">
            <nav className="doctoc" aria-label="Sections">
              {shown.toc.map((t) => (
                <button
                  key={t.anchor}
                  type="button"
                  className={t.anchor === current ? "toc toc-on" : "toc"}
                  aria-current={t.anchor === current ? "true" : undefined}
                  style={{ paddingLeft: 8 + (t.level - 1) * 10 }}
                  onClick={() => onAnchor(t.anchor)}
                >
                  {/^§\d+(\.\d+)*$/.test(t.anchor) ? `${t.anchor.slice(1)} ` : ""}
                  {t.title}
                </button>
              ))}
            </nav>
            <div className="docpart">
              {!part && target ? (
                <>
                  <Skeleton w="60%" h={16} />
                  <Skeleton w="95%" h={13} />
                  <Skeleton w="85%" h={13} />
                </>
              ) : (
                <DocText
                  docId={id}
                  md={part?.md ?? shown.md}
                  focus={focus}
                  requirements={requirements}
                  onRequirement={(rid) => onAnchor(`req:${rid}`)}
                  onFigure={onAnchor}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {!running &&
        scanned
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

      {!running && shown.figures.length > 0 && (
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
