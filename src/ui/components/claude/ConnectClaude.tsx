import * as stylex from "@stylexjs/stylex";
import { errorToast, toast } from "../../lib/toast.ts";
import { border, color, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Raw } from "../ui/Raw.tsx";
import { type } from "../ui/type.ts";

export type ClaudeStatus = {
  installed: boolean;
  version?: string;
  exe?: string;
  signedIn: boolean | null;
  detail?: string;
  diagnosis?: { kind: string; title: string; detail: string };
  connect?: { title: string; cmd: string; hint: string }[];
};

const styles = stylex.create({
  panel: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s4 },
  framed: {
    alignSelf: "stretch",
    gap: space.s4,
    padding: space.s5,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
  },
  title: { display: "inline-flex", alignItems: "center", gap: space.s2, margin: 0, color: color.text },
  mark: { display: "inline-flex", color: color.claudeText },
  text: { margin: 0, color: color.textMuted },
  strong: { color: color.text },
  steps: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    alignSelf: "stretch",
  },
  stepsTight: { gap: space.s3 },
  step: { display: "grid", gridTemplateColumns: "1fr", rowGap: space.s2 },
  stepNumbered: { gridTemplateColumns: `${size.controlSm} 1fr`, columnGap: space.s3 },
  num: {
    gridRow: "1 / span 3",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.controlSm,
    height: size.controlSm,
    borderRadius: radius.full,
    backgroundColor: color.surfaceSunken,
    color: color.textMuted,
  },
  stepPanel: { color: color.textMuted },
  cmd: { display: "flex", alignItems: "flex-start", gap: space.s2, minWidth: 0 },
  cmdText: { flex: 1, minWidth: 0 },
  hint: { color: color.textSubtle },
  sawLine: { margin: 0, color: color.textSubtle, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  saw: { display: "flex", flexDirection: "column", gap: space.s2, alignSelf: "stretch" },
  foot: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
});

const INSTALL = [
  {
    title: "Install Claude Code",
    cmd: "npm install -g @anthropic-ai/claude-code",
    hint: "Or the standalone Windows installer from the Claude Code docs.",
  },
  { title: "Sign in once, in a terminal", cmd: "claude", hint: "Type /login and follow the page that opens." },
];

const LOGIN = [
  { title: "Open a terminal and start Claude", cmd: "claude", hint: "It opens with your own subscription." },
  { title: "Sign in", cmd: "/login", hint: "Follow the page that opens, then come back here." },
];

const BACK = {
  title: "Come back and check",
  cmd: "",
  hint: "Testimus runs Claude with your subscription — no API key.",
};

const copy = (cmd: string) =>
  navigator.clipboard
    .writeText(cmd)
    .then(() => toast({ tone: "neutral", title: "Command copied", detail: cmd }))
    .catch((e) => errorToast(e, "Could not copy the command"));

// ponytail: how to connect Claude, drawn three ways by the design — `card` on a screen (Generate: a title with the
// Claude mark, numbered words, the probe's answer on one line), `dock` (a badge, numbered rounds, « What Testimus
// saw »), `panel` in Settings (a sunken box under the program field, which already says what the probe answered)
export function ConnectClaude({
  status,
  checking,
  onCheck,
  onDoctor,
  onSetPath,
  look = "card",
}: {
  status: ClaudeStatus;
  checking: boolean;
  onCheck: () => void;
  onDoctor?: () => void;
  onSetPath?: () => void;
  look?: "card" | "dock" | "panel";
}) {
  const installed = status.installed;
  const dock = look === "dock";
  const panel = look === "panel";
  const listed = status.connect?.length ? status.connect : installed ? LOGIN : INSTALL;
  const toDo = installed ? listed.filter((s) => !/^install/i.test(s.title)) : listed;
  const steps = dock && installed ? [...toDo, BACK] : toDo;
  const numbered = steps.length > 1;
  const saw = dock ? status.detail : status.detail?.split("\n").filter(Boolean).at(-1);
  return (
    <div {...stylex.props(styles.panel, panel && styles.framed)}>
      {dock && <Badge tone="danger" icon="plug" label="Not connected" />}
      <h3 {...stylex.props(dock ? type.title : type.titleSm, styles.title)}>
        {look === "card" && (
          <span {...stylex.props(styles.mark)}>
            <Icon name="claude" />
          </span>
        )}
        {installed ? "Claude is installed but not signed in" : "Claude isn't installed on this PC yet"}
      </h3>
      <p {...stylex.props(dock ? type.body : type.compact, styles.text)}>
        <span {...stylex.props(!dock && type.strong, !dock && styles.strong)}>
          Claude is optional — everything else works without it.
        </span>{" "}
        {look === "card" ? "Writing tests, checking them" : "Writing, checking"} and asking the documents need it;
        editing, review and push work now.
      </p>
      <ol {...stylex.props(styles.steps, !dock && styles.stepsTight)}>
        {steps.map((s, i) => (
          <li key={s.title} {...stylex.props(styles.step, dock && styles.stepNumbered)}>
            {dock && <span {...stylex.props(type.small, type.strong, styles.num)}>{i + 1}</span>}
            <span {...stylex.props(panel ? type.small : type.titleSm, panel && styles.stepPanel)}>
              {!dock && numbered && <span>{i + 1} · </span>}
              {s.title}
            </span>
            {s.cmd && (
              <span {...stylex.props(styles.cmd)}>
                <span {...stylex.props(styles.cmdText)}>
                  <Raw text={s.cmd} />
                </span>
                <Button
                  size="sm"
                  variant="quiet"
                  icon="copy"
                  iconOnly
                  label={`Copy: ${s.cmd}`}
                  onClick={() => void copy(s.cmd)}
                />
              </span>
            )}
            {s.hint && (
              <span data-testid="connect-hint" {...stylex.props(type.small, styles.hint)}>
                {s.hint}
              </span>
            )}
          </li>
        ))}
      </ol>
      {saw &&
        (dock ? (
          <div {...stylex.props(styles.saw)}>
            <span {...stylex.props(type.caption)}>What Testimus saw</span>
            <Raw text={saw} />
          </div>
        ) : (
          !panel && <p {...stylex.props(type.code, styles.sawLine)}>{saw}</p>
        ))}
      <div {...stylex.props(styles.foot)}>
        <Button
          variant={look === "card" ? "secondary" : "primary"}
          size="sm"
          icon="refresh"
          label={checking ? "Checking…" : "Check again"}
          disabled={checking}
          onClick={onCheck}
        />
        {onSetPath && (
          <Button size="sm" variant={dock ? "secondary" : "quiet"} label="Set the path myself…" onClick={onSetPath} />
        )}
        {onDoctor && (
          <Button
            size="sm"
            variant="quiet"
            icon={look === "card" ? undefined : "doctor"}
            label="Open system check"
            onClick={onDoctor}
          />
        )}
      </div>
    </div>
  );
}
