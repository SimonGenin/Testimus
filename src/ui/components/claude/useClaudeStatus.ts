import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { CommandInput } from "../../../core/commands/index.ts";
import type { JobEvent } from "../../../core/types.ts";
import { useRead } from "../../lib/data/query.ts";
import type { ClaudeStatus } from "./ConnectClaude.tsx";

type Seen = { said: string } | null;

const SEEN = ["claude.signedOut"] as const;

// ponytail: claude.status tells a signed-out Claude only when asked to try a run (signIn, it costs tokens); a run that
// failed on the sign-in says the same for free — the page keeps it until a run works or a check finds Claude signed in
export function noteRun(
  client: QueryClient,
  run: { ok: boolean; diagnosis?: { kind: string } | null; said?: string },
): void {
  if (run.ok) {
    if (client.getQueryData(SEEN)) client.setQueryData(SEEN, null);
    return;
  }
  const seen: Seen = { said: (run.said ?? "").split("\n")[0].trim() };
  if (run.diagnosis?.kind === "login") client.setQueryData(SEEN, seen);
}

// what Claude answered when the run stopped (its result), for « What Testimus saw »
export function claudeSaid(events: JobEvent[]): string {
  const end = events.flatMap((e) => (e.type === "claude" && e.event.type === "result" ? [e.event] : [])).pop();
  return end && !end.ok ? end.text : "";
}

export function withSeen(status: ClaudeStatus | undefined, seen: Seen | undefined): ClaudeStatus | undefined {
  if (!status || !seen || !status.installed || status.signedIn !== null) return status;
  const line = seen.said ? `claude -p: ${seen.said}` : "claude -p: not signed in";
  return { ...status, signedIn: false, detail: [status.detail, line].filter(Boolean).join("\n") };
}

// claude.status as the page knows it: the probe's answer, with the sign-in a failed run has shown
export function useClaudeStatus(input: CommandInput<"claude.status"> = {}) {
  const client = useQueryClient();
  const read = useRead("claude.status", input);
  const seen = useQuery<Seen>({
    queryKey: SEEN,
    queryFn: () => null,
    enabled: false,
    initialData: null,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const signedIn = read.data?.signedIn;
  useEffect(() => {
    if (signedIn === true) noteRun(client, { ok: true });
  }, [signedIn, client]);
  return { read, status: withSeen(read.data as ClaudeStatus | undefined, seen.data) };
}
