import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { FigureEntry } from "../../../core/types.ts";
import { noteRun } from "../../components/claude/useClaudeStatus.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { useCommand } from "../../lib/data/query.ts";
import { useProjectJobs } from "../../lib/projectJobs.ts";
import { useShowMark } from "../../lib/scroll.ts";
import { errorToast, jobToast } from "../../lib/toast.ts";
import { importClaude } from "../../lib/uploads.ts";
import { color, container, size, space } from "../../styles/tokens.stylex.ts";
import { useClaudeOffline } from "./ConvertDoc.tsx";
import { DescribedBadge, FigureDetail, FigureImage, isDescribed, isPicture } from "./FigureDetail.tsx";

const styles = stylex.create({
  box: { flex: 1, minHeight: 0, overflowY: "auto", backgroundColor: color.surface, containerType: "size" },
  inner: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingTop: space.s5,
    paddingInline: space.s7,
    paddingBottom: space.s10,
    containerType: "inline-size",
  },
  bar: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s4, color: color.textMuted },
  grow: { flex: 1 },
  body: {
    display: "grid",
    gridTemplateColumns: {
      default: `minmax(0, 1fr) calc(${size.sidebar} + ${space.s9})`,
      [container.paneCompact]: "minmax(0, 1fr)",
    },
    gap: space.s7,
    alignItems: "start",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(calc(${size.sidebar} - ${space.s10}), 1fr))`,
    gap: space.s4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  side: {
    position: { default: "sticky", [container.paneCompact]: "static" },
    top: space.s5,
    maxHeight: { default: `calc(100cqb - ${space.s5} - ${space.s5})`, [container.paneCompact]: "none" },
    overflowY: "auto",
  },
  name: { minWidth: 0, color: color.textMuted, overflowWrap: "anywhere" },
  meta: { display: "flex", alignItems: "center", gap: space.s3, color: color.textMuted },
  id: { color: color.textSubtle },
});

type Which = "all" | "described" | "bare";

const EMPTY: Record<Which, { title: string; text: string }> = {
  all: { title: "No figure in this document", text: "The conversion found no picture in it." },
  described: {
    title: "No figure is described yet",
    text: "Claude reads each picture so that search finds what it shows: « Describe » asks for it.",
  },
  bare: {
    title: "Every figure is described",
    text: "Claude described each picture when the document was converted. « Describe again » on a figure asks for a new reading.",
  },
};

// ponytail: every figure in reading order — a tile picks it, the detail beside says what Claude read in it and opens it
// in the text; the figure a link picked (« Show in Figures ») is scrolled to; « Describe » has Claude read the pictures
// not described yet (docs.describeFigures, a job)
export function DocFigures({
  docId,
  figures,
  focus,
  onOpen,
}: {
  docId: string;
  figures: FigureEntry[];
  /** the figure shown picked (« Show in Figures » from the text: fig:12) */
  focus?: string;
  onOpen: (anchor: string) => void;
}) {
  const app = useApp();
  const client = useQueryClient();
  const offline = useClaudeOffline();
  const [which, setWhich] = useState<Which>("all");
  const [picked, setPicked] = useState<string | null>(focus ?? null);
  const [started, setStarted] = useState<string>();
  const describe = useCommand("docs.describeFigures", { invalidates: [["jobs.list"]] });
  const jobs = useProjectJobs([started]);
  const running = jobs.some((j) => j.kind === "describe-figures" && j.subject === docId && j.status === "running");
  const ended = jobs.find((j) => j.id === started && j.status !== "running");
  useEffect(() => {
    if (!ended) return;
    setStarted(undefined);
    const diagnosis = (ended.result as { diagnosis?: { kind: string } } | undefined)?.diagnosis;
    noteRun(client, { ok: ended.status === "done" && !diagnosis, diagnosis });
  }, [ended, client]);
  useEffect(() => {
    if (!focus) return;
    setWhich("all");
    setPicked(focus);
  }, [focus]);
  const described = figures.filter(isDescribed);
  const bare = figures.filter((f) => f.file && !isDescribed(f));
  const undescribed = figures.filter((f) => isPicture(f) && !isDescribed(f));
  const shown = which === "all" ? figures : which === "described" ? described : undescribed;
  const current = shown.find((f) => f.anchor === picked) ?? shown[0];
  const grid = useRef<HTMLUListElement>(null);
  useShowMark(grid, focus && current?.anchor === focus ? focus : "", "[data-picked]");

  const ask = (anchors?: string[]) =>
    describe.mutate(
      { docId, force: false, ...(anchors && { anchors }), ...importClaude() },
      {
        onSuccess: (out) => {
          const jobId = (out as { jobId?: string }).jobId;
          setStarted(jobId);
          jobToast(
            anchors ? "Claude reads the figure again" : `Claude describes ${bare.length} figures`,
            jobId,
            app.navigate,
            "It runs in Jobs; the descriptions appear here as they are written.",
          );
        },
        onError: (e) => errorToast(e, "Could not ask Claude to describe the figures"),
      },
    );
  const busy = running || describe.isPending;

  return (
    <div data-testid="doc-figures" {...stylex.props(styles.box)}>
      <div {...stylex.props(styles.inner)}>
        <div {...stylex.props(type.small, styles.bar)}>
          <Segmented
            label="Which figures"
            size="sm"
            value={which}
            onChange={setWhich}
            options={[
              { value: "all", label: "All", count: figures.length },
              { value: "described", label: "Described", count: described.length },
              { value: "bare", label: "Not described", count: undescribed.length },
            ]}
          />
          <span>In reading order · open one to see it in the text</span>
          <span {...stylex.props(styles.grow)} />
          {bare.length > 0 && (
            <Button
              size="sm"
              variant="claude-quiet"
              icon="claude"
              label={
                running ? "Claude is describing…" : `Describe ${bare.length} figure${bare.length === 1 ? "" : "s"}`
              }
              loading={busy}
              disabled={offline}
              onClick={() => ask()}
            />
          )}
        </div>
        {current ? (
          <div {...stylex.props(styles.body)}>
            <ul ref={grid} aria-label="Figures" {...stylex.props(styles.grid)}>
              {shown.map((f) => {
                const on = f.anchor === current.anchor;
                return (
                  <li key={f.anchor} data-picked={on || undefined}>
                    <Card
                      density="tight"
                      selected={on}
                      label={f.caption || f.anchor}
                      onOpen={() => setPicked(f.anchor)}
                    >
                      <FigureImage docId={docId} figure={f} />
                      <span {...stylex.props(type.small, styles.name)}>{f.caption || f.anchor}</span>
                      <span {...stylex.props(type.small, styles.meta)}>
                        <span {...stylex.props(type.code, styles.id)}>{f.anchor}</span>
                        {f.kind && <span>{f.kind}</span>}
                        <span {...stylex.props(styles.grow)} />
                        <DescribedBadge figure={f} />
                      </span>
                    </Card>
                  </li>
                );
              })}
            </ul>
            <div {...stylex.props(styles.side)}>
              <FigureDetail
                docId={docId}
                figure={current}
                busy={busy}
                offline={offline}
                onOpen={onOpen}
                onDescribe={() => ask([current.anchor])}
              />
            </div>
          </div>
        ) : (
          <EmptyState
            icon={which === "bare" ? "check-circle" : "image"}
            title={EMPTY[which].title}
            text={EMPTY[which].text}
          />
        )}
      </div>
    </div>
  );
}
