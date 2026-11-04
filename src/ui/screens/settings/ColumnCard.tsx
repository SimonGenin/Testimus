import * as stylex from "@stylexjs/stylex";
import type { ColumnMode, StepColumn, XrayField } from "../../../core/types.ts";
import { Badge, type BadgeTone } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { Text } from "../../components/ui/Text.tsx";
import type { Save } from "../../lib/data/autosave.ts";
import type { Key } from "../../lib/data/query.ts";
import { color, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { columnTag } from "../generate/ColumnsView.tsx";
import { Hint, Stack } from "./Section.tsx";

const styles = stylex.create({
  head: { display: "inline-flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  grip: { display: "inline-flex", color: color.textSubtle, cursor: "grab" },
  label: { fontSize: fontSize.compact, lineHeight: lineHeight.compact, fontWeight: fontWeight.medium },
  modes: { display: "flex", alignItems: "center", gap: space.s6, flexWrap: "wrap" },
  acts: { display: "inline-flex", gap: space.s1 },
});

const MODES: { value: ColumnMode; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "filled", label: "When filled" },
  { value: "collapsed", label: "Collapsed" },
];

const tagOf = (c: StepColumn): { label: string; tone: BadgeTone } => {
  const t = columnTag(c);
  return { label: t.label, tone: t.tone === "warn" ? "warning" : "neutral" };
};

export type ColumnCardProps = {
  column: StepColumn;
  field: XrayField | undefined;
  mode: ColumnMode;
  first: boolean;
  last: boolean;
  description: { saveKey: Key; save: Save<string> };
  onMode: (m: ColumnMode) => void;
  onHidden: (h: boolean) => void;
  onReferenceSource: (on: boolean) => void;
  onMove: (by: number) => void;
  onRemove?: () => void;
};

// ponytail: one step column — how it folds on a step, hidden or not, its items linked to their sources or not, and
// what Claude is told to write in it (saved by the field)
export function ColumnCard({
  column: c,
  field,
  mode,
  first,
  last,
  description,
  onMode,
  onHidden,
  onReferenceSource,
  onMove,
  onRemove,
}: ColumnCardProps) {
  const tag = tagOf(c);
  const always = c.name === "Action" || c.name === "Expected Result";
  const id = `settings-column-${c.name.replace(/\W+/g, "-")}`;
  return (
    <Card
      title={
        <span {...stylex.props(styles.head)}>
          <span aria-hidden="true" {...stylex.props(styles.grip)}>
            <Icon name="grip" />
          </span>
          {c.name}
          <Badge label={tag.label} tone={tag.tone} size="sm" />
          {field?.required && <Badge label="required" tone="info" size="sm" tooltip="Xray refuses a step without it" />}
          {field?.disabled && (
            <Badge
              label="off in Xray"
              tone="neutral"
              size="sm"
              tooltip="Switched off in Xray: it folds unless filled"
            />
          )}
        </span>
      }
      actions={
        <span {...stylex.props(styles.acts)}>
          <Button
            size="xs"
            variant="quiet"
            icon="chevron-up"
            iconOnly
            label={`Move ${c.name} up`}
            disabled={first}
            onClick={() => onMove(-1)}
          />
          <Button
            size="xs"
            variant="quiet"
            icon="chevron-down"
            iconOnly
            label={`Move ${c.name} down`}
            disabled={last}
            onClick={() => onMove(1)}
          />
          {onRemove && (
            <Button
              size="xs"
              variant="quiet"
              icon="trash"
              iconOnly
              label={`Remove the column ${c.name}`}
              onClick={onRemove}
            />
          )}
        </span>
      }
    >
      <Stack>
        <span {...stylex.props(styles.label)}>Shown in a step</span>
        <div {...stylex.props(styles.modes)}>
          <Segmented<ColumnMode>
            size="sm"
            label={`${c.name} folding`}
            value={mode}
            options={MODES.map((m) => ({
              ...m,
              disabled: always && m.value !== "open" ? `${c.name} is always open` : undefined,
            }))}
            onChange={onMode}
          />
          <Switch label="Hidden" hint="Unless a step holds text in it" on={c.mode === "hidden"} onChange={onHidden} />
          <Switch
            label="Reference source"
            hint="Each item links to the passage it comes from"
            on={!!c.referenceSource}
            onChange={onReferenceSource}
          />
        </div>
        <Text
          id={id}
          multiline
          label={`What Claude writes in ${c.name}`}
          value={c.description}
          placeholder="Empty: Claude leaves this column empty"
          {...description}
        />
        {c.status === "new" && <Hint>New in Xray: describe it, or leave it empty and Claude never fills it.</Hint>}
        {c.status === "gone" && (
          <Hint>
            No longer in Xray: what the tests hold in it stays in test.md, as a local column. Remove it once you no
            longer need it.
          </Hint>
        )}
      </Stack>
    </Card>
  );
}
