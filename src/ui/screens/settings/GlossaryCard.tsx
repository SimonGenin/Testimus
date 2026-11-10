import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Chip } from "../../components/ui/Chip.tsx";
import { ChipField } from "../../components/ui/ChipField.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { useSetProject } from "./project.ts";
import { Hint, Stack } from "./Section.tsx";

const styles = stylex.create({
  head: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  terms: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  muted: { color: color.textMuted },
  prompt: { margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  acts: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s3 },
});

export type Glossary = CommandOutput<"media.glossary">;

const SHOWN = 40;
const FROM_DOCUMENTS = { tone: "neutral", icon: "documents", label: "From the documents" } as const;
const BY_THE_TEAM = { tone: "accent", icon: "tag", label: "Written by the team" } as const;

// ponytail: the words given to the transcription engine with every passage — the team's list once it wrote one, else
// the documents' own; the engine reads a short sentence, so the list is ordered and what does not fit is said
export function GlossaryCard({ glossary: g, failed }: { glossary: Glossary | undefined; failed?: string }) {
  const setProject = useSetProject();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async (glossary: string[] | null) => {
    setSaving(true);
    const saved = await setProject({ video: { glossary } }, "the glossary of the transcription");
    setSaving(false);
    if (saved) setDraft(null);
  };
  const leftOut = g ? g.terms.filter((t) => !g.kept.includes(t)).length : 0;
  return (
    <Card
      title={
        <span {...stylex.props(styles.head)}>
          Glossary of the transcription
          {g && <Badge {...(g.auto ? FROM_DOCUMENTS : BY_THE_TEAM)} size="sm" />}
        </span>
      }
      actions={g && draft === null ? <Button size="sm" label="Edit" onClick={() => setDraft(g.terms)} /> : undefined}
    >
      {!g ? (
        failed ? (
          <Hint>The glossary could not be read: {failed}</Hint>
        ) : (
          <>
            <Skeleton lines={3} />
            <Loading read="media.glossary" />
          </>
        )
      ) : draft !== null ? (
        <Stack>
          <ChipField
            label="Terms of the glossary"
            placeholder="Add a term…"
            mono
            autoFocus
            values={draft}
            onChange={setDraft}
          />
          <Hint>
            The first terms are the ones kept: the engine reads 60 to 80 terms at most. Write the most important first.
          </Hint>
          <div {...stylex.props(styles.acts)}>
            <Button size="sm" variant="primary" label="Save" loading={saving} onClick={() => void save(draft)} />
            <Button size="sm" label="Cancel" disabled={saving} onClick={() => setDraft(null)} />
            {!g.auto && (
              <Button
                size="sm"
                variant="quiet"
                icon="undo"
                label="Back to the documents' terms"
                disabled={saving}
                onClick={() => void save(null)}
              />
            )}
          </div>
        </Stack>
      ) : (
        <Stack>
          <Hint>
            The words the engine cannot guess: codes, acronyms, names of equipment. It leans the engine toward them; it
            does not force them.
          </Hint>
          {g.kept.length > 0 ? (
            <ul aria-label="Terms given to the engine" {...stylex.props(styles.terms)}>
              {g.kept.slice(0, SHOWN).map((t) => (
                <li key={t}>
                  <Chip label={t} mono inField />
                </li>
              ))}
              {g.kept.length > SHOWN && (
                <li {...stylex.props(type.small, styles.muted)}>+ {g.kept.length - SHOWN} more</li>
              )}
            </ul>
          ) : (
            <Hint>No term yet: the documents gave none. Edit to write the project's own words.</Hint>
          )}
          {leftOut > 0 && (
            <span {...stylex.props(type.small, styles.muted)}>
              {leftOut} left out: the engine reads 60 to 80 terms at most
            </span>
          )}
          <Progress
            label="Size of the glossary"
            value={g.budget ? (g.tokens / g.budget) * 100 : 0}
            detail={`${g.tokens} of ${g.budget} tokens`}
          />
          <Disclosure summary="What the engine is given" quiet>
            {g.prompt ? (
              <p {...stylex.props(type.code, styles.prompt)}>{g.prompt}</p>
            ) : (
              <Hint>Nothing: the glossary has no term.</Hint>
            )}
          </Disclosure>
        </Stack>
      )}
    </Card>
  );
}
