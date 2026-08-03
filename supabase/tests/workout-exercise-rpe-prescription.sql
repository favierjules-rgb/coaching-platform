-- =====================================================================
-- Checklist — migration 20260803190000 (prescription RPE cible,
-- chantier feat/student-previous-set-performance, volet builder).
--
-- À exécuter UNIQUEMENT sur la base LOCALE (npm run db:local:init) :
--
--   DB="supabase_db_coaching-platform-bootstrap"
--   docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/workout-exercise-rpe-prescription.sql
--
-- Section A : lecture seule (colonne, fonctions, RLS). Section B :
-- transaction terminée par ROLLBACK — sauvegarde builder RÉELLE (RPC avec
-- auth coach simulée via request.jwt.claims), copie RÉELLE
-- (provision_program_copy) et rejeu, anciennes lignes intactes.
-- =====================================================================

\echo '── A. Structure, fonctions et RLS (lecture seule) ─────────────────'

-- A1 : colonne recommended_rpe présente, texte, NULLABLE, sans défaut.
select case
  when (select is_nullable = 'YES' and data_type = 'text' and column_default is null
          from information_schema.columns
         where table_schema = 'public' and table_name = 'workout_exercises' and column_name = 'recommended_rpe')
  then 'OK — A1. colonne recommended_rpe text nullable sans défaut'
  else 'ECHEC A1' end as a1;

-- A2 : les DEUX fonctions recréées portent la colonne, garanties intactes.
select case
  when (select prosrc like '%recommended_rpe%' from pg_proc where proname = 'save_training_session_blocks')
   and (select not prosecdef from pg_proc where proname = 'save_training_session_blocks')
   and (select prosrc like '%recommended_rpe%' from pg_proc where proname = 'provision_program_copy')
   and (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""' and r.rolname = 'postgres'
          from pg_proc p join pg_roles r on r.oid = p.proowner
         where p.proname = 'provision_program_copy')
   and (select prosrc like '%p.user_id = auth.uid()%' from pg_proc where proname = 'provision_program_copy')
   and not has_function_privilege('anon', 'public.save_training_session_blocks(jsonb)', 'execute')
   and not has_function_privilege('anon', 'public.provision_program_copy(uuid,uuid,text)', 'execute')
   and has_function_privilege('authenticated', 'public.save_training_session_blocks(jsonb)', 'execute')
   and has_function_privilege('service_role', 'public.provision_program_copy(uuid,uuid,text)', 'execute')
  then 'OK — A2. fonctions recréées avec recommended_rpe, sécurité et privilèges intacts'
  else 'ECHEC A2' end as a2;

-- A3 : RLS/policies de workout_exercises inchangées (2 policies d'origine).
select case
  when (select relrowsecurity from pg_class where oid = 'public.workout_exercises'::regclass)
   and (select count(*) = 2 from pg_policies where schemaname = 'public' and tablename = 'workout_exercises')
   and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workout_exercises' and policyname = 'workout_exercises_manage_staff')
   and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workout_exercises' and policyname = 'workout_exercises_select_assigned_student')
  then 'OK — A3. RLS activée, les 2 policies d''origine seules et intactes'
  else 'ECHEC A3' end as a3;

\echo '── B. Comportement (transaction + ROLLBACK) ──────────────────────'

begin;

-- Décor : coach authentifié simulé + élève + programme modèle complet.
insert into auth.users (id, email) values ('f0000000-0000-4000-8000-0000000000f0', 'coach-rpe@example.test') on conflict do nothing;
insert into public.profiles (user_id, role) values ('f0000000-0000-4000-8000-0000000000f0', 'coach')
  on conflict (user_id) do update set role = 'coach';
insert into public.students (id, first_name, last_name, email, status)
values ('f0000000-0000-4000-8000-0000000000f1', 'Test', 'RpeCible', 'test-rpe-cible@example.test', 'active');
insert into public.programs (id, name) values ('f0000000-0000-4000-8000-0000000000f2', 'Modèle RPE cible');
insert into public.program_weeks (id, program_id, week_number) values ('f0000000-0000-4000-8000-0000000000f3', 'f0000000-0000-4000-8000-0000000000f2', 1);
insert into public.workout_sessions (id, program_id, program_week_id, day, session_type, updated_at)
values ('f0000000-0000-4000-8000-0000000000f4', 'f0000000-0000-4000-8000-0000000000f2', 'f0000000-0000-4000-8000-0000000000f3', 'lundi', 'strength', '2026-08-01T00:00:00Z');

-- « Ancienne » ligne : exercice existant SANS prescription (rattaché plus
-- tard par la RPC, colonne jamais touchée par la migration).
insert into public.training_blocks (id, session_id, block_type, position)
values ('f0000000-0000-4000-8000-0000000000f5', 'f0000000-0000-4000-8000-0000000000f4', 'strength', 0);
insert into public.workout_exercises (id, session_id, block_id, order_index, name, sets, reps)
values ('f0000000-0000-4000-8000-0000000000f6', 'f0000000-0000-4000-8000-0000000000f4', 'f0000000-0000-4000-8000-0000000000f5', 0, 'Ancien exercice', 3, '10');

-- B1 : les anciennes lignes sont à NULL (aucun backfill).
select case
  when (select recommended_rpe is null from public.workout_exercises where id = 'f0000000-0000-4000-8000-0000000000f6')
  then 'OK — B1. ancienne ligne : recommended_rpe NULL, intacte'
  else 'ECHEC B1' end as b1;

-- Auth coach simulée pour les fonctions (auth.uid() lit request.jwt.claims —
-- même technique que save_training_session_blocks_test.sql).
select set_config('request.jwt.claims', json_build_object('sub', 'f0000000-0000-4000-8000-0000000000f0')::text, true);

-- B2 : sauvegarde builder RÉELLE — l'exercice existant reçoit « 8-8-9 »,
-- un nouvel exercice arrive avec « 8 », un autre sans prescription.
select public.save_training_session_blocks(jsonb_build_object(
  'session_id', 'f0000000-0000-4000-8000-0000000000f4',
  'expected_updated_at', '2026-08-01T00:00:00+00:00',
  'blocks', jsonb_build_array(jsonb_build_object(
    'id', 'f0000000-0000-4000-8000-0000000000f5',
    'category', 'strength',
    'exercises', jsonb_build_array(
      jsonb_build_object('id', 'f0000000-0000-4000-8000-0000000000f6', 'name', 'Ancien exercice', 'sets', 3, 'reps', '13', 'recommended_load', '30', 'recommended_rpe', '8-8-9'),
      jsonb_build_object('id', 'new-exercise:f0000000-0000-4000-8000-0000000000f7', 'name', 'Nouveau unique', 'sets', 3, 'reps', '8', 'recommended_rpe', '8'),
      jsonb_build_object('id', 'new-exercise:f0000000-0000-4000-8000-0000000000f8', 'name', 'Sans prescription', 'sets', 3, 'reps', '8', 'recommended_rpe', '')
    )
  ))
)) as resultat \gset rpc_

select case
  when (select recommended_rpe = '8-8-9' from public.workout_exercises where id = 'f0000000-0000-4000-8000-0000000000f6')
   and (select recommended_rpe = '8' from public.workout_exercises where session_id = 'f0000000-0000-4000-8000-0000000000f4' and name = 'Nouveau unique')
   and (select recommended_rpe is null from public.workout_exercises where session_id = 'f0000000-0000-4000-8000-0000000000f4' and name = 'Sans prescription')
  then 'OK — B2. sauvegarde builder : séquence, valeur unique, et '''' normalisé en NULL'
  else 'ECHEC B2' end as b2;

-- B3 : rechargement — le modèle canonique retourné par la RPC porte la clé.
select case
  when (:'rpc_resultat')::jsonb #>> '{blocks,0,exercises,0,recommendedRpe}' = '8-8-9'
  then 'OK — B3. modèle canonique retourné avec recommendedRpe (rechargement sans perte)'
  else 'ECHEC B3' end as b3;

-- B4 : copie RÉELLE — provision_program_copy copie la prescription.
select public.provision_program_copy('f0000000-0000-4000-8000-0000000000f2', 'f0000000-0000-4000-8000-0000000000f1', null) as copie_1 \gset
select public.provision_program_copy('f0000000-0000-4000-8000-0000000000f2', 'f0000000-0000-4000-8000-0000000000f1', null) as copie_2 \gset

select case
  when (select count(*) = 1 from public.workout_exercises we
          join public.workout_sessions ws on ws.id = we.session_id
         where ws.program_id = :'copie_1' and we.recommended_rpe = '8-8-9')
   and (select count(*) = 1 from public.workout_exercises we
          join public.workout_sessions ws on ws.id = we.session_id
         where ws.program_id = :'copie_1' and we.recommended_rpe = '8')
  then 'OK — B4. copie individuelle : prescriptions RPE copiées (séquence et valeur unique)'
  else 'ECHEC B4' end as b4;

-- B5 : rejeu sans doublon — même copie, pas de duplication d'exercices.
select case
  when :'copie_1' = :'copie_2'
   and (select count(*) = 1 from public.programs where owner_student_id = 'f0000000-0000-4000-8000-0000000000f1' and source_template_id = 'f0000000-0000-4000-8000-0000000000f2')
  then 'OK — B5. rejeu idempotent : une seule copie, aucun doublon'
  else 'ECHEC B5' end as b5;

rollback;

-- B6 : rollback complet — plus aucune trace du jeu d'essai.
select case
  when not exists (select 1 from public.students where email = 'test-rpe-cible@example.test')
   and not exists (select 1 from public.programs where name = 'Modèle RPE cible')
   and not exists (select 1 from public.workout_exercises where recommended_rpe is not null)
  then 'OK — B6. rollback complet, base identique (aucune prescription persistante)'
  else 'ECHEC B6' end as b6;

\echo '── Checklist workout-exercise-rpe-prescription terminée ───────────'
