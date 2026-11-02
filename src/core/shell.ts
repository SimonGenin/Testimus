import { killChildren } from "./env.ts";
import { cancelAll } from "./jobs.ts";
import type { Job } from "./types.ts";

export type Shell = { face: string; version?: string; label: string };

export function shellOf(value = process.env.TESTIMUS_SHELL): Shell {
  const m = /^([a-z][a-z0-9-]{0,19})\/([\w.+-]{1,40})$/i.exec((value ?? "").trim());
  if (!m) return { face: "browser", label: "browser" };
  const face = m[1].toLowerCase();
  return { face, version: m[2], label: `${face} ${m[2]}` };
}

export const LOOPBACK = ["localhost", "127.0.0.1", "::1"];

function noProxyOf(vars: NodeJS.ProcessEnv): string {
  const key = Object.keys(vars).find((k) => k.toUpperCase() === "NO_PROXY" && vars[k]);
  return key ? (vars[key] ?? "") : "";
}

export function withLoopbackNoProxy(value: string | undefined): string {
  const have = (value ?? "").split(",").map((s) => s.trim().toLowerCase());
  const missing = LOOPBACK.filter((h) => !have.includes(h));
  if (!missing.length) return value ?? "";
  return value?.trim() ? `${value},${missing.join(",")}` : missing.join(",");
}

// ponytail: Node reads the proxy variables once at start-up; with NODE_USE_ENV_PROXY=1 and HTTP_PROXY set, a plain
// http:// call to llama-server or the core goes to the proxy unless NO_PROXY names the loopback (Node 26 has
// no implicit loopback exemption; HTTPS_PROXY alone leaves http:// calls direct)
export function loopbackProxyGap(vars: NodeJS.ProcessEnv = process.env): string | null {
  if (vars.NODE_USE_ENV_PROXY !== "1") return null;
  if (!(vars.HTTP_PROXY || vars.http_proxy)) return null;
  const list = noProxyOf(vars)
    .split(",")
    .map((s) => s.trim().toLowerCase());
  if (list.includes("*")) return null;
  const missing = LOOPBACK.filter((h) => !list.includes(h) && !(h === "::1" && list.includes("[::1]")));
  return missing.length
    ? `NO_PROXY does not list ${missing.join(", ")}: calls to the local model servers go to the proxy`
    : null;
}

export type StopOpts = {
  graceMs?: number;
  closeServer?(): void;
  dropConnections?(): void;
  exit(code: number): void;
};

export type Stopped = { jobs: Job[]; killed: number[] };

// ponytail: the order matters — no new request, then every job told to stop (its claude tree killed by the abort),
// then any claude still alive outside a job, then the local model servers; a hard deadline covers a stuck step
export async function stopCore(o: StopOpts): Promise<Stopped> {
  const grace = o.graceMs ?? 5000;
  const force = setTimeout(() => o.exit(1), grace + 1000);
  try {
    o.closeServer?.();
    const cancelled = cancelAll(grace);
    const killed = killChildren();
    const jobs = await cancelled;
    killed.push(...killChildren().filter((p) => !killed.includes(p)));
    const { stopAllServers } = await import("./rag/runtimes/llamacpp.ts");
    await Promise.race([stopAllServers().catch(() => {}), new Promise((r) => setTimeout(r, grace).unref())]);
    o.dropConnections?.();
    clearTimeout(force);
    o.exit(0);
    return { jobs, killed };
  } catch (e) {
    clearTimeout(force);
    process.stderr.write(`Stopping Testimus: ${e instanceof Error ? e.message : String(e)}\n`);
    o.exit(1);
    return { jobs: [], killed: [] };
  }
}

export function onParentGone(stdin: NodeJS.ReadableStream, stop: () => void): void {
  stdin.on("end", stop);
  stdin.on("close", stop);
  stdin.on("error", stop);
  stdin.resume();
}

export const STOP_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"];

export function onStopSignals(stop: (signal: NodeJS.Signals) => void): () => void {
  for (const s of STOP_SIGNALS) process.on(s, stop);
  return () => {
    for (const s of STOP_SIGNALS) process.off(s, stop);
  };
}
