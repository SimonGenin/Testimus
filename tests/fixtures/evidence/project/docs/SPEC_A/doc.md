# SPEC_A — Spécification A

## 1 Généralités <!-- § 1 -->

Ce document décrit le poste de commande. Voir le chapitre 3.2 pour les commandes, cf. 2.1 pour l'affichage.

### 1.1 Objet <!-- § 1.1 -->

Le simulateur reproduit le poste de commande centralisé de la ligne.

## 2 Affichage <!-- § 2 -->

### 2.1 Vue ligne <!-- § 2.1 -->

**EXI_MOP_SPF_100_A_10**

La vue ligne affiche tous les postes de redressement de la ligne :

- les postes en service sont en vert
- les postes hors service sont en gris

EXI_MOP_SPF_100_A_20 : La vue ligne se rafraîchit toutes les secondes.

![Figure 1 – Vue ligne complète](figures/fig-1.png) <!-- fig 1 -->

Le poste clignote en cas de défaut. Le poste clignote en cas de défaut.

### 2.2 Vue détaillée <!-- § 2.2 -->

La vue détaillée reprend les éléments du § 2.1 et renvoie à SPEC_B §4.1 pour les alarmes.

**EXI_MOP_SPF_100_A_30**

**EXI_MOP_SPF_100_A_40**

La vue détaillée s'ouvre par un double clic sur le poste.

## 3 Commandes <!-- § 3 -->

### 3.2 Ouverture <!-- § 3.2 -->

L'ouverture d'un disjoncteur demande une confirmation de l'opérateur.

## 6 Couverture des exigences <!-- § 6 -->

### 6.1 Exigences <!-- § 6.1 -->

Ce document répond aux exigences suivantes :

| **Code Exigence** | **Objet** | **Section** |
| --- | --- | --- |
| EXI_MOP_SPF_100_A_10 | La vue ligne affiche tous les postes de redressement de la ligne. | 2.1 |
| EXI_MOP_SPF_100_A_20 | La vue ligne se rafraîchit toutes les secondes. | 2 |
| EXI_MOP_SPF_100_A_30 | La vue détaillée affiche l'état du poste sélectionné. | 2.2 |
| EXI_MOP_SPF_100_A_40 | La vue détaillée s'ouvre par un double clic. | 3.2 |
| EXI_MOP_SPF_900_A_1 | Le simulateur enregistre chaque commande de l'opérateur. | 3.2 |
| EXI_MOP_SPF_900_A_2 | Les commandes refusées sont signalées à l'opérateur. | À compléter |
