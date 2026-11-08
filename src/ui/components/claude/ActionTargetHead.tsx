import * as stylex from "@stylexjs/stylex";
import type { NamedTarget } from "../../../core/types.ts";
import { TARGET_WORD } from "../../lib/actions.ts";
import { relTime } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { type } from "../ui/type.ts";

const styles = stylex.create({
  head: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    margin: 0,
    minWidth: 0,
    color: color.text,
  },
  name: { minWidth: 0, overflowWrap: "anywhere" },
  muted: { color: color.textMuted },
});

// ponytail: the head of a group of Claude actions — what they work on, its kind as a badge and its name, never an id
// (a document's code and a generation's time beside it)
export function ActionTargetHead({ target }: { target: NamedTarget }) {
  return (
    <h3 {...stylex.props(type.small, type.regular, styles.head)}>
      <Badge outline size="sm" label={TARGET_WORD[target.kind]} />
      <span {...stylex.props(styles.name)}>{target.name}</span>
      {target.code && target.code !== target.name && (
        <span {...stylex.props(type.code, styles.muted)}>{target.code}</span>
      )}
      {target.at && <span {...stylex.props(styles.muted)}>{relTime(Date.parse(target.at))}</span>}
    </h3>
  );
}
