import { useState } from "react";
import type { Block, ColumnModes, Source, Step, StepImage, XrayJson } from "../../../core/types.ts";
import { Button, ClaudeBadge, Icon, IconButton, SourceChip } from "../../components/ui/index.ts";
import { hasRawEmbed, imageRef, leafBlocks } from "../../lib/blocks.ts";
import {
  type Column,
  collapsible,
  columnsOf,
  modeOf,
  projectModes as modesOf,
  openByDefault,
  splitTracks,
} from "../../lib/columns.ts";
import type { StepMark } from "../../lib/diff.ts";
import { cx } from "../../lib/format.ts";
import { tablesIn } from "../../lib/table.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { ColumnField } from "./ColumnField.tsx";
import { FieldBlocks, MOVE, type Moved } from "./FieldBlocks.tsx";
import { RequirementField } from "./RequirementField.tsx";
import { WasView } from "./WasView.tsx";

export type StepLayout = "stacked" | "split";

// ponytail: one blank line between blocks — a field is Xray text, and a marker glued to a sentence
// renders inside the paragraph; inside a table cell it is a single line break, or the table would end
const inTable = (text: string, at: number) => tablesIn(text).some((t) => at > t.at && at < t.end);
const gap = (text: string, at: number) => (inTable(text, at) ? "\n" : "\n\n");

export const put = (text: string, at: number, chunk: string) =>
  [text.slice(0, at).replace(/\s+$/, ""), chunk, text.slice(at).replace(/^\s+/, "")]
    .filter(Boolean)
    .join(gap(text, at));

export const cut = (text: string, at: number, end: number) =>
  [text.slice(0, at).replace(/\s+$/, ""), text.slice(end).replace(/^\s+/, "")].filter(Boolean).join(gap(text, at));

const firstLine = (s: string) =>
  s
    .replace(/!\[\]\([^)]*\)/g, "")
    .trim()
    .split("\n")[0] ?? "";

const setField = (s: Step, name: string, value: string): Step => {
  const fields = { ...s.fields };
  if (value) fields[name] = value;
  else delete fields[name];
  return { ...s, fields };
};

const embeds = (s: Step, file: string) =>
  Object.values(s.fields).some((t) => leafBlocks(t, s.images).some((x) => x.kind === "image" && x.image.file === file));

export function StepCard({
  index,
  count,
  step,
  xray,
  linked = true,
  layout,
  projectModes,
  testModes = null,
  claude,
  added,
  mark,
  before,
  folded,
  dragging,
  focused,
  readOnly,
  url,
  addImage,
  alive,
  onChange,
  onImageGone,
  onFold,
  onFocus,
  onMove,
  onInsert,
  onDelete,
  onAsk,
  onRestore,
  onOpenImage,
  onOpenSource,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  index: number;
  count: number;
  step: Step;
  xray: XrayJson;
  linked?: boolean;
  layout: StepLayout;
  projectModes?: ColumnModes;
  testModes?: ColumnModes | null;
  claude?: boolean;
  added?: boolean;
  mark?: StepMark;
  before?: Step;
  folded?: boolean;
  dragging?: boolean;
  // ponytail: the step last worked on keeps its ring while focus is elsewhere (the dock, a dialog), as in Xray Editor
  focused?: boolean;
  readOnly?: boolean;
  url: (file: string) => string;
  addImage?: (file: File) => Promise<StepImage>;
  alive?: () => () => boolean;
  onChange: (fn: (s: Step) => Step) => void;
  onImageGone?: (file: string) => void;
  onFold?: (folded: boolean) => void;
  onFocus?: () => void;
  onMove?: (dir: -1 | 1) => void;
  onInsert?: () => void;
  onDelete?: () => void;
  onAsk?: () => void;
  onRestore?: (before: Step) => void;
  onOpenImage?: (file: string, images: StepImage[]) => void;
  onOpenSource?: (s: Source) => void;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const [wasOpen, setWasOpen] = useState(false);
  const n = index + 1;
  const cols = columnsOf(xray, step, linked);
  const val = (name: string) => step.fields[name] ?? "";
  const unreadable = hasRawEmbed(step);
  const pModes = projectModes ?? modesOf(xray);
  const isOpen = (c: Column) => folds[c.name] ?? openByDefault(modeOf(c, pModes, testModes), val(c.name));
  const shown = cols.filter(isOpen);
  const token = () => alive?.() ?? (() => true);

  const embedded = new Set(
    cols.flatMap((c) =>
      leafBlocks(val(c.name), step.images).flatMap((b) => (b.kind === "image" ? [b.image.file] : [])),
    ),
  );
  const orphans = step.images.filter((im) => !embedded.has(im.file));

  const setText = (name: string, at: number, end: number, value: string) =>
    onChange((s) => {
      const cur = s.fields[name] ?? "";
      const next =
        at === end
          ? value.trim()
            ? put(cur, at, value)
            : cur
          : value
            ? cur.slice(0, at) + value + cur.slice(end)
            : cut(cur, at, end);
      return setField(s, name, next);
    });

  const addFiles = async (name: string, at: number, files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length || !addImage) return;
    try {
      const added: StepImage[] = [];
      for (const f of images) added.push(await addImage(f));
      onChange((s) => {
        const cur = s.fields[name] ?? "";
        const to = Math.min(at, cur.length);
        return setField(
          { ...s, images: [...s.images, ...added] },
          name,
          put(cur, to, added.map((im) => imageRef(im.file)).join(gap(cur, to))),
        );
      });
    } catch (e) {
      errorToast(e, "Could not save the screenshot");
    }
  };

  const dropBlock = (to: string, at: number, from: Moved) =>
    onChange((s) => {
      if (from.step !== n) return s;
      if (from.field === to && from.at !== undefined && from.end !== undefined && at >= from.at && at <= from.end)
        return s;
      const clampTo = (k: number, text: string) => Math.min(Math.max(k, 0), text.length);
      if (from.at === undefined || from.end === undefined || !from.field) {
        if (!from.file || !s.images.some((im) => im.file === from.file)) return s;
        const cur = s.fields[to] ?? "";
        return setField(s, to, put(cur, clampTo(at, cur), imageRef(from.file)));
      }
      const src = s.fields[from.field] ?? "";
      const chunk = src.slice(from.at, from.end);
      if (!chunk.trim()) return s;
      const left = cut(src, from.at, from.end);
      let next = setField(s, from.field, left);
      let pos = at;
      if (from.field === to && from.at < at) pos -= src.length - left.length;
      const dst = next.fields[to] ?? "";
      next = setField(next, to, put(dst, clampTo(pos, dst), chunk));
      return next;
    });

  // ponytail: an Undo puts back only what the ✕ took — that field, and the attachment when it went with
  // it — onto the step as it is now, and only on the test instance it was rendered for; a picture left
  // unattached is deleted once its Undo can no longer bring it back
  const undoable = (title: string, name: string, before: string, image?: StepImage) => {
    const ok = token();
    toast({
      kind: "info",
      title,
      detail: `${name} of step ${n}`,
      onExpire: image ? () => onImageGone?.(image.file) : undefined,
      action: {
        label: "Undo",
        run: () => {
          if (!ok()) {
            toast({ kind: "info", title: "Too late to undo", detail: "The test was reloaded since." });
            if (image) onImageGone?.(image.file);
            return;
          }
          onChange((s) => {
            const back = setField(s, name, before);
            return image && !back.images.some((x) => x.file === image.file)
              ? { ...back, images: [...back.images, image] }
              : back;
          });
        },
      },
    });
  };

  const removeBlock = (name: string, b: Block) => {
    const before = val(name);
    const text = cut(before, b.at, b.end);
    const after = setField(step, name, text);
    const gone = b.kind === "image" && !embeds(after, b.image.file) ? b.image : undefined;
    onChange((s) => {
      const next = setField(s, name, cut(s.fields[name] ?? "", b.at, b.end));
      return gone ? { ...next, images: next.images.filter((x) => x.file !== gone.file) } : next;
    });
    undoable(
      b.kind === "text" ? "Text removed" : b.kind === "table" ? "Table removed" : "Image removed",
      name,
      before,
      gone,
    );
  };

  const detach = (im: StepImage) => {
    const ok = token();
    onChange((s) => ({ ...s, images: s.images.filter((x) => x.file !== im.file) }));
    toast({
      kind: "info",
      title: "Attachment detached",
      detail: `${im.file.split("/").pop()} of step ${n}`,
      onExpire: () => onImageGone?.(im.file),
      action: {
        label: "Undo",
        run: () => {
          if (!ok()) {
            onImageGone?.(im.file);
            return;
          }
          onChange((s) => (s.images.some((x) => x.file === im.file) ? s : { ...s, images: [...s.images, im] }));
        },
      },
    });
  };

  const fieldOf = (c: Column) => {
    const value = val(c.name);
    if (c.kind === "requirements")
      return (
        <RequirementField
          label={c.name}
          value={value}
          stepNumber={n}
          readOnly={readOnly}
          onChange={(next) => onChange((s) => setField(s, c.name, next))}
        />
      );
    if (c.kind !== "blocks")
      return (
        <ColumnField
          column={c}
          value={value}
          stepNumber={n}
          readOnly={readOnly}
          onChange={(next) => onChange((s) => setField(s, c.name, next))}
        />
      );
    return (
      <FieldBlocks
        idBase={`s${index}-${c.name.replace(/\W+/g, "")}`}
        name={c.name}
        label={c.name}
        text={value}
        images={step.images}
        url={url}
        stepNumber={n}
        readOnly={readOnly}
        onText={(at, end, v) => setText(c.name, at, end, v)}
        onAddFiles={(at, files) => void addFiles(c.name, at, files)}
        onFieldText={(next) => onChange((s) => setField(s, c.name, next))}
        onDropBlock={(at, moved) => dropBlock(c.name, at, moved)}
        onRemove={(b) => removeBlock(c.name, b)}
        onOpen={(file) => onOpenImage?.(file, step.images)}
      />
    );
  };

  const row = (c: Column) => (
    <div
      key={c.name}
      className={cx("fl", `fl-${c.kind}`)}
      data-field={c.name}
      onPaste={(e) => {
        if (readOnly || c.kind !== "blocks" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
        const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return;
        e.preventDefault();
        void addFiles(c.name, val(c.name).length, files);
      }}
    >
      <span className="fl-k">
        {c.name}
        {!c.known && (
          <span className="fl-note" title="Kept in test.md, never pushed: the project has no such step field in Xray">
            not in Xray
          </span>
        )}
      </span>
      {fieldOf(c)}
    </div>
  );

  const head = (
    <span
      className="grip"
      title={`Drag step ${n} to reorder`}
      onMouseDown={() => setArmed(true)}
      onMouseUp={() => setArmed(false)}
    >
      <Icon name="grip" />
    </span>
  );

  const dnd = {
    draggable: armed && !readOnly,
    onDragStart: (e: React.DragEvent) => {
      if (e.target !== e.currentTarget) return;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `step ${n}`);
      onDragStart?.();
    },
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes(MOVE) || e.dataTransfer.types.includes("Files")) return;
      onDragOver?.(e);
    },
    onDrop: (e: React.DragEvent) => {
      setArmed(false);
      if (e.dataTransfer.types.includes(MOVE) || e.dataTransfer.types.includes("Files")) return;
      onDrop?.(e);
    },
    onDragEnd: () => {
      setArmed(false);
      onDragEnd?.();
    },
  };

  const state = cx(
    claude && "is-claude",
    mark === "modified" && "is-modified",
    mark === "new" && "is-new",
    unreadable && "is-unreadable",
  );

  const marks = (
    <>
      {claude && <ClaudeBadge added={added} small={folded} />}
      {mark === "modified" && <span className="mark mark-modified">modified</span>}
      {mark === "new" && <span className="mark mark-new">new</span>}
    </>
  );

  if (folded)
    return (
      <article
        className={cx("card step step-folded", dragging && "is-dragging", focused && "is-focused", state)}
        aria-label={`Step ${n}`}
        onFocusCapture={onFocus}
        {...dnd}
      >
        {head}
        <span className="num">{n}</span>
        {marks}
        <span className="step-line">
          {firstLine(val(cols[0]?.name ?? "Action")) || <span className="muted">Empty step</span>}
        </span>
        <IconButton icon="down" label={`Expand step ${n}`} onClick={() => onFold?.(false)} />
      </article>
    );

  return (
    <article
      className={cx("card step", dragging && "is-dragging", focused && "is-focused", state)}
      aria-label={`Step ${n}`}
      onFocusCapture={onFocus}
      onKeyDown={(e) => {
        if (readOnly) return;
        if (e.ctrlKey && e.key === "Enter") {
          e.preventDefault();
          onInsert?.();
        } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          onMove?.(e.key === "ArrowUp" ? -1 : 1);
        }
      }}
      {...dnd}
    >
      <div className="step-head">
        {head}
        <span className="num">{n}</span>
        {marks}
        {before && (
          <button
            type="button"
            className="was-toggle"
            aria-pressed={wasOpen}
            title="What Jira has for this step, as of the last sync"
            onClick={() => setWasOpen(!wasOpen)}
          >
            {wasOpen ? "hide Jira version" : "Jira version"}
          </button>
        )}
        {unreadable && (
          <span className="sev s-err" title="Xray markup this editor cannot read">
            <Icon name="warning" />
            Not fully read — never pushed
          </span>
        )}
        <div className="spacer" />
        <div className="step-folds">
          {cols.filter(collapsible).map((c) => {
            const open = isOpen(c);
            const filled = val(c.name).trim() !== "";
            return (
              <button
                key={c.name}
                type="button"
                className="fold-toggle"
                aria-pressed={open}
                aria-label={`${c.name} column of step ${n}`}
                title={!open && filled ? `This step has ${c.name}` : open ? `Fold ${c.name}` : `Show ${c.name}`}
                onClick={() => setFolds((f) => ({ ...f, [c.name]: !open }))}
              >
                {open || !filled ? c.name : `${c.name} ●`}
              </button>
            );
          })}
        </div>
        <div className="step-tools">
          {!readOnly && (
            <>
              {onAsk && (
                <Button
                  tone="quiet"
                  size="sm"
                  icon="claude"
                  className="step-ask"
                  title="Ask Claude about this step"
                  aria-label={`Ask Claude about step ${n}`}
                  onClick={onAsk}
                >
                  <span className="step-tool-word">Ask Claude</span>
                </Button>
              )}
              <Button
                tone="quiet"
                size="sm"
                icon="plus"
                className="step-insert"
                title="Insert below (Ctrl+Enter)"
                onClick={onInsert}
                aria-label={`Insert a step below step ${n}`}
              >
                <span className="step-tool-word">Insert below</span>
              </Button>
              <IconButton
                icon="up"
                label={`Move step ${n} up (Alt+↑)`}
                disabled={index === 0}
                onClick={() => onMove?.(-1)}
              />
              <IconButton
                icon="down"
                label={`Move step ${n} down (Alt+↓)`}
                disabled={index === count - 1}
                onClick={() => onMove?.(1)}
              />
              <Button
                tone="quiet"
                size="sm"
                icon="trash"
                title="Delete"
                aria-label={`Delete step ${n}`}
                onClick={onDelete}
              >
                <span className="step-tool-word">Delete</span>
              </Button>
            </>
          )}
          <IconButton icon="up" className="step-fold" label={`Fold step ${n}`} onClick={() => onFold?.(true)} />
        </div>
      </div>
      {wasOpen && before && (
        <WasView
          step={before}
          xray={xray}
          layout={layout}
          index={index}
          url={url}
          restoreLabel="Restore this step"
          onOpenImage={(file, images) => onOpenImage?.(file, images)}
          onRestore={readOnly || !onRestore ? undefined : () => onRestore(before)}
        />
      )}
      <div
        className={cx("step-body", layout === "split" && "is-split")}
        style={layout === "split" ? ({ "--tracks": splitTracks(shown) } as React.CSSProperties) : undefined}
      >
        {shown.map(row)}
      </div>
      {orphans.length > 0 && (
        <div className="orphans">
          <span className="label">
            {orphans.length} attachment{orphans.length > 1 ? "s" : ""} not embedded — drag into a field
          </span>
          {orphans.map((im) => (
            <span key={im.file} className="orphan-box">
              <img
                className="orphan"
                src={url(im.file)}
                alt={im.file.split("/").pop()}
                title={im.file.split("/").pop()}
                draggable={!readOnly}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(MOVE, JSON.stringify({ step: n, file: im.file }));
                }}
                onClick={() => onOpenImage?.(im.file, step.images)}
              />
              {!readOnly && (
                <button
                  type="button"
                  className="orphan-x"
                  aria-label={`Detach ${im.file.split("/").pop()} from step ${n}`}
                  title="Detach this attachment"
                  onClick={() => detach(im)}
                >
                  <Icon name="close" size={10} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {step.sources.length > 0 && (
        <div className="sources">
          <span className="label">Sources</span>
          {step.sources.map((s, i) => (
            <SourceChip key={i} source={s} onOpen={onOpenSource} />
          ))}
        </div>
      )}
    </article>
  );
}
