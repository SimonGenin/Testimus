# Les runs Testimus et les exécutions Xray — point de départ

Note du 2026-11-10. **Rien de ce qui suit n'est construit.** C'est le point de départ d'une future session : ce qu'on
sait, vérifié en lecture seule sur le Jira réel (LFRPS12 et BHPTCC) et dans le schéma GraphQL d'Xray, et ce qui reste à
décider. La page Run actuelle est une première version simple qui peut changer du tout au tout ; ce plan ne dépend pas
d'elle. Quand une décision est prise, elle va dans ARCHITECTURE.md (§9b, §9 Jira) et la tâche dans ROADMAP.md (§6) ;
ce fichier peut alors disparaître.

La question : peut-on relier un run Testimus (`test-runs/<run>/`) aux exécutions de tests Xray dans Jira ? **Oui** :
les deux modèles se correspondent presque terme à terme, et l'API Xray Cloud a tout ce qu'il faut, étape par étape.
Les vraies difficultés sont les statuts (l'équipe en utilise beaucoup plus que nos quatre) et la façon dont l'équipe
se sert du champ « Actual result ».

## 1. Ce que dit le code aujourd'hui

- Un run est un dossier du projet (ARCHITECTURE.md §9b) : `run.json` (les tests **figés** à la création :
  `id`, `key?`, `folder?`, `summary`, `description?`, `preconditions`, `steps: [{ fields, images, sources? }]`) et
  `results/<testId>.json` (`status: not-run | passed | problem | blocked`, `steps: [{ ok, note? }]`, `blockedReason?`,
  `comments` (commentaires et questions, avec réponses), `attachments` (captures par étape), `history`).
- Commandes : groupe `runs` (`src/core/commands/runs.ts`, schémas dans `runs-schemas.ts`). Création :
  `freezeTest` dans `src/core/lib/run-create.ts`. Import des pages HTML : `src/core/lib/run-import.ts` (le plus récent
  gagne, l'ancien va dans `history`, un plan avant d'écrire) — la même logique servira pour relire Xray.
- **Manque pour Xray : l'id d'étape.** Un test local garde l'id de chaque étape Xray (`## Step 1 <!-- 201 -->` dans
  `test.md`, lu par `src/core/lib/jira/steps.ts` `readStep` → `Step.id`), mais `freezeTest` ne le recopie pas : le
  `RunStep` figé n'a que `fields`, `images`, `sources`. Il faudra l'ajouter (`RunStep.id?`), sans quoi on ne sait
  pas sur quelle étape Xray poser un OK / NOK.
- Rien dans `src/core/lib/jira/` ne lit ni n'écrit d'exécution aujourd'hui (tests, étapes, dossiers, préconditions
  seulement).

## 2. Ce que fait Xray (vérifié)

### 2.1 Les objets

- **Test Execution** : un ticket Jira (type `Test Execution`, id 10938 dans les deux projets ; il existe aussi
  `Sub Test Execution`, 10940, et `Test Plan`, 10937). Il contient des **Test Runs**, un par test. Il peut être relié à
  des Test Plans, avoir une Fix Version et des environnements de test.
- **Test Run** : `id` (une chaîne, ex. `6a85ac134008f25a7be5d735`), `status { name }`, `comment`, `startedOn`,
  `finishedOn`, `executedById`, `assigneeId`, `defects` (ids d'issues), `evidence`, `steps`, `testVersion`, `test`,
  `testExecution`, `customFields`, `activity` (l'historique champ par champ).
- **Étape d'un run** (`TestRunStep`) : `id`, `status { name }`, `action`, `data`, `result`, `customFields`,
  `comment`, `actualResult`, `evidence`, `attachments`, `defects`.

### 2.2 Le run est une copie figée, comme chez nous — vérifié

Sur 113 runs de trois exécutions LFRPS12 (LFRPS12-1468, -1449, -1238), comparés aux tests tels qu'ils sont
aujourd'hui :

- **Les ids d'étape du run sont ceux du test** : 868 étapes sur 869 ont le même id que l'étape du test (la dernière
  a été supprimée du test depuis). C'est ce qui permet de viser une étape précise.
- **Le texte est figé** : 59 étapes ont un texte différent de celui du test aujourd'hui (ex. LFRPS12-290 : le run dit
  « Modifier l'état du signal… », le test dit maintenant « Localiser un signal… », modifié deux jours après le run).
  2 runs n'ont pas le même nombre d'étapes que leur test.
- Tous les runs pointent la version `v1` (par défaut) du test : le versionnement des tests Xray n'est pas utilisé
  dans ces projets.

Conséquence : un test Testimus figé ne correspond à son run Xray que si les deux ont été figés sur la même version.
Il faut comparer les étapes (id et texte) avant d'envoyer un résultat, et le dire quand elles diffèrent.

### 2.3 Les statuts des projets — vérifié, identiques dans LFRPS12 et BHPTCC

Statuts d'un run (`getStatuses`) — nom, « final », couverture :

| Statut | Final | Couverture |
|---|---|---|
| PASSED | oui | OK |
| TO DO | non | NOTRUN |
| EXECUTING | non | NOTRUN |
| FAILED | oui | NOK |
| BLOCKED | non | NOK |
| PARTIAL | non | NOK |
| wish (passé, avec un petit souhait) | oui | OK |
| Waiting_for_input | non | UNKNOWN |
| POSTPONED | non | NOTRUN |
| To_Rewrite (le test est à réécrire) | non | NOTRUN |

Statuts d'une étape (`getStepStatuses`) : PASSED, TODO, EXECUTING, FAILED, Blocked, Partial, wish,
Waiting_for_input, Postponed, To_Rewrite, NOT_APPLICABLE (« pas encore applicable, ne bloque pas le résultat »).
Attention à la casse : `BLOCKED` pour un run, `Blocked` pour une étape ; `TO DO` (avec espace) pour un run, `TODO`
pour une étape.

### 2.4 Comment l'équipe s'en sert vraiment — vérifié

113 runs LFRPS12 (3 exécutions), 41 runs BHPTCC (3 exécutions) :

- **Les statuts « en plus » servent** : LFRPS12 — PASSED 72, PARTIAL 9, FAILED 9, POSTPONED 4, To_Rewrite 3,
  Waiting_for_input 2, wish 1. Étapes : PASSED 759, Partial 43, FAILED 29, NOT_APPLICABLE 13, Postponed 9, TODO 7,
  To_Rewrite 4, Waiting_for_input 4. BHPTCC pareil (PARTIAL, To_Rewrite, Waiting_for_input, BLOCKED, wish).
- **Le commentaire du run et le commentaire d'étape ne servent jamais** (0 sur 154 runs, 0 sur ~1 300 étapes).
- **« Actual result » sert à tout** (145 étapes LFRPS12, 44 BHPTCC) : ce qu'on a observé, mais aussi **les
  questions** (« Pas encore dev ? », « Pas disponible ? », « Ce n'est pas le cas, est-ce un problème ? ») et parfois la
  réponse écrite à la suite (« greg : on ne sait pas encore faire les itinéraires… »), et le lien vers un bug.
- **Les bugs sont reliés à l'étape** (26 étapes LFRPS12 avec un `defect`, jamais au run entier). Types acceptés comme
  défaut : Bug (10004) et Problem (10103) sur LFRPS12, Bug seul sur BHPTCC (`getProjectSettings.defectIssueTypes`).
- **Les captures sont des « evidence » d'étape** (20 étapes LFRPS12, 6 BHPTCC), jamais sur le run.
- `startedOn`, `finishedOn`, `executedById` sont remplis sur tous les runs. Le minuteur (`timer`) sert. L'activité
  montre des « Merged Execution » (Xray fusionne des exécutions).
- Aucun champ personnalisé de run, aucun environnement de test dans ces projets. 25 exécutions et 9 Test Plans dans
  LFRPS12, 90 exécutions et 14 Test Plans dans BHPTCC.

### 2.5 L'API — vérifiée par introspection du schéma GraphQL

Lectures :

- `getTestExecutions(jql, projectId, limit ≤ 100, start)`, `getTestExecution(issueId)` → `testRuns`, `tests`,
  `testPlans`, `testEnvironments`, `jira(fields: […])`.
- `getTestRuns(testIssueIds, testExecIssueIds, testRunAssignees, statuses, testPlanIssueIds, limit, start,
  modifiedSince)`, `getTestRun(testIssueId, testExecIssueId)`, `getTestRunById(id)`.
- `getStatuses(projectId)`, `getStepStatuses(projectId)`, `getProjectSettings(projectIdOrKey)` (défauts,
  champs de run).
- `getTestPlans` / `getTestPlan`.

Écritures (vues dans le schéma, **jamais lancées**) :

- `createTestExecution(testIssueIds | tests: [{ issueId, versionId }], testEnvironments, jira: JSON!)` → le ticket ;
  `addTestsToTestExecution`, `removeTestsFromTestExecution`, `addTestExecutionsToTestPlan`.
- Run : `updateTestRunStatus(id, status)`, `updateTestRun(id, comment, startedOn, finishedOn, assigneeId,
  executedById, customFields)`, `updateTestRunComment`, `addDefectsToTestRun`, `addEvidenceToTestRun`,
  `resetTestRun`, `setTestRunTimer`.
- Étape : **`updateTestRunStep(testRunId, stepId, updateData: { status, comment, actualResult, evidence: { add,
  removeIds, removeFilenames }, defects: { add, remove } })`** — tout en un appel ; ou séparément
  `updateTestRunStepStatus`, `updateTestRunStepComment`, `addEvidenceToTestRunStep`, `addDefectsToTestRunStep`.
- Une capture s'envoie en `AttachmentDataInput { filename, mimeType, data (base64) }`.

Import en un coup (REST, documenté, pas essayé) : `POST /api/v2/import/execution` (format JSON Xray :
`testExecutionKey` **ou** `info { project, summary, description, version, revision, user, startDate, finishDate,
testPlanKey, testEnvironments }`, puis `tests: [{ testKey, status, comment, start, finish, executedBy, defects,
evidence, steps: [{ status, comment, actualResult, evidence, defects }] }]`), et une variante
`/api/v2/import/execution/multipart`. La documentation **ne dit pas** comment les étapes sont appariées (par ordre,
semble-t-il), ni si un run existant est écrasé ou fusionné. Pour cette raison, on préfère les mutations GraphQL
étape par étape, par id : précises, et rejouables sans effet de bord.

### 2.6 Comment ces vérifications ont été faites

Lecture seule, depuis des scripts jetables (pas dans le dépôt) : jeton Xray via `POST /api/v2/authenticate` avec
`clientId` / `clientSecret` de `~/.atlassian/xray_credentials.json` (les clés s'appellent ainsi, pas `client_id`),
puis `POST /api/v2/graphql`. Jira REST avec `~/.atlassian/credentials.json` — **son `baseUrl` finit par `/wiki`**
(Confluence) : pour Jira, utiliser `https://transurb.atlassian.net` sans `/wiki`. Depuis le Bash de Git sur Windows,
un chemin d'URL qui commence par `/` passé en argument est réécrit en chemin Windows : mettre
`MSYS_NO_PATHCONV=1`. Ids des projets : LFRPS12 = 12445, BHPTCC = 11987.

## 3. La correspondance proposée

| Testimus | Xray |
|---|---|
| Un run | Une Test Execution (sa clé gardée dans `run.json`, ex. `xray: { execution: "LFRPS12-1468" }`) |
| Un test figé (avec `key`) | Le Test Run de ce test dans l'exécution |
| Un test figé sans `key` | Rien : il ne peut pas partir (le dire, proposer de le pousser d'abord) |
| Une étape figée | L'étape du run, **par son id** (à ajouter au `RunStep`) |
| OK / NOK / pas marquée | PASSED / FAILED / TODO |
| La note d'une étape | `actualResult` (c'est là que l'équipe écrit, pas `comment`) |
| Une capture d'une étape | `evidence` de l'étape |
| Un bug rédigé depuis un NOK | Un vrai ticket Bug, relié à l'étape (`defects.add`) |
| Passed / Problem / Not run | PASSED / FAILED / TO DO (EXECUTING si des étapes sont marquées) |
| Blocked + sa raison | BLOCKED (+ la raison dans `actualResult` de l'étape, ou le commentaire du run) |
| Une question (et sa réponse) | Rien d'équivalent ; l'équipe les écrit dans `actualResult` |
| `updatedAt` / `updatedBy` | `finishedOn` / `executedById` (il faut l'accountId Jira de la personne) |
| `runs.history` | `getTestRuns(testIssueIds: […])` : le test dans toutes les exécutions |

## 4. Ce qu'il reste à décider

1. **Les statuts.** Nos quatre résultats ne couvrent pas ce que l'équipe utilise (PARTIAL, POSTPONED,
   Waiting_for_input, To_Rewrite, wish ; NOT_APPLICABLE sur une étape). Trois voies :
   (a) garder nos quatre et perdre le reste à l'aller comme au retour ;
   (b) **lire les statuts du projet Xray et les proposer tels quels** dans le run (couleurs comprises, `final` et
   `coverageStatus` disent comment les compter) — notre « passed / problem / blocked / not-run » devient la
   couverture, le statut affiché est celui de Xray ;
   (c) quelques statuts en plus, fixes. La (b) semble la bonne : aucun statut n'est spécial, comme les colonnes.
   Elle touche `RunStatus`, `marksStatus` (le résultat suit les marques), le script des pages exportées (`run.js`) et
   l'écran.
2. **Le sens.** (a) **Publier** un run vers Xray (`runs.publish`, un plan puis l'écriture) ; (b) **créer un run
   depuis** une Test Execution ou un Test Plan existant ; (c) **relire** les résultats saisis dans Xray (réutiliser la
   logique de `run-import.ts`). Proposition : (a) d'abord, puis (b) et (c).
3. **Nouvelle exécution ou exécution existante** : créer la Test Execution depuis le run (nom, Fix Version, Test Plan
   au choix), ou publier dans une exécution existante (ajouter les tests qui manquent).
4. **Les questions** : rester chez nous seulement, ou être recopiées dans `actualResult` (« Question : … — Réponse :
   … ») pour que l'équipe les voie dans Jira comme aujourd'hui.
5. **Écart de version** : un test modifié depuis la création du run (ou modifié en local, pas encore poussé). Refuser,
   avertir, ou publier quand même sur les étapes qui ont le même id et le même texte.
6. **Qui a exécuté** : `executedById` veut un accountId Jira ; nous avons le nom d'utilisateur du système. Une
   correspondance est à prévoir (Testimus connaît déjà des comptes Jira pour l'assignee).
7. **Le Test Plan, la Fix Version, l'environnement** : à porter par le run (champs facultatifs à la création).

## 5. Les règles qui s'appliquent

- **Une écriture Jira est un plan d'abord** (`--dry-run`, le plan montré avant d'agir) — comme `xray.push`.
- **Jamais d'écriture vers LFRPS12 ou BHPTCC pendant le développement.** Les écritures se prouvent par des tests
  unitaires sur un faux `http` qui vérifie les requêtes exactes ; les vérifications en direct sont en lecture seule.
  Un essai d'écriture réel demande un **projet bac à sable** et l'accord de l'utilisateur dans le chat.
- Une capacité est une commande (`runs.publish`, `runs.pull`…) dans `src/core/commands/` : CLI, MCP et HTTP en
  découlent. Claude lit les runs mais ne les écrit pas (§9b) : `runs.publish` reste hors des runs Claude, comme les
  autres écritures de `runs.*`.
- Le skill `.claude/skills/xray-cloud-api/SKILL.md` gagnera une section « Exécutions » avec les faits du §2 une fois
  le travail commencé.

## 6. Premiers pas suggérés

1. Garder l'id d'étape dans le run figé (`RunStep.id`, `freezeTest`) — utile quoi qu'on décide.
2. Lire les statuts du projet (`getStatuses`, `getStepStatuses`) et les ranger dans la config du projet ou un cache.
3. `runs.publish { run, execution? , dryRun }` : le plan (exécution créée ou visée, tests ajoutés, étapes qui
   changent, captures, bugs, écarts de version), puis les mutations GraphQL une à une, arrêt au premier échec, comme le
   push des tests (`src/core/lib/jira/push.ts`, `src/core/lib/sync/push.ts`).
4. Puis la lecture : `runs.create` depuis une exécution, et la relecture des résultats.
