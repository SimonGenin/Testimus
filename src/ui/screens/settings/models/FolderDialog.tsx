import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { Progress } from "../../../components/ui/Progress.tsx";
import { RadioGroup } from "../../../components/ui/RadioGroup.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { ApiError } from "../../../lib/data/client.ts";
import { execute, useRead } from "../../../lib/data/query.ts";
import { absolutePath, examplePath } from "../../../lib/desktop.ts";
import { message } from "../../../lib/format.ts";
import {
  color,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  size as sizes,
  space,
} from "../../../styles/tokens.stylex.ts";
import { useJob } from "../jobs.ts";
import { Hint, Stack } from "../Section.tsx";
import type { SetDirOut } from "./data.ts";
import { bestDrive, defaultFolder, folderPicker, onDrive, size } from "./data.ts";

const styles = stylex.create({
  field: { display: "flex", flexDirection: "column", gap: space.snug },
  label: {
    color: color.text,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    fontWeight: fontWeight.medium,
  },
  root: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: fontFamily.mono,
  },
  free: {
    flexShrink: 0,
    marginInlineStart: space.s3,
    color: color.textMuted,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    whiteSpace: "nowrap",
  },
  drives: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(calc(${sizes.sidebar} * 2 / 3), 1fr))`,
    gap: space.s3,
  },
});

type Choice = "move" | "keep" | "copy";

const CHOICES: { value: Choice; label: string; hint: string }[] = [
  { value: "move", label: "Move them there", hint: "Followed as a job; the old copy is deleted once checked." },
  { value: "keep", label: "Keep them where they are", hint: "Only new downloads go to the new folder." },
  { value: "copy", label: "Copy them", hint: "Both folders hold them; nothing is deleted." },
];

type Refusal = { message: string; fix?: string };

const refusalOf = (e: unknown): Refusal => ({ message: message(e), fix: e instanceof ApiError ? e.fix : undefined });

// ponytail: the folder is saved by a job (models.setDir); a move or a copy is followed by the page, a plain choice is
// waited for here so the next step (a download) finds the folder set
function Saving({ jobId, onDone, onFail }: { jobId: string; onDone: () => void; onFail: (r: Refusal) => void }) {
  useJob(jobId, (job) => {
    if (job.status === "done") onDone();
    else onFail({ message: job.error ?? "The folder could not be saved.", fix: job.fix });
  });
  return null;
}

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
  const client = useQueryClient();
  const hw = useRead("models.hardware", {});
  const [dir, setDir] = useState("");
  const [typed, setTyped] = useState(false);
  const [choice, setChoice] = useState<Choice>("move");
  const [asked, setAsked] = useState("");
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<{ jobId: string; dir: string; action: SetDirOut["action"] } | null>(null);
  const pick = folderPicker();
  const changing = !!current;
  const drives = hw.data?.drives ?? [];

  useEffect(() => {
    const best = hw.data ? bestDrive(hw.data.drives ?? [], needMB) : null;
    if (best) setDir((d) => d || defaultFolder(best));
  }, [hw.data, needMB]);

  // ponytail: the plan is asked once the typing pauses
  useEffect(() => {
    const t = setTimeout(() => setAsked(dir.trim()), 250);
    return () => clearTimeout(t);
  }, [dir]);

  const how = changing ? { [choice]: true } : {};
  const ready = absolutePath(asked) && asked === dir.trim();
  const planned = useRead("models.planDir", { dir: asked, ...how }, { enabled: absolutePath(asked) });
  const plan = ready ? planned.data : undefined;
  const refused = refusal ?? (ready && planned.isError ? refusalOf(planned.error) : null);

  const apply = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const { jobId } = await execute(client, "models.setDir", { dir: dir.trim(), ...how }, { invalidates: "none" });
      const action = plan?.action ?? "set";
      if (action === "move" || action === "copy") {
        setBusy(false);
        onApplied(plan?.dir ?? dir.trim(), jobId, action);
      } else setSaving({ jobId, dir: plan?.dir ?? dir.trim(), action });
    } catch (e) {
      setRefusal(refusalOf(e));
      setBusy(false);
    }
  };

  const example = defaultFolder(drives[0]?.root ?? examplePath("D:\\", "/Users/you"));
  const moving = changing && choice !== "keep" && (plan?.installedMB ?? 0) > 0;
  return (
    <Modal
      title={changing ? "Change the models folder" : "Where should models be stored?"}
      subtitle={
        changing
          ? `Now: ${current}`
          : "Models are big files. Pick a drive with room; this PC remembers the choice for every project."
      }
      footNote={
        moving
          ? `${choice === "move" ? "Moving" : "Copying"} ${size(plan?.installedMB ?? 0)} is followed as a job in Jobs.`
          : needMB > 0
            ? `This download needs ${size(needMB)} (${size(needMB * 1.2)} free with the margin).`
            : undefined
      }
      busy={busy}
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" label="Cancel" onClick={onClose} />
          <Button
            variant="primary"
            label={changing ? "Use this folder" : "Store models here"}
            loading={busy}
            disabled={!plan}
            onClick={() => void apply()}
          />
        </>
      }
    >
      <Stack>
        {saving && (
          <Saving
            jobId={saving.jobId}
            onDone={() => {
              setBusy(false);
              onApplied(saving.dir, null, saving.action);
            }}
            onFail={(r) => {
              setSaving(null);
              setBusy(false);
              setRefusal(r);
            }}
          />
        )}
        {hw.isError ? (
          <Banner tone="warning" compact>
            The drives could not be read: {hw.error.message}. Type a folder below.
          </Banner>
        ) : !hw.data ? (
          <Skeleton kind="block" />
        ) : (
          <div {...stylex.props(styles.field)}>
            <span id="models-drives" {...stylex.props(styles.label)}>
              Drives
            </span>
            <div role="radiogroup" aria-labelledby="models-drives" {...stylex.props(styles.drives)}>
              {drives.map((d) => {
                const short = d.freeMB < needMB * 1.2;
                const used = d.totalMB ? Math.round(((d.totalMB - d.freeMB) / d.totalMB) * 100) : 0;
                return (
                  <Card
                    key={d.root}
                    title={<span {...stylex.props(styles.root)}>{d.root}</span>}
                    actions={
                      <span {...stylex.props(styles.free)}>
                        {size(d.freeMB)} free{d.totalMB ? ` of ${size(d.totalMB)}` : ""}
                      </span>
                    }
                    radio={{
                      name: "models-drive",
                      value: d.root,
                      checked: onDrive(dir.trim(), d.root),
                      disabled: short,
                      onSelect: () => {
                        setTyped(false);
                        setDir(defaultFolder(d.root));
                      },
                    }}
                  >
                    <Progress label={`${d.root} used`} value={used} detail={short ? "Not enough room" : undefined} />
                  </Card>
                );
              })}
            </div>
          </div>
        )}
        <Text
          id="models-dir"
          label="Folder"
          value={dir}
          spellCheck={false}
          placeholder={example}
          onChange={(v) => {
            setTyped(true);
            setRefusal(null);
            setDir(v);
          }}
          hint={typed && dir.trim() && !absolutePath(dir.trim()) ? `Type a full path, e.g. ${example}.` : undefined}
          trailing={
            pick ? (
              <Button
                size="sm"
                variant="quiet"
                label="Browse…"
                onClick={() =>
                  void pick({ title: "Models folder", defaultPath: dir || undefined }).then((p) => {
                    if (!p) return;
                    setTyped(true);
                    setDir(p);
                  })
                }
              />
            ) : undefined
          }
        />
        {changing && (
          <RadioGroup<Choice>
            label="The models already downloaded"
            showLabel
            value={choice}
            onChange={setChoice}
            options={CHOICES.map((c) => ({ value: c.value, label: c.label, hint: c.hint }))}
          />
        )}
        {refused ? (
          <Banner tone="danger" title="Refused">
            <span>
              {refused.message}
              {refused.fix ? ` ${refused.fix}` : ""}
            </span>
          </Banner>
        ) : plan ? (
          <div role="status">
            <Stack>
              <Hint>
                {size(plan.drive.freeMB)} free on {plan.drive.root}
              </Hint>
              {changing && plan.installedMB > 0 && (
                <Hint>
                  Downloaded so far: {size(plan.installedMB)} in {plan.files} file{plan.files === 1 ? "" : "s"}.{" "}
                  {choice === "keep"
                    ? "They stay where they are."
                    : `${choice === "move" ? "Moved" : "Copied"} in a job you can cancel; each file is checked.`}
                </Hint>
              )}
            </Stack>
          </div>
        ) : null}
      </Stack>
    </Modal>
  );
}
