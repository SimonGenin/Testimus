# Changelog

What changes for the team in each version of Testimus, newest first. Every commit that changes what the team sees
updates « Unreleased » (one short line per change, in French; a line that already speaks of the same thing is rewritten
instead); `npm run publish <x.x.x>` turns « Unreleased » into that version.

## Unreleased

- Chaque écran est fait de sections (2 à 4, au plus 2 l'une au-dessus de l'autre), chacune avec ses onglets : on tire un onglet par sa poignée vers une autre section (seules les places qui peuvent le prendre s'affichent), on replie une section en bande d'icônes, on redimensionne librement par une petite poignée qui ne déplace que les deux sections qui l'entourent, même de part et d'autre d'une section repliée (sous la largeur minimale, « Release to collapse » prévient et relâcher replie la section), et la barre du haut ajoute une colonne, coupe une section en deux ou remet la disposition de l'écran. Chaque écran garde la sienne.
- Claude devient un onglet de chaque écran au lieu du dock à droite (Ctrl J le montre ou le replie) ; sa conversation suit d'un écran à l'autre.
- Le rail de gauche n'a plus que des icônes, plus petites et bien centrées, le nom de chaque écran en infobulle.

- Analyser un test existant contre les documents : Claude relie ce qui est juste à ses passages et propose des changements, que l'équipe accepte ou refuse un par un.
- Un nouveau projet démarre avec trois demandes rapides : « One action per step », « Checkable results » et « Missing cases ».
- Dock Claude : plus de note séparée, on écrit dans la seule zone de texte.
- Le « + » des blocs Claude (dock, Generate, note d'un document, Smart columns) offre partout les mêmes choix : contextes à cocher, « Save the text as a context… », « Manage contexts… ».
- Nouvelle page Settings › Changelog : ce qui change à chaque version, la plus récente en haut. Un clic sur le numéro de version l'ouvre, et l'annonce d'une mise à jour y mène.

## 0.0.7

- Nouvel écran Run pour les testeurs : on choisit ses tests, on marque chaque étape OK / NOK, on joint des captures (glisser ou Ctrl+V), on signale un test bloqué et on pose des questions.
- Run : le test se déroule dans les mêmes cartes que l'éditeur, avec ses sources cliquables ; la page d'un run résume les étapes NOK, les tests bloqués et les questions ouvertes.
- Run : Claude lit un run pour rédiger un bug, répondre ou résumer ; sa réponse peut devenir la note d'une étape.
- Un run s'exporte en pages HTML jouables sur n'importe quel PC sans Testimus (« Export as pages… ») ; les résultats reviennent par « Import results… ».
- Documents : images et vidéos deviennent des documents à part entière ; une vidéo a son lecteur, ses chapitres, sa transcription cliquable et ses images clés. Les .txt et .md s'importent aussi.
- Documents : un document d'images ou de vidéo reste « Observed » tant que l'équipe n'en fait pas une référence ; les anciens lots de photos sont convertis automatiquement.
- Documents : « Import a folder… » importe un dossier entier et dit pourquoi un fichier est écarté ; plusieurs conversions tournent en parallèle.
- « How the documents fit together » : une page écrite par Claude sur l'articulation des documents, mise à jour après chaque import, que Claude peut recevoir à chaque run.
- Generate montre en direct le test que Claude écrit ; les tests non écrits sont regroupés par catégorie, chacun avec sa raison.
- Après une génération, « Ask for changes » modifie tous les tests ou une sélection, ou en ajoute ; Claude propose lui-même des corrections et des « Suggestions ».
- Plus de limite de 15 étapes par test : c'est la demande qui décide de la longueur.
- Recherche plus puissante, réglable dans Settings › Search : filtres, synonymes du projet, fautes de frappe, explication de chaque résultat, « Try it » avant d'enregistrer.
- Settings › Context montre tout ce que Claude reçoit : compétences, prompts, CLAUDE.md et contextes.
- L'indexation se voit (« Indexing · n % ») ; Settings › Models explique chaque pack et pourquoi une variante est choisie ou non.
- Review et Run ont une seule barre de filtres ; « Back to draft » retire une marque To fix sans valider.
- Plus d'identifiants internes à l'écran : un test est nommé par son résumé, un document par son titre.
- Le retour en arrière est toujours au même endroit, en haut ; le menu projet est simplifié (« All projects… », « Open by Jira key… »).
- Les chargements disent ce qui charge et proposent « Try again » quand c'est lent ; l'app est nettement plus rapide sur un gros projet.
- Le modèle de Claude se choisit parmi fable, opus, sonnet et haiku ; les compétences livrées se mettent à jour dans les projets sans écraser celles modifiées par l'équipe.
- La version s'affiche par son seul numéro.
- Corrections : des barres d'outils passent à la ligne au lieu de cacher des boutons, plus de fichier en double pendant un ajout, la liste des documents ne clignote plus, le pack de secours se choisit de nouveau dans Settings › Models.

## 0.0.6

- Dans une étape, le texte se sélectionne n'importe où sur la ligne ; les icônes à droite d'un texte ajoutent une image ou un tableau.
- Tableaux d'une étape : une barre au-dessus (ajouter une ligne ou une colonne, ligne d'en-tête, supprimer), un menu par ligne et par colonne (insérer, déplacer, supprimer, avec Undo), Tab d'une cellule à l'autre.
- Sur un gros projet, ouvrir un test, taper dans une étape et les listes Tests, Review et Jobs sont nettement plus rapides.
- Dock Claude : ce que Claude fait tient en deux lignes, avec ses étapes en mots simples (« Read SECIB ») et leur durée.
- Un document sans titres reconnus est converti en une seule section, avec un avertissement pour appliquer les styles de titres.
- Corrections : le cadre garde ses coins arrondis quand le dock est replié, les lignes de Documents respirent, un clic n'importe où sur un job le déplie.

## 0.0.5

- Le bouton « Add from a path… » des Documents est retiré : on ajoute un document avec « Add documents » ou en le glissant.
- Sous Windows, la barre des tâches montre l'icône de Testimus au lieu de celle d'Electron.

## 0.0.3

- Photos en annexe d'un document : Claude les lit (description, texte visible, sections illustrées) et elles deviennent une annexe « Observé sur le système réel ».
- Une annexe dit comment faire une étape, jamais le résultat attendu.

## 0.0.2

- Mises à jour depuis le dossier partagé de l'équipe : une nouvelle version est proposée au démarrage, s'installe en arrière-plan et démarre avec « Restart » ; Settings › Updates montre l'état.
- Jira dans l'éditeur de test : le statut (avec les transitions du workflow), l'assigné, et une carte Details (labels, exigences couvertes, préconditions, description).
- Commentaires Jira sous les étapes : lire, écrire, modifier ou supprimer les siens, mentionner avec @ ; « Draft with Claude » prépare un brouillon que l'on envoie soi-même.
- La liste des tests se filtre par assigné (Me, Unassigned, chaque personne) ; assignee:me marche dans toutes les recherches.
- Premier lancement guidé : Welcome, Claude, Jira & Xray, Project, Search. On peut travailler sans Jira, ou sans Xray, et « Copy a request for my admin » rédige la demande de clé Xray.
- Paramètres plus larges : les cartes passent sur deux colonnes quand il y a la place.
- Les longues listes déroulantes se filtrent en tapant (le projet Jira à la création d'un projet).

## 0.0.1

- Première version : Testimus transforme les documents de spécification en tests manuels Xray relus, dont chaque étape cite le passage qui la justifie.
- Documents : on ajoute des .docx ou .pdf ; Testimus les découpe en sections, tableaux et figures, et Claude décrit les figures.
- Le lecteur de documents montre le sommaire, le texte, les tableaux et les figures ; ouvrir une source affiche sa section avec la citation surlignée.
- Recherche locale : les documents sont indexés sur le PC ; « Search everything » (Ctrl K) cherche par mots et par sens dans les tests, les documents et leurs passages.
- Generate : on décrit ce qu'il faut tester et on choisit documents et sections ; Claude planifie, écrit les tests en parallèle et cite la source de chaque étape.
- Pendant une génération, « What Claude did » montre ses recherches, les sections lues et son plan ; « Not covered » dit ce qui n'est pas couvert et pourquoi.
- Claude relit chaque test généré contre les documents (sources, citations, résultats attendus, cas exigés) et ne signale que ce qui demande une action.
- Review : la file des tests générés (Draft, To fix, Validated), avec le test, ses constats et la source côte à côte ; « Validate », ou « To fix » avec une note que Claude corrige.
- Un test généré n'arrive dans Tests qu'une fois validé, et son état de relecture le suit dans Jira en label.
- Tests : éditeur de tests manuels (étapes, images collées ou figures des documents, tableaux, préconditions, labels, dossiers), enregistré au fil de la frappe.
- Settings › Smart columns : chaque colonne d'étape a une description que Claude suit pour la remplir, et Claude peut proposer ces descriptions.
- Jira / Xray : un projet se connecte par sa clé ; on parcourt ses dossiers et ses tests, on récupère un test ou on l'ouvre par sa clé.
- « Push to Jira » montre d'abord le plan (étapes, dossiers à créer) puis l'exécute ; « Replace with Jira's version » reprend la version Jira d'un test.
- Dock Claude : questions sur les documents, un test, une étape ou le projet, réponses sourcées, conversations gardées, contextes enregistrés, « Quick asks », modèle et effort au choix.
- « Before Claude » montre une étape telle qu'elle était avant Claude et la restaure ; Claude propose aussi des corrections en cartes à lancer.
- Settings › Models : Testimus mesure le PC et propose un pack de recherche (Light, Balanced, Performance, Quality) qu'il télécharge.
- Jobs : chaque tâche longue (conversion, indexation, génération, échange avec Jira) avec ses étapes, ses erreurs expliquées et « Run again ».
- « System check » vérifie Claude, l'accès Jira / Xray et les modèles, et propose une correction ; il marche aussi derrière le proxy de l'entreprise.
- Plusieurs projets, ouverts depuis le menu du projet ; des contextes partageables entre projets.
- Application de bureau Windows, installée sans droits administrateur.
