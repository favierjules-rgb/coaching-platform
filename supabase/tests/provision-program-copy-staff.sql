-- =====================================================================
-- Checklist — migration 20260801210000 (correctif du chemin STAFF de
-- provision_program_copy, chantier fix/program-assignment-checkbox).
--
-- À exécuter UNIQUEMENT sur la base LOCALE (npm run db:local:init) :
--
--   DB="supabase_db_coaching-platform-bootstrap"
--   docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/provision-program-copy-staff.sql
--
-- Trou de couverture corrigé : la checklist phase 1 endossait service_role —
-- le chemin coach/admin authentifié (profil résolu par profiles.user_id =
-- auth.uid()) n'était jamais exercé. Chaque point imprime « OK — … » ou
-- échoue bruyamment ; la section transactionnelle se termine par ROLLBACK
-- et la base ressort STRICTEMENT identique (vérifié en fin de fichier).
-- =====================================================================

\echo '── A. Fonction : colonne de résolution, propriétés, privilèges ───'

-- A1 (point 5). La garde utilise user_id — jamais p.id = auth.uid().
select case
  when (select prosrc like '%p.user_id = auth.uid()%'
          and prosrc not like '%p.id = auth.uid()%'
          from pg_proc where proname = 'provision_program_copy')
  then 'OK — A1. garde d''autorisation sur profiles.user_id, jamais profiles.id'
  else 'ECHEC A1 : la garde utilise encore la mauvaise colonne' end as a1;

-- A2 (point 9). SECURITY DEFINER + search_path vide + owner postgres.
select case
  when (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
          and r.rolname = 'postgres'
          from pg_proc p join pg_roles r on r.oid = p.proowner
         where p.proname = 'provision_program_copy')
  then 'OK — A2. SECURITY DEFINER, search_path vide, owner postgres'
  else 'ECHEC A2 : propriétés de la fonction altérées' end as a2;

-- A3 (point 9). Relations qualifiées public.* (aucune table nue dans le corps).
select case
  when (select prosrc like '%public.programs%' and prosrc like '%public.profiles%'
          and prosrc like '%public.program_weeks%' and prosrc like '%public.workout_sessions%'
          and prosrc like '%public.training_blocks%' and prosrc like '%public.workout_exercises%'
          and prosrc like '%public.assignments%'
          from pg_proc where proname = 'provision_program_copy')
  then 'OK — A3. toutes les relations qualifiées public.*'
  else 'ECHEC A3 : relation non qualifiée' end as a3;

-- A4 (point 9). Privilèges : authenticated + service_role + postgres, ni anon ni PUBLIC.
select case
  when has_function_privilege('authenticated', 'public.provision_program_copy(uuid,uuid,text)', 'execute')
   and has_function_privilege('service_role',  'public.provision_program_copy(uuid,uuid,text)', 'execute')
   and has_function_privilege('postgres',      'public.provision_program_copy(uuid,uuid,text)', 'execute')
   and not has_function_privilege('anon',      'public.provision_program_copy(uuid,uuid,text)', 'execute')
   and not exists (
     select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = 'public.provision_program_copy(uuid,uuid,text)'::regprocedure
        and a.grantee = 0 and a.privilege_type = 'EXECUTE')
  then 'OK — A4. EXECUTE : authenticated + service_role + postgres, ni anon ni PUBLIC'
  else 'ECHEC A4 : privilèges incorrects' end as a4;

\echo '── B. Comportement (transaction + ROLLBACK) ──────────────────────'

begin;

-- Décor : un coach, un admin, un profil student, deux élèves, un programme
-- complet (semaine → séance → bloc → 2 exercices).
insert into auth.users (id, instance_id, aud, role, email) values
 ('00000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checklist-staff-coach@example.test'),
 ('00000000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checklist-staff-admin@example.test'),
 ('00000000-0000-4000-8000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checklist-staff-student@example.test');
insert into profiles (user_id, role, first_name, last_name, email) values
 ('00000000-0000-4000-8000-00000000000c', 'coach', 'Coach', 'Test', 'checklist-staff-coach@example.test'),
 ('00000000-0000-4000-8000-00000000000d', 'admin', 'Admin', 'Test', 'checklist-staff-admin@example.test'),
 ('00000000-0000-4000-8000-00000000000e', 'student', 'Student', 'Test', 'checklist-staff-student@example.test');
insert into students (id, first_name, last_name, status, email) values
 ('00000000-0000-4000-8000-000000000021', 'Eleve', 'Un', 'active', 'checklist-staff-eleve1@example.test'),
 ('00000000-0000-4000-8000-000000000025', 'Eleve', 'Deux', 'active', 'checklist-staff-eleve2@example.test');
insert into programs (id, name, program_mode, is_public)
 values ('00000000-0000-4000-8000-000000000022', 'Programme staff', 'individuel', false);
insert into program_weeks (id, program_id, week_number)
 values ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000022', 1);
insert into workout_sessions (id, program_id, program_week_id, day)
 values ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000022',
         '00000000-0000-4000-8000-000000000023', 'Lundi');
insert into training_blocks (id, session_id, block_type, title, position)
 values ('00000000-0000-4000-8000-000000000026', '00000000-0000-4000-8000-000000000024', 'standard', 'Bloc force', 1);
insert into workout_exercises (session_id, block_id, order_index, name, sets, reps)
 values ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000026', 0, 'Squat', 4, '8'),
        ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000026', 1, 'Développé couché', 3, '10');

-- B1 (point 1). COACH authentifié (profil par user_id) → la RPC réussit.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000c', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select provision_program_copy('00000000-0000-4000-8000-000000000022',
                              '00000000-0000-4000-8000-000000000021', null) as copie \gset
select case when :'copie' <> '' and :'copie' <> '00000000-0000-4000-8000-000000000022'
       then 'OK — B1. coach authentifié : copie provisionnée (bug corrigé)'
       else 'ECHEC B1 : la RPC n''a pas créé de copie pour le coach' end as b1;
reset role;

-- B2 (points 6-7). Copie COMPLÈTE (owner, source, semaines, séances, blocs,
--     exercices) et assignation pointant vers la copie.
select case
  when (select owner_student_id from programs where id = :'copie') = '00000000-0000-4000-8000-000000000021'
   and (select source_template_id from programs where id = :'copie') = '00000000-0000-4000-8000-000000000022'
   and (select count(*) from program_weeks where program_id = :'copie') = 1
   and (select count(*) from workout_sessions where program_id = :'copie') = 1
   and (select count(*) from training_blocks tb join workout_sessions ws on ws.id = tb.session_id
         where ws.program_id = :'copie') = 1
   and (select count(*) from workout_exercises we join workout_sessions ws on ws.id = we.session_id
         where ws.program_id = :'copie') = 2
  then 'OK — B2. copie complète : owner + source + 1 semaine + 1 séance + 1 bloc + 2 exercices'
  else 'ECHEC B2 : copie incomplète' end as b2;
select case
  when (select count(*) from assignments
         where student_id = '00000000-0000-4000-8000-000000000021' and content_id = :'copie') = 1
   and not exists (select 1 from assignments where content_id = '00000000-0000-4000-8000-000000000022')
  then 'OK — B2bis. assignation vers la copie, jamais vers le modèle'
  else 'ECHEC B2bis : assignation incorrecte' end as b2bis;

-- B3 (point 8). Second appel IDENTIQUE → même copie, aucun doublon.
set local role authenticated;
select provision_program_copy('00000000-0000-4000-8000-000000000022',
                              '00000000-0000-4000-8000-000000000021', null) as copie2 \gset
reset role;
select case when :'copie' = :'copie2'
        and (select count(*) from programs where owner_student_id = '00000000-0000-4000-8000-000000000021') = 1
       then 'OK — B3. rejeu : la copie existante est réutilisée'
       else 'ECHEC B3 : doublon de copie' end as b3;

-- B4 (point 2). ADMIN authentifié → réussit aussi (2e élève, nouvelle copie).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000d', true);
select provision_program_copy('00000000-0000-4000-8000-000000000022',
                              '00000000-0000-4000-8000-000000000025', null) as copie_admin \gset
reset role;
select case when :'copie_admin' <> '' and
        (select owner_student_id from programs where id = :'copie_admin') = '00000000-0000-4000-8000-000000000025'
       then 'OK — B4. admin authentifié : la RPC réussit également'
       else 'ECHEC B4 : refus pour l''admin' end as b4;

-- B5 (point 4). Profil STUDENT → refusé (insufficient_privilege).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000e', true);
do $$
begin
  perform provision_program_copy('00000000-0000-4000-8000-000000000022',
                                 '00000000-0000-4000-8000-000000000021', null);
  raise exception 'ECHEC B5 : un profil student a pu provisionner';
exception when insufficient_privilege then
  raise notice 'OK — B5. profil student : accès refusé';
end $$;
reset role;

-- B6 (point 3). Authentifié SANS profil → refusé.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000ff","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000ff', true);
do $$
begin
  perform provision_program_copy('00000000-0000-4000-8000-000000000022',
                                 '00000000-0000-4000-8000-000000000021', null);
  raise exception 'ECHEC B6 : un utilisateur sans profil a pu provisionner';
exception when insufficient_privilege then
  raise notice 'OK — B6. sans profil : accès refusé';
end $$;
reset role;

rollback;

-- C (point 10). Le ROLLBACK a tout annulé : plus AUCUNE donnée de test.
select case
  when not exists (select 1 from programs where id in
        ('00000000-0000-4000-8000-000000000022') or owner_student_id in
        ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000025'))
   and not exists (select 1 from students where email like 'checklist-staff-%')
   and not exists (select 1 from profiles where email like 'checklist-staff-%')
   and not exists (select 1 from auth.users where email like 'checklist-staff-%')
  then 'OK — C. rollback complet : base strictement identique'
  else 'ECHEC C : des données de test ont survécu' end as c;

\echo '── Checklist staff terminée : A1-A4, B1-B6 et C doivent être OK ──'
