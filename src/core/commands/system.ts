import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { type ProbeDeps, probeAgents, probeDeps } from "../claude/limits.ts";
import { command, projectOf, UserError } from "../command.ts";
import { env } from "../env.ts";
import { AGENTS_CAP, AGENTS_DEFAULT, clampAgents } from "../lib/agents.ts";
import { readChangelog, UNRELEASED } from "../lib/changelog.ts";
import { credsStatus, saveCreds, savedSecrets } from "../lib/creds.ts";
import { jiraCheck, runDoctor, xrayCheck } from "../lib/doctor.ts";
import { readSettings, writeSettings } from "../lib/project.ts";
import { readUpdates, update } from "../lib/updates.ts";
import { indexFile } from "../rag/db.ts";
import { shellOf } from "../shell.ts";
import type { DoctorCheck, Settings } from "../types.ts";

const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string };

// ponytail: how system.testAgents starts its agents — the real project's MCP servers, or a simulated PC that --mock
// installs here (env carries the outside world; this is one command's own measuring rig, swapped by the mock only)
export const agentProbe: { deps(project: string): ProbeDeps } = { deps: probeDeps };

const check = z.object({
  id: z.string().describe("Stable id of the check, e.g. jira"),
  label: z.string().describe("What is checked, in words"),
  state: z.enum(["ok", "warn", "fail", "skip"]).describe("ok, warn (works, but…), fail, or skip (not checked)"),
  detail: z.string().describe("What was found"),
  fix: z.string().optional().describe("What to do about it"),
  action: z
    .object({
      label: z.string().describe("Button text in the UI"),
      command: z.string().describe("The command that fixes the row, e.g. models.verify"),
      input: z.record(z.string(), z.unknown()).optional().describe("Its input; a value the user picks is left out"),
      value: z.string().optional().describe("The value in place now, where a picker starts"),
    })
    .optional()
    .describe("The command that fixes this row, shown as a button by the UI"),
  also: z
    .object({
      label: z.string().describe("Button text in the UI"),
      command: z.string().describe("The command, e.g. models.acceptFit"),
    })
    .optional()
    .describe("A second way out, beside the fix (e.g. Use anyway)"),
  caution: z.string().optional().describe("On an ok row: what still deserves a look (e.g. Used anyway)"),
});

const file = {
  file: z.string().describe("The credential file's path"),
  exists: z.boolean().describe("The file is there"),
  complete: z.boolean().describe("It holds every field the connection needs"),
};
const status = z
  .object({
    jira: z.object({
      ...file,
      invalid: z.boolean().optional().describe("The file is there but broken JSON or missing a field"),
      problem: z.string().optional().describe("What is wrong with it, e.g. missing token"),
      baseUrl: z.string().optional().describe("The Jira site saved"),
      email: z.string().optional().describe("The Atlassian account saved"),
    }),
    xray: z.object({
      ...file,
      invalid: z.boolean().optional().describe("The file is there but broken JSON or missing a field"),
      problem: z.string().optional().describe("What is wrong with it, e.g. missing clientSecret"),
    }),
  })
  .describe("The credential files in ~/.atlassian (never the secrets)");

const measure = z.object({
  limit: z.number().describe("The most agents that held"),
  at: z.string().describe("When the test ran (ISO)"),
  reason: z.string().describe("Why the test stopped there"),
  levels: z
    .array(
      z.object({
        agents: z.number().describe("Agents running at that level"),
        cpu: z.number().describe("Busy share of all the cores, 0 to 1"),
        freeMB: z.number().describe("Free memory, MB"),
        searchMs: z.number().describe("Median time of a search"),
      }),
    )
    .describe("Each level the test went through"),
});

const settingsOut = z.object({
  projects: z.array(z.string()).describe("Known project folders, most recent first"),
  lastProject: z.string().describe("The project opened last"),
  claude: z.object({ exe: z.string().describe("Path to claude(.exe/.cmd); empty = claude from PATH") }),
  models: z.object({ allowRemote: z.boolean().describe("Model downloads from Hugging Face are allowed") }),
  agents: z
    .object({
      max: z.number().optional().describe("The most Claude runs at the same time"),
      adaptive: z.boolean().optional().describe("Start with 2 runs and add one while the PC has room"),
      measured: measure.optional().describe("The last test of this PC's limits (system.testAgents)"),
    })
    .optional()
    .describe(`Claude runs at the same time: max (default ${AGENTS_DEFAULT}), adaptive (default true)`),
  atlassian: z
    .object({
      skipJira: z.boolean().optional().describe("The user works without Jira on this PC: its check says not used"),
      skipXray: z.boolean().optional().describe("The user works without Xray on this PC: its check says not used"),
    })
    .optional()
    .describe("Jira or Xray left out on purpose (first launch); cleared once its connection works"),
  ui: z
    .record(z.string(), z.string())
    .optional()
    .describe("The page's own preferences (widths, layout…), kept here so a new page origin finds them"),
  updates: z
    .object({
      from: z.string().optional().describe("The update folder; empty = the folder Testimus was installed from"),
    })
    .optional()
    .describe("Where new versions are looked for"),
});

const release = z.object({
  version: z.string().describe("Its version"),
  folder: z.string().describe("The release folder (its install.ps1 installs it)"),
  notes: z.string().describe("What is new, from its release.json; empty if none"),
  built: z.string().describe("When it was built (ISO); empty if unknown"),
});

const entry = z.object({
  version: z.string().describe("The version, or Unreleased for what is committed but not published yet"),
  date: z.string().describe("When it was published (YYYY-MM-DD); empty if not yet"),
  items: z.array(z.string()).describe("What changes for the team, one line each"),
});

const verdict = {
  status,
  checks: z.array(check).describe("The read-only checks run (Jira myself, Xray authenticate)"),
  ok: z.boolean().describe("Both files complete and every check passed"),
};

// ponytail: whatever people paste — "transurb", a host, any page URL, http or https — becomes the site root over https
// (Xray Editor's siteUrl): a typed /wiki is kept, an unchanged site keeps the exact spelling already in the file
export function siteUrl(site: string, previous?: string): string {
  let s = site.trim().replace(/\s+/g, "");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let url = s;
  try {
    const u = new URL(s);
    const host = u.hostname.includes(".") ? u.hostname : `${u.hostname}.atlassian.net`;
    url = `https://${host}${/^\/wiki(\/|$)/.test(u.pathname) ? "/wiki" : ""}`;
  } catch {}
  const base = url.replace(/\/wiki$/, "");
  const prevBase = previous
    ?.trim()
    .replace(/\/+$/, "")
    .replace(/\/wiki$/, "");
  if (previous && prevBase === base) return previous.trim();
  return url;
}

export function checkedExe(raw: string): string {
  const exe = raw.trim();
  if (!exe) return "";
  // ponytail: the path is kept as typed, even one that does not run — the Claude status then says ✕ not found and shows
  // how to install (Xray Editor); only characters cmd.exe would read as commands are refused, the path reaches a shell
  if (/[&|<>^%!"\r\n]/.test(exe))
    throw new UserError(
      'That Claude program path holds characters a command line would run (& | < > ^ % ! ").',
      "Give the plain path of claude.exe or claude.cmd, or leave it empty to use claude from PATH.",
    );
  return exe;
}

const ATLASSIAN = /^https:\/\/[a-z0-9-]+\.atlassian\.net(\/wiki)?\/?$/i;
const XRAY = /^https:\/\/([a-z0-9-]+\.)*getxray\.app\/?$/i;

async function checksFor(jira: boolean, xray: boolean): Promise<DoctorCheck[]> {
  const r = await Promise.all([jira ? jiraCheck() : null, xray ? xrayCheck() : null]);
  return r.filter((c) => c !== null);
}

// ponytail: a service left out at the first launch is used again as soon as its connection works
function clearSkips(checks: DoctorCheck[]): void {
  const s = readSettings();
  const works = (id: string) => checks.some((c) => c.id === id && c.state === "ok");
  const a = { ...s.atlassian };
  if (a.skipJira && works("jira")) delete a.skipJira;
  if (a.skipXray && works("xray")) delete a.skipXray;
  if (a.skipJira === s.atlassian?.skipJira && a.skipXray === s.atlassian?.skipXray) return;
  writeSettings({ ...s, atlassian: a });
}

const verdictOf = (checks: DoctorCheck[]) => {
  const st = credsStatus();
  return { status: st, checks, ok: st.jira.complete && st.xray.complete && checks.every((c) => c.state === "ok") };
};

export const commands = [
  command({
    name: "system.version",
    summary: "Testimus and Node versions.",
    input: z.object({}),
    output: z.object({
      version: z.string().describe("Testimus version"),
      node: z.string().describe("Node version"),
      mock: z.boolean().describe("Running under --mock"),
      shell: z.string().describe("Which face runs this core: browser, or desktop <version> (TESTIMUS_SHELL)"),
    }),
    mutates: false,
    global: true,
    async run() {
      return { version: pkg.version, node: process.version, mock: env.mock, shell: shellOf().label };
    },
  }),
  command({
    name: "system.secrets",
    summary:
      "The saved Jira API token and Xray Client ID / secret, for the connection form to show back (never offered to Claude runs).",
    input: z.object({}),
    output: z.object({
      token: z.string().describe("Jira API token in ~/.atlassian/credentials.json (empty when missing)"),
      clientId: z.string().describe("Xray Client ID in ~/.atlassian/xray_credentials.json"),
      clientSecret: z.string().describe("Xray Client secret in ~/.atlassian/xray_credentials.json"),
    }),
    mutates: false,
    global: true,
    mcp: false,
    async run() {
      return savedSecrets();
    },
  }),
  command({
    name: "system.credentials",
    summary:
      "The Jira/Xray credential files: which exist and are complete (never the secrets); with check, also the read-only checks (Jira myself, Xray authenticate).",
    input: z.object({
      check: z.boolean().optional().describe("Also run the read-only checks against Jira and Xray (network)."),
    }),
    output: z.object(verdict),
    mutates: false,
    global: true,
    async run(_ctx, input) {
      const st = credsStatus();
      return verdictOf(input.check ? await checksFor(st.jira.exists, st.xray.exists) : []);
    },
  }),
  command({
    name: "system.setCredentials",
    summary:
      "Save Jira/Xray credentials into ~/.atlassian (merged with what is there; fields left out are kept), then check both connections, read-only (Jira myself, Xray authenticate).",
    input: z.object({
      site: z
        .string()
        .optional()
        .describe("Jira site: tenant name, host or URL (https://<tenant>.atlassian.net; a typed /wiki is kept)."),
      email: z.string().optional().describe("Atlassian account email."),
      token: z
        .string()
        .optional()
        .describe("Jira API token. Falls back to the TESTIMUS_JIRA_TOKEN environment variable (keeps it off argv)."),
      clientId: z.string().optional().describe("Xray Cloud API client id."),
      clientSecret: z
        .string()
        .optional()
        .describe("Xray Cloud API client secret. Falls back to the TESTIMUS_XRAY_SECRET environment variable."),
      apiBase: z.string().optional().describe("Xray API base when not the default https://xray.cloud.getxray.app."),
      otherHost: z
        .boolean()
        .optional()
        .describe("Accept a Jira site outside *.atlassian.net or an Xray API outside *.getxray.app (https only)."),
      clear: z
        .array(z.enum(["email", "token", "clientId", "clientSecret"]))
        .optional()
        .describe("Fields to erase from the credential files (the form sends a field the user emptied)."),
    }),
    output: z.object({ ...verdict, saved: z.array(z.string()).describe("Fields written (names only, never values).") }),
    mutates: true,
    global: true,
    async run(_ctx, input) {
      const token = input.token ?? process.env.TESTIMUS_JIRA_TOKEN;
      const clientSecret = input.clientSecret ?? process.env.TESTIMUS_XRAY_SECRET;
      const jira: Record<string, string> = {};
      const xray: Record<string, string> = {};
      if (input.site?.trim()) jira.baseUrl = siteUrl(input.site, credsStatus().jira.baseUrl);
      if (jira.baseUrl && !(ATLASSIAN.test(jira.baseUrl) || (input.otherHost && jira.baseUrl.startsWith("https://"))))
        throw new UserError(
          `${jira.baseUrl} is not an Atlassian Cloud site.`,
          "Give https://<tenant>.atlassian.net, or confirm another https site with otherHost.",
        );
      if (input.email?.trim()) jira.email = input.email.trim();
      if (token?.trim()) jira.token = token.trim();
      if (input.clientId?.trim()) xray.clientId = input.clientId.trim();
      if (clientSecret?.trim()) xray.clientSecret = clientSecret.trim();
      if (input.apiBase?.trim()) xray.apiBase = input.apiBase.trim().replace(/\/+$/, "");
      if (xray.apiBase && !(XRAY.test(xray.apiBase) || (input.otherHost && xray.apiBase.startsWith("https://"))))
        throw new UserError(
          `${xray.apiBase} is not an Xray Cloud address.`,
          "Leave it empty for https://xray.cloud.getxray.app, or confirm another https address with otherHost.",
        );
      for (const k of input.clear ?? []) {
        if (k === "email" || k === "token") jira[k] = "";
        else xray[k] = "";
      }
      const saved = [...Object.keys(jira), ...Object.keys(xray)];
      if (saved.length) saveCreds(jira, xray);
      const st = credsStatus();
      const checks = await checksFor(st.jira.exists, st.xray.exists);
      clearSkips(checks);
      return { ...verdictOf(checks), saved };
    },
  }),
  command({
    name: "system.doctor",
    summary:
      "Checks this PC: native modules, Claude CLI, Jira/Xray access, models, disk, proxy — one row per check, with what to do.",
    input: z.object({
      claude: z
        .boolean()
        .optional()
        .describe("Also run one minimal claude -p to prove the sign-in (takes a few seconds)."),
    }),
    output: z.object({
      ok: z.boolean().describe("No check failed"),
      checks: z.array(check).describe("One row per check"),
    }),
    mutates: false,
    global: true,
    async run(ctx, input) {
      const checks = await runDoctor({ project: ctx.project, claude: input.claude === true });
      return { ok: checks.every((c) => c.state !== "fail"), checks };
    },
  }),
  command({
    name: "system.settings",
    summary:
      "Global settings (%APPDATA%\\Testimus\\settings.json, ~/.config/Testimus/settings.json elsewhere): claude.exe, model downloads, agents at the same time, the page's preferences.",
    input: z.object({}),
    output: settingsOut,
    mutates: false,
    global: true,
    async run() {
      return readSettings();
    },
  }),
  command({
    name: "system.set",
    summary: "Change global settings (settings.json); fields left out keep their value.",
    input: z.object({
      claudeExe: z.string().optional().describe("Path to claude(.exe/.cmd); empty = find claude on PATH."),
      allowRemote: z
        .boolean()
        .optional()
        .describe("Allow model downloads from Hugging Face (false behind a blocking proxy)."),
      agentsMax: z
        .number()
        .int()
        .min(1)
        .max(AGENTS_CAP)
        .optional()
        .describe(`The most Claude runs a generation or a check starts at the same time (default ${AGENTS_DEFAULT}).`),
      agentsAdaptive: z
        .boolean()
        .optional()
        .describe("Start with 2 runs and add one while the CPU and memory have room; start none while the PC is busy."),
      skipJira: z
        .boolean()
        .optional()
        .describe("Work without Jira on this PC: the system check says « not used » instead of failing."),
      skipXray: z
        .boolean()
        .optional()
        .describe("Work without Xray (tests are read, not pushed): its check says « not used » instead of failing."),
      ui: z
        .record(z.string(), z.string())
        .optional()
        .describe("The page's testimus.* preferences, replaced whole (the UI mirrors its localStorage here)."),
      updatesFrom: z
        .string()
        .optional()
        .describe(
          "The folder new versions are looked for in (a team share, e.g. \\\\server\\tools\\Testimus); empty = the folder Testimus was installed from.",
        ),
    }),
    output: settingsOut,
    mutates: true,
    global: true,
    async run(_ctx, input) {
      const s: Settings = readSettings();
      if (input.claudeExe !== undefined) s.claude = { ...s.claude, exe: checkedExe(input.claudeExe) };
      if (input.allowRemote !== undefined) s.models = { ...s.models, allowRemote: input.allowRemote };
      if (input.agentsMax !== undefined) s.agents = { ...s.agents, max: clampAgents(input.agentsMax) };
      if (input.agentsAdaptive !== undefined) s.agents = { ...s.agents, adaptive: input.agentsAdaptive };
      if (input.skipJira !== undefined) s.atlassian = { ...s.atlassian, skipJira: input.skipJira };
      if (input.skipXray !== undefined) s.atlassian = { ...s.atlassian, skipXray: input.skipXray };
      if (input.ui) s.ui = Object.fromEntries(Object.entries(input.ui).filter(([k]) => k.startsWith("testimus.")));
      if (input.updatesFrom !== undefined) {
        const from = input.updatesFrom.trim().replace(/^"(.*)"$/, "$1");
        if (from) s.updates = { ...s.updates, from };
        else delete s.updates;
      }
      writeSettings(s);
      return s;
    },
  }),
  command({
    name: "system.updates",
    summary:
      "Is a newer Testimus in the update folder? Reads the folder (Settings › Updates, else the one Testimus was installed from) and never fails: a folder that cannot be read is told in `problem`.",
    input: z.object({}),
    output: z.object({
      current: z.string().describe("The version running now"),
      installed: z.boolean().describe("This is an installed copy (install.ps1), so it can update itself"),
      pending: z.string().describe("A newer version already installed, waiting for a restart; empty if none"),
      source: z.string().describe("The update folder read; empty if none"),
      sourceFrom: z
        .enum(["settings", "install", "none"])
        .describe("settings: set by hand; install: the folder Testimus was installed from; none"),
      reachable: z.boolean().describe("The folder could be read"),
      problem: z.string().describe("Why no update can be offered (folder missing, unreadable, empty); empty if fine"),
      latest: release.nullable().describe("The newest release in the folder"),
      available: z.boolean().describe("The newest release is newer than what runs (and than what waits)"),
      newer: z.array(entry).describe("The releases of the folder newer than what runs, newest first, with their notes"),
    }),
    mutates: false,
    global: true,
    async run() {
      return readUpdates(pkg.version, readSettings());
    },
  }),
  command({
    name: "system.changelog",
    summary:
      "What changed in each version of Testimus up to the one running (its CHANGELOG.md), newest first; Unreleased on top in a development copy. Newer versions not installed yet are in system.updates (newer).",
    input: z.object({}),
    output: z.object({
      current: z.string().describe("The version running now"),
      entries: z.array(entry).describe("Newest first; Unreleased (when it has lines) before the versions"),
    }),
    mutates: false,
    global: true,
    async run() {
      const entries = readChangelog().filter((e) => e.version !== UNRELEASED || e.items.length);
      return { current: pkg.version, entries };
    },
  }),
  command({
    name: "system.update",
    summary:
      "Installs the newest Testimus of the update folder (or the version given) next to this one with its install.ps1; the new version starts at the next launch (the desktop app offers Restart).",
    input: z.object({
      version: z.string().optional().describe("The version to install; default the newest in the folder"),
    }),
    output: z.object({
      version: z.string().describe("The version installed, current from the next launch"),
      from: z.string().describe("The release folder it came from"),
      previous: z.string().describe("The version running now"),
    }),
    mutates: true,
    global: true,
    job: "update",
    subject: (input) => (input.version ? `Testimus ${input.version}` : "Testimus"),
    async run(ctx, input) {
      return update(ctx, pkg.version, readSettings(), input.version);
    },
  }),
  command({
    name: "system.testAgents",
    summary:
      "Tests how many Claude runs this PC can carry at once: starts the project's Testimus MCP server again and again, each searching the index like an agent, until the CPU, the memory or the search time says stop; saves the limit found as the maximum.",
    input: z.object({
      apply: z.boolean().default(true).describe("Save the limit found as the maximum (agents.max)."),
    }),
    output: measure.extend({ applied: z.boolean().describe("The limit was saved as agents.max") }),
    mutates: true,
    job: "agents-test",
    async run(ctx, input) {
      const project = projectOf(ctx);
      if (!existsSync(indexFile(project)))
        throw new UserError(
          "The project has no index yet: an agent's search is what the test measures.",
          "Index the documents first (Documents screen, or testimus rag index).",
        );
      const m = await probeAgents(ctx, agentProbe.deps(project));
      const applied = input.apply && !ctx.signal.aborted;
      const s = readSettings();
      s.agents = { ...s.agents, ...(applied ? { max: m.limit } : {}), measured: m };
      writeSettings(s);
      ctx.log("info", `Limit: ${m.limit} agent${m.limit > 1 ? "s" : ""} — ${m.reason}`);
      return { ...m, applied };
    },
  }),
];
