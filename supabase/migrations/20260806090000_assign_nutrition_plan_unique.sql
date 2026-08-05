-- ============================================================================
-- Migration 20260806090000 — assignation nutrition : RPC transactionnelle
-- `assign_nutrition_plan` + invariant d'unicité en base
-- (chantier fix/nutrition-single-assigned-plan).
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
-- Bug constaté en Preview : DEUX plans nutritionnels assignés au même élève,
-- tous deux affichés « ACTIF » côté élève.
--
-- Trois causes cumulées, toutes reproduites par test avant écriture de cette
-- migration :
--
--   1. `setNutritionAssignment` (lib/supabase/nutrition.ts) fait un UPDATE sur
--      LE SEUL plan ciblé. Elle ne regarde jamais les autres plans de l'élève.
--   2. La garde applicative `guardNutritionAssignment` répond à la question
--      « ce plan est-il complet ? », jamais « cet élève a-t-il déjà un plan ? ».
--   3. AUCUN invariant en base : `nutrition_plans` ne portait qu'un index, sa
--      clé primaire sur `id`. Rien — ni contrainte, ni index — n'empêchait N
--      lignes de partager le même `student_id`.
--
-- `nutrition_plans.status` ('actif' | 'ancien' | 'prochain') est le statut
-- ÉDITORIAL du plan, sans rapport avec l'assignation : deux plans « actif »
-- assignés au même élève étaient parfaitement légaux pour la base.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE FAIT CETTE MIGRATION
-- ────────────────────────────────────────────────────────────────────────────
--   A. elle CRÉE `public.assign_nutrition_plan(p_plan_id uuid,
--      p_student_id uuid)` : point d'écriture UNIQUE et TRANSACTIONNEL de
--      l'assignation nutrition. Elle verrouille, valide, désassigne les
--      autres plans de l'élève puis assigne le plan choisi — en une seule
--      transaction, sans fenêtre où l'élève se retrouve sans plan ;
--   B. elle CRÉE `public.unassign_nutrition_plan(p_plan_id uuid)` : retrait
--      volontaire, toujours autorisé, même sur un plan invalide ;
--   C. elle CRÉE l'index unique partiel
--      `nutrition_plans_one_plan_per_student` — UNIQUE (student_id)
--      WHERE student_id IS NOT NULL — mais UNIQUEMENT après avoir vérifié
--      qu'aucun doublon n'existe déjà.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - elle ne SUPPRIME aucune ligne et ne CHOISIT arbitrairement aucun plan
--     en cas de doublon existant : elle ÉCHOUE, bruyamment, en listant les
--     élèves concernés. La régularisation est une décision métier du coach,
--     pas d'une migration (voir le runbook) ;
--   - elle ne modifie AUCUNE migration déjà appliquée ;
--   - elle ne touche NI `assignments` (programmes) NI `document_assignments`
--     (documents) : aucune régression possible de ce côté ;
--   - elle ne recrée PAS `save_nutrition_plan_v2` : la sauvegarde d'un plan
--     et son assignation restent deux opérations distinctes.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CONVENTIONS DU PROJET, RESPECTÉES À L'IDENTIQUE
-- ────────────────────────────────────────────────────────────────────────────
-- `security invoker` · `set search_path = ''` · relations qualifiées
-- `public.*` · garde `public.is_coach_or_admin()` · propriétaire `postgres` ·
-- `revoke all … from public`, `revoke execute … from anon`,
-- `grant execute … to authenticated`.
--
-- Le mode `security invoker` est volontaire : les policies RLS de
-- `nutrition_plans` (`nutrition_plans_manage_staff`, elle-même adossée à
-- `is_coach_or_admin()`) restent la deuxième barrière. Un élève authentifié
-- qui appellerait la RPC serait refusé deux fois — par la garde explicite,
-- puis par RLS.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. Vérification PRÉALABLE des doublons — la migration échoue clairement
-- ────────────────────────────────────────────────────────────────────────────
-- Aucune ligne n'est supprimée, aucune n'est choisie : si l'état actuel viole
-- déjà l'invariant, l'opérateur doit trancher lui-même, plan par plan.
do $$
declare
  v_eleves text;
  v_nb int;
begin
  select count(*), string_agg(format('élève %s : %s plans', student_id, n), E'\n  ')
    into v_nb, v_eleves
    from (
      select student_id, count(*) as n
        from public.nutrition_plans
       where student_id is not null
       group by student_id
      having count(*) > 1
    ) doublons;

  if coalesce(v_nb, 0) > 0 then
    raise exception E'MIGRATION IMPOSSIBLE — % élève(s) ont déjà plusieurs plans nutritionnels assignés :\n  %\n\nAucune ligne n''a été modifiée. Régularisez manuellement (un seul plan par élève) puis rejouez cette migration. Requête de diagnostic :\n  select student_id, count(*), array_agg(id) from public.nutrition_plans where student_id is not null group by student_id having count(*) > 1;',
      v_nb, v_eleves;
  end if;

  raise notice 'Aucun doublon student_id : l''invariant peut être posé.';
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- B. L'invariant : un élève, au plus un plan nutritionnel assigné
-- ────────────────────────────────────────────────────────────────────────────
-- Index unique PARTIEL : `student_id is null` (plan non assigné) reste
-- possible pour autant de plans qu'on veut — c'est le cas normal d'une
-- bibliothèque de plans. Seules les lignes réellement assignées sont
-- contraintes.
--
-- Cet index sert aussi d'accès : `nutrition_plans` n'en avait AUCUN sur
-- `student_id`, alors que toutes les lectures de l'espace élève filtrent
-- dessus (`getAssignedNutritionPlansForStudent`).
create unique index if not exists nutrition_plans_one_plan_per_student
  on public.nutrition_plans (student_id)
  where student_id is not null;

comment on index public.nutrition_plans_one_plan_per_student is
  'INVARIANT : un élève ne peut avoir qu''un seul plan nutritionnel assigné à la fois. Partiel : les plans non assignés (student_id null) ne sont pas contraints. Passer par public.assign_nutrition_plan() plutôt que d''écrire student_id directement.';

-- ────────────────────────────────────────────────────────────────────────────
-- C. Validation v2 en SQL — miroir exact de validatePlanV2Assignable
-- ────────────────────────────────────────────────────────────────────────────
-- Fonction INTERNE, réutilisée par la RPC d'assignation. Elle reproduit les
-- règles de lib/nutrition/plan-v2-validation.ts :
--   - le profil « default » existe ;
--   - calories quotidiennes strictement positives ;
--   - protein_bp + carb_bp + fat_bp = 10 000 ;
--   - au moins un créneau activé ;
--   - aucun créneau désactivé ne porte d'allocation non nulle ;
--   - pour CHAQUE macro, la somme sur les créneaux vaut exactement 10 000.
-- Retourne NULL si le plan est assignable, sinon le code du premier problème.
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
     and p.profile_key = 'default';

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
  'Miroir SQL de validatePlanV2Assignable (lib/nutrition/plan-v2-validation.ts). Retourne NULL si le plan v2 est assignable, sinon le code du premier problème bloquant. Fonction de lecture, security invoker, search_path vide.';

revoke all on function public.nutrition_plan_v2_blocking_issue(uuid) from public;
revoke execute on function public.nutrition_plan_v2_blocking_issue(uuid) from anon;
grant execute on function public.nutrition_plan_v2_blocking_issue(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- D. La RPC d'assignation — point d'écriture unique et transactionnel
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.assign_nutrition_plan(p_plan_id uuid, p_student_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_plan record;
  v_issue text;
  v_retires uuid[] := array[]::uuid[];
  v_row record;
begin
  -- ── 0. Autorisation ───────────────────────────────────────────────────
  if not public.is_coach_or_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_plan_id is null or p_student_id is null then
    raise exception 'INVALID_ARGUMENT: p_plan_id et p_student_id sont obligatoires';
  end if;

  -- ── 1. VERROUILLAGE ───────────────────────────────────────────────────
  -- Toutes les lignes concernées — le plan cible ET les plans déjà assignés
  -- à cet élève — sont verrouillées EN UNE SEULE instruction, triées par
  -- `id`. L'ordre commun évite les interblocages entre deux assignations
  -- concurrentes qui se croiseraient sur les mêmes lignes.
  perform 1
     from public.nutrition_plans np
    where np.id = p_plan_id or np.student_id = p_student_id
    order by np.id
      for update;

  -- ── 2. VALIDATION COMPLÈTE, AVANT TOUTE ÉCRITURE ──────────────────────
  -- Rien n'est modifié tant que le plan n'est pas déclaré assignable : un
  -- refus laisse l'ancien plan de l'élève exactement en place.
  select np.id, np.name, np.status, np.student_id, np.nutrition_model_version
    into v_plan
    from public.nutrition_plans np
   where np.id = p_plan_id;

  if not found then
    raise exception 'PLAN_NOT_FOUND: %', p_plan_id using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.students s where s.id = p_student_id) then
    raise exception 'STUDENT_NOT_FOUND: %', p_student_id using errcode = 'P0002';
  end if;

  -- Plan v2 : validation canonique. Plan v1 : règles actuelles inchangées,
  -- toujours assignable (un plan historique n'a ni profil ni créneau).
  if v_plan.nutrition_model_version = 2 then
    v_issue := public.nutrition_plan_v2_blocking_issue(p_plan_id);
    if v_issue is not null then
      raise exception 'PLAN_NOT_ASSIGNABLE: %', v_issue using errcode = '23514';
    end if;
  end if;

  -- ── 3. RETRAIT des autres plans de cet élève ──────────────────────────
  -- AVANT l'assignation, pour ne jamais violer transitoirement l'index
  -- unique partiel. Le plan cible est explicitement exclu : réassigner le
  -- même plan au même élève est IDEMPOTENT et ne le désassigne jamais.
  for v_row in
    update public.nutrition_plans np
       set student_id = null,
           updated_at = now()
     where np.student_id = p_student_id
       and np.id <> p_plan_id
    returning np.id
  loop
    v_retires := array_append(v_retires, v_row.id);
  end loop;

  -- ── 4. ASSIGNATION du plan choisi ─────────────────────────────────────
  update public.nutrition_plans np
     set student_id = p_student_id,
         updated_at = now()
   where np.id = p_plan_id
     and (np.student_id is distinct from p_student_id);

  -- ── 5. Retour canonique ───────────────────────────────────────────────
  select np.id, np.name, np.status, np.student_id, np.nutrition_model_version
    into v_plan
    from public.nutrition_plans np
   where np.id = p_plan_id;

  return jsonb_build_object(
    'plan', jsonb_build_object(
      'id', v_plan.id,
      'name', v_plan.name,
      'status', v_plan.status,
      'student_id', v_plan.student_id,
      'nutrition_model_version', v_plan.nutrition_model_version
    ),
    'unassigned_plan_ids', to_jsonb(v_retires),
    'assigned', true
  );
end;
$fn$;

alter function public.assign_nutrition_plan(uuid, uuid) owner to postgres;

comment on function public.assign_nutrition_plan(uuid, uuid) is
  'Assignation ATOMIQUE d''un plan nutritionnel à un élève : verrouillage des lignes concernées, validation complète AVANT toute écriture (plan v2 : profil default, calories positives, répartitions à 10 000 ; plan v1 : règles inchangées), retrait des autres plans de l''élève, puis assignation — dans UNE transaction. Idempotente. security invoker, search_path vide, garde is_coach_or_admin, EXECUTE réservé à authenticated. Point d''écriture UNIQUE de nutrition_plans.student_id.';

revoke all on function public.assign_nutrition_plan(uuid, uuid) from public;
revoke execute on function public.assign_nutrition_plan(uuid, uuid) from anon;
grant execute on function public.assign_nutrition_plan(uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- E. Le retrait volontaire — toujours autorisé
-- ────────────────────────────────────────────────────────────────────────────
-- Un plan devenu invalide doit pouvoir être retiré, sans quoi l'élève
-- resterait prisonnier d'un plan qu'on ne peut plus corriger. Aucune
-- validation v2 ici, volontairement.
create or replace function public.unassign_nutrition_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_plan record;
begin
  if not public.is_coach_or_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_plan_id is null then
    raise exception 'INVALID_ARGUMENT: p_plan_id est obligatoire';
  end if;

  update public.nutrition_plans np
     set student_id = null,
         updated_at = now()
   where np.id = p_plan_id
     and np.student_id is not null;

  select np.id, np.name, np.status, np.student_id, np.nutrition_model_version
    into v_plan
    from public.nutrition_plans np
   where np.id = p_plan_id;

  if not found then
    raise exception 'PLAN_NOT_FOUND: %', p_plan_id using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'plan', jsonb_build_object(
      'id', v_plan.id,
      'name', v_plan.name,
      'status', v_plan.status,
      'student_id', v_plan.student_id,
      'nutrition_model_version', v_plan.nutrition_model_version
    ),
    'unassigned_plan_ids', to_jsonb(array[]::uuid[]),
    'assigned', false
  );
end;
$fn$;

alter function public.unassign_nutrition_plan(uuid) owner to postgres;

comment on function public.unassign_nutrition_plan(uuid) is
  'Retrait d''assignation d''un plan nutritionnel. TOUJOURS autorisé, y compris sur un plan invalide — sans quoi un élève resterait prisonnier d''un plan qu''on ne peut plus corriger. Idempotent. security invoker, search_path vide, garde is_coach_or_admin, EXECUTE réservé à authenticated.';

revoke all on function public.unassign_nutrition_plan(uuid) from public;
revoke execute on function public.unassign_nutrition_plan(uuid) from anon;
grant execute on function public.unassign_nutrition_plan(uuid) to authenticated;
