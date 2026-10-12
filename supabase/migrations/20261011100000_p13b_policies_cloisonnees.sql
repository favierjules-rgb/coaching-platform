-- ════════════════════════════════════════════════════════════════════════════
-- P13-B — LES 72 POLICIES TROP LARGES, RÉÉCRITES PAR CATÉGORIE ET PAR NIVEAU
-- ════════════════════════════════════════════════════════════════════════════
-- Suite de 20261011090000, qui a posé le modèle sans rien changer d'observable.
-- Celle-ci change le comportement : c'est elle qui ferme le trou.
--
-- CE QUI ÉTAIT OUVERT
--
--     students_select_self_or_staff : (user_id = auth.uid()) OR is_coach_or_admin()
--     students_delete_staff         : is_coach_or_admin()
--
-- `is_coach_or_admin()` ne distingue ni le coach, ni l'élève suivi, ni le
-- domaine. N'importe quel compte non-admin du staff pouvait lire, modifier et
-- supprimer les élèves de tous les coachs, sur 48 tables.
--
-- LA MÉTHODE
--
-- Chaque policy conserve son nom, son rôle cible et SA BRANCHE ÉLÈVE MOT POUR
-- MOT. Seul le terme `is_coach_or_admin()` est remplacé. Ce choix est
-- délibéré : réécrire les prédicats à la main, c'était 72 occasions de perdre
-- en route un `student_id = current_student_id()` et de couper un élève de ses
-- propres données sans que personne ne s'en aperçoive.
--
-- LA CORRESPONDANCE COMMANDE ↔ NIVEAU
--
--   SELECT : ensemble de LECTURE   (le niveau `ecriture` l'inclut)
--   INSERT : ensemble d'ÉCRITURE, dans WITH CHECK
--   UPDATE : ensemble d'ÉCRITURE, dans USING ET dans WITH CHECK
--   DELETE : ensemble d'ÉCRITURE, dans USING
--
-- Les 36 policies `FOR ALL` sont donc SCINDÉES en quatre. Une policy `FOR ALL`
-- n'a qu'un `USING`, qui gouverne à la fois le SELECT, l'UPDATE et le DELETE :
-- y mettre l'ensemble de lecture laissait un collaborateur en LECTURE SEULE
-- supprimer des lignes, et y mettre celui d'écriture lui interdisait de lire.
-- Aucune substitution ne pouvait être correcte ; seule la scission l'est.
-- Comptage exact, relevé en base : 72 policies à réécrire, dont 36 déjà
-- spécialisées par commande et 36 en `FOR ALL`. Le résultat est donc
-- 72 DROP et 36 + (36 × 4) = 180 CREATE, sur 48 tables.
--
-- TROIS RÈGLES DE PORTÉE, SELON CE QUE LA TABLE PORTE
--
-- 1. `student_id` → `student_ids_<catégorie>_<niveau>()`. La catégorie vient
--    de la cartographie (docs/cloisonnement-roles-cartographie.md).
--
-- 2. Chaîne vers `programs` ou `documents` → ensembles dérivés. Les documents
--    sont routés par LEUR PROPRE `category` et exigent une affectation d'élève
--    via `document_assignments` : un document global ou non assigné n'est
--    jamais atteint par un collaborateur.
--
-- 3. Rattachement au coach (`coach_id`) → ATTENTION, voir ci-dessous.
--
-- LE PIÈGE DU `coach_id` NUL
--
-- Relevé en base avant d'écrire : `coach_id` est NUL sur la TOTALITÉ des
-- lignes de `exercise_library` (142), `session_templates` (13), `documents`
-- (17), `programs` (25), `appointments` (6), `coach_availabilities` (6) et
-- `coach_unavailabilities` (2). La colonne existe, l'application ne l'a jamais
-- renseignée — il n'y a jamais eu qu'un coach. `create_coach_event_atomic` ne
-- la cite même pas dans son INSERT.
--
-- Un prédicat `coach_id in (select coach_ids_portee())` aurait donc valu NULL,
-- donc faux, et l'administrateur comme l'assistant auraient perdu d'un coup
-- 142 exercices, 25 programmes, 17 documents, 13 modèles et tout le
-- calendrier. La forme retenue est :
--
--     public.est_staff_global()            -- admin et assistant : inchangé
--     or ( coach_id is not null            -- un collaborateur exige un
--          and coach_id in (…)             -- propriétaire EXPLICITE
--          and '<catégorie>' in (…) )
--
-- `coach_id is null` n'est JAMAIS une condition suffisante pour un
-- collaborateur : les lignes historiques sans propriétaire restent à
-- l'administration et aux assistants, et ne deviennent la ressource partagée
-- de personne. Aucun backfill n'est fait, aucune donnée n'est modifiée.
--
-- CE QUI N'EST PAS TOUCHÉ
--
-- Les 8 tables du cœur nutrition : elles ne portent plus `is_coach_or_admin()`
-- depuis P13-A et n'apparaissent donc pas ici. Leur intégration au modèle de
-- catégories se fait dans la migration suivante, avec les fonctions.
-- Aucune policy élève, aucune migration P13-A, aucune donnée.


-- ── SUIVI ÉLÈVE ────────────────────────────────────────────────────────────

drop policy if exists activity_events_staff_delete on public.activity_events;
create policy activity_events_staff_delete
  on public.activity_events for delete to public
  using (student_id in (select public.student_ids_suivi_eleve_ecriture()));

drop policy if exists activity_events_staff_insert on public.activity_events;
create policy activity_events_staff_insert
  on public.activity_events for insert to public
  with check (student_id in (select public.student_ids_suivi_eleve_ecriture()));

drop policy if exists activity_events_staff_select on public.activity_events;
create policy activity_events_staff_select
  on public.activity_events for select to public
  using (student_id in (select public.student_ids_suivi_eleve_lecture()));

drop policy if exists activity_events_staff_update on public.activity_events;
create policy activity_events_staff_update
  on public.activity_events for update to public
  using (student_id in (select public.student_ids_suivi_eleve_ecriture()))
  with check (student_id in (select public.student_ids_suivi_eleve_ecriture()));

drop policy if exists activity_events_manage_staff on public.activity_events;
create policy activity_events_manage_staff_select
  on public.activity_events for select to public
  using (student_id in (select public.student_ids_suivi_eleve_lecture()));
create policy activity_events_manage_staff_insert
  on public.activity_events for insert to public
  with check (student_id in (select public.student_ids_suivi_eleve_ecriture()));
create policy activity_events_manage_staff_update
  on public.activity_events for update to public
  using (student_id in (select public.student_ids_suivi_eleve_ecriture()))
  with check (student_id in (select public.student_ids_suivi_eleve_ecriture()));
create policy activity_events_manage_staff_delete
  on public.activity_events for delete to public
  using (student_id in (select public.student_ids_suivi_eleve_ecriture()));

drop policy if exists body_measurements_student_or_staff on public.body_measurements;
create policy body_measurements_student_or_staff_select
  on public.body_measurements for select to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_lecture())));
create policy body_measurements_student_or_staff_insert
  on public.body_measurements for insert to public
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));
create policy body_measurements_student_or_staff_update
  on public.body_measurements for update to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())))
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));
create policy body_measurements_student_or_staff_delete
  on public.body_measurements for delete to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));

drop policy if exists custom_measurements_student_or_staff on public.custom_measurements;
create policy custom_measurements_student_or_staff_select
  on public.custom_measurements for select to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_lecture())));
create policy custom_measurements_student_or_staff_insert
  on public.custom_measurements for insert to public
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));
create policy custom_measurements_student_or_staff_update
  on public.custom_measurements for update to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())))
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));
create policy custom_measurements_student_or_staff_delete
  on public.custom_measurements for delete to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));

drop policy if exists weight_entries_student_or_staff on public.weight_entries;
create policy weight_entries_student_or_staff_select
  on public.weight_entries for select to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_lecture())));
create policy weight_entries_student_or_staff_insert
  on public.weight_entries for insert to public
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));
create policy weight_entries_student_or_staff_update
  on public.weight_entries for update to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())))
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));
create policy weight_entries_student_or_staff_delete
  on public.weight_entries for delete to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));

drop policy if exists progress_photos_student_or_staff on public.progress_photos;
create policy progress_photos_student_or_staff_select
  on public.progress_photos for select to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_lecture())));
create policy progress_photos_student_or_staff_insert
  on public.progress_photos for insert to public
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));
create policy progress_photos_student_or_staff_update
  on public.progress_photos for update to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())))
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));
create policy progress_photos_student_or_staff_delete
  on public.progress_photos for delete to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));

drop policy if exists coach_notes_staff_only on public.coach_notes;
create policy coach_notes_staff_only_select
  on public.coach_notes for select to public
  using (student_id in (select public.student_ids_suivi_eleve_lecture()));
create policy coach_notes_staff_only_insert
  on public.coach_notes for insert to public
  with check (student_id in (select public.student_ids_suivi_eleve_ecriture()));
create policy coach_notes_staff_only_update
  on public.coach_notes for update to public
  using (student_id in (select public.student_ids_suivi_eleve_ecriture()))
  with check (student_id in (select public.student_ids_suivi_eleve_ecriture()));
create policy coach_notes_staff_only_delete
  on public.coach_notes for delete to public
  using (student_id in (select public.student_ids_suivi_eleve_ecriture()));

drop policy if exists legal_consents_insert_own_health_or_staff on public.legal_consents;
create policy legal_consents_insert_own_health_or_staff
  on public.legal_consents for insert to public
  with check ((((student_id = current_student_id()) AND (consent_type = 'sante_onboarding'::text)) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));

drop policy if exists legal_consents_select_self_or_staff on public.legal_consents;
create policy legal_consents_select_self_or_staff
  on public.legal_consents for select to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_lecture())));

drop policy if exists student_profiles_select_self_or_staff on public.student_profiles;
create policy student_profiles_select_self_or_staff
  on public.student_profiles for select to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_lecture())));

drop policy if exists student_profiles_manage_self_or_staff on public.student_profiles;
create policy student_profiles_manage_self_or_staff_select
  on public.student_profiles for select to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_lecture())));
create policy student_profiles_manage_self_or_staff_insert
  on public.student_profiles for insert to public
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));
create policy student_profiles_manage_self_or_staff_update
  on public.student_profiles for update to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())))
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));
create policy student_profiles_manage_self_or_staff_delete
  on public.student_profiles for delete to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_suivi_eleve_ecriture())));

-- `students` : la LECTURE de l'identité suit la simple portée — un
-- collaborateur nutrition qui ne verrait pas la fiche de ses élèves ne pourrait
-- rien faire. L'ÉCRITURE, elle, reste derrière `suivi_eleve`.
drop policy if exists students_select_self_or_staff on public.students;
create policy students_select_self_or_staff
  on public.students for select to public
  using (((user_id = auth.uid()) OR id in (select public.student_ids_portee())));

drop policy if exists students_update_self_or_staff on public.students;
-- L'original ne portait AUCUN `with check` : la ligne pouvait sortir de la
-- portée de celui qui la modifiait, l'UPDATE restant autorisé par le seul
-- `using`. La règle impose l'écriture des deux côtés — c'est un
-- resserrement par rapport à l'existant, pas une reprise.
create policy students_update_self_or_staff
  on public.students for update to public
  using (((user_id = auth.uid()) OR id in (select public.student_ids_suivi_eleve_ecriture())))
  with check (((user_id = auth.uid()) OR id in (select public.student_ids_suivi_eleve_ecriture())));

drop policy if exists students_manage_staff on public.students;
create policy students_manage_staff
  on public.students for insert to public
  with check (id in (select public.student_ids_suivi_eleve_ecriture()));

drop policy if exists students_delete_staff on public.students;
create policy students_delete_staff
  on public.students for delete to public
  using (id in (select public.student_ids_suivi_eleve_ecriture()));


-- ── ENTRAÎNEMENT ───────────────────────────────────────────────────────────

drop policy if exists assignments_select_self_or_staff on public.assignments;
create policy assignments_select_self_or_staff
  on public.assignments for select to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_lecture())));

drop policy if exists assignments_manage_staff on public.assignments;
create policy assignments_manage_staff_select
  on public.assignments for select to public
  using (student_id in (select public.student_ids_entrainement_lecture()));
create policy assignments_manage_staff_insert
  on public.assignments for insert to public
  with check (student_id in (select public.student_ids_entrainement_ecriture()));
create policy assignments_manage_staff_update
  on public.assignments for update to public
  using (student_id in (select public.student_ids_entrainement_ecriture()))
  with check (student_id in (select public.student_ids_entrainement_ecriture()));
create policy assignments_manage_staff_delete
  on public.assignments for delete to public
  using (student_id in (select public.student_ids_entrainement_ecriture()));

drop policy if exists exercise_feedback_student_or_staff on public.exercise_feedback;
create policy exercise_feedback_student_or_staff_select
  on public.exercise_feedback for select to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_lecture())));
create policy exercise_feedback_student_or_staff_insert
  on public.exercise_feedback for insert to public
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_ecriture())));
create policy exercise_feedback_student_or_staff_update
  on public.exercise_feedback for update to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_ecriture())))
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_ecriture())));
create policy exercise_feedback_student_or_staff_delete
  on public.exercise_feedback for delete to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_ecriture())));

drop policy if exists exercise_set_feedback_student_or_staff on public.exercise_set_feedback;
create policy exercise_set_feedback_student_or_staff_select
  on public.exercise_set_feedback for select to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_lecture())));
create policy exercise_set_feedback_student_or_staff_insert
  on public.exercise_set_feedback for insert to public
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_ecriture())));
create policy exercise_set_feedback_student_or_staff_update
  on public.exercise_set_feedback for update to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_ecriture())))
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_ecriture())));
create policy exercise_set_feedback_student_or_staff_delete
  on public.exercise_set_feedback for delete to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_ecriture())));

drop policy if exists workout_feedback_student_or_staff on public.workout_feedback;
create policy workout_feedback_student_or_staff_select
  on public.workout_feedback for select to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_lecture())));
create policy workout_feedback_student_or_staff_insert
  on public.workout_feedback for insert to public
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_ecriture())));
create policy workout_feedback_student_or_staff_update
  on public.workout_feedback for update to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_ecriture())))
  with check (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_ecriture())));
create policy workout_feedback_student_or_staff_delete
  on public.workout_feedback for delete to public
  using (((student_id = current_student_id()) OR student_id in (select public.student_ids_entrainement_ecriture())));

drop policy if exists training_change_history_staff_only on public.training_change_history;
create policy training_change_history_staff_only_select
  on public.training_change_history for select to public
  using (student_id in (select public.student_ids_entrainement_lecture()));
create policy training_change_history_staff_only_insert
  on public.training_change_history for insert to public
  with check (student_id in (select public.student_ids_entrainement_ecriture()));
create policy training_change_history_staff_only_update
  on public.training_change_history for update to public
  using (student_id in (select public.student_ids_entrainement_ecriture()))
  with check (student_id in (select public.student_ids_entrainement_ecriture()));
create policy training_change_history_staff_only_delete
  on public.training_change_history for delete to public
  using (student_id in (select public.student_ids_entrainement_ecriture()));

-- La chaîne `programs → program_weeks → workout_sessions → training_blocks
-- → workout_exercises → training_prescriptions`. Chaque maillon interroge
-- l'ensemble du maillon précédent, jamais la table elle-même : référencer une
-- table dans une policy réapplique SA RLS, en cascade, et c'est ce qui avait
-- fait exploser le plan nutrition à 576 nœuds.
drop policy if exists programs_manage_staff on public.programs;
create policy programs_manage_staff_select
  on public.programs for select to public
  using (id in (select public.program_ids_lecture()));
create policy programs_manage_staff_insert
  on public.programs for insert to public
  with check (id in (select public.program_ids_ecriture()));
create policy programs_manage_staff_update
  on public.programs for update to public
  using (id in (select public.program_ids_ecriture()))
  with check (id in (select public.program_ids_ecriture()));
create policy programs_manage_staff_delete
  on public.programs for delete to public
  using (id in (select public.program_ids_ecriture()));

drop policy if exists program_weeks_manage_staff on public.program_weeks;
create policy program_weeks_manage_staff_select
  on public.program_weeks for select to public
  using (program_id in (select public.program_ids_lecture()));
create policy program_weeks_manage_staff_insert
  on public.program_weeks for insert to public
  with check (program_id in (select public.program_ids_ecriture()));
create policy program_weeks_manage_staff_update
  on public.program_weeks for update to public
  using (program_id in (select public.program_ids_ecriture()))
  with check (program_id in (select public.program_ids_ecriture()));
create policy program_weeks_manage_staff_delete
  on public.program_weeks for delete to public
  using (program_id in (select public.program_ids_ecriture()));

drop policy if exists program_exercise_progression_manage_staff on public.program_exercise_progression;
create policy program_exercise_progression_manage_staff_select
  on public.program_exercise_progression for select to public
  using (program_id in (select public.program_ids_lecture()));
create policy program_exercise_progression_manage_staff_insert
  on public.program_exercise_progression for insert to public
  with check (program_id in (select public.program_ids_ecriture()));
create policy program_exercise_progression_manage_staff_update
  on public.program_exercise_progression for update to public
  using (program_id in (select public.program_ids_ecriture()))
  with check (program_id in (select public.program_ids_ecriture()));
create policy program_exercise_progression_manage_staff_delete
  on public.program_exercise_progression for delete to public
  using (program_id in (select public.program_ids_ecriture()));

drop policy if exists program_review_flags_staff on public.program_review_flags;
create policy program_review_flags_staff_select
  on public.program_review_flags for select to authenticated
  using (program_id in (select public.program_ids_lecture()));
create policy program_review_flags_staff_insert
  on public.program_review_flags for insert to authenticated
  with check (program_id in (select public.program_ids_ecriture()));
create policy program_review_flags_staff_update
  on public.program_review_flags for update to authenticated
  using (program_id in (select public.program_ids_ecriture()))
  with check (program_id in (select public.program_ids_ecriture()));
create policy program_review_flags_staff_delete
  on public.program_review_flags for delete to authenticated
  using (program_id in (select public.program_ids_ecriture()));

drop policy if exists workout_sessions_manage_staff on public.workout_sessions;
create policy workout_sessions_manage_staff_select
  on public.workout_sessions for select to public
  using (id in (select public.workout_session_ids_lecture()));
create policy workout_sessions_manage_staff_insert
  on public.workout_sessions for insert to public
  with check (id in (select public.workout_session_ids_ecriture()));
create policy workout_sessions_manage_staff_update
  on public.workout_sessions for update to public
  using (id in (select public.workout_session_ids_ecriture()))
  with check (id in (select public.workout_session_ids_ecriture()));
create policy workout_sessions_manage_staff_delete
  on public.workout_sessions for delete to public
  using (id in (select public.workout_session_ids_ecriture()));

drop policy if exists training_blocks_manage_staff on public.training_blocks;
create policy training_blocks_manage_staff_select
  on public.training_blocks for select to public
  using (session_id in (select public.workout_session_ids_lecture()));
create policy training_blocks_manage_staff_insert
  on public.training_blocks for insert to public
  with check (session_id in (select public.workout_session_ids_ecriture()));
create policy training_blocks_manage_staff_update
  on public.training_blocks for update to public
  using (session_id in (select public.workout_session_ids_ecriture()))
  with check (session_id in (select public.workout_session_ids_ecriture()));
create policy training_blocks_manage_staff_delete
  on public.training_blocks for delete to public
  using (session_id in (select public.workout_session_ids_ecriture()));

drop policy if exists workout_exercises_manage_staff on public.workout_exercises;
create policy workout_exercises_manage_staff_select
  on public.workout_exercises for select to public
  using (id in (select public.workout_exercise_ids_lecture()));
create policy workout_exercises_manage_staff_insert
  on public.workout_exercises for insert to public
  with check (id in (select public.workout_exercise_ids_ecriture()));
create policy workout_exercises_manage_staff_update
  on public.workout_exercises for update to public
  using (id in (select public.workout_exercise_ids_ecriture()))
  with check (id in (select public.workout_exercise_ids_ecriture()));
create policy workout_exercises_manage_staff_delete
  on public.workout_exercises for delete to public
  using (id in (select public.workout_exercise_ids_ecriture()));

drop policy if exists training_prescriptions_manage_staff on public.training_prescriptions;
create policy training_prescriptions_manage_staff_select
  on public.training_prescriptions for select to public
  using (block_id in (select public.training_block_ids_lecture()));
create policy training_prescriptions_manage_staff_insert
  on public.training_prescriptions for insert to public
  with check (block_id in (select public.training_block_ids_ecriture()));
create policy training_prescriptions_manage_staff_update
  on public.training_prescriptions for update to public
  using (block_id in (select public.training_block_ids_ecriture()))
  with check (block_id in (select public.training_block_ids_ecriture()));
create policy training_prescriptions_manage_staff_delete
  on public.training_prescriptions for delete to public
  using (block_id in (select public.training_block_ids_ecriture()));

-- Les BIBLIOTHÈQUES du coach. `coach_id is null` ne vaut PAS autorisation
-- pour un collaborateur : les 142 exercices et 13 modèles actuels, tous sans
-- propriétaire, restent à l'administration et aux assistants.
drop policy if exists exercise_library_manage_staff on public.exercise_library;
create policy exercise_library_manage_staff_select
  on public.exercise_library for select to public
  using ((public.est_staff_global() or (coach_id is not null and coach_id in (select public.coach_ids_portee()) and 'entrainement' in (select public.categories_lecture()))));
create policy exercise_library_manage_staff_insert
  on public.exercise_library for insert to public
  with check ((public.est_staff_global() or (coach_id is not null and coach_id in (select public.coach_ids_portee()) and 'entrainement' in (select public.categories_ecriture()))));
create policy exercise_library_manage_staff_update
  on public.exercise_library for update to public
  using ((public.est_staff_global() or (coach_id is not null and coach_id in (select public.coach_ids_portee()) and 'entrainement' in (select public.categories_ecriture()))))
  with check ((public.est_staff_global() or (coach_id is not null and coach_id in (select public.coach_ids_portee()) and 'entrainement' in (select public.categories_ecriture()))));
create policy exercise_library_manage_staff_delete
  on public.exercise_library for delete to public
  using ((public.est_staff_global() or (coach_id is not null and coach_id in (select public.coach_ids_portee()) and 'entrainement' in (select public.categories_ecriture()))));

drop policy if exists session_templates_manage_staff on public.session_templates;
create policy session_templates_manage_staff_select
  on public.session_templates for select to public
  using ((public.est_staff_global() or (coach_id is not null and coach_id in (select public.coach_ids_portee()) and 'entrainement' in (select public.categories_lecture()))));
create policy session_templates_manage_staff_insert
  on public.session_templates for insert to public
  with check ((public.est_staff_global() or (coach_id is not null and coach_id in (select public.coach_ids_portee()) and 'entrainement' in (select public.categories_ecriture()))));
create policy session_templates_manage_staff_update
  on public.session_templates for update to public
  using ((public.est_staff_global() or (coach_id is not null and coach_id in (select public.coach_ids_portee()) and 'entrainement' in (select public.categories_ecriture()))))
  with check ((public.est_staff_global() or (coach_id is not null and coach_id in (select public.coach_ids_portee()) and 'entrainement' in (select public.categories_ecriture()))));
create policy session_templates_manage_staff_delete
  on public.session_templates for delete to public
  using ((public.est_staff_global() or (coach_id is not null and coach_id in (select public.coach_ids_portee()) and 'entrainement' in (select public.categories_ecriture()))));


-- ── DOCUMENTS : routés par LEUR catégorie, via l'affectation d'élève ───────
-- `document_ids_lecture/ecriture()` joint obligatoirement `document_assignments`
-- et route sur `documents.category`. Un document global, ou assigné à personne,
-- n'entre dans aucun des deux ensembles : il reste hors d'atteinte.
drop policy if exists documents_manage_staff on public.documents;
create policy documents_manage_staff_select
  on public.documents for select to public
  using (id in (select public.document_ids_lecture()));
create policy documents_manage_staff_insert
  on public.documents for insert to public
  with check (id in (select public.document_ids_ecriture()));
create policy documents_manage_staff_update
  on public.documents for update to public
  using (id in (select public.document_ids_ecriture()))
  with check (id in (select public.document_ids_ecriture()));
create policy documents_manage_staff_delete
  on public.documents for delete to public
  using (id in (select public.document_ids_ecriture()));

-- `document_assignments` hérite des contrôles du document : même ensemble,
-- donc même catégorie, même affectation et même niveau. Aucune voie parallèle.
drop policy if exists document_assignments_select_self_or_staff on public.document_assignments;
create policy document_assignments_select_self_or_staff
  on public.document_assignments for select to public
  using (((student_id = current_student_id()) OR document_id in (select public.document_ids_lecture())));

drop policy if exists document_assignments_manage_staff on public.document_assignments;
create policy document_assignments_manage_staff
  on public.document_assignments for insert to public
  with check (document_id in (select public.document_ids_ecriture()));

drop policy if exists document_assignments_update_staff on public.document_assignments;
create policy document_assignments_update_staff
  on public.document_assignments for update to public
  using (document_id in (select public.document_ids_ecriture()))
  with check (document_id in (select public.document_ids_ecriture()));

drop policy if exists document_assignments_delete_staff on public.document_assignments;
create policy document_assignments_delete_staff
  on public.document_assignments for delete to public
  using (document_id in (select public.document_ids_ecriture()));


-- ── AGENDA ET COMMUNICATION ────────────────────────────────────────────────

drop policy if exists appointments_select_staff on public.appointments;
create policy appointments_select_staff
  on public.appointments for select to public
  using (student_id in (select public.student_ids_agenda_communication_lecture()));

drop policy if exists notification_campaign_targets_staff on public.notification_campaign_targets;
create policy notification_campaign_targets_staff_select
  on public.notification_campaign_targets for select to authenticated
  using (student_id in (select public.student_ids_agenda_communication_lecture()));
create policy notification_campaign_targets_staff_insert
  on public.notification_campaign_targets for insert to authenticated
  with check (student_id in (select public.student_ids_agenda_communication_ecriture()));
create policy notification_campaign_targets_staff_update
  on public.notification_campaign_targets for update to authenticated
  using (student_id in (select public.student_ids_agenda_communication_ecriture()))
  with check (student_id in (select public.student_ids_agenda_communication_ecriture()));
create policy notification_campaign_targets_staff_delete
  on public.notification_campaign_targets for delete to authenticated
  using (student_id in (select public.student_ids_agenda_communication_ecriture()));

-- Le calendrier du membre. Un collaborateur gère SES PROPRES indisponibilités
-- — `coach_id = current_staff_id()` — et jamais celles d'un autre membre. Les
-- 2 lignes historiques sans `coach_id` ne lui sont pas accessibles : seuls
-- l'administration et les assistants les voient, comme aujourd'hui.
drop policy if exists coach_availabilities_manage_staff on public.coach_availabilities;
create policy coach_availabilities_manage_staff_select
  on public.coach_availabilities for select to public
  using ((public.est_staff_global() or (coach_id is not null and coach_id = (select public.current_staff_id()) and 'agenda_communication' in (select public.categories_lecture()))));
create policy coach_availabilities_manage_staff_insert
  on public.coach_availabilities for insert to public
  with check ((public.est_staff_global() or (coach_id is not null and coach_id = (select public.current_staff_id()) and 'agenda_communication' in (select public.categories_ecriture()))));
create policy coach_availabilities_manage_staff_update
  on public.coach_availabilities for update to public
  using ((public.est_staff_global() or (coach_id is not null and coach_id = (select public.current_staff_id()) and 'agenda_communication' in (select public.categories_ecriture()))))
  with check ((public.est_staff_global() or (coach_id is not null and coach_id = (select public.current_staff_id()) and 'agenda_communication' in (select public.categories_ecriture()))));
create policy coach_availabilities_manage_staff_delete
  on public.coach_availabilities for delete to public
  using ((public.est_staff_global() or (coach_id is not null and coach_id = (select public.current_staff_id()) and 'agenda_communication' in (select public.categories_ecriture()))));

drop policy if exists coach_unavailabilities_select_staff on public.coach_unavailabilities;
create policy coach_unavailabilities_select_staff
  on public.coach_unavailabilities for select to public
  using ((public.est_staff_global() or (coach_id is not null and coach_id = (select public.current_staff_id()) and 'agenda_communication' in (select public.categories_lecture()))));

drop policy if exists coach_unavailabilities_delete_staff on public.coach_unavailabilities;
create policy coach_unavailabilities_delete_staff
  on public.coach_unavailabilities for delete to public
  using ((public.est_staff_global() or (coach_id is not null and coach_id = (select public.current_staff_id()) and 'agenda_communication' in (select public.categories_ecriture()))));

-- L'INSERT et l'UPDATE de `coach_unavailabilities` passaient déjà
-- exclusivement par `create_coach_event_atomic` / `update_coach_event_atomic`,
-- en SECURITY DEFINER : aucune policy ne les couvrait. Elles sont durcies dans
-- la migration suivante, pas ici.


-- ── TABLES GLOBALES : jamais accordables à un collaborateur ────────────────
-- Aucune ne se rattache à un élève. La règle « sans élève identifiable, pas
-- d'accès » s'y applique donc telle quelle : administration et assistants
-- seulement, quelle que soit la catégorie du collaborateur.

drop policy if exists appointment_email_logs_manage_staff on public.appointment_email_logs;
create policy appointment_email_logs_manage_staff_select
  on public.appointment_email_logs for select to public using (public.est_staff_global());
create policy appointment_email_logs_manage_staff_insert
  on public.appointment_email_logs for insert to public with check (public.est_staff_global());
create policy appointment_email_logs_manage_staff_update
  on public.appointment_email_logs for update to public
  using (public.est_staff_global()) with check (public.est_staff_global());
create policy appointment_email_logs_manage_staff_delete
  on public.appointment_email_logs for delete to public using (public.est_staff_global());

drop policy if exists booking_settings_manage_staff on public.booking_settings;
create policy booking_settings_manage_staff_select
  on public.booking_settings for select to public using (public.est_staff_global());
create policy booking_settings_manage_staff_insert
  on public.booking_settings for insert to public with check (public.est_staff_global());
create policy booking_settings_manage_staff_update
  on public.booking_settings for update to public
  using (public.est_staff_global()) with check (public.est_staff_global());
create policy booking_settings_manage_staff_delete
  on public.booking_settings for delete to public using (public.est_staff_global());

drop policy if exists document_levels_manage_staff on public.document_levels;
create policy document_levels_manage_staff_select
  on public.document_levels for select to public using (public.est_staff_global());
create policy document_levels_manage_staff_insert
  on public.document_levels for insert to public with check (public.est_staff_global());
create policy document_levels_manage_staff_update
  on public.document_levels for update to public
  using (public.est_staff_global()) with check (public.est_staff_global());
create policy document_levels_manage_staff_delete
  on public.document_levels for delete to public using (public.est_staff_global());

drop policy if exists notification_campaigns_staff on public.notification_campaigns;
create policy notification_campaigns_staff_select
  on public.notification_campaigns for select to authenticated using (public.est_staff_global());
create policy notification_campaigns_staff_insert
  on public.notification_campaigns for insert to authenticated with check (public.est_staff_global());
create policy notification_campaigns_staff_update
  on public.notification_campaigns for update to authenticated
  using (public.est_staff_global()) with check (public.est_staff_global());
create policy notification_campaigns_staff_delete
  on public.notification_campaigns for delete to authenticated using (public.est_staff_global());

drop policy if exists newsletter_subscribers_select_staff on public.newsletter_subscribers;
create policy newsletter_subscribers_select_staff
  on public.newsletter_subscribers for select to public using (public.est_staff_global());

drop policy if exists newsletter_subscribers_update_staff on public.newsletter_subscribers;
create policy newsletter_subscribers_update_staff
  on public.newsletter_subscribers for update to public
  using (public.est_staff_global()) with check (public.est_staff_global());

drop policy if exists newsletter_subscribers_delete_staff on public.newsletter_subscribers;
create policy newsletter_subscribers_delete_staff
  on public.newsletter_subscribers for delete to public using (public.est_staff_global());

drop policy if exists email_logs_select_staff on public.email_logs;
create policy email_logs_select_staff
  on public.email_logs for select to public using (public.est_staff_global());

drop policy if exists notification_occurrences_select_staff on public.notification_occurrences;
create policy notification_occurrences_select_staff
  on public.notification_occurrences for select to authenticated using (public.est_staff_global());

drop policy if exists notification_deliveries_select_staff on public.notification_deliveries;
create policy notification_deliveries_select_staff
  on public.notification_deliveries for select to authenticated using (public.est_staff_global());

drop policy if exists push_subscriptions_select_staff on public.push_subscriptions;
create policy push_subscriptions_select_staff
  on public.push_subscriptions for select to authenticated using (public.est_staff_global());


-- ── ADMINISTRATION : jamais un collaborateur, jamais un assistant ──────────
-- Facturation, paiements, Stripe, abonnements, comptes. `is_admin()` seul.
-- C'est un RESSERREMENT par rapport à l'existant, où `is_coach_or_admin()`
-- ouvrait ces tables à tout le staff — et c'est la règle déjà écrite dans
-- `lib/api/authz.ts`, que la couche SQL n'avait jamais appliquée.

drop policy if exists billing_customers_manage_staff on public.billing_customers;
create policy billing_customers_manage_staff_select
  on public.billing_customers for select to public using ((select public.is_admin()));
create policy billing_customers_manage_staff_insert
  on public.billing_customers for insert to public with check ((select public.is_admin()));
create policy billing_customers_manage_staff_update
  on public.billing_customers for update to public
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy billing_customers_manage_staff_delete
  on public.billing_customers for delete to public using ((select public.is_admin()));

drop policy if exists billing_events_manage_staff on public.billing_events;
create policy billing_events_manage_staff_select
  on public.billing_events for select to public using ((select public.is_admin()));
create policy billing_events_manage_staff_insert
  on public.billing_events for insert to public with check ((select public.is_admin()));
create policy billing_events_manage_staff_update
  on public.billing_events for update to public
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy billing_events_manage_staff_delete
  on public.billing_events for delete to public using ((select public.is_admin()));

drop policy if exists payment_entries_select_self_or_staff on public.payment_entries;
create policy payment_entries_select_self_or_staff
  on public.payment_entries for select to public
  using (((student_id = current_student_id()) OR (select public.is_admin())));

drop policy if exists payment_entries_manage_staff on public.payment_entries;
create policy payment_entries_manage_staff_select
  on public.payment_entries for select to public using ((select public.is_admin()));
create policy payment_entries_manage_staff_insert
  on public.payment_entries for insert to public with check ((select public.is_admin()));
create policy payment_entries_manage_staff_update
  on public.payment_entries for update to public
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy payment_entries_manage_staff_delete
  on public.payment_entries for delete to public using ((select public.is_admin()));

drop policy if exists payments_select_self_or_staff on public.payments;
create policy payments_select_self_or_staff
  on public.payments for select to public
  using (((student_id = current_student_id()) OR (select public.is_admin())));

drop policy if exists payments_manage_staff on public.payments;
create policy payments_manage_staff
  on public.payments for insert to public with check ((select public.is_admin()));

drop policy if exists payments_update_staff on public.payments;
-- Même défaut d'origine, même correction.
create policy payments_update_staff
  on public.payments for update to public
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists payments_delete_staff on public.payments;
create policy payments_delete_staff
  on public.payments for delete to public using ((select public.is_admin()));

drop policy if exists stripe_payments_manage_staff on public.stripe_payments;
create policy stripe_payments_manage_staff_select
  on public.stripe_payments for select to public using ((select public.is_admin()));
create policy stripe_payments_manage_staff_insert
  on public.stripe_payments for insert to public with check ((select public.is_admin()));
create policy stripe_payments_manage_staff_update
  on public.stripe_payments for update to public
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy stripe_payments_manage_staff_delete
  on public.stripe_payments for delete to public using ((select public.is_admin()));

drop policy if exists subscriptions_manage_staff on public.subscriptions;
create policy subscriptions_manage_staff_select
  on public.subscriptions for select to public using ((select public.is_admin()));
create policy subscriptions_manage_staff_insert
  on public.subscriptions for insert to public with check ((select public.is_admin()));
create policy subscriptions_manage_staff_update
  on public.subscriptions for update to public
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy subscriptions_manage_staff_delete
  on public.subscriptions for delete to public using ((select public.is_admin()));

drop policy if exists subscription_templates_select_active_or_staff on public.subscription_templates;
create policy subscription_templates_select_active_or_staff
  on public.subscription_templates for select to public
  using (((is_active = true) OR (select public.is_admin()) OR (id IN ( SELECT student_profiles.assigned_subscription_template_id
   FROM student_profiles
  WHERE (student_profiles.student_id = current_student_id())))));

drop policy if exists subscription_templates_manage_staff on public.subscription_templates;
create policy subscription_templates_manage_staff_select
  on public.subscription_templates for select to public using ((select public.is_admin()));
create policy subscription_templates_manage_staff_insert
  on public.subscription_templates for insert to public with check ((select public.is_admin()));
create policy subscription_templates_manage_staff_update
  on public.subscription_templates for update to public
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy subscription_templates_manage_staff_delete
  on public.subscription_templates for delete to public using ((select public.is_admin()));

drop policy if exists coaches_select_staff on public.coaches;
create policy coaches_select_staff
  on public.coaches for select to authenticated using ((select public.is_admin()));

drop policy if exists coaches_manage_admin on public.coaches;
create policy coaches_manage_admin_select
  on public.coaches for select to public using ((select public.is_admin()));
create policy coaches_manage_admin_insert
  on public.coaches for insert to public with check ((select public.is_admin()));
create policy coaches_manage_admin_update
  on public.coaches for update to public
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy coaches_manage_admin_delete
  on public.coaches for delete to public using ((select public.is_admin()));

drop policy if exists profiles_select_self_or_staff on public.profiles;
create policy profiles_select_self_or_staff
  on public.profiles for select to authenticated
  using (((user_id = auth.uid()) OR (select public.is_admin())));

drop policy if exists profiles_insert_self_or_admin on public.profiles;
create policy profiles_insert_self_or_admin
  on public.profiles for insert to public
  with check (((user_id = auth.uid()) OR (select public.is_admin())));

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin
  on public.profiles for update to public
  using (((user_id = auth.uid()) OR (select public.is_admin())))
  with check (((user_id = auth.uid()) OR (select public.is_admin())));


-- ── SEPT POLICIES QUI INLINENT LE TEST DE RÔLE ────────────────────────────
-- TROUVÉES PAR L'EXÉCUTION, PAS PAR L'INVENTAIRE. Elles n'appellent pas
-- `is_coach_or_admin()` : elles recopient son prédicat à la main —
--
--     exists (select 1 from profiles p
--              where p.user_id = auth.uid()
--                and p.role = any (array['admin','coach']))
--
-- — et étaient donc INVISIBLES à la recherche qui a bâti la cartographie des
-- 48 tables. Comme les policies permissives sont combinées en OU, elles
-- rendaient tout le reste inopérant sur ces trois tables : n'importe quel
-- compte `profiles.role = 'coach'`, assistant comme collaborateur, lisait et
-- modifiait TOUS les élèves, TOUS les profils et TOUTES les pesées. Le
-- contrôle B2 de la checklist l'a établi en base.
--
-- Elles reçoivent le même traitement que les autres : la portée et la
-- catégorie `suivi_eleve`, avec le niveau correspondant à la commande.

drop policy if exists "Admin and coach can read students" on public.students;
create policy "Admin and coach can read students"
  on public.students for select to authenticated
  using (id in (select public.student_ids_portee()));

drop policy if exists "Admin and coach can update students" on public.students;
create policy "Admin and coach can update students"
  on public.students for update to authenticated
  using (id in (select public.student_ids_suivi_eleve_ecriture()))
  with check (id in (select public.student_ids_suivi_eleve_ecriture()));

drop policy if exists "Admin and coach can read student profiles" on public.student_profiles;
create policy "Admin and coach can read student profiles"
  on public.student_profiles for select to authenticated
  using (student_id in (select public.student_ids_suivi_eleve_lecture()));

drop policy if exists "Admin and coach can update student profiles" on public.student_profiles;
create policy "Admin and coach can update student profiles"
  on public.student_profiles for update to authenticated
  using (student_id in (select public.student_ids_suivi_eleve_ecriture()))
  with check (student_id in (select public.student_ids_suivi_eleve_ecriture()));

drop policy if exists "Admin and coach can read weight entries" on public.weight_entries;
create policy "Admin and coach can read weight entries"
  on public.weight_entries for select to authenticated
  using (student_id in (select public.student_ids_suivi_eleve_lecture()));

drop policy if exists "Admin and coach can insert weight entries" on public.weight_entries;
create policy "Admin and coach can insert weight entries"
  on public.weight_entries for insert to authenticated
  with check (student_id in (select public.student_ids_suivi_eleve_ecriture()));

drop policy if exists "Admin and coach can update weight entries" on public.weight_entries;
create policy "Admin and coach can update weight entries"
  on public.weight_entries for update to authenticated
  using (student_id in (select public.student_ids_suivi_eleve_ecriture()))
  with check (student_id in (select public.student_ids_suivi_eleve_ecriture()));

-- ── CONTRÔLE INTÉGRÉ À LA MIGRATION ────────────────────────────────────────
-- Vérifie, au moment de l'application, qu'il ne reste AUCUNE policy opposant
-- `is_coach_or_admin()` dans le schéma public. Une table oubliée fait donc
-- échouer la migration au lieu de laisser un trou silencieux.
do $$
declare
  v_reste text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
    into v_reste
    from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') like '%is_coach_or_admin%'
       or coalesce(with_check, '') like '%is_coach_or_admin%');
  if v_reste is not null then
    raise exception 'P13-B : policies encore trop larges après migration : %', v_reste;
  end if;

  -- SECONDE FORME, celle qui avait échappé à la cartographie : le prédicat de
  -- `is_coach_or_admin()` recopié à la main contre `profiles`. Une policy qui
  -- accorde l'accès sur le seul rôle, sans portée ni catégorie, est tout aussi
  -- large — et bien plus difficile à voir.
  select string_agg(tablename || '.' || policyname, ', ')
    into v_reste
    from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') ~ 'role = ANY \(ARRAY\[.*(admin|coach)'
       or coalesce(with_check, '') ~ 'role = ANY \(ARRAY\[.*(admin|coach)');
  if v_reste is not null then
    raise exception
      'P13-B : policies accordant l''accès sur le seul rôle, sans portée : %', v_reste;
  end if;
end $$;
