-- ════════════════════════════════════════════════════════════════════════════
-- P13-A — LES POLICIES DE LECTURE ÉLÈVE CESSENT DE TRAVERSER LA RLS
-- (suite de 20261003090000 et 20261003190000)
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUI RESTAIT CASSÉ
--
-- Après la garde admin de 20261003190000, créer un plan marchait, mais
-- RÉENREGISTRER un plan déjà rempli échouait toujours en 57014. Le plan NAILA
-- compte 7 jours, 35 repas, 133 occurrences et 1 127 options ; le plan qui
-- passait, lui, n'avait aucun repas. `save_nutrition_plan_v2` écrit ligne à
-- ligne : ~1 127 INSERT d'une ligne, plus un DELETE et un UPDATE par
-- occurrence, plus un DELETE et un UPDATE par repas. Soit ~1 300 instructions
-- pour un budget de 8 s.
--
-- L'INSERT d'une ligne était redescendu à 0,83 ms : ce n'était plus lui.
-- C'est l'UPDATE et le DELETE par occurrence qui coûtaient, mesurés sur la
-- production à 22 ms chacun en régime établi, et 65 à 90 ms sur les six
-- premiers appels — plpgsql reconstruit un plan personnalisé cinq fois avant
-- de basculer sur un plan générique, et chaque reconstruction coûtait ici
-- 107 ms de PLANIFICATION. Le même UPDATE, RLS désactivée : 0,73 ms.
--
-- LA CAUSE
--
-- Les policies de lecture ÉLÈVE étaient écrites en EXISTS corrélés :
--
--   exists (select 1 from meal_choice_slots s
--             join meals m            on m.id = s.meal_id
--             join nutrition_days d   on d.id = m.nutrition_day_id
--             join nutrition_plans p  on p.id = d.plan_id
--            where s.id = meal_choice_options.slot_id
--              and p.student_id = current_student_id()
--              and p.status <> 'prochain')
--
-- Référencer une table dans une policy RÉAPPLIQUE la RLS de cette table. Les
-- quatre tables traversées ont chacune trois policies, qui en référencent
-- d'autres, et ainsi de suite : le plan d'un UPDATE de neuf lignes explosait
-- à ~576 nœuds. PostgreSQL exécute cette chaîne UNE FOIS PAR LIGNE, et la
-- replanifie à chaque plan personnalisé.
--
-- Ces policies sont aussi évaluées sur un UPDATE et un DELETE : pour modifier
-- une ligne, PostgreSQL doit d'abord pouvoir la LIRE. Un administrateur, qui
-- n'est pas élève, payait donc intégralement le prix d'une règle qui ne
-- pouvait de toute façon jamais lui être vraie.
--
-- CE QUI EST FAIT ICI
--
-- 1. Cinq ensembles SANS ARGUMENT, en SECURITY DEFINER : la jointure est
--    faite UNE FOIS, à l'intérieur de la fonction, donc sans réappliquer la
--    RLS des tables traversées. Même forme que les six ensembles coach de
--    20261003090000.
-- 2. Chaque policy élève devient `x in (select public.…_ids_eleve())`,
--    précédée de la garde `(select public.current_student_id()) is not null`.
--
-- POURQUOI LA RÈGLE D'ACCÈS EST INCHANGÉE
--
-- Toutes ces policies se terminaient sur `p.student_id = current_student_id()
-- and p.status <> 'prochain'`. Les fonctions encodent exactement ce prédicat.
-- Quand `current_student_id()` vaut NULL — tout utilisateur qui n'est pas un
-- élève — la comparaison `p.student_id = NULL` donne NULL, donc l'EXISTS ne
-- pouvait DÉJÀ jamais être vrai : la garde ne retire rien, elle dit d'emblée
-- ce que la chaîne aurait mis des millisecondes à découvrir. Et comme
-- `current_student_id()` est STABLE, `(select …)` la hisse en InitPlan :
-- évaluée une fois par instruction au lieu d'une fois par ligne.
--
-- VÉRIFICATION FAITE AVANT APPLICATION
--
-- Dans une transaction annulée sur la production : relevé de TOUS les
-- identifiants visibles sur les 7 tables, pour 3 élèves réels et pour
-- l'administrateur, AVANT puis APRÈS le changement. Différence symétrique :
-- 0 écart sur 1 213 lignes visibles et 19 couples (identité, table) non vides.
-- Mesures après application : planification 107 ms → 1,7 ms ; UPDATE 87,8 ms
-- → 11,4 ms ; DELETE 45 ms → 13,6 ms ; et les sous-plans des trois branches
-- apparaissent « never executed » pour l'administrateur.
--
-- Aucune policy n'est supprimée, aucune permission n'est élargie, aucun
-- `WITH CHECK` n'est touché, aucun délai PostgreSQL n'est modifié.


-- ── 1. LES CINQ ENSEMBLES ÉLÈVE ────────────────────────────────────────────
-- SANS ARGUMENT : un argument restaurerait l'évaluation par ligne, qui est
-- exactement ce que cette migration supprime.
-- `pg_temp` est nommé EN DERNIER : sur une fonction SECURITY DEFINER, ne pas
-- le nommer le placerait en tête et un objet temporaire pourrait masquer les
-- tables utilisées ici.

create or replace function public.nutrition_plan_ids_eleve() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $f$
  select p.id from public.nutrition_plans p
   where p.student_id = public.current_student_id()
     and p.status <> 'prochain';
$f$;

create or replace function public.nutrition_day_ids_eleve() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $f$
  select d.id from public.nutrition_days d
   join public.nutrition_plans p on p.id = d.plan_id
   where p.student_id = public.current_student_id()
     and p.status <> 'prochain';
$f$;

create or replace function public.nutrition_plan_profile_ids_eleve() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $f$
  select pr.id from public.nutrition_plan_profiles pr
   join public.nutrition_plans p on p.id = pr.plan_id
   where p.student_id = public.current_student_id()
     and p.status <> 'prochain';
$f$;

create or replace function public.meal_ids_eleve() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $f$
  select m.id from public.meals m
   join public.nutrition_days d on d.id = m.nutrition_day_id
   join public.nutrition_plans p on p.id = d.plan_id
   where p.student_id = public.current_student_id()
     and p.status <> 'prochain';
$f$;

create or replace function public.meal_choice_slot_ids_eleve() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $f$
  select s.id from public.meal_choice_slots s
   join public.meals m on m.id = s.meal_id
   join public.nutrition_days d on d.id = m.nutrition_day_id
   join public.nutrition_plans p on p.id = d.plan_id
   where p.student_id = public.current_student_id()
     and p.status <> 'prochain';
$f$;

-- `anon` a le droit TEMP et pourrait appeler ces fonctions : on le lui retire,
-- comme pour les six ensembles coach.
do $$
declare f text;
begin
  foreach f in array array[
    'nutrition_plan_ids_eleve','nutrition_day_ids_eleve',
    'nutrition_plan_profile_ids_eleve','meal_ids_eleve','meal_choice_slot_ids_eleve'
  ] loop
    execute format('revoke all on function public.%I() from public', f);
    execute format('revoke all on function public.%I() from anon', f);
    execute format('grant execute on function public.%I() to authenticated', f);
  end loop;
end $$;


-- ── 2. LES HUIT POLICIES ÉLÈVE, MÊME RÈGLE, AUTRE FORME ────────────────────

-- nutrition_plans : aucune jointure à faire, le prédicat était déjà direct.
-- Seul le hissage de `current_student_id()` change.
alter policy "nutrition_plans_select_self_or_assigned" on public.nutrition_plans
  using (
    (select public.current_student_id()) is not null
    and student_id = (select public.current_student_id())
    and status <> 'prochain'
  );

alter policy "nutrition_days_select_self_or_assigned" on public.nutrition_days
  using (
    (select public.current_student_id()) is not null
    and plan_id in (select public.nutrition_plan_ids_eleve())
  );

-- L'ÉCRITURE de l'élève sur son propre jour : `using` seul est réécrit, le
-- `with_check` de cette policy n'est pas touché.
alter policy "nutrition_days_update_self" on public.nutrition_days
  using (
    (select public.current_student_id()) is not null
    and plan_id in (select public.nutrition_plan_ids_eleve())
  );

alter policy "nutrition_plan_profiles_select_assigned" on public.nutrition_plan_profiles
  using (
    (select public.current_student_id()) is not null
    and plan_id in (select public.nutrition_plan_ids_eleve())
  );

alter policy "nutrition_meal_slot_targets_select_assigned" on public.nutrition_meal_slot_targets
  using (
    (select public.current_student_id()) is not null
    and profile_id in (select public.nutrition_plan_profile_ids_eleve())
  );

alter policy "meals_select_self_or_assigned" on public.meals
  using (
    (select public.current_student_id()) is not null
    and nutrition_day_id in (select public.nutrition_day_ids_eleve())
  );

alter policy "meal_choice_slots_select_assigned" on public.meal_choice_slots
  using (
    (select public.current_student_id()) is not null
    and meal_id in (select public.meal_ids_eleve())
  );

alter policy "meal_choice_options_select_assigned" on public.meal_choice_options
  using (
    (select public.current_student_id()) is not null
    and slot_id in (select public.meal_choice_slot_ids_eleve())
  );


-- ── 3. CE QUI N'EST PAS TOUCHÉ ─────────────────────────────────────────────
-- `nutrition_daily_logs_manage_own_student` : son prédicat est déjà direct
--   (`student_id = current_student_id()`), il ne traverse aucune table.
-- Les 8 policies `_manage_admin` et les 11 policies coach : inchangées.
-- Les six ensembles coach `…_ids_geres()` et les trois `can_manage_*` :
--   ni supprimés ni modifiés.
-- Aucun grant de table, aucun changement de schéma, aucun `statement_timeout`.
--
-- RESTE CONNU, NON TRAITÉ ICI : la contrainte composite
-- `planned_meal_items_option_autorisee_food` n'a pas d'index en tête sur
-- `choice_slot_id`. Son déclencheur coûte ~1,2 ms par option supprimée
-- (10,8 ms pour 9 lignes, mesuré). C'est le poste suivant si le budget de 8 s
-- reste trop juste — mais c'est un index, pas une question de RLS.
