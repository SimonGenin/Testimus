import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Chip } from "../../components/ui/Chip.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { FieldBlocks } from "../tests/FieldBlocks.tsx";
import type { RunResult, RunTestView } from "./runs.ts";

const styles = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: `${space.s7} minmax(0, 1fr) auto`,
    columnGap: space.s5,
    rowGap: space.s3,
    alignItems: "start",
  },
  fields: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))",
    gap: space.s5,
    minWidth: 0,
  },
  field: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  caption: { color: color.textMuted },
  marks: { display: "flex", gap: space.s3, minWidth: 0, margin: 0, padding: 0, borderWidth: 0 },
  more: { gridColumn: "2 / -1", display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  shots: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
});

const noop = () => {};

export type RunStepProps = {
  n: number;
  step: RunTestView["steps"][number];
  mark: RunResult["steps"][number];
  shots: string[];
  current: boolean;
  note: string;
  url: (file: string) => string;
  onMark: (ok: boolean | null) => void;
  onNote: (note: string) => void;
  onNoteDone: () => void;
  onShot: (files: File[]) => void;
};

// ponytail: one step as the tester plays it — its columns as the run froze them, OK / NOK (a second press takes the mark
// back), and on NOK what happened and a screenshot
export function RunStep(p: RunStepProps) {
  const nok = p.mark.ok === false;
  return (
    <Card edge={nok ? "danger" : undefined} focused={p.current} density="compact">
      <div {...stylex.props(styles.grid)}>
        <Badge label={String(p.n)} size="sm" />
        <div {...stylex.props(styles.fields)}>
          {Object.entries(p.step.fields).map(([name, text]) => (
            <div key={name} {...stylex.props(styles.field)}>
              <span {...stylex.props(type.caption, styles.caption)}>{name}</span>
              <FieldBlocks
                idBase={`run${p.n}-${name.replace(/\W+/g, "")}`}
                name={name}
                label={name}
                text={text}
                images={p.step.images.map((file) => ({ file }))}
                url={p.url}
                stepNumber={p.n}
                readOnly
                onText={noop}
                onAddFiles={noop}
                onFieldText={noop}
                onDropBlock={noop}
                onRemove={noop}
                onOpen={noop}
              />
            </div>
          ))}
        </div>
        <fieldset aria-label={`Step ${p.n}`} {...stylex.props(styles.marks)}>
          <Button
            size="sm"
            label="OK"
            tone="success"
            pressed={p.mark.ok === true}
            onClick={() => p.onMark(p.mark.ok === true ? null : true)}
          />
          <Button size="sm" label="NOK" tone="danger" pressed={nok} onClick={() => p.onMark(nok ? null : false)} />
        </fieldset>
        {(nok || p.shots.length > 0) && (
          <div {...stylex.props(styles.more)}>
            {nok && (
              <Text
                multiline
                rows={2}
                label="What happened"
                value={p.note}
                onChange={p.onNote}
                onBlur={p.onNoteDone}
                placeholder="What the screen showed instead"
              />
            )}
            <div {...stylex.props(styles.shots)}>
              <Button size="sm" icon="image" label="Add a screenshot" pick={{ accept: "image/*", onFiles: p.onShot }} />
              {p.shots.map((s) => (
                <Chip key={s} label={s} mono />
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
