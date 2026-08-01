-- =====================================================================
-- Checklist de vérification — migration 20260801120000 (phase 1 de
-- l'historique des séances, chantier feat/student-workout-history).
--
-- À exécuter UNIQUEMENT sur la base LOCALE construite par
-- `npm run db:local:init` — jamais sur la production.
--
--   DB="supabase_db_coaching-platform-bootstrap"
--   docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/workout-feedback-history-phase1.sql
--
-- Garanties : la section A est en lecture seule ; la section B crée son
-- décor DANS une transaction terminée par ROLLBACK — la base ressort
-- strictement identique. Chaque vérification imprime un libellé « OK — … »
-- ou échoue bruyamment (ON_ERROR_STOP).
-- =====================================================================

\echo '── A. Structure de la migration ──────────────────────────────────'

-- A1. Les 4 colonnes d'historique, toutes NULLABLES (rétrocompatibilité).
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'workout_feedback'
   and column_name in ('prescribed_snapshot', 'performed_at', 'duration_minutes', 'session_status')
 order by column_name;

-- A2. Contraintes de validité.
select conname
  from pg_constraint
 where conrelid = 'public.workout_feedback'::regclass
   and conname in ('workout_feedback_session_status_check', 'workout_feedback_duration_minutes_check')
 order by conname;

-- A3. Index partiels de la phase 1 + index unique des sessions d'achat.
select indexname
  from pg_indexes
 where schemaname = 'public'
   and indexname in ('workout_feedback_student_performed_idx',
                     'workout_feedback_session_idx',
                     'programs_source_checkout_session_key')
 order by indexname;

-- A4. Trigger d'immutabilité, actif ('O' = enabled origin).
select tgname, tgenabled
  from pg_trigger
 where tgrelid = 'public.workout_feedback'::regclass
   and tgname = 'workout_feedback_snapshot_immutable';

-- A5. RPC transactionnelle, SECURITY DEFINER (prosecdef = t).
select p.proname, p.prosecdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'provision_program_copy';

-- A5bis. Privilèges de la RPC : authenticated + service_role SEULEMENT.
-- Ni anon (grant direct hérité des DEFAULT PRIVILEGES Supabase, révoqué
-- explicitement par la migration), ni PUBLIC (grantee 0 dans l'ACL).
select case
  when has_function_privilege('authenticated', 'public.provision_program_copy(uuid,uuid,text)', 'execute')
   and has_function_privilege('service_role',  'public.provision_program_copy(uuid,uuid,text)', 'execute')
   and not has_function_privilege('anon',      'public.provision_program_copy(uuid,uuid,text)', 'execute')
   and not exists (
     select 1
       from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = 'public.provision_program_copy(uuid,uuid,text)'::regprocedure
        and a.grantee = 0 and a.privilege_type = 'EXECUTE')
  then 'OK — A5bis privilèges RPC : authenticated + service_role, ni anon ni PUBLIC'
  else 'ECHEC A5bis : privilèges RPC incorrects' end as a5bis;

-- A6. FK session_id : 'n' = ON DELETE SET NULL (comportement pré-existant conservé).
select confdeltype as fk_session_on_delete
  from pg_constraint
 where conrelid = 'public.workout_feedback'::regclass
   and confrelid = 'public.workout_sessions'::regclass;

-- A7. RLS active sur workout_feedback, politique unique élève-ou-staff.
select relrowsecurity as rls_active from pg_class where oid = 'public.workout_feedback'::regclass;
select policyname from pg_policies
 where schemaname = 'public' and tablename = 'workout_feedback' order by policyname;

\echo '── B. Comportement (transaction + ROLLBACK, base intacte) ────────'

begin;

-- Le service (webhook) est le seul appelant légitime hors staff : on
-- endosse son rôle pour la RPC (les deux GUC couvrent les versions d'auth).
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.role', 'service_role', true);

-- Décor minimal. `email` est UNIQUE en base (students_email_unique) et son
-- défaut est '' : chaque élève de test doit donc porter une adresse
-- distincte, en @example.test comme le seed.
insert into students (id, first_name, last_name, status, email)
 values ('00000000-0000-4000-8000-000000000001', 'Test', 'Local', 'active',
         'checklist-phase1@example.test');
insert into programs (id, name, program_mode, is_public)
 values ('00000000-0000-4000-8000-000000000002', 'Programme test', 'individuel', true);
insert into program_weeks (id, program_id, week_number)
 values ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 1);
insert into workout_sessions (id, program_id, program_week_id, day)
 values ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002',
         '00000000-0000-4000-8000-000000000003', 'Lundi');

-- B1. Clonage : 1er appel crée la copie, 2e appel (MÊME session Checkout)
--     rend la MÊME copie — idempotence du rejeu de webhook.
select provision_program_copy('00000000-0000-4000-8000-000000000002',
                              '00000000-0000-4000-8000-000000000001', 'cs_local_1') as premiere \gset
select provision_program_copy('00000000-0000-4000-8000-000000000002',
                              '00000000-0000-4000-8000-000000000001', 'cs_local_1') as seconde \gset
select case when :'premiere' = :'seconde'
       then 'OK — B1 idempotence : même session → même copie'
       else 'ECHEC B1 : deux copies pour la même session' end as b1;

-- B2. La copie est complète, individuelle, jamais le produit du catalogue.
select case when (select count(*) from program_weeks where program_id = :'premiere') = 1
        and (select count(*) from workout_sessions where program_id = :'premiere') = 1
        and (select owner_student_id from programs where id = :'premiere') = '00000000-0000-4000-8000-000000000001'
        and (select is_public from programs where id = :'premiere') = false
       then 'OK — B2 copie complète (semaine + séance), possédée, non publique'
       else 'ECHEC B2 : copie incomplète ou mal étiquetée' end as b2;
select case when (select count(*) from assignments
                   where student_id = '00000000-0000-4000-8000-000000000001'
                     and content_id  = :'premiere') = 1
        and not exists (select 1 from assignments
                         where content_id = '00000000-0000-4000-8000-000000000002')
       then 'OK — B2bis assignation vers la copie, jamais vers le catalogue'
       else 'ECHEC B2bis : assignation incorrecte' end as b2bis;

-- B3. NOUVELLE session Checkout → nouveau cycle (nouvelle copie).
select provision_program_copy('00000000-0000-4000-8000-000000000002',
                              '00000000-0000-4000-8000-000000000001', 'cs_local_2') as troisieme \gset
select case when :'premiere' <> :'troisieme'
       then 'OK — B3 nouvelle session → nouveau cycle'
       else 'ECHEC B3 : la nouvelle session a réutilisé l''ancienne copie' end as b3;

-- B4. Immutabilité : une fois posé, le snapshot ne peut plus être réécrit.
insert into workout_feedback (id, student_id, session_id, completed, prescribed_snapshot)
 values ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001',
         '00000000-0000-4000-8000-000000000004', true, '{"version":1}'::jsonb);
do $$
begin
  update public.workout_feedback
     set prescribed_snapshot = '{"version":2}'::jsonb
   where id = '00000000-0000-4000-8000-000000000005';
  raise exception 'ECHEC B4 : la réécriture du snapshot aurait dû être rejetée';
exception when check_violation then
  raise notice 'OK — B4 snapshot immuable (réécriture rejetée par le trigger)';
end $$;

-- B5. ON DELETE SET NULL : supprimer la séance n'emporte pas le retour,
--     la référence devient simplement NULL (l'historique survit au builder).
delete from workout_sessions where id = '00000000-0000-4000-8000-000000000004';
select case when (select session_id is null and prescribed_snapshot is not null
                    from workout_feedback
                   where id = '00000000-0000-4000-8000-000000000005')
       then 'OK — B5 séance supprimée : session_id → NULL, snapshot conservé'
       else 'ECHEC B5 : comportement ON DELETE inattendu' end as b5;

-- B6. RLS croisée : un élève ne voit JAMAIS le retour d'un autre.
insert into auth.users (id, instance_id, aud, role, email)
 values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'checklist-phase1-auth-a@example.test'),
        ('00000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'checklist-phase1-auth-b@example.test');
insert into students (id, user_id, first_name, last_name, status, email)
 values ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000a', 'A', 'Test', 'active',
         'checklist-phase1-a@example.test'),
        ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-00000000000b', 'B', 'Test', 'active',
         'checklist-phase1-b@example.test');
insert into workout_feedback (id, student_id, completed, prescribed_snapshot)
 values ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000011', true, '{"version":1}'::jsonb),
        ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000012', true, '{"version":1}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select case when count(*) filter (where student_id = '00000000-0000-4000-8000-000000000011') = 1
        and count(*) filter (where student_id = '00000000-0000-4000-8000-000000000012') = 0
       then 'OK — B6 RLS : l''élève A voit son retour, jamais celui de B (snapshot compris)'
       else 'ECHEC B6 : fuite RLS entre élèves' end as b6
  from workout_feedback
 where id in ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000014');

reset role;

-- La base ressort STRICTEMENT identique.
rollback;

\echo '── Checklist terminée : tout libellé doit être « OK — … » ────────'
