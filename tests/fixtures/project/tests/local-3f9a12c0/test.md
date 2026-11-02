---
project: LFRPS12
summary: Sectionneur avec TK — manœuvre régulière
folder: /Traction/Sectionneurs
labels: []
review: to-fix
review_note: "Le step 2 doit vérifier que seul Propriétés est proposé."
reviewed_by: tester
reviewed_at: 2026-10-31T15:20:00.000Z
generated_by: gen-tests-1a2b3c4d
---

## Description

Vérifie le menu contextuel d'un sectionneur avec télécommande (TK) manœuvré régulièrement.

## Step 1

### Action

Ouvrir la vue de traction et repérer un sectionneur avec TK.

### Expected Result

Le sectionneur est affiché avec le symbole du sectionneur.

### Exigence

EXI_MOP_SPF_511_A_1650

### Sources

- SOSIE_211_D401-1_3#req:EXI_MOP_SPF_511_A_1650 "Le sectionneur est représenté sur la schématique de traction"

## Step 2

### Action

Clic droit sur le sectionneur avec TK.

### Expected Result

Le menu contextuel s'ouvre.

### Exigence

EXI_MOP_SPF_511_A_1670

### Sources

- SOSIE_211_D401-1_3#§5.6.6 "un sectionneur avec TK manœuvré régulièrement ne propose que Propriétés"
