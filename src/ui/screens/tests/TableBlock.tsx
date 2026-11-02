import type { Block, StepImage, Table } from "../../../core/types.ts";
import { Icon } from "../../components/ui/index.ts";
import { addCol, addRow, dropCol, dropRow, width } from "../../lib/table.ts";
import { FieldBlocks, type Moved } from "./FieldBlocks.tsx";

// ponytail: no model behind the table — the cells are slices of the field string, so every edit here,
// a typed character and a dropped column alike, is one replacement of that string
export function TableBlock({
  table,
  text,
  images,
  url,
  idBase,
  name,
  label,
  stepNumber,
  readOnly,
  onText,
  onAddFiles,
  onFieldText,
  onDropBlock,
  onRemove,
  onOpen,
}: {
  table: Table;
  text: string;
  images: StepImage[];
  url: (file: string) => string;
  idBase: string;
  name: string;
  label: string;
  stepNumber: number;
  readOnly?: boolean;
  onText: (at: number, end: number, value: string) => void;
  onAddFiles: (at: number, files: File[]) => void;
  onFieldText: (next: string) => void;
  onDropBlock: (at: number, moved: Moved) => void;
  onRemove: (block: Block) => void;
  onOpen: (file: string) => void;
}) {
  const cols = width(table);
  const x = (title: string, run: () => void) => (
    <button type="button" className="tbl-x" title={title} aria-label={title} onClick={run}>
      <Icon name="close" size={12} />
    </button>
  );
  return (
    <div className="tblblock">
      <table className="tbl">
        {!readOnly && (
          <thead>
            <tr className="tbl-grips">
              <th />
              {Array.from({ length: cols }, (_, i) => (
                <th key={i}>{x(`Delete column ${i + 1}`, () => onFieldText(dropCol(text, table, i)))}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={ri} className={r.head ? "is-head" : undefined}>
              {!readOnly && (
                <td className="tbl-grip">{x(`Delete row ${ri + 1}`, () => onFieldText(dropRow(text, table, ri)))}</td>
              )}
              {Array.from({ length: cols }, (_, ci) => {
                const c = r.cells[ci];
                const Cell = r.head ? "th" : "td";
                return (
                  <Cell key={ci} className="tbl-cell" scope={r.head ? "col" : undefined}>
                    {c && (
                      <FieldBlocks
                        nested
                        idBase={`${idBase}-r${ri}c${ci}`}
                        name={name}
                        label={`${label}, row ${ri + 1} column ${ci + 1}`}
                        text={c.text}
                        images={images}
                        url={url}
                        stepNumber={stepNumber}
                        readOnly={readOnly}
                        onText={(at, end, v) => onText(c.at + at, c.at + end, v)}
                        onAddFiles={(at, files) => onAddFiles(c.at + at, files)}
                        onFieldText={(next) => onFieldText(text.slice(0, c.at) + next + text.slice(c.end))}
                        onDropBlock={(at, moved) => onDropBlock(c.at + at, moved)}
                        onRemove={(b) => onRemove({ ...b, at: c.at + b.at, end: c.at + b.end })}
                        onOpen={onOpen}
                      />
                    )}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div className="tbl-ops">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => onFieldText(addRow(text, table))}>
            <Icon name="plus" /> Row
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => onFieldText(addCol(text, table))}>
            <Icon name="plus" /> Column
          </button>
        </div>
      )}
    </div>
  );
}
