import { useEffect, useState } from "react";
import type { CredsStatus, DoctorCheck } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { Button, Icon, Severity, Skeleton } from "../../components/ui/index.ts";
import { openExternal } from "../../lib/desktop.ts";
import { runDoctor } from "../../lib/doctor.ts";
import { message } from "../../lib/format.ts";

type SetupResult = { status: CredsStatus; saved: string[]; checks: DoctorCheck[]; ok: boolean };

const TOKENS = "https://id.atlassian.com/manage-profile/security/api-tokens";

const siteOf = (baseUrl?: string) => (baseUrl ?? "").replace(/\/wiki\/?$/, "");

export function AccessStep({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  const [status, setStatus] = useState<CredsStatus | null>(null);
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    call<SetupResult>("system.setup", {})
      .then((r) => {
        setStatus(r.status);
        setSite(siteOf(r.status.jira.baseUrl));
        setEmail(r.status.jira.email ?? "");
      })
      .catch((e) => setError(message(e)));
  }, []);

  const test = async () => {
    if (!status) return;
    setTesting(true);
    setError("");
    try {
      const input: Record<string, unknown> = { check: true };
      if (site.trim() && site.trim() !== siteOf(status.jira.baseUrl)) input.site = site.trim();
      if (email.trim() && email.trim() !== (status.jira.email ?? "")) input.email = email.trim();
      if (token.trim()) input.token = token.trim();
      if (clientId.trim()) input.clientId = clientId.trim();
      if (secret.trim()) input.clientSecret = secret.trim();
      const r = await call<SetupResult>("system.setup", input);
      setStatus(r.status);
      setChecks(r.checks);
      setToken("");
      setSecret("");
      if (r.saved.length) void runDoctor();
    } catch (e) {
      setError(message(e));
    } finally {
      setTesting(false);
    }
  };

  if (!status && !error)
    return (
      <div className="setup-form" aria-busy="true">
        <Skeleton w="60%" h={14} />
        <Skeleton h={36} />
        <Skeleton h={36} />
        <Skeleton h={36} />
      </div>
    );

  const found = !!status?.jira.complete && !!status?.xray.complete;
  const okAll = !!checks?.length && checks.every((c) => c.state === "ok");
  return (
    <div className="setup-form">
      <h1 className="h setup-title">Connect to Jira and Xray</h1>
      <p className="muted">
        Testimus reads and writes your tests through your own accounts. Nothing is sent anywhere else.
      </p>
      {found && (
        <div className="setup-found" role="status">
          <Icon name="info" />
          <p>
            We found the access you already use with Xray Editor. The fields are filled in: just test the connection.
          </p>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void test();
        }}
      >
        <fieldset className="setup-set">
          <legend className="h">Jira</legend>
          <div className="formfield">
            <label className="label" htmlFor="setup-site">
              Site address
            </label>
            <input
              id="setup-site"
              className="field"
              placeholder="https://<company>.atlassian.net"
              value={site}
              onChange={(e) => setSite(e.target.value)}
            />
          </div>
          <div className="formgrid">
            <div className="formfield">
              <label className="label" htmlFor="setup-email">
                Email
              </label>
              <input
                id="setup-email"
                className="field"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="formfield">
              <label className="label" htmlFor="setup-token">
                API token{" "}
                <a
                  href={TOKENS}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    if (openExternal(TOKENS)) e.preventDefault();
                  }}
                >
                  How to create one
                </a>
              </label>
              <input
                id="setup-token"
                className="field"
                type="password"
                autoComplete="off"
                placeholder={status?.jira.complete ? "Saved — leave empty to keep it" : ""}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
          </div>
        </fieldset>
        <fieldset className="setup-set">
          <legend className="h">Xray</legend>
          <div className="formgrid">
            <div className="formfield">
              <label className="label" htmlFor="setup-cid">
                Client ID
              </label>
              <input
                id="setup-cid"
                className="field mono"
                autoComplete="off"
                placeholder={status?.xray.exists ? "Saved — leave empty to keep it" : ""}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>
            <div className="formfield">
              <label className="label" htmlFor="setup-secret">
                Client secret
              </label>
              <input
                id="setup-secret"
                className="field"
                type="password"
                autoComplete="off"
                placeholder={status?.xray.complete ? "Saved — leave empty to keep it" : ""}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </div>
          </div>
        </fieldset>
        {(checks || error) && (
          <div className="setup-checks" role="status">
            {error && <Severity tone="error">{error}</Severity>}
            {checks?.map((c) => (
              <span key={c.id} title={c.fix}>
                <Severity tone={c.state === "ok" ? "ok" : c.state === "warn" ? "warning" : "error"}>
                  {c.label} — {c.detail}
                </Severity>
              </span>
            ))}
            {checks && !checks.length && <span className="muted">Nothing to test yet: fill in the fields.</span>}
          </div>
        )}
        <div className="setup-actions">
          <Button disabled={testing} onClick={() => void test()}>
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <span className="spacer" />
          <Button tone="quiet" onClick={onSkip}>
            Skip for now
          </Button>
          <Button tone={okAll || found ? "primary" : "secondary"} icon="right" onClick={onContinue}>
            Continue
          </Button>
        </div>
      </form>
      <p className="muted">
        Saved in your user folder, shared with your other Atlassian tools. You can change them later in Settings ›
        Access.
      </p>
    </div>
  );
}
