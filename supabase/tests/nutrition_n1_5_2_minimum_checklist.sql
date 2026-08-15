-- ============================================================================
-- Checklist PostgreSQL — N1.5.2, LA QUANTITÉ MINIMALE PAR ALIMENT
--
-- CE QU'ELLE VÉRIFIE
--   M-A   les deux colonnes de minimum existent, nullables, sans default
--   M-B   l'EXPAND est TERMINÉ : quantity_unit seule, preferred_unit supprimée
--   M-C   NULL ou > 0 : zéro et négatif refusés des deux côtés
--   M-D   la paire GÉNÉRALISÉE : unité ⟺ (portion OU minimum)
--   M-E   un MINIMUM SEUL, sans portion, est accepté — le cas que N1.5.1 refusait
--   M-F   une PORTION SEULE reste acceptée (lignes d'avant N1.5.2)
--   M-G   AUCUN BACKFILL MÉTIER
--   M-H   la RPC snapshote le minimum reçu
--   M-I   la RPC ne résout rien et n'écrit aucune consommation
--   M-K   refus explicites : MINIMUM_SANS_UNITE / MINIMUM_NON_POSITIF, et
--         PORTION_SANS_UNITE de N1.5.1 CONSERVÉ
--   M-L   AUCUNE contrainte ne code 300 ni 500
--   M-M   aucun minimum global sur food_catalog / food_products
--   CONTRACT  la transition est TERMINÉE : quantity_unit seule
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

-- NULL = ÉCHEC : un contrôle indéterminé disparaîtrait du total sans rien
-- avoir prouvé. Même convention que les checklists N1.1 et N1.3.
create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, coalesce(p_ok, false));
  if p_ok is null then
    raise warning 'INDÉTERMINÉ — % · % (contrôle mal formé : traité comme un échec)', p_section, p_libelle;
  elsif p_ok then raise notice 'OK      — % · %', p_section, p_libelle;
  else raise warning 'ÉCHEC   — % · %', p_section, p_libelle; end if;
end $$;

create or replace function pg_temp.refuse_pour(p_sql text, p_motif text)
returns boolean language plpgsql as $$
begin execute p_sql; return false;
exception when others then return sqlerrm like '%' || p_motif || '%'; end $$;

create or replace function pg_temp.compte(p_sql text)
returns integer language plpgsql as $$
declare n integer;
begin execute p_sql into n; return coalesce(n, -1);
exception when others then return -1; end $$;

-- ⚠️ ON CHERCHE DU CODE, PAS DE LA PROSE. La RPC EXPLIQUE en commentaire
-- qu'elle ne relit ni `food_list_items`, ni `food_catalog`, ni `food_products` ;
-- une recherche naïve trouverait ces mots et déclarerait une lecture qui
-- n'existe pas. Le contrôle négatif l'a montré : sans ce nettoyage, P-G était
-- rouge pour une phrase. Même leçon qu'en N1.4, où un sabotage placé dans un
-- commentaire n'avait rien prouvé.
create or replace function pg_temp.sans_prose(p_src text)
returns text language sql immutable as $$
  select regexp_replace(p_src, '--[^\n]*', ' ', 'g');
$$;

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
-- M-A / M-B / M-C / M-D — LE SCHÉMA
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('M-A', 'food_list_items.minimum_quantity_override existe, numeric, nullable', (
    select data_type = 'numeric' and is_nullable = 'YES' from information_schema.columns
     where table_schema='public' and table_name='food_list_items' and column_name='minimum_quantity_override'));
  perform pg_temp.noter('M-A', 'meal_choice_options.minimum_quantity existe, numeric, nullable', (
    select data_type = 'numeric' and is_nullable = 'YES' from information_schema.columns
     where table_schema='public' and table_name='meal_choice_options' and column_name='minimum_quantity'));
  perform pg_temp.noter('M-A', 'aucun DEFAULT sur les colonnes de minimum', (
    select count(*) = 0 from information_schema.columns
     where table_schema='public' and column_name like 'minimum%' and column_default is not null));

  -- ⚠️ CE CONTRÔLE A CHANGÉ DEUX FOIS, ET LES DEUX FOIS AVAIENT RAISON.
  -- Il exigeait d'abord que l'ancien nom ait DISPARU (stratégie rename) ;
  -- N1.5.2 l'a inversé, parce que la production lisait encore
  -- `preferred_unit` et qu'un rename n'a pas d'ordre sûr. Le CONTRACT du
  -- 2026-09-13 a terminé le chemin : le code neuf est déployé et validé, la
  -- colonne est supprimée. On revient donc à la forme d'origine — non pas
  -- parce qu'on s'était trompé, mais parce que l'expand est ARRIVÉ À SON
  -- TERME. C'est la trace de trois états successifs, tous corrects à leur date.
  perform pg_temp.noter('M-B', 'quantity_unit existe', (
    select count(*) = 1 from information_schema.columns
     where table_schema='public' and table_name='meal_choice_options' and column_name='quantity_unit'));
  perform pg_temp.noter('M-B', 'preferred_unit a été SUPPRIMÉE (CONTRACT)', (
    select count(*) = 0 from information_schema.columns
     where table_schema='public' and table_name='meal_choice_options' and column_name='preferred_unit'));
  perform pg_temp.noter('M-B', 'les contraintes legacy ont disparu avec elle', (
    select count(*) = 0 from pg_constraint
     where conrelid = 'public.meal_choice_options'::regclass
       and conname in ('meal_choice_options_preferred_paire',
                       'meal_choice_options_preferred_unit_check',
                       'meal_choice_options_unite_legacy_coherente')));
  perform pg_temp.noter('M-B', 'quantity_unit est du texte NULLABLE, sans DEFAULT', (
    select data_type = 'text' and is_nullable = 'YES' and column_default is null
       from information_schema.columns
     where table_schema='public' and table_name='meal_choice_options' and column_name='quantity_unit'));
  perform pg_temp.noter('M-B', 'aucune colonne minimum_unit n''a été créée', (
    select count(*) = 0 from information_schema.columns
     where table_schema='public' and column_name = 'minimum_unit'));

  perform pg_temp.noter('M-D', 'la paire couvre les DEUX quantités', (
    select pg_get_constraintdef(oid) like '%preferred_quantity%'
       and pg_get_constraintdef(oid) like '%minimum_quantity%'
       and pg_get_constraintdef(oid) like '%quantity_unit%'
       from pg_constraint
      where conrelid='public.meal_choice_options'::regclass
        and conname='meal_choice_options_quantites_unite'));

  -- ⚠️ LE PLAFOND NE DOIT ÊTRE NULLE PART EN BASE. Il vit dans le solveur :
  -- l'écrire ici en ferait une seconde vérité, et le jour où il bougerait il
  -- faudrait une migration.
  perform pg_temp.noter('M-L', 'aucune contrainte ne code 300 ni 500', (
    select count(*) = 0 from pg_constraint
     where conrelid in ('public.food_catalog'::regclass, 'public.food_products'::regclass,
                        'public.food_list_items'::regclass, 'public.meal_choice_options'::regclass)
       and (pg_get_constraintdef(oid) like '%300%' or pg_get_constraintdef(oid) like '%500%')));

  -- ⚠️ AUCUN MINIMUM GLOBAL (§18) : le minimum est purement coach dans ce lot.
  perform pg_temp.noter('M-M', 'aucun minimum sur food_catalog ni food_products', (
    select count(*) = 0 from information_schema.columns
     where table_schema='public' and table_name in ('food_catalog','food_products')
       and column_name like '%minimum%'));

  perform pg_temp.noter('M-G', 'aucun minimum posé par la migration (food_list_items)', (
    select count(*) = 0 from public.food_list_items where minimum_quantity_override is not null));
  perform pg_temp.noter('M-G', 'aucun minimum posé par la migration (meal_choice_options)', (
    select count(*) = 0 from public.meal_choice_options where minimum_quantity is not null));
end $$;

-- ---------------------------------------------------------------------
-- M-C / M-E / M-F — LES VALEURS ACCEPTÉES ET REFUSÉES
-- ---------------------------------------------------------------------
insert into public.food_catalog (id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100) values
  ('d5200000-0000-4000-8000-00000000f001', 'N152 Beurre', 'g', 0.63, 0.71, 83),
  ('d5200000-0000-4000-8000-00000000f002', 'N152 Sirop',  'g', 0.25, 78, 0.5);

insert into auth.users (id, email) values ('d5200000-0000-4000-8000-0000000000c1', 'n152@test.invalid');
insert into public.profiles (user_id, role, first_name, last_name, email)
values ('d5200000-0000-4000-8000-0000000000c1', 'coach', 'N152', 'Coach', 'n152@test.invalid');
insert into public.coaches (id, user_id, name, email)
values ('d5200000-0000-4000-8000-00000000c001', 'd5200000-0000-4000-8000-0000000000c1', 'Coach N152', 'n152@test.invalid');
insert into public.food_lists (id, coach_id, name)
values ('d5200000-0000-4000-8000-00000000a001', 'd5200000-0000-4000-8000-00000000c001', 'Liste N152');
insert into public.food_list_items (id, list_id, position, catalog_food_id)
values ('d5200000-0000-4000-8000-000000001001', 'd5200000-0000-4000-8000-00000000a001', 1,
        'd5200000-0000-4000-8000-00000000f001');

do $$
begin
  perform pg_temp.noter('M-C', 'un minimum NUL est refusé',
    pg_temp.refuse_pour($q$ update public.food_list_items set minimum_quantity_override = 0
                            where id = 'd5200000-0000-4000-8000-000000001001' $q$,
                        'food_list_items_minimum_override_positive'));
  perform pg_temp.noter('M-C', 'un minimum NÉGATIF est refusé',
    pg_temp.refuse_pour($q$ update public.food_list_items set minimum_quantity_override = -5
                            where id = 'd5200000-0000-4000-8000-000000001001' $q$,
                        'food_list_items_minimum_override_positive'));
  perform pg_temp.noter('M-C', 'un minimum DÉCIMAL est accepté et conservé', (
    select pg_temp.compte($q$
      with maj as (update public.food_list_items set minimum_quantity_override = 4.4
                    where id = 'd5200000-0000-4000-8000-000000001001' returning minimum_quantity_override)
      select count(*) from maj where minimum_quantity_override = 4.4 $q$) = 1));
end $$;

-- Une occurrence de test, pour éprouver la paire sur meal_choice_options.
insert into public.nutrition_plans (id, name, status, nutrition_model_version)
values ('d5200000-0000-4000-8000-00000000b001', 'Plan N152', 'actif', 2);
insert into public.nutrition_plan_profiles (plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp)
values ('d5200000-0000-4000-8000-00000000b001', 'default', 2000, 3000, 4000, 3000);
insert into public.nutrition_days (id, plan_id, day, status, profile_key)
values ('d5200000-0000-4000-8000-00000000d001', 'd5200000-0000-4000-8000-00000000b001', 'monday', 'non-commence', 'default');
insert into public.meals (id, nutrition_day_id, slot, name, items, macros, coach_notes)
values ('d5200000-0000-4000-8000-00000000e001', 'd5200000-0000-4000-8000-00000000d001', 'breakfast', 'PDJ', '[]', '{}', '');
insert into public.meal_choice_slots (id, meal_id, position, label)
values ('d5200000-0000-4000-8000-00000000a501', 'd5200000-0000-4000-8000-00000000e001', 1, 'Occurrence N152');

do $$
begin
  -- ⚠️ M-E — LE CAS QUE N1.5.1 REFUSAIT : un minimum SANS portion préférée.
  -- C'est la raison d'être du renommage et de la paire généralisée.
  perform pg_temp.noter('M-E', 'un MINIMUM SEUL, sans portion, est accepté', (
    select pg_temp.compte($q$
      with ins as (
        insert into public.meal_choice_options
          (slot_id, position, catalog_food_id, minimum_quantity, quantity_unit)
        values ('d5200000-0000-4000-8000-00000000a501', 1,
                'd5200000-0000-4000-8000-00000000f001', 5, 'g') returning 1)
      select count(*) from ins $q$) = 1));

  -- ⚠️ M-F — UNE PORTION SEULE RESTE ACCEPTÉE. C'est la forme des 63 lignes
  -- déjà en production : la contrainte généralisée ne devait pas les casser.
  --
  -- ⚠️ ET DEPUIS LE CONTRACT, ELLE NE PORTE PLUS QU'UNE SEULE UNITÉ. La paire
  -- de N1.5.1 exigeait `preferred_unit` à côté ; elle a été supprimée avec la
  -- colonne. `quantity_unit` est désormais seule source métier.
  perform pg_temp.noter('M-F', 'une PORTION SEULE reste acceptée (lignes d''avant N1.5.2)', (
    select pg_temp.compte($q$
      with ins as (
        insert into public.meal_choice_options
          (slot_id, position, catalog_food_id, preferred_quantity, quantity_unit)
        values ('d5200000-0000-4000-8000-00000000a501', 2,
                'd5200000-0000-4000-8000-00000000f002', 10, 'g') returning 1)
      select count(*) from ins $q$) = 1));
  perform pg_temp.noter('M-D', 'une quantité SANS unité est refusée',
    pg_temp.refuse_pour($q$ insert into public.meal_choice_options
        (slot_id, position, catalog_food_id, minimum_quantity)
      values ('d5200000-0000-4000-8000-00000000a501', 9,
              'd5200000-0000-4000-8000-00000000f001', 5) $q$,
      'meal_choice_options_quantites_unite'));
  perform pg_temp.noter('M-D', 'une unité SANS aucune quantité est refusée',
    pg_temp.refuse_pour($q$ insert into public.meal_choice_options
        (slot_id, position, catalog_food_id, quantity_unit)
      values ('d5200000-0000-4000-8000-00000000a501', 9,
              'd5200000-0000-4000-8000-00000000f001', 'g') $q$,
      'meal_choice_options_quantites_unite'));
  perform pg_temp.noter('M-C', 'un minimum NUL est refusé sur l''option',
    pg_temp.refuse_pour($q$ update public.meal_choice_options set minimum_quantity = 0
                            where slot_id = 'd5200000-0000-4000-8000-00000000a501' $q$,
                        'meal_choice_options_minimum_positive'));
  -- ⚠️ DEPUIS LE CONTRACT, UNE SEULE CONTRAINTE PEUT ÊTRE VIOLÉE ICI : la
  -- cohérence legacy a disparu avec la colonne, et le ciblage qu'elle imposait
  -- n'a plus lieu d'être.
  perform pg_temp.noter('M-D', 'une unité hors (g, ml) est refusée',
    pg_temp.refuse_pour($q$ update public.meal_choice_options set quantity_unit = 'piece'
                            where slot_id = 'd5200000-0000-4000-8000-00000000a501' $q$,
                        'meal_choice_options_quantity_unit_check'));
end $$;

-- ---------------------------------------------------------------------
-- ROLL → CONTRACT — LA TRANSITION EST TERMINÉE
--
-- ⚠️ CETTE SECTION GARDAIT L'EXPAND : copie 1:1, double écriture, cohérence
-- des deux unités. Le CONTRACT du 2026-09-13 a supprimé la colonne legacy ;
-- ces contrôles n'ont plus d'objet, et les GARDER VERTS artificiellement
-- (« la contrainte de cohérence existe ») affirmerait une transition encore en
-- cours. On garde donc ce qui reste vrai, et une seule chose reste vraie :
-- l'unité neuve porte TOUTE la donnée, seule.
--
-- La preuve que la copie 1:1 n'a rien perdu vit désormais dans
-- `nutrition_contract_preferred_unit_checklist.sql`, sur des données de forme
-- production.
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('CONTRACT', 'quantity_unit est SEULE : aucune unité legacy ne subsiste', (
    select count(*) = 0 from information_schema.columns
     where table_schema='public' and table_name='meal_choice_options'
       and column_name like '%unit%' and column_name <> 'quantity_unit'));

  perform pg_temp.noter('CONTRACT', 'la contrainte métier de N1.5.2 est INTACTE', (
    select count(*) = 1 from pg_constraint
     where conrelid = 'public.meal_choice_options'::regclass
       and conname = 'meal_choice_options_quantites_unite'));
  perform pg_temp.noter('CONTRACT', 'le vocabulaire (g, ml) est INTACT', (
    select count(*) = 1 from pg_constraint
     where conrelid = 'public.meal_choice_options'::regclass
       and conname = 'meal_choice_options_quantity_unit_check'));

  -- ⚠️ LE CAS NEUF DE N1.5.2 SURVIT AU CONTRACT : un minimum SEUL, sans
  -- portion. C'était la raison d'être de tout le chantier d'unité.
  perform pg_temp.noter('CONTRACT', 'un minimum SEUL vit toujours, sans aucune unité legacy', (
    select count(*) = 1 from public.meal_choice_options
     where slot_id = 'd5200000-0000-4000-8000-00000000a501'
       and minimum_quantity = 5 and quantity_unit = 'g'));
end $$;

-- ---------------------------------------------------------------------
-- M-I — LA RPC NE RÉSOUT RIEN, ET N'ÉCRIT AUCUNE CONSOMMATION
-- ---------------------------------------------------------------------
do $$
declare v_src text := pg_temp.sans_prose(pg_get_functiondef('public.save_nutrition_plan_v2(jsonb)'::regprocedure));
begin
  perform pg_temp.noter('M-I', 'la RPC ne lit jamais food_list_items', v_src not like '%food_list_items%');
  perform pg_temp.noter('M-I', 'la RPC ne lit jamais food_catalog', v_src not like '%public.food_catalog%');
  perform pg_temp.noter('M-I', 'la RPC n''écrit jamais consumed_meals', v_src not like '%consumed_meals%');
  perform pg_temp.noter('M-I', 'la RPC n''écrit jamais meal_entries', v_src not like '%meal_entries%');
  perform pg_temp.noter('M-I', 'la RPC ne code aucun plafond',
    v_src not like '%300%' and v_src not like '%500%');
  perform pg_temp.noter('M-H', 'la RPC écrit bien minimum_quantity', v_src like '%minimum_quantity%');
  perform pg_temp.noter('M-H', 'la RPC lit quantity_unit', v_src like '%quantity_unit%');

  -- ⚠️ LE REFUS DE N1.5.1 EST CONSERVÉ, PAS RENOMMÉ. Un message d'erreur est
  -- lisible par du code déployé : le rebaptiser « QUANTITE_SANS_UNITE » aurait
  -- été un rename de plus, pour un gain nul. Le cas NEUF — un minimum sans
  -- unité — reçoit un nom neuf, et lui seul.
  perform pg_temp.noter('M-K', 'PORTION_SANS_UNITE de N1.5.1 est CONSERVÉ', v_src like '%PORTION_SANS_UNITE%');
  perform pg_temp.noter('M-K', 'la RPC refuse un minimum sans unité', v_src like '%MINIMUM_SANS_UNITE%');
  perform pg_temp.noter('M-K', 'la RPC refuse un minimum non positif', v_src like '%MINIMUM_NON_POSITIF%');

  -- ⚠️ LA DOUBLE ÉCRITURE A DISPARU AVEC LA COLONNE. Elle protégeait le
  -- rollout ; le rollout est terminé.
  perform pg_temp.noter('CONTRACT', 'la RPC n''écrit plus preferred_unit',
    v_src not like '%preferred_unit =%');

  -- ⚠️ MAIS LA CLÉ D'ENTRÉE SURVIT, ET C'EST DÉLIBÉRÉ : un onglet ouvert avant
  -- le déploiement peut encore poster l'ancienne clé. Le CONTRACT retire une
  -- dépendance de STOCKAGE, pas une politesse d'entrée.
  perform pg_temp.noter('CONTRACT', 'la RPC accepte encore preferred_unit EN ENTRÉE',
    v_src like '%v_option->>''preferred_unit''%');
end $$;

-- ---------------------------------------------------------------------
-- ROLL — LA DOUBLE ÉCRITURE, EXÉCUTÉE PAR LA VRAIE RPC
--
-- ⚠️ LIRE LE `prosrc` NE SUFFIT PAS. Une chaîne présente dans la source ne
-- prouve pas qu'elle est ATTEINTE. Ici on appelle vraiment la fonction, et on
-- relit vraiment les deux colonnes.
-- ---------------------------------------------------------------------
create or replace function pg_temp.six_creneaux()
returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object(
           'slot', s.slot, 'enabled', s.slot = 'breakfast',
           'protein_bp', case when s.slot = 'breakfast' then 10000 else 0 end,
           'carb_bp',    case when s.slot = 'breakfast' then 10000 else 0 end,
           'fat_bp',     case when s.slot = 'breakfast' then 10000 else 0 end,
           'display_order', s.ord) order by s.ord)
    from (values ('breakfast',1),('morning_snack',2),('lunch',3),
                 ('afternoon_snack',4),('dinner',5),('dessert',6)) as s(slot, ord);
$$;

create or replace function pg_temp.payload(p_options jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'plan_id', 'd5200000-0000-4000-8000-00000000b001',
    'plan', jsonb_build_object('name', 'Plan N152', 'status', 'actif'),
    'profile', jsonb_build_object('profile_key', 'default', 'daily_calories', 2000,
                                  'protein_bp', 3000, 'carb_bp', 4000, 'fat_bp', 3000),
    'slots', pg_temp.six_creneaux(),
    'main_profile_key', 'default',
    'profiles', jsonb_build_array(jsonb_build_object(
      'profile_key','default','daily_calories',2000,'protein_bp',3000,'carb_bp',4000,'fat_bp',3000,
      'slots', pg_temp.six_creneaux())),
    'days', jsonb_build_array(jsonb_build_object(
      'day', 'monday', 'profile_key', 'default', 'meals', jsonb_build_array(
        jsonb_build_object(
          'id', 'd5200000-0000-4000-8000-00000000e001',
          'slot', 'breakfast', 'name', 'PDJ', 'items', '[]'::jsonb,
          'choice_slots', jsonb_build_array(jsonb_build_object(
            'id', null, 'label', 'Occurrence N152 RPC',
            'source_list_id', 'd5200000-0000-4000-8000-00000000a001',
            'options', p_options)))))));
$$;

do $$
declare s text;
begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant execute on all functions in schema %I to authenticated, anon', s);
end $$;

set local role authenticated;
select pg_temp.connecte('d5200000-0000-4000-8000-0000000000c1');

do $$
begin
  perform public.save_nutrition_plan_v2(pg_temp.payload(jsonb_build_array(
    -- Une PORTION préférée, exprimée avec la clé NEUVE uniquement.
    jsonb_build_object('catalog_food_id', 'd5200000-0000-4000-8000-00000000f001',
                       'preferred_quantity', 25, 'quantity_unit', 'g'),
    -- Un MINIMUM SEUL — le cas que N1.5.1 ne savait pas écrire.
    jsonb_build_object('catalog_food_id', 'd5200000-0000-4000-8000-00000000f002',
                       'minimum_quantity', 5, 'quantity_unit', 'g'))));

  -- ⚠️ LE CŒUR DE L'EXPAND : le nouveau code n'envoie QUE `quantity_unit`, et
  -- l'ancienne colonne est remplie quand même. Un lecteur non redéployé
  -- comprend donc un repas construit aujourd'hui.
  perform pg_temp.noter('CONTRACT', 'une portion écrite par la RPC porte quantity_unit', (
    select o.preferred_quantity = 25 and o.quantity_unit = 'g'
       from public.meal_choice_options o
      where o.catalog_food_id = 'd5200000-0000-4000-8000-00000000f001'
        and o.slot_id in (select id from public.meal_choice_slots where label = 'Occurrence N152 RPC')));

  -- ⚠️ ET UN MINIMUM SEUL NE REMPLIT PAS L'ANCIENNE. Elle ne dit que l'unité
  -- d'une PORTION : lui faire dire celle d'un minimum tromperait l'ancien
  -- lecteur, qui en déduirait une portion qui n'existe pas.
  perform pg_temp.noter('CONTRACT', 'un minimum seul reste écrit sans portion', (
    select o.minimum_quantity = 5 and o.quantity_unit = 'g'
       and o.preferred_quantity is null
       from public.meal_choice_options o
      where o.catalog_food_id = 'd5200000-0000-4000-8000-00000000f002'
        and o.slot_id in (select id from public.meal_choice_slots where label = 'Occurrence N152 RPC')));

  perform pg_temp.noter('M-K', 'un minimum sans unité est refusé (MINIMUM_SANS_UNITE)',
    pg_temp.refuse_pour($q$ select public.save_nutrition_plan_v2(pg_temp.payload(jsonb_build_array(
        jsonb_build_object('catalog_food_id', 'd5200000-0000-4000-8000-00000000f001',
                           'minimum_quantity', 5)))) $q$,
      'MINIMUM_SANS_UNITE'));
  perform pg_temp.noter('M-K', 'une portion sans unité reste refusée (PORTION_SANS_UNITE)',
    pg_temp.refuse_pour($q$ select public.save_nutrition_plan_v2(pg_temp.payload(jsonb_build_array(
        jsonb_build_object('catalog_food_id', 'd5200000-0000-4000-8000-00000000f001',
                           'preferred_quantity', 25)))) $q$,
      'PORTION_SANS_UNITE'));
  perform pg_temp.noter('M-K', 'un minimum non positif est refusé (MINIMUM_NON_POSITIF)',
    pg_temp.refuse_pour($q$ select public.save_nutrition_plan_v2(pg_temp.payload(jsonb_build_array(
        jsonb_build_object('catalog_food_id', 'd5200000-0000-4000-8000-00000000f001',
                           'minimum_quantity', 0, 'quantity_unit', 'g')))) $q$,
      'MINIMUM_NON_POSITIF'));

  -- ⚠️ ET L'ALIAS D'ENTRÉE TIENT TOUJOURS : une charge utile écrite AVANT ce
  -- lot, qui ne connaît que `preferred_unit`, reste valide et remplit les deux.
  perform public.save_nutrition_plan_v2(pg_temp.payload(jsonb_build_array(
    jsonb_build_object('catalog_food_id', 'd5200000-0000-4000-8000-00000000f001',
                       'preferred_quantity', 40, 'preferred_unit', 'ml'))));
  -- ⚠️ ET L'ALIAS D'ENTRÉE SURVIT AU CONTRACT. Une charge utile écrite avant
  -- le déploiement ne connaît que `preferred_unit` ; elle reste comprise, et
  -- alimente `quantity_unit`.
  perform pg_temp.noter('CONTRACT', 'une charge utile ANCIENNE (preferred_unit) alimente quantity_unit', (
    select o.preferred_quantity = 40 and o.quantity_unit = 'ml'
       from public.meal_choice_options o
      where o.catalog_food_id = 'd5200000-0000-4000-8000-00000000f001'
        and o.slot_id in (select id from public.meal_choice_slots where label = 'Occurrence N152 RPC')));
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
  raise notice 'N1.5.2 · QUANTITÉ MINIMALE — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

-- ---------------------------------------------------------------------
-- Section Z — APRÈS LE ROLLBACK, VÉRIFIÉ ET NON SUPPOSÉ
-- ---------------------------------------------------------------------
-- ⚠️ CE BLOC EST HORS TRANSACTION, ET C'EST TOUT SON INTÉRÊT. Les checklists
-- précédentes ANNONÇAIENT cette section dans leur en-tête sans jamais
-- l'exécuter : le `rollback` final la rendait « évidente ». Une garantie
-- évidente est une garantie non mesurée. Ici on regarde vraiment.
do $$
declare v_restes int;
begin
  select
      (select count(*) from public.food_catalog        where id::text like 'd5200000%')
    + (select count(*) from public.food_lists          where id::text like 'd5200000%')
    + (select count(*) from public.food_list_items     where list_id::text like 'd5200000%')
    + (select count(*) from public.coaches             where id::text like 'd5200000%')
    + (select count(*) from public.profiles            where user_id::text like 'd5200000%')
    + (select count(*) from auth.users                 where id::text like 'd5200000%')
    + (select count(*) from public.meal_choice_slots   where label like 'Occurrence N152%')
    + (select count(*) from public.nutrition_plans     where id::text like 'd5200000%')
    into v_restes;

  if v_restes > 0 then
    raise exception 'Z · ÉCHEC : % ligne(s) de test ont survécu au rollback', v_restes;
  end if;
  raise notice 'OK      — Z · aucune donnée de test ne subsiste (vérifié, pas supposé)';
end $$;
