-- ============================================================================
-- Migration 20260909090000 — N1.5.2 : QUANTITÉ MINIMALE PAR ALIMENT.
-- (chantier feat/nutrition-structured-meals)
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
-- N1.5.1 a rendu la répartition plus humaine, mais le solveur reste libre de
-- mettre à ZÉRO un aliment que l'élève a choisi. Mesuré sur le petit déjeuner
-- P 55 · G 93 · L 32 (flocons, beurre, fromage blanc, œuf, sirop d'agave) :
--     flocons 149 · beurre 0 · fromage blanc 160 · œuf 207 · sirop 0
-- Mathématiquement juste ; fonctionnellement, deux aliments choisis ont
-- disparu du repas.
--
-- Le coach peut désormais poser une QUANTITÉ MINIMALE. Avec beurre ≥ 5 g et
-- sirop ≥ 10 g, le même repas devient :
--     flocons 130 · beurre 5 · fromage blanc 239 · œuf 179 · sirop 10   (exact)
--
-- ────────────────────────────────────────────────────────────────────────────
-- TROIS NATURES DE NOMBRE, ET IL FAUT LES DISTINGUER
-- ────────────────────────────────────────────────────────────────────────────
--   PORTION PRÉFÉRÉE (N1.5.1)  — SOFT. Le solveur la vise à macros égales et
--     s'en écarte sans hésiter dès que la cible l'exige.
--   QUANTITÉ MINIMALE (ce lot) — HARD. Le solveur ne descend JAMAIS en
--     dessous. C'est une garantie de présence, pas une suggestion.
--   PLAFOND (N1.5)             — HARD, et il vit dans le SOLVEUR (300 g /
--     500 ml), délibérément pas dans ce schéma.
--
-- ⚠️ LE MINIMUM N'EST PAS : un rôle, une portion préférée, un
-- `referenceGrams`, un minimum automatique par catégorie, ni une valeur
-- devinée. Sans champ explicite du coach, le minimum effectif vaut ZÉRO et le
-- comportement est celui de N1.5 au bit près.
--
-- ⚠️ AUCUN MINIMUM GLOBAL. `food_catalog` et `food_products` ne sont pas
-- touchés : dans ce lot, le minimum appartient à la ligne de liste du coach,
-- et à elle seule. La même whey peut valoir 5 g dans une liste et 20 g dans
-- une autre.
--
-- ────────────────────────────────────────────────────────────────────────────
-- EXPAND, PAS RENAME — ET C'EST LA CORRECTION LA PLUS IMPORTANTE DE CE LOT
-- ────────────────────────────────────────────────────────────────────────────
-- `preferred_unit` portait l'unité de la portion préférée. Elle doit désormais
-- porter aussi celle du minimum — et un minimum SANS portion est le cas le
-- plus courant. Le nom devient faux, et la contrainte de paire de N1.5.1
-- REFUSAIT ce cas : `(preferred_quantity is null) = (preferred_unit is null)`
-- rendait « minimum seul » impossible.
--
-- ⚠️ MAIS UN `rename column` OUVRE UNE FENÊTRE DE CASSE, et la production est
-- déjà servie. Vérifié le 15/08/2026 : la migration N1.5.1 est appliquée à
-- distance et porte 63 options avec portion + unité. Le code déployé lit
-- `preferred_unit`. Renommer, c'est choisir qui casse :
--     base migrée avant le déploiement  → l'ancien code ne trouve plus la colonne ;
--     déploiement avant la base         → le nouveau code ne la trouve pas encore.
-- Il n'existe pas d'ordre sûr. On ne renomme donc PAS.
--
-- ⚠️ STRATÉGIE EXPAND → DEPLOY → CONTRACT. Ce lot est l'EXPAND :
--   1. `quantity_unit` est AJOUTÉE à côté de `preferred_unit` ;
--   2. les lignes existantes sont recopiées 1:1 — ce n'est PAS un backfill
--      métier, c'est le transport d'une unité qui existait déjà, sans laquelle
--      les 63 snapshots perdraient leur échelle ;
--   3. `preferred_unit` SURVIT, et reste écrite tant qu'une portion est
--      présente, pour que l'ancien code continue de comprendre les snapshots
--      créés PENDANT le déploiement ;
--   4. le CONTRACT — suppression de `preferred_unit` et de sa contrainte —
--      sera un lot séparé, après déploiement et validation terrain.
--
-- ⚠️ AUCUNE COLONNE `minimum_unit`. Elle ne pourrait qu'être ÉGALE à
-- `quantity_unit` : les deux quantités sont figées dans l'unité de la MÊME
-- identité, au MÊME instant.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - AUCUN RENAME, AUCUN DROP de `preferred_unit` : le CONTRACT est un autre
--     lot, et il n'aura lieu qu'après validation terrain du nouveau code ;
--   - AUCUN BACKFILL MÉTIER (la copie d'unité du §A n'en est pas un), AUCUN DEFAULT. `null` veut dire « aucun minimum », et
--     c'est la valeur de toutes les lignes après cette migration ;
--   - AUCUNE CONTRAINTE NE CODE 300 NI 500. Le plafond est une décision
--     produit qui vit dans le solveur ; l'écrire ici en ferait une seconde
--     vérité, et le jour où il bougerait il faudrait une migration. La
--     cohérence `minimum ≤ plafond` est gardée par la couche TypeScript, à
--     deux niveaux — à l'écriture, ET à la résolution, pour qu'un snapshot
--     déjà figé ne puisse pas être trahi en silence ;
--   - AUCUNE POLICY créée ni modifiée. Les colonnes héritent ;
--   - AUCUNE NOUVELLE RPC. Une seule fonction est retouchée ;
--   - AUCUNE ÉCRITURE DE CONSOMMATION. `consumed_meals` et `meal_entries` ne
--     sont pas touchées : le repas calculé reste une PRESCRIPTION, et « ce que
--     j'ai mangé » reste la vérité de consommation. Les deux modèles ne sont
--     pas fusionnés.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. EXPAND — `quantity_unit` NAÎT À CÔTÉ DE `preferred_unit`
-- ────────────────────────────────────────────────────────────────────────────
alter table public.meal_choice_options
  add column if not exists quantity_unit text;

-- ⚠️ LE SEUL « BACKFILL » DE TOUT CE CHANTIER, ET IL N'EN EST PAS UN AU SENS
-- MÉTIER. On ne fabrique aucune valeur : on RECOPIE une unité qui existe déjà,
-- à l'identique, parce qu'elle change de colonne. Sans cette copie, les 63
-- snapshots de production perdraient l'échelle de leur portion — ce qui est
-- exactement ce que la migration doit empêcher.
--
-- ⚠️ IDEMPOTENTE : `where quantity_unit is null` fait de ce `update` un
-- no-op au second passage, et il ne peut jamais écraser une valeur posée
-- depuis par le nouveau code.
update public.meal_choice_options
   set quantity_unit = preferred_unit
 where preferred_unit is not null
   and quantity_unit is null;

-- ────────────────────────────────────────────────────────────────────────────
-- B. LA QUANTITÉ MINIMALE — côté bibliothèque, puis côté snapshot
-- ────────────────────────────────────────────────────────────────────────────
alter table public.food_list_items
  add column if not exists minimum_quantity_override numeric;

alter table public.meal_choice_options
  add column if not exists minimum_quantity numeric;

-- ⚠️ `NULL` ET `0` NE DISENT PAS LA MÊME CHOSE, ET IL NE DOIT Y AVOIR QU'UNE
-- FAÇON DE DIRE « PAS DE MINIMUM ». `null` = aucun minimum, minimum effectif
-- zéro, comportement N1.5. Un `0` explicite dirait la même chose une seconde
-- fois : on le refuse. Même règle que `preferred_quantity`.
alter table public.food_list_items
  drop constraint if exists food_list_items_minimum_override_positive;
alter table public.food_list_items
  add constraint food_list_items_minimum_override_positive
  check (minimum_quantity_override is null or minimum_quantity_override > 0);

alter table public.meal_choice_options
  drop constraint if exists meal_choice_options_minimum_positive;
alter table public.meal_choice_options
  add constraint meal_choice_options_minimum_positive
  check (minimum_quantity is null or minimum_quantity > 0);

-- ────────────────────────────────────────────────────────────────────────────
-- C. DEUX CONTRAINTES, ET IL FAUT SAVOIR LAQUELLE EST LAQUELLE
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ 1. LA CONTRAINTE MÉTIER — celle qui dit la vérité de N1.5.2 et qui
-- survivra au CONTRACT. Écrite comme une ÉQUIVALENCE : « pas d'unité » et
-- « aucune quantité » sont le même état.
alter table public.meal_choice_options
  drop constraint if exists meal_choice_options_quantites_unite;
alter table public.meal_choice_options
  add constraint meal_choice_options_quantites_unite
  check ((preferred_quantity is null and minimum_quantity is null) = (quantity_unit is null));

alter table public.meal_choice_options
  drop constraint if exists meal_choice_options_quantity_unit_check;
alter table public.meal_choice_options
  add constraint meal_choice_options_quantity_unit_check
  check (quantity_unit is null or quantity_unit in ('g', 'ml'));

-- ⚠️ 2. LA CONTRAINTE LEGACY, TEMPORAIRE — elle disparaîtra au CONTRACT.
-- `meal_choice_options_preferred_paire` de N1.5.1 est CONSERVÉE TELLE QUELLE,
-- et ce n'est pas de la négligence : elle dit exactement la règle de
-- transition demandée — « une portion présente impose une unité legacy
-- présente ». Un minimum SEUL la satisfait déjà (portion nulle, unité legacy
-- nulle), donc elle n'empêche pas le nouveau cas.
--
-- On y ajoute la seule chose qu'elle ne garantit pas : les deux unités ne
-- doivent jamais DIVERGER pendant la transition.
alter table public.meal_choice_options
  drop constraint if exists meal_choice_options_unite_legacy_coherente;
alter table public.meal_choice_options
  add constraint meal_choice_options_unite_legacy_coherente
  check (preferred_unit is null or preferred_unit = quantity_unit);

comment on column public.food_list_items.minimum_quantity_override is
  'N1.5.2 — quantité MINIMALE garantie pour cet aliment DANS CETTE LISTE, dans l''unité nutritionnelle de l''identité visée. CONTRAINTE DURE côté solveur : la quantité calculée ne descend jamais en dessous. NULL = aucun minimum, et le minimum effectif vaut alors zéro (comportement N1.5). Ce n''est ni une portion préférée, ni un rôle, ni un referenceGrams. Aucun minimum global n''existe : la même identité peut valoir 5 g ici et 20 g dans une autre liste.';

comment on column public.meal_choice_options.minimum_quantity is
  'N1.5.2 — quantité MINIMALE effective, FIGÉE au moment où le coach a ajouté la liste au repas. Comme preferred_quantity, elle ne suit pas la bibliothèque : modifier le minimum plus tard ne touche aucun repas déjà construit. NULL = aucun minimum. La cohérence avec le plafond du solveur (300 g / 500 ml) est gardée en TypeScript — à l''écriture ET à la résolution — jamais par une contrainte SQL, qui ferait du plafond une seconde vérité.';

comment on column public.meal_choice_options.quantity_unit is
  'N1.5.2 — unité COMMUNE à preferred_quantity et minimum_quantity, figée avec elles. Elle REMPLACE progressivement preferred_unit (N1.5.1), qui survit le temps du rollout : stratégie expand → deploy → contract, parce que la production lit encore l''ancienne colonne. Restreinte à (g, ml) : le vocabulaire de ce qui est CALCULABLE. Il n''existe volontairement PAS de minimum_unit — les deux quantités sont figées dans l''unité de la même identité, au même instant.';

-- ────────────────────────────────────────────────────────────────────────────
-- D. `save_nutrition_plan_v2` — LE MINIMUM ENTRE DANS LE SNAPSHOT
-- ────────────────────────────────────────────────────────────────────────────
-- Fonction reproduite intégralement, telle qu'elle existe après N1.5.1, avec
-- pour seules évolutions : une variable, deux validations
-- (MINIMUM_SANS_UNITE, MINIMUM_NON_POSITIF), une colonne de plus à l'insert
-- et à l'update, et la lecture de `quantity_unit`.
--
-- ⚠️ DOUBLE ÉCRITURE : `preferred_unit` est REMPLIE tant qu'une portion
-- existe (compatibilité descendante du rollout).
--
-- ⚠️ `preferred_unit` RESTE ACCEPTÉE EN ENTRÉE. Une charge utile écrite avant
-- le renommage reste valide : la clé n'a jamais eu d'autre sens que « l'unité
-- de cette option ». C'est la même politesse que `choice_slots` absente.
--
-- ⚠️ LE `delete` DE PRÉSERVATION PAR IDENTITÉ N'EST PAS TOUCHÉ. Il protège
-- `planned_meal_items`, qui cascade depuis les clés composites.

CREATE OR REPLACE FUNCTION public.save_nutrition_plan_v2(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  c_slots constant text[] := array['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'dessert'];
  c_days constant text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

  v_plan jsonb;
  v_profiles jsonb;
  v_days jsonb;
  v_sync_days boolean;
  v_sync_profiles boolean;

  v_profile jsonb;
  v_slots jsonb;
  v_slot jsonb;
  v_slot_key text;
  v_seen_slots text[];
  v_seen_profiles text[] := array[]::text[];

  v_day jsonb;
  v_day_key text;
  v_seen_days text[] := array[]::text[];
  v_meal jsonb;
  v_meal_ids uuid[];
  v_item jsonb;
  v_items jsonb;

  -- N1.3 — les occurrences de listes d'un repas, et leurs options.
  v_meal_id uuid;
  v_occurrences jsonb;
  v_occ jsonb;
  v_occ_ids uuid[];
  v_occ_id uuid;
  v_occ_pos integer;
  v_occ_label text;
  v_options jsonb;
  v_option jsonb;
  v_opt_pos integer;
  v_opt_food uuid;
  v_opt_product uuid;
  v_opt_pref numeric;
  v_opt_pref_unit text;
  v_opt_min numeric;

  v_plan_id uuid;
  v_day_id uuid;
  v_profile_id uuid;
  v_profile_key text;
  v_main_profile_key text;
  v_previous_version integer;
  v_converted boolean := false;

  v_daily_calories numeric;
  v_daily_calories_raw numeric;
  v_weekly_target numeric;
  v_protein_bp integer;
  v_carb_bp integer;
  v_fat_bp integer;

  v_protein_g numeric;
  v_carb_g numeric;
  v_fat_g numeric;
  v_daily_target jsonb;

  v_plan_row public.nutrition_plans%rowtype;
  v_result_profile jsonb;
  v_result_slots jsonb;
  v_derived_slots jsonb;
  v_result_profiles jsonb;
  v_result_days jsonb;
  v_orphelin text;
begin
  -- ── 0. Autorisation ───────────────────────────────────────────────────
  if not public.is_coach_or_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_PAYLOAD: objet JSON attendu';
  end if;

  v_plan := coalesce(p_payload->'plan', '{}'::jsonb);

  -- ── 1. Profils : forme moderne, forme historique, ou clé absente ─────
  --   `profiles` présent      → synchronisation complète des profils ;
  --   `profile` + `slots`     → forme historique, un seul profil ;
  --   ni l'un ni l'autre      → les profils existants ne sont PAS touchés
  --                             (même doctrine que les jours et les repas).
  v_plan_id := nullif(p_payload->>'plan_id', '')::uuid;

  if p_payload ? 'profiles' then
    v_sync_profiles := true;
    v_profiles := p_payload->'profiles';
    if jsonb_typeof(v_profiles) <> 'array' or jsonb_array_length(v_profiles) = 0 then
      raise exception 'INVALID_PAYLOAD: profiles doit être un tableau non vide';
    end if;
  elsif p_payload ? 'profile' then
    v_sync_profiles := true;
    if jsonb_typeof(p_payload->'profile') <> 'object' then
      raise exception 'INVALID_PAYLOAD: profile manquant';
    end if;
    if p_payload->'slots' is null or jsonb_typeof(p_payload->'slots') <> 'array' then
      raise exception 'INVALID_PAYLOAD: slots doit être un tableau';
    end if;
    -- Un seul profil, dont les créneaux sont le tableau `slots` de l'appelant.
    v_profiles := jsonb_build_array((p_payload->'profile') || jsonb_build_object('slots', p_payload->'slots'));
  else
    v_sync_profiles := false;
    if v_plan_id is null then
      raise exception 'INVALID_PAYLOAD: une création exige au moins un profil';
    end if;
    -- Les profils déjà en base font foi : on les relit pour pouvoir valider
    -- les jours et choisir le profil principal, sans rien réécrire.
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'profile_key', pr.profile_key,
               'daily_calories', pr.daily_calories,
               'protein_bp', pr.protein_bp,
               'carb_bp', pr.carb_bp,
               'fat_bp', pr.fat_bp
             ) order by pr.profile_key), '[]'::jsonb)
      into v_profiles
      from public.nutrition_plan_profiles pr
     where pr.plan_id = v_plan_id;
    if jsonb_array_length(v_profiles) = 0 then
      raise exception 'PLAN_WITHOUT_PROFILE: le plan % n''a aucun profil', v_plan_id;
    end if;
  end if;

  -- Clé absente = les jours ne sont pas touchés.
  v_sync_days := p_payload ? 'days';
  v_days := coalesce(p_payload->'days', '[]'::jsonb);
  if jsonb_typeof(v_days) <> 'array' then
    raise exception 'INVALID_PAYLOAD: days doit être un tableau';
  end if;

  -- ── 2. Contrôle STRUCTUREL de tous les profils, avant toute écriture ──
  for v_profile in select * from jsonb_array_elements(v_profiles) loop
    v_profile_key := coalesce(nullif(v_profile->>'profile_key', ''), 'default');
    if v_profile_key !~ '^[a-z][a-z0-9_]{0,31}$' then
      raise exception 'INVALID_PROFILE_KEY: %', v_profile_key;
    end if;
    if v_profile_key = any(v_seen_profiles) then
      raise exception 'DUPLICATE_PROFILE_KEY: %', v_profile_key;
    end if;
    v_seen_profiles := array_append(v_seen_profiles, v_profile_key);

    if not v_sync_profiles then
      continue;
    end if;

    v_slots := v_profile->'slots';
    if v_slots is null or jsonb_typeof(v_slots) <> 'array' then
      raise exception 'INVALID_PAYLOAD: slots manquant pour le profil %', v_profile_key;
    end if;
    if jsonb_array_length(v_slots) <> array_length(c_slots, 1) then
      raise exception 'INVALID_PAYLOAD: les six créneaux sont obligatoires pour le profil % (reçu %)',
        v_profile_key, jsonb_array_length(v_slots);
    end if;

    v_seen_slots := array[]::text[];
    for v_slot in select * from jsonb_array_elements(v_slots) loop
      v_slot_key := v_slot->>'slot';
      if v_slot_key is null or not (v_slot_key = any(c_slots)) then
        raise exception 'INVALID_SLOT: %', coalesce(v_slot_key, '(null)');
      end if;
      if v_slot_key = any(v_seen_slots) then
        raise exception 'DUPLICATE_SLOT: % (profil %)', v_slot_key, v_profile_key;
      end if;
      v_seen_slots := array_append(v_seen_slots, v_slot_key);
    end loop;
  end loop;

  -- Profil PRINCIPAL : celui dont dérivent `daily_target` et le retour
  -- historique. Ordre déterministe, jamais un `limit 1` sans `order by`.
  v_main_profile_key := nullif(p_payload->>'main_profile_key', '');
  if v_main_profile_key is null or not (v_main_profile_key = any(v_seen_profiles)) then
    if 'default' = any(v_seen_profiles) then
      v_main_profile_key := 'default';
    elsif 'legacy_default' = any(v_seen_profiles) then
      v_main_profile_key := 'legacy_default';
    else
      select min(k) into v_main_profile_key from unnest(v_seen_profiles) as k;
    end if;
  end if;

  -- ── 3. Contrôle STRUCTUREL des jours ──────────────────────────────────
  if v_sync_days then
    for v_day in select * from jsonb_array_elements(v_days) loop
      v_day_key := coalesce(nullif(v_day->>'day', ''), nullif(v_day->>'weekday', ''));
      if v_day_key is null or not (v_day_key = any(c_days)) then
        raise exception 'INVALID_DAY: %', coalesce(v_day_key, '(null)');
      end if;
      if v_day_key = any(v_seen_days) then
        raise exception 'DUPLICATE_DAY: %', v_day_key;
      end if;
      v_seen_days := array_append(v_seen_days, v_day_key);

      v_profile_key := coalesce(nullif(v_day->>'profile_key', ''), v_main_profile_key);
      if not (v_profile_key = any(v_seen_profiles)) then
        raise exception 'UNKNOWN_PROFILE_FOR_DAY: le jour % désigne le profil %, absent du payload',
          v_day_key, v_profile_key;
      end if;

      if v_day ? 'meals' and jsonb_typeof(v_day->'meals') <> 'array' then
        raise exception 'INVALID_PAYLOAD: meals doit être un tableau (jour %)', v_day_key;
      end if;
      for v_meal in select * from jsonb_array_elements(coalesce(v_day->'meals', '[]'::jsonb)) loop
        if (v_meal->>'slot') is null or not ((v_meal->>'slot') = any(c_slots)) then
          raise exception 'INVALID_MEAL_SLOT: % (jour %)', coalesce(v_meal->>'slot', '(null)'), v_day_key;
        end if;
      end loop;
    end loop;
  end if;

  -- ── 4. Le plan : création, ou mise à jour VERROUILLÉE ─────────────────
  -- Valeurs du profil principal, nécessaires dès l'insertion du plan.
  select pf into v_profile
    from jsonb_array_elements(v_profiles) pf
   where coalesce(nullif(pf->>'profile_key', ''), 'default') = v_main_profile_key;

  v_daily_calories_raw := (v_profile->>'daily_calories')::numeric;
  v_daily_calories := coalesce(v_daily_calories_raw, 0);
  v_protein_bp := coalesce((v_profile->>'protein_bp')::integer, 0);
  v_carb_bp := coalesce((v_profile->>'carb_bp')::integer, 0);
  v_fat_bp := coalesce((v_profile->>'fat_bp')::integer, 0);

  v_protein_g := v_daily_calories * v_protein_bp / 10000.0 / 4.0;
  v_carb_g    := v_daily_calories * v_carb_bp    / 10000.0 / 4.0;
  v_fat_g     := v_daily_calories * v_fat_bp     / 10000.0 / 9.0;

  v_daily_target := jsonb_build_object(
    'calories', round(v_daily_calories),
    'protein',  round(v_protein_g),
    'carbs',    round(v_carb_g),
    'fat',      round(v_fat_g)
  );

  if v_plan_id is null then
    insert into public.nutrition_plans (
      name, goal_type, status, description, coach_notes, hydration_tip,
      nutrition_model_version, daily_target
    ) values (
      coalesce(nullif(v_plan->>'name', ''), 'Plan sans nom'),
      coalesce(nullif(v_plan->>'goal_type', ''), 'maintien'),
      coalesce(nullif(v_plan->>'status', ''), 'prochain'),
      coalesce(v_plan->>'description', ''),
      coalesce(v_plan->>'coach_notes', ''),
      coalesce(v_plan->>'hydration_tip', ''),
      2,
      v_daily_target
    )
    returning id into v_plan_id;
  else
    select np.nutrition_model_version into v_previous_version
      from public.nutrition_plans np
     where np.id = v_plan_id
       for update;
    if not found then
      raise exception 'PLAN_NOT_FOUND_OR_FORBIDDEN';
    end if;

    -- Le modèle v1 n'existe plus depuis 20260811090000 : `converted` reste
    -- rendu pour ne pas casser les appelants, mais il vaut toujours false.
    v_converted := (v_previous_version is distinct from 2);

    update public.nutrition_plans np set
      name = coalesce(nullif(v_plan->>'name', ''), np.name),
      goal_type = coalesce(nullif(v_plan->>'goal_type', ''), np.goal_type),
      status = coalesce(nullif(v_plan->>'status', ''), np.status),
      description = coalesce(v_plan->>'description', np.description),
      coach_notes = coalesce(v_plan->>'coach_notes', np.coach_notes),
      hydration_tip = coalesce(v_plan->>'hydration_tip', np.hydration_tip),
      nutrition_model_version = 2,
      daily_target = v_daily_target,
      updated_at = now()
    where np.id = v_plan_id;
  end if;

  -- ── 5. Les profils et leurs créneaux ──────────────────────────────────
  -- Sautée quand la charge utile ne mentionne aucun profil : ils restent en
  -- l'état, exactement comme les jours et les repas non mentionnés.
  for v_profile in select * from jsonb_array_elements(v_profiles) where v_sync_profiles loop
    v_profile_key := coalesce(nullif(v_profile->>'profile_key', ''), 'default');

    insert into public.nutrition_plan_profiles (
      plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp
    ) values (
      v_plan_id,
      v_profile_key,
      coalesce((v_profile->>'daily_calories')::numeric, 0),
      coalesce((v_profile->>'protein_bp')::integer, 0),
      coalesce((v_profile->>'carb_bp')::integer, 0),
      coalesce((v_profile->>'fat_bp')::integer, 0)
    )
    on conflict (plan_id, profile_key) do update set
      daily_calories = excluded.daily_calories,
      protein_bp = excluded.protein_bp,
      carb_bp = excluded.carb_bp,
      fat_bp = excluded.fat_bp,
      updated_at = now()
    returning id into v_profile_id;

    for v_slot in select * from jsonb_array_elements(v_profile->'slots') loop
      insert into public.nutrition_meal_slot_targets (
        profile_id, slot, enabled, protein_bp, carb_bp, fat_bp, display_order
      ) values (
        v_profile_id,
        v_slot->>'slot',
        coalesce((v_slot->>'enabled')::boolean, true),
        coalesce((v_slot->>'protein_bp')::integer, 0),
        coalesce((v_slot->>'carb_bp')::integer, 0),
        coalesce((v_slot->>'fat_bp')::integer, 0),
        coalesce((v_slot->>'display_order')::integer, 0)
      )
      on conflict (profile_id, slot) do update set
        enabled = excluded.enabled,
        protein_bp = excluded.protein_bp,
        carb_bp = excluded.carb_bp,
        fat_bp = excluded.fat_bp,
        display_order = excluded.display_order,
        updated_at = now();
    end loop;

    delete from public.nutrition_meal_slot_targets t
     where t.profile_id = v_profile_id
       and not (t.slot = any(c_slots));
  end loop;

  -- ── 6. Les sept jours ─────────────────────────────────────────────────
  -- Ordre imposé par la clé étrangère composite : les profils existent déjà.
  if v_sync_days then
    for v_day in select * from jsonb_array_elements(v_days) loop
      v_day_key := coalesce(nullif(v_day->>'day', ''), v_day->>'weekday');
      v_profile_key := coalesce(nullif(v_day->>'profile_key', ''), v_main_profile_key);

      insert into public.nutrition_days (plan_id, day, status, target, profile_key)
      values (v_plan_id, v_day_key, 'non-commence', '{}'::jsonb, v_profile_key)
      on conflict (plan_id, day) do update set
        profile_key = excluded.profile_key,
        updated_at = now()
      returning id into v_day_id;

      -- ── 6b. Les repas prescrits de ce jour ────────────────────────────
      -- Clé `meals` absente = repas du jour NON touchés.
      if v_day ? 'meals' then
        v_meal_ids := array[]::uuid[];
        for v_meal in select * from jsonb_array_elements(v_day->'meals') loop
          if nullif(v_meal->>'id', '') is not null then
            v_meal_ids := array_append(v_meal_ids, (v_meal->>'id')::uuid);
          end if;
        end loop;

        -- Retrait des repas absents du payload, ce jour-là uniquement.
        delete from public.meals m
         where m.nutrition_day_id = v_day_id
           and not (m.id = any(v_meal_ids));

        for v_meal in select * from jsonb_array_elements(v_day->'meals') loop
          -- Les aliments acceptent les deux formes : une chaîne libre, ou un
          -- objet {name, quantity}. On normalise vers la forme objet, seule
          -- lue par l'application.
          v_items := '[]'::jsonb;
          for v_item in select * from jsonb_array_elements(coalesce(v_meal->'items', '[]'::jsonb)) loop
            if jsonb_typeof(v_item) = 'string' then
              v_items := v_items || jsonb_build_array(
                jsonb_build_object('name', v_item #>> '{}', 'quantity', '')
              );
            else
              v_items := v_items || jsonb_build_array(
                jsonb_build_object(
                  'name', coalesce(v_item->>'name', ''),
                  'quantity', coalesce(v_item->>'quantity', '')
                )
              );
            end if;
          end loop;

          -- N1.3 — l'identifiant est calculé AVANT l'insert au lieu d'être
          -- inséré à la volée : les occurrences en ont besoin juste après, et
          -- un `returning` ne rendrait rien quand le `where` du DO UPDATE
          -- écarte la ligne. Même valeur qu'avant, nommée une fois.
          v_meal_id := coalesce(nullif(v_meal->>'id', '')::uuid, gen_random_uuid());

          insert into public.meals (
            id, nutrition_day_id, slot, name, items, macros, coach_notes
          ) values (
            v_meal_id,
            v_day_id,
            v_meal->>'slot',
            coalesce(v_meal->>'name', ''),
            v_items,
            jsonb_build_object(
              'calories', coalesce((v_meal->>'calories')::numeric, 0),
              'protein',  coalesce((v_meal->>'protein')::numeric, 0),
              'carbs',    coalesce((v_meal->>'carbs')::numeric, 0),
              'fat',      coalesce((v_meal->>'fat')::numeric, 0)
            ),
            coalesce(v_meal->>'coach_notes', v_meal->>'coach_note', '')
          )
          on conflict (id) do update set
            slot = excluded.slot,
            name = excluded.name,
            items = excluded.items,
            macros = excluded.macros,
            coach_notes = excluded.coach_notes,
            updated_at = now()
          -- Barrière : un identifiant appartenant au jour d'un AUTRE plan
          -- n'est jamais réécrit.
          where meals.nutrition_day_id = v_day_id;

          -- ══════════════════════════════════════════════════════════════
          -- N1.3 — LES OCCURRENCES DE LISTES DE CE REPAS
          -- ══════════════════════════════════════════════════════════════
          -- ⚠️ CLÉ ABSENTE = RIEN N'EST TOUCHÉ. C'est la règle qui vaut déjà
          -- pour `meals` un cran plus haut, et c'est elle qui rend les
          -- charges utiles écrites avant N1.3 valides à l'octet près : un
          -- repas sans listes n'en reçoit jamais.
          if v_meal ? 'choice_slots' then
            v_occurrences := coalesce(v_meal->'choice_slots', '[]'::jsonb);
            if jsonb_typeof(v_occurrences) <> 'array' then
              raise exception 'INVALID_PAYLOAD: choice_slots doit être un tableau';
            end if;

            -- ── 1. UN IDENTIFIANT CITÉ APPARTIENT À CE REPAS, OU À RIEN ──
            -- ⚠️ SANS CETTE BARRIÈRE, LE `on conflict (id)` PLUS BAS SERAIT
            -- UNE PORTE. Envoyer dans le repas B l'identifiant d'une
            -- occurrence du repas A la DÉPLACERAIT vers B — le coach perdrait
            -- une occurrence d'un repas qu'il n'éditait pas, et le `where`
            -- du DO UPDATE se contenterait d'ignorer en silence.
            -- Un identifiant INCONNU reste accepté : c'est ainsi que le
            -- navigateur crée une occurrence dont il choisit l'UUID.
            v_occ_ids := array[]::uuid[];
            for v_occ in select * from jsonb_array_elements(v_occurrences) loop
              if nullif(v_occ->>'id', '') is not null then
                v_occ_id := (v_occ->>'id')::uuid;
                if exists (
                  select 1 from public.meal_choice_slots s
                   where s.id = v_occ_id and s.meal_id <> v_meal_id
                ) then
                  raise exception 'OCCURRENCE_HORS_REPAS: l''occurrence % appartient à un autre repas', v_occ_id
                    using errcode = '42501';
                end if;
                v_occ_ids := array_append(v_occ_ids, v_occ_id);
              end if;
            end loop;

            -- ── 2. Les occurrences absentes de la charge utile disparaissent.
            -- La cascade emporte leurs options. Un tableau vide retire donc
            -- toutes les occurrences du repas, ce qui est le sens attendu.
            delete from public.meal_choice_slots s
             where s.meal_id = v_meal_id
               and not (s.id = any(v_occ_ids));

            -- ── 3. Toutes les positions restantes partent au-dessus de 1000.
            -- ⚠️ `meal_choice_slots_position_unique` N'EST PAS DÉFERRABLE :
            -- réécrire 1..N pendant que 1..N sont encore occupées lève 23505
            -- dès la première permutation. Aucune position existante ne peut
            -- dépasser le nombre d'occurrences du repas : au-dessus de 1000,
            -- la place est libre.
            update public.meal_choice_slots
               set position = position + 1000
             where meal_id = v_meal_id;

            -- ── 4. Écriture, position DÉRIVÉE DE L'ORDRE DU TABLEAU ──────
            -- ⚠️ La position n'est JAMAIS lue dans la charge utile. Des
            -- positions trouées ou dupliquées ne sont donc pas une règle
            -- applicative à faire respecter : elles sont hors d'atteinte.
            v_occ_pos := 0;
            for v_occ in select * from jsonb_array_elements(v_occurrences) loop
              v_occ_pos := v_occ_pos + 1;

              v_occ_label := btrim(coalesce(v_occ->>'label', ''));
              if v_occ_label = '' then
                raise exception 'INVALID_PAYLOAD: choice_slots[].label vide (repas %)', v_meal_id;
              end if;

              v_options := coalesce(v_occ->'options', '[]'::jsonb);
              if jsonb_typeof(v_options) <> 'array' then
                raise exception 'INVALID_PAYLOAD: choice_slots[].options doit être un tableau';
              end if;
              -- ⚠️ UNE OCCURRENCE SANS OPTION REND LE REPAS NON PLANIFIABLE :
              -- `enregistrer_repas_planifie` exige exactement un choix par
              -- occurrence. On refuse ici plutôt que de laisser l'élève
              -- devant un créneau qu'aucune réponse ne peut satisfaire.
              if jsonb_array_length(v_options) = 0 then
                raise exception 'OCCURRENCE_SANS_OPTION: l''occurrence « % » n''a aucune option', v_occ_label
                  using errcode = '22023';
              end if;

              v_occ_id := coalesce(nullif(v_occ->>'id', '')::uuid, gen_random_uuid());

              insert into public.meal_choice_slots (id, meal_id, position, label, source_list_id)
              values (
                v_occ_id,
                v_meal_id,
                v_occ_pos,
                v_occ_label,
                nullif(v_occ->>'source_list_id', '')::uuid
              )
              on conflict (id) do update set
                position = excluded.position,
                label = excluded.label,
                source_list_id = excluded.source_list_id,
                updated_at = now()
              where meal_choice_slots.meal_id = v_meal_id;

              -- ── 5. LES OPTIONS : ON REMPLACE SANS TOUT DÉTRUIRE ────────
              -- ⚠️ SUPPRIMER PUIS RÉINSÉRER SERAIT PLUS COURT ET PLUS FAUX.
              -- `planned_meal_items` porte une clé étrangère composite vers
              -- `meal_choice_options (slot_id, catalog_food_id)` en
              -- `on delete cascade` : effacer une option efface le choix que
              -- l'élève avait déjà planifié. On ne retire donc QUE les
              -- options réellement absentes de la charge utile ; celles qui
              -- restent gardent leur ligne, et l'élève garde son choix.
              delete from public.meal_choice_options o
               where o.slot_id = v_occ_id
                 and not exists (
                   select 1 from jsonb_array_elements(v_options) x
                    where nullif(x->>'catalog_food_id', '')::uuid is not distinct from o.catalog_food_id
                      and nullif(x->>'product_id', '')::uuid is not distinct from o.product_id
                 );

              -- Même contrainte non déferrable, même parade, à l'échelle de
              -- l'occurrence cette fois.
              update public.meal_choice_options
                 set position = position + 1000
               where slot_id = v_occ_id;

              v_opt_pos := 0;
              for v_option in select * from jsonb_array_elements(v_options) loop
                v_opt_pos := v_opt_pos + 1;
                v_opt_food := nullif(v_option->>'catalog_food_id', '')::uuid;
                v_opt_product := nullif(v_option->>'product_id', '')::uuid;

                -- ── N1.5.1 : LA PORTION PRÉFÉRÉE EFFECTIVE, SNAPSHOTÉE ──────
                -- ⚠️ RÉSOLUE EN AMONT, PAS ICI. `override ?? standard ?? null`
                -- est décidé par la couche qui LIT la bibliothèque, au moment
                -- du clic ; la RPC ne relit ni `food_list_items`, ni
                -- `food_catalog`, ni `food_products` pour la recalculer. C'est
                -- la même règle que pour l'identité : ce qui arrive ici est
                -- déjà l'instantané.
                --
                -- ⚠️ ABSENTE = ABSENTE. Une charge utile d'avant N1.5.1 n'a
                -- aucune de ces deux clés : les deux colonnes restent nulles,
                -- et le solveur retombe sur le comportement N1.5 historique.
                v_opt_pref := nullif(v_option->>'preferred_quantity', '')::numeric;

                -- ── N1.5.2 : LA QUANTITÉ MINIMALE, SNAPSHOTÉE COMME LA PORTION ──
                -- ⚠️ RÉSOLUE EN AMONT, ELLE AUSSI. La RPC ne relit pas
                -- `food_list_items` pour la retrouver : ce qui arrive ici est
                -- déjà l'instantané.
                --
                -- ⚠️ ET C'EST UNE CONTRAINTE DURE, PAS UNE PRÉFÉRENCE. Le
                -- solveur ne descendra jamais en dessous ; il s'écarte
                -- librement d'une portion préférée, jamais d'un minimum.
                v_opt_min := nullif(v_option->>'minimum_quantity', '')::numeric;

                -- ⚠️ L'UNITÉ EST COMMUNE AUX DEUX QUANTITÉS (N1.5.2). La clé
                -- `preferred_unit` est encore acceptée pour qu'une charge utile
                -- écrite avant le renommage reste valide — elle n'a jamais eu
                -- d'autre sens que « l'unité de cette option ».
                v_opt_pref_unit := coalesce(
                  nullif(v_option->>'quantity_unit', ''),
                  nullif(v_option->>'preferred_unit', ''));

                -- Une quantité sans unité, ou l'inverse, n'a pas de sens : on
                -- refuse plutôt que d'en deviner une. La contrainte de paire le
                -- dirait aussi ; la lever ici NOMME la cause.
                -- ⚠️ L'UNITÉ EST EXIGÉE DÈS QU'UNE DES DEUX QUANTITÉS EXISTE.
                -- Une portion OU un minimum sans unité ne veut rien dire, et un
                -- minimum SEUL est le cas le plus courant : garantir 5 g de
                -- beurre sans avoir d'avis sur la portion.
                --
                -- ⚠️ DEUX MESSAGES, ET C'EST L'EXPAND APPLIQUÉ AUX ERREURS.
                -- `PORTION_SANS_UNITE` est le refus de N1.5.1 : il couvre
                -- exactement les deux formes qu'il couvrait déjà — une portion
                -- sans unité, et une unité sans AUCUNE quantité. Le renommer en
                -- `QUANTITE_SANS_UNITE` aurait cassé un message que du code
                -- déployé peut lire, pour un gain nul. Le cas NEUF — un minimum
                -- sans unité — reçoit donc un nom neuf, et lui seul.
                if (v_opt_pref is not null and v_opt_pref_unit is null)
                   or (v_opt_pref_unit is not null and v_opt_pref is null and v_opt_min is null) then
                  raise exception 'PORTION_SANS_UNITE: option % de l''occurrence « % »', v_opt_pos, v_occ_label
                    using errcode = '22023';
                end if;
                if v_opt_min is not null and v_opt_pref_unit is null then
                  raise exception 'MINIMUM_SANS_UNITE: option % de l''occurrence « % »', v_opt_pos, v_occ_label
                    using errcode = '22023';
                end if;
                if v_opt_min is not null and v_opt_min <= 0 then
                  raise exception 'MINIMUM_NON_POSITIF: option % de l''occurrence « % »', v_opt_pos, v_occ_label
                    using errcode = '22023';
                end if;
                if v_opt_pref is not null and v_opt_pref <= 0 then
                  raise exception 'PORTION_NON_POSITIVE: option % de l''occurrence « % »', v_opt_pos, v_occ_label
                    using errcode = '22023';
                end if;
                if v_opt_pref_unit is not null and v_opt_pref_unit not in ('g', 'ml') then
                  raise exception 'PORTION_UNITE_INCONNUE: option % de l''occurrence « % » (%)', v_opt_pos, v_occ_label, v_opt_pref_unit
                    using errcode = '22023';
                end if;

                -- EXACTEMENT UNE IDENTITÉ, et elle vient de la base. La
                -- contrainte `meal_choice_options_cible_unique` le dirait
                -- aussi ; la lever ici NOMME la cause.
                if (v_opt_food is null) = (v_opt_product is null) then
                  raise exception 'OPTION_SANS_IDENTITE: option % de l''occurrence « % »', v_opt_pos, v_occ_label
                    using errcode = '22023';
                end if;

                -- ⚠️ LA PORTION SUIT LA CHARGE UTILE, COMME LA POSITION.
                -- Un repas ré-enregistré sans y toucher renvoie la valeur DÉJÀ
                -- snapshotée — le lecteur la lui a donnée — donc rien ne bouge.
                -- Une liste REMPLACÉE renvoie la nouvelle valeur, et c'est un
                -- geste délibéré du coach. Modifier la bibliothèque sans
                -- toucher au repas ne passe jamais par ici : c'est ce qui rend
                -- l'instantané insensible à la bibliothèque.
                update public.meal_choice_options o
                   set position = v_opt_pos,
                       preferred_quantity = v_opt_pref,
                       minimum_quantity = v_opt_min,
                       quantity_unit = v_opt_pref_unit,
                       preferred_unit = case when v_opt_pref is not null then v_opt_pref_unit end
                 where o.slot_id = v_occ_id
                   and o.catalog_food_id is not distinct from v_opt_food
                   and o.product_id is not distinct from v_opt_product;

                if not found then
                  insert into public.meal_choice_options (
                    slot_id, position, catalog_food_id, product_id,
                    preferred_quantity, minimum_quantity, quantity_unit, preferred_unit)
                  values (v_occ_id, v_opt_pos, v_opt_food, v_opt_product,
                          v_opt_pref, v_opt_min, v_opt_pref_unit,
                          -- ⚠️ DOUBLE ÉCRITURE DE TRANSITION. Tant qu'une
                          -- portion est présente, l'ancienne colonne reçoit la
                          -- MÊME unité : le code déployé continue de lire des
                          -- snapshots créés pendant le rollout. Un minimum
                          -- seul laisse `preferred_unit` nulle — l'ancien code
                          -- ignore alors le minimum, ce qui est acceptable le
                          -- temps du déploiement.
                          case when v_opt_pref is not null then v_opt_pref_unit end);
                end if;
              end loop;
            end loop;
          end if;
        end loop;

        -- Le `where` ci-dessus IGNORE au lieu de lever : on vérifie donc que
        -- tous les identifiants cités appartiennent bien à ce jour.
        if exists (
          select 1 from unnest(v_meal_ids) as mid
           where not exists (
             select 1 from public.meals m
              where m.id = mid and m.nutrition_day_id = v_day_id
           )
        ) then
          raise exception 'MEAL_FROM_ANOTHER_DAY: un repas cité appartient à un autre jour (jour %)', v_day_key
            using errcode = '42501';
        end if;
      end if;
    end loop;
  end if;

  -- ── 7. Complétion à sept jours ────────────────────────────────────────
  -- Un plan v2 a TOUJOURS sept jours. Les jours manquants sont créés sur le
  -- profil principal, sans repas.
  foreach v_day_key in array c_days loop
    insert into public.nutrition_days (plan_id, day, status, target, profile_key)
    select v_plan_id, v_day_key, 'non-commence', '{}'::jsonb, v_main_profile_key
     where not exists (
       select 1 from public.nutrition_days d
        where d.plan_id = v_plan_id and d.day = v_day_key
     );
  end loop;

  -- ── 8. Profils retirés du payload ─────────────────────────────────────
  -- Refus explicite si un jour les utilise encore : la clé étrangère
  -- composite lèverait de toute façon, mais avec un message illisible.
  select d.profile_key into v_orphelin
    from public.nutrition_days d
   where d.plan_id = v_plan_id
     and not (d.profile_key = any(v_seen_profiles))
   limit 1;
  if v_orphelin is not null then
    raise exception 'PROFILE_STILL_IN_USE: le profil % est retiré du payload mais reste affecté à un jour', v_orphelin;
  end if;

  if v_sync_profiles then
    delete from public.nutrition_plan_profiles pr
     where pr.plan_id = v_plan_id
       and not (pr.profile_key = any(v_seen_profiles));
  end if;

  -- ── 9. Cibles dérivées : par jour, puis hebdomadaire ──────────────────
  -- `nutrition_days.target` est une DÉRIVÉE du profil du jour, tenue à jour
  -- pour les lectures existantes. La source de vérité reste le profil.
  update public.nutrition_days d set
    target = jsonb_build_object(
      'calories', round(pr.daily_calories),
      'protein',  round(pr.daily_calories * pr.protein_bp / 10000.0 / 4.0),
      'carbs',    round(pr.daily_calories * pr.carb_bp    / 10000.0 / 4.0),
      'fat',      round(pr.daily_calories * pr.fat_bp     / 10000.0 / 9.0)
    ),
    updated_at = now()
    from public.nutrition_plan_profiles pr
   where d.plan_id = v_plan_id
     and pr.plan_id = d.plan_id
     and pr.profile_key = d.profile_key;

  -- Somme réelle des sept jours — jamais `daily_calories × 7`, qui serait
  -- faux dès que deux jours utilisent deux profils différents.
  select sum(pr.daily_calories) into v_weekly_target
    from public.nutrition_days d
    join public.nutrition_plan_profiles pr
      on pr.plan_id = d.plan_id and pr.profile_key = d.profile_key
   where d.plan_id = v_plan_id;

  update public.nutrition_plans np
     set weekly_target_calories = case when v_daily_calories_raw is null and v_weekly_target = 0
                                       then null else v_weekly_target end,
         updated_at = now()
   where np.id = v_plan_id;

  -- ── 10. Retour CANONIQUE, recomposé depuis la base ────────────────────
  select * into v_plan_row from public.nutrition_plans where id = v_plan_id;

  select pr.id into v_profile_id
    from public.nutrition_plan_profiles pr
   where pr.plan_id = v_plan_id and pr.profile_key = v_main_profile_key;

  select to_jsonb(pr) into v_result_profile
    from public.nutrition_plan_profiles pr
   where pr.id = v_profile_id;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.display_order, t.slot), '[]'::jsonb)
    into v_result_slots
    from public.nutrition_meal_slot_targets t
   where t.profile_id = v_profile_id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'slot', t.slot,
               'enabled', t.enabled,
               'protein_grams', round(v_protein_g * t.protein_bp / 10000.0, 3),
               'carb_grams',    round(v_carb_g    * t.carb_bp    / 10000.0, 3),
               'fat_grams',     round(v_fat_g     * t.fat_bp     / 10000.0, 3)
             )
             order by t.display_order, t.slot
           ),
           '[]'::jsonb
         )
    into v_derived_slots
    from public.nutrition_meal_slot_targets t
   where t.profile_id = v_profile_id;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'profile_key', pr.profile_key,
             'daily_calories', pr.daily_calories,
             'protein_bp', pr.protein_bp,
             'carb_bp', pr.carb_bp,
             'fat_bp', pr.fat_bp,
             'slots', (
               select coalesce(jsonb_agg(to_jsonb(t) order by t.display_order, t.slot), '[]'::jsonb)
                 from public.nutrition_meal_slot_targets t where t.profile_id = pr.id
             )
           ) order by pr.profile_key
         ), '[]'::jsonb)
    into v_result_profiles
    from public.nutrition_plan_profiles pr
   where pr.plan_id = v_plan_id;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'day', d.day,
             'profile_key', d.profile_key,
             'target', d.target,
             'meal_count', (select count(*) from public.meals m where m.nutrition_day_id = d.id)
           ) order by array_position(c_days, d.day)
         ), '[]'::jsonb)
    into v_result_days
    from public.nutrition_days d
   where d.plan_id = v_plan_id;

  return jsonb_build_object(
    'plan', jsonb_build_object(
      'id', v_plan_row.id,
      'name', v_plan_row.name,
      'status', v_plan_row.status,
      'goal_type', v_plan_row.goal_type,
      'nutrition_model_version', v_plan_row.nutrition_model_version,
      'weekly_target_calories', v_plan_row.weekly_target_calories,
      'updated_at', v_plan_row.updated_at,
      'converted', v_converted
    ),
    'profile', v_result_profile,
    'slots', v_result_slots,
    'profiles', v_result_profiles,
    'days', v_result_days,
    'main_profile_key', v_main_profile_key,
    'derived', jsonb_build_object(
      'protein_grams', round(v_protein_g, 3),
      'carb_grams', round(v_carb_g, 3),
      'fat_grams', round(v_fat_g, 3),
      'slots', v_derived_slots
    ),
    'daily_target', v_plan_row.daily_target
  );
end;
$function$;


comment on function public.save_nutrition_plan_v2(jsonb) is
  'Sauvegarde ATOMIQUE d''un plan nutrition v2 COMPLET : plan, N profils, six créneaux par profil, sept jours rattachés à un profil, repas prescrits, les occurrences de listes avec leurs options snapshotées (N1.3), la portion préférée effective de chaque option (N1.5.1) et — N1.5.2 — sa quantité minimale, figées ensemble avec une unité commune. Une clé absente ne touche à rien : `choice_slots` omise laisse les occurrences intactes, `preferred_quantity` ou `minimum_quantity` omises laissent la colonne nulle. `preferred_unit` reste acceptée comme alias d''entrée de `quantity_unit`, et reste ÉCRITE tant qu''une portion existe : stratégie expand → deploy → contract, le code déployé lit encore l''ancienne colonne. Refus explicites : OCCURRENCE_HORS_REPAS, OCCURRENCE_SANS_OPTION, OPTION_SANS_IDENTITE, PORTION_SANS_UNITE (refus de N1.5.1, inchangé), MINIMUM_SANS_UNITE (le cas neuf, et lui seul), PORTION_NON_POSITIVE, MINIMUM_NON_POSITIF, PORTION_UNITE_INCONNUE. La RPC ne RÉSOUT jamais la hiérarchie override/standard ni le minimum : elle reçoit des valeurs déjà résolues, et ne lit ni food_lists, ni food_list_items, ni food_catalog, ni food_products. Elle ne code AUCUN plafond : la cohérence minimum ≤ plafond est gardée en TypeScript. security invoker, search_path vide, garde is_coach_or_admin, EXECUTE réservé à authenticated. N''accepte aucune quantité calculée par le solveur, aucune macro, aucun rôle.';

comment on column public.meal_choice_options.preferred_unit is
  'LEGACY, EN SURSIS. Colonne de N1.5.1 conservée par N1.5.2 le temps du rollout : le code déployé la lit encore, et la supprimer ouvrirait une fenêtre où l''ancienne ou la nouvelle version casse. La RPC continue de l''écrire tant qu''une portion préférée existe, avec la MÊME valeur que quantity_unit (contrainte meal_choice_options_unite_legacy_coherente). Elle sera supprimée par une migration CONTRACT distincte, après déploiement et validation terrain — jamais avant.';
