import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { TARGET_WORD, type TargetGroup } from "../../lib/actions.ts";
import { relTime } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { type } from "../ui/type.ts";

const styles = stylex.create({
  group: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  dense: { gap: space.s2 },
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

// ponytail: a group of Claude actions under what they work on — its kind as a badge and its name, never an id (a
// document's code and a generation's time beside it); the dock's cards and Generate's suggestions (dense) both use it
export function ActionGroup({
  group,
  dense = false,
  children,
}: {
  group: TargetGroup;
  dense?: boolean;
  children: ReactNode;
}) {
  const target = group.target;
  return (
    <section
      aria-label={`${TARGET_WORD[target.kind]} · ${target.name}`}
      {...stylex.props(styles.group, dense && styles.dense)}
    >
      <h3 {...stylex.props(type.small, type.regular, styles.head)}>
        <Badge outline size="sm" label={TARGET_WORD[target.kind]} />
        <span {...stylex.props(styles.name)}>{target.name}</span>
        {target.code && target.code !== target.name && (
          <span {...stylex.props(type.code, styles.muted)}>{target.code}</span>
        )}
        {target.at && <span {...stylex.props(styles.muted)}>{relTime(Date.parse(target.at))}</span>}
      </h3>
      {children}
    </section>
  );
}
