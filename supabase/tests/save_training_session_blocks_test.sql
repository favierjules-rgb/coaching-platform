-- ============================================================================
-- pgTAP — tests transactionnels de save_training_session_blocks (Lot 3A).
-- ============================================================================
-- À exécuter uniquement :
--   1. sur une stack Supabase locale ;
--   2. ou sur un projet Supabase de test isolé et sans données réelles.
--
-- NE JAMAIS EXÉCUTER SUR LA PRODUCTION.
-- Toutes les données de test sont créées dans une transaction annulée par
-- ROLLBACK.
--
-- Pré-requis (à appliquer AVANT, sur le même environnement de test) :
--   1. supabase/tests/reconstruct_training_v3_for_test_project.sql (bootstrap)
--   2. supabase/migrations/20260721224252_save_training_session_blocks_rpc.sql
--
-- L'auth coach
-- est simulée via un profil seedé + request.jwt.claims. Les scénarios à double
-- sauvegarde passent par des blocs DO qui capturent des faits dans _facts, puis
-- des assertions pgTAP lisent ces faits.
--
-- NOTE « now() figé » : dans une transaction unique, now() est constant, donc
-- l'updated_at posé par la RPC égale celui des lignes créées dans la même
-- transaction. Le cycle optimistic-lock (SF) seed donc sa séance avec un
-- updated_at PASSÉ explicite (posé à l'INSERT, non affecté par le trigger
-- BEFORE UPDATE) pour observer un vrai changement de version.
-- ============================================================================

begin;
select plan(56);

create temp table _facts(k text primary key, v text);
do $$ declare s text; begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._facts to authenticated, anon', s);
end $$;

-- ===== SEEDS =====
insert into auth.users (id,email) values ('00000000-0000-4000-8000-0000000000c0','coach@test.local') on conflict do nothing;
insert into public.profiles (user_id,role) values ('00000000-0000-4000-8000-0000000000c0','coach') on conflict (user_id) do update set role='coach';
insert into public.students (id,first_name,last_name) values ('00000000-0000-4000-8000-0000000000d0','T','E') on conflict do nothing;
insert into public.programs (id,name) values ('00000000-0000-4000-8000-000000000090','Test');
insert into public.program_weeks (id,program_id,week_number) values ('00000000-0000-4000-8000-00000000008e','00000000-0000-4000-8000-000000000090',1);
insert into public.workout_sessions (id,program_id,program_week_id,day,session_type) values
 ('00000000-0000-4000-8000-00000000005e','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-00000000008e','lundi','strength'),
 ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-00000000008e','a1','strength'),
 ('00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-00000000008e','a2','strength'),
 ('00000000-0000-4000-8000-0000000000a3','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-00000000008e','a3','strength'),
 ('00000000-0000-4000-8000-0000000000a4','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-00000000008e','a4','strength'),
 ('00000000-0000-4000-8000-0000000000a5','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-00000000008e','a5','strength'),
 ('00000000-0000-4000-8000-0000000000a6','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-00000000008e','a6','strength'),
 ('00000000-0000-4000-8000-0000000000aa','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-00000000008e','aa','strength'),
 ('00000000-0000-4000-8000-0000000000ab','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-00000000008e','ab','strength'),
 ('00000000-0000-4000-8000-0000000000ac','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-00000000008e','ac','strength'),
 ('00000000-0000-4000-8000-0000000000ad','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-00000000008e','ad','strength'),
 ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-00000000008e','b1','mixed');
insert into public.workout_sessions (id,program_id,program_week_id,day,session_type,updated_at) values
 ('00000000-0000-4000-8000-0000000000a9','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-00000000008e','a9','strength','2020-01-01T00:00:00+00');
insert into public.workout_exercises (id,session_id,order_index,name,sets,reps) values
 ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-00000000005e',0,'Développé',4,'8'),
 ('00000000-0000-4000-8000-0000000000e2','00000000-0000-4000-8000-00000000005e',1,'Rowing',4,'10');
insert into public.workout_feedback (id,student_id,session_id) values ('00000000-0000-4000-8000-0000000000f0','00000000-0000-4000-8000-0000000000d0','00000000-0000-4000-8000-00000000005e');
insert into public.exercise_feedback (id,workout_feedback_id,student_id,exercise_id,exercise_name) values ('00000000-0000-4000-8000-0000000000fe','00000000-0000-4000-8000-0000000000f0','00000000-0000-4000-8000-0000000000d0','00000000-0000-4000-8000-0000000000e1','Développé');
-- SE : bloc + exercice réels dans la séance a6
insert into public.training_blocks (id,session_id,block_type,color_key,position) values ('00000000-0000-4000-8000-0000000000a8','00000000-0000-4000-8000-0000000000a6','strength','gray',0);
insert into public.workout_exercises (id,session_id,block_id,order_index,name,sets,reps) values ('00000000-0000-4000-8000-0000000000a7','00000000-0000-4000-8000-0000000000a6','00000000-0000-4000-8000-0000000000a8',0,'Etranger',4,'8');
-- RB : bloc strength + exercice + bloc cardio + prescription réels
insert into public.training_blocks (id,session_id,block_type,title,color_key,position) values ('00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b1','strength','Muscu','gray',0);
insert into public.workout_exercises (id,session_id,block_id,order_index,name,sets,reps) values ('00000000-0000-4000-8000-0000000000b3','00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2',0,'Dev',4,'8');
insert into public.training_blocks (id,session_id,block_type,color_key,position,cardio_type) values ('00000000-0000-4000-8000-0000000000b4','00000000-0000-4000-8000-0000000000b1','cardio','blue',1,'easy_run');
insert into public.training_prescriptions (id,block_id,set_number,set_type,position,segment_type) values ('00000000-0000-4000-8000-0000000000b5','00000000-0000-4000-8000-0000000000b4',0,'normal',0,'single');

-- ===== T1..T10 : coach authentifié =====
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000c0')::text, true);

-- T1. Optimistic lock périmé → STALE, aucune mutation
select throws_ok($$ select public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-00000000005e','expected_updated_at','1999-01-01T00:00:00Z','blocks','[]'::jsonb)) $$,'STALE_TRAINING_SESSION','T1 optimistic lock périmé rejeté');
select is((select count(*)::int from public.training_blocks where session_id='00000000-0000-4000-8000-00000000005e'),0,'T1 aucune mutation après STALE');
-- T2. Migration legacy : bloc strength créé, ids d'exercices conservés
select lives_ok($$ select public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-00000000005e','expected_updated_at',(select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-00000000005e'),'blocks',jsonb_build_array(jsonb_build_object('id','legacy-strength:00000000-0000-4000-8000-00000000005e','category','strength','title',null,'color_key','gray','exercises',jsonb_build_array(jsonb_build_object('id','00000000-0000-4000-8000-0000000000e1','name','Développé','sets',4,'reps','8'),jsonb_build_object('id','00000000-0000-4000-8000-0000000000e2','name','Rowing','sets',4,'reps','10')))))) $$,'T2 migration legacy réussie');
select is((select count(*)::int from public.training_blocks where session_id='00000000-0000-4000-8000-00000000005e' and block_type='strength'),1,'T2 un vrai bloc strength créé');
select is((select count(*)::int from public.workout_exercises where id in ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e2') and block_id is not null),2,'T2 exercices repointés (ids conservés)');
-- T3. Stabilité d'un id d'exercice
select ok(exists(select 1 from public.workout_exercises where id='00000000-0000-4000-8000-0000000000e1'),'T3 id exercice conservé');
-- T4. Bloc d'une autre séance → FOREIGN_BLOCK_ID
select throws_ok($$ select public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-00000000005e','expected_updated_at',(select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-00000000005e'),'blocks',jsonb_build_array(jsonb_build_object('id','11111111-1111-4111-8111-111111111111','category','strength','title',null,'color_key','gray','exercises','[]'::jsonb)))) $$,'FOREIGN_BLOCK_ID','T4 bloc étranger rejeté');
-- T5. Format d'id invalide → rejet (message suffixé par l'id → throws_like)
select throws_like($$ select public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-00000000005e','expected_updated_at',(select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-00000000005e'),'blocks',jsonb_build_array(jsonb_build_object('id','blk-1721680000000-5','category','strength','title',null,'color_key','gray','exercises','[]'::jsonb)))) $$,'UNRECOGNIZED_BLOCK_ID%','T5 ancien format id rejeté');
-- T6. Feedback détaché (SET NULL) + compteur
select is((public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-00000000005e','expected_updated_at',(select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-00000000005e'),'blocks',jsonb_build_array(jsonb_build_object('id','legacy-strength:00000000-0000-4000-8000-00000000005e','category','strength','title',null,'color_key','gray','exercises',jsonb_build_array(jsonb_build_object('id','00000000-0000-4000-8000-0000000000e2','name','Rowing','sets',4,'reps','10'))))))->'warnings'->>'detached_exercise_feedback_count')::int,1,'T6 feedback détaché compté');
select is((select exercise_id from public.exercise_feedback where id='00000000-0000-4000-8000-0000000000fe'),null::uuid,'T6 exercise_id = NULL');
select is((select count(*)::int from public.exercise_feedback where id='00000000-0000-4000-8000-0000000000fe'),1,'T6 ligne feedback survit');
-- T7. Cas repos
select is((public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-00000000005e','expected_updated_at',(select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-00000000005e'),'blocks','[]'::jsonb))->>'session_type'),'rest','T7 session_type dérivé rest');
select is((select is_rest_day from public.workout_sessions where id='00000000-0000-4000-8000-00000000005e'),true,'T7 is_rest_day true');
select is((select session_type from public.workout_sessions where id='00000000-0000-4000-8000-00000000005e'),'strength','T7 colonne session_type placeholder');
-- T8. Positions 0-based dans l'ordre du tableau
select lives_ok($$ select public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-00000000005e','expected_updated_at',(select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-00000000005e'),'blocks',jsonb_build_array(jsonb_build_object('id','new-block:22222222-2222-4222-8222-222222222222','category','cardio','title',null,'color_key','blue','cardio_type','easy_run','prescriptions','[]'::jsonb),jsonb_build_object('id','new-block:33333333-3333-4333-8333-333333333333','category','strength','title',null,'color_key','gray','exercises','[]'::jsonb)))) $$,'T8 multi-blocs ordonnée');
select results_eq($$ select block_type, position from public.training_blocks where session_id='00000000-0000-4000-8000-00000000005e' order by position $$,$$ values ('cardio'::text,0),('strength'::text,1) $$,'T8 positions 0,1');
-- T9. RLS : anon → EXECUTE refusé (forme 4-args : errcode + message libre)
reset role;
set local role anon;
select throws_ok($$ select public.save_training_session_blocks('{}'::jsonb) $$,'42501',NULL,'T9 anon refusé (revoke)');
-- T10. RLS : authenticated non coach → NOT_AUTHORIZED
reset role;
insert into auth.users (id,email) values ('00000000-0000-4000-8000-0000000000a0','eleve@test.local') on conflict do nothing;
insert into public.profiles (user_id,role) values ('00000000-0000-4000-8000-0000000000a0','student') on conflict (user_id) do update set role='student';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000a0')::text, true);
select throws_ok($$ select public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-00000000005e','expected_updated_at','2020-01-01T00:00:00Z','blocks','[]'::jsonb)) $$,'NOT_AUTHORIZED','T10 non-coach refusé');

-- retour coach pour les scénarios étendus
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000c0')::text, true);

-- ===== SA : stabilité IDs de blocs + réordonnancement Cardio/Strength/Cardio =====
do $$ declare j jsonb; u timestamptz; run uuid; dev uuid; ski uuid; begin
  u := (select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-0000000000a1');
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000a1','expected_updated_at',u,'blocks',jsonb_build_array(
    jsonb_build_object('id','new-block:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','category','cardio','color_key','blue','cardio_type','easy_run','prescriptions','[]'::jsonb),
    jsonb_build_object('id','new-block:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02','category','strength','color_key','gray','exercises','[]'::jsonb),
    jsonb_build_object('id','new-block:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03','category','cardio','color_key','green','cardio_type','cardio_machine','machine_type','skierg','prescriptions','[]'::jsonb))));
  run := (j->'id_mapping'->'blocks'->>'new-block:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01')::uuid;
  dev := (j->'id_mapping'->'blocks'->>'new-block:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02')::uuid;
  ski := (j->'id_mapping'->'blocks'->>'new-block:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03')::uuid;
  u := (j->>'updated_at')::timestamptz;
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000a1','expected_updated_at',u,'blocks',jsonb_build_array(
    jsonb_build_object('id',ski::text,'category','cardio','color_key','green','cardio_type','cardio_machine','machine_type','skierg','prescriptions','[]'::jsonb),
    jsonb_build_object('id',run::text,'category','cardio','color_key','red','cardio_type','easy_run','prescriptions','[]'::jsonb),
    jsonb_build_object('id',dev::text,'category','strength','color_key','gray','exercises','[]'::jsonb))));
  insert into _facts values ('sa_ids_stable', case when (select count(*) from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000a1' and id in (run,dev,ski))=3 and (select count(*) from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000a1')=3 then 'true' else 'false' end);
  insert into _facts values ('sa_count',(select count(*)::text from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000a1'));
  insert into _facts values ('sa_stype', j->>'session_type');
  insert into _facts values ('sa_order',(select string_agg(m,',' order by position) from (select position, case when id=ski then 'ski' when id=run then 'run' when id=dev then 'dev' else '?' end m from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000a1') t));
end $$;
select is((select v from _facts where k='sa_ids_stable'),'true','SA 3 IDs blocs identiques avant/après');
select is((select v from _facts where k='sa_count'),'3','SA aucun bloc recréé (count=3)');
select is((select v from _facts where k='sa_order'),'ski,run,dev','SA réordonné [SkiErg,Running,Dev] positions 0,1,2');
select is((select v from _facts where k='sa_stype'),'mixed','SA session_type mixed');

-- ===== SB : stabilité ID exercice + déplacement inter-blocs + aucun détachement =====
do $$ declare j jsonb; u timestamptz; bs1 uuid; bs2 uuid; exid uuid; begin
  u := (select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-0000000000a2');
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000a2','expected_updated_at',u,'blocks',jsonb_build_array(
    jsonb_build_object('id','new-block:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01','category','strength','color_key','gray','exercises',jsonb_build_array(jsonb_build_object('id','new-exercise:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe1','name','Squat','sets',5,'reps','5'))),
    jsonb_build_object('id','new-block:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02','category','strength','color_key','gray','exercises','[]'::jsonb))));
  bs1 := (j->'id_mapping'->'blocks'->>'new-block:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01')::uuid;
  bs2 := (j->'id_mapping'->'blocks'->>'new-block:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02')::uuid;
  exid := (j->'id_mapping'->'exercises'->>'new-exercise:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe1')::uuid;
  insert into public.workout_feedback (id,student_id,session_id) values ('00000000-0000-4000-8000-0000000000bf','00000000-0000-4000-8000-0000000000d0','00000000-0000-4000-8000-0000000000a2');
  insert into public.exercise_feedback (id,workout_feedback_id,student_id,exercise_id,exercise_name) values ('00000000-0000-4000-8000-0000000000be','00000000-0000-4000-8000-0000000000bf','00000000-0000-4000-8000-0000000000d0',exid,'Squat');
  u := (j->>'updated_at')::timestamptz;
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000a2','expected_updated_at',u,'blocks',jsonb_build_array(
    jsonb_build_object('id',bs1::text,'category','strength','color_key','gray','exercises','[]'::jsonb),
    jsonb_build_object('id',bs2::text,'category','strength','color_key','gray','exercises',jsonb_build_array(jsonb_build_object('id',exid::text,'name','Squat','sets',5,'reps','5'))))));
  insert into _facts values ('sb_id_stable', case when exists(select 1 from public.workout_exercises where id=exid) then 'true' else 'false' end);
  insert into _facts values ('sb_block', case when (select block_id from public.workout_exercises where id=exid)=bs2 then 'true' else 'false' end);
  insert into _facts values ('sb_order',(select order_index::text from public.workout_exercises where id=exid));
  insert into _facts values ('sb_detached', j->'warnings'->>'detached_exercise_feedback_count');
end $$;
select is((select v from _facts where k='sb_id_stable'),'true','SB même workout_exercises.id après déplacement');
select is((select v from _facts where k='sb_block'),'true','SB nouveau block_id = 2e bloc');
select is((select v from _facts where k='sb_order'),'0','SB order_index recalculé');
select is((select v from _facts where k='sb_detached'),'0','SB detached_exercise_feedback_count=0');

-- ===== SC : politique prescriptions cardio (bloc conservé, prescriptions recréées) =====
do $$ declare j jsonb; u timestamptz; c uuid; old_ids uuid[]; new_ids uuid[]; begin
  u := (select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-0000000000a3');
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000a3','expected_updated_at',u,'blocks',jsonb_build_array(
    jsonb_build_object('id','new-block:cccccccc-cccc-4ccc-8ccc-cccccccccc01','category','cardio','color_key','blue','cardio_type','vma_intervals','prescriptions',jsonb_build_array(jsonb_build_object('segment_type','work','title','I1'),jsonb_build_object('segment_type','recovery','title','R1'))))));
  c := (j->'id_mapping'->'blocks'->>'new-block:cccccccc-cccc-4ccc-8ccc-cccccccccc01')::uuid;
  old_ids := (select array_agg(id) from public.training_prescriptions where block_id=c);
  u := (j->>'updated_at')::timestamptz;
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000a3','expected_updated_at',u,'blocks',jsonb_build_array(
    jsonb_build_object('id',c::text,'category','cardio','color_key','blue','cardio_type','vma_intervals','prescriptions',jsonb_build_array(jsonb_build_object('segment_type','work','title','I2'),jsonb_build_object('segment_type','recovery','title','R2'))))));
  new_ids := (select array_agg(id) from public.training_prescriptions where block_id=c);
  insert into _facts values ('sc_block_stable', case when exists(select 1 from public.training_blocks where id=c) then 'true' else 'false' end);
  insert into _facts values ('sc_old_gone', case when not exists(select 1 from unnest(old_ids) x where x = any(new_ids)) then 'true' else 'false' end);
  insert into _facts values ('sc_all_belong', case when (select count(*) from public.training_prescriptions tp join public.training_blocks tb on tb.id=tp.block_id where tb.session_id='00000000-0000-4000-8000-0000000000a3' and tp.block_id<>c)=0 then 'true' else 'false' end);
  insert into _facts values ('sc_order',(select string_agg(position::text,',' order by position) from public.training_prescriptions where block_id=c));
end $$;
select is((select v from _facts where k='sc_block_stable'),'true','SC ID bloc cardio conservé');
select is((select v from _facts where k='sc_old_gone'),'true','SC anciennes prescriptions supprimées (IDs recréés)');
select is((select v from _facts where k='sc_all_belong'),'true','SC prescriptions rattachées au bloc parent');
select is((select v from _facts where k='sc_order'),'0,1','SC ordre prescriptions 0,1');

-- ===== SD : mapping des IDs temporaires =====
do $$ declare j jsonb; u timestamptz; begin
  u := (select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-0000000000a4');
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000a4','expected_updated_at',u,'blocks',jsonb_build_array(
    jsonb_build_object('id','legacy-strength:00000000-0000-4000-8000-0000000000a4','category','strength','color_key','gray','exercises',jsonb_build_array(jsonb_build_object('id','new-exercise:dddddddd-dddd-4ddd-8ddd-ddddddddde01','name','Dev','sets',4,'reps','8'))),
    jsonb_build_object('id','new-block:dddddddd-dddd-4ddd-8ddd-dddddddddd01','category','cardio','color_key','blue','cardio_type','easy_run','prescriptions','[]'::jsonb))));
  insert into _facts values ('sd_map_ok', case when char_length(j->'id_mapping'->'blocks'->>'legacy-strength:00000000-0000-4000-8000-0000000000a4')=36 and char_length(j->'id_mapping'->'blocks'->>'new-block:dddddddd-dddd-4ddd-8ddd-dddddddddd01')=36 and char_length(j->'id_mapping'->'exercises'->>'new-exercise:dddddddd-dddd-4ddd-8ddd-ddddddddde01')=36 then 'true' else 'false' end);
  insert into _facts values ('sd_no_temp', case when not exists(select 1 from jsonb_array_elements(j->'blocks') b where (b->>'id') like 'new-%' or (b->>'id') like 'legacy-%') then 'true' else 'false' end);
  insert into _facts values ('sd_count',(select count(*)::text from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000a4'));
end $$;
select is((select v from _facts where k='sd_map_ok'),'true','SD chaque id temporaire → vrai UUID dans id_mapping');
select is((select v from _facts where k='sd_no_temp'),'true','SD aucun id temporaire dans blocks retourné');
select throws_like($$ select public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000a4','expected_updated_at',(select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-0000000000a4'),'blocks',jsonb_build_array(jsonb_build_object('id','new-block:dddddddd-dddd-4ddd-8ddd-dddddddddd09','category','strength','color_key','gray','exercises','[]'::jsonb),jsonb_build_object('id','new-block:dddddddd-dddd-4ddd-8ddd-dddddddddd09','category','strength','color_key','gray','exercises','[]'::jsonb)))) $$,'DUPLICATE_TEMP_BLOCK_ID%','SD deux ids temporaires identiques rejetés');
select is((select count(*)::text from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000a4'),(select v from _facts where k='sd_count'),'SD aucune mutation après rejet du doublon');

-- ===== SE : exercice étranger → FOREIGN_EXERCISE_ID =====
select throws_ok($$ select public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000a5','expected_updated_at',(select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-0000000000a5'),'blocks',jsonb_build_array(jsonb_build_object('id','new-block:eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01','category','strength','color_key','gray','exercises',jsonb_build_array(jsonb_build_object('id','00000000-0000-4000-8000-0000000000a7','name','Etranger','sets',4,'reps','8')))))) $$,'FOREIGN_EXERCISE_ID','SE exercice d''une autre séance rejeté');
select is((select session_id::text||'|'||block_id::text from public.workout_exercises where id='00000000-0000-4000-8000-0000000000a7'),'00000000-0000-4000-8000-0000000000a6|00000000-0000-4000-8000-0000000000a8','SE exercice étranger inchangé (séance + block_id)');

-- ===== SF : cycle optimistic lock complet (séance seedée avec updated_at passé) =====
do $$ declare j jsonb; u0 timestamptz; u1 timestamptz; begin
  u0 := (select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-0000000000a9');
  insert into _facts values ('sf_u0', u0::text);
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000a9','expected_updated_at',u0,'blocks',jsonb_build_array(jsonb_build_object('id','new-block:ffffffff-ffff-4fff-8fff-ffffffffff01','category','strength','color_key','gray','exercises','[]'::jsonb))));
  u1 := (j->>'updated_at')::timestamptz;
  insert into _facts values ('sf_u1_diff', case when u1 is distinct from u0 then 'true' else 'false' end);
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000a9','expected_updated_at',u1,'blocks',jsonb_build_array(jsonb_build_object('id',(j->'blocks'->0->>'id'),'category','strength','color_key','red','exercises','[]'::jsonb))));
  insert into _facts values ('sf_second_ok','true');
  insert into _facts values ('sf_count',(select count(*)::text from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000a9'));
end $$;
select is((select v from _facts where k='sf_u1_diff'),'true','SF updated_at retourné diffère de l''ancien');
select is((select v from _facts where k='sf_second_ok'),'true','SF 2e sauvegarde avec le nouveau updated_at réussit');
select throws_ok($$ select public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000a9','expected_updated_at',(select v from _facts where k='sf_u0')::timestamptz,'blocks','[]'::jsonb)) $$,'STALE_TRAINING_SESSION','SF ancienne valeur updated_at rejetée (STALE)');
select is((select count(*)::text from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000a9'),(select v from _facts where k='sf_count'),'SF aucune mutation lors du rejet STALE');

-- ===== SG : multiplicité des blocs =====
do $$ declare j jsonb; begin
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000aa','expected_updated_at',(select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-0000000000aa'),'blocks',jsonb_build_array(jsonb_build_object('id','new-block:11111111-1111-4111-8111-111111110001','category','strength','color_key','gray','exercises','[]'::jsonb),jsonb_build_object('id','new-block:11111111-1111-4111-8111-111111110002','category','strength','color_key','red','exercises','[]'::jsonb))));
  insert into _facts values ('sg1_count',(select count(*)::text from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000aa' and block_type='strength'));
  insert into _facts values ('sg1_type', j->>'session_type');
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000ab','expected_updated_at',(select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-0000000000ab'),'blocks',jsonb_build_array(jsonb_build_object('id','new-block:22222222-2222-4222-8222-222222220001','category','cardio','color_key','blue','cardio_type','easy_run','prescriptions','[]'::jsonb),jsonb_build_object('id','new-block:22222222-2222-4222-8222-222222220002','category','cardio','color_key','green','cardio_type','long_run','prescriptions','[]'::jsonb))));
  insert into _facts values ('sg2_count',(select count(*)::text from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000ab' and block_type='cardio'));
  insert into _facts values ('sg2_type', j->>'session_type');
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000ac','expected_updated_at',(select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-0000000000ac'),'blocks',jsonb_build_array(jsonb_build_object('id','new-block:33333333-3333-4333-8333-333333330001','category','strength','color_key','gray','exercises','[]'::jsonb),jsonb_build_object('id','new-block:33333333-3333-4333-8333-333333330002','category','cardio','color_key','blue','cardio_type','easy_run','prescriptions','[]'::jsonb),jsonb_build_object('id','new-block:33333333-3333-4333-8333-333333330003','category','strength','color_key','red','exercises','[]'::jsonb))));
  insert into _facts values ('sg3_order',(select string_agg(substr(block_type,1,1),',' order by position) from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000ac'));
  insert into _facts values ('sg3_type', j->>'session_type');
end $$;
select is((select v from _facts where k='sg1_count'),'2','SG plusieurs blocs strength dans une séance');
select is((select v from _facts where k='sg1_type'),'strength','SG type dérivé strength (multi strength)');
select is((select v from _facts where k='sg2_count'),'2','SG plusieurs blocs cardio dans une séance');
select is((select v from _facts where k='sg2_type'),'cardio','SG type dérivé cardio (multi cardio)');
select is((select v from _facts where k='sg3_order'),'s,c,s','SG Strength/Cardio/Strength conservé (aucun regroupement)');
select is((select v from _facts where k='sg3_type'),'mixed','SG type dérivé mixed (S/C/S)');

-- ===== SH : sauvegarde identique deux fois (idempotence strength) =====
do $$ declare j jsonb; u timestamptz; b uuid; e1 uuid; e2 uuid; begin
  u := (select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-0000000000ad');
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000ad','expected_updated_at',u,'blocks',jsonb_build_array(jsonb_build_object('id','new-block:44444444-4444-4444-8444-444444440001','category','strength','color_key','gray','exercises',jsonb_build_array(jsonb_build_object('id','new-exercise:44444444-4444-4444-8444-4444444444e1','name','A','sets',3,'reps','10'),jsonb_build_object('id','new-exercise:44444444-4444-4444-8444-4444444444e2','name','B','sets',3,'reps','10'))))));
  b := (j->'id_mapping'->'blocks'->>'new-block:44444444-4444-4444-8444-444444440001')::uuid;
  e1 := (j->'id_mapping'->'exercises'->>'new-exercise:44444444-4444-4444-8444-4444444444e1')::uuid;
  e2 := (j->'id_mapping'->'exercises'->>'new-exercise:44444444-4444-4444-8444-4444444444e2')::uuid;
  u := (j->>'updated_at')::timestamptz;
  j := public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000ad','expected_updated_at',u,'blocks',jsonb_build_array(jsonb_build_object('id',b::text,'category','strength','color_key','gray','exercises',jsonb_build_array(jsonb_build_object('id',e1::text,'name','A','sets',3,'reps','10'),jsonb_build_object('id',e2::text,'name','B','sets',3,'reps','10'))))));
  insert into _facts values ('sh_block_same', case when (select count(*) from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000ad')=1 and exists(select 1 from public.training_blocks where id=b) then 'true' else 'false' end);
  insert into _facts values ('sh_ex_same', case when (select count(*) from public.workout_exercises where session_id='00000000-0000-4000-8000-0000000000ad')=2 and exists(select 1 from public.workout_exercises where id=e1) and exists(select 1 from public.workout_exercises where id=e2) then 'true' else 'false' end);
  insert into _facts values ('sh_counts',(select count(*)::text from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000ad')||'/'||(select count(*)::text from public.workout_exercises where session_id='00000000-0000-4000-8000-0000000000ad'));
end $$;
select is((select v from _facts where k='sh_block_same'),'true','SH IDs de blocs identiques (aucun bloc inutile)');
select is((select v from _facts where k='sh_ex_same'),'true','SH IDs d''exercices identiques (aucun exercice inutile)');
select is((select v from _facts where k='sh_counts'),'1/2','SH contenu final identique (1 bloc / 2 exercices)');

-- ===== RB : rollback complet après mutations (trigger d'erreur TARDIVE) =====
-- Capture du pré-état, puis trigger BEFORE UPDATE sur workout_sessions qui lève
-- une exception : il ne se déclenche qu'à l'UPDATE final de la RPC (étape 8),
-- APRÈS insertions/mises à jour des blocs et exercices. throws_ok annule tout
-- via son savepoint → preuve du rollback transactionnel. Trigger + fonction
-- restent dans le BEGIN/ROLLBACK ; ne JAMAIS les ajouter à la migration RPC.
insert into _facts values ('rb_blocks',(select count(*)::text from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000b1'));
insert into _facts values ('rb_exblock',(select block_id::text from public.workout_exercises where id='00000000-0000-4000-8000-0000000000b3'));
insert into _facts values ('rb_presc',(select count(*)::text from public.training_prescriptions where block_id='00000000-0000-4000-8000-0000000000b4'));
insert into _facts values ('rb_stype',(select session_type from public.workout_sessions where id='00000000-0000-4000-8000-0000000000b1'));
insert into _facts values ('rb_rest',(select is_rest_day::text from public.workout_sessions where id='00000000-0000-4000-8000-0000000000b1'));
insert into _facts values ('rb_upd',(select updated_at::text from public.workout_sessions where id='00000000-0000-4000-8000-0000000000b1'));
reset role;
create function pg_temp.rb_fail() returns trigger language plpgsql as $f$ begin raise exception 'LATE_FAILURE_INJECTED'; end $f$;
create trigger rb_fail_trg before update on public.workout_sessions for each row execute function pg_temp.rb_fail();
set local role authenticated;
select throws_ok($$ select public.save_training_session_blocks(jsonb_build_object('session_id','00000000-0000-4000-8000-0000000000b1','expected_updated_at',(select updated_at from public.workout_sessions where id='00000000-0000-4000-8000-0000000000b1'),'blocks',jsonb_build_array(jsonb_build_object('id','00000000-0000-4000-8000-0000000000b2','category','strength','title','MODIF','color_key','red','exercises',jsonb_build_array(jsonb_build_object('id','00000000-0000-4000-8000-0000000000b3','name','Dev','sets',5,'reps','5'))),jsonb_build_object('id','new-block:99999999-9999-4999-8999-999999999999','category','strength','color_key','gray','exercises',jsonb_build_array(jsonb_build_object('id','new-exercise:88888888-8888-4888-8888-888888888888','name','New','sets',3,'reps','8')))))) $$,'LATE_FAILURE_INJECTED','RB erreur tardive injectée après mutations');
reset role;
drop trigger rb_fail_trg on public.workout_sessions;
select is((select count(*)::text from public.training_blocks where session_id='00000000-0000-4000-8000-0000000000b1'),(select v from _facts where k='rb_blocks'),'RB aucun nouveau bloc ne subsiste');
select is((select block_id::text from public.workout_exercises where id='00000000-0000-4000-8000-0000000000b3'),(select v from _facts where k='rb_exblock'),'RB block_id de l''exercice inchangé');
select is((select count(*)::text from public.training_prescriptions where block_id='00000000-0000-4000-8000-0000000000b4'),(select v from _facts where k='rb_presc'),'RB prescriptions inchangées');
select is((select session_type from public.workout_sessions where id='00000000-0000-4000-8000-0000000000b1'),(select v from _facts where k='rb_stype'),'RB session_type inchangé');
select is((select is_rest_day::text from public.workout_sessions where id='00000000-0000-4000-8000-0000000000b1'),(select v from _facts where k='rb_rest'),'RB is_rest_day inchangé');
select is((select updated_at::text from public.workout_sessions where id='00000000-0000-4000-8000-0000000000b1'),(select v from _facts where k='rb_upd'),'RB updated_at inchangé');

select * from finish();
rollback;
