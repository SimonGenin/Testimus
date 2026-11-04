import * as stylex from "@stylexjs/stylex";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { color } from "../../../styles/tokens.stylex.ts";
import type { AdviceRow } from "./data.ts";
import { choiceLabel } from "./data.ts";

const styles = stylex.create({ muted: { color: color.textMuted } });

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
    <section aria-label="Advice">
      <Banner
        tone={up ? "info" : "warning"}
        title={`${up ? "This PC can do more: " : "A lighter choice suits this PC: "}switch to ${choiceLabel(advice.to, label)}`}
        actions={
          <>
            <Button size="sm" label="Apply" disabled={busy} onClick={onApply} />
            <Button size="sm" variant="quiet" label="Dismiss" onClick={onDismiss} />
          </>
        }
      >
        {advice.reason}{" "}
        <span {...stylex.props(styles.muted)}>
          Quality: {advice.quality} · now {choiceLabel(advice.from, label)}
        </span>
      </Banner>
    </section>
  );
}
