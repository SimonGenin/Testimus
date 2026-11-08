# ROADMAP.md

Ce qui vient ensuite, regroupé par thème. Rien ici n'est construit tant que le code ne le dit pas. Le comment et le
pourquoi de l'existant sont dans ARCHITECTURE.md ; ce qui reste à prouver de l'existant est en fin d'ARCHITECTURE.md
(§16).

## 1. Génération

- [ ] **Voir le test en cours d'écriture.** Pendant une génération, la page Génération montre le test que Claude est en
      train d'écrire : celui en cours est déplié, il se replie quand il est fini, et on peut déplier / replier ceux
      qu'on veut. Lecture seule, aucune édition. Uniquement sur la page Génération, pas en Review.
- [x] **Plus de refus au-delà de 15 pas.** Des tests ont été refusés parce qu'ils dépassaient 15 pas. Aucun prompt ne
      doit imposer une limite stricte : c'est au prompt de l'utilisateur d'en décider. On peut pousser vers 15 pas au
      plus, mais un test plus long est écrit quand même.
- [ ] **Mieux expliquer les tests non écrits (skipped).** Dire un peu mieux pourquoi un test n'a pas été écrit, et
      ranger les refus par catégorie. Les catégories viennent de Claude, elles sont dynamiques (pas de liste en dur) :
      elles font donc partie des prompts et des outils (le bloc `gen-report`, ses `skipped`).
- [ ] **Redemander des changements après une génération.** Une fois les tests générés, pouvoir demander des
      changements sur tous les tests et des ajouts. C'est déjà possible avec Claude, mais sur la page Génération la
      barre de gauche devient un Claude block avec des options pertinentes pour ces changements, et quelques Claude
      action buttons liés aux findings et aux skipped.

## 2. Documents

- [ ] **Les images deviennent des documents à part entière.** Ce ne sont plus des pièces jointes ni des annexes d'un
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
- [ ] **Plusieurs conversions à la fois.**
- [ ] **Un document qui relie les documents entre eux.** Après un import de documents et de photos, Claude écrit une
      sorte de README qui parle des documents et des liens entre eux ; il est ensuite ajouté au contexte de chaque
      commande, pour que tous les outils connaissent ces liens. Optionnel. Corrigé après chaque import, de façon
      intelligente : on met à jour ce qui change, on ne recommence pas tout.

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
- [ ] **Une recherche plus puissante,** avec des réglages modifiables dans Settings › Search.

## 4. Claude

- [x] **Onglet de Settings « Context ».** Toutes les prompts utilisées par le système y sont visibles.
- [ ] **Claude actions triées par cible.** Les Claude actions sont triées par target (ce sur quoi porte l'action), et
      cette target est clairement visible.

## 5. Chargement et performance

- [ ] **Montrer que ça avance.** Parfois le squelette de contenu s'affiche pendant le chargement mais rien ne bouge :
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

## À compléter

- [ ] « J'aimerais pouvoir… » — la phrase s'arrêtait là dans la note d'origine.
