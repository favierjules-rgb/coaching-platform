-- ============================================================================
-- Checklist PostgreSQL — N1.5.1, LES PORTIONS PRÉFÉRÉES HYBRIDES
--
-- CE QU'ELLE VÉRIFIE
--   P-A   les cinq colonnes existent, nullables, au bon type
--   P-B   les contraintes de positivité refusent 0 et le négatif
--   P-C   la paire quantité/unité du snapshot est indissociable
--   P-D   le vocabulaire d'unité du snapshot est ('g','ml') — ni piece, ni portion
--   P-E   AUCUN BACKFILL : tout est NULL après migration
--   P-F   la RPC snapshote la portion effective reçue
--   P-G   la RPC ne RÉSOUT rien : elle ne lit ni la bibliothèque ni le catalogue
--   P-H   le snapshot NE SUIT PAS la bibliothèque (override et standard modifiés après coup)
--   P-I   rétrocompatibilité : une charge utile sans les clés laisse NULL
--   P-J   refus explicites : PORTION_SANS_UNITE / NON_POSITIVE / UNITE_INCONNUE
--   P-K   atomicité : un refus de portion n'écrit RIEN
--   P-L   la RLS n'a pas bougé : aucune policy créée, l'override reste scopé au coach
--   P-M   une portion supérieure au plafond N1.5 est ACCEPTÉE en base (préférence soft)
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
-- Section P-A / P-B / P-C / P-D — LE SCHÉMA, AVANT TOUTE DONNÉE
-- ---------------------------------------------------------------------
do $$
declare v_col record;
begin
  -- Les cinq colonnes, au bon type, TOUTES nullables (§24 : rétrocompatibilité).
  for v_col in
    select * from (values
      ('food_catalog',        'preferred_quantity',          'numeric'),
      ('food_products',       'preferred_quantity',          'numeric'),
      ('food_list_items',     'preferred_quantity_override', 'numeric'),
      ('meal_choice_options', 'preferred_quantity',          'numeric'),
      ('meal_choice_options', 'preferred_unit',              'text')
    ) as t(tbl, col, typ)
  loop
    perform pg_temp.noter('P-A', format('%s.%s existe, %s, nullable', v_col.tbl, v_col.col, v_col.typ), (
      select c.data_type = v_col.typ and c.is_nullable = 'YES'
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = v_col.tbl and c.column_name = v_col.col));
  end loop;

  -- ⚠️ AUCUN DEFAULT. Une valeur par défaut ferait naître une préférence là où
  -- personne n'en a exprimé, et le solveur la suivrait.
  perform pg_temp.noter('P-A', 'aucune des cinq colonnes ne porte de DEFAULT', (
    select count(*) = 0 from information_schema.columns
     where table_schema = 'public'
       and column_name in ('preferred_quantity', 'preferred_unit', 'preferred_quantity_override')
       and column_default is not null));
end $$;

-- P-B — zéro et négatif refusés, NULL accepté.
insert into public.food_catalog (id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100)
values ('d5100000-0000-4000-8000-00000000f001', 'N151 Whey', 'g', 80, 5, 2);

do $$
begin
  perform pg_temp.noter('P-B', 'food_catalog : une portion NULLE est refusée',
    pg_temp.refuse_pour($q$ update public.food_catalog set preferred_quantity = 0
                            where id = 'd5100000-0000-4000-8000-00000000f001' $q$,
                        'food_catalog_preferred_quantity_positive'));
  perform pg_temp.noter('P-B', 'food_catalog : une portion NÉGATIVE est refusée',
    pg_temp.refuse_pour($q$ update public.food_catalog set preferred_quantity = -30
                            where id = 'd5100000-0000-4000-8000-00000000f001' $q$,
                        'food_catalog_preferred_quantity_positive'));
  perform pg_temp.noter('P-B', 'food_catalog : une portion POSITIVE est acceptée', (
    select pg_temp.compte($q$
      with maj as (update public.food_catalog set preferred_quantity = 30
                    where id = 'd5100000-0000-4000-8000-00000000f001' returning 1)
      select count(*) from maj $q$) = 1));
end $$;

update public.food_catalog set preferred_quantity = 30
 where id = 'd5100000-0000-4000-8000-00000000f001';

do $$
begin
  perform pg_temp.noter('P-B', 'food_catalog : 30 g est bien enregistré', (
    select preferred_quantity = 30 from public.food_catalog
     where id = 'd5100000-0000-4000-8000-00000000f001'));

  -- ⚠️ ET LA PORTION EST DÉCIMALE. 2,5 cuillères existent ; un `integer`
  -- aurait arrondi en silence.
  perform pg_temp.noter('P-B', 'une portion décimale est conservée telle quelle', (
    select pg_temp.compte($q$
      with maj as (
        update public.food_catalog set preferred_quantity = 12.5
         where id = 'd5100000-0000-4000-8000-00000000f001' returning preferred_quantity)
      select count(*) from maj where preferred_quantity = 12.5 $q$) = 1));
end $$;

update public.food_catalog set preferred_quantity = 30
 where id = 'd5100000-0000-4000-8000-00000000f001';

-- P-C / P-D — la paire du snapshot, et son vocabulaire.
do $$
begin
  perform pg_temp.noter('P-C', 'la contrainte de PAIRE quantité/unité existe', (
    select count(*) = 1 from pg_constraint
     where conrelid = 'public.meal_choice_options'::regclass
       and conname = 'meal_choice_options_preferred_paire'));
  perform pg_temp.noter('P-C', 'la paire est écrite comme une ÉQUIVALENCE de nullité', (
    select upper(pg_get_constraintdef(oid)) like '%IS NULL) = (%IS NULL)%'
       from pg_constraint
      where conrelid = 'public.meal_choice_options'::regclass
        and conname = 'meal_choice_options_preferred_paire'));

  perform pg_temp.noter('P-D', 'le vocabulaire d''unité du snapshot est exactement (g, ml)', (
    select pg_get_constraintdef(oid) like '%''g''%' and pg_get_constraintdef(oid) like '%''ml''%'
       from pg_constraint
      where conrelid = 'public.meal_choice_options'::regclass
        and conname = 'meal_choice_options_preferred_unit_check'));

  -- ⚠️ NI « PIECE », NI « PORTION ». `meal_entries` les accepte parce qu'un
  -- ÉLÈVE les tape ; ici la valeur est lue par un SOLVEUR, et aucune des deux
  -- n'est convertible sans une donnée que ce schéma n'a pas.
  perform pg_temp.noter('P-D', 'ni « piece » ni « portion » n''entrent dans le snapshot', (
    select pg_get_constraintdef(oid) not like '%piece%' and pg_get_constraintdef(oid) not like '%portion%'
       from pg_constraint
      where conrelid = 'public.meal_choice_options'::regclass
        and conname = 'meal_choice_options_preferred_unit_check'));
end $$;

-- ---------------------------------------------------------------------
-- Section P-E — AUCUN BACKFILL
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('P-E', 'food_catalog : aucune portion posée par la migration', (
    select count(*) = 0 from public.food_catalog
     where preferred_quantity is not null
       and id <> 'd5100000-0000-4000-8000-00000000f001'));
  perform pg_temp.noter('P-E', 'food_products : aucune portion posée par la migration', (
    select count(*) = 0 from public.food_products where preferred_quantity is not null));
  perform pg_temp.noter('P-E', 'food_list_items : aucun override posé par la migration', (
    select count(*) = 0 from public.food_list_items where preferred_quantity_override is not null));
  perform pg_temp.noter('P-E', 'meal_choice_options : aucun snapshot posé par la migration', (
    select count(*) = 0 from public.meal_choice_options where preferred_quantity is not null));
end $$;

-- ---------------------------------------------------------------------
-- Section 0 — LE BANC
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d5100000-0000-4000-8000-0000000000c1', 'n151-coach-1@test.invalid'),
  ('d5100000-0000-4000-8000-0000000000c2', 'n151-coach-2@test.invalid');

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('d5100000-0000-4000-8000-0000000000c1', 'coach', 'N151', 'Coach1', 'n151-coach-1@test.invalid'),
  ('d5100000-0000-4000-8000-0000000000c2', 'coach', 'N151', 'Coach2', 'n151-coach-2@test.invalid');

insert into public.coaches (id, user_id, name, email) values
  ('d5100000-0000-4000-8000-00000000c001', 'd5100000-0000-4000-8000-0000000000c1', 'Coach N151 1', 'n151-coach-1@test.invalid'),
  ('d5100000-0000-4000-8000-00000000c002', 'd5100000-0000-4000-8000-0000000000c2', 'Coach N151 2', 'n151-coach-2@test.invalid');

insert into public.food_catalog (id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100)
values ('d5100000-0000-4000-8000-00000000f002', 'N151 Fromage blanc', 'g', 7, 4, 0);

-- DEUX listes du même coach, contenant le MÊME aliment : c'est le banc du
-- « deux overrides différents pour une même whey ».
insert into public.food_lists (id, coach_id, name) values
  ('d5100000-0000-4000-8000-00000000a001', 'd5100000-0000-4000-8000-00000000c001', 'Liste A'),
  ('d5100000-0000-4000-8000-00000000a002', 'd5100000-0000-4000-8000-00000000c001', 'Liste B');

insert into public.food_list_items (list_id, position, catalog_food_id, preferred_quantity_override) values
  ('d5100000-0000-4000-8000-00000000a001', 1, 'd5100000-0000-4000-8000-00000000f001', 25),
  ('d5100000-0000-4000-8000-00000000a001', 2, 'd5100000-0000-4000-8000-00000000f002', null),
  ('d5100000-0000-4000-8000-00000000a002', 1, 'd5100000-0000-4000-8000-00000000f001', 35);

do $$
begin
  -- ⚠️ LA MÊME WHEY, DEUX OVERRIDES, SANS QUE LE STANDARD BOUGE.
  perform pg_temp.noter('P-F', 'deux listes portent deux overrides différents du même aliment', (
    select count(distinct preferred_quantity_override) = 2
       from public.food_list_items
      where catalog_food_id = 'd5100000-0000-4000-8000-00000000f001'));
  perform pg_temp.noter('P-F', 'le standard de l''identité est resté à 30', (
    select preferred_quantity = 30 from public.food_catalog
     where id = 'd5100000-0000-4000-8000-00000000f001'));
end $$;

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

create or replace function pg_temp.payload(p_plan_id uuid, p_meals jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'plan_id', p_plan_id,
    'plan', jsonb_build_object('name', 'Plan N151', 'status', 'actif'),
    'profile', jsonb_build_object('profile_key', 'default', 'daily_calories', 2000,
                                  'protein_bp', 3000, 'carb_bp', 4000, 'fat_bp', 3000),
    'slots', pg_temp.six_creneaux(),
    'main_profile_key', 'default',
    'profiles', jsonb_build_array(jsonb_build_object(
      'profile_key','default','daily_calories',2000,'protein_bp',3000,'carb_bp',4000,'fat_bp',3000,
      'slots', pg_temp.six_creneaux())),
    'days', jsonb_build_array(jsonb_build_object(
      'day', 'monday', 'profile_key', 'default', 'meals', p_meals))
  );
$$;

do $$
declare s text;
begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant execute on all functions in schema %I to authenticated, anon', s);
end $$;

set local role authenticated;
select pg_temp.connecte('d5100000-0000-4000-8000-0000000000c1');

do $$
declare v_res jsonb;
begin
  v_res := public.save_nutrition_plan_v2(pg_temp.payload(null, jsonb_build_array(
    jsonb_build_object('id', 'd5100000-0000-4000-8000-00000000e001',
                       'slot', 'breakfast', 'name', 'Petit-déjeuner', 'items', '[]'::jsonb))));
  perform set_config('n151.plan_id', v_res #>> '{plan,id}', true);
end $$;

-- ---------------------------------------------------------------------
-- Section P-F — LA RPC SNAPSHOTE LA PORTION EFFECTIVE REÇUE
-- ---------------------------------------------------------------------
do $$
declare v_plan uuid := current_setting('n151.plan_id')::uuid;
begin
  perform public.save_nutrition_plan_v2(pg_temp.payload(v_plan, jsonb_build_array(
    jsonb_build_object(
      'id', 'd5100000-0000-4000-8000-00000000e001',
      'slot', 'breakfast', 'name', 'Petit-déjeuner', 'items', '[]'::jsonb,
      'choice_slots', jsonb_build_array(jsonb_build_object(
        'id', null, 'label', 'Ta protéine',
        'source_list_id', 'd5100000-0000-4000-8000-00000000a001',
        'options', jsonb_build_array(
          -- L'override du coach, DÉJÀ RÉSOLU par la couche appelante.
          jsonb_build_object('catalog_food_id', 'd5100000-0000-4000-8000-00000000f001',
                             'preferred_quantity', 25, 'preferred_unit', 'g'),
          -- Aucune préférence métier : les deux clés restent absentes.
          jsonb_build_object('catalog_food_id', 'd5100000-0000-4000-8000-00000000f002')
        )))))));

  perform pg_temp.noter('P-F', 'la portion effective (override 25 g) est snapshotée', (
    select o.preferred_quantity = 25 and o.preferred_unit = 'g'
       from public.meal_choice_options o
      where o.catalog_food_id = 'd5100000-0000-4000-8000-00000000f001'));

  perform pg_temp.noter('P-F', 'une option sans préférence garde les DEUX colonnes nulles', (
    select o.preferred_quantity is null and o.preferred_unit is null
       from public.meal_choice_options o
      where o.catalog_food_id = 'd5100000-0000-4000-8000-00000000f002'));

  -- ⚠️ 25 ET NON 30 : c'est bien l'OVERRIDE qui a gagné, pas le standard.
  perform pg_temp.noter('P-F', 'l''override l''emporte sur le standard (25, pas 30)', (
    select o.preferred_quantity <> 30
       from public.meal_choice_options o
      where o.catalog_food_id = 'd5100000-0000-4000-8000-00000000f001'));
end $$;

-- ---------------------------------------------------------------------
-- Section P-G — LA RPC NE RÉSOUT RIEN
-- ---------------------------------------------------------------------
do $$
declare v_src text := pg_temp.sans_prose(pg_get_functiondef('public.save_nutrition_plan_v2(jsonb)'::regprocedure));
begin
  -- ⚠️ SI LA RPC LISAIT LA BIBLIOTHÈQUE, LE SNAPSHOT NE SERAIT PLUS UN
  -- SNAPSHOT : il se recalculerait à chaque sauvegarde, et modifier une liste
  -- changerait un repas déjà construit.
  perform pg_temp.noter('P-G', 'la RPC ne lit jamais food_list_items',
    v_src not like '%food_list_items%');
  perform pg_temp.noter('P-G', 'la RPC ne lit jamais food_lists pour résoudre une portion',
    v_src not like '%from public.food_lists%');
  perform pg_temp.noter('P-G', 'la RPC ne lit jamais food_catalog',
    v_src not like '%public.food_catalog%');
  perform pg_temp.noter('P-G', 'la RPC ne lit jamais food_products',
    v_src not like '%public.food_products%');
  -- Et elle ne fabrique aucune valeur de repli.
  perform pg_temp.noter('P-G', 'la RPC ne pose aucune portion par défaut',
    v_src not like '%coalesce(v_opt_pref%');
end $$;

-- ---------------------------------------------------------------------
-- Section P-H — LE SNAPSHOT NE SUIT PAS LA BIBLIOTHÈQUE
-- ---------------------------------------------------------------------
set local role postgres;
update public.food_catalog set preferred_quantity = 999
 where id = 'd5100000-0000-4000-8000-00000000f001';
update public.food_list_items set preferred_quantity_override = 888
 where list_id = 'd5100000-0000-4000-8000-00000000a001'
   and catalog_food_id = 'd5100000-0000-4000-8000-00000000f001';
set local role authenticated;
select pg_temp.connecte('d5100000-0000-4000-8000-0000000000c1');

do $$
begin
  -- ⚠️ NI LE STANDARD NI L'OVERRIDE NE REDESCENDENT DANS UN REPAS DÉJÀ FIGÉ.
  -- C'est exactement la garantie que N1.3 avait posée pour les identités.
  perform pg_temp.noter('P-H', 'changer le STANDARD ne touche aucun snapshot existant', (
    select o.preferred_quantity = 25
       from public.meal_choice_options o
      where o.catalog_food_id = 'd5100000-0000-4000-8000-00000000f001'));
  perform pg_temp.noter('P-H', 'changer l''OVERRIDE ne touche aucun snapshot existant', (
    select o.preferred_quantity <> 888
       from public.meal_choice_options o
      where o.catalog_food_id = 'd5100000-0000-4000-8000-00000000f001'));
end $$;

-- ---------------------------------------------------------------------
-- Section P-I — RÉTROCOMPATIBILITÉ
-- ---------------------------------------------------------------------
do $$
declare v_plan uuid := current_setting('n151.plan_id')::uuid;
begin
  -- Une charge utile d'AVANT N1.5.1 : les options n'ont que leur identité.
  perform public.save_nutrition_plan_v2(pg_temp.payload(v_plan, jsonb_build_array(
    jsonb_build_object(
      'id', 'd5100000-0000-4000-8000-00000000e001',
      'slot', 'breakfast', 'name', 'Petit-déjeuner', 'items', '[]'::jsonb,
      'choice_slots', jsonb_build_array(jsonb_build_object(
        'id', null, 'label', 'Ancienne occurrence',
        'source_list_id', null,
        'options', jsonb_build_array(
          jsonb_build_object('catalog_food_id', 'd5100000-0000-4000-8000-00000000f002')
        )))))));

  perform pg_temp.noter('P-I', 'une charge utile sans les clés laisse les colonnes NULL', (
    select count(*) = 0 from public.meal_choice_options o
      join public.meal_choice_slots s on s.id = o.slot_id
     where s.label = 'Ancienne occurrence' and o.preferred_quantity is not null));

  -- ⚠️ ET UNE CHARGE UTILE SANS `choice_slots` DU TOUT reste valide : c'est la
  -- rétrocompatibilité N1.3, que N1.5.1 ne doit pas casser.
  perform pg_temp.noter('P-I', 'une charge utile sans choice_slots passe toujours',
    pg_temp.compte($q$
      select count(*) from (select public.save_nutrition_plan_v2(
        pg_temp.payload(current_setting('n151.plan_id')::uuid, jsonb_build_array(
          jsonb_build_object('id', 'd5100000-0000-4000-8000-00000000e001',
                             'slot', 'breakfast', 'name', 'PDJ', 'items', '[]'::jsonb)))) ) t $q$) = 1);
end $$;

-- ---------------------------------------------------------------------
-- Section P-J / P-K — LES REFUS, ET L'ATOMICITÉ
-- ---------------------------------------------------------------------
create or replace function pg_temp.payload_portion(p_qte text, p_unite text)
returns jsonb language sql stable as $$
  select pg_temp.payload(current_setting('n151.plan_id')::uuid, jsonb_build_array(
    jsonb_build_object(
      'id', 'd5100000-0000-4000-8000-00000000e001',
      'slot', 'breakfast', 'name', 'Petit-déjeuner', 'items', '[]'::jsonb,
      'choice_slots', jsonb_build_array(jsonb_build_object(
        'id', null, 'label', 'Occurrence fautive', 'source_list_id', null,
        'options', jsonb_build_array(
          (jsonb_build_object('catalog_food_id', 'd5100000-0000-4000-8000-00000000f001')
           || case when p_qte  is null then '{}'::jsonb else jsonb_build_object('preferred_quantity', p_qte::numeric) end
           || case when p_unite is null then '{}'::jsonb else jsonb_build_object('preferred_unit', p_unite) end)
        ))))));
$$;

do $$
declare s text;
begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant execute on all functions in schema %I to authenticated, anon', s);
end $$;

do $$
begin
  perform pg_temp.noter('P-J', 'une quantité SANS unité est refusée (PORTION_SANS_UNITE)',
    pg_temp.refuse_pour($q$ select public.save_nutrition_plan_v2(pg_temp.payload_portion('30', null)) $q$,
                        'PORTION_SANS_UNITE'));
  perform pg_temp.noter('P-J', 'une unité SANS quantité est refusée (PORTION_SANS_UNITE)',
    pg_temp.refuse_pour($q$ select public.save_nutrition_plan_v2(pg_temp.payload_portion(null, 'g')) $q$,
                        'PORTION_SANS_UNITE'));
  perform pg_temp.noter('P-J', 'une quantité nulle est refusée (PORTION_NON_POSITIVE)',
    pg_temp.refuse_pour($q$ select public.save_nutrition_plan_v2(pg_temp.payload_portion('0', 'g')) $q$,
                        'PORTION_NON_POSITIVE'));
  perform pg_temp.noter('P-J', 'une quantité négative est refusée (PORTION_NON_POSITIVE)',
    pg_temp.refuse_pour($q$ select public.save_nutrition_plan_v2(pg_temp.payload_portion('-5', 'g')) $q$,
                        'PORTION_NON_POSITIVE'));
  perform pg_temp.noter('P-J', '« piece » est refusée (PORTION_UNITE_INCONNUE)',
    pg_temp.refuse_pour($q$ select public.save_nutrition_plan_v2(pg_temp.payload_portion('1', 'piece')) $q$,
                        'PORTION_UNITE_INCONNUE'));
  perform pg_temp.noter('P-J', '« portion » est refusée (PORTION_UNITE_INCONNUE)',
    pg_temp.refuse_pour($q$ select public.save_nutrition_plan_v2(pg_temp.payload_portion('1', 'portion')) $q$,
                        'PORTION_UNITE_INCONNUE'));

  -- ⚠️ ET LE REFUS N'A RIEN ÉCRIT. La RPC est une transaction : l'occurrence
  -- fautive ne doit exister nulle part.
  perform pg_temp.noter('P-K', 'un refus de portion n''écrit AUCUNE occurrence', (
    select count(*) = 0 from public.meal_choice_slots where label = 'Occurrence fautive'));
end $$;

-- ---------------------------------------------------------------------
-- Section P-L — LA RLS N'A PAS BOUGÉ
-- ---------------------------------------------------------------------
do $$
begin
  -- Aucune policy créée par ce lot : les compteurs des quatre tables sont ceux
  -- que N1.1 / A1 / A3 avaient posés.
  perform pg_temp.noter('P-L', 'aucune policy nommée « preferred » n''a été créée', (
    select count(*) = 0 from pg_policies where policyname like '%preferred%'));

  -- L'override reste scopé au coach propriétaire de la liste : la colonne
  -- ajoutée hérite, elle n'ouvre rien.
  perform pg_temp.noter('P-L', 'l''override reste couvert par food_list_items_manage_own_coach', (
    select count(*) = 1 from pg_policies
     where tablename = 'food_list_items' and policyname = 'food_list_items_manage_own_coach'));

  -- ⚠️ ET `food_products` RESTE EN LECTURE SEULE. La colonne y est posée pour
  -- la capacité, pas pour l'écriture : aucun privilège n'a été accordé.
  perform pg_temp.noter('P-L', 'food_products : authenticated n''a toujours que SELECT', (
    select count(*) = 0 from information_schema.role_table_grants
     where table_name = 'food_products' and grantee = 'authenticated'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')));
end $$;

set local role postgres;
select pg_temp.connecte('d5100000-0000-4000-8000-0000000000c2');
set local role authenticated;

do $$
begin
  -- Le coach 2 ne doit pas pouvoir poser un override dans la liste du coach 1.
  perform pg_temp.noter('P-L', 'un coach ne pose pas d''override dans la liste d''un autre', (
    select pg_temp.compte($q$
      with maj as (update public.food_list_items set preferred_quantity_override = 77
                    where list_id = 'd5100000-0000-4000-8000-00000000a001' returning 1)
      select count(*) from maj $q$) = 0));
end $$;

set local role postgres;

-- ---------------------------------------------------------------------
-- Section P-M — LA PRÉFÉRENCE EST SOFT, LE PLAFOND EST HARD
-- ---------------------------------------------------------------------
do $$
begin
  -- ⚠️ 400 g EST ACCEPTÉ EN BASE, ET C'EST VOULU. Le plafond de faisabilité
  -- (300 g / 500 ml) vit dans le SOLVEUR, pas dans le schéma : le transformer
  -- en contrainte ferait d'un arbitrage une erreur métier, et empêcherait un
  -- coach d'exprimer une intention que le calcul saura simplement borner.
  perform pg_temp.noter('P-M', 'une portion de 400 g est acceptée en base', (
    select pg_temp.compte($q$
      with maj as (update public.food_catalog set preferred_quantity = 400
                    where id = 'd5100000-0000-4000-8000-00000000f002' returning 1)
      select count(*) from maj $q$) = 1));
  perform pg_temp.noter('P-M', 'aucune contrainte ne mentionne 300 ou 500', (
    select count(*) = 0 from pg_constraint
     where conrelid in ('public.food_catalog'::regclass, 'public.food_products'::regclass,
                        'public.food_list_items'::regclass, 'public.meal_choice_options'::regclass)
       and (pg_get_constraintdef(oid) like '%300%' or pg_get_constraintdef(oid) like '%500%')));
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
  raise notice 'N1.5.1 · PORTIONS PRÉFÉRÉES — % contrôles, % échec(s)', v_total, v_rouges;
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
      (select count(*) from public.food_catalog        where id::text like 'd5100000%')
    + (select count(*) from public.food_lists          where id::text like 'd5100000%')
    + (select count(*) from public.food_list_items     where list_id::text like 'd5100000%')
    + (select count(*) from public.coaches             where id::text like 'd5100000%')
    + (select count(*) from public.profiles            where user_id::text like 'd5100000%')
    + (select count(*) from auth.users                 where id::text like 'd5100000%')
    + (select count(*) from public.meal_choice_slots   where label in ('Ta protéine', 'Ancienne occurrence', 'Occurrence fautive'))
    into v_restes;

  if v_restes > 0 then
    raise exception 'Z · ÉCHEC : % ligne(s) de test ont survécu au rollback', v_restes;
  end if;
  raise notice 'OK      — Z · aucune donnée de test ne subsiste (vérifié, pas supposé)';
end $$;
