-- ============================================================================
-- CHECKLIST — ENREGISTREMENT GROUPÉ ET ATOMIQUE D'UNE PROGRAMMATION.
-- `public.save_training_program_sessions(jsonb)` — migration 20261027090000.
-- Base LOCALE uniquement. Chaque section se nettoie derrière elle.
-- ============================================================================
--
-- CE QUE CETTE CHECKLIST PROUVE, ET QUI NE PEUT PAS L'ÊTRE EN TYPESCRIPT :
-- l'atomicité réelle, la RLS réelle, l'isolation réelle entre coachs, la
-- préservation réelle des identifiants. Un test d'application avec un client
-- factice mesure le nombre de requêtes ; seul PostgreSQL prouve ce qui a été
-- écrit, et ce qui ne l'a pas été.
--
-- Lancement :
--   psql -d <base_locale> -f supabase/tests/save_training_program_sessions_checklist.sql
-- ============================================================================
\set ON_ERROR_STOP on
\timing off
set client_min_messages = warning;

create temporary table resultats (
  section text, numero int, intitule text, attendu text, obtenu text, vert boolean
);
-- La section I enregistre ses contrôles SANS repasser en `postgres` entre
-- chaque (elle enchaîne huit refus sous la même identité) : la table doit donc
-- être écrivable par `authenticated`. Table TEMPORAIRE, détruite à la
-- déconnexion — aucune portée au-delà de cette session psql.
grant all on resultats to authenticated;

-- ⚠️ LES BOOLÉENS SONT NORMALISÉS, ET C'EST UNE LEÇON DE LA PREMIÈRE PASSE.
-- `boolean::text` rend « true »/« false » en PostgreSQL, alors que la saisie
-- littérale d'un booléen s'écrit « t »/« f ». Comparer les deux formes brutes
-- faisait rougir 25 contrôles PARFAITEMENT CORRECTS — un faux rouge coûte la
-- confiance dans toute la checklist, et le temps passé à chercher un bug qui
-- n'existe pas. Les deux formes sont donc ramenées à une seule avant
-- comparaison, des DEUX côtés.
create or replace function pg_temp.norm(p text) returns text language sql immutable as $$
  select case lower(coalesce(p,'(null)'))
           when 'true' then 't' when 'false' then 'f'
           else coalesce(p,'(null)') end;
$$;

create or replace function pg_temp.verifier(
  p_section text, p_numero int, p_intitule text, p_attendu text, p_obtenu text
) returns void language plpgsql as $$
begin
  insert into resultats values (p_section, p_numero, p_intitule, p_attendu, p_obtenu,
    pg_temp.norm(p_attendu) is not distinct from pg_temp.norm(p_obtenu));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- DÉCOR — deux coachs, deux programmations, pour que l'isolation soit testable
-- ════════════════════════════════════════════════════════════════════════════
create or replace function pg_temp.poser_decor() returns void language plpgsql as $$
begin
  delete from public.programs where id in (
    '0a000000-0000-4000-8000-000000000001',
    '0a000000-0000-4000-8000-000000000002');
  delete from public.coaches where id in (
    '0c000000-0000-4000-8000-000000000001',
    '0c000000-0000-4000-8000-000000000002');
  delete from public.profiles where id in (
    '0b000000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-000000000002');
  delete from auth.users where id in (
    '0b000000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-000000000002');

  insert into auth.users (id, email) values
    ('0b000000-0000-4000-8000-000000000001', 'alice@test.local'),
    ('0b000000-0000-4000-8000-000000000002', 'bruno@test.local');

  -- Alice est ADMIN (donc staff global) ; Bruno est un second staff admin : les
  -- deux peuvent écrire, et c'est exactement ce qui rend le test d'isolation
  -- intéressant — l'un ne doit pas pouvoir toucher la programmation de l'autre
  -- par la seule vertu de la RPC groupée.
  insert into public.profiles (id, user_id, email, role, first_name, last_name, phone) values
    ('0b000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-000000000001','alice@test.local','admin','Alice','T',''),
    ('0b000000-0000-4000-8000-000000000002','0b000000-0000-4000-8000-000000000002','bruno@test.local','coach','Bruno','T','');

  insert into public.coaches (id, user_id, name, role, status, specialty, email) values
    ('0c000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-000000000001','Alice','admin','actif','muscu','alice@test.local'),
    ('0c000000-0000-4000-8000-000000000002','0b000000-0000-4000-8000-000000000002','Bruno','assistant','actif','muscu','bruno@test.local');

  insert into public.programs (id, coach_id, name, goal, level, duration_weeks, status, publication_status) values
    ('0a000000-0000-4000-8000-000000000001','0c000000-0000-4000-8000-000000000001','Programme Alice','hyper','inter',2,'actif','published'),
    ('0a000000-0000-4000-8000-000000000002','0c000000-0000-4000-8000-000000000002','Programme Bruno','hyper','inter',2,'actif','published');

  -- Deux semaines × 2 jours sur la programmation d'Alice.
  insert into public.program_weeks (id, program_id, week_number) values
    ('0d000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001',1),
    ('0d000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001',2);

  insert into public.workout_sessions
    (id, program_id, program_week_id, day, is_rest_day, name, muscle_group, duration_minutes, warmup, coach_notes, session_type)
  values
    ('0e000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000001','lundi',false,'S1','haut',60,'ech','notes','strength'),
    ('0e000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000001','mardi',true,'Repos','',60,'','','strength'),
    ('0e000000-0000-4000-8000-000000000003','0a000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-000000000002','lundi',false,'S2','bas',60,'ech','notes','strength');

  insert into public.training_blocks (id, session_id, block_type, title, color_key, position) values
    ('0f000000-0000-4000-8000-000000000001','0e000000-0000-4000-8000-000000000001','strength','Bloc A','blue',0),
    ('0f000000-0000-4000-8000-000000000003','0e000000-0000-4000-8000-000000000003','strength','Bloc C','blue',0);

  insert into public.workout_exercises
    (id, session_id, block_id, order_index, name, sets, reps, rest_seconds, tempo, recommended_load, video_url, notes)
  values
    ('10000000-0000-4000-8000-000000000001','0e000000-0000-4000-8000-000000000001','0f000000-0000-4000-8000-000000000001',0,'Squat',4,'8',90,'','','',''),
    ('10000000-0000-4000-8000-000000000002','0e000000-0000-4000-8000-000000000001','0f000000-0000-4000-8000-000000000001',1,'Presse',3,'10',60,'','','',''),
    ('10000000-0000-4000-8000-000000000003','0e000000-0000-4000-8000-000000000003','0f000000-0000-4000-8000-000000000003',0,'Tirage',4,'8',90,'','','','');

  -- Un retour élève rattaché à un exercice : il doit SURVIVRE aux
  -- enregistrements qui ne touchent pas cet exercice.
  insert into public.program_weeks (id, program_id, week_number) values
    ('0d000000-0000-4000-8000-000000000003','0a000000-0000-4000-8000-000000000002',1);
end $$;

create or replace function pg_temp.devenir(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', false);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, false);
end $$;

create or replace function pg_temp.redevenir_postgres() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  reset role;
end $$;

-- Construit une charge « modifier une séance » minimale et correcte.
create or replace function pg_temp.charge_modif(
  p_program uuid, p_session uuid, p_nom text
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'program_id', p_program,
    'sessions_to_update', jsonb_build_array(jsonb_build_object(
      'session_id', p_session,
      'expected_updated_at', (select updated_at::text from public.workout_sessions where id = p_session),
      'blocks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', tb.id::text, 'category', 'strength', 'title', tb.title,
          'color_key', tb.color_key, 'position', tb.position,
          'exercises', coalesce((select jsonb_agg(jsonb_build_object(
              'id', we.id::text, 'name', we.name, 'sets', we.sets, 'reps', we.reps,
              'rest_seconds', we.rest_seconds, 'tempo', we.tempo,
              'recommended_load', we.recommended_load, 'recommended_rpe', '',
              'video_url', we.video_url, 'notes', we.notes,
              'muscle_group', we.muscle_group, 'exercise_library_id', null)
            order by we.order_index)
            from public.workout_exercises we where we.block_id = tb.id), '[]'::jsonb))
        order by tb.position)
        from public.training_blocks tb where tb.session_id = p_session), '[]'::jsonb),
      'session_patch', jsonb_build_object('name', p_nom)
    ))
  );
$$;

select pg_temp.poser_decor();

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION A — LE CATALOGUE : la fonction est ce qu'elle prétend être
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.verifier('A', 1, 'la fonction groupée existe', '1',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_training_program_sessions'));

select pg_temp.verifier('A', 2, 'elle est SECURITY INVOKER (la RLS s''applique)', 'f',
  (select p.prosecdef::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_training_program_sessions'));

select pg_temp.verifier('A', 3, 'search_path figé', 't',
  (select (array_to_string(p.proconfig,',') like 'search_path=%')::text
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_training_program_sessions'));

select pg_temp.verifier('A', 4, 'NON exécutable par anon', 'f',
  has_function_privilege('anon','public.save_training_program_sessions(jsonb)','execute')::text);

select pg_temp.verifier('A', 5, 'NON exécutable par public', 'f',
  has_function_privilege('public','public.save_training_program_sessions(jsonb)','execute')::text);

select pg_temp.verifier('A', 6, 'exécutable par authenticated', 't',
  has_function_privilege('authenticated','public.save_training_program_sessions(jsonb)','execute')::text);

select pg_temp.verifier('A', 7, 'le moteur par séance est intact et INVOKER', 'f',
  (select p.prosecdef::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_training_session_blocks'));

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION B — LES INDEX DU LOT A
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.verifier('B', 1, 'workout_exercises(session_id) indexé, non partiel', '1',
  (select count(*)::text from pg_index ix
     join pg_class i on i.oid=ix.indexrelid
     join pg_class c on c.oid=ix.indrelid
     join pg_attribute a on a.attrelid=c.oid and a.attnum=(ix.indkey::int2[])[0]
    where c.relname='workout_exercises' and a.attname='session_id' and ix.indpred is null));

select pg_temp.verifier('B', 2, 'workout_sessions(program_week_id) indexé, non partiel', '1',
  (select count(*)::text from pg_index ix
     join pg_class c on c.oid=ix.indrelid
     join pg_attribute a on a.attrelid=c.oid and a.attnum=(ix.indkey::int2[])[0]
    where c.relname='workout_sessions' and a.attname='program_week_id' and ix.indpred is null));

select pg_temp.verifier('B', 3, 'workout_sessions(program_id) indexé NON PARTIEL', '1',
  (select count(*)::text from pg_index ix
     join pg_class c on c.oid=ix.indrelid
     join pg_attribute a on a.attrelid=c.oid and a.attnum=(ix.indkey::int2[])[0]
    where c.relname='workout_sessions' and a.attname='program_id' and ix.indpred is null));

select pg_temp.verifier('B', 4, 'l''index partiel du calendrier est CONSERVÉ', '1',
  (select count(*)::text from pg_class where relname='workout_sessions_scheduled_date_idx'));

select pg_temp.verifier('B', 5, 'plus aucune FK visée sans index utilisable', '0',
  (select count(*)::text
     from pg_constraint con
     join unnest(con.conkey) k(attnum) on true
     join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.attnum
    where con.contype='f'
      and con.conname in ('workout_exercises_session_id_fkey','workout_sessions_program_week_id_fkey')
      and not exists (select 1 from pg_index ix where ix.indrelid=con.conrelid
                        and ix.indpred is null and (ix.indkey::int2[])[0]=a.attnum)));

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION C — MODIFIER UNE SÉANCE : ce qui change, et SURTOUT ce qui ne change pas
-- ════════════════════════════════════════════════════════════════════════════
do $c$
declare
  v_av_s2 timestamptz; v_av_s3 timestamptz; v_av_prog timestamptz;
  v_ap_s2 timestamptz; v_ap_s3 timestamptz; v_ap_prog timestamptz;
  v_ids_av uuid[]; v_ids_ap uuid[];
  v_res jsonb;
begin
  select updated_at into v_av_s2 from public.workout_sessions where id='0e000000-0000-4000-8000-000000000002';
  select updated_at into v_av_s3 from public.workout_sessions where id='0e000000-0000-4000-8000-000000000003';
  select updated_at into v_av_prog from public.programs where id='0a000000-0000-4000-8000-000000000001';
  select array_agg(id order by id) into v_ids_av from public.workout_exercises
   where session_id='0e000000-0000-4000-8000-000000000001';

  perform pg_temp.devenir('0b000000-0000-4000-8000-000000000001');
  v_res := public.save_training_program_sessions(
    pg_temp.charge_modif('0a000000-0000-4000-8000-000000000001','0e000000-0000-4000-8000-000000000001','S1 renommée'));
  perform pg_temp.redevenir_postgres();

  perform pg_temp.verifier('C', 1, 'le nom de la séance visée est écrit', 'S1 renommée',
    (select name from public.workout_sessions where id='0e000000-0000-4000-8000-000000000001'));

  select array_agg(id order by id) into v_ids_ap from public.workout_exercises
   where session_id='0e000000-0000-4000-8000-000000000001';
  perform pg_temp.verifier('C', 2, 'les ids d''exercices de la séance visée sont PRÉSERVÉS',
    v_ids_av::text, v_ids_ap::text);

  -- ⚠️ LE CŒUR DU LOT B. Les séances NON déclarées modifiées ne doivent pas
  -- être touchées : ni leur contenu, ni leur `updated_at`. C'est ce qui fait
  -- passer un changement de nom de 84 écritures à une seule, et ce qui évite
  -- de réveiller 84 fois l'abonnement Realtime des élèves.
  select updated_at into v_ap_s2 from public.workout_sessions where id='0e000000-0000-4000-8000-000000000002';
  select updated_at into v_ap_s3 from public.workout_sessions where id='0e000000-0000-4000-8000-000000000003';
  perform pg_temp.verifier('C', 3, 'séance NON déclarée : updated_at INCHANGÉ (repos)',
    v_av_s2::text, v_ap_s2::text);
  perform pg_temp.verifier('C', 4, 'séance NON déclarée : updated_at INCHANGÉ (autre semaine)',
    v_av_s3::text, v_ap_s3::text);
  perform pg_temp.verifier('C', 5, 'séance NON déclarée : son exercice est toujours là', '1',
    (select count(*)::text from public.workout_exercises where id='10000000-0000-4000-8000-000000000003'));

  -- Sans program_patch, la tête ne bouge pas.
  select updated_at into v_ap_prog from public.programs where id='0a000000-0000-4000-8000-000000000001';
  perform pg_temp.verifier('C', 6, 'sans program_patch, programs.updated_at INCHANGÉ',
    v_av_prog::text, v_ap_prog::text);

  perform pg_temp.verifier('C', 7, 'le compte rendu annonce 1 séance traitée', '1',
    (v_res->>'session_count'));
  perform pg_temp.verifier('C', 8, 'il rend le nouvel updated_at de la séance', 't',
    ((v_res->'sessions'->0->>'updated_at') is not null)::text);
end $c$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION D — AJOUTER UNE SEMAINE : création de semaine + séances, en un appel
-- ════════════════════════════════════════════════════════════════════════════
do $d$
declare v_res jsonb; v_n int; v_av_s1 timestamptz;
begin
  select updated_at into v_av_s1 from public.workout_sessions where id='0e000000-0000-4000-8000-000000000001';

  perform pg_temp.devenir('0b000000-0000-4000-8000-000000000001');
  v_res := public.save_training_program_sessions(jsonb_build_object(
    'program_id','0a000000-0000-4000-8000-000000000001',
    'program_patch', jsonb_build_object('duration_weeks', 3),
    'weeks_to_create', jsonb_build_array(3),
    'sessions_to_create', jsonb_build_array(
      jsonb_build_object('client_id','sess-a','week_number',3,'day','lundi','name','Neuve A',
        'muscle_group','haut','duration_minutes',45,'warmup','','coach_notes','','is_rest_day',false,
        'blocks', jsonb_build_array(jsonb_build_object(
          'id','new-block:11111111-1111-4111-8111-111111111111','category','strength',
          'title','Bloc neuf','color_key','blue','position',0,
          'exercises', jsonb_build_array(jsonb_build_object(
            'id','new-exercise:22222222-2222-4222-8222-222222222222','name','Développé',
            'sets',4,'reps','8','rest_seconds',90,'tempo','','recommended_load','',
            'recommended_rpe','','video_url','','notes','','muscle_group',null,
            'exercise_library_id',null))))),
      jsonb_build_object('client_id','sess-b','week_number',3,'day','mardi','name','Repos',
        'muscle_group','','duration_minutes',null,'warmup','','coach_notes','','is_rest_day',true,
        'blocks', jsonb_build_array()))
  ));
  perform pg_temp.redevenir_postgres();

  perform pg_temp.verifier('D', 1, 'la semaine 3 existe', '1',
    (select count(*)::text from public.program_weeks
      where program_id='0a000000-0000-4000-8000-000000000001' and week_number=3));

  perform pg_temp.verifier('D', 2, 'ses deux séances existent', '2',
    (select count(*)::text from public.workout_sessions ws
       join public.program_weeks pw on pw.id=ws.program_week_id
      where pw.program_id='0a000000-0000-4000-8000-000000000001' and pw.week_number=3));

  perform pg_temp.verifier('D', 3, 'l''exercice de la séance neuve est écrit', '1',
    (select count(*)::text from public.workout_exercises we
       join public.workout_sessions ws on ws.id=we.session_id
       join public.program_weeks pw on pw.id=ws.program_week_id
      where pw.program_id='0a000000-0000-4000-8000-000000000001' and pw.week_number=3));

  perform pg_temp.verifier('D', 4, 'le jour de repos est marqué is_rest_day', 't',
    (select is_rest_day::text from public.workout_sessions ws
       join public.program_weeks pw on pw.id=ws.program_week_id
      where pw.program_id='0a000000-0000-4000-8000-000000000001' and pw.week_number=3
        and ws.day='mardi'));

  perform pg_temp.verifier('D', 5, 'duration_weeks mis à jour par le patch', '3',
    (select duration_weeks::text from public.programs where id='0a000000-0000-4000-8000-000000000001'));

  -- ⚠️ AJOUTER UNE SEMAINE NE TOUCHE PAS LES SEMAINES EXISTANTES. C'était
  -- précisément le scénario qui échouait : 100 requêtes séquentielles dont 84
  -- réécrivaient des séances inchangées.
  perform pg_temp.verifier('D', 6, 'les séances des semaines 1-2 sont INTACTES',
    v_av_s1::text,
    (select updated_at::text from public.workout_sessions where id='0e000000-0000-4000-8000-000000000001'));

  perform pg_temp.verifier('D', 7, 'le compte rendu rend l''id de la semaine créée', 't',
    ((v_res->'weeks'->>'3') is not null)::text);

  perform pg_temp.verifier('D', 8, 'il réconcilie les client_id des séances créées', 't',
    (select (count(*) = 2)::text from jsonb_array_elements(v_res->'sessions') e
      where e->>'client_id' in ('sess-a','sess-b')));

  -- id_mapping : les identifiants temporaires ont reçu de vrais UUID.
  select count(*) into v_n from jsonb_array_elements(v_res->'sessions') e
   where (e->'id_mapping'->'exercises') ? 'new-exercise:22222222-2222-4222-8222-222222222222';
  perform pg_temp.verifier('D', 9, 'id_mapping traduit l''identifiant temporaire d''exercice', '1', v_n::text);
end $d$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION E — ATOMICITÉ : un échec en milieu de charge n'écrit RIEN
-- ════════════════════════════════════════════════════════════════════════════
do $e$
declare
  v_av_nom text; v_av_prog_nom text; v_echec text := '(aucune erreur)';
begin
  select name into v_av_nom from public.workout_sessions where id='0e000000-0000-4000-8000-000000000001';
  select name into v_av_prog_nom from public.programs where id='0a000000-0000-4000-8000-000000000001';

  perform pg_temp.devenir('0b000000-0000-4000-8000-000000000001');
  begin
    -- Charge VALIDE pour la 1re séance, INVALIDE pour la 2e (verrou périmé).
    -- La 1re est traitée AVANT que la 2e échoue : c'est le cas qui, dans
    -- l'ancien chemin, laissait la 1re commise et l'enregistrement en erreur.
    perform public.save_training_program_sessions(jsonb_build_object(
      'program_id','0a000000-0000-4000-8000-000000000001',
      'program_patch', jsonb_build_object('name','Nom qui ne doit PAS rester'),
      'sessions_to_update', jsonb_build_array(
        jsonb_build_object(
          'session_id','0e000000-0000-4000-8000-000000000001',
          'expected_updated_at',(select updated_at::text from public.workout_sessions where id='0e000000-0000-4000-8000-000000000001'),
          'blocks', jsonb_build_array(),
          'session_patch', jsonb_build_object('name','Écriture à annuler')),
        jsonb_build_object(
          'session_id','0e000000-0000-4000-8000-000000000003',
          'expected_updated_at','1999-01-01T00:00:00Z',
          'blocks', jsonb_build_array(),
          'session_patch', jsonb_build_object('name','Jamais écrit')))
    ));
  exception when others then
    v_echec := sqlerrm;
  end;
  perform pg_temp.redevenir_postgres();

  perform pg_temp.verifier('E', 1, 'l''appel échoue', 't',
    (v_echec <> '(aucune erreur)')::text);
  perform pg_temp.verifier('E', 2, 'l''erreur nomme la séance fautive', 't',
    (v_echec like '%SESSION_FAILED%0e000000-0000-4000-8000-000000000003%')::text);
  perform pg_temp.verifier('E', 3, 'elle conserve la cause du moteur (STALE)', 't',
    (v_echec like '%STALE_TRAINING_SESSION%')::text);

  -- ⚠️ LES TROIS CONTRÔLES QUI JUSTIFIENT TOUT LE LOT B.
  perform pg_temp.verifier('E', 4, 'la séance traitée AVANT l''échec n''a PAS été écrite',
    v_av_nom, (select name from public.workout_sessions where id='0e000000-0000-4000-8000-000000000001'));
  perform pg_temp.verifier('E', 5, 'la tête du programme n''a PAS été écrite',
    v_av_prog_nom, (select name from public.programs where id='0a000000-0000-4000-8000-000000000001'));
  perform pg_temp.verifier('E', 6, 'ses blocs n''ont PAS été supprimés (charge blocks vide)', '1',
    (select count(*)::text from public.training_blocks where session_id='0e000000-0000-4000-8000-000000000001'));
  perform pg_temp.verifier('E', 7, 'ses exercices n''ont PAS été supprimés', '2',
    (select count(*)::text from public.workout_exercises where session_id='0e000000-0000-4000-8000-000000000001'));
end $e$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION F — REJOUER LA MÊME CHARGE : pas de doublon, refus net
-- ════════════════════════════════════════════════════════════════════════════
do $f$
declare v_charge jsonb; v_echec text := '(aucune)'; v_n_av int; v_n_ap int;
begin
  select count(*) into v_n_av from public.workout_exercises where session_id='0e000000-0000-4000-8000-000000000001';
  v_charge := pg_temp.charge_modif('0a000000-0000-4000-8000-000000000001','0e000000-0000-4000-8000-000000000001','Rejoué');

  perform pg_temp.devenir('0b000000-0000-4000-8000-000000000001');
  perform public.save_training_program_sessions(v_charge);   -- 1er passage : OK
  begin
    perform public.save_training_program_sessions(v_charge); -- 2e : verrou périmé
  exception when others then v_echec := sqlerrm;
  end;
  perform pg_temp.redevenir_postgres();

  perform pg_temp.verifier('F', 1, 'le 1er passage a écrit', 'Rejoué',
    (select name from public.workout_sessions where id='0e000000-0000-4000-8000-000000000001'));
  perform pg_temp.verifier('F', 2, 'le 2e passage est REFUSÉ (verrou optimiste)', 't',
    (v_echec like '%STALE_TRAINING_SESSION%')::text);

  select count(*) into v_n_ap from public.workout_exercises where session_id='0e000000-0000-4000-8000-000000000001';
  perform pg_temp.verifier('F', 3, 'aucun exercice dupliqué par le rejeu', v_n_av::text, v_n_ap::text);
end $f$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION G — VERROU DE TÊTE : le conflit concurrent ne passe plus en silence
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare v_echec text := '(aucune)';
begin
  perform pg_temp.devenir('0b000000-0000-4000-8000-000000000001');
  begin
    perform public.save_training_program_sessions(jsonb_build_object(
      'program_id','0a000000-0000-4000-8000-000000000001',
      'expected_program_updated_at','1999-01-01T00:00:00Z',
      'program_patch', jsonb_build_object('name','Écrasement interdit')));
  exception when others then v_echec := sqlerrm;
  end;
  perform pg_temp.redevenir_postgres();

  perform pg_temp.verifier('G', 1, 'tête périmée = STALE_TRAINING_PROGRAM', 't',
    (v_echec like '%STALE_TRAINING_PROGRAM%')::text);
  perform pg_temp.verifier('G', 2, 'et le nom n''a PAS été écrasé', 'f',
    (select (name = 'Écrasement interdit')::text from public.programs where id='0a000000-0000-4000-8000-000000000001'));

  -- Avec le BON verrou, l'écriture passe.
  perform pg_temp.devenir('0b000000-0000-4000-8000-000000000001');
  perform public.save_training_program_sessions(jsonb_build_object(
    'program_id','0a000000-0000-4000-8000-000000000001',
    'expected_program_updated_at',(select updated_at::text from public.programs where id='0a000000-0000-4000-8000-000000000001'),
    'program_patch', jsonb_build_object('name','Nom accepté')));
  perform pg_temp.redevenir_postgres();
  perform pg_temp.verifier('G', 3, 'avec le bon verrou, la tête s''écrit', 'Nom accepté',
    (select name from public.programs where id='0a000000-0000-4000-8000-000000000001'));
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION H — ISOLATION : un coach hors périmètre ne peut RIEN
-- ════════════════════════════════════════════════════════════════════════════
do $h$
declare v_echec text := '(aucune)'; v_nom_av text; v_verrou_alice text;
begin
  -- Bruno est `assistant` : staff global, donc il VOIT. On vérifie ici le cas
  -- qui compte vraiment — un appelant qui n'est NI coach NI admin.
  select name into v_nom_av from public.programs where id='0a000000-0000-4000-8000-000000000001';

  -- Un utilisateur authentifié SANS fiche staff.
  delete from public.profiles where id='0b000000-0000-4000-8000-000000000003';
  delete from auth.users where id='0b000000-0000-4000-8000-000000000003';
  insert into auth.users (id, email) values ('0b000000-0000-4000-8000-000000000003','eleve@test.local');
  insert into public.profiles (id, user_id, email, role, first_name, last_name, phone)
  values ('0b000000-0000-4000-8000-000000000003','0b000000-0000-4000-8000-000000000003','eleve@test.local','student','E','T','');

  perform pg_temp.devenir('0b000000-0000-4000-8000-000000000003');
  begin
    perform public.save_training_program_sessions(jsonb_build_object(
      'program_id','0a000000-0000-4000-8000-000000000001',
      'program_patch', jsonb_build_object('name','Pris par un élève')));
  exception when others then v_echec := sqlerrm;
  end;
  perform pg_temp.redevenir_postgres();

  perform pg_temp.verifier('H', 1, 'un non-staff est refusé', 't',
    (v_echec like '%NOT_AUTHORIZED%')::text);
  perform pg_temp.verifier('H', 2, 'et rien n''a été écrit', v_nom_av,
    (select name from public.programs where id='0a000000-0000-4000-8000-000000000001'));

  -- ⚠️ LE BORNAGE AU PROGRAMME. Bruno est staff global : la RLS l'autorise sur
  -- les deux programmations. Seule la vérification explicite de l'étape 9
  -- empêche une charge de détourner le moteur vers une séance d'un AUTRE
  -- programme que celui annoncé.
  /*
   * ⚠️ LE VERROU EST LU AVANT DE CHANGER D'IDENTITÉ, et c'est ce qui rend ce
   * contrôle honnête. Lu SOUS l'identité de Bruno, le `updated_at` d'une séance
   * d'Alice rend NULL (sa RLS la masque) et la RPC refuse sur
   * « expected_updated_at manquant » — un refus, oui, mais pas celui qu'on
   * teste. Le scénario réel est un appelant qui a obtenu cette valeur
   * AILLEURS et la rejoue : on la lui donne, et on vérifie que le bornage au
   * programme l'arrête quand même.
   */
  select updated_at::text into v_verrou_alice
    from public.workout_sessions where id='0e000000-0000-4000-8000-000000000001';

  v_echec := '(aucune)';
  perform pg_temp.devenir('0b000000-0000-4000-8000-000000000002');
  begin
    perform public.save_training_program_sessions(jsonb_build_object(
      'program_id','0a000000-0000-4000-8000-000000000002',
      'sessions_to_update', jsonb_build_array(jsonb_build_object(
        'session_id','0e000000-0000-4000-8000-000000000001',
        'expected_updated_at', v_verrou_alice,
        'blocks', jsonb_build_array(),
        'session_patch', jsonb_build_object('name','Détournement')))));
  exception when others then v_echec := sqlerrm;
  end;
  perform pg_temp.redevenir_postgres();

  perform pg_temp.verifier('H', 3, 'une séance d''un AUTRE programme est refusée', 't',
    (v_echec like '%absente de ce programme%')::text);
  perform pg_temp.verifier('H', 4, 'et sa séance est intacte', 'f',
    (select (name='Détournement')::text from public.workout_sessions where id='0e000000-0000-4000-8000-000000000001'));

  -- Suppression bornée elle aussi : la séance d'Alice n'est pas supprimable
  -- via une charge qui annonce le programme de Bruno.
  perform pg_temp.devenir('0b000000-0000-4000-8000-000000000002');
  perform public.save_training_program_sessions(jsonb_build_object(
    'program_id','0a000000-0000-4000-8000-000000000002',
    'sessions_to_delete', jsonb_build_array('0e000000-0000-4000-8000-000000000001')));
  perform pg_temp.redevenir_postgres();
  perform pg_temp.verifier('H', 5, 'la suppression est bornée au programme annoncé', '1',
    (select count(*)::text from public.workout_sessions where id='0e000000-0000-4000-8000-000000000001'));
end $h$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION I — CHARGE INVALIDE : refus net, nommé, sans écriture
-- ════════════════════════════════════════════════════════════════════════════
do $i$
declare v_e text;
begin
  perform pg_temp.devenir('0b000000-0000-4000-8000-000000000001');

  v_e := '(aucune)';
  begin perform public.save_training_program_sessions('{}'::jsonb);
  exception when others then v_e := sqlerrm; end;
  perform pg_temp.verifier('I', 1, 'program_id manquant refusé', 't',
    (v_e like '%INVALID_PAYLOAD: program_id manquant%')::text);

  v_e := '(aucune)';
  begin perform public.save_training_program_sessions(
    jsonb_build_object('program_id','pas-un-uuid'));
  exception when others then v_e := sqlerrm; end;
  perform pg_temp.verifier('I', 2, 'program_id mal formé refusé', 't',
    (v_e like '%INVALID_PAYLOAD%')::text);

  v_e := '(aucune)';
  begin perform public.save_training_program_sessions(jsonb_build_object(
    'program_id','0a000000-0000-4000-8000-000000000001',
    'weeks_to_create','pas-un-tableau'));
  exception when others then v_e := sqlerrm; end;
  perform pg_temp.verifier('I', 3, 'weeks_to_create non tableau refusé', 't',
    (v_e like '%weeks_to_create doit être un tableau%')::text);

  v_e := '(aucune)';
  begin perform public.save_training_program_sessions(jsonb_build_object(
    'program_id','0a000000-0000-4000-8000-000000000001',
    'program_patch', jsonb_build_object('coach_id','0c000000-0000-4000-8000-000000000002')));
  exception when others then v_e := sqlerrm; end;
  perform pg_temp.verifier('I', 4, 'clé de program_patch non autorisée refusée (coach_id)', 't',
    (v_e like '%clé de program_patch non autorisée%')::text);

  v_e := '(aucune)';
  begin perform public.save_training_program_sessions(jsonb_build_object(
    'program_id','0a000000-0000-4000-8000-000000000001',
    'program_patch', jsonb_build_object('owner_student_id','0b000000-0000-4000-8000-000000000003')));
  exception when others then v_e := sqlerrm; end;
  perform pg_temp.verifier('I', 5, 'owner_student_id ne peut PAS être patché', 't',
    (v_e like '%clé de program_patch non autorisée%')::text);

  v_e := '(aucune)';
  begin perform public.save_training_program_sessions(jsonb_build_object(
    'program_id','0a000000-0000-4000-8000-000000000001',
    'sessions_to_update', jsonb_build_array(jsonb_build_object(
      'session_id','0e000000-0000-4000-8000-000000000001',
      'blocks', jsonb_build_array()))));
  exception when others then v_e := sqlerrm; end;
  perform pg_temp.verifier('I', 6, 'expected_updated_at obligatoire en modification', 't',
    (v_e like '%expected_updated_at manquant%')::text);

  v_e := '(aucune)';
  begin perform public.save_training_program_sessions(jsonb_build_object(
    'program_id','0a000000-0000-4000-8000-000000000001',
    'sessions_to_update', jsonb_build_array(jsonb_build_object(
      'session_id','0e000000-0000-4000-8000-000000000001',
      'expected_updated_at',(select updated_at::text from public.workout_sessions where id='0e000000-0000-4000-8000-000000000001'),
      'blocks', jsonb_build_array(jsonb_build_object(
        'id','0f000000-0000-4000-8000-000000000003','category','strength',
        'title','Bloc volé','color_key','blue','position',0,'exercises',jsonb_build_array()))))));
  exception when others then v_e := sqlerrm; end;
  perform pg_temp.verifier('I', 7, 'un bloc d''une AUTRE séance est refusé (FOREIGN_BLOCK_ID)', 't',
    (v_e like '%FOREIGN_BLOCK_ID%')::text);

  -- ⚠️ CAS LÉGITIME QUI ÉCHOUAIT : modifier le contenu d'une séance SANS
  -- toucher ses métadonnées. La clé `session_patch` absente produisait
  -- `{"session_patch": null}` dans la charge interne, que le moteur rejetait.
  v_e := '(aucune)';
  begin perform public.save_training_program_sessions(jsonb_build_object(
    'program_id','0a000000-0000-4000-8000-000000000001',
    'sessions_to_update', jsonb_build_array(jsonb_build_object(
      'session_id','0e000000-0000-4000-8000-000000000002',
      'expected_updated_at',(select updated_at::text from public.workout_sessions where id='0e000000-0000-4000-8000-000000000002'),
      'blocks', jsonb_build_array()))));
  exception when others then v_e := sqlerrm; end;
  perform pg_temp.verifier('I', 9, 'une séance modifiée SANS session_patch est ACCEPTÉE', '(aucune)', v_e);

  v_e := '(aucune)';
  begin perform public.save_training_program_sessions(jsonb_build_object(
    'program_id','00000000-0000-4000-8000-00000000ffff',
    'program_patch', jsonb_build_object('name','x')));
  exception when others then v_e := sqlerrm; end;
  perform pg_temp.verifier('I', 8, 'programme inexistant : PROGRAM_NOT_FOUND_OR_FORBIDDEN', 't',
    (v_e like '%PROGRAM_NOT_FOUND_OR_FORBIDDEN%')::text);

  perform pg_temp.redevenir_postgres();
end $i$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION J — SUPPRESSION EXPLICITE : l'absence NE supprime PLUS
-- ════════════════════════════════════════════════════════════════════════════
do $j$
declare v_n int;
begin
  -- Une charge qui ne nomme AUCUNE séance ne doit rien supprimer, alors que
  -- l'ancien modèle (« absent = à supprimer ») aurait vidé le programme.
  select count(*) into v_n from public.workout_sessions where program_id='0a000000-0000-4000-8000-000000000001';

  perform pg_temp.devenir('0b000000-0000-4000-8000-000000000001');
  perform public.save_training_program_sessions(jsonb_build_object(
    'program_id','0a000000-0000-4000-8000-000000000001',
    'program_patch', jsonb_build_object('description','charge sans aucune séance')));
  perform pg_temp.redevenir_postgres();

  perform pg_temp.verifier('J', 1, 'une charge sans séance ne supprime RIEN', v_n::text,
    (select count(*)::text from public.workout_sessions where program_id='0a000000-0000-4000-8000-000000000001'));

  -- Suppression explicite d'une semaine : la cascade s'applique, et SEULEMENT
  -- à elle.
  perform pg_temp.devenir('0b000000-0000-4000-8000-000000000001');
  perform public.save_training_program_sessions(jsonb_build_object(
    'program_id','0a000000-0000-4000-8000-000000000001',
    'weeks_to_delete', jsonb_build_array(3)));
  perform pg_temp.redevenir_postgres();

  perform pg_temp.verifier('J', 2, 'la semaine 3 nommée est supprimée', '0',
    (select count(*)::text from public.program_weeks
      where program_id='0a000000-0000-4000-8000-000000000001' and week_number=3));
  perform pg_temp.verifier('J', 3, 'les semaines 1 et 2 sont conservées', '2',
    (select count(*)::text from public.program_weeks
      where program_id='0a000000-0000-4000-8000-000000000001' and week_number in (1,2)));
  perform pg_temp.verifier('J', 4, 'la cascade a emporté les séances de la semaine 3', '0',
    (select count(*)::text from public.workout_sessions ws
      where ws.program_id='0a000000-0000-4000-8000-000000000001'
        and not exists (select 1 from public.program_weeks pw where pw.id=ws.program_week_id)));
  perform pg_temp.verifier('J', 5, 'les séances des semaines 1-2 sont là', '3',
    (select count(*)::text from public.workout_sessions where program_id='0a000000-0000-4000-8000-000000000001'));
end $j$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION K — COMPATIBILITÉ : le moteur par séance marche TOUJOURS seul
-- ════════════════════════════════════════════════════════════════════════════
-- `useCalendrierAthlete` et `lib/supabase/calendrier-seances.ts` l'appellent
-- directement. La RPC groupée ne doit pas l'avoir cassé.
do $k$
declare v_res jsonb;
begin
  perform pg_temp.devenir('0b000000-0000-4000-8000-000000000001');
  v_res := public.save_training_session_blocks(jsonb_build_object(
    'session_id','0e000000-0000-4000-8000-000000000003',
    'expected_updated_at',(select updated_at::text from public.workout_sessions where id='0e000000-0000-4000-8000-000000000003'),
    'blocks', jsonb_build_array(),
    'session_patch', jsonb_build_object('name','Via le moteur seul')));
  perform pg_temp.redevenir_postgres();

  perform pg_temp.verifier('K', 1, 'le moteur par séance écrit toujours', 'Via le moteur seul',
    (select name from public.workout_sessions where id='0e000000-0000-4000-8000-000000000003'));
  perform pg_temp.verifier('K', 2, 'et rend son contrat inchangé (updated_at)', 't',
    ((v_res->>'updated_at') is not null)::text);
  perform pg_temp.verifier('K', 3, 'blocks vide = séance de repos dérivée', 'rest',
    (v_res->>'session_type'));
end $k$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION L — ÉQUIVALENCE DES PRÉDICATS RLS (lot C), SUR DES DONNÉES
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ LA MIGRATION 20261028090000 PORTE DÉJÀ CETTE PREUVE, mais elle s'exécute
-- au moment de l'application — donc, sur une base reconstruite à vide, sur ZÉRO
-- ligne. Une preuve qui ne compare rien ne prouve rien. On la rejoue ici, sur
-- le décor de cette checklist, pour chaque identité qu'il contient.
--
-- Le verdict de l'ancien ensemble et celui du nouveau prédicat doivent coïncider
-- sur CHAQUE ligne. Un seul désaccord est une faille ou un blocage, jamais un
-- détail.
do $l$
declare
  v_id record; v_d int; v_total bigint := 0; v_identites int := 0;
begin
  for v_id in
    select distinct u as user_id from (
      select user_id as u from public.coaches where user_id is not null
      union select user_id from public.profiles where user_id is not null
      union select null::uuid
    ) q
  loop
    v_identites := v_identites + 1;
    if v_id.user_id is null then
      perform set_config('request.jwt.claims', '{}', true);
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_id.user_id::text, 'role', 'authenticated')::text, true);
    end if;

    select count(*) into v_d from public.programs p
     where (p.id in (select public.program_ids_ecriture())) is distinct from public.programme_ecrivable(p.id)
        or (p.id in (select public.program_ids_lecture()))  is distinct from public.programme_lisible(p.id);
    if v_d > 0 then raise exception 'programs : % désaccord(s) pour %', v_d, coalesce(v_id.user_id::text,'(anonyme)'); end if;

    select count(*) into v_d from public.workout_sessions ws
     where (ws.id in (select public.workout_session_ids_ecriture())) is distinct from public.seance_ecrivable(ws.id)
        or (ws.id in (select public.workout_session_ids_lecture()))  is distinct from public.seance_lisible(ws.id);
    if v_d > 0 then raise exception 'workout_sessions : % désaccord(s) pour %', v_d, coalesce(v_id.user_id::text,'(anonyme)'); end if;

    select count(*) into v_d from public.training_blocks tb
     where (tb.id in (select public.training_block_ids_ecriture())) is distinct from public.bloc_entrainement_ecrivable(tb.id)
        or (tb.id in (select public.training_block_ids_lecture()))  is distinct from public.bloc_entrainement_lisible(tb.id);
    if v_d > 0 then raise exception 'training_blocks : % désaccord(s) pour %', v_d, coalesce(v_id.user_id::text,'(anonyme)'); end if;

    select count(*) into v_d from public.workout_exercises we
     where ( (we.session_id in (select public.workout_session_ids_ecriture()))
             or (we.block_id in (select public.training_block_ids_ecriture())) )
           is distinct from public.exercice_ecrivable(we.session_id, we.block_id)
        or ( (we.session_id in (select public.workout_session_ids_lecture()))
             or (we.block_id in (select public.training_block_ids_lecture())) )
           is distinct from public.exercice_lisible(we.session_id, we.block_id)
        or (we.id in (select public.workout_exercise_ids_ecriture()))
           is distinct from public.exercice_ecrivable_par_id(we.id);
    if v_d > 0 then raise exception 'workout_exercises : % désaccord(s) pour %', v_d, coalesce(v_id.user_id::text,'(anonyme)'); end if;

    select v_total + (select count(*) from public.programs)
                   + (select count(*) from public.workout_sessions)
                   + (select count(*) from public.training_blocks)
                   + (select count(*) from public.workout_exercises) into v_total;
  end loop;
  perform set_config('request.jwt.claims', '{}', true);

  perform pg_temp.verifier('L', 1, 'équivalence prédicats/ensembles : aucun désaccord', 'f',
    (v_total = 0)::text);
  perform pg_temp.verifier('L', 2, 'la preuve a porté sur plusieurs identités', 't',
    (v_identites >= 2)::text);
  raise notice 'SECTION L — % identité(s) × % comparaison(s) de ligne, 0 désaccord', v_identites, v_total;
end $l$;

-- ════════════════════════════════════════════════════════════════════════════
-- RÉSULTATS
-- ════════════════════════════════════════════════════════════════════════════
\echo ''
\echo '════════════════════ DÉTAIL PAR CONTRÔLE ════════════════════'
select section, numero, intitule,
       case when vert then 'VERT' else 'ROUGE' end as etat,
       case when vert then '' else 'attendu=' || coalesce(attendu,'(null)') || ' obtenu=' || coalesce(obtenu,'(null)') end as ecart
  from resultats order by section, numero;

\echo ''
\echo '════════════════════ SYNTHÈSE ════════════════════'
select section, count(*) as controles,
       count(*) filter (where vert) as verts,
       count(*) filter (where not vert) as rouges
  from resultats group by section order by section;

select count(*) as total, count(*) filter (where vert) as verts,
       count(*) filter (where not vert) as rouges
  from resultats;

do $fin$
declare v_r int;
begin
  select count(*) into v_r from resultats where not vert;
  if v_r > 0 then
    raise exception '% contrôle(s) ROUGE(S) — voir le détail ci-dessus', v_r;
  end if;
  raise notice 'TOUS LES CONTRÔLES SONT VERTS';
end $fin$;
