import { TextDiff } from "../../../components/ui/TextDiff.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const BEFORE = `## Traction <!-- doc SOSIE_211_D401-1_3 -->

La spécification de la traction : schématique, objets, manœuvre des sectionneurs (§5.6).

## Signalisation <!-- doc SOSIE_211_D401-1_4 -->

Les signaux du poste de commande.

## Le corpus

Deux spécifications fonctionnelles du lot J5.

## Ce qui se contredit

Rien de relevé pour l'instant.`;

const AFTER = `## Traction <!-- doc SOSIE_211_D401-1_3 -->

La spécification de la traction : schématique, objets, manœuvre des sectionneurs (§5.6).

## Signalisation <!-- doc SOSIE_211_D401-1_4 -->

Les signaux du poste de commande.

## Poste de commande — visite du 5 novembre <!-- doc RECETTE_TCO_12-10 -->

Les photos du poste réel : elles montrent ce qu'il fait, pas ce qu'il doit faire.

## Le corpus

Deux spécifications fonctionnelles du lot J5 et les photos d'une visite.

## Ce qui se contredit

Traction §5.6.6 dit que la TK s'affiche dans Propriétés ; la photo img:3 ne la montre pas.`;

export const section: KitSection = {
  name: "TextDiff",
  family: "Feedback",
  file: "TextDiff.tsx",
  summary:
    "What changed between two versions of a text, line by line: a line added on green with +, a line removed on red with −, the unchanged lines far from a change folded into « N unchanged lines ». Mono on a sunken well.",
  note: "Show changes of How the documents fit together (Claude's last update, before and after).",
  guidelines: [
    {
      head: "Options",
      text: "`before` · `after` · `context` (unchanged lines kept around each change, default 2) · `label` (the accessible name).",
    },
    {
      head: "Rules",
      text: "A text a person reads, not code: a few hundred lines at most. Each sign is an icon with its word (Added, Removed). Two equal texts say « No difference. ».",
    },
  ],
  states: () => (
    <States>
      <Cell label="added, removed, folded unchanged lines (context 1)" wide column>
        <TextDiff label="Changes of the last update" before={BEFORE} after={AFTER} context={1} />
      </Cell>
      <Cell label="the whole text (context 20)" wide column>
        <TextDiff label="Changes, in full" before={BEFORE} after={AFTER} context={20} />
      </Cell>
      <Cell label="no difference" column>
        <TextDiff label="No change" before={BEFORE} after={BEFORE} />
      </Cell>
    </States>
  ),
};
