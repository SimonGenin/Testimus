import * as stylex from "@stylexjs/stylex";
import type { Fit } from "../../../../core/types.ts";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { type } from "../../../components/ui/type.ts";
import { space } from "../../../styles/tokens.stylex.ts";
import { Hint, Stack } from "../Section.tsx";
import { FIT, PROCESSOR_ONLY, size } from "./data.ts";

const styles = stylex.create({
  plain: { margin: 0 },
  badges: { display: "flex", flexWrap: "wrap", gap: space.s2 },
});

const ON_PROCESSOR = "Made for a GPU: here it runs on the processor, several times slower.";

const WHY: Record<Fit["verdict"], string> = {
  fits: "",
  tight: "It fits only just, or only once other loaded models are unloaded.",
  "gpu-too-small": "It will run partly on the processor: indexing and search get several times slower.",
  "ram-too-small": "This PC does not have the memory to load it.",
  unknown: "Testimus does not know this GPU's memory yet: it measures it on first use.",
  untested:
    "It has never run on this system: it may not run at all. Testimus tries it right after the download and refuses it if it fails.",
  unsupported: "Testimus has no runtime for it on this system.",
};

export function fitNumbers(fit: Fit): [string, string][] {
  const gpu = fit.device === "gpu" && fit.needMB.vram > 0;
  const need = gpu ? fit.needMB.vram : fit.needMB.ram;
  const free = gpu ? fit.freeMB.vram : fit.freeMB.ram;
  const total = gpu ? fit.totalMB.vram : fit.totalMB.ram;
  const out: [string, string][] = [];
  if (need > 0) out.push([size(need), gpu ? "needed on the GPU" : "of memory needed"]);
  if (free !== null && free > 0)
    out.push([size(free), `free on this PC's ${gpu ? "GPU" : "memory"}${total ? ` (${size(total)} in all)` : ""}`]);
  return out;
}

export function fitTitle(name: string, short: string, fit: Fit, processorOnly: boolean): string {
  if (fit.verdict === "ram-too-small" || fit.verdict === "unsupported") return `${short} cannot run on this PC`;
  return processorOnly && fit.verdict === "fits" ? `Use ${name} on the processor?` : `Use ${name} anyway?`;
}

// ponytail: the dialog's name asks the question (« Use the Quality pack anyway? »), or says it cannot run; the body
// gives the verdict, what it needs against what is free, and why
export function FitConfirm({
  name,
  short,
  fit,
  processorOnly = false,
  lighter,
  onUse,
  onLighter,
  onClose,
}: {
  /** the choice inside a sentence (« the Quality pack », « Qwen3 Embedding 4B ») */
  name: string;
  /** the choice at the start of a sentence (« Quality ») */
  short: string;
  fit: Fit;
  /** a pack made for a GPU that runs on the processor here */
  processorOnly?: boolean;
  lighter: string | null;
  onUse: () => void;
  onLighter: () => void;
  onClose: () => void;
}) {
  const refused = fit.verdict === "ram-too-small" || fit.verdict === "unsupported";
  return (
    <Modal
      size="sm"
      icon="alert-triangle"
      title={fitTitle(name, short, fit, processorOnly)}
      consequences={fitNumbers(fit)}
      consequencesAt="start"
      onClose={onClose}
      actions={
        <>
          <Button variant={refused ? "secondary" : "quiet"} label="Cancel" onClick={onClose} />
          <Button
            variant={refused ? "primary" : "secondary"}
            label="Choose a lighter one"
            disabled={lighter ? false : "Nothing lighter"}
            onClick={onLighter}
          />
          {!refused && <Button variant="primary" label="Use anyway" onClick={onUse} />}
        </>
      }
    >
      <Stack>
        <span {...stylex.props(styles.badges)}>
          {processorOnly && <Badge {...PROCESSOR_ONLY} size="sm" tooltip={ON_PROCESSOR} />}
          <Badge {...FIT[fit.verdict]} size="sm" tooltip={fit.message} />
        </span>
        <p {...stylex.props(styles.plain)}>{fit.message}</p>
        {processorOnly && fit.verdict === "fits" ? (
          <Hint>{ON_PROCESSOR}</Hint>
        ) : (
          !(fit.verdict === "gpu-too-small" && /processor/.test(fit.message)) && <Hint>{WHY[fit.verdict]}</Hint>
        )}
        {fit.unload.length > 0 && (
          <Hint>
            Loaded now: <span {...stylex.props(type.code)}>{fit.unload.join(", ")}</span>. They are unloaded after 10
            idle minutes.
          </Hint>
        )}
        {lighter && <Hint>Lighter choice: {lighter}.</Hint>}
      </Stack>
    </Modal>
  );
}
