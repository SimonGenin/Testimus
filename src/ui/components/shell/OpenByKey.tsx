import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { useApp } from "../../lib/app.ts";
import { useCommand, useRead } from "../../lib/data/query.ts";
import { showProject } from "../../lib/desktop.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { fontFamily } from "../../styles/tokens.stylex.ts";
import { Banner } from "../ui/Banner.tsx";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Text } from "../ui/Text.tsx";

const KEY = /^[A-Z][A-Z0-9_]*$/;

const styles = stylex.create({ mono: { fontFamily: fontFamily.mono } });

// ponytail: the key as typed once the typing pauses — the folder it would open is asked then, not on every letter
function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

// ponytail: Xray Editor opens a project from its Jira code (its top bar's « Go ») — a known project with that key,
// else a new project folder named after it beside the current one; the dialog says which before the button does it
export function OpenByKey({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const openKey = useCommand("project.openKey", { invalidates: [["project.list"]] });
  const k = key.trim();
  const asked = useSettled(k, 250);
  const plan = useRead(
    "project.openKey",
    { key: asked, dryRun: true },
    { enabled: KEY.test(asked), project: null, keepPrevious: true },
  );
  const would = asked === k && KEY.test(k) ? plan.data : undefined;
  const go = async () => {
    if (!k) return;
    setBusy(true);
    try {
      const r = await openKey.mutateAsync({ key: k });
      showProject(app, r.dir);
      if (r.created) toast({ kind: "ok", title: `Project ${k} created`, detail: r.dir });
      onClose();
    } catch (e) {
      errorToast(e, `Could not open ${k}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Open a project by its Jira key"
      icon="key"
      subtitle="A known project with that key opens; otherwise a new project folder named after it is made beside this one."
      size="sm"
      onClose={onClose}
      onSubmit={() => void go()}
      actions={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button
            variant="primary"
            type="submit"
            label={would?.created ? "Create and open" : "Open"}
            loading={busy}
            disabled={!k}
          />
        </>
      }
    >
      <Text
        label="Jira project key"
        value={key}
        onChange={(v) => setKey(v.toUpperCase())}
        placeholder="LFRPS12"
        autoFocus
        spellCheck={false}
        hint="Upper case, as in Jira: LFRPS12, BHPTCC."
      />
      {would && (
        <Banner tone="neutral" compact icon="folder">
          {would.created ? "No project here has this key: Testimus will create " : "Testimus opens "}
          <span {...stylex.props(styles.mono)}>{would.dir}</span>.
        </Banner>
      )}
    </Modal>
  );
}
