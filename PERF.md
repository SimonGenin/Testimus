# Passe de performances — 5 novembre 2026

Rapport de la passe d'analyse, de revue et d'amélioration des performances de Testimus, avec les mesures avant et
après. SPEC.md reste le contrat (trois paragraphes ajoutés : « Reads scale with the project », le rythme des
événements `changed`, « Long lists stay light ») ; ce fichier garde les constats, les mesures et les raisons.

## Résumé

L'impression que l'app « patauge » avait trois causes, toutes confirmées par la mesure :

1. **La page redessinait tout, tout le temps.** Il n'y avait aucune frontière de mémoïsation dans l'app (pas de
   `memo`, pas de rendu partiel des listes). Trois déclencheurs redessinaient la fenêtre entière, y compris les
   centaines de lignes de la liste des tests :
   - chaque événement d'un job (une ligne de progression, un morceau de texte de Claude) : le shell lisait la liste
     des jobs en cours, qui change à chaque événement ;
   - chaque frappe dans un pas : l'éditeur republiait sa « position » (test, pas) dans le contexte global sous forme
     d'objet neuf, même quand elle ne bougeait pas ;
   - chaque mouvement de la souris en redimensionnant le dock Claude.
2. **Les listes longues dessinaient toutes leurs lignes.** 600 tests = 605 lignes, 11 450 nœuds DOM, chaque ligne
   avec son infobulle, ses badges, ses icônes ; un document de 1 500 sections = 10 775 nœuds pour son sommaire.
3. **Le serveur relisait tout à chaque requête, de façon synchrone.** `project.info` et `jobs.list` relisaient et
   re-parsaient tous les journaux de jobs (85 Mo dans le projet de test) ; `tests.list`, `review.queue`, `gen.preview`
   relisaient et re-parsaient tous les `test.md`. Comme Node n'a qu'un fil, pendant ces centaines de ms le serveur ne
   répondait à rien d'autre (ni au flux d'événements, ni à l'ouverture d'un test). Et chaque écriture d'un test
   (autosave, Claude) relançait ~5 de ces lectures.

Résultat après corrections, sur le même projet gonflé, médiane de 3 passes alternées :

| Ce que fait l'utilisateur | Travail navigateur avant → après | Pire blocage avant → après |
|---|---|---|
| Ouvrir l'écran Tests (600 tests) | 1 069 → 500 ms | 181 → 82 ms |
| Ouvrir trois tests l'un après l'autre | 1 432 → 619 ms | 211 → 71 ms |
| Taper dans le filtre local | 1 380 → 884 ms | 60 → 0 ms |
| Redimensionner le dock Claude | 1 511 → 679 ms | 51 → 0 ms |
| Ouvrir le document de 1 500 sections | 503 → 150 ms | 149 → 0 ms |
| Ouvrir l'écran Jobs (120 jobs passés) | 210 → 204 ms | 84 → 0 ms |
| Taper 10 caractères dans un pas (profil) | ~2 170 → ~800 ms ; `TestList` 200 → 3 ms | — |

| Nœuds DOM | Avant | Après |
|---|---|---|
| Écran Tests, 600 tests | 11 463 | 906 |
| Document, sommaire de 1 500 sections | 10 775 | 717 |

| Requête (serveur) | Avant | Après |
|---|---|---|
| `project.info` | 442 ms | 33 ms |
| `jobs.list` (en cours) | 460 ms | 6 ms |
| `jobs.list` (tous) | 304 ms | 5 ms |
| `tests.list` | 150 ms | 33 ms |
| `review.queue` | 217 ms | 33 ms |
| `gen.preview` | 207 ms | 44 ms |

« Pire blocage » = la plus longue tâche ininterrompue du fil principal (au-delà de ~100 ms, l'utilisateur la sent).
Les gains seront plus grands sur un PC Windows de collègue (antivirus sur chaque lecture de fichier, disques plus lents).

## Méthode

- **Projet gonflé** : le projet mock (`serve --mock`) + 600 tests de 10 pas avec sources (30 dossiers, un tiers
  locaux, 1/7 générés, états de revue mêlés), 120 journaux de jobs de 2 000 événements chacun (85 Mo, comme après
  des mois de générations), un document de 1 500 sections avec tableaux (1,7 Mo).
- **Comparaison propre** : deux copies isolées (`git worktree`) — `HEAD` seul, et `HEAD` + ces changements seulement
  (une autre session modifiait l'éditeur en même temps dans le dossier principal ; son travail est resté hors des
  mesures). Mêmes données dans les deux, passes alternées, médiane.
- **Mesures** : Chromium (Playwright) piloté par script : temps CPU du fil principal (CDP `Performance.getMetrics`),
  tâches longues (`PerformanceObserver longtask`), nœuds DOM, et profils CPU (CDP `Profiler`) sur un build non minifié
  pour trouver les fonctions et composants chauds. Côté serveur : temps de réponse HTTP (meilleur de 3), et
  chronométrage direct en Node des fonctions (`listLocalTests`, `listJobs`, `projectOverview`).

## Ce qui a changé

### Serveur

- **Cache par version de fichier** (`src/core/lib/file-memo.ts`). Une « version » d'un fichier = taille + mtime (ns)
  + inode ; un fichier absent est une version aussi. Ce qui est calculé à partir de quelques fichiers est recalculé
  seulement quand l'un d'eux bouge ; chaque lecture ne fait plus que des `stat`. Les fichiers restent la vérité
  (SPEC §3) : rien n'est servi qui ne corresponde à ce qui est sur le disque, et un autre processus (CLI, MCP, Claude
  Code dans un terminal) qui écrit est vu au `stat` suivant.
  - La ligne d'un test (`localTestRef` : `test.md`, `.remote.md`, `check.json`, `.state.json`) — sert `tests.list`,
    la file de revue, les comptes de `project.info`, la génération, le check. L'état « en cours de génération » reste
    calculé à chaque fois (il est en mémoire, pas dans un fichier).
  - Le résumé d'un job (`jobs.list`) : ne lit plus que les lignes `status`, `steps` et `process` de son journal, jamais
    les milliers de lignes de texte de Claude, et une seule fois par version du journal (le journal d'un job fini ne
    bouge plus jamais).
  - La note de revue et la génération d'un test pour la file de revue (avant : relecture et re-parse complets de
    chaque test généré à chaque affichage de la file).
- **`project.info` compte les tests à partir de leurs lignes en cache** au lieu de re-parser chaque `test.md`.
- **Tri naturel avec un seul collateur** (`src/core/lib/natural.ts`). `a.localeCompare(b, "en", { numeric: true })`
  construit un collateur ICU à chaque comparaison : **39 ms pour trier 600 identifiants, contre 1,6 ms** avec un
  collateur réutilisé. Le motif était dans la liste des tests, la file de revue, la recherche, le check, les liens
  entre sections du RAG, Jira et les mises à jour.
- **`stat` sans exception** (`throwIfNoEntry: false`) : un fichier absent (la plupart des `check.json`, `.state.json`)
  ne coûte plus la création d'une erreur avec sa pile.
- **Journal des jobs** : le dossier `.testimus/jobs` n'est plus recréé (`mkdirSync`) à chaque ligne d'un long run, et
  l'est à nouveau s'il a disparu.
- **Watcher** : une rafale d'écritures donne toujours un seul événement `changed` 200 ms après la dernière, mais
  **au plus une seconde d'écart** tant que les écritures continuent (`debounce` reçoit un `maxMs`). Avant, un pull de
  300 tests ou une longue génération n'apparaissait dans la page qu'à la toute fin — et le lot de chemins grossissait
  sans limite pendant ce temps.

### Page

- **Les jobs en cours, version « calme »** (`useRunningJobs({ quiet: true })`, utilisé par le shell) : la liste sans
  ce qui bouge (message, progression, étapes, processus). Grâce au partage structurel de TanStack Query, elle reste la
  même liste tant qu'un job ne fait qu'avancer : le shell ne se redessine plus à chaque événement. L'indicateur
  d'activité et la bannière de l'éditeur, qui affichent la progression, gardent la version complète.
- **La position de l'éditeur ne change le contexte global que si elle bouge** (`setFocus` compare test, clé, résumé
  et pas) : une frappe ne redessine plus toute l'app.
- **Frontières `memo`** sur l'écran courant (`Screens`), le dock Claude et le rail : le shell qui se redessine (dock
  redimensionné, palette ouverte, job démarré) ne redessine plus l'écran, seulement ce qu'il lit.
- **Rendu par fenêtre des listes longues** (`src/ui/components/ui/rowWindow.ts`, branché dans le kit `List`, donc
  partout : tests locaux, tests Jira, file de revue, sommaire d'un document, jobs). À partir de 150 lignes, seules les
  lignes à moins de 1 500 px de la partie visible du cadre qui défile sont dessinées, plus la ligne choisie, celle qui a
  le focus et l'arrêt de tabulation. Les autres sont un espace vide de la hauteur qu'elles avaient (hauteur mesurée,
  sinon la moyenne des lignes), donc la barre de défilement ne saute pas ; les hauteurs variables (méta sur deux lignes)
  sont respectées. Le clavier atteint toutes les lignes : flèches, Début, Fin (la ligne visée est dessinée puis prend le
  focus). Le calcul ne se refait que tous les 400 px de défilement, dans une frame d'animation. Une liste de moins de 150
  lignes est dessinée exactement comme avant ; une page sans mise en page (jsdom, les tests unitaires) dessine tout.

## Vérifications

- Tests unitaires ajoutés : `tests/unit/core/lib/file-memo.test.ts` (le cache suit chaque fichier, s'invalide quand un
  fichier bouge, apparaît ou disparaît, rend des copies ; comptes du projet ; résumé de job qui ignore le texte de
  Claude même quand il contient `"type":"status"`, et suit un journal qui grandit), `tests/unit/shared/run-work.test.ts`
  (debounce et son `maxMs`), `tests/unit/ui/shell/running-quiet.test.tsx` (20 progressions + du texte de Claude : la
  liste calme reste la même, zéro rendu ; un nouveau job la change), `tests/unit/ui/kit/list-window.test.tsx` (liste
  courte entière ; longue : lignes visibles seulement et espace exact ; défilement ; ligne choisie dessinée où qu'elle
  soit ; Fin donne le focus à la dernière ligne).
- `npm test` : 3 914 tests passent. 4 échecs dans une passe complète (éditeur, dialogue des contextes, CLI) : ils
  passent seuls dans le dossier principal et dans la copie isolée `HEAD` + ces changements — effet de la charge de la
  machine pendant les mesures, pas de régression.
- `tsc` sans erreur, Biome propre sur les fichiers touchés, gardes d'architecture vertes.
- e2e (Edge) sur les écrans touchés — tests-list, review, jobs, documents, shell, kit, jira-side : 32/32.
- Contrôle visuel : après un défilement à 30 %, 60 % et 97 % de la liste de 600 tests, la zone visible est pleine de
  lignes (12 lignes, 718 à 740 px de lignes pour 676 px visibles), ~62 lignes dessinées au lieu de 605.

## Ce qui reste (non fait, par ordre d'intérêt)

1. **Un test écrit relance beaucoup de lectures.** Un `test.md` qui change invalide `tests.show`, `check.show`,
   `tests.list`, `review.queue`, `search.all`, `project.info`, `gen.preview`… Elles sont maintenant rapides côté
   serveur, mais pendant une génération chacune repart à chaque seconde. On pourrait restreindre aux lectures
   réellement affichées ou regrouper les invalidations.
2. **Le détail d'un job en cours** recalcule tout son journal (étapes, activité Claude, journal complet) à chaque
   événement, et le cache recopie la liste d'événements à chaque fois : coût linéaire par événement, sensible sur un run
   de plusieurs milliers d'événements. Regrouper les événements par frame d'animation réglerait ça et le dock aussi.
3. **Le `stat` de tout le projet avant et après chaque job** (`stampProject`, pour dire quels fichiers un job a
   changés) parcourt tous les fichiers, figures comprises. Le watcher sait déjà ce qui a bougé.
4. **Un seul bundle de 1,4 Mo** (le catalogue du kit compris) : découper par écran (`import()` paresseux) accélérerait
   le démarrage, surtout dans Electron sur un PC lent.
5. **Les lectures du serveur restent synchrones** (`readFileSync`) : avec les caches, les blocages sont devenus courts,
   mais une première lecture d'un gros projet (journaux de jobs) bloque encore ~0,4 s au démarrage. Un préchauffage en
   arrière-plan ou des lectures asynchrones pour les journaux supprimerait ce pic.
6. **Le sommaire et la vue d'un très gros document** : le texte est déjà lu section par section, mais `docs.show`
   renvoie tout `doc.md` (1,7 Mo) au premier affichage.

L'idée d'utiliser davantage le système de jobs est bonne pour les points 3 et 5 (préchauffer les caches et indexer les
journaux en tâche de fond). Elle n'était pas nécessaire pour les gains ci-dessus, qui venaient de calculs refaits pour
rien, pas de travail long mal placé.
