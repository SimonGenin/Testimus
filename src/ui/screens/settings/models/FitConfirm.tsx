import * as stylex from "@stylexjs/stylex";
import type { Fit } from "../../../../core/types.ts";
import { Button } from "../../../components/ui/Button.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { fontFamily } from "../../../styles/tokens.stylex.ts";
import { Hint, Stack } from "../Section.tsx";
import { FitChip } from "./FitChip.tsx";

const styles = stylex.create({ mono: { fontFamily: fontFamily.mono } });

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

// ponytail: the dialog's name asks the question (« Will the Quality pack fit? »); its head says the verdict
export function FitConfirm({
  title,
  fit,
  lighter,
  onUse,
  onLighter,
  onClose,
}: {
  title: string;
  fit: Fit;
  lighter: string | null;
  onUse: () => void;
  onLighter: () => void;
  onClose: () => void;
}) {
  const refused = fit.verdict === "ram-too-small" || fit.verdict === "unsupported";
  return (
    <Modal
      size="sm"
      title={`Will ${title} fit?`}
      subtitle={
        <>
          {refused ? `${title} cannot run on this PC` : `${title} may not fit this PC`} <FitChip fit={fit} />
        </>
      }
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" label="Cancel" onClick={onClose} />
          <Button label="Choose a lighter one" disabled={lighter ? false : "Nothing lighter"} onClick={onLighter} />
          {!refused && <Button variant="primary" label="Use anyway" onClick={onUse} />}
        </>
      }
    >
      <Stack>
        <p>{fit.message}</p>
        {!(fit.verdict === "gpu-too-small" && /processor/.test(fit.message)) && <Hint>{WHY[fit.verdict]}</Hint>}
        {fit.unload.length > 0 && (
          <Hint>
            Loaded now: <span {...stylex.props(styles.mono)}>{fit.unload.join(", ")}</span>. They are unloaded after 10
            idle minutes.
          </Hint>
        )}
        {lighter && <Hint>Lighter choice: {lighter}.</Hint>}
      </Stack>
    </Modal>
  );
}
