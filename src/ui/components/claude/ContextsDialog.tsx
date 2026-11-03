import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "../../api.ts";
import { desktop, examplePath, pickFolder } from "../../lib/desktop.ts";
import { toBase64 } from "../../lib/files.ts";
import { cx, plural } from "../../lib/format.ts";
import { errorToast } from "../../lib/toast.ts";
import { Button, Icon, IconButton, Modal, Skeleton } from "../ui/index.ts";
import { CopyContext } from "./CopyContext.tsx";

export type ContextSummary = {
  id: string;
  name: string;
  paths: string[];
  files: string[];
  hasNotes: boolean;
  shared?: boolean;
};
type Detail = ContextSummary & { notes: string };
type Text = { id: string; name: string; notes: string };

export const CONTEXTS_EVENT = "testimus:contexts";
const changed = () => window.dispatchEvent(new Event(CONTEXTS_EVENT));

export function contextLine(c: Pick<ContextSummary, "files" | "paths" | "hasNotes">): string {
  const parts = [
    c.files.length ? plural(c.files.length, "file") : "",
    c.paths.length ? plural(c.paths.length, "path") : "",
    c.hasNotes ? "notes" : "",
  ].filter(Boolean);
  return parts.join(" · ") || "empty";
}

export function ContextsDialog({ onClose, initialId }: { onClose: () => void; initialId?: string }) {
  const [list, setList] = useState<ContextSummary[] | null>(null);
  const [draft, setDraft] = useState<Detail | null>(null);
  const [path, setPath] = useState("");
  const dirty = useRef<Text | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const files = useRef<HTMLInputElement>(null);

  const reload = useCallback(
    () =>
      call<ContextSummary[]>("contexts.list", {})
        .then((l) => {
          setList(l ?? []);
          return l ?? [];
        })
        .catch((e) => {
          errorToast(e, "Could not list the contexts");
          setList([]);
          return [] as ContextSummary[];
        }),
    [],
  );

  const open = useCallback((id: string | undefined) => {
    setPath("");
    if (!id) {
      setDraft(null);
      return Promise.resolve();
    }
    return call<Detail>("contexts.show", { id })
      .then(setDraft)
      .catch((e) => errorToast(e, "Could not open the context"));
  }, []);

  // ponytail: name and notes are typed — saved 400 ms after the last key, and on blur, switch, close; paths and
  // files are one gesture each and go straight to disk
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const t = dirty.current;
    if (!t) return Promise.resolve();
    dirty.current = null;
    return call<Detail>("contexts.set", { id: t.id, name: t.name, notes: t.notes })
      .then(() => reload())
      .then(changed)
      .catch((e) => errorToast(e, "Could not save the context"));
  }, [reload]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  useEffect(() => {
    void reload().then((l) => open(initialId && l.some((c) => c.id === initialId) ? initialId : l[0]?.id));
  }, [reload, open, initialId]);

  const edit = (patch: Partial<Text>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    dirty.current = { id: next.id, name: next.name, notes: next.notes };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 400);
  };

  const select = async (id: string) => {
    if (id === draft?.id) return;
    await flush();
    await open(id);
  };

  const apply = (p: Promise<Detail>, what: string) =>
    p
      .then((d) => {
        setDraft((cur) => (cur && cur.id === d.id ? { ...d, name: cur.name, notes: cur.notes } : cur));
        changed();
        return reload();
      })
      .catch((e) => errorToast(e, what));

  const create = async () => {
    await flush();
    try {
      // ponytail: like Xray Editor, a new context is seen by every project; « Shared with every project » unticks it
      const c = await call<Detail>("contexts.create", { shared: true });
      await reload();
      changed();
      setDraft(c);
      setPath("");
    } catch (e) {
      errorToast(e, "Could not create the context");
    }
  };

  const addPath = async (raw: string) => {
    const p = raw.trim();
    if (!draft || !p || draft.paths.includes(p)) return;
    await flush();
    await apply(call<Detail>("contexts.set", { id: draft.id, paths: [...draft.paths, p] }), "Could not add the path");
    setPath("");
  };

  const removePath = async (p: string) => {
    if (!draft) return;
    await flush();
    await apply(
      call<Detail>("contexts.set", { id: draft.id, paths: draft.paths.filter((x) => x !== p) }),
      "Could not remove the path",
    );
  };

  const addFiles = async (picked: FileList | null) => {
    if (!draft || !picked?.length) return;
    const id = draft.id;
    for (const f of Array.from(picked))
      await apply(
        toBase64(f).then((dataBase64) => call<Detail>("contexts.addFile", { id, name: f.name, dataBase64 })),
        `Could not copy ${f.name} into the context`,
      );
  };

  const share = async (shared: boolean) => {
    if (!draft) return;
    await flush();
    await apply(call<Detail>("contexts.share", { id: draft.id, shared }), "Could not move the context");
  };

  const removeFile = (name: string) =>
    draft && void apply(call<Detail>("contexts.removeFile", { id: draft.id, name }), `Could not remove ${name}`);

  const remove = async () => {
    if (!draft) return;
    clearTimeout(timer.current);
    dirty.current = null;
    try {
      await call("contexts.remove", { id: draft.id });
      changed();
      const rest = await reload();
      await open(rest[0]?.id);
    } catch (e) {
      errorToast(e, "Could not delete the context");
    }
  };

  return (
    <Modal
      label="Contexts"
      title="Contexts"
      subtitle="Notes, files and paths Claude reads before it works — attached per project and per test"
      width={940}
      className="ctxdlg"
      onClose={onClose}
      foot={
        <>
          <span className="spacer" />
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="ctxdlg-body">
        <div className="ctxdlg-list" role="listbox" aria-label="Contexts">
          {!list && <Skeleton h={40} />}
          {list?.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={c.id === draft?.id}
              className={cx("ctxdlg-item", c.id === draft?.id && "ctxdlg-item-on")}
              onClick={() => void select(c.id)}
            >
              <span className="ctxdlg-name">{c.id === draft?.id ? draft.name || c.id : c.name || c.id}</span>
              <span className="muted ctxdlg-line">
                {c.shared ? "shared · " : ""}
                {contextLine(c)}
              </span>
            </button>
          ))}
          <Button size="sm" tone="quiet" icon="plus" onClick={() => void create()}>
            New context
          </Button>
          <CopyContext
            onCopied={(id) =>
              void flush()
                .then(reload)
                .then(() => {
                  changed();
                  return open(id);
                })
            }
          />
        </div>
        {draft ? (
          <div className="ctxdlg-editor">
            <div className="formfield">
              <label className="label" htmlFor="ctx-name">
                Name
              </label>
              <input
                id="ctx-name"
                className="field"
                value={draft.name}
                onChange={(e) => edit({ name: e.target.value })}
                onBlur={() => void flush()}
              />
            </div>
            <label className="ctxdlg-share">
              <input type="checkbox" checked={!!draft.shared} onChange={(e) => void share(e.target.checked)} />
              <span>
                Shared with every project{" "}
                <span className="muted">
                  {draft.shared ? "(kept in the Testimus library)" : "(kept in this project's folder)"}
                </span>
              </span>
            </label>
            <div className="formfield">
              <label className="label" htmlFor="ctx-notes">
                Notes <span className="muted">(markdown, read by Claude)</span>
              </label>
              <textarea
                id="ctx-notes"
                className="field ctxdlg-notes"
                rows={7}
                placeholder="Anything Claude should know: conventions, glossary, where things are…"
                value={draft.notes}
                onChange={(e) => edit({ notes: e.target.value })}
                onBlur={() => void flush()}
              />
            </div>
            <div className="formfield">
              <span className="label">
                Paths <span className="muted">(folders or files Claude may read in place)</span>
              </span>
              {draft.paths.map((p) => (
                <div key={p} className="ctxdlg-row">
                  <Icon name="folder" />
                  <span className="mono ctxdlg-path" title={p}>
                    {p}
                  </span>
                  <IconButton icon="close" label={`Remove path ${p}`} onClick={() => void removePath(p)} />
                </div>
              ))}
              <div className="ctxdlg-add">
                <input
                  className="field mono"
                  aria-label="Path to add"
                  placeholder={examplePath("D:\\Specs\\J5", "/Users/you/Specs/J5")}
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addPath(path);
                    }
                  }}
                />
                <Button size="sm" disabled={!path.trim()} onClick={() => void addPath(path)}>
                  Add
                </Button>
                {desktop() && (
                  <Button
                    size="sm"
                    onClick={() => void pickFolder("Choose a folder Claude may read").then((p) => p && void addPath(p))}
                  >
                    Browse folder…
                  </Button>
                )}
              </div>
            </div>
            <div className="formfield">
              <span className="label">
                Files <span className="muted">(copied into the context — images, PDFs, anything)</span>
              </span>
              {draft.files.map((f) => (
                <div key={f} className="ctxdlg-row">
                  <Icon name="documents" />
                  <span className="mono ctxdlg-path" title={f}>
                    {f}
                  </span>
                  <IconButton icon="close" label={`Remove file ${f}`} onClick={() => removeFile(f)} />
                </div>
              ))}
              <div className="ctxdlg-add">
                <input
                  ref={files}
                  type="file"
                  multiple
                  hidden
                  aria-label="Files to add"
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button size="sm" icon="plus" onClick={() => files.current?.click()}>
                  Add files…
                </Button>
              </div>
            </div>
            <div className="ctxdlg-foot">
              <span className="muted mono">
                {draft.shared ? `shared library · ${draft.id}/` : `contexts/${draft.id}/`}
              </span>
              <span className="spacer" />
              <Button
                size="sm"
                tone="danger"
                icon="trash"
                title={draft.shared ? "Deleted for every project" : undefined}
                onClick={() => void remove()}
              >
                Delete context
              </Button>
            </div>
          </div>
        ) : (
          list && (
            <div className="ctxdlg-empty">
              <strong>No context yet</strong>
              <p className="muted">
                A context is a bundle of notes, files and paths Claude reads before it works on a test.
              </p>
            </div>
          )
        )}
      </div>
    </Modal>
  );
}
