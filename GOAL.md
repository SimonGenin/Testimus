# Goal — Testimus v1 fonctionnelle, en une passe

## Objectif
Livrer une **v1 fonctionnelle** de Testimus : les phases 1 à 4 de `ROADMAP.md` (la section « Later » est exclue), conformes à `SPEC.md` et au design.
C'est fini quand :
- toutes les cases de ces phases sont cochées ;
- la barre de vérification de SPEC (section « Verification bar ») est verte, mesurée après la dernière écriture ;
- le parcours complet marche dans le navigateur ;
- le rapport final est rendu (voir « Fin »).

Seule une v1 qui fonctionne compte. Le reste s'ajustera ensuite.

## Ne pose aucune question
Pas d'AskUserQuestion, pas de « voulez-vous… ». Personne ne répondra avant la fin.
- Une décision ouverte (SPEC, section « Open decisions ») prend la valeur par défaut écrite dans SPEC.
- Une ambiguïté se tranche dans le sens le plus simple qui respecte SPEC et le design.
- Un obstacle se contourne. Seule une impossibilité réelle t'arrête, et elle est expliquée dans le rapport final.

Chaque choix fait ainsi est noté dans `.build/state.md`, puis dans le rapport final.

## À lire avant tout
- `CLAUDE.md`, `SPEC.md`, `ROADMAP.md`, `LINKS.md`.
- Les skills de `.claude/skills/` et ceux de `templates/project/.claude/skills/`.
- Côté Xray Editor : `D:\Projects\XrayEditor\SPEC.md` (§3 à §9) et son `CLAUDE.md`.
- **Le design** : le brouillon est un artifact, « Testimus — UI draft », https://claude.ai/artifact/CXnVC72FxdpW9UhXbutoep. Lis-le avec l'outil Artifact (`action: "read"`) et récupère ses fichiers et ses tokens.

## Le design et la spec
- **Le design décide de l'apparence et de l'organisation des écrans** : squelette, écrans, composants, tokens Transurb, thèmes clair et sombre, états. Il remplace le « look and feel » Xray Editor cité dans SPEC §13. Les composants de Xray Editor sont repris pour leur comportement, puis habillés au design.
- **SPEC décide du comportement.** Un écran ou une fonction du design absent de SPEC (palette de commandes, import CSV, premier lancement, diagnostic, réglages…) s'implémente comme une commande du registre, puis s'ajoute à SPEC §13 dans la même vague.
- En cas de conflit de comportement, SPEC gagne, et l'écart est noté.
- Les deux thèmes sont livrés, tokens en `:root`, choix suivant le système avec un bouton de bascule.

## Règles qui ne bougent pas
- **Aucune écriture dans un projet Jira** (LFRPS12, BHPTCC ou autre). Les appels en réel sont en lecture seule. Une écriture se prouve par un test unitaire sur un faux `http` qui vérifie la requête exacte.
- On ne modifie jamais `D:\Projects\XrayEditor` ni un original de document. On copie.
- `npm` et `npx` se lancent depuis l'outil Bash. Les fichiers TypeScript s'écrivent avec Write/Edit, jamais avec un heredoc.
- Les essais réels de Claude restent sobres : `claude -p "reply ok"` pour vérifier l'enveloppe, plus un seul essai de bout en bout à la fin.
- Cache des modèles dans `.models/`, données d'essai dans `.sandbox/`, journal de construction dans `.build/`. Les trois vont dans `.gitignore`.
- Pas de git.

## Tests dans le navigateur : Claude in Chrome
Les vérifications visuelles et interactives de `testimus serve` se font avec **Claude in Chrome** (outils `mcp__claude-in-chrome__*`). Charge-les en un seul ToolSearch : `tabs_context_mcp`, `tabs_create_mcp`, `navigate`, `computer`, `read_page`, `find`, `form_input`, `get_page_text`, `read_console_messages`, `read_network_requests`, `resize_window`.
- Un seul pilote à la fois : l'orchestrateur, ou l'agent J quand c'est son tour. Jamais deux agents dans Chrome en même temps.
- Pour chaque écran du design :
  - le parcourir en clair et en sombre ;
  - le comparer à l'artifact, avec captures ;
  - vérifier que la console n'a pas d'erreur ;
  - jouer les états (vide, chargement, Claude en cours, Claude absent, erreur Jira, modifié par Claude, modifié dans Jira).
- Les tests Playwright restent la preuve automatique (`serve --mock`). Chrome est la preuve à l'œil.

## Orchestration
Tu es l'orchestrateur. Tu lances les sous-agents (outil Agent, general-purpose, en arrière-plan quand ils sont indépendants). Tu n'écris toi-même que les fichiers partagés : `package.json`, la config, `src/core/types.ts`, l'index du registre, les tokens du design, `ROADMAP.md`, `SPEC.md`, `CLAUDE.md`.
Chaque agent possède une liste de fichiers. Il ne touche à rien d'autre. Ce dont il a besoin ailleurs, il le demande dans son rapport.

**Vague 0 — toi, séquentiel.**
- Le squelette selon SPEC §1 et `CLAUDE.md` (versions, Biome, TypeScript sans enum ni namespace), toutes les dépendances installées en une fois.
- Le registre des commandes et les trois façades vides (CLI, MCP, HTTP + SSE).
- `src/core/types.ts`, avec `Step.fields` générique, les sources, la relecture, `Document` et `Job`.
- Les tokens et le squelette d'interface tirés de l'artifact : rail, zone principale, dock, thèmes.
- Un `serve --mock` minimal.

Ce sont les contrats que tout le reste utilise.

**Vague 1 — en parallèle.**
- A : `testfile` / `table` / `adf` portés, champs génériques, `### Sources`, état de relecture, tests de round-trip.
- B : `jira` / `sync` portés, `xray.fields`, préférences de `xray.json`, `xray.importCsv` dans les modes local et direct (fixture `tests/fixtures/csv/`), le mock Jira.
- C : interface portée et habillée au design (shell, éditeur de test, cartes de step, vocabulaire `ui`, palette de commandes, notifications), champs pris dans `xray.json`, client `/api`.
- D : `docs.add` / `docs.convert` (docx → `doc.md` avec ancres stables et figures, PDF en repli), `doc.json`.
- E : `rag.index` / `search` / `passage` / `figure` / `eval`, modèles en profils, en travaillant sur un `doc.md` de fixture au format de SPEC §4.
- F : le lanceur `claude -p` (stream-json, snapshot et retour arrière, diagnostic d'erreur), `chat.ask`, la façade MCP complète, `project.init` + `templates/project/`.
- K : `system.setup` / `system.doctor` / `version` / `pullModel`, plus `npm run release` et `install.ps1` (SPEC §14).

**Vague 2 — en parallèle, une fois la vague 1 finie.**
- G : `gen.tests` (job + skill `generate-tests`) et `tests.addImage`.
- H : `check.run` (passe mécanique + skill `check-test`), `check.record`, `review.set` / `fix` / `queue`, labels de relecture au push.
- I : tous les écrans du design branchés : Review, Tests, Generate, Documents, Import CSV, Jobs, Premier lancement / Diagnostic, Settings, et le dock Claude partout.
- J : e2e Playwright sur tout le parcours, contre `serve --mock`.

**Vague 3 — toi.**
1. Intégration et barre de vérification complète.
2. Revue dans Chrome de chaque écran, en clair et en sombre, contre l'artifact. Les écarts sont corrigés.
3. Vérifications réelles en lecture seule :
   - lire les champs de step de LFRPS12 (« Exigence » est-il un champ personnalisé ? Mets à jour SPEC et le skill `xray-cloud-api`) ;
   - un pull d'un test LFRPS12.
4. Un essai de bout en bout dans `.sandbox/`, piloté dans Chrome :
   - copie de `SOSIE_211_D401-1_3_01.01.docx` (chemin dans `LINKS.md`) ;
   - conversion et indexation ;
   - génération d'un test sur le sectionneur (§5.6.6, `EXI_MOP_SPF_511_A_1650` à `1680`) ;
   - check, relecture (To fix → Ask Claude to fix it → Validate) ;
   - plan de push affiché mais **non exécuté**.
5. Release et installation : `npm run release`, puis `install.ps1` sur un compte propre si Windows Sandbox est disponible. Sinon, une installation dans un dossier neuf, et la limite est notée.
6. Un agent de revue contradictoire, qui reçoit le code, SPEC et l'artifact mais pas tes conclusions.
7. Corrections, puis nouvelle vérification complète et nouvelle passe Chrome.

SPEC est mis à jour dans la même vague que chaque écart de comportement.

## Brief de chaque sous-agent
Chaque brief contient :
- l'objectif ;
- les fichiers possédés ;
- les sections de SPEC et de `LINKS.md` à lire, et l'URL de l'artifact pour un agent d'interface ;
- le skill à suivre (`port-from-xray-editor`, `docx-ingest`, `rag-eval`, `xray-cloud-api`) ;
- ce que « fini » veut dire (les tests qui doivent passer) ;
- « ne pose aucune question : tranche, note, continue » ;
- le bloc de reprise ci-dessous, recopié tel quel.

> **Reprise après interruption — obligatoire.** La session peut être arrêtée et relancée à n'importe quel moment, y compris au milieu de ton travail. Tu ne te souviens de rien d'une exécution précédente : la vérité, c'est ton journal et le code.
> 1. Au démarrage, lis `.build/agents/<ton-nom>.md` s'il existe, puis tes fichiers, puis lance tes tests. Déduis-en où tu en es. Ne refais jamais une étape dont le résultat existe et passe ses tests.
> 2. Avance par petites étapes vérifiables. Après chacune, ajoute à ton journal : l'étape, les fichiers touchés, l'état des tests, la prochaine étape.
> 3. Écris des fichiers entiers et cohérents, de façon idempotente. Rejouer une étape doit donner le même résultat. Un fichier de ton périmètre à moitié écrit (qui ne compile pas, ou qui casse un test) se répare ou se réécrit en premier.
> 4. Ne modifie jamais un fichier hors de ton périmètre, même pour « réparer ». Note-le en `BESOIN:` dans ton journal.
> 5. Termine ton journal par `DONE` et un résumé (ce qui marche, ce qui est vérifié, les écarts à SPEC et au design, les choix faits sans demander), ou par `BLOCKED: <raison précise>`.

## Ta propre reprise
- Tu tiens `.build/state.md` à jour à chaque changement : la vague en cours, chaque agent (nom, périmètre, statut), les décisions prises sans demander et les besoins en attente.
- Au démarrage, lis `state.md` et les journaux des agents, avant de lancer quoi que ce soit.
- Un agent qui n'est pas `DONE` est relancé avec le même brief plus « reprends ».
- Un agent `DONE` est contrôlé en relançant ses tests, jamais en le croyant sur parole.
- Les `BESOIN:` sont traités avant la vague suivante.

## Fin
- Coche `ROADMAP.md`.
- Mets `CLAUDE.md` à jour : les commandes réelles, et retire « specification only ».
- Supprime `.build/`.
- Réponds en français :
  - ce qui fonctionne, et comment tu l'as vérifié (tests, Chrome, essai de bout en bout) ;
  - le test généré par l'essai et ses anomalies ;
  - les écarts à SPEC et au design, et leur raison ;
  - toutes les décisions prises sans demander ;
  - ce qui reste à faire pour la v2.
