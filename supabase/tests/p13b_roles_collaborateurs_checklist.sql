-- ════════════════════════════════════════════════════════════════════════════
-- P13-B — CHECKLIST DES RÔLES ET DU CLOISONNEMENT PAR CATÉGORIE
-- ════════════════════════════════════════════════════════════════════════════
-- À EXÉCUTER SUR LA BASE LOCALE UNIQUEMENT, jamais sur la production.
--
--     npm run db:local:init
--     psql "$DATABASE_URL_LOCAL" -f supabase/tests/p13b_roles_collaborateurs_checklist.sql
--
-- Tout se passe dans UNE transaction annulée : le décor est créé, interrogé,
-- puis disparaît. Rien ne survit — le contrôle Z le vérifie.
--
-- Ce que les tests TypeScript ne peuvent PAS prouver : eux lisent le texte des
-- migrations, ils vérifient la forme. Seule une base dit si un collaborateur
-- en lecture seule échoue vraiment à supprimer une ligne.

\set ON_ERROR_STOP on

begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;

create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, p_ok);
  if p_ok then raise notice 'OK      — %', p_libelle;
  else raise warning 'ÉCHEC   — %', p_libelle; end if;
end $$;

-- Un refus d'écriture se manifeste de deux façons : 0 ligne touchée (la RLS a
-- filtré), ou 42501 (un trigger a levé). Les deux sont des refus. Une
-- violation de contrainte (23505, 23503) n'en est PAS un : elle signalerait un
-- décor incohérent, et la faire passer pour un refus masquerait un vrai trou.
create or replace function pg_temp.ecriture_refusee(p_sql text)
returns boolean language plpgsql as $$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return v_n = 0;
exception
  when insufficient_privilege then return true;
  when unique_violation then
    raise notice '  (23505 — décor incohérent, PAS un refus : %)', p_sql; return false;
  when foreign_key_violation then
    raise notice '  (23503 — décor incohérent, PAS un refus : %)', p_sql; return false;
  when others then
    raise notice '  (SQLSTATE % — PAS un refus : %)', sqlstate, p_sql; return false;
end $$;

create or replace function pg_temp.lecture_compte(p_sql text)
returns int language plpgsql as $$
declare v_n int;
begin execute p_sql into v_n; return coalesce(v_n, 0); end $$;

do $$ declare s text; begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._faits to authenticated, anon', s);
end $$;


-- ── A. LE DÉCOR ────────────────────────────────────────────────────────────
-- Un administrateur, un coach autonome (assistant), deux collaborateurs aux
-- permissions différentes, trois élèves. Les identifiants sont figés pour que
-- les contrôles puissent les citer.
do $$
declare
  u_admin   uuid := '00000000-0000-4000-8000-000000000001';
  u_coachb  uuid := '00000000-0000-4000-8000-000000000002';
  u_collabn uuid := '00000000-0000-4000-8000-000000000003';  -- nutrition, écriture
  u_collabe uuid := '00000000-0000-4000-8000-000000000004';  -- entraînement, LECTURE SEULE
  u_eleve1  uuid := '00000000-0000-4000-8000-000000000011';
  u_eleve2  uuid := '00000000-0000-4000-8000-000000000012';
begin
  -- Même forme que la checklist P13-A : (id, email) suffit.
  insert into auth.users (id, email)
  select v.id, v.mail
    from (values (u_admin,'p13b.admin@test.local'), (u_coachb,'p13b.coachb@test.local'),
                 (u_collabn,'p13b.collabn@test.local'), (u_collabe,'p13b.collabe@test.local'),
                 (u_eleve1,'p13b.eleve1@test.local'), (u_eleve2,'p13b.eleve2@test.local')) v(id, mail)
  on conflict (id) do nothing;

  -- `profiles.role` vaut 'coach' pour TOUT le staff non-admin : c'est le
  -- constat qui a fait renoncer à y ajouter 'collaborateur'. Le rôle fin est
  -- dans `coaches.role`.
  insert into public.profiles (user_id, role, first_name, last_name, email) values
    (u_admin,  'admin',  'P13bAdmin',  'S', 'p13b.admin@test.local'),
    (u_coachb, 'coach',  'P13bCoachB', 'S', 'p13b.coachb@test.local'),
    (u_collabn,'coach',  'P13bCollabN','S', 'p13b.collabn@test.local'),
    (u_collabe,'coach',  'P13bCollabE','S', 'p13b.collabe@test.local'),
    (u_eleve1, 'student','P13bEleve1', 'S', 'p13b.eleve1@test.local'),
    (u_eleve2, 'student','P13bEleve2', 'S', 'p13b.eleve2@test.local')
  on conflict (user_id) do update set role = excluded.role;

  -- `coaches.status` vaut bien 'actif' — contrainte coaches_status_check,
  -- en français. C'est `students.status` qui est en anglais ; les deux tables
  -- ne partagent pas le même vocabulaire, et c'est ce qui m'avait trompé.
  insert into public.coaches (id, user_id, name, email, role, status) values
    ('aaaaaaaa-0000-4000-8000-000000000001', u_admin,   'P13bAdmin',   'p13b.admin@test.local',   'admin',        'actif'),
    ('aaaaaaaa-0000-4000-8000-000000000002', u_coachb,  'P13bCoachB',  'p13b.coachb@test.local',  'assistant',    'actif'),
    ('aaaaaaaa-0000-4000-8000-000000000003', u_collabn, 'P13bCollabN', 'p13b.collabn@test.local', 'collaborateur','actif'),
    ('aaaaaaaa-0000-4000-8000-000000000004', u_collabe, 'P13bCollabE', 'p13b.collabe@test.local', 'collaborateur','actif');

  -- Élève 1 et 2 appartiennent au COACH B. Le coach principal ne change jamais.
  -- `students_status_check` : CHECK (status in ('active','paused','completed')).
  -- La valeur est en ANGLAIS, contrairement à `coaches.status`.
  insert into public.students (id, user_id, coach_id, first_name, last_name, email, status, access_type) values
    ('bbbbbbbb-0000-4000-8000-000000000001', u_eleve1, 'aaaaaaaa-0000-4000-8000-000000000002', 'P13bEleve1','S','p13b.eleve1@test.local','active','coaching'),
    ('bbbbbbbb-0000-4000-8000-000000000002', u_eleve2, 'aaaaaaaa-0000-4000-8000-000000000002', 'P13bEleve2','S','p13b.eleve2@test.local','active','coaching');

  -- Les DEUX collaborateurs sont affectés au MÊME élève 1, avec des catégories
  -- différentes : c'est le scénario qui prouve que l'affectation ne suffit pas.
  insert into public.collaborateur_eleves (collaborateur_id, student_id) values
    ('aaaaaaaa-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001'),
    ('aaaaaaaa-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000001');

  insert into public.collaborateur_permissions (collaborateur_id, categorie, niveau) values
    ('aaaaaaaa-0000-4000-8000-000000000003', 'nutrition',    'ecriture'),
    ('aaaaaaaa-0000-4000-8000-000000000004', 'entrainement', 'lecture');

  -- Une note de coach et une mesure, sur chacun des deux élèves.
  -- La colonne de contenu de `coach_notes` s'appelle `text`, pas `content`.
  insert into public.coach_notes (student_id, coach_id, text) values
    ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'note eleve 1'),
    ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002', 'note eleve 2');

  -- Une indisponibilité HISTORIQUE, sans propriétaire : le cas réel des 2
  -- lignes de production.
  insert into public.coach_unavailabilities (id, category, title, start_at, end_at)
  values ('cccccccc-0000-4000-8000-000000000001', 'unavailability', 'historique sans coach_id',
          now() + interval '30 day', now() + interval '30 day 1 hour');
end $$;

create or replace function pg_temp.devenir(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end $$;


-- ── B. LE COLLABORATEUR NUTRITION : SA CATÉGORIE, ET RIEN D'AUTRE ─────────
do $$
declare v_n int;
begin
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000003');

  -- Il VOIT l'identité de son élève affecté : sans cela il ne peut rien faire.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.students
          where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$);
  perform pg_temp.noter('B', 'B1. le collaborateur voit l''élève qui lui est affecté', v_n = 1);

  -- Il ne voit PAS l'élève non affecté, bien qu'il ait le même coach principal.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.students
          where id = 'bbbbbbbb-0000-4000-8000-000000000002'$q$);
  perform pg_temp.noter('B', 'B2. il ne voit PAS un élève non affecté du même coach', v_n = 0);

  -- Il n'a PAS suivi_eleve : les notes de coach lui sont fermées, même sur
  -- l'élève qui lui est affecté. C'est l'étanchéité entre catégories.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.coach_notes$q$);
  perform pg_temp.noter('B', 'B3. sans suivi_eleve, aucune note de coach — même sur son élève affecté', v_n = 0);

  perform pg_temp.noter('B', 'B4. il ne peut pas écrire une note de coach',
    pg_temp.ecriture_refusee($q$update public.coach_notes set text = 'piratée'
      where student_id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$));

  -- La facturation ne s'ouvre par aucune catégorie.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.payments$q$);
  perform pg_temp.noter('B', 'B5. aucun accès aux paiements', v_n = 0);
  v_n := pg_temp.lecture_compte($q$select count(*) from public.coaches$q$);
  perform pg_temp.noter('B', 'B6. aucun accès à la table des comptes coach', v_n = 0);

  -- Les tables globales restent fermées, quelle que soit la catégorie.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.email_logs$q$);
  perform pg_temp.noter('B', 'B7. aucun accès aux journaux d''emails (table globale)', v_n = 0);

  -- L'indisponibilité HISTORIQUE sans propriétaire ne lui est pas accessible.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.coach_unavailabilities
          where id = 'cccccccc-0000-4000-8000-000000000001'$q$);
  perform pg_temp.noter('B', 'B8. une indisponibilité sans coach_id lui reste invisible', v_n = 0);

  perform pg_temp.noter('B', 'B9. il ne peut pas supprimer une indisponibilité sans propriétaire',
    pg_temp.ecriture_refusee($q$delete from public.coach_unavailabilities
      where id = 'cccccccc-0000-4000-8000-000000000001'$q$));

  -- LE POINT CRITIQUE : il ne peut pas s'approprier son élève.
  update public.students set coach_id = 'aaaaaaaa-0000-4000-8000-000000000003'
   where id = 'bbbbbbbb-0000-4000-8000-000000000001';
  reset role;
  v_n := (select count(*) from public.students
           where id = 'bbbbbbbb-0000-4000-8000-000000000001'
             and coach_id = 'aaaaaaaa-0000-4000-8000-000000000002');
  perform pg_temp.noter('B', 'B10. il ne peut PAS réécrire students.coach_id pour s''approprier l''élève', v_n = 1);
end $$;


-- ── C. LE COLLABORATEUR ENTRAÎNEMENT EN LECTURE SEULE ─────────────────────
do $$
declare v_n int;
begin
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000004');

  v_n := pg_temp.lecture_compte($q$select count(*) from public.students
          where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$);
  perform pg_temp.noter('C', 'C1. il voit son élève affecté', v_n = 1);

  -- Lecture seule : aucune écriture, d'aucune sorte, dans SA catégorie.
  perform pg_temp.noter('C', 'C2. lecture seule : il ne peut pas INSÉRER un retour d''entraînement',
    pg_temp.ecriture_refusee($q$insert into public.workout_feedback (student_id, completed)
      values ('bbbbbbbb-0000-4000-8000-000000000001', true)$q$));

  perform pg_temp.noter('C', 'C3. lecture seule : il ne peut pas SUPPRIMER une affectation de programme',
    pg_temp.ecriture_refusee($q$delete from public.assignments
      where student_id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$));

  -- Et sa catégorie ne lui ouvre pas la nutrition, sur le même élève.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans$q$);
  perform pg_temp.noter('C', 'C4. entraînement n''ouvre pas la nutrition du même élève', v_n = 0);
end $$;


-- ── D. LES RÔLES EXISTANTS NE RÉGRESSENT PAS ──────────────────────────────
do $$
declare v_admin int; v_coachb int; v_hist int;
begin
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000001');
  v_admin := pg_temp.lecture_compte($q$select count(*) from public.students$q$);
  v_hist  := pg_temp.lecture_compte($q$select count(*) from public.coach_unavailabilities
              where id = 'cccccccc-0000-4000-8000-000000000001'$q$);
  perform pg_temp.noter('D', 'D1. l''administrateur voit tous les élèves', v_admin >= 2);
  perform pg_temp.noter('D', 'D2. l''administrateur voit les indisponibilités sans propriétaire', v_hist = 1);

  perform pg_temp.devenir('00000000-0000-4000-8000-000000000002');
  v_coachb := pg_temp.lecture_compte($q$select count(*) from public.students$q$);
  v_hist   := pg_temp.lecture_compte($q$select count(*) from public.coach_unavailabilities
               where id = 'cccccccc-0000-4000-8000-000000000001'$q$);
  perform pg_temp.noter('D', 'D3. l''assistant voit ses deux élèves', v_coachb = 2);
  perform pg_temp.noter('D', 'D4. l''assistant voit les indisponibilités sans propriétaire', v_hist = 1);
  perform pg_temp.noter('D', 'D5. l''assistant écrit une note de coach sur son élève',
    not pg_temp.ecriture_refusee($q$update public.coach_notes set text = 'maj coach'
      where student_id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$));

  -- L'assistant n'est PAS administrateur : la facturation lui est fermée.
  -- C'est un RESSERREMENT voulu par rapport à l'existant.
  perform pg_temp.noter('D', 'D6. l''assistant n''atteint pas la facturation',
    pg_temp.lecture_compte($q$select count(*) from public.payments$q$) = 0);
end $$;


-- ── E. LES RPC SECURITY DEFINER NE CONTOURNENT PLUS RIEN ──────────────────
do $$
declare v_ok boolean;
begin
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000003');

  -- Le collaborateur nutrition n'a pas agenda_communication : la RPC doit le
  -- refuser, et pas seulement la policy.
  begin
    perform public.create_appointment_atomic(
      'bbbbbbbb-0000-4000-8000-000000000002', 'RDV pirate', '', 'Autre',
      now() + interval '10 day', now() + interval '10 day 1 hour', '', '', '');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
           when others then v_ok := false;
  end;
  perform pg_temp.noter('E', 'E1. create_appointment_atomic refuse un élève non affecté', v_ok);

  begin
    perform public.create_coach_event_atomic(
      'unavailability', 'pirate', '', '', false,
      now() + interval '11 day', now() + interval '11 day 1 hour');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
           when others then v_ok := false;
  end;
  perform pg_temp.noter('E', 'E2. create_coach_event_atomic refuse sans agenda_communication', v_ok);

  begin
    perform public.update_coach_event_atomic(
      'cccccccc-0000-4000-8000-000000000001', 'pirate', '', '', false,
      now() + interval '12 day', now() + interval '12 day 1 hour');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
           when others then v_ok := false;
  end;
  perform pg_temp.noter('E', 'E3. update_coach_event_atomic refuse une ligne sans propriétaire', v_ok);
end $$;


-- ── F. LA RÉVOCATION PREND EFFET ──────────────────────────────────────────
do $$
declare v_avant int; v_apres int;
begin
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000003');
  v_avant := pg_temp.lecture_compte($q$select count(*) from public.students
              where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$);

  reset role;
  delete from public.collaborateur_eleves
   where collaborateur_id = 'aaaaaaaa-0000-4000-8000-000000000003';

  perform pg_temp.devenir('00000000-0000-4000-8000-000000000003');
  v_apres := pg_temp.lecture_compte($q$select count(*) from public.students
              where id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$);

  perform pg_temp.noter('F', 'F1. révoquer l''affectation retire l''accès immédiatement',
    v_avant = 1 and v_apres = 0);
end $$;


-- ══════════════════════════════════════════════════════════════════════════
-- G. LE CŒUR NUTRITION (migration 20261011120000)
--
-- Avant cette migration, un collaborateur nutrition affecté obtenait ZÉRO
-- plan : les huit tables du cœur opposaient les ensembles de PROPRIÉTÉ de
-- P13-A (`nutrition_plan_ids_geres()` → `is_coach_of_student()` →
-- `students.coach_id`), que l'affectation explicite ne touche jamais.
--
-- Décor PROPRE à cette section : la section F a révoqué l'affectation du
-- collaborateur nutrition d'origine, et un contrôle qui en dépendrait serait
-- vert ou rouge selon l'ordre d'exécution.
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare
  u_nl uuid := '00000000-0000-4000-8000-000000000005';  -- nutrition, LECTURE
  u_ne uuid := '00000000-0000-4000-8000-000000000006';  -- nutrition, ÉCRITURE
begin
  -- La section F s'achève en `authenticated` (set_config local) : sans ce
  -- retour, le décor ci-dessous échouerait sur `auth.users`.
  reset role;

  insert into auth.users (id, email)
  select v.id, v.mail from (values (u_nl,'p13b.nutril@test.local'), (u_ne,'p13b.nutrie@test.local')) v(id, mail)
  on conflict (id) do nothing;

  insert into public.profiles (user_id, role, first_name, last_name, email) values
    (u_nl, 'coach', 'P13bNutriL', 'S', 'p13b.nutril@test.local'),
    (u_ne, 'coach', 'P13bNutriE', 'S', 'p13b.nutrie@test.local')
  on conflict (user_id) do update set role = excluded.role;

  insert into public.coaches (id, user_id, name, email, role, status) values
    ('aaaaaaaa-0000-4000-8000-000000000005', u_nl, 'P13bNutriL', 'p13b.nutril@test.local', 'collaborateur', 'actif'),
    ('aaaaaaaa-0000-4000-8000-000000000006', u_ne, 'P13bNutriE', 'p13b.nutrie@test.local', 'collaborateur', 'actif');

  -- Tous deux affectés à l'ÉLÈVE 1 seulement. L'élève 2 a le même coach
  -- principal : c'est lui qui prouve que l'affectation, et non le cabinet,
  -- délimite la portée.
  insert into public.collaborateur_eleves (collaborateur_id, student_id) values
    ('aaaaaaaa-0000-4000-8000-000000000005', 'bbbbbbbb-0000-4000-8000-000000000001'),
    ('aaaaaaaa-0000-4000-8000-000000000006', 'bbbbbbbb-0000-4000-8000-000000000001');

  insert into public.collaborateur_permissions (collaborateur_id, categorie, niveau) values
    ('aaaaaaaa-0000-4000-8000-000000000005', 'nutrition', 'lecture'),
    ('aaaaaaaa-0000-4000-8000-000000000006', 'nutrition', 'ecriture');

  -- Trois plans : l'élève affecté, l'élève NON affecté, et un plan MODÈLE du
  -- coach principal (sans élève, donc hors de portée de toute affectation).
  insert into public.nutrition_plans (id, student_id, coach_id, name, status) values
    ('dddddddd-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'Plan eleve 1', 'actif'),
    ('dddddddd-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002', 'Plan eleve 2', 'actif'),
    ('dddddddd-0000-4000-8000-000000000003', null, 'aaaaaaaa-0000-4000-8000-000000000002', 'Plan modele coach B', 'actif');

  -- La cascade complète du plan de l'élève 1 : profil, cible, jour, repas,
  -- créneau de choix, option. Chaque table du cœur est ainsi peuplée.
  insert into public.nutrition_plan_profiles (id, plan_id, profile_key) values
    ('eeeeeeee-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 'base');
  insert into public.nutrition_meal_slot_targets (profile_id, slot) values
    ('eeeeeeee-0000-4000-8000-000000000001', 'lunch');
  insert into public.nutrition_days (id, plan_id, day, profile_key) values
    ('eeeeeeee-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000001', 'monday', 'base');
  insert into public.meals (id, nutrition_day_id, slot) values
    ('eeeeeeee-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000002', 'lunch');
  insert into public.meal_choice_slots (id, meal_id, position, label) values
    ('eeeeeeee-0000-4000-8000-000000000004', 'eeeeeeee-0000-4000-8000-000000000003', 1, 'Feculent');
  -- Une option de choix cite EXACTEMENT un aliment (contrainte
  -- `meal_choice_options_cible_unique`) : il faut donc une ligne de catalogue,
  -- et elle appartient au coach principal.
  -- `owner_coach_id` à NULL : un aliment du catalogue GLOBAL, lisible par
  -- tous (policy `food_catalog_select_global`). Le catalogue privé d'un coach
  -- reste hors de portée d'un collaborateur, et ce n'est pas l'objet ici.
  -- `slug` est une colonne GÉNÉRÉE : elle ne s'écrit pas.
  insert into public.food_catalog (id, owner_coach_id, name, protein_per_100, carb_per_100, fat_per_100) values
    ('eeeeeeee-0000-4000-8000-0000000000f1', null, 'Riz basmati p13b', 3, 28, 1);
  insert into public.meal_choice_options (id, slot_id, position, catalog_food_id) values
    ('eeeeeeee-0000-4000-8000-000000000005', 'eeeeeeee-0000-4000-8000-000000000004', 1, 'eeeeeeee-0000-4000-8000-0000000000f1');

  -- Le journal de l'élève et ses tables dépendantes.
  insert into public.nutrition_daily_logs (student_id, nutrition_plan_id, log_date) values
    ('bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', current_date);
  insert into public.consumed_meals (id, student_id, consumed_on, kind, label) values
    ('eeeeeeee-0000-4000-8000-000000000006', 'bbbbbbbb-0000-4000-8000-000000000001', current_date, 'student', 'Dejeuner');
  insert into public.meal_entries (student_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g, consumed_meal_id) values
    ('bbbbbbbb-0000-4000-8000-000000000001', 'free', 'Riz', 100, 'g', 3, 28, 1, 'eeeeeeee-0000-4000-8000-000000000006');
  insert into public.planned_meals (id, student_id, planned_on, meal_id, slot_key, label) values
    ('eeeeeeee-0000-4000-8000-000000000007', 'bbbbbbbb-0000-4000-8000-000000000001', current_date, 'eeeeeeee-0000-4000-8000-000000000003', 'lunch', 'Dejeuner prevu');
  -- Même contrainte « exactement une cible » que les options de choix.
  insert into public.planned_meal_items (planned_meal_id, student_id, choice_slot_id, position, quantity, unit, catalog_food_id) values
    ('eeeeeeee-0000-4000-8000-000000000007', 'bbbbbbbb-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000004', 1, 100, 'g', 'eeeeeeee-0000-4000-8000-0000000000f1');
  insert into public.planned_meal_skipped_slots (planned_meal_id, student_id, choice_slot_id) values
    ('eeeeeeee-0000-4000-8000-000000000007', 'bbbbbbbb-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000004');
end $$;


-- ── G/LECTURE : IL VOIT, ET IL N'ÉCRIT RIEN ───────────────────────────────
do $$
declare v_n int;
begin
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000005');

  -- LE CONTRÔLE QUI ÉCHOUAIT AVANT LA MIGRATION 20261011120000.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans
          where id = 'dddddddd-0000-4000-8000-000000000001'$q$);
  perform pg_temp.noter('G', 'G1. nutrition/lecture : il VOIT le plan de son élève affecté', v_n = 1);

  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans
          where id = 'dddddddd-0000-4000-8000-000000000002'$q$);
  perform pg_temp.noter('G', 'G2. il ne voit PAS le plan d''un élève non affecté', v_n = 0);

  -- Un plan modèle n'appartient à aucun élève : aucune affectation ne l'atteint.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans
          where id = 'dddddddd-0000-4000-8000-000000000003'$q$);
  perform pg_temp.noter('G', 'G3. il ne voit PAS le plan MODÈLE du coach principal', v_n = 0);

  -- Toute la cascade, table par table : un maillon fermé rendrait le plan
  -- illisible en pratique.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plan_profiles$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.nutrition_meal_slot_targets$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.nutrition_days$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.meals$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.meal_choice_slots$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.meal_choice_options$q$);
  perform pg_temp.noter('G', 'G4. il voit les SIX tables de la cascade du plan (profil, cible, jour, repas, créneau, option)', v_n = 6);

  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_daily_logs$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.consumed_meals$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.meal_entries$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.planned_meals$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.planned_meal_items$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.planned_meal_skipped_slots$q$);
  perform pg_temp.noter('G', 'G5. il voit le journal et les repas consommés/planifiés de son élève', v_n = 6);

  -- ET MAINTENANT LE POINT QUI JUSTIFIE DEUX ENSEMBLES SÉPARÉS : aucune de
  -- ces écritures ne doit passer. Avec un seul ensemble `FOR ALL`, toutes
  -- passaient dès que la lecture était accordée.
  perform pg_temp.noter('G', 'G6. lecture seule : il ne peut pas modifier le plan',
    pg_temp.ecriture_refusee($q$update public.nutrition_plans set name = 'pirate'
      where id = 'dddddddd-0000-4000-8000-000000000001'$q$));

  perform pg_temp.noter('G', 'G7. lecture seule : il ne peut pas ajouter un jour au plan',
    pg_temp.ecriture_refusee($q$insert into public.nutrition_days (plan_id, day, profile_key)
      values ('dddddddd-0000-4000-8000-000000000001', 'tuesday', 'base')$q$));

  perform pg_temp.noter('G', 'G8. lecture seule : il ne peut pas modifier un repas',
    pg_temp.ecriture_refusee($q$update public.meals set slot = 'dinner'
      where id = 'eeeeeeee-0000-4000-8000-000000000003'$q$));

  perform pg_temp.noter('G', 'G9. lecture seule : il ne peut pas supprimer une option de choix',
    pg_temp.ecriture_refusee($q$delete from public.meal_choice_options
      where id = 'eeeeeeee-0000-4000-8000-000000000005'$q$));

  perform pg_temp.noter('G', 'G10. lecture seule : il ne peut pas écrire le journal de l''élève',
    pg_temp.ecriture_refusee($q$update public.nutrition_daily_logs set log_date = current_date - 1
      where student_id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$));

  perform pg_temp.noter('G', 'G11. lecture seule : il ne peut pas créer un plan pour son élève',
    pg_temp.ecriture_refusee($q$insert into public.nutrition_plans (student_id, name, status)
      values ('bbbbbbbb-0000-4000-8000-000000000001', 'plan pirate', 'actif')$q$));

  perform pg_temp.noter('G', 'G12. lecture seule : il ne peut pas créer un plan modèle',
    pg_temp.ecriture_refusee($q$insert into public.nutrition_plans (student_id, coach_id, name, status)
      values (null, 'aaaaaaaa-0000-4000-8000-000000000005', 'modele pirate', 'actif')$q$));
end $$;


-- ── G/ÉCRITURE : IL TRAVAILLE, ET SEULEMENT CHEZ LUI ──────────────────────
do $$
declare v_n int;
begin
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000006');

  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans
          where id = 'dddddddd-0000-4000-8000-000000000001'$q$);
  perform pg_temp.noter('G', 'G13. nutrition/ecriture : il voit le plan de son élève affecté', v_n = 1);

  update public.nutrition_plans set name = 'Plan revu par le collaborateur'
   where id = 'dddddddd-0000-4000-8000-000000000001';
  get diagnostics v_n = row_count;
  perform pg_temp.noter('G', 'G14. il peut MODIFIER le plan de son élève affecté', v_n = 1);

  insert into public.nutrition_days (id, plan_id, day, profile_key)
  values ('eeeeeeee-0000-4000-8000-00000000000a', 'dddddddd-0000-4000-8000-000000000001', 'tuesday', 'base');
  insert into public.meals (id, nutrition_day_id, slot)
  values ('eeeeeeee-0000-4000-8000-00000000000b', 'eeeeeeee-0000-4000-8000-00000000000a', 'dinner');
  insert into public.meal_choice_slots (id, meal_id, position, label)
  values ('eeeeeeee-0000-4000-8000-00000000000c', 'eeeeeeee-0000-4000-8000-00000000000b', 1, 'Proteine');
  insert into public.meal_choice_options (slot_id, position, catalog_food_id)
  values ('eeeeeeee-0000-4000-8000-00000000000c', 1, 'eeeeeeee-0000-4000-8000-0000000000f1');
  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_days
          where id = 'eeeeeeee-0000-4000-8000-00000000000a'$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.meal_choice_options
          where slot_id = 'eeeeeeee-0000-4000-8000-00000000000c'$q$);
  perform pg_temp.noter('G', 'G15. il peut CONSTRUIRE la cascade (jour, repas, créneau, option)', v_n = 2);

  update public.nutrition_daily_logs set log_date = log_date
   where student_id = 'bbbbbbbb-0000-4000-8000-000000000001';
  get diagnostics v_n = row_count;
  perform pg_temp.noter('G', 'G16. il peut écrire le journal de son élève affecté', v_n = 1);

  -- L'élève NON affecté reste hors de portée, en lecture comme en écriture.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans
          where id = 'dddddddd-0000-4000-8000-000000000002'$q$);
  perform pg_temp.noter('G', 'G17a. il ne voit pas le plan d''un élève non affecté', v_n = 0);
  perform pg_temp.noter('G', 'G17b. il ne peut pas modifier le plan d''un élève non affecté',
    pg_temp.ecriture_refusee($q$update public.nutrition_plans set name = 'pirate'
      where id = 'dddddddd-0000-4000-8000-000000000002'$q$));
  perform pg_temp.noter('G', 'G17c. il ne peut pas créer un plan pour un élève non affecté',
    pg_temp.ecriture_refusee($q$insert into public.nutrition_plans (student_id, name, status)
      values ('bbbbbbbb-0000-4000-8000-000000000002', 'plan pirate', 'actif')$q$));

  -- La suppression du plan d'un élève n'était permise à AUCUN coach : le
  -- niveau `ecriture` ne l'élargit pas.
  perform pg_temp.noter('G', 'G18. il ne peut PAS supprimer le plan d''un élève, même affecté',
    pg_temp.ecriture_refusee($q$delete from public.nutrition_plans
      where id = 'dddddddd-0000-4000-8000-000000000001'$q$));

  perform pg_temp.noter('G', 'G19. il ne peut pas créer un plan MODÈLE',
    pg_temp.ecriture_refusee($q$insert into public.nutrition_plans (student_id, coach_id, name, status)
      values (null, 'aaaaaaaa-0000-4000-8000-000000000006', 'modele pirate', 'actif')$q$));

  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans
          where student_id is null$q$);
  perform pg_temp.noter('G', 'G20. aucun plan modèle ne lui est visible', v_n = 0);

  -- APPROPRIATION. Il peut modifier le plan, mais pas s'en déclarer
  -- propriétaire : le trigger restaure la colonne.
  update public.nutrition_plans set coach_id = 'aaaaaaaa-0000-4000-8000-000000000006'
   where id = 'dddddddd-0000-4000-8000-000000000001';
  reset role;
  v_n := (select count(*) from public.nutrition_plans
           where id = 'dddddddd-0000-4000-8000-000000000001'
             and coach_id = 'aaaaaaaa-0000-4000-8000-000000000002');
  perform pg_temp.noter('G', 'G21. il ne peut pas se déclarer propriétaire du plan (coach_id reste au coach principal)', v_n = 1);

  -- DÉPLACEMENT HORS PORTÉE : le `with check` doit refuser.
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000006');
  perform pg_temp.noter('G', 'G22. il ne peut pas déplacer le plan vers un élève non affecté',
    pg_temp.ecriture_refusee($q$update public.nutrition_plans
      set student_id = 'bbbbbbbb-0000-4000-8000-000000000002'
      where id = 'dddddddd-0000-4000-8000-000000000001'$q$));

  -- ÉTANCHÉITÉ : la nutrition n'ouvre aucune autre catégorie.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.coach_notes$q$);
  perform pg_temp.noter('G', 'G23a. nutrition n''ouvre pas suivi_eleve (aucune note de coach)', v_n = 0);
  v_n := pg_temp.lecture_compte($q$select count(*) from public.programs$q$);
  perform pg_temp.noter('G', 'G23b. nutrition n''ouvre pas entrainement (aucun programme)', v_n = 0);
  v_n := pg_temp.lecture_compte($q$select count(*) from public.appointments$q$);
  perform pg_temp.noter('G', 'G23c. nutrition n''ouvre pas agenda_communication (aucun rendez-vous)', v_n = 0);

  -- TABLES GLOBALES ET ADMINISTRATIVES : fermées, quelle que soit la catégorie.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.payments$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.email_logs$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.coaches$q$);
  perform pg_temp.noter('G', 'G24. aucun accès aux tables globales (paiements, journaux d''emails, comptes coach)', v_n = 0);

  -- Il voit bien l'identité de son élève (préalable, pas une catégorie) mais
  -- pas celle de l'élève non affecté.
  v_n := pg_temp.lecture_compte($q$select count(*) from public.students$q$);
  perform pg_temp.noter('G', 'G25. il ne voit QUE l''élève qui lui est affecté', v_n = 1);
end $$;


-- ── G/CONTOURNEMENTS ──────────────────────────────────────────────────────
-- Les huit RPC `SECURITY DEFINER` du journal écrivent HORS RLS. Elles sont
-- gardées par `current_student_id()`, qui vaut NULL pour un collaborateur :
-- aucune ne doit lui servir de porte de service.
do $$
declare v_n int; v_definer int;
begin
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000006');

  v_n := pg_temp.lecture_compte($q$select case when public.current_student_id() is null then 1 else 0 end$q$);
  perform pg_temp.noter('G', 'G26a. current_student_id() est NULL pour un collaborateur', v_n = 1);

  begin
    perform public.supprimer_entree('00000000-0000-0000-0000-000000000000');
    perform pg_temp.noter('G', 'G26b. une RPC SECURITY DEFINER du journal refuse un collaborateur', false);
  exception
    when others then
      perform pg_temp.noter('G', 'G26b. une RPC SECURITY DEFINER du journal refuse un collaborateur', true);
  end;

  reset role;
  -- Les dix nouvelles fonctions de portée : SECURITY DEFINER, `pg_temp` en
  -- DERNIER dans search_path, EXECUTE retiré à public et anon.
  select count(*) into v_definer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('nutrition_plan_ids_lecture','nutrition_plan_ids_ecriture',
                       'nutrition_plan_profile_ids_lecture','nutrition_plan_profile_ids_ecriture',
                       'nutrition_day_ids_lecture','nutrition_day_ids_ecriture',
                       'meal_ids_lecture','meal_ids_ecriture',
                       'meal_choice_slot_ids_lecture','meal_choice_slot_ids_ecriture')
     and p.prosecdef
     and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute');
  perform pg_temp.noter('G', 'G27. les 10 fonctions de portée : definer, pg_temp en dernier, anon sans EXECUTE', v_definer = 10);

  -- Plus aucune policy du cœur nutrition ne doit opposer un ensemble de
  -- PROPRIÉTÉ : ce serait le défaut d'origine, revenu.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public'
     and tablename in ('nutrition_plans','nutrition_days','nutrition_plan_profiles',
                       'nutrition_meal_slot_targets','meals','meal_choice_slots',
                       'meal_choice_options','nutrition_daily_logs')
     and (coalesce(qual,'') || coalesce(with_check,'')) ~
         '(nutrition_plan_ids_geres|nutrition_day_ids_geres|meal_ids_geres|meal_choice_slot_ids_geres|nutrition_plan_profile_ids_geres|student_ids_geres|is_coach_of_student)';
  perform pg_temp.noter('G', 'G28. aucune policy du cœur nutrition ne repose plus sur la propriété P13-A', v_n = 0);
end $$;


-- ── G/LA VOIE RÉELLE DE L'INTERFACE : LA RPC D'ENREGISTREMENT ─────────────
-- `save_nutrition_plan_v2` est le SEUL chemin par lequel l'espace admin
-- enregistre un plan (lib/supabase/nutrition.ts). Tout ce qui précède
-- vérifiait les policies table par table ; ces trois contrôles vérifient que
-- le parcours que l'utilisateur emprunte réellement donne le même verdict.
--
-- Elle est `SECURITY INVOKER` : elle s'exécute donc sous la RLS de l'appelant,
-- et c'est précisément ce qui est mesuré ici. Si elle passait un jour en
-- `SECURITY DEFINER`, ces contrôles rougiraient — c'est leur seconde raison
-- d'être.
--
-- ⚠️ LES ASSERTIONS PORTENT SUR L'ÉTAT DE LA BASE, PAS SUR UN CODE D'ERREUR.
-- La RPC lève `P0001` quand le plan lui est invisible, ce que
-- `pg_temp.ecriture_refusee` refuse (à raison) de compter pour un refus de
-- permission. On regarde donc la seule chose qui ne se discute pas : le plan
-- a-t-il changé.
--
-- ⚠️ CHAQUE NOM ATTENDU EST LU AVANT L'APPEL, JAMAIS ÉCRIT EN DUR. Première
-- version de ce bloc : G40 comparait à « Plan eleve 1 », le nom du décor. Or
-- G14 a déjà renommé ce plan en « Plan revu par le collaborateur » — G40
-- rougissait donc pour une mauvaise raison, et G41, qui attendait ce même
-- nom, passait sans rien prouver. Le nom d'arrivée de G41 est maintenant
-- DISTINCT de celui en place, et la comparaison porte sur avant/après : un
-- contrôle qui ne peut plus réussir par coïncidence.
do $$
declare
  v_accepte boolean;
  v_avant text;
  v_apres text;
  v_proprietaire uuid;
begin
  -- 1) NIVEAU LECTURE : la RPC ne doit pas écrire davantage que la policy.
  select name into v_avant from public.nutrition_plans
   where id = 'dddddddd-0000-4000-8000-000000000001';
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000005');
  begin
    perform public.save_nutrition_plan_v2(jsonb_build_object(
      'plan_id', 'dddddddd-0000-4000-8000-000000000001',
      'plan', jsonb_build_object('name', 'Plan force par lecture seule')));
    v_accepte := true;
  exception when others then
    v_accepte := false;
  end;
  reset role;
  select name into v_apres from public.nutrition_plans
   where id = 'dddddddd-0000-4000-8000-000000000001';
  perform pg_temp.noter('G',
    'G40. niveau lecture : la RPC d''enregistrement ne modifie pas le plan',
    v_apres = v_avant and v_apres <> 'Plan force par lecture seule');

  -- 2) NIVEAU ÉCRITURE, ÉLÈVE AFFECTÉ : le parcours doit ABOUTIR. C'est le
  --    contrôle qui prouve que la correction sert à quelque chose — sans lui,
  --    tout fermer rendrait la checklist verte.
  select name into v_avant from public.nutrition_plans
   where id = 'dddddddd-0000-4000-8000-000000000001';
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000006');
  begin
    perform public.save_nutrition_plan_v2(jsonb_build_object(
      'plan_id', 'dddddddd-0000-4000-8000-000000000001',
      'plan', jsonb_build_object('name', 'Plan enregistre par la RPC')));
    v_accepte := true;
  exception when others then
    v_accepte := false;
    raise notice '  (RPC refusée pour le collaborateur ecriture : % — %)', sqlstate, sqlerrm;
  end;
  reset role;
  select name, coach_id into v_apres, v_proprietaire from public.nutrition_plans
   where id = 'dddddddd-0000-4000-8000-000000000001';
  perform pg_temp.noter('G',
    'G41. niveau ecriture : la RPC enregistre le plan de son élève affecté',
    v_accepte and v_apres = 'Plan enregistre par la RPC' and v_avant <> v_apres);
  -- Et il n'est pas devenu propriétaire au passage.
  perform pg_temp.noter('G',
    'G42. la RPC ne le rend pas propriétaire : coach_id reste le coach principal',
    v_proprietaire = 'aaaaaaaa-0000-4000-8000-000000000002');

  -- 3) ÉLÈVE NON AFFECTÉ : la même RPC, le même niveau, et rien ne bouge.
  select name into v_avant from public.nutrition_plans
   where id = 'dddddddd-0000-4000-8000-000000000002';
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000006');
  begin
    perform public.save_nutrition_plan_v2(jsonb_build_object(
      'plan_id', 'dddddddd-0000-4000-8000-000000000002',
      'plan', jsonb_build_object('name', 'Plan pirate')));
    v_accepte := true;
  exception when others then
    v_accepte := false;
  end;
  reset role;
  select name into v_apres from public.nutrition_plans
   where id = 'dddddddd-0000-4000-8000-000000000002';
  perform pg_temp.noter('G',
    'G43. la RPC refuse l''élève non affecté, et son plan reste intact',
    v_apres = v_avant and v_apres <> 'Plan pirate');
end $$;


-- ── G/LES DEUX CONDITIONS SONT NÉCESSAIRES ────────────────────────────────
-- Retirer l'affectation, ou retirer la permission : l'accès doit tomber dans
-- les DEUX cas. C'est ce qui distingue « affecté » de « autorisé ».
do $$
declare v_avant int; v_apres int;
begin
  -- 1) La permission reste, l'affectation part.
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000006');
  v_avant := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans
              where id = 'dddddddd-0000-4000-8000-000000000001'$q$);
  reset role;
  delete from public.collaborateur_eleves
   where collaborateur_id = 'aaaaaaaa-0000-4000-8000-000000000006';
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000006');
  v_apres := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans
              where id = 'dddddddd-0000-4000-8000-000000000001'$q$);
  perform pg_temp.noter('G', 'G29. permission sans affectation : l''accès au plan tombe', v_avant = 1 and v_apres = 0);

  -- 2) L'affectation reste, la permission part.
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000005');
  v_avant := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans
              where id = 'dddddddd-0000-4000-8000-000000000001'$q$);
  reset role;
  delete from public.collaborateur_permissions
   where collaborateur_id = 'aaaaaaaa-0000-4000-8000-000000000005';
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000005');
  v_apres := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans
              where id = 'dddddddd-0000-4000-8000-000000000001'$q$);
  perform pg_temp.noter('G', 'G30. affectation sans permission : l''accès au plan tombe aussi', v_avant = 1 and v_apres = 0);
end $$;


-- ── G/UNE AUTRE CATÉGORIE N'OUVRE PAS LA NUTRITION ────────────────────────
do $$
declare v_n int;
begin
  -- Le collaborateur ENTRAÎNEMENT du décor A, affecté au même élève 1.
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000004');
  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.nutrition_days$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.meals$q$)
       + pg_temp.lecture_compte($q$select count(*) from public.nutrition_daily_logs$q$);
  perform pg_temp.noter('G', 'G31. un collaborateur ENTRAÎNEMENT affecté ne voit aucune donnée nutritionnelle', v_n = 0);
end $$;


-- ── G/LES RÔLES HISTORIQUES SONT INTACTS ──────────────────────────────────
do $$
declare v_n int;
begin
  -- LE COACH PRINCIPAL (assistant) : ses deux élèves, son plan modèle.
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000002');
  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans$q$);
  perform pg_temp.noter('G', 'G32. le coach principal voit ses 3 plans (2 élèves + son modèle)', v_n = 3);

  update public.nutrition_plans set name = 'Plan revu par le coach'
   where id = 'dddddddd-0000-4000-8000-000000000002';
  get diagnostics v_n = row_count;
  perform pg_temp.noter('G', 'G33. le coach principal écrit toujours le plan de SON élève', v_n = 1);

  delete from public.nutrition_plans where id = 'dddddddd-0000-4000-8000-000000000003';
  get diagnostics v_n = row_count;
  perform pg_temp.noter('G', 'G34. le coach principal supprime toujours SON plan modèle', v_n = 1);

  -- L'ÉLÈVE : son plan, et son journal.
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000011');
  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans
          where student_id = 'bbbbbbbb-0000-4000-8000-000000000001'$q$);
  perform pg_temp.noter('G', 'G35. l''élève lit toujours son propre plan', v_n = 1);
  v_n := pg_temp.lecture_compte($q$select count(*) from public.meal_entries$q$);
  perform pg_temp.noter('G', 'G36. l''élève lit toujours ses propres entrées de repas', v_n = 1);
  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans
          where student_id = 'bbbbbbbb-0000-4000-8000-000000000002'$q$);
  perform pg_temp.noter('G', 'G37. l''élève ne voit pas le plan d''un autre élève', v_n = 0);

  -- L'ADMINISTRATEUR : tout, sans condition.
  perform pg_temp.devenir('00000000-0000-4000-8000-000000000001');
  v_n := pg_temp.lecture_compte($q$select count(*) from public.nutrition_plans$q$);
  perform pg_temp.noter('G', 'G38. l''administrateur voit tous les plans restants', v_n = 2);
  update public.nutrition_plans set name = 'Plan revu par l''admin'
   where id = 'dddddddd-0000-4000-8000-000000000001';
  get diagnostics v_n = row_count;
  perform pg_temp.noter('G', 'G39. l''administrateur écrit sans condition', v_n = 1);
  reset role;
end $$;


-- ── H. LA DERNIÈRE PORTE : provision_program_copy ─────────────────────────
-- `provision_program_copy` est `SECURITY DEFINER` : elle écrit HORS RLS. Sa
-- garde acceptait `profiles.role in ('service','admin','coach')`, c'est-à-dire
-- TOUT le staff non administrateur — collaborateurs compris. Mesuré avant
-- correctif : un collaborateur sans permission ni affectation créait un
-- programme ET une affectation pour un élève qu'il ne voyait même pas.
--
-- ⚠️ LES CONTRÔLES REGARDENT LA BASE, PAS LE CODE DE LA CONDITION. Chaque cas
-- compte les lignes réellement créées dans `programs` et `assignments`, puis
-- les efface pour que le cas suivant reparte de zéro. Un refus qui laisserait
-- une ligne derrière lui serait rouge, et une autorisation qui n'écrirait rien
-- aussi : c'est ce second sens qui empêche de rendre la checklist verte en
-- fermant tout.
--
-- Décor PROPRE à cette section : les collaborateurs de la section A et G
-- portent des catégories nutrition, et la section G/LES DEUX CONDITIONS leur
-- a retiré affectation et permission. Huit acteurs neufs, donc, et des
-- identifiants qui ne croisent aucun des précédents.
do $$
declare
  u_coach_a  uuid := '00000000-0000-4000-8000-00000000a001';
  u_coach_b  uuid := '00000000-0000-4000-8000-00000000a002';
  u_rien  uuid := '00000000-0000-4000-8000-00000000a003';  -- rien du tout
  u_perm  uuid := '00000000-0000-4000-8000-00000000a004';  -- permission, pas d'affectation
  u_aff  uuid := '00000000-0000-4000-8000-00000000a005';  -- affectation, pas de permission
  u_lect  uuid := '00000000-0000-4000-8000-00000000a006';  -- entrainement/LECTURE + affectation
  u_ecr  uuid := '00000000-0000-4000-8000-00000000a007';  -- entrainement/ECRITURE + affectation
  u_eleve1  uuid := '00000000-0000-4000-8000-00000000a008';
  u_eleve2  uuid := '00000000-0000-4000-8000-00000000a009';
begin
  reset role;
  insert into auth.users (id, email)
  select v.id, v.mail from (values
    (u_coach_a,'p13b.h.coacha@test.local'), (u_coach_b,'p13b.h.coachb@test.local'),
    (u_rien,'p13b.h.c0@test.local'),     (u_perm,'p13b.h.cperm@test.local'),
    (u_aff,'p13b.h.caff@test.local'),   (u_lect,'p13b.h.clect@test.local'),
    (u_ecr,'p13b.h.cecr@test.local'),
    (u_eleve1,'p13b.h.eleve1@test.local'), (u_eleve2,'p13b.h.eleve2@test.local')) v(id, mail)
  on conflict (id) do nothing;

  insert into public.profiles (user_id, role, first_name, last_name, email) values
    (u_coach_a,'coach','P13bHCoachA','S','p13b.h.coacha@test.local'),
    (u_coach_b,'coach','P13bHCoachB','S','p13b.h.coachb@test.local'),
    (u_rien,'coach','P13bHC0','S','p13b.h.c0@test.local'),
    (u_perm,'coach','P13bHCPerm','S','p13b.h.cperm@test.local'),
    (u_aff,'coach','P13bHCAff','S','p13b.h.caff@test.local'),
    (u_lect,'coach','P13bHCLect','S','p13b.h.clect@test.local'),
    (u_ecr,'coach','P13bHCEcr','S','p13b.h.cecr@test.local'),
    (u_eleve1,'student','P13bHEleve1','S','p13b.h.eleve1@test.local'),
    (u_eleve2,'student','P13bHEleve2','S','p13b.h.eleve2@test.local')
  on conflict (user_id) do update set role = excluded.role;

  insert into public.coaches (id, user_id, name, email, role, status) values
    ('aaaaaaaa-0000-4000-8000-00000000a001', u_coach_a, 'P13bHCoachA','p13b.h.coacha@test.local','assistant','actif'),
    ('aaaaaaaa-0000-4000-8000-00000000a002', u_coach_b, 'P13bHCoachB','p13b.h.coachb@test.local','assistant','actif'),
    ('aaaaaaaa-0000-4000-8000-00000000a003', u_rien, 'P13bHC0','p13b.h.c0@test.local','collaborateur','actif'),
    ('aaaaaaaa-0000-4000-8000-00000000a004', u_perm, 'P13bHCPerm','p13b.h.cperm@test.local','collaborateur','actif'),
    ('aaaaaaaa-0000-4000-8000-00000000a005', u_aff, 'P13bHCAff','p13b.h.caff@test.local','collaborateur','actif'),
    ('aaaaaaaa-0000-4000-8000-00000000a006', u_lect, 'P13bHCLect','p13b.h.clect@test.local','collaborateur','actif'),
    ('aaaaaaaa-0000-4000-8000-00000000a007', u_ecr, 'P13bHCEcr','p13b.h.cecr@test.local','collaborateur','actif');

  -- L'élève 1 appartient au coach A, l'élève 2 au coach B. C'est l'élève 2 qui
  -- prouve qu'un assistant ne copie pas chez le voisin.
  insert into public.students (id, user_id, coach_id, first_name, last_name, email, status, access_type) values
    ('bbbbbbbb-0000-4000-8000-00000000a001', u_eleve1, 'aaaaaaaa-0000-4000-8000-00000000a001','P13bHEleve1','S','p13b.h.eleve1@test.local','active','coaching'),
    ('bbbbbbbb-0000-4000-8000-00000000a002', u_eleve2, 'aaaaaaaa-0000-4000-8000-00000000a002','P13bHEleve2','S','p13b.h.eleve2@test.local','active','coaching');

  -- Affectations : aucune pour c0 et cp ; l'élève 1 pour ca, cl et ce.
  insert into public.collaborateur_eleves (collaborateur_id, student_id) values
    ('aaaaaaaa-0000-4000-8000-00000000a005','bbbbbbbb-0000-4000-8000-00000000a001'),
    ('aaaaaaaa-0000-4000-8000-00000000a006','bbbbbbbb-0000-4000-8000-00000000a001'),
    ('aaaaaaaa-0000-4000-8000-00000000a007','bbbbbbbb-0000-4000-8000-00000000a001');

  -- Permissions : aucune pour c0 et ca ; entrainement pour cp (sans
  -- affectation), lecture pour cl, écriture pour ce.
  insert into public.collaborateur_permissions (collaborateur_id, categorie, niveau) values
    ('aaaaaaaa-0000-4000-8000-00000000a004','entrainement','ecriture'),
    ('aaaaaaaa-0000-4000-8000-00000000a006','entrainement','lecture'),
    ('aaaaaaaa-0000-4000-8000-00000000a007','entrainement','ecriture');

  -- Le programme source : un modèle du coach A, sans élève propriétaire.
  insert into public.programs (id, owner_student_id, coach_id, name, status)
  values ('ffffffff-0000-4000-8000-00000000a001', null, 'aaaaaaaa-0000-4000-8000-00000000a001','Source P13B-H','actif');
end $$;

-- Un essai = un appel, puis la mesure des EFFETS, puis l'effacement de la
-- trace. `p_attendu` vaut 'REFUS' ou 'AUTORISE' ; le verdict exige à la fois
-- le bon comportement ET le bon nombre de lignes.
create or replace function pg_temp.essai_copie(
  p_libelle text, p_attendu text, p_user uuid, p_eleve uuid
) returns void language plpgsql as $$
declare
  v_id uuid; v_refuse boolean := false; v_prog int; v_aff int; v_ok boolean;
begin
  if p_user is null then
    perform set_config('role','service_role', true);
    perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  else
    perform pg_temp.devenir(p_user);
  end if;
  begin
    v_id := public.provision_program_copy('ffffffff-0000-4000-8000-00000000a001', p_eleve, null);
  exception
    when insufficient_privilege then v_refuse := true;
    when others then
      v_refuse := true;
      raise notice '  (SQLSTATE % — refus pour une autre raison : %)', sqlstate, sqlerrm;
  end;
  reset role;

  select count(*) into v_prog from public.programs
   where source_template_id = 'ffffffff-0000-4000-8000-00000000a001';
  select count(*) into v_aff from public.assignments
   where content_id in (select id from public.programs
                         where source_template_id = 'ffffffff-0000-4000-8000-00000000a001');

  if p_attendu = 'REFUS' then
    v_ok := v_refuse and v_prog = 0 and v_aff = 0;
  else
    v_ok := (not v_refuse) and v_id is not null and v_prog = 1 and v_aff = 1;
  end if;
  perform pg_temp.noter('H', p_libelle || format(' [%s créé(s), %s affectation(s)]', v_prog, v_aff), v_ok);

  delete from public.assignments where content_id in
    (select id from public.programs where source_template_id = 'ffffffff-0000-4000-8000-00000000a001');
  delete from public.programs where source_template_id = 'ffffffff-0000-4000-8000-00000000a001';
end $$;

do $$ begin
  -- LES REFUS. Une condition manquante suffit, et aucune ne se rattrape.
  perform pg_temp.essai_copie('H1. collaborateur sans permission NI affectation : refusé',
    'REFUS', '00000000-0000-4000-8000-00000000a003', 'bbbbbbbb-0000-4000-8000-00000000a001');
  perform pg_temp.essai_copie('H2. permission entrainement/ecriture mais AUCUNE affectation : refusé',
    'REFUS', '00000000-0000-4000-8000-00000000a004', 'bbbbbbbb-0000-4000-8000-00000000a001');
  perform pg_temp.essai_copie('H3. affectation explicite mais AUCUNE permission : refusé',
    'REFUS', '00000000-0000-4000-8000-00000000a005', 'bbbbbbbb-0000-4000-8000-00000000a001');
  perform pg_temp.essai_copie('H4. entrainement/LECTURE + affectation : refusé (lecture n''écrit pas)',
    'REFUS', '00000000-0000-4000-8000-00000000a006', 'bbbbbbbb-0000-4000-8000-00000000a001');

  -- L'AUTORISATION. Les deux conditions réunies, et le travail aboutit.
  perform pg_temp.essai_copie('H5. entrainement/ECRITURE + affectation : autorisé',
    'AUTORISE', '00000000-0000-4000-8000-00000000a007', 'bbbbbbbb-0000-4000-8000-00000000a001');

  -- LA PORTÉE. Le même collaborateur, un élève qui n'est pas le sien.
  perform pg_temp.essai_copie('H6. le même collaborateur vers l''élève d''un AUTRE coach : refusé',
    'REFUS', '00000000-0000-4000-8000-00000000a007', 'bbbbbbbb-0000-4000-8000-00000000a002');

  -- LES NULL ET L'INCONNU, fail-closed.
  perform pg_temp.essai_copie('H7. identifiant d''élève NULL : refusé',
    'REFUS', '00000000-0000-4000-8000-00000000a007', null);
  perform pg_temp.essai_copie('H8. identifiant d''élève INCONNU : refusé',
    'REFUS', '00000000-0000-4000-8000-00000000a007', 'bbbbbbbb-0000-4000-8000-00000000a0ff');

  -- LES RÔLES HISTORIQUES. Préservés, et pas élargis.
  perform pg_temp.essai_copie('H9. assistant sur SON élève : autorisé',
    'AUTORISE', '00000000-0000-4000-8000-00000000a001', 'bbbbbbbb-0000-4000-8000-00000000a001');
  perform pg_temp.essai_copie('H10. assistant sur l''élève d''un autre coach : refusé (aucun accès global)',
    'REFUS', '00000000-0000-4000-8000-00000000a001', 'bbbbbbbb-0000-4000-8000-00000000a002');
  perform pg_temp.essai_copie('H11. administrateur, n''importe quel élève : autorisé',
    'AUTORISE', '00000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-00000000a002');
  perform pg_temp.essai_copie('H12. service_role (webhook Stripe, cron) : autorisé',
    'AUTORISE', null, 'bbbbbbbb-0000-4000-8000-00000000a001');
  perform pg_temp.essai_copie('H13. l''élève lui-même ne provisionne rien : refusé',
    'REFUS', '00000000-0000-4000-8000-00000000a008', 'bbbbbbbb-0000-4000-8000-00000000a001');
end $$;

-- Et la garde elle-même, telle qu'elle est EN BASE : l'ancienne règle ne doit
-- pas pouvoir revenir par une migration ultérieure.
do $$
declare v_def text; v_anon boolean;
begin
  reset role;
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname = 'provision_program_copy';
  perform pg_temp.noter('H', 'H14. la garde n''est plus fondée sur profiles.role in (admin, coach)',
    v_def is not null and position($x$not in ('service', 'admin', 'coach')$x$ in v_def) = 0);
  perform pg_temp.noter('H', 'H15. elle oppose la portée entrainement/ecriture et public.is_admin()',
    coalesce(position('student_ids_entrainement_ecriture' in v_def) > 0
             and position('public.is_admin()' in v_def) > 0, false));
  perform pg_temp.noter('H', 'H16. le corps de la copie est intact (verrou, idempotence, prescriptions, RPE)',
    coalesce(position('pg_advisory_xact_lock' in v_def) > 0
             and position('source_checkout_session_id' in v_def) > 0
             and position('training_prescriptions' in v_def) > 0
             and position('recommended_rpe' in v_def) > 0, false));
  select has_function_privilege('anon', p.oid, 'execute') into v_anon
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname = 'provision_program_copy';
  perform pg_temp.noter('H', 'H17. anon ne peut pas l''exécuter, authenticated et service_role oui',
    v_anon = false
    and (select has_function_privilege('authenticated', p.oid, 'execute')
           from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='provision_program_copy')
    and (select has_function_privilege('service_role', p.oid, 'execute')
           from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='provision_program_copy'));
end $$;


-- ── Z. BILAN ET RIEN NE SURVIT ────────────────────────────────────────────
do $$ begin reset role; end $$;

select section, count(*) as controles, count(*) filter (where not ok) as echecs
  from _faits group by section order by section;

select count(*) as total_controles, count(*) filter (where not ok) as total_echecs
  from _faits;

select string_agg(libelle, E'\n') as echecs_detailles from _faits where not ok;

rollback;

-- Après le ROLLBACK : aucun compte, aucune affectation, aucune permission.
select
  (select count(*) from public.coaches where email like 'p13b.%@test.local') as coachs_restants,
  (select count(*) from public.nutrition_plans where name like 'Plan %eleve%' or name like '%collaborateur%' or name like 'Plan modele%') as plans_restants,
  (select count(*) from auth.users where email like 'p13b.%@test.local') as comptes_restants,
  (select count(*) from public.collaborateur_eleves) as affectations_restantes,
  (select count(*) from public.collaborateur_permissions) as permissions_restantes;
