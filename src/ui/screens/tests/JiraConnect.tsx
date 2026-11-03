import { useState } from "react";
import { ApiError, call } from "../../api.ts";
import { Button, Icon } from "../../components/legacy/index.ts";
import { useApp } from "../../lib/app.ts";
import { errorToast } from "../../lib/toast.ts";

// ponytail: the Jira tab when it has nothing to list — no key yet, disconnected by the user, or a key Jira
// refused; the key is checked by xray.connect before it is saved, so a failure is said here, under the box
export function JiraConnect({ error, onConnected }: { error: string; onConnected: () => void }) {
  const app = useApp();
  const p = app.info?.project;
  const [key, setKey] = useState(p?.jiraProject ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ message: string; fix?: string } | null>(null);
  const offline = !!p?.jiraOffline;
  const shown = failed ?? (error && !offline ? { message: error } : null);
  const access = !!shown && /credentials|setup/i.test(`${shown.message} ${shown.fix ?? ""}`);

  const connect = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await call("xray.connect", { key: key.trim() });
      app.refreshInfo();
      onConnected();
    } catch (err) {
      setFailed({
        message: err instanceof Error ? err.message : String(err),
        fix: err instanceof ApiError ? err.fix : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const goOffline = async () => {
    try {
      await call("xray.disconnect", {});
      app.refreshInfo();
    } catch (err) {
      errorToast(err, "Could not disconnect Jira");
    }
  };

  return (
    <div className="jconnect">
      <Icon name={offline ? "local" : "link"} className="jconnect-icon" />
      <h2 className="jconnect-title">
        {offline ? "Working locally" : p?.jiraProject && error ? "Jira could not be reached" : "Connect to Jira"}
      </h2>
      <p className="muted">
        {offline
          ? `Nothing is read from or written to ${p?.jiraProject} until you reconnect. Your local tests stay as they are.`
          : "Give the key of the Jira project that holds the Xray tests. It is checked in Jira before it is saved."}
      </p>
      <label htmlFor="jconnect-key" className="label">
        Jira project key
      </label>
      <div className="jconnect-row">
        <input
          id="jconnect-key"
          className="field mono"
          placeholder="LFRPS12"
          autoComplete="off"
          spellCheck={false}
          value={key}
          aria-invalid={!!shown || undefined}
          aria-describedby={shown ? "jconnect-error" : undefined}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") void connect();
          }}
        />
        <Button tone="primary" size="sm" disabled={!key.trim() || busy} onClick={() => void connect()}>
          {busy ? "Checking…" : p?.jiraProject && key === p.jiraProject ? "Reconnect" : "Connect"}
        </Button>
      </div>
      {shown && (
        <div id="jconnect-error" className="jconnect-error" role="alert">
          <p>{shown.message}</p>
          {shown.fix && <p className="muted">{shown.fix}</p>}
          {access && (
            <Button size="sm" tone="quiet" icon="settings" onClick={() => app.navigate("setup")}>
              Set up Jira access
            </Button>
          )}
        </div>
      )}
      {!offline && p?.jiraProject && error && (
        <Button size="sm" tone="quiet" icon="local" className="jconnect-offline" onClick={() => void goOffline()}>
          Work locally for now
        </Button>
      )}
    </div>
  );
}
