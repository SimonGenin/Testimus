import * as stylex from "@stylexjs/stylex";
import { type DragEvent, useState } from "react";
import type { Source } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { itemLinks, stepSources } from "../../lib/fields.ts";
import { plural } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { FieldBlocks } from "../tests/FieldBlocks.tsx";
import type { StepLayout } from "../tests/StepCard.tsx";
import { ItemLinks } from "../tests/step/ItemLinks.tsx";
import { FieldRow, StepFields } from "../tests/step/StepFields.tsx";
import { StepFrame, StepSourcesRow } from "../tests/step/StepFrame.tsx";
import { StepSource } from "../tests/step/StepSource.tsx";
import { hasFiles, picturesOf, RunDrop } from "./RunDrop.tsx";
import { RunMarks } from "./RunMarks.tsx";
import { RunShot } from "./RunShot.tsx";
import type { RunResult, RunTestView } from "./runs.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s4, paddingInline: space.s4, paddingBottom: space.s4 },
  marks: { display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: space.s2, minWidth: 0 },
  grow: { flex: 1 },
  tools: { display: "inline-flex", alignItems: "center", gap: space.s1 },
  nok: { display: "flex", flexDirection: "column", gap: space.s3 },
  nokHead: { display: "flex", alignItems: "center", gap: space.s2, color: color.danger },
  shots: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: space.s3 },
  drop: { color: color.accentText },
});

const noop = () => {};

export type RunStepProps = {
  n: number;
  step: RunTestView["steps"][number];
  mark: RunResult["steps"][number];
  shots: string[];
  questions: number;
  current: boolean;
  layout: StepLayout;
  /** an OK step shows its first line only */
  folded: boolean;
  note: string;
  url: (file: string) => string;
  shotUrl: (file: string) => string;
  onCurrent: () => void;
  onMark: (ok: boolean | null) => void;
  onNote: (note: string) => void;
  onNoteDone: () => void;
  onShot: (files: File[]) => void;
  onOpenShot: (file: string) => void;
  onRemoveShot: (file: string) => void;
  onImage: (file: string) => void;
  onAsk: () => void;
  /** a source chip opens its passage */
  onOpenSource: (s: Source) => void;
};

const tracks = (names: string[]) =>
  names.map((n) => `minmax(0, ${n === "Expected Result" && names.length === 2 ? 1.25 : 1}fr)`).join(" ");

// ponytail: one step as the tester plays it, drawn like the editor's card — its columns as the run froze them, OK /
// NOK in its head; on NOK what happened and its screenshots; a screenshot dropped on the card is this step's (a step
// not marked yet becomes NOK: a screenshot is taken of what went wrong)
export function RunStep(p: RunStepProps) {
  const { xray } = useApp();
  const [over, setOver] = useState(false);
  const asStep = {
    fields: p.step.fields,
    sources: p.step.sources ?? [],
    images: p.step.images.map((file) => ({ file })),
  };
  const links = (name: string) => (xray ? itemLinks(xray, asStep, name) : []);
  const loose = xray ? stepSources(xray, asStep, Object.keys(p.step.fields)) : asStep.sources;
  const nok = p.mark.ok === false;
  const names = Object.keys(p.step.fields);
  const first = Object.values(p.step.fields)[0] ?? "";
  const folded = p.folded && p.mark.ok === true;
  const drop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setOver(false);
    const files = picturesOf(e.dataTransfer.files);
    if (!files.length) return;
    p.onCurrent();
    p.onShot(files);
    if (p.mark.ok === null) p.onMark(false);
  };
  const head = (
    <>
      <span {...stylex.props(styles.marks)}>
        {p.questions > 0 && <Badge label={plural(p.questions, "question")} tone="info" icon="info" size="sm" />}
        {!folded && p.shots.length > 0 && <Badge label={String(p.shots.length)} icon="image" size="sm" />}
      </span>
      {!folded && <span {...stylex.props(styles.grow)} />}
      {p.current && !folded && (
        <span {...stylex.props(styles.tools)}>
          <Button
            variant="quiet"
            size="sm"
            icon="image"
            iconOnly
            label={`Add a screenshot to step ${p.n}`}
            pick={{ accept: "image/*", multiple: true, onFiles: p.onShot }}
          />
          <Button
            variant="claude-quiet"
            size="sm"
            icon="claude"
            iconOnly
            label={`Ask Claude about step ${p.n}`}
            onClick={p.onAsk}
          />
        </span>
      )}
      <RunMarks n={p.n} ok={p.mark.ok} size={folded ? "sm" : "md"} onMark={p.onMark} />
    </>
  );
  return (
    <StepFrame
      n={p.n}
      marks={{ played: p.mark.ok === true ? "ok" : nok ? "nok" : undefined }}
      line={folded ? first.split("\n")[0] : undefined}
      head={head}
      focused={p.current}
      dropping={over}
      onFocusCapture={p.onCurrent}
      onPointerDown={p.onCurrent}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <div {...stylex.props(styles.body)}>
        {over && (
          <span {...stylex.props(type.compact, type.medium, styles.nokHead, styles.drop)}>
            <Icon name="upload" />
            Drop to attach to step {p.n}
            {p.mark.ok === null ? " — it becomes NOK" : ""}
          </span>
        )}
        <StepFields split={p.layout === "split"} tracks={tracks(names)}>
          {names.map((name) => (
            <FieldRow key={name} name={name} split={p.layout === "split"}>
              <FieldBlocks
                readOnly
                idBase={`run${p.n}-${name.replace(/\W+/g, "")}`}
                name={name}
                label={name}
                text={p.step.fields[name]}
                images={p.step.images.map((file) => ({ file }))}
                url={p.url}
                stepNumber={p.n}
                onText={noop}
                onAddFiles={noop}
                onFieldText={noop}
                onDropBlock={noop}
                onRemove={noop}
                onOpen={p.onImage}
              />
              {links(name).length > 0 && <ItemLinks column={name} links={links(name)} onOpen={p.onOpenSource} />}
            </FieldRow>
          ))}
        </StepFields>
        {(nok || p.shots.length > 0) && (
          <div {...stylex.props(styles.nok)}>
            {nok && (
              <Text
                multiline
                rows={2}
                label="What happened"
                value={p.note}
                onChange={p.onNote}
                onBlur={p.onNoteDone}
                placeholder="What the screen showed instead…"
              />
            )}
            <div {...stylex.props(styles.shots)}>
              {p.shots.map((s) => (
                <RunShot
                  key={s}
                  file={s}
                  url={p.shotUrl(s)}
                  onOpen={() => p.onOpenShot(s)}
                  onRemove={() => p.onRemoveShot(s)}
                />
              ))}
              <RunDrop compact label="Drop or paste a screenshot" hint="Ctrl+V pastes" onFiles={p.onShot} />
            </div>
          </div>
        )}
      </div>
      {loose.length > 0 && (
        <StepSourcesRow>
          {loose.map((s, i) => (
            <StepSource key={i} source={s} onOpen={p.onOpenSource} />
          ))}
        </StepSourcesRow>
      )}
    </StepFrame>
  );
}
