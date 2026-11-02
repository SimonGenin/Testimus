import { useEffect } from "react";
import type { CheckState, DoctorCheck } from "../../../core/types.ts";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Badge, type BadgeTone, Button, type IconName, Skeleton } from "../../components/ui/index.ts";
import { runDoctor, useDoctor } from "../../lib/doctor.ts";

export const CHECK_LOOK: Record<CheckState, { word: string; tone: BadgeTone; icon: IconName }> = {
  ok: { word: "OK", tone: "ok", icon: "check" },
  warn: { word: "To do", tone: "warn", icon: "warning" },
  fail: { word: "Failed", tone: "err", icon: "error" },
  skip: { word: "Not checked", tone: "neutral", icon: "info" },
};

const INFO_IDS = new Set(["proxy"]);

function CheckRow({ check }: { check: DoctorCheck }) {
  const look =
    check.state === "ok" && INFO_IDS.has(check.id)
      ? { word: "Info", tone: "info" as const, icon: "info" as const }
      : CHECK_LOOK[check.state];
  const open = check.state === "warn" || check.state === "fail";
  return (
    <li className="chk" data-check={check.id}>
      <Badge tone={look.tone} icon={look.icon}>
        {look.word}
      </Badge>
      <span className="chk-label">{check.label}</span>
      {open ? (
        <div className="chk-body">
          <p>{check.detail}</p>
          {check.fix && (
            <p>
              <strong>What to do:</strong> {check.fix}
            </p>
          )}
        </div>
      ) : (
        <span className="muted chk-detail">
          {check.detail}
          {check.state === "skip" && check.fix ? ` — ${check.fix}` : ""}
        </span>
      )}
    </li>
  );
}

export function DoctorScreen() {
  const doctor = useDoctor();
  useEffect(() => {
    if (!doctor.at && !doctor.running) void runDoctor();
  }, [doctor.at, doctor.running]);
  const login = doctor.checks.find((c) => c.id === "claudeLogin");
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
              : doctor.checks.map((c) => <CheckRow key={c.id} check={c} />)}
          </ul>
          {login && login.state !== "ok" && (
            <div className="doctor-login">
              <Button disabled={doctor.running} onClick={() => void runDoctor(true)}>
                Check Claude sign-in
              </Button>
              <span className="muted">Runs one tiny Claude request with your account — a few seconds.</span>
            </div>
          )}
          <span className="muted">
            Same as <span className="mono">testimus system doctor</span>
          </span>
        </div>
      </div>
    </div>
  );
}
