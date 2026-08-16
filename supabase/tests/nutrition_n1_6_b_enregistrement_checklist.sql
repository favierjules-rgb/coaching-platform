-- ============================================================================
-- Checklist PostgreSQL — N1.6B, ENREGISTRER LE REPAS STRUCTURÉ.
--
-- CE QU'ELLE VÉRIFIE — et rien de tout cela ne se prouve en TypeScript
--   S-A   la RPC existe, security definer, réservée à `authenticated`
--   S-B   la SIGNATURE n'accepte AUCUNE macro : l'invariant A5 est structurel
--   S-C   un enregistrement crée les entrées, dans les tables d'A5
--   S-D   les QUANTITÉS en base sont EXACTEMENT celles envoyées
--   S-E   les MACROS sont recalculées par le serveur, à 1e-4 près
--   S-F   IDEMPOTENCE : second appel = 0 entrée, même conteneur
--   S-G   les entrées manuelles PRÉEXISTANTES survivent
--   S-H   ROLLBACK TOTAL si un item échoue
--   S-I   jour A ≠ jour B, déjeuner ≠ dîner
--   S-J   RLS : le repas d'un autre élève est refusé
--   S-K   un aliment ARCHIVÉ après le snapshot reste enregistrable ICI…
--   S-L   …et reste REFUSÉ par l'ajout manuel A5
--   S-M   l'état « déjà enregistré » vient de planned_meals.consumed_meal_id
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
  if p_ok is null then
    raise warning 'INDÉTERMINÉ — % · %', p_section, p_libelle;
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
-- S-A / S-B — LA SIGNATURE, AVANT TOUTE DONNÉE
-- ---------------------------------------------------------------------
do $$
declare v_args text;
begin
  perform pg_temp.noter('S-A', 'la RPC existe, en security definer', (
    select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='enregistrer_repas_structure_consomme'));

  perform pg_temp.noter('S-A', 'anon ne peut pas l''exécuter', (
    select not has_function_privilege('anon',
      'public.enregistrer_repas_structure_consomme(uuid,date,jsonb)', 'execute')));
  perform pg_temp.noter('S-A', 'authenticated peut l''exécuter', (
    select has_function_privilege('authenticated',
      'public.enregistrer_repas_structure_consomme(uuid,date,jsonb)', 'execute')));

  -- ⚠️ TROIS ARGUMENTS, ET AUCUN N'EST UNE MACRO NI UN ÉLÈVE. Le client ne
  -- peut PAS envoyer de protéines : il n'existe pas de paramètre pour le
  -- faire. C'est une garantie de SIGNATURE, pas de discipline.
  select pg_get_function_identity_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='enregistrer_repas_structure_consomme';
  perform pg_temp.noter('S-B', 'la signature est (uuid, date, jsonb) et rien d''autre',
    v_args = 'p_meal_id uuid, p_consumed_on date, p_items jsonb');
  perform pg_temp.noter('S-B', 'aucun paramètre de macro', (
    v_args not like '%protein%' and v_args not like '%carb%' and v_args not like '%fat%'
    and v_args not like '%kcal%'));
  perform pg_temp.noter('S-B', 'aucun paramètre d''élève — il vient du JWT',
    v_args not like '%student%');

  -- ⚠️ ET ELLE NE RECOPIE PAS LA VALIDATION : elle APPELLE celle qui existe.
  perform pg_temp.noter('S-A', 'la RPC délègue à enregistrer_repas_planifie', (
    select pg_get_functiondef(p.oid) like '%public.enregistrer_repas_planifie(p_meal_id%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='enregistrer_repas_structure_consomme'));
  perform pg_temp.noter('S-A', 'la RPC ouvre le conteneur par ouvrir_repas_prescrit', (
    select pg_get_functiondef(p.oid) like '%public.ouvrir_repas_prescrit(p_meal_id%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='enregistrer_repas_structure_consomme'));
end $$;

-- ---------------------------------------------------------------------
-- LE BANC — un élève, un plan assigné, un repas à deux occurrences
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d6b00000-0000-4000-8000-0000000000e1', 'n16b-eleve@test.invalid'),
  ('d6b00000-0000-4000-8000-0000000000e2', 'n16b-autre@test.invalid');
insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('d6b00000-0000-4000-8000-0000000000e1', 'student', 'N16B', 'Eleve', 'n16b-eleve@test.invalid'),
  ('d6b00000-0000-4000-8000-0000000000e2', 'student', 'N16B', 'Autre', 'n16b-autre@test.invalid');
-- ⚠️ `status = 'active'` ET NON 'actif' : le défaut SQL de la table est
-- 'actif', mais la contrainte n'accepte que le vocabulaire anglais. Poser la
-- valeur explicitement plutôt que de faire confiance au défaut.
insert into public.students (id, user_id, first_name, last_name, email, status) values
  ('d6b00000-0000-4000-8000-000000005001', 'd6b00000-0000-4000-8000-0000000000e1', 'N16B', 'Eleve', 'n16b-eleve@test.invalid', 'active'),
  ('d6b00000-0000-4000-8000-000000005002', 'd6b00000-0000-4000-8000-0000000000e2', 'N16B', 'Autre', 'n16b-autre@test.invalid', 'active');

-- Deux aliments : un qui restera ACTIF, un qui sera ARCHIVÉ après le snapshot.
insert into public.food_catalog (id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, status) values
  ('d6b00000-0000-4000-8000-00000000f001', 'N16B Poulet', 'g', 31, 0, 3.6, 'active'),
  ('d6b00000-0000-4000-8000-00000000f002', 'N16B Riz',    'g', 2.7, 28, 0.3, 'active');

insert into public.nutrition_plans (id, name, status, nutrition_model_version, student_id)
values ('d6b00000-0000-4000-8000-00000000b001', 'Plan N16B', 'actif', 2, 'd6b00000-0000-4000-8000-000000005001');
insert into public.nutrition_plan_profiles (plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp)
values ('d6b00000-0000-4000-8000-00000000b001', 'default', 2000, 3000, 4000, 3000);
insert into public.nutrition_days (id, plan_id, day, status, profile_key) values
  ('d6b00000-0000-4000-8000-00000000d001', 'd6b00000-0000-4000-8000-00000000b001', 'monday', 'non-commence', 'default'),
  ('d6b00000-0000-4000-8000-00000000d002', 'd6b00000-0000-4000-8000-00000000b001', 'tuesday', 'non-commence', 'default');
insert into public.meals (id, nutrition_day_id, slot, name, items, macros, coach_notes) values
  ('d6b00000-0000-4000-8000-00000000e001', 'd6b00000-0000-4000-8000-00000000d001', 'lunch', 'Déjeuner', '[]', '{}', ''),
  ('d6b00000-0000-4000-8000-00000000e002', 'd6b00000-0000-4000-8000-00000000d001', 'dinner', 'Dîner', '[]', '{}', '');
insert into public.meal_choice_slots (id, meal_id, position, label) values
  ('d6b00000-0000-4000-8000-00000000a501', 'd6b00000-0000-4000-8000-00000000e001', 1, 'Ta protéine'),
  ('d6b00000-0000-4000-8000-00000000a502', 'd6b00000-0000-4000-8000-00000000e001', 2, 'Ton féculent'),
  ('d6b00000-0000-4000-8000-00000000a503', 'd6b00000-0000-4000-8000-00000000e002', 1, 'Ta protéine du soir');
insert into public.meal_choice_options (slot_id, position, catalog_food_id) values
  ('d6b00000-0000-4000-8000-00000000a501', 1, 'd6b00000-0000-4000-8000-00000000f001'),
  ('d6b00000-0000-4000-8000-00000000a502', 1, 'd6b00000-0000-4000-8000-00000000f002'),
  ('d6b00000-0000-4000-8000-00000000a503', 1, 'd6b00000-0000-4000-8000-00000000f001');

create or replace function pg_temp.items(p_slot1 uuid, p_food1 uuid, p_q1 numeric,
                                         p_slot2 uuid, p_food2 uuid, p_q2 numeric)
returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('slot_id', p_slot1, 'catalog_food_id', p_food1, 'quantity', p_q1, 'unit', 'g'),
    jsonb_build_object('slot_id', p_slot2, 'catalog_food_id', p_food2, 'quantity', p_q2, 'unit', 'g'));
$$;

set local role authenticated;
select pg_temp.connecte('d6b00000-0000-4000-8000-0000000000e1');

-- ⚠️ UNE ENTRÉE MANUELLE EXISTE AVANT L'ENREGISTREMENT. C'est le café du §B10 :
-- elle doit survivre.
do $$
declare v_cm uuid;
begin
  v_cm := public.ouvrir_repas_prescrit('d6b00000-0000-4000-8000-00000000e001', date '2026-08-10');
  perform public.ajouter_aliment_manuel(v_cm, 'Café', 200, 'ml', 0, 0, 0);
end $$;

-- ---------------------------------------------------------------------
-- S-C / S-D / S-E / S-G — LE PREMIER ENREGISTREMENT
-- ---------------------------------------------------------------------
do $$
declare v_res jsonb; v_cm uuid;
begin
  v_res := public.enregistrer_repas_structure_consomme(
    'd6b00000-0000-4000-8000-00000000e001', date '2026-08-10',
    pg_temp.items('d6b00000-0000-4000-8000-00000000a501', 'd6b00000-0000-4000-8000-00000000f001', 163,
                  'd6b00000-0000-4000-8000-00000000a502', 'd6b00000-0000-4000-8000-00000000f002', 200));
  v_cm := (v_res->>'consumed_meal_id')::uuid;
  perform set_config('n16b.cm', v_cm::text, true);

  perform pg_temp.noter('S-C', 'deux entrées structurées sont créées', (v_res->>'entrees_creees')::int = 2);
  perform pg_temp.noter('S-C', 'le premier appel n''est pas « déjà enregistré »', (v_res->>'deja_enregistre')::boolean = false);
  perform pg_temp.noter('S-C', 'les entrées vivent dans meal_entries, avec leur identité catalogue', (
    select count(*) = 2 from public.meal_entries e
     where e.consumed_meal_id = v_cm and e.source_type = 'catalog_food' and e.food_id is not null));

  -- ⚠️ S-D — LA QUANTITÉ EST EXACTEMENT CELLE ENVOYÉE. L'écran dit 163 g ; la
  -- base dit 163. Pas 162,6, pas 164 : elle n'est pas recalculée, elle est
  -- transmise.
  perform pg_temp.noter('S-D', 'la quantité en base est EXACTEMENT celle envoyée (163)', (
    select quantity = 163 from public.meal_entries
     where consumed_meal_id = v_cm and food_id = 'd6b00000-0000-4000-8000-00000000f001'));
  perform pg_temp.noter('S-D', 'la quantité en base est EXACTEMENT celle envoyée (200)', (
    select quantity = 200 from public.meal_entries
     where consumed_meal_id = v_cm and food_id = 'd6b00000-0000-4000-8000-00000000f002'));

  -- ⚠️ S-E — LES MACROS SONT CELLES DES QUANTITÉS, calculées PAR LE SERVEUR.
  -- 163 g × 31 / 100 = 50,53 g de protéines. La tolérance est celle de
  -- l'arrondi à 4 décimales de la RPC, pas une approximation choisie ici.
  perform pg_temp.noter('S-E', 'protéines du poulet = 163 × 31/100, à 1e-4 près', (
    select abs(protein_g - 50.53) < 0.0001 from public.meal_entries
     where consumed_meal_id = v_cm and food_id = 'd6b00000-0000-4000-8000-00000000f001'));
  perform pg_temp.noter('S-E', 'glucides du riz = 200 × 28/100, à 1e-4 près', (
    select abs(carb_g - 56) < 0.0001 from public.meal_entries
     where consumed_meal_id = v_cm and food_id = 'd6b00000-0000-4000-8000-00000000f002'));

  -- ⚠️ S-G — LE CAFÉ EST TOUJOURS LÀ. Rien n'a été effacé ni remplacé.
  perform pg_temp.noter('S-G', 'l''entrée manuelle préexistante survit', (
    select count(*) = 1 from public.meal_entries
     where consumed_meal_id = v_cm and label = 'Café'));
  perform pg_temp.noter('S-G', 'le conteneur est le MÊME que celui du café', (
    select count(*) = 1 from public.consumed_meals
     where id = v_cm and prescribed_meal_id = 'd6b00000-0000-4000-8000-00000000e001'
       and consumed_on = date '2026-08-10'));

  -- ⚠️ S-M — L'ÉTAT « DÉJÀ ENREGISTRÉ » EST PERSISTANT.
  perform pg_temp.noter('S-M', 'planned_meals.consumed_meal_id pointe le conteneur', (
    select pm.consumed_meal_id = v_cm from public.planned_meals pm
     where pm.meal_id = 'd6b00000-0000-4000-8000-00000000e001' and pm.planned_on = date '2026-08-10'));
end $$;

-- ---------------------------------------------------------------------
-- S-F — IDEMPOTENCE
-- ---------------------------------------------------------------------
do $$
declare v_res jsonb; v_cm uuid := current_setting('n16b.cm')::uuid; v_avant int;
begin
  select count(*) into v_avant from public.meal_entries where consumed_meal_id = v_cm;

  v_res := public.enregistrer_repas_structure_consomme(
    'd6b00000-0000-4000-8000-00000000e001', date '2026-08-10',
    pg_temp.items('d6b00000-0000-4000-8000-00000000a501', 'd6b00000-0000-4000-8000-00000000f001', 163,
                  'd6b00000-0000-4000-8000-00000000a502', 'd6b00000-0000-4000-8000-00000000f002', 200));

  perform pg_temp.noter('S-F', 'le second appel se dit « déjà enregistré »', (v_res->>'deja_enregistre')::boolean = true);
  perform pg_temp.noter('S-F', 'le second appel crée ZÉRO entrée', (v_res->>'entrees_creees')::int = 0);
  perform pg_temp.noter('S-F', 'le second appel rend le MÊME conteneur', (v_res->>'consumed_meal_id')::uuid = v_cm);
  perform pg_temp.noter('S-F', 'aucune entrée n''a été ajoutée en base', (
    select count(*) = v_avant from public.meal_entries where consumed_meal_id = v_cm));

  -- ⚠️ ET MÊME AVEC DES QUANTITÉS DIFFÉRENTES. Un double clic après un
  -- changement de choix ne doit pas non plus dupliquer : le lien est posé.
  v_res := public.enregistrer_repas_structure_consomme(
    'd6b00000-0000-4000-8000-00000000e001', date '2026-08-10',
    pg_temp.items('d6b00000-0000-4000-8000-00000000a501', 'd6b00000-0000-4000-8000-00000000f001', 999,
                  'd6b00000-0000-4000-8000-00000000a502', 'd6b00000-0000-4000-8000-00000000f002', 999));
  perform pg_temp.noter('S-F', 'des quantités différentes ne rouvrent pas l''enregistrement', (
    select count(*) = v_avant from public.meal_entries where consumed_meal_id = v_cm));
end $$;

-- ---------------------------------------------------------------------
-- S-H / S-I / S-J — REFUS, ISOLATION, SÉCURITÉ
-- ---------------------------------------------------------------------
do $$
declare v_total_avant int;
begin
  select count(*) into v_total_avant from public.meal_entries;

  -- ⚠️ S-H — UN ITEM INVALIDE ANNULE TOUT. Ici : une occurrence non couverte.
  perform pg_temp.noter('S-H', 'un choix incomplet est refusé',
    pg_temp.refuse_pour($q$ select public.enregistrer_repas_structure_consomme(
        'd6b00000-0000-4000-8000-00000000e001', date '2026-08-11',
        jsonb_build_array(jsonb_build_object(
          'slot_id', 'd6b00000-0000-4000-8000-00000000a501',
          'catalog_food_id', 'd6b00000-0000-4000-8000-00000000f001',
          'quantity', 100, 'unit', 'g'))) $q$,
      'CHOIX_INCOMPLET'));
  perform pg_temp.noter('S-H', 'un aliment HORS de la liste est refusé',
    pg_temp.refuse_pour($q$ select public.enregistrer_repas_structure_consomme(
        'd6b00000-0000-4000-8000-00000000e001', date '2026-08-11',
        pg_temp.items('d6b00000-0000-4000-8000-00000000a501', 'd6b00000-0000-4000-8000-00000000f002', 100,
                      'd6b00000-0000-4000-8000-00000000a502', 'd6b00000-0000-4000-8000-00000000f002', 100)) $q$,
      'CHOIX_HORS_LISTE'));
  perform pg_temp.noter('S-H', 'ROLLBACK TOTAL : aucune entrée n''a été créée par les refus', (
    select count(*) = v_total_avant from public.meal_entries));
  perform pg_temp.noter('S-H', 'ROLLBACK TOTAL : aucun planned_meal du 11 ne subsiste', (
    select count(*) = 0 from public.planned_meals where planned_on = date '2026-08-11'));
end $$;

do $$
declare v_res jsonb; v_cm_lundi uuid := current_setting('n16b.cm')::uuid;
begin
  -- ⚠️ S-I — LE MÊME REPAS PRESCRIT, UN AUTRE JOUR : une autre consommation.
  v_res := public.enregistrer_repas_structure_consomme(
    'd6b00000-0000-4000-8000-00000000e001', date '2026-08-11',
    pg_temp.items('d6b00000-0000-4000-8000-00000000a501', 'd6b00000-0000-4000-8000-00000000f001', 120,
                  'd6b00000-0000-4000-8000-00000000a502', 'd6b00000-0000-4000-8000-00000000f002', 150));
  perform pg_temp.noter('S-I', 'un autre JOUR crée une autre consommation',
    (v_res->>'consumed_meal_id')::uuid <> v_cm_lundi);
  perform pg_temp.noter('S-I', 'et deux entrées neuves, pas quatre', (v_res->>'entrees_creees')::int = 2);

  -- ⚠️ S-I — LE DÎNER DU MÊME JOUR RESTE INDÉPENDANT.
  perform pg_temp.noter('S-I', 'le dîner n''est PAS marqué enregistré par le déjeuner', (
    select count(*) = 0 from public.planned_meals
     where meal_id = 'd6b00000-0000-4000-8000-00000000e002' and consumed_meal_id is not null));
end $$;

-- ⚠️ S-J — UN AUTRE ÉLÈVE NE PEUT PAS ENREGISTRER CE REPAS.
select pg_temp.connecte('d6b00000-0000-4000-8000-0000000000e2');
do $$
begin
  perform pg_temp.noter('S-J', 'le repas d''un autre élève est refusé',
    pg_temp.refuse_pour($q$ select public.enregistrer_repas_structure_consomme(
        'd6b00000-0000-4000-8000-00000000e001', date '2026-08-12',
        pg_temp.items('d6b00000-0000-4000-8000-00000000a501', 'd6b00000-0000-4000-8000-00000000f001', 100,
                      'd6b00000-0000-4000-8000-00000000a502', 'd6b00000-0000-4000-8000-00000000f002', 100)) $q$,
      'REPAS_PRESCRIT_INACCESSIBLE'));
  perform pg_temp.noter('S-J', 'aucune entrée n''a été créée pour l''autre élève', (
    select count(*) = 0 from public.meal_entries
     where student_id = 'd6b00000-0000-4000-8000-000000005002'));
end $$;

-- ---------------------------------------------------------------------
-- S-K / S-L — L'ALIMENT ARCHIVÉ APRÈS LE SNAPSHOT
-- ---------------------------------------------------------------------
reset role;
update public.food_catalog set status = 'archived'
 where id = 'd6b00000-0000-4000-8000-00000000f002';

set local role authenticated;
select pg_temp.connecte('d6b00000-0000-4000-8000-0000000000e1');

do $$
declare v_res jsonb; v_cm uuid;
begin
  -- ⚠️ S-K — LE PLAN EST UN SNAPSHOT HISTORIQUE VALIDE. Le riz était actif
  -- quand le coach l'a prescrit ; l'archiver ensuite ne doit pas empêcher
  -- l'élève d'enregistrer un repas qu'il voit et que le solveur calcule.
  v_res := public.enregistrer_repas_structure_consomme(
    'd6b00000-0000-4000-8000-00000000e001', date '2026-08-13',
    pg_temp.items('d6b00000-0000-4000-8000-00000000a501', 'd6b00000-0000-4000-8000-00000000f001', 100,
                  'd6b00000-0000-4000-8000-00000000a502', 'd6b00000-0000-4000-8000-00000000f002', 100));
  v_cm := (v_res->>'consumed_meal_id')::uuid;
  perform pg_temp.noter('S-K', 'un aliment ARCHIVÉ après le snapshot reste enregistrable', (
    (v_res->>'entrees_creees')::int = 2));
  perform pg_temp.noter('S-K', 'et son identité catalogue est préservée', (
    select count(*) = 1 from public.meal_entries
     where consumed_meal_id = v_cm and food_id = 'd6b00000-0000-4000-8000-00000000f002'
       and source_type = 'catalog_food'));

  -- ⚠️ S-L — MAIS L'AJOUT MANUEL LE REFUSE TOUJOURS. L'exception appartient au
  -- SEUL chemin structuré ; le catalogue libre, lui, ne doit pas reproposer un
  -- aliment retiré.
  perform pg_temp.noter('S-L', 'le même aliment archivé reste refusé par l''ajout manuel A5',
    pg_temp.refuse_pour(
      format($q$ select public.ajouter_aliment_catalogue(%L, 'd6b00000-0000-4000-8000-00000000f002', 100, 'g') $q$, v_cm),
      'ALIMENT_INACCESSIBLE'));
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
  raise notice 'N1.6B · ENREGISTRER LE REPAS — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

-- ---------------------------------------------------------------------
-- Section Z
-- ---------------------------------------------------------------------
do $$
declare v_restes int;
begin
  select
      (select count(*) from public.meal_entries    where student_id::text like 'd6b00000%')
    + (select count(*) from public.consumed_meals  where student_id::text like 'd6b00000%')
    + (select count(*) from public.planned_meals   where student_id::text like 'd6b00000%')
    + (select count(*) from public.students        where id::text like 'd6b00000%')
    + (select count(*) from public.food_catalog    where id::text like 'd6b00000%')
    + (select count(*) from auth.users             where id::text like 'd6b00000%')
    into v_restes;
  if v_restes > 0 then
    raise exception 'Z · ÉCHEC : % ligne(s) de test ont survécu au rollback', v_restes;
  end if;
  raise notice 'OK      — Z · aucune donnée de test ne subsiste (vérifié, pas supposé)';
end $$;
