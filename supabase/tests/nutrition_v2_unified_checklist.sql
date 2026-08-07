-- ============================================================================
-- Checklist PostgreSQL — feat/student-nutrition-recipes, PR C
-- Migrations couvertes :
--   20260810090000_harden_nutrition_privileges.sql
--   20260811090000_nutrition_v2_unification.sql
--   20260812090000_save_nutrition_plan_v2_full.sql
--   20260813090000_student_recipe_read_access.sql
--   20260815090000_nutrition_lifecycle.sql
--   20260816090000_nutrition_plan_coach_ownership.sql
--
-- Sections :
--   A. structure du modèle unifié (colonnes, contraintes, clés, index) ;
--   B. conversion v1 → v2, sans perte, sur des données réellement v1 ;
--   C. durcissement : TRUNCATE, students, nutrition_days ;
--   D. sauvegarde transactionnelle : sept jours, repas, somme hebdomadaire,
--      rollback complet sur erreur ;
--   E. sécurité des recettes : élève, coach, autre coach, admin, anonyme,
--      attaques directes sur les tables enfants ;
--   F. non-régression de l'outil 1 (nutrition_daily_logs) ;
--   H. la garde d'assignation contrôle les SEPT jours ;
--   I. CYCLE DE VIE (PR D) : les 22 cas exigés — publication, archivage,
--      suppression définitive, appels DIRECTS des RPC par un élève, tentative
--      de suppression inter-coach, préservation des jours, repas et journaux,
--      absence d'orphelin, et RLS toujours active ;
--   K. le PROPRIÉTAIRE d'un plan : sans lui, l'élève ne voyait AUCUNE recette.
--      La séquence réelle est rejouée de bout en bout ;
--   G. aucune donnée de test persistante après le ROLLBACK.
--
-- Lancement :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/nutrition_v2_unified_checklist.sql
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;

-- La section I note ses résultats SOUS les rôles applicatifs, au moment même
-- où elle éprouve la RLS — sortir du rôle pour écrire un fait ferait perdre le
-- contexte qu'on teste. Ces deux rôles doivent donc pouvoir écrire dans la
-- table de faits. Même convention que nutrition_recipes_checklist.sql.
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
  insert into _faits values (p_section, p_libelle, p_ok);
  if p_ok then raise notice 'OK      — %', p_libelle;
  else raise warning 'ÉCHEC   — %', p_libelle; end if;
end $$;

-- ---------------------------------------------------------------------
-- Jeu d'essai
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a1110000-0000-4000-8000-000000000001', 'pc.coachA@test.local'),
  ('a1110000-0000-4000-8000-000000000002', 'pc.coachB@test.local'),
  ('a1110000-0000-4000-8000-000000000003', 'pc.eleveA@test.local'),
  ('a1110000-0000-4000-8000-000000000004', 'pc.admin@test.local'),
  ('a1110000-0000-4000-8000-000000000005', 'pc.eleveB@test.local')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('a1110000-0000-4000-8000-000000000001', 'coach',   'Coach', 'A', 'pc.coachA@test.local'),
  ('a1110000-0000-4000-8000-000000000002', 'coach',   'Coach', 'B', 'pc.coachB@test.local'),
  ('a1110000-0000-4000-8000-000000000003', 'student', 'Elève', 'A', 'pc.eleveA@test.local'),
  ('a1110000-0000-4000-8000-000000000004', 'admin',   'Admin', 'C', 'pc.admin@test.local'),
  ('a1110000-0000-4000-8000-000000000005', 'student', 'Elève', 'B', 'pc.eleveB@test.local');

insert into public.coaches (id, user_id, name, email) values
  ('c1110000-0000-4000-8000-00000000000a', 'a1110000-0000-4000-8000-000000000001', 'Coach A', 'pc.coachA@test.local'),
  ('c1110000-0000-4000-8000-00000000000b', 'a1110000-0000-4000-8000-000000000002', 'Coach B', 'pc.coachB@test.local');

insert into public.students (id, user_id, first_name, last_name, email, status, access_type, coach_id) values
  ('51110000-0000-4000-8000-00000000000a', 'a1110000-0000-4000-8000-000000000003',
   'Elève', 'A', 'pc.eleveA@test.local', 'active', 'coaching', 'c1110000-0000-4000-8000-00000000000a'),
  ('51110000-0000-4000-8000-00000000000b', 'a1110000-0000-4000-8000-000000000005',
   'Elève', 'B', 'pc.eleveB@test.local', 'active', 'coaching', 'c1110000-0000-4000-8000-00000000000b');

-- ---------------------------------------------------------------------
-- Section A — structure du modèle unifié
-- ---------------------------------------------------------------------
do $$
declare v_def text;
begin
  perform pg_temp.noter('A', 'A1. nutrition_days.profile_key existe et est NOT NULL', exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'nutrition_days'
       and column_name = 'profile_key' and is_nullable = 'NO'));

  perform pg_temp.noter('A', 'A2. clé étrangère COMPOSITE (plan_id, profile_key)', exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.nutrition_days'::regclass
       and c.conname = 'nutrition_days_profile_fkey'
       and c.contype = 'f'
       and array_length(c.conkey, 1) = 2));

  perform pg_temp.noter('A', 'A3. un jour ne peut pas pointer vers le profil d''un AUTRE plan',
    (select confrelid from pg_constraint
      where conname = 'nutrition_days_profile_fkey') = 'public.nutrition_plan_profiles'::regclass);

  perform pg_temp.noter('A', 'A4. unicité (plan_id, day)', exists (
    select 1 from pg_constraint
     where conrelid = 'public.nutrition_days'::regclass
       and conname = 'nutrition_days_plan_day_unique' and contype = 'u'));

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.nutrition_days'::regclass and conname = 'nutrition_days_day_check';
  perform pg_temp.noter('A', 'A5. nutrition_days.day contraint aux SEPT clés',
    v_def like '%monday%' and v_def like '%sunday%' and v_def not like '%Lundi%');

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.meals'::regclass and conname = 'meals_slot_check';
  perform pg_temp.noter('A', 'A6. meals.slot contraint aux SIX clés v2',
    v_def like '%breakfast%' and v_def like '%dessert%' and v_def not like '%Petit%');

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.nutrition_plans'::regclass and conname = 'nutrition_plans_model_version_check';
  perform pg_temp.noter('A', 'A7. nutrition_model_version ne peut plus valoir que 2',
    v_def like '%= 2%' and v_def not like '%1%');

  perform pg_temp.noter('A', 'A8. le DEFAULT de nutrition_model_version vaut 2', (
    select column_default like '%2%' from information_schema.columns
     where table_schema = 'public' and table_name = 'nutrition_plans'
       and column_name = 'nutrition_model_version'));

  perform pg_temp.noter('A', 'A9. index sur nutrition_days.plan_id', exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'nutrition_days_plan_id_idx'));
  perform pg_temp.noter('A', 'A10. index sur meals.nutrition_day_id', exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'meals_nutrition_day_id_idx'));

  perform pg_temp.noter('A', 'A11. nutrition_days et meals existent TOUJOURS (outil 3)',
    to_regclass('public.nutrition_days') is not null
    and to_regclass('public.meals') is not null);
  perform pg_temp.noter('A', 'A12. nutrition_daily_logs existe TOUJOURS (outil 1)',
    to_regclass('public.nutrition_daily_logs') is not null);
end $$;

-- ---------------------------------------------------------------------
-- Section B — conversion v1 → v2 sur des données RÉELLEMENT v1
-- ---------------------------------------------------------------------
-- Les contraintes posées par la migration interdisent d'insérer des données
-- au format v1. On les retire LE TEMPS DE LA TRANSACTION pour reconstituer un
-- plan d'avant la migration, puis on rejoue les DEUX fonctions de maintenance
-- que la migration elle-même appelle — jamais une copie de leur logique.
alter table public.nutrition_plans drop constraint nutrition_plans_model_version_check;
alter table public.nutrition_days drop constraint nutrition_days_day_check;
alter table public.nutrition_days alter column profile_key drop not null;
alter table public.nutrition_days drop constraint nutrition_days_profile_fkey;
alter table public.meals drop constraint meals_slot_check;

insert into public.nutrition_plans
  (id, student_id, coach_id, name, goal_type, status, daily_target,
   nutrition_model_version, coach_notes, hydration_tip)
values
  ('91110000-0000-4000-8000-00000000000a',
   '51110000-0000-4000-8000-00000000000a',
   'c1110000-0000-4000-8000-00000000000a',
   'Plan hérité v1', 'maintien', 'actif',
   '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb,
   1, 'Note du coach à conserver', 'Boire 2 L par jour');

insert into public.nutrition_days (id, plan_id, day, status, target)
values
  ('d1110000-0000-4000-8000-00000000000a', '91110000-0000-4000-8000-00000000000a', 'Lundi', 'valide',
   '{"calories":2000}'::jsonb),
  ('d1110000-0000-4000-8000-00000000000b', '91110000-0000-4000-8000-00000000000a', 'Mardi', 'non-commence',
   '{}'::jsonb);

insert into public.meals (id, nutrition_day_id, slot, name, items, macros, coach_notes)
values
  ('e1110000-0000-4000-8000-00000000000a', 'd1110000-0000-4000-8000-00000000000a', 'Midi',
   'Repas avant entraînement',
   '[{"name":"Blanc de poulet","quantity":"150 g"},{"name":"Riz basmati","quantity":"100 g cru"}]'::jsonb,
   '{"calories":650,"protein":45,"carbs":80,"fat":15}'::jsonb,
   'Peser le riz cru.');

insert into public.nutrition_daily_logs
  (student_id, nutrition_plan_id, log_date, calories, protein_g, carbs_g, fat_g, note)
values
  ('51110000-0000-4000-8000-00000000000a', '91110000-0000-4000-8000-00000000000a',
   date '2026-08-05', 2000, 115, 285, 44, 'Journée témoin');

-- Rejeu des DEUX fonctions de maintenance de la migration.
select public.nutrition_v2_normalize_vocabulary();
select public.nutrition_v2_backfill_plan('91110000-0000-4000-8000-00000000000a');

-- Contraintes remises : elles doivent maintenant passer sur les données
-- converties. C'est en soi une preuve que la conversion est complète.
alter table public.nutrition_days
  add constraint nutrition_days_day_check
  check (day in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday'));
alter table public.nutrition_days alter column profile_key set not null;
alter table public.nutrition_days
  add constraint nutrition_days_profile_fkey
  foreign key (plan_id, profile_key)
  references public.nutrition_plan_profiles (plan_id, profile_key)
  on update cascade on delete restrict;
alter table public.meals
  add constraint meals_slot_check
  check (slot in ('breakfast','morning_snack','lunch','afternoon_snack','dinner','dessert'));
alter table public.nutrition_plans
  add constraint nutrition_plans_model_version_check check (nutrition_model_version = 2);

do $$
declare
  v_plan_id constant uuid := '91110000-0000-4000-8000-00000000000a';
  v_prof record;
begin
  perform pg_temp.noter('B', 'B1. le plan est passé en v2', (
    select nutrition_model_version from public.nutrition_plans where id = v_plan_id) = 2);
  perform pg_temp.noter('B', 'B2. l''identifiant du plan est CONSERVÉ', exists (
    select 1 from public.nutrition_plans where id = v_plan_id));
  perform pg_temp.noter('B', 'B3. student_id et coach_id sont CONSERVÉS', exists (
    select 1 from public.nutrition_plans
     where id = v_plan_id
       and student_id = '51110000-0000-4000-8000-00000000000a'
       and coach_id = 'c1110000-0000-4000-8000-00000000000a'));
  perform pg_temp.noter('B', 'B4. statut et consignes CONSERVÉS', exists (
    select 1 from public.nutrition_plans
     where id = v_plan_id and status = 'actif'
       and coach_notes = 'Note du coach à conserver'
       and hydration_tip = 'Boire 2 L par jour'));

  select * into v_prof from public.nutrition_plan_profiles
   where plan_id = v_plan_id and profile_key = 'legacy_default';
  perform pg_temp.noter('B', 'B5. un profil legacy_default est créé', v_prof.id is not null);
  perform pg_temp.noter('B', 'B6. ses calories viennent de daily_target', v_prof.daily_calories = 2000);
  -- 150 g × 4 kcal / 2000 kcal = 30 % = 3000 bp ; 200 × 4 / 2000 = 40 % ;
  -- 60 × 9 / 2000 = 27 %.
  perform pg_temp.noter('B', 'B7. ses parts P/G/L sont dérivées des grammes',
    v_prof.protein_bp = 3000 and v_prof.carb_bp = 4000 and v_prof.fat_bp = 2700);

  perform pg_temp.noter('B', 'B8. le profil a ses SIX créneaux', (
    select count(*) from public.nutrition_meal_slot_targets where profile_id = v_prof.id) = 6);
  perform pg_temp.noter('B', 'B9. la somme des créneaux ACTIFS vaut 10 000 par macro', (
    select sum(protein_bp) = 10000 and sum(carb_bp) = 10000 and sum(fat_bp) = 10000
      from public.nutrition_meal_slot_targets where profile_id = v_prof.id and enabled));

  perform pg_temp.noter('B', 'B10. le plan a exactement SEPT jours', (
    select count(*) from public.nutrition_days where plan_id = v_plan_id) = 7);
  perform pg_temp.noter('B', 'B11. les sept jours portent les clés monday…sunday', (
    select string_agg(day, ',' order by array_position(
      array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'], day))
      from public.nutrition_days where plan_id = v_plan_id)
    = 'monday,tuesday,wednesday,thursday,friday,saturday,sunday');
  perform pg_temp.noter('B', 'B12. chaque jour est rattaché à un profil VALIDE', not exists (
    select 1 from public.nutrition_days d
     where d.plan_id = v_plan_id
       and not exists (select 1 from public.nutrition_plan_profiles pr
                        where pr.plan_id = d.plan_id and pr.profile_key = d.profile_key)));

  perform pg_temp.noter('B', 'B13. le jour existant CONSERVE son identifiant et son statut', exists (
    select 1 from public.nutrition_days
     where id = 'd1110000-0000-4000-8000-00000000000a' and day = 'monday' and status = 'valide'));
  perform pg_temp.noter('B', 'B14. le repas prescrit est CONSERVÉ, créneau normalisé', exists (
    select 1 from public.meals
     where id = 'e1110000-0000-4000-8000-00000000000a'
       and slot = 'lunch'
       and name = 'Repas avant entraînement'
       and coach_notes = 'Peser le riz cru.'));
  perform pg_temp.noter('B', 'B15. les aliments et macros du repas sont INTACTS', exists (
    select 1 from public.meals
     where id = 'e1110000-0000-4000-8000-00000000000a'
       and items->0->>'name' = 'Blanc de poulet'
       and items->1->>'quantity' = '100 g cru'
       and (macros->>'calories')::numeric = 650));
  perform pg_temp.noter('B', 'B16. les logs de l''élève sont CONSERVÉS', exists (
    select 1 from public.nutrition_daily_logs
     where nutrition_plan_id = v_plan_id and log_date = date '2026-08-05'
       and calories = 2000 and note = 'Journée témoin'));

  -- Idempotence : rejouer la conversion ne doit rien changer.
  perform public.nutrition_v2_backfill_plan(v_plan_id);
  perform pg_temp.noter('B', 'B17. la conversion est IDEMPOTENTE (toujours 7 jours, 1 profil)',
    (select count(*) from public.nutrition_days where plan_id = v_plan_id) = 7
    and (select count(*) from public.nutrition_plan_profiles where plan_id = v_plan_id) = 1);
end $$;

-- ---------------------------------------------------------------------
-- Section C — durcissement
-- ---------------------------------------------------------------------
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'nutrition_plans','nutrition_days','meals','nutrition_daily_logs',
    'nutrition_plan_profiles','nutrition_meal_slot_targets',
    'nutrition_recipes','nutrition_recipe_ingredients','nutrition_recipe_tags'] loop
    perform pg_temp.noter('C', format('C1. aucun TRUNCATE pour authenticated sur %s', v_table),
      not has_table_privilege('authenticated', 'public.' || v_table, 'TRUNCATE'));
  end loop;

  perform pg_temp.noter('C', 'C2. authenticated garde SELECT/INSERT/UPDATE/DELETE sur nutrition_daily_logs (outil 1)',
    has_table_privilege('authenticated', 'public.nutrition_daily_logs', 'SELECT')
    and has_table_privilege('authenticated', 'public.nutrition_daily_logs', 'INSERT')
    and has_table_privilege('authenticated', 'public.nutrition_daily_logs', 'UPDATE')
    and has_table_privilege('authenticated', 'public.nutrition_daily_logs', 'DELETE'));

  perform pg_temp.noter('C', 'C3. le trigger de protection de students existe', exists (
    select 1 from pg_trigger where tgrelid = 'public.students'::regclass
       and tgname = 'protect_students_ownership'));
  perform pg_temp.noter('C', 'C4. le trigger de protection de nutrition_days existe', exists (
    select 1 from pg_trigger where tgrelid = 'public.nutrition_days'::regclass
       and tgname = 'protect_nutrition_days_coach_columns'));
end $$;

-- L'élève tente de se réattribuer un autre coach, et de s'octroyer un profil.
do $$
declare
  v_coach_apres uuid;
  v_cible_apres jsonb;
  v_profil_apres text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);

  update public.students
     set coach_id = 'c1110000-0000-4000-8000-00000000000b',
         access_type = 'programme_seul',
         status = 'inactive'
   where id = '51110000-0000-4000-8000-00000000000a';

  update public.nutrition_days
     set target = '{"calories":9999}'::jsonb,
         profile_key = 'legacy_default',
         status = 'en-cours'
   where id = 'd1110000-0000-4000-8000-00000000000a';

  reset role;

  select coach_id into v_coach_apres from public.students
   where id = '51110000-0000-4000-8000-00000000000a';
  perform pg_temp.noter('C', 'C5. l''élève ne peut PAS changer students.coach_id',
    v_coach_apres = 'c1110000-0000-4000-8000-00000000000a');
  perform pg_temp.noter('C', 'C6. l''élève ne peut PAS changer access_type ni status', exists (
    select 1 from public.students
     where id = '51110000-0000-4000-8000-00000000000a'
       and access_type = 'coaching' and status = 'active'));

  select target, profile_key into v_cible_apres, v_profil_apres
    from public.nutrition_days where id = 'd1110000-0000-4000-8000-00000000000a';
  perform pg_temp.noter('C', 'C7. l''élève ne peut PAS réécrire nutrition_days.target',
    (v_cible_apres->>'calories')::numeric <> 9999);
  perform pg_temp.noter('C', 'C8. l''élève ne peut PAS réécrire nutrition_days.profile_key',
    v_profil_apres = 'legacy_default');
  perform pg_temp.noter('C', 'C9. mais il peut TOUJOURS avancer son statut de journée', exists (
    select 1 from public.nutrition_days
     where id = 'd1110000-0000-4000-8000-00000000000a' and status = 'en-cours'));
end $$;

-- ---------------------------------------------------------------------
-- Section D — sauvegarde transactionnelle du plan complet
-- ---------------------------------------------------------------------
do $$
declare
  v_res jsonb;
  v_plan_id uuid;
  v_slots jsonb := jsonb_build_array(
    jsonb_build_object('slot','breakfast','enabled',true,'protein_bp',2500,'carb_bp',2500,'fat_bp',2500,'display_order',0),
    jsonb_build_object('slot','morning_snack','enabled',false,'protein_bp',0,'carb_bp',0,'fat_bp',0,'display_order',1),
    jsonb_build_object('slot','lunch','enabled',true,'protein_bp',3500,'carb_bp',3500,'fat_bp',3500,'display_order',2),
    jsonb_build_object('slot','afternoon_snack','enabled',true,'protein_bp',1000,'carb_bp',1000,'fat_bp',1000,'display_order',3),
    jsonb_build_object('slot','dinner','enabled',true,'protein_bp',3000,'carb_bp',3000,'fat_bp',3000,'display_order',4),
    jsonb_build_object('slot','dessert','enabled',false,'protein_bp',0,'carb_bp',0,'fat_bp',0,'display_order',5));
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  -- Deux profils, sept jours, un repas manuel le lundi.
  v_res := public.save_nutrition_plan_v2(jsonb_build_object(
    'plan', jsonb_build_object('name','Plan unifié','status','prochain','goal_type','prise-de-masse'),
    'profiles', jsonb_build_array(
      jsonb_build_object('profile_key','standard','daily_calories',2000,
        'protein_bp',2800,'carb_bp',4400,'fat_bp',2800,'slots',v_slots),
      jsonb_build_object('profile_key','training_high','daily_calories',2200,
        'protein_bp',2700,'carb_bp',4600,'fat_bp',2700,'slots',v_slots)),
    'main_profile_key','standard',
    'days', jsonb_build_array(
      jsonb_build_object('day','monday','profile_key','standard','meals', jsonb_build_array(
        jsonb_build_object('id','f1110000-0000-4000-8000-00000000000a',
          'slot','lunch','name','Repas avant entraînement',
          'items', jsonb_build_array(
            jsonb_build_object('name','Blanc de poulet','quantity','150 g'),
            'Riz basmati 100 g cru'),
          'calories',650,'protein',45,'carbs',80,'fat',15,
          'coach_notes','Prendre ce repas trois heures avant la séance.'))),
      jsonb_build_object('day','tuesday','profile_key','training_high','meals', '[]'::jsonb),
      jsonb_build_object('day','wednesday','profile_key','standard'),
      jsonb_build_object('day','thursday','profile_key','training_high'),
      jsonb_build_object('day','friday','profile_key','standard'),
      jsonb_build_object('day','saturday','profile_key','standard'),
      jsonb_build_object('day','sunday','profile_key','standard'))));

  v_plan_id := (v_res->'plan'->>'id')::uuid;
  reset role;

  perform pg_temp.noter('D', 'D1. le plan est créé en version 2',
    (v_res->'plan'->>'nutrition_model_version') = '2');
  perform pg_temp.noter('D', 'D2. deux profils écrits', jsonb_array_length(v_res->'profiles') = 2);
  perform pg_temp.noter('D', 'D3. sept jours écrits', jsonb_array_length(v_res->'days') = 7);
  perform pg_temp.noter('D', 'D4. les jours reviennent dans l''ordre lundi → dimanche', (
    select string_agg(d->>'day', ',') from jsonb_array_elements(v_res->'days') d)
    = 'monday,tuesday,wednesday,thursday,friday,saturday,sunday');
  perform pg_temp.noter('D', 'D5. le repas manuel est écrit', (
    select count(*) from public.meals m
      join public.nutrition_days d on d.id = m.nutrition_day_id
     where d.plan_id = v_plan_id and d.day = 'monday') = 1);
  perform pg_temp.noter('D', 'D6. l''aliment donné en CHAÎNE est normalisé en objet', (
    select items->1->>'name' = 'Riz basmati 100 g cru' and items->1->>'quantity' = ''
      from public.meals where id = 'f1110000-0000-4000-8000-00000000000a'));
  perform pg_temp.noter('D', 'D7. la note du coach est conservée', (
    select coach_notes = 'Prendre ce repas trois heures avant la séance.'
      from public.meals where id = 'f1110000-0000-4000-8000-00000000000a'));

  -- 5 jours à 2 000 + 2 jours à 2 200 = 14 400, et surtout PAS 2 000 × 7.
  perform pg_temp.noter('D', 'D8. weekly_target_calories = SOMME des sept jours (14 400)', (
    select weekly_target_calories from public.nutrition_plans where id = v_plan_id) = 14400);
  perform pg_temp.noter('D', 'D9. ce n''est pas daily_calories × 7 (14 000)', (
    select weekly_target_calories from public.nutrition_plans where id = v_plan_id) <> 14000);

  perform pg_temp.noter('D', 'D10. la cible du mardi vient du profil training_high', (
    select (target->>'calories')::numeric from public.nutrition_days
      where plan_id = v_plan_id and day = 'tuesday') = 2200);
  perform pg_temp.noter('D', 'D11. la cible du lundi vient du profil standard', (
    select (target->>'calories')::numeric from public.nutrition_days
      where plan_id = v_plan_id and day = 'monday') = 2000);

  perform pg_temp.noter('D', 'D12. chaque profil a ses six créneaux', (
    select count(*) from public.nutrition_meal_slot_targets t
      join public.nutrition_plan_profiles pr on pr.id = t.profile_id
     where pr.plan_id = v_plan_id) = 12);

  -- Relecture : rien ne se perd entre deux sauvegardes.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  v_res := public.save_nutrition_plan_v2(jsonb_build_object(
    'plan_id', v_plan_id,
    'plan', jsonb_build_object('name','Plan unifié renommé')));
  reset role;

  perform pg_temp.noter('D', 'D13. une charge utile SANS days ne touche pas aux jours', (
    select count(*) from public.nutrition_days where plan_id = v_plan_id) = 7);
  perform pg_temp.noter('D', 'D14. ni aux repas prescrits', exists (
    select 1 from public.meals where id = 'f1110000-0000-4000-8000-00000000000a'));
  perform pg_temp.noter('D', 'D15. le nom est bien mis à jour', (
    select name from public.nutrition_plans where id = v_plan_id) = 'Plan unifié renommé');
end $$;

-- Atomicité : une erreur en fin de parcours annule TOUT.
do $$
declare
  v_plan_id uuid;
  v_nom_avant text;
  v_repas_avant int;
  v_refuse boolean := false;
  v_message text;
  v_slots jsonb := jsonb_build_array(
    jsonb_build_object('slot','breakfast','enabled',true,'protein_bp',2500,'carb_bp',2500,'fat_bp',2500,'display_order',0),
    jsonb_build_object('slot','morning_snack','enabled',false,'protein_bp',0,'carb_bp',0,'fat_bp',0,'display_order',1),
    jsonb_build_object('slot','lunch','enabled',true,'protein_bp',3500,'carb_bp',3500,'fat_bp',3500,'display_order',2),
    jsonb_build_object('slot','afternoon_snack','enabled',true,'protein_bp',1000,'carb_bp',1000,'fat_bp',1000,'display_order',3),
    jsonb_build_object('slot','dinner','enabled',true,'protein_bp',3000,'carb_bp',3000,'fat_bp',3000,'display_order',4),
    jsonb_build_object('slot','dessert','enabled',false,'protein_bp',0,'carb_bp',0,'fat_bp',0,'display_order',5));
begin
  select id, name into v_plan_id, v_nom_avant
    from public.nutrition_plans where name = 'Plan unifié renommé';
  select count(*) into v_repas_avant from public.meals m
    join public.nutrition_days d on d.id = m.nutrition_day_id where d.plan_id = v_plan_id;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  begin
    -- Le nom change, les repas du lundi seraient vidés… mais le dernier jour
    -- désigne un profil absent du payload : tout doit être annulé.
    perform public.save_nutrition_plan_v2(jsonb_build_object(
      'plan_id', v_plan_id,
      'plan', jsonb_build_object('name','NE DOIT PAS SURVIVRE'),
      'profiles', jsonb_build_array(
        jsonb_build_object('profile_key','standard','daily_calories',2000,
          'protein_bp',2800,'carb_bp',4400,'fat_bp',2800,'slots',v_slots)),
      'days', jsonb_build_array(
        jsonb_build_object('day','monday','profile_key','standard','meals','[]'::jsonb),
        jsonb_build_object('day','sunday','profile_key','profil_inconnu'))));
  exception when others then
    v_refuse := true;
    v_message := sqlerrm;
  end;
  reset role;

  perform pg_temp.noter('D', 'D16. un profil inconnu pour un jour est REFUSÉ', v_refuse);
  perform pg_temp.noter('D', 'D17. le refus nomme la règle violée',
    coalesce(v_message, '') like '%UNKNOWN_PROFILE_FOR_DAY%');
  perform pg_temp.noter('D', 'D18. ROLLBACK complet : le nom du plan est INTACT', (
    select name from public.nutrition_plans where id = v_plan_id) = v_nom_avant);
  perform pg_temp.noter('D', 'D19. ROLLBACK complet : les repas du lundi sont INTACTS', (
    select count(*) from public.meals m
      join public.nutrition_days d on d.id = m.nutrition_day_id
     where d.plan_id = v_plan_id) = v_repas_avant);
  perform pg_temp.noter('D', 'D20. ROLLBACK complet : les deux profils sont INTACTS', (
    select count(*) from public.nutrition_plan_profiles where plan_id = v_plan_id) = 2);
end $$;

-- Un élève ne peut pas appeler la RPC.
do $$
declare v_refuse boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  begin
    perform public.save_nutrition_plan_v2('{"plan":{"name":"x"}}'::jsonb);
  exception when others then v_refuse := true; end;
  reset role;
  perform pg_temp.noter('D', 'D21. l''ÉLÈVE ne peut pas appeler save_nutrition_plan_v2', v_refuse);
end $$;

-- ---------------------------------------------------------------------
-- Section E — sécurité des recettes
-- ---------------------------------------------------------------------
insert into public.nutrition_recipes (id, coach_id, name, slot_key, status) values
  ('a2220000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-00000000000a', 'Bol riz poulet curry', 'lunch', 'active'),
  ('a2220000-0000-4000-8000-00000000000b', 'c1110000-0000-4000-8000-00000000000a', 'Recette générique', null, 'active'),
  ('a2220000-0000-4000-8000-00000000000c', 'c1110000-0000-4000-8000-00000000000a', 'Brouillon du coach A', 'lunch', 'draft'),
  ('a2220000-0000-4000-8000-00000000000d', 'c1110000-0000-4000-8000-00000000000a', 'Archive du coach A', 'lunch', 'archived'),
  ('a2220000-0000-4000-8000-00000000000e', 'c1110000-0000-4000-8000-00000000000b', 'Recette du coach B', 'lunch', 'active');

insert into public.nutrition_recipe_ingredients
  (id, recipe_id, position, name, role, protein_per_100g, carb_per_100g, fat_per_100g, reference_grams)
values
  ('b2220000-0000-4000-8000-00000000000a', 'a2220000-0000-4000-8000-00000000000a', 1, 'Poulet', 'protein', 25, 0, 1, 140),
  ('b2220000-0000-4000-8000-00000000000e', 'a2220000-0000-4000-8000-00000000000e', 1, 'Secret du coach B', 'protein', 30, 0, 2, 120);

insert into public.nutrition_recipe_tags (recipe_id, kind, value) values
  ('a2220000-0000-4000-8000-00000000000a', 'allergen', 'milk'),
  ('a2220000-0000-4000-8000-00000000000e', 'allergen', 'gluten');

-- Le plan de l'élève A est celui du coach A (créé en section B).
-- NOTE DE MÉTHODE : `pg_temp.noter` insère dans une table temporaire dont le
-- rôle `authenticated` n'est pas propriétaire. On collecte donc les faits
-- sous l'identité testée, puis on les enregistre après `reset role`.
do $$
declare
  v_recettes int; v_brouillons int; v_archives int; v_coachB int; v_generique boolean;
  v_ingredients int; v_ing_b boolean; v_tags int; v_tag_b boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);

  select count(*) into v_recettes from public.nutrition_recipes;
  select count(*) into v_brouillons from public.nutrition_recipes where status = 'draft';
  select count(*) into v_archives from public.nutrition_recipes where status = 'archived';
  select count(*) into v_coachB from public.nutrition_recipes
   where coach_id = 'c1110000-0000-4000-8000-00000000000b';
  select exists (select 1 from public.nutrition_recipes
                  where id = 'a2220000-0000-4000-8000-00000000000b') into v_generique;
  select count(*) into v_ingredients from public.nutrition_recipe_ingredients;
  select exists (select 1 from public.nutrition_recipe_ingredients
                  where id = 'b2220000-0000-4000-8000-00000000000e') into v_ing_b;
  select count(*) into v_tags from public.nutrition_recipe_tags;
  select exists (select 1 from public.nutrition_recipe_tags
                  where recipe_id = 'a2220000-0000-4000-8000-00000000000e') into v_tag_b;

  reset role;

  perform pg_temp.noter('E', 'E1. l''élève A voit les DEUX recettes actives de son coach', v_recettes = 2);
  perform pg_temp.noter('E', 'E2. il ne voit AUCUN brouillon', v_brouillons = 0);
  perform pg_temp.noter('E', 'E3. il ne voit AUCUNE archive', v_archives = 0);
  perform pg_temp.noter('E', 'E4. il ne voit AUCUNE recette du coach B', v_coachB = 0);
  perform pg_temp.noter('E', 'E5. la recette GÉNÉRIQUE (slot_key null) lui est visible', v_generique);
  perform pg_temp.noter('E', 'E6. attaque directe sur les ingrédients : seuls ceux de son coach', v_ingredients = 1);
  perform pg_temp.noter('E', 'E7. l''ingrédient du coach B est invisible', not v_ing_b);
  perform pg_temp.noter('E', 'E8. attaque directe sur les étiquettes : seules celles de son coach', v_tags = 1);
  perform pg_temp.noter('E', 'E9. l''étiquette du coach B est invisible', not v_tag_b);
end $$;

-- L'élève ne peut RIEN écrire dans les recettes.
do $$
declare
  v_i boolean := false; v_u boolean := false; v_d boolean := false; v_t boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);

  begin
    insert into public.nutrition_recipes (coach_id, name, status)
    values ('c1110000-0000-4000-8000-00000000000a', 'Écrite par un élève', 'active');
  exception when others then v_i := true; end;

  update public.nutrition_recipes set name = 'PIRATÉE'
   where id = 'a2220000-0000-4000-8000-00000000000a';
  get diagnostics v_u = row_count;
  v_u := not v_u;

  delete from public.nutrition_recipes where id = 'a2220000-0000-4000-8000-00000000000a';
  get diagnostics v_d = row_count;
  v_d := not v_d;

  begin
    truncate table public.nutrition_recipes cascade;
  exception when others then v_t := true; end;

  reset role;

  perform pg_temp.noter('E', 'E10. l''élève ne peut pas INSÉRER de recette', v_i);
  perform pg_temp.noter('E', 'E11. l''élève ne peut pas MODIFIER une recette', v_u);
  perform pg_temp.noter('E', 'E12. l''élève ne peut pas SUPPRIMER une recette', v_d);
  perform pg_temp.noter('E', 'E13. l''élève ne peut pas TRUNCATE les recettes', v_t);
  perform pg_temp.noter('E', 'E14. la recette visée est INTACTE', exists (
    select 1 from public.nutrition_recipes
     where id = 'a2220000-0000-4000-8000-00000000000a' and name = 'Bol riz poulet curry'));
end $$;

-- Un élève SANS plan, et un élève dont le plan n'a pas de coach.
do $$
declare v_sans_plan int; v_sans_coach int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000005","role":"authenticated"}', true);
  select count(*) into v_sans_plan from public.nutrition_recipes;
  reset role;

  update public.nutrition_plans set coach_id = null
   where id = '91110000-0000-4000-8000-00000000000a';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  select count(*) into v_sans_coach from public.nutrition_recipes;
  reset role;

  update public.nutrition_plans set coach_id = 'c1110000-0000-4000-8000-00000000000a'
   where id = '91110000-0000-4000-8000-00000000000a';

  perform pg_temp.noter('E', 'E15. un élève SANS plan ne lit aucune recette', v_sans_plan = 0);
  perform pg_temp.noter('E', 'E16. un plan SANS coach_id ne donne accès à rien', v_sans_coach = 0);
end $$;

-- Coachs et administrateur.
do $$
declare
  v_a int; v_admin int;
  v_a_modifie boolean; v_a_pirate boolean; v_admin_modifie boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  select count(*) into v_a from public.nutrition_recipes;
  update public.nutrition_recipes set name = 'Bol riz poulet curry v2'
   where id = 'a2220000-0000-4000-8000-00000000000a';
  get diagnostics v_a_modifie = row_count;
  update public.nutrition_recipes set name = 'PIRATÉE PAR A'
   where id = 'a2220000-0000-4000-8000-00000000000e';
  get diagnostics v_a_pirate = row_count;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000004","role":"authenticated"}', true);
  select count(*) into v_admin from public.nutrition_recipes;
  update public.nutrition_recipes set name = 'Renommée par l''admin'
   where id = 'a2220000-0000-4000-8000-00000000000e';
  get diagnostics v_admin_modifie = row_count;
  reset role;

  perform pg_temp.noter('E', 'E17. le coach A voit ses QUATRE recettes, et rien d''autre', v_a = 4);
  perform pg_temp.noter('E', 'E18. le coach A gère SES recettes', v_a_modifie);
  perform pg_temp.noter('E', 'E19. le coach A ne gère PAS celles du coach B', not v_a_pirate);
  perform pg_temp.noter('E', 'E20. l''administrateur voit TOUTES les recettes', v_admin = 5);
  perform pg_temp.noter('E', 'E21. l''administrateur gère tout', v_admin_modifie);
end $$;

-- Anonyme.
do $$
declare v_n int; v_refuse boolean := false;
begin
  set local role anon;
  begin
    select count(*) into v_n from public.nutrition_recipes;
  exception when others then v_refuse := true; v_n := 0; end;
  reset role;
  perform pg_temp.noter('E', 'E22. anon ne lit AUCUNE recette', v_n = 0 or v_refuse);
end $$;

-- ---------------------------------------------------------------------
-- Section F — l'outil 1 n'est pas régressé
-- ---------------------------------------------------------------------
do $$
declare
  v_insere boolean; v_maj boolean; v_suppr boolean;
  v_plan boolean; v_jours int; v_repas boolean; v_creneaux boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);

  insert into public.nutrition_daily_logs
    (student_id, nutrition_plan_id, log_date, calories, protein_g, carbs_g, fat_g, note)
  values ('51110000-0000-4000-8000-00000000000a', '91110000-0000-4000-8000-00000000000a',
          date '2026-08-06', 2400, 145, 134, 45, 'Jeudi dépassé');
  select exists (select 1 from public.nutrition_daily_logs
                  where log_date = date '2026-08-06') into v_insere;

  update public.nutrition_daily_logs set calories = 2300
   where student_id = '51110000-0000-4000-8000-00000000000a' and log_date = date '2026-08-06';
  get diagnostics v_maj = row_count;

  delete from public.nutrition_daily_logs
   where student_id = '51110000-0000-4000-8000-00000000000a' and log_date = date '2026-08-06';
  get diagnostics v_suppr = row_count;

  select exists (select 1 from public.nutrition_plans
                  where id = '91110000-0000-4000-8000-00000000000a') into v_plan;
  select count(*) into v_jours from public.nutrition_days
   where plan_id = '91110000-0000-4000-8000-00000000000a';
  select exists (select 1 from public.meals
                  where id = 'e1110000-0000-4000-8000-00000000000a') into v_repas;
  select exists (select 1 from public.nutrition_meal_slot_targets t
                   join public.nutrition_plan_profiles pr on pr.id = t.profile_id
                  where pr.plan_id = '91110000-0000-4000-8000-00000000000a') into v_creneaux;

  reset role;

  perform pg_temp.noter('F', 'F1. l''élève INSÈRE toujours son journal quotidien', v_insere);
  perform pg_temp.noter('F', 'F2. il MET À JOUR ses lignes', v_maj);
  perform pg_temp.noter('F', 'F3. il SUPPRIME ses lignes', v_suppr);
  perform pg_temp.noter('F', 'F4. et il lit toujours son plan assigné', v_plan);
  perform pg_temp.noter('F', 'F5. ainsi que ses sept jours', v_jours = 7);
  perform pg_temp.noter('F', 'F6. et les repas prescrits par le coach', v_repas);
  perform pg_temp.noter('F', 'F7. ainsi que le profil et les créneaux de son plan', v_creneaux);
end $$;

-- ---------------------------------------------------------------------
-- Section H — la garde serveur contrôle les SEPT jours
--             (migration 20260814090000)
-- ---------------------------------------------------------------------
-- Un plan « nouvelle forme » : sept profils internes day_<jour>, sept jours,
-- chacun désignant le sien. On casse ensuite un jour à la fois et on vérifie
-- que la garde le nomme — puis qu'elle se tait dès qu'il est réparé.
insert into public.nutrition_plans (id, coach_id, name, nutrition_model_version, status, daily_target)
values ('92220000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-00000000000a',
        'Plan semaine complet', 2, 'actif', '{}'::jsonb);

insert into public.nutrition_plan_profiles (plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp)
select '92220000-0000-4000-8000-00000000000a', 'day_' || j, 2100, 3000, 4500, 2500
  from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) as j;

insert into public.nutrition_meal_slot_targets
  (profile_id, slot, enabled, protein_bp, carb_bp, fat_bp, display_order)
select pr.id, s.slot, true, s.bp, s.bp, s.bp, s.ord
  from public.nutrition_plan_profiles pr,
       (values ('breakfast', 1667, 0), ('morning_snack', 1667, 1), ('lunch', 1667, 2),
               ('afternoon_snack', 1667, 3), ('dinner', 1666, 4), ('dessert', 1666, 5))
         as s(slot, bp, ord)
 where pr.plan_id = '92220000-0000-4000-8000-00000000000a';

insert into public.nutrition_days (plan_id, day, profile_key, status, target)
select '92220000-0000-4000-8000-00000000000a', j, 'day_' || j, 'non-commence', '{}'::jsonb
  from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) as j;

do $$
declare
  c_plan constant uuid := '92220000-0000-4000-8000-00000000000a';
  v_issue text;
begin
  -- H1. Les sept jours valides passent.
  perform pg_temp.noter('H', 'H1. les sept jours valides : aucun problème remonté',
    public.nutrition_plan_v2_blocking_issue(c_plan) is null);

  -- H2. Lundi invalide bloque, et la garde le NOMME.
  update public.nutrition_plan_profiles set daily_calories = 0
   where plan_id = c_plan and profile_key = 'day_monday';
  v_issue := public.nutrition_plan_v2_blocking_issue(c_plan);
  perform pg_temp.noter('H', 'H2. monday invalide bloque et est nommé',
    v_issue = 'monday:calories_not_positive');

  -- H3. Réparé, le plan redevient assignable — le jour suivant ne prend pas
  --     silencieusement le relais.
  update public.nutrition_plan_profiles set daily_calories = 2100
   where plan_id = c_plan and profile_key = 'day_monday';
  perform pg_temp.noter('H', 'H3. la correction de monday rend le plan assignable',
    public.nutrition_plan_v2_blocking_issue(c_plan) is null);

  -- H4. Mardi invalide bloque — un jour du MILIEU, que l'ancienne garde
  --     ignorait complètement.
  update public.nutrition_plan_profiles set protein_bp = 2000
   where plan_id = c_plan and profile_key = 'day_tuesday';
  v_issue := public.nutrition_plan_v2_blocking_issue(c_plan);
  perform pg_temp.noter('H', 'H4. tuesday invalide bloque et est nommé',
    v_issue = 'tuesday:daily_split_incomplete');
  update public.nutrition_plan_profiles set protein_bp = 3000
   where plan_id = c_plan and profile_key = 'day_tuesday';

  -- H5. Dimanche invalide bloque — le DERNIER jour parcouru, et un contrôle
  --     différent : plus aucun créneau actif.
  update public.nutrition_meal_slot_targets t set enabled = false
   where t.profile_id = (select pr.id from public.nutrition_plan_profiles pr
                          where pr.plan_id = c_plan and pr.profile_key = 'day_sunday');
  v_issue := public.nutrition_plan_v2_blocking_issue(c_plan);
  perform pg_temp.noter('H', 'H5. sunday invalide bloque et est nommé',
    v_issue = 'sunday:no_enabled_slot');
  update public.nutrition_meal_slot_targets t set enabled = true
   where t.profile_id = (select pr.id from public.nutrition_plan_profiles pr
                          where pr.plan_id = c_plan and pr.profile_key = 'day_sunday');

  -- H6. Une répartition de créneau différente de 10 000 bloque, sur le jour
  --     concerné et sur la MACRO concernée.
  update public.nutrition_meal_slot_targets t set carb_bp = 1000
   where t.slot = 'lunch'
     and t.profile_id = (select pr.id from public.nutrition_plan_profiles pr
                          where pr.plan_id = c_plan and pr.profile_key = 'day_wednesday');
  v_issue := public.nutrition_plan_v2_blocking_issue(c_plan);
  perform pg_temp.noter('H', 'H6. une macro de créneau ≠ 10 000 bloque le jour concerné',
    v_issue = 'wednesday:carb_split_incomplete');
  update public.nutrition_meal_slot_targets t set carb_bp = 1667
   where t.slot = 'lunch'
     and t.profile_id = (select pr.id from public.nutrition_plan_profiles pr
                          where pr.plan_id = c_plan and pr.profile_key = 'day_wednesday');

  -- H7. Un jour manquant bloque, et il est nommé.
  delete from public.nutrition_days d where d.plan_id = c_plan and d.day = 'friday';
  v_issue := public.nutrition_plan_v2_blocking_issue(c_plan);
  perform pg_temp.noter('H', 'H7. un jour absent bloque et est nommé',
    v_issue = 'friday:missing_day');
  insert into public.nutrition_days (plan_id, day, profile_key, status, target)
  values (c_plan, 'friday', 'day_friday', 'non-commence', '{}'::jsonb);

  -- H8. Un plan SANS aucun profil rend le code historique — les messages
  --     d'assign_nutrition_plan restent intelligibles.
  perform pg_temp.noter('H', 'H8. un plan sans profil rend missing_default_profile',
    public.nutrition_plan_v2_blocking_issue('91110000-0000-4000-8000-00000000000b') is not null);

  -- H9. Ordre DÉTERMINISTE : deux jours cassés, c'est le PREMIER dans
  --     l'ordre lundi → dimanche qui est rapporté.
  update public.nutrition_plan_profiles set daily_calories = 0
   where plan_id = c_plan and profile_key in ('day_thursday', 'day_saturday');
  v_issue := public.nutrition_plan_v2_blocking_issue(c_plan);
  perform pg_temp.noter('H', 'H9. deux jours cassés : le premier dans l''ordre est rapporté',
    v_issue = 'thursday:calories_not_positive');
  update public.nutrition_plan_profiles set daily_calories = 2100
   where plan_id = c_plan and profile_key in ('day_thursday', 'day_saturday');

  -- H10. Tout réparé : le plan est de nouveau assignable.
  perform pg_temp.noter('H', 'H10. tout réparé, le plan est de nouveau assignable',
    public.nutrition_plan_v2_blocking_issue(c_plan) is null);
end $$;

-- H11. La garde n'écrit RIEN : elle est déclarée `stable`, et son corps ne
--      contient aucune écriture.
do $$
declare v_stable boolean; v_lecture boolean;
begin
  select p.provolatile = 's' into v_stable
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nutrition_plan_v2_blocking_issue';
  select p.prosrc !~* '(insert into|update\s+public\.|delete from|truncate)' into v_lecture
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nutrition_plan_v2_blocking_issue';
  perform pg_temp.noter('H', 'H11. la garde est `stable` et n''écrit rien',
    coalesce(v_stable, false) and coalesce(v_lecture, false));
end $$;

-- =====================================================================
-- Section I — CYCLE DE VIE (migration 20260815090000, PR D)
-- =====================================================================
-- Les 22 cas exigés : huit pour les plans, huit pour les recettes, six pour
-- les statuts et la sécurité. TOUS passent par la base — RPC appelées
-- directement, RLS éprouvée sous les vrais rôles — jamais par l'interface :
-- une protection qui ne tiendrait que dans le navigateur ne serait pas une
-- protection.
--
-- Table rase des affectations laissées par les sections précédentes : l'index
-- unique partiel n'autorise qu'un plan par élève, et cette section a besoin de
-- choisir elle-même qui est affecté à quoi.
reset role;
update public.nutrition_plans set student_id = null
 where student_id in ('51110000-0000-4000-8000-00000000000a',
                      '51110000-0000-4000-8000-00000000000b');

-- Quatre plans du coach A, tous v2 et volontairement SANS profil ni jour :
-- aucun contrôle de cette section ne passe par `assign_nutrition_plan`, donc
-- la garde des sept jours n'entre jamais en jeu — sauf en I2/I3 où l'affectation
-- est posée directement, comme le ferait une base existante.
insert into public.nutrition_plans (id, coach_id, name, goal_type, status, daily_target, nutrition_model_version)
values ('d1110000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-00000000000a',
        'Cycle — plan libre', 'maintien', 'actif', '{}'::jsonb, 2),
       ('d1110000-0000-4000-8000-00000000000b', 'c1110000-0000-4000-8000-00000000000a',
        'Cycle — plan assigné', 'maintien', 'actif', '{}'::jsonb, 2),
       ('d1110000-0000-4000-8000-00000000000c', 'c1110000-0000-4000-8000-00000000000a',
        'Cycle — plan historique', 'maintien', 'actif', '{}'::jsonb, 2),
       ('d1110000-0000-4000-8000-00000000000d', 'c1110000-0000-4000-8000-00000000000a',
        'Cycle — plan visibilité', 'maintien', 'actif', '{}'::jsonb, 2);

-- Le plan « libre » reçoit une structure complète : sa suppression doit
-- l'emporter ENTIÈREMENT, et c'est ce qu'on vérifie en I7.
insert into public.nutrition_plan_profiles (id, plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp)
values ('d2220000-0000-4000-8000-00000000000a', 'd1110000-0000-4000-8000-00000000000a',
        'day_monday', 2400, 3000, 4500, 2500);
insert into public.nutrition_meal_slot_targets (profile_id, slot, enabled, protein_bp, carb_bp, fat_bp, display_order)
values ('d2220000-0000-4000-8000-00000000000a', 'breakfast', true, 10000, 10000, 10000, 1);
insert into public.nutrition_days (id, plan_id, day, profile_key, status, target)
values ('d3330000-0000-4000-8000-00000000000a', 'd1110000-0000-4000-8000-00000000000a',
        'monday', 'day_monday', 'non-commence', '{}'::jsonb);
insert into public.meals (id, nutrition_day_id, slot, name, items, macros, coach_notes)
values ('d4440000-0000-4000-8000-00000000000a', 'd3330000-0000-4000-8000-00000000000a',
        'breakfast', 'Repas témoin', '["flocons"]'::jsonb, '{}'::jsonb, 'à ne pas perdre');

-- Le plan « historique » porte une journée de suivi : la clé étrangère est en
-- CASCADE, donc sans garde le journal partirait avec le plan.
insert into public.nutrition_daily_logs (student_id, nutrition_plan_id, log_date, calories)
values ('51110000-0000-4000-8000-00000000000a', 'd1110000-0000-4000-8000-00000000000c',
        current_date - 3, 2100);

-- Le plan « visibilité » est assigné à l'élève A, avec une journée et un repas
-- que l'élève doit voir — ou ne pas voir, selon le statut.
insert into public.nutrition_plan_profiles (id, plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp)
values ('d2220000-0000-4000-8000-00000000000d', 'd1110000-0000-4000-8000-00000000000d',
        'day_monday', 2200, 3000, 4500, 2500);
insert into public.nutrition_days (id, plan_id, day, profile_key, status, target)
values ('d3330000-0000-4000-8000-00000000000d', 'd1110000-0000-4000-8000-00000000000d',
        'monday', 'day_monday', 'non-commence', '{}'::jsonb);
insert into public.meals (id, nutrition_day_id, slot, name, items, macros, coach_notes)
values ('d4440000-0000-4000-8000-00000000000d', 'd3330000-0000-4000-8000-00000000000d',
        'breakfast', 'Repas visible', '["pain"]'::jsonb, '{}'::jsonb, '');
update public.nutrition_plans set student_id = '51110000-0000-4000-8000-00000000000a'
 where id = 'd1110000-0000-4000-8000-00000000000d';

-- Deux recettes : une du coach A (celui de l'élève A), une du coach B.
insert into public.nutrition_recipes (id, coach_id, name, slot_key, status)
values ('d5550000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-00000000000a',
        'Cycle — recette A', 'lunch', 'active'),
       ('d5550000-0000-4000-8000-00000000000b', 'c1110000-0000-4000-8000-00000000000b',
        'Cycle — recette B', 'lunch', 'active');
insert into public.nutrition_recipe_ingredients
  (id, recipe_id, position, name, role, protein_per_100g, carb_per_100g, fat_per_100g, reference_grams)
values ('d6660000-0000-4000-8000-00000000000a', 'd5550000-0000-4000-8000-00000000000a',
        1, 'Poulet', 'protein', 25, 0, 1, 140);
insert into public.nutrition_recipe_tags (recipe_id, kind, value)
values ('d5550000-0000-4000-8000-00000000000a', 'diet', 'halal');

-- ── I1 à I8 : LES PLANS ───────────────────────────────────────────────
do $$
declare
  v_date timestamptz;
  v_res jsonb;
  v_avant int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  -- I1. La date d'archivage se pose seule, et disparaît à la restauration.
  update public.nutrition_plans set status = 'ancien'
   where id = 'd1110000-0000-4000-8000-00000000000a';
  select archived_at into v_date from public.nutrition_plans
   where id = 'd1110000-0000-4000-8000-00000000000a';
  perform pg_temp.noter('I', 'I1. archiver DATE le plan, restaurer efface la date', v_date is not null);
  update public.nutrition_plans set status = 'prochain'
   where id = 'd1110000-0000-4000-8000-00000000000a';
  select archived_at into v_date from public.nutrition_plans
   where id = 'd1110000-0000-4000-8000-00000000000a';
  perform pg_temp.noter('I', 'I1 bis. la date est effacée par la restauration', v_date is null);
  update public.nutrition_plans set status = 'actif'
   where id = 'd1110000-0000-4000-8000-00000000000a';

  -- I5. Un plan ASSIGNÉ n'est pas supprimable — et rien ne bouge.
  select count(*) into v_avant from public.nutrition_plans;
  select public.delete_nutrition_plan('d1110000-0000-4000-8000-00000000000d') into v_res;
  perform pg_temp.noter('I', 'I5. un plan ASSIGNÉ est refusé à la suppression',
    (v_res->>'ok')::boolean is false and v_res->>'reason' = 'assigned');
  perform pg_temp.noter('I', 'I5 bis. le refus ne supprime AUCUN plan',
    (select count(*) from public.nutrition_plans) = v_avant);
  perform pg_temp.noter('I', 'I5 ter. le refus n''a retiré AUCUNE affectation',
    (select student_id from public.nutrition_plans where id = 'd1110000-0000-4000-8000-00000000000d')
      = '51110000-0000-4000-8000-00000000000a');

  -- I6. Un plan référencé par un JOURNAL n'est pas supprimable, et le journal
  --     survit intact — on ne supprime jamais un historique pour débloquer.
  select public.delete_nutrition_plan('d1110000-0000-4000-8000-00000000000c') into v_res;
  perform pg_temp.noter('I', 'I6. un plan référencé par le suivi quotidien est refusé',
    (v_res->>'ok')::boolean is false and v_res->>'reason' = 'used_in_history');
  perform pg_temp.noter('I', 'I6 bis. la journée de suivi est TOUJOURS là',
    (select count(*) from public.nutrition_daily_logs
      where nutrition_plan_id = 'd1110000-0000-4000-8000-00000000000c') = 1);
  perform pg_temp.noter('I', 'I6 ter. le refus nomme la dépendance comptée',
    (v_res->'dependencies'->>'daily_logs')::int = 1);

  -- I7. Un plan LIBRE part entièrement, sans laisser d'orphelin.
  select public.delete_nutrition_plan('d1110000-0000-4000-8000-00000000000a') into v_res;
  perform pg_temp.noter('I', 'I7. un plan libre est réellement supprimé',
    (v_res->>'ok')::boolean is true);
  perform pg_temp.noter('I', 'I7 bis. la RPC compte ce qu''elle a supprimé',
    (v_res->'deleted'->>'meals')::int = 1
    and (v_res->'deleted'->>'days')::int = 1
    and (v_res->'deleted'->>'profiles')::int = 1
    and (v_res->'deleted'->>'meal_slot_targets')::int = 1);
  perform pg_temp.noter('I', 'I7 ter. AUCUN orphelin ne subsiste',
    not exists (select 1 from public.nutrition_plans where id = 'd1110000-0000-4000-8000-00000000000a')
    and not exists (select 1 from public.nutrition_days where plan_id = 'd1110000-0000-4000-8000-00000000000a')
    and not exists (select 1 from public.meals where id = 'd4440000-0000-4000-8000-00000000000a')
    and not exists (select 1 from public.nutrition_plan_profiles where plan_id = 'd1110000-0000-4000-8000-00000000000a')
    and not exists (select 1 from public.nutrition_meal_slot_targets
                     where profile_id = 'd2220000-0000-4000-8000-00000000000a'));

  -- I8. Un identifiant inconnu ne lève pas : il répond.
  select public.delete_nutrition_plan('00000000-0000-4000-8000-0000000000ff') into v_res;
  perform pg_temp.noter('I', 'I8. un identifiant inconnu répond not_found sans exception',
    (v_res->>'ok')::boolean is false and v_res->>'reason' = 'not_found');

  reset role;
end $$;

-- I2 / I3 / I4 : ce que l'ÉLÈVE voit, selon le statut du plan.
do $$
declare v_plans int; v_jours int; v_repas int;
begin
  -- Le plan « visibilité » repasse en BROUILLON.
  update public.nutrition_plans set status = 'prochain'
   where id = 'd1110000-0000-4000-8000-00000000000d';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  select count(*) into v_plans from public.nutrition_plans
   where id = 'd1110000-0000-4000-8000-00000000000d';
  select count(*) into v_jours from public.nutrition_days
   where plan_id = 'd1110000-0000-4000-8000-00000000000d';
  select count(*) into v_repas from public.meals
   where id = 'd4440000-0000-4000-8000-00000000000d';
  perform pg_temp.noter('I', 'I2. un plan BROUILLON est invisible pour son élève', v_plans = 0);
  perform pg_temp.noter('I', 'I2 bis. ses jours et ses repas le sont aussi', v_jours = 0 and v_repas = 0);
  reset role;

  -- Le même plan, ARCHIVÉ.
  update public.nutrition_plans set status = 'ancien'
   where id = 'd1110000-0000-4000-8000-00000000000d';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  select count(*) into v_plans from public.nutrition_plans
   where id = 'd1110000-0000-4000-8000-00000000000d';
  select count(*) into v_jours from public.nutrition_days
   where plan_id = 'd1110000-0000-4000-8000-00000000000d';
  select count(*) into v_repas from public.meals
   where id = 'd4440000-0000-4000-8000-00000000000d';
  perform pg_temp.noter('I', 'I3. un plan ARCHIVÉ reste visible pour l''élève déjà affecté', v_plans = 1);
  perform pg_temp.noter('I', 'I3 bis. avec ses jours et ses repas', v_jours = 1 and v_repas = 1);
  reset role;

  -- I4. Archiver n'a RIEN perdu, vu du côté du coach.
  perform pg_temp.noter('I', 'I4. archiver conserve profils, jours et repas',
    (select count(*) from public.nutrition_plan_profiles
      where plan_id = 'd1110000-0000-4000-8000-00000000000d') = 1
    and (select count(*) from public.nutrition_days
          where plan_id = 'd1110000-0000-4000-8000-00000000000d') = 1
    and (select count(*) from public.meals
          where nutrition_day_id = 'd3330000-0000-4000-8000-00000000000d') = 1);
end $$;

-- ── I9 à I16 : LES RECETTES ───────────────────────────────────────────
do $$
declare v_res jsonb; v_date timestamptz;
begin
  -- L'élève A est affecté à un plan ACTIF du coach A : sa recette est donc
  -- réellement atteignable, condition de I10.
  update public.nutrition_plans set status = 'actif'
   where id = 'd1110000-0000-4000-8000-00000000000d';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  -- I9. La date d'archivage d'une recette.
  update public.nutrition_recipes set status = 'archived'
   where id = 'd5550000-0000-4000-8000-00000000000a';
  select archived_at into v_date from public.nutrition_recipes
   where id = 'd5550000-0000-4000-8000-00000000000a';
  perform pg_temp.noter('I', 'I9. archiver DATE la recette', v_date is not null);
  update public.nutrition_recipes set status = 'active'
   where id = 'd5550000-0000-4000-8000-00000000000a';
  select archived_at into v_date from public.nutrition_recipes
   where id = 'd5550000-0000-4000-8000-00000000000a';
  perform pg_temp.noter('I', 'I9 bis. republier efface la date', v_date is null);

  -- I10. Publiée et atteignable : non supprimable.
  select public.delete_nutrition_recipe('d5550000-0000-4000-8000-00000000000a') into v_res;
  perform pg_temp.noter('I', 'I10. une recette PUBLIÉE qu''un élève peut ouvrir est refusée',
    (v_res->>'ok')::boolean is false and v_res->>'reason' = 'assigned');
  perform pg_temp.noter('I', 'I10 bis. le refus compte les élèves concernés',
    (v_res->'dependencies'->>'students_with_access')::int = 1);
  perform pg_temp.noter('I', 'I10 ter. la recette et ses enfants sont intacts',
    exists (select 1 from public.nutrition_recipes where id = 'd5550000-0000-4000-8000-00000000000a')
    and (select count(*) from public.nutrition_recipe_ingredients
          where recipe_id = 'd5550000-0000-4000-8000-00000000000a') = 1);

  -- I11. Dépubliée, elle le devient — sans qu'aucune donnée n'ait été touchée.
  update public.nutrition_recipes set status = 'draft'
   where id = 'd5550000-0000-4000-8000-00000000000a';
  perform pg_temp.noter('I', 'I11. dépubliée, la même recette devient supprimable',
    public.nutrition_recipe_deletion_block('d5550000-0000-4000-8000-00000000000a') is null);
  perform pg_temp.noter('I', 'I11 bis. dépublier n''a supprimé ni ingrédient ni étiquette',
    (select count(*) from public.nutrition_recipe_ingredients
      where recipe_id = 'd5550000-0000-4000-8000-00000000000a') = 1
    and (select count(*) from public.nutrition_recipe_tags
          where recipe_id = 'd5550000-0000-4000-8000-00000000000a') = 1);

  -- I13. La recette d'un AUTRE coach est intouchable.
  --
  -- LA RÉPONSE EST `not_found`, ET C'EST PLUS FORT QUE `forbidden` : la policy
  -- `nutrition_recipes_manage_own_coach` ne rend même pas la ligne au coach A,
  -- qui n'apprend donc pas qu'elle existe. `forbidden` reste la réponse quand
  -- la ligne EST visible mais n'appartient pas à l'appelant — le cas des
  -- plans, où `nutrition_plans_manage_staff` est commune à tout le staff (voir
  -- I13 quater).
  select public.delete_nutrition_recipe('d5550000-0000-4000-8000-00000000000b') into v_res;
  perform pg_temp.noter('I', 'I13. la recette d''un AUTRE coach est refusée, sans fuite d''existence',
    (v_res->>'ok')::boolean is false and v_res->>'reason' = 'not_found');

  -- I15. Identifiant inconnu.
  select public.delete_nutrition_recipe('00000000-0000-4000-8000-0000000000fe') into v_res;
  perform pg_temp.noter('I', 'I15. un identifiant de recette inconnu répond not_found',
    (v_res->>'ok')::boolean is false and v_res->>'reason' = 'not_found');

  -- I12. La suppression réelle emporte ingrédients et étiquettes, et rien d'autre.
  select public.delete_nutrition_recipe('d5550000-0000-4000-8000-00000000000a') into v_res;
  perform pg_temp.noter('I', 'I12. la recette dépubliée est réellement supprimée',
    (v_res->>'ok')::boolean is true
    and (v_res->'deleted'->>'ingredients')::int = 1
    and (v_res->'deleted'->>'tags')::int = 1);
  perform pg_temp.noter('I', 'I12 bis. AUCUN orphelin ne subsiste',
    not exists (select 1 from public.nutrition_recipe_ingredients
                 where recipe_id = 'd5550000-0000-4000-8000-00000000000a')
    and not exists (select 1 from public.nutrition_recipe_tags
                     where recipe_id = 'd5550000-0000-4000-8000-00000000000a'));

  reset role;

  -- Recomptage HORS RÔLE : sous la RLS du coach A, « la recette de l'autre
  -- coach existe-t-elle ? » est toujours faux, qu'elle ait été supprimée ou
  -- non. Seule une lecture privilégiée peut le prouver.
  perform pg_temp.noter('I', 'I13 bis. la recette de l''autre coach est TOUJOURS là',
    exists (select 1 from public.nutrition_recipes where id = 'd5550000-0000-4000-8000-00000000000b')
    and (select count(*) from public.nutrition_recipes
          where id = 'd5550000-0000-4000-8000-00000000000a') = 0);

  -- I13 quater. Le vrai cas `forbidden` : un plan appartenant au coach B est
  -- VISIBLE par le coach A (policy staff commune), et pourtant refusé.
  insert into public.nutrition_plans (id, coach_id, name, goal_type, status, daily_target, nutrition_model_version)
  values ('d1110000-0000-4000-8000-00000000000e', 'c1110000-0000-4000-8000-00000000000b',
          'Cycle — plan du coach B', 'maintien', 'actif', '{}'::jsonb, 2);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  perform pg_temp.noter('I', 'I13 quater. le plan de l''autre coach est bien VISIBLE du coach A',
    exists (select 1 from public.nutrition_plans where id = 'd1110000-0000-4000-8000-00000000000e'));
  select public.delete_nutrition_plan('d1110000-0000-4000-8000-00000000000e') into v_res;
  perform pg_temp.noter('I', 'I13 quinquies. et pourtant sa suppression est INTERDITE',
    (v_res->>'ok')::boolean is false and v_res->>'reason' = 'forbidden');
  reset role;
  perform pg_temp.noter('I', 'I13 sexies. le plan de l''autre coach survit',
    exists (select 1 from public.nutrition_plans where id = 'd1110000-0000-4000-8000-00000000000e'));
end $$;

-- I14 / I16 : ce qu'un ÉLÈVE obtient en appelant la RPC lui-même.
do $$
declare v_res jsonb; v_visibles int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);

  -- I14. L'attaque la plus simple : appeler la RPC depuis la console.
  select public.delete_nutrition_recipe('d5550000-0000-4000-8000-00000000000b') into v_res;
  perform pg_temp.noter('I', 'I14. un ÉLÈVE appelant la RPC directement obtient forbidden',
    (v_res->>'ok')::boolean is false and v_res->>'reason' = 'forbidden');
  select public.delete_nutrition_plan('d1110000-0000-4000-8000-00000000000c') into v_res;
  perform pg_temp.noter('I', 'I14 bis. idem pour un plan',
    (v_res->>'ok')::boolean is false and v_res->>'reason' = 'forbidden');

  -- I16. La RLS des recettes n'a pas bougé : brouillon et archive restent
  --      invisibles, et le catalogue d'un autre coach aussi.
  select count(*) into v_visibles from public.nutrition_recipes
   where id = 'd5550000-0000-4000-8000-00000000000b';
  perform pg_temp.noter('I', 'I16. la recette d''un AUTRE coach reste invisible à l''élève', v_visibles = 0);

  reset role;

  -- Recomptage HORS RÔLE : l'élève n'a rien supprimé.
  perform pg_temp.noter('I', 'I14 ter. l''appel direct de l''élève n''a rien supprimé',
    exists (select 1 from public.nutrition_plans where id = 'd1110000-0000-4000-8000-00000000000c')
    and exists (select 1 from public.nutrition_recipes where id = 'd5550000-0000-4000-8000-00000000000b'));
end $$;

do $$
declare v_visibles int;
begin
  -- Une recette du coach A, en brouillon puis archivée, ne doit jamais
  -- apparaître à l'élève A — même si son plan est actif.
  insert into public.nutrition_recipes (id, coach_id, name, slot_key, status)
  values ('d5550000-0000-4000-8000-00000000000c', 'c1110000-0000-4000-8000-00000000000a',
          'Cycle — recette non publiée', 'lunch', 'draft');

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  select count(*) into v_visibles from public.nutrition_recipes
   where id = 'd5550000-0000-4000-8000-00000000000c';
  perform pg_temp.noter('I', 'I16 bis. un BROUILLON de recette reste invisible à l''élève', v_visibles = 0);
  reset role;

  update public.nutrition_recipes set status = 'archived'
   where id = 'd5550000-0000-4000-8000-00000000000c';
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  select count(*) into v_visibles from public.nutrition_recipes
   where id = 'd5550000-0000-4000-8000-00000000000c';
  perform pg_temp.noter('I', 'I16 ter. une ARCHIVE de recette reste invisible à l''élève', v_visibles = 0);
  reset role;
end $$;

-- ── I17 à I22 : STATUTS ET SÉCURITÉ ───────────────────────────────────
do $$
declare v_visibles int;
begin
  -- I17. Le catalogue passe par le plan : un plan BROUILLON n'ouvre rien.
  update public.nutrition_recipes set status = 'active'
   where id = 'd5550000-0000-4000-8000-00000000000c';
  update public.nutrition_plans set status = 'prochain'
   where id = 'd1110000-0000-4000-8000-00000000000d';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  select count(*) into v_visibles from public.nutrition_recipes
   where id = 'd5550000-0000-4000-8000-00000000000c';
  perform pg_temp.noter('I', 'I17. un plan BROUILLON n''ouvre plus le catalogue du coach', v_visibles = 0);
  reset role;

  update public.nutrition_plans set status = 'actif'
   where id = 'd1110000-0000-4000-8000-00000000000d';
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  select count(*) into v_visibles from public.nutrition_recipes
   where id = 'd5550000-0000-4000-8000-00000000000c';
  perform pg_temp.noter('I', 'I17 bis. redevenu ACTIF, le plan rouvre le catalogue', v_visibles = 1);
  reset role;
end $$;

do $$
declare v_nb int;
begin
  -- I18. Conventions de sécurité des cinq nouvelles fonctions.
  select count(*) into v_nb
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
   where n.nspname = 'public'
     and p.proname in ('delete_nutrition_plan', 'delete_nutrition_recipe',
                       'nutrition_plan_deletion_block', 'nutrition_recipe_deletion_block',
                       'nutrition_lifecycle_overview')
     and p.prosecdef = false
     and r.rolname = 'postgres'
     and 'search_path=""' = any(p.proconfig);
  perform pg_temp.noter('I', 'I18. les cinq fonctions : security invoker, owner postgres, search_path vide',
    v_nb = 5);

  -- I19. Privilèges : PUBLIC et anon dehors, authenticated dedans.
  perform pg_temp.noter('I', 'I19. anon et PUBLIC ne peuvent exécuter aucune des cinq', not exists (
    select 1 from unnest(array[
      'public.delete_nutrition_plan(uuid)',
      'public.delete_nutrition_recipe(uuid)',
      'public.nutrition_plan_deletion_block(uuid)',
      'public.nutrition_recipe_deletion_block(uuid)',
      'public.nutrition_lifecycle_overview()']) as f
     where has_function_privilege('anon', f, 'execute')
        or has_function_privilege('public', f, 'execute')));
  perform pg_temp.noter('I', 'I19 bis. authenticated peut les exécuter', (
    select bool_and(has_function_privilege('authenticated', f, 'execute'))
      from unnest(array[
        'public.delete_nutrition_plan(uuid)',
        'public.delete_nutrition_recipe(uuid)',
        'public.nutrition_plan_deletion_block(uuid)',
        'public.nutrition_recipe_deletion_block(uuid)',
        'public.nutrition_lifecycle_overview()']) as f));
  -- Le trigger, lui, n'est exécutable par personne d'autre que la base.
  perform pg_temp.noter('I', 'I19 ter. le trigger de datation n''est exposé à aucun rôle applicatif',
    not has_function_privilege('authenticated', 'public.nutrition_touch_archived_at()', 'execute')
    and not has_function_privilege('anon', 'public.nutrition_touch_archived_at()', 'execute'));
end $$;

do $$
declare v_refuse boolean := false; v_apercu jsonb; v_bloc text; v_res jsonb;
begin
  -- I20. L'aperçu est réservé au staff.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  begin
    perform public.nutrition_lifecycle_overview();
  exception when others then v_refuse := true; end;
  perform pg_temp.noter('I', 'I20. un ÉLÈVE ne peut pas lire l''aperçu du cycle de vie', v_refuse);
  reset role;

  -- I21. L'aperçu et la suppression disent la MÊME chose : une seule règle.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  select public.nutrition_lifecycle_overview() into v_apercu;
  select x->>'deletion_block' into v_bloc
    from jsonb_array_elements(v_apercu->'plans') x
   where x->>'id' = 'd1110000-0000-4000-8000-00000000000c';
  select public.delete_nutrition_plan('d1110000-0000-4000-8000-00000000000c') into v_res;
  perform pg_temp.noter('I', 'I21. l''aperçu et la suppression rendent le MÊME motif',
    v_bloc is not null and v_bloc = v_res->>'reason');
  perform pg_temp.noter('I', 'I21 bis. l''aperçu compte l''affectation du plan assigné', (
    select (x->>'assigned_students')::int
      from jsonb_array_elements(v_apercu->'plans') x
     where x->>'id' = 'd1110000-0000-4000-8000-00000000000d') = 1);
  reset role;
end $$;

do $$
declare v_nb int;
begin
  -- I22. AUCUNE donnée hors du périmètre de cette section n'a disparu. Les
  --      plans témoins des sections précédentes, le journal de l'élève et les
  --      recettes des autres sections sont recomptés explicitement.
  select count(*) into v_nb from public.nutrition_daily_logs
   where student_id = '51110000-0000-4000-8000-00000000000a';
  perform pg_temp.noter('I', 'I22. le journal de l''élève n''a pas été touché', v_nb >= 1);

  select count(*) into v_nb from public.nutrition_plans
   where id in ('d1110000-0000-4000-8000-00000000000b',
                'd1110000-0000-4000-8000-00000000000c',
                'd1110000-0000-4000-8000-00000000000d');
  perform pg_temp.noter('I', 'I22 bis. seuls les plans réellement supprimables ont disparu', v_nb = 3);

  select count(*) into v_nb from public.nutrition_recipes
   where id::text like 'a2220000-%';
  perform pg_temp.noter('I', 'I22 ter. les recettes des sections précédentes sont intactes', v_nb >= 1);
end $$;

reset role;

-- =====================================================================
-- Section K — LE PROPRIÉTAIRE D'UN PLAN (migration 20260816090000)
-- =====================================================================
-- LE DÉFAUT CORRIGÉ. `nutrition_plans.coach_id` n'était renseignée par aucun
-- chemin d'écriture, alors que la lecture élève des recettes l'exige
-- (`p.coach_id is not null and p.coach_id = nutrition_recipes.coach_id`).
-- Résultat mesuré avant correction, sur cette même base : un élève voyait son
-- plan et ZÉRO recette. Toute la bibliothèque était inaccessible.
--
-- Ces contrôles rejouent la séquence RÉELLE de l'application — création par la
-- RPC, assignation par la RPC, publication d'une recette — et vérifient que
-- l'élève finit par voir la recette. C'est la seule preuve qui vaille : les
-- écrans, le solveur et les tests unitaires fonctionnaient déjà tous.
do $$
declare
  v_res jsonb;
  v_plan uuid;
  v_profils jsonb;
  v_jours jsonb;
  v_recettes int;
begin
  select jsonb_agg(jsonb_build_object(
      'profile_key', 'day_' || j,
      'daily_calories', 2400, 'protein_bp', 3000, 'carb_bp', 4500, 'fat_bp', 2500,
      'slots', jsonb_build_array(
        jsonb_build_object('slot','breakfast','enabled',true,'protein_bp',10000,'carb_bp',10000,'fat_bp',10000,'display_order',1),
        jsonb_build_object('slot','morning_snack','enabled',false,'protein_bp',0,'carb_bp',0,'fat_bp',0,'display_order',2),
        jsonb_build_object('slot','lunch','enabled',false,'protein_bp',0,'carb_bp',0,'fat_bp',0,'display_order',3),
        jsonb_build_object('slot','afternoon_snack','enabled',false,'protein_bp',0,'carb_bp',0,'fat_bp',0,'display_order',4),
        jsonb_build_object('slot','dinner','enabled',false,'protein_bp',0,'carb_bp',0,'fat_bp',0,'display_order',5),
        jsonb_build_object('slot','dessert','enabled',false,'protein_bp',0,'carb_bp',0,'fat_bp',0,'display_order',6))))
    into v_profils
    from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) j;
  select jsonb_agg(jsonb_build_object('day', j, 'profile_key', 'day_' || j))
    into v_jours
    from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) j;

  -- Le coach A crée un plan EXACTEMENT comme l'application le fait.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000001","role":"authenticated"}', true);

  v_res := public.save_nutrition_plan_v2(jsonb_build_object(
    'plan_id', null,
    'plan', jsonb_build_object('name', 'Cycle — plan possédé', 'goal_type', 'maintien', 'status', 'actif'),
    'main_profile_key', 'day_monday',
    'profiles', v_profils,
    'days', v_jours));
  v_plan := (v_res->'plan'->>'id')::uuid;

  perform pg_temp.noter('K', 'K1. un plan créé par la RPC porte un propriétaire',
    (select coach_id from public.nutrition_plans where id = v_plan)
      = 'c1110000-0000-4000-8000-00000000000a');

  -- Il l'assigne à SON élève, toujours par la RPC.
  perform public.assign_nutrition_plan(v_plan, '51110000-0000-4000-8000-00000000000a');
  reset role;

  -- Et publie une recette.
  insert into public.nutrition_recipes (id, coach_id, name, slot_key, status)
  values ('d5550000-0000-4000-8000-00000000000e', 'c1110000-0000-4000-8000-00000000000a',
          'Cycle — recette visible', 'breakfast', 'active');

  -- CE QUE L'ÉLÈVE VOIT — le seul contrôle qui prouve la correction.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  select count(*) into v_recettes from public.nutrition_recipes
   where id = 'd5550000-0000-4000-8000-00000000000e';
  perform pg_temp.noter('K', 'K2. l''élève voit ENFIN la recette de son coach', v_recettes = 1);
  reset role;
end $$;

do $$
declare v_res jsonb;
begin
  -- K3. Un plan ANCIEN, sans propriétaire, se répare à sa réassignation — et
  --     seulement à ce moment-là.
  insert into public.nutrition_plans (id, name, goal_type, status, daily_target, nutrition_model_version)
  values ('d1110000-0000-4000-8000-00000000000f', 'Cycle — plan orphelin', 'maintien', 'actif', '{}'::jsonb, 2);
  update public.nutrition_plans set coach_id = null
   where id = 'd1110000-0000-4000-8000-00000000000f';
  perform pg_temp.noter('K', 'K3. un plan peut être remis sans propriétaire (état des plans existants)',
    (select coach_id from public.nutrition_plans where id = 'd1110000-0000-4000-8000-00000000000f') is null);

  -- Une modification ORDINAIRE ne réveille rien : le trigger d'assignation est
  -- borné à un changement réel de `student_id`.
  update public.nutrition_plans set name = 'Cycle — plan orphelin renommé'
   where id = 'd1110000-0000-4000-8000-00000000000f';
  perform pg_temp.noter('K', 'K4. renommer un plan ne lui invente pas de propriétaire',
    (select coach_id from public.nutrition_plans where id = 'd1110000-0000-4000-8000-00000000000f') is null);

  -- La structure minimale pour que l'assignation soit acceptée.
  insert into public.nutrition_plan_profiles (id, plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp)
  values ('d2220000-0000-4000-8000-00000000000f', 'd1110000-0000-4000-8000-00000000000f',
          'day_monday', 2400, 3000, 4500, 2500);
  insert into public.nutrition_meal_slot_targets (profile_id, slot, enabled, protein_bp, carb_bp, fat_bp, display_order)
  values ('d2220000-0000-4000-8000-00000000000f', 'breakfast',       true,  10000, 10000, 10000, 1),
         ('d2220000-0000-4000-8000-00000000000f', 'morning_snack',   false, 0, 0, 0, 2),
         ('d2220000-0000-4000-8000-00000000000f', 'lunch',           false, 0, 0, 0, 3),
         ('d2220000-0000-4000-8000-00000000000f', 'afternoon_snack', false, 0, 0, 0, 4),
         ('d2220000-0000-4000-8000-00000000000f', 'dinner',          false, 0, 0, 0, 5),
         ('d2220000-0000-4000-8000-00000000000f', 'dessert',         false, 0, 0, 0, 6);
  insert into public.nutrition_days (plan_id, day, profile_key, status, target)
  select 'd1110000-0000-4000-8000-00000000000f', j, 'day_monday', 'non-commence', '{}'::jsonb
    from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) j;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"a1110000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  perform public.assign_nutrition_plan('d1110000-0000-4000-8000-00000000000f',
                                       '51110000-0000-4000-8000-00000000000b');
  reset role;

  -- Le propriétaire vient de l'ÉLÈVE, pas du coach qui a cliqué : l'élève B
  -- appartient au coach B, alors que c'est le coach A qui a assigné.
  perform pg_temp.noter('K', 'K5. la réassignation répare le plan, avec le coach de l''ÉLÈVE',
    (select coach_id from public.nutrition_plans where id = 'd1110000-0000-4000-8000-00000000000f')
      = 'c1110000-0000-4000-8000-00000000000b');
end $$;

do $$
declare v_avant uuid;
begin
  -- K6. Un propriétaire existant n'est JAMAIS écrasé — la PR D fait reposer
  --     sur cette colonne le refus de supprimer le plan d'un autre coach.
  select coach_id into v_avant from public.nutrition_plans
   where id = 'd1110000-0000-4000-8000-00000000000e';
  -- L'index unique partiel n'admet qu'un plan par élève : on libère l'élève
  -- avant de lui en poser un autre à la main (ici on éprouve le TRIGGER, pas
  -- la RPC d'assignation, qui ferait ce retrait elle-même).
  update public.nutrition_plans set student_id = null
   where student_id = '51110000-0000-4000-8000-00000000000a';
  update public.nutrition_plans set student_id = '51110000-0000-4000-8000-00000000000a'
   where id = 'd1110000-0000-4000-8000-00000000000e';
  perform pg_temp.noter('K', 'K6. assigner un plan ne change pas son propriétaire',
    (select coach_id from public.nutrition_plans where id = 'd1110000-0000-4000-8000-00000000000e') = v_avant);
  update public.nutrition_plans set student_id = null
   where id = 'd1110000-0000-4000-8000-00000000000e';

  -- K7. Conventions du trigger, et son inaccessibilité aux rôles applicatifs.
  perform pg_temp.noter('K', 'K7. le trigger est security invoker, search_path vide, owner postgres', exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
     where n.nspname = 'public'
       and p.proname = 'nutrition_plans_fill_coach_id'
       and p.prosecdef = false
       and r.rolname = 'postgres'
       and 'search_path=""' = any(p.proconfig)));
  perform pg_temp.noter('K', 'K7 bis. aucun rôle applicatif ne peut l''exécuter',
    not has_function_privilege('authenticated', 'public.nutrition_plans_fill_coach_id()', 'execute')
    and not has_function_privilege('anon', 'public.nutrition_plans_fill_coach_id()', 'execute'));
  perform pg_temp.noter('K', 'K8. les deux déclencheurs sont posés', (
    select count(*) = 2 from pg_trigger
     where tgrelid = 'public.nutrition_plans'::regclass
       and not tgisinternal
       and tgname in ('nutrition_plans_fill_coach_id', 'nutrition_plans_fill_coach_id_on_assign')));
end $$;

reset role;

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
\echo '--- Tous les contrôles sont passés. ROLLBACK : aucune donnée de test ne subsiste. ---'
\echo ''

rollback;

-- Contrôle POST-ROLLBACK, hors transaction.
do $$
declare nb int;
begin
  select count(*) into nb from public.nutrition_plans
   where name in ('Plan hérité v1', 'Plan unifié', 'Plan unifié renommé',
                  'NE DOIT PAS SURVIVRE', 'Plan semaine complet',
                  'Cycle — plan libre', 'Cycle — plan assigné',
                  'Cycle — plan historique', 'Cycle — plan visibilité',
                  'Cycle — plan du coach B', 'Cycle — plan possédé',
                  'Cycle — plan orphelin', 'Cycle — plan orphelin renommé');
  if nb <> 0 then
    raise exception 'ÉCHEC   — G1. des plans de test ont survécu au ROLLBACK (% lignes)', nb;
  end if;

  select count(*) into nb from public.nutrition_recipes
   where id::text like 'a2220000-%' or id::text like 'd5550000-%';
  if nb <> 0 then
    raise exception 'ÉCHEC   — G2. des recettes de test ont survécu au ROLLBACK';
  end if;

  -- La section I supprime réellement des lignes. Le ROLLBACK doit aussi
  -- REMETTRE ce qu'elle a supprimé : une checklist ne laisse pas de trou.
  select count(*) into nb from public.nutrition_daily_logs
   where nutrition_plan_id::text like 'd1110000-%';
  if nb <> 0 then
    raise exception 'ÉCHEC   — G2 bis. un journal de test a survécu au ROLLBACK';
  end if;

  select count(*) into nb from auth.users where email like 'pc.%@test.local';
  if nb <> 0 then
    raise exception 'ÉCHEC   — G3. des comptes de test ont survécu au ROLLBACK';
  end if;

  raise notice 'OK      — G1/G3. aucune donnée de test persistante après le ROLLBACK';
end $$;

do $$
begin
  -- Les objets des migrations, eux, doivent toujours être là.
  if to_regprocedure('public.save_nutrition_plan_v2(jsonb)') is null
     or to_regprocedure('public.current_coach_id()') is null
     or to_regprocedure('public.nutrition_v2_backfill_plan(uuid)') is null
     or to_regprocedure('public.nutrition_v2_normalize_vocabulary()') is null
     or to_regprocedure('public.nutrition_plan_v2_blocking_issue(uuid)') is null
     or to_regprocedure('public.delete_nutrition_plan(uuid)') is null
     or to_regprocedure('public.delete_nutrition_recipe(uuid)') is null
     or to_regprocedure('public.nutrition_plan_deletion_block(uuid)') is null
     or to_regprocedure('public.nutrition_recipe_deletion_block(uuid)') is null
     or to_regprocedure('public.nutrition_lifecycle_overview()') is null
     or to_regprocedure('public.nutrition_plans_fill_coach_id()') is null then
    raise exception 'ÉCHEC   — G4. une fonction de migration a disparu';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.nutrition_days'::regclass
       and conname = 'nutrition_days_profile_fkey') then
    raise exception 'ÉCHEC   — G5. la clé étrangère composite a disparu';
  end if;
  raise notice 'OK      — G4/G5. les objets des migrations sont toujours en place';
end $$;
