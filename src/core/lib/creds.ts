import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import type { CredsStatus } from "../types.ts";

export type JiraCreds = { base: string; baseUrl: string; email: string; token: string };
export type XrayCreds = { apiBase: string; clientId: string; clientSecret: string };

export const JIRA_FILE = "credentials.json";
export const XRAY_FILE = "xray_credentials.json";

export function credsDir(): string {
  return join(env.homeDir(), ".atlassian");
}

function shown(name: string): string {
  return `~/.atlassian/${name}`;
}

function readRaw(name: string): Record<string, unknown> | null {
  const file = join(credsDir(), name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as Record<string, unknown>;
  } catch {
    throw new UserError(`${shown(name)} is not valid JSON.`, `Fix ${shown(name)} or run testimus system setup.`);
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function jiraCreds(): JiraCreds {
  const c = readRaw(JIRA_FILE);
  if (!c) throw new UserError(`Missing ${shown(JIRA_FILE)}.`, "Run testimus system setup to add your Jira access.");
  const baseUrl = str(c.baseUrl);
  const email = str(c.email);
  const token = str(c.token);
  if (!baseUrl || !email || !token)
    throw new UserError(`${shown(JIRA_FILE)} needs baseUrl, email and token.`, "Run testimus system setup.");
  return { base: baseUrl.replace(/\/+$/, "").replace(/\/wiki$/, ""), baseUrl, email, token };
}

export function xrayCreds(): XrayCreds {
  const c = readRaw(XRAY_FILE);
  if (!c) throw new UserError(`Missing ${shown(XRAY_FILE)}.`, "Run testimus system setup to add your Xray access.");
  const clientId = str(c.clientId);
  const clientSecret = str(c.clientSecret);
  if (!clientId || !clientSecret)
    throw new UserError(`${shown(XRAY_FILE)} needs clientId and clientSecret.`, "Run testimus system setup.");
  return { apiBase: (str(c.apiBase) || "https://xray.cloud.getxray.app").replace(/\/+$/, ""), clientId, clientSecret };
}

export function credsStatus(): CredsStatus {
  const j = (() => {
    try {
      return readRaw(JIRA_FILE);
    } catch {
      return {};
    }
  })();
  const x = (() => {
    try {
      return readRaw(XRAY_FILE);
    } catch {
      return {};
    }
  })();
  return {
    jira: {
      file: join(credsDir(), JIRA_FILE),
      exists: j !== null,
      complete: !!(j && str(j.baseUrl) && str(j.email) && str(j.token)),
      baseUrl: j ? str(j.baseUrl) || undefined : undefined,
      email: j ? str(j.email) || undefined : undefined,
    },
    xray: {
      file: join(credsDir(), XRAY_FILE),
      exists: x !== null,
      complete: !!(x && str(x.clientId) && str(x.clientSecret)),
    },
  };
}

// ponytail: these files belong to the user's other Atlassian tools too — merge into what is there, so
// unknown keys (accountId, apiBase) and the /wiki suffix of baseUrl survive
export function saveCreds(jira: Record<string, string>, xray: Record<string, string>): void {
  mkdirSync(credsDir(), { recursive: true });
  for (const [name, patch] of [
    [JIRA_FILE, jira],
    [XRAY_FILE, xray],
  ] as const) {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "string" && v.trim()));
    if (!Object.keys(clean).length) continue;
    let prev: Record<string, unknown> = {};
    try {
      prev = readRaw(name) ?? {};
    } catch {}
    writeFileSync(join(credsDir(), name), `${JSON.stringify({ ...prev, ...clean }, null, 2)}\n`, "utf8");
  }
}
