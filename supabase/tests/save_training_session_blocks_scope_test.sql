-- ════════════════════════════════════════════════════════════════════════════
-- TEST SQL — LA PORTÉE DE SAUVEGARDE (`scope`) DE save_training_session_blocks
-- ════════════════════════════════════════════════════════════════════════════
--
-- CE QU'IL PROUVE, SUR UN VRAI POSTGRESQL, ET PAS DEPUIS LE CLIENT :
--   · CAS A — 2 blocs muscu + 1 cardio, on modifie LE CARDIO SEUL : les deux
--     blocs de musculation et leurs exercices sont intacts, à la ligne près
--     (id, nom, charge, position, updated_at) ;
--   · CAS B — 1 bloc muscu + 2 cardio, on modifie LA MUSCULATION SEULE : les
--     deux blocs cardio et leurs prescriptions sont intacts ;
--   · CAS C — on SUPPRIME le bloc cardio : la musculation reste ;
--   · CAS D — on SUPPRIME un bloc de musculation : le cardio reste ;
--   · CAS E — création d'une séance MIXTE complète : tout est enregistré ;
--   · les refus de portée (bloc hors portée, UUID d'une autre catégorie,
--     position manquante, portée inconnue) ;
--   · `session_type` reste « mixed » après une modification cardio.
--
-- ⚠️ LE SCHÉMA D'EXÉCUTION DOIT PORTER LE VRAI `ON DELETE CASCADE`.
-- `workout_exercises.block_id` et `training_prescriptions.block_id` référencent
-- `training_blocks(id)` en CASCADE en production : supprimer un bloc emporte son
-- contenu. Un schéma de test qui mettrait `on delete set null` rendrait ce
-- fichier PLUS INDULGENT que la réalité — il l'a été pendant une première passe,
-- et c'est la vérification de la contrainte réelle qui l'a montré.
--
-- ⚠️ CE FICHIER NE S'EXÉCUTE PAS CONTRE LA PRODUCTION. Il suppose un schéma
-- reconstitué (voir supabase/tests/reconstruct_training_v3_for_test_project.sql)
-- ou une base jetable. Il ne modifie que les lignes qu'il crée lui-même, sous
-- des identifiants fixes en 0000…, et il les supprime en sortant.
--
-- Chaque vérification est une ASSERTION : la première qui casse arrête le
-- fichier. Un test qui se contente d'AFFICHER des compteurs ne prouve rien —
-- personne ne relit les colonnes d'un `select` dans un journal de CI.
--
-- LANCEMENT (base jetable, jamais la production) :
--   psql -d <base_jetable> -v ON_ERROR_STOP=1 -f supabase/tests/save_training_session_blocks_scope_test.sql
-- La base doit porter le schéma d'entraînement (tables `workout_sessions`,
-- `training_blocks`, `workout_exercises`, `training_prescriptions`,
-- `exercise_feedback`), la fonction `public.is_coach_or_admin()`, puis les
-- migrations 20260930090000 et 20260930100000.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
begin;

-- ── Décor commun ────────────────────────────────────────────────────────────
create temporary table t_ref(cle text primary key, val text) on commit drop;

do $$
begin
  insert into public.workout_sessions (id, program_id, program_week_id, day, is_rest_day, name, muscle_group, duration_minutes, warmup, coach_notes, session_type)
  values ('0a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-0000000000f1','0a000000-0000-4000-8000-0000000000f2','Lundi',false,'Mixte A','',60,'','','mixed');

  -- 2 blocs musculation (positions 0 et 1) + 1 bloc cardio (position 2)
  insert into public.training_blocks (id, session_id, block_type, title, color_key, "position")
  values ('0a000000-0000-4000-8000-00000000000a','0a000000-0000-4000-8000-000000000001','strength','Muscu A','gray',0),
         ('0a000000-0000-4000-8000-00000000000b','0a000000-0000-4000-8000-000000000001','strength','Muscu B','gray',1),
         ('0a000000-0000-4000-8000-00000000000c','0a000000-0000-4000-8000-000000000001','cardio','VMA','red',2);
  update public.training_blocks set cardio_type = 'vma_intervals', sport = 'course', rounds = 3
  where id = '0a000000-0000-4000-8000-00000000000c';

  insert into public.workout_exercises (id, session_id, block_id, order_index, name, sets, reps, rest_seconds, tempo, recommended_load, video_url, notes)
  values ('0a000000-0000-4000-8000-0000000000e1','0a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-00000000000a',0,'Squat',5,'5',120,'','100kg','',''),
         ('0a000000-0000-4000-8000-0000000000e2','0a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-00000000000b',0,'Tirage',4,'8',90,'','60kg','','');

  insert into public.training_prescriptions (block_id, set_number, set_type, segment_type, title, "position", intensity_target_type, target_vma_percentage)
  values ('0a000000-0000-4000-8000-00000000000c',0,'normal','work','Effort',0,'vma_percentage',105);
end $$;

-- Empreinte AVANT de tout ce qui est musculation.
create temporary table t_muscu_avant on commit drop as
  select b.id, b.title, b.block_type, b."position", b.updated_at, b.color_key, b.rounds
  from public.training_blocks b where b.session_id = '0a000000-0000-4000-8000-000000000001' and b.block_type <> 'cardio';
create temporary table t_exos_avant on commit drop as
  select e.id, e.name, e.sets, e.reps, e.recommended_load, e.order_index, e.block_id, e.updated_at
  from public.workout_exercises e where e.session_id = '0a000000-0000-4000-8000-000000000001';

-- ════════════════════════════════════════════════════════════════════════════
-- CAS A — modifier UNIQUEMENT le cardio
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_avant timestamptz; v_res jsonb; v_n int;
begin
  select updated_at into v_avant from public.workout_sessions where id = '0a000000-0000-4000-8000-000000000001';
  v_res := public.save_training_session_blocks(jsonb_build_object(
    'session_id','0a000000-0000-4000-8000-000000000001',
    'expected_updated_at', v_avant,
    'scope','cardio',
    'blocks', jsonb_build_array(jsonb_build_object(
      'id','0a000000-0000-4000-8000-00000000000c','category','cardio','position',2,
      'title','VMA modifiée','color_key','red','cardio_type','vma_intervals','sport','course','rounds',5,
      'prescriptions', jsonb_build_array(
        jsonb_build_object('segment_type','warmup','title','Échauffement','work_duration_seconds',600,'intensity_target_type','zone','target_zone',2),
        jsonb_build_object('segment_type','work','title','Effort','distance_meters',800,'intensity_target_type','zone','target_zone',4),
        jsonb_build_object('segment_type','recovery','title','Contre-effort','work_duration_seconds',120,'intensity_target_type','rpe','intensity_min',3),
        jsonb_build_object('segment_type','cooldown','title','Retour au calme','work_duration_seconds',300,'intensity_target_type','zone','target_zone',1))
    ))));

  -- 1. la musculation est intacte, à la ligne près
  select count(*) into v_n from (
    select id, title, block_type, "position", updated_at, color_key, rounds
    from public.training_blocks where session_id = '0a000000-0000-4000-8000-000000000001' and block_type <> 'cardio'
    except select * from t_muscu_avant) x;
  assert v_n = 0, 'CAS A : un bloc de musculation a été modifié par un enregistrement cardio';
  select count(*) into v_n from (
    select id, name, sets, reps, recommended_load, order_index, block_id, updated_at
    from public.workout_exercises where session_id = '0a000000-0000-4000-8000-000000000001'
    except select * from t_exos_avant) x;
  assert v_n = 0, 'CAS A : un exercice de musculation a été modifié par un enregistrement cardio';
  select count(*) into v_n from public.workout_exercises where session_id = '0a000000-0000-4000-8000-000000000001';
  assert v_n = 2, format('CAS A : %s exercices au lieu de 2 — la musculation a été supprimée', v_n);

  -- 2. le cardio est bien modifié
  select count(*) into v_n from public.training_prescriptions p
   join public.training_blocks b on b.id = p.block_id
   where b.session_id = '0a000000-0000-4000-8000-000000000001';
  assert v_n = 4, format('CAS A : %s segments au lieu de 4', v_n);
  assert (select title from public.training_blocks where id = '0a000000-0000-4000-8000-00000000000c') = 'VMA modifiée',
    'CAS A : le titre du bloc cardio n''a pas été enregistré';
  assert (select rounds from public.training_blocks where id = '0a000000-0000-4000-8000-00000000000c') = 5,
    'CAS A : les séries du bloc cardio n''ont pas été enregistrées';
  assert (select target_zone from public.training_prescriptions p join public.training_blocks b on b.id = p.block_id
          where b.session_id = '0a000000-0000-4000-8000-000000000001' and p.segment_type = 'work') = 4,
    'CAS A : la zone prescrite n''a pas été enregistrée';

  -- 3. la séance reste MIXTE
  assert (select session_type from public.workout_sessions where id = '0a000000-0000-4000-8000-000000000001') = 'mixed',
    'CAS A : la séance mixte a été réétiquetée alors que sa musculation est toujours là';
  assert (select is_rest_day from public.workout_sessions where id = '0a000000-0000-4000-8000-000000000001') = false,
    'CAS A : la séance est passée en jour de repos';

  -- 4. les positions n'ont pas bougé : muscu 0 et 1, cardio 2
  assert (select array_agg("position" order by "position") from public.training_blocks
          where session_id = '0a000000-0000-4000-8000-000000000001') = array[0,1,2],
    'CAS A : les positions des blocs ont été réécrites';
  raise notice 'CAS A OK — cardio modifié, musculation intacte, séance toujours mixte';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- CAS B — 1 muscu + 2 cardio, modifier UNIQUEMENT la musculation
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_avant timestamptz; v_n int;
begin
  insert into public.workout_sessions (id, program_id, program_week_id, day, is_rest_day, name, muscle_group, duration_minutes, warmup, coach_notes, session_type)
  values ('0b000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-0000000000f1','0a000000-0000-4000-8000-0000000000f2','Mardi',false,'Mixte B','',75,'','','mixed');
  insert into public.training_blocks (id, session_id, block_type, title, color_key, "position", cardio_type, sport, rounds)
  values ('0b000000-0000-4000-8000-00000000000a','0b000000-0000-4000-8000-000000000001','strength','Muscu','gray',0,null,null,null),
         ('0b000000-0000-4000-8000-00000000000b','0b000000-0000-4000-8000-000000000001','cardio','Cardio 1','blue',1,'easy_run','course',1),
         ('0b000000-0000-4000-8000-00000000000c','0b000000-0000-4000-8000-000000000001','cardio','Cardio 2','red',2,'vma_intervals','course',4);
  insert into public.workout_exercises (id, session_id, block_id, order_index, name, sets, reps, rest_seconds, tempo, recommended_load, video_url, notes)
  values ('0b000000-0000-4000-8000-0000000000e1','0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000a',0,'Développé',4,'6',120,'','80kg','','');
  insert into public.training_prescriptions (block_id, set_number, set_type, segment_type, title, "position", intensity_target_type, target_zone)
  values ('0b000000-0000-4000-8000-00000000000b',0,'normal','single','Footing',0,'zone',2),
         ('0b000000-0000-4000-8000-00000000000c',0,'normal','work','Effort',0,'zone',5);

  create temporary table t_cardio_avant on commit drop as
    select b.id, b.title, b.color_key, b."position", b.cardio_type, b.sport, b.rounds, b.updated_at
    from public.training_blocks b where b.session_id = '0b000000-0000-4000-8000-000000000001' and b.block_type = 'cardio';
  create temporary table t_presc_avant on commit drop as
    select p.id, p.block_id, p.segment_type, p.title, p.target_zone, p."position"
    from public.training_prescriptions p join public.training_blocks b on b.id = p.block_id
    where b.session_id = '0b000000-0000-4000-8000-000000000001';

  select updated_at into v_avant from public.workout_sessions where id = '0b000000-0000-4000-8000-000000000001';
  perform public.save_training_session_blocks(jsonb_build_object(
    'session_id','0b000000-0000-4000-8000-000000000001',
    'expected_updated_at', v_avant,
    'scope','strength',
    'blocks', jsonb_build_array(jsonb_build_object(
      'id','0b000000-0000-4000-8000-00000000000a','category','strength','position',0,'title','Muscu revue','color_key','green',
      'exercises', jsonb_build_array(
        jsonb_build_object('id','0b000000-0000-4000-8000-0000000000e1','name','Développé couché','sets',5,'reps','5','rest_seconds',150,'recommended_load','85kg'),
        jsonb_build_object('id','new-exercise:0b000000-0000-4000-8000-0000000000e9','name','Tirage horizontal','sets',4,'reps','8','rest_seconds',90,'recommended_load','60kg'))
    ))));

  -- le cardio est intact, prescriptions comprises (ids inclus : elles n'ont pas été recréées)
  select count(*) into v_n from (
    select id, title, color_key, "position", cardio_type, sport, rounds, updated_at
    from public.training_blocks where session_id = '0b000000-0000-4000-8000-000000000001' and block_type = 'cardio'
    except select * from t_cardio_avant) x;
  assert v_n = 0, 'CAS B : un bloc cardio a été modifié par un enregistrement de musculation';
  select count(*) into v_n from (
    select p.id, p.block_id, p.segment_type, p.title, p.target_zone, p."position"
    from public.training_prescriptions p join public.training_blocks b on b.id = p.block_id
    where b.session_id = '0b000000-0000-4000-8000-000000000001'
    except select * from t_presc_avant) x;
  assert v_n = 0, 'CAS B : une prescription cardio a été recréée ou modifiée';

  -- la musculation est bien modifiée
  assert (select name from public.workout_exercises where id = '0b000000-0000-4000-8000-0000000000e1') = 'Développé couché',
    'CAS B : la musculation n''a pas été modifiée';
  select count(*) into v_n from public.workout_exercises where session_id = '0b000000-0000-4000-8000-000000000001';
  assert v_n = 2, format('CAS B : %s exercices au lieu de 2', v_n);
  assert (select session_type from public.workout_sessions where id = '0b000000-0000-4000-8000-000000000001') = 'mixed',
    'CAS B : la séance mixte a été réétiquetée';
  raise notice 'CAS B OK — musculation modifiée, cardio intact';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- CAS C — supprimer le bloc cardio : la musculation reste
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_avant timestamptz; v_n int;
begin
  select updated_at into v_avant from public.workout_sessions where id = '0a000000-0000-4000-8000-000000000001';
  perform public.save_training_session_blocks(jsonb_build_object(
    'session_id','0a000000-0000-4000-8000-000000000001',
    'expected_updated_at', v_avant, 'scope','cardio', 'blocks', jsonb_build_array()));

  select count(*) into v_n from public.training_blocks
   where session_id = '0a000000-0000-4000-8000-000000000001' and block_type = 'cardio';
  assert v_n = 0, 'CAS C : le bloc cardio n''a pas été supprimé';
  select count(*) into v_n from public.training_blocks
   where session_id = '0a000000-0000-4000-8000-000000000001' and block_type <> 'cardio';
  assert v_n = 2, format('CAS C : %s blocs de musculation au lieu de 2', v_n);
  select count(*) into v_n from public.workout_exercises where session_id = '0a000000-0000-4000-8000-000000000001';
  assert v_n = 2, format('CAS C : %s exercices au lieu de 2 — la musculation a disparu avec le cardio', v_n);
  assert (select session_type from public.workout_sessions where id = '0a000000-0000-4000-8000-000000000001') = 'strength',
    'CAS C : le type dérivé devrait être strength une fois le cardio retiré';
  raise notice 'CAS C OK — cardio supprimé, musculation conservée';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- CAS D — supprimer un bloc de musculation : le cardio reste
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_avant timestamptz; v_n int;
begin
  select updated_at into v_avant from public.workout_sessions where id = '0b000000-0000-4000-8000-000000000001';
  perform public.save_training_session_blocks(jsonb_build_object(
    'session_id','0b000000-0000-4000-8000-000000000001',
    'expected_updated_at', v_avant, 'scope','strength', 'blocks', jsonb_build_array()));

  select count(*) into v_n from public.training_blocks
   where session_id = '0b000000-0000-4000-8000-000000000001' and block_type <> 'cardio';
  assert v_n = 0, 'CAS D : le bloc de musculation n''a pas été supprimé';
  select count(*) into v_n from public.workout_exercises where session_id = '0b000000-0000-4000-8000-000000000001';
  assert v_n = 0, 'CAS D : les exercices du bloc supprimé sont restés';
  select count(*) into v_n from public.training_blocks
   where session_id = '0b000000-0000-4000-8000-000000000001' and block_type = 'cardio';
  assert v_n = 2, format('CAS D : %s blocs cardio au lieu de 2 — le cardio a disparu avec la musculation', v_n);
  select count(*) into v_n from public.training_prescriptions p join public.training_blocks b on b.id = p.block_id
   where b.session_id = '0b000000-0000-4000-8000-000000000001';
  assert v_n = 2, format('CAS D : %s prescriptions cardio au lieu de 2', v_n);
  assert (select session_type from public.workout_sessions where id = '0b000000-0000-4000-8000-000000000001') = 'cardio',
    'CAS D : le type dérivé devrait être cardio une fois la musculation retirée';
  raise notice 'CAS D OK — musculation supprimée, cardio conservé';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- CAS E — création d'une séance MIXTE complète (portée 'all')
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_avant timestamptz; v_n int; v_res jsonb;
begin
  insert into public.workout_sessions (id, program_id, program_week_id, day, is_rest_day, name, muscle_group, duration_minutes, warmup, coach_notes, session_type)
  values ('0c000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-0000000000f1','0a000000-0000-4000-8000-0000000000f2','Mercredi',false,'Neuve','',90,'','','strength');
  select updated_at into v_avant from public.workout_sessions where id = '0c000000-0000-4000-8000-000000000001';

  -- muscu / cardio / muscu : l'entrelacement doit être respecté.
  v_res := public.save_training_session_blocks(jsonb_build_object(
    'session_id','0c000000-0000-4000-8000-000000000001',
    'expected_updated_at', v_avant,
    'blocks', jsonb_build_array(
      jsonb_build_object('id','new-block:0c000000-0000-4000-8000-00000000000a','category','strength','title','Force','color_key','gray',
        'exercises', jsonb_build_array(jsonb_build_object('id','new-exercise:0c000000-0000-4000-8000-0000000000e1','name','Squat','sets',5,'reps','5','rest_seconds',180))),
      jsonb_build_object('id','new-block:0c000000-0000-4000-8000-00000000000b','category','cardio','title','Intervalles','color_key','red',
        'cardio_type','vma_intervals','sport','course','rounds',6,
        'prescriptions', jsonb_build_array(jsonb_build_object('segment_type','work','title','800 m','distance_meters',800,'intensity_target_type','zone','target_zone',4))),
      jsonb_build_object('id','new-block:0c000000-0000-4000-8000-00000000000c','category','strength','title','Gainage','color_key','green',
        'exercises', jsonb_build_array(jsonb_build_object('id','new-exercise:0c000000-0000-4000-8000-0000000000e2','name','Planche','sets',3,'reps','45s','rest_seconds',60))))));

  select count(*) into v_n from public.training_blocks where session_id = '0c000000-0000-4000-8000-000000000001';
  assert v_n = 3, format('CAS E : %s blocs au lieu de 3', v_n);
  select count(*) into v_n from public.workout_exercises where session_id = '0c000000-0000-4000-8000-000000000001';
  assert v_n = 2, format('CAS E : %s exercices au lieu de 2', v_n);
  select count(*) into v_n from public.training_prescriptions p join public.training_blocks b on b.id = p.block_id
   where b.session_id = '0c000000-0000-4000-8000-000000000001';
  assert v_n = 1, format('CAS E : %s prescriptions au lieu de 1', v_n);
  assert (select session_type from public.workout_sessions where id = '0c000000-0000-4000-8000-000000000001') = 'mixed',
    'CAS E : la séance devrait être mixte';
  -- L'ORDRE muscu → cardio → muscu est conservé.
  assert (select array_agg(block_type order by "position") from public.training_blocks
          where session_id = '0c000000-0000-4000-8000-000000000001') = array['strength','cardio','strength'],
    'CAS E : l''entrelacement musculation / cardio / musculation n''a pas été conservé';
  raise notice 'CAS E OK — séance mixte créée, ordre muscu/cardio/muscu conservé';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- REFUS DE PORTÉE — le contrat, pas la bonne volonté du client
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_avant timestamptz; v_message text;
begin
  select updated_at into v_avant from public.workout_sessions where id = '0c000000-0000-4000-8000-000000000001';

  -- 1. un bloc de musculation dans un enregistrement cardio
  begin
    perform public.save_training_session_blocks(jsonb_build_object(
      'session_id','0c000000-0000-4000-8000-000000000001','expected_updated_at',v_avant,'scope','cardio',
      'blocks', jsonb_build_array(jsonb_build_object('id','new-block:0c000000-0000-4000-8000-0000000000aa','category','strength','position',0,'exercises',jsonb_build_array()))));
    assert false, 'REFUS 1 : un bloc de musculation a été accepté dans un enregistrement cardio';
  exception when others then
    v_message := SQLERRM;
    assert v_message like 'SCOPE_VIOLATION%', format('REFUS 1 : mauvaise erreur (%s)', v_message);
  end;

  -- 2. l'UUID d'un bloc de musculation, déguisé en bloc cardio
  begin
    perform public.save_training_session_blocks(jsonb_build_object(
      'session_id','0a000000-0000-4000-8000-000000000001','expected_updated_at',
      (select updated_at from public.workout_sessions where id='0a000000-0000-4000-8000-000000000001'),'scope','cardio',
      'blocks', jsonb_build_array(jsonb_build_object('id','0a000000-0000-4000-8000-00000000000a','category','cardio','position',0,'prescriptions',jsonb_build_array()))));
    assert false, 'REFUS 2 : un bloc de musculation a pu être converti en cardio';
  exception when others then
    v_message := SQLERRM;
    assert v_message like 'SCOPE_VIOLATION%', format('REFUS 2 : mauvaise erreur (%s)', v_message);
  end;

  -- 3. position manquante hors portée 'all'
  begin
    perform public.save_training_session_blocks(jsonb_build_object(
      'session_id','0c000000-0000-4000-8000-000000000001','expected_updated_at',v_avant,'scope','cardio',
      'blocks', jsonb_build_array(jsonb_build_object('id','new-block:0c000000-0000-4000-8000-0000000000ab','category','cardio','prescriptions',jsonb_build_array()))));
    assert false, 'REFUS 3 : une portée cardio a été acceptée sans position';
  exception when others then
    v_message := SQLERRM;
    assert v_message like 'MISSING_BLOCK_POSITION%', format('REFUS 3 : mauvaise erreur (%s)', v_message);
  end;

  -- 4. portée inconnue
  begin
    perform public.save_training_session_blocks(jsonb_build_object(
      'session_id','0c000000-0000-4000-8000-000000000001','expected_updated_at',v_avant,'scope','muscu',
      'blocks', jsonb_build_array()));
    assert false, 'REFUS 4 : une portée inconnue a été acceptée';
  exception when others then
    v_message := SQLERRM;
    assert v_message like 'INVALID_SCOPE%', format('REFUS 4 : mauvaise erreur (%s)', v_message);
  end;

  -- 5. la séance n'a pas bougé après ces quatre refus
  assert (select count(*) from public.training_blocks where session_id = '0c000000-0000-4000-8000-000000000001') = 3,
    'REFUS 5 : un refus a quand même modifié la séance';
  assert (select count(*) from public.workout_exercises where session_id = '0c000000-0000-4000-8000-000000000001') = 2,
    'REFUS 5 : un refus a supprimé des exercices';
  raise notice 'REFUS OK — bloc hors portée, conversion de catégorie, position manquante et portée inconnue rejetés sans rien modifier';
end $$;

rollback;
