import { useState } from "react";
import { cx } from "../../lib/format.ts";
import { Button, Modal } from "../legacy/index.ts";
import { type ContextSummary, contextLine } from "./ContextsDialog.tsx";

export function ImportContexts({
  all,
  picked,
  onUse,
  onManage,
  onClose,
}: {
  all: ContextSummary[];
  picked: string[];
  onUse: (ids: string[]) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const [on, setOn] = useState<string[]>(picked);
  const [find, setFind] = useState("");
  const q = find.trim().toLowerCase();
  const shown = all.filter((c) => !q || c.name.toLowerCase().includes(q));
  const flip = (id: string) => setOn((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  return (
    <Modal
      label="Saved contexts"
      title="Saved contexts"
      subtitle="Reference material Claude reads before this run: notes, files, folders."
      width={520}
      className="ctximport"
      onClose={onClose}
      foot={
        <>
          <Button tone="quiet" onClick={onManage}>
            Manage contexts…
          </Button>
          <span className="spacer" />
          <Button tone="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="primary"
            onClick={() => {
              onUse(on);
              onClose();
            }}
          >
            {on.length ? `Use ${on.length}` : "Use none"}
          </Button>
        </>
      }
    >
      {all.length > 6 && (
        <input
          type="search"
          className="field"
          aria-label="Search contexts"
          placeholder="Search by name"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
      )}
      {!all.length ? (
        <p className="muted">No saved context yet — write a note and « Save as context… », or Manage contexts.</p>
      ) : (
        <ul className="ctximport-list" aria-label="Saved contexts">
          {shown.map((c) => (
            <li key={c.id}>
              <label className={cx("ctximport-row", on.includes(c.id) && "is-on")}>
                <input type="checkbox" checked={on.includes(c.id)} onChange={() => flip(c.id)} />
                <span className="ctximport-text">
                  <span className="ctximport-name">
                    {c.name}
                    {c.shared && <span className="tagpill">shared</span>}
                  </span>
                  <span className="muted">{contextLine(c)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
