import { useEffect, useState } from "react";
import type { CheckState, DoctorAction, DoctorCheck } from "../../../core/types.ts";
import { run } from "../../api.ts";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Badge, type BadgeTone, Button, type IconName, Skeleton } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { desktop, pickFolder } from "../../lib/desktop.ts";
import { runDoctor, useDoctor } from "../../lib/doctor.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { FolderDialog } from "../settings/models/FolderDialog.tsx";

export const CHECK_LOOK: Record<CheckState, { word: string; tone: BadgeTone; icon: IconName }> = {
  ok: { word: "OK", tone: "ok", icon: "check" },
  warn: { word: "To do", tone: "warn", icon: "warning" },
  fail: { word: "Failed", tone: "err", icon: "error" },
  skip: { word: "Not checked", tone: "neutral", icon: "info" },
};

const INFO_IDS = new Set(["proxy"]);

const SETTINGS_OF: Record<string, string> = {
  "system.setup": "access",
  "system.saveSettings": "claude",
  "models.usePack": "models",
};

const MODELS_GB = 3;

function CheckRow({
  check,
  busy,
  onAct,
}: {
  check: DoctorCheck;
  busy: boolean;
  onAct: (c: DoctorCheck, a: DoctorAction) => void;
}) {
  const look =
    check.state === "ok" && INFO_IDS.has(check.id)
      ? { word: "Info", tone: "info" as const, icon: "info" as const }
      : CHECK_LOOK[check.state];
  const open = check.state === "warn" || check.state === "fail";
  const a = check.action;
  // ponytail: a re-check button does not do the fix itself, so the words saying what to do stay beside it
  const recheck = a?.command === "system.doctor";
  const button = a && (
    <Button size="sm" tone={open ? "primary" : "secondary"} disabled={busy} onClick={() => onAct(check, a)}>
      {busy ? "Working…" : a.label}
    </Button>
  );
  return (
    <li className="chk" data-check={check.id}>
      <Badge tone={look.tone} icon={look.icon}>
        {look.word}
      </Badge>
      <span className="chk-label">{check.label}</span>
      {open ? (
        <div className="chk-body">
          <p>{check.detail}</p>
          {check.fix && (!a || recheck) && (
            <p>
              <strong>What to do:</strong> {check.fix}
            </p>
          )}
          {button && <div className="chk-act">{button}</div>}
        </div>
      ) : (
        <div className="chk-body">
          <span className="muted chk-detail">
            {check.detail}
            {check.state === "skip" && check.fix && !a ? ` — ${check.fix}` : ""}
          </span>
          {button && <div className="chk-act">{button}</div>}
        </div>
      )}
    </li>
  );
}

export function DoctorScreen() {
  const app = useApp();
  const doctor = useDoctor();
  const [busy, setBusy] = useState<string | null>(null);
  const [folder, setFolder] = useState<DoctorAction | null>(null);
  useEffect(() => {
    if (!doctor.at && !doctor.running) void runDoctor();
  }, [doctor.at, doctor.running]);

  const exec = async (c: DoctorCheck, a: DoctorAction, input: Record<string, unknown> | undefined) => {
    setBusy(c.id);
    try {
      await run(a.command, input ?? {});
      toast({ kind: "ok", title: `${c.label}: done`, detail: a.label });
    } catch (e) {
      errorToast(e, `${a.label} failed`);
    } finally {
      setBusy(null);
      void runDoctor();
    }
  };

  const act = async (c: DoctorCheck, a: DoctorAction) => {
    if (a.command === "system.doctor") return void runDoctor(true);
    const section = SETTINGS_OF[a.command];
    if (section) return app.navigate("settings", section);
    if (a.command === "models.setDir") return setFolder(a);
    if (a.command === "models.add") {
      if (!desktop()) return app.navigate("settings", "models");
      const path = await pickFolder("Choose the model folder");
      if (path) await exec(c, a, { ...a.input, path });
      return;
    }
    await exec(c, a, a.input);
  };

  return (
    <div className="screen">
      <ScreenHeader
        title="System check"
        meta={
          doctor.running
            ? "Checking…"
            : doctor.at
              ? `Last checked at ${new Date(doctor.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
              : undefined
        }
      >
        <Button tone="primary" icon="revert" disabled={doctor.running} onClick={() => void runDoctor()}>
          Check again
        </Button>
      </ScreenHeader>
      <div className="scroll">
        <div className="doctor">
          <p>
            Everything Testimus needs on this PC.{" "}
            <span className="muted">Editing, review and push work even when Claude is not available.</span>
          </p>
          {doctor.error && (
            <p className="sev s-err" role="alert">
              The check could not run: {doctor.error}
            </p>
          )}
          <ul className="card chks" aria-label="Checks" aria-busy={doctor.running && !doctor.at}>
            {!doctor.at
              ? [0, 1, 2, 3, 4, 5].map((i) => (
                  <li key={i} className="chk">
                    <Skeleton w={52} h={22} r={11} />
                    <Skeleton w={150} h={14} />
                    <Skeleton w={220} h={12} />
                  </li>
                ))
              : doctor.checks.map((c) => (
                  <CheckRow
                    key={c.id}
                    check={c}
                    busy={busy === c.id || (c.action?.command === "system.doctor" && doctor.running)}
                    onAct={(x, a) => void act(x, a)}
                  />
                ))}
          </ul>
          <span className="muted">
            Same as <span className="mono">testimus system doctor</span>
          </span>
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
            void runDoctor();
          }}
        />
      )}
    </div>
  );
}
