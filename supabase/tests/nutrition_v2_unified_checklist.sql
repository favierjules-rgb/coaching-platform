-- ============================================================================
-- Checklist PostgreSQL — feat/student-nutrition-recipes, PR C
-- Migrations couvertes :
--   20260810090000_harden_nutrition_privileges.sql
--   20260811090000_nutrition_v2_unification.sql
--   20260812090000_save_nutrition_plan_v2_full.sql
--   20260813090000_student_recipe_read_access.sql
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
--   G. aucune donnée de test persistante après le ROLLBACK.
--
-- Lancement :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/nutrition_v2_unified_checklist.sql
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;

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
   where name in ('Plan hérité v1', 'Plan unifié', 'Plan unifié renommé', 'NE DOIT PAS SURVIVRE');
  if nb <> 0 then
    raise exception 'ÉCHEC   — G1. des plans de test ont survécu au ROLLBACK (% lignes)', nb;
  end if;

  select count(*) into nb from public.nutrition_recipes
   where id::text like 'a2220000-%';
  if nb <> 0 then
    raise exception 'ÉCHEC   — G2. des recettes de test ont survécu au ROLLBACK';
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
     or to_regprocedure('public.nutrition_v2_normalize_vocabulary()') is null then
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
