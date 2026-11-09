import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Kbd } from "../../components/ui/Kbd.tsx";
import { Tooltip } from "../../components/ui/Tooltip.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { color, container, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  foot: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: space.s4,
    containerType: "inline-size",
  },
  keys: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    display: { default: "flex", [container.paneCompact]: "none" },
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s3,
    height: size.kbd,
    overflow: "hidden",
    color: color.textMuted,
  },
  keyGroup: { display: "inline-flex", alignItems: "center", gap: space.s2, height: size.kbd, whiteSpace: "nowrap" },
  grow: { flex: 1 },
  count: { flex: "none", display: "inline-flex" },
  open: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    color: color.danger,
    whiteSpace: "nowrap",
  },
  stale: { color: color.textMuted },
  long: { display: { default: "inline", [container.paneCompact]: "none" } },
  action: { flex: "none", display: "inline-flex" },
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

// ponytail: the reviewer's two decisions and the keys that make them, in the test section's foot; Validate is allowed
// with open errors
export function ReviewFoot({ errors, stale, off, fixOpen, marked = false, onToFix, onValidate }: ReviewFootProps) {
  const still = `${plural(errors, "error")} still open${stale ? " · out of date" : ""}`;
  return (
    <div {...stylex.props(styles.foot)}>
      <span {...stylex.props(type.small, styles.keys)}>
        <span {...stylex.props(styles.keyGroup)}>
          <Kbd>J</Kbd> <Kbd>K</Kbd> next / previous test
        </span>
        <span {...stylex.props(styles.keyGroup)}>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> step
        </span>
      </span>
      <span {...stylex.props(styles.grow)} />
      {errors > 0 && (
        <span {...stylex.props(styles.count)}>
          <Tooltip label={still}>
            <span {...stylex.props(type.compact, styles.open, stale && styles.stale)}>
              <Icon name={stale ? "history" : "x-circle"} size="sm" />
              {plural(errors, "error")}
              <span {...stylex.props(styles.long)}> still open{stale ? " · out of date" : ""}</span>
            </span>
          </Tooltip>
        </span>
      )}
      <span {...stylex.props(styles.action)}>
        <Button
          icon="to-fix"
          label="To fix"
          shortcut="F"
          pressed={fixOpen || marked}
          disabled={off}
          onClick={onToFix}
        />
      </span>
      <span {...stylex.props(styles.action)}>
        <Button
          variant="primary"
          icon="validated"
          label="Validate"
          shortcut="V"
          disabled={off || fixOpen}
          onClick={onValidate}
        />
      </span>
    </div>
  );
}
