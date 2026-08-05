-- =====================================================================
-- CHECKLIST PostgreSQL — persistance de `weekly_target_calories`
-- Migration 20260805090000, chantier feat/nutrition-plan-v2-builder (PR 2).
-- =====================================================================
--
-- À exécuter EXCLUSIVEMENT sur une pile Supabase LOCALE, jamais sur la
-- production. Tout se déroule dans une transaction terminée par ROLLBACK.
--
--   npm run db:local:init
--   DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)"
--   docker exec -i "$DB_CONTAINER" \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/nutrition_plan_v2_weekly_target_checklist.sql
--
-- COUVERTURE
--   A. fonction recréée, sécurité / owner / search_path / privilèges inchangés
--   B. création v2 : valeur hebdomadaire réellement PERSISTÉE en base
--   C. modification v2 : recalcul persistant dans la même transaction
--   D. brouillon sans calories : la colonne reste NULL (aucune invention)
--   E. conversion v1 → v2 : la colonne est renseignée
--   F. rollback complet sur erreur
--   G. plans v1 non modifiés · aucune donnée de test persistante
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- ---------------------------------------------------------------------
-- Outillage (identique à la checklist de la PR 1)
-- ---------------------------------------------------------------------
create or replace function pg_temp.claims(p_sub text, p_role text)
returns void language plpgsql as $$
begin
  reset role;
  if p_sub is null or p_sub = '' then
    perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
    perform set_config('request.jwt.claim.sub', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
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

-- Payload paramétrable. `p_calories = null` ⇒ la clé `daily_calories` est
-- ABSENTE du JSON : c'est le cas « brouillon sans calories ».
create or replace function pg_temp.payload(
  p_plan_id uuid,
  p_nom text,
  p_calories numeric,
  p_dessert_protein_bp integer default 1666
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'plan_id', p_plan_id,
    'plan', jsonb_build_object('name', p_nom, 'goal_type', 'maintien', 'status', 'prochain'),
    'profile',
      case when p_calories is null
        then jsonb_build_object('profile_key','default','protein_bp',2800,'carb_bp',4800,'fat_bp',2400)
        else jsonb_build_object('profile_key','default','daily_calories',p_calories,'protein_bp',2800,'carb_bp',4800,'fat_bp',2400)
      end,
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
-- Jeu d'essai
-- ---------------------------------------------------------------------
insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role)
values ('eeee5555-5555-4555-8555-555555555555', 'wt.coach@test.local', crypt('mdp-test', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email)
values ('eeee5555-5555-4555-8555-555555555555', 'coach', 'Wanda', 'T', 'wt.coach@test.local');

-- Un plan v1 TÉMOIN, avec son objectif hebdomadaire d'origine : il ne doit
-- jamais bouger.
insert into public.nutrition_plans (id, name, goal_type, status, daily_target, weekly_target_calories, nutrition_model_version)
values ('99990000-0000-4000-8000-000000000001', 'Témoin v1', 'maintien', 'actif',
        '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb, 14000, 1);

-- Un plan v1 à CONVERTIR.
insert into public.nutrition_plans (id, name, goal_type, status, daily_target, weekly_target_calories, nutrition_model_version)
values ('99990000-0000-4000-8000-000000000002', 'À convertir', 'maintien', 'actif',
        '{"calories":1800,"protein":135,"carbs":180,"fat":50}'::jsonb, null, 1);

-- =====================================================================
-- A. FONCTION RECRÉÉE — sécurité, owner, search_path, privilèges
-- =====================================================================

do $$
declare v record;
begin
  select p.prosecdef as definer, p.proconfig as config,
         pg_get_userbyid(p.proowner) as proprietaire,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as retour,
         l.lanname as langage
    into v
    from pg_proc p
    join pg_language l on l.oid = p.prolang
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_nutrition_plan_v2';

  perform pg_temp.verifier('A1. la fonction existe', v is not null);
  perform pg_temp.verifier('A2. signature inchangée : (p_payload jsonb) returns jsonb',
    v.args = 'p_payload jsonb' and v.retour = 'jsonb');
  perform pg_temp.verifier('A3. langage inchangé (plpgsql)', v.langage = 'plpgsql');
  perform pg_temp.verifier('A4. SECURITY INVOKER conservé', v.definer = false);
  perform pg_temp.verifier('A5. search_path toujours verrouillé à vide',
    exists (select 1 from unnest(v.config) c where c in ('search_path=', 'search_path=""', 'search_path=''''')));
  perform pg_temp.verifier('A6. propriétaire conforme aux autres fonctions du schéma',
    v.proprietaire = (select pg_get_userbyid(p.proowner) from pg_proc p
                        join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname='public' and p.proname='is_coach_or_admin'));
end $$;

do $$
begin
  perform pg_temp.verifier('A7. anon ne peut toujours pas exécuter la RPC',
    not has_function_privilege('anon','public.save_nutrition_plan_v2(jsonb)','execute'));
  perform pg_temp.verifier('A8. PUBLIC ne peut toujours pas exécuter la RPC',
    not has_function_privilege('public','public.save_nutrition_plan_v2(jsonb)','execute'));
  perform pg_temp.verifier('A9. authenticated peut toujours exécuter la RPC',
    has_function_privilege('authenticated','public.save_nutrition_plan_v2(jsonb)','execute'));
end $$;

do $$
declare nb int;
begin
  -- La migration ne touche QUE la fonction : les tables et policies v2
  -- restent celles de 20260804090000.
  select count(*) into nb from pg_policies
   where schemaname='public'
     and tablename in ('nutrition_plan_profiles','nutrition_meal_slot_targets');
  perform pg_temp.verifier('A10. les quatre policies v2 sont intactes', nb = 4);
  perform pg_temp.verifier('A11. RLS toujours activée',
    (select relrowsecurity from pg_class where oid='public.nutrition_plan_profiles'::regclass)
    and (select relrowsecurity from pg_class where oid='public.nutrition_meal_slot_targets'::regclass));
end $$;

-- =====================================================================
-- B. CRÉATION v2 — la valeur est PERSISTÉE, pas seulement affichée
-- =====================================================================

create temp table _faits(cle text primary key, valeur text);
-- Les scénarios ci-dessous lisent _faits alors que le rôle courant est
-- `authenticated` : le schéma temporaire doit lui être ouvert, comme dans la
-- checklist de la PR 1.
do $$ declare s text; begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._faits to authenticated, anon', s);
end $$;

do $$
declare j jsonb;
begin
  perform pg_temp.incarner('eeee5555-5555-4555-8555-555555555555');
  j := public.save_nutrition_plan_v2(pg_temp.payload(null, 'Création v2 à 2400', 2400));
  perform pg_temp.retablir();
  insert into _faits values ('b_id', j->'plan'->>'id');
end $$;

do $$
declare v record;
begin
  select np.weekly_target_calories as hebdo, np.nutrition_model_version as version,
         np.daily_target->>'calories' as cal,
         (select pr.daily_calories from public.nutrition_plan_profiles pr where pr.plan_id = np.id) as profil_cal,
         (select count(*) from public.nutrition_meal_slot_targets t
            join public.nutrition_plan_profiles pr on pr.id = t.profile_id
           where pr.plan_id = np.id) as nb_creneaux
    into v
    from public.nutrition_plans np
   where np.id = (select valeur from _faits where cle='b_id')::uuid;

  -- LA vérification centrale : la LIGNE BRUTE porte 16 800.
  perform pg_temp.verifier('B1. création à 2400 kcal ⇒ weekly_target_calories = 16800 EN BASE',
    v.hebdo = 16800);
  perform pg_temp.verifier('B2. le plan est bien en v2', v.version = 2);
  perform pg_temp.verifier('B3. daily_target cohérent', v.cal::numeric = 2400);
  perform pg_temp.verifier('B4. profil créé avec les mêmes calories', v.profil_cal = 2400);
  perform pg_temp.verifier('B5. six créneaux créés dans la même transaction', v.nb_creneaux = 6);
end $$;

-- =====================================================================
-- C. MODIFICATION v2 — recalcul persistant, même transaction
-- =====================================================================

do $$
begin
  perform pg_temp.incarner('eeee5555-5555-4555-8555-555555555555');
  perform public.save_nutrition_plan_v2(
    pg_temp.payload((select valeur from _faits where cle='b_id')::uuid, 'Création v2 à 2400', 2000));
  perform pg_temp.retablir();
end $$;

do $$
declare v record;
begin
  select np.weekly_target_calories as hebdo,
         np.daily_target->>'calories' as cal,
         (select pr.daily_calories from public.nutrition_plan_profiles pr where pr.plan_id = np.id) as profil_cal,
         (select count(*) from public.nutrition_meal_slot_targets t
            join public.nutrition_plan_profiles pr on pr.id = t.profile_id
           where pr.plan_id = np.id) as nb_creneaux
    into v
    from public.nutrition_plans np
   where np.id = (select valeur from _faits where cle='b_id')::uuid;

  perform pg_temp.verifier('C1. modification 2400 → 2000 ⇒ weekly_target_calories = 14000 EN BASE',
    v.hebdo = 14000);
  perform pg_temp.verifier('C2. daily_target recalculé dans la même transaction', v.cal::numeric = 2000);
  perform pg_temp.verifier('C3. profil recalculé', v.profil_cal = 2000);
  perform pg_temp.verifier('C4. toujours exactement six créneaux (idempotence)', v.nb_creneaux = 6);
end $$;

-- Rejeu à l'identique : aucun effet de bord.
do $$
declare hebdo_avant numeric; hebdo_apres numeric;
begin
  select weekly_target_calories into hebdo_avant from public.nutrition_plans
   where id = (select valeur from _faits where cle='b_id')::uuid;
  perform pg_temp.incarner('eeee5555-5555-4555-8555-555555555555');
  perform public.save_nutrition_plan_v2(
    pg_temp.payload((select valeur from _faits where cle='b_id')::uuid, 'Création v2 à 2400', 2000));
  perform pg_temp.retablir();
  select weekly_target_calories into hebdo_apres from public.nutrition_plans
   where id = (select valeur from _faits where cle='b_id')::uuid;
  perform pg_temp.verifier('C5. rejeu idempotent : valeur hebdomadaire inchangée',
    hebdo_avant = hebdo_apres and hebdo_apres = 14000);
end $$;

-- =====================================================================
-- D. BROUILLON SANS CALORIES — la colonne reste NULL
-- =====================================================================

do $$
declare j jsonb;
begin
  perform pg_temp.incarner('eeee5555-5555-4555-8555-555555555555');
  -- `p_calories = null` ⇒ la clé `daily_calories` est ABSENTE du payload.
  j := public.save_nutrition_plan_v2(pg_temp.payload(null, 'Brouillon sans calories', null));
  perform pg_temp.retablir();
  insert into _faits values ('d_id', j->'plan'->>'id');
end $$;

do $$
declare v record;
begin
  select np.weekly_target_calories as hebdo,
         (select pr.daily_calories from public.nutrition_plan_profiles pr where pr.plan_id = np.id) as profil_cal,
         (select count(*) from public.nutrition_meal_slot_targets t
            join public.nutrition_plan_profiles pr on pr.id = t.profile_id
           where pr.plan_id = np.id) as nb
    into v
    from public.nutrition_plans np
   where np.id = (select valeur from _faits where cle='d_id')::uuid;

  perform pg_temp.verifier('D1. brouillon sans calories ⇒ weekly_target_calories reste NULL',
    v.hebdo is null);
  perform pg_temp.verifier('D2. aucune valeur inventée : le profil est bien à 0', v.profil_cal = 0);
  perform pg_temp.verifier('D3. le brouillon est tout de même enregistrable (six créneaux)', v.nb = 6);
end $$;

-- =====================================================================
-- E. CONVERSION v1 → v2
-- =====================================================================

do $$
declare j jsonb;
begin
  perform pg_temp.incarner('eeee5555-5555-4555-8555-555555555555');
  j := public.save_nutrition_plan_v2(pg_temp.payload('99990000-0000-4000-8000-000000000002', 'Converti', 2200));
  perform pg_temp.retablir();
  insert into _faits values ('e_converted', j->'plan'->>'converted');
end $$;

do $$
declare v record;
begin
  select np.weekly_target_calories as hebdo, np.nutrition_model_version as version
    into v from public.nutrition_plans np where np.id = '99990000-0000-4000-8000-000000000002';
  perform pg_temp.verifier('E1. la conversion est signalée',
    (select valeur from _faits where cle='e_converted') = 'true');
  perform pg_temp.verifier('E2. le plan converti passe en v2', v.version = 2);
  perform pg_temp.verifier('E3. conversion à 2200 kcal ⇒ 15400 EN BASE (était NULL)', v.hebdo = 15400);
end $$;

-- =====================================================================
-- F. ROLLBACK COMPLET SUR ERREUR
-- =====================================================================

do $$
declare erreur boolean := false;
begin
  insert into _faits
    select 'f_hebdo', weekly_target_calories::text from public.nutrition_plans
     where id = (select valeur from _faits where cle='b_id')::uuid;
  insert into _faits
    select 'f_nom', name from public.nutrition_plans
     where id = (select valeur from _faits where cle='b_id')::uuid;

  perform pg_temp.incarner('eeee5555-5555-4555-8555-555555555555');
  begin
    -- Calories différentes ET sixième créneau hors borne : si la transaction
    -- n'était pas annulée, weekly_target_calories vaudrait 63 000.
    perform public.save_nutrition_plan_v2(
      pg_temp.payload((select valeur from _faits where cle='b_id')::uuid, 'NOM QUI NE DOIT PAS RESTER', 9000, 20000));
  exception when others then erreur := true;
  end;
  perform pg_temp.retablir();
  insert into _faits values ('f_erreur', erreur::text);
end $$;

do $$
declare v record;
begin
  select np.weekly_target_calories::text as hebdo, np.name as nom
    into v from public.nutrition_plans np
   where np.id = (select valeur from _faits where cle='b_id')::uuid;
  perform pg_temp.verifier('F1. le payload hors borne fait échouer la sauvegarde',
    (select valeur from _faits where cle='f_erreur') = 'true');
  perform pg_temp.verifier('F2. weekly_target_calories INCHANGÉ après l''échec',
    v.hebdo = (select valeur from _faits where cle='f_hebdo'));
  perform pg_temp.verifier('F3. nom du plan INCHANGÉ après l''échec',
    v.nom = (select valeur from _faits where cle='f_nom'));
  perform pg_temp.verifier('F4. aucune valeur partielle : 14000 toujours en base',
    v.hebdo::numeric = 14000);
end $$;

-- =====================================================================
-- G. PLANS v1 INTACTS
-- =====================================================================

do $$
declare v record;
begin
  select weekly_target_calories as hebdo, nutrition_model_version as version,
         (select count(*) from public.nutrition_plan_profiles pr where pr.plan_id = np.id) as profils
    into v from public.nutrition_plans np where np.id = '99990000-0000-4000-8000-000000000001';
  perform pg_temp.verifier('G1. le plan v1 témoin conserve son objectif hebdomadaire (14000)', v.hebdo = 14000);
  perform pg_temp.verifier('G2. le plan v1 témoin reste en v1, sans profil', v.version = 1 and v.profils = 0);
end $$;

\echo ''
\echo '--- Tous les contrôles sont passés. ROLLBACK : aucune donnée de test ne subsiste. ---'
\echo ''

rollback;

-- Contrôle POST-ROLLBACK, hors transaction.
do $$
declare nb int;
begin
  select count(*) into nb from public.nutrition_plans
   where name in ('Témoin v1', 'À convertir', 'Création v2 à 2400', 'Brouillon sans calories', 'Converti');
  if nb <> 0 then
    raise exception 'ÉCHEC   — G3. des plans de test ont survécu au ROLLBACK (% lignes)', nb;
  end if;
  select count(*) into nb from auth.users where email = 'wt.coach@test.local';
  if nb <> 0 then
    raise exception 'ÉCHEC   — G4. un compte de test a survécu au ROLLBACK';
  end if;
  raise notice 'OK      — G3/G4. aucune donnée de test persistante après le ROLLBACK';
end $$;
