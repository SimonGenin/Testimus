import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { execute, type Key, type Prefix } from "../../lib/data/query.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { Hint, Stack } from "./Section.tsx";

const styles = stylex.create({
  acts: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
});

const draft = (f: string): Key => [project(), "settings.column", { f }];

// ponytail: a local column lives in test.md only and is never pushed; adding the field in Xray makes it an Xray column
export function NewColumn({ reads }: { reads: Prefix[] }) {
  const client = useQueryClient();
  const [name, setName, clearName] = useDraft(draft("name"));
  const [desc, setDesc, clearDesc] = useDraft(draft("desc"));
  const [adding, setAdding] = useState(!!(name || desc));
  const close = () => {
    clearName();
    clearDesc();
    setAdding(false);
  };
  const add = async () => {
    try {
      await execute(client, "columns.save", { name: name.trim(), description: desc }, { invalidates: reads });
      toast({ kind: "ok", title: `Column ${name.trim()} added`, detail: "Kept in test.md, never pushed to Xray." });
      close();
    } catch (e) {
      errorToast(e, "Could not add the column");
    }
  };
  if (!adding)
    return (
      <div {...stylex.props(styles.acts)}>
        <Button size="sm" icon="plus" label="Add a local column" onClick={() => setAdding(true)} />
        <Hint>
          Local columns are kept in test.md and never pushed. Add the field in Xray and it becomes an Xray column.
        </Hint>
      </div>
    );
  return (
    <Card title="New local column">
      <Stack>
        <Text
          label="Name of the local column"
          value={name}
          onChange={setName}
          placeholder="Remarque testeur…"
          autoFocus
        />
        <Text
          multiline
          label="What Claude writes in it"
          value={desc}
          onChange={setDesc}
          placeholder="Empty: Claude leaves it empty"
        />
        <div {...stylex.props(styles.acts)}>
          <Button
            size="sm"
            variant="primary"
            label="Add the column"
            disabled={!name.trim()}
            onClick={() => void add()}
          />
          <Button size="sm" variant="quiet" label="Cancel" onClick={close} />
        </div>
      </Stack>
    </Card>
  );
}
