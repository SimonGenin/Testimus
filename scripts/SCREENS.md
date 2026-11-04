# Captures d'écran de toute l'application — `npm run screens`

Cet outil photographie chaque écran, chaque dialogue et chaque état de Testimus : vide et avec données, en
plusieurs tailles d'écran, en clair et en sombre. Il sert d'inventaire visuel. La session design s'en sert pour
redessiner le système (GOAL-DESIGN.md). Le nettoyage s'en sert pour vérifier qu'aucun écran ni aucun état ne se
perd (GOAL-V3.md, vagues 0 et 3).

Jira et Claude sont **toujours factices** : chaque scénario démarre son propre `serve --mock`. Rien n'est écrit dans
un vrai Jira, aucun vrai Claude ne tourne. Un vrai projet de ce PC (« Essai ») est **copié** dans un dossier
temporaire, jamais modifié.

## Lancer

```
npm run screens                                   # tout : vite build, puis 16 scénarios → dist/screens/
npm run screens -- --out dist/screens-after       # même chose, ailleurs (après le nettoyage, pour comparer)
npm run screens -- --only fixture/tests,empty     # seulement ces scénarios ou ces captures
npm run screens -- --sizes md --themes light      # un essai rapide : une taille, un thème
npm run screens -- --list                         # le catalogue, sans rien lancer
```

| Option                | Rôle                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `--out <dir>`         | Dossier de sortie (défaut `dist/screens/`). **Vidé au départ.**                                        |
| `--sizes lg,md,sm`    | Tailles (défaut les trois). `xs` (740 × 800) est en plus, sur demande.                                 |
| `--themes light,dark` | Thèmes (défaut les deux).                                                                              |
| `--only a,b`          | Garde les scénarios ou les captures dont l'identifiant (`scénario/capture`) contient un de ces textes. |
| `--essai <dir>`       | Le vrai projet copié dans le scénario `essai` (défaut `~/Testimus/Projects/Essai`).                    |
| `--jobs <n>`          | Scénarios en parallèle (défaut 3). Chacun a son serveur et son bac à sable.                            |
| `--no-build`          | Ne relance pas `vite build` (`dist/ui` doit être à jour).                                              |
| `--headed`            | Montre le navigateur.                                                                                  |

Il faut Microsoft Edge (canal `msedge` de Playwright, le même que l'e2e). Le scénario `desktop` lance aussi
`npm run desktop:build` pour avoir les pages du shell Electron.

Une capture qui échoue est reprise une fois (le journal le dit par une ligne `↻`) : une machine chargée ou une page
prise pendant un rechargement ne coûte pas une capture. Le code de sortie vaut 1 si une capture échoue encore à la
seconde prise. Les autres sont quand même faites. Une capture ratée laisse une image de l'état où elle s'est arrêtée
dans `<out>/_failed/`.

## Tailles

| Clé  | Taille      | Ce qu'elle montre                                                                                       |
| ---- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `lg` | 1920 × 1080 | Tout côte à côte.                                                                                       |
| `md` | 1366 × 768  | La liste des documents passe en tiroir (sous 1464 px).                                                  |
| `sm` | 1024 × 768  | La file de Review se replie en bandeau ; le panneau de côté d'un document passe en tiroir.              |
| `xs` | 740 × 800   | Sur demande. La liste des tests passe en tiroir (sous 900 px), les écrans en une colonne (sous 760 px). |

Un panneau qui défile (une longue page de réglages, un long test) est capturé écran par écran : `-p1`, `-p2`…,
six morceaux au plus. La page elle-même ne défile jamais, ce sont ses panneaux qui défilent.

## Scénarios

| Scénario                                               | Données                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `none`                                                 | Aucun projet : premier lancement, palette réduite aux commandes, réglages sans projet.                                                                             |
| `empty`                                                | Un projet sans document, sans test, sans clé Jira : tous les états vides.                                                                                          |
| `fixture`                                              | Le projet exemple LFRPS12 avec le faux Jira : tous les états avec données, dialogues, menus, chargements, erreurs, puis une génération et les jobs qu'elle laisse. |
| `two-projects`                                         | Deux projets connus : menu projet, étape projet, étape pack.                                                                                                       |
| `slow`                                                 | Claude (60 s) et Jira (1,5 s) ralentis : génération en cours, dock en cours, popover des jobs, pull, push en cours.                                                |
| `push-stopped`                                         | Une pièce jointe refusée par Jira : push arrêté, avec reprise.                                                                                                     |
| `claude-absent`, `claude-logged-out`                   | Claude non installé / non connecté.                                                                                                                                |
| `words-only`                                           | Index sans vecteurs (recherche sur les mots seulement).                                                                                                            |
| `machine-small-gpu`, `machine-cpu-only`, `machine-mac` | Machines différentes pour Settings › Models et le choix du pack.                                                                                                   |
| `models-no-folder`                                     | Pas de dossier de modèles, pas de llama.cpp, conseil « downgrade ».                                                                                                |
| `advice-offload`                                       | Conseil « en partie sur le processeur ».                                                                                                                           |
| `essai`                                                | Copie du projet « Essai » de ce PC (pas un projet de production), avec le faux Jira (clé LFRPS12).                                                                 |
| `desktop`                                              | Les pages du shell Electron : démarrage, cœur arrêté.                                                                                                              |

Les variables `TESTIMUS_MOCK_*` derrière chaque scénario sont décrites dans SPEC.md (paragraphes « Mock seeds » et
« Mock »). La plus utile est `TESTIMUS_MOCK_SEED` : `fixture`, `empty`, `none` ou un dossier de projet, séparés par
des virgules ; le premier est ouvert.

## Sorties

```
dist/screens/
  index.html                     galerie : chaque scénario, chaque capture, chaque taille et thème
  manifest.json                  la table de tout ce qui a été capturé
  <scénario>/<capture>/<taille>-<thème>[-pN].png
  _failed/<scénario>--<capture>.png   seulement si une capture a échoué
```

`manifest.json` :

```json
{
  "made": "2026-11-03T…",
  "sizes": { "lg": { "width": 1920, "height": 1080, "label": "…" }, "…": {} },
  "themes": ["light", "dark"],
  "scenarios": { "fixture": "The LFRPS12 sample project…", "…": "" },
  "shots": [
    {
      "area": "tests",
      "scenario": "fixture",
      "shot": "tests-editor",
      "note": "Editor, a test with a modified step, a figure and preconditions",
      "hash": "#/tests/LFRPS12-1420",
      "files": [{ "size": "lg", "theme": "light", "part": 1, "file": "fixture/tests-editor/lg-light.png" }],
      "errors": []
    }
  ]
}
```

- **La clé d'une capture est `scenario/shot`.** Elle est stable et ne dépend d'aucun libellé. Une comparaison
  avant/après cherche la même clé dans les deux manifest : une clé de l'avant absente de l'après est un écran ou
  un état perdu.
- **`area`** est la zone de l'interface : `documents`, `generate`, `tests`, `review`, `jobs`, `settings`, `setup`,
  `doctor`, `claude` (dock, contextes), `shell` (palette, toasts, menu projet, formulaire de commande, popover des
  jobs) ou `desktop`. Les maquettes du design sont rangées pareil :
  `design/screens/<area>/<scénario>/<capture>/`. La zone se calcule depuis l'identifiant (`areaOf` dans
  `scripts/screens.ts`).
- **`errors`** : les erreurs de console et les exceptions de la page pendant la capture. Une capture avec des
  erreurs reste valable, mais c'est un défaut à regarder.
- **`expected`** : seulement pour une capture qui fait échouer l'API exprès (un 500 forcé, un id inconnu). Elle
  déclare `expectErrors: { pattern, why }` dans le catalogue ; la ligne « Failed to load resource » que le navigateur
  écrit alors va ici, avec la raison, et non dans `errors`. Toute autre erreur reste dans `errors`. Le test
  `tests/unit/scripts/screens-catalog.test.ts` limite ces déclarations aux captures d'erreur connues.

## Ajouter une capture

Le catalogue est `scripts/screens-catalog.ts`. Une capture :

```ts
{
  id: "tests-columns-dialog",               // stable, en kebab-case ; le premier mot donne la zone
  note: "Step columns dialog",              // une ligne, pour la galerie et le manifest
  hash: "#/tests/LFRPS12-1420",             // on y arrive par l'URL d'abord
  prep: async (p) => {                      // puis on clique ce que l'URL ne peut pas dire
    await tap(p.getByRole("main"), /^Columns/);
    await dialog(p, "Step columns");
  },
}
```

- Passe par le **hash** (`#/settings/models`, `#/tests/<id>`, `#/review/<id>`…) chaque fois que tu peux. C'est ce
  qui change le moins quand les libellés changent.
- `tap(page, nom)` clique le premier bouton, onglet, radio, élément de menu, lien ou option qui porte ce nom
  accessible. `dialog(page, nom?)` attend une modale. `palette(page, texte?)` ouvre Ctrl K. `dock(page)` ouvre le
  dock Claude. `ask(page, question)` pose une question au dock. `validate(server, id)` valide un test (un test non
  validé s'ouvre dans Review, pas dans Tests). `delay` et `fail` retiennent ou font échouer un appel `/api/…` pour
  montrer un chargement ou une erreur.
- Champs facultatifs :
  - `setup: true` pour les écrans de premier lancement ;
  - `ready` pour attendre autre chose que le rail ;
  - `sizes` pour limiter une capture à certaines tailles (un tiroir qui n'existe qu'en `xs`) ;
  - `scroll: false` pour ne pas découper un panneau long ;
  - `settle` (ms) pour laisser finir une animation ou un chargement ;
  - `page` pour une page qui n'est pas l'application (les pages du shell).
- **L'ordre compte dans un scénario.** Toutes les captures d'un scénario partagent le même serveur, et une
  capture qui change le projet (valider, générer) change ce que voient les suivantes. Mets-les en fin de
  scénario, comme dans `fixture`.
- Un nouvel état qui demande d'autres données ou un autre réglage `TESTIMUS_MOCK_*` est un nouveau scénario, dans
  `SCENARIOS()`.
- Avant de lancer le tout, vérifie avec `npm run screens -- --only <scénario>/<capture> --sizes md --themes light`.

**Après une refonte**, les libellés et les noms accessibles changent. Mets d'abord à jour les `prep` du catalogue,
en gardant les mêmes identifiants. Ajoute les nouveaux écrans (`#/kit`) avec de nouveaux identifiants, puis lance
`--out dist/screens-after`.
