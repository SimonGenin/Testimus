import * as stylex from "@stylexjs/stylex";
import { useContext, useState } from "react";
import type { CheckFile, GenTestProgress, Source, StepImage, Test } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { SourceChip } from "../../components/ui/SourceChip.tsx";
import { type } from "../../components/ui/type.ts";
import { AppContext, useApp } from "../../lib/app.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { sourceLabel } from "../../lib/fields.ts";
import { plural } from "../../lib/format.ts";
import { testLabel } from "../../lib/labels.ts";
import { isObserved } from "../../lib/media.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Lightbox } from "../tests/Lightbox.tsx";
import { StepRead } from "../tests/step/StepRead.tsx";

const styles = stylex.create({
  titles: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  waiting: { color: color.textMuted },
  meta: { color: color.textSubtle },
  badges: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  step: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  caption: { margin: 0, color: color.textMuted },
  sources: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, minWidth: 0 },
});

const STATE: Record<GenTestProgress["state"], { label: string; tone: "success" | "claude" | "neutral" }> = {
  written: { label: "Written", tone: "success" },
  writing: { label: "Writing", tone: "claude" },
  waiting: { label: "Waiting", tone: "neutral" },
  missed: { label: "Not written", tone: "neutral" },
};

function sourcesOf(test: Test): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of test.steps.flatMap((x) => x.sources)) {
    const k = `${s.docId}#${s.anchor} ${s.quote}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

function Findings({ check }: { check: CheckFile | null | undefined }) {
  const n = (s: string) => check?.findings.filter((f) => f.severity === s).length ?? 0;
  if (n("error")) return <Badge tone="danger" icon="x-circle" size="sm" label={plural(n("error"), "error")} />;
  if (n("warning"))
    return <Badge tone="warning" icon="alert-triangle" size="sm" label={plural(n("warning"), "warning")} />;
  return null;
}

// ponytail: a test of the running generation, read only — what Claude saved so far, read again each time test.md
// changes (tests.show, invalidated by the watcher); editing lives in Tests and Review
export function WritingCard({
  entry,
  open,
  onOpenChange,
}: {
  entry: GenTestProgress;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const app = useApp();
  const openSource = useContext(AppContext)?.openSource;
  const id = entry.id ?? "";
  const shown = useRead("tests.show", { id }, { enabled: !!id });
  const data = shown.data as { test?: Test; check?: CheckFile | null } | undefined;
  const test = id ? data?.test : undefined;
  const [lb, setLb] = useState<{ images: StepImage[]; index: number; step: number } | null>(null);
  const writing = entry.state === "writing";
  const sources = test ? sourcesOf(test) : [];
  const steps = test?.steps.length ?? 0;
  const title = test ? testLabel(test) : (entry.summary ?? (writing ? "A new test" : "Untitled test"));
  const meta =
    entry.state === "waiting"
      ? "Planned"
      : entry.state === "missed"
        ? "Its run wrote no test"
        : test
          ? [
              `${plural(steps, "step")}${writing ? " so far" : ""}`,
              plural(sources.length, "source"),
              ...(!writing && test.folder ? [test.folder] : []),
            ].join(" · ")
          : "Claude is starting it";
  const state = STATE[entry.state];
  return (
    <>
      <Card
        density="compact"
        edge={writing ? "claude" : undefined}
        fold={{ open, onOpenChange }}
        title={
          <span {...stylex.props(styles.titles)}>
            <span {...stylex.props(entry.state === "waiting" && styles.waiting)}>{title}</span>
            <span {...stylex.props(type.small, type.regular, styles.meta)}>{meta}</span>
          </span>
        }
        actions={
          <span {...stylex.props(styles.badges)}>
            <Badge tone={state.tone} busy={writing} size="sm" label={state.label} />
            {!writing && <Findings check={data?.check} />}
          </span>
        }
      >
        {test?.steps.map((s, i) => (
          <Card key={s.id ?? i} sunken density="compact">
            <div {...stylex.props(styles.step)}>
              <p {...stylex.props(type.caption, styles.caption)}>Step {i + 1}</p>
              <StepRead
                idBase={`writing-${id}-${i}`}
                step={s}
                xray={app.xray}
                split={false}
                narrow
                n={i + 1}
                url={(file) => fileUrl(`tests/${id}/${file}`)}
                onOpenImage={(file, images) =>
                  setLb({
                    images,
                    index: Math.max(
                      0,
                      images.findIndex((im) => im.file === file),
                    ),
                    step: i + 1,
                  })
                }
              />
            </div>
          </Card>
        ))}
        {(writing || (!test && !!id)) && <Skeleton lines={2} />}
        {!id && entry.state !== "missed" && (
          <p {...stylex.props(type.small, styles.caption)}>
            {entry.state === "waiting" ? "Not started yet." : "Claude is reading first."}
          </p>
        )}
        {sources.length > 0 && (
          <span {...stylex.props(styles.sources)}>
            <span {...stylex.props(type.caption, styles.caption)}>Sources</span>
            {sources.map((s) => (
              <SourceChip
                key={`${s.docId}#${s.anchor} ${s.quote}`}
                reference={sourceLabel(s)}
                quote={s.quote || undefined}
                figure={s.anchor.startsWith("fig:")}
                observed={isObserved(s.anchor)}
                onOpen={openSource && (() => openSource(s))}
              />
            ))}
          </span>
        )}
      </Card>
      {lb && (
        <Lightbox
          names={lb.images.map((im) => im.file.split("/").pop() ?? im.file)}
          urls={lb.images.map((im) => fileUrl(`tests/${id}/${im.file}`))}
          index={lb.index}
          step={lb.step}
          onIndex={(index) => setLb({ ...lb, index })}
          onClose={() => setLb(null)}
        />
      )}
    </>
  );
}
