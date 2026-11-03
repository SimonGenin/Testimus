import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import type { CredsStatus } from "../types.ts";
import { writeAtomic } from "./atomic.ts";

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
    throw new UserError(
      `${shown(name)} is not valid JSON.`,
      `Fix ${shown(name)} or run testimus system setCredentials.`,
    );
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// ponytail: the saved secrets, for the connection form to show back (Xray Editor prefills them); a broken file reads empty
export function savedSecrets(): { token: string; clientId: string; clientSecret: string } {
  const safe = (name: string) => {
    try {
      return readRaw(name) ?? {};
    } catch {
      return {};
    }
  };
  const j = safe(JIRA_FILE);
  const x = safe(XRAY_FILE);
  return { token: str(j.token), clientId: str(x.clientId), clientSecret: str(x.clientSecret) };
}

export function jiraCreds(): JiraCreds {
  const c = readRaw(JIRA_FILE);
  if (!c)
    throw new UserError(`Missing ${shown(JIRA_FILE)}.`, "Run testimus system setCredentials to add your Jira access.");
  const baseUrl = str(c.baseUrl);
  const email = str(c.email);
  const token = str(c.token);
  if (!baseUrl || !email || !token)
    throw new UserError(`${shown(JIRA_FILE)} needs baseUrl, email and token.`, "Run testimus system setCredentials.");
  return { base: baseUrl.replace(/\/+$/, "").replace(/\/wiki$/, ""), baseUrl, email, token };
}

export function xrayCreds(): XrayCreds {
  const c = readRaw(XRAY_FILE);
  if (!c)
    throw new UserError(`Missing ${shown(XRAY_FILE)}.`, "Run testimus system setCredentials to add your Xray access.");
  const clientId = str(c.clientId);
  const clientSecret = str(c.clientSecret);
  if (!clientId || !clientSecret)
    throw new UserError(`${shown(XRAY_FILE)} needs clientId and clientSecret.`, "Run testimus system setCredentials.");
  return { apiBase: (str(c.apiBase) || "https://xray.cloud.getxray.app").replace(/\/+$/, ""), clientId, clientSecret };
}

function probe(name: string, keys: string[]): { raw: Record<string, unknown> | null; problem?: string } {
  let raw: Record<string, unknown> | null;
  try {
    raw = readRaw(name);
  } catch {
    return { raw: {}, problem: "not valid JSON" };
  }
  if (raw === null) return { raw };
  if (typeof raw !== "object" || Array.isArray(raw)) return { raw: {}, problem: "not a JSON object" };
  const missing = keys.filter((k) => !str(raw[k]));
  return { raw, problem: missing.length ? `missing ${missing.join(", ")}` : undefined };
}

export function credsStatus(): CredsStatus {
  const j = probe(JIRA_FILE, ["baseUrl", "email", "token"]);
  const x = probe(XRAY_FILE, ["clientId", "clientSecret"]);
  return {
    jira: {
      file: join(credsDir(), JIRA_FILE),
      exists: j.raw !== null,
      complete: j.raw !== null && !j.problem,
      invalid: !!j.problem,
      ...(j.problem ? { problem: j.problem } : {}),
      baseUrl: j.raw ? str(j.raw.baseUrl) || undefined : undefined,
      email: j.raw ? str(j.raw.email) || undefined : undefined,
    },
    xray: {
      file: join(credsDir(), XRAY_FILE),
      exists: x.raw !== null,
      complete: x.raw !== null && !x.problem,
      invalid: !!x.problem,
      ...(x.problem ? { problem: x.problem } : {}),
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
    // ponytail: an empty value is a field the user cleared on purpose (Xray Editor writes the form as it is)
    const cleared = Object.entries(patch)
      .filter(([, v]) => v === "")
      .map(([k]) => k);
    if (!Object.keys(clean).length && !cleared.length) continue;
    let prev: Record<string, unknown> = {};
    try {
      prev = readRaw(name) ?? {};
    } catch {}
    if (!Object.keys(clean).length && !cleared.some((k) => k in prev)) continue;
    const next: Record<string, unknown> = { ...prev, ...clean };
    for (const k of cleared) delete next[k];
    writeAtomic(join(credsDir(), name), `${JSON.stringify(next, null, 2)}\n`);
  }
}
