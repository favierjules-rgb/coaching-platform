-- ============================================================================
-- Checklist PostgreSQL — COURSES C2 : LA LISTE DE COURSES PERSISTANTE.
--
-- POURQUOI CE FICHIER EXISTE.
-- C2 introduit deux tables, deux RPC, six policies et un GRANT DE COLONNE. La
-- suite Node `test:liste-de-courses-c2` mesure le TypeScript et lit le texte de
-- la migration ; elle ne peut rien dire de ce que PostgreSQL fait vraiment —
-- ni d'un refus de policy, ni d'un `permission denied for column`, ni d'une
-- transaction qui se déroule à moitié. Ces garanties-là ne se lisent pas, elles
-- s'exécutent.
--
-- CE QU'ELLE VÉRIFIE
--   A   les deux tables, leurs contraintes, et les deux index PARTIELS qui
--       traduisent la clé d'agrégation C1 (identité + UNITÉ)
--   B   `checked` : persistance, survie au changement de quantité, remise à
--       zéro d'une ligne revenue, étanchéité entre élèves
--   C   MANUAL : survit à la régénération, sans identité, ajout/édition/
--       suppression, et l'impossibilité de basculer MANUAL ⇄ PLAN
--   D   PLAN : label/quantity/unit/identités inécrivables, suppression
--       impossible, la RPC seule synchronise
--   E   `regenerer_liste_de_courses` : droits, ownership serveur, atomicité,
--       idempotence, réconciliation, refus d'une identité non planifiée
--   F   `updated_at` ne ment pas : figée si rien ne bouge, avancée sinon
--   G   isolation : deux élèves, deux périodes, quatre listes indépendantes
--   H   non-régression : ni planned_meals, ni consumed_meals, ni
--       nutrition_plans.shopping_list, ni food_lists ne sont touchés
--   Z   après le ROLLBACK, aucune donnée de test ne subsiste
--
-- ⚠️ NE JAMAIS exécuter sur la Production.
--
-- ⚠️ AUCUN ACCÈS RÉSEAU, AUCUN ÉTAT PRÉEXISTANT. Le banc fabrique ses propres
-- élèves, son propre plan et ses propres repas planifiés, et les emporte au
-- `rollback`. Il s'exécute tel quel sur une base reconstruite de zéro.
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

-- ⚠️ LE `exception` OUVRE UNE SOUS-TRANSACTION, et c'est exactement ce qu'on
-- veut : les écritures d'une RPC refusée sont défaites jusqu'au point de
-- sauvegarde, comme elles le seraient en production. C'est ce qui rend le
-- contrôle d'ATOMICITÉ (E) mesurable sans quitter la transaction du banc.
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

-- La version physique d'une ligne. ⚠️ `now()` EST FIGÉE DANS UNE TRANSACTION :
-- deux écritures successives portent le même horodatage, et comparer les dates
-- ne dirait donc PAS si l'écriture a eu lieu. Le `ctid` change à chaque nouvelle
-- version de tuple : il répond à la seule question qui compte en F — « la ligne
-- a-t-elle été RÉÉCRITE, oui ou non ».
-- L'ensemble des versions physiques des lignes d'une liste.
--
-- ⚠️ NI `now()` NI `xmin` NE RÉPONDENT ICI. `now()` est figée pour toute la
-- transaction : deux écritures successives portent le même horodatage. Et
-- `xmin` vaut le même identifiant de transaction pour TOUT ce que ce banc a
-- écrit, puisque tout se passe dans une seule transaction. Le `ctid` change en
-- revanche à chaque nouvelle version de tuple : il répond à la seule question
-- qui compte — « ces lignes ont-elles été RÉÉCRITES, oui ou non ».
create or replace function pg_temp.versions_lignes(p_liste uuid)
returns text language sql stable as $$
  select coalesce(string_agg(t, ',' order by t), '')
    from (select ctid::text as t from public.shopping_list_items where list_id = p_liste) x;
$$;

do $$
declare s text;
begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant execute on all functions in schema %I to authenticated, anon', s);
end $$;


-- =====================================================================
-- A — LES TABLES, LES CONTRAINTES, LES INDEX
-- =====================================================================
do $$
begin
  perform pg_temp.noter('A-01', 'shopping_lists et shopping_list_items existent', (
    select count(*) = 2 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname in ('shopping_lists', 'shopping_list_items')));

  perform pg_temp.noter('A-02', 'la RLS est ACTIVE sur les deux', (
    select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('shopping_lists', 'shopping_list_items')));

  -- ⚠️ DEUX INDEX PARTIELS, PAS UN INDEX UNIQUE ORDINAIRE. En SQL, NULL n'est
  -- jamais égal à NULL : un `unique (list_id, catalog_food_id, product_id, unit)`
  -- laisserait passer autant de doublons qu'on voudrait sur les lignes produit,
  -- sans la moindre erreur. C'est la même décision qu'en A5 (`food_favorites`).
  perform pg_temp.noter('A-03', 'unicité PLAN : deux index PARTIELS, portant l''UNITÉ', (
    select count(*) = 2 from pg_indexes
     where schemaname = 'public' and tablename = 'shopping_list_items'
       and indexname in ('shopping_list_items_plan_food_unique',
                         'shopping_list_items_plan_product_unique')
       and indexdef ilike '%unique%'
       and indexdef ilike '%unit%'
       and indexdef ilike '%where%source%plan%'));

  -- La FK COMPOSITE : une ligne ne peut pas prétendre appartenir à l'élève A
  -- tout en pointant la liste de l'élève B.
  perform pg_temp.noter('A-04', 'la FK composite lie (list_id, student_id) au parent', (
    select count(*) = 1 from pg_constraint
     where conname = 'shopping_list_items_same_student' and contype = 'f'
       and conrelid = 'public.shopping_list_items'::regclass
       and confrelid = 'public.shopping_lists'::regclass));

  perform pg_temp.noter('A-05', 'les contraintes de contrat sont toutes présentes', (
    select count(*) = 7 from pg_constraint
     where contype = 'c'
       and conname in ('shopping_lists_periode_check', 'shopping_lists_duree_check',
                       'shopping_list_items_source_check', 'shopping_list_items_unit_check',
                       'shopping_list_items_quantity_check', 'shopping_list_items_plan_check',
                       'shopping_list_items_manual_check')));

  -- ⚠️ LE PRIVILÈGE, PAS LA POLICY. Une policy dit quelles LIGNES ; seul un
  -- privilège dit quelles COLONNES. C'est lui, et lui seul, qui rend §12
  -- infranchissable.
  perform pg_temp.noter('A-06', 'authenticated n''a UPDATE que sur la colonne `checked`', (
    select array_agg(column_name::text order by column_name::text) = array['checked']
      from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'shopping_list_items'
       and grantee = 'authenticated' and privilege_type = 'UPDATE'));

  perform pg_temp.noter('A-07', 'authenticated n''a AUCUN droit d''écriture sur shopping_lists', (
    select count(*) = 0 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'shopping_lists'
       and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')));

  perform pg_temp.noter('A-08', 'anon n''a AUCUN droit sur les deux tables', (
    select count(*) = 0 from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon'
       and table_name in ('shopping_lists', 'shopping_list_items')));
end $$;


-- ---------------------------------------------------------------------
-- LE BANC — deux élèves, un plan assigné chacun, trois jours planifiés
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c2000000-0000-4000-8000-0000000000e1', 'c2-eleve@test.invalid'),
  ('c2000000-0000-4000-8000-0000000000e2', 'c2-autre@test.invalid');
insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('c2000000-0000-4000-8000-0000000000e1', 'student', 'C2', 'Eleve', 'c2-eleve@test.invalid'),
  ('c2000000-0000-4000-8000-0000000000e2', 'student', 'C2', 'Autre', 'c2-autre@test.invalid');
insert into public.students (id, user_id, first_name, last_name, email, status) values
  ('c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-0000000000e1', 'C2', 'Eleve', 'c2-eleve@test.invalid', 'active'),
  ('c2000000-0000-4000-8000-000000005002', 'c2000000-0000-4000-8000-0000000000e2', 'C2', 'Autre', 'c2-autre@test.invalid', 'active');

insert into public.food_catalog (id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, status) values
  ('c2000000-0000-4000-8000-00000000f001', 'C2 Poulet', 'g', 31, 0, 3.6, 'active'),
  ('c2000000-0000-4000-8000-00000000f002', 'C2 Riz',    'g', 2.7, 28, 0.3, 'active'),
  ('c2000000-0000-4000-8000-00000000f003', 'C2 Jamais planifié', 'g', 10, 10, 10, 'active');

-- ⚠️ UN PRODUIT EST INDISPENSABLE ICI. Une ligne produit a `catalog_food_id`
-- NULL des deux côtés de la comparaison de réconciliation : c'est précisément
-- le cas qu'un `=` traiterait mal, et qu'aucun aliment du catalogue ne révèle.
insert into public.food_products (id, gtin, product_name, brand, nutrition_unit,
                                  protein_per_100, carb_per_100, fat_per_100,
                                  source, source_version, source_fetched_at)
values ('c2000000-0000-4000-8000-00000000f101', '3000000000024', 'C2 Skyr', 'MarqueC2', 'g',
        10, 4, 0.2, 'open_food_facts', 'v3.4', now());

insert into public.nutrition_plans (id, name, status, nutrition_model_version, student_id) values
  ('c2000000-0000-4000-8000-00000000b001', 'Plan C2 A', 'actif', 2, 'c2000000-0000-4000-8000-000000005001'),
  ('c2000000-0000-4000-8000-00000000b002', 'Plan C2 B', 'actif', 2, 'c2000000-0000-4000-8000-000000005002');
insert into public.nutrition_plan_profiles (plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp) values
  ('c2000000-0000-4000-8000-00000000b001', 'default', 2000, 3000, 4000, 3000),
  ('c2000000-0000-4000-8000-00000000b002', 'default', 2000, 3000, 4000, 3000);
insert into public.nutrition_days (id, plan_id, day, status, profile_key) values
  ('c2000000-0000-4000-8000-00000000d001', 'c2000000-0000-4000-8000-00000000b001', 'monday', 'non-commence', 'default'),
  ('c2000000-0000-4000-8000-00000000d002', 'c2000000-0000-4000-8000-00000000b002', 'monday', 'non-commence', 'default');
insert into public.meals (id, nutrition_day_id, slot, name, items, macros, coach_notes) values
  ('c2000000-0000-4000-8000-00000000e001', 'c2000000-0000-4000-8000-00000000d001', 'lunch', 'Déjeuner A', '[]', '{}', ''),
  ('c2000000-0000-4000-8000-00000000e002', 'c2000000-0000-4000-8000-00000000d002', 'lunch', 'Déjeuner B', '[]', '{}', '');

-- QUATRE occurrences sur le repas de A : `planned_meal_items` impose UN choix
-- par occurrence, donc quatre aliments dans un repas demandent quatre
-- occurrences — c'est aussi la forme réelle d'un repas guidé.
insert into public.meal_choice_slots (id, meal_id, position, label) values
  ('c2000000-0000-4000-8000-00000000a501', 'c2000000-0000-4000-8000-00000000e001', 1, 'Ta protéine'),
  ('c2000000-0000-4000-8000-00000000a502', 'c2000000-0000-4000-8000-00000000e001', 2, 'Ton féculent'),
  ('c2000000-0000-4000-8000-00000000a503', 'c2000000-0000-4000-8000-00000000e001', 3, 'Ton produit'),
  ('c2000000-0000-4000-8000-00000000a504', 'c2000000-0000-4000-8000-00000000e001', 4, 'Ton extra'),
  ('c2000000-0000-4000-8000-00000000a505', 'c2000000-0000-4000-8000-00000000e002', 1, 'Ta protéine B');
insert into public.meal_choice_options (slot_id, position, catalog_food_id) values
  ('c2000000-0000-4000-8000-00000000a501', 1, 'c2000000-0000-4000-8000-00000000f001'),
  ('c2000000-0000-4000-8000-00000000a502', 1, 'c2000000-0000-4000-8000-00000000f002'),
  ('c2000000-0000-4000-8000-00000000a504', 1, 'c2000000-0000-4000-8000-00000000f001'),
  ('c2000000-0000-4000-8000-00000000a505', 1, 'c2000000-0000-4000-8000-00000000f003');
insert into public.meal_choice_options (slot_id, position, product_id) values
  ('c2000000-0000-4000-8000-00000000a503', 1, 'c2000000-0000-4000-8000-00000000f101');

-- Les repas planifiés de A : 2026-03-02, 03, 04.
insert into public.planned_meals (id, student_id, planned_on, meal_id, slot_key, label) values
  ('c2000000-0000-4000-8000-00000000c101', 'c2000000-0000-4000-8000-000000005001', date '2026-03-02', 'c2000000-0000-4000-8000-00000000e001', 'lunch', 'Déjeuner A'),
  ('c2000000-0000-4000-8000-00000000c102', 'c2000000-0000-4000-8000-000000005001', date '2026-03-03', 'c2000000-0000-4000-8000-00000000e001', 'lunch', 'Déjeuner A'),
  ('c2000000-0000-4000-8000-00000000c103', 'c2000000-0000-4000-8000-000000005001', date '2026-03-04', 'c2000000-0000-4000-8000-00000000e001', 'lunch', 'Déjeuner A'),
  ('c2000000-0000-4000-8000-00000000c201', 'c2000000-0000-4000-8000-000000005002', date '2026-03-02', 'c2000000-0000-4000-8000-00000000e002', 'lunch', 'Déjeuner B');

-- ⚠️ LE MÊME ALIMENT EN DEUX UNITÉS — c'est le cœur de la règle C1. `f001` est
-- planifié en `g` ET en `piece` : la liste doit porter DEUX lignes, parce que
-- les additionner exigerait une conversion que personne n'a le droit de décider.
insert into public.planned_meal_items
  (planned_meal_id, student_id, choice_slot_id, position, catalog_food_id, product_id, quantity, unit)
values
  ('c2000000-0000-4000-8000-00000000c101', 'c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-00000000a501', 1, 'c2000000-0000-4000-8000-00000000f001', null, 100, 'g'),
  ('c2000000-0000-4000-8000-00000000c102', 'c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-00000000a501', 1, 'c2000000-0000-4000-8000-00000000f001', null, 100, 'g'),
  ('c2000000-0000-4000-8000-00000000c103', 'c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-00000000a501', 1, 'c2000000-0000-4000-8000-00000000f001', null, 100, 'g'),
  ('c2000000-0000-4000-8000-00000000c101', 'c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-00000000a502', 2, 'c2000000-0000-4000-8000-00000000f002', null, 1, 'piece'),
  ('c2000000-0000-4000-8000-00000000c101', 'c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-00000000a503', 3, null, 'c2000000-0000-4000-8000-00000000f101', 30, 'g'),
  ('c2000000-0000-4000-8000-00000000c102', 'c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-00000000a503', 3, null, 'c2000000-0000-4000-8000-00000000f101', 30, 'g'),
  ('c2000000-0000-4000-8000-00000000c103', 'c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-00000000a504', 4, 'c2000000-0000-4000-8000-00000000f001', null, 2, 'piece'),
  ('c2000000-0000-4000-8000-00000000c201', 'c2000000-0000-4000-8000-000000005002', 'c2000000-0000-4000-8000-00000000a505', 1, 'c2000000-0000-4000-8000-00000000f003', null, 50, 'g');

-- L'agrégation C1 de la période 02→04, telle que `agregerListeDeCourses` la rend.
create or replace function pg_temp.lignes_a()
returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f001', 'product_id', null, 'quantity', 300, 'unit', 'g'),
    jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f002', 'product_id', null, 'quantity', 1,   'unit', 'piece'),
    jsonb_build_object('catalog_food_id', null, 'product_id', 'c2000000-0000-4000-8000-00000000f101', 'quantity', 60, 'unit', 'g'),
    jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f001', 'product_id', null, 'quantity', 2,   'unit', 'piece'));
$$;

-- La même, un aliment en moins (`f002` a quitté le plan) et une quantité corrigée.
create or replace function pg_temp.lignes_a_reduites()
returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f001', 'product_id', null, 'quantity', 400, 'unit', 'g'),
    jsonb_build_object('catalog_food_id', null, 'product_id', 'c2000000-0000-4000-8000-00000000f101', 'quantity', 60, 'unit', 'g'),
    jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f001', 'product_id', null, 'quantity', 2,   'unit', 'piece'));
$$;


-- =====================================================================
-- A (suite) — LES CONTRAINTES REFUSENT, MESURÉ PLUTÔT QUE SUPPOSÉ
-- =====================================================================
-- ⚠️ CES CONTRÔLES SE FONT EN PROPRIÉTAIRE, AVANT DE PRENDRE LE RÔLE CLIENT.
-- Sous `authenticated`, la RLS refuserait AVANT la contrainte, et le banc
-- prouverait la policy en croyant prouver le CHECK.
insert into public.shopping_lists (id, student_id, starts_on, ends_on) values
  ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', date '2026-02-02', date '2026-02-04');

do $$
begin
  perform pg_temp.noter('A-09', 'période à l''envers refusée (starts_on > ends_on)',
    pg_temp.refuse_pour($q$insert into public.shopping_lists (student_id, starts_on, ends_on)
      values ('c2000000-0000-4000-8000-000000005001', date '2026-02-10', date '2026-02-08')$q$,
      'shopping_lists_periode_check'));

  perform pg_temp.noter('A-10', 'période de plus de 7 jours refusée',
    pg_temp.refuse_pour($q$insert into public.shopping_lists (student_id, starts_on, ends_on)
      values ('c2000000-0000-4000-8000-000000005001', date '2026-02-10', date '2026-02-20')$q$,
      'shopping_lists_duree_check'));

  perform pg_temp.noter('A-11', 'deux listes pour (élève, mêmes dates) refusées',
    pg_temp.refuse_pour($q$insert into public.shopping_lists (student_id, starts_on, ends_on)
      values ('c2000000-0000-4000-8000-000000005001', date '2026-02-02', date '2026-02-04')$q$,
      'shopping_lists_unique'));

  perform pg_temp.noter('A-12', 'une source hors (plan, manual) refusée',
    pg_temp.refuse_pour($q$insert into public.shopping_list_items (list_id, student_id, source, label)
      values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'auto', 'x')$q$,
      'shopping_list_items_source_check'));

  -- IDENTITÉ XOR : zéro cible et deux cibles sont refusées par le MÊME test.
  perform pg_temp.noter('A-13', 'ligne PLAN sans aucune identité refusée',
    pg_temp.refuse_pour($q$insert into public.shopping_list_items (list_id, student_id, source, quantity, unit)
      values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'plan', 100, 'g')$q$,
      'shopping_list_items_plan_check'));

  perform pg_temp.noter('A-14', 'ligne PLAN à DEUX identités refusée',
    pg_temp.refuse_pour($q$insert into public.shopping_list_items (list_id, student_id, source, catalog_food_id, product_id, quantity, unit)
      values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'plan',
              'c2000000-0000-4000-8000-00000000f001', 'c2000000-0000-4000-8000-00000000f101', 100, 'g')$q$,
      'shopping_list_items_plan_check'));

  perform pg_temp.noter('A-15', 'ligne PLAN sans quantité refusée',
    pg_temp.refuse_pour($q$insert into public.shopping_list_items (list_id, student_id, source, catalog_food_id, unit)
      values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'plan',
              'c2000000-0000-4000-8000-00000000f001', 'g')$q$,
      'shopping_list_items_plan_check'));

  perform pg_temp.noter('A-16', 'quantité nulle ou négative refusée',
    pg_temp.refuse_pour($q$insert into public.shopping_list_items (list_id, student_id, source, catalog_food_id, quantity, unit)
      values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'plan',
              'c2000000-0000-4000-8000-00000000f001', 0, 'g')$q$,
      'shopping_list_items_quantity_check'));

  -- ⚠️ `kg` EST UN REFUS, PAS UNE CONVERSION. Aucune heuristique n'a le droit
  -- de transformer 1 kg en 1000 g : la base dit non, et l'écran le montre.
  perform pg_temp.noter('A-17', 'unité hors (g, ml, piece) refusée — aucune conversion',
    pg_temp.refuse_pour($q$insert into public.shopping_list_items (list_id, student_id, source, catalog_food_id, quantity, unit)
      values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'plan',
              'c2000000-0000-4000-8000-00000000f001', 1, 'kg')$q$,
      'shopping_list_items_unit_check'));

  perform pg_temp.noter('A-18', 'article MANUEL portant une identité refusé',
    pg_temp.refuse_pour($q$insert into public.shopping_list_items (list_id, student_id, source, label, catalog_food_id)
      values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'manual', 'Triche',
              'c2000000-0000-4000-8000-00000000f001')$q$,
      'shopping_list_items_manual_check'));

  perform pg_temp.noter('A-19', 'article MANUEL sans libellé refusé',
    pg_temp.refuse_pour($q$insert into public.shopping_list_items (list_id, student_id, source, label)
      values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'manual', '   ')$q$,
      'shopping_list_items_manual_check'));

  perform pg_temp.noter('A-20', 'ligne PLAN portant un libellé refusée (le nom est HYDRATÉ)',
    pg_temp.refuse_pour($q$insert into public.shopping_list_items (list_id, student_id, source, catalog_food_id, quantity, unit, label)
      values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'plan',
              'c2000000-0000-4000-8000-00000000f001', 100, 'g', 'Poulet figé')$q$,
      'shopping_list_items_plan_check'));

  -- ABSENCE DE DOUBLON PLAN, éprouvée sur la vraie table.
  insert into public.shopping_list_items (list_id, student_id, source, catalog_food_id, quantity, unit)
  values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'plan',
          'c2000000-0000-4000-8000-00000000f001', 100, 'g');

  perform pg_temp.noter('A-21', 'doublon PLAN (même identité, même unité) refusé',
    pg_temp.refuse_pour($q$insert into public.shopping_list_items (list_id, student_id, source, catalog_food_id, quantity, unit)
      values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'plan',
              'c2000000-0000-4000-8000-00000000f001', 200, 'g')$q$,
      'shopping_list_items_plan_food_unique'));

  -- ⚠️ ET LA MÊME IDENTITÉ DANS UNE AUTRE UNITÉ EST ACCEPTÉE. C'est l'autre
  -- moitié de la règle : deux unités font deux lignes, jamais une somme.
  insert into public.shopping_list_items (list_id, student_id, source, catalog_food_id, quantity, unit)
  values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'plan',
          'c2000000-0000-4000-8000-00000000f001', 2, 'piece');
  perform pg_temp.noter('A-22', 'même identité, AUTRE unité : deux lignes acceptées', (
    select count(*) = 2 from public.shopping_list_items
     where list_id = 'c2000000-0000-4000-8000-000000009001'
       and catalog_food_id = 'c2000000-0000-4000-8000-00000000f001'));

  -- Le doublon PRODUIT — celui que NULL ≠ NULL laisserait passer.
  insert into public.shopping_list_items (list_id, student_id, source, product_id, quantity, unit)
  values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'plan',
          'c2000000-0000-4000-8000-00000000f101', 30, 'g');
  perform pg_temp.noter('A-23', 'doublon PRODUIT refusé (le cas que NULL ≠ NULL masquerait)',
    pg_temp.refuse_pour($q$insert into public.shopping_list_items (list_id, student_id, source, product_id, quantity, unit)
      values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005001', 'plan',
              'c2000000-0000-4000-8000-00000000f101', 60, 'g')$q$,
      'shopping_list_items_plan_product_unique'));

  -- Une ligne ne peut pas changer de propriétaire au passage.
  perform pg_temp.noter('A-24', 'une ligne ne peut pas pointer la liste d''un autre élève',
    pg_temp.refuse_pour($q$insert into public.shopping_list_items (list_id, student_id, source, label)
      values ('c2000000-0000-4000-8000-000000009001', 'c2000000-0000-4000-8000-000000005002', 'manual', 'Vol')$q$,
      'shopping_list_items_same_student'));
end $$;

-- On repart d'une table propre pour la suite : la liste de structure a joué son rôle.
delete from public.shopping_lists where id = 'c2000000-0000-4000-8000-000000009001';


-- =====================================================================
-- E — LA RPC : DROITS, OWNERSHIP, RÉCONCILIATION, ATOMICITÉ, IDEMPOTENCE
-- =====================================================================
do $$
begin
  perform pg_temp.noter('E-01', 'regenerer_liste_de_courses est security definer', (
    select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'regenerer_liste_de_courses'));

  perform pg_temp.noter('E-02', 'son search_path est figé à public', (
    select 'search_path=public' = any (p.proconfig) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'regenerer_liste_de_courses'));

  perform pg_temp.noter('E-03', 'anon n''a PAS le droit de l''exécuter', (
    select not has_function_privilege('anon', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'regenerer_liste_de_courses'));

  perform pg_temp.noter('E-04', 'authenticated a le droit de l''exécuter', (
    select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'regenerer_liste_de_courses'));

  -- ⚠️ SA SIGNATURE N'ACCEPTE AUCUN `student_id`. L'élève vient du JWT, jamais
  -- d'un paramètre : c'est ce qui rend l'usurpation structurellement impossible.
  perform pg_temp.noter('E-05', 'sa signature n''accepte AUCUN identifiant d''élève', (
    select pg_get_function_arguments(p.oid) = 'p_starts_on date, p_ends_on date, p_lignes jsonb'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'regenerer_liste_de_courses'));

  perform pg_temp.noter('E-06', 'modifier_article_manuel : definer, search_path, anon revoked', (
    select p.prosecdef and 'search_path=public' = any (p.proconfig)
       and not has_function_privilege('anon', p.oid, 'execute')
       and has_function_privilege('authenticated', p.oid, 'execute')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'modifier_article_manuel'));

  -- ⚠️ LA RPC N'AGRÈGE RIEN ET NE CONVERTIT RIEN. On cherche du CODE, pas de la
  -- prose : les commentaires de la migration EXPLIQUENT qu'aucune conversion
  -- n'a lieu, et les compter reviendrait à mesurer une bonne intention.
  perform pg_temp.noter('E-07', 'la RPC ne contient ni somme ni facteur de conversion', (
    select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', ' ', 'g') !~* '(sum\(|\* *1000|/ *1000)'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'regenerer_liste_de_courses'));

  -- ⚠️ ELLE COMPARE AVEC `is not distinct from`, JAMAIS AVEC `=`. Trois
  -- réconciliations × deux colonnes d'identité = six comparaisons. Avec `=`,
  -- toutes les lignes produit seraient détruites et recréées à chaque
  -- régénération, en perdant leur case cochée et sans la moindre erreur.
  perform pg_temp.noter('E-08', 'la réconciliation compare avec `is not distinct from` (× 6)', (
    select (length(regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', ' ', 'g'))
          - length(replace(regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', ' ', 'g'),
                           'is not distinct from', ''))) / length('is not distinct from') = 6
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'regenerer_liste_de_courses'));
end $$;

set local role authenticated;
select pg_temp.connecte('c2000000-0000-4000-8000-0000000000e1');

do $$
declare v_liste uuid; v_bis uuid;
begin
  v_liste := public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04', pg_temp.lignes_a());
  perform set_config('c2.liste', v_liste::text, true);

  perform pg_temp.noter('E-09', 'la liste est créée pour la période demandée', (
    select starts_on = date '2026-03-02' and ends_on = date '2026-03-04'
      from public.shopping_lists where id = v_liste));

  -- ⚠️ OWNERSHIP SERVEUR : l'élève vient de `current_student_id()`, jamais du
  -- client. Aucun paramètre ne permet d'écrire chez quelqu'un d'autre.
  perform pg_temp.noter('E-10', 'elle appartient à l''élève du JWT, pas à un paramètre', (
    select student_id = 'c2000000-0000-4000-8000-000000005001'
      from public.shopping_lists where id = v_liste));

  perform pg_temp.noter('E-11', 'quatre lignes PLAN, toutes NON cochées', (
    select count(*) = 4 and bool_and(checked = false)
      from public.shopping_list_items where list_id = v_liste and source = 'plan'));

  -- La clé d'agrégation C1, vérifiée sur les données et pas sur le texte.
  perform pg_temp.noter('E-12', 'le même aliment en g et en piece fait DEUX lignes', (
    select count(*) = 2 from public.shopping_list_items
     where list_id = v_liste and catalog_food_id = 'c2000000-0000-4000-8000-00000000f001'));

  perform pg_temp.noter('E-13', 'la ligne PRODUIT existe, avec son unité', (
    select count(*) = 1 from public.shopping_list_items
     where list_id = v_liste and product_id = 'c2000000-0000-4000-8000-00000000f101' and unit = 'g'));

  -- IDEMPOTENCE — « crée OU rouvre », et rien de plus.
  v_bis := public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04', pg_temp.lignes_a());
  perform pg_temp.noter('E-14', 'un second appel ROUVRE la même liste', v_bis = v_liste);
  perform pg_temp.noter('E-15', 'et ne duplique aucune ligne (4, pas 8)', (
    select count(*) = 4 from public.shopping_list_items where list_id = v_liste and source = 'plan'));
  perform pg_temp.noter('E-16', 'une seule liste existe pour cet élève sur cette période', (
    select count(*) = 1 from public.shopping_lists
     where student_id = 'c2000000-0000-4000-8000-000000005001'
       and starts_on = date '2026-03-02' and ends_on = date '2026-03-04'));
end $$;

-- LES REFUS, ET CE QU'ILS NE LAISSENT PAS DERRIÈRE EUX
do $$
declare v_lignes_avant int; v_listes_avant int;
begin
  select count(*) into v_lignes_avant from public.shopping_list_items;
  select count(*) into v_listes_avant from public.shopping_lists;

  perform pg_temp.noter('E-17', 'une identité JAMAIS planifiée est refusée',
    pg_temp.refuse_pour($q$select public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04',
      jsonb_build_array(jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f003',
                                           'product_id', null, 'quantity', 50, 'unit', 'g')))$q$,
      'LIGNE_HORS_PLANIFICATION'));

  -- ⚠️ `f001` EST PLANIFIÉ EN g ET EN piece, JAMAIS EN ml. L'unité fait partie
  -- de l'appartenance : sans cela, une unité inventée passerait le contrôle.
  perform pg_temp.noter('E-18', 'une UNITÉ jamais planifiée pour cette identité est refusée',
    pg_temp.refuse_pour($q$select public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04',
      jsonb_build_array(jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f001',
                                           'product_id', null, 'quantity', 50, 'unit', 'ml')))$q$,
      'LIGNE_HORS_PLANIFICATION'));

  perform pg_temp.noter('E-19', 'un doublon (identité, unité) dans la charge utile est refusé',
    pg_temp.refuse_pour($q$select public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04',
      jsonb_build_array(
        jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f001', 'product_id', null, 'quantity', 100, 'unit', 'g'),
        jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f001', 'product_id', null, 'quantity', 200, 'unit', 'g')))$q$,
      'LIGNE_EN_DOUBLE'));

  perform pg_temp.noter('E-20', 'zéro identité refusée',
    pg_temp.refuse_pour($q$select public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04',
      jsonb_build_array(jsonb_build_object('catalog_food_id', null, 'product_id', null, 'quantity', 1, 'unit', 'g')))$q$,
      'IDENTITE_INVALIDE'));

  perform pg_temp.noter('E-21', 'quantité nulle refusée',
    pg_temp.refuse_pour($q$select public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04',
      jsonb_build_array(jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f001',
                                           'product_id', null, 'quantity', 0, 'unit', 'g')))$q$,
      'QUANTITE_INVALIDE'));

  perform pg_temp.noter('E-22', 'unité `kg` refusée — et surtout PAS convertie',
    pg_temp.refuse_pour($q$select public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04',
      jsonb_build_array(jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f001',
                                           'product_id', null, 'quantity', 1, 'unit', 'kg')))$q$,
      'UNITE_INVALIDE'));

  perform pg_temp.noter('E-23', 'période à l''envers refusée',
    pg_temp.refuse_pour($q$select public.regenerer_liste_de_courses(date '2026-03-04', date '2026-03-02', '[]'::jsonb)$q$,
      'PERIODE_INVALIDE'));

  perform pg_temp.noter('E-24', 'période de plus de 7 jours refusée',
    pg_temp.refuse_pour($q$select public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-12', '[]'::jsonb)$q$,
      'PERIODE_TROP_LONGUE'));

  -- ⚠️ ATOMICITÉ : LE REFUS ARRIVE AU SECOND ARTICLE. Le premier est valide, et
  -- ne doit RIEN laisser — ni ligne, ni liste pour cette période neuve.
  perform pg_temp.noter('E-25', 'un refus au 2e article n''écrit NI ligne NI liste',
    pg_temp.refuse_pour($q$select public.regenerer_liste_de_courses(date '2026-03-05', date '2026-03-06',
      jsonb_build_array(
        jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f001', 'product_id', null, 'quantity', 100, 'unit', 'g'),
        jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f003', 'product_id', null, 'quantity', 50, 'unit', 'g')))$q$,
      'LIGNE_HORS_PLANIFICATION'));

  perform pg_temp.noter('E-26', 'après ce refus, aucune liste pour la période neuve', (
    select count(*) = 0 from public.shopping_lists where starts_on = date '2026-03-05'));
  perform pg_temp.noter('E-27', 'et le nombre de lignes est strictement inchangé', (
    select count(*) = v_lignes_avant from public.shopping_list_items));
  perform pg_temp.noter('E-28', 'et le nombre de listes est strictement inchangé', (
    select count(*) = v_listes_avant from public.shopping_lists));
end $$;


-- =====================================================================
-- B — `checked` : CE QUE L'ÉLÈVE A COCHÉ LUI APPARTIENT
-- =====================================================================
do $$
declare v_liste uuid;
begin
  v_liste := current_setting('c2.liste')::uuid;

  update public.shopping_list_items set checked = true
   where list_id = v_liste and catalog_food_id = 'c2000000-0000-4000-8000-00000000f001' and unit = 'g';
  update public.shopping_list_items set checked = true
   where list_id = v_liste and product_id = 'c2000000-0000-4000-8000-00000000f101';

  perform pg_temp.noter('B-01', 'cocher est permis, et persiste', (
    select count(*) = 2 from public.shopping_list_items where list_id = v_liste and checked));

  -- RÉGÉNÉRATION AVEC CHANGEMENT RÉEL : `f002` disparaît, `f001/g` passe à 400.
  perform public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04', pg_temp.lignes_a_reduites());

  perform pg_temp.noter('B-02', 'quantité corrigée ET case cochée PRÉSERVÉE', (
    select quantity = 400 and checked from public.shopping_list_items
     where list_id = v_liste and catalog_food_id = 'c2000000-0000-4000-8000-00000000f001' and unit = 'g'));

  -- ⚠️ LE PIÈGE NULL ≠ NULL, MESURÉ SUR LA DONNÉE. Une ligne PRODUIT a
  -- `catalog_food_id` NULL des deux côtés : avec `=`, elle serait détruite puis
  -- recréée, et cette case serait revenue à false sans qu'aucune erreur ne le
  -- signale. C'est le contrôle le plus coûteux à perdre de tout ce fichier.
  perform pg_temp.noter('B-03', 'case cochée d''une ligne PRODUIT : survit à la régénération', (
    select checked from public.shopping_list_items
     where list_id = v_liste and product_id = 'c2000000-0000-4000-8000-00000000f101'));

  perform pg_temp.noter('B-04', 'la ligne disparue du plan est supprimée', (
    select count(*) = 0 from public.shopping_list_items
     where list_id = v_liste and catalog_food_id = 'c2000000-0000-4000-8000-00000000f002'));

  -- ⚠️ ET SI ELLE REVIENT, ELLE REPART NON COCHÉE — c'est le contraire de B-02,
  -- et les deux sont voulus. Garder la case d'une ligne qui avait disparu ferait
  -- croire à l'élève qu'il a déjà acheté un article qu'il n'a jamais vu revenir.
  perform public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04', pg_temp.lignes_a());
  perform pg_temp.noter('B-05', 'une ligne revenue dans le plan repart checked = false', (
    select checked = false from public.shopping_list_items
     where list_id = v_liste and catalog_food_id = 'c2000000-0000-4000-8000-00000000f002'));
  perform pg_temp.noter('B-06', 'et les cases des lignes restées, elles, tiennent toujours', (
    select count(*) = 2 from public.shopping_list_items where list_id = v_liste and checked));
end $$;


-- =====================================================================
-- C — LES ARTICLES MANUELS
-- =====================================================================
do $$
declare v_liste uuid; v_id uuid;
begin
  v_liste := current_setting('c2.liste')::uuid;

  -- ⚠️ AUCUNE IDENTITÉ NUTRITIONNELLE, ET C'EST LE POINT. « Papier toilette »
  -- n'est pas un aliment ; le chercher dans `food_catalog` serait le début d'un
  -- appariement que personne n'a demandé.
  insert into public.shopping_list_items (list_id, student_id, source, label, quantity, unit)
  values (v_liste, 'c2000000-0000-4000-8000-000000005001', 'manual', 'Sacs poubelle', 2, 'piece')
  returning id into v_id;
  perform set_config('c2.manuel', v_id::text, true);

  insert into public.shopping_list_items (list_id, student_id, source, label)
  values (v_liste, 'c2000000-0000-4000-8000-000000005001', 'manual', 'Éponges');

  perform pg_temp.noter('C-01', 'un article manuel s''ajoute, avec ou sans quantité', (
    select count(*) = 2 from public.shopping_list_items where list_id = v_liste and source = 'manual'));

  perform pg_temp.noter('C-02', 'il n''a NI aliment NI produit', (
    select bool_and(catalog_food_id is null and product_id is null)
      from public.shopping_list_items where list_id = v_liste and source = 'manual'));

  -- SURVIE À LA RÉGÉNÉRATION — la garantie centrale de §5.
  perform public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04', pg_temp.lignes_a_reduites());
  perform pg_temp.noter('C-03', 'les articles manuels SURVIVENT à la régénération', (
    select count(*) = 2 from public.shopping_list_items where list_id = v_liste and source = 'manual'));
  perform public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04', pg_temp.lignes_a());

  -- MODIFICATION, par la RPC dédiée.
  perform public.modifier_article_manuel(v_id, 'Sacs poubelle 50L', 3, 'piece');
  perform pg_temp.noter('C-04', 'un article manuel se modifie (libellé, quantité, unité)', (
    select label = 'Sacs poubelle 50L' and quantity = 3 and unit = 'piece'
      from public.shopping_list_items where id = v_id));

  perform pg_temp.noter('C-05', 'un libellé vide est refusé',
    pg_temp.refuse_pour(format('select public.modifier_article_manuel(%L, ''   '', null, null)', v_id),
      'LIBELLE_MANQUANT'));

  perform pg_temp.noter('C-06', 'une unité hors (g, ml, piece) est refusée — aucune déduction du nom',
    pg_temp.refuse_pour(format('select public.modifier_article_manuel(%L, ''Jus d''''orange'', 1, ''L'')', v_id),
      'UNITE_INVALIDE'));

  -- SUPPRESSION.
  delete from public.shopping_list_items where label = 'Éponges';
  perform pg_temp.noter('C-07', 'un article manuel se supprime', (
    select count(*) = 1 from public.shopping_list_items where list_id = v_liste and source = 'manual'));

  -- ⚠️ MANUAL → PLAN ET PLAN → MANUAL SONT IMPOSSIBLES DEPUIS LE CLIENT, et ce
  -- n'est pas une policy qui l'interdit : `source` n'est tout simplement pas
  -- dans le privilège d'`update`. Le refus arrive avant toute règle de ligne.
  perform pg_temp.noter('C-08', 'transformer un MANUEL en PLAN est impossible',
    pg_temp.refuse_pour(format('update public.shopping_list_items set source = ''plan'' where id = %L', v_id),
      'permission denied for'));
end $$;


-- =====================================================================
-- D — LES LIGNES PLAN NE SE MODIFIENT PAS
-- =====================================================================
do $$
declare v_liste uuid; v_id uuid; v_col text;
begin
  v_liste := current_setting('c2.liste')::uuid;
  select id into v_id from public.shopping_list_items
   where list_id = v_liste and source = 'plan' limit 1;

  -- ⚠️ SEPT COLONNES, UNE PAR UNE. Un test qui n'en éprouverait qu'une laisserait
  -- les six autres ouvertes le jour où le grant serait élargi par inadvertance.
  foreach v_col in array array['label', 'quantity', 'unit', 'catalog_food_id',
                               'product_id', 'list_id', 'student_id', 'source']
  loop
    perform pg_temp.noter('D-01', format('%s est INÉCRIVABLE sur une ligne PLAN', v_col),
      pg_temp.refuse_pour(format('update public.shopping_list_items set %I = null where id = %L', v_col, v_id),
        'permission denied for'));
  end loop;

  -- ⚠️ MAIS COCHER RESTE POSSIBLE. Sans ce contrôle, « tout est interdit »
  -- passerait pour un succès alors que l'écran serait inutilisable.
  update public.shopping_list_items set checked = not checked where id = v_id;
  perform pg_temp.noter('D-02', 'mais `checked` reste modifiable — l''écran fonctionne', true);
  update public.shopping_list_items set checked = not checked where id = v_id;

  -- SUPPRESSION DIRECTE : la policy `delete` ne voit pas les lignes PLAN. La
  -- requête « réussit » sans rien supprimer — d'où le comptage, et non l'absence
  -- d'erreur, comme critère.
  delete from public.shopping_list_items where list_id = v_liste and source = 'plan';
  perform pg_temp.noter('D-03', 'une ligne PLAN est INSUPPRIMABLE par l''élève', (
    select count(*) = 4 from public.shopping_list_items where list_id = v_liste and source = 'plan'));

  -- Et une ligne PLAN ne s'insère pas non plus depuis le client.
  perform pg_temp.noter('D-04', 'une ligne PLAN ne s''insère pas depuis le client',
    pg_temp.refuse_pour(format($q$insert into public.shopping_list_items
        (list_id, student_id, source, catalog_food_id, quantity, unit)
      values (%L, 'c2000000-0000-4000-8000-000000005001', 'plan',
              'c2000000-0000-4000-8000-00000000f003', 999, 'g')$q$, v_liste),
      'row-level security'));

  -- ⚠️ SEULE LA RPC SYNCHRONISE CES CHAMPS, et on le prouve : la quantité change
  -- alors qu'aucune écriture directe ne l'a pu.
  perform public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04', pg_temp.lignes_a_reduites());
  perform pg_temp.noter('D-05', 'seule la RPC fait bouger la quantité d''une ligne PLAN', (
    select quantity = 400 from public.shopping_list_items
     where list_id = v_liste and catalog_food_id = 'c2000000-0000-4000-8000-00000000f001' and unit = 'g'));
  perform public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04', pg_temp.lignes_a());
end $$;


-- =====================================================================
-- F — `updated_at` NE MENT PAS
-- =====================================================================
-- ⚠️ UNE DATE DE MODIFICATION QUI AVANCE SANS MODIFICATION EST UNE INFORMATION
-- FAUSSE : elle ferait croire à un changement, et rendrait impossible de savoir
-- quand la liste a réellement bougé pour la dernière fois.
--
-- ⚠️ `now()` EST FIGÉE DANS UNE TRANSACTION. Comparer deux `now()` ne prouverait
-- rien ici. On mesure donc DEUX choses indépendantes : le `ctid` (la ligne
-- a-t-elle été RÉÉCRITE) et une valeur ANTIDATÉE à la main (a-t-elle été
-- remplacée par l'horodatage courant).
reset role;
update public.shopping_lists set updated_at = timestamptz '2020-01-01 00:00:00Z'
 where id = current_setting('c2.liste')::uuid;
set local role authenticated;
select pg_temp.connecte('c2000000-0000-4000-8000-0000000000e1');

-- ⚠️ ON NE MESURE PAS LA RÉÉCRITURE DE LA LIGNE DE LISTE ELLE-MÊME, et il faut
-- dire pourquoi. La RPC obtient l'`id` par un `insert … on conflict … do update
-- set updated_at = shopping_lists.updated_at` : `do nothing` ne rendrait aucune
-- ligne, donc aucun `id`, et un `select` suivi d'un `insert` ouvrirait une
-- fenêtre entre les deux. Ce `do update` est une écriture qui n'écrit RIEN — la
-- valeur est recopiée sur elle-même — mais PostgreSQL produit malgré tout une
-- nouvelle version de tuple. Ce qui doit être stable, c'est donc la VALEUR de
-- `updated_at`, pas le `ctid` du parent. Les LIGNES D'ARTICLES, elles, ne
-- doivent pas bouger d'un octet, et c'est ce que F-01 mesure.
do $$
declare v_liste uuid; v_avant text; v_apres text;
begin
  v_liste := current_setting('c2.liste')::uuid;

  v_avant := pg_temp.versions_lignes(v_liste);
  perform public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04', pg_temp.lignes_a());
  v_apres := pg_temp.versions_lignes(v_liste);

  -- ⚠️ L'IDEMPOTENCE AU SENS FORT : « aucune écriture », et non « le même
  -- résultat après réécriture ». Un `delete` suivi d'un `insert` produirait le
  -- même contenu — en perdant toutes les cases cochées au passage.
  perform pg_temp.noter('F-01', 'régénération IDENTIQUE : aucune ligne d''article réécrite',
    v_avant = v_apres);

  perform pg_temp.noter('F-02', 'régénération IDENTIQUE : `updated_at` reste à sa valeur antidatée', (
    select updated_at = timestamptz '2020-01-01 00:00:00Z' from public.shopping_lists where id = v_liste));

  -- CHANGEMENT RÉEL.
  v_avant := pg_temp.versions_lignes(v_liste);
  perform public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04', pg_temp.lignes_a_reduites());
  v_apres := pg_temp.versions_lignes(v_liste);

  perform pg_temp.noter('F-03', 'changement RÉEL : les lignes concernées SONT réécrites',
    v_avant <> v_apres);
  perform pg_temp.noter('F-04', 'changement RÉEL : `updated_at` quitte la valeur antidatée', (
    select updated_at > timestamptz '2020-01-01 00:00:00Z' from public.shopping_lists where id = v_liste));

  perform public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-04', pg_temp.lignes_a());
end $$;


-- =====================================================================
-- G — L'ISOLATION : DEUX ÉLÈVES, DEUX PÉRIODES, QUATRE LISTES
-- =====================================================================
do $$
declare v_liste uuid; v_autre_periode uuid;
begin
  v_liste := current_setting('c2.liste')::uuid;

  -- Même élève, AUTRE période → autre liste.
  v_autre_periode := public.regenerer_liste_de_courses(date '2026-03-03', date '2026-03-04',
    jsonb_build_array(jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f001',
                                         'product_id', null, 'quantity', 200, 'unit', 'g')));
  perform pg_temp.noter('G-01', 'même élève, autre période : UNE AUTRE liste', v_autre_periode <> v_liste);
  perform pg_temp.noter('G-02', 'et les deux listes coexistent sans se mélanger', (
    select count(*) = 2 from public.shopping_lists
     where student_id = 'c2000000-0000-4000-8000-000000005001'));
  perform pg_temp.noter('G-03', 'chacune porte ses propres lignes', (
    select (select count(*) from public.shopping_list_items where list_id = v_autre_periode) = 1
       and (select count(*) from public.shopping_list_items where list_id = v_liste and source = 'plan') = 4));
end $$;

-- L'ÉLÈVE B, sur les MÊMES dates.
select pg_temp.connecte('c2000000-0000-4000-8000-0000000000e2');

do $$
declare v_liste_b uuid;
begin
  perform pg_temp.noter('G-04', 'B ne voit AUCUNE liste de A', (
    select count(*) = 0 from public.shopping_lists));
  perform pg_temp.noter('G-05', 'B ne voit AUCUNE ligne de A', (
    select count(*) = 0 from public.shopping_list_items));

  -- ⚠️ AUCUNE ERREUR N'EST LEVÉE ICI, ET C'EST LE PIÈGE. Un `update` qui ne voit
  -- aucune ligne « réussit » : c'est le NOMBRE de lignes touchées qui répond.
  update public.shopping_list_items set checked = true;
  perform pg_temp.noter('B-07', 'B ne peut pas cocher une ligne de A (0 ligne touchée)', (
    select count(*) = 0 from public.shopping_list_items where checked));

  perform pg_temp.noter('C-09', 'B ne peut pas modifier un article manuel de A',
    pg_temp.refuse_pour(format('select public.modifier_article_manuel(%L, ''Volé'', null, null)',
      current_setting('c2.manuel')::uuid), 'ARTICLE_MANUEL_INTROUVABLE'));

  -- B régénère SA liste, sur les MÊMES dates que A.
  v_liste_b := public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-02',
    jsonb_build_array(jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f003',
                                         'product_id', null, 'quantity', 50, 'unit', 'g')));
  perform pg_temp.noter('G-06', 'B régénère SA liste sur les mêmes dates', v_liste_b is not null);
  perform pg_temp.noter('G-07', 'et n''y voit toujours qu''une seule liste : la sienne', (
    select count(*) = 1 from public.shopping_lists));

  -- ⚠️ ET L'ALIMENT DE A RESTE INTERDIT À B. L'appartenance est vérifiée contre
  -- LA PLANIFICATION DE B, pas contre une table globale.
  perform pg_temp.noter('G-08', 'B ne peut pas mettre dans SA liste un aliment planifié par A',
    pg_temp.refuse_pour($q$select public.regenerer_liste_de_courses(date '2026-03-02', date '2026-03-02',
      jsonb_build_array(jsonb_build_object('catalog_food_id', 'c2000000-0000-4000-8000-00000000f001',
                                           'product_id', null, 'quantity', 100, 'unit', 'g')))$q$,
      'LIGNE_HORS_PLANIFICATION'));
end $$;

reset role;

do $$
begin
  perform pg_temp.noter('C-10', 'et l''article manuel de A est intact après la tentative de B', (
    select label = 'Sacs poubelle 50L' from public.shopping_list_items
     where id = current_setting('c2.manuel')::uuid));
  perform pg_temp.noter('G-09', 'au total : 3 listes, appartenant à 2 élèves distincts', (
    select count(*) = 3 and count(distinct student_id) = 2 from public.shopping_lists
     where student_id in ('c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-000000005002')));
  perform pg_temp.noter('G-10', 'les cases de A n''ont pas bougé pendant la session de B', (
    select count(*) = 2 from public.shopping_list_items
     where list_id = current_setting('c2.liste')::uuid and checked));
end $$;


-- =====================================================================
-- H — NON-RÉGRESSION : CE QUE C2 N'A PAS LE DROIT DE TOUCHER
-- =====================================================================
do $$
begin
  -- ⚠️ LA LISTE DE COURSES LIT LA PLANIFICATION, ELLE NE L'ÉCRIT JAMAIS. Huit
  -- items ont été posés par le banc ; il doit y en avoir exactement huit.
  perform pg_temp.noter('H-01', 'aucun planned_meal n''a été créé, modifié ni supprimé', (
    select count(*) = 4 from public.planned_meals
     where student_id in ('c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-000000005002')));
  perform pg_temp.noter('H-02', 'aucun planned_meal_item n''a bougé', (
    select count(*) = 8 from public.planned_meal_items
     where student_id in ('c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-000000005002')));
  perform pg_temp.noter('H-03', 'aucun planned_meal n''a été rattaché à une consommation', (
    select bool_and(consumed_meal_id is null) from public.planned_meals
     where student_id in ('c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-000000005002')));

  -- Valider n'est pas manger, et faire ses courses encore moins.
  perform pg_temp.noter('H-04', 'aucun consumed_meal n''a été créé', (
    select count(*) = 0 from public.consumed_meals
     where student_id in ('c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-000000005002')));
  perform pg_temp.noter('H-05', 'aucune meal_entry n''a été créée', (
    select count(*) = 0 from public.meal_entries
     where student_id in ('c2000000-0000-4000-8000-000000005001', 'c2000000-0000-4000-8000-000000005002')));

  -- ⚠️ LA COLONNE HÉRITÉE RESTE INTACTE. `nutrition_plans.shopping_list` est une
  -- note libre du COACH, d'une autre maille, sans identité ni unité. C2 ne la
  -- lit pas, ne l'écrit pas, et ne la supprime pas.
  perform pg_temp.noter('H-06', 'nutrition_plans.shopping_list est intacte (vide)', (
    select bool_and(shopping_list = '[]'::jsonb) from public.nutrition_plans
     where id in ('c2000000-0000-4000-8000-00000000b001', 'c2000000-0000-4000-8000-00000000b002')));
  perform pg_temp.noter('H-07', 'aucune RPC C2 ne nomme nutrition_plans.shopping_list', (
    select bool_and(pg_get_functiondef(p.oid) not like '%shopping_list%'
                 or pg_get_functiondef(p.oid) not like '%nutrition_plans%')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('regenerer_liste_de_courses', 'modifier_article_manuel')));

  -- ⚠️ `food_lists` N'EST PAS UNE LISTE DE COURSES. C'est la liste d'aliments
  -- AUTORISÉS du coach (N1), rattachée à `coach_id`. Le mot « liste » est pris
  -- dans ce domaine avec un sens inverse ; les confondre serait une régression
  -- de modèle, pas une simplification.
  perform pg_temp.noter('H-08', 'aucune RPC C2 ne lit food_lists ni food_list_items', (
    select bool_and(regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', ' ', 'g') !~ 'food_lists?')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('regenerer_liste_de_courses', 'modifier_article_manuel')));
  perform pg_temp.noter('H-09', 'aucune table shopping_* ne référence food_lists', (
    select count(*) = 0 from pg_constraint
     where contype = 'f'
       and conrelid in ('public.shopping_lists'::regclass, 'public.shopping_list_items'::regclass)
       and confrelid in ('public.food_lists'::regclass, 'public.food_list_items'::regclass)));

  -- Et les tables de C2 ne référencent QUE ce qu'elles doivent référencer.
  -- ⚠️ ON COMPARE DES OID, PAS DU TEXTE. `confrelid::regclass::text` omet le
  -- schéma quand `public` est dans le `search_path` et le garde sinon : une
  -- comparaison textuelle rougirait ou verdirait selon la session, pas selon
  -- le modèle.
  perform pg_temp.noter('H-10', 'shopping_list_items ne pointe que food_catalog, food_products et sa liste', (
    select array_agg(distinct confrelid order by confrelid)
         = (select array_agg(distinct o order by o) from unnest(array[
              'public.food_catalog'::regclass::oid,
              'public.food_products'::regclass::oid,
              'public.shopping_lists'::regclass::oid]) as o)
      from pg_constraint
     where contype = 'f' and conrelid = 'public.shopping_list_items'::regclass));
end $$;


-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_rouges int;
begin
  select count(*), count(*) filter (where ok is not true) into v_total, v_rouges from _faits;
  raise notice '';
  raise notice 'COURSES C2 · LISTE DE COURSES PERSISTANTE — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

-- ---------------------------------------------------------------------
-- Z — APRÈS LE ROLLBACK, IL NE DOIT RIEN RESTER
-- ---------------------------------------------------------------------
-- ⚠️ VÉRIFIÉ, PAS SUPPOSÉ. Une checklist qui laisserait deux élèves et trois
-- listes derrière elle contaminerait la suivante, et ferait passer pour un
-- succès un état que personne n'a voulu.
do $$
declare v_restes int;
begin
  select (select count(*) from public.students            where id::text like 'c2000000%')
       + (select count(*) from public.food_catalog        where id::text like 'c2000000%')
       + (select count(*) from public.food_products       where id::text like 'c2000000%')
       + (select count(*) from public.nutrition_plans     where id::text like 'c2000000%')
       + (select count(*) from public.planned_meals       where student_id::text like 'c2000000%')
       + (select count(*) from public.shopping_lists      where student_id::text like 'c2000000%')
       + (select count(*) from public.shopping_list_items where student_id::text like 'c2000000%')
    into v_restes;
  if v_restes > 0 then
    raise exception 'Z · ÉCHEC : % ligne(s) de test ont survécu au rollback', v_restes;
  end if;
  raise notice 'OK      — Z · aucune donnée de test ne subsiste (vérifié, pas supposé)';
end $$;
