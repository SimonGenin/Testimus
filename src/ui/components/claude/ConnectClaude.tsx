import { errorToast, toast } from "../../lib/toast.ts";
import { Button } from "../ui/index.ts";

export type ClaudeStatus = {
  installed: boolean;
  version?: string;
  exe?: string;
  signedIn: boolean | null;
  detail?: string;
  diagnosis?: { kind: string; title: string; detail: string };
  connect?: { title: string; cmd: string; hint: string }[];
};

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
}: {
  status: ClaudeStatus;
  checking: boolean;
  onCheck: () => void;
  onDoctor: () => void;
}) {
  const installed = status.installed;
  const steps = status.connect?.length ? status.connect : installed ? LOGIN : INSTALL;
  return (
    <div className="connect">
      <h3 className="h connect-title">
        {installed ? "Claude isn't signed in on this PC yet" : "Claude isn't installed on this PC yet"}
      </h3>
      <p>Writing, checking and asking the documents need it. Everything else — editing, review, push — works now.</p>
      <ol className="connect-steps">
        {steps.map((s) => (
          <li key={s.cmd}>
            <span className="connect-step-title">{s.title}</span>
            <span className="connect-cmd">
              <code className="code">{s.cmd}</code>
              <Button size="sm" tone="quiet" aria-label={`Copy: ${s.cmd}`} onClick={() => void copy(s.cmd)}>
                Copy
              </Button>
            </span>
            {s.hint && <span className="muted connect-hint">{s.hint}</span>}
          </li>
        ))}
      </ol>
      {status.detail && <p className="muted connect-hint">{status.detail}</p>}
      <div className="connect-foot">
        <Button disabled={checking} onClick={onCheck}>
          {checking ? "Checking…" : "Check again"}
        </Button>
        <Button tone="quiet" onClick={onDoctor}>
          Open system check
        </Button>
      </div>
    </div>
  );
}
