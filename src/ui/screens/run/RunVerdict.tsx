import * as stylex from "@stylexjs/stylex";
import { Badge, RUN_STATUS } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Kbd } from "../../components/ui/Kbd.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { type RunStatus, STATUS_ORDER } from "./runs.ts";

const styles = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s3 },
  row: { display: "flex", alignItems: "center", gap: space.s2 },
  title: { flex: 1, margin: 0 },
  unsaved: { color: color.warning },
  grid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: space.s2 },
  option: { color: color.textMuted },
  hint: { display: "flex", alignItems: "flex-start", gap: space.s2, margin: 0, color: color.textMuted },
  keys: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: space.s3,
    margin: 0,
    color: color.textSubtle,
  },
  key: { display: "inline-flex", alignItems: "center", gap: space.s1 },
});

const MEANS: Record<RunStatus, string> = {
  passed: "Every step did what it should",
  problem: "A step did not",
  blocked: "Could not be run",
  "not-run": "Not played yet",
};

const EDGE = { passed: "success", problem: "danger", blocked: "warning", "not-run": undefined } as const;

// ponytail: the test's result — set by the marks as they change (a NOK is Problem, all OK Passed) and saved at once;
// another one picked is saved at once too and stands until the marks change, their word shown beside it; Blocked is
// saved once its reason is said. The button only moves on
export function RunVerdict({
  status,
  proposed,
  recorded,
  reason,
  busy,
  last,
  onStatus,
  onReason,
  onReasonDone,
  onSave,
}: {
  status: RunStatus;
  /** what the marks say, when the result picked differs */
  proposed: RunStatus | null;
  /** the result shown is the one the file holds (false: Blocked waits for its reason) */
  recorded: boolean;
  reason: string;
  busy: boolean;
  last: boolean;
  onStatus: (s: RunStatus) => void;
  onReason: (r: string) => void;
  onReasonDone: () => void;
  onSave: () => void;
}) {
  const missing = status === "blocked" && !reason.trim();
  return (
    <div {...stylex.props(styles.wrap)}>
      <div {...stylex.props(styles.row)}>
        <h3 {...stylex.props(type.compact, type.strong, styles.title)}>Result of the test</h3>
        {!recorded && <span {...stylex.props(type.small, type.medium, styles.unsaved)}>Not saved yet</span>}
      </div>
      <div role="radiogroup" aria-label="Result of the test" {...stylex.props(styles.grid)}>
        {STATUS_ORDER.map((s) => (
          <Card
            key={s}
            density="tight"
            edge={status === s ? EDGE[s] : undefined}
            dashed={status !== s && proposed === s}
            radio={{ name: "run-result", value: s, checked: status === s, onSelect: () => onStatus(s) }}
            title={<Badge {...RUN_STATUS[s]} />}
          >
            <span {...stylex.props(type.caption, styles.option)}>
              {proposed === s && status !== s ? "What the marks say" : MEANS[s]}
            </span>
          </Card>
        ))}
      </div>
      {status === "blocked" && (
        <Text
          multiline
          rows={2}
          label="Why is it blocked?"
          value={reason}
          onChange={onReason}
          onBlur={onReasonDone}
          placeholder="The bench, the data or the access that was missing…"
          hint="A blocked test needs its reason: what stopped it from being run."
        />
      )}
      {proposed && proposed !== status && (
        <p {...stylex.props(type.small, styles.hint)}>
          <Icon name="info" size="sm" />
          {proposed === "problem" ? "A step is NOK" : "Every step is OK"}: the next mark sets the result again.
        </p>
      )}
      <Button
        variant="primary"
        block
        label={last ? "Finish" : "Next test"}
        shortcut="Ctrl Enter"
        loading={busy}
        disabled={missing ? "Say why the test is blocked first" : false}
        onClick={onSave}
      />
      <p {...stylex.props(type.caption, styles.keys)}>
        <span {...stylex.props(styles.key)}>
          <Kbd>O</Kbd> OK
        </span>
        <span {...stylex.props(styles.key)}>
          <Kbd>N</Kbd> NOK
        </span>
        <span {...stylex.props(styles.key)}>
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> step
        </span>
        <span {...stylex.props(styles.key)}>
          <Kbd>Ctrl V</Kbd> screenshot
        </span>
      </p>
    </div>
  );
}
