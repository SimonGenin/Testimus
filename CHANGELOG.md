# Changelog

What changes for the team in each version of Testimus, newest first. Every commit that changes what the team sees
updates « Unreleased » (one short line per change, in French; a line that already speaks of the same thing is rewritten
instead); `npm run publish <x.x.x>` turns « Unreleased » into that version.

## Unreleased

- L'écran Jobs disparaît. Un job s'ouvre dans un panneau à côté de l'écran (depuis un toast, la barre du haut ou l'écran qui l'a lancé) : ce qu'il a fait, où aller ensuite, ce qui n'a pas marché et quoi faire. Un job qui échoue reste signalé dans la barre du haut jusqu'à ce qu'on l'ouvre. Chaque test (sous ses étapes) et chaque document (Details) a son historique. Les jobs terminés sont gardés 30 jours, puis effacés tout seuls.
- Les vidéos deviennent des sources à la seconde : une source cite un moment ou une plage (de 2:36 à 2:52), dite ou vue. Un clic la rejoue aussitôt en boucle, avec quelques secondes de marge (réglables dans Settings › Videos) ; au survol, la source montre l'image clé la plus proche et la phrase citée.
- En tête d'un document d'images ou de vidéo, un badge dit s'il est « Observed » ou « Reference » ; on le change par le menu « … » (« Mark as the reference » / « Mark as observed »).
- Un enregistrement son seul (.mp3, .m4a, .wav…) s'ajoute comme une vidéo sans image : transcrit, découpé en chapitres, cité à la seconde.
- À l'ajout d'une vidéo, on peut choisir (dans un volet replié : par défaut la langue est reconnue et tout est transcrit) la ou les langues parlées, la piste son et une partie seulement ; l'application dit ce qui partira chez Claude (les images et ce qui est dit, jamais le son).
- Settings › Videos : un plafond pour la place que prennent les vidéos du projet ; une vidéo qui le dépasserait est refusée à l'ajout, et la place libre du disque est vérifiée avant la copie.
- Settings › Models › Transcription › « Measure… » : comparer les modèles de transcription sur les vidéos de référence du projet (erreurs, jargon, vitesse, mémoire), par langue.
- Glossaire de la transcription : « Have Claude write it » fait écrire le glossaire par Claude à partir des documents (on peut lui dire ce qu'on veut) ; tout ce qui est affiché est envoyé au moteur, il n'y a plus de termes « left out », et une liste trop longue est refusée à l'enregistrement.
- Chercher « S12 » trouve aussi ce qu'une vidéo a entendu « S 12 », et l'inverse.
- Le lecteur vidéo est fait pour vérifier une source : la plage est dessinée sur la frise, on sort de la boucle et on y revient, on tire ses bornes puis on enregistre.
- La transcription change de moteur (Whisper large-v3 turbo, sur ce PC, hors de l'application) : bien meilleur texte, une langue reconnue pour chaque passage (une vidéo peut mêler anglais et allemand), traduction par Claude à côté de la ligne d'origine, et environ une minute de calcul par heure de vidéo avec une carte NVIDIA.
- Une vidéo longue ou lourde ne bloque plus rien : elle se lit tout de suite, la transcription et le parcours des images avancent par morceaux de dix minutes avec le temps restant, s'annulent pour de vrai et reprennent où ils s'étaient arrêtés ; la mémoire est vérifiée avant de charger le modèle (un modèle plus léger prend le relais s'il le faut) et une mise en veille du PC n'interrompt plus rien.
- Dans l'onglet Vidéo d'un document : les lignes peu sûres sont signalées, on les écoute puis on les confirme ou on les corrige ; ce qu'une personne a corrigé n'est plus jamais écrasé. Claude peut proposer des corrections, à accepter ou refuser. « Hear again… » réentend la vidéo et montre ce que cela change pour les tests qui la citent.
- Les images clés sont mieux choisies (écrans posés, petits changements comme une alarme, plus d'images pour une vidéo longue) et chacune porte une description qu'une étape peut citer ; « Keep the frame at … » fait de n'importe quelle seconde une image clé. Pour une vidéo de dix minutes ou moins, Claude choisit les images et les chapitres en une seule passe : environ une minute pour deux minutes de vidéo.
- Settings › Models › Transcription : installer le moteur et choisir le modèle selon le PC (taille, adéquation, vitesse mesurée). Settings › Videos : langues attendues, glossaire donné à la transcription, densité des images clés, traduction.
- Un document vidéo n'a plus le bouton « Add images… » : une vidéo est un document à elle seule, les images vont dans un document d'images.
- Avant de convertir une vidéo, l'application annonce sa durée, son poids, le temps estimé sur ce PC et la part de Claude.
- Dans un document écrit en exigences (un identifiant par titre), chaque exigence est rattachée à sa section : Claude trouve ce qui l'entoure, et la recherche limitée à une section la contient. Les documents déjà indexés s'affichent « pas à jour » : un Reindex suffit.
- L'analyse d'un test s'appelle maintenant « Cross-check » (confronter le test aux documents). « Cross-check again » est un vrai bouton en haut du panneau, et le nouveau cross-check reçoit ce que l'équipe a accepté, refusé et laissé en attente — un refus n'est plus jamais reproposé. Une proposition acceptée puis défaite (test remis comme sur Jira, step annulé, source retirée) repasse « à décider », avec la mention de qui l'avait acceptée.
- Pendant que Claude travaille, la boîte où l'on a écrit sa demande (Cross-check, Generate, colonnes…) garde le texte envoyé au lieu de revenir à son texte d'exemple.
- Le résumé d'un cross-check lie chaque section ou exigence qu'il cite : un clic ouvre le passage, comme dans les réponses de Claude.
- Settings refait : un même thème sur toutes les pages (un réglage par ligne, son nom et son explication à gauche, la commande à droite). La liste sépare « This project » et « Testimus » (pour tous les projets) ; nouvelles pages Videos (langues, glossaire, images clés) et Claude Code (le programme, les runs en parallèle), la page Claude garde ce que le projet demande à Claude (dock, quick asks, vue d'ensemble des documents). Models présente les modèles un par un par type (Embeddings, Reranker, Transcription), le conseillé pour ce PC en tête, sans packs ; Access devient « Jira and Xray », replié quand tout répond ; Smart columns montre une ligne par colonne, une seule ouverte à la fois ; Context garde sa liste à côté du détail, sans faire défiler toute la page.

## 0.0.8

- Chaque écran est fait de sections (2 à 4, au plus 2 l'une au-dessus de l'autre), chacune avec ses onglets : on tire un onglet par sa poignée vers une autre section (seules les places qui peuvent le prendre s'affichent), on replie une section en bande d'icônes, on redimensionne librement par une petite poignée qui ne déplace que les deux sections qui l'entourent, même de part et d'autre d'une section repliée (sous la largeur minimale, « Release to collapse » prévient et relâcher replie la section), et la barre du haut ajoute une colonne, coupe une section en deux ou remet la disposition de l'écran. Chaque écran garde la sienne.
- Claude devient un onglet de chaque écran au lieu du dock à droite (Ctrl J le montre ou le replie) ; sa conversation suit d'un écran à l'autre.
- Une source ouverte (dans un test, l'analyse, Generate, un run ou une réponse de Claude) s'affiche dans un onglet « Source » à droite du travail, et non plus dans une fenêtre par-dessus : on lit le passage en gardant le test sous les yeux.
- Le rail de gauche n'a plus que des icônes, plus petites, bien centrées et un peu plus espacées, le nom de chaque écran en infobulle.
- Dans une colonne étroite, les boutons au-dessus de la liste des tests restent sur une ligne : le filtre Assignee montre le nombre de personnes cochées au lieu de leurs noms, puis « New test » ne garde que son « + » ; tout revient quand on élargit.
- Les blocs Claude n'affichent plus « Ctrl+Enter to send » à côté du bouton d'envoi : le raccourci marche toujours, la place revient au reste.

- Analyser un test existant contre les documents : Claude relie ce qui est juste à ses passages et propose des changements, que l'équipe accepte ou refuse un par un. L'analyse s'ouvre dans un onglet « Analysis » à droite du test (jamais par-dessus), avec le nombre de propositions à décider ; déplacée ailleurs, elle y revient la fois suivante.
- Un nouveau projet démarre avec trois demandes rapides : « One action per step », « Checkable results » et « Missing cases ».
- Dock Claude : plus de note séparée, on écrit dans la seule zone de texte.
- Le bouton « Context » de chaque bloc Claude liste tout ce qui part avec la demande — contextes, documents et ce que l'équipe en sait, puis consigne, règles et outils — avec, à côté, le texte exact de l'élément choisi et en haut le nombre de tokens de départ ; on y coche ou décoche ce qui accompagne ce run, et les contextes enregistrés s'y créent et s'y gèrent.
- Un document décoché n'est ni cherché, ni lu, ni cité par Claude pour ce run.
- Settings › Context dit, run par run, ce que Claude reçoit, ce qu'il peut toucher et ce qu'il rend ; les contextes par défaut s'y règlent.
- La vérification dit pour chaque étape si le passage cité l'appuie, et lequel elle a lu ; chaque anomalie que les documents tranchent vient avec sa correction, et le test reçoit une seule action « Fix ».
- Ce qu'une génération laisse sans test est expliqué : une raison parmi six, ce qui a été cherché et lu, ce qui débloquerait ; Claude y jette un second regard et ne propose d'écrire le test que s'il peut vraiment s'écrire.
- Vérifier plusieurs tests coûte beaucoup moins : une seule demande pour quatre tests, et Claude ne reçoit plus que les outils utiles à son travail.
- Les règles du projet (CLAUDE.md) se mettent à jour avec l'app sans toucher aux notes de l'équipe.
- Après le run d'une action, Testimus recompte ce qui reste du problème (« 3 findings → 0 »).
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
