import type { Fit } from "../../../../core/types.ts";
import { Button, Modal } from "../../../components/ui/index.ts";
import { FitChip } from "./FitChip.tsx";

const WHY: Record<Fit["verdict"], string> = {
  fits: "",
  tight: "It fits only just, or only once other loaded models are unloaded.",
  "gpu-too-small": "It will run partly on the processor: indexing and search get several times slower.",
  "ram-too-small": "This PC does not have the memory to load it.",
  unknown: "Testimus does not know this GPU's memory yet: it measures it on first use.",
};

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
  const refused = fit.verdict === "ram-too-small";
  return (
    <Modal
      label={`Will ${title} fit?`}
      title={refused ? `${title} cannot run on this PC` : `${title} may not fit this PC`}
      subtitle={<FitChip fit={fit} />}
      width={520}
      onClose={onClose}
      foot={
        <>
          <Button tone="quiet" onClick={onClose}>
            Cancel
          </Button>
          <span className="spacer" />
          <Button
            disabled={!lighter}
            title={lighter ? `Use ${lighter} instead` : "Nothing lighter"}
            onClick={onLighter}
          >
            Choose a lighter one
          </Button>
          {!refused && (
            <Button tone="primary" onClick={onUse}>
              Use anyway
            </Button>
          )}
        </>
      }
    >
      <p className="fit-msg">{fit.message}</p>
      {!(fit.verdict === "gpu-too-small" && /processor/.test(fit.message)) && (
        <p className="muted">{WHY[fit.verdict]}</p>
      )}
      {fit.unload.length > 0 && (
        <p className="muted">
          Loaded now: <span className="mono">{fit.unload.join(", ")}</span>. They are unloaded after 10 idle minutes.
        </p>
      )}
      {lighter && <p className="muted">Lighter choice: {lighter}.</p>}
    </Modal>
  );
}
