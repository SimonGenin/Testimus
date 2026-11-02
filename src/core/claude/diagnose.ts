import type { Diagnosis } from "../types.ts";

const SAYS: Record<Exclude<Diagnosis["kind"], "other">, { title: string; detail: string }> = {
  connect: {
    title: "Claude Code is not installed or not found.",
    detail: "Install the Claude Code CLI, sign in once in a terminal, or set its path in Settings.",
  },
  login: {
    title: "Claude Code is not signed in.",
    detail: "Run `claude` once in a terminal and sign in with your Claude account, then retry.",
  },
  credit: {
    title: "Your Claude account has no credit left.",
    detail: "Check the plan or the billing of the account Claude Code is signed in with.",
  },
  limit: {
    title: "Claude usage limit reached.",
    detail: "Wait until the limit resets (the message below says when), then retry.",
  },
  network: {
    title: "Claude could not be reached.",
    detail: "Check the network or the proxy (HTTPS_PROXY), then retry. Overloaded servers clear up in minutes.",
  },
};

// ponytail: the CLI's own words are kept and shown, but they are a developer's words — this says
// which of the five things went wrong so the UI can offer the one action that fixes it
export function trouble(text: string): keyof typeof SAYS | null {
  const t = text.toLowerCase();
  if (/not found on path|enoent|is not recognized|no such file/.test(t)) return "connect";
  if (
    /\/login|log in|logged out|not logged in|invalid api key|api key|unauthorized|authentication|401|403|token has expired|oauth/.test(
      t,
    )
  )
    return "login";
  if (/credit balance|insufficient|billing|payment|quota exceeded|purchase/.test(t)) return "credit";
  if (/usage limit|rate limit|too many requests|429|resets at|try again later/.test(t)) return "limit";
  if (
    /enotfound|econnrefused|etimedout|econnreset|network|fetch failed|connection error|offline|overloaded|502|503|529|proxy|certificate/.test(
      t,
    )
  )
    return "network";
  return null;
}

export function diagnose(text: string): Diagnosis | undefined {
  const kind = trouble(text);
  return kind ? { kind, ...SAYS[kind] } : undefined;
}
