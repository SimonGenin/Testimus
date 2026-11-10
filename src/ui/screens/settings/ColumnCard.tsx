import * as stylex from "@stylexjs/stylex";
import type { MouseEvent } from "react";
import type { ColumnShow, StepColumn, XrayField } from "../../../core/types.ts";
import { Badge, COLUMN, type Word } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import type { Save } from "../../lib/data/autosave.ts";
import type { Key } from "../../lib/data/query.ts";
import { border, color, container, size, space } from "../../styles/tokens.stylex.ts";
import { Hint } from "./Section.tsx";

const styles = stylex.create({
  head: {
    display: "grid",
    gridTemplateColumns: {
      default: `${size.iconMd} minmax(0, 2fr) minmax(0, 3fr) calc(${size.menuMin} / 2) ${size.controlXs}`,
      [container.paneCompact]: `${size.iconMd} minmax(0, 1fr) ${size.controlXs}`,
    },
    columnGap: space.s4,
    alignItems: "center",
    paddingBlock: space.s4,
    paddingInline: space.s6,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": color.surfaceHover },
  },
  grip: { display: "inline-flex", color: color.textDisabled, cursor: "grab" },
  name: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap", minWidth: 0 },
  line: {
    display: { default: "block", [container.paneCompact]: "none" },
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: color.textMuted,
  },
  empty: { color: color.textDisabled },
  shown: { display: { default: "block", [container.paneCompact]: "none" }, color: color.textSubtle },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingBlockStart: space.s1,
    paddingBlockEnd: space.s5,
    paddingInline: space.s6,
  },
  acts: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: space.s1 },
  note: { margin: 0, display: "flex", alignItems: "flex-start", gap: space.s2, color: color.textSubtle },
  noteIcon: { display: "inline-flex", marginTop: border.width },
});

export const SHOWN: { value: ColumnShow; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "filled", label: "When filled" },
  { value: "collapsed", label: "Folded" },
  { value: "hidden", label: "Hidden" },
];

export type ColumnCardProps = {
  column: StepColumn;
  field: XrayField | undefined;
  open: boolean;
  onToggle: () => void;
  first: boolean;
  last: boolean;
  description: { saveKey: Key; save: Save<string> };
  onMode: (m: ColumnShow) => void;
  onReferenceSource: (on: boolean) => void;
  onMove: (by: number) => void;
  onRemove?: () => void;
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

// ponytail: one step column as a row — its name, where it comes from, the first line of what Claude writes in it and
// how it shows; opened (one at a time), what Claude is told to write (saved by the field), how the editor shows it,
// its items linked to their sources or not, its place and, for a local column, its removal
export function ColumnCard({
  column: c,
  field,
  open,
  onToggle,
  first,
  last,
  description,
  onMode,
  onReferenceSource,
  onMove,
  onRemove,
}: ColumnCardProps) {
  const tag = kindBadge(c);
  const always = c.name === "Action" || c.name === "Expected Result";
  const said = c.description.trim().split("\n")[0];
  const toggle = (e: MouseEvent<HTMLDivElement>) => {
    if (!(e.target as Element).closest("button")) onToggle();
  };
  return (
    <>
      <div onClick={toggle} {...stylex.props(styles.head)}>
        <span aria-hidden="true" {...stylex.props(styles.grip)}>
          <Icon name="grip" />
        </span>
        <span {...stylex.props(styles.name)}>
          <span {...stylex.props(type.compact, type.strong)}>{c.name}</span>
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
        <span {...stylex.props(type.compact, styles.line, !said && styles.empty)}>
          {said || "No description: Claude leaves it empty"}
        </span>
        <span {...stylex.props(type.small, styles.shown)}>{SHOWN.find((m) => m.value === c.mode)?.label}</span>
        <Button
          size="xs"
          variant="quiet"
          icon={open ? "chevron-up" : "chevron-down"}
          iconOnly
          label={`${open ? "Fold" : "Open"} ${c.name}`}
          expanded={open}
          onClick={onToggle}
        />
      </div>
      {open && (
        <div {...stylex.props(styles.body)}>
          <Text
            id={columnFieldId(c.name)}
            aside
            multiline
            label="What Claude writes"
            hint="Told to Claude for every step it writes."
            value={c.description}
            placeholder="Empty: Claude leaves this column empty"
            {...description}
          />
          <Field aside label="In the editor" hint="How the column shows in a step.">
            <div>
              <Segmented<ColumnShow>
                size="sm"
                label={`${c.name} in the editor`}
                value={c.mode}
                options={SHOWN.map((m) => ({
                  ...m,
                  disabled:
                    always && m.value !== "open" && m.value !== "hidden" ? `${c.name} is always open` : undefined,
                }))}
                onChange={onMode}
              />
            </div>
          </Field>
          <Field
            aside
            label="Reference source"
            hint="Each item written in it carries its own source, clickable in the step."
          >
            <div>
              <Switch label="Cite a source for each item" on={!!c.referenceSource} onChange={onReferenceSource} />
            </div>
          </Field>
          {field?.disabled && (
            <Note>
              Switched off in Xray: what a step holds in it stays in test.md and is never pushed (Xray refuses it). It
              stays folded unless a step holds something.
            </Note>
          )}
          {c.origin === "local" && c.status !== "gone" && (
            <Note>Kept in test.md and never pushed. Add the field in Xray and it becomes an Xray column.</Note>
          )}
          {c.status === "gone" && (
            <Hint>
              No longer in Xray: what the tests hold in it stays in test.md, as a local column. Remove it once you no
              longer need it.
            </Hint>
          )}
          <div {...stylex.props(styles.acts)}>
            <Button
              size="xs"
              variant="quiet"
              icon="arrow-up"
              iconOnly
              label={`Move ${c.name} up`}
              disabled={first}
              onClick={() => onMove(-1)}
            />
            <Button
              size="xs"
              variant="quiet"
              icon="arrow-down"
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
          </div>
        </div>
      )}
    </>
  );
}
