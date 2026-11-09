import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { type } from "../../components/ui/type.ts";
import { border, breakpoint, color, space } from "../../styles/tokens.stylex.ts";
import { RunDrop } from "./RunDrop.tsx";
import { RunShot } from "./RunShot.tsx";
import type { RunResult } from "./runs.ts";

const styles = stylex.create({
  panel: {
    boxSizing: "border-box",
    flex: "none",
    width: { default: "23.75rem", [breakpoint.sm]: "auto" },
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.surface,
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: border.width,
    borderInlineStartColor: color.border,
  },
  sized: (width: string) => ({ width: { default: width, [breakpoint.sm]: "auto" } }),
  body: { flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s5,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  head: { display: "flex", alignItems: "center", gap: space.s2, margin: 0 },
  gallery: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: space.s3 },
  foot: {
    flex: "none",
    paddingBlock: space.s4,
    paddingInline: space.s5,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
});

export function PanelSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section aria-label={title} {...stylex.props(styles.section)}>
      <h3 {...stylex.props(type.compact, type.strong, styles.head)}>
        {title}
        {count !== undefined && <Badge label={String(count)} count />}
      </h3>
      {children}
    </section>
  );
}

// ponytail: the screenshots of the whole test, each tagged with its step; a picture dropped here goes to the step
// being played
export function ShotsSection({
  result,
  step,
  shotUrl,
  onShot,
  onOpen,
  onRemove,
}: {
  result: RunResult;
  step: number;
  shotUrl: (file: string) => string;
  onShot: (files: File[]) => void;
  onOpen: (file: string) => void;
  onRemove: (file: string) => void;
}) {
  const shots = result.attachments;
  return (
    <PanelSection title="Screenshots" count={shots.length}>
      {shots.length > 0 && (
        <div {...stylex.props(styles.gallery)}>
          {shots.map((a) => (
            <RunShot
              key={a.file}
              fill
              file={a.file}
              url={shotUrl(a.file)}
              step={a.step}
              onOpen={() => onOpen(a.file)}
              onRemove={() => onRemove(a.file)}
            />
          ))}
        </div>
      )}
      <RunDrop
        label={shots.length ? "Drop more screenshots" : "Drop screenshots here"}
        hint={`They go to step ${step} · Ctrl+V pastes`}
        onFiles={onShot}
      />
    </PanelSection>
  );
}

// ponytail: the testing panel beside the test being run — its sections scroll, the result stays at the foot
export function RunPanel({
  label = "Testing",
  width,
  children,
  foot,
}: {
  label?: string;
  /** px, once the tester widened it (else the design's) */
  width?: number;
  children: ReactNode;
  foot: ReactNode;
}) {
  return (
    <aside aria-label={label} {...stylex.props(styles.panel, width !== undefined && styles.sized(`${width}px`))}>
      <div {...stylex.props(styles.body)}>{children}</div>
      <div {...stylex.props(styles.foot)}>{foot}</div>
    </aside>
  );
}
