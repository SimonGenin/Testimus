# Les vidéos comme sources — plan d'une implémentation de qualité

Proposition du 2026-11-10, révisée le même jour : la partie 1 a été relue contre le code, les faits extérieurs
(moteurs, modèles, tailles, licences) ont été vérifiés en ligne, et les moteurs ont été **mesurés sur ce PC avec de
vraies vidéos** des projets SOSIE (français) et Égypte (anglais, avec de l'allemand) — §10 et §11. Rien de ce qui suit
n'est construit, sauf ce que la partie 1 décrit. Quand une décision est prise, elle va dans ARCHITECTURE.md (§5, §6, §16) et
la tâche dans ROADMAP.md ; ce fichier peut alors disparaître.

Le but : une vidéo filmée par l'équipe (PCC, simulateur, cabine, réunion enregistrée) devient une source aussi fiable
qu'une spécification. Une étape de test peut citer **la seconde** où l'opérateur dit ou fait quelque chose ; un clic
sur la source rejoue ce moment. Quelles que soient la langue parlée, les accents, la durée et le poids du fichier, la
conversion ne fait jamais tomber l'application.

## En bref — les décisions qui comptent

1. **La parole sort du serveur** : un programme à part (`whisper.cpp`), tué pour de vrai à l'annulation, par morceaux
   de 10 minutes sauvegardés un à un. C'est ce qui rend tout le reste sûr.
2. **Whisper large-v3-turbo par whisper.cpp, et rien d'autre.** Mesuré sur ce PC (§11) : c'est le meilleur texte en
   anglais comme en français. Il transcrit 18 minutes en 34 secondes sur la carte NVIDIA, et va 4 à 8 fois plus vite
   que le temps réel sur 8 cœurs de CPU. Parakeet, testé aussi, est écarté : sur une réunion en français il s'est mis
   à écrire de l'anglais, on ne peut pas lui imposer la langue, et sa mémoire grimpe à 4,8 Go pour 6 minutes.
3. **Polyglotte par passage.** Une vidéo peut changer de langue : la langue est détectée **pour chaque passage de
   parole** (environ 10 s), et chaque passage est transcrit dans sa langue. Claude traduit à côté dans la langue du
   projet ; l'original reste la source citable. Essayé sur une vidéo Égypte où le formateur passe de l'anglais à
   l'allemand : rien n'est perdu. Ne jamais imposer une langue à toute une vidéo : Whisper traduit alors en silence,
   ou supprime ce qui ne colle pas.
4. **Une source vise une plage à la seconde, et se vérifie en boucle.** Cliquer une source 2:36 → 2:52 joue 2:32 →
   2:56 en boucle dans un lecteur maison. La plage citée est dessinée sur la frise, et on peut sortir de la boucle pour
   regarder ailleurs, puis y revenir. La citation est soit la parole de la plage, soit la description d'une image clé
   qui s'y trouve (décidé, §4.3, §4.4).
5. **Une ancre de parole est un moment, pas un numéro de ligne.** `t:04:30` désigne la seconde 270 de la vidéo, qui
   existe pour toujours ; la citation se cherche dans ce qui est dit autour. Retranscrire ne casse alors que les
   sources dont les mots ont vraiment changé. À décider **avant** que beaucoup de tests citent des vidéos.
6. **Ce qu'un humain a vérifié n'est jamais écrasé par une machine** : une ligne corrigée ou confirmée survit à toutes
   les retranscriptions.
7. **Les images se choisissent sur les écrans stables**, pas sur les changements : une passe légère sur toute la vidéo
   repère quand l'écran change *quelque part*, et on garde l'image une fois l'écran posé. Claude voit ce qui a changé
   en taille réelle, pas une vignette illisible. Essai fait : aujourd'hui une alarme de 40 px est perdue, alors que
   `mpdecimate` avec la règle de l'écran posé la garde et ignore le curseur (§5.1).
8. **La mesure à la main est faite** (étape 0, §11) : moteur, modèle et GPU sont tranchés. Ce qui reste ouvert est la
   qualité sur le jargon, qui demande quelques minutes transcrites à la main par l'équipe.

---

## 1. Ce qui existe aujourd'hui

Code : `lib/media-video.ts`, `lib/video-io.ts`, `lib/video-frames.ts`, `claude/media.ts`, `lib/media-md.ts`.

1. `ffprobe` : durée, taille, présence de son.
2. Le son entier est extrait en 16 kHz mono float **en mémoire**, puis **Whisper small q8** (transformers.js, CPU,
   **dans le processus du serveur**) produit des lignes horodatées. La langue est celle du projet (fr ou en
   seulement), sinon Whisper la devine.
3. Images candidates par ffmpeg : changement de scène (> 0,3), sinon une toutes les 5 s, en 640 px. Les
   quasi-doublons sont retirés par dHash sur l'image entière (9 × 8 gris, ≤ 6 bits d'écart).
4. Survol par Claude : au plus 12 mosaïques 4 × 4 (vignettes de 320 × 180) et la transcription **coupée à 6 000
   caractères**. Claude rend des chapitres et au plus 40 moments.
5. Les moments sont extraits en pleine résolution comme images clés (`frame:mm:ss`), puis Claude les décrit par paquets
   de 20, sans le contexte de ce qui est dit à ce moment.
6. `doc.md` ne contient que le verbatim : lignes `t:mm:ss` et images `frame:mm:ss`, citables. Une source
   `doc#t:04:30` ouvre déjà le lecteur à ce moment.

**Jamais prouvé sur Windows** (ARCHITECTURE.md §16) : le ffmpeg win64 n'a jamais tourné, Whisper n'a jamais tourné du
tout, et la qualité en français sur un vrai enregistrement n'a pas été mesurée. Le modèle de transcription n'est pas
installé sur le PC de développement. L'écran Transcript renvoie vers « Settings › Models », mais aucun écran des réglages
ne parle de transcription.

### Ce qui peut casser ou décevoir

**Robustesse**

| Risque | Pourquoi |
|---|---|
| Mémoire du serveur | Le son entier en float32 (≈ 230 Mo par heure) et le modèle sont chargés dans le processus du serveur |
| Annulation fausse | Whisper ne prend pas de signal : une annulation abandonne le résultat, mais le CPU continue de calculer |
| Reprise grossière | La transcription est une seule étape : une coupure à 1 h 55 sur 2 h repart de zéro |
| Aucune progression | « Listening to… » sans pourcentage ni durée restante (ffmpeg est lancé avec `-nostats`) |
| Délai fixe | Chaque appel ffmpeg est coupé à 30 min, quelle que soit la durée de la vidéo |
| Moment deviné | Si ffmpeg ne rend pas le temps d'une image candidate, le code suppose « rang × 5 s » : une ancre fausse, sans avertissement |

**Qualité de la parole**

| Risque | Pourquoi |
|---|---|
| Accents et vocabulaire | Whisper small fait à peu près deux fois plus d'erreurs que large-v3 en français sur des phrases lues (16,2 % contre 7,8 % de WER, moyenne de 4 jeux de test) ; l'écart se resserre sur de longs enregistrements (12,6 % contre 9,0 %). Source : [carte distil-large-v3-fr](https://huggingface.co/eustlb/distil-large-v3-fr). La version 8 bits utilisée ici perd encore un peu. Il ne connaît pas le jargon (sectionneur, PCC, codes d'alarme) |
| Erreurs citables | Une ligne mal transcrite est « verbatim », donc citable comme une vérité |
| Hallucinations | Sans détection de voix (VAD), Whisper invente du texte sur les silences et la musique. En français ce sont toujours les mêmes phrases : « Sous-titres réalisés par la communauté d'Amara.org », « Merci d'avoir regardé cette vidéo » |
| Langue forcée = traduction | Seuls fr et en sont transmis. Pire : forcer « français » sur un passage en anglais ne donne pas de l'anglais mal écrit, Whisper **traduit** en français. La ligne n'est plus ce qui a été dit, et elle est citable |
| Mélange de langues | Rien ne gère une langue parlée différente de la langue de génération, ni une vidéo qui alterne |

**Sources**

| Risque | Pourquoi |
|---|---|
| Ancres fragiles | Retranscrire (meilleur modèle) déplace les lignes : `t:04:30` peut ne plus exister, et la source devient `source-missing`. Le suffixe `-2` (deuxième ligne dans la même seconde) est un numéro de position, donc instable par nature |
| Décalage son / image | Dans beaucoup de fichiers (téléphone, OBS, Teams) la piste son ne commence pas à 0. Le son extrait seul repart de 0 : toute la transcription est décalée d'autant par rapport à l'image, de quelques centièmes à plusieurs secondes. **Vérifié le 2026-11-10** : son commençant à 0,68 s, un bip à 3,70 s dans la vidéo sort à 3,02 s de l'extraction actuelle |
| Plusieurs pistes son | Un enregistrement d'écran a souvent le micro et le son du PC sur deux pistes : seule la première est lue |

**Images**

| Risque | Pourquoi |
|---|---|
| Petits changements perdus | Un pictogramme qui change de couleur ou un message qui apparaît ne dépasse ni le seuil de scène ni le dHash global. **Vérifié le 2026-11-10** : un carré rouge de 40 px qui apparaît à 4 s sur un écran de 1280 × 720 n'est pas vu par le seuil de scène, et l'image prise à 5 s (qui le montre) est jetée par le dHash de Testimus (écart 0 avec l'image d'avant) |
| Image prise en plein mouvement | Une candidate tombe au moment du changement : menu à moitié ouvert, fondu, flou de bougé d'un téléphone tenu à la main |
| Survol aveugle | Des vignettes de 320 × 180 ne se lisent pas, et une vidéo de 30 min est survolée avec ses ~6 premières minutes de parole |
| Couleurs délavées | Un iPhone filme en HDR par défaut : les images extraites sans conversion sont grises et ternes |
| Lecture | Certains `.mov` HEVC (iPhone) ne se lisent pas dans la page selon le PC, et un fichier de plusieurs Go aux images clés espacées se déplace mal |

---

## 2. Principes

Inchangés :

- Tout reste **local** : le son et les images ne quittent le PC que dans un run Claude, comme les documents. Le son
  lui-même ne part jamais : Claude ne reçoit que du texte et des images.
- **Les fichiers sont l'état** : la transcription et les images sont dérivées ; les corrections humaines et les
  réglages sont de l'état.
- **Les sources sont des données** : `docId#t:mm:ss "quote"`, la citation se retrouve mot pour mot à son ancre, et les
  ancres restent stables d'une conversion à l'autre.
- Les processus, attentes et nettoyages passent par `src/shared/run/` ; rien qui demande les droits admin, un
  compilateur ou Python.
- Chaque capacité est une commande (CLI, MCP, HTTP) ; les réglages aussi.

Ajoutés par cette proposition :

- **Le temps est la coordonnée stable.** Une seconde de la vidéo ne change jamais ; le découpage en lignes, lui,
  dépend du modèle. Tout ce qui doit durer (ancres, corrections, images clés) s'accroche au temps.
- **L'humain gagne.** Ce qu'une personne a corrigé ou confirmé n'est jamais remplacé par une nouvelle passe machine.
- **Mesuré avant d'être adopté** (P7, déjà la règle des modèles de recherche) : moteur, modèle par défaut, réglages de
  nettoyage du son, seuils d'images — chacun gagne sur les vraies vidéos de l'équipe ou reste une option.

---

## 3. Transcription

### 3.1 Le moteur : hors du processus

**Proposition : `whisper.cpp`, téléchargé à la demande comme llama.cpp et ffmpeg** (épinglé par SHA-256, sans admin),
lancé par `src/shared/run/`.

- Un vrai processus : l'annulation le tue vraiment, sa mémoire n'est pas celle du serveur, et un plantage ne fait
  tomber que lui.
- Il sait faire ce dont on a besoin, vérifié dans l'aide de `whisper-cli` : VAD Silero (`--vad`, `--vad-model`, un
  petit modèle `ggml-silero-v6.2.0.bin` à télécharger avec), glossaire (`--prompt`, `--carry-initial-prompt`),
  horodatage par mot (`--dtw`), sortie JSON détaillée avec une probabilité par mot (`-ojf`), progression (`-pp`),
  détection de langue seule (`-dl`).
- Les modèles GGML sont des fichiers uniques, faciles à épingler et à reprendre en téléchargement.
- Le même dépôt fait tourner Parakeet (`parakeet-cli`, depuis la v1.9.0). Mesuré et écarté (§3.2, §11).
- **Un processus par travail, pas par passage.** La détection de langue par passage (§3.3) demande une transcription
  par passage de 10 s. Lancer `whisper-cli` à chaque fois recharge le modèle : 20 s au lieu de 3 s pour 2 minutes sur
  le GPU (§11). Le zip contient `whisper-server.exe`, qui garde le modèle chargé et reçoit les passages un par un sur
  le réseau local de la machine, avec leur langue. On le lance pour une conversion et on le tue à la fin ou à
  l'annulation, toujours par `src/shared/run/`. C'est encore « hors du processus ».

**Ce que la vérification a changé par rapport à la première version de ce plan :**

- **Les versions étiquetées n'ont pas de binaires.** La v1.9.5 (2026-10-06) ne publie que le code. Les binaires
  Windows sont attachés aux builds automatiques du même jour (`b5454`) : `whisper-bin-x64.zip` (9 Mo, CPU),
  `whisper-blas-bin-x64.zip` (22 Mo, CPU avec OpenBLAS), et deux builds CUDA (285 Mo pour CUDA 11.8, 685 Mo pour 12.4).
  On épingle donc un build `b…` par son SHA-256, et on en garde une copie sur le canal de l'équipe au cas où GitHub le
  retirerait.
- **Il n'y a pas de build Vulkan pour Windows.** Un PC sans carte NVIDIA (puce Intel ou AMD intégrée) n'a donc que le
  CPU, sauf si nous compilons nous-mêmes un build Vulkan une fois pour toutes (c'est permis : la règle interdit le
  compilateur chez le collègue, pas chez nous) — voir §9.
- **Contenu du zip, vérifié le 2026-11-10** (`whisper-bin-x64.zip` et `whisper-blas-bin-x64.zip` de `b5454`, SHA-256
  conformes) : `whisper-cli.exe`, `parakeet-cli.exe`, `whisper-vad-speech-segments.exe`, `whisper-server.exe`, et les
  DLL CPU par génération de processeur (comme llama.cpp). **`parakeet-cli` est rudimentaire** : `-m`, `-f`, `-t`,
  `-ng` / `-dev` (GPU), `-otxt`, `-of`, `-np`, et `-ps` qui imprime chaque segment et chaque jeton avec son temps de
  début et de fin et sa probabilité. Pas de JSON, pas de VAD, pas de choix de langue. L'horodatage existe donc, mais
  il faut lire cette sortie texte, faite pour le débogage et susceptible de changer d'une version à l'autre. La VAD se
  fait à part, avec `whisper-vad-speech-segments.exe` ou par notre propre découpage (§6.2).
- **CUDA et les cartes récentes** : les builds CUDA pour Windows x64 visent CUDA 11.8 et 12.4, plus anciens que la
  série RTX 50. **Essayé : le build 12.4 marche sur la RTX 5080 de ce PC** (compute capability 12.0). Le premier
  lancement compile les noyaux GPU à la volée, environ 24 s, puis le pilote les garde en cache. Le zip CUDA 12.4 pèse
  685 Mo : à télécharger seulement sur un PC qui a une carte NVIDIA.

**La commande visée** (un morceau de son, §6.2) :

```
whisper-cli -m <modèle> -f <morceau>.wav -l <langue> -t <cœurs physiques − 1>
            --vad --vad-model ggml-silero-v6.2.0.bin
            --prompt "<glossaire>" --carry-initial-prompt
            -ojf -of <sortie> -pp
```

transformers.js est retiré pour la parole une fois le moteur natif prouvé (pas deux implémentations).

### 3.2 Les modèles : un catalogue « Transcription »

Les entrées `kind: "speech"` du catalogue (`models/catalog.json`) deviennent une vraie famille, comme les modèles
d'embedding : épinglées, avec leur taille, leur licence, leur besoin mémoire et le niveau de PC visé.

| Entrée | Fichier | Rôle | Remarque |
|---|---|---|---|
| **Whisper large-v3-turbo q8** | 874 Mo | **Défaut** | Meilleur texte mesuré, en anglais comme en français. 1,2 à 1,3 Go de mémoire sur CPU, moins de 0,9 Go avec la carte. MIT |
| Whisper small q8 | 264 Mo | PC très modeste | 0,8 Go de mémoire. Nettement moins bon : pas toujours de ponctuation, « break » pour « brake », jargon déformé |
| Whisper large-v3 | 3,1 Go (1,08 Go en q5) | Pas proposé | Pas mesuré. Turbo s'en approche et va bien plus vite ; à ajouter seulement si la mesure sur le jargon le demande |
| Parakeet TDT 0.6B v3 | 669 Mo (q8) | **Écarté** | Mesuré : bascule en anglais sur une réunion en français, langue impossible à imposer, 4,8 Go de mémoire pour 6 minutes, pas de glossaire, sortie texte de débogage seulement |
| distil-large-v3-fr | GGML fourni | Écarté | Une seule langue, et peu de gain publié sur de longs enregistrements |

**La réalité du CPU, mesurée** (§11, Core Ultra 9 285K, VAD active) : turbo va 4 à 8 fois plus vite que le temps
réel sur 8 fils, et small 7 à 10 fois. Une heure de vidéo prend donc 8 à 15 minutes avec turbo sur un bon PC sans
carte graphique, et environ 2 minutes avec la carte NVIDIA. Un portable de collègue, avec 4 cœurs rapides, ira
probablement 2 à 3 fois moins vite que ce PC : à mesurer sur un vrai portable avant d'annoncer des durées. Le
calcul d'adéquation propose small quand turbo serait trop lent ou ne tiendrait pas en mémoire.

Le calcul d'adéquation au PC (`lib/fit/`) et le journal des temps (`perf/journal.jsonl`) s'appliquent : on connaît la
vitesse réelle (« ×3 le temps réel sur ce PC »), ce qui sert aussi à estimer la durée avant l'import (§6.6).

### 3.3 La langue parlée n'est pas la langue de génération

- Une **langue parlée** par document vidéo : `auto` (défaut), une langue, ou une liste de langues attendues.
  Le projet a un défaut ; le dialogue d'ajout et l'en-tête du document permettent de le changer.
- **Jamais une langue pour toute la vidéo.** Whisper ne détecte la langue que sur les 30 premières secondes de ce
  qu'on lui donne, puis la garde. Vu sur les vidéos Égypte (§11) :
  - une vidéo en anglais qui commence par un échange en allemand est détectée « allemand » (p = 0,88) ;
  - une vidéo presque muette est détectée « français » (p = 0,47) ;
  - un formateur qui parle anglais avec un accent est détecté « allemand » (p = 0,65) ;
  - forcé en anglais, Whisper **traduit** les phrases allemandes en anglais sans le dire (« please stop one of the
    brake stations »), ou les **supprime**.
- **La langue est détectée par passage.** La VAD découpe la parole ; les segments proches sont regroupés en passages
  d'environ 10 s ; chaque passage voit sa langue détectée puis est transcrit dans cette langue. Essayé (§11) : sur la
  même vidéo, les passages allemands sortent en allemand correct (« bitte mal eins der Drehgestelle absperren »,
  p = 0,98) et les passages anglais en anglais (p = 0,99 à 1,00).
- **Les passages très courts sont le point faible** : un juron de 2 s est pris pour de l'anglais avec p = 0,37. Sous
  un seuil de confiance (à régler, environ 0,6), le passage prend la langue de ses voisins, ou la plus probable des
  langues attendues.
- **Le contexte se perd quand on coupe** : seul, un passage a transformé « brake calculation » en « precalculation ».
  Chaque passage reçoit donc en `--prompt` la fin du passage précédent **dans la même langue**, plus le glossaire.
- Une liste de langues attendues (« anglais et allemand ») sert de garde-fou : une détection hors liste (du gallois
  sur un bruit de cabine) est refusée, et le passage repasse avec la langue la plus probable de la liste. Elle se
  propose d'elle-même : après une vidéo, les langues vues deviennent celles attendues du projet.
- **À quel point c'est polyglotte** : Whisper reconnaît environ 99 langues. Très bien : anglais, allemand, français,
  espagnol, italien, néerlandais, portugais. Correct : la plupart des autres langues européennes, le russe, le
  chinois, le japonais, l'arabe standard. Faible : l'arabe dialectal et les langues peu présentes sur Internet. Un
  mot anglais dans une phrase allemande (« der Brake Controller ») reste en général tel qu'il a été dit. Une phrase
  qui change de langue en son milieu prend la langue majoritaire du passage.
- Chaque ligne garde sa langue dans `video/<n>.json`.
- `doc.md` garde la langue d'origine : c'est elle qui est citable. Une traduction dans la langue du projet est
  produite par **Claude** (pas par Whisper : sa traduction ne va que vers l'anglais, et turbo ne la fait pas) et rangée
  dans `video/<n>.json` : indexée et affichée à côté, jamais citable. Un test généré en anglais peut donc citer une
  phrase dite en allemand ; la puce de source montre l'original et sa traduction. **Rien n'est perdu** : ni ce qui a
  été dit, ni ce que cela veut dire. Seuls les passages dans une autre langue que celle du projet sont traduits, par
  lots, dans le même run que le survol quand c'est possible : le coût reste petit.
- La recherche trouve une phrase dans une autre langue grâce aux embeddings multilingues déjà en place, et à la
  traduction indexée.
- **Arabe** : l'arabe dialectal (égyptien) est nettement moins bien reconnu que l'arabe standard. À mesurer sur un
  vrai enregistrement avant de promettre quoi que ce soit.

### 3.4 Accents et vocabulaire

**Le glossaire (Whisper)**

- Construit à partir du projet : codes, noms d'équipements, sigles et abréviations tirés des documents (index,
  `context.md`, titres, labels des figures). Visible et modifiable dans les réglages (§7).
- Trois faits qui décident de sa forme :
  - la limite est dure : 224 jetons, soit 60 à 80 termes. Il faut **choisir** : d'abord ce que Whisper ne peut pas
    deviner (codes, sigles, noms propres), classé par fréquence dans les documents ; jamais les mots courants ;
  - sans `--carry-initial-prompt`, le glossaire n'influence que la première fenêtre de 30 s, puis s'efface ;
  - c'est une influence, pas un dictionnaire : il rend « sectionneur » plus probable, il ne le garantit pas. Écrit
    comme une vraie phrase ponctuée, il donne aussi le ton (ponctuation, majuscules des sigles).
- Les codes dictés (« A deux cent quatre », « S douze ») sortent sous des formes variables. La citation reste ce qui
  a été entendu ; c'est la recherche qui rapproche « S 12 » de « S12 ».

**Contre les inventions**

- **VAD** avant transcription : les silences, la musique et le bruit de cabine ne sont pas donnés au modèle.
- **Liste noire** des hallucinations connues par langue (les phrases de sous-titrage citées en §1) : une ligne qui en
  est une, sans voix détectée autour, est retirée.
- **Filtres** : la même phrase répétée en boucle ; une ligne dont les mots sont très peu probables.

**Confiance par ligne**

- Elle vient des probabilités par mot (`-ojf`). Une ligne peu sûre est marquée « incertaine » (grisée dans la page).
  Citer une ligne incertaine donne un avertissement mécanique (`quote-uncertain`), qui disparaît une fois la ligne
  corrigée ou confirmée.
- Limite à connaître : cette confiance est mal calibrée — Whisper peut inventer avec aplomb. Un signal plus fiable :
  **l'écran comme témoin**. Claude lit déjà mot pour mot les textes visibles des images clés. Si l'écran affiche
  « Brake calculation » pendant que la ligne dit « precalculation », c'est une correction toute trouvée (§3.5). Le
  « second avis » d'un autre modèle (Parakeet) a été envisagé ; il est abandonné avec Parakeet (§3.2).

**Le son lui-même**

- Volume normalisé à l'extraction (enregistrements trop faibles) : presque toujours utile.
- Réduction de bruit : **à mesurer, pas à supposer**. Whisper a appris sur du son bruité ; un débruitage agressif
  lui enlève souvent plus qu'il ne lui donne.
- Piste son : `ffprobe` liste les pistes ; s'il y en a plusieurs, on les mélange par défaut, et le dialogue d'ajout
  permet d'en choisir une.

### 3.5 Corrections humaines

- Le testeur corrige une ligne directement dans la Transcription (clic, édition, Entrée). La correction est de
  l'**état** : `video/<n>.fixes.json`. Chaque correction porte **une plage de temps** (début, fin), le texte entendu
  par la machine à ce moment-là, le texte corrigé, l'auteur et la date.
- **La plage corrigée appartient à l'humain** : après une retranscription, ce que la machine redit dans cette plage
  est ignoré, le texte humain reste. Pas de « réapplication » fragile par comparaison de textes. « Confirmer » une
  ligne juste est la même chose, sans changer le texte.
- Claude peut **proposer** des corrections, jamais les appliquer seul, à partir de trois indices : le glossaire
  (« "section heure" ressemble à "sectionneur" »), les textes visibles à l'écran à ce moment, et les documents du
  projet. Une proposition montre son indice ; le testeur écoute les 5 secondes et accepte ou refuse.
- Une ligne corrigée ou confirmée n'est plus « incertaine ».

### 3.6 Mesurer avant de choisir

Comme `rag.eval` pour la recherche : un petit jeu de référence par langue, fait de 3 à 5 vraies vidéos du projet dont
5 minutes chacune sont transcrites à la main, avec les accents réels de l'équipe. Une commande compare les modèles
installés sur ce PC. Quatre chiffres, dans cet ordre d'importance pour nous :

1. **Rappel du jargon** : sur les termes du glossaire réellement prononcés, combien sortent bien écrits. Une étape de
   test cite le nom d'un équipement : c'est là qu'une erreur coûte.
2. **WER** après normalisation (casse, ponctuation, nombres) : la qualité générale.
3. **Erreur d'horodatage** : écart médian entre le début d'une phrase et son ancre. C'est la promesse « à la seconde ».
4. **Vitesse et mémoire** : fois le temps réel, pic de mémoire.

On choisit le défaut sur ces chiffres, pas sur des benchmarks publics. Le même jeu dit si le
débruitage et la quantification (q8, q5) valent leur coût.

**Une preuve de tuyauterie sans personne filmée** : une vidéo de synthèse de 20 secondes (mire ffmpeg, voix de
synthèse de Windows, texte connu, un bip à une seconde connue) dans les tests. Elle ne dit rien des accents, mais elle
prouve sur n'importe quel PC que le moteur tourne, que le texte sort et que les temps sont justes.

---

## 4. Sources à la seconde

L'essentiel existe : `t:mm:ss` pour ce qui est dit, `frame:mm:ss` pour ce qui est vu, et l'ouverture du lecteur au bon
moment. Il manque :

### 4.1 L'ancre est un moment (décision de format, à prendre en premier)

Aujourd'hui `t:04:30` n'est valide que si une ligne **commence** à 04:30 dans `doc.md`. Un autre modèle découpe
autrement, et la source meurt alors que la phrase est toujours dite au même instant.

Proposition :

- `t:04:30` désigne **la seconde 270 de la vidéo**. Elle se résout vers la ligne en train d'être dite à cette seconde.
  `doc.md` garde une ancre par ligne, à sa seconde de début, comme aujourd'hui.
- La citation est cherchée mot pour mot dans cette ligne et ses voisines proches (quelques secondes avant, jusqu'à la
  fin du passage). Le contrôle réécrit la source vers sa forme canonique : la seconde de début de la ligne où la
  citation commence.
- Le suffixe `-2` disparaît : deux lignes dans la même seconde sont départagées par la citation, pas par leur rang.
- **Après une retranscription**, rien à migrer dans le cas courant : même instant, mêmes mots, la source tient. Seules
  cassent les sources dont les mots ont changé — précisément celles qu'un humain doit revoir.
- Question liée, à trancher dans ARCHITECTURE.md : pour une ligne de parole, la ponctuation et la casse sont un choix
  du modèle, pas quelque chose qui a été dit (la mesure le montre : turbo ponctue parfois, parfois pas, §4.5). Comparer la citation aux mots seuls (sans ponctuation ni casse) éviterait
  de casser une source pour une virgule. C'est un assouplissement de « mot pour mot », limité aux transcriptions.

### 4.2 Le rapport de retranscription

Pour ce qui casse malgré tout : une retranscription produit un **rapport** (comme la migration des lots). Pour chaque
test qui cite la vidéo, la citation est cherchée dans une fenêtre de ±15 s autour de l'ancienne ancre ; si elle y est,
la source est réécrite ; sinon le test reçoit `source-missing` avec la phrase la plus proche et le moment à réécouter.
La transcription précédente est gardée jusqu'à ce que le rapport soit appliqué : rien n'est perdu.

### 4.3 Les plages : citer de 2:36 à 2:52

Une étape s'appuie rarement sur un seul instant : une manœuvre dure 15 secondes, une explication tient en 2 ou 3
phrases. Une source vidéo doit donc pouvoir viser **une plage précise à la seconde**.

**Décidé le 2026-11-10 : la citation d'une source vidéo est soit la parole, soit la description d'une image clé.**

- **Ce qui est dit** : `t:02:36..02:52`. La citation est le texte dit dans la plage, sur une ou plusieurs lignes.
- **Ce qui est vu** (une action filmée sans un mot) : `v:02:36..02:52`. La citation se retrouve mot pour mot dans la
  **description d'une image clé** dont le moment tombe dans la plage. Exemple : `v:02:36..02:52 "le sectionneur S12
  passe de fermé à ouvert"`, tiré de la description de l'image clé de 02:44.
- Conséquences de cette décision :
  - **les descriptions des images clés entrent dans `doc.md`**, sous la ligne de leur image, pour que la citation s'y
    retrouve comme toute autre. Aujourd'hui `doc.md` ne contient que le verbatim, et les descriptions restent dans
    `figures.json`, jamais citables. C'est une règle d'ARCHITECTURE.md qui change, à écrire avec la construction ;
  - une plage `v:` doit **contenir au moins une image clé**. S'il n'y en a pas, Claude en crée une au bon moment avec
    `media.frame` (§4.6) : l'image est extraite, décrite, puis citée ;
  - une description est une lecture de Claude, pas un fait brut. Elle reste « observée » (ce que le système fait, pas
    ce qu'il doit faire, comme les photos), et elle peut être fausse. Le testeur la vérifie en voyant la boucle
    (§4.4), et peut la **corriger** : la correction est de l'état, comme celle d'une ligne de parole (§3.5) ;
  - **redécrire les images** (`--force`, ou un meilleur modèle) peut changer le texte cité. Le même rapport que pour
    une retranscription (§4.2) réécrit ou signale les sources touchées, et une description corrigée par un humain
    n'est jamais remplacée ;
  - une description est d'autant plus citable qu'elle dit **ce qui change** d'une image à la suivante (§5.3) :
    « le voyant passe au rouge » se cite mieux que « une fenêtre avec une liste ».
- Les deux bornes se résolvent par le temps (§4.1) : elles survivent à une retranscription.
- Claude propose la plage en générant ; le testeur peut l'ajuster dans le lecteur (§4.4) en tirant ses bornes. La
  source est alors réécrite, comme toute correction de test.

### 4.4 Le lecteur maison : l'extrait en boucle

Cliquer une source vidéo ouvre un lecteur **fait pour vérifier une source**, sans quitter l'écran : dans Review, dans
Run, depuis une puce de source ou depuis l'onglet Vidéo du document. Le lecteur du navigateur ne sait ni boucler sur
une plage ni montrer où commence la source : c'est un composant du kit (le `Video` existant, étendu), pas un
`<video>` nu.

**Ce qu'il fait au clic sur une source 2:36 → 2:52**

- Il joue **de 2:32 à 2:56, en boucle** : la plage plus une marge de quelques secondes de chaque côté, pour entendre le
  début de la phrase et voir l'action se préparer. La marge vaut 4 s par défaut, réglable ; elle est plus courte au
  début et à la fin de la vidéo. L'horodatage d'un modèle de parole est juste à une ou deux secondes près (§11) : la
  marge couvre aussi cette imprécision.
- **La frise montre les trois zones** : la plage citée en couleur d'accent, les marges en plus pâle, le reste de la
  vidéo en gris. Le testeur voit tout de suite ce que la source affirme exactement.
- **Ce qui est dit défile sous l'image** : les lignes de la plage sont mises en avant, avec leur traduction quand la
  langue diffère (§3.3). Les chapitres sont marqués sur la frise.

**Sortir de la boucle, regarder ailleurs, revenir**

- Un bouton « Boucle » (et la touche `L`) l'arrête ou la relance. Cliquer ailleurs sur la frise, ou lire au-delà de
  la fin, **sort de la boucle** : on regarde librement toute la vidéo.
- Un bouton « Revenir à l'extrait » ramène à 2:32 et relance la boucle. La plage citée reste dessinée sur la frise
  tant que le lecteur est ouvert.
- Les commandes habituelles : lecture et pause (`Espace`), ±5 s (`←` `→`), image par image à l'arrêt (`,` `.`),
  vitesse ×0,5 / ×1 / ×1,5 (utile pour lire un écran qui change vite), plein écran, sous-titres oui ou non.
- **Ajuster la plage** : on tire les bornes de la zone citée sur la frise ; « Enregistrer » réécrit la source du test
  (§4.3).

**Les détails qui font la différence**

- **La boucle est précise à l'image** : l'évènement `timeupdate` ne passe que 4 fois par seconde, ce qui ferait
  déborder la boucle d'un quart de seconde. Le lecteur suit chaque image affichée (`requestVideoFrameCallback`,
  présent dans Chromium et Electron) et revient au début pile à la fin.
- **Le saut est immédiat** si la vidéo a des images clés rapprochées. Une capture d'écran en a parfois une toutes les
  10 s : chaque retour au début de la boucle attendrait alors une seconde ou plus. C'est une raison de plus pour la
  version allégée (§6.7), avec une image clé toutes les 2 s.
- **En survol**, sans clic : une vignette de l'image clé la plus proche et la première ligne citée. Le lecteur ne
  s'ouvre qu'au clic, il n'y a pas de son sans demande.
- Le testeur vérifie une source en 10 secondes : c'est le « incroyable » de ce plan.
- **Sous-titres** : la transcription devient une piste de sous-titres du lecteur (un fichier WebVTT dérivé), dans la
  langue d'origine et dans sa traduction ; les chapitres deviennent une piste de chapitres. Presque gratuit, et le
  testeur lit ce que la machine a compris pendant qu'il écoute — c'est aussi la meilleure façon de repérer une erreur.

### 4.5 Des lignes courtes et des temps justes

- Une ligne = une phrase au plus, coupée sur les temps par mot du moteur, pour qu'une ancre pointe à ±1 s près.
- **Le son recalé sur l'image** : à l'extraction, le son est complété pour commencer à 0 comme la vidéo (filtre
  `aresample=async=1:first_pts=0`), sinon toute la transcription est décalée (§1). Vérifié : avec ce filtre, le bip
  de l'essai de §1 sort à 3,70 s, sa vraie place.
- En mode VAD, le moteur retire les silences puis recale les temps. **Vérifié (§11)** : le même enregistrement placé
  deux fois dans un fichier, chaque fois après 90 s de silence, donne ses phrases à +0,7 s et +1,0 s de leur vraie
  place, sans dérive. Sur 18 minutes de réunion, l'écart médian avec une transcription sans VAD est de 0,4 s. Mais
  **les fins de ligne sont approximatives** en mode VAD (une ligne courte finit souvent pile 1,000 s après son début) :
  une plage `t:a..b` se ferme sur le début de la ligne suivante, pas sur cette fin.
- **La ponctuation n'est pas garantie** : sur la même réunion en français, turbo a rendu un texte sans aucun point ni
  virgule, alors qu'il ponctue l'anglais. Une ligne ne peut donc pas se couper sur la fin de phrase seule : elle se
  coupe sur la ponctuation quand il y en a, sinon sur une pause de la parole (les temps par mot), à 15 s au plus.

### 4.6 N'importe quelle seconde comme image

Aujourd'hui seules les images clés choisies à la conversion sont des ancres `frame:`. Une génération ou une analyse qui
a besoin de voir 07:12 l'extrait par `media.frame` (déjà un outil MCP) ; elle doit pouvoir en faire une ancre : l'image
est alors ajoutée aux images clés (fichier, description par Claude, ligne dans `doc.md`) et devient citable et
intégrable dans une étape.

---

## 5. Quand capturer les images

Le principe : **beaucoup de signaux peu coûteux sur toute la vidéo, puis Claude ne regarde en détail que là où ça
compte**, avec un budget qui grandit avec la durée.

### 5.1 Des candidates plus fines : les écrans stables

Une vidéo d'écran est une suite d'**écrans posés** séparés par des changements. Ce qu'on veut, c'est une image par
écran posé — pas l'image du changement lui-même, souvent à moitié dessinée.

- **Une passe légère sur toute la durée** : ffmpeg sort la vidéo en très petit (160 × 90, gris, 2 images par
  seconde), lue au fil de l'eau sans rien écrire sur disque. Pour chaque image, la différence avec la précédente est
  calculée **par case** d'une grille (8 × 8 par exemple). Cela donne, pour toute la vidéo, la courbe « quelque chose
  bouge ici ».
- **Une candidate par écran posé** : dès qu'une case a changé nettement et que l'image ne bouge plus pendant une
  demi-seconde, on retient ce moment. Un message dans un coin ou un voyant qui change de couleur est capté ; un menu
  est pris ouvert, pas en train de s'ouvrir.
- **Et la dernière image avant le changement** quand l'écran est resté longtemps posé : c'est l'état du formulaire
  juste avant le clic sur « Valider », souvent ce que l'étape de test décrit.
- On garde **où** ça a changé (les cases) : c'est ce qui permet de montrer le changement en grand à Claude (§5.2).
- **Faux positif connu : le curseur de la souris.** Un curseur qui se déplace fait changer deux cases. On l'écarte par
  la taille (moins qu'une case entière) et par le retour à l'identique de la case quittée. Le reste se règle sur les
  vraies vidéos, et Claude trie ensuite : mieux vaut une candidate de trop qu'une alarme ratée.
- **Vidéo filmée à la main** (cabine, pupitre) : rien n'est jamais « posé ». On le voit dans la courbe (tout bouge
  tout le temps) et on revient à la règle actuelle — changement de scène, plus une image à intervalle régulier — en
  prenant **la plus nette** dans la demi-seconde autour du moment choisi, pour éviter le flou de bougé.
- **Signaux de la parole** : le début d'un segment de parole, et les mots qui annoncent une action ou un état (« on
  clique », « vous voyez », « alarme », « valider », et leurs équivalents dans la langue parlée) placent une candidate à
  ce moment et juste après.
- **Plancher régulier** adapté à la durée : toutes les 5 s pour une vidéo courte, plus espacé pour une longue.
- **Plafond** de candidates (par exemple 600) : au-delà, on garde les plus fortes variations par tranche de temps,
  jamais une réduction uniforme qui ferait disparaître un événement bref.
- **Couleurs** : une vidéo HDR (signalée par `ffprobe` : `color_transfer` vaut `arib-std-b67` ou `smpte2084`) est
  convertie en couleurs normales à l'extraction (`zscale` + `tonemap`, présents dans le ffmpeg épinglé).

**Premier pas sans rien écrire de neuf : `mpdecimate`, plus la règle de l'écran posé.** Essai du 2026-11-10 sur un
écran de synthèse de 12 s (un curseur qui bouge de 1 à 2 s, une alarme de 40 px à 4 s, un nouveau menu à 8 s) :

| Méthode | Ce qu'elle retient |
|---|---|
| Seuil de scène > 0,3 (aujourd'hui) | 8 s seulement : l'alarme est ratée |
| `freezedetect` | « immobile de 0 à 8 s » : l'alarme est ratée (il juge l'image entière) |
| `mpdecimate` | 0 s, **4 s**, 8 s… et les 26 images du curseur en mouvement |
| `mpdecimate` + écran posé ≥ 0,5 s | 0 s, 2,04 s (curseur parti), 4 s, 8 s ; 2,04 s est identique à 0 s et tombe à la comparaison avec l'écran posé précédent |

`mpdecimate` voit les petits changements parce qu'il compare par blocs de 8 × 8 pixels, et la règle de l'écran posé
élimine le curseur sans le reconnaître. Les deux sont dans le ffmpeg épinglé (7.1.1 « essentials »), ainsi que
`blurdetect` pour choisir l'image la plus nette d'une vidéo filmée à la main. La passe par grille décrite plus haut ne
vient que si `mpdecimate` déçoit sur de vraies vidéos (compression bruitée, horloge qui tourne à l'écran : une
horloge change chaque seconde et rend l'écran jamais « posé », à exclure par zone).

### 5.2 Un survol en deux niveaux

1. **Plan** : Claude lit la transcription **entière** et une mosaïque peu dense de toute la vidéo. Il rend les
   chapitres. La transcription tient largement : 2 heures de parole font environ 110 000 caractères, soit 30 à 35 000
   jetons. Plutôt que de la coller dans le prompt, on lui donne le fichier à lire (ou `media.transcript`). Les
   chapitres peuvent même sortir de la transcription seule, avant toute image : de la valeur plus tôt (§6.7).
2. **Détail par chapitre** : pour chaque chapitre, ses candidates, et le droit d'appeler `media.frame` pour voir un
   moment en grand (budget fixé, par exemple 10 appels par chapitre). Il rend les moments à garder.

- **Aucune mosaïque ne rend un écran lisible**, autant le dire : un écran de 1920 px réduit à une vignette de 430 px
  ne se lit pas plus qu'à 320 px. La mosaïque sert à voir *qu'*il se passe quelque chose et où ; pour **lire**, il faut
  des pixels réels. D'où :
  - **le recadrage du changement** : pour chaque candidate, la zone qui a changé (connue par §5.1) est montrée à sa
    taille réelle à côté de la vignette entière. Claude lit le message d'alarme ou le libellé du bouton sans demander
    l'image complète ;
  - moins de vignettes par mosaïque (3 × 3), en restant sous la taille au-delà de laquelle une image est réduite avant
    d'arriver à Claude (environ 1 500 px de grand côté sur la plupart des modèles ; à mesurer avec ce que `Read`
    transmet réellement).
- **Budget d'images clés selon la durée** : environ 40 par demi-heure, plafonné (par exemple 150), au lieu de 40 quelle
  que soit la durée.
- **Sans Claude** : les moments les plus forts selon les signaux de 5.1, répartis sur les chapitres, au lieu de 12
  images à intervalles réguliers.

### 5.3 Décrire avec le contexte

Chaque image clé est décrite avec :

- les lignes dites dans les ±10 s et le titre de son chapitre : « l'opérateur ouvre le menu Sectionneurs » au lieu de
  « une fenêtre avec une liste » ;
- **la description de l'image clé précédente** : Claude dit alors *ce qui a changé* (« le sectionneur S12 passe de
  fermé à ouvert, le voyant devient rouge »). C'est exactement la matière d'une étape et de son résultat attendu.

---

## 6. Vidéos lourdes ou longues, sans rien faire tomber

### 6.1 Tout ce qui est lourd tourne hors du serveur

`whisper-cli` et `ffmpeg` sont des processus lancés par `src/shared/run/`. Le serveur ne charge jamais le son ni un
modèle de parole. Une annulation tue vraiment le travail.

- **Priorité basse** pour que le PC reste utilisable : `src/shared/run/` l'applique au lancement (Node sait le faire
  sous Windows, sans admin).
- **Nombre de fils** : les cœurs physiques moins un, pas les cœurs logiques (au-delà, whisper.cpp ralentit). Attention
  aux processeurs Intel récents à deux types de cœurs : Windows envoie volontiers un travail en priorité basse sur les
  cœurs lents. À mesurer à l'étape 0 ; si la perte est forte, la priorité basse devient un réglage.

### 6.2 Découper, sauvegarder chaque morceau, reprendre

- Le son est découpé par ffmpeg en morceaux d'environ 10 minutes. **Les points de coupe viennent de ffmpeg lui-même**
  (`silencedetect` : il liste les silences sans aucun modèle) : on coupe au milieu d'un silence d'au moins une
  demi-seconde, donc sans chevauchement ni phrases à recoller. S'il n'y a aucun silence dans la fenêtre (bruit de
  cabine continu), on coupe quand même, avec 2 secondes de chevauchement, et les lignes en double sont retirées par
  leur temps.
- Chaque morceau est un fichier WAV temporaire sur disque, jamais un tableau en mémoire.
- Chaque morceau transcrit est sauvegardé (`video/<n>/transcript/<k>.json`) puis assemblé : une coupure reprend au
  morceau suivant, pas au début.
- Chaque morceau sauvegardé porte **ce qui l'a produit** (modèle, langue, glossaire, plage de son). Changer le
  glossaire ou le modèle refait les morceaux concernés ; ne rien changer ne refait rien.
- Même logique pour les candidates : par tranches, chacune sauvegardée.

### 6.3 Progression réelle

« Transcription 14/24 · environ 12 min restantes », calculé à partir de la vitesse mesurée sur ce PC (journal des
temps). ffmpeg rapporte son avancement (`-progress`), whisper-cli aussi (`-pp`), et `run` sait déjà lire un processus
ligne par ligne (`onLine`) ; plus de « Listening to… » muet.

### 6.4 Délais proportionnels

Plus de délai fixe de 30 min : une limite proportionnelle à la durée de la vidéo et à la vitesse mesurée, plus une
alarme « plus de nouvelles depuis 2 min » fondée sur la progression, qui détecte un processus bloqué même sur une
vidéo de 3 h.

**La mise en veille n'est pas un blocage.** Un portable qui s'endort au milieu d'une conversion de 45 minutes se
réveille avec une horloge qui a sauté : ni le délai ni l'alarme ne doivent se déclencher pour ça. Au réveil, le morceau
en cours continue ou est refait ; les morceaux déjà faits restent.

### 6.5 Ressources gouvernées

- **Une seule transcription à la fois sur le PC**, indépendamment des emplacements de conversion : elle occupe tout le
  CPU ou le GPU. Les autres attendent (« En attente de transcription »).
- Avant de charger un modèle, on vérifie la mémoire libre avec le calcul d'adéquation déjà utilisé pour les modèles
  d'embedding. S'il ne tient pas, on le dit et on propose le modèle plus léger.
- **Espace disque** vérifié avant la copie : vidéo, version allégée (6.7), images et sons temporaires.
- Décodage des images : accélération matérielle quand elle existe (`d3d11va`, commune à toutes les cartes sous
  Windows), réduction de taille dès le décodage, et premier passage sur les images clés du codec (`-skip_frame nokey`)
  pour les très longues vidéos.

### 6.6 Prévenir avant d'importer

Le dialogue d'ajout affiche, après `ffprobe` : la durée, le poids, la langue choisie et une **estimation de la durée
de conversion sur ce PC** (« ≈ 12 min sur ce PC ; ≈ 2 min avec la carte graphique »), ainsi que **la
part de Claude** (« environ 9 runs, 150 images »). Au-delà d'un seuil (par exemple 2 h), il le signale et propose de
ne transcrire qu'une plage.

### 6.7 Valeur tôt, finition ensuite

Ordre de travail : `ffprobe` → la vidéo est **lisible tout de suite** dans la page → la transcription arrive morceau
par morceau, consultable et cherchable à mesure (une mise à jour de l'index par lot de morceaux) → chapitres (à partir
de la transcription seule) → candidates → survol → images clés → descriptions.

- **Version allégée pour la page, seulement quand il le faut.** Chromium lit le HEVC depuis sa version 107 quand la
  carte graphique du PC le décode (toutes celles d'après 2016 environ) : beaucoup de `.mov` d'iPhone passeront tels
  quels. **Vérifié le 2026-11-10 dans la fenêtre Electron** (Electron 45, Chromium 156) : sur ce PC, un HEVC 8 bits
  en `.mp4` et un HEVC 10 bits HDR en `.mov` se lisent. Sans décodage matériel, `canPlayType` répond une chaîne vide et
  le lecteur échoue proprement (erreur 4, « no supported streams »), sans planter. La page sait donc le détecter :
  **si** la vidéo ne se lit pas, ou si ses images clés sont trop espacées pour s'y déplacer, une copie H.264 720p est
  produite en arrière-plan, avec une image clé toutes les 2 secondes pour que le saut à une ancre soit immédiat.
  L'original reste la source pour les images en pleine résolution.

---

## 7. Réglages

Tout réglage est une commande (`project set`, `models …`), donc aussi accessible à Claude et au CLI.

**Settings › Models › Transcription** (nouvelle partie, à côté de Embedding et Reranker)
- Les modèles du catalogue : installé ou non, taille, licence, langues, adéquation à ce PC (« recommandé », « juste »,
  « trop gros »), vitesse mesurée ici (« ×4 le temps réel »).
- Télécharger, supprimer, choisir le modèle actif.
- Le moteur (build whisper.cpp, CPU ou CUDA) et ffmpeg : état, version, téléchargement, comme le build llama.cpp.
- « Mesurer » : le jeu de référence de §3.6 sur les modèles installés.

**Settings › Project › Vidéos**
- Langue parlée par défaut : `auto`, une langue, ou une liste.
- Glossaire de transcription : construit à partir des documents, modifiable, avec un aperçu du prompt et le compte de
  jetons restants.
- Langues attendues (§3.3) : proposées d'après les vidéos déjà converties.
- Densité des images clés (sobre, normale, détaillée), qui fixe le budget de §5.2.
- Traduction des transcriptions dans la langue du projet : oui ou non.

**Par document** : langue parlée, piste son et plage à transcrire, à l'ajout et dans l'en-tête du document.

---

## 8. Étapes proposées

Chaque étape se livre seule et se prouve (tests unitaires sur le mock, plus une vraie vidéo sur ce PC Windows).

0. **Mesure à la main : faite le 2026-11-10** (§11). Moteur : whisper.cpp. Modèle : turbo. GPU : le build CUDA 12.4
   marche sur une RTX 50. Parakeet : écarté. Langues : détection par passage. Reste deux points : la qualité sur le
   jargon, qui demande 5 minutes transcrites à la main par vidéo de référence, et la vitesse sur un vrai portable de
   collègue. Le ffmpeg épinglé lui-même n'a toujours pas été lancé (les essais ont utilisé le ffmpeg 8.1.2 installé).
1. **Format des sources** : l'ancre est un moment, la résolution par le temps, la comparaison des citations de parole.
   (§4.1) C'est petit, et c'est la seule étape qui coûte plus cher chaque semaine où on attend.
2. **Robustesse** : moteur hors processus, son recalé sur l'image, découpage, reprise par morceau, progression, délais
   proportionnels, une transcription à la fois, la vidéo de synthèse dans les tests. (§6.1 à 6.5, §4.5)
3. **Modèles, langues et réglages** : catalogue Transcription, Settings › Models › Transcription, `whisper-server`
   pour le travail, détection de la langue par passage, traduction par Claude. (§3.1 à §3.3, §7)
4. **Qualité de la parole** : glossaire, liste noire, confiance par ligne, corrections humaines, jeu de référence.
   (§3.4 à 3.6)
5. **Sources à la seconde** : plages (parole et images), le lecteur maison (extrait en boucle avec marges, sortie et
   retour, bornes ajustables), rapport de retranscription, sous-titres, n'importe quelle seconde comme image.
   (§4.2 à 4.6)
6. **Captures** : écrans stables, recadrage du changement, survol en deux niveaux, budget selon la durée, descriptions
   avec contexte. (§5)
7. **Confort** : estimation avant import, valeur tôt, version allégée quand il le faut. (§6.6, §6.7)

---

## 9. Questions ouvertes

- **Les vraies vidéos** : en partie répondu (§11). SOSIE : téléphone, HEVC 1080p, de 3 s à 2 min 30, français, et
  des réunions enregistrées de 6 à 19 min. Égypte : 163 vidéos (33 Go), H.264 1080p d'environ 5 min, anglais avec
  accent et passages en allemand, certaines presque muettes. La plupart des projets parleront anglais. Reste : 5
  minutes transcrites à la main par l'équipe sur 3 de ces vidéos, pour mesurer le jargon.
- **GPU** : quelle part des PC des collègues a une carte NVIDIA ? Avec elle, une heure de vidéo prend environ 2
  minutes ; sans elle, 8 à 15 minutes sur un bon PC, sans doute plus sur un portable. Un build Vulkan de whisper.cpp,
  compilé une fois par nous, accélérerait les puces Intel et AMD : à envisager seulement si la lenteur gêne vraiment.
- **Ponctuation des citations de parole** : comparer les mots seuls (§4.1) ? C'est toucher à une règle qui ne plie
  pas ; la décision s'écrit dans ARCHITECTURE.md.
- **Corrections humaines** : l'équipe les fera-t-elle, ou faut-il surtout que Claude propose ?
- **Qui parle** : distinguer le formateur de l'opérateur aiderait à lire une transcription de réunion. whisper.cpp ne
  le fait pas vraiment ; ce serait un second outil. Hors périmètre tant que personne ne le demande.
- **Son seul** : un `.mp3` ou un `.m4a` (mémo vocal, réunion audio) est aujourd'hui refusé. Avec ce plan c'est la même
  chaîne sans les images : à ajouter à l'étape 2 ou à laisser ?
- **Disque** : la version allégée et les images ajoutent du poids par vidéo ; un plafond par projet ?
- **Confidentialité** : les images et la transcription partent dans les runs Claude, comme les documents ; le son
  jamais. Mais une vidéo montre des visages et porte des voix et des noms de collègues : ce sont des données
  personnelles. Faut-il une option « jamais à Claude » pour certaines vidéos, et prévenir à l'ajout ?

---

## 10. Faits vérifiés le 2026-11-10, et ce qui reste à voir sur le PC

**Vérifié en ligne**

- whisper.cpp : dernière version v1.9.5 (2026-10-06), sans binaires ; binaires Windows sur le build `b5454` du même
  jour, sans Vulkan ([versions](https://github.com/ggml-org/whisper.cpp/releases)). Options de `whisper-cli` citées en
  §3.1 : [aide de la commande](https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/README.md). Le dépôt
  contient `examples/parakeet-cli` et `examples/vad-speech-segments`.
- Tailles des modèles Whisper GGML : [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp). Mémoire :
  tableau du README (small ~852 Mo, large ~3,9 Go ; turbo n'y figure pas).
- Parakeet TDT 0.6B v3 : 25 langues européennes, détection de langue, horodatage par mot, CC BY 4.0, WER français
  annoncés ([carte NVIDIA](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)) ; fichiers pour whisper.cpp
  ([ggml-org/parakeet-GGUF](https://huggingface.co/ggml-org/parakeet-GGUF)) ; vitesse CPU annoncée par
  [sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html)
  (son encodeur 8 bits pèse 622 Mo, pas 490).
- WER français de Whisper et de distil-large-v3-fr, licence MIT, fichier GGML :
  [carte du modèle](https://huggingface.co/eustlb/distil-large-v3-fr).
- HEVC dans Chromium : décodage matériel activé par défaut depuis la version 107.

**Vérifié sur ce PC le 2026-11-10** (RTX 5080 et puce Intel intégrée, Core Ultra 9 285K, 64 Go)

- Les zips `b5454` de whisper.cpp (CPU, BLAS, CUDA 12.4), le ffmpeg épinglé et les modèles (small q8, turbo q8,
  Parakeet q8, Silero v6.2.0) se téléchargent, et leurs SHA-256 sont conformes (GitHub, Hugging Face et le code).
- Les mesures des moteurs sur de vraies vidéos : §11.
- Le ffmpeg épinglé contient `zscale`, `tonemap`, `mpdecimate`, `freezedetect`, `blurdetect`, `silencedetect`,
  `loudnorm`, et le décodage `d3d11va` (lu dans le binaire, sans le lancer).
- Avec le ffmpeg 8.1.2 déjà installé sur ce PC : le décalage du son et son correctif (§1, §4.5), et la détection des
  petits changements, le curseur et l'écran posé (§1, §5.1). Le dHash testé est celui du code de Testimus.
- Electron 45 lit le HEVC 8 et 10 bits sur ce PC, et échoue proprement sans décodage matériel (§6.7).
- Réseau de l'entreprise : `curl` sous Windows refuse GitHub tant qu'on ne désactive pas le contrôle de révocation
  des certificats (`--ssl-no-revoke`). Node n'a pas ce contrôle, donc les téléchargements de Testimus ne sont pas
  touchés ; un script d'installation en PowerShell ou en `curl`, si.

**Reste à voir**

- La qualité chiffrée sur le jargon : il faut une transcription faite à la main pour comparer (§3.6). Les avis du §11
  sont des lectures, pas des mesures.
- La vitesse sur un vrai portable de collègue, sans carte NVIDIA.
- Le ffmpeg épinglé (7.1.1) lancé pour de vrai sous Windows ; les essais ont utilisé le 8.1.2 installé sur ce PC.
- L'arabe égyptien, s'il y a des enregistrements.
- Les couleurs d'un vrai `.mov` HDR d'iPhone après `tonemap` (les vidéos SOSIE sont en SDR).
- La taille à laquelle une image arrive réellement à Claude par `Read`.

---

## 11. Mesures du 2026-11-10 sur de vraies vidéos

Sur ce PC (RTX 5080, Core Ultra 9 285K, 64 Go). whisper.cpp `b5454`, modèles quantifiés en 8 bits, VAD Silero v6.2.0
active, langue imposée sauf mention contraire. Temps de bout en bout, chargement du modèle compris ; mémoire = pic du
processus. Les fichiers sont restés sur ce PC ; rien n'est parti ailleurs.

**Les enregistrements**

| Nom | Projet | Contenu | Durée |
|---|---|---|---|
| PCC 1 | SOSIE, `06-PCC NG` | Vidéo de téléphone (HEVC 1080p), formateur au PCC, français | 35 s |
| Réunion A, B | SOSIE, `11-Traction` | Réunions enregistrées (mp3), français, plusieurs voix | 6 min 35, 18 min 39 |
| DMI | Égypte (Bureau) | Démonstration au DMI, anglais avec accent, passages en allemand | 2 min 06 |
| Desiro 1–4 | Égypte, `20231025_Desiro_Wegberg` | Explications en cabine (H.264 1080p), anglais, un échange en allemand | 4 min 27 à 5 min 44 |

**Vitesse et mémoire**

| Modèle | Matériel | Enregistrement | Temps | × temps réel | Mémoire |
|---|---|---|---|---|---|
| turbo | CPU, 8 fils | Réunion A (6 min 35) | 90 s | ×4,4 | 1,3 Go |
| turbo | CPU, 8 fils | DMI (2 min 06) | 17 s | ×7,6 | 1,2 Go |
| turbo | GPU, 1er lancement | Réunion A | 34 s | ×12 | 0,8 Go |
| turbo | GPU | Réunion A | 9,7 s | ×41 | 0,6 Go |
| turbo | GPU | Réunion B (18 min 39) | 34 s | ×33 | 0,7 Go |
| turbo, sans VAD | GPU | Réunion B | 38 s | ×29 | 0,8 Go |
| small | CPU, 8 fils | Réunion A | 54 s | ×7,3 | 0,8 Go |
| small | CPU, 4 fils | Réunion A | 78 s | ×5,1 | 0,8 Go |
| small | CPU, 8 fils | Réunion B | 115 s | ×9,7 | 0,9 Go |
| Parakeet | CPU, 8 fils | Réunion A | 43 s | ×9,2 | **4,8 Go** |
| Parakeet | CPU, 8 fils | DMI | 6,9 s | ×18 | 1,5 Go |
| Parakeet | GPU | DMI | 2,9 s | ×43 | 0,4 Go |

La mémoire de Parakeet grimpe avec la longueur du morceau (toute l'attention à la fois) : 1,5 Go pour 2 min, 4,8 Go
pour 6 min 35. Whisper reste stable, il travaille par fenêtres de 30 s.

**Ce qu'ils écrivent** (lecture, pas mesure)

- **Anglais avec accent (DMI)** : turbo est le meilleur. Phrases ponctuées, une par ligne, « brake calculation »
  juste, « 203 now to 184 » juste. Small écrit sans ponctuation et met « break » pour « brake ». Parakeet fait plus de
  fautes (« prey calculation ») et saute des phrases.
- **Français, réunion (A)** : turbo est le plus juste (« grosso modo », « un terminus », « PR2 », « la machine de
  départ »), mais sans aucune ponctuation. Small ponctue mais déforme plus (« à l'inverse » pour « à un terminus »).
  **Parakeet écrit de l'anglais** (« The formator assigned an estudiant to a terminus »), même sur un passage de 30 s.
- **Français, vidéo PCC (1)** : Parakeet est correct et même un peu meilleur que small (« JO » là où small écrit
  « Jio ») : sa bascule en anglais dépend de l'enregistrement, ce qui la rend imprévisible.
- **Allemand dans une vidéo anglaise** : forcé en anglais, Whisper traduit l'allemand ou le supprime. Parakeet le
  transcrit en allemand, mais mélange les deux langues dans la même phrase.

**Langue détectée sur toute la vidéo** (turbo, 30 premières secondes) : Réunions et PCC en français, 0,89 à 0,94 ;
DMI « allemand » 0,65 ; Desiro 1 « français » 0,47 (presque pas de parole) ; Desiro 2 « allemand » 0,88 (commence par
un échange en allemand) ; Desiro 3 et 4 anglais, 0,68 et 0,99. Trois vidéos anglaises sur cinq auraient été
transcrites dans la mauvaise langue.

**Langue détectée par passage** (prototype : VAD, passages de 10 s au plus, un `whisper-cli` par passage, GPU)

| Passage | Langue détectée | Texte |
|---|---|---|
| DMI 00:05 | de 1,00 | So, dann bitte mal |
| DMI 00:15 | de 0,98 | bitte mal eins der Drehgestelle absperren. |
| DMI 00:21 | en 0,88 | It's not working correctly? |
| Desiro 2, 00:00 | de 0,81 | Mach nicht die Bremse, ne? Ja, mach die zurück. |
| Desiro 2, 00:09 | en **0,37** | She's a... (un juron allemand de 2 s, mal détecté) |
| Desiro 2, 00:17 | de 0,70 | Okay. Gut, danke, das funktioniert. […] |
| Desiro 2, 00:28 | en 0,99 | So focus is here on this. It was a mistake with the Stopcocks. […] |

Un processus par passage coûte cher : 20 s pour la vidéo DMI de 2 minutes, contre 2,6 s en un seul lancement, d'où
`whisper-server` (§3.1).

**Temps en mode VAD** : l'enregistrement DMI placé deux fois dans un même fichier, chaque fois après 90 s de silence.
« You have to confirm this » tombe à +0,7 s puis +1,0 s de sa place attendue, « failure without isolation » à −0,5 s
et −1,5 s : à une ou deux secondes près, sans dérive au fil du fichier. Réunion B, avec et sans VAD : sur 67 lignes
identiques, écart médian 0,4 s, 90 % sous 2 s, et une seule à 14,6 s (un découpage différent).
