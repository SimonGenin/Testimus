import { useEffect, useState } from "react";
import { ApiError, call } from "../../../api.ts";
import { Button, Icon, Modal, Segmented, Skeleton } from "../../../components/legacy/index.ts";
import { absolutePath, examplePath } from "../../../lib/desktop.ts";
import { cx, message } from "../../../lib/format.ts";
import type { Hardware, SetDirOut } from "./data.ts";
import { bestDrive, defaultFolder, folderPicker, onDrive, size } from "./data.ts";

type Choice = "move" | "keep" | "copy";

const CHOICES: { value: Choice; label: string; title: string }[] = [
  { value: "move", label: "Move", title: "Move the downloaded models there; the old copy is deleted once checked" },
  { value: "keep", label: "Keep where they are", title: "Nothing moves; only new downloads go to the new folder" },
  { value: "copy", label: "Copy", title: "Copy them there and keep the old copy" },
];

export function FolderDialog({
  current,
  needMB,
  onApplied,
  onClose,
}: {
  current: string | null;
  needMB: number;
  onApplied: (dir: string, jobId: string | null, action: SetDirOut["action"]) => void;
  onClose: () => void;
}) {
  const [hw, setHw] = useState<Hardware | null>(null);
  const [hwError, setHwError] = useState("");
  const [dir, setDir] = useState("");
  const [typed, setTyped] = useState(false);
  const [choice, setChoice] = useState<Choice>("move");
  const [plan, setPlan] = useState<SetDirOut | null>(null);
  const [refusal, setRefusal] = useState<{ message: string; fix?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = folderPicker();
  const changing = !!current;

  useEffect(() => {
    call<Hardware>("models.hardware", {})
      .then((h) => {
        setHw(h);
        const best = bestDrive(h.drives ?? [], needMB);
        if (best) setDir((d) => d || defaultFolder(best));
      })
      .catch((e) => setHwError(message(e)));
  }, [needMB]);

  useEffect(() => {
    setPlan(null);
    setRefusal(null);
    const d = dir.trim();
    if (!absolutePath(d)) return;
    let dead = false;
    const t = setTimeout(() => {
      call<SetDirOut>("models.setDir", { dir: d, dryRun: true, ...(changing ? { [choice]: true } : {}) })
        .then((r) => !dead && setPlan(r))
        .catch((e) => !dead && setRefusal({ message: message(e), fix: e instanceof ApiError ? e.fix : undefined }));
    }, 250);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [dir, choice, changing]);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await call<SetDirOut>("models.setDir", { dir: dir.trim(), ...(changing ? { [choice]: true } : {}) });
      onApplied(r.dir, r.jobId ?? null, r.action);
    } catch (e) {
      setRefusal({ message: message(e), fix: e instanceof ApiError ? e.fix : undefined });
    } finally {
      setBusy(false);
    }
  };

  const drives = hw?.drives ?? [];
  const example = defaultFolder(drives[0]?.root ?? examplePath("D:\\", "/Users/you"));
  const moving = changing && choice !== "keep" && (plan?.installedMB ?? 0) > 0;
  return (
    <Modal
      label="Models folder"
      title={changing ? "Change the models folder" : "Where should models be stored?"}
      subtitle={
        changing ? (
          <>
            Now: <span className="mono">{current}</span>
          </>
        ) : (
          "Models are big files. Pick a drive with room; this PC remembers the choice for every project."
        )
      }
      width={600}
      onClose={onClose}
      foot={
        <>
          <span className="muted foot-hint">
            {needMB > 0 ? `This download needs ${size(needMB)} (${size(needMB * 1.2)} free with the margin).` : ""}
          </span>
          <span className="spacer" />
          <Button tone="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button tone="primary" disabled={!plan || busy} onClick={() => void apply()}>
            {moving
              ? `${choice === "move" ? "Move" : "Copy"} ${size(plan?.installedMB ?? 0)}`
              : changing
                ? "Use this folder"
                : "Store models here"}
          </Button>
        </>
      }
    >
      <span className="label">Drives</span>
      {hwError ? (
        <p className="sev s-warn">
          <Icon name="warning" />
          The drives could not be read: {hwError}. Type a folder below.
        </p>
      ) : !hw ? (
        <div className="drives">
          <Skeleton h={44} />
          <Skeleton h={44} />
        </div>
      ) : (
        <fieldset className="drives" aria-label="Drives">
          {drives.map((d) => {
            const short = d.freeMB < needMB * 1.2;
            const used = d.totalMB ? Math.round(((d.totalMB - d.freeMB) / d.totalMB) * 100) : 0;
            const on = onDrive(dir.trim(), d.root);
            return (
              <label key={d.root} className={cx("drive", on && "drive-on", short && "drive-short")}>
                <input
                  type="radio"
                  name="models-drive"
                  className="sr"
                  checked={on}
                  disabled={short}
                  aria-label={`${d.root} ${size(d.freeMB)} free`}
                  onChange={() => {
                    setTyped(false);
                    setDir(defaultFolder(d.root));
                  }}
                />
                <span className="mono drive-root">{d.root}</span>
                <span className="prog drive-bar" aria-hidden="true">
                  <span style={{ width: `${used}%` }} />
                </span>
                <span className="drive-free">
                  {size(d.freeMB)} free <span className="muted">of {size(d.totalMB)}</span>
                </span>
                {short && <span className="sev s-warn drive-note">Not enough room</span>}
              </label>
            );
          })}
        </fieldset>
      )}
      <label className="label" htmlFor="models-dir">
        Folder
      </label>
      <div className="dirpick">
        <input
          id="models-dir"
          className="field mono"
          value={dir}
          placeholder={example}
          onChange={(e) => {
            setTyped(true);
            setDir(e.target.value);
          }}
        />
        {pick && (
          <Button
            onClick={() =>
              void pick({ title: "Models folder", defaultPath: dir || undefined }).then((p) => {
                if (p) {
                  setTyped(true);
                  setDir(p);
                }
              })
            }
          >
            Browse…
          </Button>
        )}
      </div>
      {typed && !absolutePath(dir.trim()) && dir.trim() && (
        <span className="muted">Type a full path, e.g. {example}.</span>
      )}
      {changing && (
        <div className="formfield">
          <span className="label">The models already downloaded</span>
          <Segmented
            label="The models already downloaded"
            value={choice}
            onChange={setChoice}
            options={CHOICES.map((c) => ({ value: c.value, label: c.label, title: c.title }))}
          />
          <span className="muted">{CHOICES.find((c) => c.value === choice)?.title}.</span>
        </div>
      )}
      {refusal ? (
        <div className="dir-refused" role="alert">
          <span className="sev s-err">
            <Icon name="error" />
            Refused
          </span>
          <span>{refusal.message}</span>
          {refusal.fix && <span className="muted">{refusal.fix}</span>}
        </div>
      ) : plan ? (
        <div className="dir-plan" role="status">
          <span className="sev s-ok">
            <Icon name="check" />
            {size(plan.drive.freeMB)} free on {plan.drive.root}
          </span>
          {changing && plan.installedMB > 0 && (
            <span className="muted">
              Downloaded so far: {size(plan.installedMB)} in {plan.files} file{plan.files === 1 ? "" : "s"}.{" "}
              {choice === "keep"
                ? "They stay where they are."
                : `${choice === "move" ? "Moved" : "Copied"} in a job you can cancel; each file is checked.`}
            </span>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
