import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { type Command, command, UserError } from "../command.ts";
import { env } from "../env.ts";
import { credsStatus, saveCreds } from "../lib/creds.ts";
import { jiraCheck, runDoctor, xrayCheck } from "../lib/doctor.ts";
import { catalogEntry } from "../lib/models-catalog.ts";
import { pull } from "../lib/models-install.ts";
import { readSettings, writeSettings } from "../lib/project.ts";
import { shellOf } from "../shell.ts";
import type { Settings } from "../types.ts";

const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string };

const check = z.object({
  id: z.string(),
  label: z.string(),
  state: z.enum(["ok", "warn", "fail", "skip"]),
  detail: z.string(),
  fix: z.string().optional(),
});

const status = z.object({
  jira: z.object({
    file: z.string(),
    exists: z.boolean(),
    complete: z.boolean(),
    baseUrl: z.string().optional(),
    email: z.string().optional(),
  }),
  xray: z.object({ file: z.string(), exists: z.boolean(), complete: z.boolean() }),
});

const settingsOut = z.object({
  projects: z.array(z.string()),
  lastProject: z.string(),
  theme: z.enum(["system", "light", "dark"]),
  stepLayout: z.enum(["stacked", "split"]),
  claude: z.object({ exe: z.string() }),
  models: z.object({ allowRemote: z.boolean() }),
});

export function siteUrl(site: string, previous?: string): string {
  const s = site.trim().replace(/\/+$/, "");
  const url = /^https?:\/\//i.test(s) ? s : /\./.test(s) ? `https://${s}` : `https://${s}.atlassian.net`;
  const base = url.replace(/\/wiki$/, "");
  const prevBase = previous
    ?.trim()
    .replace(/\/+$/, "")
    .replace(/\/wiki$/, "");
  if (previous && prevBase === base) return previous.trim();
  return /\.atlassian\.net$/i.test(base) ? `${base}/wiki` : url;
}

export function checkedExe(raw: string): string {
  const exe = raw.trim();
  if (!exe) return "";
  if (!/\.(exe|cmd|bat)$/i.test(exe) || !isAbsolute(exe) || !existsSync(exe) || /[&|<>^%!"\r\n]/.test(exe))
    throw new UserError(
      "claude.exe must be the full path of an existing claude.exe or claude.cmd.",
      "Leave it empty to use claude from PATH.",
    );
  return exe;
}

const ATLASSIAN = /^https:\/\/[a-z0-9-]+\.atlassian\.net(\/wiki)?\/?$/i;
const XRAY = /^https:\/\/([a-z0-9-]+\.)*getxray\.app\/?$/i;

export const commands: Command[] = [
  command({
    name: "system.version",
    summary: "Testimus and Node versions.",
    input: z.object({}),
    output: z.object({
      version: z.string(),
      node: z.string(),
      mock: z.boolean(),
      shell: z.string().describe("Which face runs this core: browser, or desktop <version> (TESTIMUS_SHELL)"),
    }),
    mutates: false,
    global: true,
    async run() {
      return { version: pkg.version, node: process.version, mock: env.mock, shell: shellOf().label };
    },
  }),

  command({
    name: "system.setup",
    summary:
      "Jira/Xray credentials: with no input, which files exist and are complete; with values, merges them into ~/.atlassian and checks them read-only.",
    input: z.object({
      site: z
        .string()
        .optional()
        .describe("Jira site: tenant name, host or URL (https://<tenant>.atlassian.net; /wiki is added and kept)."),
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
      check: z
        .boolean()
        .optional()
        .describe("Run the read-only checks (Jira myself, Xray authenticate) even with no new values."),
      otherHost: z
        .boolean()
        .optional()
        .describe("Accept a Jira site outside *.atlassian.net or an Xray API outside *.getxray.app (https only)."),
    }),
    output: z.object({
      status,
      saved: z.array(z.string()).describe("Fields written (names only, never values)."),
      checks: z.array(check),
      ok: z.boolean(),
    }),
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
      const saved = [...Object.keys(jira), ...Object.keys(xray)];
      if (saved.length) saveCreds(jira, xray);
      const st = credsStatus();
      const checks =
        saved.length || input.check
          ? await Promise.all([
              st.jira.exists || Object.keys(jira).length ? jiraCheck(10000) : null,
              st.xray.exists || Object.keys(xray).length ? xrayCheck(10000) : null,
            ]).then((r) => r.filter((c) => c !== null))
          : [];
      const ok = st.jira.complete && st.xray.complete && checks.every((c) => c.state === "ok");
      return { status: st, saved, checks, ok };
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
    output: z.object({ ok: z.boolean(), checks: z.array(check) }),
    mutates: false,
    global: true,
    async run(ctx, input) {
      const checks = await runDoctor({ project: ctx.project, claude: input.claude === true });
      return { ok: checks.every((c) => c.state !== "fail"), checks };
    },
  }),

  command({
    name: "system.pullModel",
    summary: "Alias of models.pull for a v1 profile name (bge-m3, qwen3-embedding-0.6b, bge-reranker-v2-m3).",
    input: z.object({ profile: z.string().describe("Profile name (v1) or catalog id, e.g. bge-m3.") }),
    output: z.object({ profile: z.string(), hfId: z.string(), dir: z.string(), where: z.string() }),
    mutates: true,
    job: "pullModel",
    global: true,
    positional: ["profile"],
    subject: (input) => input.profile,
    async run(ctx, input) {
      const e = catalogEntry(input.profile);
      if (!e?.source.hf)
        throw new UserError(`Unknown model profile ${input.profile}.`, "testimus models catalog lists the models.");
      const r = await pull(ctx, { model: e.id, via: "download" });
      return { profile: input.profile, hfId: e.source.hf.repo, dir: r.where, where: r.via };
    },
  }),

  command({
    name: "system.settings",
    summary: "Global settings (%APPDATA%\\Testimus\\settings.json): theme, step layout, claude.exe, model downloads.",
    input: z.object({}),
    output: settingsOut,
    mutates: false,
    global: true,
    async run() {
      return readSettings();
    },
  }),

  command({
    name: "system.saveSettings",
    summary: "Changes global settings; fields left out keep their value.",
    input: z.object({
      theme: z.enum(["system", "light", "dark"]).optional().describe("UI theme."),
      stepLayout: z.enum(["stacked", "split"]).optional().describe("How a step's fields are laid out in the editor."),
      claudeExe: z.string().optional().describe("Path to claude(.exe/.cmd); empty = find claude on PATH."),
      allowRemote: z
        .boolean()
        .optional()
        .describe("Allow model downloads from Hugging Face (false behind a blocking proxy)."),
    }),
    output: settingsOut,
    mutates: true,
    global: true,
    async run(_ctx, input) {
      const s: Settings = readSettings();
      if (input.theme) s.theme = input.theme;
      if (input.stepLayout) s.stepLayout = input.stepLayout;
      if (input.claudeExe !== undefined) s.claude = { ...s.claude, exe: checkedExe(input.claudeExe) };
      if (input.allowRemote !== undefined) s.models = { ...s.models, allowRemote: input.allowRemote };
      writeSettings(s);
      return s;
    },
  }),
];
