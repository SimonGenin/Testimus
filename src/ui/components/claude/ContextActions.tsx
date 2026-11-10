import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { errorToast } from "../../lib/toast.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { CopyContext } from "./CopyContext.tsx";
import { useContextWrite } from "./contexts.ts";
import { SaveContext } from "./SaveContext.tsx";

const styles = stylex.create({
  acts: { display: "flex", flexDirection: "column", alignItems: "stretch", gap: space.s2, minWidth: 0 },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
});

// ponytail: how a saved context comes to be, wherever the saved contexts are listed — made empty (then edited), made
// from what is written in the block, or copied from another project; the owner decides what a new one does (it is
// ticked, it opens)
export function ContextActions({
  text,
  onCreated,
  onSaved,
  disabled = false,
}: {
  /** what is written in the block: « Save the text as a context… » saves it (left out with onSaved: not offered) */
  text?: string;
  /** a context made empty or copied here: the owner ticks it and opens it */
  onCreated: (id: string, how: "new" | "copy") => void;
  /** the block's text became a context: the owner ticks it and empties the block */
  onSaved?: (id: string) => void;
  disabled?: boolean;
}) {
  const write = useContextWrite();
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);

  const create = async () => {
    try {
      // ponytail: like Xray Editor, a new context is seen by every project; « Shared with every project » unticks it
      const c = await write("contexts.create", { shared: true });
      if (c) onCreated(c.id, "new");
    } catch (e) {
      errorToast(e, "Could not create the context");
    }
  };

  return (
    <div {...stylex.props(styles.acts)}>
      <div {...stylex.props(styles.row)}>
        <Button size="sm" icon="plus" label="New context" disabled={disabled} onClick={() => void create()} />
        {onSaved && (
          <Button
            size="sm"
            variant="quiet"
            icon="context"
            label="Save the text as a context…"
            disabled={disabled || (text?.trim() ? false : "Write in the box first")}
            onClick={() => setSaving(true)}
          />
        )}
      </div>
      {!disabled && <CopyContext open={copying} onOpenChange={setCopying} onCopied={(id) => onCreated(id, "copy")} />}
      {saving && onSaved && <SaveContext note={text ?? ""} onSaved={onSaved} onClose={() => setSaving(false)} />}
    </div>
  );
}
