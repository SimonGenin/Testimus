import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ContextsDialog } from "../../components/claude/ContextsDialog.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { invalidate, useRead } from "../../lib/data/query.ts";
import { type ProjectJson, useSetProject } from "./project.ts";
import { Hint, Stack } from "./Section.tsx";

const styles = stylex.create({
  set: { margin: 0, padding: 0, borderWidth: 0, minWidth: 0 },
});

// ponytail: the contexts attached to every test without a list of its own — one switch per saved context; the list
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
      <Stack>
        <Hint>Default contexts — attached to every test that has no list of its own</Hint>
        <fieldset aria-label="Default contexts" {...stylex.props(styles.set)}>
          {!all.data && !all.isError ? (
            <Skeleton lines={2} />
          ) : all.data?.length ? (
            <Stack>
              {all.data.map((x) => {
                const on = chosen.includes(x.id);
                return (
                  <Switch
                    key={x.id}
                    label={x.name || x.id}
                    on={on}
                    onChange={(next) => set(next ? [...chosen, x.id] : chosen.filter((id) => id !== x.id))}
                  />
                );
              })}
            </Stack>
          ) : (
            <Hint>No context yet.</Hint>
          )}
        </fieldset>
        <Hint>
          A context is notes, copied files and outside paths Claude reads before it works (contexts/ in the project).
        </Hint>
      </Stack>
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
