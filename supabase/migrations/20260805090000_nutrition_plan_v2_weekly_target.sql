-- ============================================================================
-- Migration 20260805090000 — save_nutrition_plan_v2 : persistance de
-- `weekly_target_calories` (chantier feat/nutrition-plan-v2-builder, PR 2).
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
-- La version 20260804090000 de la RPC n'écrivait pas
-- `nutrition_plans.weekly_target_calories` : tout plan v2 restait donc à NULL
-- sur cette colonne. Or elle n'est pas décorative — elle porte le budget
-- hebdomadaire de l'élève (lib/nutrition.ts) et l'ajustement calorique sur
-- les jours restants (lib/nutrition-weekly.ts). Un repli de LECTURE côté
-- TypeScript avait d'abord été posé ; il masquait un état incohérent en base
-- au lieu de le corriger. La base redevient ici la source de vérité.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE FAIT CETTE MIGRATION
-- ────────────────────────────────────────────────────────────────────────────
--   - elle RECRÉE `public.save_nutrition_plan_v2(p_payload jsonb)` — et RIEN
--     d'autre. Aucune table, aucune colonne, aucune policy, aucun privilège ;
--   - à la CRÉATION comme à la MODIFICATION d'un plan v2, elle enregistre
--     atomiquement `weekly_target_calories = daily_calories * 7`, dans la
--     même transaction que le plan, le profil et les six créneaux.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - AUCUNE migration déjà appliquée n'est modifiée ;
--   - AUCUN plan v1 n'est touché : la fonction ne s'exécute que lorsqu'un
--     coach enregistre un plan par le chemin v2 ;
--   - AUCUN backfill des plans v2 déjà écrits — il n'en existe aucun en
--     Production (0 plan en nutrition_model_version = 2 au moment de cette
--     PR). Le premier enregistrement d'un plan renseignera sa colonne ;
--   - AUCUNE valeur inventée : si le payload ne porte pas `daily_calories`,
--     `weekly_target_calories` reste NULL.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUI EST CONSERVÉ À L'IDENTIQUE
-- ────────────────────────────────────────────────────────────────────────────
-- Signature `(p_payload jsonb) returns jsonb` · `security invoker` ·
-- propriétaire · `set search_path = ''` · relations qualifiées `public.*` ·
-- garde `is_coach_or_admin()` · validations de structure · retour canonique ·
-- création du profil `default` et des six créneaux · idempotence des upserts ·
-- compatibilité v1 · privilèges (revoke public/anon, grant authenticated).
--
-- Le corps est celui de la migration 20260804090000, à l'identique hors les
-- quatre ajouts ci-dessus (déclarations, dérivation, INSERT, UPDATE).
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

  v_plan jsonb;
  v_profile jsonb;
  v_slots jsonb;
  v_slot jsonb;
  v_slot_key text;
  v_seen text[] := array[]::text[];

  v_plan_id uuid;
  v_profile_id uuid;
  v_profile_key text;
  v_previous_version integer;
  v_converted boolean := false;

  v_daily_calories numeric;
  -- Valeur BRUTE du payload : `null` si la clé est absente ou nulle. Sert
  -- uniquement à distinguer « pas de calories » de « zéro calorie ».
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
begin
  -- ── 0. Authentification : coach/admin uniquement ──────────────────────
  if not public.is_coach_or_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- ── 1. Enveloppe ──────────────────────────────────────────────────────
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_PAYLOAD: objet JSON attendu';
  end if;

  v_plan := coalesce(p_payload->'plan', '{}'::jsonb);
  v_profile := p_payload->'profile';
  v_slots := p_payload->'slots';

  if v_profile is null or jsonb_typeof(v_profile) <> 'object' then
    raise exception 'INVALID_PAYLOAD: profile manquant';
  end if;
  if v_slots is null or jsonb_typeof(v_slots) <> 'array' then
    raise exception 'INVALID_PAYLOAD: slots doit être un tableau';
  end if;
  if jsonb_array_length(v_slots) <> array_length(c_slots, 1) then
    raise exception 'INVALID_PAYLOAD: les six créneaux sont obligatoires (reçu %)', jsonb_array_length(v_slots);
  end if;

  v_profile_key := coalesce(nullif(v_profile->>'profile_key', ''), 'default');
  if v_profile_key !~ '^[a-z][a-z0-9_]{0,31}$' then
    raise exception 'INVALID_PROFILE_KEY: %', v_profile_key;
  end if;

  -- Structure des créneaux : noms connus, aucun doublon.
  for v_slot in select * from jsonb_array_elements(v_slots) loop
    v_slot_key := v_slot->>'slot';
    if v_slot_key is null or not (v_slot_key = any(c_slots)) then
      raise exception 'INVALID_SLOT: %', coalesce(v_slot_key, '(null)');
    end if;
    if v_slot_key = any(v_seen) then
      raise exception 'DUPLICATE_SLOT: %', v_slot_key;
    end if;
    v_seen := array_append(v_seen, v_slot_key);
  end loop;

  v_daily_calories_raw := (v_profile->>'daily_calories')::numeric;
  v_daily_calories := coalesce(v_daily_calories_raw, 0);
  -- OBJECTIF HEBDOMADAIRE, dérivé du quotidien et PERSISTÉ (migration
  -- 20260805090000). `null` tant que le payload ne porte pas de calories :
  -- on n'invente aucune valeur pour un brouillon vide.
  v_weekly_target := case when v_daily_calories_raw is null then null
                          else v_daily_calories_raw * 7 end;
  v_protein_bp := coalesce((v_profile->>'protein_bp')::integer, 0);
  v_carb_bp := coalesce((v_profile->>'carb_bp')::integer, 0);
  v_fat_bp := coalesce((v_profile->>'fat_bp')::integer, 0);

  -- ── 2. daily_target DE COMPATIBILITÉ, dérivé du profil ────────────────
  -- Format exact attendu par le code actuel (lib/supabase/nutrition.ts,
  -- mapNutritionPlanRow) : { calories, protein, carbs, fat }, en nombres.
  v_protein_g := v_daily_calories * v_protein_bp / 10000.0 / 4.0;
  v_carb_g    := v_daily_calories * v_carb_bp    / 10000.0 / 4.0;
  v_fat_g     := v_daily_calories * v_fat_bp     / 10000.0 / 9.0;

  v_daily_target := jsonb_build_object(
    'calories', round(v_daily_calories),
    'protein',  round(v_protein_g),
    'carbs',    round(v_carb_g),
    'fat',      round(v_fat_g)
  );

  -- ── 3. Le plan : création, ou mise à jour VERROUILLÉE ─────────────────
  v_plan_id := nullif(p_payload->>'plan_id', '')::uuid;

  if v_plan_id is null then
    insert into public.nutrition_plans (
      name, goal_type, status, description, coach_notes, hydration_tip,
      nutrition_model_version, daily_target, weekly_target_calories
    ) values (
      coalesce(nullif(v_plan->>'name', ''), 'Plan sans nom'),
      coalesce(nullif(v_plan->>'goal_type', ''), 'maintien'),
      coalesce(nullif(v_plan->>'status', ''), 'prochain'),
      coalesce(v_plan->>'description', ''),
      coalesce(v_plan->>'coach_notes', ''),
      coalesce(v_plan->>'hydration_tip', ''),
      2,
      v_daily_target,
      v_weekly_target
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

    -- Conversion v1 → v2 : EXPLICITE, et seulement par ce chemin.
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
      weekly_target_calories = v_weekly_target,
      updated_at = now()
    where np.id = v_plan_id;
  end if;

  -- ── 4. Le profil ──────────────────────────────────────────────────────
  insert into public.nutrition_plan_profiles (
    plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp
  ) values (
    v_plan_id, v_profile_key, v_daily_calories, v_protein_bp, v_carb_bp, v_fat_bp
  )
  on conflict (plan_id, profile_key) do update set
    daily_calories = excluded.daily_calories,
    protein_bp = excluded.protein_bp,
    carb_bp = excluded.carb_bp,
    fat_bp = excluded.fat_bp,
    updated_at = now()
  returning id into v_profile_id;

  -- ── 5. Les six créneaux ───────────────────────────────────────────────
  -- Écrits UN PAR UN, dans l'ordre du payload. Les bornes 0-10 000 sont
  -- vérifiées ici par les CHECK de la table : un créneau hors borne fait
  -- échouer cet INSERT, APRÈS les écritures ci-dessus, et annule tout.
  for v_slot in select * from jsonb_array_elements(v_slots) loop
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

  -- Créneaux surnuméraires d'un enregistrement antérieur (aucun aujourd'hui,
  -- les six étant obligatoires — filet de sécurité si le jeu évolue).
  delete from public.nutrition_meal_slot_targets t
   where t.profile_id = v_profile_id
     and not (t.slot = any(v_seen));

  -- ── 6. Retour CANONIQUE, recomposé depuis la base ─────────────────────
  select * into v_plan_row from public.nutrition_plans where id = v_plan_id;

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

  return jsonb_build_object(
    'plan', jsonb_build_object(
      'id', v_plan_row.id,
      'name', v_plan_row.name,
      'status', v_plan_row.status,
      'goal_type', v_plan_row.goal_type,
      'nutrition_model_version', v_plan_row.nutrition_model_version,
      'updated_at', v_plan_row.updated_at,
      'converted', v_converted
    ),
    'profile', v_result_profile,
    'slots', v_result_slots,
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

comment on function public.save_nutrition_plan_v2(jsonb) is
  'Sauvegarde ATOMIQUE d''un plan nutrition v2 : plan, profil « default », six créneaux, daily_target ET weekly_target_calories écrits dans UNE transaction. security invoker, search_path vide, garde is_coach_or_admin, relations qualifiées public.*, EXECUTE réservé à authenticated. Voir l''en-tête des migrations 20260804090000 (contrat initial) et 20260805090000 (objectif hebdomadaire).';

-- ── Droits d'exécution : inchangés, réaffirmés explicitement ────────────────
-- `create or replace` conserve les privilèges existants ; on les réaffirme
-- pour que la migration soit auto-suffisante si elle est rejouée sur un
-- environnement neuf.
revoke all on function public.save_nutrition_plan_v2(jsonb) from public;
revoke execute on function public.save_nutrition_plan_v2(jsonb) from anon;
grant execute on function public.save_nutrition_plan_v2(jsonb) to authenticated;
