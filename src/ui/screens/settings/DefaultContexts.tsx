import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ContextsDialog } from "../../components/claude/ContextsDialog.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Chip } from "../../components/ui/Chip.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { invalidate, useRead } from "../../lib/data/query.ts";
import { contextLabel } from "../../lib/labels.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { type ProjectJson, useSetProject } from "./project.ts";

const styles = stylex.create({
  set: { margin: 0, padding: 0, borderWidth: 0, minWidth: 0 },
  chips: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  none: { margin: 0, color: color.textMuted },
});

// ponytail: the contexts attached to every test without a list of its own — one chip per saved context, pressed when it is a default; the list
// itself is read again whenever contexts/ changes (the event bridge), the dialog included
export function DefaultContexts({ chosen }: { chosen: string[] }) {
  const client = useQueryClient();
  const setProject = useSetProject();
  const all = useRead("contexts.list", {});
  const [managing, setManaging] = useState(false);
  const set = (contexts: ProjectJson["claude"]["contexts"]) =>
    void setProject({ claude: { contexts } }, "the default contexts");
  return (
    <Card
      title="Contexts"
      actions={<Button size="sm" icon="context" label="Manage contexts…" onClick={() => setManaging(true)} />}
    >
      <Field
        label="Default contexts — attached to every test that has no list of its own"
        hint="A context is notes, copied files and outside paths Claude reads before it works (contexts/ in the project)."
      >
        <fieldset aria-label="Default contexts" {...stylex.props(styles.set)}>
          {!all.data && !all.isError ? (
            <>
              <Skeleton lines={2} />
              <Loading read="contexts.list" />
            </>
          ) : all.data?.length ? (
            <div {...stylex.props(styles.chips)}>
              {all.data.map((x) => {
                const on = chosen.includes(x.id);
                return (
                  <Chip
                    key={x.id}
                    label={contextLabel(x)}
                    tone="claude"
                    icon="context"
                    pressed={on}
                    strikeOff
                    onToggle={() => set(on ? chosen.filter((id) => id !== x.id) : [...chosen, x.id])}
                  />
                );
              })}
            </div>
          ) : (
            <p {...stylex.props(type.compact, styles.none)}>No context yet.</p>
          )}
        </fieldset>
      </Field>
      {managing && (
        <ContextsDialog
          onClose={() => {
            setManaging(false);
            void invalidate(client, [["contexts.list"]]);
          }}
        />
      )}
    </Card>
  );
}
