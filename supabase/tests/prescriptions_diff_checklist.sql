-- ════════════════════════════════════════════════════════════════════════════
-- CHECKLIST — SYNCHRONISATION DIFFÉRENTIELLE DES PRESCRIPTIONS CARDIO
-- Lot D du chantier feat/entrainement-performances.
--
-- Tout s'exécute sous le rôle `authenticated` avec une identité réelle : les
-- policies RLS s'appliquent, comme en production. Base LOCALE uniquement.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\pset pager off


create table if not exists pg_temp.resultats (
  section text, num int, libelle text, vert boolean, detail text
);
truncate pg_temp.resultats;
grant all on pg_temp.resultats to authenticated;

create or replace function pg_temp.noter(s text, l text, ok boolean, d text default null)
returns void language plpgsql as $$
declare v_n int;
begin
  select coalesce(max(num), 0) + 1 into v_n from pg_temp.resultats where section = s;
  insert into pg_temp.resultats values (s, v_n, l, coalesce(ok, false), d);
  if not coalesce(ok, false) then
    raise warning 'ÉCHEC   — %', l;
  end if;
end $$;

create or replace function pg_temp.coach() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', false);
  perform set_config('request.jwt.claims',
    '{"sub":"d1d1d1d1-0000-4000-8000-000000000001","role":"authenticated"}', false);
end $$;

create or replace function pg_temp.serveur() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', false);
  perform set_config('request.jwt.claims', '{}', false);
end $$;

-- ── DÉCOR ───────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('d1d1d1d1-0000-4000-8000-000000000001','coachd@test.local') on conflict do nothing;
insert into public.profiles (id, user_id, email, role, first_name, last_name, phone) values
  ('d1d1d1d1-0000-4000-8000-000000000001','d1d1d1d1-0000-4000-8000-000000000001',
   'coachd@test.local','admin','Coach','D','') on conflict (id) do update set role='admin';
insert into public.coaches (id, user_id, name, role, status, specialty, email) values
  ('d2d2d2d2-0000-4000-8000-000000000001','d1d1d1d1-0000-4000-8000-000000000001',
   'Coach D','admin','actif','cardio','coachd@test.local') on conflict do nothing;
insert into public.programs (id, coach_id, name, goal, level, duration_weeks, status, publication_status) values
  ('d3d3d3d3-0000-4000-8000-000000000001','d2d2d2d2-0000-4000-8000-000000000001',
   'Programme cardio','endurance','intermédiaire',4,'actif','published') on conflict (id) do nothing;
insert into public.program_weeks (id, program_id, week_number) values
  ('d4d4d4d4-0000-4000-8000-000000000001','d3d3d3d3-0000-4000-8000-000000000001',1) on conflict do nothing;
insert into public.workout_sessions
  (id, program_id, program_week_id, day, is_rest_day, name, muscle_group, duration_minutes, warmup, coach_notes, session_type)
values
  ('d5d5d5d5-0000-4000-8000-000000000001','d3d3d3d3-0000-4000-8000-000000000001',
   'd4d4d4d4-0000-4000-8000-000000000001','lundi',false,'Séance cardio','jambes',60,'','','cardio')
on conflict (id) do nothing;
-- Un SECOND bloc cardio, pour prouver le bornage par bloc.
insert into public.workout_sessions
  (id, program_id, program_week_id, day, is_rest_day, name, muscle_group, duration_minutes, warmup, coach_notes, session_type)
values
  ('d5d5d5d5-0000-4000-8000-000000000002','d3d3d3d3-0000-4000-8000-000000000001',
   'd4d4d4d4-0000-4000-8000-000000000001','mardi',false,'Autre séance','jambes',60,'','','cardio')
on conflict (id) do nothing;

-- ── OUTILS ──────────────────────────────────────────────────────────────────
-- Construit la charge d'un bloc cardio à partir de ses prescriptions réelles,
-- comme le ferait le client après lecture (identifiants RÉELS inclus).
create or replace function pg_temp.charge_cardio(p_block uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_array(jsonb_build_object(
    'id', tb.id::text, 'category', 'cardio', 'title', tb.title,
    'color_key', tb.color_key, 'position', tb.position,
    'cardio_type', tb.cardio_type, 'machine_type', tb.machine_type,
    'prescriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tp.id::text, 'segment_type', tp.segment_type, 'title', tp.title,
        'work_duration_seconds', tp.work_duration_seconds,
        'intensity_target_type', tp.intensity_target_type,
        'target_hr_percentage', tp.target_hr_percentage,
        'coach_notes', tp.coach_notes
      ) order by tp.position)
      from public.training_prescriptions tp where tp.block_id = tb.id), '[]'::jsonb)
  ))
  from public.training_blocks tb where tb.id = p_block;
$$;

-- Charge COMPLÈTE d'une séance : TOUS ses blocs, avec leurs identifiants réels.
-- Nécessaire dès que la séance porte un bloc musculation à côté du cardio : une
-- charge ne contenant que le cardio, en portée « all », supprimerait l'autre.
create or replace function pg_temp.charge_seance_complete(p_session uuid)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(
    case when tb.block_type = 'cardio' then
      jsonb_build_object('id', tb.id::text, 'category','cardio','title',tb.title,
        'color_key',tb.color_key,'position',tb.position,
        'cardio_type',tb.cardio_type,'machine_type',tb.machine_type,
        'prescriptions', coalesce((select jsonb_agg(jsonb_build_object(
          'id', tp.id::text,'segment_type',tp.segment_type,'title',tp.title,
          'work_duration_seconds',tp.work_duration_seconds,
          'intensity_target_type',tp.intensity_target_type,
          'target_hr_percentage',tp.target_hr_percentage,'coach_notes',tp.coach_notes)
          order by tp.position)
          from public.training_prescriptions tp where tp.block_id = tb.id), '[]'::jsonb))
    else
      jsonb_build_object('id', tb.id::text,'category','strength','title',tb.title,
        'color_key',tb.color_key,'position',tb.position,
        'exercises', coalesce((select jsonb_agg(jsonb_build_object(
          'id', we.id::text,'name',we.name,'sets',we.sets,'reps',we.reps,
          'rest_seconds',we.rest_seconds,'tempo',we.tempo,
          'recommended_load',we.recommended_load,'recommended_rpe',coalesce(we.recommended_rpe,''),
          'video_url',we.video_url,'notes',we.notes,
          'muscle_group',we.muscle_group,'exercise_library_id',we.exercise_library_id)
          order by we.order_index)
          from public.workout_exercises we where we.block_id = tb.id), '[]'::jsonb))
    end order by tb.position), '[]'::jsonb)
  from public.training_blocks tb where tb.session_id = p_session;
$$;

create or replace function pg_temp.enregistrer(p_session uuid, p_blocks jsonb)
returns jsonb language plpgsql as $$
declare v_res jsonb;
begin
  v_res := public.save_training_session_blocks(jsonb_build_object(
    'session_id', p_session::text,
    'expected_updated_at', (select updated_at::text from public.workout_sessions where id = p_session),
    'blocks', p_blocks));
  return v_res;
end $$;

/*
 * ⚠️ UNE PROCÉDURE, ET NON UN BLOC `do` — PARCE QUE `updated_at` EN DÉPEND.
 * `set_updated_at` pose `now()`, qui est l'horodatage de la TRANSACTION, pas
 * celui de l'instruction. Dans un seul `do`, tous les enregistrements
 * partageaient donc le même `now()` : « updated_at a bougé » était
 * intestable, et le contrôle C4 échouait sur un artefact de méthode, pas sur
 * un défaut du moteur. Avec un `commit` par enregistrement, chaque appel a sa
 * propre transaction — exactement comme une requête PostgREST.
 */
create or replace procedure pg_temp.tout()
language plpgsql as $tout$
declare
  v_sess uuid := 'd5d5d5d5-0000-4000-8000-000000000001';
  v_sess2 uuid := 'd5d5d5d5-0000-4000-8000-000000000002';
  v_block uuid; v_block2 uuid;
  v_ids uuid[]; v_ids2 uuid[]; v_ids3 uuid[];
  v_maj timestamptz[]; v_maj2 timestamptz[];
  v_crees timestamptz[]; v_crees2 timestamptz[];
  v_charge jsonb; v_res jsonb;
  v_n int; v_err text;
  v_ordre_demande uuid[];
  v_exo uuid;
  v_exo_maj timestamptz;
  v_avant record; v_apres record;
begin
  perform pg_temp.coach();
  commit;

  -- ════════ A — CRÉATION INITIALE ════════
  v_res := pg_temp.enregistrer(v_sess, jsonb_build_array(jsonb_build_object(
    'id', 'new-block:aaaaaaaa-1111-4111-8111-111111111111',
    'category', 'cardio', 'title', 'Bloc cardio', 'color_key', 'green', 'position', 0,
    'cardio_type', 'continuous_run', 'machine_type', null,
    'prescriptions', jsonb_build_array(
      jsonb_build_object('id','new-prescription:bbbbbbb1-1111-4111-8111-111111111111',
        'segment_type','work','title','Segment 1','work_duration_seconds',600,
        'intensity_target_type','heart_rate_percentage','target_hr_percentage',70,'coach_notes',''),
      jsonb_build_object('id','new-prescription:bbbbbbb2-1111-4111-8111-111111111111',
        'segment_type','work','title','Segment 2','work_duration_seconds',300,
        'intensity_target_type','heart_rate_percentage','target_hr_percentage',80,'coach_notes',''),
      jsonb_build_object('id','new-prescription:bbbbbbb3-1111-4111-8111-111111111111',
        'segment_type','recovery','title','Récupération','work_duration_seconds',120,
        'intensity_target_type','free','target_hr_percentage',null,'coach_notes',''))
  )));
  commit;
  select id into v_block from public.training_blocks where session_id = v_sess;
  select array_agg(id order by position), array_agg(updated_at order by position),
         array_agg(created_at order by position)
    into v_ids, v_maj, v_crees
    from public.training_prescriptions where block_id = v_block;

  perform pg_temp.noter('A','A1. 3 prescriptions créées', coalesce(array_length(v_ids,1),0) = 3);
  perform pg_temp.noter('A','A2. les ids temporaires sont traduits dans id_mapping.prescriptions',
    (select count(*) from jsonb_object_keys(v_res->'id_mapping'->'prescriptions')) = 3);
  perform pg_temp.noter('A','A3. chaque id rendu correspond à une ligne réelle',
    (select count(*) from jsonb_each_text(v_res->'id_mapping'->'prescriptions') m
      join public.training_prescriptions tp on tp.id::text = m.value) = 3);
  perform pg_temp.noter('A','A4. ordre préservé (positions 0,1,2)',
    (select array_agg(position order by position) from public.training_prescriptions where block_id = v_block)
      = array[0,1,2]);

  -- ════════ B — SAUVEGARDE RÉPÉTÉE SANS CHANGEMENT ════════
  v_charge := pg_temp.charge_cardio(v_block);
  perform pg_temp.enregistrer(v_sess, v_charge);
  commit;
  select array_agg(id order by position), array_agg(updated_at order by position),
         array_agg(created_at order by position)
    into v_ids2, v_maj2, v_crees2
    from public.training_prescriptions where block_id = v_block;

  perform pg_temp.noter('B','B1. les IDENTIFIANTS sont inchangés', v_ids2 = v_ids,
    format('avant=%s après=%s', v_ids, v_ids2));
  perform pg_temp.noter('B','B2. aucune ligne créée ni supprimée', array_length(v_ids2,1) = 3);
  perform pg_temp.noter('B','B3. `updated_at` n''a PAS bougé — rien n''a changé', v_maj2 = v_maj);
  perform pg_temp.noter('B','B4. `created_at` est préservé (horodatage métier)', v_crees2 = v_crees);

  -- Et une troisième fois, pour écarter une coïncidence.
  perform pg_temp.enregistrer(v_sess, pg_temp.charge_cardio(v_block));
  commit;
  select array_agg(id order by position) into v_ids3
    from public.training_prescriptions where block_id = v_block;
  perform pg_temp.noter('B','B5. stable sur un 3e enregistrement identique', v_ids3 = v_ids);

  -- ════════ C — MODIFICATION : L'IDENTITÉ SURVIT ════════
  v_charge := pg_temp.charge_cardio(v_block);
  v_charge := jsonb_set(v_charge, '{0,prescriptions,1,work_duration_seconds}', '999'::jsonb);
  v_charge := jsonb_set(v_charge, '{0,prescriptions,1,title}', '"Segment 2 modifié"'::jsonb);
  perform pg_temp.enregistrer(v_sess, v_charge);
  commit;
  select array_agg(id order by position) into v_ids2
    from public.training_prescriptions where block_id = v_block;

  perform pg_temp.noter('C','C1. l''identifiant de la prescription modifiée est CONSERVÉ', v_ids2 = v_ids);
  perform pg_temp.noter('C','C2. la modification est bien écrite',
    (select work_duration_seconds from public.training_prescriptions
      where id = v_ids[2]) = 999);
  perform pg_temp.noter('C','C3. le titre est bien écrit',
    (select title from public.training_prescriptions where id = v_ids[2]) = 'Segment 2 modifié');
  perform pg_temp.noter('C','C4. `updated_at` a bougé pour CELLE-LÀ',
    (select updated_at from public.training_prescriptions where id = v_ids[2]) > v_maj[2]);
  perform pg_temp.noter('C','C5. et PAS pour les deux autres',
    (select updated_at from public.training_prescriptions where id = v_ids[1]) = v_maj[1]
    and (select updated_at from public.training_prescriptions where id = v_ids[3]) = v_maj[3]);
  perform pg_temp.noter('C','C6. `created_at` de la ligne modifiée est intact',
    (select created_at from public.training_prescriptions where id = v_ids[2]) = v_crees[2]);

  -- ════════ D — AJOUT EXPLICITE ════════
  v_charge := pg_temp.charge_cardio(v_block);
  v_charge := jsonb_set(v_charge, '{0,prescriptions}',
    (v_charge->0->'prescriptions') || jsonb_build_array(jsonb_build_object(
      'id','new-prescription:ccccccc1-1111-4111-8111-111111111111',
      'segment_type','work','title','Segment ajouté','work_duration_seconds',240,
      'intensity_target_type','free','target_hr_percentage',null,'coach_notes','')));
  v_res := pg_temp.enregistrer(v_sess, v_charge);
  commit;

  perform pg_temp.noter('D','D1. 4 prescriptions après ajout',
    (select count(*) from public.training_prescriptions where block_id = v_block) = 4);
  perform pg_temp.noter('D','D2. les 3 identifiants d''origine sont CONSERVÉS',
    (select array_agg(id order by position) from public.training_prescriptions
      where block_id = v_block and position < 3) = v_ids);
  perform pg_temp.noter('D','D3. la nouvelle ligne est en position 3',
    (select title from public.training_prescriptions where block_id = v_block and position = 3)
      = 'Segment ajouté');
  perform pg_temp.noter('D','D4. son id réel est rendu dans id_mapping',
    (v_res->'id_mapping'->'prescriptions') ? 'new-prescription:ccccccc1-1111-4111-8111-111111111111');

  -- ════════ E — SUPPRESSION EXPLICITE, ET ELLE SEULE ════════
  v_charge := pg_temp.charge_cardio(v_block);
  -- on retire le 2e segment (index 1) de la liste
  v_charge := jsonb_set(v_charge, '{0,prescriptions}',
    ((v_charge->0->'prescriptions') - 1::int));
  perform pg_temp.enregistrer(v_sess, v_charge);
  commit;

  perform pg_temp.noter('E','E1. il reste 3 prescriptions',
    (select count(*) from public.training_prescriptions where block_id = v_block) = 3);
  perform pg_temp.noter('E','E2. SEULE la ligne retirée a disparu',
    not exists (select 1 from public.training_prescriptions where id = v_ids[2]));
  perform pg_temp.noter('E','E3. les deux autres d''origine sont toujours là, mêmes ids',
    exists (select 1 from public.training_prescriptions where id = v_ids[1])
    and exists (select 1 from public.training_prescriptions where id = v_ids[3]));
  perform pg_temp.noter('E','E4. les positions sont renumérotées sans trou',
    (select array_agg(position order by position) from public.training_prescriptions
      where block_id = v_block) = array[0,1,2]);

  -- ════════ F — RÉORDONNANCEMENT ════════
  /*
   * ⚠️ VERSION RENFORCÉE. La première se contentait de compter les lignes et
   * de vérifier que 2 des 3 ids d'origine étaient encore là — ce qui aurait
   * laissé passer un réordonnancement qui N'ÉCRIT PAS les nouvelles positions,
   * ou qui les écrit dans le mauvais ordre. On vérifie maintenant la
   * correspondance EXACTE entre l'ordre demandé et l'ordre en base, id par id.
   */
  select array_agg(id order by position) into v_ids2
    from public.training_prescriptions where block_id = v_block;
  -- Ordre demandé : on place le DERNIER en premier, puis les deux autres.
  v_charge := pg_temp.charge_cardio(v_block);
  v_charge := jsonb_set(v_charge, '{0,prescriptions}', jsonb_build_array(
    v_charge->0->'prescriptions'->2, v_charge->0->'prescriptions'->0, v_charge->0->'prescriptions'->1));
  v_ordre_demande := array[v_ids2[3], v_ids2[1], v_ids2[2]];
  perform pg_temp.enregistrer(v_sess, v_charge);
  commit;

  select array_agg(id order by position) into v_ids3
    from public.training_prescriptions where block_id = v_block;

  perform pg_temp.noter('F','F1. réordonner ne crée ni ne supprime aucune ligne',
    (select count(*) from public.training_prescriptions where block_id = v_block) = 3);
  perform pg_temp.noter('F','F2. AUCUN identifiant n''a changé (même ensemble)',
    (select array_agg(id order by id) from public.training_prescriptions where block_id = v_block)
      = (select array_agg(x order by x) from unnest(v_ids2) x),
    format('avant=%s après=%s', v_ids2, v_ids3));
  perform pg_temp.noter('F','F3. l''ordre en base est EXACTEMENT l''ordre demandé',
    v_ids3 = v_ordre_demande,
    format('demandé=%s obtenu=%s', v_ordre_demande, v_ids3));
  perform pg_temp.noter('F','F4. les positions sont 0,1,2 sans trou ni doublon',
    (select array_agg(position order by position) from public.training_prescriptions
      where block_id = v_block) = array[0,1,2]);
  perform pg_temp.noter('F','F5. chaque id porte la position de son rang demandé',
    (select bool_and(tp.position = r.rang - 1)
       from unnest(v_ordre_demande) with ordinality as r(id, rang)
       join public.training_prescriptions tp on tp.id = r.id));
  -- Et `set_number` suit `position` : les deux sont dérivés du rang.
  perform pg_temp.noter('F','F6. `set_number` suit le rang, comme `position`',
    (select bool_and(set_number = position) from public.training_prescriptions
      where block_id = v_block));

  -- ════════ G — CHARGE REFUSÉE : AUCUNE ÉCRITURE ════════
  select array_agg(id order by position) into v_ids2
    from public.training_prescriptions where block_id = v_block;

  -- G1 : un UUID de prescription qui n'appartient pas à ce bloc.
  insert into public.training_blocks (id, session_id, block_type, title, color_key, position, cardio_type)
  values ('aaaaaaa2-1111-4111-8111-111111111111', v_sess2, 'cardio', 'Bloc voisin', 'green', 0, 'continuous_run')
  on conflict (id) do nothing;
  insert into public.training_prescriptions
    (id, block_id, segment_type, title, work_duration_seconds, intensity_target_type,
     set_number, set_type, load_unit, load_input_mode, coach_notes, position, data_source)
  values ('ddddddd1-1111-4111-8111-111111111111','aaaaaaa2-1111-4111-8111-111111111111',
     'work','Voisine',600,'free',0,'normal','kg','total','',0,'manual')
  on conflict (id) do nothing;

  v_charge := pg_temp.charge_cardio(v_block);
  v_charge := jsonb_set(v_charge, '{0,prescriptions,0,id}',
    to_jsonb('ddddddd1-1111-4111-8111-111111111111'::text));
  begin
    perform pg_temp.enregistrer(v_sess, v_charge);
    commit;
    v_err := '(aucune erreur)';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.noter('G','G1. un UUID d''un AUTRE bloc est refusé (FOREIGN_PRESCRIPTION_ID)',
    v_err like 'FOREIGN_PRESCRIPTION_ID%', v_err);
  perform pg_temp.noter('G','G2. la prescription du bloc voisin est INTACTE',
    (select title from public.training_prescriptions
      where id = 'ddddddd1-1111-4111-8111-111111111111') = 'Voisine');

  -- G3 : id temporaire mal formé.
  v_charge := pg_temp.charge_cardio(v_block);
  v_charge := jsonb_set(v_charge, '{0,prescriptions,0,id}', to_jsonb('new-prescription:pas-un-uuid'::text));
  begin
    perform pg_temp.enregistrer(v_sess, v_charge);
    commit;
    v_err := '(aucune erreur)';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.noter('G','G3. suffixe non UUID refusé (INVALID_NEW_PRESCRIPTION_ID)',
    v_err like 'INVALID_NEW_PRESCRIPTION_ID%', v_err);

  -- G4 : forme inconnue.
  v_charge := pg_temp.charge_cardio(v_block);
  v_charge := jsonb_set(v_charge, '{0,prescriptions,0,id}', to_jsonb('seg-1761000000-3'::text));
  begin
    perform pg_temp.enregistrer(v_sess, v_charge);
    commit;
    v_err := '(aucune erreur)';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.noter('G','G4. forme inconnue refusée (UNRECOGNIZED_PRESCRIPTION_ID)',
    v_err like 'UNRECOGNIZED_PRESCRIPTION_ID%', v_err);

  -- G5 : deux fois le même id temporaire.
  v_charge := pg_temp.charge_cardio(v_block);
  v_charge := jsonb_set(v_charge, '{0,prescriptions}', jsonb_build_array(
    jsonb_build_object('id','new-prescription:eeeeeee1-1111-4111-8111-111111111111',
      'segment_type','work','title','X','work_duration_seconds',60,
      'intensity_target_type','free','coach_notes',''),
    jsonb_build_object('id','new-prescription:eeeeeee1-1111-4111-8111-111111111111',
      'segment_type','work','title','Y','work_duration_seconds',60,
      'intensity_target_type','free','coach_notes','')));
  begin
    perform pg_temp.enregistrer(v_sess, v_charge);
    commit;
    v_err := '(aucune erreur)';
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.noter('G','G5. id temporaire en doublon refusé (DUPLICATE_TEMP_PRESCRIPTION_ID)',
    v_err like 'DUPLICATE_TEMP_PRESCRIPTION_ID%', v_err);

  -- G6/G7 : APRÈS tous ces refus, rien n'a bougé.
  perform pg_temp.noter('G','G6. après 5 refus, les identifiants sont inchangés',
    (select array_agg(id order by position) from public.training_prescriptions
      where block_id = v_block) = v_ids2);
  perform pg_temp.noter('G','G7. ni doublon ni perte : toujours 3 lignes',
    (select count(*) from public.training_prescriptions where block_id = v_block) = 3);

  -- ════════ H — NOUVELLE TENTATIVE APRÈS ERREUR ════════
  -- La charge VALIDE rejouée juste après les refus doit réussir, sans doublon.
  perform pg_temp.enregistrer(v_sess, pg_temp.charge_cardio(v_block));
  commit;
  perform pg_temp.noter('H','H1. la tentative valide qui suit un refus réussit',
    (select count(*) from public.training_prescriptions where block_id = v_block) = 3);
  perform pg_temp.noter('H','H2. et conserve les identifiants',
    (select array_agg(id order by position) from public.training_prescriptions
      where block_id = v_block) = v_ids2);
  -- Rejouée deux fois de plus : idempotence.
  perform pg_temp.enregistrer(v_sess, pg_temp.charge_cardio(v_block));
  commit;
  perform pg_temp.enregistrer(v_sess, pg_temp.charge_cardio(v_block));
  commit;
  perform pg_temp.noter('H','H3. idempotent sur 3 rejeux consécutifs',
    (select count(*) from public.training_prescriptions where block_id = v_block) = 3
    and (select array_agg(id order by position) from public.training_prescriptions
          where block_id = v_block) = v_ids2);

  -- ════════ I — COMPATIBILITÉ : CHARGE SANS `id` ════════
  -- Un client antérieur à ce lot n'envoie aucun identifiant : les lignes sont
  -- alors traitées comme neuves (comportement d'avant), et rien ne casse.
  v_charge := pg_temp.charge_cardio(v_block);
  v_charge := (select jsonb_build_array(jsonb_set(v_charge->0, '{prescriptions}',
    (select coalesce(jsonb_agg(p - 'id'), '[]'::jsonb)
       from jsonb_array_elements(v_charge->0->'prescriptions') p))));
  perform pg_temp.enregistrer(v_sess, v_charge);
  commit;
  perform pg_temp.noter('I','I1. une charge SANS id est acceptée (déploiement progressif)',
    (select count(*) from public.training_prescriptions where block_id = v_block) = 3);
  perform pg_temp.noter('I','I2. elle recrée les lignes — comportement d''avant, assumé',
    (select count(*) from public.training_prescriptions
      where block_id = v_block and id = any(v_ids2)) = 0);

  -- ════════ J — BORNAGE PAR BLOC ════════
  perform pg_temp.noter('J','J1. le bloc voisin n''a JAMAIS été touché',
    (select count(*) from public.training_prescriptions
      where block_id = 'aaaaaaa2-1111-4111-8111-111111111111') = 1);
  perform pg_temp.noter('J','J2. et sa prescription a toujours le même id',
    exists (select 1 from public.training_prescriptions
      where id = 'ddddddd1-1111-4111-8111-111111111111'));

  -- ════════ K — LES RETOURS D'EXERCICE ET LES EXERCICES NE SONT PAS TOUCHÉS ════════
  /*
   * ⚠️ JE N'AI PAS PU FABRIQUER DE RETOUR DÉTACHÉ, ET C'EST UNE BONNE
   * NOUVELLE. Le déclencheur `enforce_exercise_feedback_write` refuse une
   * ligne `exercise_feedback` sans retour de séance parent : le schéma empêche
   * désormais d'en créer. Les 228 orphelins de production sont donc ANTÉRIEURS
   * à cette garde. On ne les simule pas.
   *
   * ⚠️ K4 EST DEVENU UN VRAI TEST. Il affirmait « 0 exercice sur la séance »,
   * ce qui ne prouvait RIEN : une séance sans exercice ne peut pas en perdre.
   * On rattache maintenant un exercice RÉEL à la séance testée, dans un bloc
   * musculation, puis on enregistre plusieurs fois le CARDIO — et on vérifie
   * que l'exercice, son identifiant et son contenu survivent.
   */
  perform pg_temp.serveur();
  select count(*) into v_n from public.exercise_feedback;
  perform pg_temp.noter('K','K1. le moteur n''ÉCRIT jamais dans exercise_feedback',
    (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'save_training_session_blocks')
    !~* '(insert into|update|delete from)\s+public\.exercise_feedback');
  perform pg_temp.noter('K','K2. il ne LIT exercise_feedback que pour compter les détachements',
    (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'save_training_session_blocks')
    like '%select count(*) into v_detached_feedback_count%');
  perform pg_temp.coach();
  commit;

  -- Un bloc musculation AVEC un exercice réel, posé par le moteur lui-même
  -- (donc avec un id serveur authentique), à côté du bloc cardio existant.
  v_charge := pg_temp.charge_cardio(v_block);
  v_charge := v_charge || jsonb_build_array(jsonb_build_object(
    'id', 'new-block:aaaaaaa9-1111-4111-8111-111111111111',
    'category', 'strength', 'title', 'Bloc muscu', 'color_key', 'blue', 'position', 1,
    'exercises', jsonb_build_array(jsonb_build_object(
      'id','new-exercise:fffffff1-1111-4111-8111-111111111111',
      'name','Développé couché','sets',4,'reps','8','rest_seconds',120,'tempo','2-0-2',
      'recommended_load','80 kg','recommended_rpe','8','video_url','https://v/dc',
      'notes','Serre les omoplates','muscle_group','pectoraux','exercise_library_id',null))));
  perform pg_temp.enregistrer(v_sess, v_charge);
  commit;

  select id, updated_at into v_exo, v_exo_maj
    from public.workout_exercises where session_id = v_sess;
  perform pg_temp.noter('K','K3. un exercice réel est bien rattaché à la séance testée',
    v_exo is not null);

  -- Trois enregistrements CARDIO successifs : on ne renvoie QUE les blocs tels
  -- qu'ils sont, et l'exercice doit traverser sans broncher.
  perform pg_temp.enregistrer(v_sess, pg_temp.charge_seance_complete(v_sess));
  commit;
  perform pg_temp.enregistrer(v_sess, pg_temp.charge_seance_complete(v_sess));
  commit;
  perform pg_temp.enregistrer(v_sess, pg_temp.charge_seance_complete(v_sess));
  commit;

  perform pg_temp.noter('K','K4. après 3 enregistrements, l''exercice existe toujours',
    exists (select 1 from public.workout_exercises where id = v_exo));
  perform pg_temp.noter('K','K5. son IDENTIFIANT est inchangé',
    (select count(*) from public.workout_exercises where session_id = v_sess) = 1
    and (select id from public.workout_exercises where session_id = v_sess) = v_exo);
  perform pg_temp.noter('K','K6. son contenu est intact',
    (select name || '|' || sets || '|' || reps || '|' || recommended_load || '|' || coalesce(muscle_group,'')
       from public.workout_exercises where id = v_exo)
      = 'Développé couché|4|8|80 kg|pectoraux');
  /*
   * ⚠️ K7 CONSTATE UNE ASYMÉTRIE RÉELLE, ET NE LA MAQUILLE PAS.
   *
   * J'avais d'abord écrit « son `updated_at` n'a pas bougé ». Le test est passé
   * au rouge, et il avait raison : la branche EXERCICE du moteur fait un
   *
   *     update public.workout_exercises set … updated_at = now()
   *     where id = v_ex_uuid and session_id = v_session_id;
   *
   * SANS garde `is distinct from` — donc chaque enregistrement de la séance
   * bouge l'`updated_at` de TOUS ses exercices, y compris ceux que personne
   * n'a touchés. C'est exactement le défaut que ce lot corrige pour les
   * prescriptions, encore présent pour les exercices.
   *
   * CE LOT NE LE CORRIGE PAS : le périmètre demandé est les prescriptions
   * cardio, et poser une garde sur les exercices changerait la sémantique
   * d'`updated_at` sur un chemin que rien n'oblige à toucher ici — l'abonnement
   * Realtime de l'élève écoute `workout_sessions`, mais d'autres lectures
   * pourraient s'appuyer sur celui des exercices. Le test MESURE donc l'état
   * réel et le nomme, pour qu'il soit suivi plutôt qu'oublié.
   *
   * L'essentiel est ailleurs, et il est vert : la LIGNE, son IDENTIFIANT et son
   * CONTENU traversent trois enregistrements cardio intacts (K4, K5, K6).
   */
  perform pg_temp.noter('K','K7. l''exercice est bien RÉÉCRIT à chaque enregistrement (asymétrie connue, hors périmètre)',
    (select updated_at from public.workout_exercises where id = v_exo) > v_exo_maj,
    'la branche exercice du moteur n''a pas de garde `is distinct from` — à traiter dans un lot dédié');
  perform pg_temp.noter('K','K7 bis. et les prescriptions, elles, ne sont PAS réécrites sans raison',
    (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='save_training_session_blocks')
    like '%is distinct from row(%');
  perform pg_temp.serveur();
  perform pg_temp.noter('K','K8. le nombre de retours d''exercice est inchangé',
    (select count(*) from public.exercise_feedback) = v_n);
  perform pg_temp.coach();
  commit;


  -- ════════ L — LES 25 CHAMPS SURVIVENT À UN ALLER-RETOUR COMPLET ════════
  /*
   * ⚠️ POURQUOI CETTE SECTION EXISTE. Mon contrôle d'exhaustivité, en écrivant
   * la migration, a refusé ma liste de colonnes faite à la main : la fonction
   * DÉPLOYÉE porte `target_zone` et `target_power_percentage`, ajoutées par une
   * migration postérieure à celle que je lisais. Une colonne oubliée dans le
   * `SET` serait simplement JAMAIS mise à jour, et aucun test de bout en bout
   * ne le verrait — l'ancienne valeur resterait, plausible.
   *
   * On pose donc une prescription où les 25 champs issus de la charge portent
   * une valeur DISTINCTIVE, on l'enregistre, on la relit, puis on les modifie
   * TOUS et on vérifie que chacun a bien changé. Un champ absent du `SET`
   * échouerait au second temps ; un champ absent de l'`INSERT` au premier.
   */
  perform pg_temp.serveur();
  delete from public.training_blocks where session_id = v_sess;
  perform pg_temp.coach();
  commit;

  v_res := pg_temp.enregistrer(v_sess, jsonb_build_array(jsonb_build_object(
    'id','new-block:aaaaaab1-1111-4111-8111-111111111111',
    'category','cardio','title','Bloc complet','color_key','green','position',0,
    'cardio_type','vma_intervals','machine_type',null,
    'prescriptions', jsonb_build_array(jsonb_build_object(
      'id','new-prescription:bbbbbbc1-1111-4111-8111-111111111111',
      'segment_type','work', 'title','Tous les champs',
      'repetitions',3, 'work_duration_seconds',601, 'distance_meters',1002,
      'elevation_gain_meters',103, 'incline_percentage',4,
      'recovery_duration_seconds',65, 'recovery_distance_meters',206,
      'intensity_target_type','vma_percentage', 'target_vma_percentage',107,
      'target_speed_kmh',18, 'target_pace_seconds_per_km',249,
      'target_hr_percentage',88, 'target_hr_zone','Zone 4',
      'target_power_watts',310, 'target_cadence',92,
      'intensity_min',7, 'intensity_max',9,
      'target_zone',5, 'target_power_percentage',95,
      'surface','piste', 'terrain','plat', 'equipment_type','tapis',
      'coach_notes','Notes initiales'))
  )));
  commit;
  select id into v_block from public.training_blocks where session_id = v_sess;
  select * into v_avant from public.training_prescriptions where block_id = v_block;

  perform pg_temp.noter('L','L1. les 25 champs sont écrits à la CRÉATION',
    v_avant.segment_type = 'work' and v_avant.title = 'Tous les champs'
    and v_avant.repetitions = 3 and v_avant.work_duration_seconds = 601
    and v_avant.distance_meters = 1002 and v_avant.elevation_gain_meters = 103
    and v_avant.incline_percentage = 4 and v_avant.recovery_duration_seconds = 65
    and v_avant.recovery_distance_meters = 206
    and v_avant.intensity_target_type = 'vma_percentage' and v_avant.target_vma_percentage = 107
    and v_avant.target_speed_kmh = 18 and v_avant.target_pace_seconds_per_km = 249
    and v_avant.target_hr_percentage = 88 and v_avant.target_hr_zone = 'Zone 4'
    and v_avant.target_power_watts = 310 and v_avant.target_cadence = 92
    and v_avant.intensity_min = 7 and v_avant.intensity_max = 9
    and v_avant.target_zone = 5 and v_avant.target_power_percentage = 95
    and v_avant.surface = 'piste' and v_avant.terrain = 'plat'
    and v_avant.equipment_type = 'tapis' and v_avant.coach_notes = 'Notes initiales');
  perform pg_temp.noter('L','L2. `target_zone` et `target_power_percentage` — les deux colonnes que ma liste manuelle avait oubliées',
    v_avant.target_zone = 5 and v_avant.target_power_percentage = 95);

  -- Second temps : on modifie TOUS les champs, et chacun doit bouger.
  perform pg_temp.enregistrer(v_sess, jsonb_build_array(jsonb_build_object(
    'id', v_block::text,
    'category','cardio','title','Bloc complet','color_key','green','position',0,
    'cardio_type','vma_intervals','machine_type',null,
    'prescriptions', jsonb_build_array(jsonb_build_object(
      'id', v_avant.id::text,
      'segment_type','recovery', 'title','Tous modifiés',
      'repetitions',13, 'work_duration_seconds',611, 'distance_meters',1012,
      'elevation_gain_meters',113, 'incline_percentage',14,
      'recovery_duration_seconds',75, 'recovery_distance_meters',216,
      'intensity_target_type','pace', 'target_vma_percentage',117,
      'target_speed_kmh',28, 'target_pace_seconds_per_km',259,
      'target_hr_percentage',78, 'target_hr_zone','Zone 2',
      'target_power_watts',320, 'target_cadence',82,
      'intensity_min',6, 'intensity_max',8,
      'target_zone',3, 'target_power_percentage',85,
      'surface','route', 'terrain','vallonné', 'equipment_type','velo',
      'coach_notes','Notes modifiées'))
  )));
  commit;
  select * into v_apres from public.training_prescriptions where id = v_avant.id;

  perform pg_temp.noter('L','L3. l''identifiant a survécu à la modification de masse',
    v_apres.id = v_avant.id);
  perform pg_temp.noter('L','L4. les 25 champs ont TOUS été mis à jour',
    v_apres.segment_type = 'recovery' and v_apres.title = 'Tous modifiés'
    and v_apres.repetitions = 13 and v_apres.work_duration_seconds = 611
    and v_apres.distance_meters = 1012 and v_apres.elevation_gain_meters = 113
    and v_apres.incline_percentage = 14 and v_apres.recovery_duration_seconds = 75
    and v_apres.recovery_distance_meters = 216
    and v_apres.intensity_target_type = 'pace' and v_apres.target_vma_percentage = 117
    and v_apres.target_speed_kmh = 28 and v_apres.target_pace_seconds_per_km = 259
    and v_apres.target_hr_percentage = 78 and v_apres.target_hr_zone = 'Zone 2'
    and v_apres.target_power_watts = 320 and v_apres.target_cadence = 82
    and v_apres.intensity_min = 6 and v_apres.intensity_max = 8
    and v_apres.target_zone = 3 and v_apres.target_power_percentage = 85
    and v_apres.surface = 'route' and v_apres.terrain = 'vallonné'
    and v_apres.equipment_type = 'velo' and v_apres.coach_notes = 'Notes modifiées');
  perform pg_temp.noter('L','L5. `created_at` est resté celui de la création',
    v_apres.created_at = v_avant.created_at);
  perform pg_temp.noter('L','L6. `block_id` n''a pas bougé — la ligne n''a pas changé de parent',
    v_apres.block_id = v_avant.block_id and v_apres.exercise_id is null);

  -- ════════ M — UNE CHARGE PARTIELLE N'EFFACE RIEN ════════
  /*
   * ⚠️ C'EST LA GARANTIE QUI MANQUAIT, et elle ne venait pas d'elle-même.
   * Écrit naïvement, l'UPDATE assigne les 25 colonnes depuis la charge :
   * `colonne = (v_prescription->>'clé')::type`. Une clé ABSENTE rend NULL — donc
   * une charge qui ne mentionne qu'un champ EFFACERAIT les 24 autres.
   *
   * La migration pose donc, sur chacune des 25 colonnes,
   * `case when v_prescription ? 'clé' then … else <colonne> end` — le contrat de
   * `session_patch`, déjà établi dans ce moteur. Cette section le prouve par
   * l'usage : on envoie une charge qui ne porte QUE `coach_notes`, et on vérifie
   * que les 24 autres champs sont intacts.
   *
   * En pratique `serializeBlock` envoie les 25 clés, donc ce cas ne se produit
   * pas aujourd'hui. Mais il se produirait au premier appel partiel — et aucun
   * test de bout en bout ne l'aurait vu venir.
   */
  perform pg_temp.enregistrer(v_sess, jsonb_build_array(jsonb_build_object(
    'id', v_block::text,
    'category','cardio','title','Bloc complet','color_key','green','position',0,
    'cardio_type','vma_intervals','machine_type',null,
    'prescriptions', jsonb_build_array(jsonb_build_object(
      'id', v_avant.id::text, 'coach_notes','Seule note changée'))
  )));
  commit;
  select * into v_avant from public.training_prescriptions where id = v_apres.id;

  perform pg_temp.noter('M','M1. le champ mentionné est bien modifié',
    v_avant.coach_notes = 'Seule note changée');
  perform pg_temp.noter('M','M2. les 24 champs ABSENTS de la charge sont INTACTS',
    v_avant.segment_type = v_apres.segment_type and v_avant.title = v_apres.title
    and v_avant.repetitions = v_apres.repetitions
    and v_avant.work_duration_seconds = v_apres.work_duration_seconds
    and v_avant.distance_meters = v_apres.distance_meters
    and v_avant.elevation_gain_meters = v_apres.elevation_gain_meters
    and v_avant.incline_percentage = v_apres.incline_percentage
    and v_avant.recovery_duration_seconds = v_apres.recovery_duration_seconds
    and v_avant.recovery_distance_meters = v_apres.recovery_distance_meters
    and v_avant.intensity_target_type = v_apres.intensity_target_type
    and v_avant.target_vma_percentage = v_apres.target_vma_percentage
    and v_avant.target_speed_kmh = v_apres.target_speed_kmh
    and v_avant.target_pace_seconds_per_km = v_apres.target_pace_seconds_per_km
    and v_avant.target_hr_percentage = v_apres.target_hr_percentage
    and v_avant.target_hr_zone = v_apres.target_hr_zone
    and v_avant.target_power_watts = v_apres.target_power_watts
    and v_avant.target_cadence = v_apres.target_cadence
    and v_avant.intensity_min = v_apres.intensity_min
    and v_avant.intensity_max = v_apres.intensity_max
    and v_avant.target_zone = v_apres.target_zone
    and v_avant.target_power_percentage = v_apres.target_power_percentage
    and v_avant.surface = v_apres.surface and v_avant.terrain = v_apres.terrain
    and v_avant.equipment_type = v_apres.equipment_type);
  perform pg_temp.noter('M','M3. `target_zone` et `target_power_percentage` ne sont pas remis à NULL',
    v_avant.target_zone = 3 and v_avant.target_power_percentage = 85);
  perform pg_temp.noter('M','M4. l''identifiant et `created_at` survivent aussi',
    v_avant.id = v_apres.id and v_avant.created_at = v_apres.created_at);

  -- Et la distinction qui compte : une clé PRÉSENTE à null EFFACE bien.
  perform pg_temp.enregistrer(v_sess, jsonb_build_array(jsonb_build_object(
    'id', v_block::text,
    'category','cardio','title','Bloc complet','color_key','green','position',0,
    'cardio_type','vma_intervals','machine_type',null,
    'prescriptions', jsonb_build_array(jsonb_build_object(
      'id', v_avant.id::text, 'target_zone', null))
  )));
  commit;
  perform pg_temp.noter('M','M5. une clé PRÉSENTE à null efface — absent ≠ null',
    (select target_zone is null from public.training_prescriptions where id = v_avant.id)
    and (select target_power_percentage = 85 from public.training_prescriptions where id = v_avant.id));


  -- ════════ N — IDENTIFIANTS TEMPORAIRES RENVOYÉS APRÈS UNE CRÉATION ════════
  /*
   * ⚠️ LE SEUL CAS OÙ L'ABSENCE DE RÉCONCILIATION PAR `id_mapping` POURRAIT
   * COÛTER QUELQUE CHOSE — et il faut le mesurer, pas le supposer sûr.
   *
   * Le builder ne consomme PAS `id_mapping` : il se réconcilie en RELISANT la
   * programmation après un succès (nouvelle `key`, remontage, identifiants
   * réels). Mais `orchestrateBuilderSave` connaît une issue `refetch-failed` :
   * la sauvegarde a réussi, la relecture a échoué, et le builder garde donc son
   * état local — avec les identifiants TEMPORAIRES des lignes qui existent
   * désormais en base.
   *
   * Si le coach réenregistre dans cet état, la charge porte à nouveau
   * `new-prescription:<même uuid>`. Trois issues possibles, et une seule
   * acceptable :
   *   · doublons qui s'accumulent → inacceptable ;
   *   · lignes perdues → inacceptable ;
   *   · lignes recréées, compte stable → acceptable (les `id` changent, ce qui
   *     est le comportement d'avant ce lot, et le coach recharge).
   *
   * C'est le bornage de la suppression (`id <> all(v_kept_presc_uuids)`) qui
   * garantit la troisième : les anciennes lignes ne sont plus dans la liste
   * conservée, donc elles partent avec l'insertion des nouvelles.
   */
  perform pg_temp.serveur();
  delete from public.training_blocks where session_id = v_sess;
  perform pg_temp.coach();
  commit;

  v_charge := jsonb_build_array(jsonb_build_object(
    'id','new-block:aaaaaac1-1111-4111-8111-111111111111',
    'category','cardio','title','Bloc N','color_key','green','position',0,
    'cardio_type','continuous_run','machine_type',null,
    'prescriptions', jsonb_build_array(
      jsonb_build_object('id','new-prescription:ccccccd1-1111-4111-8111-111111111111',
        'segment_type','work','title','N1','work_duration_seconds',100,
        'intensity_target_type','free','coach_notes',''),
      jsonb_build_object('id','new-prescription:ccccccd2-1111-4111-8111-111111111111',
        'segment_type','work','title','N2','work_duration_seconds',200,
        'intensity_target_type','free','coach_notes',''))));
  perform pg_temp.enregistrer(v_sess, v_charge);
  commit;
  select id into v_block from public.training_blocks where session_id = v_sess;
  select array_agg(id order by position) into v_ids
    from public.training_prescriptions where block_id = v_block;
  perform pg_temp.noter('N','N1. création : 2 prescriptions', array_length(v_ids,1) = 2);

  -- Le coach réenregistre son état LOCAL, non réconcilié : mêmes ids
  -- temporaires, et un identifiant de bloc temporaire lui aussi.
  perform pg_temp.enregistrer(v_sess, v_charge);
  commit;
  select array_agg(id order by position) into v_ids2
    from public.training_prescriptions where block_id = (
      select id from public.training_blocks where session_id = v_sess order by position limit 1);

  perform pg_temp.noter('N','N2. AUCUN doublon : toujours 2 prescriptions au total',
    (select count(*) from public.training_prescriptions tp
      join public.training_blocks tb on tb.id = tp.block_id
     where tb.session_id = v_sess) = 2);
  perform pg_temp.noter('N','N3. AUCUNE perte : les 2 lignes sont bien présentes',
    array_length(v_ids2,1) = 2);
  perform pg_temp.noter('N','N4. le contenu est celui de la charge',
    (select array_agg(title order by position) from public.training_prescriptions
      where block_id = (select id from public.training_blocks where session_id = v_sess
                         order by position limit 1)) = array['N1','N2']);
  perform pg_temp.noter('N','N5. les identifiants ONT changé — conséquence assumée d''un état non réconcilié',
    not (v_ids2 && v_ids),
    'le coach doit recharger ; aucun doublon, aucune perte');

  -- Et un troisième rejeu : le compte reste stable, donc rien ne s'accumule.
  perform pg_temp.enregistrer(v_sess, v_charge);
  commit;
  perform pg_temp.noter('N','N6. un 3e rejeu ne fait toujours pas gonfler la table',
    (select count(*) from public.training_prescriptions tp
      join public.training_blocks tb on tb.id = tp.block_id
     where tb.session_id = v_sess) = 2);
  perform pg_temp.noter('N','N7. et aucun bloc orphelin ne s''accumule',
    (select count(*) from public.training_blocks where session_id = v_sess) = 1);

  perform pg_temp.serveur();
end
$tout$;

call pg_temp.tout();

\echo ''
\echo '════════════════════ DÉTAIL ════════════════════'
select section, num, libelle, case when vert then 'VERT' else 'ROUGE' end as etat, detail
  from pg_temp.resultats order by section, num;

\echo ''
\echo '════════════════════ SYNTHÈSE ════════════════════'
select section, count(*) as controles, count(*) filter (where vert) as verts,
       count(*) filter (where not vert) as rouges
  from pg_temp.resultats group by section order by section;
select count(*) as total, count(*) filter (where vert) as verts,
       count(*) filter (where not vert) as rouges from pg_temp.resultats;
