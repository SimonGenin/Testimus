# Après la charge du 10–11 novembre — ce qu'il faut corriger, construire et améliorer

Spec du 2026-11-12, tirée de `D:\Projects\Testimus\.build\workload\OBSERVATIONS.md` (Testimus 0.0.9 surveillé
pendant un import de 129 documents le 10/11, puis une génération de 111 tests le 11/11, et les idées A à J notées en
chemin). Chaque point a été relu contre le code de `master` au commit `9a0342f3` ; les références `fichier:ligne`
sont celles de ce commit. Les choix marqués **Décidé** ont été tranchés avec l'utilisateur le 2026-11-12.

> **État au 2026-11-12 (soir) : les lots 0 à 7 sont construits**, en sept flux fusionnés sur `master`, chacun avec
> ses tests ; les décisions sont écrites dans ARCHITECTURE.md (§3, §5, §6, §8, §9, §9c, §11, §12, §16) et le
> CHANGELOG « Unreleased ». Écarts voulus ou restes, à connaître :
> - **I3** : le tri des images vidéo reste dans le core, mais `sharp` y est bridé (un quart des cœurs, sans cache) et
>   ses lectures sont asynchrones ; un processus à part est noté ouvert (§16).
> - **I4** : BGE-M3 8 bits n'a pas de forme DirectML : sur un PC à carte graphique il reste sur le processeur, dans
>   le programme séparé (passer à la carte = changer de modèle par les packs). llama-server sur processeur n'est pas
>   bridé. Mesuré sur 306 passages, pas 4 000 ; la voie DirectML n'est pas prouvée sur une vraie carte.
> - **Import** : « Add documents » (quelques fichiers choisis) copie toujours aussitôt — seul l'import d'un dossier
>   attend « Start » ; `docs.addFolder` en CLI/MCP démarre par défaut (`start: true`).
> - **Prompts et skills** changés (generate-tests, plan-tests, analyze-test, check-test, fix-test, edit-test, chat,
>   learn, picture) : **pas mesurés** sur Sonnet high / Opus high comme CODE.md le demande.
> - **Pas rejoué** : la charge réelle (« Ce qui reste à mesurer », en bas) ; un PC de collègue à 16 Go.
>
> Ce fichier peut être supprimé une fois ces restes tranchés.

Ce qui suit est la spec telle qu'écrite le matin du 2026-11-12.

## En bref

| Lot | Contenu | Pourquoi d'abord |
|---|---|---|
| 0 | Correctifs immédiats : G7, G5, un test manqué compté écrit, les tests qui écrivent dans le vrai journal | petits, et G7 a coûté 1 h 26 de génération affichée en échec |
| 1 | Rien de bloquant dans le core : copies annulables avec progression, plus de lecture synchrone de gros fichiers, index et images vidéo hors du core | 3 h 31 de gel le 10/11 ; la page 50× plus lente pendant l'index |
| 2 | Parallélisme : index au fil de l'eau, créneaux selon la machine et le type de travail | aucun document cherchable pendant 4 h 24 |
| 3 | Le go de l'utilisateur : import « en attente » + Lancer ; génération en deux temps | rien de lourd ne part sans qu'on sache ce qu'il coûte |
| 4 | Jobs : moins d'écritures, `changed` juste, témoin d'activité | +25 Mo en quelques secondes, 9 Mo pour un job |
| 5 | Génération : runs qui se connaissent, thèmes en sous-dossiers, images, description vérifiée, placeholders | qualité des tests |
| 6 | Écrans à l'échelle : état d'un document, panneaux bornés, sélection repliée, rendu des réponses de Claude | lisibilité avec 100+ documents et jobs |
| 7 | Claude et contextes : éditions proposées depuis le chat, contexte des conversations | le chat ne peut pas corriger ce qu'on lui demande |

Les lots 0 à 2 sont indépendants des écrans. Le lot 3 dépend du lot 1 (copie annulable) pour l'import ; la partie
génération du lot 3 et le lot 5 se construisent ensemble (le plan gagne thèmes, questions et liste des voisins).

## Décisions du 2026-11-12

1. **OneDrive** : rien de spécial pour les fichiers « en ligne seulement » — ils sont copiés comme les autres. Ce qui
   compte, c'est qu'**aucune copie ni conversion ne parte sans un clic**, et que cette attente ne bloque que ce qui en
   a besoin (lot 3, « L'import attend le go »).
2. **Import** : après le scan, les documents entrent dans la liste **en attente**, avec un bilan (volume à copier,
   place libre, runs Claude, durée estimée) et un bouton **Lancer** ; on peut en retirer avant ; le reste de l'app
   marche pendant ce temps.
3. **Index** : la meilleure solution selon la machine — sur GPU, le GPU ; sur CPU, un **programme séparé**, limité
   en cœurs et en priorité basse, qui se ferme seul après inactivité (lot 1, I4).
4. **Génération en deux temps** : une case **« Relire le plan avant d'écrire »** dans la demande, cochée par défaut ;
   l'échange sur le plan se fait **dans un formulaire sur Generate et dans le dock Claude** (lot 3, I).
5. **Thèmes** : un thème du plan devient un **sous-dossier** du dossier cible (`<dossier>/<thème>`), le champ
   `folder` existant ; Generate montre l'arbre de la page Tests (lot 5, J).
6. **Le chat corrige la vue d'ensemble, un contexte, une colonne** par des commandes ciblées dont chaque écriture
   est une **proposition montrée en diff, appliquée sur un clic** (lot 7, C).
7. **Contexte des conversations** : un contexte comme les autres, `contexts/conversations/context.md`, **réécrit par
   Claude après chaque conversation sans demander**, sous des règles (court, pas de passages de documents) ; injecté
   partout par défaut, décochable comme tout contexte (lot 7, E).
8. **Images** : viser une image pour chaque étape « faire » ou « voir » sur un écran, en cherchant figure → photo →
   image clé de vidéo — **sans en faire une obligation** : pas d'image trouvée, c'est permis. Plus un bouton
   **« Trouver une image »** sur une étape (lot 5, H). Pas d'avertissement du contrôle mécanique.
9. **Rendu des réponses de Claude** : ce qui gêne, c'est le Markdown brut, le mur de texte, les polices et tailles —
   les puces de source vont bien (lot 6, D).

---

## Lot 0 — Correctifs immédiats

### G7. Un doute qui fait échouer toute la génération

- **Constat** : `generate-c0062585` en échec après 1 h 26 et 110 tests écrits, erreur `"autre test du plan" is not a
  test id.` ; l'étape « check » et le bilan des comportements écartés n'ont pas tourné.
- **Cause** : `skipDoubts` (`src/core/claude/gen-reply.ts:279`) appelle `testExists` (`src/core/lib/store.ts:45`),
  qui passe par `testDir` (l. 38-41) et **lève une `UserError`** sur un id qui n'a pas la forme d'un nom de dossier.
  Appelé par `leftOut` (`src/core/claude/generate.ts:212`) après l'écriture des tests, avant le check et le ledger
  final. Dans la boucle des runs (`generate.ts:323-350`), une exception de `genRun` n'est pas attrapée non plus :
  `Promise.all` rejette et le job échoue.
- **À faire** :
  - `testExists` répond `false` pour un id mal formé (un test qui « n'existe pas » est la vérité ; `testDir` garde
    son refus pour les écritures). Le doute dit alors « It names "autre test du plan", which is not a test of this
    project ».
  - Le schéma `SKIP` (`gen-reply.ts:88`) refuse un `test` qui n'est ni `local-<8 hex>` ni une clé Jira : le bloc est
    redemandé avec l'erreur (le mécanisme `askAgainLines` existe), au lieu d'arriver jusqu'à `skipDoubts`.
  - Tout ce qui suit l'écriture (bilan des écartés, doutes, ledger, check) est fait **même si une partie échoue** :
    une erreur dans le bilan d'un run est loguée et attachée à ce run, le job continue. Dans la boucle, une exception
    d'un run devient un run `ok: false` (ce qui arrête les runs non commencés, comme aujourd'hui), jamais un rejet de
    `Promise.all`.
- **Preuve** : tests unitaires — `testExists(project, "autre test du plan") === false` ; un `gen-report` avec
  `already-tested` + `test: "autre test du plan"` est redemandé ; une génération dont un run lève finit `done` avec
  ce run en échec, l'étape check exécutée sur les autres.

### Un test manqué compté comme écrit (trouvé en relisant le ledger du 11/11)

- **Constat** : le ledger `.testimus/gen/generate-c0062585.json` du projet réel dit `plan: 111, done: 111`, alors que
  « R³ — Process Manager » est `missed`. Un `--resume` ne le réécrirait donc pas.
- **Cause** : `generate.ts:345` — `if (r.run.ok || r.tests.length) done.add(k)` : un run réussi qui n'a écrit aucun
  test compte comme fait, contrairement au commentaire juste au-dessus (« counts as written once its run wrote a
  test »).
- **À faire** : `done.add(k)` seulement si `r.tests.length > 0`. Un run réussi sans test devient un écarté `stopped`
  avec `why` « the run ended without writing its test — resume it ».
- **Preuve** : test unitaire sur un run mock `ok` sans test → index absent de `done`, `remaining = 1`.

### G5. Comptes rendus refusés pour un `null`

- **Constat** : 3 blocs `gen-report` sur ~111 refusés puis redemandés (~15 s chacun) : un pour `"test": null`, deux
  pour `documents-disagree` avec un seul passage. Le journal dit « has no readable gen-report block » alors que le
  bloc est là.
- **Cause** : `z.string().default("")` et `strings.default([])` (`gen-reply.ts:77-109`, aussi `PLAN` l. 111-122) ne
  couvrent que l'absence, pas `null`. Le log (`generate.ts:182`) ne distingue pas « absent » de « refusé ».
- **À faire** :
  - Dans `SKIP`, `REPORT` et `PLAN`, tout champ optionnel accepte `null` comme absent (un petit `nullish()` puis
    valeur par défaut, une fois pour toutes dans un helper du fichier).
  - Le log dit ce qui est refusé : « The gen-report block of generate 49/111 was refused (skipped.2.sources:
    documents-disagree: cite the two passages): Claude is asked again. » — `readBlock` renvoie déjà `found` et
    `errors` (`src/core/claude/parts.ts:93-109`).
  - `generate-tests/SKILL.md` l. 135 et l'exemple du bloc : `documents-disagree` exige **les deux passages** dans
    `sources` ; `already-tested` exige l'**id** d'un test (`local-…` ou clé Jira), jamais une description.
  - Corriger au passage l'incohérence de seuil : le skill dit « more than 3 tests » (l. 19-20), le prompt « more than
    one test » (`gen-prompt.ts:182`). Le prompt fait foi ; aligner le skill.
- **Preuve** : unitaire — le bloc du run 25/111 (rejoué par `.build/workload/why-report.ts`) est accepté ; un bloc
  refusé produit le log avec le chemin du champ.

### Les tests unitaires écrivent dans le vrai journal du bureau

- **Constat** : `%LOCALAPPDATA%\Testimus\logs\desktop-*.log` contient des centaines de lignes « bridge … refused »
  venues de vitest.
- **Cause** : `src/desktop/log.ts:8-16` lit `LOCALAPPDATA` à chaque ligne ; `tests/unit/setup.ts` ne redirige que
  l'env du core ; `bridge-calls.test.ts`, `bridge.test.ts`, `core.test.ts`, `window.test.ts` ne bouchonnent pas
  `LOCALAPPDATA` (quatre autres tests le font à la main).
- **À faire** : `tests/unit/global-setup.ts` fait pointer `LOCALAPPDATA` vers un dossier temporaire pour toute la
  suite ; retirer les `vi.stubEnv("LOCALAPPDATA")` devenus inutiles.
- **Preuve** : `npm test` puis aucune ligne nouvelle dans le journal réel du jour.

---

## Lot 1 — Rien de bloquant dans le core (axe 1)

Règle (à écrire dans ARCHITECTURE.md §3) : **aucune opération dont la durée dépend de la taille d'un fichier de
l'utilisateur ne tourne de façon synchrone dans le core** ; toute opération longue rend la main, dit sa progression
et suit le signal de son job.

### I1. Copie annulable, en octets, en une seule lecture

- **État** : fait au commit `9a0342f3` — `copyFileAtomic` est asynchrone (`src/core/lib/atomic.ts:22-32`), le hash
  lit par flux (`src/core/lib/hash.ts:16-21`), `addMediaDocs` et `copyMediaFiles` suivent le signal entre deux
  fichiers, le job rend la main avant de commencer (`docs-folder.ts:139`).
- **Reste à faire** :
  - **Annuler pendant une copie** : `fs.promises.copyFile` ne prend pas de signal ; une vidéo de 14 Go commencée va
    au bout (50 min le 10/11). Copier par flux avec signal et compteur d'octets — `copyChecked(from, to, signal,
    onBytes)` existe déjà dans `src/core/lib/models-dir.ts:251-274` : le déplacer dans `lib/atomic.ts` et s'en servir
    pour tout fichier de l'utilisateur.
  - **Une seule lecture** : aujourd'hui un média est lu deux fois (hash complet `media.ts:103`, puis copie
    `media.ts:176`) — pour un fichier OneDrive, le hash télécharge tout avant même que la place ou le plafond soient
    vérifiés (`media.ts:150-167`). Calculer le SHA-256 **pendant** la copie (un `Transform` dans le pipeline) ; tester
    la place et le plafond **avant**, sur la taille donnée par `stat`.
  - **Progression en octets** : « Copying VID….mp4 — 2,1 / 5,4 Go » avec `done`/`total` en octets pour le fichier,
    et l'avancement du lot en fichiers sur la ligne du job parent.
  - **Place libre pour tout** : `shortOfRoom` (`video/disk.ts:46-51`) ne vaut que pour les vidéos ; l'appliquer à
    toute copie (Word, PDF, images).
- **Preuve** : unitaire — une copie de 50 Mo annulée à mi-chemin laisse ni `.tmp` ni dossier de document ; la
  progression est en octets ; un fichier plus gros que la place libre est refusé sans avoir été lu. Manuel : importer
  une vidéo OneDrive en ligne seulement, cliquer Annuler pendant la copie, la page répond et le job s'arrête.

### I2. Plus de lecture synchrone de fichiers de taille non bornée

- **À convertir en asynchrone** (lectures entières de fichiers de l'utilisateur) :
  - `src/core/lib/docs-convert.ts:28` `copyOf` (hash de l'original copié), `:38-42` `convertSource`, `:179`, `:192`
    (`attachPdf` / `attachDocx`), `:241` `cropsOf` ;
  - `src/core/lib/docs-pipeline.ts:175-176` `inspectFiles` ; `src/core/commands/docs-read.ts:107` (PDF pour
    `renderPage`) ;
  - `src/core/lib/media.ts:237` `prepareImage` ;
  - `src/core/lib/contexts.ts:169` (fichier ajouté à un contexte), `src/core/commands/images.ts:101`, et les
    lectures de pièces jointes des runs (`run-results.ts:119`, `run-create.ts:122`, `run-import.ts:239`,
    `run-pages.ts:88,92`), `sync/push.ts:71`, `media-migrate.ts:120,125` ;
  - `src/core/lib/atomic.ts:41` `copyDirAtomic` (`cpSync` d'un dossier entier).
- **Parcours qui grandissent avec les données** :
  - `src/core/lib/video/disk.ts:9-18` `bytesOf` parcourt tout le dossier de chaque vidéo à chaque vidéo ajoutée
    (`overCap`, `media.ts:159`) : coût quadratique sur 33 vidéos. Tenir le total du projet dans un cache invalidé par
    le watcher, ou ne compter que les fichiers `.mp4` d'origine.
  - `docs-folder.ts:92-114` `walk` et `:160-163` `statSync` : bornés à 2 000 fichiers, acceptables ; passer en
    asynchrone pour l'homogénéité.
- **Hors champ** : les petites lectures bornées (`doc.json`, `test.md`, une image clé de vidéo) restent synchrones —
  la règle vise la taille non bornée, pas `*Sync` en soi. Le premier `tests.list` d'un gros projet reste tel quel
  (ARCHITECTURE.md §16).
- **Preuve** : un garde d'architecture (`tests/unit/guards/`) qui refuse `readFileSync`, `copyFileSync`, `cpSync`
  sur les chemins de `docs/*/original*`, `docs/*/media/**` et les fichiers déposés par l'utilisateur — ou, plus
  simple, une liste des fichiers où ces appels sont interdits.

### I3. Le tri des images vidéo hors du processus de la page

- **Constat** : `sharp` (netteté, comparaison, vignettes, mosaïques) tourne dans le core
  (`src/core/lib/video/frames.ts`, lectures `readFileSync` l. 111, 172, 185, 218, 254) : ~1,2 cœur et jusqu'à 66
  threads pendant les vidéos ; `mosaic` lance 9 pipelines à la fois (l. 216-220). `sharp.concurrency`, `sharp.cache`
  et `UV_THREADPOOL_SIZE` ne sont jamais réglés.
- **À faire** : le travail d'images d'une vidéo passe dans le même programme séparé que l'index (I4) ou dans un
  processus enfant à lui, lancé par `src/shared/run/` en priorité basse ; à défaut, a minima
  `sharp.concurrency(max(1, cœurs/4))` et `sharp.cache(false)` dans le core, et les lectures en asynchrone.
- **Preuve** : pendant la conversion de 3 vraies vidéos, `jobs.list` reste sous 100 ms ; le CPU du processus core
  reste sous un cœur.

### I4. L'index de recherche : le GPU s'il y en a un, sinon un programme séparé

- **Constat** : `bge-m3-q8` (runtime `transformers`, `src/core/rag/runtimes/transformers.ts`) tourne dans le core :
  17 cœurs pendant 11 min, la page à 1,95 s au lieu de 35 ms, 4,3 Go gardés jusqu'à la fermeture. Aucun réglage de
  threads (`from_pretrained(id, { dtype, device })`, l. 93-102), aucun déchargement (`loaded`, l. 70). Le GPU existe
  côté `transformers` (`dml`, l. 33-35) mais `deviceOf` (`lib/fit/placement.ts:34-37`) ne l'a pas choisi pour ce
  modèle ; le runtime `llamacpp` tourne déjà hors processus (`llama-server.exe`) et s'arrête après 10 min sans usage
  (`llama-server.ts:57`).
- **Décidé** : selon la machine, la meilleure solution.
  - **Une carte graphique utilisable** (NVIDIA ou DirectML) : vectoriser sur le GPU. Préférer le runtime déjà hors
    processus quand le modèle existe pour lui (llama-server, CUDA/Vulkan) ; sinon `transformers` en `dml`.
  - **Processeur seul** : la vectorisation `transformers` tourne dans un **processus Node enfant** (`embed-worker`,
    lancé par `src/shared/run/`, `priority: "low"`), avec `intraOpNumThreads = max(1, cœurs − 2)` et
    `interOpNumThreads = 1` ; le core lui envoie des lots de textes et reçoit des vecteurs (stdin/stdout en JSON
    lignes, comme les autres processus). Il s'arrête après **10 min sans travail** (même règle que llama-server) :
    la mémoire revient au système.
  - Dans tous les cas, le choix est dit dans Settings › Models (« Vectorisation : carte graphique » / « processeur,
    N cœurs, programme séparé »).
- **À trancher en construisant** : si le choix du GPU pour `bge-m3` change le modèle installé chez un collègue (GGUF
  au lieu d'ONNX), le changement passe par les packs existants, jamais en silence. La recherche d'une requête (un
  seul texte) peut rester dans le core si le processus est arrêté et que le relancer coûte plus que la requête — à
  mesurer.
- **Preuve** : `rag.eval` donne les mêmes chiffres avant et après (mêmes vecteurs) ; pendant l'index de 4 000
  passages sur CPU, `jobs.list` reste sous 100 ms et le core sous 1 Go ; 10 min après, le processus est fermé.
  ARCHITECTURE.md §6 et §3 (un processus de plus) à mettre à jour.

---

## Lot 2 — Parallélisme (axe 2)

### §2 bis. L'index au fil de l'eau

- **Constat** : `indexAfterConversions` (`src/core/lib/docs-index.ts:107-132`) attend tant qu'une conversion occupe
  un créneau ; avec 129 conversions et 5 créneaux, l'index n'a démarré qu'après la dernière : attente médiane 42 min,
  max 4 h 24, rien de cherchable avant la fin.
- **À faire** : l'index n'attend plus que **l'index en cours**, jamais les conversions. Un document converti rejoint
  le prochain passage ; un passage démarre dès que le précédent est fini et qu'au moins un document attend. Le
  passage prend tout ce qui est prêt à cet instant (lots naturels : 1 document au début, plusieurs quand
  l'index est occupé). Avec I4, l'index ne prend plus le CPU des conversions.
- **Affichage** : à l'étape index d'une conversion, « En attente de l'index en cours (N documents avant) » au lieu
  d'« en cours » ; la ligne du document dit « Converti — en attente de l'index ».
- **Preuve** : unitaire sur la file (`docs-index.ts`) — trois conversions qui finissent à des moments différents
  donnent deux passages d'index, le premier démarrant avant la fin de la troisième conversion. Manuel : un import de
  20 documents, le premier est cherchable avant que le dernier soit converti.

### §4. Créneaux selon la machine et le type de travail

- **Constat** : `conversionsAtOnce()` (`src/core/lib/agents.ts:122-129`) est lu une fois au début d'un lot, pareil
  pour un Word et une vidéo ; une vidéo coûte 1–1,4 Go par ffmpeg + `sharp` + un Claude. Aucune limite globale de
  ffmpeg. La génération, elle, a un pool adaptatif (`agentPool`, l. 66-117) qui s'ajuste toutes les 3 s.
- **À faire** :
  - les conversions passent par le même pool adaptatif que la génération (`agentPool`), re-évalué en continu ;
  - chaque tâche a un **poids mémoire** : Word/PDF ~ `AGENT_MB` (1 000 Mo, un Claude), images ~ 1 000 Mo, vidéo ~
    2 500 Mo (ffmpeg + images + Claude) ; le pool n'en lance une que si la RAM libre couvre son poids ;
  - un plafond global de ffmpeg simultanés (2 par défaut) ;
  - la transcription reste à un à la fois (`video/speech.ts:19`).
- **Preuve** : unitaire sur `agentPool` avec poids ; sur un PC à 16 Go simulé (`freemem` bouchonné), trois vidéos ne
  partent pas ensemble.

---

## Lot 3 — Le go de l'utilisateur (axe 3)

### L'import attend le go (décisions 1 et 2)

- **Aujourd'hui** : `docs.scanFolder` liste les fichiers (taille, importable, raison) et le dialogue
  (`src/ui/screens/documents/ImportFolder.tsx`) permet de cocher ; « Importer » lance aussitôt `docs.addFolder` :
  copies et conversions partent, et le bilan ne montre que des nombres de fichiers (l. 34).
- **À construire** :
  - **Après le scan, les documents cochés entrent dans le projet « en attente »** : leur `doc.json` existe (titre,
    type, chemin d'origine, taille), rien n'est copié ni converti. Ils apparaissent dans la liste des documents avec
    l'état « En attente du lancement » (lot 6, A).
  - **Le bilan** en tête de la liste (ou du lot) : nombre de documents par type, **volume à copier**, **place libre**
    sur le disque du projet (et le refus si elle manque), **runs Claude prévus** (un par Word/PDF, un par lot de 20
    photos, ~3 par vidéo de moins de 10 min, ~12 au-delà — ARCHITECTURE.md §16), **durée estimée** (débits mesurés le
    10/11 : ~5 Word/min avec 5 créneaux, ~12 min par vidéo de 50 min, copie au débit du disque source), et pour une
    vidéo le `media.estimate` qui existe déjà (`VideoEstimate.tsx`).
  - **« Lancer »** (le lot entier) et **« Retirer »** (un document, une sélection) ; rien d'autre n'attend : les
    autres documents, la recherche, la génération sur les documents prêts marchent.
  - Ce sont des commandes du registre (règle « one registry ») : `docs.addFolder` gagne `start: false` (ajoute en
    attente), et une commande `docs.start { ids? }` lance copies et conversions des documents en attente ; le CLI et
    MCP les ont donc aussi. Un `docs.add` d'un seul petit fichier depuis la page peut garder le lancement immédiat
    (seuil à fixer : un document Word, ou < 50 Mo).
- **Preuve** : e2e mock — un import de dossier laisse N documents en attente, aucun job de conversion ; « Lancer »
  crée les jobs ; « Retirer » sur un document en attente le supprime sans trace. Le bilan affiche un volume et une
  durée.

### G1 et I. Générer en deux temps (décision 4)

- **Aujourd'hui** : `gen.tests` fait le plan (un run `plan-tests`, bloc `test-plan`) puis enchaîne l'écriture
  (`src/core/claude/generate.ts:226-482`) ; `gen.preview` dit déjà l'index manquant ou périmé (`gen.ts:154-178`,
  bandeau `IndexNotice.tsx`), mais un index périmé ne fait qu'un `warn` dans le journal (`generate.ts:269-274`).
  `--resume` sait déjà écrire les tests planifiés non écrits (`gen-again.ts:22-39`) : la séparation plan / écriture
  existe en partie.
- **À construire** :
  1. **Une case « Relire le plan avant d'écrire »** dans la demande, **cochée par défaut** (mémorisée comme les autres
     choix du formulaire). Décochée : comportement d'aujourd'hui.
  2. **Le plan s'arrête** : `gen.tests` avec `review: true` finit son job après le plan, le ledger porte le plan et
     l'état `planned`. Rien n'est écrit.
  3. **Le plan s'enrichit** (bloc `test-plan`, `PLAN` dans `gen-reply.ts:111-122`) :
     - `theme` par test (lot 5, J) ;
     - `questions: [{ id, text, why, sources, answers?: string[] }]` — ambiguïtés, documents qui se contredisent,
       périmètre incertain, chacune avec ses passages et 2 ou 3 réponses proposées. Le skill `plan-tests` apprend à
       les poser **au lieu** d'en faire plus tard des écartés `documents-disagree` ou `unblock` ;
     - les recouvrements (G6) : deux tests qui visent les mêmes sections sont signalés par le core (comparaison des
       `sections`, sans modèle) et montrés dans le plan.
  4. **Generate montre le plan** : l'arbre des thèmes et tests (lot 5, J), les questions en formulaire (réponse
     proposée à cocher ou texte libre), l'index périmé avec « Réindexer d'abord (≈ N s) » coché par défaut (G1), le
     coût (N runs, durée estimée d'après ~3 min 20 par test et le nombre d'agents). On peut décocher, renommer,
     fusionner (deux tests en un : le plan les réunit), changer de thème.
  5. **« Revoir le plan »** relance Claude (même skill, même session `--resume`) avec les réponses et les
     modifications ; autant de tours que voulu. **Le dock Claude** peut aussi en discuter : il a le plan et les
     questions dans son contexte, et une commande `gen.planSet` (proposition à accepter, comme C) pour modifier le
     plan.
  6. **« Écrire les N tests »** lance l'écriture sur le plan arrêté (le chemin de `--resume`), avec **les questions
     et leurs réponses données à chaque run** : un run ne repose pas une question tranchée et ne la rapporte pas en
     écarté.
  7. Les réponses restent dans le ledger de la génération (et nourrissent le contexte des conversations, lot 7, E).
- **Commandes** : `gen.tests { review: true }`, `gen.plan { generation, answers, edits }` (revoir),
  `gen.planSet { generation, plan }`, `gen.write { generation }` (ou `gen.tests --resume`) — toutes au registre.
- **Preuve** : unitaire sur les blocs (`questions`, `theme`) ; e2e mock — une demande de 3 tests s'arrête au plan,
  une réponse relance le plan, « Écrire » écrit 3 tests dont les prompts contiennent les réponses. ARCHITECTURE.md §8
  à réécrire.

---

## Lot 4 — Jobs : moins d'écritures, des traces justes

### §3. La progression écrite deux fois par seconde

- **Constat** : une conversion vidéo a écrit 648 événements `progress` en 5 min, chacun par `appendFileSync` dans le
  `.jsonl` et poussé à toutes les pages (`src/core/jobs.ts:116-133`) ; aucun filtre de fréquence. Les étapes
  complètes sont réécrites à chaque changement (`emitSteps`, l. 135-142).
- **À faire** : une progression n'est **écrite dans le fichier** que si `done`/`total` ou le message changent, et au
  plus une fois par seconde par job (la dernière est toujours écrite à la fin d'une étape) ; elle est **poussée à la
  page** au même rythme. Les étapes : n'écrire que l'étape qui change.
- **Preuve** : unitaire — 100 `progress` identiques en 1 s donnent un seul événement écrit.

### G2. 9 Mo et 8 500 événements pour une génération

- **À faire** : le fichier d'un job garde l'avancement et le **résumé de chaque run Claude** (début, fin, modèle,
  durée, coût, tests écrits, erreur) ; les événements `claude` et `tool` détaillés vont **en direct à la page** (le
  panneau d'activité les montre comme aujourd'hui) mais pas dans le `.jsonl` : leur trace durable est déjà dans
  `.testimus/runs/run-*/`. Le panneau d'un job terminé relit le détail d'un run depuis son dossier de run, à la
  demande.
- **Preuve** : un job de génération mock de 10 tests écrit < 200 événements ; le panneau d'un job fini montre
  toujours l'activité d'un run en l'ouvrant.

### §6. `changed` : chaque job reçoit les fichiers de tous les autres

- **Constat** : à la fin, chaque job émet tous les chemins changés dans le projet depuis son début
  (`jobs.ts:324-328`, sans plafond) ; 133 jobs × ~2 000 chemins = +25 Mo en quelques secondes, et 133 rafales vers la
  page.
- **À faire** :
  - un job n'émet que les chemins **sous ses dossiers** : son document (`docs/<id>/`), ses tests (`tests/<id>/`),
    l'index s'il est un job d'index, plus ce que ses runs Claude ont écrit (déjà connu par les snapshots) ;
  - un sous-job d'un lot (conversion d'un import) laisse le parent émettre une fois, à la fin ;
  - dans le `.jsonl`, au-delà de 200 chemins, ne garder que le nombre et les dossiers touchés (`job.touched`).
- **Preuve** : unitaire — deux jobs simultanés sur deux documents : chacun n'émet que les chemins de son document.

### §2. Un job « en cours » qui ne fait rien

- **À faire** :
  - le panneau de job et la ligne d'activité disent **« dernier signe il y a N min »** quand rien n'est arrivé depuis
    plus de 2 min ; au-delà de 10 min sans événement ni processus vivant, le job est marqué « peut-être bloqué » avec
    Annuler en évidence ;
  - un processus enfant dont le core n'a pas vu la fin (cas du gel) est vérifié par son pid au réveil : s'il n'existe
    plus, sa fin est enregistrée à l'heure où il a été vu pour la dernière fois, pas au réveil (les durées de 3 h 30
    exit 0 du 10/11 étaient fausses) ;
  - ffmpeg, whisper et llama-server sont enregistrés comme processus du job (`withProcess`, `jobs.ts:150-187`), pas
    seulement `claude -p`.
- **Preuve** : unitaire avec horloge bouchonnée (le core n'a pas de `setTimeout` : le témoin est calculé à la
  lecture, dans `jobs.show`/`jobs.list`, depuis l'heure du dernier événement).

### Petits points de jobs

- `gen.tests` sans libellé (`gen.ts:146-149`, `subject` = 80 premiers caractères de la demande) : lui donner un
  libellé « Génération : <les mots de la demande, sans le préambule> » ou, s'il y a un plan, « Génération de N
  tests ». Pareil pour le job d'index (« Index : N documents »).
- Comptes 112 / 111 (G3) : vérifié dans le ledger — le bloc `test-plan` contenait 111 tests ; « 112 scénarios »
  était la prose de Claude. Rien perdu, rien à faire.

---

## Lot 5 — Génération : qualité

### G6. Les runs d'un plan se connaissent

- **Constat** : chaque run sait seulement « test n de N » (`gen-prompt.ts:163-166, 281-288`) ; deux tests R³ ont
  recouvert la même règle ; 11 écartés `already-tested` disaient « autre test du plan » faute d'id.
- **À faire** : le prompt d'un run planifié reçoit **la liste des autres tests du plan** : leur numéro, leur thème,
  leur sujet, leurs sections, et leur id dès qu'il existe (les runs démarrent par vagues : un run lancé après la
  création d'un voisin reçoit son id). Consigne : ce qu'un voisin couvre n'est ni écrit ni rapporté ; un écarté
  `already-tested` par un voisin nomme son id, ou à défaut `plan:<n>` — que le schéma `SKIP` accepte aussi (et que
  `dedupeSkipped` retire puisque le voisin est de la génération).
- Au plan, le core signale les tests qui citent les mêmes sections (lot 3, I.3).
- **Preuve** : unitaire sur `genPrompt` (la liste des voisins y est) et sur `SKIP` (`plan:3` accepté).

### G4. Les tests « placeholder » pendant l'écriture

- **Constat** : Claude crée le test (`tests_create`, `newTest` : « New test », une étape vide — `testfile.ts:518-531`)
  puis l'écrit ; dans l'intervalle, le dossier existe à moitié vide. L'app les cache déjà ailleurs que sur Generate
  pendant la génération (`holdNewTests`, `store.ts:48-66`), mais un run annulé ou en échec à ce moment laisse un vrai
  brouillon vide.
- **À faire** :
  - `tests.create` accepte le contenu complet (description, étapes) en un appel, et le skill `generate-tests`
    (l. 70-72) demande de créer le test **avec son contenu**, puis `Write` seulement pour corriger ;
  - à la fin d'un run (réussi, en échec ou annulé), un test qu'il a créé et qui est resté squelette (résumé « New
    test » ou description vide et toutes les étapes vides) est **retiré**, et le plan le compte `missed` ;
  - le contrôle mécanique (`lib/check.ts`) signale un résumé « New test » ou une description vide (`empty-field` sur
    la description, avertissement).
- **Preuve** : unitaire — un run mock annulé après `tests_create` ne laisse aucun dossier.

### G8. Le diagnostic après un échec ne propose rien

- **Constat** : `actions.triageFailed` (`src/core/claude/actions.ts:324-356`) ne reçoit que `job.error` et 8 lignes
  de log (`jobProblems`, l. 275-284) : il ignorait le test manqué et l'étape check sautée.
- **À faire** : pour un job `generate`, le diagnostic reçoit le ledger : tests planifiés non écrits, étape check non
  faite, écartés non relus. Et le core propose **sans modèle** les actions évidentes : « Écrire le test manqué :
  <sujet> » (un `--resume`) et « Vérifier les N tests de la génération » (le check) ; le run de diagnostic n'explique
  que la cause. Avec G7 corrigé, ce cas devient rare : il reste celui d'un run en échec (crédit, connexion).
- **Preuve** : unitaire — un ledger avec un `missed` et sans check produit les deux actions.

### J. Les thèmes en sous-dossiers (décision 5)

- **Aujourd'hui** : un seul `folder` pour toute la génération (`gen.ts:118-121`) ; `stampTest` (`generate.ts:90-108`)
  ne l'applique que si le dossier du test est vide ou `/`. Le thème est déjà dans les sujets (« Traction — … »).
- **À faire** :
  - `theme` dans le plan (lot 3, I.3), proposé par Claude d'après la demande et les chapitres des documents, en mots
    courts (« Traction », « Itinéraires ») ; le préfixe « Traction — » sort du sujet ;
  - chaque test écrit va dans `<dossier>/<thème>` (ou `/<thème>` sans dossier) : c'est son `folder` local, le chemin
    Xray n'est décidé qu'au push et on peut déplacer avant ;
  - un test non planifié (demande d'un seul test) garde le dossier donné.
- **Écran** : voir lot 6, B (l'arbre de la page Tests sur Generate).
- **Preuve** : unitaire sur `stampTest` avec thème ; e2e mock — une génération de 3 tests en 2 thèmes crée 2
  sous-dossiers visibles dans Tests.

### H. Plus d'images, sans en exiger (décision 8)

- **Mesuré le 11/11** : 228 étapes sur 1 869 avec une image (12 %) ; 238 figures de documents, 2 images clés de
  vidéo, 1 photo — alors que le projet a 15 dossiers de photos d'IHM et 33 vidéos.
- **À faire** :
  - **Skill `generate-tests`** (« Pictures », l. 92-103) : pour chaque étape où le testeur *fait* ou *voit* quelque
    chose sur un écran, chercher une image dans cet ordre — figure du document, photo d'IHM (`#img:`), image clé de
    vidéo (`#frame:`, ou `media.keep` pour fixer le bon instant) — et la mettre **si elle montre vraiment cet écran**.
    Ne pas en trouver est normal et ne se justifie pas ; une image approximative est pire que pas d'image. Même
    consigne dans `fix-test` et `edit-test`.
  - **Bouton « Trouver une image »** sur une étape, en revue et dans le test : une commande
    `tests.findImage { id, step }` — un job Claude court (Sonnet, effort bas) qui cherche dans cet ordre, propose 0 à 3
    images avec leur source, et l'utilisateur en choisit une (ajoutée par `tests.addImage`, qui existe). Claude peut
    l'appeler aussi (règle « one registry »).
  - Pas d'avertissement du contrôle mécanique (décision 8).
- **Preuve** : un `gen.bench` avant / après sur le même lot de documents compte les étapes avec image, par origine
  (figure / photo / vidéo) ; à lire à la main : aucune image hors sujet.

### F. La description d'un test vérifiée et corrigeable

- **Constat** : le Cross-check lit le résumé et la description comme périmètre (`analyze-test/SKILL.md`, « How to
  read it » 1) mais ne les confronte ni aux documents ni aux étapes ; aucune proposition ne peut les viser
  (`PROPOSAL_KINDS`, `src/core/lib/analysis.ts:21` — toutes portent sur une étape).
- **À faire** :
  - un genre de proposition **`describe`** : `{ field: "summary" | "description", text, sources, why }` ; appliquer
    la proposition réécrit le champ (comme `change` pour une colonne) ;
  - le skill `analyze-test` vérifie que la description dit ce que les étapes testent, et que ce qu'elle affirme du
    système est soutenu par un passage ; un écart description ↔ étapes donne une proposition `describe` ;
  - le check sémantique (`check-test`) gagne le même contrôle en finding `description-mismatch` (avertissement).
- **Preuve** : unitaire sur le schéma et l'application ; un test mock à description fausse donne une proposition.

---

## Lot 6 — Écrans à l'échelle et lisibilité

### A. Un état de document lisible

- **Aujourd'hui** : l'état est éparpillé — `converted?` (`types.ts:225`), `indexed`/`indexing` (`types.ts:381-382`),
  l'état des fichiers médias (`MediaFile.state`, l. 264), les étapes vidéo (`VideoData`, l. 304-342), les figures
  décrites (lues dans `figures.json` par l'écran), les conversions en vol (`src/ui/lib/uploads.ts`). `indexWord`
  (`src/ui/screens/documents/badges.tsx:20-27`) et `unready()` (`src/ui/lib/scope.ts`) en font chacun leur résumé.
  `DocStatus` (brouillon/soumis/validé, l. 208) est autre chose et le reste.
- **À faire** : `docs.list` renvoie un champ dérivé **`stage`**, calculé par le core depuis les fichiers et les jobs
  en cours, jamais stocké :
  - `pending` — en attente du lancement (lot 3) ;
  - `copying` — copie (avec octets) ;
  - `converting` — conversion, puis selon le type : `figures` (Word/PDF), `pictures` (photos lues par Claude),
    `transcribing` / `frames` (vidéo) ;
  - `waiting-index` — converti, en attente de l'index (avec « N documents avant ») ;
  - `indexing` ;
  - `ready` — cherchable, utilisable pour générer ;
  - `stale` — prêt mais l'index ne suit plus ; `failed` — avec l'étape et le message.
  Un seul composant (`DocStage`) le montre pareil dans la liste des documents, le panneau de job, le sélecteur de
  Generate et `unready()`, qui disparaît au profit de `stage`. Le mot « status » reste au statut du document.
- **Preuve** : unitaire sur le calcul de `stage` pour chaque type ; capture `npm run screens` de la liste avec un
  document à chaque étape.

### B. Panneaux et listes qui tiennent 100+ éléments

- **Aujourd'hui** (après `f4be71be`) : le panneau de job est un tiroir pleine hauteur qui défile (`Modal.tsx:85-129`),
  mais `JobFiles` (`JobFiles.tsx:47-78`) est une liste sans borne ; le popover d'activité du haut
  (`src/ui/components/shell/Activity.tsx`) n'a pas de hauteur max (`Popover.tsx:39-52` calcule une place via
  `useAnchor` qu'il n'applique pas) et liste chaque sous-job un par un.
- **À faire** :
  - `Popover` applique la hauteur disponible et défile (corrige tous les popovers) ;
  - l'activité **regroupe les sous-jobs par parent** : « Import de D401-1 — 81 conversions : 48 finies, 8 en cours,
    25 en file » sur une ligne, dépliable ;
  - `JobFiles` : au-delà de 50 fichiers, les dossiers touchés avec leur nombre, dépliables ;
  - les longues listes (Timeline d'un job, `ClaudeActivity`) passent par `useRowWindow` (le fenêtrage du kit) au-delà
    de 150 lignes.
- **Generate — la sélection des documents** (`DocScopePicker.tsx`, liste plate toujours dépliée, tout coché par
  défaut) : par défaut une seule ligne **« Tous les documents (125) »** ; « Restreindre… » déplie l'arbre (dossiers
  d'import, documents, puis sections — `SectionTree` existe) ; quand une restriction existe, la ligne dit « 12
  documents, 3 restreints ».
- **Generate — les tests** (`WritingTests.tsx`, `GenResult`/`LandedCard` : listes plates de 110 cartes) : l'arbre de
  la page Tests, groupé par thème (lot 5, J), avec l'avancement par thème (« Traction : 18 / 30 ») pendant
  l'écriture, et le test en cours déplié comme aujourd'hui. Pour cela : `list/tree.ts` (pur) passe dans
  `src/ui/components/` avec `FolderPanes` et `rows.tsx` ; `LocalTree` prend le rendu d'une ligne en paramètre ;
  `usePaneShare` accepte un nom de plus.
- **À vérifier à l'échelle** : liste des documents (125), revue (110 tests), historique d'un document — avec le mock
  à 150 documents et 150 tests (un knob du mock à ajouter si besoin, CODE.md « Mock »).
- **Preuve** : `npm run screens` sur le mock à l'échelle, clair et sombre ; e2e — le popover d'activité avec 100 jobs
  ne dépasse pas la fenêtre.

### D. Le rendu des réponses de Claude (décision 9)

- **Aujourd'hui** : `src/ui/components/claude/AnswerText.tsx:70-105` coupe aux lignes vides et affiche en
  `pre-wrap` ; seules les références deviennent des puces. `OverviewText.tsx` gère `#` et retire `**` ;
  `DiagnosisText.tsx` ne gère que les `` ` ``. `src/ui/components/sources/DocText.tsx:212-351` sait les titres,
  paragraphes, gras/italique et tableaux de `doc.md`. Aucune bibliothèque Markdown dans `package.json`.
- **À faire** : un seul rendu Markdown **maison**, en éléments React (jamais de HTML brut), partagé par `AnswerText`,
  `OverviewText`, `DiagnosisText` — et, si possible sans le casser, par `DocText` :
  - titres (`#` à `###`), paragraphes, `**gras**`, `*italique*`, listes à puces et numérotées (un niveau
    d'imbrication), `` `code` `` et blocs ```` ``` ````, tableaux `|`, liens, citations `>` ;
  - les puces de source restent telles quelles (elles vont bien) ;
  - **le mur de texte** : interlignage et espace entre blocs du kit, largeur de lecture bornée (~70 caractères),
    titres et listes qui découpent ;
  - **polices et tailles** : tout passe par `type.ts` (une taille de corps lisible pour la conversation, monospace
    pour le code), à caler avec le design system (`design/`, lecture seule — demander à une session design si un
    style manque).
- **Preuve** : tests du parseur (chaque construction, et une réponse réelle de chat du 11/11 rejouée) ; capture du
  dock avec une longue réponse, clair et sombre ; garde « pas de `dangerouslySetInnerHTML` ».

---

## Lot 7 — Claude et contextes

### C. Le chat peut corriger la vue d'ensemble, un contexte, une colonne (décision 6)

- **Aujourd'hui** : un run de chat n'a que des commandes de lecture (`EXTRA.chat = []`, `src/core/claude/access.ts`) ;
  `docs/**`, `contexts/**`, `columns.json` sont interdits en écriture fichier à tout run (`PROTECTED`, l. 226-238) ;
  `docs.overview`/`docs.overviewSave` ne sont qu'au run « overview » (l. 183-188). Résultat : un refus sans issue.
- **À faire** :
  - le chat reçoit des commandes **de proposition** : `docs.overviewPropose { text, why }`,
    `contexts.propose { id, notes, why }`, `columns.propose { column, description, why }` — elles n'écrivent rien,
    elles enregistrent une proposition (comme `actions.propose`) ;
  - la page montre la proposition **en diff** sous la réponse, avec **Appliquer** / **Ignorer** ; Appliquer appelle
    la commande d'écriture qui existe (`docs.overviewSave` avec `ifMtime`, `contexts.set`, `columns.save`) — le
    snapshot du run permet de revenir ;
  - les fichiers restent protégés en écriture directe (`PROTECTED` ne change pas).
- **Preuve** : e2e mock — demander au chat de corriger la vue d'ensemble produit une proposition, Appliquer change
  `docs/OVERVIEW.md`, Ignorer ne change rien. ARCHITECTURE.md §11 (accès des runs).

### E. Le contexte des conversations (décision 7)

- **Aujourd'hui** : les conversations vivent dans `.testimus/chats/chat-*.json` et le dock (état React) ; aucun run
  suivant ne les relit hors du fil en cours ; aucun réglage.
- **À faire** :
  - un contexte ordinaire, `contexts/conversations/context.md`, créé au premier usage, **attaché par défaut** au
    projet (`project.json` `claude.contexts`) — on le décoche comme n'importe quel contexte, par projet, par test ou
    pour un run ;
  - **après chaque tour de chat**, un run court en arrière-plan (Sonnet, effort bas) reçoit le contexte actuel et le
    dernier échange, et **réécrit le fichier sans demander** par une commande dédiée `contexts.learn { text }` — la
    seule écriture qu'il a, sur ce seul contexte ;
  - les règles du run (dans son prompt, et vérifiées par la commande) : **court** (plafond, par ex. 4 000 caractères
    — refus au-delà, Claude doit condenser) ; seulement ce qui servira à d'autres runs (décisions, préférences de
    rédaction, corrections répétées, vocabulaire, questions tranchées) ; **pas de passages de documents** ni de
    sources recopiées ; une affirmation contredite par un échange récent est remplacée ; pas de date ni de journal ;
  - « Ne pas retenir cette conversation » dans le dock (le run d'apprentissage n'est pas lancé) ;
  - les réponses aux questions du plan (lot 3, I) passent par le même chemin ;
  - le fichier est versionné comme les autres (snapshot du run) : on peut revenir à une version précédente.
- **Preuve** : unitaire sur `contexts.learn` (plafond, contexte unique) ; e2e mock — un tour de chat met à jour le
  fichier, la case « ne pas retenir » l'empêche, un run de génération le reçoit tant qu'il est coché.

---

## Ce qui reste à mesurer après construction

Rejouer la même charge sur une copie du checkpoint (`D:\Testimus\Checkpoints\L00320 - … - 2026-11-11`, jamais
écrit) ou un projet neuf avec les mêmes dossiers :

- import des trois dossiers : la page sous 100 ms tout du long ; Annuler marche pendant une copie ; le premier
  document cherchable en moins de 5 min ; durée totale (cible : copie au débit du disque + ~1 h de travail utile) ;
- index : CPU machine, mémoire du core pendant et 10 min après ;
- génération de ~100 tests : 0 job en échec pour un doute, fichier du job < 1 Mo, part des étapes avec image ;
- un PC de collègue à 16 Go sans carte NVIDIA, si possible : créneaux choisis, aucune saturation.

## Hors de ce document

- Les vidéos « qui parle », le build Vulkan de whisper.cpp : décisions existantes (ARCHITECTURE.md §16).
- La lecture de fichiers via l'API OneDrive/SharePoint plutôt que le dossier synchronisé : écartée (décision 1).
