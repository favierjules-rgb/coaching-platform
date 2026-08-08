-- ============================================================================
-- Checklist PostgreSQL — F3 : PATTERNS DE MOUVEMENT, REMPLACEMENT D'EXERCICE
-- ET RETOUR DE SÉANCE SERVEUR-AUTORITAIRE
-- (migrations 20260820090000 et 20260821090000)
--
-- LES QUESTIONS POSÉES, ET SEULEMENT CELLES-LÀ
--   1. « Un élève peut-il fabriquer lui-même la photographie du PRESCRIT ? »
--      — par l'application, par un appel PostgREST direct, à la création
--      comme après coup.
--   2. « Existe-t-il une colonne réservée au coach, dérivée par la base ou
--      immuable, qu'un élève peut encore écrire ? » — l'inventaire est
--      COMPLET : chaque colonne des trois tables de retour est classée puis
--      attaquée.
--   3. « Un élève peut-il polluer le retour d'un autre ? » — y compris en
--      rattachant sa propre ligne au retour de l'autre.
--   4. « Un remplacement peut-il mentir ? » — nom, pattern, statut, séance.
--   5. « La RPC des remplaçants laisse-t-elle énumérer la banque ? »
--
-- COMMENT ELLES SONT POSÉES
--   En EXÉCUTANT des écritures sous le rôle `authenticated`, avec les claims
--   JWT de CINQ acteurs : élève A, élève B, coach, administrateur, et `anon`.
--   Jamais en relisant des politiques.
--
-- DEUX RÈGLES DE MÉTHODE, APPRISES À LEURS DÉPENS
--   * On mesure la VALEUR, jamais le nombre de lignes. Les gardiens sont des
--     triggers BEFORE : ils restaurent l'ancienne valeur au lieu de refuser
--     la ligne, donc l'UPDATE rapporte « 1 ligne » sans avoir rien changé.
--   * Un verdict NULL est un ÉCHEC. Une comparaison portant sur une ligne
--     que la RLS masque rend NULL, ce qui ressemblerait à un succès. Chaque
--     vérification d'une ligne d'autrui se fait donc HORS du rôle de
--     l'attaquant.
--
-- SECTIONS
--   A. le décor : coach, admin, deux élèves, deux programmes, une banque ;
--   B. le vocabulaire des patterns ;
--   C. la RPC des remplaçants, et ce qu'elle ne laisse pas énumérer ;
--   D. le snapshot du prescrit : serveur-autoritaire, de bout en bout ;
--   E. la matrice de propriété, colonne par colonne, attaquée en PATCH ;
--   F. le remplacement légitime : le nom est DÉRIVÉ ;
--   G. les remplacements refusés — dix façons de tricher ;
--   H. la trace survit à la vie de la banque ;
--   I. cloisonnement inter-élèves sur les trois tables ;
--   J. le coach et l'admin gardent leurs opérations métier ;
--   K. privilèges, durcissement, et `anon` ;
--   M. les métadonnées de séance, dérivées et jamais déclarées ;
--   N. un élève, une séance, un seul retour ;
--   L. rien ne survit au ROLLBACK.
--
-- CE QUE CETTE CHECKLIST NE PEUT PAS FAIRE, ET COMMENT LE VÉRIFIER QUAND MÊME
--   Une vraie COURSE demande deux connexions simultanées ; psql n'en ouvre
--   qu'une. La garantie d'unicité ne vient de toute façon pas d'ici : elle
--   vient de l'index UNIQUE, vérifié par PostgreSQL au moment d'insérer
--   l'entrée d'index, donc atomiquement. Pour l'observer, deux terminaux :
--
--     -- terminal 1
--     begin;
--     insert into public.workout_feedback (student_id, session_id, session_key,
--            session_ref_label, completed)
--     values ('<élève>', '<séance>', 'A', 'A', true);
--     select pg_sleep(5);
--     commit;
--
--     -- terminal 2, pendant le pg_sleep — le MÊME couple (élève, séance)
--     insert into public.workout_feedback (student_id, session_id, session_key,
--            session_ref_label, completed)
--     values ('<élève>', '<séance>', 'B', 'B', true);
--
--   Le terminal 2 BLOQUE sur l'entrée d'index en cours, puis échoue dès que
--   le terminal 1 valide :
--     ERROR: duplicate key value violates unique constraint
--            "workout_feedback_one_per_student_session_uidx"
--   Une seule ligne subsiste. Aucune fenêtre entre SELECT et INSERT n'est
--   exploitable, quelle que soit la couche appelante — c'est pour cela que
--   `saveWorkoutFeedback` n'essaie pas d'empêcher la course, mais de la
--   RATTRAPER (relecture du retour gagnant, puis mise à jour).
--
-- EXÉCUTION (base LOCALE uniquement) :
--   psql -U postgres -d <base_locale> -v ON_ERROR_STOP=1 \
--     -f supabase/tests/training_movement_patterns_checklist.sql
--
-- ⚠️ NE JAMAIS exécuter sur la Production.
-- ============================================================================

\timing off

begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;

do $$
declare s text;
begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._faits to authenticated, anon', s);
end $$;

-- `p_ok is not true` et non `not p_ok` : un verdict NULL — typiquement une
-- comparaison sur une ligne que la RLS a masquée — est un ÉCHEC, jamais un
-- succès silencieux.
create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, coalesce(p_ok, false));
  if p_ok is true then raise notice 'OK      — %', p_libelle;
  else raise warning 'ÉCHEC   — %', p_libelle; end if;
end $$;

-- Un ordre SQL qui DOIT échouer. Le bloc imbriqué joue le rôle d'un
-- SAVEPOINT : sans lui, la première exception avorterait la transaction et
-- toute la suite de la checklist.
create or replace function pg_temp.refuse(p_sql text)
returns boolean language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return true;
  end;
  return false;
end $$;

-- Vraie si l'ordre passe SANS erreur mais SANS rien changer non plus : c'est
-- la signature exacte d'un trigger BEFORE qui restaure l'ancienne valeur.
create or replace function pg_temp.inchange(p_sql text, p_lecture text, p_attendu text)
returns boolean language plpgsql as $$
declare v text; v_erreur boolean;
begin
  v_erreur := pg_temp.refuse(p_sql);
  execute p_lecture into v;
  -- Peu importe que l'ordre ait été refusé (exception) ou neutralisé
  -- (valeur restaurée) : ce qui compte est que la valeur n'ait pas bougé.
  return v is not distinct from p_attendu or (v_erreur and v is not distinct from p_attendu);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- A. LE DÉCOR — cinq acteurs, deux mondes symétriques
-- ════════════════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  ('30000000-0000-4000-8000-000000000001'::uuid, 'f3.coach@test.local'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'f3.eleveA@test.local'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'f3.eleveB@test.local'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'f3.admin@test.local')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('30000000-0000-4000-8000-000000000001'::uuid, 'coach',   'F3Coach', 'T', 'f3.coach@test.local'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'student', 'F3EleveA', 'T', 'f3.eleveA@test.local'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'student', 'F3EleveB', 'T', 'f3.eleveB@test.local'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'admin',   'F3Admin', 'T', 'f3.admin@test.local');

insert into public.coaches (id, user_id, name, email) values
  ('31000000-0000-4000-8000-000000000001'::uuid, '30000000-0000-4000-8000-000000000001'::uuid, 'F3Coach', 'f3.coach@test.local');

insert into public.students (id, user_id, first_name, last_name, email, status, access_type) values
  ('32000000-0000-4000-8000-000000000002'::uuid, '30000000-0000-4000-8000-000000000002'::uuid, 'F3EleveA', 'T', 'f3.eleveA@test.local', 'active', 'coaching'),
  ('32000000-0000-4000-8000-000000000003'::uuid, '30000000-0000-4000-8000-000000000003'::uuid, 'F3EleveB', 'T', 'f3.eleveB@test.local', 'active', 'coaching');

-- La banque : quatre fiches de MÊME pattern « poussée horizontale » (dont
-- une archivée), une fiche d'un AUTRE pattern, et une fiche SANS pattern.
insert into public.exercise_library (id, coach_id, name, muscle_group, movement_pattern, status, video_url) values
  ('33000000-0000-4000-8000-0000000000a1'::uuid, '31000000-0000-4000-8000-000000000001'::uuid,
   'Développé couché barre', 'pectoraux', 'poussee_horizontale', 'active', 'https://v/dc'),
  ('33000000-0000-4000-8000-0000000000a2'::uuid, '31000000-0000-4000-8000-000000000001'::uuid,
   'Développé couché haltères', 'pectoraux', 'poussee_horizontale', 'active', 'https://v/dch'),
  ('33000000-0000-4000-8000-0000000000a3'::uuid, '31000000-0000-4000-8000-000000000001'::uuid,
   'Pompes lestées', 'pectoraux', 'poussee_horizontale', 'active', 'https://v/pl'),
  ('33000000-0000-4000-8000-0000000000a4'::uuid, '31000000-0000-4000-8000-000000000001'::uuid,
   'Développé couché machine (archivé)', 'pectoraux', 'poussee_horizontale', 'archived', ''),
  ('33000000-0000-4000-8000-0000000000b1'::uuid, '31000000-0000-4000-8000-000000000001'::uuid,
   'Squat barre', 'quadriceps', 'squat', 'active', 'https://v/sq'),
  ('33000000-0000-4000-8000-0000000000c1'::uuid, '31000000-0000-4000-8000-000000000001'::uuid,
   'Exercice sans pattern', 'autre', null, 'active', '');

-- DEUX programmes : celui de l'élève A (assigné) et celui de l'élève B.
-- Sans le second, « l'élève A vise la séance de B » ne serait pas testable.
insert into public.programs (id, coach_id, name, status, program_mode) values
  ('34000000-0000-4000-8000-000000000001'::uuid, '31000000-0000-4000-8000-000000000001'::uuid, 'Programme F3 — A', 'actif', 'individuel'),
  ('34000000-0000-4000-8000-000000000002'::uuid, '31000000-0000-4000-8000-000000000001'::uuid, 'Programme F3 — B', 'actif', 'individuel');

insert into public.program_weeks (id, program_id, week_number) values
  ('35000000-0000-4000-8000-000000000001'::uuid, '34000000-0000-4000-8000-000000000001'::uuid, 3),
  ('35000000-0000-4000-8000-000000000002'::uuid, '34000000-0000-4000-8000-000000000002'::uuid, 1);

-- Trois séances : deux chez A (la seconde sert à prouver qu'on ne peut pas
-- désigner l'exercice prescrit d'une autre séance), une chez B.
insert into public.workout_sessions (id, program_id, program_week_id, day, name, muscle_group) values
  ('36000000-0000-4000-8000-000000000001'::uuid, '34000000-0000-4000-8000-000000000001'::uuid,
   '35000000-0000-4000-8000-000000000001'::uuid, 'lundi', 'Haut du corps', 'pectoraux'),
  ('36000000-0000-4000-8000-000000000002'::uuid, '34000000-0000-4000-8000-000000000001'::uuid,
   '35000000-0000-4000-8000-000000000001'::uuid, 'mercredi', 'Bas du corps', 'quadriceps'),
  ('36000000-0000-4000-8000-000000000003'::uuid, '34000000-0000-4000-8000-000000000001'::uuid,
   '35000000-0000-4000-8000-000000000001'::uuid, 'mardi', 'Séance du mardi', 'dos'),
  ('36000000-0000-4000-8000-000000000004'::uuid, '34000000-0000-4000-8000-000000000001'::uuid,
   '35000000-0000-4000-8000-000000000001'::uuid, 'jeudi', 'Séance du jeudi', 'bras'),
  ('36000000-0000-4000-8000-000000000005'::uuid, '34000000-0000-4000-8000-000000000001'::uuid,
   '35000000-0000-4000-8000-000000000001'::uuid, 'vendredi', 'Séance du vendredi', 'jambes'),
  ('36000000-0000-4000-8000-000000000006'::uuid, '34000000-0000-4000-8000-000000000001'::uuid,
   '35000000-0000-4000-8000-000000000001'::uuid, 'samedi', 'Séance du samedi', 'épaules'),
  ('36000000-0000-4000-8000-0000000000b1'::uuid, '34000000-0000-4000-8000-000000000002'::uuid,
   '35000000-0000-4000-8000-000000000002'::uuid, 'lundi', 'Séance de B', 'dos');

insert into public.training_blocks (id, session_id, block_type, title, position) values
  ('37000000-0000-4000-8000-000000000001'::uuid, '36000000-0000-4000-8000-000000000001'::uuid, 'standard', 'Bloc 1', 1),
  ('37000000-0000-4000-8000-000000000002'::uuid, '36000000-0000-4000-8000-000000000002'::uuid, 'standard', 'Bloc 1', 1),
  ('37000000-0000-4000-8000-0000000000b1'::uuid, '36000000-0000-4000-8000-0000000000b1'::uuid, 'standard', 'Bloc B', 1);

insert into public.workout_exercises
  (id, session_id, block_id, order_index, name, sets, reps, rest_seconds, tempo, recommended_load, recommended_rpe, notes, exercise_library_id) values
  -- Exercice prescrit venant de la banque, avec pattern.
  ('38000000-0000-4000-8000-000000000001'::uuid, '36000000-0000-4000-8000-000000000001'::uuid,
   '37000000-0000-4000-8000-000000000001'::uuid, 1, 'Développé couché barre', 4, '8', 120, '3-0-1-0', '60 kg', '8', 'Serrer les omoplates',
   '33000000-0000-4000-8000-0000000000a1'::uuid),
  -- Exercice prescrit en TEXTE LIBRE : aucune fiche de banque, aucun pattern.
  ('38000000-0000-4000-8000-000000000002'::uuid, '36000000-0000-4000-8000-000000000001'::uuid,
   '37000000-0000-4000-8000-000000000001'::uuid, 2, 'Écarté maison', 3, '12', 90, '', '', '', '', null),
  -- Exercice prescrit d'une AUTRE séance du même élève.
  ('38000000-0000-4000-8000-000000000003'::uuid, '36000000-0000-4000-8000-000000000002'::uuid,
   '37000000-0000-4000-8000-000000000002'::uuid, 1, 'Squat barre', 5, '5', 180, '', '', '', '',
   '33000000-0000-4000-8000-0000000000b1'::uuid);

insert into public.assignments (student_id, content_type, content_id) values
  ('32000000-0000-4000-8000-000000000002'::uuid, 'programme', '34000000-0000-4000-8000-000000000001'::uuid),
  ('32000000-0000-4000-8000-000000000003'::uuid, 'programme', '34000000-0000-4000-8000-000000000002'::uuid);

-- Le retour de B, créé par le décor : sert de cible aux tentatives de A.
insert into public.workout_feedback (id, student_id, session_id, program_id, session_key, session_ref_label, completed) values
  ('39000000-0000-4000-8000-0000000000b1'::uuid, '32000000-0000-4000-8000-000000000003'::uuid,
   '36000000-0000-4000-8000-0000000000b1'::uuid, '34000000-0000-4000-8000-000000000002'::uuid,
   '36000000-0000-4000-8000-0000000000b1', 'Séance de B', true);


-- ════════════════════════════════════════════════════════════════════════════
-- B. LE VOCABULAIRE — ce que le CHECK accepte, et ce qu'il refuse
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int; v_manquants text;
begin
  perform pg_temp.noter('B', 'B1. la colonne movement_pattern existe',
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'exercise_library'
               and column_name = 'movement_pattern'));

  perform pg_temp.noter('B', 'B2. elle est NULLABLE — la banque existante reste valide',
    (select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'exercise_library'
        and column_name = 'movement_pattern') = 'YES');

  perform pg_temp.noter('B', 'B3. le CHECK exercise_library_movement_pattern_check existe',
    exists (select 1 from pg_constraint where conname = 'exercise_library_movement_pattern_check'));

  perform pg_temp.noter('B', 'B4. une valeur hors vocabulaire est REFUSÉE',
    pg_temp.refuse($q$
      insert into public.exercise_library (id, name, movement_pattern)
      values ('3300ffff-0000-4000-8000-000000000001'::uuid, 'Faux pattern', 'poussee_oblique')
    $q$));

  -- B4bis. ÉTAT FINAL. Les 4 clés retirées du vocabulaire sont désormais
  -- REFUSÉES. Elles ont été tolérées le temps de la fenêtre de déploiement
  -- (20260824), parce que PostgreSQL revalide un CHECK sur la ligne entière
  -- à chaque écriture : une fiche portant encore `flexion_coude` serait
  -- devenue immodifiable. 20260825 a refermé cette parenthèse — chacune des
  -- quatre doit maintenant être rejetée, une par une et nommément.
  perform pg_temp.noter('B', 'B4bis. « charniere_de_hanche » (fusionnée dans « hinge ») est REFUSÉE',
    pg_temp.refuse($q$
      insert into public.exercise_library (id, name, movement_pattern)
      values ('3300ffff-0000-4000-8000-000000000003'::uuid, 'Legacy fusionnée', 'charniere_de_hanche')
    $q$));
  perform pg_temp.noter('B', 'B4ter. « tirage_horizontal » (scindée coudes ouverts/fermés) est REFUSÉE',
    pg_temp.refuse($q$
      insert into public.exercise_library (id, name, movement_pattern)
      values ('3300ffff-0000-4000-8000-000000000004'::uuid, 'Legacy scindée 1', 'tirage_horizontal')
    $q$));
  perform pg_temp.noter('B', 'B4quater. « flexion_coude » (scindée antérieur/postérieur) est REFUSÉE',
    pg_temp.refuse($q$
      insert into public.exercise_library (id, name, movement_pattern)
      values ('3300ffff-0000-4000-8000-000000000005'::uuid, 'Legacy scindée 2', 'flexion_coude')
    $q$));
  perform pg_temp.noter('B', 'B4quinquies. « extension_coude » (scindée antérieur/postérieur) est REFUSÉE',
    pg_temp.refuse($q$
      insert into public.exercise_library (id, name, movement_pattern)
      values ('3300ffff-0000-4000-8000-000000000006'::uuid, 'Legacy scindée 3', 'extension_coude')
    $q$));

  -- Et le refus n'est pas qu'un échec d'insertion : aucune de ces lignes
  -- n'existe. Un CHECK qui laisserait passer en silence serait pire qu'absent.
  select count(*) into v_n from public.exercise_library where name like 'Legacy %';
  perform pg_temp.noter('B', 'B4sexies. aucune fiche legacy n''a survécu au refus', v_n = 0);

  -- Le CHECK réellement posé en base ne cite plus aucune des quatre. On lit
  -- la définition avec les apostrophes : `flexion_coude` est un préfixe de
  -- `flexion_coude_anterieur`, une recherche nue rendrait un faux positif.
  perform pg_temp.noter('B', 'B4septies. le CHECK en base ne mentionne plus aucune clé retirée',
    (select count(*) = 0
       from unnest(array['tirage_horizontal', 'flexion_coude',
                         'extension_coude', 'charniere_de_hanche']) as cle
      where position('''' || cle || '''' in
                     (select pg_get_constraintdef(oid) from pg_constraint
                       where conname = 'exercise_library_movement_pattern_check')) > 0));

  insert into public.exercise_library (id, name, movement_pattern)
  values ('3300ffff-0000-4000-8000-000000000002'::uuid, 'Sans pattern', null);
  perform pg_temp.noter('B', 'B5. NULL est accepté', true);

  v_manquants := '';
  begin
    insert into public.exercise_library (name, movement_pattern)
    select 'vocab-' || p, p from unnest(array[
      'poussee_horizontale','poussee_verticale','poussee_inclinee',
      'poussee_declinee','tirage_vertical','tirage_horizontal_coudes_ouverts',
      'tirage_horizontal_coudes_fermes','tirage_diagonal','ecarte_horizontal',
      'ecarte_incline','ecarte_decline','elevation_laterale','elevation_frontale',
      'elevation_posterieure','rotation_externe_epaule','rotation_interne_epaule',
      'flexion_coude_anterieur','flexion_coude_posterieur',
      'extension_coude_anterieur','extension_coude_posterieur','flexion_poignet',
      'extension_poignet','pronosupination','squat','fente','hinge',
      'extension_de_hanche','flexion_de_hanche','extension_genou','flexion_genou',
      'abduction_hanche','adduction_hanche','rotation_hanche','flexion_plantaire',
      'flexion_dorsale','flexion_tronc','extension_tronc','rotation_tronc',
      'anti_extension','anti_rotation','anti_flexion_laterale','port_de_charge',
      'haltero','pliometrie','locomotion','mobilite'
    ]) as p;
  exception when others then v_manquants := sqlerrm;
  end;
  perform pg_temp.noter('B',
    format('B6. les 46 valeurs du vocabulaire sont acceptées%s',
           case when v_manquants = '' then '' else ' — ' || v_manquants end),
    v_manquants = '');

  select count(*) into v_n from public.exercise_library where name like 'vocab-%';
  perform pg_temp.noter('B', 'B7. 46 valeurs, pas 45 ni 47', v_n = 46);

  -- Ménage : ces lignes ne doivent pas polluer les comptages de la section C.
  delete from public.exercise_library where name like 'vocab-%' or name = 'Sans pattern';
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- C. LA RPC DES REMPLAÇANTS — et ce qu'elle ne laisse pas énumérer
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int; v_noms text; v_banque int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

  select count(*), coalesce(string_agg(name, ', ' order by name), '')
    into v_n, v_noms
    from public.list_exercise_substitutes('33000000-0000-4000-8000-0000000000a1'::uuid);
  perform pg_temp.noter('C',
    format('C1. l''élève obtient 2 remplaçants du même pattern (%s)', v_noms),
    v_n = 2 and v_noms = 'Développé couché haltères, Pompes lestées');

  perform pg_temp.noter('C', 'C2. la fiche SOURCE ne se propose pas elle-même',
    not exists (select 1 from public.list_exercise_substitutes('33000000-0000-4000-8000-0000000000a1'::uuid)
                 where id = '33000000-0000-4000-8000-0000000000a1'::uuid));

  perform pg_temp.noter('C', 'C3. la fiche ARCHIVÉE n''est jamais proposée',
    not exists (select 1 from public.list_exercise_substitutes('33000000-0000-4000-8000-0000000000a1'::uuid)
                 where id = '33000000-0000-4000-8000-0000000000a4'::uuid));

  perform pg_temp.noter('C', 'C4. un exercice d''un AUTRE pattern n''est jamais proposé',
    not exists (select 1 from public.list_exercise_substitutes('33000000-0000-4000-8000-0000000000a1'::uuid)
                 where id = '33000000-0000-4000-8000-0000000000b1'::uuid));

  select count(*) into v_n from public.list_exercise_substitutes('33000000-0000-4000-8000-0000000000c1'::uuid);
  perform pg_temp.noter('C', 'C5. une fiche SANS pattern n''a aucun remplaçant', v_n = 0);

  select count(*) into v_n from public.list_exercise_substitutes('33000000-0000-4000-8000-0000000000b1'::uuid);
  perform pg_temp.noter('C', 'C6. « Squat barre » est seul de son pattern : 0 remplaçant', v_n = 0);

  -- ── ÉNUMÉRATION ──────────────────────────────────────────────────────────
  -- Un UUID inventé ne rend rien : sans pattern source, il n'y a pas de
  -- groupe à renvoyer. La RPC ne peut donc pas servir de sonde.
  select count(*) into v_n from public.list_exercise_substitutes('33000000-0000-4000-8000-00000000dead'::uuid);
  perform pg_temp.noter('C', 'C7. un UUID inexistant ne rend AUCUNE ligne', v_n = 0);

  select count(*) into v_n from public.list_exercise_substitutes(null);
  perform pg_temp.noter('C', 'C8. un UUID nul ne rend AUCUNE ligne', v_n = 0);

  -- Et surtout : la RPC ne divulgue RIEN de plus qu'un simple SELECT. La
  -- banque est volontairement GLOBALE dans ce dépôt — `exercise_library`
  -- porte un `coach_id` mais AUCUNE politique ne s'en sert, et
  -- `exercise_library_select_active` ouvre déjà toutes les fiches actives à
  -- tout utilisateur authentifié. La RPC ne peut donc pas « fuiter » un
  -- périmètre coach : ce périmètre n'existe pas encore côté base.
  select count(*) into v_banque from public.exercise_library where status = 'active';
  perform pg_temp.noter('C',
    format('C9. la banque est GLOBALE et déjà lisible en entier par l''élève (%s fiches actives) — la RPC n''ajoute aucune divulgation', v_banque),
    v_banque > 0);

  perform pg_temp.noter('C', 'C10. une fiche ARCHIVÉE reste invisible en lecture directe pour l''élève',
    not exists (select 1 from public.exercise_library where id = '33000000-0000-4000-8000-0000000000a4'::uuid));

  -- ── Le coach voit la même chose (politique staff) ────────────────────────
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  select count(*) into v_n from public.list_exercise_substitutes('33000000-0000-4000-8000-0000000000a1'::uuid);
  perform pg_temp.noter('C', 'C11. le coach obtient les mêmes 2 remplaçants', v_n = 2);

  -- ── anon : rien, jamais ──────────────────────────────────────────────────
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform pg_temp.noter('C', 'C12. anon ne peut pas exécuter la RPC',
    pg_temp.refuse($q$
      select * from public.list_exercise_substitutes('33000000-0000-4000-8000-0000000000a1'::uuid)
    $q$));
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- D. LE SNAPSHOT DU PRESCRIT — serveur-autoritaire de bout en bout
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_snapshot jsonb;
  v_attendu jsonb;
  v_avant jsonb;
  v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

  -- D1. L'élève envoie un snapshot MENSONGER en même temps que son retour.
  insert into public.workout_feedback
    (id, student_id, session_id, program_id, session_key, session_ref_label, completed,
     global_rpe, global_comment, pain, prescribed_snapshot, status, coach_reply, session_status)
  values
    ('39000000-0000-4000-8000-000000000001'::uuid,
     '32000000-0000-4000-8000-000000000002'::uuid,
     '36000000-0000-4000-8000-000000000001'::uuid,
     '34000000-0000-4000-8000-000000000001'::uuid,
     '36000000-0000-4000-8000-000000000001', 'Haut du corps', true,
     7, 'bonne séance', '',
     '{"version":1,"sessionId":"00000000-0000-0000-0000-000000000000","sessionName":"MENSONGE","blocks":[]}'::jsonb,
     'traité', 'Bravo, dit ton coach (en fait non).', 'missed');

  select prescribed_snapshot into v_snapshot
    from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'::uuid;

  perform pg_temp.noter('D',
    format('D1. le snapshot fourni par l''élève est IGNORÉ (sessionName = %s)', v_snapshot->>'sessionName'),
    v_snapshot->>'sessionName' = 'Haut du corps');

  perform pg_temp.noter('D', 'D2. il pointe la VRAIE séance, pas celle annoncée',
    (v_snapshot->>'sessionId') = '36000000-0000-4000-8000-000000000001');

  -- D3. Le contenu vient bien des lignes de prescription réelles.
  perform pg_temp.noter('D', 'D3. le snapshot reprend la prescription réelle, champ par champ',
    v_snapshot #>> '{blocks,0,exercises,0,name}' = 'Développé couché barre'
    and (v_snapshot #>> '{blocks,0,exercises,0,sets}')::int = 4
    and v_snapshot #>> '{blocks,0,exercises,0,reps}' = '8'
    and v_snapshot #>> '{blocks,0,exercises,0,recommendedLoad}' = '60 kg'
    and v_snapshot #>> '{blocks,0,exercises,0,recommendedRpe}' = '8'
    and (v_snapshot #>> '{blocks,0,exercises,0,restSeconds}')::int = 120
    and v_snapshot #>> '{blocks,0,exercises,0,tempo}' = '3-0-1-0'
    and v_snapshot #>> '{blocks,0,exercises,0,notes}' = 'Serrer les omoplates'
    and v_snapshot #>> '{blocks,0,exercises,0,exerciseLibraryId}' = '33000000-0000-4000-8000-0000000000a1'
    and v_snapshot #>> '{blocks,0,exercises,1,name}' = 'Écarté maison');

  perform pg_temp.noter('D', 'D4. la forme est celle que relit isPrescribedSnapshot (version 1)',
    (v_snapshot->>'version')::int = 1
    and jsonb_typeof(v_snapshot->'blocks') = 'array'
    and v_snapshot ? 'capturedAt'
    and v_snapshot ? 'day'
    and (v_snapshot->>'weekNumber')::int = 3);

  -- D5. Elle est exactement celle que rend la fonction de construction.
  reset role;
  select public.build_prescribed_snapshot('36000000-0000-4000-8000-000000000001'::uuid) into v_attendu;
  perform pg_temp.noter('D', 'D5. identique à build_prescribed_snapshot(), hors horodatage',
    (v_snapshot - 'capturedAt') = (v_attendu - 'capturedAt'));

  -- D6. Après création, l'élève ne peut plus le changer.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  v_avant := v_snapshot;
  update public.workout_feedback
     set prescribed_snapshot = '{"version":1,"sessionId":"x","sessionName":"RÉÉCRIT","blocks":[]}'::jsonb
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  select prescribed_snapshot into v_snapshot
    from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('D', 'D6. l''élève ne peut PAS réécrire le snapshot après création',
    v_snapshot = v_avant);

  -- D7. Même le coach modifiant la séance ne réécrit pas l'histoire.
  reset role;
  update public.workout_exercises set reps = '3', recommended_load = '999 kg'
   where id = '38000000-0000-4000-8000-000000000001'::uuid;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  update public.workout_feedback set global_comment = 'resoumission'
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  select prescribed_snapshot into v_snapshot
    from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('D',
    'D7. une resoumission après modification du programme garde la prescription d''origine',
    v_snapshot #>> '{blocks,0,exercises,0,reps}' = '8');
  reset role;
  update public.workout_exercises set reps = '8', recommended_load = '60 kg'
   where id = '38000000-0000-4000-8000-000000000001'::uuid;

  -- D8. Un retour visant la séance d'un AUTRE élève est refusé net.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  perform pg_temp.noter('D', 'D8. l''élève A ne peut pas créer un retour sur la séance de B',
    pg_temp.refuse($q$
      insert into public.workout_feedback (student_id, session_id, session_key, completed)
      values ('32000000-0000-4000-8000-000000000002'::uuid,
              '36000000-0000-4000-8000-0000000000b1'::uuid, 'vol-de-seance', true)
    $q$));
  reset role;
  select count(*) into v_n from public.workout_feedback where session_key = 'vol-de-seance';
  perform pg_temp.noter('D', 'D8bis. et aucune ligne n''a été écrite', v_n = 0);

  -- D9. Un retour NON terminé n'a pas de snapshot — rien n'est inventé.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  insert into public.workout_feedback (id, student_id, session_id, session_key, completed, prescribed_snapshot)
  values ('39000000-0000-4000-8000-000000000002'::uuid,
          '32000000-0000-4000-8000-000000000002'::uuid,
          '36000000-0000-4000-8000-000000000002'::uuid, 'seance-non-terminee', false,
          '{"version":1,"sessionName":"INVENTÉ","blocks":[]}'::jsonb);
  perform pg_temp.noter('D', 'D9. séance non terminée : aucun snapshot, malgré celui envoyé',
    (select prescribed_snapshot from public.workout_feedback
      where id = '39000000-0000-4000-8000-000000000002'::uuid) is null);
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- M. LES MÉTADONNÉES DE SÉANCE — dérivées, jamais déclarées
-- ════════════════════════════════════════════════════════════════════════════
-- `program_id`, `session_key` et `session_ref_label` décrivent la séance
-- PRESCRITE. Depuis la migration 20260822090000, ils sont DÉRIVÉS de
-- `session_id` : aucun écart n'est représentable en base. Les cinq scénarios
-- ci-dessous sont ceux d'un client qui ment sur chacun.
do $$
declare v_prog uuid; v_clef text; v_lib text; v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

  -- M1. Séance qui lui appartient + program_id d'un AUTRE programme
  --     (celui de l'élève B, donc d'un périmètre qui n'est pas le sien).
  insert into public.workout_feedback
    (id, student_id, session_id, program_id, session_key, session_ref_label, completed)
  values ('39000000-0000-4000-8000-00000000000a'::uuid,
          '32000000-0000-4000-8000-000000000002'::uuid,
          '36000000-0000-4000-8000-000000000003'::uuid,
          '34000000-0000-4000-8000-000000000002'::uuid,   -- programme de B
          'CLEF-INVENTEE',
          'LIBELLÉ INVENTÉ',
          true);
  select program_id, session_key, session_ref_label into v_prog, v_clef, v_lib
    from public.workout_feedback where id = '39000000-0000-4000-8000-00000000000a'::uuid;

  perform pg_temp.noter('M',
    format('M1. program_id est DÉRIVÉ de la séance, pas reçu (%s)', v_prog),
    v_prog = '34000000-0000-4000-8000-000000000001'::uuid);
  perform pg_temp.noter('M',
    format('M2. et il ne peut donc pas désigner le programme d''un autre élève (%s ≠ %s)',
           v_prog, '34000000-0000-4000-8000-000000000002'),
    v_prog <> '34000000-0000-4000-8000-000000000002'::uuid);
  perform pg_temp.noter('M',
    format('M3. session_key falsifiée : dérivée de session_id (« %s »)', v_clef),
    v_clef = '36000000-0000-4000-8000-000000000003');
  perform pg_temp.noter('M',
    format('M4. session_ref_label falsifié : dérivé du nom réel de la séance (« %s »)', v_lib),
    v_lib = 'Séance du mardi');

  -- M5. UPDATE après création : les trois sont figés.
  update public.workout_feedback
     set program_id = '34000000-0000-4000-8000-000000000002'::uuid,
         session_key = 'CLEF-REECRITE',
         session_ref_label = 'LIBELLÉ RÉÉCRIT'
   where id = '39000000-0000-4000-8000-00000000000a'::uuid;
  select program_id, session_key, session_ref_label into v_prog, v_clef, v_lib
    from public.workout_feedback where id = '39000000-0000-4000-8000-00000000000a'::uuid;
  perform pg_temp.noter('M', 'M5. aucun des trois ne se réécrit après création',
    v_prog = '34000000-0000-4000-8000-000000000001'::uuid
    and v_clef = '36000000-0000-4000-8000-000000000003'
    and v_lib = 'Séance du mardi');

  -- M6. Le coach non plus : ce sont des photographies de la prescription.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  update public.workout_feedback set session_ref_label = 'LE COACH RENOMME'
   where id = '39000000-0000-4000-8000-00000000000a'::uuid;
  perform pg_temp.noter('M', 'M6. même le coach ne réécrit pas le libellé d''un retour envoyé',
    (select session_ref_label from public.workout_feedback
      where id = '39000000-0000-4000-8000-00000000000a'::uuid) = 'Séance du mardi');

  -- M7. Renommer la SÉANCE ne réécrit pas les retours déjà envoyés — mais un
  --     retour créé APRÈS porte bien le nouveau nom. Le second contrôle se
  --     joue sur une séance VIERGE : depuis l'index unique (migration
  --     20260823090000), l'élève ne peut plus avoir deux retours sur la même.
  update public.workout_sessions set name = 'Séance du mardi (v2)'
   where id = '36000000-0000-4000-8000-000000000003'::uuid;
  update public.workout_sessions set name = 'Séance du jeudi (v2)'
   where id = '36000000-0000-4000-8000-000000000004'::uuid;
  perform pg_temp.noter('M', 'M7a. le retour déjà envoyé garde son libellé d''origine',
    (select session_ref_label from public.workout_feedback
      where id = '39000000-0000-4000-8000-00000000000a'::uuid) = 'Séance du mardi');
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  insert into public.workout_feedback
    (id, student_id, session_id, session_key, session_ref_label, completed)
  values ('39000000-0000-4000-8000-00000000000b'::uuid,
          '32000000-0000-4000-8000-000000000002'::uuid,
          '36000000-0000-4000-8000-000000000004'::uuid,
          'x', 'y', false);
  perform pg_temp.noter('M', 'M7b. un retour créé après le renommage porte le nouveau nom',
    (select session_ref_label from public.workout_feedback
      where id = '39000000-0000-4000-8000-00000000000b'::uuid) = 'Séance du jeudi (v2)');
  reset role;

  -- M8. SÉANCE HORS SUPABASE : aucune ligne de prescription d'où dériver.
  --     Le chemin mock/localStorage doit continuer de fonctionner tel quel.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  insert into public.workout_feedback
    (id, student_id, session_id, program_id, session_key, session_ref_label, completed)
  values ('39000000-0000-4000-8000-00000000000c'::uuid,
          '32000000-0000-4000-8000-000000000002'::uuid,
          null, null, 'session-upper', 'Séance haut du corps (mock)', true);
  select session_key, session_ref_label into v_clef, v_lib
    from public.workout_feedback where id = '39000000-0000-4000-8000-00000000000c'::uuid;
  perform pg_temp.noter('M',
    'M8. sans session_id, les trois champs restent libres — le chemin mock est intact',
    v_clef = 'session-upper' and v_lib = 'Séance haut du corps (mock)');
  reset role;

  -- M9. L'INVARIANT GLOBAL : plus aucun retour de la base ne peut présenter
  --     un écart entre sa séance et son programme, ou entre sa séance et sa
  --     clé. C'est le contrôle qui résume les huit précédents.
  -- Le contrôle ne vaut que s'il porte sur quelque chose : on compte
  -- d'abord les retours RATTACHÉS à une séance, sinon « 0 écart » serait
  -- vrai sur un ensemble vide et ne prouverait rien.
  select count(*) into v_n
    from public.workout_feedback wf
    join public.workout_sessions s on s.id = wf.session_id;
  perform pg_temp.noter('M',
    format('M9a. le contrôle porte bien sur des retours réels (%s rattachés à une séance)', v_n),
    v_n >= 4);

  select count(*) into v_n
    from public.workout_feedback wf
    join public.workout_sessions s on s.id = wf.session_id
   where wf.program_id is distinct from s.program_id
      or wf.session_key is distinct from wf.session_id::text;
  perform pg_temp.noter('M',
    format('M9b. aucun écart session_id ↔ program_id/session_key en base (%s)', v_n),
    v_n = 0);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- N. UN ÉLÈVE, UNE SÉANCE, UN SEUL RETOUR
-- ════════════════════════════════════════════════════════════════════════════
-- L'unicité ne repose plus sur une lecture-puis-écriture applicative — qui
-- ne protège de rien dès que deux soumissions se croisent — mais sur un
-- index UNIQUE PARTIEL, vérifié par PostgreSQL au moment d'insérer l'entrée
-- d'index. Les contrôles ci-dessous attaquent la règle sous tous les angles
-- que l'application ne contrôle pas.
do $$
declare v_n int; v_def text;
begin
  -- N0. L'index est là, unique, sur les bonnes colonnes, et PARTIEL.
  select indexdef into v_def
    from pg_indexes
   where schemaname = 'public' and tablename = 'workout_feedback'
     and indexname = 'workout_feedback_one_per_student_session_uidx';
  perform pg_temp.noter('N', format('N0. index présent, UNIQUE, partiel (%s)', coalesce(v_def, '∅')),
    v_def is not null
    and position('UNIQUE INDEX' in v_def) > 0
    and position('(student_id, session_id)' in v_def) > 0
    and position('WHERE (session_id IS NOT NULL)' in v_def) > 0);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

  -- N1. PREMIER retour de l'élève A sur la séance X : autorisé.
  insert into public.workout_feedback
    (id, student_id, session_id, session_key, session_ref_label, completed)
  values ('39000000-0000-4000-8000-00000000001a'::uuid,
          '32000000-0000-4000-8000-000000000002'::uuid,
          '36000000-0000-4000-8000-000000000005'::uuid, 'k', 'l', true);
  perform pg_temp.noter('N', 'N1. premier retour élève A + séance X : autorisé',
    exists (select 1 from public.workout_feedback
             where id = '39000000-0000-4000-8000-00000000001a'::uuid));

  -- N2. SECOND retour, même élève, même séance : refusé par l'index.
  perform pg_temp.noter('N', 'N2. second retour élève A + séance X : REFUSÉ', pg_temp.refuse($q$
    insert into public.workout_feedback
      (student_id, session_id, session_key, session_ref_label, completed)
    values ('32000000-0000-4000-8000-000000000002'::uuid,
            '36000000-0000-4000-8000-000000000005'::uuid, 'k2', 'l2', true)
  $q$));

  -- N3. …y compris avec une session_key DIFFÉRENTE. C'est tout l'intérêt de
  --     poser l'unicité sur session_id : la clé texte, dérivée, ne peut plus
  --     servir de porte dérobée. (La dérivation la ramène de toute façon à
  --     session_id::text — mais l'index tranche AVANT même d'en dépendre.)
  perform pg_temp.noter('N', 'N3. impossible de contourner avec une session_key falsifiée',
    pg_temp.refuse($q$
      insert into public.workout_feedback
        (student_id, session_id, session_key, session_ref_label, completed)
      values ('32000000-0000-4000-8000-000000000002'::uuid,
              '36000000-0000-4000-8000-000000000005'::uuid,
              'CLEF-TOTALEMENT-DIFFERENTE', 'autre libellé', false)
    $q$));

  select count(*) into v_n from public.workout_feedback
   where student_id = '32000000-0000-4000-8000-000000000002'::uuid
     and session_id = '36000000-0000-4000-8000-000000000005'::uuid;
  perform pg_temp.noter('N', format('N4. il n''y a bien QU''UN retour sur la séance X (%s)', v_n), v_n = 1);

  -- N5. Une AUTRE séance du même élève : parfaitement autorisé.
  insert into public.workout_feedback
    (id, student_id, session_id, session_key, session_ref_label, completed)
  values ('39000000-0000-4000-8000-00000000001b'::uuid,
          '32000000-0000-4000-8000-000000000002'::uuid,
          '36000000-0000-4000-8000-000000000006'::uuid, 'k', 'l', true);
  perform pg_temp.noter('N', 'N5. élève A + séance Y : autorisé — l''unicité est par SÉANCE',
    exists (select 1 from public.workout_feedback
             where id = '39000000-0000-4000-8000-00000000001b'::uuid));

  -- N6. `session_id` NULL : comportement HISTORIQUE conservé. L'index est
  --     partiel, ces retours ne sont pas concernés — plusieurs coexistent,
  --     exactement comme avant.
  insert into public.workout_feedback
    (student_id, session_id, session_key, session_ref_label, completed)
  values ('32000000-0000-4000-8000-000000000002'::uuid, null, 'mock-1', 'Mock 1', true),
         ('32000000-0000-4000-8000-000000000002'::uuid, null, 'mock-2', 'Mock 2', true),
         ('32000000-0000-4000-8000-000000000002'::uuid, null, 'mock-1', 'Mock 1 bis', true);
  select count(*) into v_n from public.workout_feedback
   where student_id = '32000000-0000-4000-8000-000000000002'::uuid and session_id is null;
  perform pg_temp.noter('N',
    format('N6. retours sans session_id : comportement historique intact (%s coexistent)', v_n),
    v_n >= 3);
  reset role;

  -- N7. AUCUNE RÉGRESSION ENTRE ÉLÈVES. L'unicité est (élève, séance) : deux
  --     élèves d'un programme de GROUPE gardent chacun leur retour sur la
  --     même séance. Une unicité sur la seule séance aurait cassé le groupe.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  select count(*) into v_n from public.workout_feedback
   where id = '39000000-0000-4000-8000-00000000001a'::uuid;
  perform pg_temp.noter('N', 'N7. l''élève B ne voit toujours pas les retours de A', v_n = 0);
  reset role;

  -- L'élève B possède SA séance et SON retour : rien n'a bougé pour lui.
  select count(*) into v_n from public.workout_feedback
   where student_id = '32000000-0000-4000-8000-000000000003'::uuid
     and session_id = '36000000-0000-4000-8000-0000000000b1'::uuid;
  perform pg_temp.noter('N', 'N8. l''élève B garde son propre retour sur SA séance', v_n = 1);

  -- N9. La clé texte reste alignée sur l'identité canonique, pour TOUTES les
  --     séances réelles — y compris celles créées dans cette section.
  select count(*) into v_n
    from public.workout_feedback
   where session_id is not null and session_key is distinct from session_id::text;
  perform pg_temp.noter('N',
    format('N9. session_key = session_id::text pour toutes les séances réelles (%s écart)', v_n),
    v_n = 0);

  -- N10. L'invariant final, énoncé tel quel : aucun couple (élève, séance
  --      réelle) ne porte plus d'un retour.
  select count(*) into v_n from (
    select 1 from public.workout_feedback
     where session_id is not null
     group by student_id, session_id
    having count(*) > 1
  ) t;
  perform pg_temp.noter('N', format('N10. aucun couple (élève, séance) en double (%s)', v_n), v_n = 0);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- E. LA MATRICE DE PROPRIÉTÉ — chaque colonne B, C ou D attaquée en PATCH
-- ════════════════════════════════════════════════════════════════════════════
-- Sous le rôle `authenticated`, avec les claims de l'élève A, sur SA PROPRE
-- ligne : le cas le plus favorable à l'attaquant. On lit ensuite la valeur
-- hors de son rôle quand c'est nécessaire.
do $$
declare
  v_t text; v_r text; v_s text; v_avant timestamptz; v_apres timestamptz; v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

  -- ── E0. LE HARNAIS SE TESTE LUI-MÊME ─────────────────────────────────────
  -- `pg_temp.inchange` ne prouve quelque chose que s'il sait DÉTECTER une
  -- colonne non protégée. On le vérifie sur `global_comment`, colonne de
  -- l'élève qui DOIT bouger : si l'assistant renvoyait « inchangé » partout,
  -- les vingt contrôles suivants ne vaudraient rien.
  perform pg_temp.noter('E',
    'E0. le harnais détecte bien une colonne NON protégée (auto-contrôle)',
    pg_temp.inchange(
      $q$update public.workout_feedback set global_comment = 'test du harnais' where id = '39000000-0000-4000-8000-000000000001'$q$,
      $q$select global_comment from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'$q$,
      'bonne séance') = false);

  -- L'insertion de la section D portait status = 'traité', coach_reply et
  -- session_status = 'missed' : la base a imposé ses propres valeurs.
  perform pg_temp.noter('E',
    'E0bis. à l''INSERT déjà, status/coach_reply/session_status envoyés par l''élève ont été écrasés',
    (select status || '|' || coach_reply || '|' || coalesce(session_status, '∅')
       from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'::uuid)
    = 'a-traiter||done');

  -- ── workout_feedback — colonnes B (coach) ────────────────────────────────
  perform pg_temp.noter('E', 'E1. workout_feedback.status : non modifiable par l''élève',
    pg_temp.inchange(
      $q$update public.workout_feedback set status = 'traité' where id = '39000000-0000-4000-8000-000000000001'$q$,
      $q$select status from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'$q$,
      'a-traiter'));

  perform pg_temp.noter('E', 'E2. workout_feedback.coach_reply : non modifiable par l''élève',
    pg_temp.inchange(
      $q$update public.workout_feedback set coach_reply = 'faux message' where id = '39000000-0000-4000-8000-000000000001'$q$,
      $q$select coach_reply from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'$q$,
      ''));

  perform pg_temp.noter('E', 'E3. workout_feedback.session_status : DÉRIVÉ de completed, jamais choisi',
    pg_temp.inchange(
      $q$update public.workout_feedback set session_status = 'missed' where id = '39000000-0000-4000-8000-000000000001'$q$,
      $q$select session_status from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'$q$,
      'done'));

  -- ── workout_feedback — colonnes D (immuables) ────────────────────────────
  perform pg_temp.noter('E', 'E4. workout_feedback.student_id : figé après création',
    pg_temp.inchange(
      $q$update public.workout_feedback set student_id = '32000000-0000-4000-8000-000000000003' where id = '39000000-0000-4000-8000-000000000001'$q$,
      $q$select student_id::text from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'$q$,
      '32000000-0000-4000-8000-000000000002'));

  perform pg_temp.noter('E', 'E5. workout_feedback.session_id : ne peut pas être repointé ailleurs',
    pg_temp.inchange(
      $q$update public.workout_feedback set session_id = '36000000-0000-4000-8000-0000000000b1' where id = '39000000-0000-4000-8000-000000000001'$q$,
      $q$select session_id::text from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'$q$,
      '36000000-0000-4000-8000-000000000001'));

  perform pg_temp.noter('E', 'E6. workout_feedback.program_id : ne peut pas être repointé ailleurs',
    pg_temp.inchange(
      $q$update public.workout_feedback set program_id = '34000000-0000-4000-8000-000000000002' where id = '39000000-0000-4000-8000-000000000001'$q$,
      $q$select program_id::text from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'$q$,
      '34000000-0000-4000-8000-000000000001'));

  perform pg_temp.noter('E', 'E7. workout_feedback.session_key : figée',
    pg_temp.inchange(
      $q$update public.workout_feedback set session_key = 'autre-clef' where id = '39000000-0000-4000-8000-000000000001'$q$,
      $q$select session_key from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'$q$,
      '36000000-0000-4000-8000-000000000001'));

  perform pg_temp.noter('E', 'E8. workout_feedback.id : figé (la ligne reste joignable)',
    pg_temp.inchange(
      $q$update public.workout_feedback set id = '39000000-0000-4000-8000-00000000dead' where id = '39000000-0000-4000-8000-000000000001'$q$,
      $q$select id::text from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'$q$,
      '39000000-0000-4000-8000-000000000001'));

  select created_at into v_avant from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'::uuid;
  update public.workout_feedback set created_at = '2000-01-01T00:00:00Z'
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  select created_at into v_apres from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('E', 'E9. workout_feedback.created_at : figée', v_apres = v_avant);

  -- ── workout_feedback — colonnes C (dérivées) ─────────────────────────────
  update public.workout_feedback set submitted_at = '2000-01-01T00:00:00Z', updated_at = '2000-01-01T00:00:00Z'
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  select submitted_at, updated_at into v_avant, v_apres
    from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('E', 'E10. submitted_at et updated_at : dérivés de now(), jamais choisis',
    v_avant > '2020-01-01'::timestamptz and v_apres > '2020-01-01'::timestamptz);

  -- prescribed_snapshot : déjà couvert en D6, rappelé ici pour l'inventaire.
  perform pg_temp.noter('E', 'E11. workout_feedback.prescribed_snapshot : dérivé (voir D1/D6)',
    (select prescribed_snapshot->>'sessionName' from public.workout_feedback
      where id = '39000000-0000-4000-8000-000000000001'::uuid) = 'Haut du corps');

  -- ── workout_feedback — colonnes A : l'élève garde la main ────────────────
  update public.workout_feedback
     set completed = true, global_rpe = 9, global_comment = 'très dur', pain = 'épaule droite',
         session_ref_label = 'Haut du corps (S3)', performed_at = '2026-08-07', duration_minutes = 75
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  select global_comment, pain into v_t, v_r
    from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'::uuid;
  select global_rpe::text into v_s
    from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('E',
    'E12. les colonnes de l''élève restent pleinement modifiables (rien n''a été sur-protégé)',
    v_t = 'très dur' and v_r = 'épaule droite' and v_s = '9'
    and (select duration_minutes from public.workout_feedback
          where id = '39000000-0000-4000-8000-000000000001'::uuid) = 75);

  -- ── exercise_feedback ────────────────────────────────────────────────────
  insert into public.exercise_feedback
    (id, workout_feedback_id, student_id, exercise_id, exercise_name, exercise_order, comment)
  values ('3a000000-0000-4000-8000-000000000009'::uuid,
          '39000000-0000-4000-8000-000000000001'::uuid,
          '32000000-0000-4000-8000-000000000002'::uuid,
          '38000000-0000-4000-8000-000000000001'::uuid,
          'Développé couché barre', 5, '');

  perform pg_temp.noter('E', 'E13. exercise_feedback.workout_feedback_id : figé',
    pg_temp.inchange(
      $q$update public.exercise_feedback set workout_feedback_id = '39000000-0000-4000-8000-0000000000b1' where id = '3a000000-0000-4000-8000-000000000009'$q$,
      $q$select workout_feedback_id::text from public.exercise_feedback where id = '3a000000-0000-4000-8000-000000000009'$q$,
      '39000000-0000-4000-8000-000000000001'));

  perform pg_temp.noter('E', 'E14. exercise_feedback.student_id : figé',
    pg_temp.inchange(
      $q$update public.exercise_feedback set student_id = '32000000-0000-4000-8000-000000000003' where id = '3a000000-0000-4000-8000-000000000009'$q$,
      $q$select student_id::text from public.exercise_feedback where id = '3a000000-0000-4000-8000-000000000009'$q$,
      '32000000-0000-4000-8000-000000000002'));

  perform pg_temp.noter('E', 'E15. exercise_feedback.substitute_exercise_name : jamais écrit à la main',
    pg_temp.inchange(
      $q$update public.exercise_feedback set substitute_exercise_name = 'NOM INVENTÉ' where id = '3a000000-0000-4000-8000-000000000009'$q$,
      $q$select coalesce(substitute_exercise_name, '∅') from public.exercise_feedback where id = '3a000000-0000-4000-8000-000000000009'$q$,
      '∅'));

  perform pg_temp.noter('E', 'E16. exercise_feedback.exercise_id : ne peut pas viser une autre séance',
    pg_temp.inchange(
      $q$update public.exercise_feedback set exercise_id = '38000000-0000-4000-8000-000000000003' where id = '3a000000-0000-4000-8000-000000000009'$q$,
      $q$select exercise_id::text from public.exercise_feedback where id = '3a000000-0000-4000-8000-000000000009'$q$,
      '38000000-0000-4000-8000-000000000001'));

  -- ── exercise_set_feedback ────────────────────────────────────────────────
  insert into public.exercise_set_feedback
    (id, exercise_feedback_id, student_id, set_number, load_used, reps_done, rpe)
  values ('3b000000-0000-4000-8000-000000000009'::uuid,
          '3a000000-0000-4000-8000-000000000009'::uuid,
          '32000000-0000-4000-8000-000000000002'::uuid, 1, '60 kg', '8', 8);

  perform pg_temp.noter('E', 'E17. exercise_set_feedback.exercise_feedback_id : figé',
    pg_temp.inchange(
      $q$update public.exercise_set_feedback set exercise_feedback_id = '3a000000-0000-4000-8000-00000000dead' where id = '3b000000-0000-4000-8000-000000000009'$q$,
      $q$select exercise_feedback_id::text from public.exercise_set_feedback where id = '3b000000-0000-4000-8000-000000000009'$q$,
      '3a000000-0000-4000-8000-000000000009'));

  perform pg_temp.noter('E', 'E18. exercise_set_feedback.student_id : figé',
    pg_temp.inchange(
      $q$update public.exercise_set_feedback set student_id = '32000000-0000-4000-8000-000000000003' where id = '3b000000-0000-4000-8000-000000000009'$q$,
      $q$select student_id::text from public.exercise_set_feedback where id = '3b000000-0000-4000-8000-000000000009'$q$,
      '32000000-0000-4000-8000-000000000002'));

  -- Et les colonnes de série de l'élève restent libres.
  update public.exercise_set_feedback set load_used = '65 kg', reps_done = '7', rpe = 9
   where id = '3b000000-0000-4000-8000-000000000009'::uuid;
  select load_used into v_t from public.exercise_set_feedback where id = '3b000000-0000-4000-8000-000000000009'::uuid;
  perform pg_temp.noter('E', 'E19. la charge, les répétitions et le RPE de série restent modifiables', v_t = '65 kg');

  -- Ménage : ces deux lignes de travail ne doivent pas fausser les comptages.
  delete from public.exercise_feedback where id = '3a000000-0000-4000-8000-000000000009'::uuid;
  select count(*) into v_n from public.exercise_set_feedback where id = '3b000000-0000-4000-8000-000000000009'::uuid;
  perform pg_temp.noter('E', 'E20. supprimer la ligne d''exercice emporte ses séries (CASCADE)', v_n = 0);
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- F. LE REMPLACEMENT LÉGITIME — le nom est DÉRIVÉ, jamais reçu
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_nom text; v_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

  insert into public.exercise_feedback
    (id, workout_feedback_id, student_id, exercise_id, exercise_name, exercise_order,
     comment, substitute_exercise_library_id, substitute_exercise_name)
  values
    ('3a000000-0000-4000-8000-000000000001'::uuid,
     '39000000-0000-4000-8000-000000000001'::uuid,
     '32000000-0000-4000-8000-000000000002'::uuid,
     '38000000-0000-4000-8000-000000000001'::uuid,
     'Développé couché barre', 0, 'machine prise',
     '33000000-0000-4000-8000-0000000000a2'::uuid,
     'JE RACONTE CE QUE JE VEUX');

  select substitute_exercise_name, substitute_exercise_library_id into v_nom, v_id
    from public.exercise_feedback where id = '3a000000-0000-4000-8000-000000000001'::uuid;

  perform pg_temp.noter('F',
    format('F1. le nom du remplaçant est DÉRIVÉ de la banque, pas reçu du client (« %s »)', v_nom),
    v_nom = 'Développé couché haltères');
  perform pg_temp.noter('F', 'F2. l''identifiant du remplaçant fait autorité et est conservé',
    v_id = '33000000-0000-4000-8000-0000000000a2'::uuid);
  perform pg_temp.noter('F', 'F3. `exercise_name` reste le nom PRESCRIT — les deux histoires coexistent',
    (select exercise_name from public.exercise_feedback
      where id = '3a000000-0000-4000-8000-000000000001'::uuid) = 'Développé couché barre');

  -- F3bis. Et ce nom prescrit est DÉRIVÉ, lui aussi : l'élève ne réécrit pas
  -- la prescription ligne par ligne en envoyant ce qu'il veut.
  insert into public.exercise_feedback
    (id, workout_feedback_id, student_id, exercise_id, exercise_name, exercise_order, comment)
  values ('3a000000-0000-4000-8000-000000000003'::uuid,
          '39000000-0000-4000-8000-000000000001'::uuid,
          '32000000-0000-4000-8000-000000000002'::uuid,
          '38000000-0000-4000-8000-000000000001'::uuid,
          'CE QUE JE VEUX COMME PRESCRIPTION', 3, '');
  perform pg_temp.noter('F',
    format('F3bis. le nom PRESCRIT est dérivé de l''exercice de séance (« %s »)',
           (select exercise_name from public.exercise_feedback
             where id = '3a000000-0000-4000-8000-000000000003'::uuid)),
    (select exercise_name from public.exercise_feedback
      where id = '3a000000-0000-4000-8000-000000000003'::uuid) = 'Développé couché barre');

  update public.exercise_feedback set exercise_name = 'RETOUCHÉ APRÈS COUP'
   where id = '3a000000-0000-4000-8000-000000000003'::uuid;
  perform pg_temp.noter('F', 'F3ter. et il ne se retouche pas après création',
    (select exercise_name from public.exercise_feedback
      where id = '3a000000-0000-4000-8000-000000000003'::uuid) = 'Développé couché barre');

  -- Sans exercice prescrit identifié (bloc cardio), le libellé reste libre :
  -- il n'existe aucune ligne de prescription d'où le tirer.
  insert into public.exercise_feedback
    (id, workout_feedback_id, student_id, exercise_name, exercise_order, comment)
  values ('3a000000-0000-4000-8000-000000000004'::uuid,
          '39000000-0000-4000-8000-000000000001'::uuid,
          '32000000-0000-4000-8000-000000000002'::uuid,
          'Cardio · Résultats', 900, '{}');
  perform pg_temp.noter('F', 'F3quater. le contrat cardio (libellé libre, sans exercise_id) passe toujours',
    (select exercise_name from public.exercise_feedback
      where id = '3a000000-0000-4000-8000-000000000004'::uuid) = 'Cardio · Résultats');

  delete from public.exercise_feedback
   where id in ('3a000000-0000-4000-8000-000000000003'::uuid, '3a000000-0000-4000-8000-000000000004'::uuid);

  insert into public.exercise_feedback
    (id, workout_feedback_id, student_id, exercise_id, exercise_name, exercise_order, comment,
     substitute_exercise_name)
  values
    ('3a000000-0000-4000-8000-000000000002'::uuid,
     '39000000-0000-4000-8000-000000000001'::uuid,
     '32000000-0000-4000-8000-000000000002'::uuid,
     '38000000-0000-4000-8000-000000000002'::uuid,
     'Écarté maison', 1, '', 'NOM PARASITE SANS IDENTIFIANT');
  perform pg_temp.noter('F',
    'F4. sans identifiant, un nom de remplaçant envoyé seul est effacé',
    (select substitute_exercise_name from public.exercise_feedback
      where id = '3a000000-0000-4000-8000-000000000002'::uuid) is null);
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- G. LES REMPLACEMENTS REFUSÉS — dix façons de tricher
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_avant int; v_apres int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

  select count(*) into v_avant from public.exercise_feedback
   where workout_feedback_id = '39000000-0000-4000-8000-000000000001'::uuid;

  perform pg_temp.noter('G', 'G1. pattern DIFFÉRENT : refusé', pg_temp.refuse($q$
    insert into public.exercise_feedback
      (workout_feedback_id, student_id, exercise_id, exercise_name, exercise_order, comment,
       substitute_exercise_library_id)
    values ('39000000-0000-4000-8000-000000000001'::uuid, '32000000-0000-4000-8000-000000000002'::uuid,
            '38000000-0000-4000-8000-000000000001'::uuid, 'Développé couché barre', 10, '',
            '33000000-0000-4000-8000-0000000000b1'::uuid)
  $q$));

  perform pg_temp.noter('G', 'G2. remplaçant ARCHIVÉ : refusé', pg_temp.refuse($q$
    insert into public.exercise_feedback
      (workout_feedback_id, student_id, exercise_id, exercise_name, exercise_order, comment,
       substitute_exercise_library_id)
    values ('39000000-0000-4000-8000-000000000001'::uuid, '32000000-0000-4000-8000-000000000002'::uuid,
            '38000000-0000-4000-8000-000000000001'::uuid, 'Développé couché barre', 11, '',
            '33000000-0000-4000-8000-0000000000a4'::uuid)
  $q$));

  perform pg_temp.noter('G', 'G3. remplaçant INEXISTANT : refusé', pg_temp.refuse($q$
    insert into public.exercise_feedback
      (workout_feedback_id, student_id, exercise_id, exercise_name, exercise_order, comment,
       substitute_exercise_library_id)
    values ('39000000-0000-4000-8000-000000000001'::uuid, '32000000-0000-4000-8000-000000000002'::uuid,
            '38000000-0000-4000-8000-000000000001'::uuid, 'Développé couché barre', 12, '',
            '33000000-0000-4000-8000-00000000dead'::uuid)
  $q$));

  perform pg_temp.noter('G', 'G4. remplaçant = exercice prescrit : refusé', pg_temp.refuse($q$
    insert into public.exercise_feedback
      (workout_feedback_id, student_id, exercise_id, exercise_name, exercise_order, comment,
       substitute_exercise_library_id)
    values ('39000000-0000-4000-8000-000000000001'::uuid, '32000000-0000-4000-8000-000000000002'::uuid,
            '38000000-0000-4000-8000-000000000001'::uuid, 'Développé couché barre', 13, '',
            '33000000-0000-4000-8000-0000000000a1'::uuid)
  $q$));

  perform pg_temp.noter('G', 'G5. `exercise_id` absent : refusé', pg_temp.refuse($q$
    insert into public.exercise_feedback
      (workout_feedback_id, student_id, exercise_name, exercise_order, comment,
       substitute_exercise_library_id)
    values ('39000000-0000-4000-8000-000000000001'::uuid, '32000000-0000-4000-8000-000000000002'::uuid,
            'Développé couché barre', 14, '', '33000000-0000-4000-8000-0000000000a2'::uuid)
  $q$));

  perform pg_temp.noter('G', 'G6. exercice prescrit HORS BANQUE (pattern source NULL) : refusé', pg_temp.refuse($q$
    insert into public.exercise_feedback
      (workout_feedback_id, student_id, exercise_id, exercise_name, exercise_order, comment,
       substitute_exercise_library_id)
    values ('39000000-0000-4000-8000-000000000001'::uuid, '32000000-0000-4000-8000-000000000002'::uuid,
            '38000000-0000-4000-8000-000000000002'::uuid, 'Écarté maison', 15, '',
            '33000000-0000-4000-8000-0000000000a2'::uuid)
  $q$));

  perform pg_temp.noter('G', 'G7. exercice prescrit d''une AUTRE séance : refusé', pg_temp.refuse($q$
    insert into public.exercise_feedback
      (workout_feedback_id, student_id, exercise_id, exercise_name, exercise_order, comment,
       substitute_exercise_library_id)
    values ('39000000-0000-4000-8000-000000000001'::uuid, '32000000-0000-4000-8000-000000000002'::uuid,
            '38000000-0000-4000-8000-000000000003'::uuid, 'Squat barre', 16, '',
            '33000000-0000-4000-8000-0000000000b1'::uuid)
  $q$));

  perform pg_temp.noter('G', 'G8. remplaçant sans pattern : refusé', pg_temp.refuse($q$
    insert into public.exercise_feedback
      (workout_feedback_id, student_id, exercise_id, exercise_name, exercise_order, comment,
       substitute_exercise_library_id)
    values ('39000000-0000-4000-8000-000000000001'::uuid, '32000000-0000-4000-8000-000000000002'::uuid,
            '38000000-0000-4000-8000-000000000001'::uuid, 'Développé couché barre', 17, '',
            '33000000-0000-4000-8000-0000000000c1'::uuid)
  $q$));

  perform pg_temp.noter('G', 'G9. UUID quelconque d''un autre pattern (« Squat barre ») : refusé', pg_temp.refuse($q$
    insert into public.exercise_feedback
      (workout_feedback_id, student_id, exercise_id, exercise_name, exercise_order, comment,
       substitute_exercise_library_id, substitute_exercise_name)
    values ('39000000-0000-4000-8000-000000000001'::uuid, '32000000-0000-4000-8000-000000000002'::uuid,
            '38000000-0000-4000-8000-000000000001'::uuid, 'Développé couché barre', 18, '',
            '33000000-0000-4000-8000-0000000000b1'::uuid, 'Développé couché haltères')
  $q$));

  perform pg_temp.noter('G', 'G10. réécrire un remplacement par UPDATE : refusé', pg_temp.refuse($q$
    update public.exercise_feedback
       set substitute_exercise_library_id = '33000000-0000-4000-8000-0000000000a3'::uuid
     where id = '3a000000-0000-4000-8000-000000000001'::uuid
  $q$));

  -- Le contrôle qui compte vraiment : AUCUNE de ces tentatives n'a laissé la
  -- moindre ligne derrière elle.
  select count(*) into v_apres from public.exercise_feedback
   where workout_feedback_id = '39000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('G',
    format('G11. aucune ligne écrite par les dix tentatives (%s avant, %s après)', v_avant, v_apres),
    v_avant = v_apres);
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- H. LA TRACE SURVIT À LA VIE DE LA BANQUE
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_nom text; v_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  update public.exercise_feedback
     set substitute_exercise_name = 'NOM RÉÉCRIT APRÈS COUP'
   where id = '3a000000-0000-4000-8000-000000000001'::uuid;
  select substitute_exercise_name into v_nom
    from public.exercise_feedback where id = '3a000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('H',
    format('H1. réécrire le NOM seul est sans effet (« %s »)', v_nom),
    v_nom = 'Développé couché haltères');
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  update public.exercise_library set name = 'DC haltères (renommé en 2027)'
   where id = '33000000-0000-4000-8000-0000000000a2'::uuid;
  select substitute_exercise_name into v_nom
    from public.exercise_feedback where id = '3a000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('H',
    format('H2. renommer la fiche ne réécrit pas l''histoire (« %s »)', v_nom),
    v_nom = 'Développé couché haltères');

  delete from public.exercise_library where id = '33000000-0000-4000-8000-0000000000a2'::uuid;
  select substitute_exercise_library_id, substitute_exercise_name into v_id, v_nom
    from public.exercise_feedback where id = '3a000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('H', 'H3a. la suppression de la fiche annule le lien', v_id is null);
  perform pg_temp.noter('H',
    format('H3b. mais le NOM réalisé survit (« %s »)', coalesce(v_nom, '∅')),
    v_nom = 'Développé couché haltères');
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- I. CLOISONNEMENT INTER-ÉLÈVES SUR LES TROIS TABLES
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int; v_t text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

  select count(*) into v_n from public.workout_feedback
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('I', 'I1. l''élève B ne LIT pas le retour de l''élève A', v_n = 0);

  update public.workout_feedback set global_comment = 'piraté'
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  get diagnostics v_n = row_count;
  reset role;
  -- Vérification HORS du rôle de l'attaquant : sous son identité, la RLS
  -- masque la ligne et la comparaison rendrait NULL — ce qui ressemblerait à
  -- un succès sans rien prouver.
  select global_comment into v_t from public.workout_feedback
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('I',
    format('I2. ni ne le modifie (%s ligne(s) touchée(s), commentaire toujours « %s »)', v_n, v_t),
    v_n = 0 and v_t <> 'piraté');

  -- LA FAILLE FERMÉE PAR 20260821090000 : rattacher SA PROPRE ligne
  -- d'exercice au retour de l'AUTRE. La RLS ne contrôlait que `student_id` —
  -- rien n'empêchait de choisir librement `workout_feedback_id`.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  perform pg_temp.noter('I', 'I3. l''élève B ne peut pas GREFFER une ligne d''exercice sur le retour de A',
    pg_temp.refuse($q$
      insert into public.exercise_feedback
        (workout_feedback_id, student_id, exercise_name, exercise_order, comment)
      values ('39000000-0000-4000-8000-000000000001'::uuid,
              '32000000-0000-4000-8000-000000000003'::uuid, 'INTRUS', 99, 'greffé')
    $q$));
  reset role;
  select count(*) into v_n from public.exercise_feedback
   where workout_feedback_id = '39000000-0000-4000-8000-000000000001'::uuid
     and exercise_name = 'INTRUS';
  perform pg_temp.noter('I', 'I3bis. et rien n''a été écrit dans le retour de A', v_n = 0);

  -- Même chose un cran plus bas : une série greffée sur la ligne d'un autre.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  perform pg_temp.noter('I', 'I4. l''élève B ne peut pas GREFFER une série sur une ligne d''exercice de A',
    pg_temp.refuse($q$
      insert into public.exercise_set_feedback
        (exercise_feedback_id, student_id, set_number, load_used, reps_done)
      values ('3a000000-0000-4000-8000-000000000001'::uuid,
              '32000000-0000-4000-8000-000000000003'::uuid, 9, 'INTRUS', 'INTRUS')
    $q$));
  reset role;
  select count(*) into v_n from public.exercise_set_feedback where load_used = 'INTRUS';
  perform pg_temp.noter('I', 'I4bis. et rien n''a été écrit', v_n = 0);

  -- Symétrie : A ne peut rien faire non plus chez B.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  select count(*) into v_n from public.workout_feedback
   where id = '39000000-0000-4000-8000-0000000000b1'::uuid;
  perform pg_temp.noter('I', 'I5. symétrique : l''élève A ne lit pas le retour de B', v_n = 0);
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- J. LE COACH ET L'ADMIN GARDENT LEURS OPÉRATIONS MÉTIER
-- ════════════════════════════════════════════════════════════════════════════
-- Une protection qui empêcherait le coach de travailler serait un bug, pas
-- une sécurité. Chaque refus de la section E est encadré ici par
-- l'autorisation symétrique qui, elle, doit passer.
do $$
declare v_statut text; v_reponse text; v_n int; v_envoi timestamptz; v_apres timestamptz;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  select count(*) into v_n from public.workout_feedback
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('J', 'J1. le coach LIT le retour de son élève', v_n = 1);

  select submitted_at into v_envoi from public.workout_feedback
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  update public.workout_feedback set status = 'traité', coach_reply = 'Bien joué, on garde ce rythme.'
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  select status, coach_reply, submitted_at into v_statut, v_reponse, v_apres
    from public.workout_feedback where id = '39000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('J', 'J2. le coach marque « traité » et répond',
    v_statut = 'traité' and v_reponse = 'Bien joué, on garde ce rythme.');
  perform pg_temp.noter('J',
    'J3. répondre ne fait pas remonter le retour en tête de file (submitted_at inchangé)',
    v_apres = v_envoi);

  update public.workout_feedback set session_status = 'missed'
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('J', 'J4. le coach peut qualifier une séance « missed » — l''élève, non (E3)',
    (select session_status from public.workout_feedback
      where id = '39000000-0000-4000-8000-000000000001'::uuid) = 'missed');

  -- Mais le snapshot reste hors de portée, même pour lui : la photographie
  -- du prescrit n'appartient à personne.
  update public.workout_feedback
     set prescribed_snapshot = '{"version":1,"sessionName":"COACH RÉÉCRIT","blocks":[]}'::jsonb
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('J', 'J5. même le coach ne peut pas réécrire le snapshot',
    (select prescribed_snapshot->>'sessionName' from public.workout_feedback
      where id = '39000000-0000-4000-8000-000000000001'::uuid) = 'Haut du corps');
  reset role;

  -- L'administrateur : mêmes droits métier.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
  update public.workout_feedback set status = 'important'
   where id = '39000000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.noter('J', 'J6. l''administrateur aussi',
    (select status from public.workout_feedback
      where id = '39000000-0000-4000-8000-000000000001'::uuid) = 'important');
  reset role;

  -- Et le coach peut toujours supprimer une séance : la cascade
  -- `on delete set null` ne doit pas être bloquée par le gel des colonnes.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  delete from public.workout_sessions where id = '36000000-0000-4000-8000-000000000002'::uuid;
  perform pg_temp.noter('J', 'J7. supprimer une séance reste possible (le gel n''empêche pas la cascade)',
    not exists (select 1 from public.workout_sessions where id = '36000000-0000-4000-8000-000000000002'::uuid));
  reset role;

  -- La même cascade sur la séance PORTANT un retour : session_id → NULL,
  -- snapshot conservé. C'est le scénario réel « le coach refait le programme ».
  delete from public.workout_sessions where id = '36000000-0000-4000-8000-000000000001'::uuid;
  select count(*) into v_n from public.workout_feedback
   where id = '39000000-0000-4000-8000-000000000001'::uuid
     and session_id is null and prescribed_snapshot is not null;
  perform pg_temp.noter('J',
    'J8. supprimer la séance du retour : le lien tombe, la photographie du prescrit reste', v_n = 1);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- K. PRIVILÈGES, DURCISSEMENT, ET `anon`
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_fn record; v_n int;
begin
  -- Aucune fonction de garde n'est appelable directement.
  for v_fn in
    select unnest(array[
      'public.enforce_exercise_feedback_write()',
      'public.enforce_exercise_set_feedback_write()',
      'public.enforce_workout_feedback_write()',
      'public.build_prescribed_snapshot(uuid)'
    ]) as sig
  loop
    perform pg_temp.noter('K', format('K1. %s : non exécutable par authenticated', v_fn.sig),
      not has_function_privilege('authenticated', v_fn.sig, 'execute'));
    perform pg_temp.noter('K', format('K2. %s : non exécutable par anon', v_fn.sig),
      not has_function_privilege('anon', v_fn.sig, 'execute'));
  end loop;

  perform pg_temp.noter('K', 'K3. list_exercise_substitutes : accordée à authenticated, refusée à anon',
    has_function_privilege('authenticated', 'public.list_exercise_substitutes(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.list_exercise_substitutes(uuid)', 'execute'));

  perform pg_temp.noter('K', 'K4. student_owns_workout_session : accordée à authenticated, refusée à anon',
    has_function_privilege('authenticated', 'public.student_owns_workout_session(uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.student_owns_workout_session(uuid,uuid)', 'execute'));

  -- search_path figé sur les six fonctions du chantier.
  for v_fn in
    select p.proname, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('enforce_exercise_feedback_write', 'enforce_exercise_set_feedback_write',
                         'enforce_workout_feedback_write', 'build_prescribed_snapshot',
                         'student_owns_workout_session', 'list_exercise_substitutes')
     order by p.proname
  loop
    perform pg_temp.noter('K', format('K5. search_path figé sur %s()', v_fn.proname),
      v_fn.proconfig is not null
      and exists (select 1 from unnest(v_fn.proconfig) c where c like 'search_path=%'));
  end loop;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('enforce_exercise_feedback_write', 'enforce_exercise_set_feedback_write',
                       'enforce_workout_feedback_write', 'build_prescribed_snapshot',
                       'student_owns_workout_session', 'list_exercise_substitutes')
     and pg_get_userbyid(p.proowner) = 'postgres';
  perform pg_temp.noter('K', 'K6. les six fonctions appartiennent à postgres', v_n = 6);

  -- Les gardiens partiels de la migration précédente ont bien été REMPLACÉS,
  -- pas empilés : deux gardiens sur la même table finiraient par diverger.
  perform pg_temp.noter('K', 'K7. aucun gardien obsolète ne subsiste',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and p.proname in ('protect_workout_feedback_coach_columns',
                                     'enforce_exercise_feedback_substitution')));

  select count(*) into v_n from pg_trigger
   where tgname in ('enforce_workout_feedback_write', 'enforce_exercise_feedback_write',
                    'enforce_exercise_set_feedback_write')
     and (tgtype & 1) = 1    -- FOR EACH ROW
     and (tgtype & 2) = 2;   -- BEFORE
  perform pg_temp.noter('K', 'K8. les trois gardiens sont BEFORE, pour chaque ligne', v_n = 3);

  -- Le trigger d'immutabilité du snapshot (migration 20260801120000) reste
  -- en place : second verrou, jamais remplacé.
  perform pg_temp.noter('K', 'K9. workout_feedback_snapshot_immutable est toujours là',
    exists (select 1 from pg_trigger where tgname = 'workout_feedback_snapshot_immutable'));
end $$;

-- `anon` : rien, nulle part.
do $$
declare v_n int;
begin
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into v_n from public.workout_feedback;
  perform pg_temp.noter('K', 'K10. anon ne lit aucun retour', v_n = 0);
  select count(*) into v_n from public.exercise_feedback;
  perform pg_temp.noter('K', 'K11. anon ne lit aucune ligne d''exercice', v_n = 0);
  select count(*) into v_n from public.exercise_set_feedback;
  perform pg_temp.noter('K', 'K12. anon ne lit aucune série', v_n = 0);
  perform pg_temp.noter('K', 'K13. anon n''écrit aucun retour', pg_temp.refuse($q$
    insert into public.workout_feedback (student_id, session_key, completed)
    values ('32000000-0000-4000-8000-000000000002'::uuid, 'anon', true)
  $q$));
  reset role;
end $$;


-- ---------------------------------------------------------------------
-- Bilan
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_ko int; v_liste text;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_ko from _faits;
  select string_agg(libelle, E'\n  ') into v_liste from _faits where not ok;
  raise notice '';
  raise notice '──────── % contrôles, % échec(s) ────────', v_total, v_ko;
  if v_ko > 0 then
    raise exception E'CHECKLIST EN ÉCHEC :\n  %', v_liste;
  end if;
end $$;

\echo ''
\echo '--- Retour de séance serveur-autoritaire : tout tient. ROLLBACK. ---'
\echo ''

rollback;

-- ════════════════════════════════════════════════════════════════════════════
-- L. RIEN NE SURVIT AU ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare nb int;
begin
  select count(*) into nb from auth.users where email like 'f3.%@test.local';
  if nb <> 0 then raise exception 'ÉCHEC — L1. des comptes de test ont survécu au ROLLBACK'; end if;
  select count(*) into nb from public.exercise_library where name like 'Développé couché%' or name like 'vocab-%';
  if nb <> 0 then raise exception 'ÉCHEC — L2. des exercices de test ont survécu'; end if;
  select count(*) into nb from public.workout_feedback
   where session_key in ('vol-de-seance', 'seance-non-terminee', 'anon', 'mock-1', 'mock-2');
  if nb <> 0 then raise exception 'ÉCHEC — L3. des retours de test ont survécu'; end if;
  raise notice 'OK      — L1/L2/L3. aucune donnée de test après le ROLLBACK';
end $$;
