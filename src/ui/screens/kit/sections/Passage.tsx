import { Badge, DOC_STATUS } from "../../../components/ui/Badge.tsx";
import { Passage } from "../../../components/ui/Passage.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const TEXT = [
  "Selon le type de sectionneur, le menu contextuel diffère.",
  "Le menu contextuel d'un sectionneur sans TK propose Propriétés et les commandes d'autorisation et de confirmation d'ouverture et de fermeture.",
  "Un sectionneur avec TK manœuvré régulièrement ne propose que Propriétés.",
];

export const section: KitSection = {
  name: "Passage",
  family: "Collections",
  file: "Passage.tsx",
  summary:
    "A part of a specification as the document says it: where it comes from, the section's number and title, the paragraphs in the reading face with the quoted words highlighted, its figures.",
  note: "The design's passage (kit.mjs passage): the source panel, the dock's passage and the documents reader each drew it, with different captions and figure sizes. The serif is for whole passages, never for a few words inside a control.",
  guidelines: [
    {
      head: "Anatomy",
      text: "Head (small, muted): the reference in mono and the link colour, the document's title, a status badge · body in `reading`: the title in `readingHeading` after its number in mono · paragraphs · figures with their caption.",
    },
    {
      head: "Options",
      text: "`quote` highlights the quoted words (found case and spaces aside) · `dim` mutes the paragraphs that do not hold them · `figureSize`: `preview` (140 px high, beside a test or in the dock) or `full` (the reader).",
    },
  ],
  states: () => (
    <States>
      <Cell label="head · heading · quote" wide column>
        <Passage
          reference="D401-1_3 §5.6.6"
          docTitle="Spécification IHM poste"
          head={<Badge {...DOC_STATUS.validated} size="sm" />}
          anchor="§ 5.6.6"
          heading="Menu contextuel"
          paragraphs={TEXT}
          quote="le menu contextuel   diffère"
        />
      </Cell>
      <Cell label="dim (the cited paragraph stands out)" wide column>
        <Passage paragraphs={TEXT} quote="ne propose que Propriétés" dim />
      </Cell>
      <Cell label="figure (placeholder until it loads) · caption" wide column>
        <Passage
          anchor="§ 5.6.7"
          heading="Synoptique"
          paragraphs={["Le synoptique montre l'état de chaque sectionneur."]}
          figures={[{ caption: "Figure 12 — Synoptique du poste" }]}
        />
      </Cell>
    </States>
  ),
};
