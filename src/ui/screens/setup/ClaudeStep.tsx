import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { type ClaudeStatus, ConnectClaude } from "../../components/claude/ConnectClaude.tsx";
import { noteRun, useClaudeStatus } from "../../components/claude/useClaudeStatus.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { invalidate, read } from "../../lib/data/query.ts";
import { message } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { StepCard } from "./StepCard.tsx";

const styles = stylex.create({
  rows: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: space.s4,
    rowGap: space.s4,
  },
  text: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  muted: { color: color.textMuted },
  code: { color: color.textSubtle },
});

type SignIn = { state: "idle" | "checking" } | { state: "done"; status: ClaudeStatus };

// ponytail: Claude is the engine — the step asks `claude --version`, then, once it is there, proves the sign-in with one
// tiny run (a few tokens, once per visit); signed out or missing, it shows how to connect it, and the person may go on
// without it (reading, review and push work)
export function ClaudeStep({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  const client = useQueryClient();
  const { read: probe, status } = useClaudeStatus();
  const [signIn, setSignIn] = useState<SignIn>({ state: "idle" });
  const asked = useRef(false);

  const check = async (again: boolean) => {
    setSignIn({ state: "checking" });
    if (again) await invalidate(client, [["claude.status"]]);
    const base = again ? await read(client, "claude.status", { refresh: true }).catch(() => null) : status;
    if (!base?.installed) {
      setSignIn({ state: "idle" });
      return;
    }
    const r = (await read(client, "claude.status", { signIn: true }).catch(
      (e): ClaudeStatus => ({ installed: true, signedIn: false, detail: message(e) }),
    )) as ClaudeStatus;
    if (r.signedIn) noteRun(client, { ok: true });
    setSignIn({ state: "done", status: r });
  };

  useEffect(() => {
    if (asked.current || !status?.installed) return;
    asked.current = true;
    void check(false);
  });

  const installed = !!status?.installed;
  const done = signIn.state === "done" ? signIn.status : null;
  const signedIn = installed && done?.signedIn === true;
  const signedOut = installed && done !== null && done.signedIn === false;
  const shown: ClaudeStatus | null = !status ? null : signedOut && done ? { ...status, ...done } : status;
  const panel = !!shown && signIn.state !== "checking" && (!installed || signedOut);

  return (
    <StepCard
      id="claude-h"
      title="Claude reads and writes"
      lead="Testimus asks Claude Code, with your own Claude subscription, to write and check the tests. Your documents are sent only inside those runs."
      back={<Button variant="quiet" size="lg" icon="chevron-left" label="Back" onClick={onBack} />}
      actions={
        <>
          {!signedIn && <Button variant="quiet" size="lg" label="Continue without Claude" onClick={onContinue} />}
          <Button
            variant={signedIn ? "primary" : "secondary"}
            size="lg"
            iconAfter="chevron-right"
            label="Continue"
            disabled={!signedIn && "Claude is not signed in yet — or continue without it"}
            onClick={onContinue}
          />
        </>
      }
    >
      {probe.isPending ? (
        <>
          <Skeleton lines={2} />
          <Loading read="claude.status" />
        </>
      ) : (
        <Card sunken>
          <div role="status" aria-live="polite" {...stylex.props(styles.rows)}>
            {installed ? (
              <Badge label="Found" tone="success" icon="check-circle" />
            ) : (
              <Badge label="Not found" tone="danger" icon="x-circle" />
            )}
            <span {...stylex.props(type.compact, type.strong)}>
              {installed ? "Claude Code is installed" : "Claude Code is not installed"}
            </span>
            <span {...stylex.props(type.code, styles.code)}>{status?.version ?? ""}</span>
            {installed && (
              <>
                {signIn.state === "checking" ? (
                  <Badge label="Checking" tone="neutral" busy />
                ) : signedIn ? (
                  <Badge label="Signed in" tone="success" icon="check-circle" />
                ) : signedOut ? (
                  <Badge label="Signed out" tone="warning" icon="alert-triangle" />
                ) : (
                  <Badge label="Not checked" tone="neutral" />
                )}
                <span {...stylex.props(styles.text)}>
                  <span {...stylex.props(type.compact, type.strong)}>
                    {signedIn ? "Claude answers with your subscription" : "Signed in to Claude"}
                  </span>
                  {signIn.state === "checking" && (
                    <span {...stylex.props(type.small, styles.muted)}>One tiny run, a few seconds…</span>
                  )}
                </span>
                {panel ? (
                  <span />
                ) : (
                  <Button
                    size="sm"
                    icon="refresh"
                    label="Check again"
                    disabled={signIn.state === "checking"}
                    onClick={() => void check(true)}
                  />
                )}
              </>
            )}
          </div>
        </Card>
      )}
      {panel && shown && (
        <ConnectClaude look="panel" status={shown} checking={false} onCheck={() => void check(true)} />
      )}
    </StepCard>
  );
}
