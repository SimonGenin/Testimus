# Goal — Testimus v2 : RAG v2 et application de bureau, en une passe

## Objectif

Construire ce que proposent **`SPEC-RAG.md`** (phases R1 à R10, et R11 selon la règle plus bas) et
**`SPEC-ELECTRON.md`** (phases E1 à E4), sur la v1 existante, sans rien casser de ce qui marche.

C'est fini quand :
- chaque phase de ces deux specs est construite, vérifiée, et que son comportement a **quitté la
  proposition pour entrer dans `SPEC.md`** (règle écrite en tête de chaque spec) ;
- `ROADMAP.md` a une section par spec (R1…R11, E1…E4), chaque case cochée ou expliquée ;
- la barre de vérification de `SPEC.md` (« Verification bar ») est verte, mesurée **après la dernière
  écriture**, plus les e2e desktop de SPEC-ELECTRON §10 ;
- le banc d'essai (SPEC-RAG §10) a tourné sur les vrais documents RATP et ses résultats sont écrits ;
- le parcours complet marche, dans le navigateur **et** dans la fenêtre Electron ;
- le rapport final est rendu (voir « Fin »).

## Ne pose aucune question

Pas d'AskUserQuestion, pas de « voulez-vous… », pas de pause en attendant une réponse. Personne ne
répondra avant la fin.
- Une question ouverte d'une spec prend **la réponse du tableau « Décisions » ci-dessous**.
- Une question qui n'y est pas : prends le choix que la spec recommande ; s'il n'y en a pas, le plus
  simple qui respecte `SPEC.md`, les principes P1–P8 de SPEC-RAG et D1–D5 de SPEC-ELECTRON.
- Un obstacle se contourne. Seule une impossibilité réelle t'arrête, et elle est expliquée dans le
  rapport final, avec ce qu'il faudrait pour la lever.

Chaque choix fait ainsi est noté dans `.build/v2/state.md` (section « Décisions prises »), puis dans le
rapport final, et dans la spec concernée quand il fixe un comportement.

## À lire avant tout

- `CLAUDE.md`, `SPEC.md`, `ROADMAP.md`, `LINKS.md` (dont « Local models and runtimes »).
- **`SPEC-RAG.md` et `SPEC-ELECTRON.md` en entier**, sections « Tried on the dev PC » comprises : ce
  sont des faits mesurés, pas des hypothèses.
- `GOAL.md` : comment la v1 a été construite (mêmes règles d'orchestration).
- Les skills de `.claude/skills/` (`rag-eval`, `docx-ingest`, `xray-cloud-api`, `port-from-xray-editor`)
  et ceux de `templates/project/.claude/skills/` (produit : `generate-tests`, `check-test`, `ask-docs`,
  `fix-test`).

## Décisions (réponses aux questions ouvertes)

### SPEC-RAG §14

| # | Question | Décision |
|---|---|---|
| 1 | Clé de l'activation par machine | Chemin réel (`realpath`, casse normalisée) du dossier projet ; si absent, retombe sur le pack de référence. |
| 2 | Ollama sur un autre hôte | Refusé (P5). Seul le loopback est accepté. Et sur ce PC, Ollama n'est pas installé : voir « Règles ». |
| 3 | Partage d'un espace vectoriel entre PC | Non. Chaque PC indexe (≈ 2 000 passages). |
| 4 | Matrices et amendements des PA | Règle de §3.2 telle quelle, testée sur **tous** les documents actuels du dossier J5 ; les amendements au niveau section seulement si un PA nomme la section de façon reconnaissable, sinon au niveau document. |
| 5 | VRAM hors NVIDIA | Verdict « unknown » + mesure au premier usage. Essayer `qwMemorySize` du registre ; si ça ne marche pas sans admin, l'écrire et passer. |
| 6 | EMF/WMF | Inchangé : gardés tels quels avec l'avertissement. |
| 7 | Langue de l'instruction Qwen | Anglais par défaut ; le banc d'essai compare une fois avec le français et garde le meilleur. |
| 8 | Stemmer français | Une bibliothèque JS pure, licence MIT/BSD/Apache, maintenue ; sinon un portage de l'algorithme Snowball French dans `src/core/rag/stem-fr.ts`, avec ses tests sur la liste de mots de référence Snowball. |
| 9 | Budgets par défaut | Ceux de §7.10 (`queryMs: 1000`, `indexPassagesPerSec: 5`, `headroom: 0.15`). |
| 10 | Livraison de llama.cpp | Téléchargé à la demande seulement (chemin B), build choisi d'après le profil machine (CUDA → Vulkan → CPU). Rien dans la release. |
| 11 | Packs | Les quatre de §7.12 + Custom. Premier lancement : propose le pack qui « fits » le mieux, présélectionné ; Light si le matériel est inconnu. |

### SPEC-ELECTRON §12

| # | Question | Décision |
|---|---|---|
| 1 | Signature (E0) | Impossible ici (il faut le PC d'un testeur). Construire non signé, documenter le risque, garder le mode navigateur comme repli (D3). E0 reste ouverte dans le rapport. |
| 2 | Runtime A ou B | **B** (le Node 26 livré fait tourner le cœur). |
| 3 | Rythme Electron | Une ligne dans SPEC §16 : une release au moins tous les 6 mois, version Electron épinglée. |
| 4 | Raccourci « Testimus (browser) » | Gardé pour tous. |
| 5 | Fermer pendant un job | Toujours demander (pas d'icône de zone de notification). |
| 6 | Préférences UI | Accepter la séparation navigateur / bureau (`localStorage` par profil). |
| 7 | Mises à jour (E5) | Hors périmètre : E5 n'est pas construite, elle est listée dans le rapport. |

### Banc d'essai (SPEC-RAG §10)

- Les testeurs ne sont pas là pour écrire le jeu de référence : construis un **jeu d'amorçage**
  (`eval/behaviors.jsonl`) de 30 à 40 comportements sur les documents actuels (§10.2 : Claude lit le
  document entier et propose les preuves), chaque ligne marquée `"validated": false`. Répartis-les entre
  les catégories de §10.2 (une section, sections éloignées, plusieurs documents, exceptions, amendements
  PA, figures, sigles).
- Les résultats sont **provisoires** tant que le jeu n'est pas validé par les testeurs ; écris-le partout
  où un chiffre apparaît.
- La référence (`project.json.rag.reference`) ne change que si la règle de §10.6 est remplie sur ce jeu ;
  sinon elle reste au pack Light (bge-m3), et le rapport dit pourquoi.
- Le niveau L2 (avec Claude) reste sobre : 4 comportements × 2 configurations (la référence et la
  meilleure en L1) × 3 essais. Pas plus.

### R11

À faire si, à la fin de R10, le banc d'essai montre qu'un reranker Qwen3 améliore le rappel en mode
`threshold` : alors l'implémentation `yes-no-lm` de transformers.js (§8.2). Les descriptions de figures
v2 : oui, mais seulement sur les documents du banc d'essai. L'embedding multimodal : non (reporté par
§11).

## Règles qui ne bougent pas

- **Aucune écriture dans un projet Jira** (LFRPS12, BHPTCC ou autre). Les appels réels sont en lecture
  seule. Une écriture se prouve par un test unitaire sur un faux `http`.
- On ne modifie jamais `D:\Projects\XrayEditor` ni un original de document : les documents RATP sont
  **copiés** depuis le dossier J5 (`LINKS.md`) dans `.sandbox/v2/`.
- `npm` et `npx` depuis l'outil Bash. Les fichiers TypeScript avec Write/Edit, jamais en heredoc. TS
  effaçable seulement, imports en `.ts`, pas de commentaire sauf `// ponytail:`, tests dans `tests/`.
- **Modèles** : ceux de `LINKS.md` sont déjà sur D: et vérifiés. N'en télécharge un autre que s'il est
  dans le catalogue de SPEC-RAG §7.2, dans `D:\transformers-models`, avec contrôle SHA-256. Jamais sur
  C: (24 Go libres). Ne supprime, ne déplace aucun modèle de `D:\transformers-models`. Pour les
  essais du déplacement de dossier (§7.3), utilise des copies dans `.sandbox/v2/`.
- **Ollama a été désinstallé de ce PC** (2026-11-02). Ne l'installe pas, ne le lance pas, n'appelle
  jamais un vrai Ollama et n'essaie pas de prouver qu'il est installé. Le runtime Ollama (R7) se
  construit et se prouve **uniquement contre un faux serveur HTTP** (tests unitaires et mock) ; le seul
  état réel à vérifier est « Ollama non installé » (doctor, panneau Ollama). Tous les essais réels de
  modèles passent par transformers.js et llama.cpp.
- `llama-server` tourne en local seulement (`127.0.0.1`), toujours avec `--api-key`. Tout serveur lancé
  pour un essai est arrêté à la fin de l'essai.
- Téléchargements par le `fetch` de Node (ou le client HTTP de PowerShell pour un essai), jamais
  `curl.exe` (SPEC-RAG F17), jamais en désactivant une vérification de certificat.
- Electron : version épinglée en devDependency, la même que celle téléchargée par la release, vérifiée
  par `SHASUMS256.txt`.
- Les essais réels de Claude restent sobres : `claude -p "reply ok"` pour l'enveloppe, le L2 borné
  ci-dessus, un parcours complet à la fin.
- Rien qui demande des droits admin. Pas de raccourci, de PATH ni de clé de registre modifiés sur ce PC
  sans que ce soit dans `.sandbox/` ou dans une installation de test avec `-NoPath -NoShortcut`.
- Données d'essai dans `.sandbox/v2/`, journal de construction dans `.build/v2/`. Les deux dans
  `.gitignore`.
- Pas de git.

## Tests dans le navigateur et dans la fenêtre

- Navigateur : le navigateur intégré ou **Claude in Chrome** (un seul pilote à la fois), plus Playwright
  qui reste la preuve automatique (`serve --mock`).
- Fenêtre : Playwright `_electron.launch` (SPEC-ELECTRON §10) pour la preuve automatique ; une capture
  de chaque nouvel écran dans `tests/screens/`.
- Pour chaque écran nouveau ou changé (Settings › Models avec les packs, le dialogue de dossier, le
  panneau Ollama, les confirmations de fit, la bannière de conseil ; Review « sources lues / liées » ;
  First launch « Parcourir… ») : clair et sombre, console sans erreur, les états (vide, chargement,
  téléchargement en cours, Ollama absent / arrêté / présent, GPU trop petit, modèle en partie sur le
  processeur, erreur).

## Orchestration

Tu es l'orchestrateur. Tu lances les sous-agents (outil Agent, general-purpose, en arrière-plan quand
ils sont indépendants). **Tu écris toi-même les fichiers partagés** : `package.json`, la config,
`src/core/types.ts`, `src/core/commands/index.ts`, `src/core/rag/db.ts` (schéma), `models/catalog.json`,
`SPEC.md`, `SPEC-RAG.md`, `SPEC-ELECTRON.md`, `ROADMAP.md`, `CLAUDE.md`, `LINKS.md`.
Chaque agent possède une liste de fichiers et ne touche à rien d'autre ; ce dont il a besoin ailleurs,
il le demande en `BESOIN:` dans son journal.

**Vague 0 — toi, séquentiel. Les contrats.**
1. Lis tout, lance `npm run build`, `npm test`, `npx playwright test` : l'état de départ, noté dans
   `state.md`.
2. Découpe `src/core/rag/search.ts` sans changer son comportement (tests verts avant et après) :
   `search/lexical.ts` (FTS, requête), `search/vector.ts`, `search/hybrid.ts` (fusion, rerank),
   `search/passage.ts` (passage, figure). Même chose pour `embed.ts` → `runtimes/types.ts`,
   `runtimes/transformers.ts`, `runtimes/mock.ts`. Ainsi deux agents ne partagent jamais un fichier.
3. Types partagés dans `types.ts` : entrée de catalogue (sources, runtimes, quantification,
   lighter/heavier), pack et variante, installation, empreinte d'espace, `EmbeddingRuntime` /
   `RerankRuntime` (§8.1), statement d'exigence, arête du graphe, ligne du journal des temps, profil
   machine, verdict de fit.
4. Schéma de `rag.db` (§6.2) : `edges`, colonne FTS racinisée, `spaces`, `vec_<id>`, avec la migration
   de l'ancienne table `vecs` (§6.3) et son test.
5. `models/catalog.json` : les entrées de SPEC-RAG §7.2 (avec les SHA-256 relevés sur Hugging Face) et
   les packs de §7.12 ; le test unitaire « sans Ollama » (P8, §7.12) dès maintenant.
6. Les commandes nouvelles déclarées dans le registre avec leurs schémas zod (`.describe()` partout)
   et un `run` qui lève « not built yet » : `rag.mentions`, `rag.related`, `rag.compare`, `rag.spaces`,
   `rag.dropSpace`, `gen.bench`, `models.*` (§7.6).

**Vague 1 — en parallèle.**
- **A — Banc d'essai (R1)** : `rag/eval.ts` v2, format `behaviors.jsonl` (l'ancien reste lisible),
  métriques L1 de §10.3, rapports avec empreinte (§10.5), `rag.compare` avec intervalles bootstrap
  (§10.6). Tests sur un jeu de fixtures.
- **B — Modèle de preuve (R2)** : statements d'exigence (§3.1), détection des matrices (§3.2),
  graphe (§3.3), plafond de passage (§3.4), dans `convert*.ts`, `chunk.ts`, `search/passage.ts` ;
  `quote-not-at-anchor` et `quote-weak` dans `lib/check.ts`. Preuve sur la vraie conversion de
  D401-1_3 (F1–F3 de SPEC-RAG doivent disparaître).
- **C — Lexical français (R4)** : `rag/stem-fr.ts`, glossaire (§4.2), mots vides, dans
  `search/lexical.ts` et l'indexation de la colonne racinisée.
- **D — Espaces vectoriels (R5)** : `indexer.ts` par espace, empreinte (§6.1), activation par machine
  (§6.4), repli BM25 (§4.4), `runtimes/transformers.ts` (device, dtype par device, troncature en tokens,
  F8–F9), `search/vector.ts`, `rag.spaces`, `rag.dropSpace`.
- **E — Gestionnaire de modèles (R6, R8)** : `lib/models-store.ts` et nouveaux `lib/models-*.ts` :
  registre machine (§7.4), chemin A, téléchargement B avec `.part` + SHA-256, **changement de dossier**
  move / keep / copy (§7.3), profil machine et fit (§7.8), journal des temps (§7.9), conseils (§7.10),
  packs et leur résolution (§7.12) ; `commands/models.ts` ; lignes du doctor (§7.11).
- **F — Runtimes Ollama et llama.cpp (R7, R9)** : `runtimes/ollama.ts` (§8.3), `runtimes/llamacpp.ts`
  et le gestionnaire de serveurs (démarrage, clé aléatoire, `/health`, arrêt après inactivité, §8.4),
  téléchargement du build llama.cpp (B) ; tests sur des faux HTTP. Essai réel en fin d'étape **pour
  llama.cpp seulement**, avec les GGUF de `LINKS.md` ; Ollama uniquement contre un faux serveur, plus la
  détection réelle « non installé ».
- **G — Cœur pour le bureau (E1)** : `serve --port 0 --ready-json --exit-with-stdin`, annulation des
  jobs et arrêt de l'arbre `claude -p` à la sortie, `TESTIMUS_SHELL` (SPEC-ELECTRON §3.2), dans
  `faces/http.ts`, `faces/cli.ts`, `core/jobs.ts`, `core/claude/run.ts`.
- **H — Coquille Electron (E2)** : `src/desktop/*` (main, core, window, bridge, preload, pages),
  `npm run desktop`, tests unitaires et e2e Electron de SPEC-ELECTRON §10. Le bridge est déclaré ici,
  câblé dans l'UI en vague 2.

**Vague 2 — en parallèle, une fois la vague 1 finie et ses `BESOIN:` traités.**
- **I — Outils de rappel (R3)** : `rag.mentions`, `rag.related`, `expand` (§4.1) ; skills produit mis
  à jour (§4.6) dans `templates/project/.claude/skills/` ; registre des preuves lues (§5.3) depuis le
  `stream-json` dans `core/claude/` et `gen.ts`.
- **J — Écrans modèles et recherche** : Settings › Models (cartes de packs, table repliée, dialogue de
  dossier, panneau Ollama, confirmations de fit, bannière de conseil, §7.7), Settings › Search (sans la
  liste `PROFILES` codée en dur, F11), Review « sources lues / liées ».
- **K — Pont et UI de bureau (E3)** : `src/ui/lib/desktop.ts` et les points d'appel (Parcourir…,
  `pathOf` → `docs.add { path }`, sélecteurs Import et claude.exe, progression dans la barre des tâches,
  notifications, « Afficher dans l'Explorateur »), chaque écran gardant son comportement sans le pont.
- **L — Release (E4)** : `scripts/release.ts` et `install.ps1` : Electron épinglé + SHA-256, renommage,
  icône, fuses, asar, locales, raccourcis, `Unblock-File` (SPEC-ELECTRON §7). Installation de preuve dans
  un dossier neuf avec `-NoPath -NoShortcut` (Windows Sandbox n'est pas disponible sur ce PC).
- **M — E2e** : Playwright navigateur sur tous les nouveaux écrans contre `serve --mock` (le mock gagne
  un faux Ollama, un faux llama.cpp, un faux profil machine pour jouer « GPU trop petit » et « en partie
  sur le processeur »), plus les e2e Electron.

**Vague 3 — toi.**
1. Intégration et barre de vérification complète.
2. **R10 — les mesures** : copie les documents actuels du dossier J5 dans `.sandbox/v2/project/`,
   convertis, construis le jeu d'amorçage, puis lance le L1 sur chaque variante de chaque pack (§10.8,
   dans l'ordre), les quantifications Q4 / Q8, l'instruction anglaise / française, rerankers `topk` et
   `threshold` (seuils par modèle, §4.5), puis le L2 borné. Ordre des variantes et seuils fixés par les
   chiffres ; tout est écrit dans SPEC.md §5 et SPEC-RAG §16, marqué provisoire.
3. R11 selon sa règle.
4. Revue à l'œil de chaque écran nouveau ou changé, navigateur et fenêtre, clair et sombre.
5. Vérifications réelles en lecture seule : un `xray.pull` d'un test LFRPS12 marche toujours ; un
   parcours complet dans la fenêtre Electron sur `.sandbox/v2/project/` : choisir le pack Quality (il
   doit se résoudre sur la variante que le fit autorise), indexer, générer un test sur le sectionneur
   (§5.6.6, `EXI_MOP_SPF_511_A_1650` à `1680`), check, relecture (To fix → Ask Claude to fix it →
   Validate), plan de push affiché **mais non exécuté**, quitter avec un job en cours et vérifier qu'aucun
   `node.exe`, `claude.exe` ou `llama-server.exe` ne reste.
6. La preuve « sans Ollama » (P8) : Ollama n'est pas installé sur ce PC, donc le parcours ci-dessus la
   donne déjà pour Quality ; complète-la en résolvant et indexant chaque pack (Light, Performance,
   Balanced, Quality) avec transformers.js et llama.cpp seuls, et en vérifiant que le doctor et le
   panneau Ollama disent « non installé » sans erreur.
7. Release, puis installation de preuve (vague 2, L).
8. Un agent de revue contradictoire, qui reçoit le code, `SPEC.md`, `SPEC-RAG.md` et `SPEC-ELECTRON.md`
   mais pas tes conclusions.
9. Corrections, puis nouvelle barre de vérification complète et nouvelle revue à l'œil.

`SPEC.md` est mis à jour dans la même vague que chaque comportement qui atterrit ; la partie
correspondante quitte SPEC-RAG.md ou SPEC-ELECTRON.md (ou y est marquée « built, see SPEC §x »).

## Brief de chaque sous-agent

Chaque brief contient :
- l'objectif ;
- les fichiers possédés ;
- les sections de SPEC, SPEC-RAG, SPEC-ELECTRON et `LINKS.md` à lire ;
- le skill à suivre quand il y en a un (`rag-eval`, `docx-ingest`, `xray-cloud-api`) ;
- les décisions du tableau ci-dessus qui le concernent ;
- ce que « fini » veut dire (les tests qui doivent passer, la preuve réelle s'il y en a une) ;
- « ne pose aucune question : tranche, note, continue » ;
- le bloc de reprise ci-dessous, recopié tel quel.

> **Reprise après interruption — obligatoire.** La session peut être arrêtée et relancée à n'importe quel moment, y compris au milieu de ton travail. Tu ne te souviens de rien d'une exécution précédente : la vérité, c'est ton journal et le code.
> 1. Au démarrage, lis `.build/v2/agents/<ton-nom>.md` s'il existe, puis tes fichiers, puis lance tes tests. Déduis-en où tu en es. Ne refais jamais une étape dont le résultat existe et passe ses tests.
> 2. Avance par petites étapes vérifiables. Après chacune, ajoute à ton journal : l'étape, les fichiers touchés, l'état des tests, la prochaine étape.
> 3. Écris des fichiers entiers et cohérents, de façon idempotente. Rejouer une étape doit donner le même résultat. Un fichier de ton périmètre à moitié écrit (qui ne compile pas, ou qui casse un test) se répare ou se réécrit en premier.
> 4. Ne modifie jamais un fichier hors de ton périmètre, même pour « réparer ». Note-le en `BESOIN:` dans ton journal.
> 5. Termine ton journal par `DONE` et un résumé (ce qui marche, ce qui est vérifié, les écarts aux specs, les choix faits sans demander), ou par `BLOCKED: <raison précise>`.

## Ta propre reprise

- Tu tiens `.build/v2/state.md` à jour à chaque changement : la vague en cours, chaque agent (nom,
  périmètre, statut), les décisions prises sans demander, les besoins en attente, l'état des mesures R10.
- Au démarrage, lis `state.md` et les journaux des agents avant de lancer quoi que ce soit.
- Un agent qui n'est pas `DONE` est relancé avec le même brief plus « reprends ».
- Un agent `DONE` est contrôlé en relançant ses tests, jamais en le croyant sur parole.
- Les `BESOIN:` sont traités avant la vague suivante.
- Les mesures longues (indexation du corpus, L1 sur toutes les variantes) tournent en arrière-plan ;
  leur avancement est dans `state.md` pour qu'une reprise ne les relance pas de zéro.

## Fin — le rapport

Un fichier `.build/v2/REPORT.md`, en français, et son résumé dans ta réponse :
- ce qui est construit, phase par phase (R1–R11, E1–E4), et ce qui ne l'est pas, avec la raison ;
- la barre de vérification finale (commandes, nombres de tests, durée) ;
- les **mesures R10** : tableau par variante (rappel des preuves @10 / @20, complet@k, rappel par rôle
  dont les exceptions, latence p50 / p95, VRAM, durée d'indexation), le pack de référence retenu et
  pourquoi, en rappelant que le jeu d'amorçage n'est pas encore validé par les testeurs ;
- la preuve « sans Ollama » ;
- toutes les décisions prises sans demander ;
- ce qui reste ouvert : E0 (signature sur un PC testeur), la validation du jeu de référence par les
  testeurs, E5, et tout `BLOCKED`.
