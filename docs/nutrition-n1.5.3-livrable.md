# N1.5.3 — Meilleure solution faisable + explication des écarts

Branche `feat/nutrition-structured-meals`. **Aucune migration**, aucun `db push`, aucun commit,
aucun push, **aucun transfert Mac** — ce rapport le précède.

| | |
|---|---|
| Tests N1.5 / N1.5.1 / N1.5.2 / N1.5.3 | **112**, 0 échec (91 → 112 : **21 tests BEST / KKT / UNIT**) |
| Contrôles négatifs N1.5.3 | **14 / 14 discriminants**, md5 vérifié |
| Vérification KKT | **120 solutions** balayées, 0 violation duale (tolérance 1e−9) |
| Checklists SQL rejouées | N1.1 · 107, N1.3 · 43, N1.5.1 · 46, N1.5.2 · 50 — toutes vertes |
| Suites N1.2 / N1.3 / N1.4 / A5 | vertes |
| Batterie complète | **100 suites** — 92 vertes, **8 rouges pré-existantes, identiques à avant le lot** |
| Responsive 375 / 390 / 430 / 768 / 1440 | **0 débordement**, banc lui-même contrôlé |
| `tsc --noEmit` · `eslint .` · `git diff --check` | exit 0 |
| Migrations sur disque | **76 — inchangé** |

---

## 1. Ce que le lot corrige vraiment

Ton §1 avait raison de refuser un lot UI seul. Mesuré **avant** ce lot, banc terrain poulet/riz :

```
Riz basmati cuit   q = 0,0   PLANCHER   gradient = −72,1
```

Le riz — principale source de glucides du repas — était collé à zéro alors qu'il **manquait
129 g de glucides**, et rien ne pouvait plus l'en sortir. L'écran, lui, masquait tout.

Deux défauts, donc, et le second était le vrai :

1. `QuantitesDuRepas` remplaçait la liste des grammes par un paragraphe dès que le statut valait
   `impossible` ;
2. **le solveur ne rendait pas la meilleure solution faisable.** Son « clamp-and-resolve » figeait
   une variable à sa borne et ne la relâchait **jamais** : il satisfaisait la condition **primale**
   (`min ≤ q ≤ max`) et ignorait la condition **duale**.

---

## 2. Les trois bancs terrain, avant et après

Valeurs Ciqual réelles. **Le « avant » n'est pas reconstitué : c'est le fichier de ton Mac**
(`meal-choice-solver.ts`, md5 `bf0f10ad…`, sans `choisirRelâchement`), exécuté côte à côte avec le
nouveau.

```
banc A AVANT exact       Flocons 149 · Beurre 0 · Fblanc 160 · Oeuf 207 · Sirop 0
banc A APRÈS exact       Flocons 149 · Beurre 0 · Fblanc 160 · Oeuf 207 · Sirop 0
                         → IDENTIQUE, au gramme près

banc B AVANT impossible  Boeuf 208 · Patate   0 · Tomate 300 · Poivron 0 · Jus   0
                         résultat P59 G14 L14   écarts P−4,2  G+78,9  L+17,6
banc B APRÈS impossible  Boeuf 191 · Patate 272 · Tomate 300 · Poivron 0 · Jus 300
                         résultat P60 G92 L14   écarts P−5,2  G +0,9  L+18,2

banc C AVANT impossible  Poulet 255 · Riz   0 · Soja 0 · Carotte   0 · Jus 300
                         résultat P76 G29 L26   écarts P−5,5  G+129,2 L+16,5
banc C APRÈS impossible  Poulet 235 · Riz 300 · Soja 0 · Carotte 300 · Jus 300
                         résultat P82 G143 L25  écarts P−11,7 G +15,0 L+17,3
```

**Banc B : 78,9 g de glucides manquants → 0,9 g.** **Banc C : 129,2 → 15,0.**

**Banc A n'a pas bougé d'un gramme**, et ce n'était pas un espoir : l'audit avait mesuré résidu 0
et tous gradients nuls, donc un point déjà optimal, structurellement insensible au relâchement.
`KKT-01` épingle maintenant les cinq quantités `[149, 0, 160, 207, 0]` et
`releasedOrder.length === 0`.

**⚠️ Ces chiffres diffèrent de ceux de mon audit** (banc C : 8,7 g au lieu de 15,0). L'audit
modélisait les jus en `ml`, plafond 500. L'audit d'unités du §14 a établi que c'était **faux** —
voir § 6. Les bancs ci-dessus sont en `g`, plafond 300 : moins flatteurs, et justes.

---

## 3. L'ensemble actif complet (§3)

La boucle avait quatre étapes ; elle en a cinq :

1. résoudre sur les variables libres *(inchangé — recentrage N1.5.1 compris)* ;
2. violation **primale** de plancher → figer, recalculer le résidu *(inchangé)* ;
3. violation **primale** de plafond → figer *(inchangé)* ;
4. **NOUVEAU — condition duale.** `gⱼ = ∂objectif/∂qⱼ`. Au plancher l'optimalité exige `g ≥ 0`, au
   plafond `g ≤ 0`. Un signe contraire prouve une direction faisable strictement meilleure : on
   **relâche** la variable la plus violée (à égalité, plus petit index — critère total) ;
5. ni violation primale ni duale → **c'est l'optimum**, `converged = true`.

**Trois protections, et elles ne disent pas la même chose :**

| | |
|---|---|
| **Cyclage** | mémoire exacte des ensembles actifs visités. Revoir un ensemble prouve un cycle — la théorie dit que l'objectif décroît strictement à chaque relâchement, donc un retour ne peut venir que du flottant. |
| **Explosion** | plafond `64 + 8·N` tours, dimensionné sur N et non constant. |
| **Non-fini** | `Number.isFinite` après chaque résolution, avant tout usage. |

Dans les trois cas on sort **sans certifier**, on rend le **meilleur point faisable rencontré**
(pas celui du dernier tour), et `converged` vaut `false`.

**Déterminisme** : `BEST-24` rejoue les trois bancs **100 fois** et compare le JSON complet, bit
pour bit.

---

## 4. La métrique C (§2)

Poids par macro : `1 / max(5 g, 10 % de la cible)` — **exactement la tolérance avec laquelle
`determineStatus` décide `approximate` contre `impossible`**. Optimisation et verdict partagent
désormais la même géométrie : « meilleure solution » et « meilleur statut » sont la même phrase.

Elle entre en **un seul endroit** : les trois lignes macro et le second membre sont mis à
l'échelle. Le recentrage N1.5.1 agit sur les **colonnes** (les aliments), les poids sur les
**lignes** (les macros) : les deux sont orthogonaux, et rien de la couche préférence n'a bougé.

Le contrôle négatif `NC-H` remplace les poids par `[1, 1, 1]` (métrique A) : **4 tests rougissent**.

---

## 5. Priorités (§4) — et c'est écrit dans le code, pas dans un commentaire

Le gradient qui décide d'un relâchement est celui de l'erreur **macro seule**. Une portion
préférée ne peut donc **jamais** empêcher une libération qui améliore réellement les macros.

`BEST-14` le mesure : une préférence absurde (5 g partout) ne dégrade pas le coût macro, et les
deux points restent KKT-optimaux. Le contrôle négatif `KKT-NC-05` ajoute la préférence au gradient
de relâchement : **7 tests rougissent**.

---

## 6. §14 — l'audit des unités, et il infirme mon propre soupçon

**Mesuré en base, pas supposé :**

| | |
|---|---|
| `food_catalog` (Ciqual) | **3 330 lignes, 100 % `nutrition_unit = 'g'`, ZÉRO en `ml`** — dont **506 boissons** |
| contrainte | `nutrition_unit in ('g','ml')` sur `food_catalog` **et** `food_products` |
| unité du solveur | `n.unit`, l'unité d'hydratation, et rien d'autre |
| unité affichée | `item.unit`, la même valeur |
| conversion g → ml | **aucune, nulle part** |
| unité d'un produit OFF | `nutrition_data_per === "100ml"` ou `product_quantity_unit ∈ {ml, l}` — **la donnée déclarée, jamais le nom** |

**Il n'y a donc aucune incohérence entre calcul et affichage** : l'écran rend exactement l'unité
qui a servi au calcul. L'incohérence que j'avais signalée dans l'audit venait de **mon banc**, qui
modélisait les jus en `ml`. C'était précisément la faute que ton §14 interdit — déduire une unité
d'un nom d'aliment. Les bancs sont corrigés, et le résultat est **moins bon** qu'annoncé (banc C :
15 g d'écart glucides au lieu de 8,7), parce qu'un jus plafonne à 300 g et non 500 ml.

`UNIT-01` garde la règle : aucun test de nom (`jus`, `boisson`, `lait`, `eau`, `soupe`) ne décide
d'une unité, dans aucun des quatre fichiers. `UNIT-NC-01` déduit `ml` du mot « jus » → **rouge**.

**Aucune migration n'en découle.** Si tu veux qu'un jus soit calculé en millilitres, c'est une
décision de **données de catalogue** — pas de solveur, pas de schéma — et elle demande une donnée
de densité qui n'existe pas. Je n'ai rien inventé.

---

## 7. Les deltas (§9) et le seuil (§10)

`delta = résultat − cible` **n'a pas bougé** : c'est la convention historique, partagée avec
`recipe-solver`, et celle que `determineStatus` reçoit. À côté :

```ts
ecartsVersLaCible = { proteinGrams: cible − résultat, … }   // > 0 : ajouter · < 0 : réduire
```

Les deux sont calculés sur `actual`, donc sur les **quantités affichées** (§11) : le message ne
peut pas annoncer un manque que le « RÉSULTAT » juste au-dessus dément. `NC-B` calcule les écarts
avant l'arrondi → **rouge**. `NC-E` inverse le signe → **rouge**.

**Seuil : le gramme, et rien d'autre.** En dessous, l'écart arrondi vaut 0 — il n'y a
littéralement rien à écrire. **Le statut ne décide pas de l'affichage des écarts** : un repas
`approximate` peut dire « réduire environ 2 g de lipides », et `BEST-12` épingle qu'aucune
condition de statut n'entoure ce calcul.

**Ordre des lignes** : par écart **rapporté à la tolérance de sa macro**, pas en grammes bruts.
Sans ça une grande cible passerait toujours devant — 9 g de glucides sur 158 pèsent moins que 6 g
de lipides sur 42, et c'est ce dernier qu'il faut lire en premier. C'est la même géométrie que la
métrique d'optimisation.

---

## 8. L'écran (§8, §12, §13)

Le ternaire `impossible ?` a disparu. La liste des quantités, la CIBLE et le RÉSULTAT sont
**toujours** rendus. Puis, selon le statut :

- **exact** — rien de plus ;
- **approché** — « Cette combinaison s'approche au mieux de ton objectif. » ;
- **impossible** — « Cette combinaison ne permet pas d'atteindre exactement ton objectif, mais
  voici la meilleure proposition possible avec tes choix. »

Puis, si un écart atteint 1 g : « Pour te rapprocher de la cible : » et des lignes
« **Ajouter** environ 16 g de lipides » / « **Réduire** environ 11 g de protéines » — jamais un
signe nu. Puis « Modifie un de tes choix pour t'en rapprocher. »

**Aucun aliment n'est nommé dans le conseil** (§13). `BEST-18/19` vérifie qu'aucun nom d'aliment
de la solution n'apparaît dans le bloc de conseils, et que ni `rôle`, ni `referenceGrams`, ni
`catégorie` n'existent dans l'écran. `NC-F` insère un nom d'aliment → **rouge**.

**La seule raison qui reste de ne rien afficher est structurelle**, et elle est tenue par
`calculDuRepas`, pas par le rendu : unité inconnue, identité introuvable, `minimum > maximum`,
données invalides, **et solveur non convergent**. Ce dernier cas est neuf : `converged === false`
rend `non-calculable`.

---

## 9. Contrôles négatifs — 14 / 14 discriminants

md5 vérifié après chaque restauration.

| sabotage | rouges |
|---|---:|
| `KKT-NC-01` relâchement désactivé | 5 |
| `KKT-NC-02` condition duale MIN inversée | 6 |
| `KKT-NC-03` condition duale MAX inversée | 6 |
| `KKT-NC-04` arrêt dès la faisabilité primale | 5 |
| `KKT-NC-05` préférence avant erreur macro | 7 |
| `UNIT-NC-01` `ml` déduit du mot « jus » | 1 |
| `NC-A` quantités masquées si `impossible` | 4 |
| `NC-B` écarts calculés avant arrondi | 1 |
| `NC-C` minimum violé | 3 |
| `NC-D` **plafond non imposé dans le solveur** | 9 |
| `NC-E` signe des écarts inversé | 2 |
| `NC-F` un aliment précis suggéré | 1 |
| `NC-G` A5 masquée quand le repas porte des listes | 2 |
| `NC-H` métrique A au lieu de C | 4 |

**Deux contrôles ont d'abord échoué à discriminer, et les deux ont produit un vrai correctif :**

- **`NC-D` version « affichage »** — remplacer `Math.floor(maxQuantity)` par `+∞` dans l'arrondi
  borné ne rougissait **rien** : le solveur ne produit jamais de quantité au-dessus du plafond, ce
  clamp d'affichage est donc **mesuré inatteignable** (même famille que le `Math.max(0, …)` de
  N1.5). Le sabotage a été déplacé là où la règle vit vraiment — le figement au plafond dans la
  boucle — et il rougit **9 fois**.
- **`NC-G`** — masquer la section « Ce que j'ai mangé » sur les repas portant des listes ne
  rougissait **rien** : `A5-MIN-10` lisait le **source** et son `indexOf` retombait sur un autre
  bloc plus bas. Deux corrections : `A5-MIN-10` est désormais **ancré sur `<ConsumedMealSection`**,
  et `BEST-21/22/23` **rend vraiment** l'écran de la semaine avec un repas hors cible et vérifie
  que la section de consommation est dans le DOM. Le sabotage rougit maintenant **2 fois**.

---

## 10. Responsive (§24)

Le VRAI composant rendu dans Chromium, dans une carte de repas, **pire cas** : trois écarts
simultanés et des libellés Ciqual longs.

```
  375 px  scrollWidth 375 / client 375   AUCUN DÉBORDEMENT  · 3 lignes d'écart, 19/19/19 px
  390 px  scrollWidth 390 / client 390   AUCUN DÉBORDEMENT  · 3 lignes d'écart, 19/19/19 px
  430 px  scrollWidth 430 / client 430   AUCUN DÉBORDEMENT  · 3 lignes d'écart, 19/19/19 px
  768 px  scrollWidth 768 / client 768   AUCUN DÉBORDEMENT  · 3 lignes d'écart, 19/19/19 px
 1440 px  scrollWidth 1440 / client 1440 AUCUN DÉBORDEMENT  · 3 lignes d'écart, 19/19/19 px
```

**Et le banc lui-même a été contrôlé** : un libellé insécable très long fait passer `scrollWidth`
à 989 et désigne le coupable (`span.min-w-0`). Un banc qui ne sait pas détecter un débordement ne
prouve pas son absence.

---

## 11. §18 — aucune migration, vérifié

- **76 migrations sur disque, inchangé.** Aucun fichier créé, aucun modifié.
- `ecartsVersLaCible` est un champ **calculé**, jamais persisté.
- L'écran n'importe aucun client Supabase, n'appelle aucune RPC : la solution est dérivée par
  `useMemo`, jamais rangée ni envoyée (`BEST-20`).
- `consumed_meals` et `meal_entries` ne sont pas touchées ; « Enregistrer le repas » reste N1.6.
- L'audit des unités (§6) **n'a rien découvert qui exige une migration** : l'unité est déjà lue au
  bon endroit, contrainte des deux côtés, et jamais devinée.

---

## 12. Tripwires mis à jour — en nommant l'exception

| contrôle | ce qu'il disait | ce qu'il dit |
|---|---|---|
| `N1.5-17` | « `impossible` n'affiche AUCUNE quantité » | l'inverse — la prémisse « une solution hors cible ment » est tombée, le solveur rend l'optimum certifié |
| `N1.5-BOUND-09` | « l'élève ne voit pas 300 g de brocoli » | il les voit ; le plafond n'existe pas pour **cacher** une mauvaise combinaison, mais pour l'empêcher de se **déguiser** en bonne |
| `N1.5-16` | ancienne phrase « approche au mieux les objectifs de ce repas » | nouvelle phrase §12 |
| `N1.5-05` · `N1.4-02/15` | « aucun `.sort(` dans l'écran » | resserré : interdit sur les **occurrences, aliments et options** ; les lignes d'écart, elles, sont triées |
| `A5-MIN-10` | lisait la première occurrence d'une chaîne | ancré sur `<ConsumedMealSection`, doublé d'un rendu réel |
| `determinism.iterations` | « 1 + une par aliment figé » | le relâchement défait des figements : le compte de tours dépasse celui des figements survivants |
| `zeroedOrder` / `flooredOrder` / `cappedOrder` | chronologie des figements | **figements survivants**, en ordre d'entrée — publier la chronologie ferait mentir la liste sur l'état final |

---

## 13. Rouges hors périmètre — identiques à avant le lot

**8 suites sur 100**, exactement les mêmes qu'avant N1.5.3, aux mêmes causes :
`training-movement-patterns` (F1/F2/F8, défaut vidéo déjà rapporté en N1.4, N1.5.1 et N1.5.2) et 7
suites entraînement / webhook / vidéo dont la fermeture d'imports (28 à 97 modules chacune)
n'atteint **aucun fichier du lot**. Aucun test n'a été modifié pour obtenir du vert.

La checklist A1 (section Z) et `nutrition_v2_unified` (5 échecs) restent rouges pour les raisons
mesurées en N1.5.2 — indépendantes de ce lot, vérifiées sur une base sans lui.

---

## 14. Fichiers

**Modifiés** — `lib/nutrition/meal-choice-solver.ts` · `lib/nutrition/meal-choice-selection.ts` ·
`components/student/StudentMealChoices.tsx` · `scripts/tests/nutrition-n1-5-quantites.mts` ·
`scripts/tests/nutrition-n1-4-choix-eleve.mts`

**Nouveau** — `docs/nutrition-n1.5.3-audit.md` · `docs/nutrition-n1.5.3-livrable.md`

`package.json` **n'est pas touché**. Aucune migration. Aucun fichier C1.
