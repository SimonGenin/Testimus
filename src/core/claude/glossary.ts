import { z } from "zod";
import { cleanTerms, GLOSSARY_TOKENS } from "../../shared/glossary.ts";
import type { Ctx } from "../command.ts";
import { listDocs } from "../lib/docs.ts";
import { isMediaDoc } from "../lib/media.ts";
import { readProject } from "../lib/project.ts";
import { autoTerms, promptOf } from "../lib/video/glossary.ts";
import { GIVEN_SLOT, given } from "./given.ts";
import { languageName } from "./language.ts";
import { readBlock } from "./parts.ts";
import type { JobRun, PromptTemplate } from "./prompt.ts";
import { runClaude } from "./run.ts";

export const GLOSSARY_MARKER = "Testimus transcription glossary run";
export const GLOSSARY_TAG = "glossary";

type GlossaryFacts = { language: string; current: string[]; auto: boolean; found: string[]; docs: string };

export function glossaryPrompt(ask: string, f: GlossaryFacts, extra: string[] = []): string {
  return [
    `${GLOSSARY_MARKER}: write the glossary the speech engine is given with every passage of the project's videos.`,
    "",
    "The engine (Whisper) hears the videos of the real system and writes what is said. It cannot guess the project's",
    "own words: codes (S12, PR2), acronyms (PCC, DMI), names of equipment, places, screens. The glossary leans it",
    "toward them. Every term you write is sent, in your order, and the engine reads a short sentence: about",
    `${GLOSSARY_TOKENS} tokens, some 60 to 80 terms. A term costs about one token every three characters, plus one.`,
    "Spend them on the words people say aloud in the videos and the engine would write wrong. Never a common word",
    "of the language, never a word written only in tables, never a long phrase. Write each term as the documents",
    "write it (its case, its spaces). The most important first: whatever does not fit at the end is dropped.",
    "Look in the documents with Grep in docs/*/doc.md and docs/*/context.md. Do not edit any file.",
    "",
    ask.trim() ? `The team asks: « ${ask.trim()} »` : "No request: write the best glossary for the project.",
    "",
    `Language of the project: ${languageName(f.language)}.`,
    `Documents: ${f.docs || "(none)"}`,
    `The glossary today (${f.auto ? "taken from the documents by counting" : "written by the team"}): ${f.current.join(", ") || "(empty)"}`,
    `Candidates counted in the documents, most used first: ${f.found.join(", ") || "(none)"}`,
    ...extra,
    "",
    "Reply in 1-3 lines in English: what you kept and why. End the reply with this block, nothing after it:",
    "```" + GLOSSARY_TAG,
    '["PCC", "S12", "Sectionneur"]',
    "```",
    "",
  ].join("\n");
}

export const prompts: PromptTemplate[] = [
  {
    id: "glossary",
    name: "Write the glossary of the transcription",
    group: "Documents",
    kind: "media",
    usedBy: ["Settings › Videos: Have Claude write it", "media.suggestGlossary"],
    answers: "The terms, most important first, in the block that ends the reply",
    text: () =>
      glossaryPrompt(
        "{request}",
        {
          language: "{language}",
          current: ["{term}"],
          auto: true,
          found: ["{term}"],
          docs: "{document} « {title} »; …",
        },
        GIVEN_SLOT,
      ),
  },
];

export type GlossaryDraft = { ok: boolean; terms: string[]; summary: string; costUsd?: number };

// ponytail: Claude writes the list, the app keeps what fits — nothing it returns is shown and then left out
export async function draftGlossary(project: string, ctx: Ctx, ask: string, opts: JobRun = {}): Promise<GlossaryDraft> {
  const p = readProject(project);
  const own = p.video?.glossary;
  const found = autoTerms(project);
  const g = given(project, "media", { kind: "project" }, opts);
  ctx.progress({ message: "Claude writes the glossary of the transcription" });
  const run = await runClaude({
    project,
    kind: "media",
    label: "Glossary of the transcription",
    prompt: glossaryPrompt(
      ask,
      {
        language: p.language,
        current: own ?? promptOf(found, p.language).kept,
        auto: !own,
        found,
        docs: listDocs(project)
          .filter((d) => !isMediaDoc(d))
          .map((d) => `${d.id} « ${d.title} »`)
          .join("; "),
      },
      g.lines,
    ),
    given: g,
    model: opts.model || p.claude.model,
    effort: opts.effort || "medium",
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  const b = run.ok ? readBlock(run.summary, GLOSSARY_TAG, z.array(z.string())) : null;
  const terms = promptOf(cleanTerms(b?.value ?? []), p.language).kept;
  return { ok: terms.length > 0, terms, summary: run.summary, costUsd: run.costUsd };
}
