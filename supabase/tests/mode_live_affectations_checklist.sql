-- ============================================================================
-- Checklist PostgreSQL — MODE LIVE : QUI EST SAISISSABLE SUR QUELLE
-- PROGRAMMATION
--
--   npm run db:local:init          # base LOCALE : baseline + migrations
--   psql "$DATABASE_URL_LOCAL" -f supabase/tests/mode_live_affectations_checklist.sql
--
-- ⚠️ BASE LOCALE UNIQUEMENT. Ce fichier ÉCRIT (élèves, programmes, affectations)
-- et ne tient que par son ROLLBACK final.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LA QUESTION POSÉE
-- ────────────────────────────────────────────────────────────────────────────
-- Le mode Live part désormais d'une PROGRAMMATION et non plus d'une fiche
-- d'élève. Deux questions nouvelles en découlent, et aucune ne se répond en
-- lisant du TypeScript :
--
--   1. « Quels élèves cette programmation concerne-t-elle, pour CE compte ? »
--      — c'est la liste que la fenêtre « Choisir un élève » affiche ;
--   2. « Un élève listé est-il réellement saisissable ? » — c'est-à-dire la
--      base acceptera-t-elle le retour de séance qu'on s'apprête à écrire.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LE PIÈGE QUE CETTE CHECKLIST EXISTE POUR FERMER
-- ────────────────────────────────────────────────────────────────────────────
-- `assignedStudentIds`, côté application, MÉLANGE deux populations : les
-- affectations DIRECTES et les PROPRIÉTAIRES D'UNE COPIE, rattachés à la carte
-- du MODÈLE alors qu'ils s'entraînent sur une autre structure.
--
-- Ouvrir le Live pour un propriétaire de copie depuis le modèle n'est pas une
-- maladresse d'ergonomie : `student_owns_workout_session` REFUSE l'écriture,
-- et le refus arriverait en salle, au moment de valider, après la séance.
-- L1/L2 ci-dessous le prouvent sur la base — c'est ce qui justifie que la règle
-- d'affichage soit « affectation directe », mot pour mot celle de la base.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE VÉRIFIE
--   A.  le décor : une programmation, trois élèves, un modèle et une copie
--   L1  le propriétaire d'une COPIE n'est PAS saisissable sur le MODÈLE
--   L2  … et il l'est sur SA copie
--   L3  un élève en affectation DIRECTE est saisissable
--   L4  un doublon d'affectation est impossible (contrainte unique)
--   L5  une programmation sans affectation ne concerne personne
--   L6  le coach ne voit que SES élèves dans la liste
--   L7  le collaborateur entraînement/ÉCRITURE : visible et saisissable
--   L8  le collaborateur entraînement/LECTURE : visible, NON saisissable
--   L9  un coach étranger ne voit ni la programmation, ni ses séances
--   L10 URL forgée : écriture refusée pour un élève hors périmètre
--   P1-P6 ce qui compte comme « séance enregistrée » : élève ET coach, pas un
--         brouillon, pas un retour non terminé, une correction compte une fois
--   S.  SABOTAGES — la règle « affectation directe » est-elle nécessaire ?
--   Z.  rien ne survit au ROLLBACK
--
-- ⚠️ CE QU'ELLE NE PEUT PAS PROUVER : `requireStaffForStudent` vit dans
-- l'application et interroge la base avec le client service role, donc hors
-- RLS. Les contrôles ci-dessous décrivent ce que la BASE autorise — c'est le
-- second rempart, pas le premier. Le premier est éprouvé par
-- `scripts/tests/mode-live.mts`.
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

create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, coalesce(p_ok, false));
  if p_ok is true then raise notice 'OK      — %', p_libelle;
  else raise warning 'ÉCHEC   — %', p_libelle; end if;
end $$;

create or replace function pg_temp.devenir(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.systeme() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '', true); reset role; end $$;

/*
 * Une tentative d'écriture de retour de séance, sous le rôle courant.
 * Rend 'acceptée' / 'refusée (<sqlstate>)'.
 *
 * ⚠️ LA LIGNE EST RETIRÉE PAR (élève, séance), PAS PAR `session_key`.
 * Le gardien DÉRIVE `session_key` de la séance (`new.session_key :=
 * new.session_id::text`, migration 20260822090000) : la valeur 'essai' qu'on
 * envoie n'arrive jamais en base, et un `delete where session_key = 'essai'`
 * n'efface donc RIEN. La première version de ce fichier faisait exactement
 * cela, et la section P suivante butait sur la contrainte unique (élève,
 * séance) en essayant de réécrire une ligne censée avoir disparu. C'est le
 * même piège que celui noté en tête de
 * mode_presentiel_tracabilite_checklist.sql, à un endroit différent.
 *
 * Le nettoyage passe par un rôle sans RLS (`reset role`) : il doit effacer
 * même ce que l'acteur testé ne pourrait pas voir.
 */
create or replace function pg_temp.essai_saisie(p_student uuid, p_session uuid)
returns text language plpgsql as $$
declare v_resultat text;
begin
  begin
    insert into public.workout_feedback
      (student_id, session_id, session_key, session_ref_label, completed)
    values (p_student, p_session, 'essai', 'essai', true);
    v_resultat := 'acceptée';
  exception when others then
    return 'refusée (' || sqlstate || ')';
  end;
  return v_resultat;
end $$;

/** Efface une tentative, hors RLS, par ses clés réelles. */
create or replace function pg_temp.nettoyer_essai(p_student uuid, p_session uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
  delete from public.workout_feedback where student_id = p_student and session_id = p_session;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- A. LE DÉCOR
-- ════════════════════════════════════════════════════════════════════════════
-- Un coach et son admin, deux collaborateurs (écriture / lecture seule), un
-- coach étranger. Trois élèves. UNE programmation MODÈLE affectée aux élèves 1
-- et 2 ; une COPIE appartenant à l'élève 3 et dérivée de ce modèle ; une
-- programmation JAMAIS affectée.
do $$
declare
  u_admin  uuid := 'c0000000-0000-4000-8000-000000000001';
  u_coach  uuid := 'c0000000-0000-4000-8000-000000000002';
  u_cok    uuid := 'c0000000-0000-4000-8000-000000000003';
  u_cko    uuid := 'c0000000-0000-4000-8000-000000000004';
  u_etrang uuid := 'c0000000-0000-4000-8000-000000000005';
  u_e1 uuid := 'c0000000-0000-4000-8000-000000000011';
  u_e2 uuid := 'c0000000-0000-4000-8000-000000000012';
  u_e3 uuid := 'c0000000-0000-4000-8000-000000000013';
  u_e4 uuid := 'c0000000-0000-4000-8000-000000000014';
begin
  insert into auth.users (id, email) select v.id, v.m from (values
    (u_admin,'ml.admin@test.local'), (u_coach,'ml.coach@test.local'),
    (u_cok,'ml.cok@test.local'), (u_cko,'ml.cko@test.local'),
    (u_etrang,'ml.etranger@test.local'),
    (u_e1,'ml.e1@test.local'), (u_e2,'ml.e2@test.local'),
    (u_e3,'ml.e3@test.local'), (u_e4,'ml.e4@test.local')) v(id,m)
  on conflict (id) do nothing;

  insert into public.profiles (user_id, role, first_name, last_name, email) values
    (u_admin,'admin','MlAdmin','T','ml.admin@test.local'),
    (u_coach,'coach','MlCoach','T','ml.coach@test.local'),
    (u_cok,'coach','MlCok','T','ml.cok@test.local'),
    (u_cko,'coach','MlCko','T','ml.cko@test.local'),
    (u_etrang,'coach','MlEtranger','T','ml.etranger@test.local'),
    -- ⚠️ DEUX HOMONYMES VOLONTAIRES : élèves 1 et 4 portent le même nom. Le
    -- dédoublonnage de la fenêtre doit porter sur l'IDENTIFIANT, jamais sur le
    -- nom — c'est l'un des cas que le cahier des charges nomme.
    (u_e1,'student','Marie','Dupont','ml.e1@test.local'),
    (u_e2,'student','MlEleve2','T','ml.e2@test.local'),
    (u_e3,'student','MlEleve3','T','ml.e3@test.local'),
    (u_e4,'student','Marie','Dupont','ml.e4@test.local')
  on conflict (user_id) do update set role = excluded.role;

  insert into public.coaches (id, user_id, name, email, role, status) values
    ('c1000000-0000-4000-8000-000000000001',u_admin,'MlAdmin','ml.admin@test.local','admin','actif'),
    ('c1000000-0000-4000-8000-000000000002',u_coach,'MlCoach','ml.coach@test.local','assistant','actif'),
    ('c1000000-0000-4000-8000-000000000003',u_cok,'MlCok','ml.cok@test.local','collaborateur','actif'),
    ('c1000000-0000-4000-8000-000000000004',u_cko,'MlCko','ml.cko@test.local','collaborateur','actif'),
    ('c1000000-0000-4000-8000-000000000005',u_etrang,'MlEtranger','ml.etranger@test.local','assistant','actif');

  insert into public.students (id, user_id, coach_id, first_name, last_name, email, status, access_type) values
    ('c2000000-0000-4000-8000-000000000011',u_e1,'c1000000-0000-4000-8000-000000000002','Marie','Dupont','ml.e1@test.local','active','coaching'),
    ('c2000000-0000-4000-8000-000000000012',u_e2,'c1000000-0000-4000-8000-000000000002','MlEleve2','T','ml.e2@test.local','active','coaching'),
    ('c2000000-0000-4000-8000-000000000013',u_e3,'c1000000-0000-4000-8000-000000000002','MlEleve3','T','ml.e3@test.local','active','coaching'),
    ('c2000000-0000-4000-8000-000000000014',u_e4,'c1000000-0000-4000-8000-000000000005','Marie','Dupont','ml.e4@test.local','active','coaching');

  insert into public.collaborateur_eleves (collaborateur_id, student_id) values
    ('c1000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000011'),
    ('c1000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000011');
  insert into public.collaborateur_permissions (collaborateur_id, categorie, niveau) values
    ('c1000000-0000-4000-8000-000000000003','entrainement','ecriture'),
    ('c1000000-0000-4000-8000-000000000004','entrainement','lecture');

  -- Le MODÈLE, la COPIE de l'élève 3, et une programmation JAMAIS affectée.
  insert into public.programs (id, coach_id, name, status, program_mode, duration_weeks, owner_student_id) values
    ('c4000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','Modèle Live','actif','individuel',4, null),
    ('c4000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000002','Copie de MlEleve3','actif','individuel',4,'c2000000-0000-4000-8000-000000000013'),
    ('c4000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000002','Modèle jamais affecté','actif','individuel',4, null);

  insert into public.program_weeks (id, program_id, week_number) values
    ('c5000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001',1),
    ('c5000000-0000-4000-8000-000000000002','c4000000-0000-4000-8000-000000000001',2),
    ('c5000000-0000-4000-8000-000000000003','c4000000-0000-4000-8000-000000000002',1),
    ('c5000000-0000-4000-8000-000000000004','c4000000-0000-4000-8000-000000000003',1);

  insert into public.workout_sessions (id, program_id, program_week_id, day, name, muscle_group) values
    -- Le modèle : deux semaines, donc des séances PASSÉES et FUTURES.
    ('c6000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','lundi','Modèle S1','pectoraux'),
    ('c6000000-0000-4000-8000-000000000002','c4000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000002','lundi','Modèle S2','dos'),
    -- Une troisième séance du MODÈLE, pour éprouver le retour non terminé sans
    -- emprunter une séance de la copie — que la base refuserait, à juste titre.
    ('c6000000-0000-4000-8000-000000000005','c4000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000002','mardi','Modèle S2 bis','jambes'),
    -- La copie : SES propres séances, d'autres identifiants.
    ('c6000000-0000-4000-8000-000000000003','c4000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000003','lundi','Copie S1','pectoraux'),
    ('c6000000-0000-4000-8000-000000000004','c4000000-0000-4000-8000-000000000003','c5000000-0000-4000-8000-000000000004','lundi','Jamais S1','jambes');

  -- Affectations DIRECTES : élèves 1 et 2 sur le modèle, élève 3 sur SA copie.
  -- L'élève 3 n'a AUCUNE ligne vers le modèle : c'est tout le sujet.
  insert into public.assignments (student_id, content_type, content_id) values
    ('c2000000-0000-4000-8000-000000000011','programme','c4000000-0000-4000-8000-000000000001'),
    ('c2000000-0000-4000-8000-000000000012','programme','c4000000-0000-4000-8000-000000000001'),
    ('c2000000-0000-4000-8000-000000000013','programme','c4000000-0000-4000-8000-000000000002');
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.programs where name like 'Modèle%' or name like 'Copie%';
  perform pg_temp.noter('A', 'A1. le décor est en place (3 programmations)', v_n = 3);
  select count(*) into v_n from public.workout_sessions
   where program_id = 'c4000000-0000-4000-8000-000000000001';
  perform pg_temp.noter('A', 'A1b. le modèle porte trois séances', v_n = 3);
  select count(*) into v_n from public.assignments
   where content_type = 'programme'
     and content_id in ('c4000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000002');
  perform pg_temp.noter('A', 'A2. trois affectations directes', v_n = 3);
  perform pg_temp.noter('A', 'A3. la copie déclare bien son propriétaire',
    exists (select 1 from public.programs
             where id = 'c4000000-0000-4000-8000-000000000002'
               and owner_student_id = 'c2000000-0000-4000-8000-000000000013'));
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- L1 / L2 — LE MODÈLE N'EST PAS LA COPIE
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_r text;
begin
  perform pg_temp.devenir('c0000000-0000-4000-8000-000000000002');  -- le coach

  -- L1. L'élève 3 possède une COPIE de ce modèle. Saisir une séance DU MODÈLE
  --     en son nom doit être refusé par la base elle-même.
  v_r := pg_temp.essai_saisie('c2000000-0000-4000-8000-000000000013',
                              'c6000000-0000-4000-8000-000000000001');
  perform pg_temp.noter('L',
    'L1. le propriétaire d''une COPIE n''est pas saisissable sur le MODÈLE',
    v_r like 'refusée%');

  -- L2. Sur SA copie, en revanche, tout est normal.
  v_r := pg_temp.essai_saisie('c2000000-0000-4000-8000-000000000013',
                              'c6000000-0000-4000-8000-000000000003');
  perform pg_temp.noter('L', 'L2. … et il est saisissable sur SA copie', v_r = 'acceptée');

  -- L3. Un élève en affectation DIRECTE, sur le modèle : accepté.
  v_r := pg_temp.essai_saisie('c2000000-0000-4000-8000-000000000011',
                              'c6000000-0000-4000-8000-000000000001');
  perform pg_temp.noter('L', 'L3. un élève en affectation DIRECTE est saisissable',
    v_r = 'acceptée');

  perform pg_temp.systeme();
  perform pg_temp.nettoyer_essai('c2000000-0000-4000-8000-000000000013', 'c6000000-0000-4000-8000-000000000003');
  perform pg_temp.nettoyer_essai('c2000000-0000-4000-8000-000000000011', 'c6000000-0000-4000-8000-000000000001');
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- L4 / L5 — DOUBLONS ET PROGRAMMATION NON AFFECTÉE
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_ok boolean; v_n int;
begin
  -- L4. Le « doublon d'affectation » redouté n'existe pas : la base l'interdit.
  --     Le dédoublonnage de la fenêtre reste utile pour une autre raison —
  --     un élève peut remonter à la fois par `assignments` et par
  --     `owner_student_id` —, et il porte sur l'IDENTIFIANT.
  begin
    insert into public.assignments (student_id, content_type, content_id)
    values ('c2000000-0000-4000-8000-000000000011','programme','c4000000-0000-4000-8000-000000000001');
    v_ok := false;
  exception when others then v_ok := true;
  end;
  perform pg_temp.noter('L', 'L4. une seconde affectation au même programme est refusée', v_ok);

  -- L5. La programmation jamais affectée ne concerne personne : pas d'étiquette.
  select count(*) into v_n from public.assignments
   where content_type = 'programme' and content_id = 'c4000000-0000-4000-8000-000000000003';
  perform pg_temp.noter('L', 'L5. une programmation non affectée ne concerne aucun élève',
    v_n = 0
    and not exists (select 1 from public.programs
                     where id = 'c4000000-0000-4000-8000-000000000003'
                       and owner_student_id is not null));
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- L6 à L9 — CE QUE CHAQUE COMPTE VOIT DE LA LISTE
-- ════════════════════════════════════════════════════════════════════════════
-- La route lit `assignments` sous la RLS du compte, puis confronte chaque
-- candidat à `requireStaffForStudent`. On mesure ici la PREMIÈRE couche.
do $$
declare
  a record; v_vus int; v_ecriture int; v_seances int; v_prog int;
  v_modele uuid := 'c4000000-0000-4000-8000-000000000001';
begin
  for a in select * from (values
      ('coach',                      'c0000000-0000-4000-8000-000000000002'::uuid, 2, 2, 3, 1),
      ('administrateur',             'c0000000-0000-4000-8000-000000000001'::uuid, 2, 2, 3, 1),
      ('collaborateur ÉCRITURE',     'c0000000-0000-4000-8000-000000000003'::uuid, 1, 1, 3, 1),
      ('collaborateur LECTURE seule','c0000000-0000-4000-8000-000000000004'::uuid, 1, 0, 3, 1),
      ('coach ÉTRANGER',             'c0000000-0000-4000-8000-000000000005'::uuid, 0, 0, 0, 0)
    ) t(nom, compte, att_vus, att_ecriture, att_seances, att_prog)
  loop
    perform pg_temp.devenir(a.compte);
    select count(distinct g.student_id) into v_vus from public.assignments g
     where g.content_type = 'programme' and g.content_id = v_modele;
    select count(*) into v_ecriture from public.student_ids_entrainement_ecriture() as e(id)
     where e.id in (select g.student_id from public.assignments g
                     where g.content_type = 'programme' and g.content_id = v_modele);
    select count(*) into v_seances from public.workout_sessions where program_id = v_modele;
    select count(*) into v_prog from public.programs where id = v_modele;
    perform pg_temp.systeme();

    perform pg_temp.noter('L', format(
      'L6-9. %s : %s élève(s) vu(s) / %s en écriture / %s séance(s) / programmation %s',
      a.nom, v_vus, v_ecriture, v_seances,
      case when v_prog = 1 then 'visible' else 'invisible' end),
      v_vus = a.att_vus and v_ecriture = a.att_ecriture
      and v_seances = a.att_seances and v_prog = a.att_prog);
  end loop;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- L10 — URL FORGÉE
-- ════════════════════════════════════════════════════════════════════════════
-- Un coach qui remplacerait l'identifiant d'élève dans l'URL par celui d'un
-- élève d'un autre coach. La page le redirige (requirePresentielAccess) et la
-- route d'enregistrement le refuse (requireStaffForStudent) ; ici on vérifie le
-- DERNIER rempart, celui de la base.
do $$
declare v_r text;
begin
  perform pg_temp.devenir('c0000000-0000-4000-8000-000000000002');  -- coach
  v_r := pg_temp.essai_saisie('c2000000-0000-4000-8000-000000000014',  -- élève du coach ÉTRANGER
                              'c6000000-0000-4000-8000-000000000001');
  perform pg_temp.noter('L', 'L10. saisir pour un élève hors périmètre est refusé',
    v_r like 'refusée%');
  perform pg_temp.systeme();
  perform pg_temp.nettoyer_essai('c2000000-0000-4000-8000-000000000014', 'c6000000-0000-4000-8000-000000000001');
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- P. CE QUI COMPTE COMME « SÉANCE ENREGISTRÉE »
-- ════════════════════════════════════════════════════════════════════════════
-- Le planning Live tire DEUX indicateurs du même ensemble : le contour vert
-- d'une séance et la barre de progression. Cet ensemble est exactement le
-- résultat de la requête de `seancesTermineesDeLEleve` :
--
--     select session_id from workout_feedback
--      where student_id = :eleve and completed = true and session_id is not null
--
-- ⚠️ ELLE NE REGARDE NI `saisie_mode`, NI `saisie_par` — et c'est tout l'objet
-- de cette section. « Une séance enregistrée par le coach est-elle reconnue
-- comme une séance enregistrée par l'élève ? » ne se répond pas en lisant du
-- TypeScript : il faut écrire les deux lignes sous les deux identités et
-- constater qu'elles ressortent ensemble.
create or replace function pg_temp.seances_enregistrees(p_student uuid)
returns int language sql as $$
  select count(*)::int from public.workout_feedback
   where student_id = p_student and completed is true and session_id is not null
$$;

do $$
declare
  v_e1 uuid := 'c2000000-0000-4000-8000-000000000011';
  v_s1 uuid := 'c6000000-0000-4000-8000-000000000001';
  v_s2 uuid := 'c6000000-0000-4000-8000-000000000002';
  v_n int;
  v_mode1 text;
  v_mode2 text;
begin
  -- P1. Rien d'enregistré : l'ensemble est vide. Un brouillon local, par
  --     construction, n'a jamais atteint cette table — il n'y a donc rien à
  --     écarter ici, et c'est la meilleure garantie possible.
  v_n := pg_temp.seances_enregistrees(v_e1);
  perform pg_temp.noter('P', 'P1. aucune séance enregistrée au départ (un brouillon local n''y est pas)',
    v_n = 0);

  -- P2. L'ÉLÈVE valide sa séance.
  perform pg_temp.devenir('c0000000-0000-4000-8000-000000000011');
  insert into public.workout_feedback (student_id, session_id, session_key, session_ref_label, completed)
  values (v_e1, v_s1, 'x', 'x', true);
  perform pg_temp.systeme();
  perform pg_temp.noter('P', 'P2. une séance validée par l''ÉLÈVE entre dans l''ensemble',
    pg_temp.seances_enregistrees(v_e1) = 1);

  -- P3. LE COACH valide une autre séance du même élève, en présentiel.
  perform pg_temp.devenir('c0000000-0000-4000-8000-000000000002');
  insert into public.workout_feedback (student_id, session_id, session_key, session_ref_label, completed)
  values (v_e1, v_s2, 'y', 'y', true);
  perform pg_temp.systeme();
  perform pg_temp.noter('P', 'P3. une séance validée par le COACH entre dans le MÊME ensemble',
    pg_temp.seances_enregistrees(v_e1) = 2);

  -- Et la traçabilité les distingue, elle — sans que la progression s'en serve.
  select saisie_mode into v_mode1 from public.workout_feedback where session_id = v_s1;
  select saisie_mode into v_mode2 from public.workout_feedback where session_id = v_s2;
  perform pg_temp.noter('P',
    'P3b. la trace distingue les deux auteurs, alors que le COMPTE les traite pareil',
    v_mode1 = 'autonome' and v_mode2 = 'presentiel');

  -- P4. Une CORRECTION ne crée pas de seconde ligne : l'index unique
  --     (student_id, session_id) l'interdit, et le compte ne bouge pas.
  perform pg_temp.devenir('c0000000-0000-4000-8000-000000000002');
  update public.workout_feedback set global_rpe = 9 where session_id = v_s1;
  perform pg_temp.systeme();
  perform pg_temp.noter('P', 'P4. une séance corrigée reste comptée UNE fois',
    pg_temp.seances_enregistrees(v_e1) = 2);

  -- P5. Un retour envoyé SANS la case « séance terminée » ne compte pas.
  perform pg_temp.devenir('c0000000-0000-4000-8000-000000000011');
  insert into public.workout_feedback (student_id, session_id, session_key, session_ref_label, completed)
  values (v_e1, 'c6000000-0000-4000-8000-000000000005', 'z', 'z', false);
  perform pg_temp.systeme();
  perform pg_temp.noter('P', 'P5. un retour non terminé (completed = false) ne compte pas',
    pg_temp.seances_enregistrees(v_e1) = 2);

  -- P6. Et une séance dévalidée en ressort : l'ensemble décrit l'état, pas
  --     l'histoire.
  perform pg_temp.devenir('c0000000-0000-4000-8000-000000000011');
  update public.workout_feedback set completed = false where session_id = v_s1;
  perform pg_temp.systeme();
  perform pg_temp.noter('P', 'P6. une séance dévalidée quitte l''ensemble',
    pg_temp.seances_enregistrees(v_e1) = 1);

  -- Remise en état pour les sections suivantes.
  perform pg_temp.systeme();
  delete from public.workout_feedback where student_id = v_e1;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- S. SABOTAGES — la règle « affectation directe » est-elle nécessaire ?
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_r text;
begin
  /*
   * SAB-L1 : on donne à l'élève 3 une affectation DIRECTE au modèle, c'est-à-dire
   * exactement ce que l'application ferait si elle traitait un propriétaire de
   * copie comme un élève du modèle. La base accepte alors — ce qui montre que
   * le refus de L1 ne vient PAS d'un hasard de décor, mais bien de l'absence
   * d'affectation directe.
   */
  insert into public.assignments (student_id, content_type, content_id)
  values ('c2000000-0000-4000-8000-000000000013','programme','c4000000-0000-4000-8000-000000000001');

  perform pg_temp.devenir('c0000000-0000-4000-8000-000000000002');
  v_r := pg_temp.essai_saisie('c2000000-0000-4000-8000-000000000013',
                              'c6000000-0000-4000-8000-000000000001');
  perform pg_temp.systeme();
  perform pg_temp.nettoyer_essai('c2000000-0000-4000-8000-000000000013', 'c6000000-0000-4000-8000-000000000001');
  delete from public.assignments
   where student_id = 'c2000000-0000-4000-8000-000000000013'
     and content_id = 'c4000000-0000-4000-8000-000000000001';

  perform pg_temp.noter('S',
    'SAB-L1. avec une affectation directe, la même écriture PASSE : c''est bien elle que L1 mesure',
    v_r = 'acceptée');
end $$;

do $$
declare v_r text;
begin
  /*
   * SAB-L10 : on rattache l'élève du coach étranger au coach testé. L'écriture
   * refusée en L10 devient alors acceptée — donc L10 mesure bien le périmètre,
   * et pas une impossibilité technique quelconque.
   */
  update public.students set coach_id = 'c1000000-0000-4000-8000-000000000002'
   where id = 'c2000000-0000-4000-8000-000000000014';
  insert into public.assignments (student_id, content_type, content_id)
  values ('c2000000-0000-4000-8000-000000000014','programme','c4000000-0000-4000-8000-000000000001');

  perform pg_temp.devenir('c0000000-0000-4000-8000-000000000002');
  v_r := pg_temp.essai_saisie('c2000000-0000-4000-8000-000000000014',
                              'c6000000-0000-4000-8000-000000000001');
  perform pg_temp.systeme();
  perform pg_temp.nettoyer_essai('c2000000-0000-4000-8000-000000000014', 'c6000000-0000-4000-8000-000000000001');

  perform pg_temp.noter('S',
    'SAB-L10. rattaché au coach, le même élève devient saisissable : L10 mesure bien le périmètre',
    v_r = 'acceptée');
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
\echo '--- Mode Live : affectations et périmètres. ROLLBACK. ---'
rollback;

do $$
begin
  if exists (select 1 from public.students where email like 'ml.%') then
    raise warning 'ÉCHEC   — Z1. des élèves de test survivent au ROLLBACK';
  elsif exists (select 1 from public.programs where name like 'Modèle%' or name like 'Copie de Ml%') then
    raise warning 'ÉCHEC   — Z2. des programmations de test survivent au ROLLBACK';
  elsif exists (
    select 1 from public.workout_feedback f
     where f.student_id in ('c2000000-0000-4000-8000-000000000011',
                            'c2000000-0000-4000-8000-000000000012',
                            'c2000000-0000-4000-8000-000000000013',
                            'c2000000-0000-4000-8000-000000000014')
  ) then
    raise warning 'ÉCHEC   — Z3. des retours d''essai survivent au ROLLBACK';
  else
    raise notice 'OK      — Z1/Z2/Z3. aucune donnée de test après le ROLLBACK';
  end if;
end $$;
