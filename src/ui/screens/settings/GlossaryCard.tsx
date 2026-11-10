import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { GLOSSARY_TOKENS, glossaryTokens } from "../../../shared/glossary.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Chip } from "../../components/ui/Chip.tsx";
import { ChipField } from "../../components/ui/ChipField.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { run } from "../../lib/data/client.ts";
import { invalidate } from "../../lib/data/query.ts";
import { useNow } from "../../lib/now.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { useSetProject } from "./project.ts";
import { Fact, Group, Hint, Row, Stack } from "./Section.tsx";

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
  claude: { display: "flex", alignItems: "center", gap: space.s2, color: color.claudeText },
});

export type Glossary = CommandOutput<"media.glossary">;

const SHOWN = 40;
const FROM_DOCUMENTS = { tone: "neutral", icon: "documents", label: "From the documents" } as const;
const WRITTEN = { tone: "accent", icon: "tag", label: "Written for this project" } as const;

type Suggested = CommandOutput<"media.suggestGlossary">;

// ponytail: the words given to the transcription engine with every passage — the project's list once it or Claude
// wrote one, else the documents' own. Every term shown is sent: a list the engine cannot read whole is not saved.
// Claude writes it from the documents and an optional request, in a Claude block under the terms
export function GlossaryCard({ glossary: g, failed }: { glossary: Glossary | undefined; failed?: string }) {
  const setProject = useSetProject();
  const app = useApp();
  const client = useQueryClient();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState<number | null>(null);
  const now = useNow(1000, asking !== null);
  const [saving, setSaving] = useState(false);
  const language = app.info?.project?.language ?? "en";
  const size = draft ? glossaryTokens(draft, language) : 0;
  const over = size > GLOSSARY_TOKENS;
  const suggest = async () => {
    setAsking(Date.now());
    try {
      const r = await run<Suggested>("media.suggestGlossary", { ask });
      if (r.ok) {
        setAsk("");
        toast({ tone: "success", title: `Claude wrote the glossary: ${r.terms.length} terms` });
      } else toast({ tone: "warning", title: "Claude gave no glossary", detail: r.summary.slice(0, 300) });
      await invalidate(client, [["media.glossary"]]);
      app.refreshInfo();
    } catch (e) {
      errorToast(e, "Claude could not write the glossary");
    } finally {
      setAsking(null);
    }
  };
  const save = async (glossary: string[] | null) => {
    setSaving(true);
    const saved = await setProject({ video: { glossary } }, "the glossary of the transcription");
    setSaving(false);
    if (saved) setDraft(null);
  };
  return (
    <Group
      id="videos-glossary"
      title={
        <span {...stylex.props(styles.head)}>
          Glossary of the transcription
          {g && <Badge {...(g.auto ? FROM_DOCUMENTS : WRITTEN)} size="sm" />}
        </span>
      }
      actions={
        g && draft === null && asking === null ? (
          <Button size="sm" label="Edit by hand" onClick={() => setDraft(g.terms)} />
        ) : undefined
      }
    >
      {!g ? (
        <Row>
          {failed ? (
            <Hint>The glossary could not be read: {failed}</Hint>
          ) : (
            <>
              <Skeleton lines={3} />
              <Loading read="media.glossary" />
            </>
          )}
        </Row>
      ) : draft !== null ? (
        <Row>
          <Stack>
            <ChipField
              label="Terms of the glossary"
              placeholder="Add a term…"
              mono
              autoFocus
              values={draft}
              onChange={setDraft}
            />
            <Progress
              label="Size of the glossary"
              value={Math.min(100, (size / GLOSSARY_TOKENS) * 100)}
              detail={`${size} of ${GLOSSARY_TOKENS} tokens`}
            />
            <Hint>
              {over
                ? "Too long: the engine could not read every term. Remove the least useful ones."
                : "Every term is sent to the engine, in this order: about 60 to 80 fit."}
            </Hint>
            <div {...stylex.props(styles.acts)}>
              <Button
                size="sm"
                variant="primary"
                label="Save"
                loading={saving}
                disabled={over && "The glossary is too long for the engine"}
                onClick={() => void save(draft)}
              />
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
        </Row>
      ) : (
        <>
          <Row>
            <Fact
              label="Terms given to the engine"
              hint="Codes, acronyms, names of equipment the engine cannot guess. It leans toward them; it does not force them."
            >
              {g.terms.length > 0 ? (
                <ul aria-label="Terms given to the engine" {...stylex.props(styles.terms)}>
                  {g.terms.slice(0, SHOWN).map((t) => (
                    <li key={t}>
                      <Chip label={t} mono inField />
                    </li>
                  ))}
                  {g.terms.length > SHOWN && (
                    <li {...stylex.props(type.small, styles.muted)}>+ {g.terms.length - SHOWN} more</li>
                  )}
                </ul>
              ) : (
                <Hint>No term yet: the documents gave none. Have Claude write it, or edit it by hand.</Hint>
              )}
              <Progress
                label="Size of the glossary"
                value={g.budget ? (g.tokens / g.budget) * 100 : 0}
                detail={`${g.tokens} of ${g.budget} tokens, every term is sent`}
              />
            </Fact>
          </Row>
          <Row>
            <span {...stylex.props(type.label, styles.claude)}>
              <Icon name="claude" size="sm" />
              Have Claude write it
            </span>
            <Hint>
              Claude reads the documents and writes the words the engine cannot guess, most important first, as many as
              the engine reads. They replace the terms above.
            </Hint>
            <ClaudeBlock
              id="glossary-ask"
              ariaLabel="What you want of the glossary"
              placeholder="Optional, e.g. add the names of the substations"
              value={ask}
              onChange={setAsk}
              allowEmpty
              submitLabel="Ask Claude"
              onSubmit={() => void suggest()}
              running={asking === null ? null : Math.max(0, (now - asking) / 1000)}
            />
          </Row>
          <Row>
            <Disclosure summary="What the engine is given" quiet>
              {g.prompt ? (
                <p {...stylex.props(type.code, styles.prompt)}>{g.prompt}</p>
              ) : (
                <Hint>Nothing: the glossary has no term.</Hint>
              )}
            </Disclosure>
          </Row>
        </>
      )}
    </Group>
  );
}
