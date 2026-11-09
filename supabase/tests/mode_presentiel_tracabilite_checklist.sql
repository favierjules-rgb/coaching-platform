-- ============================================================================
-- Checklist PostgreSQL — MODE PRÉSENTIEL : TRAÇABILITÉ DE LA SAISIE
-- Migration couverte : 20261102090000_mode_presentiel_tracabilite.sql
--
--   npm run db:local:init          # base LOCALE : baseline + migrations
--   psql "$DATABASE_URL_LOCAL" -f supabase/tests/mode_presentiel_tracabilite_checklist.sql
--
-- Exécutée sur une base reconstruite de zéro (baseline du 24/07/2026 + les 97
-- migrations postérieures, celle de ce lot comprise) : 42 contrôles, 0 échec.
--
-- TROIS PIÈGES Y ONT ÉTÉ TROUVÉS, et aucun ne l'aurait été par lecture :
--   · `session_key` est DÉRIVÉE de la séance et l'unicité porte sur
--     (student_id, session_id) — faire varier la clé pour distinguer quatre
--     auteurs ne fonctionne pas, il faut faire varier la séance ;
--   · `workout_feedback.status` a pour vocabulaire a-traiter / traité /
--     important, en français ;
--   · T7c et T8c étaient VIDES : tant que la fonction posait `now()`, les deux
--     dates comparées venaient de la même transaction, donc étaient égales
--     quoi qu'il arrive. Le contrôle passait même contre une fonction
--     délibérément cassée. La fonction pose maintenant `clock_timestamp()`,
--     et la section S met chaque contrôle à l'épreuve de la régression qu'il
--     prétend détecter.
--
-- 33 contrôles d'origine + A6b/A6c/A6d (search_path exact, prédicat
-- d'autorisation, invariant P13-B) + 6 sabotages = 42.
--
-- ⚠️ BASE LOCALE UNIQUEMENT. Ni la production, ni une base distante. Ce
-- fichier ÉCRIT (élèves, programmes, retours de séance) et ne tient que par
-- son ROLLBACK final ; une interruption au mauvais moment laisserait des
-- lignes derrière elle. La migration elle-même n'a volontairement jamais été
-- jouée ailleurs qu'ici.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LA QUESTION POSÉE, ET POURQUOI ELLE NE PEUT PAS SE POSER DANS NODE
-- ────────────────────────────────────────────────────────────────────────────
-- `scripts/tests/mode-presentiel.mts` vérifie le CONTENU de la migration : les
-- colonnes, le vocabulaire, l'absence de helper de rôle dans la dérivation, la
-- conservation des quatre gardes de la fonction d'origine. Il ne peut rien
-- dire de son COMPORTEMENT : seul PostgreSQL sait ce que `auth.uid()` et
-- `current_student_id()` rendent pour un compte donné.
--
-- La question est donc : « QUI la base dit-elle avoir saisi ce réalisé ? »,
-- posée en EXÉCUTANT des écritures sous six acteurs différents.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LE POINT QUI A MOTIVÉ CETTE CHECKLIST
-- ────────────────────────────────────────────────────────────────────────────
-- Le classement ne s'appuie sur AUCUN helper de rôle. Il aurait été naturel
-- d'écrire « si l'auteur est du staff, alors présentiel » avec
-- `is_coach_or_admin()` — et ce serait faux : P13-B a introduit
-- `coaches.role = 'collaborateur'`, que cette fonction ne connaît pas. La
-- règle retenue est « l'auteur est-il l'élève de cette ligne ? », et T3 est
-- là pour prouver qu'un collaborateur disposant de l'écriture en entraînement
-- tombe bien du côté « présentiel » — pas par chance, par construction.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE VÉRIFIE
--   A.  les colonnes, la contrainte, le search_path, le PRÉDICAT P13-B
--   T1  l'élève lui-même               → autonome
--   T2  son coach autonome (assistant) → presentiel
--   T3  un COLLABORATEUR entrainement/ecriture affecté → presentiel
--   T4  un administrateur de cabinet   → presentiel
--   T5  un élève écrivant pour un AUTRE élève → refusé par la RLS
--   T6  une écriture SYSTÈME (aucun claim) → aucun mode affirmé
--   T7  une réponse de coach ne RÉÉCRIT PAS la trace de l'élève
--   T8  un coach qui corrige le réalisé → la trace passe à presentiel
--   T9  l'élève qui resaisit ensuite    → la trace repasse à autonome
--   T10 des valeurs fournies par le client sont REMPLACÉES, jamais gardées
--   T11 le vocabulaire est fermé : 'autre' est refusé
--   S.  SABOTAGES — chacun des contrôles ajoutés après la revue est mis à
--       l'épreuve de la régression exacte qu'il prétend détecter
--   Z.  rien ne survit au ROLLBACK
--
-- ────────────────────────────────────────────────────────────────────────────
-- DEUX RÈGLES DE MÉTHODE, REPRISES DES CHECKLISTS EXISTANTES
--   * On mesure la VALEUR, jamais le nombre de lignes. Le gardien est un
--     trigger BEFORE : il RESTAURE au lieu de refuser, donc un UPDATE
--     rapporte « 1 ligne » sans avoir rien changé.
--   * Un verdict NULL est un ÉCHEC. Une comparaison portant sur une ligne que
--     la RLS masque rend NULL, ce qui ressemblerait à un succès : les
--     relectures de contrôle se font donc HORS du rôle de l'acteur testé.
-- ============================================================================

begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;

do $$
declare s text;
begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._faits to authenticated, anon', s);
end $$;

-- `coalesce(p_ok, false)` : un verdict NULL est un échec, pas un succès.
create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, coalesce(p_ok, false));
  if p_ok is true then raise notice 'OK      — %', p_libelle;
  else raise warning 'ÉCHEC   — %', p_libelle; end if;
end $$;

-- Un ordre qui DOIT échouer. Le bloc imbriqué joue le rôle d'un SAVEPOINT :
-- sans lui, la première exception avorterait la transaction entière.
create or replace function pg_temp.refuse(p_sql text)
returns boolean language plpgsql as $$
begin
  begin
    execute p_sql;
    return false;
  exception when others then
    return true;
  end;
end $$;

create or replace function pg_temp.devenir(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end $$;

-- Revenir au rôle de session : plus aucun claim, donc `auth.uid()` est NULL.
-- C'est exactement le contexte d'une écriture système.
create or replace function pg_temp.redevenir_systeme() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- LE DÉCOR — un admin, un coach autonome, un collaborateur, deux élèves
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  u_admin   uuid := '70000000-0000-4000-8000-000000000001';
  u_coach   uuid := '70000000-0000-4000-8000-000000000002';
  u_collab  uuid := '70000000-0000-4000-8000-000000000003';
  u_eleveA  uuid := '70000000-0000-4000-8000-000000000011';
  u_eleveB  uuid := '70000000-0000-4000-8000-000000000012';
begin
  insert into auth.users (id, email)
  select v.id, v.mail from (values
      (u_admin, 'mp.admin@test.local'), (u_coach, 'mp.coach@test.local'),
      (u_collab,'mp.collab@test.local'),
      (u_eleveA,'mp.eleveA@test.local'), (u_eleveB,'mp.eleveB@test.local')
    ) v(id, mail)
  on conflict (id) do nothing;

  -- `profiles.role` vaut 'coach' pour TOUT le staff non-admin ; le rôle fin
  -- est dans `coaches.role`. Ce n'est pas un détail : c'est précisément ce qui
  -- rend un classement par `profiles.role` incapable de distinguer un
  -- collaborateur d'un coach autonome.
  insert into public.profiles (user_id, role, first_name, last_name, email) values
    (u_admin,  'admin',   'MPAdmin',  'T', 'mp.admin@test.local'),
    (u_coach,  'coach',   'MPCoach',  'T', 'mp.coach@test.local'),
    (u_collab, 'coach',   'MPCollab', 'T', 'mp.collab@test.local'),
    (u_eleveA, 'student', 'MPEleveA', 'T', 'mp.eleveA@test.local'),
    (u_eleveB, 'student', 'MPEleveB', 'T', 'mp.eleveB@test.local')
  on conflict (user_id) do update set role = excluded.role;

  insert into public.coaches (id, user_id, name, email, role, status) values
    ('71000000-0000-4000-8000-000000000001', u_admin,  'MPAdmin',  'mp.admin@test.local',  'admin',         'actif'),
    ('71000000-0000-4000-8000-000000000002', u_coach,  'MPCoach',  'mp.coach@test.local',  'assistant',     'actif'),
    ('71000000-0000-4000-8000-000000000003', u_collab, 'MPCollab', 'mp.collab@test.local', 'collaborateur', 'actif');

  -- `students.status` est en ANGLAIS, `coaches.status` en français : les deux
  -- tables ne partagent pas le même vocabulaire.
  insert into public.students (id, user_id, coach_id, first_name, last_name, email, status, access_type) values
    ('72000000-0000-4000-8000-000000000011', u_eleveA, '71000000-0000-4000-8000-000000000002',
     'MPEleveA', 'T', 'mp.eleveA@test.local', 'active', 'coaching'),
    ('72000000-0000-4000-8000-000000000012', u_eleveB, '71000000-0000-4000-8000-000000000002',
     'MPEleveB', 'T', 'mp.eleveB@test.local', 'active', 'coaching');

  -- ⚠️ LE COLLABORATEUR EST AFFECTÉ À L'ÉLÈVE A, AVEC L'ÉCRITURE EN
  -- ENTRAÎNEMENT. C'est la configuration qui compte : affecté mais sans la
  -- permission, il serait refusé en amont par `requireStaffForStudent` et on
  -- n'apprendrait rien du trigger.
  insert into public.collaborateur_eleves (collaborateur_id, student_id) values
    ('71000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000011');
  insert into public.collaborateur_permissions (collaborateur_id, categorie, niveau) values
    ('71000000-0000-4000-8000-000000000003', 'entrainement', 'ecriture');

  insert into public.programs (id, coach_id, name, status, program_mode) values
    ('74000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002',
     'Programme MP', 'actif', 'individuel');

  insert into public.program_weeks (id, program_id, week_number) values
    ('75000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 1);

  /*
   * ⚠️ HUIT SÉANCES, ET C'EST LA BASE QUI L'EXIGE.
   *
   * `workout_feedback` porte un index unique partiel sur (student_id,
   * session_id), et `session_key` est DÉRIVÉE de la séance par le gardien
   * (`new.session_key := new.session_id::text`, migration 20260822090000).
   * Faire varier la clé de séance pour distinguer quatre auteurs ne
   * fonctionne donc pas : les quatre écritures viseraient la même ligne, et
   * la deuxième violerait l'unicité. C'est ce qu'a appris la première
   * exécution de cette checklist — on fait varier la SÉANCE, un acteur par
   * séance, et l'élève reste le même.
   */
  insert into public.workout_sessions (id, program_id, program_week_id, day, name, muscle_group)
  select v.id, '74000000-0000-4000-8000-000000000001',
         '75000000-0000-4000-8000-000000000001', v.jour, v.nom, 'pectoraux'
    from (values
      ('76000000-0000-4000-8000-000000000001'::uuid, 'lundi',    'MP — saisie élève'),
      ('76000000-0000-4000-8000-000000000002'::uuid, 'mardi',    'MP — saisie coach'),
      ('76000000-0000-4000-8000-000000000003'::uuid, 'mercredi', 'MP — saisie collaborateur'),
      ('76000000-0000-4000-8000-000000000004'::uuid, 'jeudi',    'MP — saisie admin'),
      ('76000000-0000-4000-8000-000000000005'::uuid, 'vendredi', 'MP — tentative interdite'),
      ('76000000-0000-4000-8000-000000000006'::uuid, 'samedi',   'MP — écriture système'),
      ('76000000-0000-4000-8000-000000000007'::uuid, 'dimanche', 'MP — valeurs du client'),
      ('76000000-0000-4000-8000-000000000008'::uuid, 'lundi',    'MP — vocabulaire')
    ) v(id, jour, nom);

  -- Les DEUX élèves sont affectés au programme : sans cela,
  -- `student_owns_workout_session` refuserait l'écriture et l'on confondrait
  -- « refus de propriété » et « refus de droits ».
  insert into public.assignments (student_id, content_type, content_id) values
    ('72000000-0000-4000-8000-000000000011', 'programme', '74000000-0000-4000-8000-000000000001'),
    ('72000000-0000-4000-8000-000000000012', 'programme', '74000000-0000-4000-8000-000000000001');
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- A. LA FORME — colonnes, vocabulaire, et ce que la migration n'a pas touché
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int; v_def text;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'workout_feedback'
     and column_name in ('saisie_mode', 'saisie_par', 'saisie_le');
  perform pg_temp.noter('A', 'A1. les trois colonnes de traçabilité existent', v_n = 3);

  -- NULLABLE et SANS DÉFAUT : l'historique doit rester « on ne sait pas ».
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'workout_feedback'
     and column_name in ('saisie_mode', 'saisie_par', 'saisie_le')
     and (is_nullable <> 'YES' or column_default is not null);
  perform pg_temp.noter('A', 'A2. aucune des trois n''a de défaut, et toutes sont nullables', v_n = 0);

  perform pg_temp.noter('A', 'A3. la contrainte de vocabulaire est posée',
    exists (select 1 from pg_constraint
             where conrelid = 'public.workout_feedback'::regclass
               and conname = 'workout_feedback_saisie_mode_valide'));

  -- `on delete set null` : supprimer un compte coach ne doit ni échouer, ni
  -- détruire le retour de l'élève.
  select confdeltype into v_def from pg_constraint
   where conrelid = 'public.workout_feedback'::regclass and contype = 'f'
     and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'public.workout_feedback'::regclass
                            and attname = 'saisie_par')];
  perform pg_temp.noter('A', 'A4. saisie_par → auth.users avec on delete set null', v_def = 'n');

  -- Le trigger est TOUJOURS attaché, et la fonction toujours security definer.
  perform pg_temp.noter('A', 'A5. le trigger enforce_workout_feedback_write est attaché',
    exists (select 1 from pg_trigger
             where tgname = 'enforce_workout_feedback_write'
               and tgrelid = 'public.workout_feedback'::regclass
               and not tgisinternal));

  /*
   * ⚠️ LA VALEUR EXACTE, PAS « il y a un search_path ».
   *
   * Ce contrôle disait `like '%search_path=%'` : il acceptait aussi bien
   * `public, pg_temp` qu'une chaîne vide ou qu'un `public, extensions`
   * dangereux. Il a laissé passer, en revue, un search_path ramené à `''` —
   * inoffensif en soi, mais contraire à la convention que P13-B a posée et
   * que son contrôle G27 exige à la lettre. Un contrôle qui accepte toutes
   * les valeurs ne vérifie rien.
   */
  perform pg_temp.noter('A', 'A6. security definer, propriétaire postgres',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write'
               and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'));

  perform pg_temp.noter('A', 'A6b. search_path EXACTEMENT « public, pg_temp » (convention P13-B)',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write'
               and array_to_string(coalesce(p.proconfig, '{}'), ',') = 'search_path=public, pg_temp'));

  /*
   * ⚠️ LE PRÉDICAT D'AUTORISATION, VÉRIFIÉ SUR LE TEXTE DE LA FONCTION.
   *
   * C'est l'angle mort qui a laissé passer la régression : la checklist
   * éprouvait abondamment la TRACE, et pas du tout la ligne qui décide des
   * droits de staff. Les deux sens sont nommés séparément, parce qu'ils
   * échouent pour des raisons différentes : « le bon prédicat est là » et
   * « l'ancien helper de rôles n'est pas revenu ». Le second est celui qui
   * manquait, et il se juge sur `prosrc` BRUT — l'invariant de P13-B est
   * littéral, commentaires compris.
   */
  perform pg_temp.noter('A', 'A6c. v_staff repose sur « entrainement en écriture » (P13-B)',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write'
               and p.prosrc like '%v_staff := (not v_systeme) and (''entrainement'' in (select public.categories_ecriture()))%'));

  perform pg_temp.noter('A', 'A6d. aucune fonction definer du schéma n''oppose plus le helper de rôles global',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
                   and p.prosrc like '%is_coach_or' || '_admin%'
                   and p.proname <> 'is_coach_or' || '_admin'));

  -- ⚠️ AUCUN DROIT N'A ÉTÉ OUVERT. La migration ne contient aucun `grant` ;
  -- on le constate ici sur la base, pas seulement sur le texte.
  perform pg_temp.noter('A', 'A7. la fonction du trigger n''est pas exécutable par authenticated',
    has_function_privilege('authenticated',
      'public.enforce_workout_feedback_write()', 'execute') is false);

  -- L'historique est INTACT : si des lignes existaient déjà, elles sont à NULL.
  select count(*) into v_n from public.workout_feedback where saisie_mode is not null;
  perform pg_temp.noter('A', 'A8. aucune ligne préexistante ne s''est vu attribuer un mode',
    v_n = 0);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- T1 à T4 — QUI SAISIT, SELON LA BASE
-- ════════════════════════════════════════════════════════════════════════════
-- Chaque acteur écrit le retour de l'élève A sur SA PROPRE clé de séance :
-- `workout_feedback` est unique par (élève, session_key), et quatre acteurs
-- sur la même clé se marcheraient dessus. On fait donc varier la clé, jamais
-- l'élève — c'est l'auteur qu'on teste, pas la cible.
do $$
declare
  v_eleveA uuid := '72000000-0000-4000-8000-000000000011';
  v_s1 uuid := '76000000-0000-4000-8000-000000000001';
  v_s2 uuid := '76000000-0000-4000-8000-000000000002';
  v_s3 uuid := '76000000-0000-4000-8000-000000000003';
  v_s4 uuid := '76000000-0000-4000-8000-000000000004';
  v_mode   text;
  v_par    uuid;
  v_le     timestamptz;
  v_cle    text;
begin
  /* ── T1. L'ÉLÈVE LUI-MÊME ───────────────────────────────────────────── */
  perform pg_temp.devenir('70000000-0000-4000-8000-000000000011');
  insert into public.workout_feedback (student_id, session_id, session_key, session_ref_label, completed)
  values (v_eleveA, v_s1, 'ignoré', 'ignoré', true);
  perform pg_temp.redevenir_systeme();

  select saisie_mode, saisie_par, saisie_le, session_key
    into v_mode, v_par, v_le, v_cle
    from public.workout_feedback where session_id = v_s1;
  perform pg_temp.noter('T', 'T1. l''élève qui saisit lui-même → autonome', v_mode = 'autonome');
  perform pg_temp.noter('T', 'T1b. l''auteur est son propre compte Auth',
    v_par = '70000000-0000-4000-8000-000000000011'::uuid);
  /*
   * ⚠️ LA BORNE HAUTE EST `clock_timestamp()`, PAS `now()`.
   *
   * Depuis que la fonction pose `clock_timestamp()`, la date de saisie est
   * postérieure au début de la transaction : `v_le <= now()` est donc faux
   * alors que tout va bien. C'est le contrôle qui était mal écrit, pas la
   * fonction — et il vaut mieux qu'il l'ait dit en rougissant.
   *
   * Ce qu'on veut affirmer : la date vient du SERVEUR, maintenant, et non de
   * la valeur envoyée par l'appelant (2020). D'où une fenêtre, large d'une
   * minute, qu'aucune valeur cliente plausible ne peut viser.
   */
  perform pg_temp.noter('T', 'T1c. la date de saisie est posée par le serveur, à l''instant',
    v_le is not null
    and v_le > clock_timestamp() - interval '1 minute'
    and v_le <= clock_timestamp());
  -- Au passage : la clé de séance envoyée par l'appelant est elle aussi
  -- REMPLACÉE par la base. Même doctrine que les trois colonnes de trace.
  perform pg_temp.noter('T', 'T1d. session_key est dérivée de la séance, pas reçue',
    v_cle = v_s1::text);

  /* ── T2. SON COACH AUTONOME (coaches.role = 'assistant') ────────────── */
  perform pg_temp.devenir('70000000-0000-4000-8000-000000000002');
  insert into public.workout_feedback (student_id, session_id, session_key, session_ref_label, completed)
  values (v_eleveA, v_s2, 'ignoré', 'ignoré', true);
  perform pg_temp.redevenir_systeme();

  select saisie_mode, saisie_par into v_mode, v_par
    from public.workout_feedback where session_id = v_s2;
  perform pg_temp.noter('T', 'T2. le coach de l''élève → presentiel', v_mode = 'presentiel');
  perform pg_temp.noter('T', 'T2b. l''auteur est le compte du COACH, pas celui de l''élève',
    v_par = '70000000-0000-4000-8000-000000000002'::uuid);

  /* ── T3. LE COLLABORATEUR — LE POINT DEMANDÉ EXPLICITEMENT ──────────── */
  -- ⚠️ `is_coach_or_admin()` ne le reconnaît pas. Si la dérivation s'appuyait
  -- sur ce helper, cette ligne serait classée « autonome » : la base
  -- affirmerait que l'élève a saisi une séance que quelqu'un d'autre a
  -- remplie pour lui. C'est le faux-vert que ce contrôle existe pour exclure.
  perform pg_temp.devenir('70000000-0000-4000-8000-000000000003');
  insert into public.workout_feedback (student_id, session_id, session_key, session_ref_label, completed)
  values (v_eleveA, v_s3, 'ignoré', 'ignoré', true);
  perform pg_temp.redevenir_systeme();

  select saisie_mode, saisie_par into v_mode, v_par
    from public.workout_feedback where session_id = v_s3;
  perform pg_temp.noter('T',
    'T3. un COLLABORATEUR (entrainement/ecriture, affecté) → presentiel', v_mode = 'presentiel');
  perform pg_temp.noter('T', 'T3b. l''auteur est le compte du collaborateur',
    v_par = '70000000-0000-4000-8000-000000000003'::uuid);

  /* ── T4. L'ADMINISTRATEUR DE CABINET ────────────────────────────────── */
  perform pg_temp.devenir('70000000-0000-4000-8000-000000000001');
  insert into public.workout_feedback (student_id, session_id, session_key, session_ref_label, completed)
  values (v_eleveA, v_s4, 'ignoré', 'ignoré', true);
  perform pg_temp.redevenir_systeme();

  select saisie_mode into v_mode from public.workout_feedback where session_id = v_s4;
  perform pg_temp.noter('T', 'T4. un administrateur → presentiel', v_mode = 'presentiel');
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- T5 — LA RLS RESTE LE SECOND REMPART
-- ════════════════════════════════════════════════════════════════════════════
-- La traçabilité DÉCRIT une écriture ; elle ne l'autorise pas. Un élève qui
-- écrirait le retour d'un autre serait proprement classé « presentiel » — et
-- c'est pour cela que ce contrôle existe : il doit être REFUSÉ bien avant,
-- par la politique d'insertion.
do $$
declare v_ok boolean;
begin
  perform pg_temp.devenir('70000000-0000-4000-8000-000000000012');  -- élève B
  v_ok := pg_temp.refuse($q$
    insert into public.workout_feedback (student_id, session_id, session_key, session_ref_label, completed)
    values ('72000000-0000-4000-8000-000000000011', '76000000-0000-4000-8000-000000000005',
            'ignoré', 'ignoré', true)
  $q$);
  perform pg_temp.redevenir_systeme();
  perform pg_temp.noter('T', 'T5. un élève ne peut pas écrire le retour d''un autre', v_ok);

  perform pg_temp.noter('T', 'T5b. et rien n''a été écrit',
    not exists (select 1 from public.workout_feedback
                 where session_id = '76000000-0000-4000-8000-000000000005'));
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- T6 — L'ÉCRITURE SYSTÈME N'AFFIRME AUCUN MODE
-- ════════════════════════════════════════════════════════════════════════════
-- Aucun claim JWT : `auth.uid()` est NULL. Il n'y a aucun humain derrière, et
-- prétendre « autonome » inventerait une information. NULL dit « on ne sait
-- pas », et `saisie_par is null` le rend reconnaissable.
do $$
declare v_mode text; v_par uuid;
begin
  perform pg_temp.redevenir_systeme();
  insert into public.workout_feedback (student_id, session_id, session_key, session_ref_label, completed)
  values ('72000000-0000-4000-8000-000000000012', '76000000-0000-4000-8000-000000000006',
          'ignoré', 'ignoré', true);

  select saisie_mode, saisie_par into v_mode, v_par
    from public.workout_feedback
   where session_id = '76000000-0000-4000-8000-000000000006';
  perform pg_temp.noter('T', 'T6. écriture système → aucun mode affirmé', v_mode is null);
  perform pg_temp.noter('T', 'T6b. et aucun auteur', v_par is null);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- T7 à T9 — LA TRACE SUIT LE RÉALISÉ, ET RIEN D'AUTRE
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_mode text; v_par uuid; v_le timestamptz; v_le2 timestamptz;
begin
  /* ── T7. UNE RÉPONSE DE COACH N'EST PAS UNE SAISIE ──────────────────── */
  -- `mp-t1` a été saisi par l'élève. Le coach le marque traité et répond :
  -- recalculer la trace ici lui attribuerait la saisie de son élève.
  select saisie_le into v_le from public.workout_feedback
   where session_id = '76000000-0000-4000-8000-000000000001';

  perform pg_temp.devenir('70000000-0000-4000-8000-000000000002');
  update public.workout_feedback
     set status = 'traité', coach_reply = 'Belle séance.'
   where session_id = '76000000-0000-4000-8000-000000000001';
  perform pg_temp.redevenir_systeme();

  select saisie_mode, saisie_par, saisie_le into v_mode, v_par, v_le2
    from public.workout_feedback
   where session_id = '76000000-0000-4000-8000-000000000001';
  perform pg_temp.noter('T', 'T7. une réponse de coach laisse le mode à autonome',
    v_mode = 'autonome');
  perform pg_temp.noter('T', 'T7b. l''auteur reste l''élève',
    v_par = '70000000-0000-4000-8000-000000000011'::uuid);
  /*
   * ⚠️ CE CONTRÔLE ÉTAIT VIDE, ET LE SABOTAGE SAB-T7C LE PROUVE.
   *
   * Tant que la fonction posait `now()`, les deux dates comparées venaient de
   * la MÊME transaction : `now()` y est figé, donc elles étaient égales quoi
   * qu'il arrive. Le contrôle passait même après avoir délibérément fait
   * recalculer la date sur une réponse de coach — c'est-à-dire exactement ce
   * qu'il prétend interdire.
   *
   * La fonction pose désormais `clock_timestamp()`, qui avance à chaque
   * instruction. L'égalité devient une information : elle ne peut venir que de
   * `new.saisie_le := old.saisie_le`. Et pour qu'aucune coïncidence d'horloge
   * ne la fabrique, SAB-T7C plus bas rejoue le scénario contre une fonction
   * sabotée et exige que ce contrôle ÉCHOUE.
   */
  perform pg_temp.noter('T', 'T7c. et la date de saisie n''a pas bougé (clock_timestamp)',
    v_le2 = v_le);

  /* ── T8. LE COACH CORRIGE LE RÉALISÉ ────────────────────────────────── */
  -- Là, c'est bien une saisie : le RPE global change.
  --
  -- ⚠️ UNE PAUSE DE 10 ms AVANT. `clock_timestamp()` est à la microseconde,
  -- donc deux instructions successives suffiraient presque toujours — mais
  -- « presque toujours » n'est pas une garantie, et un contrôle qui rougit une
  -- fois sur mille finit désarmé. La pause rend l'écart certain.
  perform pg_sleep(0.01);
  perform pg_temp.devenir('70000000-0000-4000-8000-000000000002');
  update public.workout_feedback set global_rpe = 8
   where session_id = '76000000-0000-4000-8000-000000000001';
  perform pg_temp.redevenir_systeme();

  select saisie_mode, saisie_par, saisie_le into v_mode, v_par, v_le2
    from public.workout_feedback
   where session_id = '76000000-0000-4000-8000-000000000001';
  perform pg_temp.noter('T', 'T8. un coach qui modifie le réalisé → presentiel',
    v_mode = 'presentiel');
  perform pg_temp.noter('T', 'T8b. l''auteur devient le coach',
    v_par = '70000000-0000-4000-8000-000000000002'::uuid);
  -- ⚠️ STRICTEMENT SUPÉRIEURE, pas « >= ». Le `>=` était satisfait par
  -- l'égalité, donc par l'absence de recalcul : il validait le contraire de
  -- ce qu'il annonçait.
  perform pg_temp.noter('T', 'T8c. et la date de saisie est RAFRAÎCHIE (strictement)',
    v_le2 > v_le);

  /* ── T9. L'ÉLÈVE REPREND LA MAIN ────────────────────────────────────── */
  perform pg_temp.devenir('70000000-0000-4000-8000-000000000011');
  update public.workout_feedback set global_comment = 'Je corrige moi-même.'
   where session_id = '76000000-0000-4000-8000-000000000001';
  perform pg_temp.redevenir_systeme();

  select saisie_mode, saisie_par into v_mode, v_par
    from public.workout_feedback
   where session_id = '76000000-0000-4000-8000-000000000001';
  perform pg_temp.noter('T', 'T9. l''élève qui resaisit → la trace repasse à autonome',
    v_mode = 'autonome');
  perform pg_temp.noter('T', 'T9b. et l''auteur redevient l''élève',
    v_par = '70000000-0000-4000-8000-000000000011'::uuid);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- T10 — CE QUE LE CLIENT ENVOIE EST REMPLACÉ, JAMAIS GARDÉ
-- ════════════════════════════════════════════════════════════════════════════
-- Même doctrine que `prescribed_snapshot` : la valeur reçue n'est pas
-- comparée, elle est écrasée. Une colonne de traçabilité qu'un client pourrait
-- écrire ne tracerait rien.
do $$
declare v_mode text; v_par uuid; v_le timestamptz;
begin
  perform pg_temp.devenir('70000000-0000-4000-8000-000000000002');  -- le coach
  insert into public.workout_feedback
    (student_id, session_id, session_key, session_ref_label, completed,
     saisie_mode, saisie_par, saisie_le)
  values ('72000000-0000-4000-8000-000000000011', '76000000-0000-4000-8000-000000000007',
          'ignoré', 'ignoré', true,
          -- Le mensonge que le client tenterait : « c'est l'élève, en 2020 ».
          'autonome', '70000000-0000-4000-8000-000000000011', '2020-01-01T00:00:00Z');
  perform pg_temp.redevenir_systeme();

  select saisie_mode, saisie_par, saisie_le into v_mode, v_par, v_le
    from public.workout_feedback
   where session_id = '76000000-0000-4000-8000-000000000007';
  perform pg_temp.noter('T', 'T10. le mode envoyé par le client est remplacé',
    v_mode = 'presentiel');
  perform pg_temp.noter('T', 'T10b. l''auteur envoyé par le client est remplacé',
    v_par = '70000000-0000-4000-8000-000000000002'::uuid);
  perform pg_temp.noter('T', 'T10c. la date envoyée par le client est remplacée',
    v_le > '2021-01-01'::timestamptz);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- T11 — LE VOCABULAIRE EST FERMÉ
-- ════════════════════════════════════════════════════════════════════════════
-- La contrainte ne peut pas être éprouvée par une écriture applicative : le
-- trigger réécrit la colonne avant qu'elle ne soit vérifiée. On l'éprouve donc
-- là où elle vit, en désactivant le trigger le temps d'un essai — ce qui est
-- aussi la preuve que la contrainte protège les écritures FUTURES, y compris
-- celles d'un code qui ne passerait plus par ce trigger.
do $$
declare v_ok boolean;
begin
  alter table public.workout_feedback disable trigger enforce_workout_feedback_write;
  v_ok := pg_temp.refuse($q$
    insert into public.workout_feedback
      (student_id, session_id, session_key, session_ref_label, completed, saisie_mode)
    values ('72000000-0000-4000-8000-000000000011', '76000000-0000-4000-8000-000000000008',
            'mp-t11', 'MP — vocabulaire', true, 'autre')
  $q$);
  alter table public.workout_feedback enable trigger enforce_workout_feedback_write;
  perform pg_temp.noter('T', 'T11. un mode hors vocabulaire est refusé par la contrainte', v_ok);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- S. SABOTAGES — un contrôle qui ne mord pas ne protège de rien
-- ════════════════════════════════════════════════════════════════════════════
-- Les quatre contrôles ajoutés après la revue (A6b, A6c, A6d, T7c) sont ici
-- mis à l'épreuve : on présente à chacun la régression exacte qu'il prétend
-- détecter, et on exige qu'il la voie. C'est la leçon de la revue : T7c
-- passait depuis le début, y compris contre une fonction délibérément cassée.
--
-- La fonction est sauvegardée, sabotée, interrogée, puis RESTAURÉE avant le
-- sabotage suivant — les contrôles T qui précèdent ont déjà tourné, et le
-- ROLLBACK final emporte de toute façon tout.

create temporary table _gardien_original (def text) on commit drop;
insert into _gardien_original
select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write';

create or replace function pg_temp.restaurer_gardien() returns void language plpgsql as $$
declare v_def text;
begin
  select def into v_def from _gardien_original;
  execute v_def;
end $$;

/* ── SAB-A6B : le search_path n'est plus celui de la convention ──────────── */
do $$
declare v_detecte boolean;
begin
  alter function public.enforce_workout_feedback_write() set search_path = '';
  v_detecte := not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write'
       and array_to_string(coalesce(p.proconfig, '{}'), ',') = 'search_path=public, pg_temp');
  perform pg_temp.restaurer_gardien();
  perform pg_temp.noter('S', 'SAB-A6B. un search_path ramené à '''' est détecté par A6b', v_detecte);
end $$;

/* ── SAB-A6C/D : l'ancien helper de rôles revient dans le gardien ────────── */
do $$
declare v_src text; v_c boolean; v_d boolean;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write';
  v_src := replace(v_src,
    'v_staff := (not v_systeme) and (''entrainement'' in (select public.categories_ecriture()));',
    'v_staff := (not v_systeme) and public.is_coach_or' || '_admin();');
  execute format(
    'create or replace function public.enforce_workout_feedback_write() returns trigger language plpgsql security definer set search_path = public, pg_temp as %L',
    v_src);

  -- A6c doit cesser de trouver le prédicat P13-B…
  v_c := not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write'
       and p.prosrc like '%v_staff := (not v_systeme) and (''entrainement'' in (select public.categories_ecriture()))%');
  -- … et A6d doit voir l'invariant P13-B rompu.
  v_d := exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
       and p.prosrc like '%is_coach_or' || '_admin%'
       and p.proname <> 'is_coach_or' || '_admin');

  perform pg_temp.restaurer_gardien();
  perform pg_temp.noter('S', 'SAB-A6C. la perte du prédicat P13-B est détectée par A6c', v_c);
  perform pg_temp.noter('S', 'SAB-A6D. le retour du helper de rôles est détecté par A6d', v_d);
end $$;

/* ── SAB-T7C : la date de saisie est recalculée sur une réponse de coach ─── */
-- C'est LE sabotage qui compte : avec `now()`, ce scénario passait le contrôle.
do $$
declare
  v_src text; v_le timestamptz; v_le2 timestamptz; v_detecte boolean;
  v_seance uuid := '76000000-0000-4000-8000-000000000003';  -- celle du collaborateur
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write';
  -- La branche de CONSERVATION se met à recalculer la date.
  v_src := replace(v_src,
    'new.saisie_le   := old.saisie_le;',
    'new.saisie_le   := clock_timestamp();');
  execute format(
    'create or replace function public.enforce_workout_feedback_write() returns trigger language plpgsql security definer set search_path = public, pg_temp as %L',
    v_src);

  select saisie_le into v_le from public.workout_feedback where session_id = v_seance;
  perform pg_sleep(0.01);
  -- Une écriture qui N'EST PAS une saisie : marquer « traité ».
  perform pg_temp.devenir('70000000-0000-4000-8000-000000000002');
  update public.workout_feedback set status = 'traité' where session_id = v_seance;
  perform pg_temp.redevenir_systeme();
  select saisie_le into v_le2 from public.workout_feedback where session_id = v_seance;

  perform pg_temp.restaurer_gardien();
  -- T7c affirme `v_le2 = v_le`. Contre le saboteur, cette égalité doit être
  -- FAUSSE : c'est la preuve que le contrôle sait voir la régression.
  v_detecte := v_le2 <> v_le;
  perform pg_temp.noter('S',
    'SAB-T7C. un recalcul de saisie_le sur une écriture non-saisie est détecté par T7c', v_detecte);
end $$;

/* ── SAB-T8C : la date de saisie N'EST PAS rafraîchie sur une vraie saisie ─ */
do $$
declare
  v_src text; v_le timestamptz; v_le2 timestamptz;
  v_seance uuid := '76000000-0000-4000-8000-000000000004';  -- celle de l'admin
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write';
  -- La branche de SAISIE cesse de rafraîchir la date.
  v_src := replace(v_src, 'new.saisie_le  := clock_timestamp();', 'new.saisie_le  := old.saisie_le;');
  execute format(
    'create or replace function public.enforce_workout_feedback_write() returns trigger language plpgsql security definer set search_path = public, pg_temp as %L',
    v_src);

  select saisie_le into v_le from public.workout_feedback where session_id = v_seance;
  perform pg_sleep(0.01);
  perform pg_temp.devenir('70000000-0000-4000-8000-000000000001');
  update public.workout_feedback set global_rpe = 5 where session_id = v_seance;
  perform pg_temp.redevenir_systeme();
  select saisie_le into v_le2 from public.workout_feedback where session_id = v_seance;

  perform pg_temp.restaurer_gardien();
  -- T8c affirme `v_le2 > v_le` : contre le saboteur, ce doit être faux.
  perform pg_temp.noter('S',
    'SAB-T8C. une date de saisie non rafraîchie sur une vraie saisie est détectée par T8c',
    not (v_le2 > v_le));
end $$;

/* ── SAB-RESTAURATION : le gardien est bien revenu à sa version réelle ───── */
do $$
begin
  perform pg_temp.noter('S', 'SAB-Z. après les sabotages, le gardien est restauré à l''identique',
    (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write')
    = (select def from _gardien_original));
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- BILAN
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_total int; v_ko int; r record;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_ko from _faits;
  raise notice '';
  for r in select section, libelle from _faits where not ok order by section, libelle loop
    raise warning 'RESTE À CORRIGER — %. %', r.section, r.libelle;
  end loop;
  raise notice '──────── % contrôles, % échec(s) ────────', v_total, v_ko;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- Z. RIEN NE SURVIT
-- ════════════════════════════════════════════════════════════════════════════
\echo ''
\echo '--- Traçabilité du mode présentiel : fin des contrôles. ROLLBACK. ---'
rollback;

do $$
begin
  if exists (
    select 1 from public.workout_feedback f
     where f.student_id in ('72000000-0000-4000-8000-000000000011',
                            '72000000-0000-4000-8000-000000000012')
  ) then
    raise warning 'ÉCHEC   — Z1. des retours de test survivent au ROLLBACK';
  elsif exists (select 1 from public.students where email like 'mp.%') then
    raise warning 'ÉCHEC   — Z2. des élèves de test survivent au ROLLBACK';
  elsif exists (select 1 from public.coaches where email like 'mp.%') then
    raise warning 'ÉCHEC   — Z3. du staff de test survit au ROLLBACK';
  else
    raise notice 'OK      — Z1/Z2/Z3. aucune donnée de test après le ROLLBACK';
  end if;
end $$;
