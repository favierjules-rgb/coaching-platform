-- ============================================================================
-- Checklist PostgreSQL — COURSES C0 : « VALIDER MES CHOIX ».
--
-- POURQUOI CE FICHIER EXISTE AVANT LA MOINDRE LIGNE D'INTERFACE.
-- C0 n'écrit aucune migration et ne crée aucune RPC : il APPELLE SEULE une
-- fonction qui n'a jamais été appelée seule — `enregistrer_repas_planifie`,
-- jusqu'ici invoquée uniquement DEPUIS `enregistrer_repas_structure_consomme`.
-- Bâtir l'interface sans avoir éprouvé ce chemin serait supposer, pas mesurer.
--
-- CE QU'ELLE VÉRIFIE
--   V-A   la RPC existe, security definer, `authenticated` oui / `anon` non,
--         et sa signature n'accepte AUCUNE macro
--   V-B   un appel direct crée 1 planned_meal et N planned_meal_items, avec
--         les quantités, les identités et les unités EXACTEMENT transmises
--   V-C   il ne crée NI consumed_meal NI meal_entry, et consumed_meal_id
--         reste NULL — valider n'est pas manger
--   V-D   idempotence : deux appels identiques ne dupliquent rien
--   V-E   revalidation : les items sont REMPLACÉS, le planned_meal est le MÊME
--   V-F   refus : choix incomplet · option hors snapshot · autre élève · anon
--   V-G   indépendance : jour A ≠ jour B, déjeuner ≠ dîner
--   V-H   l'identité PRODUIT est préservée comme l'identité catalogue
--   V-I   ⚠️ CE CAS A ÉTÉ TRANCHÉ PAR C0.1. Il mesurait une divergence ; il
--         mesure désormais le REFUS qui l'empêche.
--   LOCK  C0.1 — le verrou serveur : refus, erreur stable, et rien qui bouge
--   V-J   « Enregistrer le repas » après validation : rien n'est dupliqué, et
--         c'est LUI qui renseigne consumed_meal_id
--   Z     après le ROLLBACK, aucune donnée de test ne subsiste
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

create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, coalesce(p_ok, false));
  if p_ok is null then raise warning 'INDÉTERMINÉ — % · %', p_section, p_libelle;
  elsif p_ok then raise notice 'OK      — % · %', p_section, p_libelle;
  else raise warning 'ÉCHEC   — % · %', p_section, p_libelle; end if;
end $$;

create or replace function pg_temp.refuse_pour(p_sql text, p_motif text)
returns boolean language plpgsql as $$
begin execute p_sql; return false;
exception when others then return sqlerrm like '%' || p_motif || '%'; end $$;

create or replace function pg_temp.connecte(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

do $$
declare s text;
begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant execute on all functions in schema %I to authenticated, anon', s);
end $$;

-- ---------------------------------------------------------------------
-- V-A — LA SIGNATURE ET LES DROITS, AVANT TOUTE DONNÉE
-- ---------------------------------------------------------------------
do $$
declare v_args text;
begin
  perform pg_temp.noter('V-A', 'la RPC existe, en security definer', (
    select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='enregistrer_repas_planifie'));
  perform pg_temp.noter('V-A', 'authenticated peut l''exécuter', (
    select has_function_privilege('authenticated',
      'public.enregistrer_repas_planifie(uuid,date,jsonb)', 'execute')));
  perform pg_temp.noter('V-A', 'anon ne peut PAS l''exécuter', (
    select not has_function_privilege('anon',
      'public.enregistrer_repas_planifie(uuid,date,jsonb)', 'execute')));

  -- ⚠️ TROIS ARGUMENTS, AUCUNE MACRO, AUCUN ÉLÈVE. Le client ne PEUT PAS
  -- envoyer de protéines : il n'existe aucun paramètre pour le faire, et
  -- l'élève vient du JWT. C'est une garantie de SIGNATURE, pas de discipline.
  select pg_get_function_identity_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='enregistrer_repas_planifie';
  perform pg_temp.noter('V-A', 'la signature est (uuid, date, jsonb) et rien d''autre',
    v_args = 'p_meal_id uuid, p_planned_on date, p_items jsonb');
  perform pg_temp.noter('V-A', 'aucun paramètre de macro', (
    v_args not like '%protein%' and v_args not like '%carb%'
    and v_args not like '%fat%' and v_args not like '%kcal%'));
  perform pg_temp.noter('V-A', 'aucun paramètre d''élève — il vient du JWT',
    v_args not like '%student%');

  -- ⚠️ ET ELLE N'ÉCRIT PAS LA CONSOMMATION. Mesuré sur la SOURCE de la
  -- fonction : ni `consumed_meals`, ni `meal_entries`, ni `consumed_meal_id`
  -- n'y sont écrits. C'est ce qui autorise C0 à l'appeler seule.
  perform pg_temp.noter('V-A', 'la RPC n''insère jamais dans consumed_meals', (
    select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', ' ', 'g')
             not ilike '%insert into public.consumed_meals%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='enregistrer_repas_planifie'));
  perform pg_temp.noter('V-A', 'la RPC n''insère jamais dans meal_entries', (
    select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', ' ', 'g')
             not ilike '%insert into public.meal_entries%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='enregistrer_repas_planifie'));
  perform pg_temp.noter('V-A', 'la RPC n''écrit jamais consumed_meal_id', (
    select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', ' ', 'g')
             not ilike '%consumed_meal_id =%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='enregistrer_repas_planifie'));
end $$;

-- ---------------------------------------------------------------------
-- LE BANC — un élève, un plan assigné, deux repas, trois occurrences
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c0000000-0000-4000-8000-0000000000e1', 'c0-eleve@test.invalid'),
  ('c0000000-0000-4000-8000-0000000000e2', 'c0-autre@test.invalid');
insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('c0000000-0000-4000-8000-0000000000e1', 'student', 'C0', 'Eleve', 'c0-eleve@test.invalid'),
  ('c0000000-0000-4000-8000-0000000000e2', 'student', 'C0', 'Autre', 'c0-autre@test.invalid');
insert into public.students (id, user_id, first_name, last_name, email, status) values
  ('c0000000-0000-4000-8000-000000005001', 'c0000000-0000-4000-8000-0000000000e1', 'C0', 'Eleve', 'c0-eleve@test.invalid', 'active'),
  ('c0000000-0000-4000-8000-000000005002', 'c0000000-0000-4000-8000-0000000000e2', 'C0', 'Autre', 'c0-autre@test.invalid', 'active');

insert into public.food_catalog (id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, status) values
  ('c0000000-0000-4000-8000-00000000f001', 'C0 Poulet', 'g', 31, 0, 3.6, 'active'),
  ('c0000000-0000-4000-8000-00000000f002', 'C0 Riz',    'g', 2.7, 28, 0.3, 'active'),
  ('c0000000-0000-4000-8000-00000000f003', 'C0 Saumon', 'g', 20, 0, 13, 'active'),
  ('c0000000-0000-4000-8000-00000000f004', 'C0 Hors liste', 'g', 10, 10, 10, 'active');

-- Un PRODUIT, pour éprouver la seconde identité (V-H).
insert into public.food_products (id, gtin, product_name, brand, nutrition_unit,
                                  protein_per_100, carb_per_100, fat_per_100,
                                  source, source_version, source_fetched_at)
values ('c0000000-0000-4000-8000-00000000f101', '3000000000017', 'C0 Skyr', 'MarqueC0', 'g',
        10, 4, 0.2, 'open_food_facts', 'v3.4', now());

insert into public.nutrition_plans (id, name, status, nutrition_model_version, student_id)
values ('c0000000-0000-4000-8000-00000000b001', 'Plan C0', 'actif', 2, 'c0000000-0000-4000-8000-000000005001');
insert into public.nutrition_plan_profiles (plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp)
values ('c0000000-0000-4000-8000-00000000b001', 'default', 2000, 3000, 4000, 3000);
insert into public.nutrition_days (id, plan_id, day, status, profile_key) values
  ('c0000000-0000-4000-8000-00000000d001', 'c0000000-0000-4000-8000-00000000b001', 'monday', 'non-commence', 'default');
insert into public.meals (id, nutrition_day_id, slot, name, items, macros, coach_notes) values
  ('c0000000-0000-4000-8000-00000000e001', 'c0000000-0000-4000-8000-00000000d001', 'lunch',  'Déjeuner', '[]', '{}', ''),
  ('c0000000-0000-4000-8000-00000000e002', 'c0000000-0000-4000-8000-00000000d001', 'dinner', 'Dîner',    '[]', '{}', '');
insert into public.meal_choice_slots (id, meal_id, position, label) values
  ('c0000000-0000-4000-8000-00000000a501', 'c0000000-0000-4000-8000-00000000e001', 1, 'Ta protéine'),
  ('c0000000-0000-4000-8000-00000000a502', 'c0000000-0000-4000-8000-00000000e001', 2, 'Ton féculent'),
  ('c0000000-0000-4000-8000-00000000a503', 'c0000000-0000-4000-8000-00000000e002', 1, 'Ta protéine du soir');
-- L'occurrence 1 propose DEUX aliments : c'est le vrai choix de N1.4.
insert into public.meal_choice_options (slot_id, position, catalog_food_id) values
  ('c0000000-0000-4000-8000-00000000a501', 1, 'c0000000-0000-4000-8000-00000000f001'),
  ('c0000000-0000-4000-8000-00000000a501', 2, 'c0000000-0000-4000-8000-00000000f003'),
  ('c0000000-0000-4000-8000-00000000a502', 1, 'c0000000-0000-4000-8000-00000000f002'),
  ('c0000000-0000-4000-8000-00000000a503', 1, 'c0000000-0000-4000-8000-00000000f001');
-- Et un PRODUIT dans la seconde occurrence.
insert into public.meal_choice_options (slot_id, position, product_id) values
  ('c0000000-0000-4000-8000-00000000a502', 2, 'c0000000-0000-4000-8000-00000000f101');

create or replace function pg_temp.deux(p_food1 uuid, p_q1 numeric, p_food2 uuid, p_q2 numeric)
returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('slot_id', 'c0000000-0000-4000-8000-00000000a501',
                       'catalog_food_id', p_food1, 'quantity', p_q1, 'unit', 'g'),
    jsonb_build_object('slot_id', 'c0000000-0000-4000-8000-00000000a502',
                       'catalog_food_id', p_food2, 'quantity', p_q2, 'unit', 'g'));
$$;

set local role authenticated;
select pg_temp.connecte('c0000000-0000-4000-8000-0000000000e1');

-- ---------------------------------------------------------------------
-- V-B / V-C — LE PREMIER APPEL DIRECT, ET CE QU'IL NE FAIT PAS
-- ---------------------------------------------------------------------
do $$
declare v_pm uuid; v_cm_avant int; v_me_avant int;
begin
  select count(*) into v_cm_avant from public.consumed_meals;
  select count(*) into v_me_avant from public.meal_entries;

  v_pm := public.enregistrer_repas_planifie(
    'c0000000-0000-4000-8000-00000000e001', date '2026-08-17',
    pg_temp.deux('c0000000-0000-4000-8000-00000000f001', 163,
                 'c0000000-0000-4000-8000-00000000f002', 200));
  perform set_config('c0.pm', v_pm::text, true);

  perform pg_temp.noter('V-B', 'un planned_meal est créé', v_pm is not null);
  perform pg_temp.noter('V-B', 'il porte la DATE réelle et le repas', (
    select planned_on = date '2026-08-17'
       and meal_id = 'c0000000-0000-4000-8000-00000000e001'
       and slot_key = 'lunch'
      from public.planned_meals where id = v_pm));
  perform pg_temp.noter('V-B', 'il appartient à l''élève du JWT', (
    select student_id = 'c0000000-0000-4000-8000-000000005001'
      from public.planned_meals where id = v_pm));

  -- ⚠️ UN ITEM PAR OCCURRENCE, ET PAS UN DE PLUS. Deux occurrences envoyées,
  -- deux lignes écrites : c'est la clé `un_choix_par_occurrence` en action.
  perform pg_temp.noter('V-B', 'un item par occurrence (2)', (
    select count(*) = 2 from public.planned_meal_items where planned_meal_id = v_pm));

  -- ⚠️ LA QUANTITÉ EST EXACTEMENT CELLE ENVOYÉE. L'écran dit 163 g ; la base
  -- dit 163. Pas 162,6 : elle n'est pas recalculée, elle est transmise.
  perform pg_temp.noter('V-B', 'la quantité est EXACTEMENT celle envoyée (163 g)', (
    select quantity = 163 and unit = 'g' from public.planned_meal_items
     where planned_meal_id = v_pm and catalog_food_id = 'c0000000-0000-4000-8000-00000000f001'));
  perform pg_temp.noter('V-B', 'la quantité est EXACTEMENT celle envoyée (200 g)', (
    select quantity = 200 and unit = 'g' from public.planned_meal_items
     where planned_meal_id = v_pm and catalog_food_id = 'c0000000-0000-4000-8000-00000000f002'));

  -- ⚠️ L'IDENTITÉ EST FORTE, ET L'OCCURRENCE EST CONSERVÉE. C'est ce couple
  -- qui permettra plus tard de RESTAURER la sélection sans chercher par nom.
  perform pg_temp.noter('V-B', 'l''identité catalogue et l''occurrence sont conservées', (
    select count(*) = 1 from public.planned_meal_items
     where planned_meal_id = v_pm
       and choice_slot_id = 'c0000000-0000-4000-8000-00000000a501'
       and catalog_food_id = 'c0000000-0000-4000-8000-00000000f001'
       and product_id is null));

  -- V-C — CE QUE VALIDER NE FAIT PAS. Trois mesures, pas une intention.
  perform pg_temp.noter('V-C', 'AUCUN consumed_meal n''a été créé', (
    select count(*) = v_cm_avant from public.consumed_meals));
  perform pg_temp.noter('V-C', 'AUCUNE meal_entry n''a été créée', (
    select count(*) = v_me_avant from public.meal_entries));
  perform pg_temp.noter('V-C', 'consumed_meal_id reste NULL — valider n''est pas manger', (
    select consumed_meal_id is null from public.planned_meals where id = v_pm));
end $$;

-- ---------------------------------------------------------------------
-- V-D / V-E — IDEMPOTENCE ET REVALIDATION
-- ---------------------------------------------------------------------
do $$
declare v_pm uuid := current_setting('c0.pm')::uuid; v_pm2 uuid;
begin
  -- V-D — le MÊME appel, deux fois.
  v_pm2 := public.enregistrer_repas_planifie(
    'c0000000-0000-4000-8000-00000000e001', date '2026-08-17',
    pg_temp.deux('c0000000-0000-4000-8000-00000000f001', 163,
                 'c0000000-0000-4000-8000-00000000f002', 200));
  perform pg_temp.noter('V-D', 'le second appel rend le MÊME planned_meal', v_pm2 = v_pm);
  perform pg_temp.noter('V-D', 'aucune ligne planned_meals dupliquée', (
    select count(*) = 1 from public.planned_meals
     where student_id = 'c0000000-0000-4000-8000-000000005001'
       and planned_on = date '2026-08-17'
       and meal_id = 'c0000000-0000-4000-8000-00000000e001'));
  perform pg_temp.noter('V-D', 'toujours deux items, aucun doublon', (
    select count(*) = 2 from public.planned_meal_items where planned_meal_id = v_pm));

  -- V-E — L'ÉLÈVE CHANGE D'AVIS : poulet → saumon, et la quantité bouge.
  v_pm2 := public.enregistrer_repas_planifie(
    'c0000000-0000-4000-8000-00000000e001', date '2026-08-17',
    pg_temp.deux('c0000000-0000-4000-8000-00000000f003', 210,
                 'c0000000-0000-4000-8000-00000000f002', 180));
  perform pg_temp.noter('V-E', 'la revalidation garde le MÊME planned_meal', v_pm2 = v_pm);
  perform pg_temp.noter('V-E', 'toujours deux items — les anciens sont REMPLACÉS', (
    select count(*) = 2 from public.planned_meal_items where planned_meal_id = v_pm));
  perform pg_temp.noter('V-E', 'le poulet a disparu de la composition', (
    select count(*) = 0 from public.planned_meal_items
     where planned_meal_id = v_pm and catalog_food_id = 'c0000000-0000-4000-8000-00000000f001'));
  perform pg_temp.noter('V-E', 'le saumon l''a remplacé, avec sa nouvelle quantité', (
    select quantity = 210 from public.planned_meal_items
     where planned_meal_id = v_pm and catalog_food_id = 'c0000000-0000-4000-8000-00000000f003'));
  perform pg_temp.noter('V-E', 'et toujours aucun consumed_meal_id', (
    select consumed_meal_id is null from public.planned_meals where id = v_pm));
end $$;

-- ---------------------------------------------------------------------
-- V-H — L'IDENTITÉ PRODUIT
-- ---------------------------------------------------------------------
do $$
declare v_pm uuid := current_setting('c0.pm')::uuid;
begin
  perform public.enregistrer_repas_planifie(
    'c0000000-0000-4000-8000-00000000e001', date '2026-08-17',
    jsonb_build_array(
      jsonb_build_object('slot_id', 'c0000000-0000-4000-8000-00000000a501',
                         'catalog_food_id', 'c0000000-0000-4000-8000-00000000f003',
                         'quantity', 210, 'unit', 'g'),
      jsonb_build_object('slot_id', 'c0000000-0000-4000-8000-00000000a502',
                         'product_id', 'c0000000-0000-4000-8000-00000000f101',
                         'quantity', 150, 'unit', 'g')));

  perform pg_temp.noter('V-H', 'un PRODUIT est enregistré avec product_id, sans catalog_food_id', (
    select quantity = 150 and catalog_food_id is null
      from public.planned_meal_items
     where planned_meal_id = v_pm and product_id = 'c0000000-0000-4000-8000-00000000f101'));
  perform pg_temp.noter('V-H', 'et l''aliment catalogue de l''autre occurrence coexiste', (
    select count(*) = 1 from public.planned_meal_items
     where planned_meal_id = v_pm and catalog_food_id = 'c0000000-0000-4000-8000-00000000f003'));
end $$;

-- ---------------------------------------------------------------------
-- V-F — LES REFUS
-- ---------------------------------------------------------------------
do $$
begin
  -- ⚠️ CHOIX INCOMPLET : une seule des deux occurrences envoyée.
  perform pg_temp.noter('V-F', 'un choix INCOMPLET est refusé (CHOIX_INCOMPLET)',
    pg_temp.refuse_pour($q$ select public.enregistrer_repas_planifie(
        'c0000000-0000-4000-8000-00000000e001', date '2026-08-18',
        jsonb_build_array(jsonb_build_object(
          'slot_id', 'c0000000-0000-4000-8000-00000000a501',
          'catalog_food_id', 'c0000000-0000-4000-8000-00000000f001',
          'quantity', 100, 'unit', 'g'))) $q$,
      'CHOIX_INCOMPLET'));

  -- ⚠️ HORS SNAPSHOT : un aliment qui n'est dans AUCUNE option de l'occurrence.
  perform pg_temp.noter('V-F', 'une option HORS SNAPSHOT est refusée (CHOIX_HORS_LISTE)',
    pg_temp.refuse_pour($q$ select public.enregistrer_repas_planifie(
        'c0000000-0000-4000-8000-00000000e001', date '2026-08-18',
        pg_temp.deux('c0000000-0000-4000-8000-00000000f004', 100,
                     'c0000000-0000-4000-8000-00000000f002', 100)) $q$,
      'CHOIX_HORS_LISTE'));

  -- ⚠️ DEUX IDENTITÉS À LA FOIS : refusé avant même la contrainte de table.
  perform pg_temp.noter('V-F', 'deux identités sur un item sont refusées (IDENTITE_INVALIDE)',
    pg_temp.refuse_pour($q$ select public.enregistrer_repas_planifie(
        'c0000000-0000-4000-8000-00000000e001', date '2026-08-18',
        jsonb_build_array(
          jsonb_build_object('slot_id','c0000000-0000-4000-8000-00000000a501',
            'catalog_food_id','c0000000-0000-4000-8000-00000000f001',
            'product_id','c0000000-0000-4000-8000-00000000f101','quantity',100,'unit','g'),
          jsonb_build_object('slot_id','c0000000-0000-4000-8000-00000000a502',
            'catalog_food_id','c0000000-0000-4000-8000-00000000f002','quantity',100,'unit','g'))) $q$,
      'IDENTITE_INVALIDE'));

  -- ⚠️ QUANTITÉ NULLE OU NÉGATIVE.
  perform pg_temp.noter('V-F', 'une quantité non positive est refusée (QUANTITE_INVALIDE)',
    pg_temp.refuse_pour($q$ select public.enregistrer_repas_planifie(
        'c0000000-0000-4000-8000-00000000e001', date '2026-08-18',
        pg_temp.deux('c0000000-0000-4000-8000-00000000f003', 0,
                     'c0000000-0000-4000-8000-00000000f002', 100)) $q$,
      'QUANTITE_INVALIDE'));

  -- ⚠️ ET AUCUN DE CES REFUS N'A LAISSÉ DE TRACE. Le rollback est celui de la
  -- fonction, pas une politesse de l'appelant.
  perform pg_temp.noter('V-F', 'aucun planned_meal n''a été créé au 18/08 par ces refus', (
    select count(*) = 0 from public.planned_meals where planned_on = date '2026-08-18'));
end $$;

-- ⚠️ UN AUTRE ÉLÈVE — le repas ne lui est pas assigné.
set local role authenticated;
select pg_temp.connecte('c0000000-0000-4000-8000-0000000000e2');
do $$
begin
  perform pg_temp.noter('V-F', 'un AUTRE élève est refusé (REPAS_PRESCRIT_INACCESSIBLE)',
    pg_temp.refuse_pour($q$ select public.enregistrer_repas_planifie(
        'c0000000-0000-4000-8000-00000000e001', date '2026-08-19',
        pg_temp.deux('c0000000-0000-4000-8000-00000000f003', 100,
                     'c0000000-0000-4000-8000-00000000f002', 100)) $q$,
      'REPAS_PRESCRIT_INACCESSIBLE'));
  perform pg_temp.noter('V-F', 'et il ne VOIT pas le planifié de l''autre (RLS)', (
    select count(*) = 0 from public.planned_meals
     where student_id = 'c0000000-0000-4000-8000-000000005001'));
end $$;

-- ⚠️ ANON — le refus est un défaut de DROIT, pas un message d'erreur métier.
set local role anon;
do $$
begin
  perform pg_temp.noter('V-F', 'anon ne peut pas exécuter la RPC (permission denied)',
    pg_temp.refuse_pour($q$ select public.enregistrer_repas_planifie(
        'c0000000-0000-4000-8000-00000000e001', date '2026-08-19', '[]'::jsonb) $q$,
      'permission denied'));
end $$;
reset role;

-- ---------------------------------------------------------------------
-- V-G — INDÉPENDANCE DES JOURS ET DES REPAS
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('c0000000-0000-4000-8000-0000000000e1');
do $$
declare v_lundi uuid := current_setting('c0.pm')::uuid; v_mardi uuid; v_diner uuid;
begin
  -- Le MÊME repas, un AUTRE jour.
  v_mardi := public.enregistrer_repas_planifie(
    'c0000000-0000-4000-8000-00000000e001', date '2026-08-18',
    pg_temp.deux('c0000000-0000-4000-8000-00000000f001', 120,
                 'c0000000-0000-4000-8000-00000000f002', 90));
  perform pg_temp.noter('V-G', 'jour A et jour B sont DEUX planned_meals', v_mardi <> v_lundi);
  perform pg_temp.noter('V-G', 'et le jour A n''a pas bougé', (
    select count(*) = 1 from public.planned_meal_items
     where planned_meal_id = v_lundi and catalog_food_id = 'c0000000-0000-4000-8000-00000000f003'));

  -- Un AUTRE repas, le MÊME jour.
  v_diner := public.enregistrer_repas_planifie(
    'c0000000-0000-4000-8000-00000000e002', date '2026-08-18',
    jsonb_build_array(jsonb_build_object(
      'slot_id', 'c0000000-0000-4000-8000-00000000a503',
      'catalog_food_id', 'c0000000-0000-4000-8000-00000000f001',
      'quantity', 175, 'unit', 'g')));
  perform pg_temp.noter('V-G', 'déjeuner et dîner du même jour sont DEUX planned_meals',
    v_diner <> v_mardi);
  perform pg_temp.noter('V-G', 'le dîner porte son propre créneau', (
    select slot_key = 'dinner' from public.planned_meals where id = v_diner));
end $$;

-- ---------------------------------------------------------------------
-- V-I / LOCK — LE VERROU DE C0.1, MESURÉ SUR LE CHEMIN QUI POSAIT PROBLÈME.
--
-- Ce bloc mesurait autrefois une DIVERGENCE : la RPC acceptait de réécrire le
-- planifié d'un repas déjà consommé, et planifié / consommé partaient chacun
-- de leur côté. C0.1 a fermé ce chemin. Le bloc mesure donc maintenant le
-- refus, ET tout ce qui doit continuer de fonctionner autour de lui.
-- ---------------------------------------------------------------------
do $$
declare
  v_res jsonb; v_pm uuid; v_cm uuid;
  v_items_avant text; v_items_apres text;
  v_entrees_avant text; v_entrees_apres text;
begin
  -- LOCK-07 — ENREGISTRER SANS VALIDATION PRÉALABLE. Le dîner du 18 n'a jamais
  -- été validé : c'est le parcours de N1.6B, et il doit rester intact.
  -- ⚠️ UNE DATE VIERGE, EXPRÈS. Le 18 a déjà servi à V-G : y mesurer
  -- « aucun planifié » testerait le banc, pas la RPC.
  perform pg_temp.noter('LOCK-07', 'aucun planifié n''existe avant l''enregistrement', (
    select count(*) = 0 from public.planned_meals
     where meal_id = 'c0000000-0000-4000-8000-00000000e002'
       and planned_on = date '2026-08-25'));

  v_res := public.enregistrer_repas_structure_consomme(
    'c0000000-0000-4000-8000-00000000e002', date '2026-08-25',
    jsonb_build_array(jsonb_build_object(
      'slot_id', 'c0000000-0000-4000-8000-00000000a503',
      'catalog_food_id', 'c0000000-0000-4000-8000-00000000f001',
      'quantity', 175, 'unit', 'g')));
  v_pm := (v_res->>'planned_meal_id')::uuid;
  v_cm := (v_res->>'consumed_meal_id')::uuid;

  perform pg_temp.noter('LOCK-07', 'enregistrer SANS validation préalable fonctionne', (
    (v_res->>'entrees_creees')::int = 1 and (v_res->>'deja_enregistre')::boolean = false));
  perform pg_temp.noter('LOCK-07', 'et il a créé le planifié au passage', (
    select count(*) = 1 from public.planned_meal_items where planned_meal_id = v_pm));

  perform pg_temp.noter('V-J', 'enregistrer APRÈS validation ne duplique pas le planned_meal', (
    select count(*) = 1 from public.planned_meals
     where student_id = 'c0000000-0000-4000-8000-000000005001'
       and planned_on = date '2026-08-25'
       and meal_id = 'c0000000-0000-4000-8000-00000000e002'));
  perform pg_temp.noter('V-J', 'c''est LA CONSOMMATION qui renseigne consumed_meal_id', (
    select consumed_meal_id = v_cm from public.planned_meals where id = v_pm));
  perform pg_temp.noter('V-J', 'et une entrée de consommation existe', (
    select count(*) = 1 from public.meal_entries where consumed_meal_id = v_cm));

  -- ── L'ÉTAT EXACT, AVANT LA TENTATIVE ─────────────────────────────────────
  -- ⚠️ ON PHOTOGRAPHIE, ON NE RÉSUME PAS. « Les items sont inchangés » se
  -- prouve en comparant leur contenu complet, pas leur nombre : une réécriture
  -- qui remplacerait 175 g par 999 g garderait exactement une ligne.
  select string_agg(format('%s|%s|%s|%s', choice_slot_id, coalesce(catalog_food_id::text,'-'),
                           quantity, unit), ',' order by position)
    into v_items_avant from public.planned_meal_items where planned_meal_id = v_pm;
  select string_agg(format('%s|%s|%s|%s|%s', food_id, quantity, unit, protein_g, carb_g), ',' order by id)
    into v_entrees_avant from public.meal_entries where consumed_meal_id = v_cm;

  -- ── LOCK-02 / LOCK-03 — LE REFUS ─────────────────────────────────────────
  perform pg_temp.noter('LOCK-02', 'un repas CONSOMMÉ refuse la revalidation',
    pg_temp.refuse_pour($q$ select public.enregistrer_repas_planifie(
        'c0000000-0000-4000-8000-00000000e002', date '2026-08-25',
        jsonb_build_array(jsonb_build_object(
          'slot_id', 'c0000000-0000-4000-8000-00000000a503',
          'catalog_food_id', 'c0000000-0000-4000-8000-00000000f001',
          'quantity', 999, 'unit', 'g'))) $q$,
      'REPAS_DEJA_CONSOMME'));
  -- ⚠️ L'ERREUR EST NOMMÉE, PAS SEULEMENT LEVÉE. Un `raise` générique
  -- laisserait le client afficher un message technique ; ce nom est traduit.
  perform pg_temp.noter('LOCK-03', 'et l''erreur porte EXACTEMENT le nom REPAS_DEJA_CONSOMME',
    pg_temp.refuse_pour($q$ select public.enregistrer_repas_planifie(
        'c0000000-0000-4000-8000-00000000e002', date '2026-08-25', '[]'::jsonb) $q$,
      'REPAS_DEJA_CONSOMME'));

  -- ── LOCK-04 / 05 / 06 — RIEN N'A BOUGÉ ───────────────────────────────────
  select string_agg(format('%s|%s|%s|%s', choice_slot_id, coalesce(catalog_food_id::text,'-'),
                           quantity, unit), ',' order by position)
    into v_items_apres from public.planned_meal_items where planned_meal_id = v_pm;
  select string_agg(format('%s|%s|%s|%s|%s', food_id, quantity, unit, protein_g, carb_g), ',' order by id)
    into v_entrees_apres from public.meal_entries where consumed_meal_id = v_cm;

  -- ⚠️ CE QUE LOCK-04 PROUVE, ET CE QU'IL NE PEUT PAS PROUVER. Il compare le
  -- contenu COMPLET, pas un compte : une réécriture 175 → 999 garderait une
  -- ligne. Mais il ne peut PAS prouver que le refus précède le `delete` — un
  -- `raise` à l'intérieur d'une fonction annule de toute façon les écritures de
  -- l'instruction. Mesuré : déplacer le verrou APRÈS le `delete` laisse LOCK-04
  -- vert et ne fait rougir que LOCK-03. C'est donc LOCK-03 qui garde l'ordre,
  -- en exigeant que le refus arrive avant même la validation de la charge utile.
  perform pg_temp.noter('LOCK-04', 'planned_meal_items est BIT-IDENTIQUE après le refus',
    v_items_apres is not distinct from v_items_avant);
  perform pg_temp.noter('LOCK-05', 'meal_entries est BIT-IDENTIQUE après le refus',
    v_entrees_apres is not distinct from v_entrees_avant);
  perform pg_temp.noter('LOCK-06', 'consumed_meal_id est inchangé après le refus', (
    select consumed_meal_id = v_cm from public.planned_meals where id = v_pm));
  -- Et la quantité d'origine est toujours là, nommément.
  perform pg_temp.noter('LOCK-04', 'la quantité planifiée vaut toujours 175 g', (
    select quantity = 175 from public.planned_meal_items where planned_meal_id = v_pm));

  -- ── LOCK-09 — L'IDEMPOTENCE DE N1.6B SURVIT AU VERROU ────────────────────
  -- ⚠️ C'EST LE CONTRÔLE QUI JUSTIFIE D'AVOIR TOUCHÉ À DEUX FONCTIONS. Sans
  -- l'inversion de l'ordre dans `enregistrer_repas_structure_consomme`, ce
  -- second appel lèverait REPAS_DEJA_CONSOMME au lieu de rendre « déjà
  -- enregistré » — un double clic casserait l'écran.
  v_res := public.enregistrer_repas_structure_consomme(
    'c0000000-0000-4000-8000-00000000e002', date '2026-08-25',
    jsonb_build_array(jsonb_build_object(
      'slot_id', 'c0000000-0000-4000-8000-00000000a503',
      'catalog_food_id', 'c0000000-0000-4000-8000-00000000f001',
      'quantity', 175, 'unit', 'g')));
  perform pg_temp.noter('LOCK-09', 'un second enregistrement reste idempotent', (
    (v_res->>'deja_enregistre')::boolean = true and (v_res->>'entrees_creees')::int = 0));
  perform pg_temp.noter('LOCK-09', 'et il rend le MÊME conteneur', (v_res->>'consumed_meal_id')::uuid = v_cm);
  perform pg_temp.noter('LOCK-09', 'sans créer une seule entrée de plus', (
    select count(*) = 1 from public.meal_entries where consumed_meal_id = v_cm));

  -- ⚠️ ET MÊME AVEC DES ITEMS DIFFÉRENTS. C'est le défaut que l'ancien ordre
  -- laissait passer : le second appel réécrivait le planifié AVANT de répondre
  -- « déjà enregistré ». Il ne le peut plus.
  v_res := public.enregistrer_repas_structure_consomme(
    'c0000000-0000-4000-8000-00000000e002', date '2026-08-25',
    jsonb_build_array(jsonb_build_object(
      'slot_id', 'c0000000-0000-4000-8000-00000000a503',
      'catalog_food_id', 'c0000000-0000-4000-8000-00000000f001',
      'quantity', 42, 'unit', 'g')));
  perform pg_temp.noter('LOCK-09', 'un second appel aux items DIFFÉRENTS ne réécrit rien', (
    select quantity = 175 from public.planned_meal_items where planned_meal_id = v_pm));
end $$;

-- ---------------------------------------------------------------------
-- LOCK-01 — UN REPAS NON CONSOMMÉ RESTE LIBREMENT MODIFIABLE
-- ⚠️ LE VERROU DOIT MORDRE SUR LA CONSOMMATION, PAS SUR L'EXISTENCE. Bloquer
-- tout `planned_meal` existant supprimerait « Mettre à jour mes choix ».
-- ---------------------------------------------------------------------
do $$
declare v_pm uuid;
begin
  v_pm := public.enregistrer_repas_planifie(
    'c0000000-0000-4000-8000-00000000e001', date '2026-08-20',
    pg_temp.deux('c0000000-0000-4000-8000-00000000f001', 100,
                 'c0000000-0000-4000-8000-00000000f002', 100));
  perform pg_temp.noter('LOCK-01', 'un repas NON consommé se valide', (
    select consumed_meal_id is null from public.planned_meals where id = v_pm));

  -- Et se REvalide, autant de fois qu'il le faut : poulet → saumon.
  perform public.enregistrer_repas_planifie(
    'c0000000-0000-4000-8000-00000000e001', date '2026-08-20',
    pg_temp.deux('c0000000-0000-4000-8000-00000000f003', 210,
                 'c0000000-0000-4000-8000-00000000f002', 180));
  perform pg_temp.noter('LOCK-01', 'et se REvalide tant qu''il n''est pas consommé', (
    select quantity = 210 from public.planned_meal_items
     where planned_meal_id = v_pm and catalog_food_id = 'c0000000-0000-4000-8000-00000000f003'));
  perform pg_temp.noter('LOCK-01', 'toujours deux items, aucun doublon', (
    select count(*) = 2 from public.planned_meal_items where planned_meal_id = v_pm));

  -- LOCK-08 — et l'enregistrer APRÈS validation fonctionne encore.
  perform pg_temp.noter('LOCK-08', 'enregistrer APRÈS validation crée bien la consommation', (
    (public.enregistrer_repas_structure_consomme(
       'c0000000-0000-4000-8000-00000000e001', date '2026-08-20',
       pg_temp.deux('c0000000-0000-4000-8000-00000000f003', 210,
                    'c0000000-0000-4000-8000-00000000f002', 180))->>'entrees_creees')::int = 2));
  perform pg_temp.noter('LOCK-08', 'et il pose consumed_meal_id sur le MÊME planned_meal', (
    select consumed_meal_id is not null from public.planned_meals where id = v_pm));
  perform pg_temp.noter('LOCK-08', 'sans dupliquer le planifié', (
    select count(*) = 1 from public.planned_meals
     where student_id = 'c0000000-0000-4000-8000-000000005001'
       and planned_on = date '2026-08-20'
       and meal_id = 'c0000000-0000-4000-8000-00000000e001'));
end $$;

-- ---------------------------------------------------------------------
-- LOCK-10 — AUCUNE AUTRE RPC N'A ÉTÉ TOUCHÉE
-- ⚠️ MESURÉ SUR LA DÉFINITION EN BASE, pas sur le fichier de migration : ce
-- qui compte est ce qui tourne, pas ce qu'on croit avoir écrit.
-- ---------------------------------------------------------------------
do $$
declare v_nom text;
begin
  for v_nom in select unnest(array['ouvrir_repas_prescrit', 'ajouter_aliment_catalogue',
                                   'ajouter_aliment_produit', 'ajouter_aliment_manuel',
                                   'modifier_quantite_entree', 'supprimer_entree',
                                   'save_nutrition_plan_v2', 'creer_repas_eleve'])
  loop
    perform pg_temp.noter('LOCK-10', format('%s ne connaît pas REPAS_DEJA_CONSOMME', v_nom), (
      select bool_and(pg_get_functiondef(p.oid) not like '%REPAS_DEJA_CONSOMME%')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_nom));
  end loop;

  -- Et le verrou n'existe QUE dans la fonction qui doit le porter.
  perform pg_temp.noter('LOCK-10', 'le verrou vit dans enregistrer_repas_planifie, et là seulement', (
    -- ⚠️ `prokind = 'f'` : `pg_get_functiondef` REFUSE les agrégats et les
    -- fonctions de fenêtrage, et l'oublier fait échouer la requête entière au
    -- premier `array_agg` rencontré — pas le contrôle, la requête.
    -- ⚠️ ON CHERCHE LE `raise`, PAS LE MOT. `enregistrer_repas_structure_consomme`
    -- EXPLIQUE en commentaire pourquoi l'ordre a changé, et cite donc le nom de
    -- l'erreur : chercher la chaîne nue compterait cette prose comme un second
    -- verrou. Même leçon que partout dans ce dépôt — on cherche du code.
    select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', ' ', 'g')
             like '%raise exception ''REPAS_DEJA_CONSOMME''%'));
end $$;

reset role;

-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_rouges int;
begin
  select count(*), count(*) filter (where ok is not true) into v_total, v_rouges from _faits;
  raise notice '';
  raise notice 'COURSES C0 · VALIDER MES CHOIX — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

do $$
declare v_restes int;
begin
  select (select count(*) from public.students          where id::text like 'c0000000%')
       + (select count(*) from public.food_catalog      where id::text like 'c0000000%')
       + (select count(*) from public.food_products     where id::text like 'c0000000%')
       + (select count(*) from public.nutrition_plans   where id::text like 'c0000000%')
       + (select count(*) from public.planned_meals     where student_id::text like 'c0000000%')
    into v_restes;
  if v_restes > 0 then
    raise exception 'Z · ÉCHEC : % ligne(s) de test ont survécu au rollback', v_restes;
  end if;
  raise notice 'OK      — Z · aucune donnée de test ne subsiste (vérifié, pas supposé)';
end $$;
