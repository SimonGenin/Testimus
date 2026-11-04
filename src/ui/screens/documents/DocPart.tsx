import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { color, fontSize, lineHeight, size, space } from "../../styles/tokens.stylex.ts";
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
    paddingBlock: space.s5,
    paddingInline: space.s7,
    maxWidth: `calc(${size.reading} + ${size.thumb} + ${space.s11})`,
  },
  nav: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
  },
  where: { flex: 1, minWidth: 0 },
});

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
  onGo,
}: {
  docId: string;
  sections: TocEntry[];
  current: string;
  md: string;
  loading: boolean;
  focus?: string;
  onGo: (anchor: string) => void;
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
    const hot = b.querySelector<HTMLElement>("[data-focus]");
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
  }, [md, focus, current, loading]);

  return (
    <div ref={box} data-testid="doc-part" {...stylex.props(styles.box)}>
      <div {...stylex.props(styles.inner)}>
        <div {...stylex.props(styles.nav)}>
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
        {loading ? <Skeleton lines={4} /> : <DocText docId={docId} md={md} focus={focus} onFigure={onGo} />}
      </div>
    </div>
  );
}
