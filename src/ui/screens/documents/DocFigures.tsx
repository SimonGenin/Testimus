import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { FigureEntry } from "../../../core/types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { useCommand } from "../../lib/data/query.ts";
import { useProjectJobs } from "../../lib/projectJobs.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { importClaude } from "../../lib/uploads.ts";
import {
  border,
  color,
  container,
  fontFamily,
  fontSize,
  lineHeight,
  radius,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { DescribedBadge, FigureDetail, FigureImage, isDescribed } from "./FigureDetail.tsx";

const styles = stylex.create({
  box: { flex: 1, minHeight: 0, overflowY: "auto", backgroundColor: color.surface },
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
  bar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s4,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
  },
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
  tile: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s3,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: { default: color.surface, ":hover": color.surfaceHover },
    minWidth: 0,
    overflow: "hidden",
  },
  picked: { borderColor: color.accent, boxShadow: `0 0 0 ${border.width} ${color.accent}` },
  name: { display: "flex", minWidth: 0 },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
  },
  id: { fontFamily: fontFamily.mono, fontSize: fontSize.code, color: color.textSubtle },
});

type Which = "all" | "described" | "bare";

const EMPTY: Record<Which, { title: string; text: string }> = {
  all: { title: "No figure in this document", text: "The conversion found no picture in it." },
  described: {
    title: "No figure is described yet",
    text: "Claude reads each picture so that search finds what it shows: « Describe » asks for it.",
  },
  bare: {
    title: "Every figure is described",
    text: "Claude described each picture when the document was converted. « Describe again » on a figure asks for a new reading.",
  },
};

// ponytail: every figure in reading order — a tile picks it, the detail beside says what Claude read in it and opens it
// in the text; « Describe » has Claude read the pictures not described yet (docs.describeFigures, a job)
export function DocFigures({
  docId,
  figures,
  onOpen,
}: {
  docId: string;
  figures: FigureEntry[];
  onOpen: (anchor: string) => void;
}) {
  const [which, setWhich] = useState<Which>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [started, setStarted] = useState<string>();
  const describe = useCommand("docs.describeFigures", { invalidates: [["jobs.list"]] });
  const jobs = useProjectJobs([started]);
  const running = jobs.some((j) => j.kind === "describe-figures" && j.subject === docId && j.status === "running");
  const described = figures.filter(isDescribed);
  const bare = figures.filter((f) => f.file && !isDescribed(f));
  const shown = which === "all" ? figures : which === "described" ? described : figures.filter((f) => !isDescribed(f));
  const current = shown.find((f) => f.anchor === picked) ?? shown[0];

  const ask = (anchors?: string[]) =>
    describe.mutate(
      { docId, force: false, ...(anchors && { anchors }), ...importClaude() },
      {
        onSuccess: (out) => {
          const jobId = (out as { jobId?: string }).jobId;
          setStarted(jobId);
          toast({
            kind: "info",
            title: anchors ? "Claude reads the figure again" : `Claude describes ${bare.length} figures`,
            detail: "It runs in Jobs; the descriptions appear here as they are written.",
          });
        },
        onError: (e) => errorToast(e, "Could not ask Claude to describe the figures"),
      },
    );
  const busy = running || describe.isPending;

  return (
    <div {...stylex.props(styles.box)}>
      <div {...stylex.props(styles.inner)}>
        <div {...stylex.props(styles.bar)}>
          <Segmented
            label="Which figures"
            size="sm"
            value={which}
            onChange={setWhich}
            options={[
              { value: "all", label: "All", count: figures.length },
              { value: "described", label: "Described", count: described.length },
              { value: "bare", label: "Not described", count: figures.length - described.length },
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
              onClick={() => ask()}
            />
          )}
        </div>
        {current ? (
          <div {...stylex.props(styles.body)}>
            <ul aria-label="Figures" {...stylex.props(styles.grid)}>
              {shown.map((f) => {
                const on = f.anchor === current.anchor;
                return (
                  <li key={f.anchor} data-picked={on || undefined} {...stylex.props(styles.tile, on && styles.picked)}>
                    <FigureImage docId={docId} figure={f} />
                    <span {...stylex.props(styles.name)}>
                      <Button
                        size="sm"
                        variant="quiet"
                        label={f.caption || f.anchor}
                        pressed={on}
                        onClick={() => setPicked(f.anchor)}
                      />
                    </span>
                    <span {...stylex.props(styles.meta)}>
                      <span {...stylex.props(styles.id)}>{f.anchor}</span>
                      {f.kind && <span>{f.kind}</span>}
                      <span {...stylex.props(styles.grow)} />
                      <DescribedBadge figure={f} />
                    </span>
                  </li>
                );
              })}
            </ul>
            <FigureDetail
              docId={docId}
              figure={current}
              busy={busy}
              onOpen={onOpen}
              onDescribe={() => ask([current.anchor])}
            />
          </div>
        ) : (
          <EmptyState
            compact
            icon={which === "bare" ? "check-circle" : "image"}
            title={EMPTY[which].title}
            text={EMPTY[which].text}
          />
        )}
      </div>
    </div>
  );
}
