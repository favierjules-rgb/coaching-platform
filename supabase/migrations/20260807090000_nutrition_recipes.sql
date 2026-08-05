-- ============================================================================
-- Migration 20260807090000 — socle des recettes adaptatives
-- (chantier feat/nutrition-adaptive-recipes-engine, PR A).
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
-- Le solveur adaptatif (lib/nutrition/recipe-solver.ts) existe et est couvert
-- par 25 tests, mais AUCUNE recette n'existe en base : l'audit du chantier a
-- confirmé zéro table, zéro vue, zéro RPC liée aux recettes, aux ingrédients
-- ou aux aliments. Les 11 recettes du dépôt sont des FIXTURES de test, jamais
-- importées. Cette migration crée le socle de stockage — et rien d'autre.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE FAIT CETTE MIGRATION
-- ────────────────────────────────────────────────────────────────────────────
--   A. `public.nutrition_recipes`            — la recette CANONIQUE ;
--   B. `public.nutrition_recipe_ingredients` — miroir exact de
--      `RecipeIngredient` (lib/nutrition/recipe-types.ts) ;
--   C. `public.nutrition_recipe_tags`        — étiquettes à VOCABULAIRE
--      CONTRÔLÉ, jamais du texte libre ;
--   D. `public.nutrition_recipe_blocking_issue(uuid)` — fonction de LECTURE
--      qui dit si une recette est exploitable par le solveur.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - AUCUNE donnée insérée : ni recette, ni ingrédient, ni étiquette. Les
--     fixtures restent des fixtures ; leur import explicite appartient à la
--     PR B ;
--   - AUCUNE table de portion calculée. Une proposition du solveur est
--     ÉPHÉMÈRE par exigence produit : ce qui n'a pas de table ne peut pas
--     être écrit par inadvertance ;
--   - AUCUNE modification de `nutrition_plans`, `nutrition_plan_profiles`,
--     `nutrition_meal_slot_targets`, `nutrition_days` ni `meals` : les plans
--     v1 comme v2 sont strictement inchangés ;
--   - AUCUN référentiel d'aliments partagé. Chaque ingrédient porte les
--     valeurs SAISIES pour cette recette. Un ingrédient `free` n'est PAS
--     présumé à 0 : la colonne accepte ses vraies valeurs, et c'est le RÔLE
--     — pas la valeur — qui l'exclut du calcul ;
--   - AUCUNE fonction `security definer`.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DÉCISION — LECTURE ÉLÈVE VOLONTAIREMENT ABSENTE
-- ────────────────────────────────────────────────────────────────────────────
-- Aucune policy de SELECT pour l'élève n'est posée ici. C'est un choix, pas
-- un oubli.
--
--   1. La PR A ne livre AUCUN écran élève. Une policy que rien ne consomme
--      serait de l'exposition sans usage.
--   2. Une recette n'est jamais « la recette d'un élève » : elle appartient
--      au catalogue du coach. La seule policy simple possible — « tout
--      `authenticated` lit les recettes actives » — laisserait n'importe quel
--      élève énumérer l'intégralité du catalogue.
--   3. Le filtrage par profil (allergènes, intolérances, régime) est une
--      règle APPLICATIVE : proposer d'abord, filtrer ensuite serait exposer
--      d'abord. La PR C décidera de son chemin d'accès exact — policy
--      étroitement cadrée ou RPC dédiée — une fois ce chemin figé.
--
-- Ajouter une policy plus tard est ADDITIF ; en retirer une est une
-- régression de comportement. On choisit donc le sens réversible.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ÉCART ASSUMÉ AVEC LE GABARIT v2 : LE PRIVILÈGE TRUNCATE
-- ────────────────────────────────────────────────────────────────────────────
-- Le gabarit de la migration 20260804090000 fait `revoke all … from public`
-- puis `from anon`, mais JAMAIS `from authenticated`. Or Supabase applique
-- `alter default privileges in schema public grant all on tables to anon,
-- authenticated, service_role` : `authenticated` hérite donc de TRUNCATE, et
-- TRUNCATE contourne la RLS. Constat mesuré sur une base reconstruite :
--     nutrition_plans              : TRUNCATE authenticated = true
--     nutrition_plan_profiles      : TRUNCATE authenticated = true
--     nutrition_meal_slot_targets  : TRUNCATE authenticated = true
--
-- Cette migration ne corrige PAS l'existant — ce serait hors périmètre et
-- non demandé. Mais elle refuse de reproduire le défaut sur les trois
-- nouvelles tables : `revoke all … from authenticated` PRÉCÈDE le grant des
-- quatre droits nécessaires. Vérifié par la checklist et par l'intégration.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. La recette canonique
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.nutrition_recipes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches (id) on delete restrict,
  name text not null,
  description text,
  -- `null` = recette GÉNÉRIQUE, proposable sur n'importe quel créneau.
  -- Sinon : l'un des six créneaux du modèle v2 (lib/nutrition/meal-distribution.ts).
  slot_key text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nutrition_recipes_name_not_blank
    check (length(btrim(name)) > 0),
  constraint nutrition_recipes_slot_key_check
    check (slot_key is null or slot_key in
      ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'dessert')),
  constraint nutrition_recipes_status_check
    check (status in ('draft', 'active', 'archived'))
);

-- `on delete restrict` sur coach_id : supprimer un coach ne doit JAMAIS
-- emporter silencieusement son catalogue. La suppression est refusée tant que
-- des recettes existent — décision explicite plutôt que perte de données.

create index if not exists nutrition_recipes_coach_id_idx
  on public.nutrition_recipes (coach_id);

-- Accès de proposition : « les recettes actives de ce créneau ».
create index if not exists nutrition_recipes_status_slot_idx
  on public.nutrition_recipes (status, slot_key);

comment on table public.nutrition_recipes is
  'Recette CANONIQUE. Elle n''est jamais modifiée par une adaptation : les quantités calculées par solveRecipe sont éphémères et n''ont aucune table. slot_key null = recette générique, proposable sur tout créneau v2.';
comment on column public.nutrition_recipes.slot_key is
  'Créneau v2 conseillé (breakfast … dessert), ou null pour une recette générique. Aligné sur MEAL_SLOT_KEYS de lib/nutrition/meal-distribution.ts.';
comment on column public.nutrition_recipes.status is
  'Statut ÉDITORIAL : draft (en cours de saisie) | active (proposable) | archived (retirée). Sans rapport avec l''assignation d''un plan.';

-- ────────────────────────────────────────────────────────────────────────────
-- B. Les ingrédients — miroir exact de RecipeIngredient
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.nutrition_recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.nutrition_recipes (id) on delete cascade,
  position integer not null,
  name text not null,
  role text not null,

  -- Macros POUR 100 g CRU — convention du solveur, documentée dans
  -- lib/nutrition/recipe-types.ts. AUCUNE valeur n'est présumée : un
  -- ingrédient `free` peut porter ses vraies macros, c'est son RÔLE qui
  -- l'exclut du calcul, pas un zéro conventionnel.
  protein_per_100g numeric not null,
  carb_per_100g numeric not null,
  fat_per_100g numeric not null,

  reference_grams numeric not null,
  min_grams numeric,
  max_grams numeric,

  unit_scalable boolean not null default false,
  max_units integer,
  unit_name text,
  fixed_label text,

  egg boolean not null default false,
  egg_grams numeric,

  linked_to_ingredient_id uuid,
  link_ratio_bp integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Support de la clé étrangère composite ci-dessous : elle garantit
  -- STRUCTURELLEMENT qu'un ingrédient lié appartient à la MÊME recette.
  constraint nutrition_recipe_ingredients_id_recipe_unique unique (id, recipe_id),

  constraint nutrition_recipe_ingredients_position_positive
    check (position >= 1),
  constraint nutrition_recipe_ingredients_position_unique
    unique (recipe_id, position),
  constraint nutrition_recipe_ingredients_name_not_blank
    check (length(btrim(name)) > 0),
  constraint nutrition_recipe_ingredients_role_check
    check (role in ('protein', 'carbohydrate', 'fat', 'fixed', 'free')),

  constraint nutrition_recipe_ingredients_macros_non_negative
    check (protein_per_100g >= 0 and carb_per_100g >= 0 and fat_per_100g >= 0),
  constraint nutrition_recipe_ingredients_reference_non_negative
    check (reference_grams >= 0),
  constraint nutrition_recipe_ingredients_min_non_negative
    check (min_grams is null or min_grams >= 0),
  constraint nutrition_recipe_ingredients_max_non_negative
    check (max_grams is null or max_grams >= 0),
  constraint nutrition_recipe_ingredients_bounds_ordered
    check (min_grams is null or max_grams is null or min_grams <= max_grams),

  constraint nutrition_recipe_ingredients_max_units_positive
    check (max_units is null or max_units >= 1),
  constraint nutrition_recipe_ingredients_units_only_when_scalable
    check (unit_scalable or (max_units is null and unit_name is null)),
  constraint nutrition_recipe_ingredients_egg_grams_positive
    check (egg_grams is null or egg_grams > 0),
  constraint nutrition_recipe_ingredients_egg_grams_only_when_egg
    check (egg or egg_grams is null),

  -- Une liaison est un COUPLE : parent ET part, ou ni l'un ni l'autre.
  constraint nutrition_recipe_ingredients_link_pair
    check (
      (linked_to_ingredient_id is null and link_ratio_bp is null)
      or (linked_to_ingredient_id is not null and link_ratio_bp is not null and link_ratio_bp > 0)
    ),
  -- Un ingrédient ne peut pas être lié à lui-même. Les cycles plus longs
  -- sont détectés par nutrition_recipe_blocking_issue (une contrainte ne
  -- peut pas parcourir un graphe).
  constraint nutrition_recipe_ingredients_no_self_link
    check (linked_to_ingredient_id is null or linked_to_ingredient_id <> id),

  -- L'ingrédient parent DOIT appartenir à la même recette. Garanti par la
  -- base, pas seulement par l'application.
  constraint nutrition_recipe_ingredients_link_same_recipe
    foreign key (linked_to_ingredient_id, recipe_id)
    references public.nutrition_recipe_ingredients (id, recipe_id)
    on delete set null
);

create index if not exists nutrition_recipe_ingredients_recipe_id_idx
  on public.nutrition_recipe_ingredients (recipe_id, position);

comment on table public.nutrition_recipe_ingredients is
  'Ingrédients d''une recette, en miroir exact du type RecipeIngredient (lib/nutrition/recipe-types.ts). Macros POUR 100 g CRU. Aucune valeur n''est présumée : un ingrédient `free` porte ses vraies valeurs, c''est son rôle qui l''exclut du calcul. Aucun référentiel d''aliments partagé : ces valeurs sont celles saisies pour CETTE recette.';
comment on column public.nutrition_recipe_ingredients.link_ratio_bp is
  'Part du poids du parent, en POINTS DE BASE entiers (1 500 = 15 %). Jamais un flottant — même convention que tout le chantier nutrition v2.';
comment on constraint nutrition_recipe_ingredients_link_same_recipe
  on public.nutrition_recipe_ingredients is
  'Clé étrangère COMPOSITE (linked_to_ingredient_id, recipe_id) : un ingrédient lié ne peut structurellement pas pointer vers une autre recette.';

-- ────────────────────────────────────────────────────────────────────────────
-- C. Les étiquettes — VOCABULAIRE CONTRÔLÉ, jamais du texte libre
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI PAS DU TEXTE LIBRE. `student_profiles.allergies`,
-- `.intolerances` et `.disliked_foods` sont des tableaux jsonb de texte
-- libre, nullables, écrits par l'onboarding. Comparer « arachide » à un nom
-- d'ingrédient produit des faux négatifs — sur des ALLERGIES. Le filtrage
-- applicatif ne travaille donc QUE sur les clés techniques ci-dessous.
--
-- CHOIX POUR `excludes` — tranché : VOCABULAIRE CONTRÔLÉ, comme les trois
-- autres familles. L'alternative (« identifiant technique stable » vers un
-- référentiel d'aliments) a été écartée pour une raison factuelle : ce
-- référentiel n'existe pas et la PR A n'a pas le droit de le créer. Un
-- identifiant qui ne référence rien n'est pas plus sûr que du texte libre.
-- Le vocabulaire d'`excludes` couvre donc des CATÉGORIES d'aliment, pas des
-- aliments. Il s'étend par MIGRATION — jamais par saisie utilisateur — et
-- pourra migrer additivement vers une clé étrangère le jour où un
-- référentiel existera.
create table if not exists public.nutrition_recipe_tags (
  recipe_id uuid not null references public.nutrition_recipes (id) on delete cascade,
  kind text not null,
  value text not null,
  created_at timestamptz not null default now(),

  constraint nutrition_recipe_tags_pkey primary key (recipe_id, kind, value),

  constraint nutrition_recipe_tags_kind_check
    check (kind in ('allergen', 'intolerance', 'diet', 'excludes')),

  -- Vocabulaire initial. Toute extension passe par une migration : la
  -- contrainte est le contrat, et un diff la rend visible en revue.
  constraint nutrition_recipe_tags_value_check check (
    (kind = 'allergen' and value in (
      'gluten', 'milk', 'egg', 'peanut', 'tree_nut', 'soy', 'fish',
      'shellfish', 'sesame', 'mustard', 'celery', 'lupin', 'sulfites'))
    or (kind = 'intolerance' and value in (
      'lactose', 'gluten', 'fructose', 'fodmap'))
    or (kind = 'diet' and value in (
      'vegetarian', 'vegan', 'pescetarian', 'halal', 'kosher'))
    or (kind = 'excludes' and value in (
      'pork', 'beef', 'veal', 'lamb', 'poultry', 'red_meat', 'offal',
      'seafood', 'raw_fish', 'raw_egg', 'alcohol', 'caffeine', 'spicy',
      'mushroom', 'onion_garlic', 'added_sugar', 'artificial_sweetener'))
  )
);

create index if not exists nutrition_recipe_tags_kind_value_idx
  on public.nutrition_recipe_tags (kind, value);

comment on table public.nutrition_recipe_tags is
  'Étiquettes d''une recette, à VOCABULAIRE CONTRÔLÉ. kind = allergen (allergènes réglementaires) | intolerance | diet (régime COMPATIBLE) | excludes (catégorie d''aliment présente). Aucune valeur libre : la contrainte CHECK est le contrat, elle s''étend par migration. Le filtrage applicatif ne compare JAMAIS du texte libre de profil à un nom d''ingrédient.';
comment on column public.nutrition_recipe_tags.kind is
  'allergen / intolerance / excludes décrivent ce que la recette CONTIENT. diet décrit un régime avec lequel la recette est COMPATIBLE — sémantique inverse, volontairement, car un plat ne « contient » pas un régime.';

-- ────────────────────────────────────────────────────────────────────────────
-- D. Sécurité — RLS, gabarit v2, plus le correctif TRUNCATE
-- ────────────────────────────────────────────────────────────────────────────
alter table public.nutrition_recipes enable row level security;
alter table public.nutrition_recipe_ingredients enable row level security;
alter table public.nutrition_recipe_tags enable row level security;

drop policy if exists "nutrition_recipes_manage_staff" on public.nutrition_recipes;
create policy "nutrition_recipes_manage_staff" on public.nutrition_recipes
  for all
  using (public.is_coach_or_admin())
  with check (public.is_coach_or_admin());

drop policy if exists "nutrition_recipe_ingredients_manage_staff" on public.nutrition_recipe_ingredients;
create policy "nutrition_recipe_ingredients_manage_staff" on public.nutrition_recipe_ingredients
  for all
  using (public.is_coach_or_admin())
  with check (public.is_coach_or_admin());

drop policy if exists "nutrition_recipe_tags_manage_staff" on public.nutrition_recipe_tags;
create policy "nutrition_recipe_tags_manage_staff" on public.nutrition_recipe_tags
  for all
  using (public.is_coach_or_admin())
  with check (public.is_coach_or_admin());

-- AUCUNE policy de SELECT pour l'élève — voir la justification en en-tête.
-- RLS étant activée sans policy le concernant, un élève authentifié ne lit
-- AUCUNE ligne de ces trois tables.

-- Privilèges. `revoke all … from authenticated` PRÉCÈDE le grant : sans lui,
-- les privilèges par défaut de Supabase laisseraient TRUNCATE (qui contourne
-- la RLS) à tout compte authentifié.
revoke all on table public.nutrition_recipes from public;
revoke all on table public.nutrition_recipes from anon;
revoke all on table public.nutrition_recipes from authenticated;
revoke all on table public.nutrition_recipe_ingredients from public;
revoke all on table public.nutrition_recipe_ingredients from anon;
revoke all on table public.nutrition_recipe_ingredients from authenticated;
revoke all on table public.nutrition_recipe_tags from public;
revoke all on table public.nutrition_recipe_tags from anon;
revoke all on table public.nutrition_recipe_tags from authenticated;

grant select, insert, update, delete on table public.nutrition_recipes to authenticated;
grant select, insert, update, delete on table public.nutrition_recipe_ingredients to authenticated;
grant select, insert, update, delete on table public.nutrition_recipe_tags to authenticated;

grant all on table public.nutrition_recipes to service_role;
grant all on table public.nutrition_recipe_ingredients to service_role;
grant all on table public.nutrition_recipe_tags to service_role;

-- `updated_at` : même déclencheur que partout ailleurs dans le schéma.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    execute 'drop trigger if exists set_updated_at on public.nutrition_recipes';
    execute 'create trigger set_updated_at before update on public.nutrition_recipes
             for each row execute function public.set_updated_at()';
    execute 'drop trigger if exists set_updated_at on public.nutrition_recipe_ingredients';
    execute 'create trigger set_updated_at before update on public.nutrition_recipe_ingredients
             for each row execute function public.set_updated_at()';
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- E. nutrition_recipe_blocking_issue — fonction de LECTURE
-- ────────────────────────────────────────────────────────────────────────────
-- Retourne NULL si la recette est exploitable par le solveur, sinon le CODE
-- du premier problème bloquant. Aucune écriture : `stable`, aucun INSERT /
-- UPDATE / DELETE, `security invoker`, `search_path` verrouillé.
--
-- Elle double délibérément certaines contraintes CHECK. Ce n'est pas
-- redondant : la checklist doit pouvoir trancher sans passer par
-- l'application, et une contrainte posée plus tard sur une base déjà peuplée
-- n'aurait pas rétro-validé les lignes existantes.
create or replace function public.nutrition_recipe_blocking_issue(p_recipe_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  c_roles constant text[] := array['protein', 'carbohydrate', 'fat', 'fixed', 'free'];
  c_scalable constant text[] := array['protein', 'carbohydrate', 'fat'];
  v_recipe record;
  v_nb int;
begin
  if p_recipe_id is null then
    return 'recipe_not_found';
  end if;

  select r.id, r.name, r.status into v_recipe
    from public.nutrition_recipes r where r.id = p_recipe_id;
  if not found then
    return 'recipe_not_found';
  end if;

  if v_recipe.name is null or length(btrim(v_recipe.name)) = 0 then
    return 'recipe_name_empty';
  end if;

  if v_recipe.status is null or v_recipe.status not in ('draft', 'active', 'archived') then
    return 'recipe_status_unknown';
  end if;

  select count(*) into v_nb
    from public.nutrition_recipe_ingredients i where i.recipe_id = p_recipe_id;
  if v_nb = 0 then
    return 'recipe_without_ingredient';
  end if;

  -- Positions : uniques (garanti par contrainte) ET continues à partir de 1.
  -- La continuité N'EST PAS une contrainte de table : la PR B doit pouvoir
  -- supprimer un ingrédient au milieu d'une édition sans que la base refuse
  -- l'état intermédiaire. C'est donc une règle d'EXPLOITABILITÉ, vérifiée ici.
  select count(*) into v_nb
    from public.nutrition_recipe_ingredients i where i.recipe_id = p_recipe_id;
  if exists (
    select 1 from public.nutrition_recipe_ingredients i
     where i.recipe_id = p_recipe_id
       and (i.position < 1 or i.position > v_nb)
  ) then
    return 'ingredient_positions_not_contiguous';
  end if;

  if exists (
    select 1 from public.nutrition_recipe_ingredients i
     where i.recipe_id = p_recipe_id and not (i.role = any(c_roles))
  ) then
    return 'ingredient_role_unknown';
  end if;

  if exists (
    select 1 from public.nutrition_recipe_ingredients i
     where i.recipe_id = p_recipe_id
       and (i.protein_per_100g < 0 or i.carb_per_100g < 0 or i.fat_per_100g < 0
            or i.reference_grams < 0)
  ) then
    return 'ingredient_macro_negative';
  end if;

  if exists (
    select 1 from public.nutrition_recipe_ingredients i
     where i.recipe_id = p_recipe_id
       and ((i.min_grams is not null and i.min_grams < 0)
            or (i.max_grams is not null and i.max_grams < 0)
            or (i.min_grams is not null and i.max_grams is not null and i.min_grams > i.max_grams))
  ) then
    return 'ingredient_bounds_incoherent';
  end if;

  -- Lien vers un ingrédient d'une AUTRE recette : structurellement impossible
  -- grâce à la clé étrangère composite. Vérifié tout de même — la fonction
  -- doit rester vraie même si la contrainte venait à être relâchée.
  if exists (
    select 1 from public.nutrition_recipe_ingredients i
     where i.recipe_id = p_recipe_id
       and i.linked_to_ingredient_id is not null
       and not exists (
         select 1 from public.nutrition_recipe_ingredients parent
          where parent.id = i.linked_to_ingredient_id
            and parent.recipe_id = i.recipe_id)
  ) then
    return 'ingredient_link_outside_recipe';
  end if;

  if exists (
    select 1 from public.nutrition_recipe_ingredients i
     where i.recipe_id = p_recipe_id
       and i.linked_to_ingredient_id is not null
       and (i.link_ratio_bp is null or i.link_ratio_bp <= 0)
  ) then
    return 'ingredient_link_ratio_invalid';
  end if;

  -- CYCLE de liaison. Une contrainte ne peut pas parcourir un graphe : on
  -- remonte la chaîne des parents, en bornant la profondeur au nombre
  -- d'ingrédients. Toute chaîne plus longue est nécessairement un cycle.
  if exists (
    with recursive chaine(depart, courant, profondeur) as (
      select i.id, i.linked_to_ingredient_id, 1
        from public.nutrition_recipe_ingredients i
       where i.recipe_id = p_recipe_id and i.linked_to_ingredient_id is not null
      union all
      select c.depart, i.linked_to_ingredient_id, c.profondeur + 1
        from chaine c
        join public.nutrition_recipe_ingredients i on i.id = c.courant
       where i.linked_to_ingredient_id is not null
         and c.profondeur <= v_nb
    )
    select 1 from chaine where courant = depart or profondeur > v_nb
  ) then
    return 'ingredient_link_cycle';
  end if;

  -- Un ingrédient AJUSTABLE dont la quantité de référence vaut 0 rend le
  -- ratio de son groupe indéterminé : le solveur ne pourrait rien faire de
  -- cette variable.
  if exists (
    select 1 from public.nutrition_recipe_ingredients i
     where i.recipe_id = p_recipe_id
       and i.role = any(c_scalable)
       and i.reference_grams <= 0
  ) then
    return 'scalable_ingredient_without_reference';
  end if;

  -- Cohérence unit_scalable / max_units / unit_name.
  if exists (
    select 1 from public.nutrition_recipe_ingredients i
     where i.recipe_id = p_recipe_id
       and i.unit_scalable
       and (i.unit_name is null or length(btrim(i.unit_name)) = 0
            or (i.max_units is not null and i.max_units < 1)
            or i.reference_grams <= 0)
  ) then
    return 'unit_scalable_incoherent';
  end if;
  if exists (
    select 1 from public.nutrition_recipe_ingredients i
     where i.recipe_id = p_recipe_id
       and not i.unit_scalable
       and (i.max_units is not null or i.unit_name is not null)
  ) then
    return 'unit_fields_without_unit_scalable';
  end if;

  -- Cohérence egg / egg_grams.
  if exists (
    select 1 from public.nutrition_recipe_ingredients i
     where i.recipe_id = p_recipe_id
       and ((i.egg and i.egg_grams is not null and i.egg_grams <= 0)
            or (not i.egg and i.egg_grams is not null))
  ) then
    return 'egg_fields_incoherent';
  end if;

  return null;
end;
$fn$;

alter function public.nutrition_recipe_blocking_issue(uuid) owner to postgres;

comment on function public.nutrition_recipe_blocking_issue(uuid) is
  'Retourne NULL si la recette est exploitable par le solveur adaptatif, sinon le code du premier problème bloquant. Fonction de LECTURE : stable, aucune écriture, security invoker, search_path vide. Miroir SQL des invariants attendus par lib/nutrition/recipe-solver.ts.';

revoke all on function public.nutrition_recipe_blocking_issue(uuid) from public;
revoke execute on function public.nutrition_recipe_blocking_issue(uuid) from anon;
grant execute on function public.nutrition_recipe_blocking_issue(uuid) to authenticated;
