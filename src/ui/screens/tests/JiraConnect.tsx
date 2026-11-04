import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useApp } from "../../lib/app.ts";
import { ApiError } from "../../lib/data/client.ts";
import { execute } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";
import { color, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  box: { display: "flex", flexDirection: "column", alignItems: "stretch", gap: space.s3, padding: space.s5 },
  icon: { color: color.textMuted },
  title: { margin: 0, fontSize: fontSize.titleSm, lineHeight: lineHeight.titleSm, fontWeight: fontWeight.semibold },
  text: { margin: 0, fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
  row: { display: "flex", alignItems: "flex-end", gap: space.s2 },
  grow: { flex: 1, minWidth: 0 },
});

const JIRA = [["project.info"], ["xray.folders"], ["xray.search"], ["xray.preconditions"], ["xray.status"]] as const;

// ponytail: the Jira tab when it has nothing to list — no key yet, disconnected by the user, or a key Jira
// refused; the key is checked by xray.connect before it is saved, so a failure is said here, under the box
export function JiraConnect({ error, onConnected }: { error: string; onConnected: () => void }) {
  const app = useApp();
  const client = useQueryClient();
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
      await execute(client, "xray.connect", { key: key.trim() }, { invalidates: [...JIRA] });
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
      await execute(client, "xray.disconnect", {}, { invalidates: [...JIRA] });
      app.refreshInfo();
    } catch (err) {
      errorToast(err, "Could not disconnect Jira");
    }
  };

  return (
    <div {...stylex.props(styles.box)}>
      <span {...stylex.props(styles.icon)}>
        <Icon name={offline ? "drive" : "link"} size="lg" />
      </span>
      <h2 {...stylex.props(styles.title)}>
        {offline ? "Working locally" : p?.jiraProject && error ? "Jira could not be reached" : "Connect to Jira"}
      </h2>
      <p {...stylex.props(styles.text)}>
        {offline
          ? `Nothing is read from or written to ${p?.jiraProject} until you reconnect. Your local tests stay as they are.`
          : "Give the key of the Jira project that holds the Xray tests. It is checked in Jira before it is saved."}
      </p>
      <div {...stylex.props(styles.row)}>
        <div {...stylex.props(styles.grow)}>
          <Text
            label="Jira project key"
            placeholder="LFRPS12"
            spellCheck={false}
            value={key}
            error={shown ? "" : undefined}
            onChange={(v) => setKey(v.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") void connect();
            }}
          />
        </div>
        <Button
          variant="primary"
          label={busy ? "Checking…" : p?.jiraProject && key === p.jiraProject ? "Reconnect" : "Connect"}
          loading={busy}
          disabled={!key.trim()}
          onClick={() => void connect()}
        />
      </div>
      {shown && (
        <Banner
          tone="danger"
          compact
          actions={
            access ? (
              <Button
                size="sm"
                variant="quiet"
                icon="settings"
                label="Set up Jira access"
                onClick={() => app.navigate("setup")}
              />
            ) : undefined
          }
        >
          {shown.message}
          {shown.fix && <p {...stylex.props(styles.text)}>{shown.fix}</p>}
        </Banner>
      )}
      {!offline && p?.jiraProject && error && (
        <Button variant="quiet" icon="drive" label="Work locally for now" onClick={() => void goOffline()} />
      )}
    </div>
  );
}
