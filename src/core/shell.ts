import tls from "node:tls";
import { LOOPBACK } from "../shared/loopback.ts";
import { killChildren } from "../shared/run/process.ts";
import { scope, sleep, timeout } from "../shared/run/work.ts";
import { cancelAll } from "./jobs.ts";
import type { Job } from "./types.ts";

export type Shell = { face: string; version?: string; label: string };

export function shellOf(value = process.env.TESTIMUS_SHELL): Shell {
  const m = /^([a-z][a-z0-9-]{0,19})\/([\w.+-]{1,40})$/i.exec((value ?? "").trim());
  if (!m) return { face: "browser", label: "browser" };
  const face = m[1].toLowerCase();
  return { face, version: m[2], label: `${face} ${m[2]}` };
}

function noProxyOf(vars: NodeJS.ProcessEnv): string {
  const key = Object.keys(vars).find((k) => k.toUpperCase() === "NO_PROXY" && vars[k]);
  return key ? (vars[key] ?? "") : "";
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

// ponytail: a company proxy that inspects HTTPS re-signs the connection with a root IT put in the Windows store (a
// FortiGate on xray.cloud.getxray.app at Transurb); Node trusts only its own roots unless told, so the core adds the
// system's at start-up, whatever launched it (shortcut, testimus.cmd, npm, claude -p for mcp)
export function trustSystemCertificates(t: Pick<typeof tls, "getCACertificates" | "setDefaultCACertificates"> = tls) {
  const system = t.getCACertificates("system");
  if (system.length) t.setDefaultCACertificates([...new Set([...t.getCACertificates("default"), ...system])]);
  return system.length;
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
  return scope(async (s) => {
    sleep(grace + 1000, s.signal).then(
      () => o.exit(1),
      () => {},
    );
    try {
      o.closeServer?.();
      const cancelled = cancelAll(grace);
      const killed = killChildren();
      const jobs = await cancelled;
      killed.push(...killChildren().filter((p) => !killed.includes(p)));
      const { stopAllServers } = await import("./rag/runtimes/llamacpp.ts");
      await timeout(grace, () => stopAllServers()).catch(() => {});
      o.dropConnections?.();
      o.exit(0);
      return { jobs, killed };
    } catch (e) {
      process.stderr.write(`Stopping Testimus: ${e instanceof Error ? e.message : String(e)}\n`);
      o.exit(1);
      return { jobs: [], killed: [] };
    }
  });
}

export const STOP_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"];

export function onStopSignals(stop: (signal: NodeJS.Signals) => void): () => void {
  for (const s of STOP_SIGNALS) process.on(s, stop);
  return () => {
    for (const s of STOP_SIGNALS) process.off(s, stop);
  };
}
