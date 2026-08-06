-- ============================================================================
-- Migration 20260812090000 — `save_nutrition_plan_v2` devient l'unique chemin
-- de sauvegarde d'un plan COMPLET : plan, profils, créneaux, sept jours et
-- repas prescrits (chantier feat/student-nutrition-recipes, PR C — lot 3/4).
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUI CHANGE
-- ────────────────────────────────────────────────────────────────────────────
-- La version 20260805090000 écrivait le plan, UN profil et ses six créneaux.
-- Elle ne touchait ni `nutrition_days` ni `meals` — d'où le symptôme visible
-- côté élève : « Semaine alimentaire » suivie de « Aucun jour planifié ».
--
-- Cette version écrit, dans la MÊME transaction :
--   1. `nutrition_plans` ;
--   2. `nutrition_plan_profiles` — N profils, plus un seul ;
--   3. `nutrition_meal_slot_targets` — six créneaux par profil ;
--   4. `nutrition_days` — exactement sept, chacun rattaché à un profil ;
--   5. `meals` — les repas prescrits manuellement par le coach.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CONTRAT DE CHARGE UTILE
-- ────────────────────────────────────────────────────────────────────────────
-- Même doctrine que `save_nutrition_recipe` (20260809090000) : **une clé
-- absente ne touche à rien**, une clé présente fait autorité.
--
--   {
--     "plan_id": uuid | null,
--     "plan":     { name, goal_type, status, description, coach_notes,
--                   hydration_tip },
--     "profiles": [ { profile_key, daily_calories, protein_bp, carb_bp,
--                     fat_bp, slots: [ {slot, enabled, protein_bp, carb_bp,
--                     fat_bp, display_order} × 6 ] } ],
--     "days":     [ { day, profile_key,
--                     meals: [ {id?, slot, name, items, calories, protein,
--                               carbs, fat, coach_notes} ] } ],
--     "main_profile_key": text | null
--   }
--
-- COMPATIBILITÉ ASCENDANTE : si `profiles` est absent, la fonction reconstruit
-- un tableau d'un seul élément depuis `profile` + `slots`, la forme écrite par
-- `buildSaveNutritionPlanV2Payload`. Les appelants existants et leurs tests
-- continuent donc de fonctionner sans modification.
--
-- ────────────────────────────────────────────────────────────────────────────
-- OBJECTIF HEBDOMADAIRE
-- ────────────────────────────────────────────────────────────────────────────
-- `weekly_target_calories` n'est PLUS `daily_calories × 7`. C'est la somme,
-- sur les sept jours, des calories du profil affecté à chaque jour — la seule
-- valeur juste dès que deux jours utilisent deux profils différents.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - aucune modification de schéma ;
--   - aucune seconde RPC concurrente : `save_nutrition_plan_v2` reste seule ;
--   - aucune écriture de quantité calculée par le solveur — la charge utile
--     n'a aucun champ où en loger, la liste de colonnes étant explicite ;
--   - aucune suppression de profil encore utilisé par un jour : la clé
--     étrangère composite le refuserait, et la fonction le dit avant.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

create or replace function public.save_nutrition_plan_v2(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
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

          insert into public.meals (
            id, nutrition_day_id, slot, name, items, macros, coach_notes
          ) values (
            coalesce(nullif(v_meal->>'id', '')::uuid, gen_random_uuid()),
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
$fn$;

alter function public.save_nutrition_plan_v2(jsonb) owner to postgres;

comment on function public.save_nutrition_plan_v2(jsonb) is
  'Sauvegarde ATOMIQUE d''un plan nutrition v2 COMPLET : plan, N profils, six créneaux par profil, sept jours rattachés à un profil et repas prescrits, dans UNE transaction. Une clé absente de la charge utile ne touche à rien ; `profiles` accepte aussi la forme historique `profile` + `slots`. weekly_target_calories est la SOMME des calories des sept jours, jamais daily_calories × 7. security invoker, search_path vide, garde is_coach_or_admin, EXECUTE réservé à authenticated. N''accepte aucune quantité calculée par le solveur.';

revoke all on function public.save_nutrition_plan_v2(jsonb) from public;
revoke execute on function public.save_nutrition_plan_v2(jsonb) from anon;
grant execute on function public.save_nutrition_plan_v2(jsonb) to authenticated;
