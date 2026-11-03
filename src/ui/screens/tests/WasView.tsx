import { useState } from "react";
import type { Step, StepImage, XrayJson } from "../../../core/types.ts";
import { Button } from "../../components/ui/index.ts";
import { collapsible, columnsOf, splitTracks } from "../../lib/columns.ts";
import { cx } from "../../lib/format.ts";
import { ColumnField } from "./ColumnField.tsx";
import { FieldBlocks } from "./FieldBlocks.tsx";
import type { StepLayout } from "./StepCard.tsx";

const none = () => {};

// The snapshot of a step, drawn by the very same field blocks as the live card (same layout, same
// screenshots) — only read-only: no insert strips, no ⋮⋮, no ✕, and its images still open in the lightbox
export function WasView({
  step,
  xray,
  layout,
  index,
  url,
  restoreLabel,
  onOpenImage,
  onRestore,
}: {
  step: Step;
  xray: XrayJson;
  layout: StepLayout;
  index: number;
  url: (file: string) => string;
  restoreLabel: string;
  onOpenImage: (file: string, images: StepImage[]) => void;
  onRestore?: () => void;
}) {
  const shown = columnsOf(xray, step).filter((c) => !collapsible(c) || (step.fields[c.name] ?? "").trim());
  const n = index + 1;
  return (
    <section className="was" aria-label={`Step ${n} as Jira has it`}>
      <div className="was-head">
        <span className="was-label">In Jira, last synced</span>
        <span className="spacer" />
        {onRestore && (
          <Button size="sm" icon="revert" onClick={onRestore}>
            {restoreLabel}
          </Button>
        )}
      </div>
      <div
        className={cx("step-body", layout === "split" && "is-split")}
        style={layout === "split" ? ({ "--tracks": splitTracks(shown) } as React.CSSProperties) : undefined}
      >
        {shown.map((c) => {
          const value = step.fields[c.name] ?? "";
          return (
            <div key={c.name} className="fl" data-field={c.name}>
              <span className="fl-k">{c.name}</span>
              {c.kind === "blocks" ? (
                <FieldBlocks
                  readOnly
                  idBase={`was${index}-${c.name.replace(/\W+/g, "")}`}
                  name={c.name}
                  label={c.name}
                  text={value}
                  images={step.images}
                  url={url}
                  stepNumber={n}
                  onText={none}
                  onAddFiles={none}
                  onFieldText={none}
                  onDropBlock={none}
                  onRemove={none}
                  onOpen={(file) => onOpenImage(file, step.images)}
                />
              ) : (
                <ColumnField column={c} value={value} stepNumber={n} readOnly onChange={none} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// A step Jira still has and the local test no longer does: an unnumbered placeholder, kept only so the
// deletion is visible and its Jira version still readable, and inert everywhere else
export function GoneStep({
  step,
  xray,
  layout,
  url,
  onOpenImage,
  onRestore,
}: {
  step: Step;
  xray: XrayJson;
  layout: StepLayout;
  url: (file: string) => string;
  onOpenImage: (file: string, images: StepImage[]) => void;
  onRestore?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const first = (step.fields.Action ?? "")
    .replace(/!\[\]\([^)]*\)/g, "")
    .trim()
    .split("\n")[0];
  return (
    <section className="card step step-gone" aria-label="Deleted step">
      <div className="step-head">
        <span className="num num-gone" title="This step has no number any more">
          –
        </span>
        <span className="mark mark-gone">deleted</span>
        <span className="step-line muted">{first}</span>
        <button
          type="button"
          className="was-toggle"
          aria-pressed={open}
          title="What Jira still has for this step"
          onClick={() => setOpen(!open)}
        >
          {open ? "hide Jira version" : "Jira version"}
        </button>
      </div>
      {open && (
        <WasView
          step={step}
          xray={xray}
          layout={layout}
          index={-1}
          url={url}
          restoreLabel="Bring the step back"
          onOpenImage={onOpenImage}
          onRestore={onRestore}
        />
      )}
    </section>
  );
}
