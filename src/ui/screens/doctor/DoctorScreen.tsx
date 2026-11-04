import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { DoctorAction, DoctorCheck } from "../../../core/types.ts";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Badge, HEALTH } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Table } from "../../components/ui/Table.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { desktop, pickFolder } from "../../lib/desktop.ts";
import { toast } from "../../lib/toast.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { FolderDialog } from "../settings/models/FolderDialog.tsx";
import { CheckTable } from "./CheckTable.tsx";
import { counts, sections } from "./checks.ts";
import { useDoctorChecks } from "./useDoctorChecks.ts";

const styles = stylex.create({
  screen: { flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" },
  scroll: { flex: 1, minHeight: 0, overflowY: "auto" },
  page: {
    boxSizing: "border-box",
    maxWidth: `calc(${size.reading} + ${size.sidebar} + ${space.s7} * 2)`,
    paddingBlock: space.s7,
    paddingInline: space.s7,
    display: "flex",
    flexDirection: "column",
    gap: space.s7,
  },
  lead: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: space.s4 },
  intro: { flex: "1 1 20rem", margin: 0, color: color.textMuted },
  counts: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  checks: { display: "flex", flexDirection: "column", gap: space.s7 },
  foot: { margin: 0, color: color.textMuted },
});

const SETTINGS_OF: Record<string, string> = {
  "system.setCredentials": "access",
  "system.set": "claude",
  "models.usePack": "models",
};

const MODELS_GB = 3;

const clock = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function DoctorScreen() {
  const app = useApp();
  const d = useDoctorChecks();
  const [folder, setFolder] = useState<DoctorAction | null>(null);

  const act = async (c: DoctorCheck, a: DoctorAction) => {
    if (a.command === "system.doctor") return d.checkSignIn();
    const section = SETTINGS_OF[a.command];
    if (section) return app.navigate("settings", section);
    if (a.command === "models.setDir") return setFolder(a);
    if (a.command === "models.add") {
      if (!desktop()) return app.navigate("settings", "models");
      const path = await pickFolder("Choose the model folder");
      if (path) await d.run(c, a, { ...a.input, path });
      return;
    }
    await d.run(c, a, a.input ?? {});
  };

  const busy = (c: DoctorCheck) => d.busyId === c.id || (c.action?.command === "system.doctor" && d.signingIn);

  return (
    <div {...stylex.props(styles.screen)}>
      <ScreenHeader
        title="System check"
        meta={d.checking && !d.checks ? "Checking…" : d.at ? `Last checked at ${clock(d.at)}` : undefined}
      >
        <Button
          variant="primary"
          icon="refresh"
          label={d.checking ? "Checking…" : "Check again"}
          loading={d.checking}
          onClick={d.again}
        />
      </ScreenHeader>
      <div {...stylex.props(styles.scroll)}>
        <div {...stylex.props(styles.page)}>
          <div {...stylex.props(styles.lead)}>
            <p {...stylex.props(type.body, styles.intro)}>
              Everything Testimus needs on this PC. Editing, review and push work even when Claude is not available.
            </p>
            {d.checks && (
              <div {...stylex.props(styles.counts)}>
                {counts(d.checks).map(({ look, n }) => (
                  <Badge key={look} {...HEALTH[look]} label={`${n} ${HEALTH[look].label}`} size="sm" />
                ))}
              </div>
            )}
          </div>
          {d.error && <Banner tone="danger">The check could not run: {d.error}</Banner>}
          <section aria-label="Checks" aria-busy={!d.checks} {...stylex.props(styles.checks)}>
            {d.checks ? (
              sections(d.checks).map((s) => (
                <CheckTable
                  key={s.title}
                  title={s.title}
                  checks={s.checks}
                  busy={busy}
                  onAct={(c, a) => void act(c, a)}
                />
              ))
            ) : (
              <Table
                label="Checks"
                loading
                rows={[]}
                getKey={() => ""}
                columns={[
                  { key: "state", label: "State" },
                  { key: "label", label: "Check" },
                  { key: "detail", label: "Result" },
                  { key: "fix", label: "Fix" },
                ]}
              />
            )}
          </section>
          <p {...stylex.props(type.small, styles.foot)}>
            The same check from a terminal: <span {...stylex.props(type.code)}>testimus system doctor</span> · the
            rail's status dot shows the last result.
          </p>
        </div>
      </div>
      {folder && (
        <FolderDialog
          current={folder.value ?? null}
          needMB={MODELS_GB * 1024}
          onClose={() => setFolder(null)}
          onApplied={(dir, jobId) => {
            setFolder(null);
            toast({ kind: "ok", title: jobId ? "Moving the models" : "Models folder saved", detail: dir });
            d.again();
          }}
        />
      )}
    </div>
  );
}
