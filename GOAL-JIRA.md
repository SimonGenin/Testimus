# Goal — Jira dans l'éditeur : en-tête, Details, statut, assignee, commentaires, filtre par personne

## Le design

Canevas « Testimus — test head & Jira » : https://claude.ai/artifact/3ixGp2HXDjRM4BqSRfzKoW (lire avec l'outil
Artifact, `action: "read"`, puis les fichiers `project/*.dc.html`). Sept planches : l'éditeur (Main), Details et
son historique (History), les commentaires (Comments), le statut (Status), l'assignee (Assignee), les cas limites
(Local), la liste filtrée par personne (List). Le canevas dessine avec les jetons actuels ; le code n'utilise que
le kit et `tokens.stylex.ts`.

## Ce qui change pour l'utilisateur

1. **L'en-tête** (`SummaryCard`) ne garde que la clé, le titre et les badges Testimus (revue, généré, sync). À
   droite : le statut Jira (bouton + menu des transitions), l'assignee (avatar + menu avec recherche), le nombre de
   commentaires (descend jusqu'à la carte). Le badge de statut informatif disparaît des badges.
2. **Une carte « Details »** à part, entre l'en-tête et les étapes, faite comme une étape : tête (carré d'icône,
   titre, marques, repli), corps = les champs de `TestDetails` d'aujourd'hui. Repliée, une ligne résume (labels,
   covers, début de la description). **Historique comme les étapes** : `WasToggle` « Jira version » (la copie de
   la dernière synchro) et « Before Claude » (avant la passe de Claude), le cadre de l'ancienne version ne montre
   que les champs qui diffèrent, la description en diff mot à mot, un bouton pour reprendre l'ancienne version. Les
   contextes Claude n'ont pas de version Jira.
3. **Statut** : le menu liste les transitions que le workflow Jira autorise depuis le statut courant, chacune
   avec son statut d'arrivée. Le choix part tout de suite dans Jira (pas au push), un toast confirme, avec
   « Undo » seulement si une transition ramène au statut d'avant.
4. **Assignee** : menu avec recherche (personnes assignables sur l'issue), « Assign to me » / « Unassigned ».
   Part tout de suite dans Jira.
5. **Commentaires** : carte en bas de l'éditeur. Lire, écrire (Ctrl+Entrée), modifier et supprimer les siens
   (suppression confirmée). Refus de Jira : le texte reste, « Try again ».
6. **Filtre par personne** dans la liste locale : contrôle « Assignee » (Me, Unassigned, chaque personne, avec
   leur nombre), plusieurs cochables ; même chose tapé : `assignee:me`, `assignee:none`, `assignee:camille`.
   L'avatar de l'assignee sur chaque ligne.
7. **Cas limites** : test local (pas de clé) → pas de contrôles Jira, « Push to Jira… » ; Jira non connecté →
   statut et assignee de la dernière synchro en lecture seule, « Connect Jira… ».

## Phases

### J1 — Les données (lecture seule)

- `Test` gagne `assignee?: { accountId: string; name: string }`, front-matter `assignee:` dans `test.md`
  (`src/core/lib/testfile.ts`, comme `status` : écrit par le pull, jamais poussé, jamais dans le diff de sync).
- `pullTest` (`src/core/lib/jira/read.ts`) lit aussi `assignee` (et `updated` pour « Updated in Jira … »).
  `GET_TESTS` ajoute `"assignee"` aux champs `jira(...)` pour que la liste distante le porte.
- Le mock Jira (`src/core/mock/jira.ts`, `jira/state.ts`) : chaque `MTest` gagne `assignee`, `comments[]`, et
  un petit workflow (To Do → In Progress → Done, + Blocked) ; `issueJson` renvoie `assignee`. La fixture
  `tests/fixtures/project/` reçoit des assignees variés (dont MOCK_ME) pour le filtre.

### J2 — Les commandes (un nouveau groupe `issue`, `src/core/commands/issue.ts`)

Chaque commande : zod avec `.describe()` partout, donc CLI, MCP et HTTP d'un coup. Chaque écriture accepte
`--dry-run` et rend son plan (`{ key, from, to }`), comme `xray.plan`.

| Commande | Jira REST v3 | Notes |
|---|---|---|
| `issue.transitions {key}` | `GET /issue/{key}/transitions` | nom, id, statut d'arrivée (+ catégorie pour la teinte) |
| `issue.transition {key, transition, dryRun}` | `POST /issue/{key}/transitions` | puis réécrit `status` dans `test.md` et `.remote.md` |
| `issue.people {key, query}` | `GET /user/assignable/search?issueKey=&query=` | lecture tapée lettre par lettre : `withSignal` |
| `issue.assign {key, accountId \| "me" \| null, dryRun}` | `PUT /issue/{key}/assignee` | « me » via `getMyself` ; réécrit `assignee` |
| `issue.comments {key}` | `GET /issue/{key}/comment` | ADF → texte (`lib/adf.ts`), auteur, date, `mine` |
| `issue.comment {key, text, dryRun}` | `POST /issue/{key}/comment` | texte → ADF |
| `issue.editComment {key, id, text, dryRun}` | `PUT /issue/{key}/comment/{id}` | seulement les siens |
| `issue.deleteComment {key, id, dryRun}` | `DELETE /issue/{key}/comment/{id}` | seulement les siens |

- Un 403 devient une `UserError` lisible (« you can't comment on LFRPS12-412 — Add Comments permission »), avec
  `fix`. `jiraFetch` jette aujourd'hui un message générique sur 401/403 : distinguer le 403 de permission.
- Le statut et l'assignee réécrits localement après succès gardent le test « In sync » (le `changed` du watcher
  rafraîchit la page).
- Accès de Claude (`src/core/claude/access.ts`) : les lectures (`issue.transitions`, `issue.people`,
  `issue.comments`) permises, **les écritures non**, comme `xray.push`.
- Le mock répond à chaque route ; il refuse une transition absente du workflow et la modif d'un commentaire d'un
  autre (comme Jira).

### J3 — Le filtre

- `src/core/search/query.ts` : clé `assignee` (valeurs `me`, `none`, ou un mot comparé au nom avec les règles de
  `match` : accents, préfixes). `me` se résout avec `getMyself` (en cache) ; hors connexion, `me` = le dernier
  compte connu (à garder dans le profil de connexion).
- Le corpus des tests (`src/core/search/tests` ou équivalent) porte l'assignee ; `tests.list` le rend pour les
  lignes et pour les comptes du menu.

### J4 — L'interface

- Kit (`src/ui/components/ui/`) : **Avatar** (initiales, teinte stable par compte, variante « personne » en
  pointillés) — nouveau composant, dans le catalogue `#/kit`. Le reste existe : `Menu`, `Popover`, `Badge`
  (`jiraStatus` à étendre avec la catégorie Jira pour la teinte), `Text` multiline, `Toast`, `Card`.
- `screens/tests/editor/` : `SummaryCard` allégé + `JiraControls` (statut, assignee, compteur) ; `DetailsCard`
  (reprend `TestDetails`, tête façon `StepHead`, repli dans les préférences) ; `DetailsWas` (le cadre de
  l'ancienne version, mêmes couleurs que `WasView`) ; `CommentsCard`.
- « Before Claude » pour Details : étendre ce que `lib/diff.ts` fait pour les étapes (`RunDiff`) aux champs du
  test (summary exclu, il reste dans l'en-tête).
- Liste : `ListTools` gagne le contrôle « Assignee » (écrit `assignee:` dans la requête, comme le reste des
  filtres) ; `rows.tsx` l'avatar.
- Toutes les lectures par `useRead`, les écritures par `useCommand` ; le plan (from → to) vient du `--dry-run`.

### J5 — Preuves

- Unitaires : chaque commande sur le faux `http`, écritures comprises (jamais LFRPS12 ni BHPTCC en écriture) ;
  `query.ts` pour `assignee:` ; le mock ; les gardes d'architecture à zéro.
- Vérification **en lecture seule** sur un vrai projet des trois GET (transitions, assignable search, comments) :
  consigner les formes de réponse dans le skill `xray-cloud-api`.
- e2e sur `serve --mock` : transition, assignation, commentaire (écrire, modifier, supprimer, refus), filtre
  `assignee:me`, Details replié/déplié, « Jira version ».
- `npm run screens` : nouvelles captures (en-tête, Details avec historique, commentaires, menus, liste filtrée),
  clair et sombre.
- `ROADMAP.md` et `PARITY.md` à jour.

## Décisions (validées par Simon le 2026-11-05)

1. **Statut, assignee et commentaires partent tout de suite dans Jira**, pas avec le push (comme dans Jira).
   Le menu montre d'où on part et où on arrive avant le clic ; la commande garde son `--dry-run`.
2. **Claude lit les commentaires et rédige, l'humain envoie.** Claude ne poste, ne modifie ni ne supprime jamais
   un commentaire (les écritures `issue.*` restent hors de son accès). Il peut rédiger une réponse : bouton
   « Draft with Claude » dans le composeur de la carte Commentaires, qui lance une commande
   `claude.draftComment {key, ask?}` (lit le test, ses commentaires, les sources ; rend un texte, n'écrit rien
   dans Jira). Le brouillon arrive dans le composeur, marqué « Drafted by Claude » jusqu'à ce qu'on le modifie ;
   l'humain l'envoie avec « Comment ». Le skill correspondant va dans `templates/project/.claude/skills/`
   (produit), le mock Claude gagne un brouillon scripté.
3. **Les @mentions sont dans cette passe.** Taper `@` dans le composeur ouvre le menu des personnes (la même
   recherche qu'`issue.people`) ; la mention s'affiche comme une puce dans le texte. Dans le texte manipulé par
   les commandes, une mention s'écrit `@[Camille Martin](accountId)` ; `lib/adf.ts` la convertit en nœud ADF
   `mention` (`attrs: { id, text: "@Camille Martin" }`) à l'envoi et la relit à la lecture — Jira notifie la
   personne. Un brouillon de Claude peut contenir des mentions (il connaît les comptes par `issue.people`). Tests :
   aller-retour ADF ↔ texte avec mentions, le mock garde les nœuds `mention`.
4. **L'assignee vit dans `test.md`** comme le statut : copie de Jira, réécrite au pull et après chaque
   assignation, jamais poussée. Le filtre marche hors ligne.

Ces décisions s'ajoutent aux phases : la 2 à J2 (commande `claude.draftComment`, accès Claude) et à J4 (bouton du
composeur), la 3 à J2 (`lib/adf.ts`, `issue.comment*`) et à J4 (menu `@` du composeur, puce de mention). Planche
« Comments — Claude drafts, @mentions » (`Draft.dc.html`) : le bouton, la demande facultative avec ses quick asks,
le brouillon en cours (Stop), le brouillon arrivé (« Drafted by Claude », Redo, Discard), le menu `@`, le
commentaire posté. Une fois envoyé, le commentaire est celui de l'humain : rien ne dit dans Jira qu'il vient d'un
brouillon de Claude. Le composeur n'est donc plus un `<textarea>` mais un champ qui sait porter des puces : une
option du `Text` du kit (comme les puces de `ChipField`), pas un champ à part.
