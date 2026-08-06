-- =====================================================================
-- CHECKLIST PostgreSQL — répartition nutritionnelle structurée (modèle v2)
-- Migration 20260804090000, chantier feat/nutrition-adaptive-recipes, PR 1.
-- =====================================================================
--
-- À exécuter EXCLUSIVEMENT sur une pile Supabase LOCALE, jamais sur la
-- production : ce script crée des comptes et des plans de test, et tente
-- délibérément des écritures interdites.
--
--   npm run db:local:init          # baseline + migrations post-baseline
--   DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)"
--   docker exec -i "$DB_CONTAINER" \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/nutrition_plan_v2_checklist.sql
--
-- Chaque contrôle affiche « OK » ou lève une exception (ON_ERROR_STOP=1
-- interrompt alors le script). TOUT se déroule dans une transaction
-- terminée par ROLLBACK : la base revient à son état initial, aucune donnée
-- de test ne subsiste.
--
-- COUVERTURE
--   A. Schéma ....... colonne, tables, contraintes, index, FK, unicités
--   B. Sécurité ..... RLS, policies, privilèges, propriétaire et
--                     search_path de la RPC
--   C. Fonctionnel .. conversion v1 → v2, sauvegarde canonique, six
--                     créneaux, daily_target synchronisé, rejeu idempotent
--   D. Atomicité .... échec APRÈS écriture du plan ⇒ rollback total
--   E. Accès ........ refus élève, refus anon, refus authenticated non
--                     staff, isolement élève A / élève B
--   F. Propreté ..... aucune donnée de test persistante
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- ---------------------------------------------------------------------
-- Outillage
-- ---------------------------------------------------------------------
-- Même dispositif que scripts/sql/profiles-security-tests.sql : les trois
-- formes de claims JWT sont réécrites à chaque changement d'identité, pour
-- qu'aucun `auth.uid()` résiduel ne fasse passer un test qui devrait échouer.

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

-- Payload canonique de test : 1 700 kcal réparties 28 / 48 / 24, six
-- créneaux couvrant exactement 10 000 points de base par macro.
create or replace function pg_temp.payload_v2(
  p_plan_id uuid,
  p_nom text default 'Plan v2 de test',
  p_dessert_protein_bp integer default 1666
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'plan_id', p_plan_id,
    'plan', jsonb_build_object('name', p_nom, 'goal_type', 'maintien', 'status', 'prochain'),
    'profile', jsonb_build_object(
      'profile_key', 'default',
      'daily_calories', 1700,
      'protein_bp', 2800,
      'carb_bp', 4800,
      'fat_bp', 2400
    ),
    'slots', jsonb_build_array(
      jsonb_build_object('slot','breakfast',      'enabled',true,'protein_bp',1667,'carb_bp',1667,'fat_bp',1667,'display_order',0),
      jsonb_build_object('slot','morning_snack',  'enabled',true,'protein_bp',1667,'carb_bp',1667,'fat_bp',1667,'display_order',1),
      jsonb_build_object('slot','lunch',          'enabled',true,'protein_bp',1667,'carb_bp',1667,'fat_bp',1667,'display_order',2),
      jsonb_build_object('slot','afternoon_snack','enabled',true,'protein_bp',1667,'carb_bp',1667,'fat_bp',1667,'display_order',3),
      jsonb_build_object('slot','dinner',         'enabled',true,'protein_bp',1666,'carb_bp',1666,'fat_bp',1666,'display_order',4),
      jsonb_build_object('slot','dessert',        'enabled',true,'protein_bp',p_dessert_protein_bp,'carb_bp',1666,'fat_bp',1666,'display_order',5)
    )
  );
$$;

-- ---------------------------------------------------------------------
-- Jeu d'essai : coach, élève A, élève B, un plan v1 par élève
-- ---------------------------------------------------------------------
insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('aaaa1111-1111-4111-8111-111111111111', 'nutri.eleve.a@test.local', crypt('motdepasse-test', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated'),
  ('bbbb2222-2222-4222-8222-222222222222', 'nutri.eleve.b@test.local', crypt('motdepasse-test', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated'),
  ('cccc3333-3333-4333-8333-333333333333', 'nutri.coach@test.local',   crypt('motdepasse-test', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated'),
  ('dddd4444-4444-4444-8444-444444444444', 'nutri.simple@test.local',  crypt('motdepasse-test', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email)
values
  ('aaaa1111-1111-4111-8111-111111111111', 'student', 'Alice', 'Nutri', 'nutri.eleve.a@test.local'),
  ('bbbb2222-2222-4222-8222-222222222222', 'student', 'Bob',   'Nutri', 'nutri.eleve.b@test.local'),
  ('cccc3333-3333-4333-8333-333333333333', 'coach',   'Carla', 'Nutri', 'nutri.coach@test.local'),
  -- Utilisateur authentifié SANS rôle staff et SANS fiche élève : sert à
  -- prouver qu'un simple `authenticated` ne peut pas sauvegarder de plan.
  ('dddd4444-4444-4444-8444-444444444444', 'student', 'Sans', 'Fiche', 'nutri.simple@test.local');

-- `students.status` accepte 'active'/'paused'/'completed' (jamais 'actif') :
-- la valeur est donc TOUJOURS fournie explicitement, le DEFAULT violerait
-- sa propre contrainte. Voir scripts/sql/profiles-security-tests.sql.
insert into public.students (id, user_id, first_name, last_name, email, status, access_type)
values
  ('a5a5a5a5-1111-4111-8111-111111111111', 'aaaa1111-1111-4111-8111-111111111111', 'Alice', 'Nutri', 'nutri.eleve.a@test.local', 'active', 'coaching'),
  ('b5b5b5b5-2222-4222-8222-222222222222', 'bbbb2222-2222-4222-8222-222222222222', 'Bob',   'Nutri', 'nutri.eleve.b@test.local', 'active', 'coaching');

-- Deux plans HISTORIQUES (v1), un par élève. Ils doivent rester en v1.
insert into public.nutrition_plans (id, student_id, name, goal_type, status, daily_target)
values
  ('11110000-0000-4000-8000-000000000001', 'a5a5a5a5-1111-4111-8111-111111111111', 'Plan v1 d''Alice', 'maintien', 'actif',
   '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb),
  ('22220000-0000-4000-8000-000000000002', 'b5b5b5b5-2222-4222-8222-222222222222', 'Plan v1 de Bob',   'maintien', 'actif',
   '{"calories":1800,"protein":130,"carbs":180,"fat":55}'::jsonb);

-- =====================================================================
-- A. SCHÉMA
-- =====================================================================

do $$
declare v record;
begin
  select data_type, is_nullable, column_default into v
    from information_schema.columns
   where table_schema = 'public' and table_name = 'nutrition_plans'
     and column_name = 'nutrition_model_version';
  -- ⚠️ PR C — le DEFAULT est passé à 2 (migration 20260811090000) : le modèle
  -- v1 n'existe plus, et un insert qui ne mentionne pas la colonne doit
  -- produire un plan v2, pas un plan refusé par la contrainte.
  perform pg_temp.verifier(
    'A1. nutrition_plans.nutrition_model_version : integer NOT NULL DEFAULT 2',
    v.data_type = 'integer' and v.is_nullable = 'NO' and v.column_default like '2%');
end $$;

do $$
begin
  perform pg_temp.verifier('A2. contrainte de version (1, 2)',
    exists (select 1 from pg_constraint
             where conname = 'nutrition_plans_model_version_check'
               and conrelid = 'public.nutrition_plans'::regclass));
end $$;

do $$
begin
  perform pg_temp.verifier('A3. les deux tables v2 existent',
    to_regclass('public.nutrition_plan_profiles') is not null
    and to_regclass('public.nutrition_meal_slot_targets') is not null);
end $$;

do $$
declare nb int;
begin
  select count(*) into nb from pg_constraint
   where conrelid = 'public.nutrition_plan_profiles'::regclass
     and contype = 'c'
     and conname in ('nutrition_plan_profiles_key_format',
                     'nutrition_plan_profiles_calories_range',
                     'nutrition_plan_profiles_protein_bp_range',
                     'nutrition_plan_profiles_carb_bp_range',
                     'nutrition_plan_profiles_fat_bp_range');
  perform pg_temp.verifier('A4. contraintes de bornes du profil (0 à 10 000)', nb = 5);
end $$;

do $$
declare nb int;
begin
  select count(*) into nb from pg_constraint
   where conrelid = 'public.nutrition_meal_slot_targets'::regclass
     and contype = 'c'
     and conname in ('nutrition_meal_slot_targets_slot_check',
                     'nutrition_meal_slot_targets_protein_bp_range',
                     'nutrition_meal_slot_targets_carb_bp_range',
                     'nutrition_meal_slot_targets_fat_bp_range',
                     'nutrition_meal_slot_targets_display_order_range');
  perform pg_temp.verifier('A5. contraintes de bornes et de créneau (0 à 10 000, six valeurs)', nb = 5);
end $$;

do $$
begin
  perform pg_temp.verifier('A6. index sur les clés étrangères',
    exists (select 1 from pg_indexes where schemaname='public' and indexname='nutrition_plan_profiles_plan_id_idx')
    and exists (select 1 from pg_indexes where schemaname='public' and indexname='nutrition_meal_slot_targets_profile_id_idx'));
end $$;

do $$
declare nb int;
begin
  select count(*) into nb from pg_constraint
   where contype = 'f'
     and confdeltype = 'c'  -- ON DELETE CASCADE
     and (
       (conrelid = 'public.nutrition_plan_profiles'::regclass and confrelid = 'public.nutrition_plans'::regclass)
       or
       (conrelid = 'public.nutrition_meal_slot_targets'::regclass and confrelid = 'public.nutrition_plan_profiles'::regclass)
     );
  perform pg_temp.verifier('A7. clés étrangères en ON DELETE CASCADE', nb = 2);
end $$;

do $$
declare nb int;
begin
  select count(*) into nb from pg_constraint
   where contype = 'u'
     and conname in ('nutrition_plan_profiles_key_unique',
                     'nutrition_meal_slot_targets_profile_slot_unique');
  perform pg_temp.verifier('A8. unicités (plan_id, profile_key) et (profile_id, slot)', nb = 2);
end $$;

-- Les bornes sont réellement appliquées, pas seulement déclarées.
do $$
declare bloque boolean := false;
begin
  begin
    insert into public.nutrition_plan_profiles (plan_id, profile_key, protein_bp)
    values ('11110000-0000-4000-8000-000000000001', 'hors_borne', 10001);
  exception when check_violation then bloque := true;
  end;
  perform pg_temp.verifier('A9. une part hors borne (10 001) est refusée par la base', bloque);
end $$;

do $$
declare bloque boolean := false;
begin
  begin
    insert into public.nutrition_plan_profiles (plan_id, profile_key) values ('11110000-0000-4000-8000-000000000001','p1');
    insert into public.nutrition_meal_slot_targets (profile_id, slot)
      select id, 'brunch' from public.nutrition_plan_profiles where plan_id='11110000-0000-4000-8000-000000000001' and profile_key='p1';
  exception when check_violation then bloque := true;
  end;
  perform pg_temp.verifier('A10. un créneau inconnu (« brunch ») est refusé par la base', bloque);
end $$;
-- Nettoyage local du profil de contrôle A10.
delete from public.nutrition_plan_profiles
 where plan_id = '11110000-0000-4000-8000-000000000001' and profile_key = 'p1';

-- =====================================================================
-- B. RLS, POLICIES, PRIVILÈGES, RPC
-- =====================================================================

do $$
begin
  perform pg_temp.verifier('B1. RLS activée sur les deux tables',
    (select relrowsecurity from pg_class where oid='public.nutrition_plan_profiles'::regclass)
    and (select relrowsecurity from pg_class where oid='public.nutrition_meal_slot_targets'::regclass));
end $$;

do $$
declare nb int;
begin
  select count(*) into nb from pg_policies
   where schemaname='public'
     and tablename in ('nutrition_plan_profiles','nutrition_meal_slot_targets')
     and policyname in ('nutrition_plan_profiles_manage_staff','nutrition_plan_profiles_select_assigned',
                        'nutrition_meal_slot_targets_manage_staff','nutrition_meal_slot_targets_select_assigned');
  perform pg_temp.verifier('B2. quatre policies : gestion staff + lecture élève assigné', nb = 4);
end $$;

do $$
declare nb int;
begin
  -- L'élève n'a QUE des policies de lecture : aucune policy d'écriture ne
  -- doit exister en dehors de celles réservées au staff.
  select count(*) into nb from pg_policies
   where schemaname='public'
     and tablename in ('nutrition_plan_profiles','nutrition_meal_slot_targets')
     and cmd <> 'SELECT'
     and policyname not like '%_manage_staff';
  perform pg_temp.verifier('B3. aucune policy d''écriture hors staff', nb = 0);
end $$;

do $$
declare nb int;
begin
  select count(*) into nb from information_schema.role_table_grants
   where table_schema='public'
     and table_name in ('nutrition_plan_profiles','nutrition_meal_slot_targets')
     and grantee in ('anon','PUBLIC');
  perform pg_temp.verifier('B4. anon et PUBLIC n''ont AUCUN privilège de table', nb = 0);
end $$;

do $$
declare nb int;
begin
  select count(distinct privilege_type) into nb from information_schema.role_table_grants
   where table_schema='public' and table_name='nutrition_plan_profiles'
     and grantee='authenticated' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');
  perform pg_temp.verifier('B5. authenticated dispose des quatre privilèges (RLS reste la barrière)', nb = 4);
end $$;

do $$
begin
  perform pg_temp.verifier('B6. la RPC save_nutrition_plan_v2 existe',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='save_nutrition_plan_v2'));
end $$;

do $$
declare v record;
begin
  select p.prosecdef as definer,
         p.proconfig as config,
         pg_get_userbyid(p.proowner) as proprietaire
    into v
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='save_nutrition_plan_v2';
  -- security INVOKER : la fonction n'accorde aucun droit que l'appelant n'a
  -- pas déjà. Son propriétaire suit la convention du dépôt (le rôle qui
  -- applique les migrations, comme toutes les autres fonctions public.*).
  perform pg_temp.verifier('B7. RPC en security invoker', v.definer = false);
  -- PostgreSQL stocke `set search_path = ''` sous la forme littérale
  -- `search_path=""` dans pg_proc.proconfig : on teste donc les deux
  -- écritures possibles plutôt qu'une seule, arbitraire.
  perform pg_temp.verifier('B8. search_path verrouillé à vide',
    exists (select 1 from unnest(v.config) c
             where c in ('search_path=', 'search_path=""', 'search_path=''''')));
  perform pg_temp.verifier('B9. propriétaire conforme aux autres fonctions du schéma',
    v.proprietaire = (select pg_get_userbyid(p.proowner) from pg_proc p
                        join pg_namespace n on n.oid=p.pronamespace
                       where n.nspname='public' and p.proname='is_coach_or_admin'));
end $$;

do $$
begin
  perform pg_temp.verifier('B10. anon ne peut pas EXÉCUTER la RPC',
    not has_function_privilege('anon','public.save_nutrition_plan_v2(jsonb)','execute'));
  perform pg_temp.verifier('B11. PUBLIC ne peut pas EXÉCUTER la RPC',
    not has_function_privilege('public','public.save_nutrition_plan_v2(jsonb)','execute'));
  perform pg_temp.verifier('B12. authenticated peut EXÉCUTER la RPC (la garde staff fait le reste)',
    has_function_privilege('authenticated','public.save_nutrition_plan_v2(jsonb)','execute'));
end $$;

-- =====================================================================
-- C. FONCTIONNEL — conversion, sauvegarde canonique, idempotence
-- =====================================================================

create temp table _faits(cle text primary key, valeur text);

do $$
declare j jsonb;
begin
  perform pg_temp.incarner('cccc3333-3333-4333-8333-333333333333');
  j := public.save_nutrition_plan_v2(pg_temp.payload_v2('11110000-0000-4000-8000-000000000001', 'Plan v2 d''Alice'));
  perform pg_temp.retablir();
  insert into _faits values
    ('c_converted', j->'plan'->>'converted'),
    ('c_version',   j->'plan'->>'nutrition_model_version'),
    ('c_nb_slots',  jsonb_array_length(j->'slots')::text),
    ('c_target',    (j->'daily_target')::text),
    ('c_profil',    j->'profile'->>'profile_key'),
    ('c_derive_p',  j->'derived'->>'protein_grams'),
    ('c_nom',       j->'plan'->>'name');
end $$;

do $$
begin
  -- ⚠️ PR C — il n'y a plus rien à convertir : tous les plans sont en v2 et
  -- la contrainte l'impose. Le drapeau `converted` est conservé dans le
  -- retour de la RPC pour ne pas casser les appelants, mais il vaut désormais
  -- toujours `false`. C'est CELA que le contrôle vérifie.
  perform pg_temp.verifier('C1. aucune conversion : le modèle v1 n''existe plus',
    (select valeur from _faits where cle='c_converted') = 'false');
  perform pg_temp.verifier('C2. le plan est passé en version 2',
    (select valeur from _faits where cle='c_version') = '2');
  perform pg_temp.verifier('C3. le retour canonique porte les six créneaux',
    (select valeur from _faits where cle='c_nb_slots') = '6');
  perform pg_temp.verifier('C4. le retour canonique porte le profil « default »',
    (select valeur from _faits where cle='c_profil') = 'default');
  perform pg_temp.verifier('C5. les macros dérivées sont retournées (119 g de protéines)',
    (select valeur from _faits where cle='c_derive_p')::numeric = 119);
end $$;

do $$
declare v record;
begin
  select np.nutrition_model_version as version,
         np.daily_target as cible,
         (select count(*) from public.nutrition_plan_profiles pr where pr.plan_id = np.id) as nb_profils,
         (select count(*) from public.nutrition_meal_slot_targets t
            join public.nutrition_plan_profiles pr on pr.id = t.profile_id
           where pr.plan_id = np.id) as nb_creneaux
    into v
    from public.nutrition_plans np where np.id = '11110000-0000-4000-8000-000000000001';
  perform pg_temp.verifier('C6. la base porte bien un profil et six créneaux',
    v.nb_profils = 1 and v.nb_creneaux = 6);
  -- daily_target REGÉNÉRÉ depuis le profil : 1 700 kcal à 28/48/24
  -- ⇒ 119 g de protéines, 204 g de glucides, 45 g de lipides.
  perform pg_temp.verifier('C7. daily_target synchronisé sur le profil, au format attendu par l''app',
    v.cible = '{"fat": 45, "carbs": 204, "protein": 119, "calories": 1700}'::jsonb);
  perform pg_temp.verifier('C8. l''ancien daily_target v1 (2000 kcal) a bien été remplacé',
    (v.cible->>'calories')::numeric = 1700);
end $$;

-- Rejeu à l'identique : même état, aucune ligne dupliquée.
do $$
declare j jsonb; nb_avant int; nb_apres int; cible_avant jsonb; cible_apres jsonb;
begin
  -- Compte et cible lus séparément : `jsonb` n'a pas d'agrégat max().
  select count(*) into nb_avant
    from public.nutrition_meal_slot_targets t
    join public.nutrition_plan_profiles pr on pr.id = t.profile_id
   where pr.plan_id = '11110000-0000-4000-8000-000000000001';
  select np.daily_target into cible_avant
    from public.nutrition_plans np where np.id = '11110000-0000-4000-8000-000000000001';

  perform pg_temp.incarner('cccc3333-3333-4333-8333-333333333333');
  j := public.save_nutrition_plan_v2(pg_temp.payload_v2('11110000-0000-4000-8000-000000000001', 'Plan v2 d''Alice'));
  perform pg_temp.retablir();

  select count(*) into nb_apres
    from public.nutrition_meal_slot_targets t
    join public.nutrition_plan_profiles pr on pr.id = t.profile_id
   where pr.plan_id = '11110000-0000-4000-8000-000000000001';
  select np.daily_target into cible_apres
    from public.nutrition_plans np where np.id = '11110000-0000-4000-8000-000000000001';

  perform pg_temp.verifier('C9. rejeu idempotent : toujours six créneaux, aucun doublon',
    nb_avant = 6 and nb_apres = 6);
  perform pg_temp.verifier('C10. rejeu idempotent : daily_target inchangé', cible_avant = cible_apres);
  perform pg_temp.verifier('C11. rejeu sur un plan déjà v2 : plus aucune conversion signalée',
    (j->'plan'->>'converted') = 'false');
end $$;

-- Le plan v1 de Bob n'a JAMAIS été touché : aucun backfill.
do $$
declare v record;
begin
  select np.nutrition_model_version as version, np.daily_target as cible,
         (select count(*) from public.nutrition_plan_profiles pr where pr.plan_id = np.id) as nb
    into v from public.nutrition_plans np where np.id='22220000-0000-4000-8000-000000000002';
  -- ⚠️ PR C — tous les plans sont en v2. Ce qui reste vrai, et qui était le
  -- fond du contrôle : la RPC ne touche QUE le plan qu'on lui désigne. Le
  -- plan voisin garde donc sa cible d'origine et n'a reçu ni profil, ni
  -- répartition inventée.
  perform pg_temp.verifier('C12. le plan voisin n''a PAS été touché : aucune répartition inventée',
    v.version = 2 and v.nb = 0 and (v.cible->>'calories')::numeric = 1800);
end $$;

-- =====================================================================
-- D. SAUVEGARDE ATOMIQUE
-- =====================================================================
-- Aucune porte dérobée de type `inject_failure` : on envoie un payload dont
-- le SIXIÈME créneau porte une valeur hors borne. La RPC écrit d'abord le
-- plan (nouveau nom, nouveau daily_target), puis le profil, puis les cinq
-- premiers créneaux — et échoue seulement sur le sixième, sur la contrainte
-- CHECK de la table. Le bloc EXCEPTION crée une sous-transaction : son
-- annulation doit ramener EXACTEMENT l'état d'avant.

do $$
declare j jsonb; erreur_levee boolean := false;
begin
  insert into _faits
    select 'd_nom', name from public.nutrition_plans where id='11110000-0000-4000-8000-000000000001';
  insert into _faits
    select 'd_target', daily_target::text from public.nutrition_plans where id='11110000-0000-4000-8000-000000000001';
  insert into _faits
    select 'd_profil', (daily_calories::text || '/' || protein_bp::text)
      from public.nutrition_plan_profiles where plan_id='11110000-0000-4000-8000-000000000001';
  insert into _faits
    select 'd_creneaux', string_agg(t.slot || ':' || t.protein_bp::text, ',' order by t.display_order)
      from public.nutrition_meal_slot_targets t
      join public.nutrition_plan_profiles pr on pr.id = t.profile_id
     where pr.plan_id='11110000-0000-4000-8000-000000000001';

  perform pg_temp.incarner('cccc3333-3333-4333-8333-333333333333');
  begin
    -- Nom différent ET dessert hors borne : si la transaction n'était pas
    -- annulée, le nom du plan aurait changé.
    j := public.save_nutrition_plan_v2(
      pg_temp.payload_v2('11110000-0000-4000-8000-000000000001', 'NOM QUI NE DOIT JAMAIS APPARAÎTRE', 20000));
  exception when others then
    erreur_levee := true;
  end;
  perform pg_temp.retablir();
  insert into _faits values ('d_erreur', erreur_levee::text);
end $$;

do $$
declare v record;
begin
  perform pg_temp.verifier('D1. le payload hors borne fait bien échouer la sauvegarde',
    (select valeur from _faits where cle='d_erreur') = 'true');

  select np.name as nom, np.daily_target::text as cible,
         (select pr.daily_calories::text || '/' || pr.protein_bp::text
            from public.nutrition_plan_profiles pr where pr.plan_id = np.id) as profil,
         (select string_agg(t.slot || ':' || t.protein_bp::text, ',' order by t.display_order)
            from public.nutrition_meal_slot_targets t
            join public.nutrition_plan_profiles pr on pr.id = t.profile_id
           where pr.plan_id = np.id) as creneaux,
         (select count(*) from public.nutrition_meal_slot_targets t
            join public.nutrition_plan_profiles pr on pr.id = t.profile_id
           where pr.plan_id = np.id) as nb
    into v
    from public.nutrition_plans np where np.id='11110000-0000-4000-8000-000000000001';

  perform pg_temp.verifier('D2. plan INCHANGÉ après l''échec',
    v.nom = (select valeur from _faits where cle='d_nom'));
  perform pg_temp.verifier('D3. daily_target INCHANGÉ après l''échec',
    v.cible = (select valeur from _faits where cle='d_target'));
  perform pg_temp.verifier('D4. profil INCHANGÉ après l''échec',
    v.profil = (select valeur from _faits where cle='d_profil'));
  perform pg_temp.verifier('D5. créneaux INCHANGÉS après l''échec',
    v.creneaux = (select valeur from _faits where cle='d_creneaux'));
  perform pg_temp.verifier('D6. aucune ligne partielle : toujours exactement six créneaux', v.nb = 6);
end $$;

-- Un payload structurellement invalide échoue AVANT toute écriture.
do $$
declare erreur boolean := false;
begin
  perform pg_temp.incarner('cccc3333-3333-4333-8333-333333333333');
  begin
    perform public.save_nutrition_plan_v2(jsonb_build_object(
      'plan_id','11110000-0000-4000-8000-000000000001',
      'profile', jsonb_build_object('profile_key','default','daily_calories',1700),
      'slots', jsonb_build_array(jsonb_build_object('slot','breakfast'))));
  exception when others then erreur := true;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('D7. un payload à cinq créneaux manquants est refusé', erreur);
end $$;

do $$
declare erreur boolean := false;
begin
  perform pg_temp.incarner('cccc3333-3333-4333-8333-333333333333');
  begin
    perform public.save_nutrition_plan_v2(jsonb_set(
      pg_temp.payload_v2('11110000-0000-4000-8000-000000000001'),
      '{slots,5,slot}', '"breakfast"'::jsonb));
  exception when others then erreur := true;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('D8. un créneau en doublon est refusé', erreur);
end $$;

-- =====================================================================
-- E. ACCÈS — élève, anon, authenticated non staff, isolement A / B
-- =====================================================================

-- Le plan v1 de Bob est converti en v2 par le coach, pour comparer deux
-- plans v2 appartenant à deux élèves différents.
do $$
begin
  perform pg_temp.incarner('cccc3333-3333-4333-8333-333333333333');
  perform public.save_nutrition_plan_v2(pg_temp.payload_v2('22220000-0000-4000-8000-000000000002', 'Plan v2 de Bob'));
  perform pg_temp.retablir();
end $$;

do $$
declare nb_profils int; nb_creneaux int;
begin
  perform pg_temp.incarner('aaaa1111-1111-4111-8111-111111111111');
  select count(*) into nb_profils from public.nutrition_plan_profiles
   where plan_id = '11110000-0000-4000-8000-000000000001';
  select count(*) into nb_creneaux from public.nutrition_meal_slot_targets t
    join public.nutrition_plan_profiles pr on pr.id = t.profile_id
   where pr.plan_id = '11110000-0000-4000-8000-000000000001';
  perform pg_temp.retablir();
  perform pg_temp.verifier('E1. l''élève A lit le profil et les six créneaux de SON plan',
    nb_profils = 1 and nb_creneaux = 6);
end $$;

do $$
declare nb_profils int; nb_creneaux int;
begin
  perform pg_temp.incarner('aaaa1111-1111-4111-8111-111111111111');
  select count(*) into nb_profils from public.nutrition_plan_profiles
   where plan_id = '22220000-0000-4000-8000-000000000002';
  select count(*) into nb_creneaux from public.nutrition_meal_slot_targets t
    join public.nutrition_plan_profiles pr on pr.id = t.profile_id
   where pr.plan_id = '22220000-0000-4000-8000-000000000002';
  perform pg_temp.retablir();
  perform pg_temp.verifier('E2. l''élève A ne lit RIEN du plan de l''élève B',
    nb_profils = 0 and nb_creneaux = 0);
end $$;

do $$
declare bloque boolean := false; nb int;
begin
  perform pg_temp.incarner('aaaa1111-1111-4111-8111-111111111111');
  begin
    update public.nutrition_plan_profiles set protein_bp = 9999
     where plan_id = '11110000-0000-4000-8000-000000000001';
    get diagnostics nb = row_count;
    bloque := (nb = 0);
  exception when insufficient_privilege then bloque := true;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('E3. l''élève ne peut pas MODIFIER un profil', bloque);
end $$;

do $$
declare bloque boolean := false;
begin
  perform pg_temp.incarner('aaaa1111-1111-4111-8111-111111111111');
  begin
    insert into public.nutrition_plan_profiles (plan_id, profile_key)
    values ('11110000-0000-4000-8000-000000000001', 'pirate');
  exception when insufficient_privilege then bloque := true;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('E4. l''élève ne peut pas CRÉER de profil', bloque);
end $$;

do $$
declare bloque boolean := false;
begin
  perform pg_temp.incarner('aaaa1111-1111-4111-8111-111111111111');
  begin
    perform public.save_nutrition_plan_v2(pg_temp.payload_v2('11110000-0000-4000-8000-000000000001'));
  exception when others then bloque := true;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('E5. l''élève ne peut pas EXÉCUTER la sauvegarde v2', bloque);
end $$;

do $$
declare bloque boolean := false;
begin
  perform pg_temp.incarner('dddd4444-4444-4444-8444-444444444444');
  begin
    perform public.save_nutrition_plan_v2(pg_temp.payload_v2('11110000-0000-4000-8000-000000000001'));
  exception when others then bloque := true;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('E6. un authenticated non staff ne peut pas sauvegarder de plan', bloque);
end $$;

do $$
declare nb int; bloque boolean := false;
begin
  perform pg_temp.anonyme();
  begin
    select count(*) into nb from public.nutrition_plan_profiles;
  exception when insufficient_privilege then nb := -1;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('E7. anon ne lit AUCUN profil', nb <= 0);

  perform pg_temp.anonyme();
  begin
    perform public.save_nutrition_plan_v2(pg_temp.payload_v2('11110000-0000-4000-8000-000000000001'));
  exception when others then bloque := true;
  end;
  perform pg_temp.retablir();
  perform pg_temp.verifier('E8. anon ne peut pas EXÉCUTER la sauvegarde v2', bloque);
end $$;

-- =====================================================================
-- F. PROPRETÉ
-- =====================================================================

do $$
declare nb int;
begin
  select count(*) into nb from public.nutrition_plans
   where id in ('11110000-0000-4000-8000-000000000001','22220000-0000-4000-8000-000000000002');
  perform pg_temp.verifier('F1. les plans de test existent AVANT le rollback (ils vont disparaître)', nb = 2);
end $$;

\echo ''
\echo '--- Tous les contrôles sont passés. ROLLBACK : aucune donnée de test ne subsiste. ---'
\echo ''

rollback;

-- Contrôle POST-ROLLBACK : plus aucune trace, hors transaction.
do $$
declare nb int;
begin
  select count(*) into nb from public.nutrition_plans
   where id in ('11110000-0000-4000-8000-000000000001','22220000-0000-4000-8000-000000000002');
  if nb <> 0 then
    raise exception 'ÉCHEC   — F2. des données de test ont survécu au ROLLBACK (% lignes)', nb;
  end if;
  select count(*) into nb from auth.users where email like 'nutri.%@test.local';
  if nb <> 0 then
    raise exception 'ÉCHEC   — F3. des comptes de test ont survécu au ROLLBACK (% lignes)', nb;
  end if;
  raise notice 'OK      — F2/F3. aucune donnée de test persistante après le ROLLBACK';
end $$;
