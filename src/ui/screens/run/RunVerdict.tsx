import * as stylex from "@stylexjs/stylex";
import { RUN_STATUS } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { type RunStatus, STATUS_ORDER } from "./runs.ts";

const styles = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s4 },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s4 },
  title: { flex: 1, margin: 0, minWidth: "10rem" },
  explain: { margin: 0, color: color.textSubtle },
});

// ponytail: the test's result — proposed by the marks (a NOK proposes Problem, all OK Passed), the tester's to choose;
// Blocked needs its reason
export function RunVerdict({
  status,
  reason,
  busy,
  last,
  onStatus,
  onReason,
  onSave,
}: {
  status: RunStatus;
  reason: string;
  busy: boolean;
  last: boolean;
  onStatus: (s: RunStatus) => void;
  onReason: (r: string) => void;
  onSave: () => void;
}) {
  const missing = status === "blocked" && !reason.trim();
  return (
    <div {...stylex.props(styles.wrap)}>
      <div {...stylex.props(styles.row)}>
        <h3 {...stylex.props(type.titleSm, styles.title)}>Result of the test</h3>
        <Segmented
          label="Result of the test"
          value={status}
          onChange={onStatus}
          options={STATUS_ORDER.map((s) => ({ value: s, label: RUN_STATUS[s].label, icon: RUN_STATUS[s].icon }))}
        />
        <Button
          variant="primary"
          label={last ? "Save the result" : "Save and next test"}
          shortcut="Ctrl Enter"
          loading={busy}
          disabled={missing ? "Say why the test is blocked first" : false}
          onClick={onSave}
        />
      </div>
      {status === "blocked" && (
        <Text
          label="Why is it blocked?"
          value={reason}
          onChange={onReason}
          placeholder="TK not wired on the simulator"
          hint="A blocked test needs its reason: what stopped it from being run."
        />
      )}
      <p {...stylex.props(type.small, styles.explain)}>
        A NOK step proposes Problem; every step OK proposes Passed. Blocked, with its reason, needs no step run. Keys: O
        = OK, N = NOK, J / K = next / previous step, Ctrl+Enter = save and next test.
      </p>
    </div>
  );
}
