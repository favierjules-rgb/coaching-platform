# N1.6 — Couleurs des listes · CONTRACT `preferred_unit` · Enregistrer le repas

Branche `feat/nutrition-structured-meals`. **Trois migrations séparées**, appliquées en LOCAL
uniquement. Aucun `db push`, aucun commit, aucun push, **aucun transfert Mac** — ce rapport le
précède.

| | |
|---|---|
| **N1.6A** couleurs — tests TS | **12**, 0 échec |
| **N1.6A** checklist SQL | **22 contrôles + section Z**, 0 échec |
| **CONTRACT** — tests TS | **5**, 0 échec |
| **CONTRACT** checklist SQL | **15 contrôles + section Z**, 0 échec |
| **CONTRACT** banc données de production | **63 valeurs, diff VIDE** |
| **N1.6B** enregistrement — tests TS | **14**, 0 échec |
| **N1.6B** checklist SQL | **35 contrôles + section Z**, 0 échec |
| Contrôles négatifs N1.6 | **13 / 13 discriminants**, md5 vérifié |
| Suites rejouées | N1.5 · 112, N1.4 · 16, N1.3 · 23, N1.2 · 34, A5, sécurité |
| Checklists SQL rejouées | N1.1 · 108, N1.3 · 43, N1.5.1 · 47, N1.5.2 · 44, matrice sécurité · 76, A5.7 · 38, A5 favoris · 30 |
| Batterie complète | **102 suites** — 94 vertes, **8 rouges pré-existantes, identiques à avant le lot** |
| Responsive 375 / 390 / 430 / 768 / 1440 | **0 débordement**, banc lui-même contrôlé |
| `tsc --noEmit` · `eslint .` · `git diff --check` | exit 0 |
| Migrations sur disque | 76 → **79** |

---

# N1.6A — LES COULEURS

## 1. Le vocabulaire n'a pas été inventé — il a été EXTRAIT

`training_blocks.color_key` portait déjà `gray · red · orange · yellow · green · blue · purple`,
sa table de styles (`dot` / `borderLeft` / `softBg` + libellé français) et son sélecteur
accessible. C'était la **seule** couleur stockée du projet.

**Une seule table de styles existe désormais dans tout le dépôt**, et c'est vérifié par
recherche exhaustive sur `lib/`, `components/`, `app/`, `hooks/` :

```
COLOR-DUP → porteurs de `borderLeft: "border-l-` = ["lib/ui/color-keys.ts"]
```

`lib/training-block-editing.ts` fait `BLOCK_COLOR_KEYS = COLOR_KEYS`, `block-view-model.ts` fait
`BLOCK_COLOR_STYLES = COLOR_STYLES`, et `BlockColorPicker` **délègue** à `ColorKeyPicker`. Aucun
copier-coller : le contrôle négatif `COLOR-NC-01` remet une table dupliquée et **rougit**.

Les trois suites d'entraînement (`training-blocks`, `training-block-editing`, `block-view-model`,
`admin-program-preview`) restent vertes — l'extraction n'a rien changé pour elles.

**Pas de `pink`**, pas de chaîne CSS arbitraire : `isColorKey("#ff0000")` est faux, et les deux
contraintes SQL refusent l'un comme l'autre.

## 2. `null` et `gray` sont deux états DIFFÉRENTS

```sql
food_lists.color_key         text NULL  check (null or in (7 clés))
meal_choice_slots.color_key  text NULL  check (null or in (7 clés))
```

Nullable, **sans default, sans backfill** — les 12 listes de production restent à `null`.

⚠️ Et ce n'est pas le piège « deux façons de dire la même chose » que N1.5.2 avait refusé pour
`minimum_quantity` : **`null` n'affiche AUCUN accent**, `gray` affiche une pastille grise. Le
premier est l'absence de choix, le second est un choix. `COLOR-01` vérifie qu'aucune classe
d'accent n'est rendue sans couleur.

## 3. Le snapshot est OBLIGATOIRE, et la base le dit

```
food_lists_manage_own_coach | ALL | coach_id = current_coach_id()
food_lists_manage_admin     | ALL | is_admin()
```

**Aucune policy `select` élève sur `food_lists`.** Un élève ne peut donc *structurellement* pas
lire la couleur de la bibliothèque : sans `meal_choice_slots.color_key`, elle serait invisible de
son côté. `COLOR-11` le vérifie sur le code, `C-G` sur les policies — et le jour où quelqu'un
ajouterait une policy élève, `C-G` rougirait, ce qui est exactement le moment où il faudrait se
redemander pourquoi on snapshot.

**Mesuré** : coach peint `blue` → occurrence posée → coach repeint `red` → l'ancienne occurrence
garde `blue`, une nouvelle prend `red`. Même sémantique que `preferred_quantity` et
`minimum_quantity`.

## 4. La couleur ne touche RIEN

`COLOR-06` est le contrôle le plus important du lot : ni `meal-choice-solver.ts` ni
`meal-choice-selection.ts` ne contiennent `colorKey`, `color_key`, `COLOR_STYLES` ou `ColorKey`.
Le contrôle négatif `COLOR-NC-03` fait passer la couleur au solveur → **rouge**.

`COLOR-07` va plus loin : **aucune couleur n'est associée à un mot du vocabulaire nutritionnel**,
nulle part — pas de `red → protéines`, pas de table de correspondance. Et `C-H` vérifie que la
couleur n'est ni sur `meal_choice_options`, ni sur `food_list_items`, ni sur `food_catalog` : la
poser sur un aliment en ferait, de proche en proche, un rôle.

## 5. L'UI

Coach : sélecteur dans l'éditeur de liste (avec « Aucune »), pastille dans la bibliothèque
(`FoodListRow`), pastille dans le sélecteur du constructeur et sur l'occurrence
(`MealChoiceListsPanel`). L'écran dit **« Repère visuel uniquement — sans effet sur les quantités
calculées »** : sans cette phrase, un coach pourrait croire qu'il déclare un rôle.

Élève : **barre latérale** `border-l-4` sur l'occurrence. `COLOR-RENDU` vérifie qu'aucun
`bg-red-500` n'apparaît — accent, jamais remplissage — et que le libellé « Ta protéine » reste
écrit. La couleur ne dit jamais seule ce qu'est une liste.

---

# CONTRACT — `preferred_unit` DISPARAÎT

## 6. La preuve qui donnait le droit d'écrire cette migration

⚠️ **On ne supprime pas une colonne parce qu'on CROIT que plus personne ne la lit.** Recherche
exhaustive sur `lib/`, `components/`, `app/`, `hooks/`, `types/`, prose dépouillée :

> **Zéro usage runtime.** Le seul `preferred_unit` restant du TypeScript était un COMMENTAIRE
> dans `lib/nutrition/plan-v2-week.ts`.

`CONTRACT-01` rejoue cette recherche **à chaque exécution des tests** — la preuve ne périme pas.

## 7. Ce qui tombe, et dans quel ordre

```
A. la RPC cesse d'écrire preferred_unit     ← AVANT tout le reste
B. les 3 contraintes legacy tombent
C. la colonne tombe
```

`CONTRACT-04` vérifie l'ordre par position dans le fichier : l'inverse laisserait une fonction
cassée entre deux instructions de la même migration.

**Ce qui NE tombe pas** : `meal_choice_options_quantites_unite` et
`meal_choice_options_quantity_unit_check` — la vérité métier de N1.5.2. Ni `PORTION_SANS_UNITE`,
ni `MINIMUM_SANS_UNITE`.

⚠️ **Et l'alias d'ENTRÉE survit.** Un onglet ouvert avant le déploiement peut encore poster
`preferred_unit` ; la RPC continue de le comprendre comme alias de `quantity_unit`. Le CONTRACT
retire une dépendance de **stockage**, pas une politesse d'entrée.

## 8. Les 63 valeurs, mesurées

Base reconstruite à l'**état post-N1.5.2** — 609 options, dont 63 portant les **deux** unités
égales, comme la production. Migration appliquée. Diff des 63 lignes `id|portion|quantity_unit` :

```
63 lignes avant · 63 lignes après · diff VIDE
546 options nues encore nues
```

C'est la contrainte `meal_choice_options_unite_legacy_coherente` — posée en N1.5.2 précisément
pour cela — qui rendait ce drop sûr : elle garantissait que les deux colonnes ne pouvaient pas
diverger.

## 9. Trois checklists ont changé d'avis, et c'est la trace du chemin

| checklist | avant N1.5.2 | pendant l'expand | après le CONTRACT |
|---|---|---|---|
| N1.5.2 · `M-B` | « `preferred_unit` a disparu » | « elle SURVIT » | « elle a été SUPPRIMÉE » |
| N1.5.1 · `P-C` | paire `preferred_paire` | paire conservée | paire généralisée seule |
| N1.1 · `N1-B` | une colonne texte tolérée | **deux** | une, et l'ancienne doit avoir disparu |

**Chacun des trois états était correct à sa date.** Ce n'est pas une hésitation : c'est
l'empreinte d'un expand → deploy → contract mené jusqu'au bout. Le commentaire de chaque contrôle
le dit, plutôt que de faire disparaître l'histoire.

---

# N1.6B — ENREGISTRER LE REPAS

## 10. La RPC atomique existait déjà, et personne ne l'avait branchée

`enregistrer_repas_planifie`, livrée en N1.1 : **0 ligne en production, 0 appelant TypeScript**.
Elle valide déjà l'appartenance du repas au plan assigné, exclut les plans « prochain », exige un
choix par occurrence sans doublon ni intrus, exige que **toutes** les occurrences soient
couvertes, exige que chaque aliment appartienne au **snapshot** de son occurrence, contrôle
l'unité — le tout en transaction, idempotent par `on conflict`.

`enregistrer_repas_structure_consomme` l'**appelle**. Elle ne recopie pas un seul de ces
contrôles : deux validations parallèles divergeraient au premier ajout de règle. `S-A` épingle
les deux délégations (`enregistrer_repas_planifie` et `ouvrir_repas_prescrit`).

## 11. Le client ne peut PAS envoyer de macro

C'est une garantie de **signature**, pas de discipline :

```
p_meal_id uuid, p_consumed_on date, p_items jsonb
```

`S-B` vérifie qu'aucun paramètre ne contient `protein`, `carb`, `fat`, `kcal` ni `student` — l'élève
vient du JWT. `SAVE-30` garde le chemin TypeScript, où une clé pourrait toujours s'ajouter au JSON.
Le contrôle négatif `SAVE-NC-02` ajoute `protein_g: 0` à la charge utile → **rouge**.

## 12. La quantité affichée est la quantité enregistrée

```
S-D · la quantité en base est EXACTEMENT celle envoyée (163)  ✔
S-D · la quantité en base est EXACTEMENT celle envoyée (200)  ✔
S-E · protéines = 163 × 31/100, à 1e-4 près                   ✔
S-E · glucides  = 200 × 28/100, à 1e-4 près                   ✔
```

Le serveur recalcule les macros avec **la formule d'A5** — `quantite_en_base_nutritionnelle` puis
`round(base × pour100 / 100, 4)` — qui est aussi celle du solveur. La tolérance de `SAVE-06` est
donc l'arrondi à 4 décimales de la RPC, pas une approximation choisie.

`SAVE-05` vérifie que l'écran envoie `item.displayQuantity` et **jamais** `item.quantity`, sur un
banc où les deux **diffèrent** — sinon le contrôle ne prouverait rien. `SAVE-NC-01` inverse les
deux → **rouge**.

## 13. L'idempotence est en base

`planned_meals.consumed_meal_id` — la colonne que N1.1 avait laissée vide depuis le début.

```
S-F · le second appel se dit « déjà enregistré »              ✔
S-F · le second appel crée ZÉRO entrée                        ✔
S-F · le second appel rend le MÊME conteneur                  ✔
S-F · des quantités DIFFÉRENTES ne rouvrent pas l'enregistrement ✔
```

Le verrou est celui de `on conflict … do update`, tenu jusqu'au commit ; un `for update` explicite
le rend lisible. **La garde React ne suffisait pas** : `enCoursRef` refuse une écriture *pendant*
la première, mais deux clics espacés de deux secondes passeraient tous les deux.

⚠️ **Et le lien est posé APRÈS les entrées.** L'inverse marquerait le repas « enregistré » alors
qu'un item aurait échoué. `SAVE-NC-04` échange les deux blocs → **rouge**.

## 14. Rien n'est effacé, rien n'est synchronisé

```
S-G · l'entrée manuelle préexistante survit          ✔   (le café du §B10)
S-G · le conteneur est le MÊME que celui du café     ✔
S-H · ROLLBACK TOTAL : aucune entrée créée par les refus ✔
S-H · ROLLBACK TOTAL : aucun planned_meal ne subsiste    ✔
S-I · un autre JOUR crée une autre consommation      ✔
S-I · le dîner n'est PAS marqué par le déjeuner      ✔
S-J · le repas d'un autre élève est refusé           ✔
```

`SAVE-13` vérifie qu'aucun `delete` ni `update` de `meal_entries` n'existe dans la RPC.
`SAVE-NC-07` en ajoute un → **rouge**.

## 15. §8 — l'aliment archivé, et c'est l'arbitrage le plus délicat du lot

Le lecteur élève **ne filtre délibérément pas** `status` : « un aliment archivé après coup doit
garder son nom à l'écran ». Il s'affiche donc, se calcule — et **échouait** à l'enregistrement.

```
S-K · un aliment ARCHIVÉ après le snapshot reste enregistrable       ✔
S-K · et son identité catalogue est préservée                        ✔
S-L · le même aliment archivé reste REFUSÉ par l'ajout manuel A5     ✔
```

Le retrait de `status = 'active'` porte sur **une seule ligne**, dans
`enregistrer_repas_planifie` — dont le chemin est déjà étroit : repas assigné + occurrence du repas
+ option du **snapshot**. `ajouter_aliment_catalogue` n'est pas touchée.

⚠️ **`owner_coach_id is null` reste, lui.** Ce n'est pas du cycle de vie mais de la visibilité :
la fonction étant `security definer`, retirer cette garde ouvrirait un accès que la RLS refuse.

## 16. L'état « enregistré » vient de la persistance

`lireRepasStructuresEnregistres` lit `planned_meals`, pas `meal_entries` : **supprimer une entrée
dans « Ce que j'ai mangé » ne réarme pas le bouton** (§29). La prescription A ÉTÉ enregistrée,
c'est un fait daté ; l'élève corrige sa consommation avec les outils A5. `SAVE-NC-06` fait lire
`meal_entries` → **rouge**.

Conformément au §11, **aucune** action « Enregistrer cette nouvelle version » n'est proposée.

## 17. Le statut ne bloque jamais

`SAVE-02/03/04/12` rend les trois statuts et vérifie le bouton dans chacun — puis vérifie qu'aucun
`status` / `impossible` / `approximate` n'apparaît **dans la condition** du bouton. Le rendu seul
ne suffirait pas : un `status === "impossible"` ajouté demain passerait trois bancs figés.
`SAVE-NC-05` l'ajoute → **rouge**.

**A5 reste entièrement libre** : la condition de rendu de `<ConsumedMealSection>` est exactement
`{suivi && date && (`, sans un mot d'enregistrement, et les cinq gestes restent câblés.

---

## 18. Contrôles négatifs — 13 / 13 discriminants

md5 vérifié après chaque restauration.

| sabotage | rouges |
|---|---:|
| `COLOR-NC-01` table de couleurs dupliquée | 1 |
| `COLOR-NC-02` la couleur n'est plus snapshotée par la RPC | 1 |
| `COLOR-NC-03` le solveur reçoit la couleur | 1 |
| `SAVE-NC-01` quantité interne au lieu de l'affichée | 2 |
| `SAVE-NC-02` le client envoie une macro | 1 |
| `SAVE-NC-03` idempotence retirée | 1 |
| `SAVE-NC-04` le lien posé AVANT les entrées | 1 |
| `SAVE-NC-05` le statut bloque l'enregistrement | 1 |
| `SAVE-NC-06` l'état vient de `meal_entries` | 1 |
| `SAVE-NC-07` la RPC efface les entrées existantes | 1 |
| `CONTRACT-NC-01` la RPC écrit encore `preferred_unit` | 1 |
| `CONTRACT-NC-02` la colonne n'est pas supprimée | 1 |
| `CONTRACT-NC-03` la couleur perdue dans la reproduction | 1 |

**Deux contrôles ont d'abord refusé de rougir, et les deux ont produit un vrai correctif.**
`COLOR-NC-02` (RPC qui écrit `null` au lieu de la couleur reçue) passait : la suite TS ne
regardait pas le DDL de la migration → deux assertions ajoutées. `COLOR-NC-03` dans sa première
forme ne faisait rien parcourir jusqu'au solveur — le sabotage a été déplacé là où la règle vit.

---

## 19. Responsive

Le VRAI écran rendu dans Chromium — **pire cas** : cinq occurrences colorées, libellés Ciqual
longs, trois lignes d'écart, bouton d'enregistrement.

```
  375 px  scrollWidth 375 / 375   AUCUN DÉBORDEMENT
  390 px  scrollWidth 390 / 390   AUCUN DÉBORDEMENT
  430 px  scrollWidth 430 / 430   AUCUN DÉBORDEMENT
  768 px  scrollWidth 768 / 768   AUCUN DÉBORDEMENT
 1440 px  scrollWidth 1440 / 1440 AUCUN DÉBORDEMENT
```

Banc contrôlé : un libellé insécable long fait passer `scrollWidth` à 989 et désigne le coupable.

---

## 20. Tripwires mis à jour — en nommant l'exception

| contrôle | ce qu'il disait | ce qu'il dit |
|---|---|---|
| `N1.5-10/11/12` | « pas de bouton Enregistrer » | le bouton existe ; la garantie gardée est que l'écran **délègue** et n'écrit pas |
| `N1.4-21/22/23` | idem | idem |
| `A5-MIN-08/09` | aucun `suivi` dans les props des choix | pont **étroit et nommé** ; interdit reste `suivi.meals`, `suivi.onAjouter…` |
| `N1.3-04/05/06` | 4 clés d'occurrence | **5** — `color_key` est du snapshot |
| `N1.1 · N1-B` | 2 colonnes texte tolérées | 1, + `preferred_unit` doit avoir disparu |
| `N1.5.2 · M-B` | `preferred_unit` SURVIT | elle a été SUPPRIMÉE |
| `N1.5.1 · P-C` | paire `preferred_paire` | paire généralisée, l'ancienne doit avoir disparu |
| compteurs migrations | 76 / manifeste 49 | **79 / 52**, + trois noms dans les listes nominatives |

---

## 21. Rouges hors périmètre — identiques à avant le lot

**8 suites sur 102**, exactement les mêmes qu'avant N1.6, aux mêmes causes :
`training-movement-patterns` (F1/F2/F8 — défaut vidéo rapporté depuis N1.4) et 7 suites
entraînement / webhook / vidéo dont la fermeture d'imports n'atteint aucun fichier du lot.
Aucun test n'a été modifié pour obtenir du vert.

---

## 22. Fichiers

**Nouveaux (10)**
`supabase/migrations/20260910090000_n1_6_a_couleurs_de_listes.sql` ·
`supabase/migrations/20260913090000_contract_preferred_unit.sql` ·
`supabase/migrations/20260912090000_n1_6_b_enregistrer_repas_structure.sql` ·
`supabase/tests/nutrition_n1_6_a_couleurs_checklist.sql` ·
`supabase/tests/nutrition_contract_preferred_unit_checklist.sql` ·
`supabase/tests/nutrition_n1_6_b_enregistrement_checklist.sql` ·
`scripts/tests/nutrition-n1-6-couleurs.mts` ·
`scripts/tests/nutrition-contract-preferred-unit.mts` ·
`scripts/tests/nutrition-n1-6-enregistrement.mts` ·
`lib/ui/color-keys.ts` · `components/ui/ColorKeyPicker.tsx` · `components/ui/ColorKeyDot.tsx`

**Modifiés** — `lib/training-block-editing.ts` · `components/admin/blocks/block-view-model.ts` ·
`components/admin/blocks/BlockColorPicker.tsx` · `components/admin/FoodListEditor.tsx` ·
`components/admin/FoodListRow.tsx` · `components/admin/MealChoiceListsPanel.tsx` ·
`components/admin/NutritionPlanV2WeekPanel.tsx` · `components/student/StudentMealChoices.tsx` ·
`components/student/StudentPrescribedWeek.tsx` · `lib/supabase/food-lists.ts` ·
`lib/supabase/nutrition-week.ts` · `lib/supabase/consumed-meals.ts` ·
`lib/nutrition/plan-v2-week.ts` · `lib/nutrition/plan-v2-week-form.ts` ·
`hooks/useConsumedMeals.ts` · `app/(student)/nutrition/[planId]/page.tsx` ·
`supabase/baseline/manifest.json` · 5 checklists SQL · ~14 fichiers de tests (compteurs et
tripwires).

⚠️ **`package.json` EST touché**, et c'est une nécessité démontrée : trois suites neuves sans
entrée `npm run` ne seraient jamais exécutées par la batterie. **Trois lignes ajoutées, aucune
modifiée, aucune supprimée** — et les deux entrées `courses-c1` du conteneur, qui sont une dérive
étrangère, ne partiront pas au transfert.

---

## 23. Ordre de déploiement — CORRIGÉ

Une version précédente de ce livrable plaçait le CONTRACT en **deuxième** position, sur
l'affirmation que « le code N1.5.3 déployé lit déjà `quantity_unit` ». C'était une **déduction,
pas une mesure** : une migration ne peut pas constater quel code tourne en production, et rien
n'établissait que le runtime lisant `quantity_unit` fût réellement en ligne. Appliqué dans cet
ordre, le CONTRACT aurait supprimé une colonne que la production pouvait encore lire.

Les trois migrations n'étant **pas encore appliquées à distance**, l'ordre a été corrigé dans les
noms de fichiers — le seul endroit où `supabase db push` le lit.

```
PHASE 1 — base seule, AVANT tout déploiement
  20260910090000  N1.6A COLOR    purement additif : deux colonnes nullables,
                                 une clé de charge utile de plus
  20260912090000  N1.6B SAVE     une RPC neuve que personne n'appelle encore,
                                 et un filtre RELÂCHÉ sur une RPC existante

PHASE 2 — déployer le runtime N1.6, qui ne lit plus preferred_unit

PHASE 3 — base seule, APRÈS le déploiement
  20260913090000  CONTRACT       irréversible : les 63 valeurs de preferred_unit
                                 disparaissent. Elles sont strictement égales à
                                 quantity_unit, garanti par la contrainte de
                                 cohérence de N1.5.2.
```

**Pourquoi la phase 1 ne casse rien.** COLOR et SAVE n'enlèvent rien à l'ancien runtime :

- COLOR **conserve la double écriture** de `preferred_unit` dans les DEUX chemins de la RPC
  (`update` puis `insert`). Un plan enregistré pendant la phase 1 reste donc lisible par le code
  encore en ligne.
- COLOR n'ajoute que des colonnes **nullables** : une charge utile sans `color_key` passe, et la
  couleur reste `NULL`.
- SAVE ne nomme **jamais** `preferred_unit`, ne reproduit pas `save_nutrition_plan_v2`, et ne
  touche `meal_choice_options` que par `slot_id` / `catalog_food_id` / `product_id`. Il est donc
  strictement indépendant du CONTRACT — c'est ce qui rend l'inversion possible.
- SAVE reproduit `enregistrer_repas_planifie` en **retirant** un filtre (`status = 'active'`) :
  une relaxation ne peut pas casser un appelant existant. Signature et droits inchangés.

**Où c'est prouvé.** Un banc dédié (`supabase/tests/nutrition_n1_6_phase1_rollout_checklist.sql`) s'exécute sur une base arrêtée
**avant** le CONTRACT — 51 migrations au lieu de 52 — et mesure **25 contrôles, 0 échec** :
`preferred_unit` présente avec ses trois contraintes legacy, les deux `color_key` posées et
contraintes, la RPC d'enregistrement structuré exécutable par `authenticated` et interdite à
`anon`, et surtout le trajet réel d'un **ancien client** : une charge utile portant la clé
`preferred_unit` et aucune couleur traverse la RPC, remplit les deux unités, et un
ré-enregistrement — chemin `update` — les remplit encore.

Sur cette même base intermédiaire, les checklists du lot sont **vertes sans modification** :
N1.6A **22/22**, N1.6B **35/35**. La checklist CONTRACT y est **9/15 rouge**, comme elle doit
l'être : elle décrit l'état d'après.

⚠️ **Les checklists `nutrition_n1_listes`, `nutrition_n1_5_1_portions` et
`nutrition_n1_5_2_minimum` décrivent l'état POST-CONTRACT.** Elles sont rouges en phase 1 (2, 1 et
5 échecs), et c'est normal : elles affirment que `preferred_unit` a disparu. À exécuter en phase 3.

**Contrôles négatifs du banc.** Annuler la double écriture de COLOR — sur le chemin `update`, puis
sur le chemin `insert` — fait rougir le banc les deux fois. Et il rougit de la meilleure façon
possible : la RPC **lève**, sur `meal_choice_options_preferred_paire`. En phase 1, la contrainte
legacy de N1.5.1 rend la perte de la double écriture **impossible en silence** — un snapshot à
moitié cassé serait refusé par la base avant d'exister.

Le premier sabotage, dans sa forme initiale, n'a **rien fait rougir** : le banc ne réenregistrait
pas, donc le chemin `update` n'était jamais emprunté. Le banc a été corrigé — il enregistre puis
ré-enregistre sur la même occurrence — avant que le contrôle négatif ne devienne concluant.

**Le garde permanent.** `CONTRACT-07` (`npm run test:nutrition-contract`) lit les noms de fichiers
sur le disque et exige que le CONTRACT soit postérieur à COLOR et à SAVE, et qu'il soit la
**dernière** migration du dépôt. Le remettre à `20260911` fait rougir ce contrôle avec le message
exact ; ajouter une migration après lui le fait rougir aussi — délibérément, pour que l'ordre du
rollout se décide, et ne se découvre pas en production.
