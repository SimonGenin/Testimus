# Changelog

What changes for the team in each version of Testimus, newest first. Every commit that changes what the team sees
updates « Unreleased » (one short line per change, in French; a line that already speaks of the same thing is rewritten
instead); `npm run publish <x.x.x>` turns « Unreleased » into that version.

## Unreleased

- Analyser un test existant contre les documents : Claude relie ce qui est juste à ses passages et propose des changements, que l'équipe accepte ou refuse un par un.
- Un nouveau projet démarre avec trois demandes rapides : « One action per step », « Checkable results » et « Missing cases ».
- Dock Claude : plus de note séparée, on écrit dans la seule zone de texte ; « Save the text as a context… » enregistre ce qui y est écrit.
- Nouvelle page Settings › Changelog : ce qui change à chaque version, la plus récente en haut. Un clic sur le numéro de version l'ouvre, et l'annonce d'une mise à jour y mène.

## 0.0.7 — 2026-11-09

- La version s'affiche par son seul numéro (0.0.7).
- Nouvel écran Run pour les testeurs : on déroule un test comme dans l'éditeur, avec ses sources cliquables, et un run s'exporte en pages HTML lisibles sans Testimus.
- Documents : import d'un dossier entier, plusieurs conversions en parallèle, images et vidéos deviennent des documents à part entière, et docs/OVERVIEW.md décrit comment les documents s'articulent.
- Generate montre le test que Claude écrit en direct ; après une génération, Claude propose lui-même les corrections sur ses tests et des suggestions dans « Ask for changes ».
- Recherche plus puissante, réglable dans Settings › Search (filtres, synonymes, fautes de frappe, explication de chaque résultat).
- Settings › Context montre tout ce que Claude reçoit.
- Plus d'identifiants internes à l'écran, un menu projet simplifié, un retour en arrière toujours au même endroit, et de nombreuses corrections.

## 0.0.6 — 2026-11-06

- Dans une étape, le texte se sélectionne n'importe où sur la ligne ; on ajoute une image ou un tableau avec les icônes à droite du texte.
- Les tableaux d'une étape s'éditent avec une barre au-dessus (ligne, colonne, ligne d'en-tête, supprimer), des menus de ligne et de colonne, et Tab d'une cellule à l'autre.
- Sur un gros projet, ouvrir un test et taper dans une étape sont nettement plus rapides.
- Le dock Claude résume ce que Claude fait en deux lignes.
- Un document sans titres reconnus est converti en une seule section.

## 0.0.5 — 2026-11-05

- Le bouton « Add from a path… » des Documents est retiré : on ajoute un document avec Add documents ou en le glissant.
- Sous Windows, la barre des tâches montre l'icône de Testimus au lieu de celle d'Electron.

## 0.0.3 — 2026-11-05

- Photos en annexe d'un document : Claude les lit (description, texte visible, sections illustrées) et elles deviennent une annexe « Observé sur le système réel ».
- Une annexe dit comment faire une étape, jamais le résultat attendu.

## 0.0.2 — 2026-11-05

- Paramètres plus larges : les cartes passent sur deux colonnes quand il y a la place.
- Les longues listes déroulantes se filtrent en tapant (projet Jira à la création d'un projet).

## 0.0.1 — 2026-11-05

- Première version.
