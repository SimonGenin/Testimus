import * as stylex from "@stylexjs/stylex";
import type { ColumnMode, StepColumn, XrayField } from "../../../core/types.ts";
import { Badge, COLUMN, type Word } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import type { Save } from "../../lib/data/autosave.ts";
import type { Key } from "../../lib/data/query.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { Hint, Stack } from "./Section.tsx";

const styles = stylex.create({
  head: { display: "inline-flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  grip: { display: "inline-flex", color: color.textSubtle, cursor: "grab" },
  modes: { display: "flex", alignItems: "center", gap: space.s6, flexWrap: "wrap" },
  acts: { display: "inline-flex", gap: space.s1 },
  note: {
    margin: 0,
    display: "flex",
    alignItems: "flex-start",
    gap: space.s2,
    color: color.textSubtle,
  },
  noteIcon: { display: "inline-flex", marginTop: border.width },
});

const MODES: { value: ColumnMode; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "filled", label: "When filled" },
  { value: "collapsed", label: "Collapsed" },
];

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
  /** a column found in Xray: saved with no description, so Claude never fills it and it is no longer to describe */
  onLeaveEmpty?: () => void;
};

// ponytail: where the column comes from, in the kit's column vocabulary — a warning for what Xray changed, the drive
// for a column kept in test.md
function kindBadge(c: StepColumn): Word {
  if (c.status === "gone") return COLUMN.gone;
  if (c.origin === "local") return COLUMN.local;
  if (c.status === "new") return COLUMN["new-in-xray"];
  return c.builtin ? COLUMN.standard : COLUMN.xray;
}

function Note({ children }: { children: string }) {
  return (
    <p {...stylex.props(type.small, styles.note)}>
      <span {...stylex.props(styles.noteIcon)}>
        <Icon name="info" size="sm" />
      </span>
      {children}
    </p>
  );
}

export const columnFieldId = (name: string) => `settings-column-${name.replace(/\W+/g, "-")}`;

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
  onLeaveEmpty,
}: ColumnCardProps) {
  const tag = kindBadge(c);
  const always = c.name === "Action" || c.name === "Expected Result";
  const id = columnFieldId(c.name);
  return (
    <Card
      title={
        <span {...stylex.props(styles.head)}>
          <span aria-hidden="true" {...stylex.props(styles.grip)}>
            <Icon name="grip" />
          </span>
          {c.name}
          <Badge label={tag.label} tone={tag.tone} icon={tag.icon} tooltip={tag.tooltip} size="sm" />
          {field?.required && (
            <Badge
              label="Required"
              tone="warning"
              icon="alert-circle"
              size="sm"
              tooltip="Xray refuses a step without it"
            />
          )}
          {field?.disabled && <Badge label="Off in Xray" tone="neutral" icon="eye-off" size="sm" />}
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
        <Field label="Shown in a step">
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
            <Switch label="Hidden" on={c.mode === "hidden"} onChange={onHidden} />
            <Switch label="Reference source" on={!!c.referenceSource} onChange={onReferenceSource} />
          </div>
        </Field>
        <Text
          id={id}
          multiline
          label={`What Claude writes in ${c.name}`}
          value={c.description}
          placeholder="Empty: Claude leaves this column empty"
          {...description}
        />
        {c.status === "new" && (
          <Banner
            tone="warning"
            compact
            title="Found in Xray, not described yet"
            actions={onLeaveEmpty && <Button size="sm" variant="quiet" label="Leave it empty" onClick={onLeaveEmpty} />}
          >
            Xray has this step field. Write above what Claude puts in it — or leave it empty: Claude never fills it.
          </Banner>
        )}
        {field?.disabled && <Note>Switched off in Xray: it stays folded unless a step holds something.</Note>}
        {c.origin === "local" && c.status !== "gone" && (
          <Note>Kept in test.md and never pushed. Add the field in Xray and it becomes an Xray column.</Note>
        )}
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
