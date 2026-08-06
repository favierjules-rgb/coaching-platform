-- ============================================================================
-- Migration 20260811090000 — unification du modèle nutritionnel : le v2
-- devient l'unique modèle (chantier feat/student-nutrition-recipes, PR C —
-- lot 2/4).
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE FAIT CETTE MIGRATION
-- ────────────────────────────────────────────────────────────────────────────
--   A. NORMALISE les deux vocabulaires restés en texte libre :
--        - `nutrition_days.day` : « Lundi » … « Dimanche » → monday … sunday ;
--        - `meals.slot`        : « Petit déjeuner » … → breakfast … dessert.
--      Les six clés de créneau sont EXACTEMENT celles de
--      `nutrition_meal_slot_targets` (20260804090000:131-132) et de
--      `nutrition_recipes.slot_key` (20260807090000:99-101). Aucune
--      septième liste n'est créée.
--
--   B. RATTACHE chaque jour à un profil v2 :
--      `nutrition_days.profile_key` + clé étrangère COMPOSITE
--      `(plan_id, profile_key) → nutrition_plan_profiles (plan_id, profile_key)`.
--      La composite rend structurellement impossible qu'un jour pointe vers
--      le profil d'un AUTRE plan — même raisonnement que la clé étrangère
--      composite des ingrédients de recette (20260807090000:207-210).
--
--   C. CONVERTIT tous les plans en v2, sans perte :
--        - un plan v1 reçoit un profil `legacy_default` construit depuis son
--          `daily_target` ;
--        - un plan v2 conserve ses profils et ses créneaux ;
--        - les sept jours sont créés s'ils manquent ;
--        - `nutrition_days` et `meals` existants sont CONSERVÉS tels quels.
--
--   D. VERROUILLE le modèle : `nutrition_model_version` ne peut plus valoir
--      que 2. La colonne est conservée (le code et les tests la lisent
--      encore) mais elle ne porte plus de branche fonctionnelle.
--
--   E. AJOUTE les index manquants sur les colonnes réellement filtrées.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - AUCUNE suppression de table. `nutrition_days` et `meals` ne sont pas le
--     « modèle v1 » : elles deviennent la SEMAINE ALIMENTAIRE PRESCRITE du
--     modèle v2 (outil 3). Elles restent.
--   - AUCUNE suppression de donnée. Aucun `delete` hors des lignes que la
--     migration vient elle-même d'insérer en cas d'échec (il n'y en a pas :
--     tout est en une transaction implicite par instruction, et les
--     pré-contrôles échouent AVANT toute écriture).
--   - AUCUNE suppression de `nutrition_daily_logs` (outil 1).
--   - AUCUNE policy modifiée : c'est le lot 4 qui s'en charge, pour les
--     recettes uniquement.
--
-- ────────────────────────────────────────────────────────────────────────────
-- RÈGLE DÉTERMINISTE DE RATTACHEMENT JOUR → PROFIL
-- ────────────────────────────────────────────────────────────────────────────
-- Un plan v2 peut déjà posséder plusieurs profils sans aucune affectation
-- journalière. L'ordre de choix est FIXE, documenté, et reporté dans le
-- rapport de PR :
--   1. le profil `default` s'il existe (c'est celui qu'écrit la RPC actuelle) ;
--   2. sinon le profil `legacy_default` s'il existe ;
--   3. sinon le profil dont `profile_key` vient en PREMIER par ordre
--      alphabétique — ordre total, donc reproductible.
-- Jamais de choix aléatoire, jamais `limit 1` sans `order by`.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A0. PRÉ-CONTRÔLES — la migration échoue AVANT d'écrire quoi que ce soit
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_liste text;
begin
  -- Jours dont le libellé n'est ni un jour français connu, ni déjà une clé.
  select string_agg(distinct d.day, ', ' order by d.day) into v_liste
    from public.nutrition_days d
   where d.day not in ('Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche')
     and d.day not in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday');
  if v_liste is not null then
    raise exception
      'MIGRATION IMPOSSIBLE : nutrition_days.day contient des valeurs non reconnues (%). Corrige-les avant de rejouer.',
      v_liste;
  end if;

  -- Créneaux de repas non reconnus.
  select string_agg(distinct m.slot, ', ' order by m.slot) into v_liste
    from public.meals m
   where m.slot not in ('Petit déjeuner','Collation matin','Midi','Collation après-midi','Dîner','Compléments')
     and m.slot not in ('breakfast','morning_snack','lunch','afternoon_snack','dinner','dessert');
  if v_liste is not null then
    raise exception
      'MIGRATION IMPOSSIBLE : meals.slot contient des valeurs non reconnues (%). Corrige-les avant de rejouer.',
      v_liste;
  end if;

  -- Deux jours portant le même libellé dans un même plan : l'unicité posée
  -- plus bas échouerait, autant le dire tout de suite et nommer les plans.
  select string_agg(distinct t.plan_id::text, ', ') into v_liste
    from (
      select d.plan_id, d.day
        from public.nutrition_days d
       group by d.plan_id, d.day
      having count(*) > 1
    ) t;
  if v_liste is not null then
    raise exception
      'MIGRATION IMPOSSIBLE : jours en double dans les plans suivants (%). Déduplique-les avant de rejouer.',
      v_liste;
  end if;

  raise notice 'Pré-contrôles A0 : aucun libellé inconnu, aucun jour en double.';
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- A. Normalisation des vocabulaires
-- ────────────────────────────────────────────────────────────────────────────
-- Extraite en FONCTION plutôt qu'écrite en ligne : la checklist doit pouvoir
-- rejouer exactement la même normalisation sur des lignes de test, sans en
-- recopier une seconde version qui divergerait au premier correctif.
create or replace function public.nutrition_v2_normalize_vocabulary()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_jours int;
  v_repas int;
begin
  update public.nutrition_days set day = case day
    when 'Lundi' then 'monday'
    when 'Mardi' then 'tuesday'
    when 'Mercredi' then 'wednesday'
    when 'Jeudi' then 'thursday'
    when 'Vendredi' then 'friday'
    when 'Samedi' then 'saturday'
    when 'Dimanche' then 'sunday'
    else day
  end
  where day in ('Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche');
  get diagnostics v_jours = row_count;

  -- « Compléments » → `dessert` : les deux modèles ont un SIXIÈME créneau
  -- d'appoint, en fin de journée, et il n'y a pas d'autre correspondance
  -- possible parmi les six clés v2. La divergence sémantique est assumée et
  -- documentée plutôt que masquée.
  update public.meals set slot = case slot
    when 'Petit déjeuner' then 'breakfast'
    when 'Collation matin' then 'morning_snack'
    when 'Midi' then 'lunch'
    when 'Collation après-midi' then 'afternoon_snack'
    when 'Dîner' then 'dinner'
    when 'Compléments' then 'dessert'
    else slot
  end
  where slot in ('Petit déjeuner','Collation matin','Midi','Collation après-midi','Dîner','Compléments');
  get diagnostics v_repas = row_count;

  return jsonb_build_object('days_normalized', v_jours, 'meals_normalized', v_repas);
end;
$fn$;

alter function public.nutrition_v2_normalize_vocabulary() owner to postgres;
comment on function public.nutrition_v2_normalize_vocabulary() is
  'Normalise nutrition_days.day (Lundi… → monday…) et meals.slot (Petit déjeuner… → breakfast…) vers le vocabulaire v2. Idempotente. Fonction de MAINTENANCE : aucun rôle applicatif ne peut l''exécuter.';
revoke all on function public.nutrition_v2_normalize_vocabulary() from public;
revoke execute on function public.nutrition_v2_normalize_vocabulary() from anon;
revoke execute on function public.nutrition_v2_normalize_vocabulary() from authenticated;

select public.nutrition_v2_normalize_vocabulary();

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'nutrition_days_day_check'
       and conrelid = 'public.nutrition_days'::regclass
  ) then
    alter table public.nutrition_days
      add constraint nutrition_days_day_check
      check (day in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'meals_slot_check'
       and conrelid = 'public.meals'::regclass
  ) then
    alter table public.meals
      add constraint meals_slot_check
      check (slot in ('breakfast','morning_snack','lunch','afternoon_snack','dinner','dessert'));
  end if;
end $$;

comment on column public.nutrition_days.day is
  'Jour de la semaine, en CLÉ technique : monday … sunday. Même vocabulaire que lib/nutrition/weekdays.ts ; les libellés français sont un affichage, jamais un stockage.';
comment on column public.meals.slot is
  'Créneau du repas prescrit, en CLÉ technique : breakfast, morning_snack, lunch, afternoon_snack, dinner, dessert. EXACTEMENT le vocabulaire de nutrition_meal_slot_targets.slot et de nutrition_recipes.slot_key — aucune liste parallèle.';

-- ────────────────────────────────────────────────────────────────────────────
-- B. La colonne de rattachement
-- ────────────────────────────────────────────────────────────────────────────
alter table public.nutrition_days
  add column if not exists profile_key text;

-- ────────────────────────────────────────────────────────────────────────────
-- C. Conversion de tous les plans
-- ────────────────────────────────────────────────────────────────────────────
-- Extraite en FONCTION, pour la même raison que la normalisation : la
-- checklist rejoue EXACTEMENT cette conversion sur un plan de test.
create or replace function public.nutrition_v2_backfill_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  c_jours constant text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  v_daily_target jsonb;
  v_cal numeric;
  v_prot numeric;
  v_carb numeric;
  v_fat numeric;
  v_profile_key text;
  v_profile_id uuid;
  v_jour text;
  v_profil_cree boolean := false;
  v_jours_crees int := 0;
begin
  select p.daily_target into v_daily_target
    from public.nutrition_plans p where p.id = p_plan_id;
  if not found then
    raise exception 'PLAN_NOT_FOUND: %', p_plan_id;
  end if;

  -- ── 1. Un profil, au moins ────────────────────────────────────────────
  -- Ordre de choix FIXE : `default`, puis `legacy_default`, puis le premier
  -- par ordre alphabétique. Jamais de `limit 1` sans `order by`.
  select pr.profile_key into v_profile_key
    from public.nutrition_plan_profiles pr
   where pr.plan_id = p_plan_id
   order by
     case pr.profile_key
       when 'default' then 0
       when 'legacy_default' then 1
       else 2
     end,
     pr.profile_key
   limit 1;

  if v_profile_key is null then
    -- Plan sans aucun profil : on en construit un depuis `daily_target`.
    -- Les grammes stockés redeviennent des parts en points de base, qui sont
    -- la source de vérité du v2. Aucune valeur inventée : si les calories
    -- sont nulles ou absentes, les parts valent 0 et le plan restera signalé
    -- « non assignable » par la validation applicative.
    v_cal  := coalesce((v_daily_target->>'calories')::numeric, 0);
    v_prot := coalesce((v_daily_target->>'protein')::numeric, 0);
    v_carb := coalesce((v_daily_target->>'carbs')::numeric, 0);
    v_fat  := coalesce((v_daily_target->>'fat')::numeric, 0);

    v_profile_key := 'legacy_default';

    insert into public.nutrition_plan_profiles (
      plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp
    ) values (
      p_plan_id,
      v_profile_key,
      least(greatest(v_cal, 0), 10000),
      case when v_cal > 0 then least(greatest(round(v_prot * 4 / v_cal * 10000), 0), 10000) else 0 end,
      case when v_cal > 0 then least(greatest(round(v_carb * 4 / v_cal * 10000), 0), 10000) else 0 end,
      case when v_cal > 0 then least(greatest(round(v_fat  * 9 / v_cal * 10000), 0), 10000) else 0 end
    )
    on conflict (plan_id, profile_key) do nothing;

    v_profil_cree := true;
  end if;

  select pr.id into v_profile_id
    from public.nutrition_plan_profiles pr
   where pr.plan_id = p_plan_id and pr.profile_key = v_profile_key;

  -- ── 2. Les six créneaux du profil, s'ils manquent ─────────────────────
  -- Répartition de départ DÉTERMINISTE et documentée : petit déjeuner 25 %,
  -- déjeuner 35 %, collation de l'après-midi 10 %, dîner 30 %. La somme des
  -- créneaux actifs vaut 10 000 sur chaque macro, donc le plan converti est
  -- immédiatement assignable. Les deux créneaux restants existent, désactivés
  -- et à zéro — le coach les activera s'il le souhaite.
  if not exists (
    select 1 from public.nutrition_meal_slot_targets t where t.profile_id = v_profile_id
  ) then
    insert into public.nutrition_meal_slot_targets
      (profile_id, slot, enabled, protein_bp, carb_bp, fat_bp, display_order)
    values
      (v_profile_id, 'breakfast',       true,  2500, 2500, 2500, 0),
      (v_profile_id, 'morning_snack',   false,    0,    0,    0, 1),
      (v_profile_id, 'lunch',           true,  3500, 3500, 3500, 2),
      (v_profile_id, 'afternoon_snack', true,  1000, 1000, 1000, 3),
      (v_profile_id, 'dinner',          true,  3000, 3000, 3000, 4),
      (v_profile_id, 'dessert',         false,    0,    0,    0, 5)
    on conflict (profile_id, slot) do nothing;
  end if;

  -- ── 3. Les sept jours ─────────────────────────────────────────────────
  foreach v_jour in array c_jours loop
    insert into public.nutrition_days (plan_id, day, status, target, profile_key)
    select p_plan_id, v_jour, 'non-commence', '{}'::jsonb, v_profile_key
     where not exists (
       select 1 from public.nutrition_days d
        where d.plan_id = p_plan_id and d.day = v_jour
     );
    if found then
      v_jours_crees := v_jours_crees + 1;
    end if;
  end loop;

  -- ── 4. Rattachement des jours SANS profil ─────────────────────────────
  -- On ne réécrit jamais une affectation déjà posée.
  update public.nutrition_days d
     set profile_key = v_profile_key, updated_at = now()
   where d.plan_id = p_plan_id
     and d.profile_key is null;

  -- ── 5. Le plan passe en v2 ────────────────────────────────────────────
  update public.nutrition_plans p
     set nutrition_model_version = 2, updated_at = now()
   where p.id = p_plan_id
     and p.nutrition_model_version is distinct from 2;

  return jsonb_build_object(
    'plan_id', p_plan_id,
    'profile_key', v_profile_key,
    'profile_created', v_profil_cree,
    'days_created', v_jours_crees
  );
end;
$fn$;

alter function public.nutrition_v2_backfill_plan(uuid) owner to postgres;
comment on function public.nutrition_v2_backfill_plan(uuid) is
  'Convertit UN plan au modèle v2 : profil legacy_default depuis daily_target si aucun profil n''existe, six créneaux par défaut, sept jours, rattachement des jours sans profil, version portée à 2. Idempotente, ne réécrit jamais une affectation existante. Fonction de MAINTENANCE : aucun rôle applicatif ne peut l''exécuter.';
revoke all on function public.nutrition_v2_backfill_plan(uuid) from public;
revoke execute on function public.nutrition_v2_backfill_plan(uuid) from anon;
revoke execute on function public.nutrition_v2_backfill_plan(uuid) from authenticated;

do $$
declare
  v_plan record;
  v_res jsonb;
  v_nb_plans int := 0;
  v_nb_profils int := 0;
  v_nb_jours int := 0;
begin
  for v_plan in select p.id from public.nutrition_plans p order by p.id loop
    v_res := public.nutrition_v2_backfill_plan(v_plan.id);
    v_nb_plans := v_nb_plans + 1;
    if (v_res->>'profile_created')::boolean then
      v_nb_profils := v_nb_profils + 1;
    end if;
    v_nb_jours := v_nb_jours + (v_res->>'days_created')::int;
  end loop;

  raise notice 'Conversion : % plan(s) traité(s), % profil(s) créé(s), % jour(s) créé(s).',
    v_nb_plans, v_nb_profils, v_nb_jours;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- D. Invariants structurels
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_orphelins int;
begin
  select count(*) into v_orphelins
    from public.nutrition_days d
   where d.profile_key is null
      or not exists (
        select 1 from public.nutrition_plan_profiles pr
         where pr.plan_id = d.plan_id and pr.profile_key = d.profile_key
      );
  if v_orphelins > 0 then
    raise exception
      'MIGRATION IMPOSSIBLE : % jour(s) sans profil valide après conversion.', v_orphelins;
  end if;
end $$;

alter table public.nutrition_days
  alter column profile_key set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'nutrition_days_plan_day_unique'
       and conrelid = 'public.nutrition_days'::regclass
  ) then
    alter table public.nutrition_days
      add constraint nutrition_days_plan_day_unique unique (plan_id, day);
  end if;

  -- Clé étrangère COMPOSITE : un jour ne peut désigner qu'un profil de SON
  -- plan. `on update cascade` suit un éventuel renommage de profil ;
  -- `on delete restrict` interdit de supprimer un profil encore utilisé par
  -- un jour — la suppression doit être un acte explicite du coach.
  if not exists (
    select 1 from pg_constraint
     where conname = 'nutrition_days_profile_fkey'
       and conrelid = 'public.nutrition_days'::regclass
  ) then
    alter table public.nutrition_days
      add constraint nutrition_days_profile_fkey
      foreign key (plan_id, profile_key)
      references public.nutrition_plan_profiles (plan_id, profile_key)
      on update cascade
      on delete restrict;
  end if;
end $$;

comment on column public.nutrition_days.profile_key is
  'Profil v2 utilisé par ce jour, dans le MÊME plan (clé étrangère composite). C''est lui qui fixe les calories et les macros du jour, donc les cibles de chaque créneau. Deux jours d''un même plan peuvent utiliser deux profils différents.';

-- ────────────────────────────────────────────────────────────────────────────
-- E. Le modèle v1 disparaît
-- ────────────────────────────────────────────────────────────────────────────
update public.nutrition_plans
   set nutrition_model_version = 2, updated_at = now()
 where nutrition_model_version is distinct from 2;

do $$
begin
  if exists (select 1 from public.nutrition_plans where nutrition_model_version <> 2) then
    raise exception 'MIGRATION IMPOSSIBLE : des plans ne sont pas en version 2.';
  end if;

  -- L'ancienne contrainte acceptait 1 ou 2. On la remplace par « 2 et rien
  -- d'autre » : plus aucune écriture v1 n'est possible, ni par l'application,
  -- ni par une requête directe, ni par une future RPC distraite.
  if exists (
    select 1 from pg_constraint
     where conname = 'nutrition_plans_model_version_check'
       and conrelid = 'public.nutrition_plans'::regclass
  ) then
    alter table public.nutrition_plans drop constraint nutrition_plans_model_version_check;
  end if;

  alter table public.nutrition_plans
    add constraint nutrition_plans_model_version_check
    check (nutrition_model_version = 2);
end $$;

-- Le DEFAULT valait 1 (20260804090000:64). Un insert qui ne mentionne pas la
-- colonne violerait donc la nouvelle contrainte : on aligne le défaut.
alter table public.nutrition_plans
  alter column nutrition_model_version set default 2;

comment on column public.nutrition_plans.nutrition_model_version is
  'Toujours 2. Colonne CONSERVÉE pour ne pas casser les lectures existantes, mais elle ne porte plus aucune branche fonctionnelle : le modèle v1 n''existe plus. La contrainte interdit désormais toute autre valeur.';

-- ────────────────────────────────────────────────────────────────────────────
-- F. Index sur les colonnes réellement filtrées
-- ────────────────────────────────────────────────────────────────────────────
create index if not exists nutrition_days_plan_id_idx
  on public.nutrition_days (plan_id);
create index if not exists meals_nutrition_day_id_idx
  on public.meals (nutrition_day_id);
create index if not exists nutrition_daily_logs_student_plan_date_idx
  on public.nutrition_daily_logs (student_id, nutrition_plan_id, log_date);

-- ────────────────────────────────────────────────────────────────────────────
-- G. Le trigger de protection connaît maintenant `profile_key`
-- ────────────────────────────────────────────────────────────────────────────
-- Recréation à l'identique de 20260810090000, avec la colonne ajoutée par
-- cette migration. Le rattachement d'un jour à un profil est une décision du
-- coach ; un élève ne doit pas pouvoir se donner un profil plus généreux.
create or replace function public.protect_nutrition_days_coach_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if public.is_coach_or_admin() then
    return new;
  end if;

  new.plan_id := old.plan_id;
  new.day := old.day;
  new.week_start_date := old.week_start_date;
  new.target := old.target;
  new.profile_key := old.profile_key;

  return new;
end;
$$;

alter function public.protect_nutrition_days_coach_columns() owner to postgres;

comment on function public.protect_nutrition_days_coach_columns() is
  'Limite l''UPDATE élève de nutrition_days aux colonnes status et actual. plan_id, day, week_start_date, target et profile_key sont restaurés à leur valeur d''origine pour un non-staff.';

-- ────────────────────────────────────────────────────────────────────────────
-- H. Le profil PRINCIPAL n'est plus forcément nommé « default »
-- ────────────────────────────────────────────────────────────────────────────
-- `nutrition_plan_v2_blocking_issue` (20260806090000:145-151) cherchait
-- EXCLUSIVEMENT `profile_key = 'default'`. Un plan converti par cette
-- migration porte `legacy_default` : sans ce correctif, tout ancien plan
-- deviendrait « non assignable » avec le code `missing_default_profile`, et
-- le coach ne pourrait plus l'attribuer à son élève.
--
-- L'ordre de choix est le MÊME que celui de `nutrition_v2_backfill_plan` et
-- de `save_nutrition_plan_v2` : `default`, puis `legacy_default`, puis le
-- premier par ordre alphabétique. Trois endroits, une seule règle.
create or replace function public.nutrition_plan_v2_blocking_issue(p_plan_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  c_total constant integer := 10000;
  v_profile record;
  v_actifs int;
  v_orphelin int;
  v_somme int;
begin
  select p.id, p.daily_calories, p.protein_bp, p.carb_bp, p.fat_bp
    into v_profile
    from public.nutrition_plan_profiles p
   where p.plan_id = p_plan_id
   order by
     case p.profile_key
       when 'default' then 0
       when 'legacy_default' then 1
       else 2
     end,
     p.profile_key
   limit 1;

  if not found then
    return 'missing_default_profile';
  end if;

  if v_profile.daily_calories is null or v_profile.daily_calories <= 0 then
    return 'calories_not_positive';
  end if;

  if coalesce(v_profile.protein_bp, 0) + coalesce(v_profile.carb_bp, 0)
     + coalesce(v_profile.fat_bp, 0) <> c_total then
    return 'daily_split_incomplete';
  end if;

  select count(*) into v_actifs
    from public.nutrition_meal_slot_targets s
   where s.profile_id = v_profile.id and s.enabled;

  if v_actifs = 0 then
    return 'no_enabled_slot';
  end if;

  select count(*) into v_orphelin
    from public.nutrition_meal_slot_targets s
   where s.profile_id = v_profile.id
     and not s.enabled
     and (coalesce(s.protein_bp, 0) <> 0 or coalesce(s.carb_bp, 0) <> 0
          or coalesce(s.fat_bp, 0) <> 0);

  if v_orphelin > 0 then
    return 'disabled_slot_with_allocation';
  end if;

  select coalesce(sum(s.protein_bp), 0) into v_somme
    from public.nutrition_meal_slot_targets s where s.profile_id = v_profile.id;
  if v_somme <> c_total then
    return 'protein_split_incomplete';
  end if;

  select coalesce(sum(s.carb_bp), 0) into v_somme
    from public.nutrition_meal_slot_targets s where s.profile_id = v_profile.id;
  if v_somme <> c_total then
    return 'carb_split_incomplete';
  end if;

  select coalesce(sum(s.fat_bp), 0) into v_somme
    from public.nutrition_meal_slot_targets s where s.profile_id = v_profile.id;
  if v_somme <> c_total then
    return 'fat_split_incomplete';
  end if;

  return null;
end;
$fn$;

alter function public.nutrition_plan_v2_blocking_issue(uuid) owner to postgres;

comment on function public.nutrition_plan_v2_blocking_issue(uuid) is
  'Miroir SQL de validatePlanV2Assignable. Retourne NULL si le plan v2 est assignable, sinon le code du premier problème. Le profil examiné est le PRINCIPAL : default, puis legacy_default, puis le premier par ordre alphabétique — même règle que la conversion et que save_nutrition_plan_v2. Fonction de lecture, security invoker, search_path vide.';

revoke all on function public.nutrition_plan_v2_blocking_issue(uuid) from public;
revoke execute on function public.nutrition_plan_v2_blocking_issue(uuid) from anon;
grant execute on function public.nutrition_plan_v2_blocking_issue(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Contrôle final
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_plans int;
  v_incomplets int;
begin
  select count(*) into v_plans from public.nutrition_plans;

  select count(*) into v_incomplets
    from public.nutrition_plans p
   where (select count(*) from public.nutrition_days d where d.plan_id = p.id) <> 7;
  if v_incomplets > 0 then
    raise exception 'MIGRATION IMPOSSIBLE : % plan(s) n''ont pas exactement sept jours.', v_incomplets;
  end if;

  raise notice 'Unification v2 terminée : % plan(s), 7 jours chacun, tous rattachés à un profil valide.', v_plans;
end $$;
