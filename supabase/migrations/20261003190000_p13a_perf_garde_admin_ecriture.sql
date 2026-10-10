-- ════════════════════════════════════════════════════════════════════════════
-- P13-A — GARDE ADMIN SUR LE CHEMIN D'ÉCRITURE (suite de 20261003090000)
-- ════════════════════════════════════════════════════════════════════════════
-- POURQUOI CETTE MIGRATION EXISTE
--
-- La migration 20261003090000 a corrigé le chemin de LECTURE : en remplaçant
-- les fonctions `can_manage_*(uuid)` (évaluées une fois PAR LIGNE) par des
-- ensembles `x in (select public.…_ids_geres())` (hachés, évalués une fois par
-- instruction), le listing du domaine nutrition est passé de 5 311 ms à
-- ~531 ms côté admin.
--
-- Elle a laissé un trou sur le chemin d'ÉCRITURE, et c'est ce trou qui
-- faisait encore échouer `save_nutrition_plan_v2` en 57014 (« canceling
-- statement due to statement timeout ») côté admin.
--
-- Mécanisme exact : un ensemble haché est calculé UNE FOIS PAR INSTRUCTION.
-- Pour une lecture qui balaie 25 191 lignes, c'est excellent. Pour un INSERT
-- d'UNE SEULE ligne, c'est catastrophique : le `WITH CHECK` recalcule
-- l'intégralité de l'ensemble (`ProjectSet (actual rows=3249)` pour les
-- créneaux) afin de valider une ligne. Mesure sur la production : 46 ms pour
-- un INSERT d'une ligne dans `meal_choice_options`. Un plan complet en écrit
-- ~1 000 : le budget de 8 s du rôle `authenticated` est dépassé.
--
-- Revenir à la forme scalaire `can_manage_meal(id)` dans le `WITH CHECK` ne
-- règle rien : mesuré à 43,7 ms pour la même ligne.
--
-- CE QUI EST FAIT ICI
--
-- Les 11 policies « coach » reçoivent le préfixe `not (select
-- public.is_admin()) and (…)`. `(select public.is_admin())` est hissé en
-- InitPlan : évalué une fois, avant les SubPlans. Quand l'utilisateur est
-- admin, le `and` court-circuite et les sous-plans coûteux apparaissent
-- « never executed » dans le plan. Mesure sur la production : 46 ms → 9,9 ms
-- pour le même INSERT d'une ligne.
--
-- POURQUOI LA RÈGLE DE SÉCURITÉ EST INCHANGÉE
--
-- Les policies permissives sont combinées en OU. L'admin ne perd AUCUN droit :
-- il continue de passer par les policies `_manage_admin` créées par
-- 20261003090000, qui lui donnent déjà `for all` avec `using` et `with check`
-- à `(select public.is_admin())`. La garde ne fait que lui éviter d'évaluer
-- EN PLUS la branche coach, dont il n'a pas besoin. Pour un coach non admin,
-- `not (select public.is_admin())` vaut `true` : la condition d'origine est
-- évaluée à l'identique, inchangée, y compris la garde `source_list_id` de
-- `meal_choice_slots`.
--
-- Aucune policy n'est désactivée, aucune permission n'est élargie, aucun
-- `search_path` n'est touché, aucun délai PostgreSQL n'est modifié.
--
-- NOTE D'HISTORIQUE — ces 11 `alter policy` ont été appliqués directement sur
-- la production le 2026-10-10 pour débloquer l'incident. Cette migration les
-- consigne à l'identique afin que le dépôt et la production ne divergent pas :
-- la rejouer sur la production est un no-op sémantique.


-- nutrition_plans ----------------------------------------------------------
alter policy "nutrition_plans_select_own_coach" on public.nutrition_plans
  using (
    not (select public.is_admin())
    and (
      (student_id is not null and student_id in (select public.student_ids_geres()))
      or (student_id is null
          and coach_id is not null
          and coach_id = (select public.current_coach_id()))
    )
  );

alter policy "nutrition_plans_insert_own_coach" on public.nutrition_plans
  with check (
    not (select public.is_admin())
    and (
      (student_id is not null and student_id in (select public.student_ids_geres()))
      or (student_id is null
          and coach_id is not null
          and coach_id = (select public.current_coach_id()))
    )
  );

alter policy "nutrition_plans_update_own_coach" on public.nutrition_plans
  using (
    not (select public.is_admin())
    and (
      (student_id is not null and student_id in (select public.student_ids_geres()))
      or (student_id is null
          and coach_id is not null
          and coach_id = (select public.current_coach_id()))
    )
  )
  with check (
    not (select public.is_admin())
    and (
      (student_id is not null and student_id in (select public.student_ids_geres()))
      or (student_id is null
          and coach_id is not null
          and coach_id = (select public.current_coach_id()))
    )
  );

alter policy "nutrition_plans_delete_own_coach" on public.nutrition_plans
  using (
    not (select public.is_admin())
    and student_id is null
    and coach_id is not null
    and coach_id = (select public.current_coach_id())
  );

-- nutrition_days -----------------------------------------------------------
alter policy "nutrition_days_manage_own_coach" on public.nutrition_days
  using (
    not (select public.is_admin())
    and plan_id in (select public.nutrition_plan_ids_geres())
  )
  with check (
    not (select public.is_admin())
    and plan_id in (select public.nutrition_plan_ids_geres())
  );

-- nutrition_plan_profiles --------------------------------------------------
alter policy "nutrition_plan_profiles_manage_own_coach" on public.nutrition_plan_profiles
  using (
    not (select public.is_admin())
    and plan_id in (select public.nutrition_plan_ids_geres())
  )
  with check (
    not (select public.is_admin())
    and plan_id in (select public.nutrition_plan_ids_geres())
  );

-- nutrition_meal_slot_targets ----------------------------------------------
alter policy "nutrition_meal_slot_targets_manage_own_coach" on public.nutrition_meal_slot_targets
  using (
    not (select public.is_admin())
    and profile_id in (select public.nutrition_plan_profile_ids_geres())
  )
  with check (
    not (select public.is_admin())
    and profile_id in (select public.nutrition_plan_profile_ids_geres())
  );

-- meals --------------------------------------------------------------------
alter policy "meals_manage_own_coach" on public.meals
  using (
    not (select public.is_admin())
    and nutrition_day_id in (select public.nutrition_day_ids_geres())
  )
  with check (
    not (select public.is_admin())
    and nutrition_day_id in (select public.nutrition_day_ids_geres())
  );

-- meal_choice_slots --------------------------------------------------------
-- La garde `source_list_id` est CONSERVÉE telle quelle, à l'intérieur de la
-- branche coach : elle n'a de sens que pour un coach non admin.
alter policy "meal_choice_slots_manage_own_coach" on public.meal_choice_slots
  using (
    not (select public.is_admin())
    and meal_id in (select public.meal_ids_geres())
  )
  with check (
    not (select public.is_admin())
    and meal_id in (select public.meal_ids_geres())
    and (
      source_list_id is null
      or exists (
        select 1 from public.food_lists fl
         where fl.id = meal_choice_slots.source_list_id
           and fl.coach_id = (select public.current_coach_id()))
    )
  );

-- meal_choice_options ------------------------------------------------------
alter policy "meal_choice_options_manage_own_coach" on public.meal_choice_options
  using (
    not (select public.is_admin())
    and slot_id in (select public.meal_choice_slot_ids_geres())
  )
  with check (
    not (select public.is_admin())
    and slot_id in (select public.meal_choice_slot_ids_geres())
  );

-- nutrition_daily_logs -----------------------------------------------------
alter policy "nutrition_daily_logs_manage_own_coach" on public.nutrition_daily_logs
  using (
    not (select public.is_admin())
    and student_id in (select public.student_ids_geres())
  )
  with check (
    not (select public.is_admin())
    and student_id in (select public.student_ids_geres())
  );


-- ── CE QUI N'EST PAS TOUCHÉ ────────────────────────────────────────────────
-- Les 8 policies `_manage_admin` : inchangées.
-- `nutrition_daily_logs_manage_own_student` : inchangée — la garde admin n'a
--   pas de sens sur une policy élève, et l'y mettre retirerait un droit.
-- Les fonctions `…_ids_geres()`, `can_manage_*`, `is_admin`,
--   `current_coach_id` : NI supprimées NI modifiées, `search_path` intact.
-- Aucun grant, aucun schéma, aucun `statement_timeout`.
