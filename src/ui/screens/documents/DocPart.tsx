import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef } from "react";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { DocText } from "./DocText.tsx";
import type { TocEntry } from "./DocToc.tsx";
import { into } from "./scroll.ts";

const styles = stylex.create({
  box: { flex: 1, minHeight: 0, overflowY: "auto", backgroundColor: color.surface },
  inner: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingTop: space.s7,
    paddingRight: space.s8,
    paddingBottom: space.s11,
    paddingLeft: space.s3,
    maxWidth: `calc(${size.reading} + ${space.s11} + ${space.s8} + ${space.s5})`,
    marginInline: "auto",
  },
  nav: { display: "flex", alignItems: "center", gap: space.s2, color: color.textMuted },
  where: { flex: 1, minWidth: 0 },
});

export type QuoteFrom = { test: string; step?: number };

const sectionLabel = (anchor: string) => (anchor.startsWith("§") ? `§ ${anchor.slice(1)}` : anchor);

// ponytail: a quote (or a passage with none) opened from a test: which test cited it (when the link says so), the way
// back, and Clear to read on without the mark
function QuoteBar({
  under,
  quoted,
  from,
  onBack,
  onClear,
}: {
  under: string;
  quoted: boolean;
  from?: QuoteFrom;
  onBack: () => void;
  onClear: () => void;
}) {
  return (
    <Banner
      tone="neutral"
      icon="quote"
      actions={
        <>
          <Button size="sm" icon="arrow-left" label={from ? "Back to the test" : "Back"} onClick={onBack} />
          <Button size="sm" variant="quiet" label="Clear" onClick={onClear} />
        </>
      }
    >
      {from ? (
        <>
          {quoted ? "The quote" : "The passage"} cited by <span {...stylex.props(type.code)}>{from.test}</span>
          {from.step ? ` · step ${from.step}` : ""}
        </>
      ) : (
        "The quoted passage"
      )}
      {under && (
        <>
          , under <span {...stylex.props(type.code)}>{sectionLabel(under)}</span>
        </>
      )}
    </Banner>
  );
}

const ACTS = ["wheel", "pointerdown", "keydown", "touchstart"] as const;

// ponytail: one section (with its subsections) at a time — ‹ › step through the contents; the line a link points at is
// centred, and followed while figures and fonts arrive, until the reader acts
export function DocPart({
  docId,
  sections,
  current,
  md,
  loading,
  focus,
  target,
  quote,
  onGo,
  onFigure,
}: {
  docId: string;
  sections: TocEntry[];
  current: string;
  md: string;
  loading: boolean;
  focus?: string;
  target?: string;
  quote?: { from?: QuoteFrom; onBack: () => void; onClear: () => void };
  onGo: (anchor: string) => void;
  /** a figure of the text shown in the Figures view */
  onFigure?: (anchor: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const at = sections.findIndex((t) => t.anchor === current);
  const prev = at > 0 ? sections[at - 1] : undefined;
  const next = at >= 0 && at < sections.length - 1 ? sections[at + 1] : undefined;
  const chapter = at >= 0 && sections[at].level > 1 ? sections.slice(0, at).findLast((t) => t.level === 1) : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new part or focus moves the marked line in the DOM
  useLayoutEffect(() => {
    const b = box.current;
    if (!b || loading) return;
    const hot = b.querySelector<HTMLElement>("[data-focus], [data-target]");
    const go = () => {
      b.scrollTop = hot ? b.scrollTop + into(b, hot, true) : 0;
    };
    go();
    const text = b.querySelector('[data-testid="doc-text"]');
    if (!hot || !text || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(go);
    watch.observe(text);
    const stop = () => {
      watch.disconnect();
      for (const k of ACTS) window.removeEventListener(k, stop, true);
    };
    for (const k of ACTS) window.addEventListener(k, stop, true);
    return stop;
  }, [md, focus, target, current, loading]);

  return (
    <div ref={box} data-testid="doc-part" {...stylex.props(styles.box)}>
      <div {...stylex.props(styles.inner)}>
        {(focus || quote?.from) && quote && <QuoteBar under={current} quoted={!!focus} {...quote} />}
        <div {...stylex.props(type.small, styles.nav)}>
          <span {...stylex.props(styles.where)}>
            {chapter ? `${chapter.title} · ` : ""}
            {at >= 0 ? `section ${at + 1} of ${sections.length}` : ""}
          </span>
          <Button
            size="sm"
            variant="quiet"
            iconOnly
            icon="chevron-left"
            label="Previous section"
            disabled={!prev}
            onClick={() => prev && onGo(prev.anchor)}
          />
          <Button
            size="sm"
            variant="quiet"
            iconOnly
            icon="chevron-right"
            label="Next section"
            disabled={!next}
            onClick={() => next && onGo(next.anchor)}
          />
        </div>
        {loading ? (
          <Skeleton lines={4} />
        ) : (
          <DocText docId={docId} md={md} focus={focus} target={target} onFigure={onFigure ?? onGo} />
        )}
      </div>
    </div>
  );
}
