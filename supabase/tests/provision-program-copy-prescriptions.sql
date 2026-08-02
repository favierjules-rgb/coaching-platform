-- =====================================================================
-- Checklist — migration 20260802190000 (copie des training_prescriptions
-- dans provision_program_copy, chantier fix/program-copy-training-prescriptions).
--
-- À exécuter UNIQUEMENT sur la base LOCALE (npm run db:local:init) :
--
--   DB="supabase_db_coaching-platform-bootstrap"
--   docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/provision-program-copy-prescriptions.sql
--
-- Section A : lecture seule. Section B : transaction terminée par ROLLBACK,
-- vérification post-transaction incluse — la base ressort identique.
-- =====================================================================

\echo '── A. Propriétés et privilèges conservés (point 17) ──────────────'

select case
  when (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""' and r.rolname = 'postgres'
          from pg_proc p join pg_roles r on r.oid = p.proowner
         where p.proname = 'provision_program_copy')
   and (select prosrc like '%p.user_id = auth.uid()%' from pg_proc where proname = 'provision_program_copy')
  then 'OK — A1. SECURITY DEFINER, search_path vide, owner postgres, garde user_id'
  else 'ECHEC A1' end as a1;

select case
  when has_function_privilege('authenticated', 'public.provision_program_copy(uuid,uuid,text)', 'execute')
   and has_function_privilege('service_role',  'public.provision_program_copy(uuid,uuid,text)', 'execute')
   and has_function_privilege('postgres',      'public.provision_program_copy(uuid,uuid,text)', 'execute')
   and not has_function_privilege('anon',      'public.provision_program_copy(uuid,uuid,text)', 'execute')
   and not exists (
     select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = 'public.provision_program_copy(uuid,uuid,text)'::regprocedure
        and a.grantee = 0 and a.privilege_type = 'EXECUTE')
  then 'OK — A2. EXECUTE : authenticated + service_role + postgres, ni anon ni PUBLIC'
  else 'ECHEC A2' end as a2;

\echo '── B. Comportement (transaction + ROLLBACK) ──────────────────────'

begin;

-- Décor : coach/admin/student + 3 élèves + 2 programmes.
insert into auth.users (id, instance_id, aud, role, email) values
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checklist-presc-coach@example.test'),
 ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checklist-presc-admin@example.test'),
 ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'checklist-presc-student@example.test');
insert into profiles (user_id, role, first_name, last_name, email) values
 ('00000000-0000-4000-8000-0000000000c1', 'coach', 'Coach', 'Presc', 'checklist-presc-coach@example.test'),
 ('00000000-0000-4000-8000-0000000000c2', 'admin', 'Admin', 'Presc', 'checklist-presc-admin@example.test'),
 ('00000000-0000-4000-8000-0000000000c3', 'student', 'Student', 'Presc', 'checklist-presc-student@example.test');
insert into students (id, first_name, last_name, status, email) values
 ('00000000-0000-4000-8000-000000000031', 'Eleve', 'Un', 'active', 'checklist-presc-e1@example.test'),
 ('00000000-0000-4000-8000-000000000032', 'Eleve', 'Deux', 'active', 'checklist-presc-e2@example.test'),
 ('00000000-0000-4000-8000-000000000033', 'Eleve', 'Trois', 'active', 'checklist-presc-e3@example.test');

-- Programme MUSCULATION PURE (point 1) : 1 bloc strength, 0 prescription.
insert into programs (id, name, program_mode, is_public)
 values ('00000000-0000-4000-8000-000000000041', 'Muscu pure', 'individuel', false);
insert into program_weeks (id, program_id, week_number)
 values ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000041', 1);
insert into workout_sessions (id, program_id, program_week_id, day)
 values ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000041',
         '00000000-0000-4000-8000-000000000042', 'Lundi');
insert into training_blocks (id, session_id, block_type, title, position)
 values ('00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000043', 'standard', 'Force', 1);
insert into workout_exercises (session_id, block_id, order_index, name, sets, reps)
 values ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000044', 0, 'Squat', 4, '8');

-- Programme MIXTE (points 2-9) : bloc strength (1 exercice + 1 prescription
-- PAR EXERCICE) + bloc cardio (2 segments simples + 1 repeat_group parent
-- avec 2 enfants — hiérarchie et ordre à préserver).
insert into programs (id, name, program_mode, is_public)
 values ('00000000-0000-4000-8000-000000000051', 'Mixte cardio muscu', 'individuel', false);
insert into program_weeks (id, program_id, week_number)
 values ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-000000000051', 1);
insert into workout_sessions (id, program_id, program_week_id, day)
 values ('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-000000000051',
         '00000000-0000-4000-8000-000000000052', 'Mardi');
insert into training_blocks (id, session_id, block_type, title, position) values
 ('00000000-0000-4000-8000-000000000054', '00000000-0000-4000-8000-000000000053', 'standard', 'Force', 1),
 ('00000000-0000-4000-8000-000000000055', '00000000-0000-4000-8000-000000000053', 'cardio', 'Fractionné', 2);
insert into workout_exercises (id, session_id, block_id, order_index, name, sets, reps)
 values ('00000000-0000-4000-8000-000000000056', '00000000-0000-4000-8000-000000000053',
         '00000000-0000-4000-8000-000000000054', 0, 'Développé', 3, '10');
-- Prescription PAR EXERCICE (set 1, charge cible, RPE, tempo…).
insert into training_prescriptions (id, exercise_id, set_number, set_type, target_reps, target_load, load_unit, target_rpe, tempo_eccentric, rest_seconds, coach_notes, position)
 values ('00000000-0000-4000-8000-000000000057', '00000000-0000-4000-8000-000000000056',
         1, 'top_set', 10, 80, 'kg', 8, '3', 120, 'Contrôle la descente', 1);
-- Segments cardio : 2 simples + 1 repeat_group parent + 2 enfants.
insert into training_prescriptions (id, block_id, set_number, segment_type, title, position, duration_seconds, intensity_target_type, target_vma_percentage, surface, coach_notes)
 values ('00000000-0000-4000-8000-000000000058', '00000000-0000-4000-8000-000000000055',
         1, 'single', 'Échauffement', 1, 600, 'vma_percentage', 60, 'route', 'Allure très facile'),
        ('00000000-0000-4000-8000-000000000059', '00000000-0000-4000-8000-000000000055',
         1, 'repeat_group', 'Répétitions 4×', 2, null, null, null, null, ''),
        ('00000000-0000-4000-8000-00000000005c', '00000000-0000-4000-8000-000000000055',
         1, 'single', 'Retour au calme', 5, 300, 'free', null, null, '');
update training_prescriptions set repetitions = 4 where id = '00000000-0000-4000-8000-000000000059';
insert into training_prescriptions (id, block_id, parent_prescription_id, set_number, segment_type, title, position, work_duration_seconds, recovery_duration_seconds, intensity_target_type, target_pace_seconds_per_km)
 values ('00000000-0000-4000-8000-00000000005a', '00000000-0000-4000-8000-000000000055',
         '00000000-0000-4000-8000-000000000059', 1, 'work', 'Effort 400 m', 3, 90, null, 'pace', 240),
        ('00000000-0000-4000-8000-00000000005b', '00000000-0000-4000-8000-000000000055',
         '00000000-0000-4000-8000-000000000059', 1, 'recovery', 'Récup', 4, null, 60, 'free', null);

-- Rôle COACH (point 12) pour tout le flux principal.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- 1. Muscu pure : copie inchangée, aucune prescription inventée.
select provision_program_copy('00000000-0000-4000-8000-000000000041',
                              '00000000-0000-4000-8000-000000000031', null) as copie_muscu \gset
reset role;
select case
  when (select count(*) from workout_exercises we join workout_sessions ws on ws.id = we.session_id
         where ws.program_id = :'copie_muscu') = 1
   and (select count(*) from training_prescriptions tp
         where tp.block_id in (select tb.id from training_blocks tb join workout_sessions ws on ws.id = tb.session_id where ws.program_id = :'copie_muscu')
            or tp.exercise_id in (select we.id from workout_exercises we join workout_sessions ws on ws.id = we.session_id where ws.program_id = :'copie_muscu')) = 0
  then 'OK — B1. muscu sans prescription : copie inchangée'
  else 'ECHEC B1' end as b1;

-- 2-4. Mixte : la copie porte TOUTES les prescriptions (6 = 1 exercice + 5 cardio).
set local role authenticated;
select provision_program_copy('00000000-0000-4000-8000-000000000051',
                              '00000000-0000-4000-8000-000000000031', null) as copie_mixte \gset
reset role;
select case
  when (select count(*) from training_prescriptions tp
         where tp.block_id in (select tb.id from training_blocks tb join workout_sessions ws on ws.id = tb.session_id where ws.program_id = :'copie_mixte')) = 5
   and (select count(*) from training_prescriptions tp
         where tp.exercise_id in (select we.id from workout_exercises we join workout_sessions ws on ws.id = we.session_id where ws.program_id = :'copie_mixte')) = 1
  then 'OK — B2. mixte : 5 segments cardio + 1 prescription d''exercice copiés'
  else 'ECHEC B2' end as b2;

-- 5. TOUTES les colonnes conservées (comparaison jsonb hors id/rattachements/horodatage).
select case
  when (select to_jsonb(c) - 'id' - 'block_id' - 'exercise_id' - 'parent_prescription_id' - 'created_at' - 'updated_at'
          from training_prescriptions c
          join training_blocks tb on tb.id = c.block_id
          join workout_sessions ws on ws.id = tb.session_id
         where ws.program_id = :'copie_mixte' and c.title = 'Échauffement')
     = (select to_jsonb(s) - 'id' - 'block_id' - 'exercise_id' - 'parent_prescription_id' - 'created_at' - 'updated_at'
          from training_prescriptions s where s.id = '00000000-0000-4000-8000-000000000058')
   and (select to_jsonb(c) - 'id' - 'block_id' - 'exercise_id' - 'parent_prescription_id' - 'created_at' - 'updated_at'
          from training_prescriptions c
          join workout_exercises we on we.id = c.exercise_id
          join workout_sessions ws on ws.id = we.session_id
         where ws.program_id = :'copie_mixte')
     = (select to_jsonb(s) - 'id' - 'block_id' - 'exercise_id' - 'parent_prescription_id' - 'created_at' - 'updated_at'
          from training_prescriptions s where s.id = '00000000-0000-4000-8000-000000000057')
  then 'OK — B3. toutes les colonnes de prescription conservées (jsonb strict)'
  else 'ECHEC B3' end as b3;

-- 6-7. Rattachements : uniquement les NOUVEAUX ids, jamais ceux du modèle.
select case
  when not exists (select 1 from training_prescriptions tp
         where tp.block_id in ('00000000-0000-4000-8000-000000000055')
           and tp.id not in ('00000000-0000-4000-8000-000000000058','00000000-0000-4000-8000-000000000059',
                             '00000000-0000-4000-8000-00000000005a','00000000-0000-4000-8000-00000000005b',
                             '00000000-0000-4000-8000-00000000005c'))
   and not exists (select 1 from training_prescriptions tp
         join training_blocks tb on tb.id = tp.block_id
         join workout_sessions ws on ws.id = tb.session_id
        where ws.program_id = :'copie_mixte'
          and tp.block_id = '00000000-0000-4000-8000-000000000055')
   and not exists (select 1 from training_prescriptions tp
         join workout_exercises we on we.id = tp.exercise_id
         join workout_sessions ws on ws.id = we.session_id
        where ws.program_id = :'copie_mixte'
          and tp.exercise_id = '00000000-0000-4000-8000-000000000056')
  then 'OK — B4. les prescriptions copiées ne référencent AUCUN id du modèle'
  else 'ECHEC B4' end as b4;

-- 8. Hiérarchie : les 2 enfants copiés pointent vers le repeat_group COPIÉ.
select case
  when (select count(*) from training_prescriptions enfant
          join training_prescriptions parent on parent.id = enfant.parent_prescription_id
          join training_blocks tb on tb.id = enfant.block_id
          join workout_sessions ws on ws.id = tb.session_id
         where ws.program_id = :'copie_mixte'
           and parent.segment_type = 'repeat_group'
           and parent.block_id = enfant.block_id) = 2
  then 'OK — B5. hiérarchie parent → enfants intégralement copiée et remappée'
  else 'ECHEC B5' end as b5;

-- 9. Ordre des segments conservé (positions et titres à l'identique).
select case
  when (select array_agg(c.title order by c.position) from training_prescriptions c
          join training_blocks tb on tb.id = c.block_id
          join workout_sessions ws on ws.id = tb.session_id
         where ws.program_id = :'copie_mixte')
     = (select array_agg(s.title order by s.position) from training_prescriptions s
         where s.block_id = '00000000-0000-4000-8000-000000000055')
  then 'OK — B6. ordre des segments conservé'
  else 'ECHEC B6' end as b6;

-- 10-11. Rejeu : même copie, AUCUN doublon (prescriptions comprises).
set local role authenticated;
select provision_program_copy('00000000-0000-4000-8000-000000000051',
                              '00000000-0000-4000-8000-000000000031', null) as copie_rejeu \gset
reset role;
select case
  when :'copie_rejeu' = :'copie_mixte'
   and (select count(*) from training_prescriptions tp
         where tp.block_id in (select tb.id from training_blocks tb join workout_sessions ws on ws.id = tb.session_id where ws.program_id = :'copie_mixte')
            or tp.exercise_id in (select we.id from workout_exercises we join workout_sessions ws on ws.id = we.session_id where ws.program_id = :'copie_mixte')) = 6
  then 'OK — B7. second appel : même copie, aucun doublon de prescription'
  else 'ECHEC B7' end as b7;

-- 12-13-14. Admin puis service_role provisionnent aussi (élèves 2 et 3).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c2', true);
select provision_program_copy('00000000-0000-4000-8000-000000000051',
                              '00000000-0000-4000-8000-000000000032', null) as copie_admin \gset
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
select provision_program_copy('00000000-0000-4000-8000-000000000051',
                              '00000000-0000-4000-8000-000000000033', 'cs_checklist_presc') as copie_service \gset
select case
  when :'copie_admin' <> '' and :'copie_service' <> ''
   and (select count(*) from training_prescriptions tp
         where tp.block_id in (select tb.id from training_blocks tb join workout_sessions ws on ws.id = tb.session_id where ws.program_id = :'copie_service')) = 5
  then 'OK — B8. coach (B1-B7), admin et service_role autorisés — copies complètes'
  else 'ECHEC B8' end as b8;

-- 15-16. Student et sans-profil refusés.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c3', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$ begin
  perform provision_program_copy('00000000-0000-4000-8000-000000000051',
                                 '00000000-0000-4000-8000-000000000031', null);
  raise exception 'ECHEC B9 : profil student accepté';
exception when insufficient_privilege then raise notice 'OK — B9. profil student refusé';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000ee","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000ee', true);
do $$ begin
  perform provision_program_copy('00000000-0000-4000-8000-000000000051',
                                 '00000000-0000-4000-8000-000000000031', null);
  raise exception 'ECHEC B10 : utilisateur sans profil accepté';
exception when insufficient_privilege then raise notice 'OK — B10. sans profil refusé';
end $$;
reset role;

-- 18. Source absente : NULL rendu, AUCUNE écriture (pas de corruption).
select count(*) as programmes_avant from programs \gset
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select coalesce(provision_program_copy('00000000-0000-4000-8000-0000000000dd',
                              '00000000-0000-4000-8000-000000000031', null)::text, 'NULL') as source_absente \gset
select case
  when :'source_absente' = 'NULL' and (select count(*) from programs) = :programmes_avant
  then 'OK — B11. source inexistante : NULL, zéro écriture'
  else 'ECHEC B11' end as b11;

-- 19. Assignations : toujours vers les copies, jamais vers le modèle.
select case
  when not exists (select 1 from assignments where content_id in
        ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000051'))
   and (select count(*) from assignments where content_id in (:'copie_muscu', :'copie_mixte', :'copie_admin', :'copie_service')) = 4
  then 'OK — B12. assignations dirigées vers les copies uniquement'
  else 'ECHEC B12' end as b12;

rollback;

-- 20. ROLLBACK complet : plus aucune donnée de la checklist.
select case
  when not exists (select 1 from students where email like 'checklist-presc-%')
   and not exists (select 1 from profiles where email like 'checklist-presc-%')
   and not exists (select 1 from auth.users where email like 'checklist-presc-%')
   and not exists (select 1 from programs where id in
        ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000051'))
   and not exists (select 1 from training_prescriptions where id = '00000000-0000-4000-8000-000000000058')
  then 'OK — B13. rollback complet : base strictement identique'
  else 'ECHEC B13' end as b13;

\echo '── Checklist prescriptions terminée : A1-A2 et B1-B13 doivent être OK ──'
