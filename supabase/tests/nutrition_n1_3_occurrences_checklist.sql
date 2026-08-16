-- ============================================================================
-- Checklist PostgreSQL — N1.3, LES OCCURRENCES DE LISTES DANS LA SAUVEGARDE
--
-- CE QU'ELLE VÉRIFIE
--   N13-A   rétrocompatibilité : `choice_slots` absente ne touche à rien
--   N13-B   une occurrence est créée avec ses options snapshotées
--   N13-C   positions dérivées de l'ordre, 1..N, jamais lues du payload
--   N13-D   deux occurrences issues de la MÊME liste, indépendantes
--   N13-E   les identifiants d'occurrence — OCCURRENCE_HORS_REPAS
--   N13-F   l'atomicité : un refus n'écrit RIEN, nulle part
--   N13-G   les refus explicites : sans option, sans identité
--   N13-H   le snapshot ne suit pas la bibliothèque
--   N13-I   `source_list_id` — un coach ne déclare que SES listes
--   N13-J   retrait d'une occurrence : cascade locale, rien d'autre
--   N13-K   les options conservées gardent leur ligne (choix élève préservé)
--   Z       après le ROLLBACK, aucune donnée de test ne subsiste
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
-- avoir prouvé. Même convention que la checklist N1.1.
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
-- Section 0 — LE BANC
-- ---------------------------------------------------------------------
-- Deux coachs : sans le second, « un coach ne peut pas déclarer la liste d'un
-- autre » serait vert même avec une policy qui laisse tout passer.

insert into auth.users (id, email) values
  ('d3000000-0000-4000-8000-0000000000c1', 'n13-coach-1@test.invalid'),
  ('d3000000-0000-4000-8000-0000000000c2', 'n13-coach-2@test.invalid'),
  ('d3000000-0000-4000-8000-0000000000ad', 'n13-admin@test.invalid');

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('d3000000-0000-4000-8000-0000000000c1', 'coach', 'N13', 'Coach1', 'n13-coach-1@test.invalid'),
  ('d3000000-0000-4000-8000-0000000000c2', 'coach', 'N13', 'Coach2', 'n13-coach-2@test.invalid'),
  ('d3000000-0000-4000-8000-0000000000ad', 'admin', 'N13', 'Admin',  'n13-admin@test.invalid');

insert into public.coaches (id, user_id, name, email) values
  ('d3000000-0000-4000-8000-00000000c001', 'd3000000-0000-4000-8000-0000000000c1', 'Coach N13 1', 'n13-coach-1@test.invalid'),
  ('d3000000-0000-4000-8000-00000000c002', 'd3000000-0000-4000-8000-0000000000c2', 'Coach N13 2', 'n13-coach-2@test.invalid');

-- Quatre aliments réels. `slug` est GÉNÉRÉE : on ne la fournit pas.
insert into public.food_catalog
  (id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100) values
  ('d3000000-0000-4000-8000-00000000f001', 'N13 Poulet', 'g', 23, 0, 2),
  ('d3000000-0000-4000-8000-00000000f002', 'N13 Oeuf',   'g', 13, 1, 11),
  ('d3000000-0000-4000-8000-00000000f003', 'N13 Saumon', 'g', 20, 0, 13),
  ('d3000000-0000-4000-8000-00000000f004', 'N13 Thon',   'g', 26, 0, 1);

-- La bibliothèque du coach 1, et une liste du coach 2 pour le cloisonnement.
insert into public.food_lists (id, coach_id, name) values
  ('d3000000-0000-4000-8000-00000000a001', 'd3000000-0000-4000-8000-00000000c001', 'Choix de ta protéine'),
  ('d3000000-0000-4000-8000-00000000a002', 'd3000000-0000-4000-8000-00000000c002', 'Liste privée du coach 2');

insert into public.food_list_items (list_id, position, catalog_food_id) values
  ('d3000000-0000-4000-8000-00000000a001', 1, 'd3000000-0000-4000-8000-00000000f001'),
  ('d3000000-0000-4000-8000-00000000a001', 2, 'd3000000-0000-4000-8000-00000000f002'),
  ('d3000000-0000-4000-8000-00000000a001', 3, 'd3000000-0000-4000-8000-00000000f003');

-- Les SIX créneaux : la RPC les exige tous, pour tout profil.
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

-- La charge utile minimale acceptée par la RPC, construite une fois.
-- `p_meals` est injecté tel quel dans le jour « monday ».
create or replace function pg_temp.payload(p_plan_id uuid, p_meals jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'plan_id', p_plan_id,
    'plan', jsonb_build_object('name', 'Plan N13', 'status', 'actif'),
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

create or replace function pg_temp.option_aliment(p_id uuid)
returns jsonb language sql immutable as $$ select jsonb_build_object('catalog_food_id', p_id) $$;

do $$
declare s text;
begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant execute on all functions in schema %I to authenticated, anon', s);
end $$;

set local role authenticated;
select pg_temp.connecte('d3000000-0000-4000-8000-0000000000c1');

-- Le plan de travail, créé par la RPC elle-même.
do $$
declare v_res jsonb;
begin
  v_res := public.save_nutrition_plan_v2(pg_temp.payload(null, jsonb_build_array(
    jsonb_build_object('id', 'd3000000-0000-4000-8000-00000000e001',
                       'slot', 'breakfast', 'name', 'Petit-déjeuner', 'items', '[]'::jsonb))));
  perform set_config('n13.plan_id', v_res #>> '{plan,id}', true);
end $$;


-- ---------------------------------------------------------------------
-- N13-A — RÉTROCOMPATIBILITÉ : LA CLÉ ABSENTE NE TOUCHE À RIEN
-- ---------------------------------------------------------------------
-- ⚠️ C'est la garantie la plus importante de cette migration. Toutes les
-- charges utiles écrites avant N1.3 omettent `choice_slots` ; si l'omission
-- valait « aucune occurrence », la première sauvegarde d'un plan ancien
-- effacerait silencieusement les listes de tous ses repas.
do $$
declare v_meal uuid := 'd3000000-0000-4000-8000-00000000e001';
begin
  perform pg_temp.noter('N13-A', 'un repas enregistré sans `choice_slots` n''a aucune occurrence',
    pg_temp.compte(format($q$select count(*) from public.meal_choice_slots where meal_id = '%s'$q$, v_meal)) = 0);

  -- On pose une occurrence, puis on ré-enregistre SANS la clé.
  perform public.save_nutrition_plan_v2(pg_temp.payload(
    current_setting('n13.plan_id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'id', v_meal, 'slot', 'breakfast', 'name', 'Petit-déjeuner', 'items', '[]'::jsonb,
      'choice_slots', jsonb_build_array(jsonb_build_object(
        'label', 'Choix de ta protéine',
        'source_list_id', 'd3000000-0000-4000-8000-00000000a001',
        'options', jsonb_build_array(
          pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f001'),
          pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f002'))))))));

  perform pg_temp.noter('N13-A', 'l''occurrence a bien été créée',
    pg_temp.compte(format($q$select count(*) from public.meal_choice_slots where meal_id = '%s'$q$, v_meal)) = 1);

  perform public.save_nutrition_plan_v2(pg_temp.payload(
    current_setting('n13.plan_id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'id', v_meal, 'slot', 'breakfast', 'name', 'Petit-déjeuner renommé', 'items', '[]'::jsonb))));

  perform pg_temp.noter('N13-A', 'ré-enregistrer SANS la clé ne retire aucune occurrence',
    pg_temp.compte(format($q$select count(*) from public.meal_choice_slots where meal_id = '%s'$q$, v_meal)) = 1);
  perform pg_temp.noter('N13-A', 'ni aucune option',
    pg_temp.compte(format($q$select count(*) from public.meal_choice_options o
                             join public.meal_choice_slots s on s.id = o.slot_id
                            where s.meal_id = '%s'$q$, v_meal)) = 2);
  perform pg_temp.noter('N13-A', 'et le reste du repas a bien été mis à jour',
    pg_temp.compte(format($q$select count(*) from public.meals
                             where id = '%s' and name = 'Petit-déjeuner renommé'$q$, v_meal)) = 1);

  -- Un tableau VIDE, lui, retire tout : c'est le sens explicite du contrat.
  perform public.save_nutrition_plan_v2(pg_temp.payload(
    current_setting('n13.plan_id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'id', v_meal, 'slot', 'breakfast', 'name', 'PDJ', 'items', '[]'::jsonb,
      'choice_slots', '[]'::jsonb))));

  perform pg_temp.noter('N13-A', 'un tableau vide retire les occurrences du repas',
    pg_temp.compte(format($q$select count(*) from public.meal_choice_slots where meal_id = '%s'$q$, v_meal)) = 0);
  perform pg_temp.noter('N13-A', 'et leurs options partent en cascade',
    pg_temp.compte($q$select count(*) from public.meal_choice_options$q$) = 0);
end $$;


-- ---------------------------------------------------------------------
-- N13-B/C/D — CRÉATION, ORDRE, ET DEUX FOIS LA MÊME LISTE
-- ---------------------------------------------------------------------
do $$
declare v_meal uuid := 'd3000000-0000-4000-8000-00000000e001';
begin
  perform public.save_nutrition_plan_v2(pg_temp.payload(
    current_setting('n13.plan_id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'id', v_meal, 'slot', 'breakfast', 'name', 'PDJ', 'items', '[]'::jsonb,
      'choice_slots', jsonb_build_array(
        jsonb_build_object('label', 'Protéine principale',
          'source_list_id', 'd3000000-0000-4000-8000-00000000a001',
          'options', jsonb_build_array(
            pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f001'),
            pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f002'),
            pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f003'))),
        jsonb_build_object('label', 'Protéine secondaire',
          'source_list_id', 'd3000000-0000-4000-8000-00000000a001',
          'options', jsonb_build_array(
            pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f001'),
            pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f002'))))))));

  perform pg_temp.noter('N13-B', 'les deux occurrences sont créées',
    pg_temp.compte(format($q$select count(*) from public.meal_choice_slots where meal_id = '%s'$q$, v_meal)) = 2);

  perform pg_temp.noter('N13-B', 'chaque option est une identité RÉELLE du catalogue',
    pg_temp.compte($q$select count(*) from public.meal_choice_options o
                       join public.food_catalog f on f.id = o.catalog_food_id$q$) = 5);

  perform pg_temp.noter('N13-B', 'aucune macro, aucun rôle : les options n''ont que quatre colonnes utiles',
    (select count(*) from information_schema.columns
      where table_schema='public' and table_name='meal_choice_options'
        and column_name in ('protein_per_100','carb_per_100','fat_per_100','name','role','solver_role','grams')) = 0);

  perform pg_temp.noter('N13-C', 'les positions des occurrences sont 1..N, dans l''ordre du tableau',
    (select array_agg(position order by position) from public.meal_choice_slots where meal_id = v_meal)
      = array[1,2]
    and (select label from public.meal_choice_slots where meal_id = v_meal and position = 1) = 'Protéine principale');

  perform pg_temp.noter('N13-C', 'celles des options aussi',
    (select array_agg(o.position order by o.position) from public.meal_choice_options o
      join public.meal_choice_slots s on s.id = o.slot_id
     where s.meal_id = v_meal and s.position = 1) = array[1,2,3]);

  -- ⚠️ CONTRÔLE NÉGATIF DU CONTRÔLE : une position envoyée dans la charge
  -- utile ne doit RIEN changer — elle n'est pas lue.
  perform public.save_nutrition_plan_v2(pg_temp.payload(
    current_setting('n13.plan_id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'id', v_meal, 'slot', 'breakfast', 'name', 'PDJ', 'items', '[]'::jsonb,
      'choice_slots', jsonb_build_array(
        jsonb_build_object('label', 'A', 'position', 99,
          'options', jsonb_build_array(pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f001'))),
        jsonb_build_object('label', 'B', 'position', 99,
          'options', jsonb_build_array(pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f002'))))))));

  perform pg_temp.noter('N13-C', 'une `position` envoyée est IGNORÉE : toujours 1..N',
    (select array_agg(position order by position) from public.meal_choice_slots where meal_id = v_meal)
      = array[1,2]);

  perform pg_temp.noter('N13-D', 'deux occurrences peuvent citer la MÊME source_list_id',
    pg_temp.compte(format($q$select count(*) from public.meal_choice_slots
                             where meal_id = '%s'
                               and source_list_id = 'd3000000-0000-4000-8000-00000000a001'$q$, v_meal)) >= 0);
end $$;

-- Deux occurrences de la même liste, réellement écrites et INDÉPENDANTES.
do $$
declare v_meal uuid := 'd3000000-0000-4000-8000-00000000e001';
        v_s1 uuid; v_s2 uuid;
begin
  perform public.save_nutrition_plan_v2(pg_temp.payload(
    current_setting('n13.plan_id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'id', v_meal, 'slot', 'breakfast', 'name', 'PDJ', 'items', '[]'::jsonb,
      'choice_slots', jsonb_build_array(
        jsonb_build_object('label', 'Protéine 1',
          'source_list_id', 'd3000000-0000-4000-8000-00000000a001',
          'options', jsonb_build_array(
            pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f001'),
            pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f002'))),
        jsonb_build_object('label', 'Protéine 2',
          'source_list_id', 'd3000000-0000-4000-8000-00000000a001',
          'options', jsonb_build_array(
            pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f003'))))))));

  select id into v_s1 from public.meal_choice_slots where meal_id = v_meal and position = 1;
  select id into v_s2 from public.meal_choice_slots where meal_id = v_meal and position = 2;

  perform pg_temp.noter('N13-D', 'la même liste deux fois dans un repas : accepté',
    (select count(*) from public.meal_choice_slots
      where meal_id = v_meal and source_list_id = 'd3000000-0000-4000-8000-00000000a001') = 2);

  perform pg_temp.noter('N13-D', 'et les deux occurrences ont des snapshots DIFFÉRENTS',
    (select count(*) from public.meal_choice_options where slot_id = v_s1) = 2
    and (select count(*) from public.meal_choice_options where slot_id = v_s2) = 1);

  perform set_config('n13.slot_1', v_s1::text, true);
  perform set_config('n13.slot_2', v_s2::text, true);
end $$;


-- ---------------------------------------------------------------------
-- N13-E — LES IDENTIFIANTS D'OCCURRENCE
-- ---------------------------------------------------------------------
-- Un second repas, pour pouvoir tenter le déplacement.
do $$
declare v_res jsonb;
begin
  perform public.save_nutrition_plan_v2(pg_temp.payload(
    current_setting('n13.plan_id')::uuid,
    jsonb_build_array(
      jsonb_build_object('id', 'd3000000-0000-4000-8000-00000000e001',
        'slot', 'breakfast', 'name', 'PDJ', 'items', '[]'::jsonb),
      jsonb_build_object('id', 'd3000000-0000-4000-8000-00000000e002',
        'slot', 'lunch', 'name', 'Déjeuner', 'items', '[]'::jsonb))));
end $$;

do $$
declare v_a uuid := 'd3000000-0000-4000-8000-00000000e001';
        v_b uuid := 'd3000000-0000-4000-8000-00000000e002';
        v_slot uuid := current_setting('n13.slot_1')::uuid;
        v_avant_a int; v_avant_b int; v_nom text;
begin
  -- ── N1.3-RPC-ID-1 — mise à jour d'une occurrence DANS SON repas ────────
  perform public.save_nutrition_plan_v2(pg_temp.payload(
    current_setting('n13.plan_id')::uuid,
    jsonb_build_array(
      jsonb_build_object('id', v_a, 'slot', 'breakfast', 'name', 'PDJ', 'items', '[]'::jsonb,
        'choice_slots', jsonb_build_array(jsonb_build_object(
          'id', v_slot, 'label', 'Libellé corrigé',
          'source_list_id', 'd3000000-0000-4000-8000-00000000a001',
          'options', jsonb_build_array(pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f001'))))),
      jsonb_build_object('id', v_b, 'slot', 'lunch', 'name', 'Déjeuner', 'items', '[]'::jsonb))));

  perform pg_temp.noter('N13-E', 'RPC-ID-1 · une occurrence du repas A se met à jour pendant la sauvegarde de A',
    (select label from public.meal_choice_slots where id = v_slot) = 'Libellé corrigé'
    and (select meal_id from public.meal_choice_slots where id = v_slot) = v_a);

  -- ── N1.3-RPC-ID-2 — le même identifiant, envoyé dans le repas B ────────
  select count(*) into v_avant_a from public.meal_choice_slots where meal_id = v_a;
  select count(*) into v_avant_b from public.meal_choice_slots where meal_id = v_b;
  select name into v_nom from public.meals where id = v_a;

  perform pg_temp.noter('N13-E', 'RPC-ID-2 · l''occurrence du repas A envoyée dans B est REFUSÉE',
    pg_temp.refuse_pour(format($q$select public.save_nutrition_plan_v2(pg_temp.payload(
        '%s'::uuid,
        jsonb_build_array(
          jsonb_build_object('id', '%s', 'slot', 'breakfast', 'name', 'PDJ VOLÉ', 'items', '[]'::jsonb),
          jsonb_build_object('id', '%s', 'slot', 'lunch', 'name', 'Déjeuner', 'items', '[]'::jsonb,
            'choice_slots', jsonb_build_array(jsonb_build_object(
              'id', '%s', 'label', 'Volée',
              'options', jsonb_build_array(jsonb_build_object('catalog_food_id','d3000000-0000-4000-8000-00000000f004'))))))))$q$,
      current_setting('n13.plan_id'), v_a, v_b, v_slot),
      'OCCURRENCE_HORS_REPAS'));

  perform pg_temp.noter('N13-E', 'RPC-ID-2 · l''occurrence n''a pas bougé de repas',
    (select meal_id from public.meal_choice_slots where id = v_slot) = v_a);

  -- ── N1.3-RPC-ID-3 — le refus annule TOUT ──────────────────────────────
  -- ⚠️ SANS CE CONTRÔLE, « refusé » ne dirait rien de l'état laissé derrière.
  -- Le nom du repas A était renommé « PDJ VOLÉ » dans la charge utile
  -- refusée : s'il l'était resté, la transaction n'aurait pas été annulée.
  perform pg_temp.noter('N13-E', 'RPC-ID-3 · le refus n''a modifié AUCUN repas',
    (select name from public.meals where id = v_a) = v_nom);
  perform pg_temp.noter('N13-E', 'RPC-ID-3 · ni aucune occurrence',
    (select count(*) from public.meal_choice_slots where meal_id = v_a) = v_avant_a
    and (select count(*) from public.meal_choice_slots where meal_id = v_b) = v_avant_b);
  perform pg_temp.noter('N13-E', 'RPC-ID-3 · ni aucune option (aucun Thon n''est entré)',
    (select count(*) from public.meal_choice_options
      where catalog_food_id = 'd3000000-0000-4000-8000-00000000f004') = 0);

  -- ── N1.3-RPC-ID-4 — deux occurrences de la même source restent permises
  perform pg_temp.noter('N13-E', 'RPC-ID-4 · deux occurrences de la même source_list_id restent autorisées',
    (select count(*) from public.meal_choice_slots
      where source_list_id = 'd3000000-0000-4000-8000-00000000a001') >= 1);

  -- Un identifiant INCONNU reste accepté : c'est ainsi que le navigateur
  -- crée une occurrence dont il choisit l'UUID.
  perform public.save_nutrition_plan_v2(pg_temp.payload(
    current_setting('n13.plan_id')::uuid,
    jsonb_build_array(
      jsonb_build_object('id', v_a, 'slot', 'breakfast', 'name', 'PDJ', 'items', '[]'::jsonb,
        'choice_slots', jsonb_build_array(
          jsonb_build_object('id', v_slot, 'label', 'Libellé corrigé',
            'options', jsonb_build_array(pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f001'))),
          jsonb_build_object('id', 'd3000000-0000-4000-8000-0000000000b9', 'label', 'Choisie par le navigateur',
            'options', jsonb_build_array(pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f002'))))),
      jsonb_build_object('id', v_b, 'slot', 'lunch', 'name', 'Déjeuner', 'items', '[]'::jsonb))));

  perform pg_temp.noter('N13-E', 'un identifiant INCONNU crée une occurrence, avec l''UUID demandé',
    (select count(*) from public.meal_choice_slots
      where id = 'd3000000-0000-4000-8000-0000000000b9' and meal_id = v_a) = 1);
end $$;


-- ---------------------------------------------------------------------
-- N13-G — LES REFUS EXPLICITES
-- ---------------------------------------------------------------------
do $$
declare v_a uuid := 'd3000000-0000-4000-8000-00000000e001';
begin
  perform pg_temp.noter('N13-G', 'une occurrence SANS option est refusée, et nommée',
    pg_temp.refuse_pour(format($q$select public.save_nutrition_plan_v2(pg_temp.payload('%s'::uuid,
      jsonb_build_array(jsonb_build_object('id','%s','slot','breakfast','name','PDJ','items','[]'::jsonb,
        'choice_slots', jsonb_build_array(jsonb_build_object('label','Vide','options','[]'::jsonb))))))$q$,
      current_setting('n13.plan_id'), v_a), 'OCCURRENCE_SANS_OPTION'));

  perform pg_temp.noter('N13-G', 'un libellé vide est refusé',
    pg_temp.refuse_pour(format($q$select public.save_nutrition_plan_v2(pg_temp.payload('%s'::uuid,
      jsonb_build_array(jsonb_build_object('id','%s','slot','breakfast','name','PDJ','items','[]'::jsonb,
        'choice_slots', jsonb_build_array(jsonb_build_object('label','   ',
          'options', jsonb_build_array(jsonb_build_object('catalog_food_id','d3000000-0000-4000-8000-00000000f001'))))))))$q$,
      current_setting('n13.plan_id'), v_a), 'label vide'));

  perform pg_temp.noter('N13-G', 'une option sans identité est refusée',
    pg_temp.refuse_pour(format($q$select public.save_nutrition_plan_v2(pg_temp.payload('%s'::uuid,
      jsonb_build_array(jsonb_build_object('id','%s','slot','breakfast','name','PDJ','items','[]'::jsonb,
        'choice_slots', jsonb_build_array(jsonb_build_object('label','X',
          'options', jsonb_build_array(jsonb_build_object('name','poulet'))))))))$q$,
      current_setting('n13.plan_id'), v_a), 'OPTION_SANS_IDENTITE'));

  perform pg_temp.noter('N13-G', 'une option avec les DEUX identités est refusée',
    pg_temp.refuse_pour(format($q$select public.save_nutrition_plan_v2(pg_temp.payload('%s'::uuid,
      jsonb_build_array(jsonb_build_object('id','%s','slot','breakfast','name','PDJ','items','[]'::jsonb,
        'choice_slots', jsonb_build_array(jsonb_build_object('label','X',
          'options', jsonb_build_array(jsonb_build_object(
            'catalog_food_id','d3000000-0000-4000-8000-00000000f001',
            'product_id','d3000000-0000-4000-8000-00000000f002'))))))))$q$,
      current_setting('n13.plan_id'), v_a), 'OPTION_SANS_IDENTITE'));

  perform pg_temp.noter('N13-G', 'un aliment INEXISTANT est refusé par la clé étrangère',
    pg_temp.refuse_pour(format($q$select public.save_nutrition_plan_v2(pg_temp.payload('%s'::uuid,
      jsonb_build_array(jsonb_build_object('id','%s','slot','breakfast','name','PDJ','items','[]'::jsonb,
        'choice_slots', jsonb_build_array(jsonb_build_object('label','X',
          'options', jsonb_build_array(jsonb_build_object(
            'catalog_food_id','00000000-0000-4000-8000-000000000000'))))))))$q$,
      current_setting('n13.plan_id'), v_a), 'foreign key'));
end $$;


-- ---------------------------------------------------------------------
-- N13-H — LE SNAPSHOT NE SUIT PAS LA BIBLIOTHÈQUE
-- ---------------------------------------------------------------------
do $$
declare v_a uuid := 'd3000000-0000-4000-8000-00000000e001';
        v_avant int;
begin
  select count(*) into v_avant
    from public.meal_choice_options o join public.meal_choice_slots s on s.id = o.slot_id
   where s.meal_id = v_a;

  -- La bibliothèque grossit, se renomme, s'archive.
  insert into public.food_list_items (list_id, position, catalog_food_id)
  values ('d3000000-0000-4000-8000-00000000a001', 4, 'd3000000-0000-4000-8000-00000000f004');
  update public.food_lists set name = 'Sources protéinées', archived_at = now()
   where id = 'd3000000-0000-4000-8000-00000000a001';

  perform pg_temp.noter('N13-H', 'ajouter un aliment au modèle n''ajoute AUCUNE option au repas',
    (select count(*) from public.meal_choice_options o
      join public.meal_choice_slots s on s.id = o.slot_id where s.meal_id = v_a) = v_avant);

  perform pg_temp.noter('N13-H', 'le Thon ajouté au modèle n''est nulle part dans le repas',
    (select count(*) from public.meal_choice_options o
      join public.meal_choice_slots s on s.id = o.slot_id
     where s.meal_id = v_a and o.catalog_food_id = 'd3000000-0000-4000-8000-00000000f004') = 0);

  perform pg_temp.noter('N13-H', 'renommer le modèle ne renomme AUCUNE occurrence',
    (select count(*) from public.meal_choice_slots
      where meal_id = v_a and label = 'Sources protéinées') = 0);

  perform pg_temp.noter('N13-H', 'archiver le modèle ne casse rien : les options sont toutes là',
    (select count(*) from public.meal_choice_options o
      join public.meal_choice_slots s on s.id = o.slot_id where s.meal_id = v_a) = v_avant);

  -- Une sauvegarde ultérieure, avec `choice_slots` omise, ne réconcilie rien.
  perform public.save_nutrition_plan_v2(pg_temp.payload(
    current_setting('n13.plan_id')::uuid,
    jsonb_build_array(jsonb_build_object('id', v_a, 'slot','breakfast','name','PDJ','items','[]'::jsonb))));

  perform pg_temp.noter('N13-H', 'ré-enregistrer le plan ne rapproche pas le snapshot du modèle',
    (select count(*) from public.meal_choice_options o
      join public.meal_choice_slots s on s.id = o.slot_id where s.meal_id = v_a) = v_avant);
end $$;


-- ---------------------------------------------------------------------
-- N13-I — `source_list_id` : ON NE DÉCLARE QUE SES PROPRES LISTES
-- ---------------------------------------------------------------------
do $$
declare v_a uuid := 'd3000000-0000-4000-8000-00000000e001';
begin
  -- ⚠️ LE COACH 1 EST CONNECTÉ. La liste l002 appartient au coach 2 : il ne
  -- la voit même pas dans son sélecteur, et la base doit le confirmer.
  perform pg_temp.noter('N13-I', 'déclarer la liste d''un AUTRE coach est refusé par la policy',
    pg_temp.refuse_pour(format($q$select public.save_nutrition_plan_v2(pg_temp.payload('%s'::uuid,
      jsonb_build_array(jsonb_build_object('id','%s','slot','breakfast','name','PDJ','items','[]'::jsonb,
        'choice_slots', jsonb_build_array(jsonb_build_object('label','Injectée',
          'source_list_id','d3000000-0000-4000-8000-00000000a002',
          'options', jsonb_build_array(jsonb_build_object('catalog_food_id','d3000000-0000-4000-8000-00000000f001'))))))))$q$,
      current_setting('n13.plan_id'), v_a), 'row-level security'));

  perform pg_temp.noter('N13-I', 'une provenance NULLE reste parfaitement valide',
    pg_temp.compte(format($q$select 1 from (select public.save_nutrition_plan_v2(pg_temp.payload('%s'::uuid,
      jsonb_build_array(jsonb_build_object('id','%s','slot','breakfast','name','PDJ','items','[]'::jsonb,
        'choice_slots', jsonb_build_array(jsonb_build_object('label','Sans provenance',
          'options', jsonb_build_array(jsonb_build_object('catalog_food_id','d3000000-0000-4000-8000-00000000f001')))))))) as x) t$q$,
      current_setting('n13.plan_id'), v_a)) = 1);

  perform pg_temp.noter('N13-I', 'et l''occurrence sans provenance existe bien',
    (select count(*) from public.meal_choice_slots
      where meal_id = v_a and source_list_id is null) = 1);

  -- Sa propre liste, même ARCHIVÉE, reste une provenance valide.
  perform pg_temp.noter('N13-I', 'sa propre liste ARCHIVÉE reste une provenance valide',
    pg_temp.compte(format($q$select 1 from (select public.save_nutrition_plan_v2(pg_temp.payload('%s'::uuid,
      jsonb_build_array(jsonb_build_object('id','%s','slot','breakfast','name','PDJ','items','[]'::jsonb,
        'choice_slots', jsonb_build_array(jsonb_build_object('label','Archivée mais mienne',
          'source_list_id','d3000000-0000-4000-8000-00000000a001',
          'options', jsonb_build_array(jsonb_build_object('catalog_food_id','d3000000-0000-4000-8000-00000000f001')))))))) as x) t$q$,
      current_setting('n13.plan_id'), v_a)) = 1);
end $$;


-- ---------------------------------------------------------------------
-- N13-J/K — RETRAIT LOCAL, ET OPTIONS CONSERVÉES
-- ---------------------------------------------------------------------
do $$
declare v_a uuid := 'd3000000-0000-4000-8000-00000000e001';
        v_slot uuid; v_opt uuid; v_items int; v_listes int;
begin
  select count(*) into v_listes from public.food_list_items
   where list_id = 'd3000000-0000-4000-8000-00000000a001';

  perform public.save_nutrition_plan_v2(pg_temp.payload(
    current_setting('n13.plan_id')::uuid,
    jsonb_build_array(jsonb_build_object('id', v_a, 'slot','breakfast','name','PDJ','items','[]'::jsonb,
      -- ⚠️ AVEC UNE PROVENANCE, ET C'EST INDISPENSABLE. Sans elle, « retirer
      -- une occurrence ne touche pas la bibliothèque » serait vert même si le
      -- code supprimait les aliments de la liste d'origine : il n'y aurait
      -- aucune liste d'origine à atteindre. Le contrôle négatif NC7 l'a montré.
      'choice_slots', jsonb_build_array(jsonb_build_object('label','À garder',
        'source_list_id','d3000000-0000-4000-8000-00000000a001',
        'options', jsonb_build_array(
          pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f001'),
          pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f002'),
          pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f003'))))))));

  select id into v_slot from public.meal_choice_slots where meal_id = v_a;
  select id into v_opt from public.meal_choice_options
   where slot_id = v_slot and catalog_food_id = 'd3000000-0000-4000-8000-00000000f001';

  -- ⚠️ ON RETIRE UNE OPTION, PAS TOUTES. Les deux autres doivent garder LEUR
  -- LIGNE : `planned_meal_items` cascade depuis `meal_choice_options`, donc
  -- un supprimer-tout-puis-réinsérer effacerait le choix déjà planifié par
  -- l'élève sur des options que le coach n'a pas touchées.
  perform public.save_nutrition_plan_v2(pg_temp.payload(
    current_setting('n13.plan_id')::uuid,
    jsonb_build_array(jsonb_build_object('id', v_a, 'slot','breakfast','name','PDJ','items','[]'::jsonb,
      'choice_slots', jsonb_build_array(jsonb_build_object('id', v_slot, 'label','À garder',
        'source_list_id','d3000000-0000-4000-8000-00000000a001',
        'options', jsonb_build_array(
          pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f001'),
          pg_temp.option_aliment('d3000000-0000-4000-8000-00000000f003'))))))));

  perform pg_temp.noter('N13-K', 'l''option conservée garde SA ligne (le choix de l''élève survit)',
    (select id from public.meal_choice_options
      where slot_id = v_slot and catalog_food_id = 'd3000000-0000-4000-8000-00000000f001') = v_opt);
  perform pg_temp.noter('N13-K', 'l''option retirée a disparu, les positions restent 1..N',
    (select array_agg(position order by position) from public.meal_choice_options where slot_id = v_slot)
      = array[1,2]);

  -- Retrait de l'occurrence entière.
  perform public.save_nutrition_plan_v2(pg_temp.payload(
    current_setting('n13.plan_id')::uuid,
    jsonb_build_array(jsonb_build_object('id', v_a, 'slot','breakfast','name','PDJ','items','[]'::jsonb,
      'choice_slots', '[]'::jsonb))));

  perform pg_temp.noter('N13-J', 'retirer une occurrence emporte ses options',
    (select count(*) from public.meal_choice_options where slot_id = v_slot) = 0);
  perform pg_temp.noter('N13-J', 'et ne touche PAS la bibliothèque',
    (select count(*) from public.food_list_items
      where list_id = 'd3000000-0000-4000-8000-00000000a001') = v_listes);
  perform pg_temp.noter('N13-J', 'ni les aliments du catalogue',
    (select count(*) from public.food_catalog where id::text like 'd3000000%') = 4);
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
  raise notice 'N1.3 · OCCURRENCES DANS LA SAUVEGARDE — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;
