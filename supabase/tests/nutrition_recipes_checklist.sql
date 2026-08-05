-- ============================================================================
-- Checklist PostgreSQL — feat/nutrition-adaptive-recipes-engine, PR A
-- Migration couverte : 20260807090000_nutrition_recipes.sql
--
-- CE QU'ELLE VÉRIFIE
--   A. les trois tables existent, avec leurs colonnes et leurs contraintes ;
--   B. sécurité : RLS activée, policies staff, AUCUNE lecture élève,
--      privilèges minimaux et AUCUN TRUNCATE pour authenticated ;
--   C. la fonction de validation : signature, security invoker, owner,
--      search_path, privilèges, et absence d'écriture ;
--   D. les invariants de table refusent réellement les lignes fautives ;
--   E. nutrition_recipe_blocking_issue exerce chacun de ses codes ;
--   F. comportement RLS réel : coach écrit et lit, élève ne lit rien,
--      anon et PUBLIC refusés ;
--   G. lecture groupée : une recette complète se lit en trois requêtes ;
--   H. les plans v1 et v2 ne sont pas touchés ;
--   I. après le ROLLBACK, aucune donnée de test ne subsiste.
--
-- EXÉCUTION (base LOCALE uniquement) :
--   docker exec -i "$DB_CONTAINER" \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/nutrition_recipes_checklist.sql
--
-- ⚠️ NE JAMAIS exécuter sur la Production.
-- ============================================================================

\timing off

begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;

-- Les contrôles s'exécutent sous `authenticated` puis `anon` : ces rôles
-- doivent pouvoir écrire dans la table de faits de la checklist.
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

-- ---------------------------------------------------------------------
-- Section A — les trois tables
-- ---------------------------------------------------------------------
do $$
declare v_nb int;
begin
  select count(*) into v_nb from pg_tables
   where schemaname = 'public'
     and tablename in ('nutrition_recipes', 'nutrition_recipe_ingredients', 'nutrition_recipe_tags');
  perform pg_temp.noter('A', 'A1. les trois tables existent', v_nb = 3);

  perform pg_temp.noter('A', 'A2. nutrition_recipes : colonnes attendues', (
    select count(*) = 8 from information_schema.columns
     where table_schema = 'public' and table_name = 'nutrition_recipes'
       and column_name in ('id','coach_id','name','description','slot_key','status','created_at','updated_at')));

  -- Les 21 colonnes attendues, ET AUCUNE AUTRE : le miroir de
  -- RecipeIngredient doit être exact, pas seulement suffisant.
  perform pg_temp.noter('A', 'A3. nutrition_recipe_ingredients : miroir EXACT de RecipeIngredient', (
    select array_agg(column_name::text order by column_name::text) = array[
      'carb_per_100g','created_at','egg','egg_grams','fat_per_100g','fixed_label','id',
      'link_ratio_bp','linked_to_ingredient_id','max_grams','max_units','min_grams','name',
      'position','protein_per_100g','recipe_id','reference_grams','role','unit_name',
      'unit_scalable','updated_at']::text[]
      from information_schema.columns
     where table_schema = 'public' and table_name = 'nutrition_recipe_ingredients'));

  perform pg_temp.noter('A', 'A4. nutrition_recipe_tags : clé primaire (recipe_id, kind, value)', exists (
    select 1 from pg_constraint
     where conrelid = 'public.nutrition_recipe_tags'::regclass
       and contype = 'p'
       and pg_get_constraintdef(oid) = 'PRIMARY KEY (recipe_id, kind, value)'));

  perform pg_temp.noter('A', 'A5. unicité (recipe_id, position)', exists (
    select 1 from pg_constraint
     where conrelid = 'public.nutrition_recipe_ingredients'::regclass
       and conname = 'nutrition_recipe_ingredients_position_unique'));

  perform pg_temp.noter('A', 'A6. clé étrangère COMPOSITE : un lien reste dans la recette', exists (
    select 1 from pg_constraint
     where conrelid = 'public.nutrition_recipe_ingredients'::regclass
       and conname = 'nutrition_recipe_ingredients_link_same_recipe'
       and contype = 'f'));

  perform pg_temp.noter('A', 'A7. index de lecture (recipe_id, position)', exists (
    select 1 from pg_indexes where schemaname = 'public'
       and indexname = 'nutrition_recipe_ingredients_recipe_id_idx'));

  perform pg_temp.noter('A', 'A8. index de proposition (status, slot_key)', exists (
    select 1 from pg_indexes where schemaname = 'public'
       and indexname = 'nutrition_recipes_status_slot_idx'));
end $$;

-- ---------------------------------------------------------------------
-- Section B — sécurité, privilèges, TRUNCATE
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['nutrition_recipes','nutrition_recipe_ingredients','nutrition_recipe_tags'] loop
    perform pg_temp.noter('B', format('B1. RLS activée sur %s', t), (
      select c.relrowsecurity from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t));

    perform pg_temp.noter('B', format('B2. %s : AUCUN TRUNCATE pour authenticated', t),
      not has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE'));

    perform pg_temp.noter('B', format('B3. %s : authenticated a select/insert/update/delete', t),
      has_table_privilege('authenticated', 'public.' || t, 'SELECT')
      and has_table_privilege('authenticated', 'public.' || t, 'INSERT')
      and has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
      and has_table_privilege('authenticated', 'public.' || t, 'DELETE'));

    perform pg_temp.noter('B', format('B4. %s : anon n''a AUCUN droit', t),
      not has_table_privilege('anon', 'public.' || t, 'SELECT')
      and not has_table_privilege('anon', 'public.' || t, 'INSERT')
      and not has_table_privilege('anon', 'public.' || t, 'TRUNCATE'));

    perform pg_temp.noter('B', format('B5. %s : service_role conserve le gabarit', t),
      has_table_privilege('service_role', 'public.' || t, 'SELECT')
      and has_table_privilege('service_role', 'public.' || t, 'TRUNCATE'));
  end loop;

  perform pg_temp.noter('B', 'B6. trois policies staff, et AUCUNE lecture élève', (
    select count(*) = 3 from pg_policy
     where polrelid in ('public.nutrition_recipes'::regclass,
                        'public.nutrition_recipe_ingredients'::regclass,
                        'public.nutrition_recipe_tags'::regclass)));

  perform pg_temp.noter('B', 'B7. aucune policy ne référence current_student_id()', not exists (
    select 1 from pg_policy
     where polrelid in ('public.nutrition_recipes'::regclass,
                        'public.nutrition_recipe_ingredients'::regclass,
                        'public.nutrition_recipe_tags'::regclass)
       and coalesce(pg_get_expr(polqual, polrelid), '') like '%current_student_id%'));

  perform pg_temp.noter('B', 'B8. les policies staff s''appuient sur is_coach_or_admin()', (
    select count(*) = 3 from pg_policy
     where polrelid in ('public.nutrition_recipes'::regclass,
                        'public.nutrition_recipe_ingredients'::regclass,
                        'public.nutrition_recipe_tags'::regclass)
       and pg_get_expr(polqual, polrelid) like '%is_coach_or_admin%'));
end $$;

-- ---------------------------------------------------------------------
-- Section C — la fonction de validation
-- ---------------------------------------------------------------------
do $$
declare
  v_secdef boolean; v_owner text; v_config text[]; v_volatile char;
begin
  select p.prosecdef, pg_get_userbyid(p.proowner), p.proconfig, p.provolatile
    into v_secdef, v_owner, v_config, v_volatile
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nutrition_recipe_blocking_issue';

  perform pg_temp.noter('C', 'C1. nutrition_recipe_blocking_issue existe', v_owner is not null);
  perform pg_temp.noter('C', 'C2. SECURITY INVOKER (aucune fonction security definer)', v_secdef = false);
  perform pg_temp.noter('C', 'C3. propriétaire postgres', v_owner = 'postgres');
  perform pg_temp.noter('C', 'C4. search_path verrouillé à vide',
    v_config @> array['search_path=']::text[] or v_config @> array['search_path=""']::text[]
    or v_config @> array['search_path=''''']::text[]);
  perform pg_temp.noter('C', 'C5. déclarée stable : aucune écriture possible', v_volatile = 's');
  perform pg_temp.noter('C', 'C6. signature (p_recipe_id uuid) returns text', exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'nutrition_recipe_blocking_issue'
       and pg_get_function_identity_arguments(p.oid) = 'p_recipe_id uuid'
       and pg_get_function_result(p.oid) = 'text'));
  perform pg_temp.noter('C', 'C7. anon ne peut pas l''exécuter',
    not has_function_privilege('anon', 'public.nutrition_recipe_blocking_issue(uuid)', 'execute'));
  perform pg_temp.noter('C', 'C8. PUBLIC ne peut pas l''exécuter',
    not has_function_privilege('public', 'public.nutrition_recipe_blocking_issue(uuid)', 'execute'));
  perform pg_temp.noter('C', 'C9. authenticated peut l''exécuter',
    has_function_privilege('authenticated', 'public.nutrition_recipe_blocking_issue(uuid)', 'execute'));
end $$;

-- ---------------------------------------------------------------------
-- Jeu d'essai
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('eeee7777-7777-4777-8777-777777777777', 'rc.coach@test.local'),
  ('eeee8888-8888-4888-8888-888888888888', 'rc.eleve@test.local')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('eeee7777-7777-4777-8777-777777777777', 'coach', 'Rémi', 'C', 'rc.coach@test.local'),
  ('eeee8888-8888-4888-8888-888888888888', 'student', 'Elsa', 'E', 'rc.eleve@test.local');

insert into public.students (id, user_id, first_name, last_name, email, status, access_type)
values ('99990000-0000-4000-8000-000000000009', 'eeee8888-8888-4888-8888-888888888888',
        'Elsa', 'E', 'rc.eleve@test.local', 'active', 'coaching');

insert into public.coaches (id, name, email)
values ('cccc0000-0000-4000-8000-000000000009', 'Rémi', 'rc.coach@test.local');

-- Plan v1 TÉMOIN : il ne doit jamais bouger.
insert into public.nutrition_plans (id, student_id, name, goal_type, status, daily_target, nutrition_model_version)
values ('77770000-0000-4000-8000-000000000009', '99990000-0000-4000-8000-000000000009',
        'Témoin v1', 'maintien', 'actif',
        '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb, 1);

-- ---------------------------------------------------------------------
-- Section D — les invariants de table refusent réellement
-- ---------------------------------------------------------------------
insert into public.nutrition_recipes (id, coach_id, name, slot_key, status)
values ('11110000-0000-4000-8000-00000000000a', 'cccc0000-0000-4000-8000-000000000009',
        'Poulet riz crème', 'lunch', 'active'),
       ('11110000-0000-4000-8000-00000000000b', 'cccc0000-0000-4000-8000-000000000009',
        'Recette générique', null, 'active');

insert into public.nutrition_recipe_ingredients
  (id, recipe_id, position, name, role, protein_per_100g, carb_per_100g, fat_per_100g, reference_grams, max_grams)
values ('22220000-0000-4000-8000-00000000000a', '11110000-0000-4000-8000-00000000000a', 1, 'Poulet', 'protein', 25, 0, 1, 140, null),
       ('22220000-0000-4000-8000-00000000000b', '11110000-0000-4000-8000-00000000000a', 2, 'Riz', 'carbohydrate', 7, 77, 1, 100, null),
       ('22220000-0000-4000-8000-00000000000c', '11110000-0000-4000-8000-00000000000a', 3, 'Crème', 'fat', 3, 3, 4, 80, 100);

insert into public.nutrition_recipe_ingredients
  (id, recipe_id, position, name, role, protein_per_100g, carb_per_100g, fat_per_100g, reference_grams)
values ('22220000-0000-4000-8000-00000000000d', '11110000-0000-4000-8000-00000000000b', 1, 'Avoine', 'carbohydrate', 13, 68, 7, 60);

insert into public.nutrition_recipe_tags (recipe_id, kind, value) values
  ('11110000-0000-4000-8000-00000000000a', 'allergen', 'milk'),
  ('11110000-0000-4000-8000-00000000000a', 'excludes', 'poultry');

do $$
declare v_refuse boolean;
begin
  v_refuse := false;
  begin insert into public.nutrition_recipe_ingredients (recipe_id, position, name, role, protein_per_100g, carb_per_100g, fat_per_100g, reference_grams)
        values ('11110000-0000-4000-8000-00000000000a', 1, 'Doublon', 'fixed', 0, 0, 0, 10);
  exception when unique_violation then v_refuse := true; end;
  perform pg_temp.noter('D', 'D1. position dupliquée REFUSÉE', v_refuse);

  v_refuse := false;
  begin insert into public.nutrition_recipe_ingredients (recipe_id, position, name, role, protein_per_100g, carb_per_100g, fat_per_100g, reference_grams)
        values ('11110000-0000-4000-8000-00000000000a', 9, 'Négatif', 'fixed', -1, 0, 0, 10);
  exception when check_violation then v_refuse := true; end;
  perform pg_temp.noter('D', 'D2. macro négative REFUSÉE', v_refuse);

  v_refuse := false;
  begin insert into public.nutrition_recipe_ingredients (recipe_id, position, name, role, protein_per_100g, carb_per_100g, fat_per_100g, reference_grams, min_grams, max_grams)
        values ('11110000-0000-4000-8000-00000000000a', 9, 'Bornes', 'fixed', 0, 0, 0, 10, 80, 20);
  exception when check_violation then v_refuse := true; end;
  perform pg_temp.noter('D', 'D3. bornes incohérentes (min > max) REFUSÉES', v_refuse);

  v_refuse := false;
  begin insert into public.nutrition_recipe_ingredients (recipe_id, position, name, role, protein_per_100g, carb_per_100g, fat_per_100g, reference_grams, linked_to_ingredient_id, link_ratio_bp)
        values ('11110000-0000-4000-8000-00000000000a', 9, 'Externe', 'fixed', 0, 0, 0, 10, '22220000-0000-4000-8000-00000000000d', 1500);
  exception when foreign_key_violation then v_refuse := true; end;
  perform pg_temp.noter('D', 'D4. lien vers un ingrédient d''une AUTRE recette REFUSÉ', v_refuse);

  v_refuse := false;
  begin insert into public.nutrition_recipe_ingredients (recipe_id, position, name, role, protein_per_100g, carb_per_100g, fat_per_100g, reference_grams, linked_to_ingredient_id)
        values ('11110000-0000-4000-8000-00000000000a', 9, 'SansRatio', 'fixed', 0, 0, 0, 10, '22220000-0000-4000-8000-00000000000a');
  exception when check_violation then v_refuse := true; end;
  perform pg_temp.noter('D', 'D5. liaison sans part (link_ratio_bp) REFUSÉE', v_refuse);

  v_refuse := false;
  begin insert into public.nutrition_recipes (coach_id, name, status)
        values ('cccc0000-0000-4000-8000-000000000009', 'X', 'publie');
  exception when check_violation then v_refuse := true; end;
  perform pg_temp.noter('D', 'D6. statut inconnu REFUSÉ', v_refuse);

  v_refuse := false;
  begin insert into public.nutrition_recipes (coach_id, name, slot_key, status)
        values ('cccc0000-0000-4000-8000-000000000009', 'X', 'brunch', 'active');
  exception when check_violation then v_refuse := true; end;
  perform pg_temp.noter('D', 'D7. slot_key hors des six créneaux v2 REFUSÉ', v_refuse);

  v_refuse := false;
  begin insert into public.nutrition_recipe_tags (recipe_id, kind, value)
        values ('11110000-0000-4000-8000-00000000000a', 'allergen', 'cacahuete');
  exception when check_violation then v_refuse := true; end;
  perform pg_temp.noter('D', 'D8. étiquette hors vocabulaire contrôlé REFUSÉE', v_refuse);

  v_refuse := false;
  begin insert into public.nutrition_recipe_tags (recipe_id, kind, value)
        values ('11110000-0000-4000-8000-00000000000a', 'allergen', 'milk');
  exception when unique_violation then v_refuse := true; end;
  perform pg_temp.noter('D', 'D9. étiquette dupliquée REFUSÉE', v_refuse);

  v_refuse := false;
  begin insert into public.nutrition_recipe_tags (recipe_id, kind, value)
        values ('11110000-0000-4000-8000-00000000000a', 'humeur', 'milk');
  exception when check_violation then v_refuse := true; end;
  perform pg_temp.noter('D', 'D10. famille d''étiquette inconnue REFUSÉE', v_refuse);

  v_refuse := false;
  begin insert into public.nutrition_recipes (coach_id, name, status)
        values ('cccc0000-0000-4000-8000-000000000009', '   ', 'active');
  exception when check_violation then v_refuse := true; end;
  perform pg_temp.noter('D', 'D11. nom vide REFUSÉ', v_refuse);
end $$;

-- ---------------------------------------------------------------------
-- Section E — nutrition_recipe_blocking_issue, code par code
-- ---------------------------------------------------------------------
do $$
declare v_vide uuid := '11110000-0000-4000-8000-00000000000e';
begin
  perform pg_temp.noter('E', 'E1. recette complète ⇒ null (exploitable)',
    public.nutrition_recipe_blocking_issue('11110000-0000-4000-8000-00000000000a') is null);

  perform pg_temp.noter('E', 'E2. recette inexistante ⇒ recipe_not_found',
    public.nutrition_recipe_blocking_issue('00000000-0000-4000-8000-0000000000ff') = 'recipe_not_found');

  perform pg_temp.noter('E', 'E3. argument null ⇒ recipe_not_found',
    public.nutrition_recipe_blocking_issue(null) = 'recipe_not_found');

  insert into public.nutrition_recipes (id, coach_id, name, status)
  values (v_vide, 'cccc0000-0000-4000-8000-000000000009', 'Sans ingrédient', 'draft');
  perform pg_temp.noter('E', 'E4. recette sans ingrédient ⇒ recipe_without_ingredient',
    public.nutrition_recipe_blocking_issue(v_vide) = 'recipe_without_ingredient');
end $$;

do $$
begin
  update public.nutrition_recipe_ingredients set position = 7
   where id = '22220000-0000-4000-8000-00000000000c';
  perform pg_temp.noter('E', 'E5. positions non contiguës ⇒ ingredient_positions_not_contiguous',
    public.nutrition_recipe_blocking_issue('11110000-0000-4000-8000-00000000000a') = 'ingredient_positions_not_contiguous');
  update public.nutrition_recipe_ingredients set position = 3
   where id = '22220000-0000-4000-8000-00000000000c';

  update public.nutrition_recipe_ingredients set reference_grams = 0
   where id = '22220000-0000-4000-8000-00000000000b';
  perform pg_temp.noter('E', 'E6. ajustable sans référence ⇒ scalable_ingredient_without_reference',
    public.nutrition_recipe_blocking_issue('11110000-0000-4000-8000-00000000000a') = 'scalable_ingredient_without_reference');
  update public.nutrition_recipe_ingredients set reference_grams = 100
   where id = '22220000-0000-4000-8000-00000000000b';

  update public.nutrition_recipe_ingredients
     set unit_scalable = true, unit_name = null, max_units = 2
   where id = '22220000-0000-4000-8000-00000000000c';
  perform pg_temp.noter('E', 'E7. unit_scalable sans libellé ⇒ unit_scalable_incoherent',
    public.nutrition_recipe_blocking_issue('11110000-0000-4000-8000-00000000000a') = 'unit_scalable_incoherent');
  update public.nutrition_recipe_ingredients
     set unit_scalable = false, unit_name = null, max_units = null
   where id = '22220000-0000-4000-8000-00000000000c';

  update public.nutrition_recipe_ingredients
     set linked_to_ingredient_id = '22220000-0000-4000-8000-00000000000b', link_ratio_bp = 1500
   where id = '22220000-0000-4000-8000-00000000000a';
  update public.nutrition_recipe_ingredients
     set linked_to_ingredient_id = '22220000-0000-4000-8000-00000000000a', link_ratio_bp = 1500
   where id = '22220000-0000-4000-8000-00000000000b';
  perform pg_temp.noter('E', 'E8. cycle de liaison ⇒ ingredient_link_cycle',
    public.nutrition_recipe_blocking_issue('11110000-0000-4000-8000-00000000000a') = 'ingredient_link_cycle');
  update public.nutrition_recipe_ingredients
     set linked_to_ingredient_id = null, link_ratio_bp = null
   where id in ('22220000-0000-4000-8000-00000000000a', '22220000-0000-4000-8000-00000000000b');

  perform pg_temp.noter('E', 'E9. après restauration, la recette redevient exploitable',
    public.nutrition_recipe_blocking_issue('11110000-0000-4000-8000-00000000000a') is null);
end $$;

-- Les codes restants : atteignables uniquement si une contrainte venait à
-- être relâchée. On vérifie qu'ils sont bien déclarés dans la fonction.
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nutrition_recipe_blocking_issue';
  perform pg_temp.noter('E', 'E10. codes de repli déclarés (rôle, macro, bornes, lien, œuf, unités)',
    v_src like '%ingredient_role_unknown%' and v_src like '%ingredient_macro_negative%'
    and v_src like '%ingredient_bounds_incoherent%' and v_src like '%ingredient_link_outside_recipe%'
    and v_src like '%ingredient_link_ratio_invalid%' and v_src like '%egg_fields_incoherent%'
    and v_src like '%unit_fields_without_unit_scalable%' and v_src like '%recipe_name_empty%'
    and v_src like '%recipe_status_unknown%');
  perform pg_temp.noter('E', 'E11. la fonction ne contient AUCUNE écriture',
    v_src !~* '(insert into|update public\.|delete from)');
end $$;

-- ---------------------------------------------------------------------
-- Section F — comportement RLS réel
-- ---------------------------------------------------------------------
do $$
declare v_nb int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"eeee7777-7777-4777-8777-777777777777","role":"authenticated"}', true);
  select count(*) into v_nb from public.nutrition_recipes;
  perform pg_temp.noter('F', 'F1. le COACH lit les recettes', v_nb >= 2);

  insert into public.nutrition_recipes (id, coach_id, name, status)
  values ('11110000-0000-4000-8000-00000000000f', 'cccc0000-0000-4000-8000-000000000009', 'Écrite par le coach', 'draft');
  perform pg_temp.noter('F', 'F2. le COACH écrit une recette', exists (
    select 1 from public.nutrition_recipes where id = '11110000-0000-4000-8000-00000000000f'));

  reset role;
end $$;

do $$
declare v_recettes int; v_ingredients int; v_tags int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"eeee8888-8888-4888-8888-888888888888","role":"authenticated"}', true);
  select count(*) into v_recettes from public.nutrition_recipes;
  select count(*) into v_ingredients from public.nutrition_recipe_ingredients;
  select count(*) into v_tags from public.nutrition_recipe_tags;
  perform pg_temp.noter('F', 'F3. l''ÉLÈVE ne lit AUCUNE recette (décision PR A)', v_recettes = 0);
  perform pg_temp.noter('F', 'F4. l''ÉLÈVE ne lit AUCUN ingrédient', v_ingredients = 0);
  perform pg_temp.noter('F', 'F5. l''ÉLÈVE ne lit AUCUNE étiquette', v_tags = 0);
  reset role;
end $$;

do $$
declare v_refuse boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"eeee8888-8888-4888-8888-888888888888","role":"authenticated"}', true);
  begin
    insert into public.nutrition_recipes (coach_id, name, status)
    values ('cccc0000-0000-4000-8000-000000000009', 'Écrite par un élève', 'draft');
  exception when insufficient_privilege then v_refuse := true; end;
  perform pg_temp.noter('F', 'F6. l''ÉLÈVE ne peut PAS écrire de recette', v_refuse);
  reset role;
end $$;

do $$
declare v_refuse boolean := false;
begin
  set local role anon;
  begin
    perform 1 from public.nutrition_recipes;
  exception when insufficient_privilege then v_refuse := true; end;
  perform pg_temp.noter('F', 'F7. anon n''a AUCUN accès aux recettes', v_refuse);
  reset role;
end $$;

do $$
declare v_refuse boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"eeee7777-7777-4777-8777-777777777777","role":"authenticated"}', true);
  begin
    execute 'truncate table public.nutrition_recipes cascade';
  exception when insufficient_privilege then v_refuse := true; end;
  perform pg_temp.noter('F', 'F8. authenticated ne peut PAS TRUNCATE (contournerait la RLS)', v_refuse);
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- Section G — lecture groupée
-- ---------------------------------------------------------------------
do $$
declare v_ing int; v_tags int; v_ordre text;
begin
  -- Le motif exact de lib/supabase/nutrition-recipes.ts : trois requêtes,
  -- les enfants chargés par `in (…)`, jamais une par recette.
  select count(*) into v_ing from public.nutrition_recipe_ingredients
   where recipe_id in ('11110000-0000-4000-8000-00000000000a', '11110000-0000-4000-8000-00000000000b');
  perform pg_temp.noter('G', 'G1. tous les ingrédients de N recettes en UNE requête', v_ing = 4);

  select count(*) into v_tags from public.nutrition_recipe_tags
   where recipe_id in ('11110000-0000-4000-8000-00000000000a', '11110000-0000-4000-8000-00000000000b');
  perform pg_temp.noter('G', 'G2. toutes les étiquettes en UNE requête', v_tags = 2);

  select string_agg(name, ',' order by position) into v_ordre
    from public.nutrition_recipe_ingredients
   where recipe_id = '11110000-0000-4000-8000-00000000000a';
  perform pg_temp.noter('G', 'G3. ordre déterministe par position', v_ordre = 'Poulet,Riz,Crème');

  perform pg_temp.noter('G', 'G4. recette générique lisible (slot_key null)', exists (
    select 1 from public.nutrition_recipes
     where id = '11110000-0000-4000-8000-00000000000b' and slot_key is null));
end $$;

-- ---------------------------------------------------------------------
-- Section H — v1 et v2 intacts
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('H', 'H1. le plan v1 témoin est inchangé', exists (
    select 1 from public.nutrition_plans
     where id = '77770000-0000-4000-8000-000000000009'
       and nutrition_model_version = 1
       and daily_target = '{"calories":2000,"protein":150,"carbs":200,"fat":60}'::jsonb));

  perform pg_temp.noter('H', 'H2. aucun nutrition_days créé par ce chantier', (
    select count(*) = 0 from public.nutrition_days
     where plan_id = '77770000-0000-4000-8000-000000000009'));

  perform pg_temp.noter('H', 'H3. les tables v2 n''ont pas été modifiées', (
    select count(*) = 2 from information_schema.tables
     where table_schema = 'public'
       and table_name in ('nutrition_plan_profiles', 'nutrition_meal_slot_targets')));

  perform pg_temp.noter('H', 'H4. aucune table de portion calculée n''existe', (
    select count(*) = 0 from pg_tables
     where schemaname = 'public'
       and (tablename like '%solved%' or tablename like '%portion%'
            or tablename like '%serving%')));
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

-- Contrôle POST-ROLLBACK, hors transaction : aucune donnée de test persistante.
do $$
declare nb int;
begin
  select count(*) into nb from public.nutrition_recipes
   where name in ('Poulet riz crème', 'Recette générique', 'Sans ingrédient', 'Écrite par le coach');
  if nb <> 0 then
    raise exception 'ÉCHEC   — I1. des recettes de test ont survécu au ROLLBACK (% lignes)', nb;
  end if;
  select count(*) into nb from public.nutrition_recipe_ingredients;
  if nb <> 0 then
    raise exception 'ÉCHEC   — I2. des ingrédients de test ont survécu au ROLLBACK';
  end if;
  select count(*) into nb from public.nutrition_recipe_tags;
  if nb <> 0 then
    raise exception 'ÉCHEC   — I3. des étiquettes de test ont survécu au ROLLBACK';
  end if;
  select count(*) into nb from auth.users where email in ('rc.coach@test.local', 'rc.eleve@test.local');
  if nb <> 0 then
    raise exception 'ÉCHEC   — I4. des comptes de test ont survécu au ROLLBACK';
  end if;
  select count(*) into nb from public.nutrition_plans where name = 'Témoin v1';
  if nb <> 0 then
    raise exception 'ÉCHEC   — I5. le plan témoin a survécu au ROLLBACK';
  end if;
  raise notice 'OK      — I1/I5. aucune donnée de test persistante après le ROLLBACK';
end $$;

-- Les tables et la fonction, elles, viennent de la migration : elles restent.
do $$
begin
  if (select count(*) from pg_tables where schemaname = 'public'
       and tablename in ('nutrition_recipes','nutrition_recipe_ingredients','nutrition_recipe_tags')) <> 3 then
    raise exception 'ÉCHEC   — I6. une table de la migration a disparu';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'nutrition_recipe_blocking_issue') then
    raise exception 'ÉCHEC   — I7. la fonction de validation a disparu';
  end if;
  raise notice 'OK      — I6/I7. les objets de la migration sont toujours en place';
end $$;
