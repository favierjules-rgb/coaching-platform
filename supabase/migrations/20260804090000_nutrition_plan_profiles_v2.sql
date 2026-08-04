-- ============================================================================
-- Migration 20260804090000 — Répartition nutritionnelle STRUCTURÉE (modèle v2)
-- (chantier feat/nutrition-adaptive-recipes, PR 1).
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI CE MODÈLE
-- ────────────────────────────────────────────────────────────────────────────
-- Le schéma réel montre que `nutrition_days` porte le SUIVI HEBDOMADAIRE de
-- l'élève (une ligne par jour de semaine), pas des « journées types » avec des
-- objectifs distincts : `nutrition_days.target` n'est aujourd'hui jamais
-- alimenté, et la seule cible quotidienne réellement utilisée vit dans
-- `nutrition_plans.daily_target`. Un plan n'a donc, à ce jour, QU'UNE cible
-- quotidienne.
--
-- Le nouveau modèle doit néanmoins prévoir plusieurs profils futurs (jour
-- d'entraînement / jour de repos) SANS imposer une restructuration
-- ultérieure. D'où l'introduction d'une table de PROFILS portant une clé
-- (`profile_key`) : aujourd'hui un plan v2 possède exactement un profil
-- `default` ; demain, ajouter `training` ou `rest` sera une simple ligne
-- supplémentaire, sans migration de structure.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POINTS DE BASE — pourquoi des entiers
-- ────────────────────────────────────────────────────────────────────────────
-- Tous les pourcentages sont stockés en POINTS DE BASE ENTIERS :
--   100 % = 10 000   50 % = 5 000   33,33 % = 3 333
-- Une répartition « complète » se teste alors par une égalité ENTIÈRE
-- (`= 10000`). Aucune comparaison flottante de type `= 100` n'existe, ni ici
-- ni côté TypeScript (lib/nutrition/basis-points.ts).
--
-- ────────────────────────────────────────────────────────────────────────────
-- SOURCES DE VÉRITÉ (plan v2)
-- ────────────────────────────────────────────────────────────────────────────
--   - calories quotidiennes structurées ....... source de vérité
--   - pourcentages P/G/L ...................... source de vérité
--   - pourcentages par créneau ................ source de vérité
--   - grammes et calories des repas ........... DÉRIVÉS
--   - nutrition_plans.daily_target ............ DÉRIVÉ, régénéré par la RPC
--     dans la MÊME transaction, au seul titre de la compatibilité avec le
--     suivi nutritionnel existant. Ce JSONB n'est JAMAIS une seconde source
--     éditable.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - AUCUNE ancienne migration n'est modifiée ;
--   - AUCUN backfill : `nutrition_model_version` a pour DEFAULT 1, donc TOUS
--     les plans existants restent en v1, lisibles et assignables exactement
--     comme aujourd'hui, sans répartition inventée ;
--   - AUCUNE table de recettes (`recipes`, `recipe_ingredients`,
--     `recipe_steps`, `recipe_meal_slots`, `recipe_substitutions`) : elles
--     appartiennent à la PR 3 ;
--   - AUCUNE policy ni AUCUN privilège existants ne sont supprimés,
--     remplacés ou restreints : tout ce qui est créé ici l'est sur des objets
--     NOUVEAUX, à la seule exception de l'ajout de colonne (additif).
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ── 1. Version du modèle sur le plan ────────────────────────────────────────
-- Additif et rejouable. DEFAULT 1 : chaque plan déjà en base reste v1.

alter table public.nutrition_plans
  add column if not exists nutrition_model_version integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'nutrition_plans_model_version_check'
       and conrelid = 'public.nutrition_plans'::regclass
  ) then
    alter table public.nutrition_plans
      add constraint nutrition_plans_model_version_check
      check (nutrition_model_version in (1, 2));
  end if;
end $$;

comment on column public.nutrition_plans.nutrition_model_version is
  'Version du modèle nutritionnel du plan. 1 = format historique (daily_target saisi directement par l''éditeur v1). 2 = répartition structurée : profils + créneaux en points de base, daily_target DÉRIVÉ et régénéré par save_nutrition_plan_v2. DEFAULT 1, aucun backfill : tout plan antérieur au chantier feat/nutrition-adaptive-recipes reste en v1.';

-- ── 2. Profils de répartition ───────────────────────────────────────────────

create table if not exists public.nutrition_plan_profiles (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.nutrition_plans (id) on delete cascade,
  profile_key text not null default 'default',
  daily_calories numeric not null default 0,
  protein_bp integer not null default 0,
  carb_bp integer not null default 0,
  fat_bp integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nutrition_plan_profiles_key_unique unique (plan_id, profile_key),
  constraint nutrition_plan_profiles_key_format
    check (profile_key ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint nutrition_plan_profiles_calories_range
    check (daily_calories >= 0 and daily_calories <= 10000),
  constraint nutrition_plan_profiles_protein_bp_range
    check (protein_bp >= 0 and protein_bp <= 10000),
  constraint nutrition_plan_profiles_carb_bp_range
    check (carb_bp >= 0 and carb_bp <= 10000),
  constraint nutrition_plan_profiles_fat_bp_range
    check (fat_bp >= 0 and fat_bp <= 10000)
);

create index if not exists nutrition_plan_profiles_plan_id_idx
  on public.nutrition_plan_profiles (plan_id);

comment on table public.nutrition_plan_profiles is
  'Profil de répartition d''un plan nutrition v2. Aujourd''hui un plan v2 possède EXACTEMENT un profil « default » ; profile_key permet d''ajouter « training » / « rest » plus tard sans restructurer. daily_calories et les parts P/G/L sont les SOURCES DE VÉRITÉ du plan ; les grammes en sont dérivés.';
comment on column public.nutrition_plan_profiles.profile_key is
  'Clé du profil. « default » aujourd''hui. Format contraint : minuscules, chiffres et souligné, 32 caractères au plus.';
comment on column public.nutrition_plan_profiles.protein_bp is
  'Part des protéines dans les calories quotidiennes, en POINTS DE BASE entiers (10 000 = 100 %). Jamais un pourcentage flottant.';

-- ── 3. Cibles par créneau de repas ──────────────────────────────────────────

create table if not exists public.nutrition_meal_slot_targets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.nutrition_plan_profiles (id) on delete cascade,
  slot text not null,
  enabled boolean not null default true,
  protein_bp integer not null default 0,
  carb_bp integer not null default 0,
  fat_bp integer not null default 0,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nutrition_meal_slot_targets_profile_slot_unique unique (profile_id, slot),
  constraint nutrition_meal_slot_targets_slot_check
    check (slot in ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'dessert')),
  constraint nutrition_meal_slot_targets_protein_bp_range
    check (protein_bp >= 0 and protein_bp <= 10000),
  constraint nutrition_meal_slot_targets_carb_bp_range
    check (carb_bp >= 0 and carb_bp <= 10000),
  constraint nutrition_meal_slot_targets_fat_bp_range
    check (fat_bp >= 0 and fat_bp <= 10000),
  constraint nutrition_meal_slot_targets_display_order_range
    check (display_order >= 0 and display_order <= 999)
);

create index if not exists nutrition_meal_slot_targets_profile_id_idx
  on public.nutrition_meal_slot_targets (profile_id);

comment on table public.nutrition_meal_slot_targets is
  'Part de chaque créneau de repas dans un profil v2, macro par macro, en POINTS DE BASE entiers. Un créneau désactivé doit porter des parts nulles ; la somme des créneaux ACTIFS doit valoir 10 000 par macro pour qu''un plan soit assignable (contrôle applicatif : lib/nutrition/plan-v2-validation.ts).';
comment on column public.nutrition_meal_slot_targets.enabled is
  'Créneau proposé à l''élève. Un créneau désactivé n''est pas supprimé : sa ligne reste, à zéro, pour préserver son display_order.';

-- ── 4. updated_at automatique (fonction déjà présente au baseline) ──────────

do $$
begin
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    execute 'drop trigger if exists set_updated_at on public.nutrition_plan_profiles';
    execute 'create trigger set_updated_at before update on public.nutrition_plan_profiles
               for each row execute function public.set_updated_at()';
    execute 'drop trigger if exists set_updated_at on public.nutrition_meal_slot_targets';
    execute 'create trigger set_updated_at before update on public.nutrition_meal_slot_targets
               for each row execute function public.set_updated_at()';
  end if;
end $$;

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
-- Même doctrine que nutrition_plans / nutrition_days / meals :
--   - le staff (coach/admin) gère tout ;
--   - l'élève LIT uniquement ce qui dépend du plan qui lui est assigné
--     (nutrition_plans.student_id — source de vérité de l'assignation
--     nutrition, PAS la table `assignments`) ;
--   - l'élève n'écrit JAMAIS un profil ni un créneau ;
--   - anon n'a aucune policy, donc ne lit rien.

alter table public.nutrition_plan_profiles enable row level security;
alter table public.nutrition_meal_slot_targets enable row level security;

drop policy if exists "nutrition_plan_profiles_manage_staff" on public.nutrition_plan_profiles;
create policy "nutrition_plan_profiles_manage_staff" on public.nutrition_plan_profiles
  for all
  using (public.is_coach_or_admin())
  with check (public.is_coach_or_admin());

drop policy if exists "nutrition_plan_profiles_select_assigned" on public.nutrition_plan_profiles;
create policy "nutrition_plan_profiles_select_assigned" on public.nutrition_plan_profiles
  for select
  using (
    exists (
      select 1 from public.nutrition_plans p
       where p.id = nutrition_plan_profiles.plan_id
         and p.student_id = public.current_student_id()
    )
  );

drop policy if exists "nutrition_meal_slot_targets_manage_staff" on public.nutrition_meal_slot_targets;
create policy "nutrition_meal_slot_targets_manage_staff" on public.nutrition_meal_slot_targets
  for all
  using (public.is_coach_or_admin())
  with check (public.is_coach_or_admin());

drop policy if exists "nutrition_meal_slot_targets_select_assigned" on public.nutrition_meal_slot_targets;
create policy "nutrition_meal_slot_targets_select_assigned" on public.nutrition_meal_slot_targets
  for select
  using (
    exists (
      select 1
        from public.nutrition_plan_profiles pr
        join public.nutrition_plans p on p.id = pr.plan_id
       where pr.id = nutrition_meal_slot_targets.profile_id
         and p.student_id = public.current_student_id()
    )
  );

-- ── 6. Privilèges — le strict nécessaire ────────────────────────────────────
-- Supabase accorde par défaut les tables du schéma public à anon,
-- authenticated et service_role. anon n'a aucune raison de toucher ces
-- tables : on lui retire tout explicitement, ainsi qu'à PUBLIC.
-- Les policies restent la seule barrière métier pour authenticated.

revoke all on table public.nutrition_plan_profiles from public;
revoke all on table public.nutrition_plan_profiles from anon;
revoke all on table public.nutrition_meal_slot_targets from public;
revoke all on table public.nutrition_meal_slot_targets from anon;

grant select, insert, update, delete on table public.nutrition_plan_profiles to authenticated;
grant select, insert, update, delete on table public.nutrition_meal_slot_targets to authenticated;
grant all on table public.nutrition_plan_profiles to service_role;
grant all on table public.nutrition_meal_slot_targets to service_role;

-- ── 7. save_nutrition_plan_v2 — moteur d'écriture ATOMIQUE ──────────────────
--
-- POURQUOI UNE RPC. `supabase-js` n'offre pas de transaction multi-requêtes :
-- une suite d'appels `.insert()/.update()` peut laisser un plan v2 à moitié
-- écrit (profil enregistré, créneaux manquants, daily_target périmé). Cette
-- sauvegarde touche TROIS tables et DOIT être atomique : elle vit donc dans
-- une seule fonction PostgreSQL, appelée par un unique `supabase.rpc(...)`.
-- Une exception annule l'intégralité de la transaction.
--
-- SÉCURITÉ (mêmes conventions que save_training_session_blocks) :
--   - `security invoker` : les policies RLS de l'appelant s'appliquent. La
--     fonction n'accorde donc AUCUN privilège que son appelant n'a pas déjà,
--     et son propriétaire (postgres, comme toutes les fonctions du dépôt)
--     n'entre pas en jeu dans les droits d'accès aux lignes ;
--   - garde explicite `public.is_coach_or_admin()` en toute première
--     instruction : un élève authentifié est refusé avant toute lecture ;
--   - `set search_path = ''` : aucun objet ne peut être détourné par un
--     schéma injecté ; toutes les relations sont qualifiées `public.` ;
--   - EXECUTE révoqué à PUBLIC et à anon, accordé au seul rôle
--     `authenticated` (le staff s'y ajoute par la garde ci-dessus).
--
-- VALIDATION — répartition des responsabilités, volontaire :
--   - la RPC valide la STRUCTURE (enveloppe, clé de profil, six créneaux
--     connus et sans doublon) ;
--   - les BORNES de valeurs (0 à 10 000) sont portées par les CONTRAINTES
--     CHECK des tables, qui font autorité.
--   Cette séparation est aussi ce qui permet de PROUVER l'atomicité sans
--   ajouter la moindre porte dérobée : un payload dont le sixième créneau
--   porte une valeur hors borne échoue à l'INSERT, APRÈS l'écriture du plan,
--   du profil et des cinq premiers créneaux — et la transaction entière est
--   annulée. Voir supabase/tests/nutrition_plan_v2_checklist.sql.
--
-- IDEMPOTENCE : rejouer exactement le même payload sur le même plan produit
-- le même état (upsert sur (plan_id, profile_key) et (profile_id, slot)).

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

  v_daily_calories := coalesce((v_profile->>'daily_calories')::numeric, 0);
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
  'Sauvegarde ATOMIQUE d''un plan nutrition v2 : plan, profil « default », six créneaux et daily_target de compatibilité écrits dans UNE transaction. security invoker, search_path vide, garde is_coach_or_admin, relations qualifiées public.*, EXECUTE réservé à authenticated. Voir l''en-tête de la migration 20260804090000 pour le contrat complet.';

-- ── Droits d'exécution : jamais PUBLIC, jamais anon ─────────────────────────
revoke all on function public.save_nutrition_plan_v2(jsonb) from public;
revoke execute on function public.save_nutrition_plan_v2(jsonb) from anon;
grant execute on function public.save_nutrition_plan_v2(jsonb) to authenticated;
