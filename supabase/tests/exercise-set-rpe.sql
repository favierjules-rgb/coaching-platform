-- =====================================================================
-- Checklist — migration 20260803120000 (RPE par série,
-- chantier feat/student-previous-set-performance, option B).
--
-- À exécuter UNIQUEMENT sur la base LOCALE (npm run db:local:init) :
--
--   DB="supabase_db_coaching-platform-bootstrap"
--   docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/exercise-set-rpe.sql
--
-- Section A : lecture seule (colonne, contrainte, RLS). Section B :
-- transaction terminée par ROLLBACK — la base ressort identique, aucun
-- feedback existant n'est modifié (vérifié par empreinte avant/après).
-- =====================================================================

\echo '── A. Structure et RLS (lecture seule) ───────────────────────────'

-- A1 (point 1) : colonne rpe présente, type integer, NULLABLE, sans défaut.
select case
  when (select is_nullable = 'YES' and data_type = 'integer' and column_default is null
          from information_schema.columns
         where table_schema = 'public' and table_name = 'exercise_set_feedback' and column_name = 'rpe')
  then 'OK — A1. colonne rpe integer nullable sans défaut'
  else 'ECHEC A1' end as a1;

-- A2 : contrainte CHECK avec les bornes exactes (NULL autorisé, 1..10).
select case
  when exists (
    select 1 from pg_constraint
     where conname = 'exercise_set_feedback_rpe_check'
       and conrelid = 'public.exercise_set_feedback'::regclass
       and contype = 'c' and convalidated)
  then 'OK — A2. contrainte exercise_set_feedback_rpe_check présente et VALIDÉE'
  else 'ECHEC A2' end as a2;

-- A3 (point 9) : RLS inchangée — activée, et l''unique policy d''origine
-- (student_or_staff) toujours seule sur la table.
select case
  when (select relrowsecurity from pg_class where oid = 'public.exercise_set_feedback'::regclass)
   and (select count(*) = 1 from pg_policies
         where schemaname = 'public' and tablename = 'exercise_set_feedback')
   and exists (select 1 from pg_policies
         where schemaname = 'public' and tablename = 'exercise_set_feedback'
           and policyname = 'exercise_set_feedback_student_or_staff')
  then 'OK — A3. RLS activée, policy exercise_set_feedback_student_or_staff seule et intacte'
  else 'ECHEC A3' end as a3;

\echo '── B. Comportement (transaction + ROLLBACK) ──────────────────────'

begin;

-- Jeu d''essai isolé (uuid dédiés, emails uniques @example.test — règle
-- maison depuis l''incident students_email_unique). Statut EXPLICITE
-- 'active' : students_status_check n''accepte que active/paused/completed,
-- le DEFAULT 'actif' de la colonne violerait la contrainte.
insert into public.students (id, first_name, last_name, email, status)
values ('a0000000-0000-4000-8000-00000000000a', 'Test', 'Rpe', 'test-rpe-checklist@example.test', 'active');

insert into public.workout_feedback (id, student_id, session_key, session_ref_label, completed, submitted_at)
values
  ('b0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000a', 'chk-ancienne', 'Ancienne séance', true, now()),
  ('b0000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-00000000000a', 'chk-nouvelle', 'Nouvelle séance', true, now());

-- « Ancien » retour : RPE global d''exercice uniquement, séries SANS rpe.
insert into public.exercise_feedback (id, workout_feedback_id, student_id, exercise_name, exercise_order, rpe, comment)
values ('c0000000-0000-4000-8000-00000000000c', 'b0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000a', 'Squat', 0, 7, '');

insert into public.exercise_set_feedback (exercise_feedback_id, student_id, set_number, load_used, reps_done)
values
  ('c0000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-00000000000a', 1, '80 kg', '8'),
  ('c0000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-00000000000a', 2, '80 kg', '7');

-- Empreinte de l''« ancien » retour AVANT le reste du test (point 8).
create temp table chk_empreinte_avant as
select id, set_number, load_used, reps_done, rpe
  from public.exercise_set_feedback
 where exercise_feedback_id = 'c0000000-0000-4000-8000-00000000000c';

-- B1 (point 2) : NULL accepté (les deux lignes ci-dessus en sont la preuve).
select case
  when (select count(*) = 2 from public.exercise_set_feedback
         where exercise_feedback_id = 'c0000000-0000-4000-8000-00000000000c' and rpe is null)
  then 'OK — B1. rpe NULL accepté (ancien format inchangé)'
  else 'ECHEC B1' end as b1;

-- « Nouveau » retour : RPE DIFFÉRENT par série, exercice sans rpe global.
insert into public.exercise_feedback (id, workout_feedback_id, student_id, exercise_name, exercise_order, rpe, comment)
values ('c0000000-0000-4000-8000-00000000000d', 'b0000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-00000000000a', 'Développé couché', 0, null, '');

-- B2 (points 3 et 7) : bornes 1 et 10 acceptées, valeurs distinctes par série.
insert into public.exercise_set_feedback (exercise_feedback_id, student_id, set_number, load_used, reps_done, rpe)
values
  ('c0000000-0000-4000-8000-00000000000d', 'a0000000-0000-4000-8000-00000000000a', 1, '45 kg', '10', 1),
  ('c0000000-0000-4000-8000-00000000000d', 'a0000000-0000-4000-8000-00000000000a', 2, '45 kg', '10', 5),
  ('c0000000-0000-4000-8000-00000000000d', 'a0000000-0000-4000-8000-00000000000a', 3, '45 kg', '9', 10);

select case
  when (select array_agg(rpe order by set_number) = array[1, 5, 10]
          from public.exercise_set_feedback
         where exercise_feedback_id = 'c0000000-0000-4000-8000-00000000000d')
  then 'OK — B2. RPE 1/5/10 enregistrés, un par série, valeurs distinctes relues'
  else 'ECHEC B2' end as b2;

-- B3 (point 4) : 0 refusé par la contrainte.
do $$
begin
  begin
    insert into public.exercise_set_feedback (exercise_feedback_id, student_id, set_number, load_used, reps_done, rpe)
    values ('c0000000-0000-4000-8000-00000000000d', 'a0000000-0000-4000-8000-00000000000a', 4, '', '', 0);
    raise exception 'ECHEC B3 : rpe = 0 accepté';
  exception
    when check_violation then raise notice 'OK — B3. rpe = 0 refusé (check_violation)';
  end;
end $$;

-- B4 (point 5) : 11 refusé par la contrainte.
do $$
begin
  begin
    insert into public.exercise_set_feedback (exercise_feedback_id, student_id, set_number, load_used, reps_done, rpe)
    values ('c0000000-0000-4000-8000-00000000000d', 'a0000000-0000-4000-8000-00000000000a', 4, '', '', 11);
    raise exception 'ECHEC B4 : rpe = 11 accepté';
  exception
    when check_violation then raise notice 'OK — B4. rpe = 11 refusé (check_violation)';
  end;
end $$;

-- B5 (point 6) : l''ancien retour reste entièrement lisible (mêmes colonnes
-- qu''avant + rpe NULL), la lecture jointe exercice→séries fonctionne.
select case
  when (select count(*) = 2
          from public.exercise_feedback ef
          join public.exercise_set_feedback esf on esf.exercise_feedback_id = ef.id
         where ef.id = 'c0000000-0000-4000-8000-00000000000c'
           and ef.rpe = 7 and esf.rpe is null and esf.load_used <> '')
  then 'OK — B5. ancien feedback (rpe global 7, séries NULL) lisible tel quel'
  else 'ECHEC B5' end as b5;

-- B6 (point 8) : aucune ligne de l''« ancien » retour modifiée par tout ce
-- qui précède (empreinte identique champ à champ).
select case
  when not exists (
    (select id, set_number, load_used, reps_done, rpe from public.exercise_set_feedback
      where exercise_feedback_id = 'c0000000-0000-4000-8000-00000000000c'
     except select * from chk_empreinte_avant)
    union all
    (select * from chk_empreinte_avant
     except select id, set_number, load_used, reps_done, rpe from public.exercise_set_feedback
      where exercise_feedback_id = 'c0000000-0000-4000-8000-00000000000c'))
  then 'OK — B6. aucun ancien feedback modifié (empreinte identique)'
  else 'ECHEC B6' end as b6;

rollback;

-- B7 (point 10) : rollback complet — plus aucune trace du jeu d''essai.
select case
  when not exists (select 1 from public.students where email = 'test-rpe-checklist@example.test')
   and not exists (select 1 from public.workout_feedback where session_key in ('chk-ancienne', 'chk-nouvelle'))
  then 'OK — B7. rollback complet, base identique'
  else 'ECHEC B7' end as b7;

\echo '── Checklist exercise-set-rpe terminée ───────────────────────────'
