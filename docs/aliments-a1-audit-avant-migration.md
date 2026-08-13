# ALIMENTS A1 — §1 AUDIT FINAL AVANT MIGRATION

**Statut : LECTURE SEULE. Aucune ligne de SQL écrite, aucun fichier de code modifié.**
Date : 10/08/2026 — projet Supabase `yesuolzfmxgnaznhbcnw` (lecture seule via `execute_sql`).

Cinq constats **bloquent ou modifient** le plan A1 tel qu'il est spécifié. Ils sont
en tête. Le détail suit.

---

## 0. RÉSUMÉ — CE QUI NE COLLE PAS

| # | Constat | Effet sur A1 |
|---|---|---|
| **B1** | `nutrition_daily_logs.nutrition_plan_id` est **NOT NULL** (FK → `nutrition_plans`, ON DELETE CASCADE) | Un journal ne peut **pas** exister sans plan assigné. `meal_entries` ne doit pas hériter de ça. D1 « source de vérité » ne peut donc **jamais** être une simple vue dérivée dans un sens ni dans l'autre. À documenter, pas à corriger ici. |
| **B2** | **Aucun helper de relation coach ↔ élève n'existe**, et **aucune policy du schéma ne l'exprime**. Toutes les tables élève utilisent `student_id = current_student_id() OR is_coach_or_admin()` | §7 « le coach lit les entrées de **ses** élèves » serait une convention **nouvelle et plus stricte que tout le reste du schéma**. → **Décision requise (Q1).** |
| **B3** | En production : `profiles.role` ne contient que **`admin`** et **`student`**. **Zéro coach.** La table `coaches` a 1 ligne, rattachée au compte **admin** | Aujourd'hui `is_coach_or_admin()` ≡ `is_admin()`. « Aliment privé d'un coach » = aliment privé de l'admin. Le design reste bon pour le futur multi-coach, mais **aucun test ne peut s'appuyer sur un vrai profil `coach`** — fixtures synthétiques obligatoires. |
| **B4** | **`pg_trgm` n'est PAS installée** (`installed_version: null`). `unaccent`, `citext`, `fuzzystrmatch` non plus | Conformément à ta consigne : **on ne l'ajoute pas**. `food_aliases` fonctionnera en correspondance **exacte sur une colonne normalisée** + index btree. Le flou est reporté au lot qui en aura besoin. |
| **B5** | Le chemin d'écriture des ingrédients est **DELETE-ALL puis re-INSERT** avec liste de colonnes explicite, dans **3 RPC** | §8 : ajouter `nutrition_recipe_ingredients.food_id` **n'est pas propre dans ce lot** — la colonne serait **silencieusement effacée à la prochaine sauvegarde du coach**. → **Décision requise (Q2).** Preuve en §5. |

---

## 1. AUDIT COMPLET DE `nutrition_daily_logs`

### 1.1 Structure réelle (baseline `00_baseline_remote_schema.sql:946`)

```sql
create table public.nutrition_daily_logs (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null,          -- FK students(id)          ON DELETE CASCADE
  nutrition_plan_id uuid not null,          -- FK nutrition_plans(id)   ON DELETE CASCADE
  log_date          date not null,
  calories          numeric,                -- nullable
  protein_g         numeric,                -- nullable
  carbs_g           numeric,                -- nullable
  fat_g             numeric,                -- nullable
  note              text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
unique (student_id, nutrition_plan_id, log_date)
index  nutrition_daily_logs_student_plan_date_idx (student_id, nutrition_plan_id, log_date)  -- 20260811090000
trigger set_updated_at before update
```

**Granularité : le JOUR.** Aucune notion de repas, de créneau, d'aliment ni de quantité.
Les 4 macros sont saisies à la main par l'élève, nullable, sans contrainte de signe
(`calories >= 0` n'existe pas), et **`calories` est stockée** — elle n'est pas dérivée
du 4/4/9. C'est exactement l'inverse de la règle §2 posée pour `food_catalog`.

**Volume en production : 1 ligne.** Le coût d'une future migration de données est nul aujourd'hui.

### 1.2 Écritures — **une seule**

| Chemin | Fichier | Nature |
|---|---|---|
| `upsertNutritionDailyLog` | `lib/supabase/nutrition-logs.ts:76` | `upsert` sur `onConflict: student_id,nutrition_plan_id,log_date`, écrit aussi `updated_at` à la main, puis `logActivityEvent(… "nutrition_log_filled")` |
| ↑ appelé par | `hooks/useSupabaseNutritionWeek.ts:98` | outil « Suivi de la semaine » de `/nutrition` (élève) |

Aucun autre `insert` / `update` / `upsert` sur cette table, ni en TypeScript, ni en RPC.

### 1.3 Lectures — **quatre**

| Fonction | Défini | Appelé par |
|---|---|---|
| `getNutritionLogsForDates` | `nutrition-logs.ts:36` | `useSupabaseNutritionWeek.ts:52` et `:76` (semaine élève) ; `lib/supabase/progress.ts:341` |
| `getLatestNutritionLog` | `nutrition-logs.ts:56` | `components/admin/NutritionWeekSummaryCard.tsx:39` (résumé admin) |
| `getLatestNutritionLogDate` | `progress.ts:128` — `.from("nutrition_daily_logs")` **en direct** | `progress.ts:81` et `:320` |
| affichage | `components/shared/ProgressNutritionSection.tsx` | section 5 de la fiche progression — « jamais de moyenne calculée sur des jours non remplis » |

### 1.4 Côté SQL

| Objet | Migration | Comportement |
|---|---|---|
| `nutrition_plan_deletion_block(uuid)` | `20260817090000:228` | La **présence** d'un log rend le plan non supprimable → motif `used_in_history` |
| `delete_nutrition_plan(uuid)` | `20260817090000:279` | Supprime les logs du plan **explicitement** (pas par CASCADE), après que le blocage a été levé. ⚠️ Le commentaire de `20260815090000:770` (« ne supprime JAMAIS une ligne de `nutrition_daily_logs` ») est **périmé** — 20260817090000 l'a remplacé. |
| `delete_student` | `lib/supabase/delete-student.ts:20` | Mentionnée en commentaire ; la suppression passe par la CASCADE de `students` |
| Privilèges | `20260810090000:77,100` | Durcis : `authenticated` n'a **pas** TRUNCATE (vérifié en base : `has_table_privilege = false`), `anon` n'a pas SELECT |

### 1.5 RLS

```sql
create policy "nutrition_daily_logs_student_or_staff" on public.nutrition_daily_logs
  for all
  using      (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());
```

Une seule policy, `FOR ALL`. **N'importe quel membre du staff lit et écrit le journal de n'importe quel élève.**
C'est la convention de tout le schéma (voir §2.3), pas une exception.

### 1.6 Plan de compatibilité D1 — proposé, **rien n'est fait dans ce lot**

1. **A1 (ce lot)** : `nutrition_daily_logs` reste strictement intacte — table, RLS, RPC, couche TS, tests. `meal_entries` est créée **à côté**, sans lien, sans double écriture (conforme à ta consigne : pas de double-écriture manuelle).
2. **A2/A3** : l'UI élève écrit **uniquement** dans `meal_entries`. `useSupabaseNutritionWeek` continue de lire `nutrition_daily_logs` — les deux outils coexistent visiblement, sans se contredire, parce qu'ils ne partagent aucune donnée.
3. **Lot de convergence (après A3, avant Courses)** : le « Suivi de la semaine » est réécrit pour agréger `meal_entries` par jour. `nutrition_daily_logs` devient alors **lecture seule historique** — l'`upsert` est retiré, la policy passe en `select`.
4. **Jamais** : suppression de la table tant que `nutrition_plan_deletion_block` s'appuie dessus (une suppression de plan changerait de verdict).

**Le point dur, à décider dans ce lot de convergence et pas avant : `nutrition_plan_id NOT NULL`.**
Un `meal_entry` existe qu'un plan soit assigné ou non. Une entrée hors plan n'a donc
**aucune place** dans `nutrition_daily_logs`. La convergence ne pourra pas être une
simple vue : ce sera soit une vue partielle (seulement les jours couverts par un plan
assigné), soit un abandon assumé de la table. À trancher là-bas, avec les chiffres réels.

---

## 2. HELPERS RLS EXISTANTS

### 2.1 Ce qui existe

| Helper | Où | Sécurité | `search_path` | EXECUTE |
|---|---|---|---|---|
| `public.is_admin()` | `20260726220000:64` | DEFINER | `public` | `authenticated`, `service_role` — **`anon` révoqué** |
| `public.is_coach_or_admin()` | baseline:73 | DEFINER | `public` | `authenticated`, `service_role`, **`anon`** |
| `public.current_student_id()` | baseline:62 | DEFINER | `public` | `authenticated`, `service_role`, **`anon`** |
| `public.current_coach_id()` | `20260813090000:99` | DEFINER | `public` | `authenticated`, `service_role` — **`anon` révoqué** |

`current_coach_id()` est déterministe (`order by c.created_at, c.id limit 1`).
`current_student_id()` **ne l'est pas** : ni `limit 1`, ni index unique sur
`students.user_id` (vérifié : `0` index unique). Défaut connu, documenté dans
`20260813090000`, **hors périmètre A1**.

### 2.2 Ce qui **n'existe pas** — B2

Il n'y a **aucune** fonction du type `coach_can_access_student(uuid)`, et
**aucune policy du schéma** ne joint `students.coach_id` à `current_coach_id()`.
Recherche exhaustive : `grep "students s" supabase/**/*.sql | grep coach_id` → 0 résultat.

### 2.3 La convention réellement en vigueur

20 policies du baseline suivent **exactement** ce moule :

```sql
using (student_id = public.current_student_id() or public.is_coach_or_admin())
```

`activity_events`, `appointments`, `assignments`, `body_measurements`,
`custom_measurements`, `document_assignments`, `exercise_feedback`,
`exercise_set_feedback`, `legal_consents`, `nutrition_daily_logs`,
`payment_entries`, `payments`, `progress_photos`, `stripe_payments`…

La seule table qui distingue les coachs entre eux est `nutrition_recipes` — et
c'est par **propriété** (`coach_id = current_coach_id()`), jamais par relation
à un élève.

### 2.4 Modèle de catalogue global déjà présent — précédent pour D3

`exercise_library` :

```sql
create policy "exercise_library_select_active"  for select using (status = 'active');
create policy "exercise_library_manage_staff"   for all    using (public.is_coach_or_admin());
```

C'est le seul catalogue « global » du schéma. Sa lecture n'est **filtrée par aucun
rôle** (elle est ouverte à `anon` si le grant le permet) et son écriture est ouverte
à **tout** le staff. Pour `food_catalog`, §7 demande plus strict (écriture **admin
uniquement** sur le global) : ce sera donc un **durcissement** par rapport au
précédent, pas une copie. Je le signale pour que ce ne soit pas lu comme une
incohérence de style.

---

## 3. RÉALITÉ DE LA BASE DE PRODUCTION (10/08/2026)

| Mesure | Valeur |
|---|---|
| `profiles` (rôles présents) | **`admin`, `student` — aucun `coach`** |
| `profiles` total | 8 (1 admin, 7 élèves) |
| `coaches` | 1 ligne, `user_id` non nul, **rattachée au compte admin** |
| `students` | 7, dont **2 sans `coach_id`** |
| `nutrition_plans` | 7, **0 sans `coach_id`** |
| `nutrition_recipes` | 17, toutes `active`, **1 seul coach propriétaire** |
| `nutrition_recipe_ingredients` | 100 |
| `meals` | 183 |
| `nutrition_days` | 49, **toutes `non-commence`** |
| `nutrition_daily_logs` | **1** |
| `food_catalog` / `food_aliases` / `food_products` / `meal_entries` | **n'existent pas** (`to_regclass` → null) |

**Conséquences directes sur A1 :**

- `is_coach_or_admin()` ≡ `is_admin()` aujourd'hui. Une policy « écriture admin
  uniquement » et une policy « écriture staff » sont donc **indistinguables en
  production** — seuls des tests SQL avec des rôles fabriqués peuvent les
  distinguer. Les checklists devront créer leurs propres profils.
- Une règle §7 stricte (coach → ses élèves) **rendrait invisibles** les entrées
  des **2 élèves sans `coach_id`** pour tout coach ; seul l'admin les verrait.
- Les hypothèses A0 sur les volumes sont **confirmées** (100 ingrédients,
  49 jours tous `non-commence`, `meals` en texte libre).

---

## 4. EXTENSIONS DISPONIBLES — B4

Installées sur le distant :
`plpgsql 1.0`, `pg_stat_statements 1.11`, `pgcrypto 1.3`, `uuid-ossp 1.1`,
`btree_gist 1.7`, `pg_cron 1.6.4`, `pg_net 0.20.3`, `supabase_vault 0.3.1`.

**Non installées** (disponibles au catalogue, mais `installed_version: null`) :
`pg_trgm 1.6`, `unaccent 1.1`, `citext 1.6`, `fuzzystrmatch 1.2`, `vector`, `pgtap`…

→ **Décision : pas de `pg_trgm`.** Ta consigne était « seulement si l'extension est
déjà disponible/acceptable — n'ajoute pas une extension inutile ». Elle n'est pas
active, et A1 ne livre aucune recherche floue.

**Conséquence sur `food_aliases` :** la recherche se fera par **égalité** sur une
colonne normalisée, avec index btree — pas par similarité. La normalisation
(minuscules, accents retirés, ponctuation réduite) se fera par une petite fonction
SQL `immutable` bâtie sur `translate()` + `lower()` + `regexp_replace()`, sans
`unaccent`, ce qui permet d'en faire une **colonne générée** (`generated always as
… stored`) — donc impossible à désynchroniser. Précédent le plus proche dans le
dépôt : `newsletter_subscribers.normalized_email`, mais celle-là est calculée
**côté application**, ce qui est plus faible. Je propose de faire mieux, pas pareil.

---

## 5. §8 — `nutrition_recipe_ingredients.food_id` : **PREUVE QUE CE N'EST PAS PROPRE**

Ta condition était : « ajoute-la **seulement si c'est démontrablement propre dans ce
lot** ». Voici la démonstration que ça ne l'est pas.

Le chemin d'écriture des ingrédients n'est **jamais** un `update` ciblé. C'est
systématiquement **`delete` de tous les ingrédients de la recette, puis `insert`
avec une liste de colonnes explicite** :

| RPC | Migration : lignes | Forme |
|---|---|---|
| `save_nutrition_recipe` | `20260818090000:663` puis `:676` | `delete … where recipe_id = p_recipe_id` puis `insert (recipe_id, position, name, role, protein_per_100g, …, linked_to_ingredient_id, link_ratio_bp)` — **18 colonnes nommées** |
| `duplicate_nutrition_recipe` | `20260819090000:439` | `insert (… 18 colonnes …) select … from nutrition_recipe_ingredients` |
| `import_nutrition_recipes` | `20260818090000:352` | `insert (… 18 colonnes …)` depuis le jsonb |
| `delete_nutrition_recipe` | `20260819090000:616` | `delete` |

Une colonne `food_id` ajoutée aujourd'hui :

1. serait **absente des 3 `insert`** → toute recette sauvegardée, dupliquée ou
   réimportée **perdrait son `food_id`** sans erreur, sans trace, sans test rouge ;
2. pour être tenue, il faudrait modifier ces 3 RPC (plusieurs centaines de lignes,
   `security invoker`, avec leurs propres checklists), **plus** le schéma jsonb de
   la charge utile, **plus** `NutritionRecipeIngredientRow` et sa projection
   champ-par-champ à 20 colonnes (`lib/nutrition/recipe-rows.ts:209-260`), **plus**
   les tests `nutrition-recipes`, `nutrition-recipes-admin`, `nutrition-recipe-images`.

C'est un chantier, pas une colonne. Et il appartient au même endroit que les
**17 noms composites à virgules** : le lot DATA CLEANUP, où le mapping vers le
catalogue sera fait pour de vrai. Ajouter la colonne maintenant, c'est créer une
colonne qui ne peut être ni remplie ni conservée.

→ **Q2 : je propose de reporter `food_id` à DATA CLEANUP.** `recipe-solver.ts`
reste inchangé, les macros d'ingrédient restent la seule autorité du solveur —
ce qui était de toute façon ton exigence.

---

## 6. CONVENTIONS DU DÉPÔT — extraites, à respecter

**Table**

- `id uuid primary key default gen_random_uuid()`
- `created_at timestamptz not null default now()`, `updated_at` idem
- trigger `set_updated_at` posé dans un bloc `do $$ if exists (pg_proc …) $$` (jamais en dur)
- macros et grammages : **`numeric` sans précision** ; toute borne est une contrainte `check`, jamais un type
- ratios internes : **entiers en points de base** (`link_ratio_bp`, 1 500 = 15 %), jamais un flottant
- `status text not null default '…'` + `check (status in (…))` — **jamais un enum PostgreSQL**
- vocabulaire contrôlé = contrainte `check`, étendue **uniquement par migration** (« la contrainte est le contrat, et un diff la rend visible en revue »)
- FK : `on delete restrict` quand une perte serait silencieuse, `cascade` pour les enfants
- contraintes **nommées** : `<table>_<sujet>_<règle>` (`nutrition_recipe_ingredients_macros_non_negative`)
- index : `create index if not exists <table>_<colonnes>_idx`
- `comment on table` + `comment on column` pour tout ce qui n'est pas évident, **en français**

**Sécurité (gabarit v2 + correctif TRUNCATE)**

```sql
alter table public.X enable row level security;
-- policies…
revoke all on table public.X from public;
revoke all on table public.X from anon;
revoke all on table public.X from authenticated;   -- AVANT le grant : sinon TRUNCATE, qui contourne la RLS
grant select, insert, update, delete on table public.X to authenticated;
grant all on table public.X to service_role;
```

Fonctions : `security invoker` + `set search_path = ''` par défaut ; `security
definer` + `set search_path = public` **seulement** pour les helpers d'identité, et
toujours suivi de `revoke execute … from public` puis `from anon`.

**En-tête de migration** : `-- Migration <ts> — <titre>` puis les sections
`POURQUOI` / `CE QUE FAIT CETTE MIGRATION` / `CE QU'ELLE NE FAIT PAS` /
`⚠️ NE PAS exécuter en Production sans runbook validé`.

**Tests SQL** : `supabase/tests/<sujet>_checklist.sql` — `begin; … rollback;`,
table temporaire `_faits(section, libelle, ok)`, fonction `pg_temp.noter(...)`,
sections A, B, C…, exécution **sur base LOCALE uniquement** via
`scripts/db-local-init.sh`.

**Tests TS** : `scripts/tests/<sujet>.mts` + une entrée `"test:<sujet>"` dans
`package.json`.

### 6.1 Dette mécanique déclenchée par toute nouvelle migration

Une migration de plus **casse 13 assertions** réparties dans 8 fichiers. Il faudra
toutes les mettre à jour dans le même lot :

| Fichier | Ligne | Valeur actuelle |
|---|---|---|
| `supabase/baseline/manifest.json` | `migrations_post_baseline_attendues` | 35 entrées → 36 |
| `scripts/tests/security-hardening.mts` | 466 | `…length, 62` → 63 |
| `scripts/tests/security-hardening.mts` | 490 | `attendues.length, 35` → 36 |
| `scripts/tests/nutrition-plan-v2-builder.mts` | 1026, **1030** | 35 → 36 (dont 1 assertion **miroir** sur le texte de `security-hardening`) |
| `scripts/tests/nutrition-recipes-admin.mts` | 825, **830** | idem |
| `scripts/tests/nutrition-recipes.mts` | 632, **636** | idem |
| `scripts/tests/nutrition-single-assigned-plan.mts` | 590, **594** | idem |
| `scripts/tests/nutrition-v2-unified.mts` | 1090, **1101**, 1454 | idem |
| `scripts/tests/training-movement-patterns.mts` | 492 | 35 → 36 |

Les lignes en gras vérifient la **chaîne de caractères** `assert.equal(attendues.length, 35);`
telle qu'elle apparaît dans `security-hardening.mts` — elles échouent donc même si
on ne touche qu'à ce fichier-là. C'est exactement le piège rencontré au lot
« manifeste de migrations ».

---

## 7. NOTE D'ENVIRONNEMENT

Le conteneur de travail a été recyclé : `/root/miroir` contient bien tous les
fichiers (y compris le chantier lecteur vidéo — `lib/video/source.ts`,
`components/shared/MediaModal.tsx`, `VideoPlayerModal.tsx`, `FileViewerModal.tsx`,
`components/shared/video/`), mais son **historique Git a été perdu**.

Conséquence pratique : les livrables §12/§13 `git status --short` et
`git diff --check` seront produits **sur ton vrai dépôt** `~/Documents/coaching-platform`
via le pont, comme pour les lots précédents. Le travail lui-même se fait dans le
miroir, puis est transféré avec vérification SHA-256 octet par octet.

---

## 8. CE QUE JE PROPOSE D'ÉCRIRE, UNE FOIS TES RÉPONSES REÇUES

Résumé d'intention — **le SQL n'est pas écrit**, il attend Q1 et Q2.

- `public.food_catalog` — `owner_coach_id uuid null` (null = global SETH),
  `slug` en **colonne générée** depuis `name` via une fonction `immutable` sans
  extension ; deux index uniques **partiels** (`where owner_coach_id is null` /
  `(owner_coach_id, slug) where owner_coach_id is not null`) ; macros `numeric`
  pour 100 g avec `check (… >= 0)` ; `nutrition_unit` à vocabulaire contrôlé ;
  **aucune colonne calories** — le 4/4/9 reste dérivé.
- `public.food_aliases` — `food_id` FK cascade, `alias` + `alias_normalise`
  générée, unique sur `(food_id, alias_normalise)`, visibilité héritée du catalogue.
- `public.meal_entries` — distincte de `meals`, **sans** `nutrition_plan_id`
  obligatoire ; `source_type` en `check ('recipe','catalog_food','product','free')` ;
  `recipe_id` et `food_id` en FK nullable **posées maintenant**, `product_id`
  ajouté par sa propre migration au lot produits (une FK réelle vaut mieux qu'un
  `uuid` sans référence) ; `label`, `quantity`, `unit`, `protein_g`, `carb_g`,
  `fat_g` **gelés à l'insertion** — garanti par un trigger `before update` qui
  refuse leur modification, pas seulement par convention.
- Les contraintes « état impossible » (`source_type = 'catalog_food'` ⇒
  `food_id not null`) : **introduites progressivement, avec leur lot**, comme tu
  le suggérais. En A1 on pose seulement celles dont les deux côtés existent déjà
  (`recipe`, `catalog_food`, `free`). `product` reste déclaré dans le vocabulaire
  mais sans contrainte associée tant que `food_products` n'existe pas — sinon la
  contrainte serait fausse le jour où la table arrive.

---

## 9. LES DEUX DÉCISIONS QUE J'ATTENDS

**Q1 — Portée de lecture du coach sur `meal_entries` (§7).**

- **(a) Convention maison** — `student_id = current_student_id() or is_coach_or_admin()`.
  Cohérent avec les 20 autres tables élève. Tout le staff lit tout. Aujourd'hui sans
  effet réel (1 seul compte staff, qui est l'admin).
- **(b) Strict** — nouveau helper `coach_peut_lire_eleve(uuid)` :
  `is_admin() or exists (select 1 from students s where s.id = $1 and s.coach_id = current_coach_id())`.
  Plus proche de ta formulation. **Effet mesuré : les 2 élèves sans `coach_id`
  ne seraient lisibles que par l'admin.** Et ce serait la première policy du schéma
  de ce type — les 20 autres tables resteraient laxistes, donc l'isolement serait
  partiel tant qu'elles ne suivent pas.

Ma recommandation : **(b)**, parce que `meal_entries` est la table la plus intime
du produit et que le sens de l'histoire est le durcissement — à condition
d'accepter les 2 élèves orphelins et d'assumer que les 20 autres tables suivront
dans un chantier « isolation coach » dédié.

**Q2 — `nutrition_recipe_ingredients.food_id`.**
Je propose de **ne pas l'ajouter en A1** (preuve en §5) et de la reporter à DATA
CLEANUP, avec les 17 composites. Confirmes-tu ?

---

*Aucune migration écrite. Aucun fichier de code modifié. Aucun `db push`. Rien committé, rien poussé.*
