import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import type { Save } from "../../lib/data/autosave.ts";
import { invalidate, type Key } from "../../lib/data/query.ts";
import { desktop, examplePath, pickFolder } from "../../lib/desktop.ts";
import { canRestart, restartApp, restartHint, type Updates, useStartUpdate, useUpdates } from "../../lib/updates.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { useSetSettings, useSettings } from "./machine.ts";
import { Fact, Group, Row, Section } from "./Section.tsx";

const styles = stylex.create({
  row: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  muted: { color: color.textMuted, overflowWrap: "anywhere" },
});

export function stateBadge(u: Updates): { label: string; tone: "success" | "info" | "warning" | "neutral" } {
  if (u.pending) return { label: `${u.pending} installed — restart`, tone: "success" };
  if (u.available && u.latest) return { label: `${u.latest.version} available`, tone: "info" };
  if (u.problem) return { label: u.reachable ? "No release found" : "Folder not reachable", tone: "warning" };
  return { label: "Up to date", tone: "success" };
}

export function sourceLine(u: Updates): string {
  if (u.sourceFrom === "install") return `Looking in ${u.source}, the folder Testimus was installed from.`;
  if (u.sourceFrom === "settings") return `Looking in ${u.source}.`;
  return "No folder to look in yet.";
}

// ponytail: the folder is the share the releases are copied to; left empty, the one this copy was installed from is
// read — so moving the share only needs the new path here, and nothing breaks while it is unreachable
export function UpdatesSection() {
  const app = useApp();
  const client = useQueryClient();
  const settings = useSettings();
  const setSettings = useSetSettings();
  const updates = useUpdates();
  const start = useStartUpdate(app.navigate);
  const [starting, setStarting] = useState(false);
  const saveKey: Key = [null, "system.settings", { field: "updatesFrom" }];
  const u = updates.data;
  const typed = settings.data?.updates?.from ?? "";

  const save: Save<string> = async (value) => {
    if (value.trim() === typed) return;
    await setSettings({ updatesFrom: value.trim() });
    await invalidate(client, [["system.updates"]]);
  };

  const badge = u && stateBadge(u);
  return (
    <Section
      id="updates"
      title="Updates"
      intro="New versions of Testimus are copied to a folder; Testimus looks there when it starts and offers to install them. Your settings and projects stay."
    >
      <Group
        title="Version"
        actions={
          <Button
            size="sm"
            icon="refresh"
            label="Check now"
            loading={updates.isFetching}
            onClick={() => void updates.refetch()}
          />
        }
      >
        <Row>
          <Fact
            label="This copy"
            hint={u && !u.installed ? "Not an installed copy, so it cannot update itself." : undefined}
          >
            <div {...stylex.props(styles.row)}>
              {u && <span {...stylex.props(type.code)}>{u.current}</span>}
              {badge && <Badge label={badge.label} tone={badge.tone} />}
            </div>
            {u?.problem && (
              <Banner tone="warning" compact>
                {u.problem}
              </Banner>
            )}
            {u?.pending ? (
              <>
                <span {...stylex.props(type.compact)}>{restartHint(u.pending)}</span>
                {canRestart() && (
                  <div {...stylex.props(styles.row)}>
                    <Button variant="primary" icon="refresh" label="Restart now" onClick={restartApp} />
                  </div>
                )}
              </>
            ) : (
              u?.available &&
              u.latest && (
                <div {...stylex.props(styles.row)}>
                  <Button
                    variant="primary"
                    icon="download"
                    label={`Update to ${u.latest.version}`}
                    disabled={!u.installed}
                    loading={starting}
                    onClick={() => {
                      setStarting(true);
                      void start(u.latest?.version).finally(() => setStarting(false));
                    }}
                  />
                  <span {...stylex.props(type.small, styles.muted)}>
                    It installs beside this version; your settings and projects stay.
                  </span>
                </div>
              )
            )}
            <div>
              <Button
                variant="link"
                label={u?.available && u.latest ? `What's new in ${u.latest.version}` : "What changed in each version"}
                onClick={() => app.navigate("settings", "changelog")}
              />
            </div>
          </Fact>
        </Row>
      </Group>
      <Group id="updates" title="Where new versions come from">
        <Row>
          <Text
            aside
            id="settings-updates-from"
            label="Update folder"
            hint="Empty: the folder this copy was installed from. A folder that moved only needs its new path here."
            value={typed}
            saveKey={saveKey}
            delay="blur"
            save={save}
            spellCheck={false}
            placeholder={
              u?.sourceFrom === "install"
                ? `${u.source} (where Testimus was installed from)`
                : examplePath("\\\\server\\tools\\Testimus", "/Volumes/tools/Testimus")
            }
            trailing={
              desktop() ? (
                <Button
                  size="sm"
                  variant="quiet"
                  label="Browse…"
                  disabled={!settings.data}
                  onClick={() =>
                    void pickFolder("Choose the update folder").then((picked) =>
                      picked ? save(picked, undefined) : undefined,
                    )
                  }
                />
              ) : undefined
            }
          />
          {u && (
            <Fact>
              <span {...stylex.props(type.small, styles.muted)}>{sourceLine(u)}</span>
            </Fact>
          )}
        </Row>
      </Group>
    </Section>
  );
}
