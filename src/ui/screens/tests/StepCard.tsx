import { useRef, useState } from "react";
import type { Block, Source, Step, StepImage, XrayJson } from "../../../core/types.ts";
import { Button, ClaudeBadge, Icon, IconButton, SourceChip } from "../../components/ui/index.ts";
import { hasRawEmbed, imageRef, leafBlocks } from "../../lib/blocks.ts";
import { fieldViews } from "../../lib/fields.ts";
import { cx } from "../../lib/format.ts";
import { tablesIn } from "../../lib/table.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { FieldBlocks, MOVE, type Moved } from "./FieldBlocks.tsx";
import { RequirementField } from "./RequirementField.tsx";

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

const SPLIT = ["Action", "Expected Result"];
const firstLine = (s: string) =>
  s
    .replace(/!\[\]\([^)]*\)/g, "")
    .trim()
    .split("\n")[0] ?? "";

export function StepCard({
  index,
  count,
  step,
  xray,
  layout,
  claude,
  added,
  folded,
  dragging,
  readOnly,
  url,
  addImage,
  onChange,
  onFold,
  onFocus,
  onMove,
  onInsert,
  onDelete,
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
  layout: StepLayout;
  claude?: boolean;
  added?: boolean;
  folded?: boolean;
  dragging?: boolean;
  readOnly?: boolean;
  url: (file: string) => string;
  addImage?: (file: File) => Promise<StepImage>;
  onChange: (fn: (s: Step) => Step) => void;
  onFold?: (folded: boolean) => void;
  onFocus?: () => void;
  onMove?: (dir: -1 | 1) => void;
  onInsert?: () => void;
  onDelete?: () => void;
  onOpenImage?: (file: string) => void;
  onOpenSource?: (s: Source) => void;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const picker = useRef<HTMLInputElement>(null);
  const n = index + 1;
  const views = fieldViews(xray, step);
  const val = (name: string) => step.fields[name] ?? "";
  const unreadable = hasRawEmbed(step);
  const target = views.find((v) => v.name === "Expected Result")?.name ?? views[0]?.name ?? "Action";

  const embedded = new Set(
    views.flatMap((v) =>
      leafBlocks(val(v.name), step.images).flatMap((b) => (b.kind === "image" ? [b.image.file] : [])),
    ),
  );
  const orphans = step.images.filter((im) => !embedded.has(im.file));

  const setField = (s: Step, name: string, value: string): Step => {
    const fields = { ...s.fields };
    if (value) fields[name] = value;
    else delete fields[name];
    return { ...s, fields };
  };

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
    if (!images.length) return;
    if (!addImage) return;
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

  const removeBlock = (name: string, b: Block) => {
    const before = step;
    onChange((s) => {
      const text = cut(s.fields[name] ?? "", b.at, b.end);
      let next = setField(s, name, text);
      if (b.kind === "image") {
        const still = Object.values(next.fields).some((t) =>
          leafBlocks(t, next.images).some((x) => x.kind === "image" && x.image.file === b.image.file),
        );
        if (!still) next = { ...next, images: next.images.filter((x) => x.file !== b.image.file) };
      }
      return next;
    });
    toast({
      kind: "info",
      title: b.kind === "text" ? "Text removed" : b.kind === "table" ? "Table removed" : "Image removed",
      detail: `${name} of step ${n}`,
      action: { label: "Undo", run: () => onChange(() => before) },
    });
  };

  const field = (name: string) => (
    <FieldBlocks
      idBase={`s${index}-${name.replace(/\W+/g, "")}`}
      name={name}
      label={name}
      text={val(name)}
      images={step.images}
      url={url}
      stepNumber={n}
      readOnly={readOnly}
      onText={(at, end, value) => setText(name, at, end, value)}
      onAddFiles={(at, files) => void addFiles(name, at, files)}
      onFieldText={(next) => onChange((s) => setField(s, name, next))}
      onDropBlock={(at, moved) => dropBlock(name, at, moved)}
      onRemove={(b) => removeBlock(name, b)}
      onOpen={(file) => onOpenImage?.(file)}
    />
  );

  const row = (v: (typeof views)[number]) => {
    const value = val(v.name);
    const shut = v.collapsed && !opened.has(v.name);
    return (
      <div key={v.name} className="fl" data-field={v.name}>
        <span className="fl-k">{v.name}</span>
        {shut ? (
          <button
            type="button"
            className="btn btn-quiet btn-sm fl-folded"
            aria-label={`Show ${v.name} of step ${n}`}
            onClick={() => setOpened(new Set([...opened, v.name]))}
          >
            <Icon name="right" />
            {value.trim() ? `Folded · ${firstLine(value).slice(0, 60)}` : "Folded · empty"}
          </button>
        ) : v.requirements ? (
          <RequirementField
            label={v.name}
            value={value}
            stepNumber={n}
            readOnly={readOnly}
            onChange={(next) => onChange((s) => setField(s, v.name, next))}
          />
        ) : (
          field(v.name)
        )}
      </div>
    );
  };

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

  if (folded)
    return (
      <article
        className={cx("card step step-folded", dragging && "is-dragging", claude && "is-claude")}
        aria-label={`Step ${n}`}
        onFocusCapture={onFocus}
        {...dnd}
      >
        {head}
        <span className="num">{n}</span>
        {claude && <ClaudeBadge added={added} small />}
        <span className="step-line">
          {firstLine(val(views[0]?.name ?? "Action")) || <span className="muted">Empty step</span>}
        </span>
        <IconButton icon="down" label={`Expand step ${n}`} onClick={() => onFold?.(false)} />
      </article>
    );

  const mainViews = layout === "split" ? views.filter((v) => SPLIT.includes(v.name)) : [];
  const restViews = layout === "split" ? views.filter((v) => !SPLIT.includes(v.name)) : views;

  return (
    <article
      className={cx("card step", dragging && "is-dragging", claude && "is-claude", unreadable && "is-unreadable")}
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
        {claude && <ClaudeBadge added={added} />}
        {unreadable && (
          <span className="sev s-warn" title="Xray markup this editor cannot read">
            <Icon name="warning" />
            Not fully read — never pushed
          </span>
        )}
        <div className="spacer" />
        <div className="step-tools">
          {!readOnly && (
            <>
              <Button
                tone="quiet"
                size="sm"
                icon="image"
                className="step-shot"
                title="Add screenshot"
                aria-label={`Add a screenshot to step ${n}`}
                onClick={() => picker.current?.click()}
              >
                <span className="step-tool-word">Add screenshot</span>
              </Button>
              <Button
                tone="quiet"
                size="sm"
                icon="plus"
                className="step-insert"
                title="Insert below"
                onClick={onInsert}
                aria-label={`Insert a step below step ${n}`}
              >
                <span className="step-tool-word">Insert below</span>
              </Button>
              <IconButton icon="up" label={`Move step ${n} up`} disabled={index === 0} onClick={() => onMove?.(-1)} />
              <IconButton
                icon="down"
                label={`Move step ${n} down`}
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
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label={`Add screenshots to step ${n}`}
          onChange={(e) => {
            void addFiles(target, val(target).length, Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {mainViews.length > 0 && <div className="step-split">{mainViews.map(row)}</div>}
      {restViews.map(row)}
      {orphans.length > 0 && (
        <div className="orphans">
          <span className="label">
            {orphans.length} attachment{orphans.length > 1 ? "s" : ""} not embedded — drag into a field
          </span>
          {orphans.map((im) => (
            <img
              key={im.file}
              className="orphan"
              src={url(im.file)}
              alt={im.file.split("/").pop()}
              title={im.file.split("/").pop()}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(MOVE, JSON.stringify({ step: n, file: im.file }));
              }}
              onClick={() => onOpenImage?.(im.file)}
            />
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
