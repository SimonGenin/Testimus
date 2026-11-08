import type { ColumnLayout, Step, StepImage } from "../../../../core/types.ts";
import { collapsible, columnsOf, splitTracks } from "../../../lib/columns.ts";
import { ColumnField } from "../ColumnField.tsx";
import { FieldBlocks } from "../FieldBlocks.tsx";
import { FieldRow, StepFields } from "./StepFields.tsx";

const none = () => {};

// The fields of a step drawn read-only by the very same field blocks as the live card (same layout, same screenshots,
// images still open): a step's earlier version (WasView), a test Claude is writing (Generate)
export function StepRead({
  idBase,
  step,
  xray,
  split,
  narrow = false,
  n,
  url,
  onOpenImage,
}: {
  /** unique per step on the page: the fields' ids */
  idBase: string;
  step: Step;
  xray: ColumnLayout;
  split: boolean;
  /** a narrow column: the fields one under the other, each label above its field */
  narrow?: boolean;
  /** the step's number */
  n: number;
  url: (file: string) => string;
  onOpenImage: (file: string, images: StepImage[]) => void;
}) {
  const shown = columnsOf(xray, step).filter((c) => !collapsible(c) || (step.fields[c.name] ?? "").trim());
  return (
    <StepFields split={split} tracks={splitTracks(shown)}>
      {shown.map((c) => {
        const value = step.fields[c.name] ?? "";
        return (
          <FieldRow key={c.name} name={c.name} split={split || narrow}>
            {c.kind === "blocks" ? (
              <FieldBlocks
                readOnly
                idBase={`${idBase}-${c.name.replace(/\W+/g, "")}`}
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
          </FieldRow>
        );
      })}
    </StepFields>
  );
}
