import { Button, Icon } from "../../../components/legacy/index.ts";
import type { AdviceRow } from "./data.ts";
import { choiceLabel } from "./data.ts";

export function AdviceBanner({
  advice,
  label,
  busy,
  onApply,
  onDismiss,
}: {
  advice: AdviceRow;
  label: (id: string) => string;
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const up = advice.direction === "upgrade";
  return (
    <section className={up ? "advice advice-up" : "advice advice-down"} aria-label="Advice">
      <Icon name={up ? "info" : "warning"} size={20} />
      <div className="advice-body">
        <span className="advice-title">
          {up ? "This PC can do more: " : "A lighter choice suits this PC: "}
          switch to {choiceLabel(advice.to, label)}
        </span>
        <span>{advice.reason}</span>
        <span className="muted">
          Quality: {advice.quality} · now {choiceLabel(advice.from, label)}
        </span>
      </div>
      <div className="advice-actions">
        <Button size="sm" disabled={busy} onClick={onApply}>
          Apply
        </Button>
        <Button size="sm" tone="quiet" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}
