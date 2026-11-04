import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { ConnectClaude } from "../../components/claude/ConnectClaude.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { flushAutosaves, pendingAutosaves } from "../../lib/data/autosave.ts";
import { type Key, key, read, useRead } from "../../lib/data/query.ts";
import { desktop, examplePath, onWindows, pickFiles } from "../../lib/desktop.ts";
import { message } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { useSetSettings, useSettings } from "./machine.ts";
import { Stack } from "./Section.tsx";

const styles = stylex.create({
  row: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  state: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s2 },
  line: {
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    color: color.textMuted,
  },
});

export type ClaudeStatus = CommandOutput<"claude.status">;

export function exeLine(s: ClaudeStatus): string {
  return s.installed
    ? `${s.version ?? "Claude Code"} · found`
    : `${(s.detail || "claude did not answer").split("\n")[0].slice(0, 160)} · Claude is optional`;
}

// ponytail: the path is saved when the field is left (or the screen goes), not while typing — each new path makes
// Claude's state asked again; Check (or Enter) saves what is typed, then asks `claude --version` afresh
export function ClaudeProgram() {
  const app = useApp();
  const client = useQueryClient();
  const settings = useSettings();
  const status = useRead("claude.status", {});
  const setSettings = useSetSettings();
  const [checking, setChecking] = useState(false);
  const saveKey: Key = [null, "system.settings", { field: "claudeExe" }];

  const check = async () => {
    setChecking(true);
    try {
      await flushAutosaves([["system.settings", { field: "claudeExe" }]]);
      if (pendingAutosaves().some((k) => JSON.stringify(k) === JSON.stringify(saveKey))) return;
      const r = await read(client, "claude.status", { refresh: true }).catch(
        (e): ClaudeStatus => ({ installed: false, signedIn: false, detail: message(e) }) as ClaudeStatus,
      );
      client.setQueryData(key("claude.status", {}) as unknown as readonly unknown[], r);
    } finally {
      setChecking(false);
    }
  };

  const st = status.data;
  const exe = settings.data?.claude.exe ?? "";
  return (
    <Stack>
      <Text
        id="settings-claude-exe"
        label="Claude program"
        value={exe}
        saveKey={saveKey}
        delay="blur"
        save={async (value) => {
          if (value.trim() === (settings.data?.claude.exe ?? "")) return;
          await setSettings({ claudeExe: value.trim() });
        }}
        spellCheck={false}
        placeholder={`Found on PATH — or ${examplePath("C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd", "/Users/you/.local/bin/claude")}`}
        onKeyDown={(e) => {
          if (e.key === "Enter") void check();
        }}
        trailing={
          desktop() ? (
            <Button
              size="sm"
              variant="quiet"
              label="Browse…"
              disabled={!settings.data}
              onClick={() =>
                void pickFiles(
                  "Choose the Claude program",
                  onWindows() ? [{ name: "Programs", extensions: ["exe", "cmd"] }] : [],
                  false,
                ).then(async ([picked]) => {
                  if (!picked) return;
                  setChecking(true);
                  try {
                    await setSettings({ claudeExe: picked });
                  } catch {
                    setChecking(false);
                    return;
                  }
                  await check();
                })
              }
            />
          ) : undefined
        }
      />
      <div {...stylex.props(styles.row)}>
        <Button size="sm" icon="refresh" label="Check" loading={checking} onClick={() => void check()} />
        {checking && (
          <span role="status" {...stylex.props(type.code, styles.line)}>
            Running claude --version…
          </span>
        )}
      </div>
      {st && !checking && (
        <div {...stylex.props(styles.state)}>
          {st.installed ? (
            <span role="status" title={st.detail}>
              <Badge label={exeLine(st)} tone="success" icon="check" />
            </span>
          ) : (
            <>
              <Badge label="Not found" tone="danger" icon="x-circle" />
              <span role="status" title={st.detail} {...stylex.props(type.code, styles.line)}>
                {exeLine(st)}
              </span>
            </>
          )}
        </div>
      )}
      {st && !checking && !st.installed && (
        <ConnectClaude
          look="panel"
          status={st}
          checking={false}
          onCheck={() => void check()}
          onSetPath={() => document.getElementById("settings-claude-exe")?.focus()}
          onDoctor={() => app.navigate("doctor")}
        />
      )}
    </Stack>
  );
}
