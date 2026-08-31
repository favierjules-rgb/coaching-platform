-- ============================================================================
-- Migration 20260920090000 — N1.7 : UNE LISTE QU'ON PEUT NE PAS PRENDRE.
-- (chantier feat/listes-ignorables)
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
-- Un repas guidé exige aujourd'hui UN aliment par occurrence : toutes les
-- listes doivent être servies, sans exception. Or tout le monde ne prend pas
-- de crème avec son plat, ni de boisson sucrée avec son déjeuner. L'élève
-- n'avait que deux réponses possibles — un aliment, ou un repas qui reste
-- éternellement incomplet.
--
-- Ce lot en ajoute une troisième : « Rien ». Les quantités des AUTRES aliments
-- sont alors recalculées pour viser la même cible, ce que le solveur de N1.5
-- sait déjà faire sans cas particulier — il traite N = 1 comme N = 10.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LE RÉGLAGE APPARTIENT À LA LISTE, PAS À L'ALIMENT
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ C'EST « BOISSON PEUT ÊTRE IGNORÉE », JAMAIS « CE JUS D'ORANGE EST
-- FACULTATIF ». La question que le coach se pose est « cette catégorie est-elle
-- obligatoire dans le repas ? », et elle n'a qu'une réponse par liste. Poser le
-- réglage sur chaque aliment aurait créé des états incohérents — trois aliments
-- facultatifs et quatre obligatoires dans la même liste ne veut rien dire, un
-- seul choix étant servi.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ET C'EST DU SNAPSHOT, EXACTEMENT COMME LA COULEUR
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ DEUX COLONNES, PAS UNE. `food_lists.peut_etre_ignoree` est le réglage
-- VIVANT de la bibliothèque ; `meal_choice_slots.peut_etre_ignoree` est sa
-- copie FIGÉE au moment où le coach pose la liste dans un repas. Rendre une
-- liste ignorable demain ne doit PAS rendre facultative une occurrence d'un
-- repas construit hier — c'est la même règle que `color_key`,
-- `preferred_quantity` et `minimum_quantity`, et pour la même raison : un élève
-- n'a aucune policy `select` sur `food_lists`, la bibliothèque lui est
-- invisible.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE TABLE, ET NON UNE LIGNE DANS `planned_meal_items`
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ MESURÉ AVANT D'ÊTRE DÉCIDÉ. `planned_meal_items` impose trois contraintes
-- qu'un « rien » viole toutes les trois : `quantity > 0`,
-- `planned_meal_items_cible_unique` (exactement une identité d'aliment) et
-- `choice_slot_id not null` avec ses deux clés composites. Le commentaire de
-- 20260906 dit pourquoi elles existent : sans elles, il suffirait d'omettre
-- une colonne pour planifier n'importe quel aliment HORS des listes du coach.
--
-- On ne les affaiblit pas pour loger une absence. Une occurrence ignorée n'est
-- pas un aliment à zéro gramme : c'est un aliment qui n'existe pas. Elle a donc
-- sa table, où la seule information est « cette occurrence-ci a été écartée ».
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - AUCUN BACKFILL, et `default false` PARTOUT : toutes les listes et toutes
--     les occurrences existantes restent obligatoires. Aucun repas déjà
--     construit ne change de comportement ;
--   - AUCUNE COLONNE SUPPRIMÉE, AUCUNE RENOMMÉE, AUCUNE CONTRAINTE RELÂCHÉE ;
--   - AUCUNE SIGNATURE DE RPC MODIFIÉE. `enregistrer_repas_planifie` garde ses
--     trois paramètres : l'occurrence ignorée voyage DANS `p_items`, marquée
--     `"ignore": true`. Ajouter un quatrième paramètre à valeur par défaut
--     aurait créé une SURCHARGE, et tout appel à trois arguments serait devenu
--     ambigu ;
--   - AUCUNE MIGRATION EXISTANTE MODIFIÉE ;
--   - AUCUN CALCUL NUTRITIONNEL DÉPLACÉ EN BASE. Le solveur reste en TypeScript.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. LE RÉGLAGE, CÔTÉ BIBLIOTHÈQUE
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ `not null default false` ET NON `boolean` NULLABLE. Il n'existe pas de
-- troisième état : une liste est obligatoire ou elle ne l'est pas. Un `null`
-- aurait obligé chaque lecture à décider ce qu'il veut dire.
alter table public.food_lists
  add column if not exists peut_etre_ignoree boolean not null default false;

comment on column public.food_lists.peut_etre_ignoree is
  'N1.7 — l''élève peut répondre « Rien » à cette liste. Réglage VIVANT de la bibliothèque ; les repas déjà construits portent leur propre copie figée dans meal_choice_slots.peut_etre_ignoree.';

-- ────────────────────────────────────────────────────────────────────────────
-- B. SA COPIE FIGÉE, DANS L'OCCURRENCE
-- ────────────────────────────────────────────────────────────────────────────
alter table public.meal_choice_slots
  add column if not exists peut_etre_ignoree boolean not null default false;

comment on column public.meal_choice_slots.peut_etre_ignoree is
  'N1.7 — SNAPSHOT du réglage de la liste au moment de l''ajout au repas. Modifier la bibliothèque ensuite ne touche pas cette occurrence — même règle que color_key.';

-- ────────────────────────────────────────────────────────────────────────────
-- C. LA TRACE D'UNE OCCURRENCE ÉCARTÉE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.planned_meal_skipped_slots (
  id uuid primary key default gen_random_uuid(),

  planned_meal_id uuid not null references public.planned_meals (id) on delete cascade,
  student_id uuid not null,

  -- ⚠️ MÊME `on delete cascade` QUE `planned_meal_items`, ET POUR LA MÊME
  -- RAISON. Si le coach retire l'occurrence du repas, le « rien » que l'élève
  -- avait posé pour elle n'a plus d'objet : il disparaît avec elle plutôt que
  -- de désigner une occurrence qui n'existe plus.
  choice_slot_id uuid not null references public.meal_choice_slots (id) on delete cascade,

  created_at timestamptz not null default now(),

  -- ⚠️ UNE OCCURRENCE N'EST ÉCARTÉE QU'UNE FOIS. Sans cette unicité, deux
  -- lignes diraient la même chose, et la relecture compterait deux « rien »
  -- pour une seule occurrence.
  constraint planned_meal_skipped_slots_unique unique (planned_meal_id, choice_slot_id)
);

create index if not exists planned_meal_skipped_slots_meal_idx
  on public.planned_meal_skipped_slots (planned_meal_id);

create index if not exists planned_meal_skipped_slots_slot_idx
  on public.planned_meal_skipped_slots (choice_slot_id);

alter table public.planned_meal_skipped_slots enable row level security;

-- ⚠️ LES TROIS POLICIES SONT CELLES DE `planned_meal_items`, MOT POUR MOT.
-- Une occurrence écartée est une donnée de composition comme une autre : elle
-- doit être visible exactement par les mêmes personnes, ni plus ni moins.
drop policy if exists "planned_meal_skipped_slots_select_own_student" on public.planned_meal_skipped_slots;
create policy "planned_meal_skipped_slots_select_own_student" on public.planned_meal_skipped_slots
  for select to authenticated
  using (student_id = public.current_student_id());

drop policy if exists "planned_meal_skipped_slots_select_own_coach" on public.planned_meal_skipped_slots;
create policy "planned_meal_skipped_slots_select_own_coach" on public.planned_meal_skipped_slots
  for select to authenticated
  using (public.is_coach_of_student(student_id));

drop policy if exists "planned_meal_skipped_slots_manage_admin" on public.planned_meal_skipped_slots;
create policy "planned_meal_skipped_slots_manage_admin" on public.planned_meal_skipped_slots
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ⚠️ LECTURE SEULE POUR `authenticated`, COMME `planned_meal_items`. L'écriture
-- passe UNIQUEMENT par `enregistrer_repas_planifie`, qui est `security definer`
-- et vérifie que l'occurrence est bien ignorable. Un `insert` direct
-- contournerait ce garde-fou.
revoke all on table public.planned_meal_skipped_slots from public, anon, authenticated;
grant select on table public.planned_meal_skipped_slots to authenticated;
grant all on table public.planned_meal_skipped_slots to service_role;

comment on table public.planned_meal_skipped_slots is
  'N1.7 — les occurrences auxquelles l''élève a répondu « Rien ». Une absence n''est pas un aliment à zéro gramme : elle ne peut pas vivre dans planned_meal_items, dont les contraintes de sécurité l''interdisent.';

-- ────────────────────────────────────────────────────────────────────────────
-- D. `save_nutrition_plan_v2` — LE RÉGLAGE ENTRE DANS LE SNAPSHOT
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ LA FONCTION EST REDONNÉE EN ENTIER, ET C'EST LA CONVENTION DU DÉPÔT :
-- PostgreSQL n'a pas de « patch de fonction ». Le corps est celui de
-- 20260913090000 mot pour mot, plus la seule lecture de `peut_etre_ignoree`
-- et son écriture dans `meal_choice_slots`.
CREATE OR REPLACE FUNCTION public.save_nutrition_plan_v2(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  c_slots constant text[] := array['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'dessert'];
  c_days constant text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  -- N1.6A — miroir strict de `meal_choice_slots_color_key_check` et de
  -- `training_blocks.color_key`. Une couleur hors vocabulaire est refusée ici
  -- pour NOMMER la cause ; la contrainte le dirait aussi, mais moins bien.
  c_couleurs constant text[] := array['gray','red','orange','yellow','green','blue','purple'];

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
  v_occ_color text;
  v_occ_ignorable boolean;
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

              -- ── N1.6A — LA COULEUR, FIGÉE COMME LE RESTE DU SNAPSHOT ────
              -- ⚠️ ABSENTE = ABSENTE. Une charge utile d'avant N1.6A n'a pas
              -- cette clé : la colonne reste nulle, l'occurrence s'affiche
              -- sans accent, et rien d'autre ne change.
              --
              -- ⚠️ ELLE ARRIVE DÉJÀ RÉSOLUE. La RPC ne lit PAS `food_lists`
              -- pour la retrouver — ce serait relire la bibliothèque, et
              -- l'instantané cesserait d'en être un.
              --
              -- ⚠️ ET ELLE N'A AUCUN SENS MÉTIER. Aucun calcul ne la lit,
              -- aucun rôle n'en dérive. Le vocabulaire est celui, déjà
              -- existant, de `training_blocks.color_key`.
              v_occ_color := nullif(v_occ->>'color_key', '');
              if v_occ_color is not null and not (v_occ_color = any(c_couleurs)) then
                raise exception 'COULEUR_INCONNUE: occurrence « % » (%)', v_occ_label, v_occ_color
                  using errcode = '22023';
              end if;

              -- ⚠️ N1.7 — ABSENTE = OBLIGATOIRE. Une charge utile d'avant ce
              -- lot n'a pas cette clé : `coalesce` la lit comme `false`,
              -- l'occurrence reste obligatoire, et RIEN ne change pour les
              -- repas déjà construits.
              --
              -- ⚠️ ELLE ARRIVE DÉJÀ RÉSOLUE, comme la couleur. La RPC ne lit
              -- PAS `food_lists` pour la retrouver : ce serait relire la
              -- bibliothèque, et l'instantané cesserait d'en être un.
              v_occ_ignorable := coalesce((v_occ->>'peut_etre_ignoree')::boolean, false);

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

              insert into public.meal_choice_slots (id, meal_id, position, label, source_list_id, color_key, peut_etre_ignoree)
              values (
                v_occ_id,
                v_meal_id,
                v_occ_pos,
                v_occ_label,
                nullif(v_occ->>'source_list_id', '')::uuid,
                v_occ_color,
                v_occ_ignorable
              )
              on conflict (id) do update set
                position = excluded.position,
                label = excluded.label,
                source_list_id = excluded.source_list_id,
                color_key = excluded.color_key,
                peut_etre_ignoree = excluded.peut_etre_ignoree,
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

                -- ⚠️ L'UNITÉ EST COMMUNE AUX DEUX QUANTITÉS (N1.5.2).
                --
                -- ⚠️ CONTRACT — LA CLÉ D'ENTRÉE `preferred_unit` SURVIT À LA
                -- COLONNE, ET CE N'EST PAS UN OUBLI. La COLONNE disparaît ;
                -- l'ALIAS D'ENTRÉE reste, parce qu'un onglet ouvert avant le
                -- déploiement peut encore poster l'ancienne clé. Elle n'a
                -- jamais eu d'autre sens que « l'unité de cette option », et
                -- l'accepter ne coûte rien. Le CONTRACT retire une dépendance
                -- de STOCKAGE, pas une politesse d'entrée.
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
                       quantity_unit = v_opt_pref_unit
                 where o.slot_id = v_occ_id
                   and o.catalog_food_id is not distinct from v_opt_food
                   and o.product_id is not distinct from v_opt_product;

                if not found then
                  insert into public.meal_choice_options (
                    slot_id, position, catalog_food_id, product_id,
                    preferred_quantity, minimum_quantity, quantity_unit)
                  values (v_occ_id, v_opt_pos, v_opt_food, v_opt_product,
                          v_opt_pref, v_opt_min, v_opt_pref_unit);
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
$function$
;

-- ────────────────────────────────────────────────────────────────────────────
-- E. `enregistrer_repas_planifie` — « RIEN » EST UNE RÉPONSE VALIDE
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ SIGNATURE INCHANGÉE. Corps de 20260914090000 mot pour mot, plus la
-- branche `"ignore": true` et son garde-fou sur le snapshot.
CREATE OR REPLACE FUNCTION public.enregistrer_repas_planifie(p_meal_id uuid, p_planned_on date, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_student uuid;
  v_meal record;
  v_cible record;
  v_cible_trouvee boolean;
  v_planned uuid;
  v_item jsonb;
  v_ignore boolean;
  v_slots_envoyes uuid[];
  v_position integer := 0;
  v_slot uuid;
  v_food uuid;
  v_product uuid;
  v_quantity numeric;
  v_unit text;
  v_aliment record;
  v_poids_piece numeric;
  v_existant uuid;
  v_consumed_existant uuid;
begin
  v_student := public.current_student_id();
  if v_student is null then
    raise exception 'ELEVE_INCONNU' using errcode = '42501';
  end if;

  if p_planned_on is null then
    raise exception 'DATE_MANQUANTE' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'ITEMS_INVALIDES' using errcode = '22023';
  end if;

  -- Le repas doit appartenir à un plan RÉELLEMENT ASSIGNÉ à cet élève. C'est ce
  -- contrôle, et lui seul, qui empêche de planifier à partir du plan d'un autre.
  --
  -- ⚠️ `status <> 'prochain'` EST LA MÊME CONDITION QUE LA LECTURE. Les policies
  -- `meals_select_self_or_assigned` et `meal_choice_slots_select_assigned`
  -- excluent les plans « prochain ». Sans cette ligne, une fonction
  -- `security definer` — qui ignore la RLS par construction — permettrait de
  -- planifier un repas que l'élève ne peut même pas afficher.
  select m.id, m.slot, m.name
    into v_meal
    from public.meals m
    join public.nutrition_days d on d.id = m.nutrition_day_id
    join public.nutrition_plans p on p.id = d.plan_id
   where m.id = p_meal_id
     and p.student_id = v_student
     and p.status <> 'prochain';
  if not found then
    raise exception 'REPAS_PRESCRIT_INACCESSIBLE' using errcode = '42501';
  end if;

  -- ── C0.1 — LE VERROU : UNE CONSOMMATION FIGE SA COMPOSITION ─────────────
  -- ⚠️ ON REGARDE AVANT D'ÉCRIRE, PAS APRÈS. Le refus intervient avant
  -- l'`upsert` de `planned_meals` ET avant le `delete` des items : en cas de
  -- refus, rien n'a bougé — ni `updated_at`, ni les cibles, ni un seul item.
  --
  -- ⚠️ `for update` PARCE QUE LA DÉCISION EST UNE COURSE. Sans verrou de
  -- ligne, deux appels concurrents pourraient lire `consumed_meal_id` nul tous
  -- les deux et réécrire la composition d'un repas en cours de consommation.
  --
  -- POURQUOI CE VERROU EXISTE : sans lui, un appel direct APRÈS consommation
  -- réécrivait `planned_meal_items` pendant que `meal_entries` gardait
  -- l'ancienne composition. Mesuré : planifié 999 g, consommé 175 g, et rien
  -- pour l'empêcher. Une consommation enregistrée FIGE désormais le planifié
  -- correspondant — c'est aussi ce qui garantit à Courses qu'un repas passé ne
  -- change plus rétroactivement de composition.
  select pm.id, pm.consumed_meal_id into v_existant, v_consumed_existant
    from public.planned_meals pm
   where pm.student_id = v_student
     and pm.planned_on = p_planned_on
     and pm.meal_id = p_meal_id
   for update;

  if v_existant is not null and v_consumed_existant is not null then
    raise exception 'REPAS_DEJA_CONSOMME' using errcode = '42501';
  end if;


  -- ⚠️ LA PLANIFICATION N'EXISTE QUE POUR UN REPAS GUIDÉ. Un repas sans
  -- occurrence garde le fonctionnement libre actuel, qui passe par A5. Ouvrir
  -- la planification à un repas sans liste créerait un second chemin pour la
  -- même chose, et `choice_slot_id not null` serait alors intenable.
  if not exists (select 1 from public.meal_choice_slots s where s.meal_id = p_meal_id) then
    raise exception 'REPAS_SANS_LISTE' using errcode = '22023';
  end if;

  -- ────────────────────────────────────────────────────────────────────────
  -- TOUTES LES OCCURRENCES, EXACTEMENT UNE FOIS CHACUNE
  -- ────────────────────────────────────────────────────────────────────────
  -- Comparaison d'ENSEMBLES, jamais de nombres : une occurrence omise et une
  -- autre citée deux fois donnent le même total, et un compteur ne verrait
  -- rien. L'ordre des quatre refus va du plus précis au plus général, pour que
  -- le motif rendu soit celui qui aide.
  v_slots_envoyes := array(
    select nullif(x ->> 'slot_id', '')::uuid from jsonb_array_elements(p_items) x);

  if array_position(v_slots_envoyes, null) is not null then
    raise exception 'OCCURRENCE_MANQUANTE' using errcode = '22023';
  end if;

  -- ⚠️ `coalesce(..., 0)` N'EST PAS DÉCORATIF. `array_length` d'un tableau VIDE
  -- rend NULL, pas 0 ; sans le coalesce, `NULL is distinct from 0` est vrai et
  -- un envoi vide serait refusé pour « occurrence en double ». Le motif serait
  -- faux, et le test qui vérifie le motif l'a montré.
  if coalesce(array_length(v_slots_envoyes, 1), 0) is distinct from
     (select count(distinct u)::int from unnest(v_slots_envoyes) u) then
    raise exception 'OCCURRENCE_EN_DOUBLE' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_slots_envoyes) u
     where u not in (select s.id from public.meal_choice_slots s where s.meal_id = p_meal_id)
  ) then
    raise exception 'OCCURRENCE_HORS_REPAS' using errcode = '42501';
  end if;

  -- Un tableau vide passe les trois contrôles précédents sans rien prouver :
  -- c'est celui-ci qui le refuse, parce qu'il reste des occurrences non
  -- couvertes.
  if exists (
    select 1 from public.meal_choice_slots s
     where s.meal_id = p_meal_id
       and s.id <> all (coalesce(v_slots_envoyes, array[]::uuid[]))
  ) then
    raise exception 'CHOIX_INCOMPLET' using errcode = '22023';
  end if;

  select * into v_cible from public.cible_creneau_du_repas(p_meal_id);
  v_cible_trouvee := found;

  insert into public.planned_meals (
    student_id, planned_on, meal_id, slot_key, label,
    target_kcal, target_protein_g, target_carb_g, target_fat_g
  ) values (
    v_student, p_planned_on, p_meal_id, v_meal.slot,
    coalesce(nullif(btrim(coalesce(v_meal.name, '')), ''), v_meal.slot),
    case when v_cible_trouvee then v_cible.target_kcal end,
    case when v_cible_trouvee then v_cible.target_protein_g end,
    case when v_cible_trouvee then v_cible.target_carb_g end,
    case when v_cible_trouvee then v_cible.target_fat_g end
  )
  on conflict (student_id, planned_on, meal_id) do update
    set updated_at = now(),
        label = excluded.label,
        slot_key = excluded.slot_key,
        target_kcal = excluded.target_kcal,
        target_protein_g = excluded.target_protein_g,
        target_carb_g = excluded.target_carb_g,
        target_fat_g = excluded.target_fat_g
  returning id into v_planned;

  -- REMPLACEMENT INTÉGRAL. Tout ce qui précède disparaît avant d'écrire.
  delete from public.planned_meal_items where planned_meal_id = v_planned;
  -- ⚠️ N1.7 — LES « RIEN » PARTENT AVEC LE RESTE. `enregistrer_repas_planifie`
  -- REMPLACE la composition, elle ne la complète pas : laisser les anciennes
  -- occurrences écartées survivre ferait cohabiter le « rien » d'hier avec
  -- l'aliment choisi aujourd'hui pour la même occurrence.
  delete from public.planned_meal_skipped_slots where planned_meal_id = v_planned;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_slot     := nullif(v_item ->> 'slot_id', '')::uuid;
    v_ignore   := coalesce((v_item ->> 'ignore')::boolean, false);

    -- ════════════════════════════════════════════════════════════════════
    -- N1.7 — « RIEN » : L'OCCURRENCE EST CITÉE, MAIS AUCUN ALIMENT N'EST SERVI
    -- ════════════════════════════════════════════════════════════════════
    -- ⚠️ ELLE RESTE DANS `p_items`, ET C'EST INDISPENSABLE. Le contrôle
    -- d'ensemble plus haut exige TOUTES les occurrences, exactement une fois
    -- chacune. L'omettre ferait lever OCCURRENCE_MANQUANTE — « je ne prends
    -- rien » deviendrait indiscernable de « j'ai oublié de répondre ».
    if v_ignore then
      -- ⚠️ LE GARDE-FOU EST ICI, ET NON DANS L'INTERFACE SEULE. Le snapshot
      -- de l'occurrence fait foi : une liste rendue ignorable dans la
      -- bibliothèque APRÈS la construction du repas ne rend pas facultative
      -- une occurrence figée obligatoire. Sans ce refus, un appel direct à la
      -- RPC contournerait la décision du coach.
      if not exists (
        select 1 from public.meal_choice_slots s
         where s.id = v_slot and s.peut_etre_ignoree
      ) then
        raise exception 'OCCURRENCE_NON_IGNORABLE' using errcode = '42501';
      end if;

      -- ⚠️ AUCUNE LIGNE DANS `planned_meal_items`, ET AUCUNE POSITION
      -- CONSOMMÉE. Une absence n'est pas un aliment : lui donner un rang la
      -- ferait compter parmi les aliments du repas.
      insert into public.planned_meal_skipped_slots (planned_meal_id, student_id, choice_slot_id)
      values (v_planned, v_student, v_slot);
      continue;
    end if;

    v_position := v_position + 1;

    v_food     := nullif(v_item ->> 'catalog_food_id', '')::uuid;
    v_product  := nullif(v_item ->> 'product_id', '')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit     := v_item ->> 'unit';

    if (case when v_food is null then 0 else 1 end)
     + (case when v_product is null then 0 else 1 end) <> 1 then
      raise exception 'IDENTITE_INVALIDE' using errcode = '22023';
    end if;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'QUANTITE_INVALIDE' using errcode = '22023';
    end if;

    -- L'appartenance de l'occurrence au repas a déjà été établie plus haut, sur
    -- l'ENSEMBLE des occurrences envoyées : la revérifier ici serait du code
    -- inatteignable.

    -- L'aliment doit appartenir au SNAPSHOT de cette occurrence.
    if not exists (
      select 1 from public.meal_choice_options o
       where o.slot_id = v_slot
         and o.catalog_food_id is not distinct from v_food
         and o.product_id is not distinct from v_product
    ) then
      raise exception 'CHOIX_HORS_LISTE' using errcode = '42501';
    end if;

    -- L'unité doit être convertible POUR CET ALIMENT — sinon la quantité
    -- planifiée ne pourrait jamais devenir une consommation. On réutilise le
    -- helper d'A2 : il lève lui-même PIECE_SANS_POIDS ou UNITE_INCOMPATIBLE.
    if v_food is not null then
      -- ⚠️ N1.6B — `status = 'active'` A ÉTÉ RETIRÉ ICI, ET SEULEMENT ICI.
      -- Un aliment ARCHIVÉ après la construction du plan reste affiché à
      -- l'élève (le lecteur de semaine ne filtre pas le statut, délibérément :
      -- « un aliment archivé après coup doit garder son nom à l'écran »), il
      -- reste calculé par le solveur — et il échouait donc à l'enregistrement,
      -- avec ALIMENT_INACCESSIBLE, sur un repas parfaitement affiché. Le plan
      -- constitue un SNAPSHOT HISTORIQUE VALIDE : l'aliment était actif quand
      -- le coach l'a prescrit.
      --
      -- ⚠️ L'EXCEPTION N'APPARTIENT QU'À CE CHEMIN, et il est étroit : repas
      -- assigné à l'élève + occurrence de ce repas + option appartenant au
      -- SNAPSHOT de l'occurrence. `ajouter_aliment_catalogue` — l'ajout manuel
      -- A5, où l'élève choisit librement dans le catalogue — continue d'exiger
      -- `status = 'active'` et n'est PAS touchée par ce lot.
      --
      -- ⚠️ `owner_coach_id is null` RESTE, LUI. Ce n'est pas du cycle de vie
      -- mais de la visibilité : un aliment privé de coach n'est lisible par
      -- aucun élève (policy `food_catalog_select_global`), et cette fonction
      -- étant `security definer`, retirer la garde ouvrirait un accès que la
      -- RLS refuse.
      select f.nutrition_unit, f.piece_weight_g into v_aliment
        from public.food_catalog f
       where f.id = v_food and f.owner_coach_id is null;
      if not found then
        raise exception 'ALIMENT_INACCESSIBLE' using errcode = '42501';
      end if;
      perform public.quantite_en_base_nutritionnelle(
        v_quantity, v_unit, v_aliment.nutrition_unit, v_aliment.piece_weight_g);
    else
      select p.nutrition_unit,
             case when p.net_unit = 'g' and p.nutrition_unit = 'g'
                  then p.net_quantity else null end as piece_weight_g
        into v_aliment
        from public.food_products p
       where p.id = v_product;
      if not found then
        raise exception 'PRODUIT_INACCESSIBLE' using errcode = '42501';
      end if;
      perform public.quantite_en_base_nutritionnelle(
        v_quantity, v_unit, v_aliment.nutrition_unit, v_aliment.piece_weight_g);
    end if;

    insert into public.planned_meal_items (
      planned_meal_id, student_id, choice_slot_id, position,
      catalog_food_id, product_id, quantity, unit
    ) values (
      v_planned, v_student, v_slot, v_position,
      v_food, v_product, v_quantity, v_unit
    );
  end loop;

  return v_planned;
end;
$function$
;
