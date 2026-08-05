-- ============================================================================
-- Checklist PostgreSQL — feat/nutrition-recipes-admin, PR B
-- Migration couverte : 20260808090000_save_nutrition_recipe.sql
--
-- CE QU'ELLE VÉRIFIE
--   A. source_key et son index unique PARTIEL ;
--   B. la RPC : signature, security invoker, owner, search_path, privilèges ;
--   C. création complète, brouillon incomplet, activation valide ;
--   D. activation REFUSÉE : rollback complet, ancienne version intacte ;
--   E. modification atomique : ajout, retrait, synchronisation des tags ;
--   F. sécurité des enfants : aucun enfant ni lien d'une AUTRE recette,
--      aucun cycle ;
--   G. archivage — un statut, jamais une suppression ;
--   H. RLS et privilèges : anon, PUBLIC, élève refusés ; coach autorisé ;
--      aucun TRUNCATE pour authenticated ;
--   I. import rejouable : même source_key, aucun doublon, recette manuelle
--      de même nom intacte ;
--   J. aucune donnée de test persistante après le ROLLBACK.
--
-- EXÉCUTION (base LOCALE uniquement) :
--   docker exec -i "$DB_CONTAINER" \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/nutrition_recipes_admin_checklist.sql
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
  insert into _faits values (p_section, p_libelle, p_ok);
  if p_ok then raise notice 'OK      — %', p_libelle;
  else raise warning 'ÉCHEC   — %', p_libelle; end if;
end $$;

-- Jeu d'essai
insert into auth.users (id, email) values
  ('aaaa9999-9999-4999-8999-999999999991', 'ra.coach@test.local'),
  ('aaaa9999-9999-4999-8999-999999999992', 'ra.eleve@test.local')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('aaaa9999-9999-4999-8999-999999999991', 'coach', 'Rina', 'A', 'ra.coach@test.local'),
  ('aaaa9999-9999-4999-8999-999999999992', 'student', 'Ella', 'B', 'ra.eleve@test.local');

insert into public.students (id, user_id, first_name, last_name, email, status, access_type)
values ('bbbb9999-9999-4999-8999-999999999992', 'aaaa9999-9999-4999-8999-999999999992',
        'Ella', 'B', 'ra.eleve@test.local', 'active', 'coaching');

insert into public.coaches (id, name, email)
values ('dddd9999-9999-4999-8999-999999999991', 'Rina', 'ra.coach@test.local');

-- Plan v1 témoin — il ne doit jamais bouger.
insert into public.nutrition_plans (id, name, goal_type, status, daily_target, nutrition_model_version)
values ('eeee9999-9999-4999-8999-999999999991', 'Témoin v1 PR B', 'maintien', 'actif',
        '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb, 1);

-- ---------------------------------------------------------------------
-- Section A — source_key et son index
-- ---------------------------------------------------------------------
do $$
declare v_def text;
begin
  perform pg_temp.noter('A', 'A1. la colonne source_key existe', exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'nutrition_recipes' and column_name = 'source_key'));

  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'nutrition_recipes_source_key_unique';
  perform pg_temp.noter('A', 'A2. index unique (coach_id, source_key)',
    v_def like '%UNIQUE INDEX%' and v_def like '%(coach_id, source_key)%');
  perform pg_temp.noter('A', 'A3. index PARTIEL (source_key is not null)',
    v_def like '%WHERE (source_key IS NOT NULL)%');

  perform pg_temp.noter('A', 'A4. format de source_key contraint', exists (
    select 1 from pg_constraint
     where conrelid = 'public.nutrition_recipes'::regclass
       and conname = 'nutrition_recipes_source_key_format'));
end $$;

-- ---------------------------------------------------------------------
-- Section B — la RPC
-- ---------------------------------------------------------------------
do $$
declare v_secdef boolean; v_owner text; v_config text[];
begin
  select p.prosecdef, pg_get_userbyid(p.proowner), p.proconfig
    into v_secdef, v_owner, v_config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_nutrition_recipe';

  perform pg_temp.noter('B', 'B1. save_nutrition_recipe existe', v_owner is not null);
  perform pg_temp.noter('B', 'B2. SECURITY INVOKER', v_secdef = false);
  perform pg_temp.noter('B', 'B3. propriétaire postgres', v_owner = 'postgres');
  perform pg_temp.noter('B', 'B4. search_path verrouillé à vide',
    v_config @> array['search_path=']::text[] or v_config @> array['search_path=""']::text[]
    or v_config @> array['search_path=''''']::text[]);
  perform pg_temp.noter('B', 'B5. signature (p_payload jsonb) returns jsonb', exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'save_nutrition_recipe'
       and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb'
       and pg_get_function_result(p.oid) = 'jsonb'));
  perform pg_temp.noter('B', 'B6. anon ne peut pas l''exécuter',
    not has_function_privilege('anon', 'public.save_nutrition_recipe(jsonb)', 'execute'));
  perform pg_temp.noter('B', 'B7. PUBLIC ne peut pas l''exécuter',
    not has_function_privilege('public', 'public.save_nutrition_recipe(jsonb)', 'execute'));
  perform pg_temp.noter('B', 'B8. authenticated peut l''exécuter',
    has_function_privilege('authenticated', 'public.save_nutrition_recipe(jsonb)', 'execute'));
  perform pg_temp.noter('B', 'B9. aucun TRUNCATE pour authenticated sur les trois tables',
    not has_table_privilege('authenticated', 'public.nutrition_recipes', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.nutrition_recipe_ingredients', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.nutrition_recipe_tags', 'TRUNCATE'));
end $$;

-- ---------------------------------------------------------------------
-- Sections C à G — comportement, sous l'identité du COACH
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa9999-9999-4999-8999-999999999991","role":"authenticated"}';

do $$
declare v_res jsonb; v_id uuid;
begin
  -- C. Création complète, demandée directement en `active`.
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('coach_id','dddd9999-9999-4999-8999-999999999991',
      'name','Poulet riz crème','slot_key','lunch','status','active'),
    'ingredients', jsonb_build_array(
      jsonb_build_object('id','11119999-0000-4000-8000-000000000001','position',1,'name','Poulet','role','protein',
        'protein_per_100g',25,'carb_per_100g',0,'fat_per_100g',1,'reference_grams',140),
      jsonb_build_object('id','11119999-0000-4000-8000-000000000002','position',2,'name','Riz','role','carbohydrate',
        'protein_per_100g',7,'carb_per_100g',77,'fat_per_100g',1,'reference_grams',100)),
    'tags', jsonb_build_array(jsonb_build_object('kind','allergen','value','milk'))));
  v_id := (v_res->'recipe'->>'id')::uuid;

  perform pg_temp.noter('C', 'C1. création complète : statut active', (v_res->'recipe'->>'status') = 'active');
  perform pg_temp.noter('C', 'C2. deux ingrédients écrits', (v_res->>'ingredient_count') = '2');
  perform pg_temp.noter('C', 'C3. une étiquette écrite', (v_res->>'tag_count') = '1');
  perform pg_temp.noter('C', 'C4. aucun blocage résiduel', (v_res->'blocking_issue') = 'null'::jsonb);
  perform pg_temp.noter('C', 'C5. positions 1..N en base', (
    select string_agg(position::text, ',' order by position) from public.nutrition_recipe_ingredients
     where recipe_id = v_id) = '1,2');

  -- C bis. Brouillon INCOMPLET : accepté.
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('coach_id','dddd9999-9999-4999-8999-999999999991',
      'name','Brouillon incomplet','status','draft'),
    'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb));
  perform pg_temp.noter('C', 'C6. brouillon SANS ingrédient accepté', (v_res->'recipe'->>'status') = 'draft');
  perform pg_temp.noter('C', 'C7. et signalé comme non exploitable',
    (v_res->>'blocking_issue') = 'recipe_without_ingredient');
end $$;

do $$
declare
  v_id uuid;
  v_avant jsonb;
  v_apres jsonb;
  v_refuse boolean := false;
  v_message text;
begin
  select id into v_id from public.nutrition_recipes where name = 'Poulet riz crème';
  select jsonb_build_object(
    'statut', (select status from public.nutrition_recipes where id = v_id),
    'ingredients', (select jsonb_agg(jsonb_build_object('n', name, 'p', position) order by position)
                      from public.nutrition_recipe_ingredients where recipe_id = v_id),
    'tags', (select jsonb_agg(kind || '/' || value order by kind) from public.nutrition_recipe_tags where recipe_id = v_id))
    into v_avant;

  -- D. Activation INVALIDE : un ajustable sans quantité de référence.
  begin
    perform public.save_nutrition_recipe(jsonb_build_object(
      'recipe', jsonb_build_object('id', v_id, 'coach_id','dddd9999-9999-4999-8999-999999999991',
        'name','Poulet riz crème MODIFIÉ','slot_key','lunch','status','active'),
      'ingredients', jsonb_build_array(
        jsonb_build_object('id','11119999-0000-4000-8000-000000000001','position',1,'name','Poulet','role','protein',
          'protein_per_100g',25,'carb_per_100g',0,'fat_per_100g',1,'reference_grams',0)),
      'tags', '[]'::jsonb));
  exception when others then
    v_refuse := true;
    v_message := sqlerrm;
  end;

  perform pg_temp.noter('D', 'D1. activation invalide REFUSÉE', v_refuse);
  perform pg_temp.noter('D', 'D2. le refus nomme la règle violée',
    coalesce(v_message, '') like '%RECIPE_NOT_ACTIVABLE%'
    and coalesce(v_message, '') like '%scalable_ingredient_without_reference%');

  select jsonb_build_object(
    'statut', (select status from public.nutrition_recipes where id = v_id),
    'ingredients', (select jsonb_agg(jsonb_build_object('n', name, 'p', position) order by position)
                      from public.nutrition_recipe_ingredients where recipe_id = v_id),
    'tags', (select jsonb_agg(kind || '/' || value order by kind) from public.nutrition_recipe_tags where recipe_id = v_id))
    into v_apres;
  perform pg_temp.noter('D', 'D3. ROLLBACK complet : l''ancienne version est INTACTE', v_avant = v_apres);
  perform pg_temp.noter('D', 'D4. le nom n''a pas été modifié', exists (
    select 1 from public.nutrition_recipes where id = v_id and name = 'Poulet riz crème'));
end $$;

do $$
declare v_id uuid; v_res jsonb;
begin
  select id into v_id from public.nutrition_recipes where name = 'Poulet riz crème';

  -- E. Modification atomique : retrait du riz, ajout d'un lié, tags resynchronisés.
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('id', v_id, 'coach_id','dddd9999-9999-4999-8999-999999999991',
      'name','Poulet panure','slot_key','lunch','status','draft'),
    'ingredients', jsonb_build_array(
      jsonb_build_object('id','11119999-0000-4000-8000-000000000001','position',1,'name','Poulet','role','protein',
        'protein_per_100g',25,'carb_per_100g',0,'fat_per_100g',1,'reference_grams',140),
      jsonb_build_object('id','11119999-0000-4000-8000-000000000003','position',2,'name','Panure','role','fixed',
        'protein_per_100g',8,'carb_per_100g',60,'fat_per_100g',3,'reference_grams',20,
        'linked_to_ingredient_id','11119999-0000-4000-8000-000000000001','link_ratio_bp',1500)),
    'tags', jsonb_build_array(jsonb_build_object('kind','diet','value','halal'))));

  perform pg_temp.noter('E', 'E1. modification : deux ingrédients', (v_res->>'ingredient_count') = '2');
  perform pg_temp.noter('E', 'E2. l''ingrédient absent du payload est RETIRÉ', not exists (
    select 1 from public.nutrition_recipe_ingredients
     where recipe_id = v_id and id = '11119999-0000-4000-8000-000000000002'));
  perform pg_temp.noter('E', 'E3. le nouvel ingrédient est INSÉRÉ', exists (
    select 1 from public.nutrition_recipe_ingredients
     where recipe_id = v_id and id = '11119999-0000-4000-8000-000000000003'));
  perform pg_temp.noter('E', 'E4. l''ingrédient conservé est mis à jour', exists (
    select 1 from public.nutrition_recipe_ingredients
     where recipe_id = v_id and id = '11119999-0000-4000-8000-000000000001' and position = 1));
  perform pg_temp.noter('E', 'E5. la LIAISON est posée en seconde passe', exists (
    select 1 from public.nutrition_recipe_ingredients
     where id = '11119999-0000-4000-8000-000000000003'
       and linked_to_ingredient_id = '11119999-0000-4000-8000-000000000001'
       and link_ratio_bp = 1500));
  perform pg_temp.noter('E', 'E6. les étiquettes sont SYNCHRONISÉES (ancienne retirée, nouvelle posée)', (
    select string_agg(kind || '/' || value, ',' order by kind) from public.nutrition_recipe_tags
     where recipe_id = v_id) = 'diet/halal');
  perform pg_temp.noter('E', 'E7. aucune autre recette n''a été touchée', (
    select count(*) from public.nutrition_recipe_ingredients i
      join public.nutrition_recipes r on r.id = i.recipe_id
     where r.name = 'Brouillon incomplet') = 0);
end $$;

do $$
declare
  v_id uuid; v_autre uuid; v_refuse boolean; v_message text;
begin
  select id into v_id from public.nutrition_recipes where name = 'Poulet panure';
  select id into v_autre from public.nutrition_recipes where name = 'Brouillon incomplet';

  -- On donne un enfant à l'autre recette, pour tenter de le voler.
  perform public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('id', v_autre, 'coach_id','dddd9999-9999-4999-8999-999999999991',
      'name','Brouillon incomplet','status','draft'),
    'ingredients', jsonb_build_array(
      jsonb_build_object('id','22229999-0000-4000-8000-000000000001','position',1,'name','Avoine','role','carbohydrate',
        'protein_per_100g',13,'carb_per_100g',68,'fat_per_100g',7,'reference_grams',60)),
    'tags', '[]'::jsonb));

  -- F1. Enfant d'une AUTRE recette : refusé.
  v_refuse := false;
  begin
    perform public.save_nutrition_recipe(jsonb_build_object(
      'recipe', jsonb_build_object('id', v_id, 'coach_id','dddd9999-9999-4999-8999-999999999991',
        'name','Poulet panure','status','draft'),
      'ingredients', jsonb_build_array(
        jsonb_build_object('id','22229999-0000-4000-8000-000000000001','position',1,'name','Volé','role','fixed',
          'protein_per_100g',0,'carb_per_100g',0,'fat_per_100g',0,'reference_grams',10)),
      'tags', '[]'::jsonb));
  exception when others then
    v_refuse := true; v_message := sqlerrm;
  end;
  perform pg_temp.noter('F', 'F1. enfant d''une AUTRE recette REFUSÉ', v_refuse);
  perform pg_temp.noter('F', 'F2. le refus est nommé',
    coalesce(v_message, '') like '%INGREDIENT_FROM_ANOTHER_RECIPE%');
  perform pg_temp.noter('F', 'F3. l''ingrédient de l''autre recette est INTACT', exists (
    select 1 from public.nutrition_recipe_ingredients
     where id = '22229999-0000-4000-8000-000000000001' and recipe_id = v_autre and name = 'Avoine'));

  -- F4. Lien INTER-RECETTES : refusé par la clé étrangère composite.
  v_refuse := false;
  begin
    perform public.save_nutrition_recipe(jsonb_build_object(
      'recipe', jsonb_build_object('id', v_id, 'coach_id','dddd9999-9999-4999-8999-999999999991',
        'name','Poulet panure','status','draft'),
      'ingredients', jsonb_build_array(
        jsonb_build_object('id','11119999-0000-4000-8000-000000000001','position',1,'name','Poulet','role','protein',
          'protein_per_100g',25,'carb_per_100g',0,'fat_per_100g',1,'reference_grams',140,
          'linked_to_ingredient_id','22229999-0000-4000-8000-000000000001','link_ratio_bp',1500)),
      'tags', '[]'::jsonb));
  exception when others then v_refuse := true; end;
  perform pg_temp.noter('F', 'F4. lien vers une AUTRE recette REFUSÉ', v_refuse);

  -- F5. CYCLE de liaison : accepté en brouillon, mais l'activation est refusée.
  perform public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('id', v_id, 'coach_id','dddd9999-9999-4999-8999-999999999991',
      'name','Poulet panure','status','draft'),
    'ingredients', jsonb_build_array(
      jsonb_build_object('id','11119999-0000-4000-8000-000000000001','position',1,'name','A','role','fixed',
        'protein_per_100g',1,'carb_per_100g',1,'fat_per_100g',1,'reference_grams',10,
        'linked_to_ingredient_id','11119999-0000-4000-8000-000000000003','link_ratio_bp',1500),
      jsonb_build_object('id','11119999-0000-4000-8000-000000000003','position',2,'name','B','role','fixed',
        'protein_per_100g',1,'carb_per_100g',1,'fat_per_100g',1,'reference_grams',10,
        'linked_to_ingredient_id','11119999-0000-4000-8000-000000000001','link_ratio_bp',1500)),
    'tags', '[]'::jsonb));
  perform pg_temp.noter('F', 'F5. un cycle est détecté par blocking_issue',
    public.nutrition_recipe_blocking_issue(v_id) = 'ingredient_link_cycle');

  v_refuse := false;
  begin
    perform public.save_nutrition_recipe(jsonb_build_object(
      'recipe', jsonb_build_object('id', v_id, 'coach_id','dddd9999-9999-4999-8999-999999999991',
        'name','Poulet panure','status','active'),
      'ingredients', jsonb_build_array(
        jsonb_build_object('id','11119999-0000-4000-8000-000000000001','position',1,'name','A','role','fixed',
          'protein_per_100g',1,'carb_per_100g',1,'fat_per_100g',1,'reference_grams',10,
          'linked_to_ingredient_id','11119999-0000-4000-8000-000000000003','link_ratio_bp',1500),
        jsonb_build_object('id','11119999-0000-4000-8000-000000000003','position',2,'name','B','role','fixed',
          'protein_per_100g',1,'carb_per_100g',1,'fat_per_100g',1,'reference_grams',10,
          'linked_to_ingredient_id','11119999-0000-4000-8000-000000000001','link_ratio_bp',1500)),
      'tags', '[]'::jsonb));
  exception when others then v_refuse := true; end;
  perform pg_temp.noter('F', 'F6. l''ACTIVATION d''une recette cyclique est REFUSÉE', v_refuse);
end $$;

do $$
declare v_id uuid; v_res jsonb;
begin
  select id into v_id from public.nutrition_recipes where name = 'Poulet panure';
  -- G. Archivage : un statut, la recette reste en base.
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('id', v_id, 'coach_id','dddd9999-9999-4999-8999-999999999991',
      'name','Poulet panure','status','archived'),
    'ingredients', jsonb_build_array(
      jsonb_build_object('id','11119999-0000-4000-8000-000000000001','position',1,'name','A','role','fixed',
        'protein_per_100g',1,'carb_per_100g',1,'fat_per_100g',1,'reference_grams',10)),
    'tags', '[]'::jsonb));
  perform pg_temp.noter('G', 'G1. archivage : statut archived', (v_res->'recipe'->>'status') = 'archived');
  perform pg_temp.noter('G', 'G2. la recette EXISTE toujours en base', exists (
    select 1 from public.nutrition_recipes where id = v_id));
  perform pg_temp.noter('G', 'G3. ses ingrédients sont conservés', (
    select count(*) from public.nutrition_recipe_ingredients where recipe_id = v_id) = 1);
end $$;

-- ---------------------------------------------------------------------
-- Section I — import rejouable
-- ---------------------------------------------------------------------
do $$
declare v_res jsonb; v_id uuid; v_id2 uuid; v_refuse boolean := false;
begin
  -- Une recette MANUELLE portant le même nom qu'une fixture, sans source_key.
  perform public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('coach_id','dddd9999-9999-4999-8999-999999999991',
      'name','Porridge Protéiné','status','draft'),
    'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb));

  -- Premier import de la fixture du même nom.
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('coach_id','dddd9999-9999-4999-8999-999999999991',
      'name','Porridge Protéiné','status','draft','source_key','fixture:proto-1'),
    'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb));
  v_id := (v_res->'recipe'->>'id')::uuid;
  perform pg_temp.noter('I', 'I1. import : la fixture est créée', v_id is not null);
  perform pg_temp.noter('I', 'I2. deux recettes de même nom coexistent (manuelle + importée)', (
    select count(*) from public.nutrition_recipes where name = 'Porridge Protéiné') = 2);

  -- Second import, MÊME source_key, en mise à jour de la même ligne.
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('id', v_id, 'coach_id','dddd9999-9999-4999-8999-999999999991',
      'name','Porridge Protéiné','status','draft','source_key','fixture:proto-1'),
    'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb));
  v_id2 := (v_res->'recipe'->>'id')::uuid;
  perform pg_temp.noter('I', 'I3. second import : MÊME ligne, aucun doublon', v_id2 = v_id);
  perform pg_temp.noter('I', 'I4. toujours deux recettes de ce nom', (
    select count(*) from public.nutrition_recipes where name = 'Porridge Protéiné') = 2);

  -- Un second import qui tenterait de CRÉER une ligne avec la même clé est
  -- refusé par l'index unique partiel.
  begin
    perform public.save_nutrition_recipe(jsonb_build_object(
      'recipe', jsonb_build_object('coach_id','dddd9999-9999-4999-8999-999999999991',
        'name','Porridge Protéiné','status','draft','source_key','fixture:proto-1'),
      'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb));
  exception when unique_violation then v_refuse := true; end;
  perform pg_temp.noter('I', 'I5. une seconde CRÉATION avec la même clé est refusée par la base', v_refuse);

  perform pg_temp.noter('I', 'I6. la recette MANUELLE n''a pas de source_key et n''a pas bougé', exists (
    select 1 from public.nutrition_recipes
     where name = 'Porridge Protéiné' and source_key is null and status = 'draft'));
end $$;

reset role;

-- ---------------------------------------------------------------------
-- Section H — RLS et privilèges
-- ---------------------------------------------------------------------
do $$
declare v_refuse boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaa9999-9999-4999-8999-999999999992","role":"authenticated"}', true);
  begin
    perform public.save_nutrition_recipe(jsonb_build_object(
      'recipe', jsonb_build_object('coach_id','dddd9999-9999-4999-8999-999999999991',
        'name','Écrite par un élève','status','draft'),
      'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb));
  exception when others then v_refuse := true; end;
  perform pg_temp.noter('H', 'H1. l''ÉLÈVE ne peut PAS enregistrer de recette', v_refuse);
  perform pg_temp.noter('H', 'H2. aucune recette « Écrite par un élève » créée', not exists (
    select 1 from public.nutrition_recipes where name = 'Écrite par un élève'));
  perform pg_temp.noter('H', 'H3. l''ÉLÈVE ne lit toujours AUCUNE recette', (
    select count(*) from public.nutrition_recipes) = 0);
  reset role;
end $$;

do $$
declare v_refuse boolean := false;
begin
  set local role anon;
  begin
    perform public.save_nutrition_recipe('{}'::jsonb);
  exception when insufficient_privilege then v_refuse := true;
           when others then v_refuse := true; end;
  perform pg_temp.noter('H', 'H4. anon ne peut PAS exécuter la RPC', v_refuse);
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- Non-régression v1 / v2
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('H', 'H5. le plan v1 témoin est inchangé', exists (
    select 1 from public.nutrition_plans
     where id = 'eeee9999-9999-4999-8999-999999999991'
       and nutrition_model_version = 1
       and daily_target = '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb));
  perform pg_temp.noter('H', 'H6. aucune table de portion calculée n''existe', (
    select count(*) = 0 from pg_tables
     where schemaname = 'public'
       and (tablename like '%solved%' or tablename like '%portion%' or tablename like '%serving%')));
  perform pg_temp.noter('H', 'H7. aucune policy de lecture élève sur les recettes', not exists (
    select 1 from pg_policy
     where polrelid in ('public.nutrition_recipes'::regclass,
                        'public.nutrition_recipe_ingredients'::regclass,
                        'public.nutrition_recipe_tags'::regclass)
       and coalesce(pg_get_expr(polqual, polrelid), '') like '%current_student_id%'));
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
  select count(*) into nb from public.nutrition_recipes
   where name in ('Poulet riz crème', 'Poulet panure', 'Brouillon incomplet', 'Porridge Protéiné');
  if nb <> 0 then
    raise exception 'ÉCHEC   — J1. des recettes de test ont survécu au ROLLBACK (% lignes)', nb;
  end if;
  select count(*) into nb from public.nutrition_recipe_ingredients;
  if nb <> 0 then
    raise exception 'ÉCHEC   — J2. des ingrédients de test ont survécu au ROLLBACK';
  end if;
  select count(*) into nb from auth.users where email in ('ra.coach@test.local', 'ra.eleve@test.local');
  if nb <> 0 then
    raise exception 'ÉCHEC   — J3. des comptes de test ont survécu au ROLLBACK';
  end if;
  select count(*) into nb from public.nutrition_plans where name = 'Témoin v1 PR B';
  if nb <> 0 then
    raise exception 'ÉCHEC   — J4. le plan témoin a survécu au ROLLBACK';
  end if;
  raise notice 'OK      — J1/J4. aucune donnée de test persistante après le ROLLBACK';
end $$;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'save_nutrition_recipe') then
    raise exception 'ÉCHEC   — J5. la RPC de la migration a disparu';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                  and indexname = 'nutrition_recipes_source_key_unique') then
    raise exception 'ÉCHEC   — J6. l''index d''unicité de source_key a disparu';
  end if;
  raise notice 'OK      — J5/J6. les objets de la migration sont toujours en place';
end $$;
