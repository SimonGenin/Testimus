import { SourceChip } from "../../../components/ui/SourceChip.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const noop = () => {};

export const section: KitSection = {
  name: "SourceChip",
  family: "Inputs",
  file: "SourceChip.tsx",
  summary:
    "A claim's source: a sunken pill with the mono reference and the muted quote (the interface face: the serif is for whole passages), with the mechanical check's verdict; opens the passage. The caller formats the reference (docId#anchor).",
  note: "Not a Chip option: a source is two runs (the mono reference, the quote) with a verdict, and it opens a passage, where a Chip is one string you press or remove.",
  states: () => (
    <States>
      <Cell label="ok · figure" column>
        <SourceChip reference="§5.6.6" quote="Selon le type de sectionneur, le menu contextuel diffère" onOpen={noop} />
        <SourceChip reference="fig:40" quote="Figure 40 – Représentation graphique sectionneur" figure onOpen={noop} />
      </Cell>
      <Cell label="open now (pressed) · hover · focus" column>
        <SourceChip
          reference="SOSIE_211_D401-1_3 §5.6.6"
          quote="La fenêtre Propriétés affiche l'état de la position"
          pressed
          onOpen={noop}
        />
        <SourceChip
          reference="§5.6.7"
          quote="les points kilométriques voie 1 et voie 2"
          debugState="hover"
          onOpen={noop}
        />
        <SourceChip
          reference="§5.6.7"
          quote="les points kilométriques voie 1 et voie 2"
          debugState="focus"
          onOpen={noop}
        />
      </Cell>
      <Cell label="not found · not at its anchor" column>
        <SourceChip reference="§5.6.6" quote="Le menu contextuel propose Ouvrir" state="not-found" onOpen={noop} />
        <SourceChip
          reference="§5.6.6"
          quote="les points kilométriques voie 1 et voie 2"
          state="not-at-anchor"
          onOpen={noop}
        />
      </Cell>
      <Cell label="observed (images or a video of the real system: how, never what is expected) · compact" column>
        <SourceChip reference="img:2" quote="IMG_0043.jpg — 2026-10-12 14:05" observed figure onOpen={noop} />
        <SourceChip reference="t:00:32" quote="Là on fait clic droit sur le sectionneur" observed onOpen={noop} />
        <SourceChip reference="frame:01:20" observed compact onOpen={noop} />
      </Cell>
      <Cell label="compact (in a line) · read only" column>
        <SourceChip reference="§5.6.6" quote="Selon le type de sectionneur" compact onOpen={noop} />
        <SourceChip reference="§4.1" quote="La fenêtre affiche l'état" />
      </Cell>
      <Cell label="long quote (cut, full in the tooltip)" wide>
        <SourceChip
          reference="SOSIE_211_D401-1_3 §5.6.6"
          quote="Le sectionneur est représenté sur la schématique de traction par le symbole de la Figure 40, et son état est rappelé dans la fenêtre Propriétés ouverte depuis le menu contextuel"
          onOpen={noop}
        />
      </Cell>
    </States>
  ),
};
