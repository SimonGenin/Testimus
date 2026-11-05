import * as stylex from "@stylexjs/stylex";
import type { Block, Source, StepImage } from "../../../../core/types.ts";
import type { Cell } from "../../../../shared/table.ts";
import { Disclosure } from "../../../components/ui/Disclosure.tsx";
import { Raw } from "../../../components/ui/Raw.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { blocksOf } from "../../../lib/blocks.ts";
import { space } from "../../../styles/tokens.stylex.ts";
import { ExternBlock, ImageBlock } from "./ImageBlock.tsx";
import { MOVE, type Moved } from "./moved.ts";
import { StepSource } from "./StepSource.tsx";
import { fileName } from "./stepText.ts";

const styles = stylex.create({
  cell: { display: "flex", flexDirection: "column", minWidth: 0 },
  picture: { paddingInline: space.s3, paddingBlock: space.s2 },
});

const takes = (e: React.DragEvent) => ["Files", MOVE].some((t) => e.dataTransfer.types.includes(t));
const figureSource = (figure: string) => {
  const at = figure.indexOf("#");
  return { docId: figure.slice(0, at), anchor: figure.slice(at + 1), quote: "" };
};

// ponytail: the one space Xray puts on each side of a cell's text (« | Fermé | ») is the cell's, not the text's — the
// field shows the text between them and writes there, so every other space typed is kept
const pad = (cell: string, b: { at: number; end: number; text: string }) => {
  const lead = b.at === 0 && b.text.startsWith(" ") ? 1 : 0;
  const trail = b.end === cell.length && b.text.length > lead && b.text.endsWith(" ") ? 1 : 0;
  return { from: b.at + lead, to: b.end - trail, value: b.text.slice(lead, b.text.length - trail) };
};

// ponytail: a table cell is a text field (and the pictures pasted or dropped in it) — no handle, no insert strip: the
// grid around it carries the row's and the column's actions; offsets given back are the field's
export function TableCell({
  cell,
  head,
  focused,
  id,
  label,
  images,
  url,
  readOnly,
  lockedBy,
  onText,
  onAddFiles,
  onDropBlock,
  onRemove,
  onOpen,
  onOpenSource,
}: {
  cell: Cell | undefined;
  head: boolean;
  focused: boolean;
  id: string;
  label: string;
  images: StepImage[];
  url: (file: string) => string;
  readOnly?: boolean;
  lockedBy?: "claude";
  onText: (at: number, end: number, value: string) => void;
  onAddFiles: (at: number, files: File[]) => void;
  onDropBlock: (at: number, moved: Moved) => void;
  onRemove: (block: Block) => void;
  onOpen: (file: string) => void;
  onOpenSource?: (s: Source) => void;
}) {
  if (!cell) return null;
  const blocks = blocksOf(cell.text, images);
  const abs = (k: number) => cell.at + k;
  const hasText = blocks.some((b) => b.kind === "text");
  const blank = !cell.text.trim();
  const tail = blocks.length ? blocks[blocks.length - 1].end : 0;
  const placeholder = head ? "Column name" : focused ? "Type, or paste an image" : undefined;
  const field = (value: string, write: (v: string) => void, at: number, key: string | number, first: boolean) => (
    <div
      key={key}
      onPaste={(e) => {
        if (readOnly) return;
        const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return;
        e.preventDefault();
        const box = e.target as HTMLTextAreaElement;
        onAddFiles(abs(at + (box.selectionStart ?? value.length)), files);
      }}
    >
      <Text
        id={first ? id : undefined}
        multiline
        appearance="cell"
        size="sm"
        ariaLabel={label}
        value={value}
        placeholder={first ? placeholder : undefined}
        readOnly={readOnly && !lockedBy}
        lockedBy={lockedBy}
        onChange={(v) => write(v.replace(/\n\s*\n/g, "\n"))}
        onKeyDown={(e) => {
          const box = e.target as HTMLTextAreaElement;
          if (e.key === "Enter" && box.value.slice(0, box.selectionStart ?? 0).endsWith("\n")) e.preventDefault();
        }}
      />
    </div>
  );
  // ponytail: text fields are keyed by their order, so the empty one a blank cell shows is the same field once the first
  // letter made it the cell's text — the focus stays in it
  let texts = 0;
  const next = () => texts++;
  const kids = blocks.map((b, i) => {
    if (b.kind === "text") {
      const p = pad(cell.text, b);
      const n = next();
      return field(p.value, (v) => onText(abs(p.from), abs(p.to), v), p.from, `t${n}`, n === 0);
    }
    if (b.kind === "image")
      return (
        <div key={`b${i}`} {...stylex.props(styles.picture)}>
          <ImageBlock
            src={url(b.image.file)}
            name={fileName(b.image.file)}
            label={label}
            caption={
              b.image.figure ? (
                <StepSource source={figureSource(b.image.figure)} compact onOpen={onOpenSource} />
              ) : undefined
            }
            onOpen={() => onOpen(b.image.file)}
            onRemove={readOnly ? undefined : () => onRemove({ ...b, at: abs(b.at), end: abs(b.end) })}
          />
        </div>
      );
    if (b.kind === "extern")
      return (
        <div key={`b${i}`} {...stylex.props(styles.picture)}>
          <ExternBlock
            url={b.url}
            params={b.params}
            label={label}
            onRemove={readOnly ? undefined : () => onRemove({ ...b, at: abs(b.at), end: abs(b.end) })}
          />
        </div>
      );
    return (
      <div key={`b${i}`} {...stylex.props(styles.picture)}>
        <Disclosure summary="Xray markup this editor cannot read" quiet>
          <Raw text={b.kind === "raw" ? b.text : cell.text.slice(b.at, b.end)} />
        </Disclosure>
      </div>
    );
  });
  if (!hasText && blank) kids.push(field("", (v) => v && onText(cell.at, cell.end, ` ${v} `), 0, "t0", true));
  else if (!hasText && !readOnly)
    kids.push(field("", (v) => v && onText(abs(tail), abs(tail), `\n${v}`), tail, "t0", true));
  return (
    <div
      {...stylex.props(styles.cell)}
      onDragOver={(e) => !readOnly && takes(e) && e.preventDefault()}
      onDrop={(e) => {
        if (readOnly || !takes(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const moved = e.dataTransfer.getData(MOVE);
        const at = abs(blank ? 0 : tail);
        if (moved) onDropBlock(at, JSON.parse(moved) as Moved);
        else onAddFiles(at, Array.from(e.dataTransfer.files));
      }}
    >
      {kids}
    </div>
  );
}
