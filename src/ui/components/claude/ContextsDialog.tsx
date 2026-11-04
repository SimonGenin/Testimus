import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { discardAutosave } from "../../lib/data/autosave.ts";
import { key, useRead } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";
import { border, color, fontFamily, fontSize, size, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Icon } from "../ui/Icon.tsx";
import { List } from "../ui/List.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { ContextEditor, useWords } from "./ContextEditor.tsx";
import { CopyContext } from "./CopyContext.tsx";
import { type ContextDetail, type ContextSummary, contextLine, useContexts, useContextWrite } from "./contexts.ts";

export { type ContextSummary, contextLine } from "./contexts.ts";

const styles = stylex.create({
  body: {
    display: "grid",
    gridTemplateColumns: `${size.sidebar} minmax(0, 1fr)`,
    height: "64vh",
    minHeight: size.modalSm,
  },
  side: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    paddingInlineEnd: space.s5,
    borderInlineEndStyle: "solid",
    borderInlineEndWidth: border.width,
    borderInlineEndColor: color.border,
    minWidth: 0,
  },
  main: { paddingInlineStart: space.s6, minWidth: 0, minHeight: 0, overflowY: "auto" },
  centered: { display: "flex", alignItems: "center", justifyContent: "center" },
  path: { display: "inline-flex", alignItems: "center", gap: space.s2, fontFamily: fontFamily.mono },
  muted: { fontSize: fontSize.small, color: color.textSubtle },
});

// ponytail: the dialog that manages saved contexts — opened from Settings › Claude, a test's header and the dock
export function ContextsDialog({ onClose, initialId }: { onClose: () => void; initialId?: string }) {
  const write = useContextWrite();
  const listRead = useRead("contexts.list", {});
  const list = useContexts();
  const [sel, setSel] = useState<string | undefined>(undefined);
  const [copying, setCopying] = useState(false);
  const known = list?.some((c) => c.id === sel);
  const id = known ? sel : undefined;
  const detailRead = useRead("contexts.show", { id: id ?? "" }, { enabled: !!id });
  const detail = id ? (detailRead.data as unknown as ContextDetail | undefined) : undefined;
  const words = useWords(id ?? "", detail);

  useEffect(() => {
    if (!list || (sel && list.some((c) => c.id === sel))) return;
    setSel(initialId && list.some((c) => c.id === initialId) && !sel ? initialId : list[0]?.id);
  }, [list, sel, initialId]);

  useEffect(() => {
    if (listRead.error) errorToast(listRead.error, "Could not list the contexts");
  }, [listRead.error]);
  useEffect(() => {
    if (detailRead.error) errorToast(detailRead.error, "Could not open the context");
  }, [detailRead.error]);

  const create = async () => {
    await words.flush();
    try {
      // ponytail: like Xray Editor, a new context is seen by every project; « Shared with every project » unticks it
      const c = await write("contexts.create", { shared: true });
      if (c) setSel(c.id);
    } catch (e) {
      errorToast(e, "Could not create the context");
    }
  };

  const remove = async () => {
    if (!detail) return;
    discardAutosave(key("contexts.show", { id: detail.id }));
    try {
      await write("contexts.remove", { id: detail.id });
      setSel(undefined);
    } catch (e) {
      errorToast(e, "Could not delete the context");
    }
  };

  const name = (c: ContextSummary) => (c.id === id && words.value ? words.value.name || c.id : c.name || c.id);
  const rows: ContextSummary[] = list ?? [];

  return (
    <Modal
      title="Contexts"
      icon="context"
      size="lg"
      subtitle="Notes, files and folders Claude reads before it works. The project's defaults go with every test that has no list of its own."
      onClose={onClose}
      footNote={
        detail && (
          <span {...stylex.props(styles.path)}>
            <Icon name="folder" size="sm" />
            {detail.shared ? `shared library · ${detail.id}/` : `contexts/${detail.id}/`}
            {detail.shared && <span {...stylex.props(styles.muted)}>· deleted for every project</span>}
          </span>
        )
      }
      actions={detail && <Button variant="quiet" icon="trash" label="Delete context" onClick={() => void remove()} />}
    >
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.side)}>
          <Button block icon="plus" label="New context" onClick={() => void create()} />
          <CopyContext
            open={copying}
            onOpenChange={setCopying}
            onCopied={(c) => void words.flush().then(() => setSel(c))}
          />
          <List
            label="Contexts"
            items={rows}
            getKey={(c) => c.id}
            loading={list === undefined && !listRead.error}
            empty={<span {...stylex.props(styles.muted)}>No context yet.</span>}
            selected={detail?.id ?? null}
            onSelect={(k) => {
              if (k !== id) void words.flush().then(() => setSel(k));
            }}
            renderItem={(c) => ({
              title: name(c),
              lead: <Icon name="text" />,
              meta: `${c.shared ? "shared · " : ""}${contextLine(c)}`,
            })}
          />
        </div>
        <div {...stylex.props(styles.main, !detail && !id && styles.centered)}>
          {detail ? (
            <ContextEditor key={detail.id} detail={detail} words={words} />
          ) : id && !detailRead.error ? (
            <Skeleton lines={4} />
          ) : list !== undefined || listRead.error ? (
            <EmptyState
              icon="context"
              title="No context yet"
              text="A context is a bundle of notes, files and folders Claude reads before it works on a test — a glossary, house rules, the screens of the system under test."
              actions={
                <>
                  <Button variant="primary" icon="plus" label="New context" onClick={() => void create()} />
                  <Button label="Copy from another project…" onClick={() => setCopying(true)} />
                </>
              }
            />
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
