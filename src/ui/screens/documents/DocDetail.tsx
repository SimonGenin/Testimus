import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DocJson, FigureEntry } from "../../../core/types.ts";
import { call, project } from "../../api.ts";
import { ActionButton } from "../../components/claude/ActionButton.tsx";
import { ActionCount } from "../../components/claude/ActionCount.tsx";
import { AdditionalContext } from "../../components/claude/AdditionalContext.tsx";
import { Button, DragEdge, Icon, IconButton, Menu, Segmented, Severity, Skeleton } from "../../components/ui/index.ts";
import { forProblem, useActions } from "../../lib/actions.ts";
import { baseName, desktop, pathJoin, reveal } from "../../lib/desktop.ts";
import { cx, message, plural } from "../../lib/format.ts";
import type { SideEdge } from "../../lib/sideWidth.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { idPattern, REQUIREMENT, tracesNow } from "../../lib/traces.ts";
import { settled, useUploads } from "../../lib/uploads.ts";
import { ConvertDoc } from "./ConvertDoc.tsx";
import { DocFigures } from "./DocFigures.tsx";
import { DocReading } from "./DocReading.tsx";
import { DocText } from "./DocText.tsx";
import type { Fold } from "./DocumentsScreen.tsx";
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
  fold = "wide",
  tocEdge,
  sideEdge,
  listOpen = false,
  onShowList,
  onAnchor,
  onChanged,
  onRemoved,
}: {
  id: string;
  anchor: string;
  quote?: string;
  fold?: Fold;
  tocEdge?: SideEdge;
  sideEdge?: SideEdge;
  listOpen?: boolean;
  onShowList?: () => void;
  onAnchor: (anchor: string) => void;
  onChanged: () => void;
  onRemoved: () => void;
}) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [ask, setAsk] = useState(false);
  const [again, setAgain] = useState(false);
  const [view, setView] = useState<"text" | "figures">("text");
  const [drawer, setDrawer] = useState<"sections" | "details" | null>(null);
  const [part, setPart] = useState<{ anchor: string; md: string; section?: string } | null>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState("");
  const [ctxIds, setCtxIds] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const requirements = idPattern((tracesNow() ?? []).find((t) => t.id === REQUIREMENT));
  const acts = useActions({ docId: id });
  const running = useUploads().find((u) => u.docId === id && u.job === "convert" && !settled(u));
  const [opened, setOpened] = useState(false);
  const wasRunning = useRef(false);
  const sideFolded = fold === "small" || fold === "tiny";
  const tocFolded = fold === "tiny";

  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      setOpened(true);
    }
  }, [running]);

  useEffect(() => {
    if ((drawer === "details" && !sideFolded) || (drawer === "sections" && !tocFolded)) setDrawer(null);
  }, [drawer, sideFolded, tocFolded]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

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
  }, [part, focus, anchor, view]);

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

  const switcher = onShowList && (
    <IconButton
      icon="documents"
      className="docdoc-switch"
      label="Show the document list"
      aria-expanded={listOpen}
      onClick={onShowList}
    />
  );

  if (error)
    return (
      <section className="docdoc docdoc-alone" aria-label={`${id} details`}>
        {switcher}
        <Severity tone="error">This document could not be opened</Severity>
        <p>{error}</p>
      </section>
    );
  if (!shown)
    return (
      <section className="docdoc docdoc-alone" aria-label={`${id} details`} aria-busy="true">
        <Skeleton w={240} h={22} />
        <Skeleton w={300} h={12} />
        <Skeleton h={80} />
      </section>
    );

  const d = shown.doc;
  const from = d.source.file?.endsWith(".pdf") ? "PDF" : "Word";
  const converted = !!d.convertedAt;
  const reading = !running && converted;
  const sections = shown.toc;
  const at = sections.findIndex((t) => t.anchor === current);
  const prev = at > 0 ? sections[at - 1] : undefined;
  const next = at >= 0 && at < sections.length - 1 ? sections[at + 1] : undefined;
  const chapter = at >= 0 && sections[at].level > 1 ? sections.slice(0, at).findLast((t) => t.level === 1) : undefined;
  const go = (a: string) => {
    setView("text");
    setDrawer(null);
    onAnchor(a);
  };
  const toggle = (which: "sections" | "details") => setDrawer((w) => (w === which ? null : which));

  return (
    <section
      className={cx("docdoc", opened && "docdetail-open", drawer && `is-${drawer}-open`)}
      aria-label={`${d.code} details`}
    >
      <header className="docdoc-head">
        {switcher}
        <div className="docdoc-titles">
          <div className="docdoc-titleline">
            <h2 className="h docdoc-title">{d.title}</h2>
            <span className="mono muted docdetail-code">
              <span>{d.code}</span> · <span>version {d.version}</span>
              {d.date && (
                <>
                  {" · "}
                  <span>{d.date}</span>
                </>
              )}
            </span>
          </div>
          {running ? (
            <span className="muted docdoc-facts">
              Converting from {from} · {baseName(d.source.path.replace(/^upload: /, ""))}
            </span>
          ) : converted ? (
            <span className="muted docdoc-facts">
              Converted from {from} · {plural(sections.length, "section")} · {plural(shown.figures.length, "figure")}
            </span>
          ) : (
            <span className="muted docdoc-facts">
              {from} file, not converted · {baseName(d.source.path.replace(/^upload: /, ""))}
            </span>
          )}
        </div>
        <div className="docdoc-acts">
          {reading && shown.figures.length > 0 && (
            <Segmented
              label="Document views"
              value={view}
              onChange={setView}
              options={[
                { value: "text", label: "Text" },
                { value: "figures", label: "Figures", count: shown.figures.length },
              ]}
            />
          )}
          {reading && tocFolded && view === "text" && (
            <Button
              size="sm"
              tone="quiet"
              icon="text"
              aria-expanded={drawer === "sections"}
              onClick={() => toggle("sections")}
            >
              Sections
            </Button>
          )}
          <ActionCount actions={acts} />
          {sideFolded && (
            <Button
              size="sm"
              tone={drawer === "details" ? "primary" : "quiet"}
              aria-expanded={drawer === "details"}
              onClick={() => toggle("details")}
            >
              Details
              {!running && d.warnings.length > 0 && <span className="docdoc-dot" title="Conversion warnings" />}
            </Button>
          )}
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
      </header>

      <div ref={textBox} className={cx("docdoc-body", !reading && "is-bare")}>
        {reading && (
          <nav className="doctoc" aria-label="Sections">
            <div className="docdoc-label">
              Structure <span className="muted">{plural(sections.length, "section")}</span>
            </div>
            {sections.map((t) => (
              <button
                key={t.anchor}
                type="button"
                className={cx("toc", t.level === 1 && "toc-chapter", t.anchor === current && "toc-on")}
                aria-current={t.anchor === current ? "true" : undefined}
                style={{ paddingLeft: 8 + Math.max(0, t.level - 2) * 12 }}
                onClick={() => go(t.anchor)}
              >
                {/^§\d+(\.\d+)*$/.test(t.anchor) ? `${t.anchor.slice(1)} ` : ""}
                {t.title}
              </button>
            ))}
          </nav>
        )}
        {reading && tocEdge && !tocFolded && (
          <DragEdge className="doctoc-edge" label="Resize the sections" {...tocEdge} />
        )}
        {drawer === "sections" && <div className="docs-scrim" aria-hidden="true" onClick={() => setDrawer(null)} />}

        <div className="docdoc-view">
          {running && <DocReading docId={id} upload={running} />}
          {!running && !converted && <ConvertDoc doc={d} onChanged={onChanged} />}
          {reading && again && <ConvertDoc doc={d} again onClose={() => setAgain(false)} onChanged={onChanged} />}
          {reading && view === "figures" && <DocFigures docId={id} figures={shown.figures} onOpen={go} />}
          {reading && view === "text" && (
            <div className="docpart">
              <div className="docpart-in">
                <div className="docpart-nav">
                  <span className="muted">
                    {chapter ? `${chapter.title} · ` : ""}
                    {at >= 0 ? `section ${at + 1} of ${sections.length}` : ""}
                  </span>
                  <span className="spacer" />
                  <IconButton
                    icon="left"
                    label="Previous section"
                    disabled={!prev}
                    onClick={() => prev && go(prev.anchor)}
                  />
                  <IconButton
                    icon="right"
                    label="Next section"
                    disabled={!next}
                    onClick={() => next && go(next.anchor)}
                  />
                </div>
                {!part && target ? (
                  <>
                    <Skeleton w="60%" h={18} />
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
                    onFigure={go}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {drawer === "details" && <div className="docs-scrim" aria-hidden="true" onClick={() => setDrawer(null)} />}
        {sideEdge && !sideFolded && <DragEdge className="docdoc-side-edge" label="Resize the settings" {...sideEdge} />}
        <aside className="docdoc-side" aria-label="Document settings">
          <div className="formfield">
            <span className="docdoc-label">Status</span>
            <Segmented
              label="Status"
              className="docdoc-status"
              value={d.status}
              options={STATUSES.map((s) => ({ value: s, label: cap(s), disabled: !!running }))}
              onChange={(s) => s !== d.status && void set({ status: s })}
            />
          </div>

          <div className="formfield">
            <span className="docdoc-label">Claude context</span>
            <span className="muted docdoc-hint">
              What the team knows about this document. Claude reads it every time.
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

          {!running && d.warnings.length > 0 && (
            <div className="docdetail-warn">
              <span className="docdoc-label">
                Conversion <span className="muted">{plural(d.warnings.length, "warning")}</span>
              </span>
              <ul className="docdoc-warns">
                {d.warnings.map((w) => {
                  const a = forProblem(acts, w);
                  return (
                    <li key={w} className="docdoc-warn">
                      <Icon name="warning" />
                      <div className="docdoc-warn-text">
                        <p>{w}</p>
                        {a && <ActionButton action={a} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
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
        </aside>
      </div>

      {ask && <RemoveDoc doc={d} onClose={() => setAsk(false)} onRemoved={onRemoved} />}
    </section>
  );
}
