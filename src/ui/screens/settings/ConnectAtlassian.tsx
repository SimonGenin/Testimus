import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import type { CredsStatus, DoctorCheck } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { execute, invalidate, type Key, read, useRead } from "../../lib/data/query.ts";
import { desktop, openExternal, reveal } from "../../lib/desktop.ts";
import { message } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { color, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Grid, Hint } from "./Section.tsx";

const styles = stylex.create({
  form: { display: "flex", flexDirection: "column", gap: space.s6 },
  step: { display: "flex", gap: space.s4, alignItems: "flex-start" },
  num: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.controlSm,
    height: size.controlSm,
    borderRadius: radius.full,
    backgroundColor: color.surfaceSunken,
    color: color.textMuted,
  },
  col: { display: "flex", flexDirection: "column", gap: space.s3, flex: 1, minWidth: 0 },
  title: { margin: 0 },
  how: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    margin: 0,
    paddingLeft: space.s6,
  },
  foot: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  spacer: { flex: 1 },
  checks: { display: "flex", flexDirection: "column", gap: space.s3 },
  result: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  said: { color: color.text },
  unsaved: { color: color.textMuted },
});

export type SetupResult = CommandOutput<"system.setCredentials">;
/** untested: the check did not run, a field is missing */
export type Word = { ok: boolean; text: string; untested?: true };

const RESULT = {
  ok: { label: "Connected", tone: "success", icon: "check-circle" },
  failed: { label: "Failed", tone: "danger", icon: "x-circle" },
  untested: { label: "Not tested", tone: "warning", icon: "alert-triangle" },
} as const;

export const TOKENS = "https://id.atlassian.com/manage-profile/security/api-tokens";

// ponytail: people paste what their browser shows — "transurb", "transurb.atlassian.net", a whole issue URL — and
// the file wants the site root (the core's siteUrl does the saving; this is only the preview under the field)
export function siteRoot(input: string): string {
  let s = input.trim().replace(/\s+/g, "");
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return s;
  }
  const host = u.hostname.includes(".") ? u.hostname : `${u.hostname}.atlassian.net`;
  return `https://${host}${/^\/wiki(\/|$)/.test(u.pathname) ? "/wiki" : ""}`;
}

const baseOf = (url?: string) =>
  (url ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/wiki$/, "");

// ponytail: an unchanged site keeps the exact value already in the file
export function savedAs(root: string, previous?: string): string {
  if (!root) return "";
  if (previous && baseOf(previous) === baseOf(root)) return previous.trim();
  return root;
}

export function jiraWords(c: DoctorCheck | undefined): Word {
  if (!c || /needs baseUrl|Missing |not valid JSON/.test(c.detail))
    return { ok: false, text: "Fill in the site, the email and the API token first.", untested: true };
  if (c.state === "ok") return { ok: true, text: `Connected as ${c.detail.replace(/ on \S+$/, "")}` };
  if (/Jira 40[13]/.test(c.detail))
    return {
      ok: false,
      text: "Jira refused this email and token. Check the email is the one you log into Jira with, and that the token was copied whole — a token with scopes does not work here: create one without.",
    };
  if (/Jira 404|unreachable/.test(c.detail))
    return {
      ok: false,
      text: `No Jira Cloud site at that address — check the site address, and your network or proxy. (${c.detail.slice(0, 160)})`,
    };
  return { ok: false, text: c.detail };
}

export function xrayWords(c: DoctorCheck | undefined): Word {
  if (!c || /needs clientId|Missing |not valid JSON/.test(c.detail))
    return { ok: false, text: "Fill in the Client ID and the Client Secret first.", untested: true };
  if (c.state === "ok") return { ok: true, text: "Key accepted" };
  if (/Xray 40[13]|authentication failed \(40[0-3]\)/.test(c.detail))
    return {
      ok: false,
      text: "Xray refused this Client ID and Secret. Copy both again from the API key — the secret is shown only once, when the key is created; a lost one means a new key.",
    };
  if (/unreachable/.test(c.detail))
    return { ok: false, text: `Xray did not answer — check your network or proxy. (${c.detail.slice(0, 160)})` };
  return { ok: false, text: c.detail };
}

const open = (url: string) => {
  if (!openExternal(url)) window.open(url, "_blank", "noopener,noreferrer");
};

const dirOf = (file: string) => file.replace(/[\\/][^\\/]+$/, "");

// ponytail: an Xray key is made by a Jira admin — the person sends this, with the exact way to the page
export function adminRequest(email: string, site: string): string {
  return [
    "Hello,",
    "",
    `Could you create an Xray API key for my Jira user${email ? ` (${email})` : ""}${site ? ` on ${site}` : ""}?`,
    "In Jira: Settings → Apps → Xray → API Keys → Create API Key, for my user.",
    "Then send me the Client ID and the Client secret — the secret is shown only once.",
    "",
    "Thank you!",
  ].join("\n");
}

const copyRequest = (text: string) =>
  navigator.clipboard
    .writeText(text)
    .then(() =>
      toast({ tone: "neutral", title: "Request copied", detail: "Paste it in a message to your Jira admin." }),
    )
    .catch((e) => errorToast(e, "Could not copy the request"));

const draft = (f: string): Key => [null, "atlassian", { f }];

// ponytail: what is typed stays a draft until Save and test (« Not saved yet » says so meanwhile); the form sends only
// what changed, and a saved value the user emptied is erased (Xray Editor saves the form as it is)
export function ConnectAtlassian({
  lead,
  saveVariant = "primary",
  onStatus,
  onResult,
}: {
  lead?: ReactNode;
  /** the look of « Save and test the connection »: secondary when the caller's own button is the next step (setup,
   * once the connection is tested) */
  saveVariant?: "primary" | "secondary";
  onStatus?: (s: CredsStatus) => void;
  onResult?: (r: SetupResult) => void;
}) {
  const client = useQueryClient();
  const creds = useRead("system.credentials", {});
  const secrets = useRead("system.secrets", {});
  const status = creds.data?.status ?? null;
  const kept = secrets.data ?? { token: "", clientId: "", clientSecret: "" };
  const [site, setSite, clearSite] = useDraft(draft("site"), status?.jira.baseUrl ?? "");
  const [email, setEmail, clearEmail] = useDraft(draft("email"), status?.jira.email ?? "");
  const [token, setToken, clearToken] = useDraft(draft("token"), kept.token);
  const [clientId, setClientId, clearClientId] = useDraft(draft("clientId"), kept.clientId);
  const [secret, setSecret, clearSecret] = useDraft(draft("secret"), kept.clientSecret);
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState<{ jira: Word; xray: Word } | null>(null);
  const [error, setError] = useState("");
  const told = useRef(onStatus);
  told.current = onStatus;
  useEffect(() => {
    if (status) told.current?.(status);
  }, [status]);

  const root = siteRoot(site);
  const saved = savedAs(root, status?.jira.baseUrl);
  const base = baseOf(root);
  const touched =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setWords(null);
      setError("");
    };

  const save = async () => {
    if (!status) return;
    setBusy(true);
    setError("");
    try {
      const input: Record<string, unknown> = {};
      if (root && saved !== status.jira.baseUrl) {
        input.site = root;
        if (!/\.atlassian\.net(\/|$)/i.test(baseOf(root).replace(/^https?:\/\//, ""))) input.otherHost = true;
      }
      if (email.trim() && email.trim() !== (status.jira.email ?? "")) input.email = email.trim();
      if (token.trim() && token.trim() !== kept.token) input.token = token.trim();
      if (clientId.trim() && clientId.trim() !== kept.clientId) input.clientId = clientId.trim();
      if (secret.trim() && secret.trim() !== kept.clientSecret) input.clientSecret = secret.trim();
      const clear = [
        !email.trim() && status.jira.email ? "email" : "",
        !token.trim() && kept.token ? "token" : "",
        !clientId.trim() && kept.clientId ? "clientId" : "",
        !secret.trim() && kept.clientSecret ? "clientSecret" : "",
      ].filter(Boolean);
      if (clear.length) input.clear = clear;
      const r = await execute(client, "system.setCredentials", input, {
        invalidates: [["system.credentials"], ["system.secrets"]],
      });
      for (const c of [clearSite, clearEmail, clearToken, clearClientId, clearSecret]) c();
      setWords({
        jira: jiraWords(r.checks.find((c) => c.id === "jira")),
        xray: xrayWords(r.checks.find((c) => c.id === "xray")),
      });
      onResult?.(r);
      if (r.saved.length) void invalidate(client, [["system.doctor"]]).then(() => read(client, "system.doctor", {}));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (creds.isError)
    return (
      <Banner tone="danger" title="The access could not be read">
        {creds.error.message}
      </Banner>
    );
  if (!status || secrets.isPending)
    return (
      <>
        <Skeleton lines={5} />
        <Loading read="system.secrets" />
      </>
    );

  const dir = dirOf(status.jira.file);
  const unsaved =
    saved !== (status.jira.baseUrl ?? "").trim() ||
    email.trim() !== (status.jira.email ?? "") ||
    token.trim() !== kept.token ||
    clientId.trim() !== kept.clientId ||
    secret.trim() !== kept.clientSecret;
  return (
    <form
      aria-label="Connect to Jira and Xray"
      {...stylex.props(styles.form)}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {lead && <Hint>{lead}</Hint>}
      <div {...stylex.props(styles.step)}>
        <span {...stylex.props(type.small, type.strong, type.tabular, styles.num)}>1</span>
        <div {...stylex.props(styles.col)}>
          <h3 {...stylex.props(type.titleSm, styles.title)}>Your Jira site and the email you log in with</h3>
          <Grid>
            <Text
              id="setup-site"
              label="Jira site"
              value={site}
              onChange={touched(setSite)}
              placeholder="company.atlassian.net"
              spellCheck={false}
            />
            <Text
              id="setup-email"
              label="Email"
              type="email"
              value={email}
              onChange={touched(setEmail)}
              placeholder="you@company.com"
              spellCheck={false}
            />
          </Grid>
          <Hint>
            {saved && saved !== site.trim() ? (
              <>
                Will be saved as <span {...stylex.props(type.code)}>{saved}</span>
              </>
            ) : (
              "The address in your browser when you open Jira — just the site, any page of it works."
            )}
          </Hint>
        </div>
      </div>

      <div {...stylex.props(styles.step)}>
        <span {...stylex.props(type.small, type.strong, type.tabular, styles.num)}>2</span>
        <div {...stylex.props(styles.col)}>
          <h3 {...stylex.props(type.titleSm, styles.title)}>A Jira API token</h3>
          <ol {...stylex.props(type.compact, styles.how)}>
            <li>
              Open your Atlassian account's token page{" "}
              <Button size="sm" icon="external" label="Open API tokens" onClick={() => open(TOKENS)} />
            </li>
            <li>
              <strong>Create API token</strong> — the plain one, not “with scopes” (a scoped token does not work here);
              name it, pick the longest expiry.
            </li>
            <li>Copy it and paste it below: it is shown only once.</li>
          </ol>
          <Text
            id="setup-token"
            label="API token"
            type="password"
            value={token}
            onChange={touched(setToken)}
            spellCheck={false}
            placeholder={status.jira.complete ? "Saved — leave empty to keep it" : ""}
          />
        </div>
      </div>

      <div {...stylex.props(styles.step)}>
        <span {...stylex.props(type.small, type.strong, type.tabular, styles.num)}>3</span>
        <div {...stylex.props(styles.col)}>
          <h3 {...stylex.props(type.titleSm, styles.title)}>An Xray API key — Client ID and Client secret</h3>
          <ol {...stylex.props(type.compact, styles.how)}>
            <li>
              In Jira, <Icon name="settings" size="sm" />{" "}
              <strong>Settings → Apps → Xray → API Keys → Create API Key</strong>, for your own user{" "}
              {base && (
                <Button
                  size="sm"
                  icon="external"
                  label="Open Jira apps"
                  onClick={() => open(`${base}/plugins/servlet/upm`)}
                />
              )}
            </li>
            <li>Copy the Client ID and the Client secret below — the secret is shown only once.</li>
            <li>
              Only a Jira admin sees that page: if you are not one, ask yours for a key made for your user{" "}
              <Button
                size="sm"
                icon="copy"
                label="Copy a request for my admin"
                onClick={() => void copyRequest(adminRequest(email.trim(), base))}
              />
            </li>
          </ol>
          <Grid>
            <Text
              id="setup-cid"
              label="Client ID"
              value={clientId}
              onChange={touched(setClientId)}
              spellCheck={false}
              placeholder={status.xray.exists ? "Saved — leave empty to keep it" : ""}
            />
            <Text
              id="setup-secret"
              label="Client secret"
              type="password"
              value={secret}
              onChange={touched(setSecret)}
              spellCheck={false}
              placeholder={status.xray.complete ? "Saved — leave empty to keep it" : ""}
            />
          </Grid>
        </div>
      </div>

      <div {...stylex.props(styles.foot)}>
        <Button
          type="submit"
          variant={saveVariant}
          icon="plug"
          label={busy ? "Testing…" : "Save and test the connection"}
          loading={busy}
        />
        {unsaved && !busy && <span {...stylex.props(type.small, styles.unsaved)}>Not saved yet</span>}
        <span {...stylex.props(styles.spacer)} />
        {desktop() ? (
          <Button
            size="sm"
            variant="quiet"
            icon="folder-open"
            label={`Saved in ${dir}`}
            onClick={() => void reveal(dir)}
          />
        ) : (
          <Hint>
            Saved in <span {...stylex.props(type.code)}>{dir}</span>
          </Hint>
        )}
      </div>

      {(words || error) && (
        <div {...stylex.props(styles.checks)}>
          {error && (
            <Banner tone="danger" compact>
              {error}
            </Banner>
          )}
          {words && (
            <div role="status" {...stylex.props(styles.checks)}>
              {(["jira", "xray"] as const).map((k) => (
                <div key={k} {...stylex.props(styles.result)}>
                  <Badge {...RESULT[words[k].ok ? "ok" : words[k].untested ? "untested" : "failed"]} />
                  <span {...stylex.props(type.compact, type.strong)}>{k === "jira" ? "Jira" : "Xray"}</span>
                  <span {...stylex.props(type.compact, styles.said)}>{words[k].text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </form>
  );
}
