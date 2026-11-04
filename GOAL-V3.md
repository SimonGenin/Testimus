# Goal — Testimus v3 : le grand nettoyage, en une passe

## Objectif

Le code de Testimus a été écrit vite. Il marche, mais il ne peut pas rester tel quel. Cette passe le **réécrit
proprement, en entier**, sans perdre une seule fonctionnalité, et en appliquant au passage le nouveau design system
(voir « Entrée design »). Ce n'est pas une revue qui produit une liste de remarques : on refactore réellement, zone
par zone, et les tests prouvent que rien n'est perdu.

On vise une qualité extrême sur quatre axes, détaillés par les principes N1 à N7 plus bas :
1. **Tout ce qu'on peut faire dans Testimus est une commande** du registre, utilisable depuis la CLI, le MCP et
   l'UI. Un agent a donc la main sur toute l'application.
2. **Un seul composant par contrôle.** Une zone de texte, un bouton, un select, une case à cocher, une liste…
   existent chacun une seule fois, avec des options. Les variantes partent du composant de base, elles ne le
   copient pas.
3. **Une seule couche de données** pour le cache, la synchronisation avec le serveur, l'autosave, les conflits et
   l'état hors ligne, écrite de façon générique et modulaire.
4. **Tout est testé**, et l'architecture se lit sans effort.

C'est fini quand **chacun** de ces points est vrai et prouvé dans le rapport, par la commande et sa sortie :
1. Les gardes de N1, N2, N4 et N7 sont bloquantes et comptent **zéro écart** (`npm test` les exécute).
2. `npm run build`, `npm run check`, `npm test` et `npx playwright test` (dont `tests/e2e/desktop`) sont verts,
   **lancés après la dernière écriture**, sur la branche `grand-nettoyage`.
3. La couverture ne baisse dans aucun dossier par rapport à la ligne de base, et elle atteint au moins 90 % des
   lignes dans `src/core/`, `src/shared/`, `src/ui/components/ui/` et `src/ui/lib/data/`.
4. Chaque ligne de `PARITY.md` cite le test qui la prouve, et ce test est vert.
5. `npm run screens -- --out dist/screens-after` ne perd aucune capture par rapport à `dist/screens/`, la console
   est sans erreur dans chaque capture, et chaque écart à une maquette de `design/screens/` est justifié dans le
   rapport.
6. L'écran `#/kit` montre chaque composant du kit dans chacun de ses états, en clair et en sombre.
7. La revue contradictoire de la vague 5 a tourné, et chacun de ses constats est corrigé ou réfuté dans le
   rapport.
8. `SPEC.md` (§1, §2, §3, §6, §12, §13), `CLAUDE.md` (Layout, règles d'architecture, conventions), `ROADMAP.md` et
   `PARITY.md` décrivent ce qui existe vraiment.
9. `.build/v3/REPORT.md` existe et reprend ces dix points un par un, avec leur preuve.
10. Un **agent frais** (sans le contexte de la passe, agent 91 `repasse-design`) a relu toute l'interface et
    vérifié qu'elle utilise le design system **partout**, pour qu'un changement se fasse ensuite en un seul
    endroit : chaque contrôle est un composant du kit, chaque icône est celle de la maquette (`design/icons`,
    `design/build/screens/*.mjs`), chaque couleur, taille, espacement, rayon, ombre ou police vient de
    `tokens.stylex.ts`, aucun écran ne recopie un composant du kit ni n'en contourne une option. Chacun de ses
    constats est corrigé, ou justifié dans le rapport (raison, source).

## Lancement

Cette passe est lancée avec **`/goal`** : tu ne t'arrêtes pas tant que les dix points de « C'est fini quand »
ne sont pas tous vrais. Pas de « j'ai fini la vague 2, je fais une pause », pas de rapport intermédiaire présenté
comme une fin. Si le contexte se compacte ou si la session redémarre, tu reprends par « Ta propre reprise ».

**Elle tourne en même temps que la session design** (`GOAL-DESIGN.md`), qui remplit `design/`. Tu avances sur
tout ce qui ne dépend pas du design (vagues 0 à 2 : l'audit, les fondations du cœur, les agents du cœur), puis tu
attends à la **porte design** avant les jetons, le kit et l'interface (voir « Les vagues »).
- La porte s'ouvre quand **`design/READY.md`** existe : la session design l'écrit en tout dernier, une fois
  `design/` complet et vérifié. Elle t'envoie aussi un message (`SendMessage`), mais c'est le fichier qui fait foi.
- Si tu arrives à la porte avant elle, attends avec l'outil `Monitor` (une boucle qui s'arrête quand le fichier
  existe, délai long), et traite pendant ce temps les `BESOIN:` des agents du cœur. N'invente pas de design, et ne
  pars pas de l'ancien pour avancer.
- **Tu n'écris jamais dans `design/`**, et la session design n'écrit jamais ailleurs que dans `design/`.
- Avant la porte, si une question sur le design bloque une décision du cœur (une commande à prévoir pour un geste
  nouveau, par exemple), écris à la session design (`SendMessage`, la session dont le titre contient « design »
  dans `ListAgents`). Après la porte, elle reste disponible pour tes questions ; si elle ne répond pas, tranche
  selon « Ne pose aucune question ».

**Préalable** : les captures « avant » (`npm run screens`, dans `dist/screens/`) se prennent sur le code de
départ, avant que quoi que ce soit change. Simon les lance avant d'ouvrir les deux sessions. Si
`dist/screens/manifest.json` manque quand tu démarres, c'est **toi** qui le lances, en premier (la session design
ne le lance jamais).

Tu es l'**orchestrateur** : tu écris toi-même les fondations et tu lances des sous-agents (outil `Agent`) pour
le reste. Qui fait quoi est dans « Sous-agents ».

La ligne de lancement (courte, parce que `/goal` peut limiter sa longueur) :

```
/goal Exécute GOAL-V3.md (le grand nettoyage de Testimus) jusqu'au bout, en orchestrant les sous-agents qu'il décrit. Fini quand les 10 points de « C'est fini quand » sont vrais et prouvés dans .build/v3/REPORT.md : gardes à zéro, build/check/tests/e2e verts après la dernière écriture, couverture tenue, aucune capture perdue, PARITY.md prouvé, revue contradictoire traitée, docs à jour. Lis GOAL-V3.md en entier avant tout.
```

## Ne pose aucune question

Pas d'AskUserQuestion, pas de « voulez-vous… », pas de pause en attendant une réponse. Personne ne répondra avant la
fin.
- Une question prend **la réponse du tableau « Décisions » ci-dessous**.
- Si elle n'y est pas : prends le choix le plus simple qui respecte `SPEC.md` et les principes N1–N7.
- Un obstacle se contourne. Seule une impossibilité réelle t'arrête, et tu l'expliques dans le rapport final, avec ce
  qu'il faudrait pour la lever.

Chaque choix fait ainsi est noté dans `.build/v3/state.md` (section « Décisions prises »), puis dans le rapport
final, et dans `SPEC.md` quand il fixe un comportement ou une règle d'architecture.

## À lire avant tout

- `CLAUDE.md`, `SPEC.md` en entier (surtout §1 Stack, §2 Architecture, §12 Command catalog, §13 UI, §15
  Verification bar), `ROADMAP.md`, `PARITY.md`.
- `SPEC-RAG.md` et `SPEC-ELECTRON.md` : ce sont les archives de conception. Lis-les pour comprendre pourquoi une
  chose est faite comme elle est **avant** de la réécrire.
- `GOAL-V2.md` : les règles d'orchestration de la passe précédente, reprises ici.
- Les skills de `.claude/skills/` (dont `port-from-xray-editor` : ce qui vient de Xray Editor y est expliqué) et
  ceux de `templates/project/.claude/skills/`, qui sont du code produit.
- **L'entrée design** (ci-dessous), en entier.

## Entrée design

En même temps que cette passe, la session design (`GOAL-DESIGN.md`) produit le nouveau design system et les
nouveaux écrans dans **`design/`**, à la racine du dépôt. La passe design ne touche pas `src/` : tout ce qu'elle produit est dans ce
dossier.
- `design/tokens.css` : les jetons, en variables CSS aux noms sémantiques et plats (`--color-surface-raised`,
  `--space-3`…). C'est un design system **redéfini de zéro** : ses noms ne suivent pas les anciens, et l'ancien
  `tokens.css` n'est pas une référence.
- `design/SYSTEM.md` : le design system, c'est-à-dire les principes, puis chaque composant du kit (N2) avec ses
  options, ses états et ses règles d'usage.
- `design/components.md` : la table « ce qui existe aujourd'hui → le composant du kit et l'option qui le
  remplacent » (les doublons à unifier).
- `design/screens/<area>/<scénario>/<capture>/` : une maquette par écran et par état, en HTML statique
  (`index.html`, qui n'utilise que `design/tokens.css`), plus `<taille>-<thème>.png`. `<area>` est la zone d'un
  agent `ui-*` (`tests`, `claude`, `review`…), et `<scénario>/<capture>` est l'identifiant stable de
  `dist/screens/manifest.json` : avant, maquette et après se comparent terme à terme.
- `design/PARITY-GAPS.md` : chaque capacité de `PARITY.md` que les maquettes ne montrent pas, et où elle va.
- `design/SOURCES.md` : les liens des artefacts claude.ai d'où vient le design (un artefact « Design System »
  pour les jetons et les composants, des artefacts « Design » pour les écrans), s'il y en a. Ces artefacts restent
  la référence quand on retravaille le design. Le nettoyage, lui, lit **seulement les fichiers locaux** de
  `design/` : la passe design les y exporte.
- `design/READY.md` : écrit en tout dernier par la session design. Il ouvre la porte design (voir « Lancement »).
- Les jetons du design remplacent ceux de `src/ui/styles/tokens.css` et deviennent `tokens.stylex.ts`
  (décision 10). Les composants du design deviennent les
  primitives de N2. Les maquettes deviennent les écrans.
- Si le design montre un composant que N2 ne prévoit pas, on l'ajoute au kit. Si deux maquettes dessinent la même
  chose de deux façons, on en fait **un seul** composant avec une option, et on note l'écart dans le rapport.
- Si le design fait disparaître ou change une capacité de `PARITY.md`, **la capacité gagne** : on la garde, on la
  place au plus près de la maquette, et on note l'écart dans le rapport.
- La session design remplit `design/` **pendant** que tu travailles sur le cœur. Tu ne lis `design/` qu'une
  fois la porte ouverte (`design/READY.md`) : avant, il est incomplet. Le nouveau design n'est pas facultatif, et
  l'ancien n'est pas un repli.

## Ce qu'on sait déjà (relevé le 2026-11-03, à confirmer dans l'audit)

- 121 commandes dans `src/core/commands/` ; `faces/http.ts` n'expose que `/api/<group>/<verb>`, `/api/events` et
  `/files/`. Le principe « un registre, trois faces » est en place côté cœur. Ce qui reste à prouver, c'est que
  l'UI ne fait rien en dehors.
- Il existe un kit `src/ui/components/ui/` (Button, IconButton, Field, GrowArea, Menu, Modal, Segmented, Tabs,
  ChipInput…), mais les écrans le contournent :
  - `<textarea>` nu dans 10 fichiers (dont `ClaudeDock.tsx`, `AdditionalContext.tsx`, `FixNote.tsx`,
    `ProjectSection.tsx`, `ContextsDialog.tsx`, `CommandForm.tsx`) ;
  - `<input>` nu dans environ 30 fichiers ;
  - `<button>` nu dans 48 fichiers ;
  - `<select>` nu dans 12 fichiers.
- L'autosave à 400 ms est écrit **trois fois** à la main (`TestEditor.tsx`, `ProjectSection.tsx`,
  `ContextsDialog.tsx`). Les brouillons passent par `lib/drafts.ts`, le vidage avant suppression par les variables
  globales de `lib/editorBus.ts`.
- Les données serveur arrivent par 178 `useEffect`, chacun avec son `call(...)`, et les rafraîchissements passent
  par des événements `window` (`ACTIONS_EVENT`…) ou par `events()` (SSE) branché écran par écran.
- Quelques fichiers sont trop gros pour être lus d'un coup : `TestEditor.tsx` (1 121 lignes), `ClaudeDock.tsx`
  (1 067), `jira.ts` (977), `docs.ts` (723), `types.ts` (680).
- Les préférences de vue (largeurs, thème, disposition des étapes…) sont 18 clés `testimus.*` dans `localStorage`,
  lues et écrites un peu partout.
- 234 fichiers de tests unitaires, dont beaucoup sont nommés `cov-*` (écrits pour la couverture et non par
  comportement), et 22 specs e2e.

## Principes

### N1 — Tout est une commande

- Tout ce qu'un utilisateur peut **faire** (créer, modifier, supprimer, lancer, annuler, valider, pousser,
  importer, régler) est une commande du registre, avec ses schémas zod d'entrée et de sortie et un `.describe()` sur
  chaque champ. L'UI l'appelle par `call("<group>.<verb>")`, et rien d'autre. Un bouton qui appelle du code métier
  directement, ou qui enchaîne trois appels pour faire une seule chose que Claude ne pourrait pas refaire en un
  appel, c'est un bug : on en fait une commande.
- Ne confonds pas ce mot avec les « actions » qui existent déjà (`actions.*`, les actions que Claude propose) : elles
  restent ce qu'elles sont.
- L'UI peut garder **seulement l'état de présentation** : largeurs, plis, onglet ouvert, thème, disposition. Tout cet
  état passe par **un seul module de préférences typé** (une clé, un type, une valeur par défaut, une liste
  déclarée), plus jamais par `localStorage` appelé directement. Une préférence qui change ce que fait l'application
  (modèle par défaut, contextes…) n'est pas de la présentation : c'est une commande.
- Une commande a un nom de verbe clair, une seule responsabilité, une sortie typée, des erreurs `UserError` avec un
  `fix` quand l'utilisateur peut agir. Une commande qui modifie Jira accepte `--dry-run`. Les longues tâches passent
  par `jobs`.
- Les faces restent minces : aucune logique métier dans `src/faces/`, aucune dans `src/ui/` hors de la présentation.
- **Gardes** : (a) un test qui lit tous les `call("…")` de `src/ui/` et échoue si un nom n'est pas dans le registre ;
  (b) un test qui échoue si `src/ui/` importe autre chose que des **types** depuis `src/core/` ; (c) un test qui
  échoue si `src/ui/` appelle `fetch`, `EventSource` ou `localStorage` ailleurs que dans la couche de données et le
  module de préférences ; (d) un test qui échoue si `faces/http.ts` sert une route en dehors de la liste connue.

### N2 — Un composant par contrôle, des options plutôt que des copies

- Chaque contrôle existe **une seule fois** dans `src/ui/components/ui/` : bouton (avec ses variantes et l'icône
  seule), champ de texte, zone de texte, select, case à cocher, interrupteur, choix segmenté, liste et élément de
  liste, menu, onglets, fenêtre modale, confirmation, puce et champ à puces, badge, infobulle, toast, squelette de
  chargement, poignée de redimensionnement, tableau.
- En dehors de `components/ui/`, **interdit** : `<button>`, `<input>`, `<textarea>`, `<select>`, `contentEditable`.
  **Garde** : un test ou une règle de lint qui échoue dès qu'un de ces éléments apparaît ailleurs.
- **Le texte éditable**, c'est l'exemple qui fixe la règle pour tout le reste. Il n'existe qu'**un seul**
  composant texte (sur une ligne ou plusieurs, selon une option) qui sait :
  - grandir avec son contenu (ce que fait `GrowArea` aujourd'hui) ;
  - **se sauvegarder tout seul** : l'autosave de la couche de données (N3) avec un délai de 400 ms, vidé quand le
    champ perd le focus, quand la fenêtre perd le focus et quand le composant disparaît ;
  - afficher son état : enregistré, en cours, en erreur avec une nouvelle tentative, conflit avec le disque ;
  - garder un brouillon quand on change d'écran (ce que fait `useDraft` aujourd'hui) ;
  - passer en lecture seule pendant que Claude travaille.

  Un écran ne réécrit jamais ces comportements : il passe une commande de sauvegarde et une valeur, rien de plus.
- **Le bloc Claude** (la saisie du dock, « Ask Claude » sur un test ou une étape, la note « To fix », les contextes
  additionnels, les quick asks) est **un seul composant**, construit **sur** le composant texte ; il ne le recopie
  pas. Ce qui le distingue, ce sont des options : contextes oui ou non, quick asks oui ou non, choix du modèle et de
  l'effort, pièces jointes, envoi par Entrée ou autosave. Une fonctionnalité ajoutée au composant texte (un
  correcteur, un raccourci, une mention) marche donc aussitôt dans le bloc Claude. Il n'y a ni `ClaudeTextarea`, ni
  `DockInput`, ni `FixNoteInput` : ce sont des réglages du même composant.
- On étend un composant de trois façons, dans cet ordre de préférence :
  1. **une option** sur le composant existant ;
  2. **un composant qui l'enveloppe** et lui passe ses props (c'est ce que « hériter » veut dire en React) ;
  3. **un composant nouveau**, seulement s'il ne ressemble à aucun autre, et en écrivant pourquoi dans le
     catalogue (N5).

  Copier le JSX d'un composant pour le modifier n'est jamais une option.
- Un fichier de composant fait une seule chose. Au-delà d'environ 300 lignes, on le découpe (sous-composants,
  hooks), sauf s'il y a une raison écrite.

### N3 — Une seule couche de données

- Tout l'état serveur (les sorties des commandes) passe par **une seule couche** : un cache par clé
  `commande + entrée`, la déduplication des lectures identiques, l'annulation (`AbortSignal`), la relecture quand
  `/api/events` annonce un changement (fin de job, fichier modifié, action proposée), les mises à jour optimistes
  avec retour en arrière si l'appel échoue, un état « périmé », un état « serveur injoignable » et la reprise quand
  il revient.
- L'autosave est une **mutation de cette couche** (avec délai, regroupement, un seul envoi à la fois par clé, et le
  vidage avant de quitter). Ce n'est plus un minuteur dans chaque écran. Les conflits avec le disque (le `mtime` de
  `test.md` modifié pendant l'édition) se gèrent ici, une seule fois.
- Ce qui disparaît : les `useEffect(() => call(...))` dispersés, les événements `window` maison qui servent à se
  rafraîchir, les variables globales de `editorBus.ts`, les trois minuteurs d'autosave.
- Le SSE est ouvert **une seule fois**. La couche traduit chaque événement en invalidation de clés précises. Un
  écran ne s'abonne jamais lui-même.
- **Garde** : le test N1 (c), plus des tests unitaires de la couche (cache, invalidation, optimiste et retour en
  arrière, autosave vidé au démontage, conflit, serveur perdu puis retrouvé).

### N4 — Une architecture qui se lit

- **Cœur** : chaque groupe de commandes s'appuie sur des modules `lib/` profonds (une interface petite, beaucoup de
  travail derrière). On supprime les doublons et le code mort, et on découpe les fichiers trop gros par
  responsabilité. `types.ts` se range par domaine si ça le rend plus clair. `env.ts` reste **la** seule couture
  (`http`, dossiers, `spawnClaude`).
- **UI** : `app/` (routes, coque), `components/ui/` (le kit), `components/<zone>/` (composites partagés),
  `screens/<écran>/`, `lib/data/` (la couche N3), `lib/prefs.ts` (N1). Un écran assemble des composants ; il ne
  contient pas de logique de données, et ses styles sont des styles StyleX dans son propre fichier.
- **Styles, en StyleX** (décision 10) : les valeurs (couleurs, espacements, rayons, ombres, tailles de police)
  viennent **uniquement** des jetons de `tokens.stylex.ts`, et les styles d'un composant vivent dans son `.tsx` :
  un composant supprimé emporte ses styles. **Gardes** : (a) un test qui échoue si une couleur littérale (`#…`,
  `rgb(`, `hsl(`) ou une taille en `px` apparaît ailleurs que dans `tokens.stylex.ts` (sauf `0` et `1px` pour les
  bordures) ; (b) un nom de jeton inconnu casse `tsc` ; (c) aucun fichier `.css` dans `src/ui/` à part les
  polices (`@font-face`), et aucun `dangerouslySetInnerHTML` ; (d) aucun `style={{…}}` hors d'une valeur calculée à l'exécution (une largeur glissée,
  une position).
- Les conventions de `CLAUDE.md` tiennent toujours : le style ponytail (pas d'abstraction spéculative, pas
  d'interface qui n'a qu'une implémentation, la bibliothèque standard d'abord), pas de commentaire sauf
  `// ponytail:`, TS effaçable, imports en `.ts`, tests dans `tests/`. N2 et N3 ne sont pas des abstractions
  spéculatives : chacun remplace au moins trois copies qui existent déjà.

### N5 — Un design system sur lequel on peut retravailler

- Un **catalogue de composants** : un écran `#/kit` servi par `serve --mock`, qui montre chaque composant du kit
  dans **chacun de ses états et options** (normal, survol, focus, désactivé, chargement, erreur, vide, long texte),
  en clair et en sombre, avec ses props. C'est là qu'on repart d'un composant existant pour en faire évoluer un.
- Playwright capture le catalogue dans `tests/screens/kit/`. Un changement visuel d'un composant se voit donc dans
  un seul diff de captures.
- Chaque composant du kit est accessible : rôle ARIA, clavier, focus visible, libellé. Les tests de composants
  l'interrogent par rôle et par libellé.
- Une ligne dans `SPEC.md` §13 décrit le kit et la règle « option, puis enveloppe, puis nouveau ».

### N6 — Tout est testé, et rien n'est perdu

- **Avant** de réécrire une zone, vérifie que ses comportements sont couverts (`PARITY.md`, SPEC, tests
  existants). Ce qui ne l'est pas reçoit d'abord un test de caractérisation, **vert sur l'ancien code**. Ensuite
  seulement, on réécrit.
- On ne supprime pas une assertion et on n'affaiblit pas un test pour le faire passer. Un test e2e peut changer de
  sélecteur ou de libellé parce que le design a changé, à condition de vérifier **le même comportement**. Chaque
  test modifié est listé dans le rapport avec sa raison. StyleX génère ses propres noms de classes : un test qui
  cherche un élément par sa classe CSS passe à une recherche par rôle et par libellé (ou `data-testid` quand
  l'élément n'a ni l'un ni l'autre).
- Chaque commande a un test unitaire qui passe par le registre. Chaque composant du kit a un test de composant
  (vitest + Testing Library) qui couvre **toutes** ses options. Chaque écran a ses parcours e2e. La couche N3 a ses
  tests unitaires.
- Les tests se rangent par comportement et non plus par couverture : les `cov-*` sont renommés et regroupés par zone
  (`tests/unit/core/…`, `tests/unit/ui/…`), sans qu'aucun cas ne se perde.
- Couverture mesurée au départ (`npm run test:coverage`) puis à la fin : elle ne baisse dans aucun dossier. Objectif
  ≥ 90 % des lignes pour `src/core/` et `src/ui/components/ui/`, et `src/ui/lib/data/`.

### N7 — Un seul point pour les sous-processus, l'annulation et les ressources

Le code qui lance un processus, l'arrête, attend, réessaie ou nettoie est celui où une erreur coûte le plus cher
(un `claude.exe` ou un `llama-server.exe` qui reste, un job qu'on n'arrive pas à annuler), et celui qu'il faut
pouvoir corriger à un seul endroit. Il vit donc dans **une seule couche**, `src/shared/run/`, en deux fichiers :
- **`work.ts`** : `sleep` et `timeout` qu'on peut annuler, nouvelle tentative avec délai croissant ou
  `Retry-After`, sémaphore (le « six appels Jira au plus »), et une portée (`scope`) qui exécute ses nettoyages
  dans l'ordre inverse **dans tous les cas** : fin normale, erreur, annulation, délai dépassé.
- **`process.ts`**, construit sur `work.ts` : lancer un processus (directement ou par un shim `.cmd`, avec le refus
  des métacaractères de cmd qui est aujourd'hui dans `env.ts`), le registre des processus vivants, l'arrêt de
  **tout l'arbre** (`taskkill /T /F` sous Windows, le groupe de processus ailleurs), la lecture de stdout ligne par
  ligne, le code de sortie, et l'arrêt de tous les enfants quand le parent s'en va (`--exit-with-stdin`, signaux,
  `exit`).

Tout le monde passe par là : `env.spawnClaude`, `claude/run.ts`, `claude/limits.ts`, `jobs.ts`,
`rag/runtimes/llama-server.ts`, `lib/models-hardware.ts`, `lib/jira.ts` (sémaphore et attente du 429, qu'on doit
pouvoir annuler : aujourd'hui elle ne l'est pas), `faces/http.ts`, et aussi le shell Electron (`src/desktop/core.ts`,
`main.ts`). `src/shared/` ne dépend que de Node : le desktop peut donc l'importer sans casser la règle « le
desktop n'importe jamais `src/core/` » (ajoute `src/shared/` à cette règle dans CLAUDE.md). Les scripts de
`scripts/` (outils de dev et de release) n'ont pas l'obligation d'y passer.

- **Garde** : un test qui échoue si `node:child_process`, `process.kill` ou `taskkill` apparaît dans `src/`
  ailleurs que dans `src/shared/run/process.ts`, ou si un `setTimeout` qui sert à attendre (et non à repousser un
  affichage dans l'UI) apparaît dans `src/core/` ailleurs que dans `work.ts`.
- **Tests** : de vrais sous-processus, pas des faux. Un petit script Node de fixture lance un petit-enfant ; on
  vérifie que tout l'arbre disparaît après une fin normale, une erreur, une annulation, un délai dépassé et la
  fermeture de stdin du parent. Les mêmes tests tournent sous macOS et sous Windows (le chemin `taskkill` ne se
  prouve que sur le PC Windows : le rapport dit où chaque chemin a été vérifié). `work.ts` a ses tests avec une
  horloge factice : chaque fonction, annulée à chaque étape.
- Chaque nettoyage de ressource du code (fichier `.part`, serveur, verrou, abonnement SSE côté serveur) s'inscrit
  dans une portée de `work.ts`. Il n'y a plus de `finally` qui nettoie à la main.

## Décisions (réponses aux questions qui vont se poser)

| # | Question | Décision |
|---|---|---|
| 1 | Bibliothèque pour la couche de données ? | **TanStack Query v5** (`@tanstack/react-query`, version exacte épinglée). Cela rouvre la règle « no state library » de SPEC §1 : écris-y la raison (le cache, l'invalidation, l'optimiste et la reprise réécrits à la main dans 178 effets) et retire la ligne. Le SSE alimente `invalidateQueries`. Décision ferme (validée le 2026-11-03), pas de couche maison. |
| 2 | Storybook pour le catalogue ? | Non : l'écran `#/kit` dans l'application (pas de dépendance de plus, mêmes jetons, même build, capturé par la Playwright qui existe déjà). |
| 3 | Bibliothèque de composants (Radix, MUI…) ou Tailwind ? | Non (SPEC §1). Le kit est à nous, construit sur le nouveau design. Une primitive headless est permise pour un seul composant si l'accessibilité l'exige (combobox, menu), avec la raison dans SPEC §1. |
| 4 | Garde « pas d'élément nu » : Biome ou test ? | Une règle Biome si elle existe pour ce cas dans la version installée ; sinon un test unitaire qui lit `src/ui/`. |
| 5 | Préférences de vue : commande ou local ? | Local (`localStorage` par profil, décision 6 de SPEC-ELECTRON), mais par `lib/prefs.ts` seulement. Thème et disposition restent locaux ; modèle, effort et contextes par défaut sont des commandes (ils le sont déjà). |
| 6 | Le design retire une capacité ? | La capacité reste (voir « Entrée design »). |
| 7 | Renommer une commande ? | Permis si le nom actuel ment. CLI, MCP, skills produit (`templates/project/.claude/skills/`), SPEC §12 et tests sont mis à jour dans le même changement. Pas d'alias de compatibilité : le logiciel est jeune. |
| 8 | Format des fichiers projet (`test.md`, `doc.json`, `project.json`, `xray.json`, `context.md`…) ? | **Libre de changer** : aucun vrai projet n'existe encore (validé le 2026-11-03). Pas de migration ni de lecture de l'ancien format. Un format change seulement s'il devient plus simple, plus cohérent avec les autres, ou plus facile à lire et à éditer pour Claude. Le principe « les fichiers sont la vérité » de CLAUDE.md tient toujours : les fichiers restent lisibles par un humain et éditables à la main, les sources restent `docId#anchor "quote"`, et les ancres restent stables. Un format changé met à jour, dans le même changement, SPEC §3 et §6, `templates/project/` (dont les skills produit), `tests/fixtures/project/`, le mock et les tests. |
| 9 | La librairie Effect (erreurs typées, injection, concurrence, ressources) ? | **Non** (validé le 2026-11-03), mais à une condition. Effect serait utile pour l'annulation, les délais, les nouvelles tentatives et le nettoyage garanti des ressources, et ce code existe chez nous, écrit à la main : `env.ts` (l'arbre de processus de `claude -p`), `jobs.ts`, `claude/run.ts`, `rag/runtimes/llama-server.ts` (démarrage, `/health`, arrêt après inactivité), `lib/jira.ts` (six appels au plus, attente `Retry-After`), et `AbortSignal` passé à la main dans 49 fichiers. Ce code a déjà au moins un défaut de ce type : l'attente d'un 429 dans `jira.ts` ignore l'annulation. En revanche, Effect ne couvre pas notre risque le plus grave (le processus parent tué : c'est `--exit-with-stdin` et `taskkill /T` qui s'en chargent, et ils restent à nous), il doublerait zod, qui est le contrat de la CLI, du MCP et de l'HTTP, et il ferait cohabiter deux paradigmes pour quelques modules. **La condition** : une couche à nous, qui sert de **point unique** pour tout ce code (voir N7). Ajoute Effect à « Considered and left out » de SPEC §1, avec cette raison et la règle pour le rouvrir : si cette couche dépasse environ 500 lignes, ou si un défaut d'annulation ou de nettoyage revient après cette passe, on reconsidère Effect pour elle. |
| 10 | Outil de styles ? | **StyleX, imposé** (décision de Simon, 2026-11-03). Pas de repli vers CSS Modules ni vers des feuilles par zone. Les jetons de `design/tokens.css` deviennent `src/ui/styles/tokens.stylex.ts` (`defineVars`, mêmes noms en camelCase) ; le thème sombre passe par `createTheme`, branché sur le `data-theme` actuel (`public/theme.js`, sans flash au chargement) ; les styles de chaque composant sont dans son `.tsx` (`stylex.create`), et les variantes du kit sont des objets de styles typés. Un composant du kit n'accepte de l'extérieur que les propriétés de style qu'il déclare. **L'intégration est la toute première étape de la vague 1**, avec quelques jetons provisoires (juste de quoi prouver la chaîne, remplacés à la porte design par ceux de `design/tokens.css`), et elle doit faire marcher : `npm run build` (Vite 8 / Rolldown), le HMR de `npm run dev:ui`, `npm test` (vitest passe par les plugins Vite, donc les composants sont rendus avec leurs styles), `npx playwright test`, `npm run release` et l'e2e Electron, et des noms de classes lisibles en dev. Si le plugin officiel ou communautaire ne tient pas sur Rolldown, écris un petit plugin Vite à nous qui appelle le compilateur officiel de StyleX (son plugin Babel) sur les `.tsx`, avec ses tests. C'est un problème à résoudre, pas une raison de changer d'outil. Seule une impossibilité prouvée et écrite arrête la passe (`BLOCKED`). **Aucune exception** : l'UI n'injecte jamais de HTML brut (pas de `dangerouslySetInnerHTML`, vérifié le 2026-11-03) ; le texte des documents et les réponses de Claude sont rendus en éléments React, que StyleX style comme le reste. Ça doit le rester : un rendu de markdown produit des composants, pas une chaîne HTML. SPEC §1 rouvre « no CSS framework » avec la raison. La règle « une feuille CSS par zone » de CLAUDE.md devient « les styles dans le fichier du composant (StyleX), les jetons dans `tokens.stylex.ts`, aucune feuille CSS ». |

## Règles qui ne bougent pas

- **Aucune écriture dans un projet Jira** (LFRPS12, BHPTCC ou autre). Les appels réels sont en lecture seule. Une
  écriture se prouve par un test unitaire sur un faux `http`.
- On ne modifie jamais Xray Editor ni un original de document.
- `npm` et `npx` depuis l'outil Bash. Les fichiers TypeScript s'écrivent avec Write ou Edit, jamais en heredoc.
- Rien qui demande des droits admin, un compilateur ou Python sur le PC d'un collègue (SPEC §14) ; pas de dépendance
  native sans prébuild win-x64.
- Les essais réels de Claude restent sobres : `claude -p "reply ok"` pour l'enveloppe, un parcours complet à la fin.
- Données d'essai dans `.sandbox/v3/`, journal de construction dans `.build/v3/`. Les deux dans `.gitignore`.
- **Git** : tout se fait sur une branche `grand-nettoyage` partie de `master`, avec **un commit après chaque étape
  verte** (c'est le filet de sécurité d'une réécriture : une étape ratée se reprend depuis le dernier commit). Les
  agents en parallèle travaillent dans leurs propres worktrees et l'orchestrateur fusionne. Jamais de push. La
  fusion dans `master` se fait à la fin, seulement si la barre est verte.

## Orchestration

**Les fichiers partagés, c'est toi qui les écris** : `package.json`, la config (biome, vite, tsconfig,
`playwright.config.ts`, `tests/e2e/helpers.ts`), `src/core/types.ts`, `src/core/commands/index.ts`,
`src/core/command.ts`, `src/core/env.ts`, `src/shared/run/*`, `src/ui/api.ts`, `src/ui/lib/data/*`,
`src/ui/lib/prefs.ts`, `src/ui/styles/tokens.stylex.ts`, le composant texte, le bloc Claude et le bouton du kit,
la coquille de l'écran `#/kit`, `SPEC.md`, `CLAUDE.md`, `ROADMAP.md`, `PARITY.md`. Chaque agent possède une liste
de fichiers et ne touche à rien d'autre ; ce dont il a besoin ailleurs, il le demande en `BESOIN:` dans son
journal.

## Sous-agents

### Règles communes

- **Outil** : `Agent`, type `general-purpose` pour tous (il faut écrire des fichiers ; `Explore` ne le peut pas).
  Ne passe ni `model` ni `effort` : chaque agent prend ton modèle, parce que la qualité prime ici sur le coût.
- **Arrière-plan** : tous les agents d'une même vague partent ensemble, en arrière-plan. **Six au plus en même
  temps** (chacun lance vitest, Vite et parfois Playwright : au-delà, la machine rame et les tests deviennent
  instables). Les suivants partent quand une place se libère, dans l'ordre du tableau.
- **Worktree** : chaque agent qui **écrit du code** a `isolation: "worktree"`. Sa première commande est
  `npm ci --prefer-offline`, parce que le worktree n'a pas de `node_modules`. Il commite sur sa branche ; c'est toi
  qui fusionnes dans `grand-nettoyage`, après avoir relancé ses tests. Les agents d'audit lisent ta copie et
  n'écrivent que leur rapport dans `.build/v3/audit/` : pas de worktree pour eux.
- **Port e2e** : chaque agent qui écrit reçoit son port, `TESTIMUS_E2E_PORT=43<NN>` (le numéro du tableau), et ne
  lance que **ses** specs e2e. La suite complète, c'est toi qui la lances.
- **Pas de sous-sous-agent** : un sous-agent ne lance pas d'autres agents. S'il trouve sa zone trop grosse, il
  l'écrit en `BESOIN:`, et c'est toi qui découpes.
- **Rien ne se perd** : un agent ne réécrit une zone qu'une fois ses tests de caractérisation verts (N6). Il
  supprime l'ancien code dans le même commit que celui qui le remplace.

### Le tableau

| # | Nom | Vague | Isolation | Possède | Lit d'abord | Fini quand |
|---|---|---|---|---|---|---|
| 01 | `audit-commands` | 0 | aucune (lecture seule) | `.build/v3/audit/commands.md` | `src/core/commands/`, `src/faces/`, tous les `call(` de `src/ui/`, SPEC §2 et §12 | chaque commande et chaque geste de l'UI ont une ligne (voir « Les audits ») |
| 02 | `audit-controls` | 0 | aucune | `.build/v3/audit/controls.md` | `src/ui/` en entier, `design/components.md` | chaque élément nu et chaque doublon du kit ont leur remplaçant |
| 03 | `audit-data` | 0 | aucune | `.build/v3/audit/data.md` | `src/ui/` en entier, `src/core/jobs.ts`, `/api/events` dans `faces/http.ts` | chaque chargement a sa clé et ses invalidations |
| 04 | `audit-core` | 0 | aucune | `.build/v3/audit/core.md` | `src/core/`, `src/shared/` s'il existe, SPEC §3 et §6, `templates/project/` | modules, doublons, code mort, formats proposés |
| 05 | `audit-tests` | 0 | aucune | `.build/v3/audit/tests.md` | `tests/`, `PARITY.md`, SPEC §13 et §15 | chaque ligne de PARITY et de SPEC §13 a son test ou « aucun » |
| 06 | `audit-design` | 3 (après la porte) | aucune | `.build/v3/audit/design.md` | `design/` en entier, `src/ui/`, `dist/screens/` | la liste finale du kit et l'écart écran par écran |
| 11 | `kit-saisie` | 3 | worktree | champ texte une ligne, select, case à cocher, interrupteur, choix segmenté, champ à puces : leurs fichiers dans `components/ui/`, leurs tests, leur section `screens/kit/` | `design/SYSTEM.md`, le bouton et le composant texte déjà faits (le modèle à suivre) | chaque option testée, section du catalogue capturée clair et sombre |
| 12 | `kit-calques` | 3 | worktree | menu, modale, confirmation, infobulle, toast | idem | idem, plus le clavier (Échap, Tab piégé dans la modale, retour du focus) |
| 13 | `kit-affichage` | 3 | worktree | liste et élément de liste, onglets, badge, squelette, poignée de redimensionnement, tableau | idem | idem |
| 21 | `ui-tests` | 4 | worktree | `src/ui/screens/tests/` et ses e2e (`editor`, `parity-editor`, `tests-list`, `push-stopped`) | `design/screens/tests/`, PARITY §Editor et §Step card, `controls.md`, `data.md` | zone sans écart de garde, ses e2e et captures verts ; `TestEditor.tsx` et `StepCard.tsx` découpés |
| 22 | `ui-claude` | 4 | worktree | `src/ui/components/claude/` (dock, contextes, quick asks, modèle), `components/sources/`, e2e `claude`, `claude-absent`, `actions` | `design/screens/claude/`, PARITY §Claude, `controls.md`, `data.md` | idem ; chaque saisie du dock est le bloc Claude avec ses options ; `ClaudeDock.tsx` découpé |
| 23 | `ui-review` | 4 | worktree | `src/ui/screens/review/`, e2e `review`, `review-evidence` | `design/screens/review/`, SPEC §9 | idem |
| 24 | `ui-documents` | 4 | worktree | `src/ui/screens/documents/`, e2e `documents`, `documents-bm25` | `design/screens/documents/`, SPEC §4 | idem |
| 25 | `ui-generate` | 4 | worktree | `src/ui/screens/generate/`, e2e `generate` | `design/screens/generate/`, SPEC §7 | idem |
| 26 | `ui-settings` | 4 | worktree | `src/ui/screens/settings/` (dont `models/`), e2e `models`, `search-settings`, `theme-system` | `design/screens/settings/`, SPEC §13 Settings | idem |
| 27 | `ui-setup-jobs` | 4 | worktree | `src/ui/screens/setup/`, `jobs/`, `doctor/`, `Placeholder.tsx`, e2e `setup-pack`, `jobs`, `system` | leurs maquettes | idem |
| 28 | `ui-shell` | 4 | worktree | `src/ui/app/`, `src/ui/components/shell/`, `src/ui/lib/` hors `data/` et `prefs.ts`, `src/ui/main.tsx`, e2e `shell`, `search`, `narrow` | `design/screens/shell/`, SPEC §13 | idem ; `lib/` ne garde que de la présentation (le reste est passé dans la couche de données ou dans une commande) |
| 31 | `core-jira` | 2 | worktree | `src/core/lib/jira.ts`, `sync.ts`, `adf.ts`, `commands/xray.ts`, `src/core/mock/jira.ts`, leurs tests | skill `xray-cloud-api`, SPEC §10, `commands.md`, `core.md` | N1 et N4 dans la zone, `jira.ts` découpé, tests rangés, aucune écriture Jira réelle |
| 32 | `core-docs` | 2 | worktree | `src/core/lib/docs.ts`, `src/core/rag/convert*`, `inspect.ts`, `pdf.ts`, `commands/docs.ts`, `commands/images.ts`, leurs tests | skill `docx-ingest`, SPEC §4 | idem ; ancres et citations inchangées sur les fixtures |
| 33 | `core-rag` | 2 | worktree | `src/core/rag/` hors `convert*`, `inspect.ts`, `pdf.ts`, et `llama-server.ts` ; `src/core/search/`, `commands/rag*.ts`, `commands/search.ts`, leurs tests | skill `rag-eval`, SPEC §5 | idem ; `rag.eval` donne les mêmes chiffres qu'au départ sur le jeu de fixtures |
| 34 | `core-claude` | 2 | worktree | `src/core/claude/` hors `run.ts`, `commands/{claude,chat,gen,check,actions,review}.ts`, `src/core/mock/claude*.ts`, `templates/project/.claude/skills/`, leurs tests | SPEC §7, §8, §11 | idem ; les skills produit citent les bons noms de commandes |
| 35 | `core-models` | 2 | worktree | `src/core/lib/models-*.ts`, `commands/models.ts`, `rag/runtimes/llama-server.ts` (déjà branché sur N7), `src/core/mock/models.ts`, `machine.ts`, `models/catalog.json`, leurs tests | SPEC §5 (modèles), SPEC-RAG §7 | idem |
| 36 | `core-project` | 2 | worktree | `commands/{project,system,jobs,columns,contexts,tests}.ts`, `lib/` restant (testfile, table, store, check, creds, project, doctor, hash, zip), `src/core/mock/` restant, `src/faces/`, `src/desktop/`, leurs tests | SPEC §3, §6, §12, SPEC-ELECTRON | idem ; `src/desktop/` passe par `src/shared/run/` |
| 41 | `revue-contradictoire` | 5 | aucune (lecture seule) | `.build/v3/audit/revue.md` | le code, `SPEC.md`, `PARITY.md`, N1–N7, `design/`. **Pas** `state.md` ni tes conclusions | chaque constat a un fichier, une ligne, un scénario qui échoue, et sa gravité |

Les zones s'ajustent après l'audit (vague 0, étape 3) si un fichier n'a pas de propriétaire ou en a deux. La
carte finale est dans `state.md`, et **chaque fichier de `src/` et de `tests/` y a exactement un propriétaire**.

### Les audits (contenu attendu)

- **commands.md** : chaque commande (nom, schéma, `describe` manquants, responsabilité, doublons, nom trompeur,
  logique métier dans une face) ; et **à l'envers**, chaque geste de l'UI (bouton, champ, menu, raccourci,
  glisser-déposer) avec la commande qu'il appelle, ou « aucune », ou « plusieurs appels pour un geste ».
- **controls.md** : chaque `<button>`, `<input>`, `<textarea>`, `<select>` et chaque composant maison qui double le
  kit ; pour chacun, le composant du kit et l'option qui le remplacent.
- **data.md** : chaque chargement de données dans l'UI (`useEffect` + `call`, abonnements, événements `window`,
  minuteurs, globales), regroupé par clé de données, avec ce qui doit l'invalider.
- **core.md** : modules trop gros, doublons, code mort (exports jamais importés), dépendances circulaires, usages
  de `env` contournés, chaque endroit qui lance un processus, attend ou nettoie (N7) ; et chaque format de fichier
  du projet (SPEC §3), avec ses incohérences (noms de champs, deux façons de dire la même chose, données qui se
  recoupent) et le format proposé.
- **tests.md** : chaque ligne de `PARITY.md` et chaque comportement de SPEC §13, avec le test qui le prouve ou
  « aucun » ; chaque `cov-*` et sa zone ; chaque test qui cherche un élément par sa classe CSS.
- **design.md** : l'écart entre `design/` et le code actuel, écran par écran et composant par composant ; la liste
  finale des composants du kit et de leurs options.

## Les vagues

Les vagues 0 à 2 ne dépendent pas du design : elles tournent pendant que la session design travaille. La **porte
design** (`design/READY.md`, voir « Lancement ») sépare la vague 2 de la vague 3. Commit après chaque point vert.

**Vague 0 — l'état de départ et l'audit. Sans design.**
1. Toi : si `dist/screens/manifest.json` manque, `npm run screens` d'abord (voir « Préalable »). Puis
   `npm run build`, `npm run check`, `npm test`, `npm run test:coverage`, `npx playwright test`. Note dans
   `state.md` les nombres de tests, les durées et la couverture par dossier : c'est la ligne de base. Crée la
   branche `grand-nettoyage`.
2. Les agents 01 à 05, en parallèle (06 attend la porte).
3. Toi : à partir des audits, la carte des zones et l'ordre des vagues dans `state.md`.

**Vague 1 — toi, en séquence. Les fondations qui ne dépendent pas du design.**
1. L'intégration StyleX (décision 10) : la dépendance épinglée, le plugin de build, un `tokens.stylex.ts` avec
   quelques jetons **provisoires**, `createTheme` pour le sombre, un bouton d'essai, et toute la liste de contrôle
   de la décision 10 verte. Le port de Playwright devient réglable (`TESTIMUS_E2E_PORT`, 4327 par défaut).
2. Les tests de caractérisation manquants que signale `tests.md`, verts sur l'ancien code.
3. Les formats de fichiers du projet (décision 8) d'après `core.md` : c'est un contrat partagé, donc fixé ici,
   avant les agents. Écris-les dans SPEC §3 et §6, puis adapte le code qui lit et écrit ces fichiers,
   `templates/project/`, `tests/fixtures/project/` et le mock. Les tests de caractérisation qui lisent un fichier
   suivent le nouveau format et gardent le même comportement.
4. La couche `src/shared/run/` (N7) avec ses tests de vrais sous-processus, puis `env.ts`, `jobs.ts`,
   `claude/run.ts`, `llama-server.ts` et l'attente du 429 de `jira.ts` branchés dessus.
5. La couche de données (N3) et `lib/prefs.ts`, avec leurs tests. L'ancienne UI ne l'utilise pas encore : ce
   sont les agents de la vague 4 qui l'y branchent.
6. Les gardes N1, N2, N4 et N7, **en mode liste** : elles comptent les écarts restants sans encore échouer, et le
   compte est noté dans `state.md`. Il doit atteindre zéro en vague 5, et elles deviennent alors bloquantes.

**Vague 2 — les agents du cœur, 31 à 36. Sans design.** Les plus gros d'abord : 36, 31, 34, puis 32, 33, 35.
- Un agent cœur applique N1, N4 et N7 d'après `commands.md` et `core.md`, et range les tests de sa zone (N6).
- **L'interface est encore l'ancienne** pendant cette vague. Un agent du cœur qui renomme une commande ou change sa
  sortie met donc à jour, en même temps, les appels `call("…")` de l'ancienne UI qui s'en servent, et seulement ces
  lignes (c'est la seule exception à « ne touche que tes fichiers »). Les e2e de départ doivent rester verts.
- Il note chaque changement de commande dans son journal ; tu les reportes dans `.build/v3/audit/commands.md`,
  pour que les agents de la vague 4 partent du registre à jour.
- Fusion : après chaque agent `DONE`, tu fusionnes sa branche, puis tu relances `npm test` et les e2e touchés sur
  `grand-nettoyage`. Un conflit se règle de ton côté, jamais en réécrivant la zone d'un autre.
- Pendant que ces agents travaillent, tu attends la porte design (`Monitor`), et tu traites leurs `BESOIN:`.

**— Porte design : `design/READY.md` existe. —**

**Vague 3 — le design dans le code.**
1. L'agent 06 (`audit-design`), puis toi, à partir de son rapport :
2. Tous les jetons de `design/tokens.css` dans `tokens.stylex.ts`, en remplaçant les jetons provisoires.
3. Le bouton, le composant texte, puis le bloc Claude construit dessus, avec leurs tests et leur section du
   catalogue. Ce sont **les modèles** que suivent les agents 11 à 13 : ce qu'ils montrent (structure du fichier,
   styles StyleX, options, tests, section du catalogue) devient la règle.
4. La coquille de l'écran `#/kit` (N5), où chaque agent du kit ajoute sa section.
5. Les agents 11 à 13, en parallèle : le reste du kit. Tu fusionnes et tu relances le catalogue.

**Vague 4 — les agents de l'interface, 21 à 28.** Les plus gros d'abord : 21, 22, 28, puis les autres. Six agents
au plus en même temps, ceux du cœur encore en cours compris.
- Un agent UI applique les maquettes de son écran, remplace chaque contrôle nu par le kit, branche ses données sur
  la couche N3, passe ses styles en StyleX, découpe ses gros fichiers, et garde ses e2e verts. Les feuilles de
  `src/ui/styles/` disparaissent au fur et à mesure que les écrans passent en StyleX.
- Un agent qui a besoin d'une option nouvelle dans le kit, d'une commande nouvelle ou d'un champ dans `types.ts`
  l'écrit en `BESOIN:`. Tu l'ajoutes, tu commits sur `grand-nettoyage`, et tu lui dis de fusionner cette branche
  dans son worktree (`SendMessage` à l'agent).
- Fusion comme en vague 2.

**Vague 5 — toi, puis l'agent 41.**
1. Intégration finale, puis la barre complète. La dernière feuille de `src/ui/styles/` a disparu.
2. Les gardes passent en mode bloquant : zéro écart.
3. Couverture finale comparée à la ligne de base, dossier par dossier.
4. Revue à l'œil de chaque écran et du catalogue, en clair et en sombre, dans le navigateur et dans la fenêtre
   Electron, console sans erreur. Chaque état (vide, chargement, erreur, serveur perdu, Claude absent, long texte).
   `npm run screens -- --out dist/screens-after` (le catalogue `scripts/screens-catalog.ts` d'abord mis à jour pour
   les nouveaux libellés et l'écran `#/kit`), puis la comparaison avec `dist/screens/`, par clé `scenario/shot` des deux `manifest.json` : une capture « avant » sans
   capture « après » est un écran ou un état perdu, et une capture « après » s'écarte de sa maquette de
   `design/screens/` seulement avec une raison écrite dans le rapport.
5. Les vérifications réelles en lecture seule : un `xray.pull` d'un test LFRPS12 marche toujours ; un parcours
   complet sur `.sandbox/v3/project/` (importer un document, indexer, générer, check, relecture To fix → Ask
   Claude to fix it → Validate, plan de push affiché **mais non exécuté**).
6. L'agent 41 (`revue-contradictoire`). Il cherche une capacité perdue, un contrôle qui contourne le kit, un geste
   qui n'est pas une commande, un chargement en dehors de la couche de données, un processus, une attente ou un
   nettoyage en dehors de `src/shared/run/`, un processus qui reste après une annulation, un style hors StyleX.
7. Corrections : chaque constat est corrigé, ou réfuté avec sa preuve. Puis la barre complète une nouvelle fois et
   une nouvelle revue à l'œil.
8. `SPEC.md`, `CLAUDE.md` (Layout, Architecture rules, Conventions), `ROADMAP.md` (une section « v3 — nettoyage »)
   et `PARITY.md` (colonne Testimus à jour) décrivent ce qui existe vraiment.
9. L'agent 91 (`repasse-design`), lancé **frais** (subagent neuf, sans fork de la conversation) après les écarts aux
   maquettes : la repasse du point 10 de « C'est fini quand ». Il lit `design/` (SYSTEM.md, components.md, icons,
   build/screens) et `src/ui/`, et rend `.build/v3/audit/design-system.md` : un tableau « zone · élément · ce que
   fait l'app (fichier:ligne) · ce que veut le design system (source) · correction ». Les corrections sont faites
   (par lots sans fichiers communs), puis la barre complète une dernière fois.

## Brief de chaque sous-agent

Chaque brief contient :
- l'objectif de sa zone et les principes N1–N7 recopiés ;
- les fichiers qu'il possède ;
- les extraits d'audit qui le concernent (`.build/v3/audit/*.md`) et les maquettes de son écran ;
- les sections de SPEC et les lignes de `PARITY.md` à garder ;
- les décisions du tableau qui le concernent ;
- ce que « fini » veut dire : ses tests verts, ses écarts de garde à zéro dans sa zone, ses captures ;
- « ne pose aucune question : tranche, note, continue » ;
- les « Règles communes » de « Sous-agents » (worktree, `npm ci`, son port e2e, pas de sous-sous-agent) ;
- le bloc de reprise ci-dessous, recopié tel quel.

> **Reprise après interruption — obligatoire.** La session peut être arrêtée et relancée à n'importe quel moment, y compris au milieu de ton travail. Tu ne te souviens de rien d'une exécution précédente : la vérité, c'est ton journal, le code et `git log` de ton worktree.
> 1. Au démarrage, lis `.build/v3/agents/<ton-nom>.md` s'il existe, puis `git log` et `git status`, puis tes fichiers, puis lance tes tests. Déduis-en où tu en es. Ne refais jamais une étape dont le résultat est commité et passe ses tests.
> 2. Avance par petites étapes vérifiables. Après chacune : tests verts, commit, puis une ligne dans ton journal (l'étape, les fichiers, l'état des tests, la prochaine étape).
> 3. Écris des fichiers entiers et cohérents. Un fichier de ton périmètre à moitié réécrit (qui ne compile pas, ou qui casse un test) se répare en premier, ou se remet au dernier commit.
> 4. Ne modifie jamais un fichier hors de ton périmètre, même pour « réparer ». Note-le en `BESOIN:` dans ton journal.
> 5. Ne supprime pas une assertion et n'affaiblis pas un test. Un test changé est listé dans ton journal avec sa raison.
> 6. Termine ton journal par `DONE` et un résumé (ce qui marche, ce qui est vérifié, les tests modifiés, les écarts au design, les choix faits sans demander), ou par `BLOCKED: <raison précise>`.

## Ta propre reprise

- `.build/v3/state.md` est tenu à jour à chaque changement : la vague en cours, chaque agent (nom, zone, worktree,
  statut), les décisions prises sans demander, les besoins en attente, le compte des écarts de chaque garde, la
  ligne de base et la couverture.
- Au démarrage, lis `state.md`, les journaux des agents et `git log` avant de lancer quoi que ce soit.
- Un agent qui n'est pas `DONE` est relancé avec le même brief, plus « reprends ».
- Un agent `DONE` est contrôlé en relançant ses tests et ses gardes, jamais en le croyant sur parole.
- Les `BESOIN:` sont traités avant la vague suivante.

## Fin — le rapport

Un fichier `.build/v3/REPORT.md`, en français, et son résumé dans ta réponse :
- ce qui a été réécrit, zone par zone, et ce qui ne l'a pas été, avec la raison ;
- les gardes N1–N4 et N7 : ce que chacune vérifie et leur compte au départ puis à la fin (zéro attendu) ;
- le kit : la liste des composants, leurs options, et ce que chacun a remplacé (le nombre d'éléments nus et de
  copies supprimés) ;
- la couche `src/shared/run/` : ce qu'elle gère, ce qui passe par elle, sa taille (la règle de la décision 9), et où
  chaque chemin d'arrêt (macOS, Windows) a été vérifié ;
- la couche de données : ce qu'elle gère et ce qu'elle a remplacé (le nombre d'effets, d'événements et de
  minuteurs supprimés) ;
- les commandes ajoutées, renommées ou fusionnées, et les gestes de l'UI qui n'en avaient pas ;
- la barre de vérification de départ et de fin (commandes, nombres de tests, durée, couverture par dossier) ;
- chaque test modifié, avec sa raison ; chaque capacité de `PARITY.md`, avec le test qui la prouve ;
- les écarts entre le design et ce qui est construit, et pourquoi ;
- toutes les décisions prises sans demander ;
- comment fusionner la branche `grand-nettoyage` dans `master`, et ce qui reste ouvert.
