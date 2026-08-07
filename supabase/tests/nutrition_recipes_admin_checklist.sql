-- ============================================================================
-- Checklist PostgreSQL — feat/nutrition-recipes-admin, PR B puis PR B.1
-- Migrations couvertes :
--   20260808090000_save_nutrition_recipe.sql
--   20260809090000_save_nutrition_recipe_partial_payload.sql
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
--   K. contrat de charge utile PARTIELLE (PR B.1) : une clé ABSENTE ne
--      touche à rien — ni la description, ni le statut, ni les enfants ;
--   J. aucune donnée de test persistante après le ROLLBACK.
--
-- EXÉCUTION (base LOCALE uniquement) :
--   docker exec -i "$DB_CONTAINER" \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/nutrition_recipes_admin_checklist.sql
--
-- ⚠️ NE JAMAIS exécuter sur la Production.
-- ============================================================================

-- ⚠️ PR C — le modèle v1 n'existe plus. La migration 20260811090000 a converti
-- tous les plans et la contrainte `nutrition_plans_model_version_check`
-- interdit désormais toute valeur autre que 2. Les insertions de test qui
-- créaient des plans « v1 » ont donc été portées en v2 : elles décrivent la
-- même situation métier, dans le seul modèle qui subsiste.

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
  ('aaaa9999-9999-4999-8999-999999999992', 'ra.eleve@test.local'),
  ('aaaa9999-9999-4999-8999-999999999993', 'ra.admin@test.local')
on conflict (id) do nothing;

-- Un ADMINISTRATEUR en plus du coach : `is_coach_or_admin()` a deux branches,
-- et la version précédente de cette checklist n'en exerçait qu'une.
insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('aaaa9999-9999-4999-8999-999999999991', 'coach', 'Rina', 'A', 'ra.coach@test.local'),
  ('aaaa9999-9999-4999-8999-999999999992', 'student', 'Ella', 'B', 'ra.eleve@test.local'),
  ('aaaa9999-9999-4999-8999-999999999993', 'admin', 'Adam', 'C', 'ra.admin@test.local');

insert into public.students (id, user_id, first_name, last_name, email, status, access_type)
values ('bbbb9999-9999-4999-8999-999999999992', 'aaaa9999-9999-4999-8999-999999999992',
        'Ella', 'B', 'ra.eleve@test.local', 'active', 'coaching');

-- `user_id` est désormais indispensable : depuis la migration 20260813090000,
-- un coach ne gère que les recettes dont `coach_id` correspond à SA fiche,
-- résolue par `current_coach_id()` (coaches.user_id = auth.uid()).
insert into public.coaches (id, user_id, name, email)
values ('dddd9999-9999-4999-8999-999999999991',
        'aaaa9999-9999-4999-8999-999999999991', 'Rina', 'ra.coach@test.local');

-- Plan v1 témoin — il ne doit jamais bouger.
insert into public.nutrition_plans (id, name, goal_type, status, daily_target, nutrition_model_version)
values ('eeee9999-9999-4999-8999-999999999991', 'Témoin v1 PR B', 'maintien', 'actif',
        '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb, 2);

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
  -- INSTANTANÉ COMPLET. La version précédente ne capturait que (nom, position)
  -- par ingrédient : or la tentative fautive ci-dessous modifie justement
  -- `reference_grams` (140 → 0), qui n'était donc PAS comparé. Une régression
  -- qui aurait laissé passer l'UPDATE tout en annulant le DELETE serait
  -- passée inaperçue.
  select jsonb_build_object(
    'statut', (select status from public.nutrition_recipes where id = v_id),
    'nom', (select name from public.nutrition_recipes where id = v_id),
    'description', (select description from public.nutrition_recipes where id = v_id),
    'creneau', (select slot_key from public.nutrition_recipes where id = v_id),
    'ingredients', (select jsonb_agg(jsonb_build_object(
                        'n', name, 'p', position, 'role', role,
                        'prot', protein_per_100g, 'gluc', carb_per_100g, 'lip', fat_per_100g,
                        'ref', reference_grams, 'min', min_grams, 'max', max_grams,
                        'unite', unit_scalable, 'nb_unites', max_units, 'nom_unite', unit_name,
                        'libelle', fixed_label, 'oeuf', egg, 'g_oeuf', egg_grams,
                        'lien', linked_to_ingredient_id, 'ratio', link_ratio_bp) order by position)
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
    'nom', (select name from public.nutrition_recipes where id = v_id),
    'description', (select description from public.nutrition_recipes where id = v_id),
    'creneau', (select slot_key from public.nutrition_recipes where id = v_id),
    'ingredients', (select jsonb_agg(jsonb_build_object(
                        'n', name, 'p', position, 'role', role,
                        'prot', protein_per_100g, 'gluc', carb_per_100g, 'lip', fat_per_100g,
                        'ref', reference_grams, 'min', min_grams, 'max', max_grams,
                        'unite', unit_scalable, 'nb_unites', max_units, 'nom_unite', unit_name,
                        'libelle', fixed_label, 'oeuf', egg, 'g_oeuf', egg_grams,
                        'lien', linked_to_ingredient_id, 'ratio', link_ratio_bp) order by position)
                      from public.nutrition_recipe_ingredients where recipe_id = v_id),
    'tags', (select jsonb_agg(kind || '/' || value order by kind) from public.nutrition_recipe_tags where recipe_id = v_id))
    into v_apres;
  perform pg_temp.noter('D', 'D3. ROLLBACK complet : l''ancienne version est INTACTE', v_avant = v_apres);
  perform pg_temp.noter('D', 'D4. le nom n''a pas été modifié', exists (
    select 1 from public.nutrition_recipes where id = v_id and name = 'Poulet riz crème'));
  perform pg_temp.noter('D', 'D5. la quantité de référence visée par la tentative est INTACTE', (
    select reference_grams from public.nutrition_recipe_ingredients
     where id = '11119999-0000-4000-8000-000000000001') = 140);
  perform pg_temp.noter('D', 'D6. l''ingrédient que la tentative supprimait est TOUJOURS là', exists (
    select 1 from public.nutrition_recipe_ingredients
     where id = '11119999-0000-4000-8000-000000000002' and recipe_id = v_id));
  perform pg_temp.noter('D', 'D7. l''étiquette que la tentative retirait est TOUJOURS là', exists (
    select 1 from public.nutrition_recipe_tags
     where recipe_id = v_id and kind = 'allergen' and value = 'milk'));
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
  exception when others then v_refuse := true; v_message := sqlerrm; end;
  perform pg_temp.noter('F', 'F4. lien vers une AUTRE recette REFUSÉ', v_refuse);
  -- « quelque chose a échoué » ne prouve rien : on exige que ce soit bien la
  -- clé étrangère COMPOSITE (linked_to_ingredient_id, recipe_id) qui refuse.
  perform pg_temp.noter('F', 'F4 bis. le refus vient de la clé étrangère composite',
    coalesce(v_message, '') like '%nutrition_recipe_ingredients_link_same_recipe_fkey%'
    or coalesce(v_message, '') like '%foreign key%'
    or coalesce(v_message, '') like '%clé étrangère%');

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

-- ---------------------------------------------------------------------
-- Section K — contrat de charge utile PARTIELLE (PR B.1)
--
-- « Clé ABSENTE = rien n'est touché ; clé PRÉSENTE = la valeur est écrite,
--   y compris pour effacer. »
--
-- La version 20260808090000 ne distinguait pas les deux : une charge utile
-- sans `description` effaçait la description, une charge utile sans `status`
-- rétrogradait la recette en brouillon, et une charge utile sans `tags`
-- supprimait toutes les étiquettes. Le chemin de réimport des fixtures
-- empruntait les trois.
-- ---------------------------------------------------------------------
do $$
declare v_res jsonb; v_id uuid; v_refuse boolean := false; v_message text;
begin
  -- Une recette COMPLÈTE, activée, avec description et étiquettes.
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('coach_id','dddd9999-9999-4999-8999-999999999991',
      'name','Charge partielle','description','Notes du coach','slot_key','dinner','status','draft'),
    'ingredients', jsonb_build_array(
      jsonb_build_object('id','33339999-0000-4000-8000-000000000001','position',1,'name','Poulet','role','protein',
        'protein_per_100g',25,'carb_per_100g',0,'fat_per_100g',1,'reference_grams',140)),
    'tags', jsonb_build_array(jsonb_build_object('kind','diet','value','halal'))));
  v_id := (v_res->'recipe'->>'id')::uuid;

  -- K0. TRANSITION brouillon → actif sur une recette EXISTANTE : c'est le
  -- cas d'usage réel de l'écran, et il n'était couvert par aucun contrôle
  -- (seule une création directe en `active` l'était).
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('id', v_id, 'coach_id','dddd9999-9999-4999-8999-999999999991',
      'status','active'),
    'ingredients', jsonb_build_array(
      jsonb_build_object('id','33339999-0000-4000-8000-000000000001','position',1,'name','Poulet','role','protein',
        'protein_per_100g',25,'carb_per_100g',0,'fat_per_100g',1,'reference_grams',140))));
  perform pg_temp.noter('K', 'K0. transition brouillon → ACTIF sur une recette existante',
    (v_res->'recipe'->>'status') = 'active');

  -- Charge utile MINIMALE : uniquement l'identifiant, le coach et le nom.
  -- Ni description, ni créneau, ni statut, ni ingredients, ni tags.
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('id', v_id, 'coach_id','dddd9999-9999-4999-8999-999999999991',
      'name','Charge partielle renommée')));

  perform pg_temp.noter('K', 'K1. le nom mentionné EST écrit',
    (v_res->'recipe'->>'name') = 'Charge partielle renommée');
  perform pg_temp.noter('K', 'K2. la description NON mentionnée est CONSERVÉE',
    (v_res->'recipe'->>'description') = 'Notes du coach');
  perform pg_temp.noter('K', 'K3. le créneau NON mentionné est CONSERVÉ',
    (v_res->'recipe'->>'slot_key') = 'dinner');
  perform pg_temp.noter('K', 'K4. le statut NON mentionné est CONSERVÉ (pas de retour en brouillon)',
    (v_res->'recipe'->>'status') = 'active');
  perform pg_temp.noter('K', 'K5. les ingrédients NON mentionnés sont CONSERVÉS',
    (v_res->>'ingredient_count') = '1');
  perform pg_temp.noter('K', 'K6. les étiquettes NON mentionnées sont CONSERVÉES',
    (v_res->>'tag_count') = '1');

  -- Et l'inverse : une clé PRÉSENTE écrit, y compris pour effacer.
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('id', v_id, 'coach_id','dddd9999-9999-4999-8999-999999999991',
      'description', null, 'slot_key', null),
    'tags', '[]'::jsonb));
  perform pg_temp.noter('K', 'K7. une description PRÉSENTE à null efface bien',
    (v_res->'recipe'->'description') = 'null'::jsonb);
  perform pg_temp.noter('K', 'K8. un créneau PRÉSENT à null efface bien',
    (v_res->'recipe'->'slot_key') = 'null'::jsonb);
  perform pg_temp.noter('K', 'K9. des étiquettes PRÉSENTES à [] suppriment bien',
    (v_res->>'tag_count') = '0');
  perform pg_temp.noter('K', 'K10. et le statut, toujours non mentionné, reste ACTIF',
    (v_res->'recipe'->>'status') = 'active');

  -- Un statut inconnu reste refusé, mentionné ou non.
  begin
    perform public.save_nutrition_recipe(jsonb_build_object(
      'recipe', jsonb_build_object('id', v_id, 'coach_id','dddd9999-9999-4999-8999-999999999991',
        'status','publie')));
  exception when others then v_refuse := true; v_message := sqlerrm; end;
  perform pg_temp.noter('K', 'K11. un statut inconnu est toujours refusé',
    v_refuse and coalesce(v_message, '') like '%INVALID_STATUS%');
end $$;

-- L'upsert des ingrédients est borné à la recette : un identifiant appartenant
-- à une AUTRE recette ne peut ni être déplacé, ni être réécrit.
do $$
declare v_autre uuid; v_refuse boolean := false; v_message text; v_nom_avant text;
begin
  select id into v_autre from public.nutrition_recipes where name = 'Charge partielle renommée';
  select name into v_nom_avant from public.nutrition_recipe_ingredients
   where id = '33339999-0000-4000-8000-000000000001';

  begin
    perform public.save_nutrition_recipe(jsonb_build_object(
      'recipe', jsonb_build_object('coach_id','dddd9999-9999-4999-8999-999999999991',
        'name','Voleuse d''ingrédient','status','draft'),
      'ingredients', jsonb_build_array(
        jsonb_build_object('id','33339999-0000-4000-8000-000000000001','position',1,'name','VOLÉ','role','fixed',
          'protein_per_100g',99,'carb_per_100g',99,'fat_per_100g',99,'reference_grams',99)),
      'tags', '[]'::jsonb));
  exception when others then v_refuse := true; v_message := sqlerrm; end;

  perform pg_temp.noter('K', 'K12. réécrire l''enfant d''une AUTRE recette est refusé', v_refuse);
  perform pg_temp.noter('K', 'K13. le refus est explicite',
    coalesce(v_message, '') like '%INGREDIENT_FROM_ANOTHER_RECIPE%');
  perform pg_temp.noter('K', 'K14. l''ingrédient visé est INTACT (nom, rôle, macros)', exists (
    select 1 from public.nutrition_recipe_ingredients
     where id = '33339999-0000-4000-8000-000000000001'
       and recipe_id = v_autre and name = v_nom_avant and role = 'protein'
       and protein_per_100g = 25 and reference_grams = 140));
  perform pg_temp.noter('K', 'K15. la recette voleuse n''existe pas', not exists (
    select 1 from public.nutrition_recipes where name = 'Voleuse d''ingrédient'));
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

-- L'ADMINISTRATEUR : l'autre branche de is_coach_or_admin(), jamais exercée
-- jusqu'ici. Elle doit autoriser, exactement comme le coach.
do $$
declare v_res jsonb;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaa9999-9999-4999-8999-999999999993","role":"authenticated"}', true);
  -- DEPUIS 20260818090000 : un administrateur SANS fiche coach ne CRÉE plus.
  -- `nutrition_recipes.coach_id` est NOT NULL et la lecture élève exige
  -- `p.coach_id = r.coach_id` : une recette sans propriétaire réel serait
  -- invisible de tous. Mieux vaut un refus clair qu'une ligne morte.
  declare v_erreur text;
  begin
    begin
      v_res := public.save_nutrition_recipe(jsonb_build_object(
        'recipe', jsonb_build_object('coach_id','dddd9999-9999-4999-8999-999999999991',
          'name','Écrite par un administrateur','status','draft'),
        'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb));
    exception when others then v_erreur := sqlerrm; end;
    perform pg_temp.noter('H', 'H0. un ADMINISTRATEUR sans fiche coach ne peut pas CRÉER',
      coalesce(v_erreur, '') like '%NO_COACH_PROFILE%');
    perform pg_temp.noter('H', 'H0 bis. et rien n''a été créé au nom du coach visé',
      not exists (select 1 from public.nutrition_recipes
                   where name = 'Écrite par un administrateur'));
  end;
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
       and nutrition_model_version = 2
       and daily_target = '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb));
  perform pg_temp.noter('H', 'H6. aucune table de portion calculée n''existe', (
    select count(*) = 0 from pg_tables
     where schemaname = 'public'
       and (tablename like '%solved%' or tablename like '%portion%' or tablename like '%serving%')));
  -- ⚠️ PR C — la lecture élève est désormais VOULUE, et chaînée jusqu'au coach
  -- du plan assigné (migration 20260813090000). Le contrôle vérifie donc sa
  -- présence sur les trois tables, au lieu de son absence.
  perform pg_temp.noter('H', 'H7. la lecture élève existe, et sur les TROIS tables', (
    select count(*) = 3 from pg_policy
     where polrelid in ('public.nutrition_recipes'::regclass,
                        'public.nutrition_recipe_ingredients'::regclass,
                        'public.nutrition_recipe_tags'::regclass)
       and coalesce(pg_get_expr(polqual, polrelid), '') like '%current_student_id%'));
end $$;


-- =====================================================================
-- Section K — CATALOGUE : duplication et import (migration 20260818090000)
-- =====================================================================
-- Les deux RPC de la PR E partagent une même exigence : le navigateur ne
-- choisit JAMAIS le propriétaire. On l'éprouve en tentant précisément cela.
insert into public.coaches (id, name, email)
values ('dddd9999-9999-4999-8999-999999999992', 'Autre coach', 'ra.autre@test.local');

insert into public.nutrition_recipes (id, coach_id, name, description, slot_key, status)
values ('99999999-9999-4999-8999-999999999901', 'dddd9999-9999-4999-8999-999999999991',
        'Catalogue — source', 'à recopier', 'lunch', 'active'),
       ('99999999-9999-4999-8999-999999999902', 'dddd9999-9999-4999-8999-999999999992',
        'Catalogue — autre coach', null, 'lunch', 'active');
insert into public.nutrition_recipe_ingredients
  (id, recipe_id, position, name, role, protein_per_100g, carb_per_100g, fat_per_100g, reference_grams)
values ('99999999-9999-4999-8999-999999999911', '99999999-9999-4999-8999-999999999901', 1, 'Poulet', 'protein', 25, 0, 1, 140),
       ('99999999-9999-4999-8999-999999999912', '99999999-9999-4999-8999-999999999901', 2, 'Sauce', 'fat', 3, 3, 40, 20);
update public.nutrition_recipe_ingredients
   set linked_to_ingredient_id = '99999999-9999-4999-8999-999999999911', link_ratio_bp = 2500
 where id = '99999999-9999-4999-8999-999999999912';
insert into public.nutrition_recipe_tags (recipe_id, kind, value)
values ('99999999-9999-4999-8999-999999999901', 'diet', 'halal');

do $$
declare v jsonb; v_copie uuid; v_avant int; v_apres int; v_erreur text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaa9999-9999-4999-8999-999999999991","role":"authenticated"}', true);

  -- ── DUPLICATION ─────────────────────────────────────────────────────
  v := public.duplicate_nutrition_recipe('99999999-9999-4999-8999-999999999901');
  v_copie := (v->>'recipe_id')::uuid;
  perform pg_temp.noter('K', 'K1. la duplication copie ingrédients, liaisons et étiquettes',
    (v->>'ok')::boolean is true
    and (v->'copied'->>'ingredients')::int = 2
    and (v->'copied'->>'links')::int = 1
    and (v->'copied'->>'tags')::int = 1);
  perform pg_temp.noter('K', 'K2. la copie naît en BROUILLON, jamais publiée',
    (select status from public.nutrition_recipes where id = v_copie) = 'draft');
  perform pg_temp.noter('K', 'K3. identifiants DISTINCTS, à tous les niveaux',
    v_copie <> '99999999-9999-4999-8999-999999999901'
    and not exists (select 1 from public.nutrition_recipe_ingredients
                     where recipe_id = v_copie
                       and id in ('99999999-9999-4999-8999-999999999911',
                                  '99999999-9999-4999-8999-999999999912')));
  perform pg_temp.noter('K', 'K4. la liaison pointe DANS la copie, pas vers l''original',
    (select bool_and(p.recipe_id = v_copie)
       from public.nutrition_recipe_ingredients i
       join public.nutrition_recipe_ingredients p on p.id = i.linked_to_ingredient_id
      where i.recipe_id = v_copie));
  perform pg_temp.noter('K', 'K5. l''ORIGINAL est intact : nom, statut, enfants',
    (select name from public.nutrition_recipes where id = '99999999-9999-4999-8999-999999999901') = 'Catalogue — source'
    and (select status from public.nutrition_recipes where id = '99999999-9999-4999-8999-999999999901') = 'active'
    and (select count(*) from public.nutrition_recipe_ingredients where recipe_id = '99999999-9999-4999-8999-999999999901') = 2);
  perform pg_temp.noter('K', 'K6. la copie hérite du propriétaire de la SOURCE',
    (select coach_id from public.nutrition_recipes where id = v_copie) = 'dddd9999-9999-4999-8999-999999999991');
  perform pg_temp.noter('K', 'K7. source_key nulle : une copie n''usurpe pas l''identité d''une fixture',
    (select source_key from public.nutrition_recipes where id = v_copie) is null);

  -- La recette d'un AUTRE coach est INTROUVABLE — pas « interdite » : la RLS
  -- ne révèle même pas son existence.
  v := public.duplicate_nutrition_recipe('99999999-9999-4999-8999-999999999902');
  perform pg_temp.noter('K', 'K8. dupliquer la recette d''un AUTRE coach est refusé',
    (v->>'ok')::boolean is false and v->>'reason' = 'not_found');

  -- ── IMPORT ──────────────────────────────────────────────────────────
  -- Le fichier tente d'injecter un propriétaire ET une publication.
  v := public.import_nutrition_recipes(jsonb_build_object('recipes', jsonb_build_array(
    jsonb_build_object(
      'name', 'Importée A',
      'coach_id', 'dddd9999-9999-4999-8999-999999999992',
      'status', 'active',
      'slot_key', 'dinner',
      'tags', jsonb_build_array(jsonb_build_object('kind', 'diet', 'value', 'vegan')),
      'ingredients', jsonb_build_array(
        jsonb_build_object('position', 1, 'name', 'Tofu', 'role', 'protein',
                           'protein_per_100g', 12, 'carb_per_100g', 2, 'fat_per_100g', 7, 'reference_grams', 150),
        jsonb_build_object('position', 2, 'name', 'Huile', 'role', 'fat',
                           'protein_per_100g', 0, 'carb_per_100g', 0, 'fat_per_100g', 100, 'reference_grams', 10,
                           'linked_to_position', 1, 'link_ratio_bp', 1000))))));
  perform pg_temp.noter('K', 'K9. l''import crée les recettes demandées',
    (v->>'ok')::boolean is true and (v->>'count')::int = 1 and (v->>'ingredients')::int = 2);
  perform pg_temp.noter('K', 'K10. une recette importée arrive en BROUILLON, malgré le fichier',
    (select status from public.nutrition_recipes where name = 'Importée A') = 'draft');
  perform pg_temp.noter('K', 'K11. le coach_id du FICHIER est ignoré : le serveur décide',
    (select coach_id from public.nutrition_recipes where name = 'Importée A')
      = 'dddd9999-9999-4999-8999-999999999991'
    and not exists (select 1 from public.nutrition_recipes
                     where coach_id = 'dddd9999-9999-4999-8999-999999999992'
                       and name = 'Importée A'));
  perform pg_temp.noter('K', 'K12. les liaisons importées restent DANS la recette',
    (select bool_and(p.recipe_id = i.recipe_id)
       from public.nutrition_recipe_ingredients i
       join public.nutrition_recipe_ingredients p on p.id = i.linked_to_ingredient_id
       join public.nutrition_recipes r on r.id = i.recipe_id
      where r.name = 'Importée A'));

  -- ── TRANSACTIONNALITÉ ───────────────────────────────────────────────
  -- Un lot dont UNE recette est fautive ne doit rien laisser derrière lui.
  select count(*) into v_avant from public.nutrition_recipes;
  begin
    perform public.import_nutrition_recipes(jsonb_build_object('recipes', jsonb_build_array(
      jsonb_build_object('name', 'Valide du lot', 'ingredients', jsonb_build_array(
        jsonb_build_object('position', 1, 'name', 'Riz', 'role', 'carbohydrate',
                           'protein_per_100g', 7, 'carb_per_100g', 77, 'fat_per_100g', 1, 'reference_grams', 100))),
      jsonb_build_object('name', 'Fautive du lot', 'ingredients', jsonb_build_array(
        jsonb_build_object('position', 1, 'name', 'X', 'role', 'inconnu', 'reference_grams', 10))))));
  exception when others then v_erreur := sqlerrm; end;
  select count(*) into v_apres from public.nutrition_recipes;
  perform pg_temp.noter('K', 'K13. un lot fautif est REFUSÉ, et nomme la cause',
    v_erreur like '%INVALID_ROLE%');
  perform pg_temp.noter('K', 'K14. et n''écrit RIEN : pas même la recette valide du lot',
    v_avant = v_apres
    and not exists (select 1 from public.nutrition_recipes where name = 'Valide du lot'));

  reset role;
end $$;

do $$
declare v jsonb; v_refuse boolean := false;
begin
  -- ── UN ÉLÈVE N'IMPORTE NI NE DUPLIQUE ───────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaa9999-9999-4999-8999-999999999992","role":"authenticated"}', true);
  v := public.duplicate_nutrition_recipe('99999999-9999-4999-8999-999999999901');
  perform pg_temp.noter('K', 'K15. un ÉLÈVE ne peut pas dupliquer',
    (v->>'ok')::boolean is false and v->>'reason' = 'forbidden');
  v := public.import_nutrition_recipes(jsonb_build_object('recipes', jsonb_build_array(
    jsonb_build_object('name', 'Par un élève', 'ingredients', jsonb_build_array(
      jsonb_build_object('position', 1, 'name', 'X', 'role', 'protein',
                         'protein_per_100g', 1, 'carb_per_100g', 1, 'fat_per_100g', 1, 'reference_grams', 10))))));
  perform pg_temp.noter('K', 'K16. un ÉLÈVE ne peut pas importer',
    (v->>'ok')::boolean is false and v->>'reason' = 'forbidden');
  perform pg_temp.noter('K', 'K17. et rien n''a été créé en son nom',
    not exists (select 1 from public.nutrition_recipes where name = 'Par un élève'));
  reset role;

  -- ── anon ─────────────────────────────────────────────────────────────
  perform pg_temp.noter('K', 'K18. anon ne peut exécuter aucune des deux RPC',
    not has_function_privilege('anon', 'public.duplicate_nutrition_recipe(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.import_nutrition_recipes(jsonb)', 'execute'));
  perform pg_temp.noter('K', 'K19. authenticated le peut, et les deux sont security invoker', (
    select count(*) = 2 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
     where n.nspname = 'public'
       and p.proname in ('duplicate_nutrition_recipe', 'import_nutrition_recipes')
       and p.prosecdef = false
       and r.rolname = 'postgres'
       and 'search_path=""' = any(p.proconfig))
    and has_function_privilege('authenticated', 'public.duplicate_nutrition_recipe(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.import_nutrition_recipes(jsonb)', 'execute'));

  -- ── L'ÉLÈVE NE VOIT NI COPIE NI IMPORT ──────────────────────────────
  -- Les deux naissent en brouillon : la policy élève n'ouvre que « active ».
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaa9999-9999-4999-8999-999999999992","role":"authenticated"}', true);
  perform pg_temp.noter('K', 'K20. aucune recette dupliquée ou importée n''est visible de l''élève',
    not exists (select 1 from public.nutrition_recipes
                 where name in ('Catalogue — source — copie', 'Importée A')));
  reset role;
end $$;

reset role;


-- =====================================================================
-- Section L — LE PROPRIÉTAIRE N'EST PLUS CHOISI PAR LE CLIENT (20260818090000)
-- =====================================================================
-- `save_nutrition_recipe` lisait `coach_id` DANS la charge utile. Un coach
-- ordinaire était déjà contraint par le `with check` de
-- `nutrition_recipes_manage_own_coach` — mais un ADMINISTRATEUR ne l'était
-- pas, et le repli « premier coach du cabinet » de `useCurrentCoachId`
-- pouvait attribuer une recette au mauvais propriétaire sans la moindre
-- malveillance. Ces contrôles éprouvent la règle DEPUIS LA RPC, pas depuis
-- l'écran.
insert into public.coaches (id, user_id, name, email)
values ('dddd9999-9999-4999-8999-999999999993', null, 'Coach cible', 'ra.cible@test.local');

do $$
declare v_res jsonb; v_id uuid; v_erreur text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaa9999-9999-4999-8999-999999999991","role":"authenticated"}', true);

  -- L1. CRÉATION en nommant un AUTRE coach → le serveur impose l'appelant.
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object(
      'coach_id', 'dddd9999-9999-4999-8999-999999999993',
      'name', 'Propriété — tentative pour un autre', 'status', 'draft'),
    'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb));
  v_id := (v_res->'recipe'->>'id')::uuid;
  perform pg_temp.noter('L', 'L1. créer en nommant un AUTRE coach : le propriétaire reste l''appelant',
    (select coach_id from public.nutrition_recipes where id = v_id)
      = 'dddd9999-9999-4999-8999-999999999991');
  perform pg_temp.noter('L', 'L2. et RIEN n''a été créé pour le coach visé',
    not exists (select 1 from public.nutrition_recipes
                 where coach_id = 'dddd9999-9999-4999-8999-999999999993'));

  -- L3. CRÉATION avec un coach_id inventé → même verdict.
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object(
      'coach_id', '00000000-0000-4000-8000-0000000000ff',
      'name', 'Propriété — coach inventé', 'status', 'draft'),
    'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb));
  perform pg_temp.noter('L', 'L3. un coach_id inventé n''empêche rien et ne décide de rien',
    (select coach_id from public.nutrition_recipes
      where id = (v_res->'recipe'->>'id')::uuid) = 'dddd9999-9999-4999-8999-999999999991');

  -- L4. MODIFICATION de SA recette en tentant de changer le propriétaire.
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object(
      'id', v_id,
      'coach_id', 'dddd9999-9999-4999-8999-999999999993',
      'name', 'Propriété — renommée')));
  perform pg_temp.noter('L', 'L4. modifier sa recette ne change PAS son propriétaire',
    (select coach_id from public.nutrition_recipes where id = v_id)
      = 'dddd9999-9999-4999-8999-999999999991'
    and (select name from public.nutrition_recipes where id = v_id) = 'Propriété — renommée');

  reset role;
end $$;

-- Une recette appartenant à un AUTRE coach, créée hors rôle.
insert into public.nutrition_recipes (id, coach_id, name, status)
values ('88889999-9999-4999-8999-999999999901', 'dddd9999-9999-4999-8999-999999999993',
        'Propriété — recette d''autrui', 'draft');

do $$
declare v_res jsonb; v_erreur text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaa9999-9999-4999-8999-999999999991","role":"authenticated"}', true);

  -- L5. MODIFIER la recette d'un autre coach : refusée. `RECIPE_NOT_FOUND`
  --     et non « interdit » — la RLS ne révèle même pas son existence.
  begin
    v_res := public.save_nutrition_recipe(jsonb_build_object(
      'recipe', jsonb_build_object(
        'id', '88889999-9999-4999-8999-999999999901',
        'coach_id', 'dddd9999-9999-4999-8999-999999999991',
        'name', 'Volée')));
  exception when others then v_erreur := sqlerrm; end;
  perform pg_temp.noter('L', 'L5. modifier la recette d''un AUTRE coach est refusé',
    coalesce(v_erreur, '') like '%RECIPE_NOT_FOUND%');
  reset role;

  -- Recomptage HORS RÔLE : sous la RLS de l'appelant, la ligne est invisible
  -- de toute façon. Seule une lecture privilégiée prouve qu'elle est intacte.
  perform pg_temp.noter('L', 'L6. la recette d''autrui garde son nom ET son propriétaire',
    (select name from public.nutrition_recipes where id = '88889999-9999-4999-8999-999999999901')
      = 'Propriété — recette d''autrui'
    and (select coach_id from public.nutrition_recipes where id = '88889999-9999-4999-8999-999999999901')
      = 'dddd9999-9999-4999-8999-999999999993');
end $$;

do $$
declare v_res jsonb;
begin
  -- L7. L'ADMINISTRATEUR corrige une recette SANS se l'approprier. C'est le
  --     point que la spécification demandait de ne pas supposer : modifier
  --     n'est pas devenir propriétaire.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaa9999-9999-4999-8999-999999999993","role":"authenticated"}', true);
  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object(
      'id', '88889999-9999-4999-8999-999999999901',
      'name', 'Propriété — corrigée par un admin')));
  perform pg_temp.noter('L', 'L7. un ADMIN peut corriger n''importe quelle recette',
    (v_res->'recipe'->>'id') = '88889999-9999-4999-8999-999999999901');
  reset role;
  perform pg_temp.noter('L', 'L8. mais il ne s''en approprie PAS la propriété',
    (select coach_id from public.nutrition_recipes where id = '88889999-9999-4999-8999-999999999901')
      = 'dddd9999-9999-4999-8999-999999999993'
    and (select name from public.nutrition_recipes where id = '88889999-9999-4999-8999-999999999901')
      = 'Propriété — corrigée par un admin');
end $$;

do $$
declare v_res jsonb; v_dup jsonb; v_imp jsonb;
begin
  -- L9. LES TROIS CHEMINS D'ÉCRITURE appliquent la MÊME règle. C'est le
  --     contrôle qui compte : une seule porte laissée ouverte suffirait.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaaa9999-9999-4999-8999-999999999991","role":"authenticated"}', true);

  v_res := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('coach_id', 'dddd9999-9999-4999-8999-999999999993',
                                 'name', 'Trois chemins — manuel', 'status', 'draft'),
    'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb));
  v_dup := public.duplicate_nutrition_recipe((v_res->'recipe'->>'id')::uuid);
  v_imp := public.import_nutrition_recipes(jsonb_build_object('recipes', jsonb_build_array(
    jsonb_build_object('name', 'Trois chemins — import',
      'coach_id', 'dddd9999-9999-4999-8999-999999999993',
      'ingredients', jsonb_build_array(jsonb_build_object(
        'position', 1, 'name', 'X', 'role', 'protein',
        'protein_per_100g', 20, 'carb_per_100g', 0, 'fat_per_100g', 1, 'reference_grams', 100))))));

  perform pg_temp.noter('L', 'L9. manuel, duplication et import donnent le MÊME propriétaire', (
    select count(distinct coach_id) = 1 and min(coach_id::text) = 'dddd9999-9999-4999-8999-999999999991'
      from public.nutrition_recipes
     where id in ((v_res->'recipe'->>'id')::uuid,
                  (v_dup->>'recipe_id')::uuid,
                  (v_imp->'created'->0->>'recipe_id')::uuid)));
  perform pg_temp.noter('L', 'L10. et les trois naissent en BROUILLON', (
    select bool_and(status = 'draft') from public.nutrition_recipes
     where id in ((v_res->'recipe'->>'id')::uuid,
                  (v_dup->>'recipe_id')::uuid,
                  (v_imp->'created'->0->>'recipe_id')::uuid)));
  reset role;
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
  select count(*) into nb from public.nutrition_recipes
   where name in ('Poulet riz crème', 'Poulet panure', 'Brouillon incomplet', 'Porridge Protéiné',
                  'Charge partielle', 'Charge partielle renommée', 'Voleuse d''ingrédient',
                  'Écrite par un administrateur');
  if nb <> 0 then
    raise exception 'ÉCHEC   — J1. des recettes de test ont survécu au ROLLBACK (% lignes)', nb;
  end if;
  -- On compte les ingrédients DE TEST, identifiés par leurs préfixes d'UUID,
  -- et non la table entière : depuis l'import des fixtures, une base locale
  -- contient légitimement des recettes, et l'ancienne assertion « la table est
  -- vide » aurait échoué sans qu'aucune donnée de test n'ait survécu.
  select count(*) into nb from public.nutrition_recipes
   where name in ('Catalogue — source', 'Catalogue — source — copie', 'Importée A',
                  'Catalogue — autre coach', 'Propriété — recette d''autrui',
                  'Propriété — corrigée par un admin', 'Trois chemins — manuel',
                  'Trois chemins — import')
      or name like 'Propriété — %';
  if nb <> 0 then
    raise exception 'ÉCHEC   — J1 bis. des recettes de la section K ont survécu au ROLLBACK (% lignes)', nb;
  end if;

  select count(*) into nb from public.nutrition_recipe_ingredients
   where id::text like '11119999-%' or id::text like '22229999-%' or id::text like '33339999-%'
      or id::text like '99999999-%';
  if nb <> 0 then
    raise exception 'ÉCHEC   — J2. des ingrédients de test ont survécu au ROLLBACK (% lignes)', nb;
  end if;
  select count(*) into nb from auth.users
   where email in ('ra.coach@test.local', 'ra.eleve@test.local', 'ra.admin@test.local');
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
