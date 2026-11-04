import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Kbd } from "../../components/ui/Kbd.tsx";
import { Tooltip } from "../../components/ui/Tooltip.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { border, color, container, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  foot: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    alignItems: "center",
    flexWrap: { default: "nowrap", [container.paneNarrow]: "wrap" },
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInline: { default: space.s5, [container.paneNarrow]: space.s4 },
    borderTopWidth: border.width,
    borderTopStyle: "solid",
    borderTopColor: color.border,
    backgroundColor: color.surface,
  },
  keys: {
    display: { default: "inline-flex", [container.paneCompact]: "none" },
    alignItems: "center",
    gap: space.s2,
    color: color.textMuted,
    whiteSpace: "nowrap",
  },
  grow: { flex: 1 },
  open: {
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    color: color.danger,
    whiteSpace: "nowrap",
  },
  stale: { color: color.textMuted },
  long: { display: { default: "inline", [container.paneNarrow]: "none" } },
});

export type ReviewFootProps = {
  errors: number;
  stale: boolean;
  /** true, or why the decisions are off (Claude works on the test) */
  off: boolean | string;
  fixOpen: boolean;
  /** the test is To fix already: the button reads pressed */
  marked?: boolean;
  onToFix: () => void;
  onValidate: () => void;
};

// ponytail: the reviewer's two decisions and the keys that make them; Validate is allowed with open errors
export function ReviewFoot({ errors, stale, off, fixOpen, marked = false, onToFix, onValidate }: ReviewFootProps) {
  const still = `${plural(errors, "error")} still open${stale ? " · out of date" : ""}`;
  return (
    <div {...stylex.props(styles.foot)}>
      <span {...stylex.props(type.small, styles.keys)}>
        <Kbd>J</Kbd> <Kbd>K</Kbd> next / previous test <Kbd>↑</Kbd> <Kbd>↓</Kbd> step <Kbd>F</Kbd> to fix
      </span>
      <span {...stylex.props(styles.grow)} />
      {errors > 0 && (
        <Tooltip label={still}>
          <span {...stylex.props(type.compact, styles.open, stale && styles.stale)}>
            <Icon name={stale ? "history" : "x-circle"} size="sm" />
            {plural(errors, "error")}
            <span {...stylex.props(styles.long)}> still open{stale ? " · out of date" : ""}</span>
          </span>
        </Tooltip>
      )}
      <Button icon="to-fix" label="To fix" pressed={fixOpen || marked} disabled={off} onClick={onToFix} />
      <Button
        variant="primary"
        icon="validated"
        label="Validate"
        shortcut="V"
        disabled={off || fixOpen}
        onClick={onValidate}
      />
    </div>
  );
}
