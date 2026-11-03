import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CredsStatus, DoctorCheck } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { Button, Icon, Skeleton } from "../../components/ui/index.ts";
import { desktop, openExternal, reveal } from "../../lib/desktop.ts";
import { runDoctor } from "../../lib/doctor.ts";
import { cx, message } from "../../lib/format.ts";

export type SetupResult = { status: CredsStatus; saved: string[]; checks: DoctorCheck[]; ok: boolean };
export type Word = { ok: boolean; text: string };
type Secrets = { token: string; clientId: string; clientSecret: string };

export const TOKENS = "https://id.atlassian.com/manage-profile/security/api-tokens";

// ponytail: people paste what their browser shows — "transurb", "transurb.atlassian.net", a whole issue URL —
// and the file wants the site root; a /wiki the user typed is kept (Xray Editor's siteUrl)
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

// ponytail: what system.setup writes for that root — the shared file keeps the /wiki form other Atlassian tools
// need (SPEC §2), and an unchanged site keeps the exact value already there
export function savedAs(root: string, previous?: string): string {
  if (!root) return "";
  if (previous && baseOf(previous) === baseOf(root)) return previous.trim();
  return /\.atlassian\.net$/i.test(baseOf(root)) ? `${baseOf(root)}/wiki` : root;
}

export function jiraWords(c: DoctorCheck | undefined): Word {
  if (!c || /needs baseUrl|Missing |not valid JSON/.test(c.detail))
    return { ok: false, text: "Fill in the site, the email and the API token first." };
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
    return { ok: false, text: "Fill in the Client ID and the Client Secret first." };
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

export function ConnectAtlassian({
  lead,
  onStatus,
  onResult,
}: {
  lead?: ReactNode;
  onStatus?: (s: CredsStatus) => void;
  onResult?: (r: SetupResult) => void;
}) {
  const [status, setStatus] = useState<CredsStatus | null>(null);
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState<{ jira: Word; xray: Word } | null>(null);
  const [error, setError] = useState("");
  const told = useRef(onStatus);
  const kept = useRef<Secrets>({ token: "", clientId: "", clientSecret: "" });
  told.current = onStatus;

  useEffect(() => {
    call<SetupResult>("system.setup", {})
      .then((r) => {
        setStatus(r.status);
        setSite(r.status.jira.baseUrl ?? "");
        setEmail(r.status.jira.email ?? "");
        told.current?.(r.status);
      })
      .catch((e) => setError(message(e)));
    call<Secrets>("system.secrets", {})
      .then((s) => {
        if (!s) return;
        kept.current = s;
        setToken(s.token);
        setClientId(s.clientId);
        setSecret(s.clientSecret);
      })
      .catch(() => {});
  }, []);

  const root = siteRoot(site);
  const saved = savedAs(root, status?.jira.baseUrl);
  const base = baseOf(root);
  const touched = () => {
    setWords(null);
    setError("");
  };

  const save = async () => {
    if (!status) return;
    setBusy(true);
    setError("");
    try {
      const input: Record<string, unknown> = { check: true };
      if (root && saved !== status.jira.baseUrl) {
        input.site = root;
        // ponytail: a site that is not *.atlassian.net is the user's choice (Xray Editor saves any site) — said so here
        if (!/\.atlassian\.net(\/|$)/i.test(baseOf(root).replace(/^https?:\/\//, ""))) input.otherHost = true;
      }
      if (email.trim() && email.trim() !== (status.jira.email ?? "")) input.email = email.trim();
      const was = kept.current;
      if (token.trim() && token.trim() !== was.token) input.token = token.trim();
      if (clientId.trim() && clientId.trim() !== was.clientId) input.clientId = clientId.trim();
      if (secret.trim() && secret.trim() !== was.clientSecret) input.clientSecret = secret.trim();
      // ponytail: a saved value the user emptied is erased, not kept (Xray Editor saves the form as it is)
      const clear = [
        !email.trim() && status.jira.email ? "email" : "",
        !token.trim() && was.token ? "token" : "",
        !clientId.trim() && was.clientId ? "clientId" : "",
        !secret.trim() && was.clientSecret ? "clientSecret" : "",
      ].filter(Boolean);
      if (clear.length) input.clear = clear;
      const r = await call<SetupResult>("system.setup", input);
      setStatus(r.status);
      onStatus?.(r.status);
      kept.current = { token: token.trim(), clientId: clientId.trim(), clientSecret: secret.trim() };
      setWords({
        jira: jiraWords(r.checks.find((c) => c.id === "jira")),
        xray: xrayWords(r.checks.find((c) => c.id === "xray")),
      });
      onResult?.(r);
      if (r.saved.length) void runDoctor();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (!status && !error)
    return (
      <div className="atl" aria-busy="true">
        <Skeleton w="60%" h={14} />
        <Skeleton h={36} />
        <Skeleton h={36} />
      </div>
    );

  const kind = shown ? "text" : "password";
  const dir = status ? dirOf(status.jira.file) : "~/.atlassian";
  return (
    <form
      className="atl"
      aria-label="Connect to Jira and Xray"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {lead && <p className="muted">{lead}</p>}
      <div className="atl-step">
        <span className="atl-num">1</span>
        <div className="atl-col">
          <span className="atl-title">Your Jira site and the email you log in with</span>
          <div className="formgrid">
            <div className="formfield">
              <label className="label" htmlFor="setup-site">
                Jira site
              </label>
              <input
                id="setup-site"
                className="field"
                placeholder="company.atlassian.net"
                spellCheck={false}
                value={site}
                onChange={(e) => {
                  setSite(e.target.value);
                  touched();
                }}
              />
            </div>
            <div className="formfield">
              <label className="label" htmlFor="setup-email">
                Email
              </label>
              <input
                id="setup-email"
                className="field"
                type="email"
                autoComplete="username"
                placeholder="you@company.com"
                spellCheck={false}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  touched();
                }}
              />
            </div>
          </div>
          <span className="muted atl-hint">
            {saved && saved !== site.trim() ? (
              <>
                Will be saved as <span className="mono">{saved}</span>
              </>
            ) : (
              "The address in your browser when you open Jira — just the site, any page of it works."
            )}
          </span>
        </div>
      </div>

      <div className="atl-step">
        <span className="atl-num">2</span>
        <div className="atl-col">
          <span className="atl-title">A Jira API token</span>
          <ol className="atl-how">
            <li>
              Open your Atlassian account's token page{" "}
              <Button size="sm" icon="external" onClick={() => open(TOKENS)}>
                Open API tokens
              </Button>
            </li>
            <li>
              <strong>Create API token</strong> — the plain one, not <em>with scopes</em> (a scoped token does not work
              here); name it, pick the longest expiry.
            </li>
            <li>Copy it and paste it below: it is shown only once.</li>
          </ol>
          <div className="formfield">
            <label className="label" htmlFor="setup-token">
              API token
            </label>
            <input
              id="setup-token"
              className="field"
              type={kind}
              autoComplete="off"
              spellCheck={false}
              placeholder={status?.jira.complete ? "Saved — leave empty to keep it" : ""}
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                touched();
              }}
            />
          </div>
        </div>
      </div>

      <div className="atl-step">
        <span className="atl-num">3</span>
        <div className="atl-col">
          <span className="atl-title">An Xray API key (Client ID + Client Secret)</span>
          <ol className="atl-how">
            <li>
              In Jira, <strong>⚙ Settings → Apps → Xray → API Keys → Create API Key</strong>, for your own user{" "}
              {base && (
                <Button size="sm" icon="external" onClick={() => open(`${base}/plugins/servlet/upm`)}>
                  Open Jira apps
                </Button>
              )}
            </li>
            <li>Copy the Client ID and the Client Secret below — the secret is shown only once.</li>
            <li>Only a Jira admin sees that page: if you are not one, ask yours for a key made for your user.</li>
          </ol>
          <div className="formgrid">
            <div className="formfield">
              <label className="label" htmlFor="setup-cid">
                Client ID
              </label>
              <input
                id="setup-cid"
                className="field mono"
                autoComplete="off"
                spellCheck={false}
                placeholder={status?.xray.exists ? "Saved — leave empty to keep it" : ""}
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  touched();
                }}
              />
            </div>
            <div className="formfield">
              <label className="label" htmlFor="setup-secret">
                Client secret
              </label>
              <input
                id="setup-secret"
                className="field"
                type={kind}
                autoComplete="off"
                spellCheck={false}
                placeholder={status?.xray.complete ? "Saved — leave empty to keep it" : ""}
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value);
                  touched();
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="atl-foot">
        <Button tone="primary" disabled={busy || !status} onClick={() => void save()}>
          {busy ? "Testing…" : "Save and test the connection"}
        </Button>
        <Button tone="quiet" size="sm" aria-pressed={shown} onClick={() => setShown(!shown)}>
          {shown ? "Hide secrets" : "Show secrets"}
        </Button>
        <span className="spacer" />
        {desktop() ? (
          <button type="button" className="linkbtn atl-dir" onClick={() => void reveal(dir)}>
            Saved in <span className="mono">{dir}</span>
          </button>
        ) : (
          <span className="muted atl-dir">
            Saved in <span className="mono">{dir}</span>
          </span>
        )}
      </div>

      {(words || error) && (
        <div className="atl-result" role="status">
          {error && (
            <div className="atl-check atl-bad">
              <Icon name="error" />
              <span>{error}</span>
            </div>
          )}
          {words &&
            (["jira", "xray"] as const).map((k) => (
              <div key={k} className={cx("atl-check", words[k].ok ? "atl-ok" : "atl-bad")}>
                <Icon name={words[k].ok ? "check" : "error"} />
                <strong>{k === "jira" ? "Jira" : "Xray"}</strong>
                <span>{words[k].text}</span>
              </div>
            ))}
        </div>
      )}
    </form>
  );
}
