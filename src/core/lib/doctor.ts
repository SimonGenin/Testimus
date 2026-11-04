import { tmpdir } from "node:os";
import { LOOPBACK } from "../../shared/loopback.ts";
import { claudeExe } from "../claude/status.ts";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { LEGACY_ORT, legacyOrt, onnxVersion } from "../rag/runtimes/ort.ts";
import { loopbackProxyGap, shellOf } from "../shell.ts";
import type { DoctorAction, DoctorCheck } from "../types.ts";
import { jiraCreds, xrayCreds } from "./creds.ts";
import { type ModelDeps, modelDeps, modelRows } from "./doctor-models.ts";
import { diskCheck, message, row } from "./doctor-row.ts";
import { getMyself, resetAuth, xrayJwt } from "./jira/http.ts";

export type DoctorOpts = {
  project: string | null;
  claude: boolean;
  timeoutMs?: number;
  models?: ModelDeps;
};

const SETUP: DoctorAction = { label: "Connect Atlassian", command: "system.setCredentials" };
const SIGN_IN: DoctorAction = { label: "Check Claude sign-in", command: "system.doctor", input: { claude: true } };
export function nodeCheck(version = process.version): DoctorCheck {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  return major >= 24
    ? row("node", "Node runtime", "ok", version)
    : row("node", "Node runtime", "fail", version, "Run Testimus through testimus.cmd, which uses its own Node 26.");
}

export async function sqliteCheck(): Promise<DoctorCheck> {
  const label = "Index engine (node:sqlite + sqlite-vec + FTS5)";
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const vec = await import("sqlite-vec");
    const db = new DatabaseSync(":memory:", { allowExtension: true });
    try {
      vec.load(db);
      const v = db.prepare("select sqlite_version() as s, vec_version() as v").get() as { s: string; v: string };
      db.exec("create virtual table probe using fts5(t)");
      return row("sqlite", label, "ok", `SQLite ${v.s}, sqlite-vec ${v.v}, FTS5`);
    } finally {
      db.close();
    }
  } catch (e) {
    return row("sqlite", label, "fail", message(e), "Reinstall Testimus: the release folder is incomplete.");
  }
}

export async function onnxCheck(): Promise<DoctorCheck> {
  const label = "Embedding runtime (onnxruntime-node)";
  try {
    return row("onnx", label, "ok", `onnxruntime ${await onnxVersion()}`);
  } catch (e) {
    const fix = legacyOrt()
      ? `On an Intel Mac Testimus needs ${LEGACY_ORT} (onnxruntime-node 1.23.2, the last one built for it): run npm install in the Testimus folder.`
      : process.platform === "win32"
        ? "Reinstall Testimus; if it persists, install the Microsoft Visual C++ Redistributable (x64)."
        : `Reinstall Testimus: onnxruntime-node has no build for ${process.platform} ${process.arch} in this folder.`;
    return row("onnx", label, "fail", message(e), fix);
  }
}

export async function claudeVersionCheck(timeoutMs: number): Promise<DoctorCheck> {
  const label = "Claude Code CLI";
  const exe = claudeExe();
  const fix =
    "Install it: irm https://claude.ai/install.ps1 | iex — or set its path with testimus system set --claude-exe <path>.";
  const exePath: DoctorAction = { label: "Set the Claude program path", command: "system.set" };
  try {
    const out = await env.spawnClaude({
      exe,
      args: ["--version"],
      cwd: tmpdir(),
      stdin: "",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const v = out.stdout.match(/\d+\.\d+\.\d+/)?.[0];
    if (out.code !== 0 || !v) return row("claude", label, "fail", `${exe} not found or not working`, fix, exePath);
    return row("claude", label, "ok", `${exe} ${v}`);
  } catch (e) {
    return row("claude", label, "fail", `${exe}: ${message(e)}`, fix, exePath);
  }
}

export async function claudeLoginCheck(timeoutMs: number): Promise<DoctorCheck> {
  const label = "Claude signed in";
  const fix = "Open a terminal, run claude once and sign in with your Claude subscription.";
  try {
    const out = await env.spawnClaude({
      exe: claudeExe(),
      args: ["-p", "--output-format", "json"],
      cwd: tmpdir(),
      stdin: "Reply with the single word ok.",
      signal: AbortSignal.timeout(timeoutMs),
    });
    let result: { is_error?: boolean; result?: string } = {};
    try {
      result = JSON.parse(out.stdout.trim().split(/\r?\n/).pop() ?? "{}");
    } catch {}
    const text = `${result.result ?? ""} ${out.stderr}`.trim();
    if (out.code === 0 && !result.is_error) return row("claudeLogin", label, "ok", "a minimal claude -p run answered");
    if (/limit|credit|usage/i.test(text))
      return row("claudeLogin", label, "warn", text.slice(0, 200), "Your plan's limit is reached: wait or upgrade.");
    return row("claudeLogin", label, "fail", text.slice(0, 200) || `claude -p exited with ${out.code}`, fix, SIGN_IN);
  } catch (e) {
    return row("claudeLogin", label, "fail", message(e), fix, SIGN_IN);
  }
}

// ponytail: the doctor asks Jira and Xray through the one client (lib/jira/http.ts: its six slots, its 429 wait), with
// the cached sign-in dropped first so a token just saved is the one checked; the client's errors say the status
export async function jiraCheck(): Promise<DoctorCheck> {
  const label = "Jira reachable and authenticated";
  let c: ReturnType<typeof jiraCreds>;
  try {
    c = jiraCreds();
  } catch (e) {
    return row("jira", label, "fail", message(e), e instanceof UserError ? e.fix : undefined, SETUP);
  }
  const host = new URL(c.base).host;
  try {
    resetAuth();
    const me = await getMyself();
    return row("jira", label, "ok", `${me.displayName ?? c.email} on ${host}`);
  } catch (e) {
    const status = /^Jira (\d{3})\b/.exec(message(e))?.[1];
    if (status === "401" || status === "403")
      return row(
        "jira",
        label,
        "fail",
        `Jira ${status} — check ~/.atlassian/credentials.json`,
        "Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens, then testimus system setCredentials --token <token>.",
        SETUP,
      );
    if (status)
      return row(
        "jira",
        label,
        "fail",
        `Jira ${status} on ${host}`,
        "Check the site in ~/.atlassian/credentials.json.",
        SETUP,
      );
    return row(
      "jira",
      label,
      "fail",
      `${host} unreachable: ${message(e)}`,
      "Check the network or the proxy (HTTPS_PROXY).",
    );
  }
}

export async function xrayCheck(): Promise<DoctorCheck> {
  const label = "Xray reachable and authenticated";
  let c: ReturnType<typeof xrayCreds>;
  try {
    c = xrayCreds();
  } catch (e) {
    return row("xray", label, "fail", message(e), e instanceof UserError ? e.fix : undefined, SETUP);
  }
  const host = new URL(c.apiBase).host;
  try {
    resetAuth();
    await xrayJwt(true);
    return row("xray", label, "ok", `authenticated on ${host}`);
  } catch (e) {
    const m = message(e);
    const status = /^Xray 401\b/.test(m)
      ? "401"
      : (/^Xray authentication failed \((\d{3})\)/.exec(m)?.[1] ?? (/empty token/.test(m) ? "200" : undefined));
    if (status === "401" || status === "403")
      return row(
        "xray",
        label,
        "fail",
        "Xray 401 — check ~/.atlassian/xray_credentials.json (client id / secret)",
        "Ask your Jira admin for an Xray API key (client id + secret), then testimus system setCredentials.",
        SETUP,
      );
    if (status) return row("xray", label, "fail", `Xray authentication failed (${status}) on ${host}`, "Retry later.");
    return row("xray", label, "fail", `${host} unreachable: ${m}`, "Check the network or the proxy (HTTPS_PROXY).");
  }
}

export function hideAuth(url: string): string {
  return url.replace(/\/\/[^/@]*@/, "//***@");
}

export function proxyCheck(vars: NodeJS.ProcessEnv = process.env): DoctorCheck {
  const proxy = vars.HTTPS_PROXY || vars.https_proxy || vars.HTTP_PROXY || vars.http_proxy;
  const on = vars.NODE_USE_ENV_PROXY === "1";
  if (!proxy) return row("proxy", "Proxy", "ok", "none (direct connection)");
  const shown = `${hideAuth(proxy)}${vars.NO_PROXY || vars.no_proxy ? `, NO_PROXY=${vars.NO_PROXY || vars.no_proxy}` : ""}`;
  const gap = loopbackProxyGap(vars);
  if (gap)
    return row(
      "proxy",
      "Proxy",
      "fail",
      `${shown}: ${gap}`,
      `Start Testimus through testimus.cmd or the desktop app (they add ${LOOPBACK.join(",")} to NO_PROXY), or add them to NO_PROXY yourself.`,
    );
  if (on) return row("proxy", "Proxy", "ok", `${shown} (used by fetch)`);
  return row(
    "proxy",
    "Proxy",
    "warn",
    `${shown} is set but NODE_USE_ENV_PROXY is not 1: downloads and Jira calls ignore it`,
    "Start Testimus through testimus.cmd, which sets NODE_USE_ENV_PROXY=1.",
  );
}

export async function runDoctor(opts: DoctorOpts): Promise<DoctorCheck[]> {
  const t = opts.timeoutMs ?? 8000;
  const login: Promise<DoctorCheck> = opts.claude
    ? claudeLoginCheck(Math.max(t, 60000))
    : Promise.resolve(
        row(
          "claudeLogin",
          "Claude signed in",
          "skip",
          "not checked",
          "testimus system doctor --claude runs one.",
          SIGN_IN,
        ),
      );
  const rows = await Promise.all([
    nodeCheck(),
    sqliteCheck(),
    onnxCheck(),
    row("face", "Face", "ok", shellOf().label),
    claudeVersionCheck(Math.max(t, 15000)),
    login,
    jiraCheck(),
    xrayCheck(),
    modelRows(opts.project, opts.models ?? modelDeps),
    opts.project
      ? diskCheck("disk.index", "Disk space for the index", opts.project, 1)
      : row("disk.index", "Disk space for the index", "skip", "no project open"),
    proxyCheck(),
  ]);
  return rows.flat();
}
