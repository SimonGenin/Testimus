import { ChipField } from "../../../components/ui/ChipField.tsx";
import { Field } from "../../../components/ui/Field.tsx";
import { Switch } from "../../../components/ui/Switch.tsx";
import { plural } from "../../../lib/format.ts";
import { Group, Row } from "../Section.tsx";
import type { Draft, Retrieval, RetrievalRead } from "./draft.ts";

const chipOf = (group: string[]) => group.join(" = ");

// ponytail: a chip is one group, « TK = télécommande » (or more, « a = b = c »); a chip without « = » is no group yet
const groupOf = (chip: string) => [...new Set(chip.split("=").map((t) => t.trim()))].filter(Boolean);

// ponytail: how a query's words are matched — French forms (the stems column), typos, and the project's synonyms
// beside the acronyms read from the documents; accents and case are always folded by the index, so only said
export function Words({ draft, glossary }: { draft: Draft; glossary: RetrievalRead["glossary"] }) {
  const r = draft.value as Retrieval;
  const [header, text, codes, forms] = r.bm25Weights;
  const read = glossary.documents + glossary.project;
  return (
    <Group id="words" title="Words">
      <Row>
        <Field aside label="French forms" hint="Accents and case are always ignored.">
          <div>
            <Switch
              label="« manœuvrer » also finds « manœuvre », « manœuvrés »"
              on={forms !== 0}
              onChange={(on) => draft.change({ bm25Weights: on ? [header, text, codes] : [header, text, codes, 0] })}
            />
          </div>
        </Field>
      </Row>
      <Row>
        <Field aside label="Typos" hint="For a word the documents never use.">
          <div>
            <Switch label="Also look one letter away" on={r.typos} onChange={(typos) => draft.change({ typos })} />
          </div>
        </Field>
      </Row>
      <Row>
        <Field
          aside
          label="Synonyms and acronyms"
          hint={`One finds the other, both ways.${
            read ? ` Also ${plural(read, "acronym")} read from the documents and the glossary.` : ""
          }`}
        >
          <ChipField
            label="Synonyms and acronyms"
            placeholder="TK = télécommande"
            values={r.synonyms.map(chipOf)}
            onChange={(chips) => draft.change({ synonyms: chips.map(groupOf).filter((g) => g.length >= 2) })}
          />
        </Field>
      </Row>
    </Group>
  );
}
