# Goal — Photos et vidéos : des lots en annexe d'un document

## L'idée en une phrase

Un **lot** (des photos, des vidéos, des enregistrements audio, plus un contexte écrit par l'utilisateur) est attaché à
un document. Testimus le prépare sur le PC (images normalisées, images clés des vidéos, transcription du son), Claude
l'analyse comme il décrit les figures, et le résultat devient une **annexe du document** : des sections avec ancres et
figures dans son `doc.md`, que la recherche, la génération et le contrôle lisent comme le reste du document. À la
conversion comme à la génération, on coche les lots à prendre.

## Le design

Canevas « Testimus — photos & videos » : https://claude.ai/artifact/Rgv6nyWJk1y9zjZnj1424L (lire avec l'outil
Artifact, `action: "read"`, puis les fichiers `project/*.dc.html`). Neuf planches : Documents, les lots sous leur
document et le dépôt de fichiers (Main) ; le dialogue du lot et l'avis de téléchargement d'ffmpeg et de Whisper
(Batch) ; le bloc « Photos & videos » à l'import et à la conversion (Convert) ; la progression d'un lot dans la liste
et dans Jobs (Progress) ; la lecture d'une annexe photo (AnnexPhoto) et d'une vidéo avec sa chronologie, interactive
(AnnexVideo) ; les annexes dans le périmètre de génération (Scope) ; une source « observed », une image clé dans une
étape et le constat `observed-only` (Test) ; les cas limites (Edges). Dans l'interface, un lot s'appelle un
**batch**. Le canevas propose un jeton de plus, `observed` (sarcelle), pour la marque des sources d'annexe ; le reste
est fait des jetons actuels, et le code n'utilise que le kit et `tokens.stylex.ts`.

## Décisions (2026-11-05)

- Un lot est une **annexe** du document : son analyse est ajoutée à la fin du `doc.md` du document, pas un document à
  part.
- Les originaux (vidéos comprises) sont **copiés** dans le projet.
- À la conversion, **les deux** : on crée ou coche des lots dans le dialogue d'import / de conversion (les lots cochés
  sont ajoutés en annexe), et l'étude/la conversion du document peut s'appuyer sur les photos cochées (une photo pour
  une figure manquante ou illisible, un écran réel pour lire un libellé).
- Une source tirée d'un lot dit **comment** faire une étape, pas ce qui est **attendu** (voir plus bas).

## Ce qui change pour l'utilisateur

1. **Documents** : sous chaque document, ses lots (« Recette TCO 12/10 — 14 photos, 2 vidéos », coché ou non dans le
   document). « Add photos & videos… » sur le document (ou glisser des fichiers sur lui) ouvre le dialogue du lot :
   fichiers, titre, **contexte** (« photos du TCO réel en recette, version 3.2 »), modèle et effort de Claude. Le même
   bloc est dans le dialogue d'import et de conversion, avec la liste des lots existants à cocher.
2. **Le document se lit avec ses annexes** : après le corps du document, une annexe par lot coché ; une section par
   photo (photo, description, libellés, sections qu'elle illustre) ; pour une vidéo, un lecteur et sa chronologie
   (chapitres, images clés, transcription horodatée) — cliquer sur un horodatage place la vidéo à ce moment.
3. **Génération** : dans le choix du périmètre, les annexes apparaissent sous leur document comme des sections, cochées
   avec lui par défaut, décochables une par une. Une étape peut citer une annexe (`SOSIE_211_D401-1_3#§lot-recette.essai-freinage.t0021
   "on autorise l'ouverture"`) et mettre une image clé dans une étape comme une figure.
4. **Recherche, Ask Claude, contrôle** : les passages des annexes sortent dans la recherche, les citations sont
   vérifiées mot à mot comme le reste du document.

## Où vivent les lots

```
docs/<docId>/
  doc.json            + media: [{ id, title, included, items, plan }]   (les lots, ce que Claude a choisi)
  doc.md              le corps converti, puis une annexe par lot inclus (assemblé, jamais édité à la main)
  figures/            + les photos normalisées et les images clés des lots (préfixe lot-<slug>-)
  figures.json        + leurs descriptions, libellés, genre (le même describeFigures)
  media/<lot>/
    context.md        le contexte du lot
    files/            les originaux copiés
    part.md           l'analyse du lot : la vérité de l'annexe ; doc.md la recopie
    <item>/           le dérivé local : transcript.json, frames.json, mosaïques
```

**Assemblage** : `doc.md` = corps converti + `part.md` de chaque lot `included`, dans l'ordre des lots. Une
conversion, un ajout, un retrait, une case cochée ou décochée réassemble `doc.md` et relance ce que relance déjà un
changement de texte : contrôle mécanique des tests qui citent le document, index. Le corps converti est gardé à part
(`body.md`, dérivé) pour que réassembler ne demande pas de reconvertir.

Annexe d'un lot :

```
# Annexe — Recette TCO 12/10 (photos et vidéos) <!-- § lot-recette -->

## IMG_0042 <!-- § lot-recette.img-0042 -->
![IMG_0042 — 12/10/2026 14:03](figures/lot-recette-img-0042.jpg) <!-- fig lot-recette.img-0042 -->
Fenêtre Propriétés d'un sectionneur ouverte sur le TCO… Illustre §5.6.6.

## essai-freinage.mp4 — 04:12 <!-- § lot-recette.essai-freinage -->
### 00:00–00:45 Autorisation d'ouverture du sectionneur <!-- § lot-recette.essai-freinage.t0000 -->
![00:12](figures/lot-recette-essai-freinage-t0012.jpg) <!-- fig lot-recette.essai-freinage.t0012 -->
L'opérateur ouvre le menu contextuel du sectionneur S12 et choisit « Autoriser l'ouverture »…
> [00:21] « on autorise l'ouverture du sectionneur »
```

Ancres stables : le lot, le nom du fichier, l'horodatage — jamais une position. Une annexe a un `§` à elle (`lot-…`) :
le corps du document n'a jamais d'ancre qui commence ainsi, donc tout le monde sait qu'un passage vient d'une
observation. Les chapitres et images clés que Claude a choisis sont gardés (`media[].plan`), comme `conversion` pour le
document : refaire l'analyse redonne les mêmes ancres, sauf `--force`. Les renvois d'une annexe vers le corps
(« Illustre §5.6.6 ») sont relus quand le document est reconverti ; un renvoi qui ne résout plus devient un
avertissement de conversion (avec son action Claude).

## La conversion s'appuie sur les photos cochées

L'étude du document (`study-document`) et le tri des avertissements reçoivent la liste des photos et images clés des
lots cochés pour cette conversion, avec leurs descriptions. Claude peut alors :

- proposer une photo pour une figure sans image (« Figure 41 is a shape drawn in Word ») — comme aujourd'hui une image
  tirée du PDF ; la figure garde son ancre et dit d'où vient l'image ;
- lire un libellé illisible dans le document sur l'écran réel, en le signalant comme tel dans la description de la
  figure (jamais dans le texte de la spécification).

## Le traitement d'un lot

### Photos (jpg, png, webp, heic)

1. Copie dans `files/`, normalisation dans `figures/` (jpg ≤ 2000 px, orientation EXIF, HEIC → jpg) ; la date de prise
   de vue (EXIF) ordonne le lot.
2. Claude, par paquets de 20 (comme les figures), lit chaque photo avec le contexte du lot et la table des matières du
   document ; il rend description, libellés recopiés à la lettre, genre, et les sections du document illustrées (il
   peut chercher dans le document).
3. `part.md` est écrit, `doc.md` réassemblé, l'index mis à jour.

### Vidéos (mp4, mov, mkv, avi, webm) et audio (mp3, m4a, wav)

Tout se fait en local avec **ffmpeg** et **Whisper** ; seul Claude voit images et texte, comme pour les documents.

1. `ffprobe` : durée, pistes.
2. **Son** → `ffmpeg -vn -ac 1 -ar 16000 -f f32le` → Whisper (transformers.js, déjà là pour les embeddings) →
   `transcript.json`, segments horodatés, dans la langue du projet. Pas de son ou silence : on saute.
3. **Images candidates** : changements de scène (`select='gt(scene,s)'`, seuil bas : un écran de simulateur change peu)
   plus au moins une image toutes les 5 s ; quasi-doublons retirés par une empreinte 9×8 calculée par ffmpeg (dHash).
   Un enregistrement d'écran de 10 min donne typiquement 60 à 150 candidates.
4. **Mosaïques** : les candidates en planches 4×4 (`tile`), la correspondance case → horodatage dans le prompt. Claude
   voit toute la vidéo pour ~1,5 k tokens par planche.
5. **Claude, passe 1 (survol)** : transcription + mosaïques → chapitres (début, fin, titre) et moments à voir en grand
   (≤ 30 par 10 min).
6. Les images choisies sont extraites en pleine résolution.
7. **Claude, passe 2 (détail)** : images clés par paquets, avec leur bout de transcription → description, libellés, ce
   que fait l'opérateur, ce que montre l'écran, les sections du document concernées.
8. `part.md` (chapitres, images clés, citations de la transcription), réassemblage, index.

Ordre de grandeur pour 10 min : transcription en quelques minutes sur le processeur, ~80 k tokens côté Claude.

Pendant une génération ou un Ask Claude, Claude peut demander une image à un moment précis (`media.frame`) ou un
passage de transcription (`media.transcript`) : ce sont des commandes, donc des outils MCP.

## Les outils sur le PC d'un collègue

- **ffmpeg / ffprobe** : téléchargés à la demande comme llama.cpp (build win64 LGPL épinglé + SHA-256, dossier des
  runtimes), au premier lot qui en a besoin (vidéo, audio, HEIC). Une ligne dans le diagnostic. Ni admin, ni
  compilateur.
- **Whisper** : une entrée `speech` dans `models/catalog.json` (runtime transformers) — `whisper-small` dans le pack
  Light, `whisper-large-v3-turbo` dans les autres ; téléchargé comme les autres modèles, temps au journal de perf.
- `--mock` : ffmpeg et Whisper simulés (`TESTIMUS_MOCK_FFMPEG`, `TESTIMUS_MOCK_WHISPER`), Claude scripté ; la fixture
  gagne un lot (2 photos, une courte vidéo et sa transcription).

## Ce que vaut une source tirée d'un lot

Une photo ou une vidéo montre **ce que fait le système réel**, pas ce qu'il doit faire. Dans les skills
(`generate-tests`, `check-test`, `fix-test`) :

- une annexe sert à écrire *comment* faire une étape (où cliquer, libellés exacts, enchaînement des écrans) ;
- un résultat attendu doit avoir une source dans le corps du document ; s'il n'en a qu'une dans une annexe, le contrôle
  mécanique le signale (`observed-only`), sauf si le contexte du lot dit qu'il fait référence.

## Commandes (un groupe `media`, CLI + MCP + HTTP d'un coup)

| Commande | Ce qu'elle fait |
|---|---|
| `media.add {doc, files, title?, context?, include?, model?, effort?}` | crée le lot, lance préparation puis analyse (job) |
| `media.addFiles {doc, lot, files}` / `media.removeFile {doc, lot, item}` | complète ou retire ; seuls les éléments touchés sont refaits |
| `media.include {doc, lot, included}` | coche / décoche le lot dans le document (réassemble) |
| `media.analyse {doc, lot, items?, force?}` | refait la préparation et/ou l'analyse |
| `media.context {doc, lot, text}` | le contexte du lot |
| `media.remove {doc, lot}` | retire le lot (réassemble ; les tests qui le citent sont recontrôlés) |
| `media.list {doc?}` / `media.show {doc, lot}` | les lots, leurs éléments, leur état |
| `media.frame {doc, lot, item, at}` | une image à un moment donné (pour Claude et pour l'écran) |
| `media.transcript {doc, lot, item, from?, to?}` | la transcription d'un passage |
| `docs.convert {…, media?}` / `docs.add {…, media?}` | les lots cochés pour cette conversion (annexes + appui de l'étude) |
| `models.pullRuntime {runtime: "ffmpeg"}` | télécharge ffmpeg |

Le serveur HTTP sert `/files/` avec les requêtes `Range` pour que le lecteur vidéo puisse se placer.

## Phases

- **M1 — Lots de photos en annexe** : `doc.json.media`, `body.md` + assemblage, `media.add` / `addFiles` / `removeFile`
  / `include` / `context` / `remove` / `list` / `show`, normalisation (jpg, png, webp), analyse Claude des photos,
  `part.md`, index ; `observed-only` et la règle des sources dans les skills ; annexes dans le périmètre de génération ;
  Documents (lots sous le document, dialogue d'ajout, lots à cocher à l'import et à la conversion).
- **M2 — La conversion s'appuie sur les photos** : photos et descriptions passées à l'étude et au tri, figure sans image
  prise d'une photo, renvois relus à la reconversion.
- **M3 — Outils vidéo** : téléchargement d'ffmpeg, diagnostic, probe, candidates, dHash, mosaïques, HEIC ;
  `media.frame`.
- **M4 — Transcription** : Whisper au catalogue et dans les packs, `transcript.json`, `media.transcript`, audio seul.
- **M5 — Analyse des vidéos** : les deux passes Claude, `plan` gardé, chapitres et images clés dans `part.md`.
- **M6 — Lecteur vidéo** : composant du kit (lecteur + chronologie), horodatages cliquables, image clé dans une étape.

Chaque phase est utilisable seule ; M1 et M2 n'ont besoin d'aucun nouvel outil.

## Encore ouvert

- Le design est fait (voir « Le design ») ; restent à trancher en le relisant : le jeton `observed`, le nom
  « batch », et l'aide « N items illustrate §… » quand le périmètre est restreint à des sections.
