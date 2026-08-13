# ALIMENTS A1 — LIVRABLE §13, AVANT TOUT `db push`

**Aucun `npx supabase db push --linked` lancé. Rien committé. Rien poussé.**
Aucune écriture sur le projet Supabase distant : les seuls appels distants ont
été des **lectures** (`list_extensions`, `execute_sql` en `select`).

---

## 1. BANC D'ESSAI — CE SUR QUOI LES TESTS ONT RÉELLEMENT TOURNÉ

Docker n'est pas disponible dans le conteneur de travail, mais **PostgreSQL 16.13
natif l'est**. J'ai donc reconstruit une base locale fidèle plutôt que de me
contenter d'un test statique :

1. amorçage Supabase minimal — rôles `anon` / `authenticated` / `service_role`,
   schémas `auth` / `storage` / `extensions`, `auth.uid()` lisant
   `request.jwt.claims`, `pgcrypto`, `uuid-ossp` ;
2. chargement du **baseline réel** `00_baseline_remote_schema.sql` → **45 tables,
   107 policies, 5 fonctions**, exactement ce que le manifeste déclare ;
3. rejeu des **36 migrations post-baseline**, A1 comprise, sur une base **vierge** ;
4. exécution de la checklist.

Trois extensions absentes d'un PostgreSQL nu (`pg_cron`, `pg_net`,
`supabase_vault`, `pg_stat_statements`) ont été neutralisées **dans une copie de
travail hors du dépôt** (`/root/lab-pg/`). Le fichier `supabase/baseline/00_baseline_remote_schema.sql`
du dépôt n'a **pas** été modifié — son empreinte SHA-256 reste celle du manifeste,
ce que `security-hardening` test 19 vérifie et qui est resté vert.

---

## 2. MIGRATION SQL EXACTE

`supabase/migrations/20260831090000_food_catalog_and_meal_entries.sql`
SHA-256 `847440e12514d0d2e2b9319d62560ff35aa57152fb9dfdfa5ef341522d38e7ac`

Le fichier complet t'a été livré. Résumé de ce qu'il contient, dans l'ordre :

| § | Objet |
|---|---|
| A | `public.food_slug(text)` — normalisation déterministe |
| B | `public.is_coach_of_student(uuid)` — la relation coach ↔ élève |
| C | `public.food_catalog` |
| D | `public.food_aliases` |
| E | `public.meal_entries` (instantané indépendant de sa source, aucun trigger de gel) |
| F | RLS, 9 policies, privilèges, triggers `set_updated_at` |

**Aucun `insert`. Aucun `create extension`. Aucun `drop table` ni `drop column`.**
Les seuls `drop … if exists` portent sur des policies et des triggers que la
migration recrée immédiatement (vérifié par le test 16).

---

## 3. HELPERS AJOUTÉS

### `public.food_slug(text)` — `immutable`, `strict`, `search_path = ''`

Ligatures développées dans les deux casses (`Œ`/`œ`→`oe`, `Æ`/`æ`→`ae`, `ß`→`ss`),
accents latins retirés par `translate()` dans les deux casses, repli de casse
ASCII par `translate()`, puis tout le reste réduit à des tirets simples.

**Défaut trouvé en l'exécutant, pas en le relisant.** La première version
utilisait `lower()`. `lower()` est déclarée `immutable` par PostgreSQL mais son
résultat **dépend de la collation** : sur une base en locale C,
`« Œuf entier »` devenait **`uf-entier`** — la ligature n'était pas repliée puis
le caractère était balayé. Une colonne générée figée sur une normalisation
dépendante de la locale aurait été fausse dès qu'un environnement diffère.
`lower()` a été supprimée. Mesures après correction :

```
Fromage blanc 0 %        -> fromage-blanc-0
Œuf entier / ŒUF ENTIER  -> oeuf-entier      (identiques)
Pâtes complètes, cuites  -> pates-completes-cuites
Bœuf haché 5%            -> boeuf-hache-5
Müsli & Straße           -> musli-strasse
!!!                      -> NULL             (ligne refusée)
```

### `public.is_coach_of_student(uuid)` — `stable`, `security definer`, `search_path = public`

```sql
select exists (
  select 1 from public.students s
   where s.id = p_student_id
     and s.coach_id is not null
     and s.coach_id = public.current_coach_id());
```

`revoke execute … from public`, puis `from anon` ; `grant … to authenticated, service_role`.
`security definer` parce que la RLS de `students` filtrerait un `invoker` et
répondrait faux pour la mauvaise raison — même motif que `current_coach_id()`.

**Aucun rattachement automatique.** Les élèves sans `coach_id` ne sont lisibles
par aucun coach, seulement par eux-mêmes et par l'administrateur. C'est vérifié
explicitement (MEAL-A7), pas subi.

### Aucun trigger de gel — correction du 11/08/2026

Une première rédaction posait `meal_entries_freeze_snapshot()`, un trigger
`before update` qui refusait toute modification des six colonnes de
l'instantané. **Il a été retiré.** Il confondait deux règles distinctes :

- « l'entrée ne suit pas sa source » — **voulue**, et portée par le fait que
  les macros sont **stockées**, jamais dérivées à la lecture, avec des FK en
  `on delete set null` ;
- « l'entrée ne bouge jamais » — **non voulue**, et mauvaise UX : une faute de
  quantité aurait obligé à supprimer, rechercher à nouveau, recréer.

Le seul trigger `before update` de `meal_entries` est désormais
`set_updated_at`, celui de tout le schéma. La migration conserve un
`drop trigger if exists` + `drop function if exists` pour rester correcte si
elle est rejouée sur une base où l'ancienne version aurait été posée.

**Ce que le schéma ne garantit pas, et qui est assumé** : la base ne vérifie
pas que `protein_g` corresponde à `quantity` × les macros de `food_id` — une
contrainte CHECK ne fait pas de sous-requête. Ce n'est **pas** une régression
introduite par l'UPDATE : l'INSERT présentait exactement la même liberté depuis
le début. La cohérence appartient au chemin d'écriture, et c'est A2 qui la
livrera (voir §13).

---

## 4. POLICIES EXACTES — 9, toutes bornées `to authenticated`

```sql
-- food_catalog
food_catalog_select_global      SELECT to authenticated
  using (owner_coach_id is null)

food_catalog_manage_own_coach   ALL    to authenticated
  using / with check (owner_coach_id is not null
                      and owner_coach_id = public.current_coach_id())

food_catalog_manage_admin       ALL    to authenticated
  using / with check (public.is_admin())

-- food_aliases  (visibilité HÉRITÉE : les sous-requêtes portent sur
--                food_catalog, elle-même sous RLS et évaluée en invoker)
food_aliases_select_visible     SELECT to authenticated
  using (exists (select 1 from public.food_catalog f where f.id = food_aliases.food_id))

food_aliases_manage_own_coach   ALL    to authenticated
  using / with check (exists (select 1 from public.food_catalog f
                               where f.id = food_aliases.food_id
                                 and f.owner_coach_id is not null
                                 and f.owner_coach_id = public.current_coach_id()))

food_aliases_manage_admin       ALL    to authenticated
  using / with check (public.is_admin())

-- meal_entries
meal_entries_crud_own_student   ALL    to authenticated
  using / with check (student_id = public.current_student_id())

meal_entries_select_own_coach   SELECT to authenticated          ← LECTURE SEULE
  using (public.is_coach_of_student(student_id))

meal_entries_manage_admin       ALL    to authenticated
  using / with check (public.is_admin())
```

**`is_coach_or_admin()` n'apparaît nulle part** dans cette migration. C'est la
décision Q1, et le test 10 la verrouille : introduire cet appel rend la suite rouge.

**Pourquoi `to authenticated` explicite alors que le reste du dépôt s'en passe.**
La migration 20260807090000 explique que ses policies n'ont pas de clause `TO`
parce que leurs prédicats (`… = current_student_id()`) sont **faux** pour `anon`.
Ici, `owner_coach_id is null` est **vrai** pour n'importe qui : sans clause `TO`,
la confidentialité ne tiendrait plus qu'au privilège. Même règle, prédicat de
forme différente. Le test 11 l'impose sur les neuf policies.

**Privilèges** — pour les trois tables :
`revoke all from public`, `from anon`, **`from authenticated`** *(avant le grant :
sinon TRUNCATE reste, et TRUNCATE contourne la RLS)*, puis
`grant select, insert, update, delete to authenticated` et `grant all to service_role`.
Vérifié en base : `has_table_privilege('authenticated', …, 'TRUNCATE') = false` sur les trois.

---

## 5. CONTRAINTES ET INDEX — relevés sur la base, pas sur le texte

### Contraintes

| Table | Nom | Définition |
|---|---|---|
| food_catalog | `_pkey` | PRIMARY KEY (id) |
| food_catalog | `_owner_coach_id_fkey` | FK → coaches(id) **ON DELETE RESTRICT** |
| food_catalog | `_name_not_blank` | `length(btrim(name)) > 0` |
| food_catalog | `_slug_not_empty` | `slug IS NOT NULL` |
| food_catalog | `_nutrition_unit_check` | `nutrition_unit IN ('g','ml')` |
| food_catalog | `_macros_non_negative` | `protein_per_100 >= 0 AND carb_per_100 >= 0 AND fat_per_100 >= 0` |
| food_catalog | `_status_check` | `status IN ('active','archived')` |
| food_aliases | `_pkey` | PRIMARY KEY (id) |
| food_aliases | `_food_id_fkey` | FK → food_catalog(id) **ON DELETE CASCADE** |
| food_aliases | `_alias_not_blank` | `length(btrim(alias)) > 0` |
| food_aliases | `_normalise_not_empty` | `alias_normalise IS NOT NULL` |
| food_aliases | `_unique_par_aliment` | UNIQUE (food_id, alias_normalise) |
| meal_entries | `_pkey` | PRIMARY KEY (id) |
| meal_entries | `_student_id_fkey` | FK → students(id) **ON DELETE CASCADE** |
| meal_entries | `_recipe_id_fkey` | FK → nutrition_recipes(id) **ON DELETE SET NULL** |
| meal_entries | `_food_id_fkey` | FK → food_catalog(id) **ON DELETE SET NULL** |
| meal_entries | `_label_not_blank` | `length(btrim(label)) > 0` |
| meal_entries | `_quantity_positive` | `quantity > 0` |
| meal_entries | `_macros_non_negative` | `protein_g >= 0 AND carb_g >= 0 AND fat_g >= 0` |
| meal_entries | `_unit_check` | `unit IN ('g','ml','piece','portion')` |
| meal_entries | `_slot_key_check` | `slot_key IS NULL OR slot_key IN (les 6 créneaux v2)` |
| meal_entries | `_source_type_check` | `source_type IN ('recipe','catalog_food','product','free')` |
| meal_entries | `_recipe_id_coherent` | `recipe_id IS NULL OR source_type = 'recipe'` |
| meal_entries | `_food_id_coherent` | `food_id IS NULL OR source_type = 'catalog_food'` |
| meal_entries | `_source_unique` | `recipe_id IS NULL OR food_id IS NULL` |

**Le sens des contraintes d'état impossible est délibéré.** Écrire
« `source_type = 'recipe'` ⇒ `recipe_id NOT NULL` » aurait rendu **impossible la
suppression d'une recette référencée** : la mise à NULL par `ON DELETE SET NULL`
aurait violé la contrainte et annulé la transaction. L'implication est donc
inversée — un pointeur *incohérent* est refusé, un pointeur *absent* est toléré.
L'instantané reste l'autorité. C'est éprouvé par MEAL-A4 et MEAL-A5.

`product` est déclaré dans le vocabulaire **sans contrainte associée** : `food_products`
n'existe pas, et une contrainte qui référence le vide serait fausse le jour où la
table arrive. Progressivité, comme tu le suggérais.

### Index

| Table | Index | Définition |
|---|---|---|
| food_catalog | `food_catalog_slug_global_unique` | UNIQUE (slug) **WHERE owner_coach_id IS NULL** |
| food_catalog | `food_catalog_slug_coach_unique` | UNIQUE (owner_coach_id, slug) **WHERE owner_coach_id IS NOT NULL** |
| food_catalog | `food_catalog_owner_status_idx` | (owner_coach_id, status) |
| food_aliases | `food_aliases_normalise_idx` | (alias_normalise) — la recherche par **égalité** de ce lot |
| food_aliases | `food_aliases_unique_par_aliment` | UNIQUE (food_id, alias_normalise) |
| meal_entries | `meal_entries_student_date_idx` | (student_id, consumed_on) |
| meal_entries | `meal_entries_food_id_idx` | (food_id) WHERE food_id IS NOT NULL |
| meal_entries | `meal_entries_recipe_id_idx` | (recipe_id) WHERE recipe_id IS NOT NULL |

Deux index **partiels** plutôt qu'un seul `(owner_coach_id, slug)` : ce dernier
ne contraindrait rien côté global, puisque NULL n'entre pas en collision avec
NULL dans un index unique.

---

## 6. IMPACT SUR LE SCHÉMA EXISTANT

**Aucune table existante n'est altérée.** La migration est strictement additive :
3 tables, 3 fonctions, 2 triggers nouveaux, 9 policies, 8 index.

Les seules **références sortantes** vers l'existant :

| Depuis | Vers | Effet |
|---|---|---|
| `food_catalog.owner_coach_id` | `coaches(id)` | RESTRICT — supprimer un coach est refusé tant qu'il a des aliments privés |
| `meal_entries.student_id` | `students(id)` | CASCADE — supprimer un élève emporte son journal, comme le reste du schéma |
| `meal_entries.recipe_id` | `nutrition_recipes(id)` | SET NULL — l'historique survit |
| `meal_entries.food_id` | `food_catalog(id)` | SET NULL — l'historique survit |

`nutrition_recipe_ingredients` : **inchangée**, 21 colonnes, aucune `food_id`
(RECIPE-A1). `recipe-solver.ts` : inchangé, ne connaît pas `food_catalog` (test 5).
Les quatre RPC de recettes : non redéfinies (test 4, RECIPE-A2).

---

## 7. AUDIT `nutrition_daily_logs` — ÉTAT ET PLAN

**Aucune modification.** Ni colonne, ni policy, ni RPC, ni couche TypeScript.
La migration ne la nomme même pas dans son code (test 3).

**Aucune double écriture.** `meal_entries` n'a ni `nutrition_plan_id`, ni FK vers
`nutrition_plans`, ni vue de compatibilité, ni trigger croisé. Les deux tables
n'ont aucun point de contact — c'est ce qui rend l'absence de double source
structurelle plutôt que disciplinaire.

Rappel de l'audit §1 (détail complet dans `docs/aliments-a1-audit-avant-migration.md`) :

- **1 écriture** : `upsertNutritionDailyLog` ← `useSupabaseNutritionWeek:98`
- **4 lectures** : `getNutritionLogsForDates` (semaine élève + `progress.ts:341`),
  `getLatestNutritionLog` (`NutritionWeekSummaryCard:39`),
  `getLatestNutritionLogDate` (`progress.ts:130`), affichage `ProgressNutritionSection`
- **SQL** : `nutrition_plan_deletion_block` (un log **bloque** la suppression d'un
  plan → `used_in_history`) ; `delete_nutrition_plan` les supprime explicitement
- **RLS** : une policy `FOR ALL`, `student_id = current_student_id() or is_coach_or_admin()`
- **Volume réel** : **1 ligne**

**Plan de compatibilité — écrit, pas exécuté.**

1. **A1 (ce lot)** — coexistence sans lien.
2. **A2/A3** — l'UI élève écrit uniquement dans `meal_entries` ; le « Suivi de la
   semaine » continue de lire `nutrition_daily_logs`. Deux outils visibles, aucune
   donnée partagée, donc aucune contradiction possible.
3. **Lot de convergence (après A3, avant Courses)** — le suivi hebdomadaire est
   réécrit pour agréger `meal_entries` par jour ; `nutrition_daily_logs` passe en
   **lecture seule historique** (l'`upsert` retiré, la policy réduite à `select`).
4. **Jamais de suppression** tant que `nutrition_plan_deletion_block` s'appuie
   dessus : la retirer changerait le verdict de suppression d'un plan.

**Le point dur, à trancher au lot de convergence et pas avant** :
`nutrition_daily_logs.nutrition_plan_id` est **NOT NULL**. Une entrée `meal_entries`
hors plan n'a donc aucune place dans le journal. La convergence ne pourra pas être
une simple vue — ce sera soit une vue partielle (jours couverts par un plan
assigné), soit un abandon assumé de la table, avec les chiffres réels en main.

---

## 8. RÉSULTATS DES TESTS

### 8.1 Checklist PostgreSQL — sur une base réelle

`supabase/tests/aliments_a1_checklist.sql`
SHA-256 `1c2b2b1d670ab5f72417b5f7821ab0c47d93a1960ced32a975849fb59d852602`

```
ALIMENTS A1 — 130 contrôles, 0 échec(s)
OK — Z · aucune donnée de test ne subsiste après le ROLLBACK
```

Comptes synthétiques : **admin, coach A, coach B, élève A (→ coach A),
élève B (→ coach B), élève orphelin (`coach_id` NULL)**. Domaine `test.invalid`
(réservé RFC 2606), identifiants UUID fixes, `begin` … `rollback`.

Répartition : FOOD-A1 6 · FOOD-A2 4 · FOOD-A3 5 · FOOD-A4 5 · FOOD-A5 4 ·
FOOD-A6 8 · FOOD-A7 13 · FOOD-A8 10 · MEAL-A1 5 · MEAL-A2 7 · MEAL-A3 3 ·
MEAL-A4 4 · MEAL-A5 8 · MEAL-A6 8 · MEAL-A7 10 · **MEAL-A8 4 · MEAL-A9 5 ·
MEAL-A10 4 · MEAL-A11 3 · MEAL-A12 2** · RECIPE-A1 3 · RECIPE-A2 4 · plus les
contrôles de mise en place et de rollback.

> ⚠️ Les libellés FOOD-A1…A8 / MEAL-A1…A7 / RECIPE-A1…A2 sont **ma reconstruction**
> à partir des §2, §5, §6, §7 et §8 de ton énoncé : le texte exact de ta liste §11
> a été perdu à la compaction du contexte. Le sommaire en tête de la checklist dit
> précisément ce que chaque identifiant recouvre — si l'un d'eux ne correspond pas
> à ce que tu avais écrit, dis-le et je le réaligne.

### 8.2 Contrôles négatifs — la preuve que le vert sait devenir rouge

Cinq régressions injectées volontairement, puis annulées :

| Injection | Effet mesuré |
|---|---|
| trigger de gel RÉTABLI (la régression corrigée le 11/08) | **8 rouges** : MEAL-A5, MEAL-A8, MEAL-A11, MEAL-A12, MEAL-A9 |
| policy élève ramenée à `for select` | **9 rouges** : MEAL-A6, MEAL-A8, MEAL-A11, MEAL-A12 |
| trigger sur `food_catalog` qui propage aux entrées | **5 rouges** : MEAL-A5, MEAL-A10 |
| policy élève en `using(true)` | **12 rouges** : MEAL-A6, MEAL-A7 |
| `is_coach_of_student` → `is_coach_or_admin()` | **3 rouges** : coach A lit l'élève de coach B **et** l'élève orphelin |
| écriture catalogue ouverte à tout le staff | **8 rouges** FOOD-A7 + 1 FOOD-A8 |
| index unique du slug global supprimé | **2 rouges** FOOD-A3 / FOOD-A4 |
| policy `using(true)` ajoutée sur le catalogue | **10+ rouges** FOOD-A6 / FOOD-A7 |
| — retour à l'état nominal | **130 / 0** |

Le deuxième contrôle est la démonstration expérimentale de ta décision Q1 : la
convention maison du dépôt **fuite réellement**, ce n'est pas une inquiétude théorique.

Côté TypeScript, deux contrôles négatifs de plus : retirer `to authenticated`
d'une policy → tests 10 et 11 rouges ; remettre `is_coach_or_admin()` → test 10
rouge. Fichier restauré à l'octet près (SHA-256 identique) après chaque essai.

### 8.3 Harnais TypeScript

```
npm run test:aliments-a1     16 tests, 16 pass, 0 fail
```

SHA-256 `f9ac6a04cc229e2da44337ff53ac8edb66f1dc4dc567d8062b3ba8f9e81e6253`

**Faux négatif corrigé en route** : quatre tests étaient rouges pour la mauvaise
raison — mes assertions lisaient la prose française des `comment on … is '…'`,
qui est du SQL exécutable et survivait au retrait des lignes `--`. La migration
*documente* qu'elle ne dépend pas de `pg_trgm` et qu'elle diffère de
`nutrition_daily_logs` ; ces phrases déclenchaient les gardes. L'extraction du
code retire désormais aussi les `comment on`. C'est l'exact symétrique du faux
vert, et ça méritait d'être corrigé au même titre.

### 8.4 Suites nutrition existantes et sécurité

| Suite | Résultat |
|---|---|
| `test:security-hardening` | **31 / 0** |
| `test:nutrition-recipes` | **45 / 0** |
| `test:nutrition-recipes-admin` | **65 / 0** |
| `test:nutrition-recipe-images` | **46 / 0** |
| `test:nutrition-v2-unified` | **74 / 0** |
| `test:nutrition-single-assigned-plan` | **28 / 0** |
| `test:nutrition-plan-v2-builder` | **72 / 0** |
| `test:nutrition-recipe-solver` | **25 / 0** |
| `test:nutrition-macro-targets` | **15 / 0** |
| `test:nutrition-meal-distribution` | **23 / 0** |
| `test:nutrition-plan-v2-guards` | **18 / 0** |
| `test:aliments-a1` | **16 / 0** |
| `test:training-movement-patterns` | 60 / **3 échecs** ← voir §9 |
| `test:student-feedback-video` | 56 / **1 échec** ← voir §9 |

### 8.5 `tsc` et `eslint`

```
npx tsc --noEmit        exit 0, aucune erreur
npm run lint            0 erreur, 1 avertissement
                        components/brand/SethStarsMark.tsx:6  '_props' non utilisé
```

L'avertissement est préexistant et sans rapport avec A1 (`SethStarsMark.tsx`
n'est pas dans le lot).

---

## 9. QUATRE TESTS ROUGES QUI NE VIENNENT PAS DE A1 — ATTRIBUTION PROUVÉE

| Suite | Test | Assertion |
|---|---|---|
| training-movement-patterns | F1 | `html.includes("https://v/prescrit")` |
| training-movement-patterns | F2 | `html.includes("https://v/remplacant")` |
| training-movement-patterns | F8 | `section.includes("substituteExerciseLibraryId: …")` |
| student-feedback-video | F6 | « le chemin doit partir dans la charge utile » |

**Preuve d'attribution par exécution.** J'ai reconstruit une copie complète du
dépôt **sans la moindre trace de A1** — migration retirée, checklist et harnais
supprimés, manifeste ramené à 35, tous les compteurs ramenés à 62 / 35 — et
relancé les deux suites :

```
training-movement-patterns   60 réussis, 3 échecs   ← identique
student-feedback-video       56 réussis, 1 échecs   ← identique
security-hardening           31 / 0                 ← identique
```

**Cause réelle.** Ces quatre tests appartiennent au **chantier lecteur vidéo**
(commit `09fe153`). `components/student/ExerciseFeedbackCard.tsx` importe
désormais `VideoPlayerModal` : l'URL de démonstration n'est plus rendue comme
`href` dans le HTML initial, elle est passée en propriété et n'est utilisée qu'à
l'ouverture de la modale. Les tests F1/F2 assertent encore sur l'ancien balisage.
F8 et F6 assertent sur des chaînes exactes de `SessionFeedbackSection.tsx` qui
ont bougé.

**Je ne les ai pas touchés** — c'est hors périmètre A1, et ta règle est de ne
jamais modifier un test hors périmètre pour obtenir du vert. C'est une dette du
lot vidéo, à traiter dans son propre lot. Dis-moi si tu veux que je l'ouvre.

---

## 10. ÉTAT DU DÉPÔT RÉEL

Tout a été transféré sur `~/Documents/coaching-platform`, branche
`feat/video-player`, arbre auparavant propre au commit `09fe153`.

Vérification d'intégrité — les 4 fichiers neufs sont **identiques à l'octet près**
entre le miroir et ton disque, et les 9 fichiers modifiés ont été édités **sur
place** par les mêmes remplacements, puis leur SHA-256 comparé au miroir : les 13
empreintes concordent. Cela prouve aussi que ton dépôt et le miroir étaient bien
en phase avant l'édition.

```
$ ls supabase/migrations/*.sql | wc -l
63

$ git diff --check
(rien)                                   exit 0

$ git status --short
 M package.json
 M scripts/tests/nutrition-plan-v2-builder.mts
 M scripts/tests/nutrition-recipes-admin.mts
 M scripts/tests/nutrition-recipes.mts
 M scripts/tests/nutrition-single-assigned-plan.mts
 M scripts/tests/nutrition-v2-unified.mts
 M scripts/tests/security-hardening.mts
 M scripts/tests/training-movement-patterns.mts
 M supabase/baseline/manifest.json
?? docs/aliments-a1-audit-avant-migration.md
?? scripts/tests/aliments-a1.mts
?? supabase/migrations/20260831090000_food_catalog_and_meal_entries.sql
?? supabase/tests/aliments_a1_checklist.sql
```

**Les modifications de compteur sont isolées et lisibles dans le diff**, comme tu
l'as demandé — les 8 fichiers modifiés hors `package.json` ne contiennent QUE des
changements de compteur :

| Fichier | Changement |
|---|---|
| `supabase/baseline/manifest.json` | + 1 entrée `20260831090000_…` → 36 |
| `security-hardening.mts` | `62 → 63` (ligne 466) et `35 → 36` (ligne 490) |
| `training-movement-patterns.mts` | `62 → 63` (ligne 468) et `35 → 36` (ligne 492) |
| `nutrition-plan-v2-builder.mts` | `35 → 36` ×2, `".length, 62," → ".length, 63,"` |
| `nutrition-recipes-admin.mts` | idem |
| `nutrition-recipes.mts` | idem |
| `nutrition-single-assigned-plan.mts` | idem |
| `nutrition-v2-unified.mts` | `35 → 36` ×3, `".length, 62," → ".length, 63,"` |
| `package.json` | + `"test:aliments-a1"` |

Les occurrences en ×2 / ×3 sont les **assertions miroir** : six de ces fichiers
vérifient la chaîne de caractères telle qu'elle apparaît dans
`security-hardening.mts`. Les oublier aurait rendu rouges des suites vertes sans
rapport avec ce chantier — le piège exact du lot « manifeste de migrations ».

**Note sur la branche.** L'arbre est sur `feat/video-player`. Le lot vidéo étant
déjà committé en `09fe153`, tu peux faire `git checkout -b feat/aliments-a1` à
tout moment avant de committer : les modifications non suivies te suivront. Je
n'ai pas créé la branche moi-même, ça reste ton choix.

---

## 11. CE QUE CE LOT NE CONTIENT PAS

`food_products` · Open Food Facts · GTIN · scanner · interface élève ·
recettes persistées · `nutrition_recipe_ingredients.food_id` · modification de
`nutrition_daily_logs` · les 17 composites · favoris · récents · hors ligne ·
Courses · packaging · prix · magasins · nouvelle dépendance npm ·
nouvelle extension PostgreSQL.

Chacun de ces points est vérifié par une assertion, pas seulement annoncé en
en-tête (tests 1, 2, 3, 4, 5, 16).

---

## 12. CE QUE J'ATTENDS DE TOI

1. **Ton accord explicite pour `npx supabase db push --linked`** — je ne l'ai pas
   lancé et je ne le lancerai pas sans lui.
2. **La liste §11 d'origine**, si tu l'as encore, pour vérifier que ma
   reconstruction des identifiants correspond bien à ce que tu avais écrit.
3. **La frontière A2, à trancher avant de coder l'UI** — voir §13 ci-dessous.
4. **Les 4 tests rouges du lot vidéo** : je les laisse tels quels. Dis-moi si tu
   veux un lot dédié.

*Rien committé. Rien poussé. Aucune écriture sur Supabase distant.*


---

## 13. FRONTIÈRE A2 — CE QU'IL FAUDRA DÉCIDER AVANT DE CODER L'UI

Le schéma d'A1 n'interdit aucune de ces options ; il ne tranche aucune non plus.

### 13.1 Le chemin d'écriture : une RPC qui CALCULE plutôt qu'un client qui ENVOIE

Aujourd'hui n'importe quel client authentifié peut écrire `protein_g = 0` sur
une entrée `catalog_food`. C'est vrai à l'INSERT depuis le début, et le passage
à l'UPDATE n'y change rien.

La réponse propre est une RPC `security definer` — appelons-la
`enregistrer_meal_entry(...)` — qui reçoit `(food_id | recipe_id | product_id,
quantity, unit, consumed_on, slot_key)` et **calcule** l'instantané côté
serveur avant d'écrire. On retire alors le `grant insert, update` direct sur la
table à `authenticated` : le client ne peut plus fabriquer de macros du tout.
C'est le même schéma que `save_nutrition_recipe` et `delete_nutrition_plan`.

### 13.2 Le recalcul, source par source

| `source_type` | Recalcul à la correction | Point dur |
|---|---|---|
| `catalog_food` | `macro = quantity × per_100 / 100` — purement déterministe | **l'unité**, voir 13.3 |
| `recipe` | rejouer `solveRecipe` avec la cible du créneau au moment de la correction | le solveur n'est aujourd'hui **jamais persisté** ; A2 devra décider si l'entrée stocke aussi le détail des grammages ou seulement le total |
| `product` | recalcul depuis `food_products` (100 g / 100 ml de l'étiquette) | la table n'existe pas encore ; l'entrée devra aussi retenir la **version** du produit lue, car Open Food Facts change sous nos pieds |
| `free` | **aucun recalcul** — l'élève saisit ses macros à la main, elles font autorité | à assumer explicitement : c'est le seul cas où le client reste la source, y compris via la RPC |

### 13.3 Le point dur : `unit` et `nutrition_unit` ne parlent pas la même langue

`food_catalog.nutrition_unit ∈ {g, ml}` mais `meal_entries.unit ∈ {g, ml,
piece, portion}`. Une entrée `catalog_food` en `piece` — « 1 banane » — **ne
peut pas** être recalculée : rien dans le catalogue ne dit combien pèse une
banane. Trois options, à choisir en A2 :

1. **`grams_per_piece numeric null` sur `food_catalog`** (migration additive) —
   le plus utile pour l'UX, et ça sert aussi aux Courses plus tard ;
2. **contraindre `catalog_food` à `unit ∈ {g, ml}`** — l'UI convertit
   pièce → grammes avant d'écrire, la base reste simple ;
3. **laisser passer** — mais alors ces entrées ne sont jamais recalculables, et
   la correction de quantité ne peut pas mettre les macros à jour.

Je n'ai **pas** posé la contrainte de l'option 2 dans A1 : elle serait
irréversible sans migration et elle préjuge de l'UX que tu n'as pas encore
arrêtée. Mais c'est la première décision d'A2, avant la moindre ligne
d'interface.

### 13.4 Atomicité

Quantité et macros doivent voyager dans **une seule instruction** — un UPDATE,
ou un appel de RPC. La checklist le vérifie (MEAL-A11 : une correction dont une
partie viole une contrainte n'écrit rien du tout). Deux requêtes successives
laisseraient une fenêtre où l'instantané est mi-ancien mi-neuf, ce qui est pire
qu'un refus.
