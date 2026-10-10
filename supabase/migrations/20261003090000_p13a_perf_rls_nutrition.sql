-- ════════════════════════════════════════════════════════════════════════════
-- P13-A — CORRECTIF DE PERFORMANCE DES POLICIES (timeout 57014 à la sauvegarde)
-- ════════════════════════════════════════════════════════════════════════════
--
-- LE PROBLÈME, MESURÉ EN PRODUCTION
-- ─────────────────────────────────
-- `POST /rest/v1/rpc/save_nutrition_plan_v2` meurt en `57014 canceling
-- statement due to statement timeout`. La cause N'EST PAS la RPC : c'est le
-- coût des policies posées par 20261002090000.
--
-- L'ancienne policy disait `is_coach_or_admin()` — une fonction SANS ARGUMENT.
-- PostgreSQL la reconnaît comme constante pour la durée de l'instruction et la
-- hisse en « One-Time Filter » : UNE évaluation, quel que soit le nombre de
-- lignes. Mesuré sur `meal_choice_slots` (3 312 lignes) : 5,6 ms.
--
-- La nouvelle policy dit `can_manage_meal(meal_id)` — une fonction qui DÉPEND
-- DE LA LIGNE. Elle ne peut donc pas être hissée : elle s'exécute une fois PAR
-- LIGNE, et chaque appel ouvre lui-même une requête sur `meals`, puis
-- `nutrition_days`, puis `nutrition_plans`. Mesuré sur les mêmes 3 312
-- lignes : 1 786 ms. Soit ~320× le coût précédent.
--
-- Sur `meal_choice_options` (25 191 lignes en production), une simple lecture
-- par l'administrateur prenait 5 311 ms — pour UNE table. La sauvegarde d'un
-- plan en touche plusieurs, en suppression puis en réinsertion : le total
-- dépasse les 8 s de `statement_timeout` du rôle `authenticated`.
--
-- CE QUI A ÉTÉ ESSAYÉ ET ÉCARTÉ, AVEC LES MESURES
-- ───────────────────────────────────────────────
--   * `(select public.is_admin())` seul (hissage en InitPlan) : 5 311 → 3 880 ms.
--     Insuffisant — le planificateur place les sous-plans coûteux AVANT
--     l'InitPlan dans le OU, donc l'administrateur paie quand même la chaîne.
--   * `alter function … cost 100000` pour forcer l'ordre du OU : 4 096 ms.
--     Insuffisant pour la même raison.
--   * Déplier la chaîne en jointures DANS la policy : 7 507 ms, soit PIRE —
--     référencer une table dans une policy réapplique la RLS de cette table,
--     et la chaîne se rejoue à chaque niveau.
--
-- LA CORRECTION RETENUE, MESURÉE : 5 311 → 512 ms
-- ────────────────────────────────────────────────
-- On revient à ce qui rendait l'ancienne policy rapide — un prédicat SANS
-- ARGUMENT, évalué une seule fois — sans rien céder sur la règle.
--
-- Chaque fonction ci-dessous rend l'ENSEMBLE des identifiants que
-- l'utilisateur courant a le droit de gérer. Elle ne prend aucun argument :
-- PostgreSQL l'évalue donc UNE FOIS par instruction et garde le résultat dans
-- une table de hachage, puis chaque ligne ne coûte qu'une recherche.
-- Elles sont SECURITY DEFINER, ce qui évite en outre de réappliquer la RLS des
-- tables jointes à l'intérieur du prédicat.
--
-- LA RÈGLE DE PROPRIÉTÉ EST INCHANGÉE, AU MOT PRÈS :
--   plan affecté  → `is_coach_of_student(student_id)` ;
--   plan modèle   → `coach_id = current_coach_id()`, avec IS NOT NULL ;
--   l'élève sans coach reste invisible de tout coach ;
--   l'administrateur garde son accès global ;
--   les policies de lecture élève ne sont pas touchées.
-- Seule la FORME D'ÉVALUATION change. Aucun droit n'est élargi.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. LES ENSEMBLES GÉRABLES, CALCULÉS UNE FOIS PAR INSTRUCTION ───────────

create or replace function public.nutrition_plan_ids_geres()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
    from public.nutrition_plans p
   where (p.student_id is not null and public.is_coach_of_student(p.student_id))
      or (p.student_id is null
          and p.coach_id is not null
          and p.coach_id = public.current_coach_id());
$$;

comment on function public.nutrition_plan_ids_geres() is
  'P13-A/perf. Les plans que le coach courant possède. Sans argument : évalué une seule fois par instruction. Même règle que can_manage_nutrition_plan, forme ensembliste.';

create or replace function public.nutrition_day_ids_geres()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id
    from public.nutrition_days d
   where d.plan_id in (select public.nutrition_plan_ids_geres());
$$;

comment on function public.nutrition_day_ids_geres() is
  'P13-A/perf. Les jours des plans gérés par le coach courant.';

create or replace function public.meal_ids_geres()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.id
    from public.meals m
   where m.nutrition_day_id in (select public.nutrition_day_ids_geres());
$$;

comment on function public.meal_ids_geres() is
  'P13-A/perf. Les repas prescrits des plans gérés par le coach courant.';

create or replace function public.meal_choice_slot_ids_geres()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id
    from public.meal_choice_slots s
   where s.meal_id in (select public.meal_ids_geres());
$$;

comment on function public.meal_choice_slot_ids_geres() is
  'P13-A/perf. Les créneaux de choix des plans gérés par le coach courant.';

create or replace function public.nutrition_plan_profile_ids_geres()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pr.id
    from public.nutrition_plan_profiles pr
   where pr.plan_id in (select public.nutrition_plan_ids_geres());
$$;

comment on function public.nutrition_plan_profile_ids_geres() is
  'P13-A/perf. Les profils des plans gérés par le coach courant.';

create or replace function public.student_ids_geres()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id
    from public.students s
   where s.coach_id is not null
     and s.coach_id = public.current_coach_id();
$$;

comment on function public.student_ids_geres() is
  'P13-A/perf. Les élèves du coach courant. Même règle que is_coach_of_student, forme ensembliste.';

-- Mêmes précautions que les fonctions de 20261002090000 : `pg_temp` nommé en
-- dernier, droit d'exécution retiré à public et anon.
do $$
declare f text;
begin
  foreach f in array array[
    'nutrition_plan_ids_geres','nutrition_day_ids_geres','meal_ids_geres',
    'meal_choice_slot_ids_geres','nutrition_plan_profile_ids_geres','student_ids_geres'
  ] loop
    execute format('revoke all on function public.%I() from public', f);
    execute format('revoke all on function public.%I() from anon', f);
    execute format('grant execute on function public.%I() to authenticated', f);
  end loop;
end $$;


-- ── 2. LES POLICIES, REFORMULÉES SANS CHANGER LA RÈGLE ─────────────────────
-- `(select public.is_admin())` : hissé en InitPlan, évalué une fois.
-- `x in (select …_geres())`    : ensemble haché, évalué une fois.

-- nutrition_plans ----------------------------------------------------------
drop policy if exists "nutrition_plans_manage_admin" on public.nutrition_plans;
create policy "nutrition_plans_manage_admin"
  on public.nutrition_plans for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "nutrition_plans_select_own_coach" on public.nutrition_plans;
create policy "nutrition_plans_select_own_coach"
  on public.nutrition_plans for select to authenticated
  using (
    (student_id is not null and student_id in (select public.student_ids_geres()))
    or (student_id is null
        and coach_id is not null
        and coach_id = (select public.current_coach_id()))
  );

drop policy if exists "nutrition_plans_insert_own_coach" on public.nutrition_plans;
create policy "nutrition_plans_insert_own_coach"
  on public.nutrition_plans for insert to authenticated
  with check (
    (student_id is not null and student_id in (select public.student_ids_geres()))
    or (student_id is null
        and coach_id is not null
        and coach_id = (select public.current_coach_id()))
  );

drop policy if exists "nutrition_plans_update_own_coach" on public.nutrition_plans;
create policy "nutrition_plans_update_own_coach"
  on public.nutrition_plans for update to authenticated
  using (
    (student_id is not null and student_id in (select public.student_ids_geres()))
    or (student_id is null
        and coach_id is not null
        and coach_id = (select public.current_coach_id()))
  )
  with check (
    (student_id is not null and student_id in (select public.student_ids_geres()))
    or (student_id is null
        and coach_id is not null
        and coach_id = (select public.current_coach_id()))
  );

drop policy if exists "nutrition_plans_delete_own_coach" on public.nutrition_plans;
create policy "nutrition_plans_delete_own_coach"
  on public.nutrition_plans for delete to authenticated
  using (
    student_id is null
    and coach_id is not null
    and coach_id = (select public.current_coach_id())
  );

-- nutrition_days -----------------------------------------------------------
drop policy if exists "nutrition_days_manage_admin" on public.nutrition_days;
create policy "nutrition_days_manage_admin"
  on public.nutrition_days for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "nutrition_days_manage_own_coach" on public.nutrition_days;
create policy "nutrition_days_manage_own_coach"
  on public.nutrition_days for all to authenticated
  using (plan_id in (select public.nutrition_plan_ids_geres()))
  with check (plan_id in (select public.nutrition_plan_ids_geres()));

-- nutrition_plan_profiles --------------------------------------------------
drop policy if exists "nutrition_plan_profiles_manage_admin" on public.nutrition_plan_profiles;
create policy "nutrition_plan_profiles_manage_admin"
  on public.nutrition_plan_profiles for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "nutrition_plan_profiles_manage_own_coach" on public.nutrition_plan_profiles;
create policy "nutrition_plan_profiles_manage_own_coach"
  on public.nutrition_plan_profiles for all to authenticated
  using (plan_id in (select public.nutrition_plan_ids_geres()))
  with check (plan_id in (select public.nutrition_plan_ids_geres()));

-- nutrition_meal_slot_targets ----------------------------------------------
drop policy if exists "nutrition_meal_slot_targets_manage_admin" on public.nutrition_meal_slot_targets;
create policy "nutrition_meal_slot_targets_manage_admin"
  on public.nutrition_meal_slot_targets for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "nutrition_meal_slot_targets_manage_own_coach" on public.nutrition_meal_slot_targets;
create policy "nutrition_meal_slot_targets_manage_own_coach"
  on public.nutrition_meal_slot_targets for all to authenticated
  using (profile_id in (select public.nutrition_plan_profile_ids_geres()))
  with check (profile_id in (select public.nutrition_plan_profile_ids_geres()));

-- meals --------------------------------------------------------------------
drop policy if exists "meals_manage_admin" on public.meals;
create policy "meals_manage_admin"
  on public.meals for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "meals_manage_own_coach" on public.meals;
create policy "meals_manage_own_coach"
  on public.meals for all to authenticated
  using (nutrition_day_id in (select public.nutrition_day_ids_geres()))
  with check (nutrition_day_id in (select public.nutrition_day_ids_geres()));

-- meal_choice_slots --------------------------------------------------------
drop policy if exists "meal_choice_slots_manage_admin" on public.meal_choice_slots;
create policy "meal_choice_slots_manage_admin"
  on public.meal_choice_slots for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- La garde `source_list_id` est CONSERVÉE telle quelle.
drop policy if exists "meal_choice_slots_manage_own_coach" on public.meal_choice_slots;
create policy "meal_choice_slots_manage_own_coach"
  on public.meal_choice_slots for all to authenticated
  using (meal_id in (select public.meal_ids_geres()))
  with check (
    meal_id in (select public.meal_ids_geres())
    and (
      source_list_id is null
      or exists (
        select 1 from public.food_lists fl
         where fl.id = meal_choice_slots.source_list_id
           and fl.coach_id = (select public.current_coach_id()))
    )
  );

-- meal_choice_options ------------------------------------------------------
drop policy if exists "meal_choice_options_manage_admin" on public.meal_choice_options;
create policy "meal_choice_options_manage_admin"
  on public.meal_choice_options for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "meal_choice_options_manage_own_coach" on public.meal_choice_options;
create policy "meal_choice_options_manage_own_coach"
  on public.meal_choice_options for all to authenticated
  using (slot_id in (select public.meal_choice_slot_ids_geres()))
  with check (slot_id in (select public.meal_choice_slot_ids_geres()));

-- nutrition_daily_logs -----------------------------------------------------
drop policy if exists "nutrition_daily_logs_manage_admin" on public.nutrition_daily_logs;
create policy "nutrition_daily_logs_manage_admin"
  on public.nutrition_daily_logs for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "nutrition_daily_logs_manage_own_student" on public.nutrition_daily_logs;
create policy "nutrition_daily_logs_manage_own_student"
  on public.nutrition_daily_logs for all to authenticated
  using (student_id = (select public.current_student_id()))
  with check (student_id = (select public.current_student_id()));

drop policy if exists "nutrition_daily_logs_manage_own_coach" on public.nutrition_daily_logs;
create policy "nutrition_daily_logs_manage_own_coach"
  on public.nutrition_daily_logs for all to authenticated
  using (student_id in (select public.student_ids_geres()))
  with check (student_id in (select public.student_ids_geres()));


-- ── 3. NETTOYAGE DU statement_timeout POSÉ À LA MAIN ───────────────────────
-- Un `alter function public.save_nutrition_plan_v2(jsonb) set statement_timeout
-- = '30s'` avait été appliqué manuellement sur la production pour tenter de
-- contourner le 57014. Il est INOPÉRANT, et il faut le dire précisément :
-- PostgreSQL arme le minuteur au démarrage de l'instruction de plus haut
-- niveau — l'enveloppe `WITH pgrst_source AS (…)` que PostgREST construit. Le
-- `SET` de la fonction n'est appliqué qu'à l'ENTRÉE dans le corps, donc APRÈS
-- l'armement, et changer `statement_timeout` en cours d'instruction ne réarme
-- pas un minuteur déjà programmé. La valeur qui gouverne reste celle du rôle
-- `authenticated` (8 s). Mesure à l'appui : `pg_stat_statements` plafonnait
-- cette RPC à 7 951 ms, jamais 30 000.
--
-- Le laisser en place serait pire qu'inutile : il ferait croire à une marge qui
-- n'existe pas. On le retire donc — et SEULEMENT lui.
--
-- `reset` nomme UN paramètre : le `search_path = ''` de la fonction, posé par
-- la migration 20260812090000, n'est pas touché. Un `reset all` l'aurait
-- effacé, ce qui aurait rouvert un risque de détournement par search_path sur
-- une fonction qui écrit tout le domaine nutrition.
alter function public.save_nutrition_plan_v2(jsonb) reset statement_timeout;


-- ── 4. CE QUI N'EST PAS TOUCHÉ ─────────────────────────────────────────────
-- Les policies de LECTURE ÉLÈVE : intactes, à l'identique.
-- `can_manage_nutrition_plan` / `_nutrition_day` / `can_manage_meal` : NI
-- supprimées NI modifiées. Elles ne sont simplement plus le chemin des
-- policies ; elles restent la formulation lisible de la règle, et la checklist
-- P13-A continue de les interroger (contrôles C11 à C13).
-- Aucun grant de table, aucun changement de schéma, aucun délai modifié.
