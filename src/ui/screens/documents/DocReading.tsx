import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Timeline, type TimelineItem } from "../../components/ui/Timeline.tsx";
import { type } from "../../components/ui/type.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { invalidate, useRead } from "../../lib/data/query.ts";
import type { Upload } from "../../lib/uploads.ts";
import { border, color, duration, easing, radius, size, space } from "../../styles/tokens.stylex.ts";
import { useCancel } from "../settings/jobs.ts";

const appear = stylex.keyframes({
  from: { opacity: 0, transform: `translateY(${space.s2})` },
  to: { opacity: 1, transform: "none" },
});

const styles = stylex.create({
  wrap: { padding: space.s5, overflowY: "auto", flex: 1, minHeight: 0 },
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  head: { display: "flex", alignItems: "flex-start", gap: space.s3 },
  grow: { flex: 1, minWidth: 0 },
  msg: { margin: 0, color: color.textMuted },
  toc: { display: "flex", flexDirection: "column", gap: space.s1, margin: 0, padding: 0, listStyle: "none" },
  sec: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s1,
    color: color.textMuted,
  },
  secNew: { animationName: appear, animationDuration: duration.slow, animationTimingFunction: easing.enter },
  secIndexed: { color: color.text },
  secNow: { color: color.accentText },
  indent: (n: number) => ({ paddingLeft: `calc(${size.iconMd} * ${n})` }),
  title: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  mark: { display: "inline-flex", width: size.iconSm, color: color.success },
  more: { color: color.textSubtle },
  figs: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(${size.controlLg}, ${size.row2}))`,
    gap: space.s2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  fig: {
    position: "relative",
    height: size.row2,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r2,
    overflow: "hidden",
    backgroundColor: color.surfaceSunken,
    opacity: 0.6,
  },
  figDone: { opacity: 1 },
  figLooking: { borderColor: color.claudeBorder, boxShadow: `0 0 0 ${border.width} ${color.claudeBorder}` },
  figImg: { width: "100%", height: "100%", objectFit: "cover" },
  figOk: {
    position: "absolute",
    right: space.s1,
    bottom: space.s1,
    display: "inline-flex",
    color: color.success,
    backgroundColor: color.surface,
    borderRadius: radius.full,
  },
  figMore: { display: "flex", alignItems: "center", justifyContent: "center", color: color.textMuted },
  lock: { display: "flex", alignItems: "center", gap: space.s2 },
  sr: {
    position: "absolute",
    width: border.width,
    height: border.width,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
});

type Step = "read" | "figures" | "index";

const STEPS: { key: Step; label: string }[] = [
  { key: "read", label: "Reading the file" },
  { key: "figures", label: "Claude describes the figures" },
  { key: "index", label: "Indexing" },
];
// ponytail: the core describes figures 20 at a time (FIGURES_BATCH); the next batch is the one Claude is looking at
const BATCH = 20;
const SECTIONS = 30;
const THUMBS = 18;

const stepOf = (u: Upload): Step =>
  u.phase === "indexing" ? "index" : /figure|re-checking/i.test(u.message) ? "figures" : "read";

// ponytail: while a document converts, what the job has written so far — its sections, its figures as Claude describes
// them, the index filling — read again at each step the job reports; the text opens once it is indexed; Cancel stops
// the job (the document stays as it was)
export function DocReading({ docId, upload }: { docId: string; upload: Upload }) {
  const client = useQueryClient();
  const cancel = useCancel();
  const step = stepOf(upload);
  const outline = useRead("docs.show", { id: docId, brief: true });
  const toc = outline.data?.toc ?? [];
  const known = toc.length > 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: read again at each step the job reports, not while it only indexes
  useEffect(() => {
    if (step === "index" && known) return;
    void invalidate(client, [["docs.show", { id: docId, brief: true }]]);
  }, [docId, upload.message, upload.phase, upload.pct]);

  const seen = useRef({ sections: 0, figures: 0 });
  const before = seen.current;
  const sections = toc.filter((t) => t.level <= 2);
  const shownSections = sections.slice(0, SECTIONS);
  const figures = (outline.data?.figures ?? []).filter((f) => f.file);
  const thumbs = figures.slice(0, THUMBS);
  useEffect(() => {
    seen.current = {
      sections: Math.max(seen.current.sections, shownSections.length),
      figures: Math.max(seen.current.figures, thumbs.length),
    };
  });

  const described = figures.filter((f) => f.description.trim()).length;
  const looking = new Set(
    step === "figures"
      ? figures
          .filter((f) => !f.description.trim())
          .slice(0, BATCH)
          .map((f) => f.anchor)
      : [],
  );
  const filled = step === "index" && upload.pct !== null ? Math.round((upload.pct / 100) * shownSections.length) : 0;
  const at = STEPS.findIndex((s) => s.key === step);
  const steps: TimelineItem[] = STEPS.map((s, i) => ({
    key: s.key,
    state: i < at ? "done" : i === at ? "running" : "waiting",
    title: s.label,
    note: s.key === "figures" && figures.length > 0 ? `${described}/${figures.length}` : undefined,
  }));

  return (
    <div {...stylex.props(styles.wrap)}>
      <section aria-label="Reading the document" aria-busy="true">
        <Card>
          <div {...stylex.props(styles.body)}>
            <div {...stylex.props(styles.head)}>
              <span {...stylex.props(styles.grow)}>
                <Timeline label="Steps" items={steps} compact />
              </span>
              {upload.jobId && (
                <Button
                  size="sm"
                  variant="quiet"
                  icon="stop"
                  label="Cancel"
                  onClick={() => cancel(upload.jobId as string)}
                />
              )}
            </div>
            <p role="status" {...stylex.props(type.small, styles.msg)}>
              {upload.message}
            </p>
            {known ? (
              <ol aria-label="Sections read" {...stylex.props(styles.toc)}>
                {shownSections.map((t, i) => {
                  const state = i < filled ? "indexed" : step === "index" && i === filled ? "now" : undefined;
                  return (
                    <li
                      key={t.anchor}
                      data-state={state}
                      data-new={i >= before.sections ? "" : undefined}
                      {...stylex.props(
                        type.compact,
                        styles.sec,
                        styles.indent(t.level - 1),
                        i >= before.sections && styles.secNew,
                        state === "indexed" && styles.secIndexed,
                        state === "now" && styles.secNow,
                      )}
                    >
                      <span {...stylex.props(styles.title)}>
                        {/^§\d+(\.\d+)*$/.test(t.anchor) ? `${t.anchor.slice(1)} ` : ""}
                        {t.title}
                      </span>
                      {state === "indexed" && (
                        <span {...stylex.props(styles.mark)}>
                          <Icon name="check" size="sm" />
                        </span>
                      )}
                    </li>
                  );
                })}
                {sections.length > SECTIONS && (
                  <li {...stylex.props(type.small, styles.more)}>and {sections.length - SECTIONS} more sections</li>
                )}
              </ol>
            ) : (
              <div data-testid="reading-scan">
                <Skeleton lines={6} />
              </div>
            )}
            {thumbs.length > 0 && (
              <ul aria-label="Figures" {...stylex.props(styles.figs)}>
                {thumbs.map((f, i) => {
                  const done = !!f.description.trim();
                  const on = looking.has(f.anchor);
                  return (
                    <li
                      key={f.anchor}
                      data-done={done ? "" : undefined}
                      data-looking={on ? "" : undefined}
                      title={f.caption || f.anchor}
                      {...stylex.props(
                        styles.fig,
                        i >= before.figures && styles.secNew,
                        done && styles.figDone,
                        on && styles.figLooking,
                      )}
                    >
                      <img
                        src={fileUrl(`docs/${docId}/${f.file}`)}
                        alt=""
                        loading="lazy"
                        {...stylex.props(styles.figImg)}
                      />
                      {done && (
                        <span {...stylex.props(styles.figOk)}>
                          <Icon name="check-circle" size="sm" />
                        </span>
                      )}
                      <span {...stylex.props(styles.sr)}>
                        {f.caption || f.anchor}: {done ? "described" : "not described yet"}
                      </span>
                    </li>
                  );
                })}
                {figures.length > THUMBS && (
                  <li {...stylex.props(styles.fig, type.small, styles.figMore)}>+{figures.length - THUMBS}</li>
                )}
              </ul>
            )}
            <p {...stylex.props(type.small, styles.msg, styles.lock)}>
              <Icon name="lock" size="sm" />
              The text and the figures open once the document is converted and indexed.
            </p>
          </div>
        </Card>
      </section>
    </div>
  );
}
