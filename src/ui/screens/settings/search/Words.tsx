import { Card } from "../../../components/ui/Card.tsx";
import { Checkbox } from "../../../components/ui/Checkbox.tsx";
import { ChipField } from "../../../components/ui/ChipField.tsx";
import { Field } from "../../../components/ui/Field.tsx";
import { plural } from "../../../lib/format.ts";
import { Stack } from "../Section.tsx";
import type { Draft, Retrieval, RetrievalRead } from "./draft.ts";

const chipOf = (group: string[]) => group.join(" = ");

// ponytail: a chip is one group, « TK = télécommande » (or more, « a = b = c »); a chip without « = » is no group yet
const groupOf = (chip: string) => [...new Set(chip.split("=").map((t) => t.trim()))].filter(Boolean);

// ponytail: how a query's words are matched — French forms (the stems column), accents and case (always: the index
// folds them), typos, and the project's synonyms beside the acronyms read from the documents
export function Words({ draft, glossary }: { draft: Draft; glossary: RetrievalRead["glossary"] }) {
  const r = draft.value as Retrieval;
  const [header, text, codes, forms] = r.bm25Weights;
  const read = glossary.documents + glossary.project;
  return (
    <Card title="Words">
      <Stack>
        <Checkbox
          label="French forms (« manœuvrer » finds « manœuvre », « manœuvrés »)"
          checked={forms !== 0}
          onChange={(on) => draft.change({ bm25Weights: on ? [header, text, codes] : [header, text, codes, 0] })}
        />
        <Checkbox
          label="Accents and case ignored"
          checked
          disabled="Always: the index is built that way"
          onChange={() => {}}
        />
        <Checkbox
          label="Typos forgiven (one letter)"
          hint="A word the documents never use also looks for the words one letter away."
          checked={r.typos}
          onChange={(typos) => draft.change({ typos })}
        />
        <Field
          label="Synonyms and acronyms"
          hint={`Write « TK = télécommande »: a search with one finds the other, both ways.${
            read ? ` Also ${plural(read, "acronym")} read from the documents and the glossary.` : ""
          }`}
        >
          <ChipField
            label="Synonyms and acronyms"
            placeholder="Add « word = word »…"
            values={r.synonyms.map(chipOf)}
            onChange={(chips) => draft.change({ synonyms: chips.map(groupOf).filter((g) => g.length >= 2) })}
          />
        </Field>
      </Stack>
    </Card>
  );
}
