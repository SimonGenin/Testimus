import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { ContextEditor, useWords } from "../../components/claude/ContextEditor.tsx";
import {
  type ContextDetail,
  type ContextSummary,
  contextLine,
  useContextWrite,
} from "../../components/claude/contexts.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { type } from "../../components/ui/type.ts";
import { discardAutosave } from "../../lib/data/autosave.ts";
import { key, useRead } from "../../lib/data/query.ts";
import { contextLabel } from "../../lib/labels.ts";
import { errorToast } from "../../lib/toast.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { tokens } from "./given.ts";
import { useSetProject } from "./project.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s6, minWidth: 0 },
  attached: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  line: { margin: 0, color: color.textMuted, overflowWrap: "anywhere" },
  rule: {
    boxSizing: "border-box",
    height: 0,
    margin: 0,
    borderWidth: 0,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  foot: { display: "inline-flex", alignItems: "center", gap: space.s2, color: color.textMuted },
  subtle: { color: color.textSubtle },
});

// ponytail: one saved context — the team's own piece of what Claude is given, and the one kind edited here: whether it
// is a default of the project (project.json, the one place for that switch), where else it is attached, then its
// name, notes, paths and files (the editor every list of contexts uses), and Delete, which asks first
export function ContextCard({
  context,
  defaults,
  onTests,
  onDeleted,
}: {
  context: ContextSummary;
  /** the project's default contexts (project.json claude.contexts) */
  defaults: string[];
  /** a test attaches it in its own list */
  onTests: boolean;
  onDeleted: () => void;
}) {
  const id = context.id;
  const write = useContextWrite();
  const setProject = useSetProject();
  const read = useRead("contexts.show", { id });
  const detail = read.data as unknown as ContextDetail | undefined;
  const words = useWords(id, detail);
  const [deleting, setDeleting] = useState(false);
  const isDefault = defaults.includes(id);
  const name = contextLabel(words.value ?? detail ?? context);

  useEffect(() => {
    if (read.error) errorToast(read.error, "Could not open the context");
  }, [read.error]);

  const remove = async () => {
    discardAutosave(key("contexts.show", { id }));
    try {
      await write("contexts.remove", { id });
    } catch (e) {
      throw new Error(`Could not delete the context: ${e instanceof Error ? e.message : String(e)}`);
    }
    setDeleting(false);
    onDeleted();
  };

  return (
    <Card
      title={name}
      actions={
        <Button size="sm" variant="quiet" icon="trash" label="Delete context…" onClick={() => setDeleting(true)} />
      }
      footer={
        <span {...stylex.props(type.small, styles.foot)}>
          <Icon name="folder" size="sm" />
          {(detail ?? context).shared ? "In the shared library" : "In this project"}
          <span {...stylex.props(styles.subtle)}>
            · {contextLine(detail ?? context)}
            {detail?.notes.trim() ? ` · ${tokens(detail.notes.trim().length)}` : ""}
          </span>
        </span>
      }
    >
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.attached)}>
          <Switch
            on={isDefault}
            onChange={(on) =>
              void setProject(
                { claude: { contexts: on ? [...defaults, id] : defaults.filter((x) => x !== id) } },
                "the default contexts",
              )
            }
            label="Default of the project"
            hint="Goes with every run on a test or a document that has no contexts of its own, with every question and every generation."
          />
          <p {...stylex.props(type.small, styles.line)}>
            {onTests
              ? "A test also attaches it in its own list: it goes with the runs on that test, and with a request on the whole project."
              : isDefault
                ? "A test or a document with a list of its own takes that list instead."
                : "Not attached: it goes with a run only when it is ticked in the request, or put in a test's or a document's own list."}
          </p>
        </div>
        <hr {...stylex.props(styles.rule)} />
        {detail ? (
          <ContextEditor key={detail.id} detail={detail} words={words} />
        ) : (
          !read.error && (
            <>
              <Skeleton lines={4} />
              <Loading read="contexts.show" />
            </>
          )
        )}
      </div>
      {deleting && (
        <Modal
          title="Delete the context?"
          size="sm"
          confirm={{ verb: "Delete the context", danger: true, onConfirm: remove }}
          consequences={[
            [
              "",
              (detail ?? context).shared
                ? "It is shared: it is deleted for every project, not only this one."
                : "It is deleted from this project.",
            ],
            ["", "The tests, documents and project defaults that named it stop taking it. This cannot be undone."],
          ]}
          onClose={() => setDeleting(false)}
        >
          {`« ${name} » — its notes, files and paths.`}
        </Modal>
      )}
    </Card>
  );
}
