import * as stylex from "@stylexjs/stylex";
import { errorToast, toast } from "../../lib/toast.ts";
import {
  color,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";

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
  title: {
    margin: 0,
    fontSize: fontSize.title,
    lineHeight: lineHeight.title,
    fontWeight: fontWeight.semibold,
    color: color.text,
  },
  text: { margin: 0, fontSize: fontSize.body, lineHeight: lineHeight.body, color: color.textMuted },
  steps: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    alignSelf: "stretch",
    counterReset: "step",
  },
  step: {
    display: "grid",
    gridTemplateColumns: `${size.controlSm} 1fr`,
    columnGap: space.s3,
    rowGap: space.s2,
    counterIncrement: "step",
    "::before": {
      content: "counter(step)",
      gridRow: "1 / span 3",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: size.controlSm,
      height: size.controlSm,
      borderRadius: radius.full,
      backgroundColor: color.surfaceSunken,
      fontSize: fontSize.small,
      fontWeight: fontWeight.semibold,
      color: color.textMuted,
    },
  },
  stepTitle: { fontSize: fontSize.body, lineHeight: lineHeight.body, fontWeight: fontWeight.semibold },
  cmd: { display: "flex", alignItems: "flex-start", gap: space.s2, minWidth: 0 },
  code: {
    flex: 1,
    minWidth: 0,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    overflowWrap: "anywhere",
  },
  hint: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textSubtle },
  sawLabel: { fontSize: fontSize.small, fontWeight: fontWeight.semibold, color: color.textMuted },
  saw: {
    margin: 0,
    alignSelf: "stretch",
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    color: color.textMuted,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
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

const copy = (cmd: string) =>
  navigator.clipboard
    .writeText(cmd)
    .then(() => toast({ kind: "info", title: "Command copied", detail: cmd }))
    .catch((e) => errorToast(e, "Could not copy the command"));

export function ConnectClaude({
  status,
  checking,
  onCheck,
  onDoctor,
  onSetPath,
}: {
  status: ClaudeStatus;
  checking: boolean;
  onCheck: () => void;
  onDoctor?: () => void;
  onSetPath?: () => void;
}) {
  const installed = status.installed;
  const steps = status.connect?.length ? status.connect : installed ? LOGIN : INSTALL;
  return (
    <div {...stylex.props(styles.panel)}>
      <Badge tone="danger" icon="plug" label={installed ? "Signed out" : "Not connected"} />
      <h3 {...stylex.props(styles.title)}>
        {installed ? "Claude isn't signed in on this PC yet" : "Claude isn't installed on this PC yet"}
      </h3>
      <p {...stylex.props(styles.text)}>
        Claude is optional — everything else works without it. Writing, checking and asking the documents need it.
        Everything else — editing, review, push — works now.
      </p>
      <ol {...stylex.props(styles.steps)}>
        {steps.map((s) => (
          <li key={s.cmd} {...stylex.props(styles.step)}>
            <span {...stylex.props(styles.stepTitle)}>{s.title}</span>
            <span {...stylex.props(styles.cmd)}>
              <code {...stylex.props(styles.code)}>{s.cmd}</code>
              <Button
                size="sm"
                variant="quiet"
                icon="copy"
                iconOnly
                label={`Copy: ${s.cmd}`}
                onClick={() => void copy(s.cmd)}
              />
            </span>
            {s.hint && (
              <span data-testid="connect-hint" {...stylex.props(styles.hint)}>
                {s.hint}
              </span>
            )}
          </li>
        ))}
      </ol>
      {status.detail && (
        <>
          <span {...stylex.props(styles.sawLabel)}>What Testimus saw</span>
          <pre {...stylex.props(styles.saw)}>{status.detail}</pre>
        </>
      )}
      <div {...stylex.props(styles.foot)}>
        <Button
          variant="primary"
          size="sm"
          icon="refresh"
          label={checking ? "Checking…" : "Check again"}
          disabled={checking}
          onClick={onCheck}
        />
        {onSetPath && <Button size="sm" label="Set the path myself…" onClick={onSetPath} />}
        {onDoctor && <Button size="sm" variant="quiet" icon="doctor" label="Open system check" onClick={onDoctor} />}
      </div>
    </div>
  );
}
