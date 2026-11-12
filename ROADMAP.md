# ROADMAP.md

Ce qui vient ensuite, regroupé par thème. Rien ici n'est construit tant que le code ne le dit pas. Le comment et le
pourquoi de l'existant sont dans ARCHITECTURE.md ; ce qui reste à prouver de l'existant est en fin d'ARCHITECTURE.md
(§16).

## 1. Génération

- [x] **Voir le test en cours d'écriture.** Pendant une génération, la page Génération montre le test que Claude est en
      train d'écrire : celui en cours est déplié, il se replie quand il est fini, et on peut déplier / replier ceux
      qu'on veut. Lecture seule, aucune édition. Uniquement sur la page Génération, pas en Review.
- [x] **Plus de refus au-delà de 15 pas.** Des tests ont été refusés parce qu'ils dépassaient 15 pas. Aucun prompt ne
      doit imposer une limite stricte : c'est au prompt de l'utilisateur d'en décider. On peut pousser vers 15 pas au
      plus, mais un test plus long est écrit quand même.
- [x] **Mieux expliquer les tests non écrits (skipped).** Dire un peu mieux pourquoi un test n'a pas été écrit, et
      ranger les refus par catégorie. Les catégories viennent de Claude, elles sont dynamiques (pas de liste en dur) :
      elles font donc partie des prompts et des outils (le bloc `gen-report`, ses `skipped`).
- [x] **Redemander des changements après une génération.** Une fois les tests générés, pouvoir demander des
      changements sur tous les tests et des ajouts. C'est déjà possible avec Claude, mais sur la page Génération la
      barre de gauche devient un Claude block avec des options pertinentes pour ces changements, et quelques Claude
      action buttons liés aux findings et aux skipped.
- [ ] **Un ordre documenté n'est pas une exigence.** Un manuel décrit une suite d'actions dans un ordre ; ça ne veut
      pas dire que le système l'impose. Un test tiré d'une procédure ne doit pas affirmer un ordre que la source ne
      fait que décrire : il le suit, mais le vérifier en tant qu'exigence demande une source qui le dit. Une règle dans
      `generate-tests` et `check-test`, et un motif de la vérification. *(Idée tirée de SRS Writing, règle W10.)*
- [ ] **Les questions au client, rassemblées.** Les tests non écrits disent déjà ce qui les débloquerait (`unblock` :
      un document à ajouter, une figure…). Les rassembler en une liste de questions au client, sans doublons, prête à
      envoyer et à suivre. Une question n'y entre que si un test en dépend. *(SRS Writing : le registre des questions
      au client.)*

## 2. Documents

- [x] **Les images deviennent des documents à part entière.** Ce ne sont plus des pièces jointes ni des annexes d'un
      autre document. Un document peut être un PDF, un Word, un `.txt`, une image, une vidéo… ou un ensemble d'images
      et de vidéos. Une image ou plusieurs images forment un document, comme un document est un ensemble de sections,
      et comme une vidéo est elle-même un ensemble d'images.
      - Remplace les « lots en annexe » construits le 2026-11-05 (`doc.json.media`, groupe `media`, ARCHITECTURE.md
        §5). À garder : normalisation des photos, lecture par Claude par paquets de 20, une source tirée d'une photo dit
        *comment* faire une étape, pas ce qui est *attendu* (`observed-only`).
      - Pistes déjà étudiées pour la vidéo, tout en local : `ffprobe` (durée, pistes) ; son → Whisper (transformers.js,
        une entrée `speech` au catalogue) → transcription horodatée ; images candidates par changement de scène plus une
        toutes les 5 s, quasi-doublons retirés (dHash) ; mosaïques 4×4 pour un survol par Claude (chapitres, moments à
        voir), puis les images clés en pleine résolution ; `media.frame` et `media.transcript` comme commandes, donc
        outils MCP. ffmpeg téléchargé à la demande comme llama.cpp (build win64 épinglé + SHA-256), sans admin. `/files`
        avec les requêtes `Range` pour un lecteur vidéo.
- [x] **Un document à partir d'un dossier.** Choisir un dossier et ajouter tous ses éléments valides, prêts à l'import.
- [x] **Plusieurs conversions à la fois.**
- [x] **Un document qui relie les documents entre eux.** Après un import de documents et de photos, Claude écrit une
      sorte de README qui parle des documents et des liens entre eux ; il est ensuite ajouté au contexte de chaque
      commande, pour que tous les outils connaissent ces liens. Optionnel. Corrigé après chaque import, de façon
      intelligente : on met à jour ce qui change, on ne recommence pas tout.

- [x] **Les vidéos comme sources, à la seconde** (2026-11-10, le plan était `VIDEO-SOURCES.md`). Une source cite
      un moment ou une plage, dite ou vue ; le lecteur maison la rejoue en boucle. La parole sort du serveur
      (whisper.cpp, large-v3 turbo), par morceaux repris un à un, une langue par passage, traduite par Claude ; ce
      qu'un humain corrige n'est jamais écrasé ; les images se prennent sur les écrans posés.
      - Reste à faire avec l'équipe : 5 minutes transcrites à la main sur 3 vidéos (Documents › Video ›
        Reference…) pour mesurer le jargon ; la vitesse sur un portable sans carte NVIDIA ; mesurer les runs
        Claude d'une vidéo de plus de dix minutes (ceux d'une vidéo courte sont mesurés : ARCHITECTURE.md §16).

      - Fait depuis (même jour) : les fichiers son seuls (.mp3, .m4a…), le plafond de disque par projet, « Never
        to Claude » pour un document.
      - Décidé, pas construit : « qui parle » (hors périmètre tant que personne ne le demande) ; un build Vulkan
        pour les puces Intel et AMD (seulement si la lenteur gêne : ce serait notre propre binaire à compiler
        et à héberger). Limite connue : l'index est mis à jour une fois la vidéo convertie, pas pendant.

- [ ] **Découper une figure en parties.** Un écran, un pupitre ou une armoire montre des dizaines d'éléments ; chacun
      (touche, champ, zone, voyant, commande) devient une partie de la figure : une ancre stable par son libellé, jamais
      par sa position (`fig:40/doo-l`), son propre recadrage à la résolution d'origine, son genre, et ses états quand
      la source les montre (normal, appuyé, en défaut…). Un pas de test montre alors la touche seule, pas l'écran
      entier ; la recherche trouve la touche ; la vérification lit le bon recadrage ; chaque état montré peut devenir
      un cas de test. Vaut aussi pour une image clé de vidéo (l'écran recadré dans l'image de la cabine).
      - Méthode reprise de SRS Writing (`image_tools.py`, règles P1, P3, P4, P6, P16), qui l'a apprise à ses
        dépens : Claude lit les cadres sur une **grille graduée dessinée sur l'image**, dans ses propres pixels, jamais
        à l'œil ; l'élément est recadré **avec son étiquette** et une marge ; un contrôle automatique refuse un bord
        qui coupe du contenu (et élargit le cadre) ; une planche de toutes les parties, chacune avec son nom, est
        relue pour vérifier que chacune montre sa propre étiquette ; jamais affichée à plus de 2× sa taille ; une
        légende qui nomme deux choses donne deux parties ; on nomme par le libellé lu, jamais par l'ordre des cadres.
      - Gardées comme les images clés : une nouvelle lecture redonne les mêmes ancres ; un cadre corrigé par une
        personne n'est jamais réécrit. Une commande (`docs.splitFigure` ou équivalent), automatique pour les écrans
        riches en libellés, à la demande pour le reste.
      - À décider d'abord, dans ARCHITECTURE.md : une partie est-elle citable, ou seulement une image à joindre
        (aujourd'hui seule la légende d'une figure est citable) ?
      - En deux temps : les parties et leur usage dans les tests (`tests_addImage` sur une partie, un chunk par
        partie, un lien figure → partie) ; puis un écran qui montre les cadres sur la figure et permet de les déplacer
        (avec /design).
- [ ] **Des corrections de transcription pour tout le projet.** Une liste `faux => juste` (mots entiers, sans tenir
      compte de la casse), appliquée après l'écoute à toutes les vidéos du projet, et réapplicable sans réécouter. Elle
      complète le glossaire : un terme du glossaire sortait encore faux 12 fois sur 20 dans les mesures de MediaTools.
      Changer le texte change ce que citent les sources : passer par le même rapport qu'une nouvelle écoute.
      *(MediaTools, `corrections.txt`.)*
- [ ] **L'image la plus lisible autour d'un instant.** Quand on garde une image d'une vidéo, chercher sur quelques
      secondes autour celle où la zone voulue est la plus nette et la moins éblouie (énergie des contours divisée par
      le reflet), plutôt que l'image exacte de l'instant. Pour les vidéos tenues à la main en cabine. *(MediaTools,
      `screengrab.py`.)*

## 3. Index, modèles et recherche

- [x] **Pas de warnings pendant l'indexation.** Pendant qu'elle tourne, l'indexation affiche des avertissements de
      problèmes d'indexation : c'est normal puisqu'elle travaille, ça n'a pas de sens pour l'utilisateur et ça le
      perturbe. Ils doivent disparaître.
- [x] **Rendre clair qui utilise quoi : embedding, reranker, recherche.** Aujourd'hui on comprend mal quelle recherche
      et quel RAG sont utilisés. Exemple : avec le pack Qualité, l'app propose quand même d'installer BGE-M3. Il faut
      dire clairement qui a besoin de quoi et qui utilise quoi — d'autant que d'autres LLM que Claude vont bientôt
      arriver.
- [x] **Packs : marge du bandeau.** Au-dessus des packs de modèles, le bandeau info / warning n'a pas de marge par
      rapport aux packs.
- [x] **Packs : des textes justes, un code générique.** Ce qui est écrit dans les packs n'est pas toujours vrai, par
      exemple « skipped car trop gros » pour un modèle qu'on est littéralement en train d'utiliser. Retravailler ce code
      pour le rendre global et générique : il montre clairement du spaghetti.
- [x] **Une recherche plus puissante,** avec des réglages modifiables dans Settings › Search.
- [ ] **Un glossaire ferroviaire de départ.** Proposer, pour un projet ferroviaire, un glossaire de synonymes du
      métier (DSD = dead man = Sifa, MSDO = ouverture sélective des portes…) à verser dans `project.json.glossary`,
      pour que la recherche trouve un élément sous tous ses noms. Des données du projet, jamais du code. *(SRS
      Writing, `SRS-Element-Library.md` : 44 éléments génériques avec leurs synonymes.)*

## 4. Claude

- [x] **Onglet de Settings « Context ».** Toutes les prompts utilisées par le système y sont visibles.
- [x] **Claude actions triées par cible.** Les Claude actions sont triées par target (ce sur quoi porte l'action), et
      cette target est clairement visible.

## 5. Chargement et performance

- [x] **Montrer que ça avance.** Parfois le squelette de contenu s'affiche pendant le chargement mais rien ne bouge :
      on ne sait pas s'il se passe quelque chose. C'est assez courant que ça prenne de longues secondes. Il faut un
      signe de vie, et vérifier s'il reste des problèmes de performance.
      - Pistes laissées par la passe du 2026-11-05 : un `test.md` écrit invalide beaucoup de lectures (à restreindre à
        celles affichées, ou à regrouper) ; le détail d'un job en cours recalcule tout son journal à chaque événement
        (regrouper par frame) ; le `stat` de tout le projet avant et après chaque job alors que le watcher sait ce qui a
        bougé ; un seul bundle de 1,4 Mo (découper par écran) ; les premières lectures synchrones d'un gros projet
        (~0,4 s au démarrage) ; `docs.show` renvoie tout `doc.md` au premier affichage.

## 6. Exécution des tests

- [x] **Un onglet « Run » pour les testeurs.** Les testeurs y font leurs tests. À imaginer avec /design : ce qui compte
      pour eux. A priori : créer un run avec une série de tests, puis annoter chaque test (« passe », « problème »),
      ajouter des commentaires, des questions, etc.
- [x] **Un run en pages HTML, hors de l'app.** Générer, un peu comme des artifacts, un dossier pour un run : une page
      `index.html` qui lance le run dans le navigateur en localhost. Le dossier peut aller sur une autre machine que
      l'app, on y fait le run, puis on le réimporte dans l'application avec ses résultats. Un modèle existe sur ce PC :
      la fiche de test interactive de `D:\SVN\B040L00320_Ratp_Sosie_Sources\.claude\skills\testing\` (HTML +
      `data.json`, OK / NOK par ligne).

## 7. Navigation et interface

- [x] **Plus d'identifiants internes à l'écran.** On voit parfois des ids internes comme « local-4df6ff7b » : ce n'est
      pas acceptable, on ne sait pas ce que c'est. Trouver tous les endroits où l'interface en affiche, et les
      remplacer par ce qui parle à l'utilisateur (le résumé du test, sa clé Jira, le titre du document…).
- [x] **Menu du projet simplifié.** Dans le menu principal, un clic sur le nom du projet ne montre plus « Open a
      folder », « New project » ni « Open by Jira key » : juste un bouton qui ramène à l'écran de sélection de projet.

## 8. Vérification et relecture

- [ ] **Une vérification à l'aveugle.** Un modèle à qui l'on montre une affirmation finit par être d'accord avec
      elle ; notre vérification montre le test à Claude. En option, pour les tests importants ou un échantillon avant
      validation : un run qui **ne voit pas le test** répond à des questions ouvertes sur son objet (que fait cet
      élément, dans quels états, avec quels effets ?) à partir des documents seuls ; on compare ; chaque désaccord est
      relu sur la page source avant d'être signalé. Mesurer sur un échantillon avant d'en faire un réglage par défaut.
      *(SRS Writing, skill `verify-against-sources`.)*
- [ ] **Corriger le même défaut partout.** Quand une personne corrige un pas, une tournure ou une image, chercher le
      même défaut dans les autres tests et proposer de les corriger aussi (« 7 autres tests ont la même formulation »),
      au lieu de s'arrêter au cas signalé. *(SRS Writing, « Maintaining this skill », point 10.)*
- [ ] **Une modification n'empire rien.** Une modification de test, par Claude ou par une personne, qui **ajoute** un
      défaut au contrôle mécanique est signalée avant d'être enregistrée ou synchronisée. On ne demande pas zéro
      défaut, seulement de ne pas en ajouter. *(SRS Writing : le cliquet de `confluence.update_page`.)*
- [ ] **Des idées pour la relecture**, à comparer d'abord avec Validate / To fix, écran par écran (avec /design) :
      - une catégorie par commentaire (erreur, formulation, structure, image, info manquante) ;
      - « Répondu, à vérifier » : quand Claude a corrigé, l'auteur du commentaire le voit jusqu'à ce qu'il en accuse
        réception ou réponde de nouveau ;
      - « Demander d'abord à un collègue » : un commentaire adressé à une personne n'est pas une demande pour Claude
        tant qu'il ne lui a pas été passé.

      *(SRS Writing, l'atelier de relecture `SRS.html`, `SRS-Local-Workspace.md` §3.)*

## À compléter

- [ ] « J'aimerais pouvoir… » — la phrase s'arrêtait là dans la note d'origine.
