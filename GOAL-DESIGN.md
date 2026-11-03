# Goal — Testimus : le nouveau design system, de zéro

## Lancement

Ce document est le brief de la **session design**. Elle est lancée avec `/design` et la ligne de « Ligne de
lancement » en bas de ce fichier, en même temps que l'implémenteur. Elle produit **seulement du design**, sans jamais toucher au code.

**Elle tourne en même temps que l'implémenteur** (`GOAL-V3.md`, lancé avec `/goal`). Pendant que tu dessines, il
réécrit le cœur de l'application (commandes, données, sous-processus), qui ne dépend pas du design. Ensuite, il
attend ton signal pour construire le kit et les écrans à partir de ce que tu livres.
- **Tu n'écris que dans `design/`**, et l'implémenteur n'y écrit jamais. Ne touche à rien d'autre, même pour
  « réparer » : le code bouge sous tes pieds, sur une autre branche.
- **Le signal de fin** : quand tout `design/` est exporté et vérifié, écris **`design/READY.md` en tout dernier**
  (la date, la liste des livrables, les liens des artefacts). C'est ce fichier qui ouvre sa porte : ne l'écris pas
  avant. Puis envoie-lui un message (`SendMessage` à la session dont le titre contient « implémenteur » ou
  « GOAL-V3 » dans `ListAgents`) : « design prêt, voir design/READY.md ».
- **Ses questions** : avant ou après ton signal, l'implémenteur peut t'écrire (`SendMessage`). Réponds-lui, et si
  ta réponse change un livrable, mets le fichier à jour dans `design/` et dis-le-lui.
- **Les captures « avant »** (`dist/screens/`) : Simon les lance avant d'ouvrir les deux sessions. Si
  `dist/screens/manifest.json` manque, **ne lance pas l'outil toi-même** : c'est l'implémenteur qui le fait en
  premier. Commence par les jetons et le kit, et lis l'inventaire dès que le manifest est là (attends-le avec
  l'outil `Monitor` si tu en as besoin pour les écrans).

## Objectif

Aujourd'hui, l'interface est en désordre : le même contrôle a plusieurs apparences, les espacements et les
couleurs changent d'un écran à l'autre, et beaucoup de choses ont été faites vite. **Redéfinis le design system en
entier, de zéro.** Tu as tous les droits : la palette, la typographie, les espacements, les formes, la densité,
la mise en page des écrans. **Ne pars pas de ce qui existe.** Tu peux t'inspirer de deux ou trois choses qui
marchent (le dock Claude à droite partout, le rail à gauche, les badges de revue), mais les jetons, les
composants et les écrans sont neufs. L'ancien `src/ui/styles/tokens.css` n'est pas une référence.

Ce qu'on veut : un outil professionnel, beau et calme. On y passe des heures à relire des tests et des passages
de documents. Il doit donc être dense sans être serré, avoir une hiérarchie claire, et des couleurs qui ont un
sens (l'état d'une revue, la gravité d'un constat, ce que Claude a changé), et pas de la décoration.

C'est fini quand :
1. l'artefact **Design System** existe : jetons (couleurs clair et sombre, typographie, espacements, rayons,
   ombres, mouvement), chaque composant du kit avec un aperçu vivant de **chacun de ses états et de chacune de ses
   options**, et les règles d'usage ;
2. un artefact **Design** existe pour chaque écran de « Écrans à couvrir », avec chacun de ses états, en clair et
   en sombre, aux trois tailles de l'outil de captures (lg 1920×1080, md 1366×768, sm 1024×768) ;
3. tout est **exporté en fichiers locaux** dans `design/` (voir « Livrables »), et c'est la seule chose que
   l'implémenteur lira ;
4. chaque capacité de `PARITY.md` a sa place dans une maquette, ou une ligne dans `design/PARITY-GAPS.md` qui dit
   où elle va ;
5. `design/README.md` résume les choix, liste les livrables et les liens des artefacts.
6. `design/READY.md` est écrit en dernier, et l'implémenteur a reçu le message « design prêt ».

## À lire avant tout

- `CLAUDE.md` (ce que fait Testimus, ses règles) et `SPEC.md` §13 (UI : chaque écran, chaque état, chaque
  comportement attendu).
- `PARITY.md` : chaque capacité que l'utilisateur voit ou fait. **Rien ne doit disparaître**. Une capacité peut
  changer de place ou de forme, mais elle doit exister.
- `GOAL-V3.md`, sections N2 (la liste du kit, le composant texte, le bloc Claude) et N5 (le catalogue) : ce que
  l'implémenteur construira à partir de ton travail.
- Les captures de l'état actuel (`dist/screens/`, voir « L'outil de captures ») : elles servent d'**inventaire**
  de ce qui existe (écrans, états, contenus), pas de modèle à suivre.

## Contraintes

- **Ne touche pas `src/`, `tests/` ni `scripts/`.** Tout ce que tu écris va dans `design/`.
- **Le kit, c'est un composant par contrôle, avec des options** (N2 de GOAL-V3). Dessine chaque contrôle **une
  seule fois** : bouton (primaire, secondaire, discret, danger, icône seule ; tailles), champ texte, zone de
  texte, select, case à cocher, interrupteur, choix segmenté, liste et élément de liste, menu, onglets, modale,
  confirmation, puce et champ à puces, badge, infobulle, toast, squelette de chargement, poignée de
  redimensionnement, tableau. Si deux écrans semblent avoir besoin de deux versions, c'est une option du même
  composant.
- **Le composant texte** : il grandit avec son contenu, se sauvegarde tout seul, et montre son état (enregistré,
  en cours, erreur avec une nouvelle tentative, conflit avec le disque, lecture seule pendant que Claude
  travaille). Dessine chacun de ces états.
- **Le bloc Claude** est construit sur le composant texte. Il apparaît dans le dock, dans « Ask Claude » sur un test
  ou une étape, dans la note « To fix » et dans les contextes additionnels. Ses options : contextes, quick asks,
  modèle et effort, pièces jointes, envoi par Entrée ou autosave. Dessine-le avec chaque combinaison utilisée.
- **Jetons** : des variables CSS aux noms **sémantiques et plats** (`--color-surface-raised`, `--color-text-muted`,
  `--color-status-validated`, `--space-3`, `--radius-2`, `--font-size-body`…). L'implémenteur les traduira en
  StyleX (`defineVars`, mêmes noms en camelCase) : pas de calcul, pas d'imbrication. Le sombre est un second jeu
  de valeurs pour les **mêmes** noms.
- **Contraste** : WCAG AA en clair et en sombre (4,5:1 pour le texte, 3:1 pour les contrôles et le focus). Le focus
  clavier est toujours visible.
- **Polices** : elles doivent pouvoir être livrées avec l'application, parce qu'elle tourne hors ligne et derrière
  un proxy (paquets `@fontsource` ou `@fontsource-variable`, licence OFL). Pas de Google Fonts au chargement. Tu
  peux changer les polices actuelles (Lexend, Source Sans 3, JetBrains Mono).
- **Pas de bibliothèque de composants** ni d'icônes qui imposerait sa dépendance. Les icônes sont des SVG simples,
  livrés dans `design/icons/`.
- **Textes de l'interface en anglais** (règle de CLAUDE.md). Les contenus montrés (tests, passages) peuvent être en
  français, comme les vrais projets.
- **L'application tourne dans une fenêtre Electron et dans un navigateur** : pas de barre de titre dessinée, et un
  écran utilisable dès 1024×768.

## Écrans à couvrir

Chacun avec ses états : vide, chargement, contenu normal, contenu très long, erreur, Claude absent ou déconnecté,
Jira non connecté, travail de Claude en cours.
- **Coque** : rail, barre du haut, dock Claude (replié, ouvert, en cours, résultat, erreur), palette Ctrl K,
  toasts, problèmes.
- **Premier lancement** : projet, accès, pack de modèles.
- **Documents** : liste, lecture d'un document (ancres, figures, sommaire), import, conversion, suppression.
- **Generate** : la demande, la portée (sections, exigences), le job en direct, le résultat.
- **Tests** : liste, éditeur (en-tête, détails, étapes empilées et en deux colonnes, champs, tableaux, images,
  sources), onglet Jira, plan de push, suppression.
- **Review** : file, test avec ses constats et le passage source, Validate / To fix, la note To fix.
- **Jobs** et **Doctor**.
- **Settings** : chaque section (projet, colonnes, Claude, accès, recherche, modèles, apparence).
- **Desktop** : l'écran de démarrage et la page d'erreur du shell Electron.
- **Le catalogue `#/kit`** : l'écran qui montre tout le kit (N5).

## Livrables (dans `design/`)

- `tokens.css` : tous les jetons, clair et sombre (`:root` et `[data-theme="dark"]`).
- `SYSTEM.md` : les principes, puis chaque composant (rôle, anatomie, options, états, règles d'usage, ce qu'il ne
  faut pas faire).
- `components.md` : la table « ce qui existe aujourd'hui → composant du kit et option » ; l'inventaire vient des
  captures actuelles et de `PARITY.md`.
- `screens/<area>/<scénario>/<capture>/index.html` : la maquette en HTML statique, qui n'utilise que
  `design/tokens.css` et `design/icons/` (un agent doit pouvoir la lire et la mesurer), plus
  `<taille>-<thème>.png`. `<area>`, `<scénario>` et `<capture>` sont **ceux de `dist/screens/manifest.json`**
  (par exemple `screens/tests/fixture/tests-editor/`), pour comparer avant, maquette et après terme à terme. Une
  capture de l'inventaire sans maquette est listée dans `README.md` avec sa raison (un état identique à un autre,
  par exemple).
- `icons/` : les icônes en SVG.
- `PARITY-GAPS.md` : chaque capacité de `PARITY.md` qu'une maquette ne montre pas, et où elle va.
- `SOURCES.md` : les liens des artefacts (Design System, et un Design par écran).
- `README.md` : les choix (palette, typographie, densité) et pourquoi, la liste des livrables.

## Méthode

1. Lis les documents de « À lire avant tout », puis l'inventaire des captures (`dist/screens/`, voir « Lancement »
   s'il manque).
2. Crée l'artefact Design System (`Artifact`, `action: "quickstart"`, puis le type « Design System ») : les
   jetons d'abord, puis le kit, composant par composant.
3. **Un seul point d'arrêt** : quand les jetons et les cinq composants principaux (bouton, composant texte, bloc
   Claude, liste, modale) existent, envoie les liens à Simon et attends son accord avant de dessiner les écrans.
   Après, ne pose plus de question : tranche, et note le choix dans `README.md`.
4. Un artefact Design par écran, avec tous ses états.
5. Exporte tout dans `design/` et vérifie chaque maquette HTML dans le navigateur, en clair et en sombre, à chacune
   des trois tailles, console sans erreur.
6. Écris `design/READY.md` en dernier, puis envoie le message à l'implémenteur (voir « Lancement »).
7. Reste disponible pour ses questions.

## L'outil de captures

`npm run screens` capture chaque écran et chaque état de l'application actuelle (175 captures, 16 scénarios :
données factices, projet vide, Claude absent, machines différentes, une copie du projet « Essai »…), en trois
tailles, en clair et en sombre. Sortie : `dist/screens/<scénario>/<capture>/<taille>-<thème>[-pN].png`, plus
`manifest.json` (zone, scénario, capture, note, erreurs console) et une galerie `index.html`. Les identifiants
`<scénario>/<capture>` sont stables. Le mode d'emploi complet est dans **`scripts/SCREENS.md`**.

## Ligne de lancement

```
/design Redéfinis de zéro le design system de Testimus et dessine tous ses écrans, en artefacts puis exportés dans design/. Fini quand les 6 points de « C'est fini quand » de GOAL-DESIGN.md sont vrais. Lis GOAL-DESIGN.md en entier avant de commencer.
```
