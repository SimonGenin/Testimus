import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { Block, StepImage } from "../../../core/types.ts";
import { GrowArea, Icon } from "../../components/ui/index.ts";
import { blocksOf } from "../../lib/blocks.ts";
import { cx } from "../../lib/format.ts";
import { NEW_TABLE } from "../../lib/table.ts";
import { TableBlock } from "./TableBlock.tsx";

// ponytail: one payload for both drags a field accepts — a block of this step being moved (named by the
// slice of text it is, because the same ref may appear more than once), and an attachment no field embeds
export const MOVE = "application/x-testimus-block";

export type Moved = { step: number; file?: string; field?: string; at?: number; end?: number };

type Item = Block & { draft?: true };

const takes = (e: React.DragEvent) => ["Files", MOVE].some((t) => e.dataTransfer.types.includes(t));
const nameOf = (params: string, url: string) => /alt="([^"]*)"/.exec(params)?.[1] || url;
const dead = (url: string) => url.startsWith("blob:");
const base = (file: string) => file.split("/").pop() ?? file;

export function FieldBlocks({
  idBase,
  name,
  label,
  text,
  images,
  url,
  stepNumber,
  readOnly,
  nested,
  onText,
  onAddFiles,
  onFieldText,
  onDropBlock,
  onRemove,
  onOpen,
}: {
  idBase: string;
  name: string;
  label: string;
  text: string;
  images: StepImage[];
  url: (file: string) => string;
  stepNumber: number;
  readOnly?: boolean;
  nested?: boolean;
  onText: (at: number, end: number, value: string) => void;
  onAddFiles: (at: number, files: File[]) => void;
  onFieldText: (next: string) => void;
  onDropBlock: (at: number, moved: Moved) => void;
  onRemove: (block: Block) => void;
  onOpen: (file: string) => void;
}) {
  const [over, setOver] = useState<number | null>(null);
  // ponytail: the draft caret is a view, not an edit — nothing empty is ever written to the file; it is
  // remembered with the text it was opened on and simply gone once that text changed
  const [draft, setDraft] = useState<{ at: number; text: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const putAt = useRef(0);
  const focusDraft = useRef(false);

  const items: Item[] = blocksOf(text, images);
  // ponytail: an empty field is its insert strip alone — no empty text block is ever created
  if (!readOnly && draft && draft.text === text) {
    const at = draft.at;
    const i = items.findIndex((b) => b.at >= at);
    items.splice(i < 0 ? items.length : i, 0, { kind: "text", text: "", at, end: at, draft: true });
  }
  const id = (i: number) => `${idBase}-${i}`;

  useLayoutEffect(() => {
    if (!focusDraft.current) return;
    focusDraft.current = false;
    const i = items.findIndex((b) => b.draft);
    if (i >= 0) document.getElementById(id(i))?.focus();
  });

  const handle = () => (
    <span className="blk-handle" title="Drag to move" draggable>
      <Icon name="grip" size={14} />
    </span>
  );

  const insert = (at: number, k: number) =>
    readOnly ? null : (
      <div
        className={cx("blk-insert", over === k && "is-over")}
        onDragOver={(e) => {
          if (!takes(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(k);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setOver((o) => (o === k ? null : o));
        }}
        onDrop={(e) => {
          if (!takes(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(null);
          const moved = e.dataTransfer.getData(MOVE);
          if (moved) onDropBlock(at, JSON.parse(moved) as Moved);
          else onAddFiles(at, Array.from(e.dataTransfer.files));
        }}
      >
        <span className="blk-insert-btns" onMouseDown={(e) => e.preventDefault()}>
          <button
            type="button"
            onClick={() => {
              focusDraft.current = true;
              setDraft({ at, text });
            }}
          >
            + text
          </button>
          <button
            type="button"
            onClick={() => {
              putAt.current = at;
              picker.current?.click();
            }}
          >
            + image
          </button>
          {!nested && (
            <button type="button" onClick={() => onText(at, at, NEW_TABLE)}>
              + table
            </button>
          )}
        </span>
      </div>
    );

  return (
    <div
      className={cx("blocks", !items.length && "is-empty")}
      onDragOver={(e) => !readOnly && takes(e) && e.preventDefault()}
      onDrop={(e) => {
        if (readOnly || !takes(e)) return;
        e.preventDefault();
        const moved = e.dataTransfer.getData(MOVE);
        if (moved) onDropBlock(text.length, JSON.parse(moved) as Moved);
        else onAddFiles(text.length, Array.from(e.dataTransfer.files));
      }}
    >
      {insert(0, -1)}
      {items.map((b, i) => (
        <Fragment key={i}>
          <div
            className="blk-row"
            onDragStart={(e) => {
              if (readOnly || b.draft) return;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData(MOVE, JSON.stringify({ step: stepNumber, field: name, at: b.at, end: b.end }));
            }}
          >
            {b.kind === "text" && (
              <>
                <GrowArea
                  id={id(i)}
                  className="edit"
                  aria-label={`${label} of step ${stepNumber}`}
                  value={b.text}
                  readOnly={readOnly}
                  onChange={(e) => onText(b.at, b.end, e.target.value)}
                  onBlur={() => b.draft && setDraft(null)}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
                    if (!files.length) return;
                    e.preventDefault();
                    onAddFiles(b.at + (e.currentTarget.selectionStart ?? b.text.length), files);
                  }}
                />
                {!readOnly && !b.draft && (
                  <span className="blk-tools">
                    {handle()}
                    <button
                      type="button"
                      className="blk-x"
                      aria-label={`Delete this text of ${label} of step ${stepNumber}`}
                      title="Delete this text"
                      onClick={() => onRemove(b)}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                )}
              </>
            )}
            {b.kind === "image" && (
              <figure className="imgblock">
                <button type="button" className="imgblock-open" onClick={() => onOpen(b.image.file)}>
                  <img className="imgblock-img" draggable={false} src={url(b.image.file)} alt={base(b.image.file)} />
                </button>
                <figcaption className="imgblock-meta">
                  {!readOnly && handle()}
                  <span className="imgblock-name mono">{base(b.image.file)}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="blk-x"
                      aria-label={`Remove ${base(b.image.file)} from ${label} of step ${stepNumber}`}
                      onClick={() => onRemove(b)}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  )}
                </figcaption>
              </figure>
            )}
            {b.kind === "extern" && (
              <figure className="imgblock is-extern">
                {!dead(b.url) && (
                  <img className="imgblock-img" draggable={false} src={b.url} alt={nameOf(b.params, b.url)} />
                )}
                <figcaption className="imgblock-meta" title={b.url}>
                  {!readOnly && handle()}
                  <Icon name="external" size={12} />
                  <span className="imgblock-name">
                    {nameOf(b.params, b.url) + (dead(b.url) ? " — Jira no longer holds this image" : "")}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="blk-x"
                      aria-label={`Remove ${nameOf(b.params, b.url)} from ${label} of step ${stepNumber}`}
                      onClick={() => onRemove(b)}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  )}
                </figcaption>
              </figure>
            )}
            {b.kind === "table" && (
              <>
                <TableBlock
                  table={b}
                  text={text}
                  images={images}
                  url={url}
                  idBase={idBase}
                  name={name}
                  label={label}
                  stepNumber={stepNumber}
                  readOnly={readOnly}
                  onText={onText}
                  onAddFiles={onAddFiles}
                  onFieldText={onFieldText}
                  onDropBlock={onDropBlock}
                  onRemove={onRemove}
                  onOpen={onOpen}
                />
                {!readOnly && (
                  <span className="blk-tools">
                    {handle()}
                    <button
                      type="button"
                      className="blk-x"
                      aria-label={`Delete this table of ${label} of step ${stepNumber}`}
                      title="Delete this table"
                      onClick={() => onRemove(b)}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                )}
              </>
            )}
            {b.kind === "raw" && (
              <>
                <details className="rawblock">
                  <summary>Xray markup this editor cannot read</summary>
                  <pre>{b.text}</pre>
                </details>
                {!readOnly && <span className="blk-tools">{handle()}</span>}
              </>
            )}
          </div>
          {insert(b.draft ? b.at : b.end, i)}
        </Fragment>
      ))}
      {!readOnly && (
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label={`Add ${label} screenshots to step ${stepNumber}`}
          onChange={(e) => {
            onAddFiles(putAt.current, Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      )}
    </div>
  );
}
