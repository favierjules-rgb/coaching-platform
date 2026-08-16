# N1.1 — MIGRATION, CONTRAINTES, RLS, RPC, TESTS SQL

**Aucun `db push` distant. Aucun commit. Aucun push. Aucun merge. Aucune UI.**
La migration n'a été appliquée **que** sur la base locale `lab`, en PostgreSQL
16.13, et chaque exécution de la checklist se termine par un `ROLLBACK` vérifié.

---

## 1. Ce qui est livré

| fichier | état |
|---|---|
| `supabase/migrations/20260906090000_nutrition_listes_et_repas_planifies.sql` | **nouveau** — 6 tables, 3 fonctions, RLS, privilèges |
| `supabase/tests/nutrition_n1_listes_checklist.sql` | **nouveau** — 102 contrôles |
| `supabase/baseline/manifest.json` | modifié — la migration y est déclarée (45 → 46) |
| `supabase/tests/aliments_a1_checklist.sql` | modifié — liste blanche des lectrices de `food_catalog` |
| 12 fichiers `scripts/tests/*.mts` | modifiés — compteurs de migrations (72 → 73, 45 → 46) |

Le détail des modifications de tests existants, et pourquoi elles étaient
inévitables, est au §9.

---

## 2. Les six tables

Aucune table existante n'est modifiée. Un contrôle le vérifie par comptage de
colonnes : `meals` garde ses 9, `consumed_meals` ses 14, `meal_entries` ses 16.

```
food_lists           coach_id→coaches(RESTRICT) · name · archived_at
 └ food_list_items   list_id(CASCADE) · position · catalog_food_id XOR product_id (RESTRICT)

meal_choice_slots    meal_id→meals(CASCADE) · position · label · source_list_id(SET NULL)
 └ meal_choice_options slot_id(CASCADE) · position · catalog_food_id XOR product_id (RESTRICT)

planned_meals        student_id(CASCADE) · planned_on · meal_id(CASCADE) · slot_key · label
                     target_kcal/protein/carb/fat · consumed_meal_id(SET NULL)
 └ planned_meal_items (planned_meal_id, student_id)→planned_meals(id, student_id) CASCADE
                     choice_slot_id NOT NULL(CASCADE) · position
                     catalog_food_id XOR product_id (RESTRICT) · quantity · unit
```

**Aucune colonne de rôle, nulle part.** Le contrôle `N1-A` l'exige
structurellement : aucune colonne des six tables ne peut s'appeler `%role%`,
`%macro%`, `%protein%`, `%carb%`, `%fat%` ni `%reference%` — à la seule exception
assumée des quatre `target_*` de `planned_meals`, qui sont l'objectif du créneau
et non une valeur d'aliment. Et `planned_meal_items` ne porte **aucune macro** :
elles se dérivent de l'identité et de la quantité.

---

## 3. Le mécanisme du snapshot, et sa preuve

`meal_choice_options` porte ses propres lignes. **Il n'existe aucune clé
étrangère vers `food_list_items`** — un contrôle le vérifie sur `pg_constraint`.
`source_list_id` est de la provenance pure, en `ON DELETE SET NULL`.

La preuve est exécutée, avec son contrôle négatif dans le même bloc :

```
N1-C · MODIFIER LE MODÈLE NE CHANGE RIEN AU REPAS (2 options, pas 3)     ✓
N1-C · contrôle négatif : la lecture PAR LE MODÈLE, elle, verrait 3      ✓
N1-C · les deux chemins DIFFÈRENT — le test discrimine bien             ✓
```

Le scénario est celui du cahier des charges : le coach ajoute « Crevette » au
modèle *Protéines* deux semaines après l'avoir posé dans le repas de Jules. Le
repas reste à deux options ; la même question posée en joignant le modèle en
verrait trois. **Sans la troisième assertion, les deux premières pourraient être
vertes sur une base vide.**

Le cas destructeur est couvert aussi : **supprimer** le modèle ne retire aucune
option, et les occurrences survivent en perdant seulement leur provenance.

---

## 4. L'aliment hors liste — refusé par la base, pas par la RPC

Deux clés étrangères composites sur `planned_meal_items` :

```
(choice_slot_id, catalog_food_id) → meal_choice_options (slot_id, catalog_food_id)
(choice_slot_id, product_id)      → meal_choice_options (slot_id, product_id)
```

Elles s'appuient sur deux contraintes `UNIQUE` **non partielles** posées sur
`meal_choice_options`. C'est une exception assumée à la convention du dépôt (qui
utilise ailleurs des index partiels) : PostgreSQL exige qu'une clé étrangère
référence une contrainte unique non partielle. Le comportement reste correct —
`UNIQUE` autorise autant de `NULL` qu'on veut, donc les produits ne sont pas
limités.

### Le cas `choice_slot_id NULL`, traité explicitement

Les clés composites sont en `MATCH SIMPLE` : **si une de leurs colonnes est
`NULL`, la vérification est sautée**. Un `choice_slot_id` nullable rouvrirait
donc exactement la porte que ces clés ferment — il suffirait de l'omettre.

La colonne est donc **`NOT NULL`**. Combinée au `CHECK` « exactement une
identité », cela garantit qu'une des deux clés est **toujours** active, sur
toutes les lignes. Il n'existe aucun `choice_slot_id` nul possible, donc aucun
cas de contournement.

Conséquence assumée du `CASCADE` : si le coach retire une occurrence du repas,
les aliments planifiés pour elle disparaissent — le choix n'existe plus. Le repas
planifié, lui, survit.

Les trois refus sont **exécutés en tant que propriétaire, donc sans RLS et sans
passer par la RPC** — le but est de prouver que la protection tient même si un
autre chemin d'écriture apparaissait :

```
N1-G · un aliment DE la liste est accepté                              ✓
N1-G · un aliment ajouté au modèle APRÈS le snapshot est refusé        ✓
N1-G · un aliment d'une AUTRE occurrence est refusé                    ✓
N1-H · choice_slot_id est NOT NULL — le trou du match simple est fermé ✓
N1-H · un aliment SANS occurrence est refusé                           ✓
N1-H · un aliment planifié ne peut pas changer d'élève                 ✓
```

---

## 5. Les trois fonctions

**`cible_creneau_du_repas(uuid)`** — `stable`, `security definer`,
`search_path = public`. Rend la cible P/G/L/kcal d'un repas prescrit : profil du
jour, puis part du créneau, deux étages de points de base, kcal en 4/4/9, aucun
arrondi.

⚠️ **Ce calcul existait déjà, en ligne, dans `ouvrir_repas_prescrit`.** Je ne l'ai
**pas** modifiée — toucher une RPC de production dépasse le périmètre de N1.1.
La duplication est donc réelle, et je l'ai transformée en **invariant testé** :

```
N1-K · la cible du dîner est bien 75 P / 80 G / 33,33 L                        ✓
N1-K · les kcal dérivent du 4/4/9, jamais d'une somme de points de base        ✓
N1-K · le repas planifié a figé exactement cette cible                         ✓
N1-K · ouvrir_repas_prescrit rend LES MÊMES nombres — pas deux conventions     ✓
```

Le jour où l'une des deux dérive, la checklist rougit.

**`enregistrer_repas_planifie(uuid, date, jsonb)`** — `security definer`,
`search_path = public`. Une transaction, sept vérifications, un remplacement
intégral :

1. élève connu ; 2. date fournie ; 3. le repas appartient à un plan **réellement
assigné ET lisible** (`status <> 'prochain'`) ; 4. le repas est **guidé** (au
moins une occurrence) ; 5. l'ensemble des occurrences envoyées est **exactement**
celui du repas — aucune omise, aucune doublée, aucune étrangère ; 6. chaque
aliment appartient au snapshot de son occurrence ; 7. l'unité est convertible
pour cet aliment — vérifié en appelant `quantite_en_base_nutritionnelle` d'A2,
qui lève elle-même `PIECE_SANS_POIDS` ou `UNITE_INCOMPATIBLE`.

Puis `upsert` du repas planifié, `delete` de tous ses aliments, `insert` des
nouveaux. **Aucune macro n'est calculée ni stockée**, et rien n'est écrit dans
`consumed_meals`.

**`supprimer_repas_planifie(uuid)`** — sans elle, l'élève ne pourrait jamais
annuler une planification, puisqu'il n'a aucun privilège `DELETE`.

---

## 6. Planifier n'est pas consommer

```
N1-J · aucun consumed_meals n'a été créé                          ✓
N1-J · aucune meal_entries n'a été créée                          ✓
N1-J · le repas planifié n'est rattaché à aucune consommation     ✓
```

L'état « planifié » contre « mangé » se **dérive** de `consumed_meal_id`, il
n'existe aucune colonne `status`. Un drapeau serait une seconde vérité à
maintenir d'accord avec les faits — exactement ce qu'A5.7 évite avec `aSaisie`.

---

## 7. Résultat de la checklist

```
npm : aucun script — la checklist se lance directement
  psql -d lab -f supabase/tests/nutrition_n1_listes_checklist.sql

N1.1 · LISTES ET REPAS PLANIFIÉ — 102 contrôles, 0 échec(s)
OK — Z · aucune donnée de test ne subsiste
```

Sections : `N1-A` structure et absence de rôle · `N1-B` identités · `N1-C`
snapshot · `N1-D` liste répétée · `N1-E` ordres · `N1-F` personnalisation ·
`N1-G` aliment hors liste · `N1-H` `choice_slot_id` · **`N1-CHOIX` un choix par
occurrence, toutes obligatoires** · **`N1-PLAN` plan « prochain »** · `N1-I` la
RPC · `N1-J` planifier ≠ consommer · `N1-K` la cible · `N1-L` unités · `N1-M`
RLS · `N1-N` privilèges · `N1-O` anciens plans · `N1-P` archivage · `SUP`.

---

## 7 bis. Les quatre corrections de ce passage

### a. Une occurrence = un seul aliment, garanti par la base

```sql
constraint planned_meal_items_un_choix_par_occurrence
  unique (planned_meal_id, choice_slot_id)
```

Côté élève une occurrence est un « Choisir un aliment » : elle rend UN choix.
Sans cette contrainte, rien n'empêchait d'écrire deux aliments pour la même
liste — et l'écran, qui n'en affiche qu'un, aurait caché le second **tout en le
laissant peser sur les courses et sur le calcul**.

### b. Toutes les occurrences sont obligatoires — et c'est une comparaison d'ENSEMBLES

La RPC construit le tableau des occurrences envoyées, puis applique quatre refus,
du plus précis au plus général :

| ordre | refus | motif |
|---|---|---|
| 1 | une occurrence est `null` | `OCCURRENCE_MANQUANTE` |
| 2 | une occurrence est citée deux fois | `OCCURRENCE_EN_DOUBLE` |
| 3 | une occurrence n'appartient pas au repas | `OCCURRENCE_HORS_REPAS` |
| 4 | une occurrence du repas n'est pas couverte | `CHOIX_INCOMPLET` |

**Comparer les nombres ne suffirait pas** : une occurrence doublée plus une
occurrence omise donnent le même total. Le contrôle `N1-CHOIX-5` le prouve en
deux assertions — l'envoi est refusé, **et** le compte envoyé vaut bien 4 pour
4 occurrences.

En V1, **aucune liste n'est facultative**. Le jour où le facultatif arrivera, ce
sera une colonne sur `meal_choice_slots` et une condition ici — pas un
assouplissement silencieux.

### c. Le statut du plan

La RPC exige désormais `p.status <> 'prochain'`, **exactement** la condition des
policies de lecture `meals_select_self_or_assigned` et
`meal_choice_slots_select_assigned`. Une fonction `security definer` ignore la
RLS par construction : sans cette ligne, l'élève pouvait planifier un repas
qu'il ne peut même pas afficher. `N1-PLAN` le vérifie dans les deux sens, avec un
contrôle négatif de montage qui prouve que le refus venait bien du statut.

### d. Un défaut trouvé par le test du motif

`array_length` d'un tableau **vide** rend `NULL`, pas `0`. Sans `coalesce(…, 0)`,
`NULL is distinct from 0` est vrai : un envoi vide était refusé pour
« occurrence en double ». Le refus était correct, **le motif était faux** — et
c'est le contrôle qui vérifie le *motif*, pas seulement le refus, qui l'a
attrapé.

---

## 7 ter. Audit RLS demandé — l'écriture coach est globale, et c'est l'existant

Les trois policies de la chaîne de prescription, lues en base :

```
nutrition_plans_manage_staff   ALL  is_coach_or_admin()
nutrition_days_manage_staff    ALL  is_coach_or_admin()
meals_manage_staff             ALL  is_coach_or_admin()
```

Et la fonction elle-même :

```sql
select exists (select 1 from public.profiles
                where user_id = auth.uid() and role in ('coach', 'admin'));
```

**Aucune vérification d'appartenance.** Un coach peut donc écrire les plans, les
jours et les repas de n'importe quel autre coach — c'est la règle en vigueur
aujourd'hui, indépendamment de N1.

`meal_choice_slots_manage_staff` et `meal_choice_options_manage_staff` sont
**identiques**. Comme tu l'as demandé : je n'ai rien changé, et je le documente.
Leur donner une règle plus stricte créerait une incohérence — un coach pourrait
supprimer le repas d'un confrère mais pas ses listes de choix.

La bibliothèque, elle, est un catalogue **possédé** : elle suit l'autre
convention du dépôt, celle de `nutrition_recipes_manage_own_coach`, et un test
vérifie que les deux `qual` sont littéralement égales.

**Deux contrôles épinglent l'équivalence** (`N1-M`) : le jour où `meals` sera
restreint aux élèves d'un coach, ils rougiront et forceront à restreindre les
tables N1 avec lui.

En production il n'existe **qu'un seul coach** aujourd'hui, donc l'exposition
pratique est nulle — mais la règle, elle, est bien celle-là.

---

## 8. Contrôles négatifs — treize, exécutés puis restaurés

Chacun sabote la migration, rejoue la checklist, puis restaure le fichier.

| # | sabotage | ce qui rougit |
|---|---|---|
| 1 | `choice_slot_id` redevient nullable | N1-H × 2 |
| 2 | la clé étrangère d'appartenance au snapshot est retirée | N1-G × 2, SUP |
| 3 | une colonne `solver_role` est ajoutée à `food_lists` | N1-A |
| 4 | `authenticated` reçoit INSERT/UPDATE/DELETE sur `planned_meals` | N1-N × 2 |
| 5 | une policy de lecture élève est ajoutée sur la bibliothèque | N1-M × 3 |
| 6 | la RPC n'efface plus les aliments précédents | N1-I |
| 7 | la cible applique les points du créneau aux calories du jour | N1-K × 3 |
| 8 | la RPC ne vérifie plus l'appartenance au snapshot | N1-I |
| 9 | un repas sans occurrence devient planifiable | N1-I × 2 |
| 10 | la contrainte « un choix par occurrence » est retirée | N1-CHOIX-6 × 2 |
| 11 | la RPC n'exige plus la couverture des occurrences | N1-CHOIX-2, N1-CHOIX-3 |
| 12 | la RPC ne détecte plus une occurrence doublée | N1-CHOIX-4, N1-CHOIX-5 |
| 13 | la RPC ne vérifie plus le statut du plan | N1-PLAN |

### Deux contrôles ont trouvé un défaut dans les tests eux-mêmes

**Le n° 2**, au premier essai, n'a fait rougir qu'**un** des deux contrôles
d'appartenance. Le second restait vert — non parce que l'aliment était refusé,
mais parce que la ligne précédente, désormais acceptée, occupait déjà la
position 2 et déclenchait la contrainte d'unicité. **Deux contrôles qui partagent
une clé d'unicité se masquent.** Corrigé : positions 2 et 3, sabotage rejoué, les
deux rougissent.

**Le n° 2, une seconde fois.** Après l'ajout de l'unicité « un choix par
occurrence », il a **régressé** : seul `SUP` rougissait, les deux contrôles
`N1-G` restaient verts. La raison est la même que la première fois, sous un autre
visage — les trois insertions visaient la même occurrence, donc la nouvelle
contrainte d'unicité prenait le relais de la clé étrangère retirée. Les trois
visent maintenant **trois occurrences distinctes et trois positions distinctes**.
Sabotage rejoué : les trois rougissent.

**Le n° 6**, au premier essai, faisait échouer la checklist *sans dire lequel* :
la RPC sabotée lève une violation d'unicité qui avorte le bloc entier et emporte
tous les contrôles suivants. L'appel est maintenant enveloppé, et l'échec est
capturé et nommé.

### Le n° 8 dit quelque chose d'utile

Retirer la vérification d'appartenance **dans la RPC** ne fait rougir que le
contrôle du **message** (`CHOIX_HORS_LISTE`). L'insertion reste refusée — par la
clé étrangère composite. C'est exactement la répartition annoncée : **la base est
le rempart, la RPC ne fournit qu'un motif lisible.**

---

## 9. Modifications de tests existants — assumées et justifiées

### 9.1 La liste blanche d'A1 (`aliments_a1_checklist.sql`)

Le contrôle `RECIPE-A2` interdit qu'une fonction se mette à lire `food_catalog`,
avec une liste blanche de cinq noms. `enregistrer_repas_planifie` la lit — pour
la même raison qu'`ajouter_aliment_catalogue` : valider que l'unité demandée est
convertible pour cet aliment. Sans cette lecture, une quantité serait planifiable
en pièces puis refusée au moment de la consommation, c'est-à-dire trop tard.

J'ai donc **ajouté un sixième nom**, avec le commentaire qui l'explique. Ce que
le contrôle garde est intact : aucune fonction du monde des **recettes** ne lit
`food_catalog`, et l'assertion suivante le vérifie nommément sur les quatre RPC
de recettes.

**Contrôle négatif exécuté :** retirer le nom de la liste blanche fait rougir
`RECIPE-A2`. L'allow-list discrimine toujours.

### 9.2 Les compteurs de migrations (12 fichiers `.mts` + le manifeste)

Le dépôt compte **32 assertions** sur le nombre de migrations, réparties dans
13 fichiers, et un manifeste `supabase/baseline/manifest.json`. Le commentaire
d'`aliments-a1.mts` dit leur raison d'être :

> « COMPTEUR VOLONTAIREMENT EXPLICITE. Il doit être mis à jour à CHAQUE nouvelle
> migration — c'est le but : ajouter un fichier au dossier est un acte délibéré,
> et ce rouge en est l'accusé de réception. »

72 → 73, et 45 → 46 pour le manifeste. **C'est le workflow prévu, pas un
contournement.** Le test `coach-reply-video` G1 est celui qui a attrapé l'oubli
du manifeste, avec sa propre justification : *« Une migration absente du manifeste
n'est JAMAIS appliquée localement : la suite passerait au vert contre un schéma
qui n'est pas celui de la Production. »*

### 9.3 Trois gardes « aucune migration postérieure », réécrites sans perdre leur sens

`courses-c1.mts`, `aliments-a5-coach.mts` et `aliments-a5-history.mts`
affirmaient `migrations postérieures à A5 == []`. C'était vrai tant qu'aucun
chantier ne suivait — le dépôt a déjà connu cinq fois ce motif, et
`aliments-a3-search.mts` le documente comme tel.

Elles affirment maintenant que la liste des migrations postérieures est
**exactement** celle de N1, nommée. Ce que chaque lot devait prouver — *ce lot-ci
n'a créé aucune migration* — reste prouvé.

### 9.4 Une fenêtre bornée des deux côtés (`aliments-a5-history.mts`)

Le contrôle « aucune migration d'A5 ne parle d'historique » filtrait
`horodatage >= "20260905"`, borne basse seule. La migration de N1 y entrait, et
son `comment on table` — qui explique justement pourquoi un repas planifié ne
doit **pas** peser sur l'historique A5.7 — faisait rougir un contrôle qui ne
parle que d'A5. Fenêtre bornée à `< "20260906"`. La règle gardée est inchangée.

---

## 10. Non-régression

### Checklists SQL, exécutées sur `lab`

| checklist | résultat |
|---|---|
| `nutrition_n1_listes_checklist` | **102 contrôles, 0 échec** |
| `nutrition_security_matrix_checklist` | 76 contrôles, 0 échec |
| `aliments_a1_checklist` | 149 contrôles, 0 échec |
| `aliments_a2_checklist` | 121 contrôles, 0 échec |
| `aliments_a5_favoris_checklist` | 30 contrôles, 0 échec |
| `aliments_a5_7_historique_checklist` | 38 contrôles, 0 échec |
| `nutrition_v2_unified_checklist` | 176 contrôles, **4 échecs — antérieurs** |

**Preuve d'antériorité, pas déclaration :** les quatre rouges de
`nutrition_v2_unified` (I11, I12, I12 bis, I13 bis — suppression d'une recette
dépubliée) sont **identiques avec et sans** les objets N1. Je l'ai vérifié en
supprimant les six tables et les trois fonctions, puis en rejouant : 4 échecs
dans les deux cas.

### Suites TypeScript — 97 suites, 2 257 tests verts

Huit suites rouges, **exactement les mêmes qu'avant ce lot** : `webhook-idempotency`
(7), `account-activation-provisioning` (16), `previous-performance` (1),
`set-rpe-feedback` (1), `prescribed-rpe` (1), `student-training-ui` (1),
`training-movement-patterns` (3), `student-feedback-video` (1). Aucune nouvelle.

`npx tsc --noEmit` : aucune erreur. `npx eslint .` : aucune erreur.
`git diff --check` : propre.

---

## 11. `piece_weight_g` — STOP respecté

N1.1 **n'écrit aucune donnée métier**. La chaîne existante est réutilisée telle
quelle : `unitesPourAliment` → `ajouter_aliment_catalogue` →
`quantite_en_base_nutritionnelle`, et la RPC de planification appelle ce même
helper. Aucune métadonnée parallèle n'est créée.

La checklist crée un aliment de banc avec `piece_weight_g = 50` **dans une
transaction annulée** — ce n'est pas une donnée écrite, c'est un banc de test.

Deux contrôles gardent la règle :

```
N1-L · la pièce est refusée quand l'aliment n'en déclare pas le poids  ✓ (PIECE_SANS_POIDS)
N1-L · la pièce est acceptée quand piece_weight_g est renseigné        ✓
```

**Le jour où il faudra renseigner un poids de pièce sur un vrai aliment, je
m'arrêterai avant de l'écrire** — c'est une valeur métier, pas une valeur
technique.

---

## 12. Branche — commandes proposées, aucune branche touchée

Le dépôt du Mac est actuellement sur **`feat/courses-c2`**, qui contient les deux
commits de Courses C1 (`e2d3720`, `f7169c7`) — **absents de `main`**.

Je n'ai créé aucune branche et n'ai extrait aucun fichier dans l'arbre de travail,
précisément pour ne pas déposer N1 sur la mauvaise branche. Les deux archives sont
posées à la racine du dépôt, **non extraites**.

```bash
cd ~/Documents/coaching-platform
rm -f .git/index.lock                    # le pont laisse parfois ce verrou

git switch main
git switch -c feat/nutrition-structured-meals

tar xzf n1.1-main.tgz --overwrite        # 16 fichiers
rm n1.1-main.tgz n1.1-compteur-courses-c1.tgz

git status                               # relire avant de committer
```

**⚠️ Un point à connaître.** `scripts/tests/courses-c1.mts` **n'existe pas sur
`main`** : il vit sur les branches Courses. Son compteur de migrations est donc
livré à part, dans `n1.1-compteur-courses-c1.tgz`, à appliquer **le jour où C1
sera fusionné** — sans quoi la suite `courses-c1` rougira sur 73 migrations
là où elle en attend 72.

Les compteurs sur `main` valent bien 72 et 45 aujourd'hui : le delta s'y applique
proprement.

---

## 13. Ce que N1.1 ne fait pas

Aucune UI. Aucune lecture ni écriture côté application. Aucun module de calcul —
le solveur N1 est le lot N1.5. Aucune donnée `piece_weight_g`. Aucun
`db push` distant : la migration n'a tourné que sur `lab`, et devra être appliquée
en Production par un runbook validé, séparément.

---

**STOP après N1.1. Aucun commit, aucun push, aucun merge, aucun `db push`
distant.**
