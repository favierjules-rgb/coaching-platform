# N1.5.1 — Portions préférées hybrides

Branche `feat/nutrition-structured-meals`. **Une migration**, appliquée en LOCAL uniquement.
Aucun `db push` distant, aucun commit, aucun push, aucun merge. Aucun transfert Mac.

| | |
|---|---|
| Tests TypeScript N1.5 / N1.5.1 | **61**, 0 échec |
| Checklist SQL N1.5.1 | **46 contrôles + section Z**, 0 échec |
| Contrôles négatifs TypeScript | **10 / 10 discriminants**, md5 vérifié |
| Contrôles négatifs SQL | **6 / 6 discriminants**, md5 vérifié |
| Suites de non-régression | **22**, toutes vertes |
| Checklists SQL rejouées | **4** (N1.1 · 107, N1.3 · 43, A1 · 149, A2 · 121) |
| `npx tsc --noEmit` / `npx eslint .` | propres |

---

## 1. Le défaut, reproduit avant d'être corrigé

Petit déjeuner P 55 · G 93 · L 32, valeurs Ciqual 2025 réelles (whey en valeurs d'étiquette
produit). Le banc **reproduit ta mesure terrain** avant de la corriger :

| | pain | huile | fromage blanc | whey | sirop | distance aux portions |
|---|---:|---:|---:|---:|---:|---:|
| ton relevé terrain | 52 | 25 | 10 | 63 | 85 | — |
| N1.5 (avant) | 53 | 28 | **10** | **62** | **86** | **149 %** |
| N1.5.1 (après) | 151 | 25 | **221** | **34** | 24 | **57 %** |

Portions de banc : pain 80 · huile 10 · fromage blanc 200 · whey 30 · sirop 20.

---

## 2. Le critère, et le résultat qui le justifie

Substitution `qᵢ = cᵢ + sᵢ · xᵢ`, avec `cᵢ` = portion préférée (0 sans préférence) et
`sᵢ` = portion préférée (`ECHELLE_NEUTRE` sinon). Minimiser `‖x‖` revient à minimiser
`Σ ((qᵢ − cᵢ)/sᵢ)²` — l'écart **relatif** à la portion : 10 g d'écart sur 30 g de whey pèsent
autant que 66 g sur 200 g de fromage blanc.

**C'est exactement le solveur N1.5 appliqué à une matrice dont les colonnes sont mises à
l'échelle.** Aucune algèbre nouvelle, aucune bibliothèque, **aucun λ**.

### Les macros ne paient rien — mesuré, pas argumenté

Les deux formulations minimisent une norme **sur le même ensemble** : celui des solutions qui
minimisent déjà l'écart macro. Résidu macro **avant arrondi**, petit déjeuner terrain :

```
sans portions   max|Δ| < 1e−9
avec portions   max|Δ| < 1e−9
```

Épinglé par `PREF-02`. C'est pourquoi il n'y a **aucun compromis à arbitrer** — et pourquoi λ
aurait été un recul : mesuré à l'audit, il ne change rien dans sa plage utile et **dégrade les
macros** dès qu'il pèse (statut `exact` → `approximate` à λ = 10).

### L'échelle neutre — le nombre qui décide du § « aliment sans préférence »

`ECHELLE_NEUTRE = 100`, dans l'unité de l'aliment. **Ce n'est pas une portion** : jamais
affichée, jamais enregistrée, jamais snapshotée. C'est l'unité de mesure de l'écart pour un
aliment dont personne n'a d'avis — sans elle, on comparerait des grammes absolus à des écarts
relatifs.

Sensibilité mesurée (quantité rendue au sirop, seul aliment sans préférence) :

| σ | 1 | 20 | 50 | **100** | 150 | 300 |
|---|---:|---:|---:|---:|---:|---:|
| sirop | **0 g** | 8 | 24 | **34** | 37 | 39 |

À σ = 1 — c'est-à-dire « grammes absolus », la formulation B de l'audit — **l'aliment choisi par
l'élève disparaît de son repas**. C'est la mesure qui a disqualifié B. Le choix de 100 n'est pas
sur un fil : au-delà, le résultat bouge de 5 g. Constant plutôt que « médiane du repas », qui
donnait 32 g au lieu de 34 mais couplait les aliments entre eux — ajouter une portion à X
changerait la quantité de Y, déterministe mais inexplicable à un coach.

---

## 3. La hiérarchie, résolue à UN seul endroit

```
effectivePreferred = food_list_items.preferred_quantity_override
                  ?? identité.preferred_quantity
                  ?? null
```

Écrit une fois, dans `portionEffective()` (`lib/supabase/food-lists.ts`), c'est-à-dire dans la
couche qui **lit la bibliothèque**. Ni la RPC ni l'écran élève ne la recalculent :

- **la RPC reçoit une portion déjà résolue** et se contente de la figer — exactement comme
  l'identité. La checklist P-G le prouve en cherchant, dans le source de la fonction **privé de
  ses commentaires**, toute lecture de `food_list_items`, `food_lists`, `food_catalog` ou
  `food_products` : zéro ;
- **l'écran élève ne connaît même pas le mot `portionStandard`** (`PREF-12`).

---

## 4. Le snapshot

Figé dans `lireSnapshotDeListe`, au même instant que l'identité. Après ce point, modifier
l'override **ou** le standard ne touche plus le repas — vérifié en base (checklist P-H : le
standard passe à 999 et l'override à 888, le snapshot reste à 25) et en TypeScript (`PREF-17`,
qui exerce trois listes : override 25, override 35 sur le **même** aliment, et aucun override →
le standard 30).

**Quantité et unité voyagent en paire ou pas du tout.** La base le dit
(`meal_choice_options_preferred_paire`), la RPC le dit (`PORTION_SANS_UNITE`), et la couche de
lecture le redit — une paire incomplète redevient « pas de préférence » plutôt qu'une portion
dont on ignore l'échelle.

---

## 5. Ce que la préférence n'est pas — chaque point mesuré

| affirmation | preuve |
|---|---|
| pas une quantité obligatoire | `PREF-08` : portions ÷ 5, le solveur s'en éloigne de **635 %** et atteint la cible `exact` |
| pas un minimum | `PREF-06` : portions à 200 g, cible minuscule → toutes les quantités descendent sous 200 |
| pas un maximum | `PREF-06` : portions à 20 g, le solveur monte au-delà |
| zéro reste atteignable | `PREF-06` : l'huile tombe à 0 malgré une portion de 10 g |
| pas un rôle, pas de catégorie | `PREF-11` : aucun `role`, aucun `proteine/feculent/legume` dans le solveur |
| pas un `referenceGrams` | `PREF-11` : la portion est un **centre additionné**, jamais une base de ratio |
| **les plafonds gagnent** | `PREF-07` : portions à 400 g → toutes ≤ 300 g, plafonnement effectif ; 600 ml → 500 ml |
| ne sauve jamais un repas impossible | `PREF-09` : banc B avec portions raisonnables → toujours `impossible` |
| le statut ne dépend que des macros | `PREF-09` : `determineStatus(delta, target)`, et aucune mention de `preferred` |
| rétrocompatible au bit près | `PREF-03` : `null` **et** `undefined` rendent exactement le résultat N1.5 |

**Une préférence supérieure au plafond est acceptée en base** (checklist P-M) : c'est une
intention de coach, pas une erreur métier. Le solveur arbitre. Aucune contrainte du schéma ne
mentionne 300 ni 500 — vérifié.

---

## 6. La migration

`20260908090000_n1_5_1_portions_preferees.sql`, **appliquée en local, idempotente** (rejouée
trois fois sans erreur).

- 5 colonnes, toutes **nullables**, `numeric` (décimales conservées : 2,5 cuillères existent) ;
- 3 contraintes de positivité, 1 de paire, 1 de vocabulaire `('g','ml')` — **ni `piece`, ni
  `portion`** : le vocabulaire de ce qui est **calculable**, pas de ce qui se saisit ;
- **aucun `default`** — une valeur par défaut ferait naître une préférence que personne n'a
  exprimée, et le solveur la suivrait ;
- **aucun backfill** — vérifié colonne par colonne (checklist P-E) ;
- **aucune policy créée ni modifiée** — les colonnes héritent (P-L), `food_products` reste en
  `SELECT` seul pour `authenticated`, et un coach ne peut toujours pas poser d'override dans la
  liste d'un autre ;
- `save_nutrition_plan_v2` : deux variables, trois validations
  (`PORTION_SANS_UNITE`, `PORTION_NON_POSITIVE`, `PORTION_UNITE_INCONNUE`), deux colonnes à
  l'insert, deux à l'update. **Le `delete` de préservation par identité n'est pas touché** — il
  protège `planned_meal_items`, qui cascade depuis les clés composites.

Compteurs à jour : **75 migrations** sur disque, `migrations_post_baseline_attendues` **48**, les
trois listes nominatives complétées, et les ~19 assertions de comptage réparties dans 14 fichiers.

---

## 7. Contrôles négatifs — 16 / 16 discriminants

**TypeScript (10)** — inverser la hiérarchie · ne pas émettre la portion vers la RPC · σ = 1 ·
exposer l'échelle neutre comme portion · la préférence devient un plancher · la préférence
contourne le plafond · deviner une unité incohérente · **le snapshot ne fige plus** · l'UI écrit
à chaque frappe · le writer accepte une portion nulle.

**SQL (6)** — la RPC ignore la portion à l'insert (4 rouges) · la contrainte de paire disparaît ·
le vocabulaire accepte `piece` · la positivité disparaît · la migration backfille · la RPC ne
valide plus la paire (3 rouges).

Suite verte avant et après chaque série, md5 vérifié à chaque restauration.

### Un contrôle négatif a trouvé un trou dans mes tests

**NCP8 n'a d'abord rien fait rougir.** Saboter `lireSnapshotDeListe` pour qu'il ne fige plus
aucune portion laissait la suite verte : **rien n'exerçait le pont bibliothèque → repas**.
Ce n'était pas une souplesse, c'était une absence. `PREF-17` a été écrit pour cela, et NCP8
rougit maintenant.

---

## 8. Trois tripwires ont sauté, et c'était leur rôle

Des lots précédents épinglaient des invariants que N1.5.1 change **délibérément**. Chacun a été
mis à jour en **nommant l'exception**, jamais en élargissant la règle :

1. **N1.3-04/05/06 et N1.3-NAME-7** — « une option ne porte QUE des identités ». Elle en porte
   maintenant quatre clés : l'identité **et la portion figée**. Le libellé et les macros
   continuent de ne jamais partir — c'est la ligne de partage entre snapshot et hydratation. Le
   mot `quantity` reste interdit ; seul `preferred_quantity` est autorisé, et l'assertion le
   distingue explicitement.
2. **N1.2-21** — « aucun écran ne demande une quantité ». L'éditeur porte désormais **une** saisie
   numérique, et l'assertion vérifie qu'il n'y en a qu'une, que c'est bien la portion, et que
   les autres écrans n'en ont toujours aucune.
3. **N1-B (checklist SQL)** — « aucune colonne texte ne peut tenir lieu d'identité ».
   `preferred_unit` est du texte, mais c'est une **unité** contrainte à deux valeurs : elle est
   nommée en exception, et une assertion de plus vérifie que le check existe bel et bien.

### Et un quatrième a rougi pour de la prose

**RECIPE-A2** (checklist A1) cherchait `food_catalog` dans `prosrc` — qui contient aussi les
**commentaires**. Ma RPC explique qu'elle ne lit pas `food_catalog` ; la phrase suffisait à faire
rougir. Corrigé en retirant les commentaires avant la recherche : l'assertion mesure désormais de
**vraies lectures**, elle est donc plus forte qu'avant. Même leçon dans ma propre checklist (P-G),
et même leçon qu'en N1.4 où un sabotage placé dans un commentaire n'avait rien prouvé.

---

## 9. Non-régression

22 suites TypeScript vertes, dont `nutrition-n1-3` (23), `nutrition-n1-4` (16),
`nutrition-n1-listes` (34), `nutrition-plan-v2-builder` (72), `nutrition-v2-unified` (74),
`nutrition-recipes-admin` (65), `security-hardening` (31), `nutrition-recipe-solver` (25),
`aliments-a1/a2/a3/a5/a5-history/a5-coach`.

4 checklists SQL rejouées sur la base locale migrée : N1.1 · 107, N1.3 · 43, A1 · 149, A2 · 121.

### Un rouge PRÉ-EXISTANT, et je ne l'ai pas maquillé

`training-movement-patterns` : **F1, F2, F8** échouent, et échouaient **déjà avant ce lot**
(vérifié en remettant l'ancien compteur). C'est la famille du défaut vidéo déjà signalée en N1.4
(`SessionFeedbackSection` indexe `videosExercice[exercise.id]` là où le test attend
`videosExercice[exerciseFb.exerciseId]`). **Hors périmètre, non corrigé, signalé.**

En revanche **B7 de la même suite était rouge pour une raison qui me concerne** : son compteur
disait 73 migrations alors que le dossier en portait 74 depuis N1.3 — un compteur oublié par un
lot précédent. Remis à 75, avec la mention de ce qu'il ratait.

---

## 10. Fichiers

**Nouveaux**

- `supabase/migrations/20260908090000_n1_5_1_portions_preferees.sql`
- `supabase/tests/nutrition_n1_5_1_portions_checklist.sql`
- `docs/nutrition-n1.5.1-livrable.md`

**Modifiés** — `lib/nutrition/meal-choice-solver.ts` (formulation C, `ECHELLE_NEUTRE`) ·
`lib/nutrition/meal-choice-selection.ts` · `lib/nutrition/plan-v2-week.ts` ·
`lib/nutrition/plan-v2-week-form.ts` · `lib/supabase/food-lists.ts` ·
`lib/supabase/nutrition-week.ts` · `components/admin/FoodListEditor.tsx` ·
`scripts/tests/nutrition-n1-5-quantites.mts` · `supabase/baseline/manifest.json` ·
17 fichiers de tests pour les compteurs de migrations et les trois tripwires.

**`package.json` n'est pas touché** : la suite N1.5.1 vit dans le harnais N1.5 déjà enregistré.

---

## 11. Ce qui reste à décider avant le `db push`

1. **`food_products.preferred_quantity` est posée mais inécrivable** — la table est en `SELECT`
   seul pour `authenticated`. La colonne restera `NULL` jusqu'au lot qui lui donnera un chemin
   admin. C'est le périmètre validé ; je le rappelle parce que la colonne existera en production.
2. **Aucun écran n'écrit le standard global.** L'éditeur de liste le LIT et l'affiche ; ce que le
   coach pose est toujours un override. L'écran admin des standards est un lot séparé.
3. **Le `db push` distant n'a pas été fait**, comme demandé. La migration est prête, idempotente,
   et vérifiée par 46 contrôles + 6 sabotages sur une base locale portant le baseline et les
   48 migrations post-baseline.
