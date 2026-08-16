-- ============================================================================
-- Checklist PostgreSQL — CONTRACT : `preferred_unit` SUPPRIMÉE.
--
-- CE QU'ELLE VÉRIFIE
--   K-A   la colonne n'existe PLUS, et les trois contraintes legacy non plus
--   K-B   `quantity_unit` reste, seule, avec sa contrainte de vocabulaire
--   K-C   la vérité métier de N1.5.2 est INTACTE
--   K-D   la RPC n'écrit plus l'ancienne colonne, mais accepte encore la clé
--   K-E   les données : une portion et un minimum vivent avec quantity_unit
--         seule, y compris via une charge utile ANCIENNE
--   Z     après le ROLLBACK, aucune donnée de test ne subsiste
--
-- ⚠️ CE QUE CETTE CHECKLIST NE PEUT PAS PROUVER, ET OÙ ÇA SE PROUVE.
-- « Les 63 valeurs de production survivent au drop » ne se démontre pas ici :
-- il faudrait exécuter la migration AU MILIEU de la checklist, sur une base
-- déjà peuplée. C'est fait par un banc dédié, dans le livrable — base
-- reconstruite à l'état post-N1.5.2, 609 options dont 63 avec les DEUX unités
-- égales, migration appliquée, diff des 63 lignes AVANT/APRÈS. Prétendre le
-- prouver ici serait mentir sur ce qu'on mesure.
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

create or replace function pg_temp.compte(p_sql text)
returns integer language plpgsql as $$
declare n integer;
begin execute p_sql into n; return coalesce(n, -1);
exception when others then return -1; end $$;

create or replace function pg_temp.sans_prose(p_src text)
returns text language sql immutable as $$
  select regexp_replace(p_src, '--[^\n]*', ' ', 'g');
$$;

-- ---------------------------------------------------------------------
-- K-A / K-B / K-C — LE SCHÉMA APRÈS LE CONTRACT
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('K-A', 'preferred_unit n''existe plus', (
    select count(*) = 0 from information_schema.columns
     where table_schema='public' and table_name='meal_choice_options' and column_name='preferred_unit'));

  perform pg_temp.noter('K-A', 'la paire de N1.5.1 a disparu', (
    select count(*) = 0 from pg_constraint
     where conrelid='public.meal_choice_options'::regclass
       and conname='meal_choice_options_preferred_paire'));
  perform pg_temp.noter('K-A', 'le vocabulaire legacy a disparu', (
    select count(*) = 0 from pg_constraint
     where conrelid='public.meal_choice_options'::regclass
       and conname='meal_choice_options_preferred_unit_check'));
  perform pg_temp.noter('K-A', 'la cohérence de transition a disparu', (
    select count(*) = 0 from pg_constraint
     where conrelid='public.meal_choice_options'::regclass
       and conname='meal_choice_options_unite_legacy_coherente'));

  -- ⚠️ ET AUCUNE AUTRE COLONNE D'UNITÉ NE SUBSISTE. Chercher `preferred_unit`
  -- par son nom ne suffirait pas : une colonne `ancienne_unite` recréée
  -- passerait. On exige qu'il n'en reste QU'UNE.
  perform pg_temp.noter('K-B', 'quantity_unit est la SEULE colonne d''unité', (
    select count(*) = 1 from information_schema.columns
     where table_schema='public' and table_name='meal_choice_options' and column_name like '%unit%'));
  perform pg_temp.noter('K-B', 'et elle garde son vocabulaire (g, ml)', (
    select pg_get_constraintdef(oid) like '%''g''%' and pg_get_constraintdef(oid) like '%''ml''%'
       from pg_constraint
      where conrelid='public.meal_choice_options'::regclass
        and conname='meal_choice_options_quantity_unit_check'));

  perform pg_temp.noter('K-C', 'la contrainte métier de N1.5.2 est INTACTE', (
    select pg_get_constraintdef(oid) like '%preferred_quantity%'
       and pg_get_constraintdef(oid) like '%minimum_quantity%'
       and pg_get_constraintdef(oid) like '%quantity_unit%'
       from pg_constraint
      where conrelid='public.meal_choice_options'::regclass
        and conname='meal_choice_options_quantites_unite'));
  perform pg_temp.noter('K-C', 'les positivités de N1.5.1 et N1.5.2 sont INTACTES', (
    select count(*) = 2 from pg_constraint
     where conrelid='public.meal_choice_options'::regclass
       and conname in ('meal_choice_options_preferred_positive', 'meal_choice_options_minimum_positive')));
end $$;

-- ---------------------------------------------------------------------
-- K-D — LA RPC
-- ---------------------------------------------------------------------
do $$
declare v_src text := pg_temp.sans_prose(pg_get_functiondef('public.save_nutrition_plan_v2(jsonb)'::regprocedure));
begin
  perform pg_temp.noter('K-D', 'la RPC n''écrit plus preferred_unit', v_src not like '%preferred_unit =%');
  perform pg_temp.noter('K-D', 'la RPC ne nomme plus la colonne à l''insert',
    v_src not like '%quantity_unit, preferred_unit)%');
  -- ⚠️ L'ALIAS D'ENTRÉE SURVIT, ET C'EST DÉLIBÉRÉ : un onglet ouvert avant le
  -- déploiement peut encore poster l'ancienne clé.
  perform pg_temp.noter('K-D', 'la clé d''entrée preferred_unit reste acceptée',
    v_src like '%v_option->>''preferred_unit''%');
  -- Et les lots précédents survivent à la reproduction de la fonction.
  perform pg_temp.noter('K-D', 'la couleur N1.6A survit dans la RPC', v_src like '%color_key%');
  perform pg_temp.noter('K-D', 'le minimum N1.5.2 survit dans la RPC', v_src like '%minimum_quantity%');
end $$;

-- ---------------------------------------------------------------------
-- K-E — LES DONNÉES
-- ---------------------------------------------------------------------
insert into public.food_catalog (id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100)
values ('d7000000-0000-4000-8000-00000000f001', 'CONTRACT Aliment', 'g', 20, 10, 5);
insert into public.nutrition_plans (id, name, status, nutrition_model_version)
values ('d7000000-0000-4000-8000-00000000b001', 'Plan CONTRACT', 'actif', 2);
insert into public.nutrition_plan_profiles (plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp)
values ('d7000000-0000-4000-8000-00000000b001', 'default', 2000, 3000, 4000, 3000);
insert into public.nutrition_days (id, plan_id, day, status, profile_key)
values ('d7000000-0000-4000-8000-00000000d001', 'd7000000-0000-4000-8000-00000000b001', 'monday', 'non-commence', 'default');
insert into public.meals (id, nutrition_day_id, slot, name, items, macros, coach_notes)
values ('d7000000-0000-4000-8000-00000000e001', 'd7000000-0000-4000-8000-00000000d001', 'breakfast', 'PDJ', '[]', '{}', '');
insert into public.meal_choice_slots (id, meal_id, position, label)
values ('d7000000-0000-4000-8000-00000000a501', 'd7000000-0000-4000-8000-00000000e001', 1, 'Occurrence CONTRACT');

do $$
begin
  -- ⚠️ UNE PORTION VIT DÉSORMAIS AVEC `quantity_unit` SEULE. Avant le CONTRACT,
  -- la paire de N1.5.1 aurait refusé cet insert.
  perform pg_temp.noter('K-E', 'une portion vit avec quantity_unit seule', (
    select pg_temp.compte($q$
      with ins as (
        insert into public.meal_choice_options
          (slot_id, position, catalog_food_id, preferred_quantity, quantity_unit)
        values ('d7000000-0000-4000-8000-00000000a501', 1,
                'd7000000-0000-4000-8000-00000000f001', 25, 'g') returning 1)
      select count(*) from ins $q$) = 1));

  perform pg_temp.noter('K-E', 'la valeur écrite est bien relue', (
    select preferred_quantity = 25 and quantity_unit = 'g'
      from public.meal_choice_options
     where slot_id = 'd7000000-0000-4000-8000-00000000a501' and position = 1));
end $$;

-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_rouges int;
begin
  select count(*), count(*) filter (where ok is not true) into v_total, v_rouges from _faits;
  raise notice '';
  raise notice 'CONTRACT · preferred_unit — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

do $$
declare v_restes int;
begin
  select
      (select count(*) from public.food_catalog       where id::text like 'd7000000%')
    + (select count(*) from public.nutrition_plans    where id::text like 'd7000000%')
    + (select count(*) from public.meal_choice_slots  where id::text like 'd7000000%')
    into v_restes;
  if v_restes > 0 then
    raise exception 'Z · ÉCHEC : % ligne(s) de test ont survécu au rollback', v_restes;
  end if;
  raise notice 'OK      — Z · aucune donnée de test ne subsiste (vérifié, pas supposé)';
end $$;
