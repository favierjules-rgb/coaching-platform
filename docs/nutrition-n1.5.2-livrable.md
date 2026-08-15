# N1.5.2 — Quantité minimale par aliment · **stratégie EXPAND → DEPLOY → CONTRACT**

Branche `feat/nutrition-structured-meals`. **Une migration**, appliquée en LOCAL uniquement.
Aucun `db push` distant, aucun commit, aucun push. **Aucun transfert Mac** — ce rapport le
précède.

| | |
|---|---|
| Tests TypeScript N1.5 | **91**, 0 échec (81 → 91 : `RENOMMAGE` retiré, **11 ROLL** ajoutés) |
| Checklist SQL N1.5.2 | **50 contrôles + section Z**, 0 échec |
| Contrôles négatifs de transition | **8 / 8 discriminants**, md5 vérifié |
| Contrôles négatifs solveur / écriture rejoués | **9 / 9 discriminants**, md5 vérifié |
| Banc de transition sur données de production | **609 options dont 63 avec unité** — diff vide |
| Checklists SQL rejouées | N1.1 · 107, N1.3 · 43, N1.5.1 · 46, A5.7 · 38, A5 favoris · 30, matrice sécurité · 76, A1 · 149 |
| Batterie TypeScript complète | **100 suites** via `npm run test:*` — 92 vertes, **8 rouges hors périmètre** (§ 11) |
| `npx tsc --noEmit` / `npx eslint .` / `git diff --check` | propres (exit 0) |

---

## 1. Ce que ta correction a changé, et pourquoi j'avais tort

Le lot précédent renommait `preferred_unit` → `quantity_unit`. C'était encore faux, et pour la
raison que tu as nommée : **la production est servie par du code qui lit `preferred_unit`.**

Renommer, c'est choisir qui casse :

| ordre | conséquence |
|---|---|
| base migrée avant le déploiement | l'ancien code ne trouve plus la colonne |
| déploiement avant la base | le nouveau code ne la trouve pas encore |

**Il n'existe pas d'ordre sûr.** Ce lot est donc l'**EXPAND** :

1. `quantity_unit` naît **à côté** de `preferred_unit` ;
2. l'unité existante est recopiée **1:1** — pas un backfill métier, le transport d'une valeur
   qui existait déjà ;
3. `preferred_unit` **survit** et **reste écrite** tant qu'une portion existe ;
4. le **CONTRACT** — la supprimer, elle et sa contrainte — sera un lot séparé, après
   déploiement et validation terrain.

---

## 2. Le banc de transition : 609 options, dont 63 avec unité

Une base neuve ne prouve rien. J'ai donc reconstruit une base **dans l'état réel de la
production** — toutes les migrations **sauf** N1.5.2 — puis j'y ai posé la forme exacte mesurée
le 15/08/2026 : **609 options, dont 63 portant portion + unité**, unités alternées g/ml,
portions décimales une fois sur trois. Puis j'ai appliqué N1.5.2 **par-dessus**.

| mesure | résultat |
|---|---|
| les 63 lignes (`id·portion·unité`) avant vs après | **diff vide**, md5 identique `e7b401e4…` |
| copie 1:1 des unités | **63 / 63**, `g×32 ml×31` |
| unités perdues | **0** |
| lignes perdues (609) | **0** |
| les 546 sans portion restent nues | **546 / 546** |
| minimums inventés | **0** |
| décimale conservée (3 → 3,25) | **3.25** |
| `preferred_unit` existe encore | **oui** |

**Puis le second passage**, avec entre les deux **deux options écrites par le nouveau code**
(un minimum seul, une portion) : **diff strictement vide sur 611 lignes.** La garde
`and quantity_unit is null` fait de l'`update` un no-op qui ne peut jamais piétiner une
écriture récente.

---

## 3. Le résultat le plus utile de ce lot, et je ne l'attendais pas

En contrôle négatif, j'ai **supprimé la copie 1:1** et rejoué la migration sur les données de
production. Attendu : 63 unités perdues en silence. Mesuré :

```
ERROR: check constraint "meal_choice_options_quantites_unite" is violated by some row
unités PERDUES : 63
```

**La migration refuse de s'appliquer.** La contrainte métier — écrite pour dire la vérité de
N1.5.2 — sert accidentellement de filet à un backfill oublié : sur les vraies données, l'oubli
est une erreur bruyante, pas une perte silencieuse. Sous Supabase CLI, chaque fichier s'exécute
dans une transaction : l'échec serait total, sans état intermédiaire.

Symétriquement, en supprimant la **double écriture** de la RPC :

```
ERROR: new row violates check constraint "meal_choice_options_preferred_paire"
```

C'est la contrainte de N1.5.1 **qu'on a délibérément conservée** qui refuse l'insert. Un
développeur qui « nettoierait » la colonne legacy ne peut pas casser le rollout en silence : ça
échoue à l'écriture.

---

## 4. Deux contraintes, et il faut savoir laquelle est laquelle

**1. La contrainte MÉTIER** — celle qui survivra au CONTRACT :

```sql
check ((preferred_quantity is null and minimum_quantity is null) = (quantity_unit is null))
check (quantity_unit is null or quantity_unit in ('g','ml'))
```

**2. Les contraintes LEGACY, temporaires** — `meal_choice_options_preferred_paire` et
`meal_choice_options_preferred_unit_check` de N1.5.1 sont **conservées mot pour mot**. Ce n'est
pas de la négligence : la paire dit « portion présente ⟹ unité legacy présente », et un
**minimum seul la satisfait déjà** (les deux nulles). Il n'y avait donc rien à généraliser de ce
côté — et la toucher aurait été une casse gratuite du contrat déployé.

On y ajoute la seule chose qu'elles ne garantissaient pas :

```sql
check (preferred_unit is null or preferred_unit = quantity_unit)   -- unite_legacy_coherente
```

**Les deux unités ne peuvent pas diverger.** C'est le seul vrai risque de l'expand par rapport
au rename, et il est fermé par une contrainte, pas par une convention.

---

## 5. La double écriture, et sa dissymétrie assumée

| l'option porte | `quantity_unit` | `preferred_unit` |
|---|---|---|
| une portion (± un minimum) | l'unité | **la même unité** |
| un minimum SEUL | l'unité | **NULL** |
| ni l'un ni l'autre | NULL | NULL |

**Un minimum seul ne remplit pas l'ancienne colonne**, et c'est délibéré : `preferred_unit` n'a
jamais dit que l'unité d'une **portion**. Lui faire dire celle d'un minimum ferait déduire à
l'ancien lecteur une portion qui n'existe pas — et la paire de N1.5.1 le refuserait de toute
façon. L'ancien code ignore alors le minimum, ce qui est exactement le comportement acceptable
le temps du déploiement (ton §4).

Vérifié **en exécutant la vraie RPC**, pas en lisant son source : le nouveau code n'envoie que
`quantity_unit`, et les deux colonnes ressortent remplies ; une charge utile **ancienne**, qui
ne connaît que `preferred_unit`, reste valide et remplit les deux également.

---

## 6. Les messages d'erreur aussi sont un contrat

`PORTION_SANS_UNITE` de N1.5.1 est **conservé**, et couvre exactement les deux formes qu'il
couvrait déjà. Le cas **neuf** — un minimum sans unité — reçoit un nom neuf, `MINIMUM_SANS_UNITE`,
et lui seul. Le lot précédent les fusionnait sous `QUANTITE_SANS_UNITE` : un rename de plus,
pour un gain nul.

C'est ce qui permet le point suivant.

---

## 7. La preuve la plus forte : la checklist N1.5.1 est restaurée **bit pour bit**

Le lot précédent avait modifié `nutrition_n1_5_1_portions_checklist.sql` pour suivre le
renommage. Sous l'expand, ce n'est plus nécessaire — et sa version d'origine devient le meilleur
test de transition qui soit.

Je l'ai donc **récupérée depuis le Mac** (lecture seule ; N1.5.2 n'y a jamais été transférée,
sa copie est la version N1.5.1 intacte) et restaurée :

```
md5 Mac    3d283e7538fb41507a21bd8fe42e84e8
md5 source 3d283e7538fb41507a21bd8fe42e84e8
```

**Elle passe, inchangée, sur une base portant N1.5.2 : 46 contrôles, 0 échec.** Elle exerce la
vraie RPC avec la clé `preferred_unit`, relit `o.preferred_unit = 'g'`, vérifie la paire de
N1.5.1 mot pour mot. Le contrat N1.5.1 n'est pas « supposé compatible » : il est rejoué.

---

## 8. Les onze tests ROLL

`N1.5.2-RENOMMAGE` affirmait que l'ancien nom avait disparu **partout** — l'exact contraire de
ce qu'il faut. Remplacé par :

| test | ce qu'il garde |
|---|---|
| ROLL-01 | `add column` + copie 1:1 conditionnée à `preferred_unit is not null` |
| ROLL-02 | garde `and quantity_unit is null` — idempotence, pas d'écrasement |
| ROLL-03 | les contraintes de N1.5.1 ne sont pas supprimées |
| ROLL-04 | la divergence des deux unités est interdite par une contrainte |
| ROLL-05 | contrainte métier + aucune colonne `minimum_unit` + aucun 300/500 |
| ROLL-06 | double écriture présente **et conditionnée** à la portion |
| ROLL-07 | `preferred_unit` reste acceptée en entrée, `quantity_unit` prioritaire |
| ROLL-08 | `PORTION_SANS_UNITE` conservé, `MINIMUM_SANS_UNITE` neuf |
| ROLL-09 | **aucun `DROP` de `preferred_unit`** |
| ROLL-10 | **aucun `RENAME`**, d'aucune colonne |
| ROLL-NOUVEAU-LECTEUR | le nouveau code TS ne nomme jamais l'ancienne colonne |

**Et la leçon « on cherche du code, pas de la prose » sert une cinquième fois** : la migration
raconte l'expand dans ses `--` **et** dans ses `comment on column`, qui sont des chaînes SQL que
le nettoyage des `--` ne touche pas. Chercher « drop column » ou « rename » en texte brut aurait
fait rougir ces contrôles pour les phrases qui affirment précisément ce qu'ils vérifient. D'où
`DDL_N152`, dépouillé des deux.

---

## 9. Contrôles négatifs de transition — 8 / 8 discriminants

md5 de la migration vérifié après chaque restauration (`30ca9a01f9639ce3d94c8711e91b337f`) :

| sabotage | rougit |
|---|---|
| copie 1:1 supprimée | tests TS **et** la migration refuse de s'appliquer sur les vraies données |
| garde d'idempotence retirée | ROLL-02 |
| double écriture retirée de l'`update` | ROLL-06 |
| double écriture remplacée par `null` (update + insert) | checklist SQL **et** contrainte N1.5.1 à l'écriture |
| contrainte de cohérence legacy retirée | ROLL-04 |
| retour au `rename column` | ROLL-01, ROLL-10 |
| `PORTION_SANS_UNITE` rebaptisé | ROLL-08 |
| double écriture retirée de l'`insert` | checklist SQL (section ROLL exécutée) |

Et les **9 contrôles négatifs du lot N1.5.2 lui-même** ont été rejoués, ancres à jour, md5 vérifié
après chaque restauration :

| sabotage | tests rouges |
|---|---:|
| le minimum est ignoré | 5 |
| figer à 0 au lieu du minimum | 3 |
| le résidu n'est pas recalculé | 8 |
| l'aliment figé perd ses macros | 1 |
| l'arrondi descend sous le minimum | 2 |
| la bibliothèque ne snapshote plus le minimum | 1 |
| la charge utile n'émet plus le minimum | 1 |
| la résolution laisse passer `min > plafond` | 1 |
| le writer accepte `min > plafond` | 1 |

---

## 10. Tout le reste de N1.5.2 est inchangé (ton §9, §10)

Le solveur, la sélection, l'UI, l'arrondi borné, la garde `min > plafond` à deux couches, le cas
terrain et le balayage n'ont **pas bougé** : la correction est purement une stratégie de
déploiement.

```
min_i = minimum snapshoté ?? 0        max_i = 300 g / 500 ml
```

`q < 0` est littéralement `q < min_i` quand `min_i` vaut 0 : la non-négativité de N1.5 est le cas
dégénéré du plancher. Boucle : résoudre → plus grande violation de plancher figée → sinon plus
grand dépassement figé → **résidu recalculé** → re-résoudre. Un aliment figé **continue
d'apporter ses macros**.

`clamp(round(q), ceil(min), floor(max))` — **une borne ne s'arrondit pas, elle se respecte**
(4,4 → 4 ❌ / 5 ✔ ; 12,3 → 12 ❌ / 13 ✔).

**Cas terrain**, P 55 · G 93 · L 32, valeurs Ciqual réelles — le banc reproduit d'abord le défaut :

| | flocons | beurre | fromage blanc | œuf | sirop | statut |
|---|---:|---:|---:|---:|---:|---|
| sans minimum | 149 | **0** | 160 | 207 | **0** | exact |
| beurre ≥ 5, sirop ≥ 10 | 130 | **5** | 239 | 179 | **10** | **exact** |

**Balayage : 5 376 quantités** entre plancher et plafond, aucune violation. Parcours A5 intact
(`A5-MIN-01..10`), aucune écriture dans `consumed_meals` ni `meal_entries`.

---

## 11. Rouges signalés, non corrigés, hors périmètre

**8 suites rouges sur 100**, et je ne les ai pas touchées. Ce ne sont pas des affirmations :

- **`training-movement-patterns` — F1 / F2 / F8 uniquement.** Défaut vidéo pré-existant
  (`SessionFeedbackSection` indexe `videosExercice[exercise.id]` là où le test attend
  `videosExercice[exerciseFb.exerciseId]`), déjà rapporté en N1.4 et N1.5.1. Son contrôle de
  compteur **B7 est vert** : 76 migrations, manifeste 49.
- **Les 7 autres** — `webhook-idempotency`, `account-activation-provisioning`,
  `previous-performance`, `set-rpe-feedback`, `prescribed-rpe`, `student-training-ui`,
  `student-feedback-video`. **Mesuré, pas supposé** : j'ai calculé la fermeture d'imports de
  chacune (28 à 97 modules) et **aucune n'atteint un seul fichier du lot**. Leurs échecs sont
  dans les domaines entraînement / webhook / vidéo (`supabase.rpc is not a function`, filtres de
  saisie réelle, chemin de vidéo).
- **Checklist A1, section Z** — sur un lab **reconstruit de zéro**, elle échoue parce qu'elle
  exige `food_catalog` globalement vide, alors qu'une migration antérieure y sème le Ciqual. Ses
  **149 contrôles sont verts**. Vérifié sur une base **sans N1.5.2** : même échec — donc
  indépendant de ce lot.
- **Checklist `nutrition_v2_unified`, 5 échecs** (suppression de recette dépubliée). Comptés
  **avec et sans N1.5.2** : **5 dans les deux cas**. Pré-existant.

Je n'ai modifié **aucun** de ces tests pour obtenir du vert.

**Un point d'exploitation, pas un test** : `.git/index.lock` traîne dans le dépôt Mac. `git
status` fonctionne, mais le pont ne peut pas supprimer de fichier. À retirer à la main avant le
transfert.

---

## 12. Fichiers

**Nouveaux** — `supabase/migrations/20260909090000_n1_5_2_quantite_minimale.sql` ·
`supabase/tests/nutrition_n1_5_2_minimum_checklist.sql` · `docs/nutrition-n1.5.2-livrable.md`

**Modifiés** — `lib/nutrition/meal-choice-solver.ts` · `meal-choice-selection.ts` ·
`plan-v2-week.ts` · `plan-v2-week-form.ts` · `lib/supabase/food-lists.ts` · `nutrition-week.ts` ·
`components/admin/FoodListEditor.tsx` · `scripts/tests/nutrition-n1-5-quantites.mts` ·
`scripts/tests/nutrition-n1-3-occurrences.mts` · `supabase/baseline/manifest.json` ·
la checklist N1.1 · 15 fichiers de tests (compteurs).

**Restauré à l'identique** — `supabase/tests/nutrition_n1_5_1_portions_checklist.sql`
(md5 égal au Mac : il ne fait plus partie du lot).

`package.json` **n'est pas touché**.

---

## 13. §19 — la couleur n'est toujours pas dans ce lot

Conformément à ton §12 : aucune couleur ici. L'audit COLOR suit dès que N1.5.2 est sécurisé.

---

## 14. Le runbook, maintenant qu'il est simple

L'expand **supprime la contrainte d'ordre** qui était le seul point d'exploitation du lot
précédent :

1. `db push` de N1.5.2 — **peut partir seul**, sans déploiement simultané. L'ancien code
   continue de lire `preferred_unit`, qui est intacte et toujours écrite.
2. Déploiement du nouveau code — quand tu veux. Il lit `quantity_unit`, déjà rempli.
3. **CONTRACT, lot séparé** — après validation terrain : `drop column preferred_unit`,
   `drop constraint meal_choice_options_preferred_paire`,
   `drop constraint meal_choice_options_preferred_unit_check`,
   `drop constraint meal_choice_options_unite_legacy_coherente`. Rien d'autre.
