-- ============================================================================
-- Checklist PostgreSQL — PR E.1, photo de recette
-- Migration couverte : 20260819090000_nutrition_recipe_images.sql
--
-- CE QU'ELLE VÉRIFIE
--   A. la colonne image_path et sa contrainte de forme ;
--   B. le bucket, ses plafonds et sa liste MIME ;
--   C. la fonction d'appartenance : forme, existence, PROPRIÉTÉ RÉELLE ;
--   D. les quatre policies et leurs clauses ;
--   E. écriture réelle : le coach dans son dossier, refusé partout ailleurs ;
--   F. l'élève : ni écriture, ni suppression, ni listage ;
--   G. anon : rien du tout ;
--   H. la RPC : pose, remplacement, retrait, chemins refusés ;
--   I. duplication : la copie naît sans photo, la source est rendue ;
--   J. suppression : le chemin est rendu ; archivage : la photo est conservée ;
--   K. `copy()` : les DEUX droits qu'il exige sont réellement accordés ;
--   L. aucune donnée de test après le ROLLBACK.
--
-- CE QU'ELLE NE VÉRIFIE PAS
--   La couche HTTP de storage-api (l'API `upload`, `copy`, `remove`) n'existe
--   pas dans un PostgreSQL nu. Ce qui est vérifié ici, ce sont les PRÉDICATS
--   que storage-api évalue : un `insert` sur storage.objects sous le rôle
--   `authenticated` avec les mêmes claims JWT. C'est exactement la décision
--   d'autorisation ; seul le transport n'est pas exercé.
--
-- EXÉCUTION (base LOCALE uniquement) :
--   docker exec -i "$DB_CONTAINER" \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/nutrition_recipe_images_checklist.sql
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

-- ─────────────────────────── Jeu d'essai ───────────────────────────
-- DEUX coachs, un élève, un administrateur. Les deux coachs sont
-- indispensables : la moitié des contrôles porte sur ce qu'un coach ne peut
-- PAS faire chez l'autre.
insert into auth.users (id, email) values
  ('aaa10000-0000-4000-8000-00000000000a'::uuid, 'im.coachA@test.local'),
  ('aaa10000-0000-4000-8000-00000000000b'::uuid, 'im.coachB@test.local'),
  ('aaa10000-0000-4000-8000-00000000000e'::uuid, 'im.eleve@test.local'),
  ('aaa10000-0000-4000-8000-00000000000d'::uuid, 'im.admin@test.local')
on conflict (id) do nothing;

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('aaa10000-0000-4000-8000-00000000000a'::uuid, 'coach',   'CoachA', 'X', 'im.coachA@test.local'),
  ('aaa10000-0000-4000-8000-00000000000b'::uuid, 'coach',   'CoachB', 'X', 'im.coachB@test.local'),
  ('aaa10000-0000-4000-8000-00000000000e'::uuid, 'student', 'Eleve',  'X', 'im.eleve@test.local'),
  ('aaa10000-0000-4000-8000-00000000000d'::uuid, 'admin',   'Admin',  'X', 'im.admin@test.local');

insert into public.coaches (id, user_id, name, email) values
  ('ccc10000-0000-4000-8000-00000000000a'::uuid, 'aaa10000-0000-4000-8000-00000000000a'::uuid, 'CoachA', 'im.coachA@test.local'),
  ('ccc10000-0000-4000-8000-00000000000b'::uuid, 'aaa10000-0000-4000-8000-00000000000b'::uuid, 'CoachB', 'im.coachB@test.local');

insert into public.students (id, user_id, first_name, last_name, email, status, access_type)
values ('55510000-0000-4000-8000-00000000000e'::uuid, 'aaa10000-0000-4000-8000-00000000000e'::uuid,
        'Eleve', 'X', 'im.eleve@test.local', 'active', 'coaching');

insert into public.nutrition_recipes (id, coach_id, name, status) values
  ('eee10000-0000-4000-8000-00000000000a'::uuid, 'ccc10000-0000-4000-8000-00000000000a'::uuid, 'Photo — recette de A', 'active'),
  ('eee10000-0000-4000-8000-00000000000b'::uuid, 'ccc10000-0000-4000-8000-00000000000b'::uuid, 'Photo — recette de B', 'active');

insert into public.nutrition_recipe_ingredients
  (id, recipe_id, position, name, role, protein_per_100g, carb_per_100g, fat_per_100g, reference_grams)
values
  ('11110000-0000-4000-8000-00000000000a'::uuid, 'eee10000-0000-4000-8000-00000000000a'::uuid, 1, 'Poulet', 'protein', 25, 0, 1, 140),
  ('11110000-0000-4000-8000-00000000000b'::uuid, 'eee10000-0000-4000-8000-00000000000b'::uuid, 1, 'Poulet', 'protein', 25, 0, 1, 140);

-- Raccourcis lisibles pour les chemins.
create or replace function pg_temp.chemin(p_coach uuid, p_recette uuid, p_fichier text)
returns text language sql immutable as $$
  select 'recipes/' || p_coach::text || '/' || p_recette::text || '/' || p_fichier || '.webp';
$$;

-- ---------------------------------------------------------------------
-- Section A — la colonne et sa contrainte
-- ---------------------------------------------------------------------
do $$
declare v_ok boolean;
begin
  perform pg_temp.noter('A', 'A1. la colonne image_path existe', exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'nutrition_recipes' and column_name = 'image_path'));

  perform pg_temp.noter('A', 'A2. elle est NULLABLE — la photo est facultative', (
    select is_nullable = 'YES' from information_schema.columns
     where table_schema = 'public' and table_name = 'nutrition_recipes' and column_name = 'image_path'));

  perform pg_temp.noter('A', 'A3. la contrainte de forme existe', exists (
    select 1 from pg_constraint
     where conrelid = 'public.nutrition_recipes'::regclass
       and conname = 'nutrition_recipes_image_path_shape'));

  -- A4. Un chemin CONFORME est accepté.
  begin
    update public.nutrition_recipes
       set image_path = pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid,
                                       'eee10000-0000-4000-8000-00000000000a'::uuid,
                                       'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
     where id = 'eee10000-0000-4000-8000-00000000000a'::uuid;
    v_ok := true;
  exception when check_violation then v_ok := false;
  end;
  perform pg_temp.noter('A', 'A4. un chemin conforme est accepté', v_ok);
end $$;

-- A5 à A9 : chaque forme illégitime, une par une. Un `savepoint` par cas —
-- une violation de contrainte avorte la sous-transaction, pas la checklist.
do $$
declare
  v_cas text;
  v_chemins text[] := array[
    -- dossier d'un AUTRE coach
    'recipes/ccc10000-0000-4000-8000-00000000000b/eee10000-0000-4000-8000-00000000000a/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp',
    -- dossier d'une AUTRE recette
    'recipes/ccc10000-0000-4000-8000-00000000000a/eee10000-0000-4000-8000-00000000000b/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp',
    -- traversée de répertoire
    'recipes/ccc10000-0000-4000-8000-00000000000a/eee10000-0000-4000-8000-00000000000a/../../secret.webp',
    -- extension interdite (SVG)
    'recipes/ccc10000-0000-4000-8000-00000000000a/eee10000-0000-4000-8000-00000000000a/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.svg',
    -- nom de fichier libre : pas un UUID
    'recipes/ccc10000-0000-4000-8000-00000000000a/eee10000-0000-4000-8000-00000000000a/photo-de-vacances.webp',
    -- préfixe absent
    'ccc10000-0000-4000-8000-00000000000a/eee10000-0000-4000-8000-00000000000a/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.webp'
  ];
  v_libelles text[] := array[
    'A5. dossier d''un AUTRE coach refusé',
    'A6. dossier d''une AUTRE recette refusé',
    'A7. traversée « ../ » refusée',
    'A8. extension SVG refusée',
    'A9. nom de fichier libre refusé',
    'A10. chemin sans préfixe « recipes/ » refusé'
  ];
  i int;
  v_refuse boolean;
begin
  for i in 1 .. array_length(v_chemins, 1) loop
    begin
      update public.nutrition_recipes set image_path = v_chemins[i]
       where id = 'eee10000-0000-4000-8000-00000000000a'::uuid;
      v_refuse := false;
    exception when check_violation then v_refuse := true;
    end;
    perform pg_temp.noter('A', v_libelles[i], v_refuse);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Section B — le bucket et ses plafonds
-- ---------------------------------------------------------------------
do $$
declare v_b record;
begin
  select * into v_b from storage.buckets where id = 'recipe-images';
  perform pg_temp.noter('B', 'B1. le bucket recipe-images existe', v_b.id is not null);
  perform pg_temp.noter('B', 'B2. il est PUBLIC en lecture', v_b.public = true);
  perform pg_temp.noter('B', 'B3. un plafond de taille est posé, à 1 Mo au plus',
    v_b.file_size_limit is not null and v_b.file_size_limit <= 1048576);
  perform pg_temp.noter('B', 'B4. la liste MIME contient WebP', 'image/webp' = any(v_b.allowed_mime_types));
  perform pg_temp.noter('B', 'B5. et n''accepte AUCUN SVG',
    not ('image/svg+xml' = any(v_b.allowed_mime_types)));
  perform pg_temp.noter('B', 'B6. ni aucun type non-image',
    (select bool_and(m like 'image/%') from unnest(v_b.allowed_mime_types) m));
end $$;

-- ---------------------------------------------------------------------
-- Section C — la fonction d'appartenance
-- ---------------------------------------------------------------------
do $$
declare v_secdef boolean; v_owner text; v_config text[];
begin
  select p.prosecdef, pg_get_userbyid(p.proowner), p.proconfig
    into v_secdef, v_owner, v_config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nutrition_recipe_image_owner_ok';

  perform pg_temp.noter('C', 'C1. nutrition_recipe_image_owner_ok existe', v_owner is not null);
  perform pg_temp.noter('C', 'C2. SECURITY INVOKER — elle ne fabrique aucun privilège', v_secdef = false);
  perform pg_temp.noter('C', 'C3. propriétaire postgres', v_owner = 'postgres');
  perform pg_temp.noter('C', 'C4. search_path verrouillé à vide',
    v_config @> array['search_path=']::text[] or v_config @> array['search_path=""']::text[]);
  perform pg_temp.noter('C', 'C5. anon ne peut pas l''exécuter',
    not has_function_privilege('anon', 'public.nutrition_recipe_image_owner_ok(text)', 'execute'));
  perform pg_temp.noter('C', 'C6. authenticated peut l''exécuter',
    has_function_privilege('authenticated', 'public.nutrition_recipe_image_owner_ok(text)', 'execute'));
end $$;

-- ---------------------------------------------------------------------
-- Section D — les quatre policies
-- ---------------------------------------------------------------------
do $$
declare v_cmd text; v_n int;
begin
  select count(*) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'recipe_images_%';
  perform pg_temp.noter('D', 'D1. quatre policies, une par commande', v_n = 4);

  perform pg_temp.noter('D', 'D2. INSERT porte un WITH CHECK', exists (
    select 1 from pg_policies where policyname = 'recipe_images_insert_owner_coach'
      and cmd = 'INSERT' and with_check is not null));
  perform pg_temp.noter('D', 'D3. UPDATE porte USING **et** WITH CHECK', exists (
    select 1 from pg_policies where policyname = 'recipe_images_update_owner_coach'
      and cmd = 'UPDATE' and qual is not null and with_check is not null));
  perform pg_temp.noter('D', 'D4. DELETE porte un USING', exists (
    select 1 from pg_policies where policyname = 'recipe_images_delete_owner_coach'
      and cmd = 'DELETE' and qual is not null));
  perform pg_temp.noter('D', 'D5. SELECT existe — sans lui, remove() et copy() échouent', exists (
    select 1 from pg_policies where policyname = 'recipe_images_select_owner_coach'
      and cmd = 'SELECT' and qual is not null));

  perform pg_temp.noter('D', 'D6. les quatre sont réservées au rôle authenticated', (
    select bool_and(roles = array['authenticated']::name[]) from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname like 'recipe_images_%'));

  perform pg_temp.noter('D', 'D7. aucune ne se contente de is_coach_or_admin()', (
    select bool_and(coalesce(qual, '') || coalesce(with_check, '') like '%nutrition_recipe_image_owner_ok%')
      from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname like 'recipe_images_%'));
end $$;

-- ---------------------------------------------------------------------
-- Section E — écriture réelle : le coach A
-- ---------------------------------------------------------------------
do $$
declare v_ok boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaa10000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

  -- E1. Son dossier, sa recette : accepté.
  begin
    insert into storage.objects (bucket_id, name) values ('recipe-images',
      pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid,
                     'eee10000-0000-4000-8000-00000000000a'::uuid, '11111111-1111-1111-1111-111111111111'));
    v_ok := true;
  exception when insufficient_privilege then v_ok := false;
  end;
  perform pg_temp.noter('E', 'E1. le coach écrit dans le dossier de SA recette', v_ok);

  -- E2. Le dossier du coach B : refusé.
  begin
    insert into storage.objects (bucket_id, name) values ('recipe-images',
      pg_temp.chemin('ccc10000-0000-4000-8000-00000000000b'::uuid,
                     'eee10000-0000-4000-8000-00000000000b'::uuid, '22222222-2222-2222-2222-222222222222'));
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.noter('E', 'E2. il ne peut PAS écrire dans le dossier du coach B', v_ok);

  -- E3. LE CONTRÔLE QUI COMPTE : son propre dossier, mais la recette de B.
  -- Une policy qui se contenterait de comparer le segment « coach » à
  -- current_coach_id() accepterait ce chemin. La jointure le refuse.
  begin
    insert into storage.objects (bucket_id, name) values ('recipe-images',
      pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid,
                     'eee10000-0000-4000-8000-00000000000b'::uuid, '33333333-3333-3333-3333-333333333333'));
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.noter('E', 'E3. son dossier + la recette d''un AUTRE : refusé (la jointure sert)', v_ok);

  -- E4. Une recette qui n'existe pas.
  begin
    insert into storage.objects (bucket_id, name) values ('recipe-images',
      pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid,
                     'eee10000-0000-4000-8000-0000000000ff'::uuid, '44444444-4444-4444-4444-444444444444'));
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.noter('E', 'E4. une recette inexistante : refusé', v_ok);

  -- E5. Un chemin hors forme.
  begin
    insert into storage.objects (bucket_id, name) values ('recipe-images', 'nimporte/quoi.webp');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.noter('E', 'E5. un chemin hors forme : refusé', v_ok);

  -- E6. Il voit son objet (nécessaire à remove() et copy()).
  perform pg_temp.noter('E', 'E6. il voit son propre objet', (
    select count(*) = 1 from storage.objects
     where bucket_id = 'recipe-images'
       and name like 'recipes/ccc10000-0000-4000-8000-00000000000a/%'));

  -- E7. Il peut le supprimer.
  delete from storage.objects where bucket_id = 'recipe-images'
    and name = pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid,
                              'eee10000-0000-4000-8000-00000000000a'::uuid, '11111111-1111-1111-1111-111111111111');
  perform pg_temp.noter('E', 'E7. il peut supprimer son propre objet', not exists (
    select 1 from storage.objects where bucket_id = 'recipe-images'
       and name like '%11111111-1111-1111-1111-111111111111%'));
  reset role;
end $$;

-- E8/E9 : le coach B dépose un objet, puis A tente de le lire et de le
-- supprimer. C'est le scénario « coach A ne remplace/supprime pas l'image de
-- coach B », demandé explicitement.
do $$
declare v_vus int; v_supprimes int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaa10000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
  insert into storage.objects (bucket_id, name) values ('recipe-images',
    pg_temp.chemin('ccc10000-0000-4000-8000-00000000000b'::uuid,
                   'eee10000-0000-4000-8000-00000000000b'::uuid, '55555555-5555-5555-5555-555555555555'));
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaa10000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

  select count(*) into v_vus from storage.objects
   where bucket_id = 'recipe-images' and name like 'recipes/ccc10000-0000-4000-8000-00000000000b/%';
  perform pg_temp.noter('E', 'E8. le coach A ne VOIT pas l''objet du coach B', v_vus = 0);

  with supprimes as (
    delete from storage.objects
     where bucket_id = 'recipe-images' and name like 'recipes/ccc10000-0000-4000-8000-00000000000b/%'
    returning 1
  ) select count(*) into v_supprimes from supprimes;
  perform pg_temp.noter('E', 'E9. et il ne peut pas le supprimer', v_supprimes = 0);

  -- E10. Ni le renommer vers son propre dossier (c'est le rôle du WITH CHECK
  -- sur UPDATE : sans lui, un coach déplacerait un objet chez lui).
  update storage.objects
     set name = pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid,
                               'eee10000-0000-4000-8000-00000000000a'::uuid, '66666666-6666-6666-6666-666666666666')
   where bucket_id = 'recipe-images' and name like 'recipes/ccc10000-0000-4000-8000-00000000000b/%';
  perform pg_temp.noter('E', 'E10. ni le déplacer vers son propre dossier', exists (
    select 1 from public.nutrition_recipes where true) and not exists (
    select 1 from storage.objects where name like '%66666666-6666-6666-6666-666666666666%'));
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- Section F — l'élève n'a AUCUN droit sur ce bucket
-- ---------------------------------------------------------------------
do $$
declare v_ok boolean; v_n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaa10000-0000-4000-8000-00000000000e","role":"authenticated"}', true);

  begin
    insert into storage.objects (bucket_id, name) values ('recipe-images',
      pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid,
                     'eee10000-0000-4000-8000-00000000000a'::uuid, '77777777-7777-7777-7777-777777777777'));
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.noter('F', 'F1. un élève ne peut RIEN écrire dans le bucket', v_ok);

  select count(*) into v_n from storage.objects where bucket_id = 'recipe-images';
  perform pg_temp.noter('F', 'F2. il ne peut pas LISTER le bucket', v_n = 0);

  with supprimes as (
    delete from storage.objects where bucket_id = 'recipe-images' returning 1
  ) select count(*) into v_n from supprimes;
  perform pg_temp.noter('F', 'F3. il ne peut rien supprimer', v_n = 0);

  -- F4. Et il ne peut pas non plus poser une photo par la RPC.
  perform pg_temp.noter('F', 'F4. la RPC lui répond « forbidden »', (
    select public.set_nutrition_recipe_image(
      'eee10000-0000-4000-8000-00000000000a'::uuid, null) ->> 'reason') = 'forbidden');
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- Section G — anon
-- ---------------------------------------------------------------------
do $$
declare v_n int; v_ok boolean;
begin
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  select count(*) into v_n from storage.objects where bucket_id = 'recipe-images';
  perform pg_temp.noter('G', 'G1. anon ne voit aucun objet par la RLS', v_n = 0);

  begin
    insert into storage.objects (bucket_id, name) values ('recipe-images', 'recipes/a/b/c.webp');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.noter('G', 'G2. anon ne peut rien écrire', v_ok);

  perform pg_temp.noter('G', 'G3. anon ne peut pas exécuter la RPC',
    not has_function_privilege('anon', 'public.set_nutrition_recipe_image(uuid,text)', 'execute'));
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- Section H — la RPC set_nutrition_recipe_image
-- ---------------------------------------------------------------------
do $$
declare v jsonb; v_chemin1 text; v_chemin2 text;
begin
  v_chemin1 := pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid,
                              'eee10000-0000-4000-8000-00000000000a'::uuid, '88888888-8888-8888-8888-888888888888');
  v_chemin2 := pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid,
                              'eee10000-0000-4000-8000-00000000000a'::uuid, '99999999-9999-9999-9999-999999999999');

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaa10000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

  -- On repart d'une recette SANS photo : la section A en a posé une pour
  -- éprouver la contrainte, et H1 doit vraiment observer une PREMIÈRE pose.
  perform public.set_nutrition_recipe_image('eee10000-0000-4000-8000-00000000000a'::uuid, null);

  -- H1. Poser une première photo : aucun chemin précédent à nettoyer.
  v := public.set_nutrition_recipe_image('eee10000-0000-4000-8000-00000000000a'::uuid, v_chemin1);
  perform pg_temp.noter('H', 'H1. la pose réussit et ne rend aucun ancien chemin',
    (v->>'ok')::boolean and v->>'image_path' = v_chemin1 and v->>'previous_path' is null);

  -- H2. Remplacer : l'ANCIEN chemin est rendu, dans la même transaction.
  v := public.set_nutrition_recipe_image('eee10000-0000-4000-8000-00000000000a'::uuid, v_chemin2);
  perform pg_temp.noter('H', 'H2. le remplacement rend EXACTEMENT l''ancien chemin',
    (v->>'ok')::boolean and v->>'image_path' = v_chemin2 and v->>'previous_path' = v_chemin1);

  -- H3. Reposer le MÊME chemin : rien à nettoyer.
  v := public.set_nutrition_recipe_image('eee10000-0000-4000-8000-00000000000a'::uuid, v_chemin2);
  perform pg_temp.noter('H', 'H3. reposer le même chemin ne réclame aucun nettoyage',
    (v->>'ok')::boolean and v->>'previous_path' is null);

  -- H4. Un chemin étranger est refusé, SANS erreur PostgreSQL brute.
  v := public.set_nutrition_recipe_image('eee10000-0000-4000-8000-00000000000a'::uuid,
        pg_temp.chemin('ccc10000-0000-4000-8000-00000000000b'::uuid,
                       'eee10000-0000-4000-8000-00000000000a'::uuid, '88888888-8888-8888-8888-888888888888'));
  perform pg_temp.noter('H', 'H4. un chemin d''un autre coach : invalid_path',
    v->>'reason' = 'invalid_path');

  -- H5. Et la ligne n'a pas bougé.
  perform pg_temp.noter('H', 'H5. la photo en base est restée la bonne', (
    select image_path from public.nutrition_recipes
     where id = 'eee10000-0000-4000-8000-00000000000a'::uuid) = v_chemin2);

  -- H6. La recette d'un AUTRE coach est INTROUVABLE — pas « interdite ».
  v := public.set_nutrition_recipe_image('eee10000-0000-4000-8000-00000000000b'::uuid, null);
  perform pg_temp.noter('H', 'H6. la recette d''un autre coach est introuvable', v->>'reason' = 'not_found');

  -- H7. Le retrait rend le chemin à nettoyer.
  v := public.set_nutrition_recipe_image('eee10000-0000-4000-8000-00000000000a'::uuid, null);
  perform pg_temp.noter('H', 'H7. le retrait rend le chemin devenu inutile',
    (v->>'ok')::boolean and v->>'image_path' is null and v->>'previous_path' = v_chemin2);

  -- H8. Elle ne touche QUE image_path.
  perform pg_temp.noter('H', 'H8. le statut et le nom sont intacts', (
    select status = 'active' and name = 'Photo — recette de A'
      from public.nutrition_recipes where id = 'eee10000-0000-4000-8000-00000000000a'::uuid));
  reset role;
end $$;

do $$
declare v_secdef boolean; v_owner text; v_config text[];
begin
  select p.prosecdef, pg_get_userbyid(p.proowner), p.proconfig
    into v_secdef, v_owner, v_config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_nutrition_recipe_image';
  perform pg_temp.noter('H', 'H9. SECURITY INVOKER, postgres, search_path vide',
    v_secdef = false and v_owner = 'postgres'
    and (v_config @> array['search_path=']::text[] or v_config @> array['search_path=""']::text[]));
  perform pg_temp.noter('H', 'H10. EXECUTE réservé à authenticated',
    has_function_privilege('authenticated', 'public.set_nutrition_recipe_image(uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.set_nutrition_recipe_image(uuid,text)', 'execute')
    and not has_function_privilege('public', 'public.set_nutrition_recipe_image(uuid,text)', 'execute'));
end $$;

-- ---------------------------------------------------------------------
-- Section I — duplication indépendante
-- ---------------------------------------------------------------------
do $$
declare v jsonb; v_chemin text; v_copie uuid;
begin
  v_chemin := pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid,
                             'eee10000-0000-4000-8000-00000000000a'::uuid, 'abababab-abab-abab-abab-abababababab');
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaa10000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

  perform public.set_nutrition_recipe_image('eee10000-0000-4000-8000-00000000000a'::uuid, v_chemin);
  v := public.duplicate_nutrition_recipe('eee10000-0000-4000-8000-00000000000a'::uuid);
  v_copie := (v->>'recipe_id')::uuid;

  perform pg_temp.noter('I', 'I1. la duplication rend le chemin de la SOURCE',
    v->>'source_image_path' = v_chemin);
  perform pg_temp.noter('I', 'I2. la COPIE naît SANS photo', (
    select image_path is null from public.nutrition_recipes where id = v_copie));
  perform pg_temp.noter('I', 'I3. l''original garde la sienne', (
    select image_path = v_chemin from public.nutrition_recipes
     where id = 'eee10000-0000-4000-8000-00000000000a'::uuid));

  -- I4. La copie ne PEUT PAS porter le chemin de l'original : la contrainte
  -- contient l'identifiant de la recette. Le couplage est impossible, pas
  -- seulement évité.
  begin
    update public.nutrition_recipes set image_path = v_chemin where id = v_copie;
    perform pg_temp.noter('I', 'I4. la copie ne peut pas pointer vers le fichier de l''original', false);
  exception when check_violation then
    perform pg_temp.noter('I', 'I4. la copie ne peut pas pointer vers le fichier de l''original', true);
  end;

  -- I5. La copie peut recevoir SA propre photo, dans SON dossier.
  begin
    insert into storage.objects (bucket_id, name) values ('recipe-images',
      pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid, v_copie, 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd'));
    perform pg_temp.noter('I', 'I5. la copie peut recevoir sa propre photo', true);
  exception when insufficient_privilege then
    perform pg_temp.noter('I', 'I5. la copie peut recevoir sa propre photo', false);
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- Section J — suppression et archivage
-- ---------------------------------------------------------------------
do $$
declare v jsonb; v_chemin text; v_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaa10000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

  -- Une recette jetable, avec photo.
  v := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('name', 'Photo — à supprimer', 'status', 'draft'),
    'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb));
  v_id := (v->'recipe'->>'id')::uuid;
  v_chemin := pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid, v_id, 'dededede-dede-dede-dede-dededededede');
  perform public.set_nutrition_recipe_image(v_id, v_chemin);

  -- J1. L'ARCHIVAGE conserve la photo.
  perform public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('id', v_id, 'status', 'archived')));
  perform pg_temp.noter('J', 'J1. archiver ne touche PAS à la photo', (
    select image_path = v_chemin from public.nutrition_recipes where id = v_id));

  -- J2. La restauration non plus.
  perform public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('id', v_id, 'status', 'draft')));
  perform pg_temp.noter('J', 'J2. restaurer non plus', (
    select image_path = v_chemin from public.nutrition_recipes where id = v_id));

  -- J3. La suppression définitive REND le chemin à nettoyer.
  v := public.delete_nutrition_recipe(v_id);
  perform pg_temp.noter('J', 'J3. la suppression rend le chemin de l''objet à retirer',
    (v->>'ok')::boolean and v->>'image_path' = v_chemin);

  -- J4. Une recette sans photo rend NULL, pas une chaîne vide.
  v := public.save_nutrition_recipe(jsonb_build_object(
    'recipe', jsonb_build_object('name', 'Photo — sans image', 'status', 'draft'),
    'ingredients', '[]'::jsonb, 'tags', '[]'::jsonb));
  v := public.delete_nutrition_recipe((v->'recipe'->>'id')::uuid);
  perform pg_temp.noter('J', 'J4. sans photo, le chemin rendu est NULL',
    (v->>'ok')::boolean and (v->'image_path') = 'null'::jsonb);
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- Section K — ce que `copy()` exige réellement
-- ---------------------------------------------------------------------
-- L'API Storage `copy` lit la source puis écrit la destination, sous
-- l'identité de l'appelant : il lui faut SELECT sur l'une et INSERT sur
-- l'autre. Un bucket public n'y change rien — la lecture publique passe par
-- `/object/public/…`, qui ne consulte pas la RLS, alors que `copy` si.
-- On vérifie donc les DEUX droits, sur les DEUX chemins concernés.
do $$
declare v_source text; v_cible text; v_copie uuid; v_lisible boolean; v_ecrivable boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaa10000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

  v_copie := (public.duplicate_nutrition_recipe('eee10000-0000-4000-8000-00000000000a'::uuid) ->> 'recipe_id')::uuid;
  v_source := pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid,
                             'eee10000-0000-4000-8000-00000000000a'::uuid, 'efefefef-efef-efef-efef-efefefefefef');
  v_cible  := pg_temp.chemin('ccc10000-0000-4000-8000-00000000000a'::uuid, v_copie, 'fafafafa-fafa-fafa-fafa-fafafafafafa');

  insert into storage.objects (bucket_id, name) values ('recipe-images', v_source);

  -- K1. La SOURCE est lisible par l'appelant.
  select exists (select 1 from storage.objects where bucket_id = 'recipe-images' and name = v_source)
    into v_lisible;
  perform pg_temp.noter('K', 'K1. copy() : la source est LISIBLE sous RLS', v_lisible);

  -- K2. La DESTINATION est écrivable.
  begin
    insert into storage.objects (bucket_id, name) values ('recipe-images', v_cible);
    v_ecrivable := true;
  exception when insufficient_privilege then v_ecrivable := false;
  end;
  perform pg_temp.noter('K', 'K2. copy() : la destination est ÉCRIVABLE sous RLS', v_ecrivable);

  perform pg_temp.noter('K', 'K3. les deux droits que copy() exige sont donc réunis',
    v_lisible and v_ecrivable);
  reset role;
end $$;

-- K4 : et un coach ne peut pas copier l'objet d'un autre — la source ne lui
-- est pas lisible, donc `copy` échouerait avant même d'écrire.
do $$
declare v_source text; v_vu boolean;
begin
  v_source := pg_temp.chemin('ccc10000-0000-4000-8000-00000000000b'::uuid,
                             'eee10000-0000-4000-8000-00000000000b'::uuid, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaa10000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
  insert into storage.objects (bucket_id, name) values ('recipe-images', v_source);
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"aaa10000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
  select exists (select 1 from storage.objects where name = v_source) into v_vu;
  perform pg_temp.noter('K', 'K4. un coach ne peut pas copier l''objet d''un autre : la source lui est invisible',
    not v_vu);
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

-- ---------------------------------------------------------------------
-- Section L — rien ne survit au ROLLBACK
-- ---------------------------------------------------------------------
\echo ''
\echo '--- Tous les contrôles sont passés. ROLLBACK : aucune donnée de test ne subsiste. ---'
\echo ''

rollback;

do $$
declare nb int;
begin
  select count(*) into nb from public.nutrition_recipes where name like 'Photo — %';
  if nb <> 0 then raise exception 'ÉCHEC — L1. des recettes de test ont survécu (%)', nb; end if;
  select count(*) into nb from storage.objects where bucket_id = 'recipe-images';
  if nb <> 0 then raise exception 'ÉCHEC — L2. des objets de test ont survécu (%)', nb; end if;
  select count(*) into nb from auth.users where email like 'im.%@test.local';
  if nb <> 0 then raise exception 'ÉCHEC — L3. des comptes de test ont survécu'; end if;
  if not exists (select 1 from storage.buckets where id = 'recipe-images') then
    raise exception 'ÉCHEC — L4. le bucket de la migration a disparu';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'recipe_images_%') <> 4 then
    raise exception 'ÉCHEC — L5. les policies de la migration ont disparu';
  end if;
  raise notice 'OK      — L1/L5. aucune donnée de test, et les objets de la migration sont en place';
end $$;
