import * as stylex from "@stylexjs/stylex";
import { Button } from "../../../components/ui/Button.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { useApp } from "../../../lib/app.ts";
import { Hint, Stack } from "../Section.tsx";
import type { Installed } from "./data.ts";
import { size } from "./data.ts";

const styles = stylex.create({
  plain: { margin: 0 },
});

// ponytail: removing a model says what goes (a download's files) or stays (a folder registered where it is), and what
// was made with it that stays: a search model's vector spaces, a transcription model's transcripts
export function RemoveDialog({
  label,
  inst,
  speech,
  onConfirm,
  onClose,
}: {
  label: string;
  inst: Installed;
  speech: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const app = useApp();
  return (
    <Modal
      size="sm"
      title={`Remove ${label}?`}
      confirm={{
        verb: "Remove",
        danger: inst.via !== "path",
        icon: inst.via === "path" ? null : undefined,
        onConfirm,
      }}
      onClose={onClose}
    >
      <Stack>
        <p {...stylex.props(styles.plain)}>
          {inst.via === "download"
            ? `Its files (${size(inst.sizeMB)}) are deleted from ${inst.where}.`
            : `Testimus forgets it; the folder ${inst.where} stays on disk.`}
        </p>
        {speech ? (
          <Hint>The videos it heard keep their transcript.</Hint>
        ) : (
          <Hint>
            Vector spaces built with it stay in the index until you drop them in{" "}
            <Button
              variant="link"
              label="Settings › Search"
              disabled={app.info ? false : "Open a project first"}
              onClick={() => {
                onClose();
                app.navigate("settings", "search");
              }}
            />
            .
          </Hint>
        )}
      </Stack>
    </Modal>
  );
}
