import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { border, color, size, space } from "../../styles/tokens.stylex.ts";
import { day, folderOf, NO_FOLDER, type RunTestView } from "./runs.ts";

const styles = stylex.create({
  bar: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s3,
    minHeight: size.row2,
    paddingBlock: space.s2,
    paddingInline: space.s5,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  key: { color: color.textMuted },
  folder: { display: "inline-flex", alignItems: "center", gap: space.s1, minWidth: 0, color: color.textMuted },
  folderName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  grow: { flex: 1 },
  pos: { color: color.textMuted, whiteSpace: "nowrap" },
  nav: { display: "inline-flex", alignItems: "center", gap: space.s1 },
});

// ponytail: the test bar of a test being run, as the editor's — which test (its key or id, its folder, frozen when),
// where it is in the run, previous / next, Ask Claude, the test itself in Tests
export function RunExecBar({
  test,
  at,
  total,
  frozenAt,
  onPrev,
  onNext,
  onAsk,
  onOpenTest,
}: {
  test: RunTestView;
  at: number;
  total: number;
  frozenAt: string;
  onPrev?: () => void;
  onNext?: () => void;
  onAsk: () => void;
  onOpenTest: () => void;
}) {
  const folder = folderOf(test);
  return (
    <div role="toolbar" aria-label="Test" {...stylex.props(styles.bar)}>
      <span {...stylex.props(type.small, type.mono, styles.key)}>{test.key ?? test.id}</span>
      {folder !== NO_FOLDER && (
        <span title={folder} {...stylex.props(type.compact, styles.folder)}>
          <Icon name="folder" size="sm" />
          <span {...stylex.props(styles.folderName)}>{folder}</span>
        </span>
      )}
      <Badge
        label={`Frozen copy · ${day(frozenAt)}`}
        icon="lock"
        size="sm"
        tooltip="The run keeps the test as it was when the run was made"
      />
      <span {...stylex.props(styles.grow)} />
      <span {...stylex.props(type.compact, type.tabular, styles.pos)}>
        Test {at} of {total}
      </span>
      <span {...stylex.props(styles.nav)}>
        <Button
          variant="quiet"
          size="sm"
          icon="chevron-left"
          iconOnly
          label="Previous test"
          disabled={!onPrev}
          onClick={onPrev}
        />
        <Button
          variant="quiet"
          size="sm"
          icon="chevron-right"
          iconOnly
          label="Next test"
          disabled={!onNext}
          onClick={onNext}
        />
      </span>
      <Button variant="claude-quiet" size="sm" icon="claude" label="Ask Claude" onClick={onAsk} />
      <Button variant="quiet" size="sm" icon="external" iconOnly label="Open the test in Tests" onClick={onOpenTest} />
    </div>
  );
}
