-- =====================================================================
-- Tests de sécurité RÉELS sur les profils — correctifs C-1 et H-3.
-- À exécuter EXCLUSIVEMENT sur Supabase local, jamais sur la production :
-- ce script écrit des données (comptes de test) et tente des élévations de
-- privilèges.
--
--   npm run db:local:init          # baseline + migrations post-baseline
--   DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)"
--   docker exec -i "$DB_CONTAINER" \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < scripts/sql/profiles-security-tests.sql
--
-- Règle métier vérifiée :
--   role    : seul un administrateur (jamais un coach, jamais un élève) ;
--   user_id : immuable pour tout utilisateur authentifié, admin compris ;
--   service_role : opérations serveur prévues, non entravées.
--
-- Chaque test affiche OK ou lève une exception. Tout se déroule dans une
-- transaction annulée à la fin : la base locale revient à son état initial.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- ---------------------------------------------------------------------
-- Jeu d'essai : élève A, élève B, coach, admin
-- ---------------------------------------------------------------------
insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'eleve.a@test.local', crypt('motdepasse-test', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'eleve.b@test.local', crypt('motdepasse-test', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'coach@test.local',   crypt('motdepasse-test', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'admin@test.local',   crypt('motdepasse-test', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated'),
  ('55555555-5555-5555-5555-555555555555', 'nouveau@test.local', crypt('motdepasse-test', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email)
values
  ('11111111-1111-1111-1111-111111111111', 'student', 'Alice', 'A', 'eleve.a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'student', 'Bob',   'B', 'eleve.b@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'coach',   'Carla', 'C', 'coach@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'admin',   'Denis', 'D', 'admin@test.local');

-- ⚠️ `students.status` : la valeur EN BASE est 'active', pas 'actif'.
-- La colonne a pour DEFAULT 'actif' alors que sa propre contrainte CHECK
-- n'autorise que 'active' / 'paused' / 'completed' — incohérence présente
-- dans le schéma de production, hors périmètre de ce correctif de sécurité.
-- L'application traduit d'ailleurs elle-même le vocabulaire métier vers la
-- base (STATUS_APP_TO_DB dans lib/supabase/students.ts : actif → active).
-- La valeur est donc TOUJOURS fournie explicitement ici, jamais laissée au
-- DEFAULT, qui violerait la contrainte.
-- Fiche coach : `coaches.status` accepte 'actif'/'inactif' (français), à
-- l'inverse de `students.status` — les deux tables ne suivent pas la même
-- convention.
--
-- ⚠️ `coaches.role` ne désigne PAS le rôle applicatif de `profiles.role`.
-- `coaches_role_check` n'autorise que 'admin' (le propriétaire du site) et
-- 'assistant' (un collaborateur ajouté) — voir types/index.ts::CoachRole et
-- supabase/seed.sql, qui emploie exactement ces deux valeurs. 'coach' n'est
-- pas une valeur valide ici, bien que ce soit un rôle valide dans `profiles`.
-- Les DEFAULT de la table sont, eux, cohérents avec leurs CHECK
-- (role → 'admin', status → 'actif') : contrairement à `students.status`,
-- les omettre serait sans danger. Ils restent explicites pour la lisibilité.
insert into public.coaches (id, user_id, name, email, role, status, specialty)
values
  ('99999999-9999-9999-9999-999999999999', '33333333-3333-3333-3333-333333333333',
   'Carla Coach', 'coach@test.local', 'admin', 'actif', 'Préparation physique'),
  -- Second coach, associé à AUCUN élève : sert à prouver qu'un élève ne peut
  -- pas obtenir la fiche d'un coach qui n'est pas le sien.
  ('88888888-8888-8888-8888-888888888888', null,
   'Bruno Autre', 'autre.coach@test.local', 'assistant', 'actif', 'Mobilité');

insert into public.students (user_id, first_name, last_name, email, status, access_type, coach_id)
values
  ('11111111-1111-1111-1111-111111111111', 'Alice', 'A', 'eleve.a@test.local', 'active', 'coaching',
   '99999999-9999-9999-9999-999999999999'),
  -- Élève B volontairement SANS coach : la RPC ne doit rien lui renvoyer.
  ('22222222-2222-2222-2222-222222222222', 'Bob',   'B', 'eleve.b@test.local', 'active', 'coaching', null);

-- ---------------------------------------------------------------------
-- Outillage
-- ---------------------------------------------------------------------
-- Changement d'acteur — TOUJOURS repartir d'un état propre.
--
-- `auth.uid()` et `auth.role()` lisent, selon les versions de GoTrue, soit
-- `request.jwt.claims` (JSON complet), soit les paramètres unitaires
-- `request.jwt.claim.sub` / `request.jwt.claim.role`. Les trois sont donc
-- réécrites à CHAQUE changement d'identité : compter sur l'état laissé par
-- le scénario précédent exposerait à des faux positifs (un `auth.uid()`
-- résiduel ferait passer un test qui devrait échouer).
create or replace function pg_temp.claims(p_sub text, p_role text)
returns void language plpgsql as $$
begin
  reset role;
  if p_sub is null or p_sub = '' then
    perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
    perform set_config('request.jwt.claim.sub', '', true);
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_sub, 'role', p_role)::text, true);
    perform set_config('request.jwt.claim.sub', p_sub, true);
  end if;
  perform set_config('request.jwt.claim.role', p_role, true);
  set local row_security = on;
end;
$$;

create or replace function pg_temp.incarner(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform pg_temp.claims(p_user_id::text, 'authenticated');
  set local role authenticated;
end;
$$;

create or replace function pg_temp.anonyme()
returns void language plpgsql as $$
begin
  perform pg_temp.claims(null, 'anon');
  set local role anon;
end;
$$;

create or replace function pg_temp.service()
returns void language plpgsql as $$
begin
  perform pg_temp.claims(null, 'service_role');
  set local role service_role;
end;
$$;

create or replace function pg_temp.retablir()
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end;
$$;

create or replace function pg_temp.verifier(p_nom text, p_condition boolean)
returns void language plpgsql as $$
begin
  if p_condition then
    raise notice 'OK      — %', p_nom;
  else
    raise exception 'ÉCHEC   — %', p_nom;
  end if;
end;
$$;

-- =====================================================================
-- A. ÉLÈVE
-- =====================================================================

-- ---- 1. Élève modifie son propre nom : AUTORISÉ ---------------------
do $$
declare nb int;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  update public.profiles set first_name = 'Alice-modifié'
   where user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics nb = row_count;
  perform pg_temp.retablir();
  perform pg_temp.verifier('1. élève modifie son propre nom', nb = 1);
end $$;

-- ---- 2. Élève change son rôle : REFUSÉ (C-1) ------------------------
do $$
declare bloque boolean := false;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  begin
    update public.profiles set role = 'admin'
     where user_id = '11111111-1111-1111-1111-111111111111';
  exception when insufficient_privilege then
    bloque := true;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('2. élève change son rôle : refusé', bloque);
end $$;

-- ---- 3. Le rôle stocké est resté 'student' --------------------------
do $$
declare r text;
begin
  select role into r from public.profiles
   where user_id = '11111111-1111-1111-1111-111111111111';
  perform pg_temp.verifier('3. le rôle stocké est toujours student', r = 'student');
end $$;

-- ---- 4. is_coach_or_admin() reste false pour l'élève ----------------
do $$
declare est_staff boolean; est_admin boolean;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  est_staff := public.is_coach_or_admin();
  est_admin := public.is_admin();
  perform pg_temp.retablir();
  perform pg_temp.verifier('4. is_coach_or_admin() et is_admin() restent false pour l''élève',
    est_staff = false and est_admin = false);
end $$;

-- ---- 5. Élève change son user_id : REFUSÉ ---------------------------
do $$
declare bloque boolean := false;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  begin
    update public.profiles set user_id = '55555555-5555-5555-5555-555555555555'
     where user_id = '11111111-1111-1111-1111-111111111111';
  exception when insufficient_privilege then
    bloque := true;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('5. élève change son user_id : refusé', bloque);
end $$;

-- ---- 6. Élève lit son propre profil : AUTORISÉ ----------------------
do $$
declare nb int;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  select count(*) into nb from public.profiles
   where user_id = '11111111-1111-1111-1111-111111111111';
  perform pg_temp.retablir();
  perform pg_temp.verifier('6. élève lit son propre profil', nb = 1);
end $$;

-- ---- 7. Élève ne lit pas le profil d'un autre élève (H-3) -----------
do $$
declare nb int; nb_students int;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  select count(*) into nb from public.profiles
   where user_id = '22222222-2222-2222-2222-222222222222';
  -- Seul son propre profil 'student' doit être visible.
  select count(*) into nb_students from public.profiles where role = 'student';
  perform pg_temp.retablir();
  perform pg_temp.verifier('7. élève ne lit pas les profils des autres élèves (H-3)',
    nb = 0 and nb_students = 1);
end $$;

-- ---- 8. Élève ne modifie pas le profil d'un autre élève (IDOR) ------
do $$
declare nb int;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  update public.profiles set first_name = 'piraté'
   where user_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics nb = row_count;
  perform pg_temp.retablir();
  perform pg_temp.verifier('8. élève ne modifie pas le profil d''un autre élève', nb = 0);
end $$;

-- =====================================================================
-- B. ANONYME
-- =====================================================================

-- ---- Diagnostic du contexte anonyme (données techniques locales) -----
-- Affiché systématiquement : si le test 9 échoue, ces deux tableaux
-- disent immédiatement si la cause est le contexte JWT ou bien la policy
-- elle-même.
select pg_temp.anonyme();
select
  current_user,
  session_user,
  auth.uid()   as auth_uid,
  auth.role()  as auth_role,
  current_setting('request.jwt.claim.sub',  true) as jwt_sub,
  current_setting('request.jwt.claim.role', true) as jwt_role,
  current_setting('request.jwt.claims',     true) as jwt_claims;
select pg_temp.retablir();

select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'profiles'
 order by policyname;


-- ---- 9. Anonyme : accès à profiles REFUSÉ ---------------------------
-- Depuis `revoke all on table public.profiles from anon`, PostgreSQL refuse
-- l'accès AVANT même d'évaluer la RLS : anon reçoit « permission denied »,
-- il n'obtient pas « zéro ligne ». Les deux situations n'ont pas la même
-- valeur de sécurité, le test les distingue donc explicitement :
--
--   permission denied           → PASS (privilège révoqué, RLS jamais atteinte)
--   lecture possible, 0 ligne   → ÉCHEC : le GRANT est revenu, seule la RLS
--                                 protège encore la table
--   lecture possible, ≥ 1 ligne → ÉCHEC CRITIQUE : fuite de données
--
-- Le contexte est vérifié AVANT, sans quoi un `auth.uid()` résiduel rendrait
-- le résultat ininterprétable.
do $$
declare
  utilisateur text;
  role_auth text;
  uid_auth uuid;
  rls_active boolean;
  policy_large int;
  refuse boolean := false;
  lignes_lues int := -1;
  visibles text;
begin
  perform pg_temp.anonyme();

  utilisateur := current_user;
  role_auth   := auth.role();
  uid_auth    := auth.uid();
  select relrowsecurity into rls_active
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'profiles';
  select count(*) into policy_large from pg_policies
   where schemaname = 'public' and tablename = 'profiles'
     and policyname = 'profiles_select_authenticated';

  perform pg_temp.verifier(
    format('9a. contexte anonyme : current_user=%s (attendu anon)', utilisateur),
    utilisateur = 'anon');
  perform pg_temp.verifier(
    format('9b. contexte anonyme : auth.role()=%s (attendu anon)', coalesce(role_auth, 'NULL')),
    role_auth = 'anon');
  perform pg_temp.verifier(
    format('9c. contexte anonyme : auth.uid()=%s (attendu NULL)', coalesce(uid_auth::text, 'NULL')),
    uid_auth is null);
  perform pg_temp.verifier('9d. RLS active sur profiles', rls_active);
  perform pg_temp.verifier('9e. profiles_select_authenticated absente', policy_large = 0);

  -- Tentative de lecture. Le bloc ne capture QUE insufficient_privilege :
  -- toute autre erreur remonte, et aucune exception d'échec n'est levée
  -- ici — le verdict est rendu après, hors du bloc.
  begin
    select count(*) into lignes_lues from public.profiles;
  exception when insufficient_privilege then
    refuse := true;
  end;

  if not refuse then
    select string_agg(format('%s/%s', role, email), ', ') into visibles from public.profiles;
  end if;
  perform pg_temp.retablir();

  if refuse then
    raise notice 'OK      — 9. anon : permission denied sur profiles (privilège révoqué)';
  elsif lignes_lues = 0 then
    raise exception 'ÉCHEC   — 9. anon PEUT interroger profiles (0 ligne renvoyée) : le GRANT est revenu, seule la RLS protège encore la table';
  else
    raise notice 'Lignes visibles par anon : %', coalesce(visibles, '(inconnues)');
    raise exception 'ÉCHEC CRITIQUE — 9. anon lit % ligne(s) de profiles', lignes_lues;
  end if;
end $$;

-- ---- 9f. Catalogue : anon n'a pas le privilège SELECT ---------------
-- Assertion indépendante de toute tentative d'accès : elle interroge le
-- catalogue, et détecterait un GRANT revenu même si aucune lecture n'était
-- tentée.
do $$
declare peut_lire boolean;
begin
  select has_table_privilege('anon', 'public.profiles', 'SELECT') into peut_lire;
  perform pg_temp.verifier('9f. catalogue : anon n''a pas SELECT sur profiles', peut_lire = false);
end $$;

-- ---- 9g. Anon appelle la RPC du coach : REFUSÉ ----------------------
-- EXECUTE lui est révoqué : l'appel doit échouer, et pas seulement renvoyer
-- un ensemble vide.
do $$
declare refuse boolean := false; lignes int := -1;
begin
  perform pg_temp.anonyme();
  begin
    select count(*) into lignes from public.get_my_coach_public_profile();
  exception when insufficient_privilege then
    refuse := true;
  end;
  perform pg_temp.retablir();

  if refuse then
    raise notice 'OK      — 9g. anon : permission denied sur get_my_coach_public_profile()';
  else
    raise exception 'ÉCHEC   — 9g. anon a pu exécuter la RPC du coach (% ligne(s))', lignes;
  end if;
end $$;

-- =====================================================================
-- C. COACH — gère les élèves, ne distribue AUCUN privilège
-- =====================================================================

-- ---- 10. Coach lit tous les profils : AUTORISÉ ----------------------
do $$
declare nb int;
begin
  perform pg_temp.incarner('33333333-3333-3333-3333-333333333333');
  select count(*) into nb from public.profiles;
  perform pg_temp.retablir();
  perform pg_temp.verifier('10. coach lit tous les profils', nb = 4);
end $$;

-- ---- 11. Coach modifie le nom d'un élève : AUTORISÉ -----------------
do $$
declare nb int;
begin
  perform pg_temp.incarner('33333333-3333-3333-3333-333333333333');
  update public.profiles set first_name = 'Bob-suivi'
   where user_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics nb = row_count;
  perform pg_temp.retablir();
  perform pg_temp.verifier('11. coach modifie le nom d''un élève', nb = 1);
end $$;

-- ---- 12. Coach change le rôle d'un élève : REFUSÉ -------------------
do $$
declare bloque boolean := false;
begin
  perform pg_temp.incarner('33333333-3333-3333-3333-333333333333');
  begin
    update public.profiles set role = 'coach'
     where user_id = '22222222-2222-2222-2222-222222222222';
  exception when insufficient_privilege then
    bloque := true;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('12. coach change le rôle d''un élève : refusé', bloque);
end $$;

-- ---- 13. Coach promeut un élève administrateur : REFUSÉ -------------
do $$
declare bloque boolean := false; r text;
begin
  perform pg_temp.incarner('33333333-3333-3333-3333-333333333333');
  begin
    update public.profiles set role = 'admin'
     where user_id = '22222222-2222-2222-2222-222222222222';
  exception when insufficient_privilege then
    bloque := true;
  end;
  perform pg_temp.retablir();
  select role into r from public.profiles
   where user_id = '22222222-2222-2222-2222-222222222222';
  perform pg_temp.verifier('13. coach promeut un élève admin : refusé', bloque and r = 'student');
end $$;

-- ---- 14. Coach se promeut lui-même administrateur : REFUSÉ ----------
do $$
declare bloque boolean := false;
begin
  perform pg_temp.incarner('33333333-3333-3333-3333-333333333333');
  begin
    update public.profiles set role = 'admin'
     where user_id = '33333333-3333-3333-3333-333333333333';
  exception when insufficient_privilege then
    bloque := true;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('14. coach ne se promeut pas administrateur', bloque);
end $$;

-- ---- 15. Coach change un user_id : REFUSÉ ---------------------------
do $$
declare bloque boolean := false;
begin
  perform pg_temp.incarner('33333333-3333-3333-3333-333333333333');
  begin
    update public.profiles set user_id = '55555555-5555-5555-5555-555555555555'
     where user_id = '22222222-2222-2222-2222-222222222222';
  exception when insufficient_privilege then
    bloque := true;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('15. coach change un user_id : refusé', bloque);
end $$;

-- =====================================================================
-- D. ADMINISTRATEUR
-- =====================================================================

-- ---- 16. Admin passe un élève en coach : AUTORISÉ -------------------
do $$
declare nb int; r text;
begin
  perform pg_temp.incarner('44444444-4444-4444-4444-444444444444');
  update public.profiles set role = 'coach'
   where user_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics nb = row_count;
  perform pg_temp.retablir();
  select role into r from public.profiles
   where user_id = '22222222-2222-2222-2222-222222222222';
  perform pg_temp.verifier('16. admin passe un élève en coach', nb = 1 and r = 'coach');
end $$;

-- ---- 17. Admin passe un compte en admin : AUTORISÉ ------------------
-- Opération volontairement permise : la gestion des administrateurs doit
-- rester possible depuis l'application sans intervention en base.
do $$
declare r text;
begin
  perform pg_temp.incarner('44444444-4444-4444-4444-444444444444');
  update public.profiles set role = 'admin'
   where user_id = '22222222-2222-2222-2222-222222222222';
  perform pg_temp.retablir();
  select role into r from public.profiles
   where user_id = '22222222-2222-2222-2222-222222222222';
  perform pg_temp.verifier('17. admin promeut un compte administrateur', r = 'admin');
end $$;

-- Remise en état pour la suite des tests.
update public.profiles set role = 'student'
 where user_id = '22222222-2222-2222-2222-222222222222';

-- ---- 18. Admin change un user_id : REFUSÉ (immuable pour tous) ------
do $$
declare bloque boolean := false;
begin
  perform pg_temp.incarner('44444444-4444-4444-4444-444444444444');
  begin
    update public.profiles set user_id = '55555555-5555-5555-5555-555555555555'
     where user_id = '22222222-2222-2222-2222-222222222222';
  exception when insufficient_privilege then
    bloque := true;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('18. admin change un user_id : refusé', bloque);
end $$;

-- =====================================================================
-- E. SERVICE ROLE — flux serveur
-- =====================================================================

-- ---- 19. Service role crée un profil : AUTORISÉ ---------------------
do $$
declare nb int;
begin
  perform pg_temp.service();
  insert into public.profiles (user_id, role, first_name, last_name, email)
  values ('55555555-5555-5555-5555-555555555555', 'student', 'Eve', 'E', 'nouveau@test.local');
  get diagnostics nb = row_count;
  perform pg_temp.retablir();
  perform pg_temp.verifier('19. service role crée un profil (provisionnement)', nb = 1);
end $$;

-- ---- 20. Service role ajuste un rôle : AUTORISÉ ---------------------
do $$
declare r text;
begin
  perform pg_temp.service();
  update public.profiles set role = 'coach'
   where user_id = '55555555-5555-5555-5555-555555555555';
  perform pg_temp.retablir();
  select role into r from public.profiles
   where user_id = '55555555-5555-5555-5555-555555555555';
  perform pg_temp.verifier('20. service role ajuste un rôle', r = 'coach');
end $$;

-- =====================================================================
-- E bis. LECTURE DES PROFILS ET RPC PUBLIQUE DU COACH
-- =====================================================================

-- ---- 21. Élève ne lit AUCUNE ligne coach/admin ----------------------
do $$
declare nb int; visibles text;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  select count(*), string_agg(role, ',') into nb, visibles
    from public.profiles where role in ('coach', 'admin');
  perform pg_temp.retablir();
  if nb <> 0 then
    raise notice 'Lignes staff visibles par l''élève : %', visibles;
  end if;
  perform pg_temp.verifier(
    format('21. élève ne lit aucun profil coach/admin (%s visible(s))', nb), nb = 0);
end $$;

-- ---- 22. Élève ne voit QUE sa propre ligne --------------------------
do $$
declare nb int; propre int;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  select count(*) into nb from public.profiles;
  select count(*) into propre from public.profiles
   where user_id = '11111111-1111-1111-1111-111111111111';
  perform pg_temp.retablir();
  perform pg_temp.verifier(
    format('22. élève ne voit que sa propre ligne (%s ligne(s))', nb),
    nb = 1 and propre = 1);
end $$;

-- ---- 23. La RPC renvoie le coach RÉELLEMENT associé -----------------
do $$
declare id_coach uuid; prenom text; nb int;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  select coach_id, first_name into id_coach, prenom
    from public.get_my_coach_public_profile();
  select count(*) into nb from public.get_my_coach_public_profile();
  perform pg_temp.retablir();
  perform pg_temp.verifier('23. la RPC renvoie le coach associé à l''élève',
    nb = 1 and id_coach = '99999999-9999-9999-9999-999999999999' and prenom = 'Carla');
end $$;

-- ---- 24. Un élève sans coach n'obtient rien -------------------------
do $$
declare nb int;
begin
  perform pg_temp.incarner('22222222-2222-2222-2222-222222222222');
  select count(*) into nb from public.get_my_coach_public_profile();
  perform pg_temp.retablir();
  perform pg_temp.verifier('24. élève sans coach : la RPC ne renvoie rien', nb = 0);
end $$;

-- ---- Diagnostic : signature réelle de la RPC ------------------------
-- Une fonction `RETURNS TABLE (...)` a pour type de retour le PSEUDO-type
-- `record` : `pg_type.typrelid` vaut 0, il n'existe aucune ligne dans
-- `pg_attribute` à joindre. Les colonnes de sortie sont décrites par
-- `proargnames` + `proargmodes` (mode 't' = TABLE) et `proallargtypes`.
--
-- Note : `pg_proc.proallargnames` n'existe pas — la colonne des noms est
-- `proargnames`, qui contient TOUS les arguments (entrée, sortie et TABLE),
-- d'où la nécessité de filtrer sur `proargmodes`.
select
  p.oid::regprocedure                as signature,
  pg_get_function_result(p.oid)      as resultat,
  p.pronargs                         as nb_arguments_entree,
  p.proargnames,
  p.proargmodes,
  p.proallargtypes
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'get_my_coach_public_profile';

select parameter_name, parameter_mode, data_type, ordinal_position
  from information_schema.parameters
 where specific_schema = 'public'
   and specific_name like 'get\_my\_coach\_public\_profile\_%'
 order by ordinal_position;

-- ---- 25. La RPC n'expose ni email, ni téléphone, ni rôle ------------
-- Colonnes de sortie reconstruites dans leur ORDRE RÉEL depuis le catalogue.
-- Modes retenus : 'o' (OUT), 'b' (INOUT) et 't' (TABLE) — les modes 'i' et
-- 'v' sont des entrées, ils ne sortent rien.
do $$
declare colonnes text;
begin
  select string_agg(x.nom, ',' order by x.ord) into colonnes
    from pg_proc p
    cross join lateral unnest(p.proargnames, p.proargmodes) with ordinality
      as x(nom, mode, ord)
   where p.proname = 'get_my_coach_public_profile'
     and p.pronamespace = 'public'::regnamespace
     and x.mode in ('o', 'b', 't');

  perform pg_temp.verifier(
    format('25. la RPC n''expose que l''identité minimale (%s)', coalesce(colonnes, 'AUCUNE COLONNE LUE')),
    colonnes = 'coach_id,first_name,last_name,specialty');
end $$;

-- ---- 25b. Types de sortie conformes ---------------------------------
do $$
declare types text;
begin
  select string_agg(format_type(x.typ, null), ',' order by x.ord) into types
    from pg_proc p
    cross join lateral unnest(p.proallargtypes, p.proargmodes) with ordinality
      as x(typ, mode, ord)
   where p.proname = 'get_my_coach_public_profile'
     and p.pronamespace = 'public'::regnamespace
     and x.mode in ('o', 'b', 't');

  perform pg_temp.verifier(
    format('25b. types de sortie de la RPC (%s)', coalesce(types, 'AUCUN TYPE LU')),
    types = 'uuid,text,text,text');
end $$;

-- ---- 25c. Preuve à l'exécution : les clés réellement renvoyées ------
-- Le catalogue décrit la signature déclarée ; ce test observe la ligne
-- effectivement produite. Une divergence entre les deux — colonne ajoutée
-- par un `create or replace` mal propagé, par exemple — serait détectée ici.
do $$
declare ligne jsonb; cles text;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  select to_jsonb(f) into ligne from public.get_my_coach_public_profile() f;
  perform pg_temp.retablir();

  if ligne is null then
    raise exception 'ÉCHEC   — 25c. la RPC n''a renvoyé aucune ligne pour l''élève A (le test 23 devrait avoir échoué avant)';
  end if;

  select string_agg(k, ',' order by k) into cles from jsonb_object_keys(ligne) as k;
  perform pg_temp.verifier(
    format('25c. clés réellement renvoyées par la RPC (%s)', cles),
    cles = 'coach_id,first_name,last_name,specialty');
end $$;

-- ---- 25d. Aucun argument d'entrée : pas d'IDOR possible -------------
-- L'appelant est déterminé par auth.uid() seul. Un paramètre — même
-- optionnel — rouvrirait la porte à la lecture du coach d'autrui.
do $$
declare nb_entrees int;
begin
  select p.pronargs into nb_entrees
    from pg_proc p
   where p.proname = 'get_my_coach_public_profile'
     and p.pronamespace = 'public'::regnamespace;
  perform pg_temp.verifier(
    format('25d. la RPC n''accepte aucun argument d''entrée (%s)', nb_entrees),
    nb_entrees = 0);
end $$;

-- ---- 25e. Aucune donnée interne dans la signature -------------------
-- Test distinct et explicite : même si la liste attendue changeait un jour,
-- ces colonnes-là doivent rester absentes.
do $$
declare interdite text;
begin
  select string_agg(x.nom, ', ' order by x.ord) into interdite
    from pg_proc p
    cross join lateral unnest(p.proargnames, p.proargmodes) with ordinality
      as x(nom, mode, ord)
   where p.proname = 'get_my_coach_public_profile'
     and p.pronamespace = 'public'::regnamespace
     and x.mode in ('o', 'b', 't')
     and x.nom ~* '(email|mail|phone|telephone|tel$|role|status|statut|note|password|token|secret|user_id|birth|address|adresse)';

  if interdite is not null then
    raise notice 'Colonnes sensibles exposées : %', interdite;
  end if;
  perform pg_temp.verifier(
    '25e. la RPC n''expose ni email, ni téléphone, ni rôle, ni statut, ni note interne',
    interdite is null);
end $$;

-- ---- 26. anon ne peut pas exécuter la RPC ---------------------------
do $$
declare peut boolean;
begin
  select has_function_privilege('anon', 'public.get_my_coach_public_profile()', 'execute')
    into peut;
  perform pg_temp.verifier('26. anon ne peut pas exécuter la RPC du coach', peut = false);
end $$;

-- ---- 27. anon n'a plus aucun privilège sur profiles -----------------
do $$
declare privileges text;
begin
  select string_agg(privilege_type, ',' order by privilege_type) into privileges
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'profiles' and grantee = 'anon';
  perform pg_temp.verifier(
    format('27. anon n''a plus de privilège sur profiles (%s)', coalesce(privileges, 'aucun')),
    privileges is null);
end $$;

-- ---- 28. Aucune policy profiles n'expose le staff sans condition ----
do $$
declare fautives text;
begin
  select string_agg(policyname, ', ') into fautives
    from pg_policies
   where schemaname = 'public' and tablename = 'profiles'
     and coalesce(qual, '') ~ 'role[^=]*=[^=]*ANY[^)]*coach'
     and coalesce(qual, '') !~ 'auth\.uid\(\) IS NOT NULL';
  if fautives is not null then
    raise notice 'Policies exposant le staff : %', fautives;
  end if;
  perform pg_temp.verifier(
    '28. aucune policy ne contient de clause role in (coach, admin) inconditionnelle',
    fautives is null);
end $$;

-- ---- 29. La policy de lecture cible le seul rôle authenticated ------
do $$
declare roles_policy text;
begin
  select array_to_string(roles, ',') into roles_policy
    from pg_policies
   where schemaname = 'public' and tablename = 'profiles'
     and policyname = 'profiles_select_self_or_staff';
  perform pg_temp.verifier(
    format('29. profiles_select_self_or_staff ciblée sur authenticated (%s)', roles_policy),
    roles_policy = 'authenticated');
end $$;

-- =====================================================================
-- F. ÉTAT DE LA CONFIGURATION
-- =====================================================================

-- ---- 21. La policy trop large est absente (H-3) ---------------------
do $$
declare nb int;
begin
  select count(*) into nb from pg_policies
   where schemaname = 'public' and tablename = 'profiles'
     and policyname = 'profiles_select_authenticated';
  perform pg_temp.verifier('21. profiles_select_authenticated absente', nb = 0);
end $$;

-- ---- 22. Le trigger de protection est en place ----------------------
do $$
declare nb int;
begin
  select count(*) into nb from pg_trigger t
   join pg_class c on c.oid = t.tgrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'profiles'
     and t.tgname = 'protect_role_column' and not t.tgisinternal;
  perform pg_temp.verifier('22. trigger protect_role_column présent', nb = 1);
end $$;

-- ---- 23. La policy UPDATE a un WITH CHECK ---------------------------
do $$
declare check_expr text;
begin
  select with_check into check_expr from pg_policies
   where schemaname = 'public' and tablename = 'profiles'
     and policyname = 'profiles_update_self_or_admin';
  perform pg_temp.verifier('23. profiles_update_self_or_admin a un WITH CHECK',
    check_expr is not null);
end $$;

-- ---- 24. is_admin() : search_path figé et anon révoqué --------------
do $$
declare cfg text; anon_peut boolean;
begin
  select array_to_string(p.proconfig, ',') into cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_admin';
  select has_function_privilege('anon', 'public.is_admin()', 'execute') into anon_peut;
  perform pg_temp.verifier('24. is_admin() : search_path figé, anon révoqué',
    cfg like '%search_path=public%' and anon_peut = false);
end $$;

-- ---- 25. La fonction de trigger a un search_path figé ---------------
do $$
declare cfg text;
begin
  select array_to_string(p.proconfig, ',') into cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'protect_profiles_role_column';
  perform pg_temp.verifier('25. search_path explicite sur la fonction de trigger',
    cfg like '%search_path=public%');
end $$;


-- =====================================================================
-- G. TABLE COACHES — fermée aux élèves (H-3, suite)
-- =====================================================================
-- La fermeture de `profiles` ne servait à rien tant que `coaches` restait
-- ouverte : `coaches_select_authenticated` (TO public, using auth.role() =
-- 'authenticated') donnait à tout compte connecté le nom, l'email, le
-- téléphone et le statut de chaque coach.

-- ---- Diagnostic : policies et privilèges sur coaches ----------------
select policyname, cmd, roles, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'coaches'
 order by policyname;

-- ---- 30. anon ne peut pas lire coaches -------------------------------
do $$
declare refuse boolean := false; lignes int := -1; peut_lire boolean;
begin
  perform pg_temp.anonyme();
  begin
    select count(*) into lignes from public.coaches;
  exception when insufficient_privilege then
    refuse := true;
  end;
  perform pg_temp.retablir();

  select has_table_privilege('anon', 'public.coaches', 'SELECT') into peut_lire;

  if not refuse then
    raise exception 'ECHEC   — 30. anon a pu interroger coaches (% ligne(s))', lignes;
  end if;
  perform pg_temp.verifier('30. anon : permission denied sur coaches, et aucun privilège au catalogue',
    refuse and peut_lire = false);
end $$;

-- ---- 31. Élève A : zéro ligne en lecture directe sur coaches --------
-- `authenticated` conserve le GRANT (les coachs en ont besoin) : l'élève
-- peut donc INTERROGER la table, mais la RLS ne lui rend aucune ligne.
-- C'est bien zéro ligne qui est attendu ici, pas une erreur de privilège.
do $$
declare lignes int;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  select count(*) into lignes from public.coaches;
  perform pg_temp.retablir();
  perform pg_temp.verifier(
    format('31. élève A ne lit aucune ligne de coaches (%s)', lignes),
    lignes = 0);
end $$;

-- ---- 32. Élève A récupère uniquement SON coach via la RPC -----------
do $$
declare id_coach uuid; nom text; lignes int;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  select coach_id, first_name into id_coach, nom from public.get_my_coach_public_profile();
  select count(*) into lignes from public.get_my_coach_public_profile();
  perform pg_temp.retablir();
  perform pg_temp.verifier(
    format('32. élève A obtient son coach via la RPC (%s ligne, %s)', lignes, coalesce(nom, 'NULL')),
    lignes = 1 and id_coach = '99999999-9999-9999-9999-999999999999' and nom = 'Carla');
end $$;

-- ---- 33. Élève A n'obtient JAMAIS l'autre coach ----------------------
-- Ni par la RPC (aucun paramètre à falsifier), ni par lecture directe.
do $$
declare via_rpc int; direct int;
begin
  perform pg_temp.incarner('11111111-1111-1111-1111-111111111111');
  select count(*) into via_rpc from public.get_my_coach_public_profile()
   where coach_id = '88888888-8888-8888-8888-888888888888';
  select count(*) into direct from public.coaches
   where id = '88888888-8888-8888-8888-888888888888';
  perform pg_temp.retablir();
  perform pg_temp.verifier(
    format('33. élève A n''atteint pas le coach d''autrui (rpc=%s, direct=%s)', via_rpc, direct),
    via_rpc = 0 and direct = 0);
end $$;

-- ---- 34. Élève B, sans coach, n'obtient rien ------------------------
do $$
declare via_rpc int; direct int;
begin
  perform pg_temp.incarner('22222222-2222-2222-2222-222222222222');
  select count(*) into via_rpc from public.get_my_coach_public_profile();
  select count(*) into direct from public.coaches;
  perform pg_temp.retablir();
  perform pg_temp.verifier(
    format('34. élève B sans coach : rien via la RPC ni en direct (rpc=%s, direct=%s)', via_rpc, direct),
    via_rpc = 0 and direct = 0);
end $$;

-- ---- 35. Le coach lit bien les fiches coaches -----------------------
do $$
declare lignes int;
begin
  perform pg_temp.incarner('33333333-3333-3333-3333-333333333333');
  select count(*) into lignes from public.coaches;
  perform pg_temp.retablir();
  perform pg_temp.verifier(
    format('35. le coach lit les fiches coaches (%s attendu 2)', lignes),
    lignes = 2);
end $$;

-- ---- 36. L'admin lit bien les fiches coaches ------------------------
do $$
declare lignes int;
begin
  perform pg_temp.incarner('44444444-4444-4444-4444-444444444444');
  select count(*) into lignes from public.coaches;
  perform pg_temp.retablir();
  perform pg_temp.verifier(
    format('36. l''admin lit les fiches coaches (%s attendu 2)', lignes),
    lignes = 2);
end $$;

-- ---- 37. Le service role conserve son accès -------------------------
-- Chemin du provisionnement serveur (resolveCoachId, coach-account-
-- provisioning) et des emails transactionnels.
do $$
declare lignes int;
begin
  perform pg_temp.service();
  select count(*) into lignes from public.coaches;
  perform pg_temp.retablir();
  perform pg_temp.verifier(
    format('37. le service role lit les fiches coaches (%s attendu 2)', lignes),
    lignes = 2);
end $$;

-- ---- 38. coaches_select_authenticated est absente -------------------
do $$
declare nb int;
begin
  select count(*) into nb from pg_policies
   where schemaname = 'public' and tablename = 'coaches'
     and policyname = 'coaches_select_authenticated';
  perform pg_temp.verifier('38. coaches_select_authenticated absente', nb = 0);
end $$;

-- ---- 39. coaches_select_staff : authenticated + is_coach_or_admin ---
do $$
declare roles_policy text; condition text;
begin
  select array_to_string(roles, ','), coalesce(qual, '') into roles_policy, condition
    from pg_policies
   where schemaname = 'public' and tablename = 'coaches'
     and policyname = 'coaches_select_staff';
  perform pg_temp.verifier(
    format('39. coaches_select_staff ciblée sur authenticated avec is_coach_or_admin() (%s / %s)',
      coalesce(roles_policy, 'ABSENTE'), coalesce(condition, '')),
    roles_policy = 'authenticated' and condition like '%is_coach_or_admin()%');
end $$;

-- ---- 40. Aucune policy coaches ne reste inconditionnelle ------------
-- Filet : détecte la réapparition d'une clause qui ouvrirait la table à tout
-- compte connecté, quel que soit le nom de la policy.
do $$
declare fautives text;
begin
  select string_agg(policyname, ', ') into fautives
    from pg_policies
   where schemaname = 'public' and tablename = 'coaches'
     and cmd in ('SELECT', 'ALL')
     and coalesce(qual, '') ~ 'auth\.role\(\)'
     and coalesce(qual, '') ~ 'authenticated'
     and coalesce(qual, '') !~ 'is_coach_or_admin';
  if fautives is not null then
    raise notice 'Policies coaches trop larges : %', fautives;
  end if;
  perform pg_temp.verifier(
    '40. aucune policy coaches ne se contente de auth.role() = authenticated',
    fautives is null);
end $$;

rollback;

\echo ''
\echo '================================================'
\echo ' 45 tests exécutés — aucun échec.'
\echo ' Rôles couverts : anon, élève A, élève B, coach,'
\echo ' admin, service_role.'
\echo ' Tables couvertes : profiles, coaches.'
\echo ' Base locale inchangée (rollback).'
\echo '================================================'
