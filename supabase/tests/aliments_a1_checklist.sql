-- ============================================================================
-- Checklist PostgreSQL — ALIMENTS A1, FONDATIONS DATA
-- Migration couverte : 20260831090000_food_catalog_and_meal_entries.sql
-- Exécutée contre le schéma COURANT, donc A2 (20260901090000) comprise.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE A2 A CHANGÉ DANS CETTE CHECKLIST, ET POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
-- Une checklist se lit sur une base reconstruite baseline → TOUTES les
-- migrations. Elle vit donc avec le schéma d'aujourd'hui, pas avec celui du
-- jour où son chantier a été écrit. A2 a modifié deux contrats posés par A1,
-- et les contrôles concernés ont été RÉÉCRITS — jamais supprimés :
--
--   1. `consumed_on` et `slot_key` ont QUITTÉ meal_entries pour consumed_meals.
--      Les garder aux deux endroits en ferait une seconde source de vérité.
--      → MEAL-A2 et MEAL-A5 constatent le déplacement et éprouvent la clé
--        étrangère composite qui le remplace ; le vocabulaire du créneau est
--        éprouvé sur sa nouvelle table par aliments_a2_checklist.sql.
--
--   2. `insert, update, delete` ont été RETIRÉS à `authenticated`. Tant qu'ils
--      existaient, un client pouvait écrire ses propres macros par PostgREST
--      et contourner tout le calcul serveur ; une policy dit quelles LIGNES,
--      jamais quelles VALEURS.
--      → MEAL-A6, A7, A8, A9, A11 et A12 gardent leur intention et changent de
--        véhicule : ils passent par les RPC `security definer` de A2. Des
--        contrôles NEUFS prouvent en plus que la porte directe est fermée,
--        pour l'élève, pour le coach ET pour l'administrateur.
--
-- Réécrire un contrôle « tel quel » aurait produit un FAUX VERT : un INSERT
-- qui échoue parce que la colonne n'existe plus n'éprouve pas le vocabulaire
-- qu'il prétendait éprouver.
--
-- CE QU'ELLE VÉRIFIE
--   FOOD-A1  macros négatives refusées
--   FOOD-A2  nutrition_unit à vocabulaire contrôlé
--   FOOD-A3  slug unique dans l'espace GLOBAL
--   FOOD-A4  slug unique PAR COACH, et les deux espaces sont disjoints
--   FOOD-A5  aucune colonne de calories : le 4/4/9 reste dérivé
--   FOOD-A9  piece_weight_g : posée, nullable, positive, et lue par PERSONNE
--   FOOD-A6  RLS élève : lit le global, n'écrit RIEN, ne voit aucun privé
--   FOOD-A7  RLS coach : son privé seulement ; jamais le global, jamais l'autre
--   FOOD-A8  food_aliases : normalisation, unicité, visibilité héritée
--   MEAL-A1  meal_entries existe SANS nutrition_plan_id
--   MEAL-A2  quantité, macros et libellé contraints
--   MEAL-A3  source_type à vocabulaire contrôlé
--   MEAL-A4  états impossibles refusés, dans le sens qui survit à set null
--   MEAL-A5  l'instantané ne suit JAMAIS sa source (correction, suppression)
--   MEAL-A6  RLS élève : CRUD sur les siennes, rien sur celles d'un autre
--   MEAL-A7  RLS coach : lecture de SES élèves, jamais d'écriture ; admin global
--   MEAL-A8  l'élève PEUT corriger sa propre entrée
--   MEAL-A9  l'élève ne peut pas corriger celle d'un autre
--   MEAL-A10 un changement de food_catalog ne modifie jamais une entrée
--   MEAL-A11 une correction EXPLICITE remplace l'instantané, atomiquement
--   MEAL-A12 updated_at bouge à la correction, created_at ne bouge pas
--   RECIPE-A1 nutrition_recipe_ingredients strictement inchangée
--   RECIPE-A2 le monde des recettes ne dépend d'aucune façon de food_catalog
--   Z         après le ROLLBACK, aucune donnée de test ne subsiste
--
-- COMPTES SYNTHÉTIQUES — aucun compte réel, aucune donnée de production.
--   admin          → profiles.role = 'admin'
--   coach A        → coaches + profiles.role = 'coach'
--   coach B        → coaches + profiles.role = 'coach'
--   élève A        → students.coach_id = coach A
--   élève B        → students.coach_id = coach B
--   élève orphelin → students.coach_id IS NULL   (cas VOULU, voir la migration)
--
-- EXÉCUTION (base LOCALE uniquement) :
--   docker exec -i "$DB_CONTAINER" \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/aliments_a1_checklist.sql
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

-- Un contrôle vaut vrai, faux… ou NULL. Le troisième cas est le plus
-- dangereux : `accepte(sql) and (select …)` rend NULL quand la sous-requête
-- ne voit aucune ligne, et un récapitulatif écrit `count(*) filter (where
-- not ok)` ne compte PAS les NULL — le contrôle disparaît du total sans
-- jamais avoir été vérifié. Mesuré sur FOOD-A9, pas supposé.
--
-- `noter` range donc NULL comme un ÉCHEC, et le dit avec son propre mot pour
-- qu'on ne confonde pas « la règle est violée » avec « la question n'a pas
-- été posée correctement ».
create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, coalesce(p_ok, false));
  if p_ok is null then
    raise warning 'INDÉTERMINÉ — % · % (contrôle mal formé : traité comme un échec)', p_section, p_libelle;
  elsif p_ok then raise notice 'OK      — % · %', p_section, p_libelle;
  else raise warning 'ÉCHEC   — % · %', p_section, p_libelle; end if;
end $$;

-- « Cette instruction DOIT échouer. » Rend vrai quand elle a bien échoué.
-- Le bloc EXCEPTION ouvre une sous-transaction : un refus n'annule donc pas
-- la checklist entière, et l'état reste exploitable pour le contrôle suivant.
create or replace function pg_temp.refuse(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;

-- Même chose à l'endroit : « cette instruction DOIT passer ».
create or replace function pg_temp.accepte(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  return false;
end $$;

-- Nombre de lignes rendues par une requête, sous l'identité courante.
create or replace function pg_temp.compte(p_sql text)
returns integer language plpgsql as $$
declare n integer;
begin
  execute p_sql into n;
  return coalesce(n, -1);
exception when others then
  return -1;
end $$;

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
-- Section 0 — les comptes synthétiques
-- ---------------------------------------------------------------------
-- Identifiants FIXES : une checklist doit être rejouable à l'identique, et
-- un uuid tiré au hasard rendrait un échec impossible à relire.
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'admin@test.invalid'),
  ('a0000000-0000-4000-8000-000000000002', 'coach-a@test.invalid'),
  ('a0000000-0000-4000-8000-000000000003', 'coach-b@test.invalid'),
  ('a0000000-0000-4000-8000-000000000004', 'eleve-a@test.invalid'),
  ('a0000000-0000-4000-8000-000000000005', 'eleve-b@test.invalid'),
  ('a0000000-0000-4000-8000-000000000006', 'eleve-orphelin@test.invalid');

insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('a0000000-0000-4000-8000-000000000001', 'admin',   'Adm', 'In',  'admin@test.invalid'),
  ('a0000000-0000-4000-8000-000000000002', 'coach',   'Co',  'AchA','coach-a@test.invalid'),
  ('a0000000-0000-4000-8000-000000000003', 'coach',   'Co',  'AchB','coach-b@test.invalid'),
  ('a0000000-0000-4000-8000-000000000004', 'student', 'El',  'EveA','eleve-a@test.invalid'),
  ('a0000000-0000-4000-8000-000000000005', 'student', 'El',  'EveB','eleve-b@test.invalid'),
  ('a0000000-0000-4000-8000-000000000006', 'student', 'El',  'EveO','eleve-orphelin@test.invalid');

insert into public.coaches (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'Coach A', 'coach-a@test.invalid'),
  ('c0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000003', 'Coach B', 'coach-b@test.invalid');

insert into public.students (id, user_id, coach_id, first_name, last_name, email, status) values
  ('50000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000004',
   'c0000000-0000-4000-8000-00000000000a', 'Eleve', 'A', 'eleve-a@test.invalid', 'active'),
  ('50000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000005',
   'c0000000-0000-4000-8000-00000000000b', 'Eleve', 'B', 'eleve-b@test.invalid', 'active'),
  ('50000000-0000-4000-8000-00000000000f', 'a0000000-0000-4000-8000-000000000006',
   null, 'Eleve', 'Orphelin', 'eleve-orphelin@test.invalid', 'active');

-- Une recette de coach A, pour éprouver meal_entries.recipe_id.
insert into public.nutrition_recipes (id, coach_id, name, status) values
  ('40000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000a', 'Recette test A', 'active');

-- ── LES CONTENEURS DE REPAS (ajoutés par ALIMENTS A2) ──────────────────
-- Depuis 20260901090000, une meal_entry appartient à un `consumed_meal` et
-- c'est LUI qui porte la date et le créneau. Ces conteneurs sont ici de
-- simples DÉCORS : ce que cette checklist éprouve reste meal_entries. Leur
-- propre contrat (cible figée, repas prescrit vs libre, RPC) est éprouvé par
-- supabase/tests/aliments_a2_checklist.sql, pas ici.
--
-- Insertion DIRECTE, sous l'identité `postgres` : A2 a retiré ce privilège à
-- `authenticated`, et c'est précisément ce que MEAL-A6 vérifie plus bas.
insert into public.consumed_meals (id, student_id, consumed_on, kind, label, position) values
  ('d0000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-8000-00000000000a',
   date '2026-08-10', 'student', 'Repas decor A', 1000),
  ('d0000000-0000-4000-8000-0000000000a2', '50000000-0000-4000-8000-00000000000a',
   date '2026-08-09', 'student', 'Repas decor A veille', 1000),
  ('d0000000-0000-4000-8000-0000000000b1', '50000000-0000-4000-8000-00000000000b',
   date '2026-08-10', 'student', 'Repas decor B', 1000),
  ('d0000000-0000-4000-8000-0000000000f1', '50000000-0000-4000-8000-00000000000f',
   date '2026-08-10', 'student', 'Repas decor orphelin', 1000);

do $$
begin
  perform pg_temp.noter('0', 'les six comptes synthétiques et leurs rattachements existent',
    (select count(*) from public.students where id in (
       '50000000-0000-4000-8000-00000000000a',
       '50000000-0000-4000-8000-00000000000b',
       '50000000-0000-4000-8000-00000000000f')) = 3
    and (select coach_id from public.students where id = '50000000-0000-4000-8000-00000000000f') is null);
end $$;

-- ---------------------------------------------------------------------
-- FOOD-A1 — macros négatives refusées
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('FOOD-A1', 'protéines négatives refusées', pg_temp.refuse($q$
    insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100)
    values ('Negatif proteine', -1, 0, 0) $q$));
  perform pg_temp.noter('FOOD-A1', 'glucides négatifs refusés', pg_temp.refuse($q$
    insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100)
    values ('Negatif glucide', 0, -0.01, 0) $q$));
  perform pg_temp.noter('FOOD-A1', 'lipides négatifs refusés', pg_temp.refuse($q$
    insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100)
    values ('Negatif lipide', 0, 0, -5) $q$));
  perform pg_temp.noter('FOOD-A1', 'macros nulles acceptées (une eau n''est pas une erreur)', pg_temp.accepte($q$
    insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100)
    values ('Eau plate', 0, 0, 0) $q$));
  perform pg_temp.noter('FOOD-A1', 'nom vide refusé', pg_temp.refuse($q$
    insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100)
    values ('   ', 1, 1, 1) $q$));
  perform pg_temp.noter('FOOD-A1', 'nom sans aucun caractère alphanumérique refusé (slug vide)', pg_temp.refuse($q$
    insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100)
    values ('!!! ???', 1, 1, 1) $q$));
end $$;

-- ---------------------------------------------------------------------
-- FOOD-A2 — nutrition_unit à vocabulaire contrôlé
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('FOOD-A2', 'unité « g » acceptée', pg_temp.accepte($q$
    insert into public.food_catalog (name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100)
    values ('Unite grammes', 'g', 1, 1, 1) $q$));
  perform pg_temp.noter('FOOD-A2', 'unité « ml » acceptée', pg_temp.accepte($q$
    insert into public.food_catalog (name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100)
    values ('Unite millilitres', 'ml', 1, 1, 1) $q$));
  perform pg_temp.noter('FOOD-A2', 'unité hors vocabulaire refusée', pg_temp.refuse($q$
    insert into public.food_catalog (name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100)
    values ('Unite inventee', 'cuillere', 1, 1, 1) $q$));
  perform pg_temp.noter('FOOD-A2', 'statut hors vocabulaire refusé', pg_temp.refuse($q$
    insert into public.food_catalog (name, status, protein_per_100, carb_per_100, fat_per_100)
    values ('Statut invente', 'brouillon', 1, 1, 1) $q$));
end $$;

-- ---------------------------------------------------------------------
-- FOOD-A3 — slug unique dans l'espace GLOBAL
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('FOOD-A3', 'premier aliment global accepté', pg_temp.accepte($q$
    insert into public.food_catalog (id, name, protein_per_100, carb_per_100, fat_per_100)
    values ('f0000000-0000-4000-8000-000000000001', 'Blanc de poulet', 23, 0, 1.5) $q$));

  perform pg_temp.noter('FOOD-A3', 'le slug est bien calculé par la colonne générée',
    (select slug from public.food_catalog where id = 'f0000000-0000-4000-8000-000000000001') = 'blanc-de-poulet');

  -- Même aliment, autre graphie : accents, casse, ponctuation, espaces.
  perform pg_temp.noter('FOOD-A3', 'doublon global déguisé (casse et accents) refusé', pg_temp.refuse($q$
    insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100)
    values ('  BLANC de Poulet  ', 23, 0, 1.5) $q$));

  perform pg_temp.noter('FOOD-A3', 'ligature en capitale normalisée comme en minuscule',
    public.food_slug('ŒUF ENTIER') = public.food_slug('Œuf entier')
    and public.food_slug('Œuf entier') = 'oeuf-entier');

  -- Le repli de casse ne doit RIEN devoir à la collation de la base.
  perform pg_temp.noter('FOOD-A3', 'normalisation indépendante de la collation (aucun lower())',
    public.food_slug('Bœuf Haché 5%') = 'boeuf-hache-5'
    and public.food_slug('Müsli & Straße') = 'musli-strasse');
end $$;

-- ---------------------------------------------------------------------
-- FOOD-A4 — slug unique PAR COACH, espaces de noms disjoints
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('FOOD-A4', 'coach A crée son aliment privé homonyme du global', pg_temp.accepte($q$
    insert into public.food_catalog (id, owner_coach_id, name, protein_per_100, carb_per_100, fat_per_100)
    values ('f0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000a',
            'Blanc de poulet', 24, 0, 1.2) $q$));

  perform pg_temp.noter('FOOD-A4', 'coach B crée le même nom sans collision', pg_temp.accepte($q$
    insert into public.food_catalog (id, owner_coach_id, name, protein_per_100, carb_per_100, fat_per_100)
    values ('f0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000b',
            'Blanc de poulet', 22, 0, 2) $q$));

  perform pg_temp.noter('FOOD-A4', 'coach A ne peut pas le créer deux fois', pg_temp.refuse($q$
    insert into public.food_catalog (owner_coach_id, name, protein_per_100, carb_per_100, fat_per_100)
    values ('c0000000-0000-4000-8000-00000000000a', 'blanc-de-poulet', 24, 0, 1.2) $q$));

  perform pg_temp.noter('FOOD-A4', 'trois lignes coexistent : une globale, deux privées',
    (select count(*) from public.food_catalog where slug = 'blanc-de-poulet') = 3);

  perform pg_temp.noter('FOOD-A4', 'un aliment privé ne peut pas pointer un coach inexistant', pg_temp.refuse($q$
    insert into public.food_catalog (owner_coach_id, name, protein_per_100, carb_per_100, fat_per_100)
    values ('c0000000-0000-4000-8000-0000000000ff', 'Coach fantome', 1, 1, 1) $q$));
end $$;

-- ---------------------------------------------------------------------
-- FOOD-A5 — aucune calorie stockée
-- ---------------------------------------------------------------------
do $$
declare v_colonnes text[];
begin
  select array_agg(column_name order by ordinal_position) into v_colonnes
    from information_schema.columns
   where table_schema = 'public' and table_name = 'food_catalog';

  perform pg_temp.noter('FOOD-A5', 'aucune colonne de calories, kcal ou énergie sur food_catalog',
    not exists (
      select 1 from unnest(v_colonnes) c
       where c ~* '(calor|kcal|energ)'));

  perform pg_temp.noter('FOOD-A5', 'les trois macros pour 100 unités sont présentes et NOT NULL',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'food_catalog'
        and column_name in ('protein_per_100', 'carb_per_100', 'fat_per_100')
        and is_nullable = 'NO') = 3);

  -- L'énergie reste CALCULABLE à la lecture — c'est tout l'intérêt de ne pas
  -- la stocker : elle ne peut pas diverger.
  perform pg_temp.noter('FOOD-A5', 'le 4/4/9 se dérive des colonnes stockées',
    (select round(4 * protein_per_100 + 4 * carb_per_100 + 9 * fat_per_100)
       from public.food_catalog where id = 'f0000000-0000-4000-8000-000000000001') = 106);

  perform pg_temp.noter('FOOD-A5', 'aucune colonne de calories non plus sur meal_entries',
    not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'meal_entries'
         and column_name ~* '(calor|kcal|energ)'));
end $$;

-- ---------------------------------------------------------------------
-- FOOD-A9 — piece_weight_g : la place est prise, le moteur viendra après
-- ---------------------------------------------------------------------
-- « 1 banane ≈ 120 g ». A1 pose la colonne et ses garde-fous ; AUCUN code de
-- ce lot ne la lit. Ce qui est vérifié ici, c'est qu'elle existe avec la
-- bonne forme — pas qu'elle serve à quelque chose.
do $$
begin
  perform pg_temp.noter('FOOD-A9', 'la colonne existe, en numeric et NULLABLE',
    (select data_type = 'numeric' and is_nullable = 'YES'
       from information_schema.columns
      where table_schema = 'public' and table_name = 'food_catalog'
        and column_name = 'piece_weight_g'));

  perform pg_temp.noter('FOOD-A9', 'elle n''a AUCUNE valeur par défaut — NULL veut dire « pas de pièce »',
    (select column_default is null from information_schema.columns
      where table_schema = 'public' and table_name = 'food_catalog'
        and column_name = 'piece_weight_g'));

  perform pg_temp.noter('FOOD-A9', 'un aliment sans pièce naturelle s''enregistre sans elle', pg_temp.accepte($q$
    insert into public.food_catalog (id, name, protein_per_100, carb_per_100, fat_per_100)
    values ('f0000000-0000-4000-8000-0000000000d1', 'Huile olive', 0, 0, 100) $q$));

  perform pg_temp.noter('FOOD-A9', 'une banane à 120 g s''enregistre et se relit 120', pg_temp.accepte($q$
    insert into public.food_catalog (id, name, protein_per_100, carb_per_100, fat_per_100, piece_weight_g)
    values ('f0000000-0000-4000-8000-0000000000d2', 'Banane fraiche', 1.1, 23, 0.3, 120) $q$));

  perform pg_temp.noter('FOOD-A9', 'un poids de pièce nul ou négatif est refusé',
    pg_temp.refuse($q$
      insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100, piece_weight_g)
      values ('Piece nulle', 1, 1, 1, 0) $q$)
    and pg_temp.refuse($q$
      insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100, piece_weight_g)
      values ('Piece negative', 1, 1, 1, -5) $q$));

  -- Un poids décimal est permis : un œuf moyen ne pèse pas un nombre rond.
  perform pg_temp.noter('FOOD-A9', 'un poids décimal est permis (un œuf ne pèse pas rond)', pg_temp.accepte($q$
    insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100, piece_weight_g)
    values ('Oeuf moyen', 12.6, 0.7, 9.5, 57.5) $q$));
end $$;

do $$
begin
  perform pg_temp.noter('FOOD-A9', 'la banane relit bien 120',
    (select piece_weight_g from public.food_catalog
      where id = 'f0000000-0000-4000-8000-0000000000d2') = 120);
  perform pg_temp.noter('FOOD-A9', 'l''huile, elle, n''a pas de poids de pièce',
    (select piece_weight_g is null from public.food_catalog
      where id = 'f0000000-0000-4000-8000-0000000000d1'));
end $$;

-- ---------------------------------------------------------------------
-- FOOD-A6 — RLS élève : il LIT le global, il n'ÉCRIT RIEN
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');  -- élève A

do $$
begin
  perform pg_temp.noter('FOOD-A6', 'l''élève lit le catalogue global',
    pg_temp.compte($q$ select count(*)::int from public.food_catalog
                        where id = 'f0000000-0000-4000-8000-000000000001' $q$) = 1);

  perform pg_temp.noter('FOOD-A6', 'l''élève ne voit AUCUN aliment privé',
    pg_temp.compte($q$ select count(*)::int from public.food_catalog
                        where owner_coach_id is not null $q$) = 0);

  perform pg_temp.noter('FOOD-A6', 'l''élève ne peut pas créer un aliment global', pg_temp.refuse($q$
    insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100)
    values ('Aliment pousse par un eleve', 1, 1, 1) $q$));

  perform pg_temp.noter('FOOD-A6', 'l''élève ne peut pas créer un aliment privé', pg_temp.refuse($q$
    insert into public.food_catalog (owner_coach_id, name, protein_per_100, carb_per_100, fat_per_100)
    values ('c0000000-0000-4000-8000-00000000000a', 'Aliment vole', 1, 1, 1) $q$));

  -- Un UPDATE sans droit ne LÈVE PAS : il ne touche simplement aucune ligne.
  -- On mesure donc l'effet, pas l'exception — sinon le test serait vert pour
  -- la mauvaise raison.
  perform pg_temp.noter('FOOD-A6', 'l''élève ne modifie aucune ligne du catalogue global',
    pg_temp.compte($q$ with maj as (
        update public.food_catalog set protein_per_100 = 999
         where id = 'f0000000-0000-4000-8000-000000000001' returning 1)
      select count(*)::int from maj $q$) = 0);

  perform pg_temp.noter('FOOD-A6', 'l''élève ne supprime aucune ligne du catalogue',
    pg_temp.compte($q$ with sup as (
        delete from public.food_catalog
         where id = 'f0000000-0000-4000-8000-000000000001' returning 1)
      select count(*)::int from sup $q$) = 0);

  perform pg_temp.noter('FOOD-A6', 'l''élève n''a AUCUN privilège TRUNCATE (qui contournerait la RLS)',
    not has_table_privilege('authenticated', 'public.food_catalog', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.meal_entries', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.food_aliases', 'TRUNCATE'));
end $$;

reset role;

-- La valeur d'origine est intacte : la preuve que rien n'est passé.
do $$
begin
  perform pg_temp.noter('FOOD-A6', 'la valeur du catalogue est restée intacte après les tentatives',
    (select protein_per_100 from public.food_catalog
      where id = 'f0000000-0000-4000-8000-000000000001') = 23);
end $$;

-- ---------------------------------------------------------------------
-- FOOD-A7 — RLS coach : son privé, rien que son privé
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000002');  -- coach A

do $$
begin
  perform pg_temp.noter('FOOD-A7', 'coach A voit son aliment privé',
    pg_temp.compte($q$ select count(*)::int from public.food_catalog
                        where id = 'f0000000-0000-4000-8000-00000000000a' $q$) = 1);

  perform pg_temp.noter('FOOD-A7', 'coach A ne voit PAS l''aliment privé de coach B',
    pg_temp.compte($q$ select count(*)::int from public.food_catalog
                        where id = 'f0000000-0000-4000-8000-00000000000b' $q$) = 0);

  perform pg_temp.noter('FOOD-A7', 'coach A lit le catalogue global',
    pg_temp.compte($q$ select count(*)::int from public.food_catalog
                        where owner_coach_id is null $q$) > 0);

  perform pg_temp.noter('FOOD-A7', 'coach A modifie son aliment privé',
    pg_temp.compte($q$ with maj as (
        update public.food_catalog set protein_per_100 = 25
         where id = 'f0000000-0000-4000-8000-00000000000a' returning 1)
      select count(*)::int from maj $q$) = 1);

  perform pg_temp.noter('FOOD-A7', 'coach A ne modifie AUCUN aliment global',
    pg_temp.compte($q$ with maj as (
        update public.food_catalog set protein_per_100 = 999
         where owner_coach_id is null returning 1)
      select count(*)::int from maj $q$) = 0);

  perform pg_temp.noter('FOOD-A7', 'coach A ne modifie pas l''aliment de coach B',
    pg_temp.compte($q$ with maj as (
        update public.food_catalog set protein_per_100 = 999
         where id = 'f0000000-0000-4000-8000-00000000000b' returning 1)
      select count(*)::int from maj $q$) = 0);

  perform pg_temp.noter('FOOD-A7', 'coach A ne peut pas créer un aliment GLOBAL', pg_temp.refuse($q$
    insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100)
    values ('Global cree par un coach', 1, 1, 1) $q$));

  perform pg_temp.noter('FOOD-A7', 'coach A ne peut pas créer un aliment AU NOM de coach B', pg_temp.refuse($q$
    insert into public.food_catalog (owner_coach_id, name, protein_per_100, carb_per_100, fat_per_100)
    values ('c0000000-0000-4000-8000-00000000000b', 'Usurpation', 1, 1, 1) $q$));

  -- Le cas le plus sournois : céder son propre aliment au global, ce qui
  -- l'élèverait de portée. Le `with check` de sa policy l'interdit.
  perform pg_temp.noter('FOOD-A7', 'coach A ne peut pas rendre son aliment global', pg_temp.refuse($q$
    update public.food_catalog set owner_coach_id = null
     where id = 'f0000000-0000-4000-8000-00000000000a' $q$));

  perform pg_temp.noter('FOOD-A7', 'coach A ne peut pas donner son aliment à coach B', pg_temp.refuse($q$
    update public.food_catalog set owner_coach_id = 'c0000000-0000-4000-8000-00000000000b'
     where id = 'f0000000-0000-4000-8000-00000000000a' $q$));
end $$;

reset role;

-- L'administrateur, lui, écrit le global.
set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000001');  -- admin

do $$
begin
  perform pg_temp.noter('FOOD-A7', 'l''administrateur crée un aliment global', pg_temp.accepte($q$
    insert into public.food_catalog (id, name, protein_per_100, carb_per_100, fat_per_100)
    values ('f0000000-0000-4000-8000-000000000002', 'Riz basmati cuit', 2.7, 28, 0.3) $q$));

  perform pg_temp.noter('FOOD-A7', 'l''administrateur voit les aliments privés des deux coachs',
    pg_temp.compte($q$ select count(*)::int from public.food_catalog
                        where owner_coach_id is not null $q$) = 2);
end $$;

reset role;

do $$
begin
  perform pg_temp.noter('FOOD-A7', 'aucun aliment global n''a été altéré par un coach',
    (select count(*) from public.food_catalog
      where owner_coach_id is null and protein_per_100 = 999) = 0);
  perform pg_temp.noter('FOOD-A7', 'l''aliment privé de coach A est resté à lui',
    (select owner_coach_id from public.food_catalog
      where id = 'f0000000-0000-4000-8000-00000000000a') = 'c0000000-0000-4000-8000-00000000000a');
end $$;

-- ---------------------------------------------------------------------
-- FOOD-A8 — food_aliases : normalisation, unicité, visibilité héritée
-- ---------------------------------------------------------------------
insert into public.food_aliases (food_id, alias) values
  ('f0000000-0000-4000-8000-000000000001', 'Escalope de poulet'),
  ('f0000000-0000-4000-8000-00000000000a', 'Poulet maison A');

do $$
begin
  perform pg_temp.noter('FOOD-A8', 'l''alias normalisé est calculé par la colonne générée',
    (select alias_normalise from public.food_aliases where alias = 'Escalope de poulet')
      = 'escalope-de-poulet');

  perform pg_temp.noter('FOOD-A8', 'deux graphies du même alias sont un doublon', pg_temp.refuse($q$
    insert into public.food_aliases (food_id, alias)
    values ('f0000000-0000-4000-8000-000000000001', '  ESCALOPE  de   Poulet ') $q$));

  perform pg_temp.noter('FOOD-A8', 'le même alias sur un AUTRE aliment reste permis', pg_temp.accepte($q$
    insert into public.food_aliases (food_id, alias)
    values ('f0000000-0000-4000-8000-00000000000b', 'Escalope de poulet') $q$));

  perform pg_temp.noter('FOOD-A8', 'alias vide refusé', pg_temp.refuse($q$
    insert into public.food_aliases (food_id, alias)
    values ('f0000000-0000-4000-8000-000000000001', '   ') $q$));

  perform pg_temp.noter('FOOD-A8', 'alias sans caractère alphanumérique refusé', pg_temp.refuse($q$
    insert into public.food_aliases (food_id, alias)
    values ('f0000000-0000-4000-8000-000000000001', '---') $q$));
end $$;

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');  -- élève A
do $$
begin
  perform pg_temp.noter('FOOD-A8', 'l''élève voit les alias du catalogue GLOBAL',
    pg_temp.compte($q$ select count(*)::int from public.food_aliases
                        where food_id = 'f0000000-0000-4000-8000-000000000001' $q$) = 1);
  perform pg_temp.noter('FOOD-A8', 'l''élève ne voit AUCUN alias d''aliment privé',
    pg_temp.compte($q$ select count(*)::int from public.food_aliases a
                        join public.food_catalog f on f.id = a.food_id
                       where f.owner_coach_id is not null $q$) = 0);
  perform pg_temp.noter('FOOD-A8', 'l''élève ne peut pas créer d''alias', pg_temp.refuse($q$
    insert into public.food_aliases (food_id, alias)
    values ('f0000000-0000-4000-8000-000000000001', 'alias pousse par un eleve') $q$));
end $$;
reset role;

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000003');  -- coach B
do $$
begin
  perform pg_temp.noter('FOOD-A8', 'coach B ne voit pas les alias de l''aliment privé de coach A',
    pg_temp.compte($q$ select count(*)::int from public.food_aliases
                        where food_id = 'f0000000-0000-4000-8000-00000000000a' $q$) = 0);
  perform pg_temp.noter('FOOD-A8', 'coach B voit les alias de SON aliment',
    pg_temp.compte($q$ select count(*)::int from public.food_aliases
                        where food_id = 'f0000000-0000-4000-8000-00000000000b' $q$) = 1);
  perform pg_temp.noter('FOOD-A8', 'coach B ne peut pas ajouter d''alias à l''aliment de coach A', pg_temp.refuse($q$
    insert into public.food_aliases (food_id, alias)
    values ('f0000000-0000-4000-8000-00000000000a', 'intrusion') $q$));
  perform pg_temp.noter('FOOD-A8', 'coach B ne peut pas ajouter d''alias à un aliment GLOBAL', pg_temp.refuse($q$
    insert into public.food_aliases (food_id, alias)
    values ('f0000000-0000-4000-8000-000000000001', 'intrusion globale') $q$));
end $$;
reset role;

-- ---------------------------------------------------------------------
-- MEAL-A1 — meal_entries existe SANS nutrition_plan_id
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('MEAL-A1', 'meal_entries est une table distincte de meals',
    to_regclass('public.meal_entries') is not null
    and to_regclass('public.meals') is not null);

  perform pg_temp.noter('MEAL-A1', 'AUCUNE colonne nutrition_plan_id (contrairement à nutrition_daily_logs)',
    not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'meal_entries'
                   and column_name = 'nutrition_plan_id')
    and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'nutrition_daily_logs'
                   and column_name = 'nutrition_plan_id' and is_nullable = 'NO'));

  perform pg_temp.noter('MEAL-A1', 'AUCUNE clé étrangère de meal_entries vers nutrition_plans',
    not exists (
      select 1 from pg_constraint c
       where c.conrelid = 'public.meal_entries'::regclass
         and c.contype = 'f'
         and c.confrelid = 'public.nutrition_plans'::regclass));

  -- L'élève orphelin n'a ni coach ni plan : il doit pouvoir manger quand même.
  perform pg_temp.noter('MEAL-A1', 'une entrée s''enregistre sans le moindre plan assigné', pg_temp.accepte($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000f', 'd0000000-0000-4000-8000-0000000000f1', 'free',
            'Pomme', 150, 'g', 0.4, 20, 0.3) $q$));

  perform pg_temp.noter('MEAL-A1', 'aucun plan n''existe pour cet élève — la preuve que rien ne l''exige',
    (select count(*) from public.nutrition_plans
      where student_id = '50000000-0000-4000-8000-00000000000f') = 0);
end $$;

-- ---------------------------------------------------------------------
-- MEAL-A2 — quantité, macros et libellé contraints
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('MEAL-A2', 'quantité nulle refusée', pg_temp.refuse($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'free', 'Rien', 0, 'g', 0, 0, 0) $q$));

  perform pg_temp.noter('MEAL-A2', 'quantité négative refusée', pg_temp.refuse($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'free', 'Negatif', -1, 'g', 0, 0, 0) $q$));

  perform pg_temp.noter('MEAL-A2', 'macro négative refusée', pg_temp.refuse($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'free', 'Macro', 100, 'g', -1, 0, 0) $q$));

  perform pg_temp.noter('MEAL-A2', 'libellé vide refusé', pg_temp.refuse($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'free', '  ', 100, 'g', 0, 0, 0) $q$));

  perform pg_temp.noter('MEAL-A2', 'unité hors vocabulaire refusée', pg_temp.refuse($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'free', 'Unite', 1, 'poignee', 0, 0, 0) $q$));

  -- ── DÉPLACÉ PAR A2, PAS SUPPRIMÉ ──────────────────────────────────────
  -- A1 posait `consumed_on` et `slot_key` SUR L'ENTRÉE, et deux contrôles
  -- éprouvaient ici le vocabulaire du créneau. A2 (20260901090000) a déplacé
  -- les deux sur `consumed_meals` : les garder aux deux endroits en ferait
  -- une seconde source de vérité — rien n'empêcherait une entrée datée du 13
  -- d'être rattachée à un repas du 14.
  --
  -- Les réécrire tels quels ici donnerait un FAUX VERT : l'INSERT échouerait
  -- pour « column slot_key does not exist », c'est-à-dire pour une raison qui
  -- n'a rien à voir avec le vocabulaire éprouvé. On constate donc le
  -- déplacement, et le vocabulaire lui-même est éprouvé sur sa nouvelle
  -- table par A2-DB (supabase/tests/aliments_a2_checklist.sql).
  perform pg_temp.noter('MEAL-A2', 'consumed_on et slot_key ont QUITTÉ meal_entries (déplacés sur consumed_meals par A2)',
    not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'meal_entries'
                   and column_name in ('consumed_on', 'slot_key'))
    and (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'consumed_meals'
            and column_name in ('consumed_on', 'slot_key')) = 2);

  perform pg_temp.noter('MEAL-A2', 'une entrée ne peut PAS flotter sans conteneur', pg_temp.refuse($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', null, 'free', 'Orpheline', 30, 'g', 1, 5, 2) $q$));

  -- La clé étrangère est COMPOSITE : le conteneur ET l'élève. Rattacher son
  -- entrée au repas d'un autre est refusé par la base, pas par une règle
  -- applicative.
  perform pg_temp.noter('MEAL-A2', 'une entrée ne peut PAS être rattachée au repas d''un autre élève', pg_temp.refuse($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000b1', 'free', 'Vol', 30, 'g', 1, 5, 2) $q$));

  perform pg_temp.noter('MEAL-A2', 'une entrée normale, elle, s''enregistre', pg_temp.accepte($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'free', 'Grignotage', 30, 'g', 1, 5, 2) $q$));
end $$;

-- ---------------------------------------------------------------------
-- MEAL-A3 — source_type à vocabulaire contrôlé
-- ---------------------------------------------------------------------
do $$
declare v_ok boolean := true;
begin
  perform pg_temp.noter('MEAL-A3', 'source_type inventé refusé', pg_temp.refuse($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'scan', 'X', 1, 'g', 0, 0, 0) $q$));

  -- Les quatre valeurs du vocabulaire, y compris `product` qui n'a pas
  -- encore de table : elle est déclarée d'avance, donc elle doit passer.
  perform pg_temp.noter('MEAL-A3', 'les quatre valeurs du vocabulaire sont acceptées, product compris',
    pg_temp.accepte($q$
      insert into public.meal_entries
        (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
      values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a2', 'free',         'A', 1, 'g', 0, 0, 0),
             ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a2', 'product',      'B', 1, 'g', 0, 0, 0) $q$)
    and pg_temp.accepte($q$
      insert into public.meal_entries
        (student_id, consumed_meal_id, source_type, recipe_id, label, quantity, unit, protein_g, carb_g, fat_g)
      values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a2', 'recipe',
              '40000000-0000-4000-8000-00000000000a', 'C', 1, 'portion', 0, 0, 0) $q$)
    and pg_temp.accepte($q$
      insert into public.meal_entries
        (student_id, consumed_meal_id, source_type, food_id, label, quantity, unit, protein_g, carb_g, fat_g)
      values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a2', 'catalog_food',
              'f0000000-0000-4000-8000-000000000001', 'D', 1, 'g', 0, 0, 0) $q$));

  perform pg_temp.noter('MEAL-A3', 'le vocabulaire déclaré est exactement recipe|catalog_food|product|free',
    (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.meal_entries'::regclass
        and conname = 'meal_entries_source_type_check')
    ~ 'recipe.*catalog_food.*product.*free');
end $$;

-- ---------------------------------------------------------------------
-- MEAL-A4 — états impossibles
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('MEAL-A4', 'food_id sans source_type = catalog_food refusé', pg_temp.refuse($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, food_id, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'free',
            'f0000000-0000-4000-8000-000000000001', 'X', 1, 'g', 0, 0, 0) $q$));

  perform pg_temp.noter('MEAL-A4', 'recipe_id sans source_type = recipe refusé', pg_temp.refuse($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, recipe_id, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'catalog_food',
            '40000000-0000-4000-8000-00000000000a', 'X', 1, 'g', 0, 0, 0) $q$));

  perform pg_temp.noter('MEAL-A4', 'les deux pointeurs à la fois refusés', pg_temp.refuse($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, recipe_id, food_id, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'recipe',
            '40000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-000000000001',
            'X', 1, 'g', 0, 0, 0) $q$));

  -- Le point clé : la contrainte est écrite dans le sens qui SURVIT à
  -- `on delete set null`. Une entrée « recipe » dont le pointeur est déjà
  -- NULL reste légale — sinon supprimer une recette deviendrait impossible.
  perform pg_temp.noter('MEAL-A4', 'une entrée « recipe » au pointeur NULL reste légale', pg_temp.accepte($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, recipe_id, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'recipe', null,
            'Recette disparue', 1, 'portion', 10, 20, 5) $q$));
end $$;

-- ---------------------------------------------------------------------
-- MEAL-A5 — l'instantané est indépendant de SA SOURCE
-- ---------------------------------------------------------------------
-- Ce que cette section prouve : rien de ce qui arrive à `food_catalog` ou à
-- `nutrition_recipes` ne réécrit une entrée existante. Elle ne prouve PAS
-- que la ligne est immuable — ce serait une autre règle, et ce n'est pas
-- celle qu'on veut : la correction volontaire est éprouvée en MEAL-A11.
insert into public.meal_entries
  (id, student_id, consumed_meal_id, source_type, food_id, label, quantity, unit, protein_g, carb_g, fat_g,
   created_at, updated_at)
values ('e0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'catalog_food', 'f0000000-0000-4000-8000-000000000001',
        'Blanc de poulet', 200, 'g', 46, 0, 3,
        now() - interval '2 days', now() - interval '2 days');

do $$
begin
  -- Ce qui n'est pas l'instantané se corrige évidemment. Depuis A2, le
  -- créneau et la date ne sont plus sur l'entrée : ce qui reste à ce niveau,
  -- c'est la note. Changer de repas se fait en changeant de conteneur — et
  -- c'est cette seconde forme que le contrôle suivant éprouve.
  perform pg_temp.noter('MEAL-A5', 'la note est modifiable', pg_temp.accepte($q$
    update public.meal_entries set note = 'note ajoutee'
     where id = 'e0000000-0000-4000-8000-000000000001' $q$));

  perform pg_temp.noter('MEAL-A5', 'déplacer l''entrée vers un AUTRE repas du même élève est possible', pg_temp.accepte($q$
    update public.meal_entries set consumed_meal_id = 'd0000000-0000-4000-8000-0000000000a2'
     where id = 'e0000000-0000-4000-8000-000000000001' $q$));

  perform pg_temp.noter('MEAL-A5', 'la déplacer vers le repas d''un AUTRE élève est refusé', pg_temp.refuse($q$
    update public.meal_entries set consumed_meal_id = 'd0000000-0000-4000-8000-0000000000b1'
     where id = 'e0000000-0000-4000-8000-000000000001' $q$));

  -- Et AUCUN trigger ne s'interpose sur l'UPDATE de meal_entries hormis
  -- l'horodatage : c'est la garantie que le schéma n'interdit pas l'UX de A2.
  perform pg_temp.noter('MEAL-A5', 'aucun trigger de gel ne subsiste sur meal_entries',
    (select coalesce(array_agg(tgname::text order by tgname::text), '{}'::text[])
       from pg_trigger where tgrelid = 'public.meal_entries'::regclass and not tgisinternal)
    = array['set_updated_at']::text[]);

  perform pg_temp.noter('MEAL-A5', 'la fonction de gel n''existe plus dans le schéma',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'meal_entries_freeze_snapshot'));
end $$;

-- La correction du catalogue, puis sa disparition : l'histoire ne bouge pas.
update public.food_catalog set protein_per_100 = 99, name = 'Blanc de poulet corrige'
 where id = 'f0000000-0000-4000-8000-000000000001';

do $$
begin
  perform pg_temp.noter('MEAL-A5', 'corriger l''aliment source ne change PAS l''entrée consommée',
    (select label || '|' || quantity || '|' || protein_g || '|' || carb_g || '|' || fat_g
       from public.meal_entries where id = 'e0000000-0000-4000-8000-000000000001')
    = 'Blanc de poulet|200|46|0|3');
end $$;

delete from public.food_aliases where food_id = 'f0000000-0000-4000-8000-000000000001';
delete from public.food_catalog where id = 'f0000000-0000-4000-8000-000000000001';

do $$
begin
  perform pg_temp.noter('MEAL-A5', 'supprimer l''aliment source n''emporte pas l''entrée',
    (select count(*) from public.meal_entries
      where id = 'e0000000-0000-4000-8000-000000000001') = 1);
  perform pg_temp.noter('MEAL-A5', 'le pointeur passe à NULL, l''instantané reste exact',
    (select food_id is null
        and label = 'Blanc de poulet' and quantity = 200
        and protein_g = 46 and carb_g = 0 and fat_g = 3
       from public.meal_entries where id = 'e0000000-0000-4000-8000-000000000001'));
  perform pg_temp.noter('MEAL-A5', 'l''entrée reste légale malgré source_type = catalog_food sans pointeur',
    (select source_type from public.meal_entries
      where id = 'e0000000-0000-4000-8000-000000000001') = 'catalog_food');
end $$;

-- Même démonstration côté recette : la supprimer ne réécrit pas l'histoire.
delete from public.nutrition_recipe_tags where recipe_id = '40000000-0000-4000-8000-00000000000a';
delete from public.nutrition_recipes where id = '40000000-0000-4000-8000-00000000000a';

do $$
begin
  perform pg_temp.noter('MEAL-A5', 'supprimer la recette source n''emporte pas les entrées',
    (select count(*) from public.meal_entries
      where source_type = 'recipe' and recipe_id is null) >= 2);
end $$;

-- ---------------------------------------------------------------------
-- MEAL-A6 — RLS élève
-- ---------------------------------------------------------------------
insert into public.meal_entries
  (id, student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
values
  ('e0000000-0000-4000-8000-0000000000b1', '50000000-0000-4000-8000-00000000000b', 'd0000000-0000-4000-8000-0000000000b1', 'free', 'Repas eleve B', 100, 'g', 10, 10, 10),
  ('e0000000-0000-4000-8000-0000000000f1', '50000000-0000-4000-8000-00000000000f', 'd0000000-0000-4000-8000-0000000000f1', 'free', 'Repas eleve orphelin', 100, 'g', 10, 10, 10);

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');  -- élève A

do $$
begin
  perform pg_temp.noter('MEAL-A6', 'l''élève A lit ses propres entrées',
    pg_temp.compte($q$ select count(*)::int from public.meal_entries $q$) > 0);

  perform pg_temp.noter('MEAL-A6', 'l''élève A ne voit AUCUNE entrée d''un autre élève',
    pg_temp.compte($q$ select count(*)::int from public.meal_entries
                        where student_id <> '50000000-0000-4000-8000-00000000000a' $q$) = 0);

  -- ── LE CHEMIN D'ÉCRITURE A CHANGÉ EN A2 ───────────────────────────────
  -- A1 accordait `insert, update, delete` sur meal_entries à `authenticated`,
  -- et cette section prouvait que la RLS suffisait à cloisonner les élèves.
  -- A2 a RETIRÉ ces trois privilèges : tant qu'ils existaient, un client
  -- pouvait écrire ses propres protein_g / carb_g / fat_g par PostgREST et
  -- contourner intégralement le calcul serveur. La RLS ne pouvait pas s'y
  -- opposer : une policy dit QUELLES LIGNES, jamais QUELLES VALEURS.
  --
  -- L'INTENTION des contrôles ci-dessous est inchangée — « l'élève écrit ses
  -- entrées, et seulement les siennes ». Seul le VÉHICULE change : les RPC
  -- `security definer` de 20260901090000. On ajoute donc, en plus, la preuve
  -- que la porte directe est bien fermée.
  perform pg_temp.noter('MEAL-A6', 'la porte DIRECTE est fermée : insert refusé', pg_temp.refuse($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1',
            'free', 'Macros fabriquees', 1, 'g', 9999, 0, 0) $q$));

  perform pg_temp.noter('MEAL-A6', 'la porte DIRECTE est fermée : update et delete refusés',
    pg_temp.refuse($q$ update public.meal_entries set protein_g = 9999
                        where student_id = '50000000-0000-4000-8000-00000000000a' $q$)
    and pg_temp.refuse($q$ delete from public.meal_entries
                            where student_id = '50000000-0000-4000-8000-00000000000a' $q$));

  perform pg_temp.noter('MEAL-A6', 'aucun privilège d''écriture ne subsiste pour authenticated',
    not exists (select 1 from information_schema.role_table_grants
                 where table_schema = 'public' and table_name = 'meal_entries'
                   and grantee = 'authenticated'
                   and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))
    and exists (select 1 from information_schema.role_table_grants
                 where table_schema = 'public' and table_name = 'meal_entries'
                   and grantee = 'authenticated' and privilege_type = 'SELECT'));

  -- L'élève écrit — par la RPC, qui calcule les macros elle-même.
  perform pg_temp.noter('MEAL-A6', 'l''élève A crée une entrée pour lui-même, PAR LA RPC', pg_temp.accepte($q$
    select public.ajouter_aliment_manuel('d0000000-0000-4000-8000-0000000000a1',
             'Saisie eleve A', 100, 'g', 1, 2, 3) $q$));

  -- Et il ne peut pas viser le repas d'un autre : la RPC résout l'élève par
  -- current_student_id(), jamais par un identifiant reçu du client.
  perform pg_temp.noter('MEAL-A6', 'l''élève A ne peut PAS écrire dans le repas de l''élève B', pg_temp.refuse($q$
    select public.ajouter_aliment_manuel('d0000000-0000-4000-8000-0000000000b1',
             'Usurpation', 1, 'g', 0, 0, 0) $q$));

  perform pg_temp.noter('MEAL-A6', 'l''élève A ne modifie aucune entrée de l''élève B', pg_temp.refuse($q$
    select public.modifier_quantite_entree('e0000000-0000-4000-8000-0000000000b1', 500, 'g') $q$));

  perform pg_temp.noter('MEAL-A6', 'l''élève A ne supprime aucune entrée de l''élève B', pg_temp.refuse($q$
    select public.supprimer_entree('e0000000-0000-4000-8000-0000000000b1') $q$));

  perform pg_temp.noter('MEAL-A6', 'l''élève A supprime bien SA propre entrée',
    pg_temp.accepte($q$ select public.supprimer_entree(
      (select id from public.meal_entries
        where student_id = '50000000-0000-4000-8000-00000000000a'
          and label = 'Saisie eleve A')) $q$)
    and pg_temp.compte($q$ select count(*)::int from public.meal_entries
                            where label = 'Saisie eleve A' $q$) = 0);
end $$;

reset role;

do $$
begin
  perform pg_temp.noter('MEAL-A6', 'l''entrée de l''élève B est intacte après les tentatives',
    (select note from public.meal_entries
      where id = 'e0000000-0000-4000-8000-0000000000b1') = '');
end $$;

-- ---------------------------------------------------------------------
-- MEAL-A7 — RLS coach : lecture de SES élèves, jamais d'écriture
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000002');  -- coach A

do $$
begin
  perform pg_temp.noter('MEAL-A7', 'coach A lit les entrées de SON élève A',
    pg_temp.compte($q$ select count(*)::int from public.meal_entries
                        where student_id = '50000000-0000-4000-8000-00000000000a' $q$) > 0);

  perform pg_temp.noter('MEAL-A7', 'coach A ne lit PAS les entrées de l''élève de coach B',
    pg_temp.compte($q$ select count(*)::int from public.meal_entries
                        where student_id = '50000000-0000-4000-8000-00000000000b' $q$) = 0);

  -- Le point explicitement voulu : l'élève sans rattachement reste opaque.
  perform pg_temp.noter('MEAL-A7', 'coach A ne lit PAS les entrées de l''élève sans coach_id',
    pg_temp.compte($q$ select count(*)::int from public.meal_entries
                        where student_id = '50000000-0000-4000-8000-00000000000f' $q$) = 0);

  perform pg_temp.noter('MEAL-A7', 'coach A ne peut pas ÉCRIRE une entrée pour son élève', pg_temp.refuse($q$
    insert into public.meal_entries
      (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
    values ('50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'free',
            'Saisie par le coach', 1, 'g', 0, 0, 0) $q$));

  -- A1 : la RLS laissait passer l'UPDATE et il touchait zéro ligne. A2 :
  -- le privilège lui-même a disparu, l'instruction est REFUSÉE. Les deux
  -- disent « le coach ne change rien » ; le contrôle nomme lequel des deux
  -- barrages a joué, pour qu'un futur relâchement du privilège se voie.
  perform pg_temp.noter('MEAL-A7', 'coach A ne modifie aucune entrée de son élève', pg_temp.refuse($q$
    update public.meal_entries set note = 'coach'
     where student_id = '50000000-0000-4000-8000-00000000000a' $q$));

  perform pg_temp.noter('MEAL-A7', 'coach A ne supprime aucune entrée de son élève', pg_temp.refuse($q$
    delete from public.meal_entries
     where student_id = '50000000-0000-4000-8000-00000000000a' $q$));

  -- Le coach n'a pas non plus de porte dérobée par les RPC : elles résolvent
  -- toutes l'élève par current_student_id(), qui est NULL pour un coach.
  perform pg_temp.noter('MEAL-A7', 'les RPC de A2 ne donnent au coach aucune porte dérobée', pg_temp.refuse($q$
    select public.ajouter_aliment_manuel('d0000000-0000-4000-8000-0000000000a1',
             'Saisie par le coach via RPC', 1, 'g', 0, 0, 0) $q$));

  perform pg_temp.noter('MEAL-A7', 'le helper relationnel répond juste pour chacun des trois élèves',
    public.is_coach_of_student('50000000-0000-4000-8000-00000000000a')
    and not public.is_coach_of_student('50000000-0000-4000-8000-00000000000b')
    and not public.is_coach_of_student('50000000-0000-4000-8000-00000000000f'));
end $$;

reset role;

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000003');  -- coach B
do $$
begin
  perform pg_temp.noter('MEAL-A7', 'coach B lit son élève B et lui seul',
    pg_temp.compte($q$ select count(*)::int from public.meal_entries
                        where student_id = '50000000-0000-4000-8000-00000000000b' $q$) = 1
    and pg_temp.compte($q$ select count(*)::int from public.meal_entries
                           where student_id <> '50000000-0000-4000-8000-00000000000b' $q$) = 0);
end $$;
reset role;

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000001');  -- admin
do $$
begin
  perform pg_temp.noter('MEAL-A7', 'l''administrateur lit les entrées des TROIS élèves',
    pg_temp.compte($q$ select count(distinct student_id)::int from public.meal_entries $q$) = 3);
  -- ── CONSÉQUENCE ASSUMÉE DE A2, ÉNONCÉE PLUTÔT QUE CONTOURNÉE ─────────
  -- En A1 l'administrateur écrivait directement : sa policy meal_entries_
  -- manage_admin le permettait. A2 retire insert/update/delete à
  -- `authenticated` TOUT ENTIER — l'administrateur en fait partie. Sa policy
  -- subsiste mais ne peut plus s'exercer : un privilège absent n'est pas
  -- rattrapable par une policy permissive.
  --
  -- C'est voulu : la règle « le navigateur ne dicte jamais les macros » ne
  -- souffre pas d'exception par rôle, sans quoi il suffirait d'usurper un
  -- profil admin pour la contourner. Une correction administrative se fait
  -- côté serveur (service_role) ou en SQL, jamais depuis le navigateur.
  perform pg_temp.noter('MEAL-A7', 'l''administrateur non plus n''écrit directement (conséquence assumée de A2)',
    pg_temp.refuse($q$
      insert into public.meal_entries
        (student_id, consumed_meal_id, source_type, label, quantity, unit, protein_g, carb_g, fat_g)
      values ('50000000-0000-4000-8000-00000000000f', 'd0000000-0000-4000-8000-0000000000f1', 'free',
              'Correction administrative', 10, 'g', 0, 0, 0) $q$));

  perform pg_temp.noter('MEAL-A7', 'sa policy d''administration existe toujours, elle est simplement sans privilège',
    exists (select 1 from pg_policies where schemaname = 'public'
             and tablename = 'meal_entries' and policyname = 'meal_entries_manage_admin'));
end $$;
reset role;

-- L'anonyme ne voit rien, nulle part.
set local role anon;
select pg_temp.connecte(null);
do $$
begin
  perform pg_temp.noter('MEAL-A7', 'un anonyme ne lit ni le catalogue, ni les alias, ni les entrées',
    pg_temp.compte($q$ select count(*)::int from public.food_catalog $q$) = -1
    and pg_temp.compte($q$ select count(*)::int from public.food_aliases $q$) = -1
    and pg_temp.compte($q$ select count(*)::int from public.meal_entries $q$) = -1);
end $$;
reset role;

-- ---------------------------------------------------------------------
-- MEAL-A8 à MEAL-A12 — corriger une saisie, sans jamais suivre la source
-- ---------------------------------------------------------------------
-- La règle produit : « 120 g au lieu de 150 g » se répare par un UPDATE, pas
-- par une suppression suivie d'une nouvelle recherche. Ce que le schéma doit
-- garantir, c'est que cette correction est POSSIBLE pour le propriétaire,
-- IMPOSSIBLE pour les autres, et qu'elle n'est jamais déclenchée par un
-- changement du référentiel.

-- Un aliment neuf et une entrée neuve, pour ne rien devoir aux sections
-- précédentes (le catalogue y a été supprimé volontairement).
insert into public.food_catalog (id, name, protein_per_100, carb_per_100, fat_per_100)
values ('f0000000-0000-4000-8000-0000000000c1', 'Banane', 1.1, 23, 0.3);

insert into public.meal_entries
  (id, student_id, consumed_meal_id, source_type, food_id,
   label, quantity, unit, protein_g, carb_g, fat_g, created_at, updated_at)
values ('e0000000-0000-4000-8000-0000000000c1', '50000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-0000000000a1', 'catalog_food', 'f0000000-0000-4000-8000-0000000000c1',
        'Banane', 120, 'g', 1.32, 27.6, 0.36,
        now() - interval '2 days', now() - interval '2 days');

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');  -- élève A

do $$
declare v_avant timestamptz;
        v_cree  timestamptz;
begin
  select updated_at, created_at into v_avant, v_cree
    from public.meal_entries where id = 'e0000000-0000-4000-8000-0000000000c1';

  -- ── MEAL-A8 ────────────────────────────────────────────────────────
  -- L'élève corrige 120 g → 150 g. En A1, l'application recalculait les
  -- macros depuis food_catalog puis écrivait le couple quantité + macros en
  -- une instruction. En A2, c'est le SERVEUR qui recharge food_catalog et
  -- recalcule : le client n'envoie que la quantité et l'unité, et il ne
  -- pourrait pas envoyer autre chose — le privilège d'écriture directe lui a
  -- été retiré (MEAL-A6).
  --
  -- L'intention du contrôle est intacte : « corriger sa saisie est possible,
  -- et le résultat est un instantané neuf, cohérent ». Les valeurs attendues
  -- sont les mêmes qu'en A1, puisque l'aliment est le même : 1,1 / 23 / 0,3
  -- pour 100 g, appliqués à 150 g.
  perform pg_temp.noter('MEAL-A8', 'l''élève corrige la quantité de SA propre entrée', pg_temp.accepte($q$
    select public.modifier_quantite_entree('e0000000-0000-4000-8000-0000000000c1', 150, 'g') $q$));

  perform pg_temp.noter('MEAL-A8', 'le SERVEUR a recalculé les macros, le client ne les a jamais dictées',
    (select quantity = 150 and protein_g = 1.65 and carb_g = 34.5 and fat_g = 0.45
       from public.meal_entries where id = 'e0000000-0000-4000-8000-0000000000c1'));

  -- Le libellé d'un aliment du catalogue n'est PLUS corrigible par l'élève :
  -- il fait partie de l'instantané que le serveur calcule, et la RPC le
  -- réécrit depuis food_catalog. C'est un durcissement voulu par A2 — un
  -- libellé libre permettrait de faire passer n'importe quoi pour autre chose.
  perform pg_temp.noter('MEAL-A8', 'le libellé suit le catalogue, il n''est pas dicté par le client',
    (select label from public.meal_entries
      where id = 'e0000000-0000-4000-8000-0000000000c1') = 'Banane');

  -- Les contraintes de A1 tiennent toujours : c'est la RPC qui les rencontre
  -- désormais, et elle refuse AVANT d'écrire.
  perform pg_temp.noter('MEAL-A8', 'les contraintes tiennent toujours pendant une correction',
    pg_temp.refuse($q$ select public.modifier_quantite_entree(
      'e0000000-0000-4000-8000-0000000000c1', 0, 'g') $q$)
    and pg_temp.refuse($q$ select public.modifier_quantite_entree(
      'e0000000-0000-4000-8000-0000000000c1', -5, 'g') $q$)
    and pg_temp.refuse($q$ select public.modifier_quantite_entree(
      'e0000000-0000-4000-8000-0000000000c1', 150, 'poignee') $q$));

  -- Sortir d'un état cohérent n'est même plus exprimable : aucune RPC ne
  -- prend `source_type` en paramètre, et l'UPDATE direct est fermé.
  perform pg_temp.noter('MEAL-A8', 'une correction ne peut pas produire un état impossible',
    pg_temp.refuse($q$
      update public.meal_entries set source_type = 'free'
       where id = 'e0000000-0000-4000-8000-0000000000c1' $q$)
    and not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('modifier_quantite_entree', 'ajouter_aliment_catalogue',
                           'ajouter_aliment_manuel')
         and pg_get_function_arguments(p.oid) ~ 'source_type'));

  -- ── MEAL-A11 ───────────────────────────────────────────────────────
  perform pg_temp.noter('MEAL-A11', 'le nouvel instantané a bien REMPLACÉ l''ancien',
    (select quantity = 150 and protein_g = 1.65 and carb_g = 34.5 and fat_g = 0.45
       from public.meal_entries where id = 'e0000000-0000-4000-8000-0000000000c1'));

  perform pg_temp.noter('MEAL-A11', 'le rattachement à la source est conservé',
    (select food_id = 'f0000000-0000-4000-8000-0000000000c1' and source_type = 'catalog_food'
       from public.meal_entries where id = 'e0000000-0000-4000-8000-0000000000c1'));

  -- Atomicité : quantité et macros voyagent dans la MÊME instruction, à
  -- l'intérieur de la RPC. Si l'une échoue, aucune ne passe — sinon un
  -- instantané mi-ancien mi-neuf pourrait exister, ce qui est pire qu'un refus.
  perform pg_temp.noter('MEAL-A11', 'une correction refusée n''écrit RIEN',
    pg_temp.refuse($q$ select public.modifier_quantite_entree(
      'e0000000-0000-4000-8000-0000000000c1', 200, 'litre') $q$)
    and (select quantity = 150 and protein_g = 1.65 from public.meal_entries
          where id = 'e0000000-0000-4000-8000-0000000000c1'));

  -- ── MEAL-A12 ───────────────────────────────────────────────────────
  perform pg_temp.noter('MEAL-A12', 'updated_at a bougé à la correction',
    (select updated_at from public.meal_entries
      where id = 'e0000000-0000-4000-8000-0000000000c1') > v_avant);

  perform pg_temp.noter('MEAL-A12', 'created_at n''a PAS bougé',
    (select created_at from public.meal_entries
      where id = 'e0000000-0000-4000-8000-0000000000c1') = v_cree);
end $$;

reset role;

-- ── MEAL-A9 : l'élève B tente de corriger l'entrée de l'élève A ──────────
set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000005');  -- élève B
do $$
begin
  perform pg_temp.noter('MEAL-A9', 'l''élève B ne voit pas l''entrée de l''élève A',
    pg_temp.compte($q$ select count(*)::int from public.meal_entries
                        where id = 'e0000000-0000-4000-8000-0000000000c1' $q$) = 0);

  perform pg_temp.noter('MEAL-A9', 'l''élève B ne corrige AUCUNE ligne de l''élève A',
    pg_temp.refuse($q$ select public.modifier_quantite_entree(
      'e0000000-0000-4000-8000-0000000000c1', 999, 'g') $q$)
    and pg_temp.refuse($q$ update public.meal_entries set quantity = 999
                            where id = 'e0000000-0000-4000-8000-0000000000c1' $q$));

  -- Le cas sournois : déplacer une entrée vers soi. Deux barrages désormais.
  -- L'UPDATE direct n'a plus de privilège ; et même s'il en retrouvait un, la
  -- clé étrangère composite (consumed_meal_id, student_id) refuserait une
  -- ligne dont l'élève ne correspond plus au conteneur.
  perform pg_temp.noter('MEAL-A9', 'l''élève B ne peut pas s''approprier une entrée',
    pg_temp.refuse($q$
      update public.meal_entries set student_id = '50000000-0000-4000-8000-00000000000b'
       where id = 'e0000000-0000-4000-8000-0000000000c1' $q$)
    and exists (select 1 from pg_constraint
                 where conrelid = 'public.meal_entries'::regclass
                   and conname = 'meal_entries_consumed_meal_same_student'
                   and contype = 'f' and cardinality(conkey) = 2));
end $$;
reset role;

-- Un coach ne corrige pas davantage : il lit, point.
set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000002');  -- coach A
do $$
begin
  perform pg_temp.noter('MEAL-A9', 'le coach de l''élève A la LIT mais ne la corrige pas',
    pg_temp.compte($q$ select count(*)::int from public.meal_entries
                        where id = 'e0000000-0000-4000-8000-0000000000c1' $q$) = 1
    and pg_temp.refuse($q$ update public.meal_entries set quantity = 999
                            where id = 'e0000000-0000-4000-8000-0000000000c1' $q$)
    and pg_temp.refuse($q$ select public.modifier_quantite_entree(
      'e0000000-0000-4000-8000-0000000000c1', 999, 'g') $q$));
end $$;
reset role;

do $$
begin
  perform pg_temp.noter('MEAL-A9', 'après toutes les tentatives, la ligne appartient toujours à l''élève A',
    (select student_id = '50000000-0000-4000-8000-00000000000a' and quantity = 150
       from public.meal_entries where id = 'e0000000-0000-4000-8000-0000000000c1'));
end $$;

-- ── MEAL-A10 : le référentiel bouge, l'entrée ne bouge pas ───────────────
do $$
declare v_avant text;
        v_horodatage timestamptz;
begin
  select label || '|' || quantity || '|' || protein_g || '|' || carb_g || '|' || fat_g,
         updated_at
    into v_avant, v_horodatage
    from public.meal_entries where id = 'e0000000-0000-4000-8000-0000000000c1';

  -- Correction complète de l'aliment : macros, nom (donc slug), unité, statut.
  update public.food_catalog
     set protein_per_100 = 88, carb_per_100 = 77, fat_per_100 = 66,
         name = 'Banane corrigee', nutrition_unit = 'ml', status = 'archived'
   where id = 'f0000000-0000-4000-8000-0000000000c1';

  perform pg_temp.noter('MEAL-A10', 'corriger l''aliment ne touche AUCUNE colonne de l''entrée',
    (select label || '|' || quantity || '|' || protein_g || '|' || carb_g || '|' || fat_g
       from public.meal_entries where id = 'e0000000-0000-4000-8000-0000000000c1') = v_avant);

  perform pg_temp.noter('MEAL-A10', 'corriger l''aliment ne touche même pas updated_at de l''entrée',
    (select updated_at from public.meal_entries
      where id = 'e0000000-0000-4000-8000-0000000000c1') = v_horodatage);

  -- Et rien dans le schéma ne pourrait le faire : aucun trigger sur
  -- food_catalog ne cite meal_entries, aucune vue ne recalcule à la lecture.
  perform pg_temp.noter('MEAL-A10', 'aucun trigger de food_catalog ne touche meal_entries',
    not exists (
      select 1 from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.food_catalog'::regclass
         and not t.tgisinternal
         and coalesce(p.prosrc, '') ~ 'meal_entries'));

  -- La suppression de l'aliment : le pointeur tombe, l'instantané reste.
  delete from public.food_catalog where id = 'f0000000-0000-4000-8000-0000000000c1';

  perform pg_temp.noter('MEAL-A10', 'supprimer l''aliment laisse l''instantané intact, pointeur à NULL',
    (select food_id is null
       from public.meal_entries where id = 'e0000000-0000-4000-8000-0000000000c1')
    and (select label || '|' || quantity || '|' || protein_g || '|' || carb_g || '|' || fat_g
           from public.meal_entries where id = 'e0000000-0000-4000-8000-0000000000c1') = v_avant);
end $$;

-- ---------------------------------------------------------------------
-- RECIPE-A1 — nutrition_recipe_ingredients strictement inchangée
-- ---------------------------------------------------------------------
do $$
declare v_attendues text[] := array[
  'id','recipe_id','position','name','role',
  'protein_per_100g','carb_per_100g','fat_per_100g',
  'reference_grams','min_grams','max_grams',
  'unit_scalable','max_units','unit_name','fixed_label',
  'egg','egg_grams','linked_to_ingredient_id','link_ratio_bp',
  'created_at','updated_at'];
  v_reelles text[];
begin
  select array_agg(column_name order by ordinal_position) into v_reelles
    from information_schema.columns
   where table_schema = 'public' and table_name = 'nutrition_recipe_ingredients';

  perform pg_temp.noter('RECIPE-A1', 'les 21 colonnes sont exactement celles d''avant A1',
    v_reelles = v_attendues);

  perform pg_temp.noter('RECIPE-A1', 'AUCUNE colonne food_id, product_id ou catalog_id',
    not exists (select 1 from unnest(v_reelles) c
                 where c in ('food_id', 'product_id', 'catalog_id')));

  perform pg_temp.noter('RECIPE-A1', 'AUCUNE clé étrangère vers food_catalog',
    not exists (
      select 1 from pg_constraint
       where conrelid = 'public.nutrition_recipe_ingredients'::regclass
         and contype = 'f'
         and confrelid = 'public.food_catalog'::regclass));
end $$;

-- ---------------------------------------------------------------------
-- RECIPE-A2 — le monde des recettes ignore food_catalog
-- ---------------------------------------------------------------------
do $$
declare v_fonctions text[];
begin
  -- Aucune fonction du schéma public ne mentionne food_catalog, hormis celles
  -- posées par A1 et A2 elles-mêmes. La liste est ÉNUMÉRÉE plutôt que filtrée
  -- par préfixe : une nouvelle fonction qui se mettrait à lire le catalogue
  -- doit faire rougir ce contrôle, et non se glisser dans une exception large.
  --
  -- A2 y ajoute exactement deux lectrices, et ce sont les deux qui calculent
  -- l'instantané côté serveur — c'est leur raison d'être.
  select coalesce(array_agg(p.proname order by p.proname), '{}') into v_fonctions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     -- ⚠️ ON CHERCHE DU CODE, PAS DE LA PROSE. `prosrc` contient aussi les
     -- COMMENTAIRES de la fonction : depuis N1.5.1, `save_nutrition_plan_v2`
     -- EXPLIQUE qu'elle ne lit ni `food_catalog` ni `food_products` pour
     -- résoudre une portion — et cette phrase-là faisait rougir le contrôle.
     -- Retirer les commentaires rend l'assertion plus forte, pas plus large :
     -- elle mesure désormais de vraies lectures.
     and regexp_replace(coalesce(p.prosrc, ''), '--[^\n]*', ' ', 'g') ~ 'food_catalog'
     -- ⚠️ LISTE BLANCHE, ET ELLE S'ÉTEND PAR DÉCISION, JAMAIS PAR COMMODITÉ.
     --
     -- `enregistrer_repas_planifie` (N1.1) y entre pour la MÊME raison
     -- qu'`ajouter_aliment_catalogue` : elle lit `food_catalog` afin de valider
     -- que l'unité demandée est convertible pour cet aliment — la pièce n'est
     -- acceptée que si `piece_weight_g` est renseigné. Sans cette lecture, une
     -- quantité serait planifiable en pièces puis refusée au moment de la
     -- consommation, c'est-à-dire trop tard.
     --
     -- Ce que ce contrôle garde reste intact : AUCUNE fonction du monde des
     -- RECETTES ne lit `food_catalog`, et l'assertion suivante le vérifie
     -- nommément sur les quatre RPC de recettes.
     and p.proname not in ('food_slug', 'is_coach_of_student', 'meal_entries_freeze_snapshot',
                           'ajouter_aliment_catalogue', 'modifier_quantite_entree',
                           'enregistrer_repas_planifie');

  perform pg_temp.noter('RECIPE-A2', 'aucune fonction existante ne s''est mise à lire food_catalog',
    v_fonctions = '{}'::text[]);

  perform pg_temp.noter('RECIPE-A2', 'les deux lectrices de A2 sont bien là, et ce sont les seules ajoutées',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and coalesce(p.prosrc, '') ~ 'food_catalog'
        and p.proname in ('ajouter_aliment_catalogue', 'modifier_quantite_entree')) = 2);

  perform pg_temp.noter('RECIPE-A2', 'les RPC de recettes n''ont pas été retouchées par A1',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('save_nutrition_recipe', 'duplicate_nutrition_recipe',
                          'import_nutrition_recipes', 'delete_nutrition_recipe')
        and coalesce(p.prosrc, '') ~ '(food_catalog|food_id|meal_entries)') = 0);

  -- Le seul lien nouveau vers le monde recettes est meal_entries.recipe_id,
  -- et il est en `set null` : l'historique survit à la suppression.
  perform pg_temp.noter('RECIPE-A2', 'meal_entries.recipe_id est la seule nouvelle référence, en ON DELETE SET NULL',
    (select confdeltype from pg_constraint
      where conrelid = 'public.meal_entries'::regclass
        and contype = 'f'
        and confrelid = 'public.nutrition_recipes'::regclass) = 'n');

  perform pg_temp.noter('RECIPE-A2', 'nutrition_daily_logs n''a été touchée ni en colonnes ni en policies',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'nutrition_daily_logs') = 11
    and (select count(*) from pg_policies
          where schemaname = 'public' and tablename = 'nutrition_daily_logs') = 1);
end $$;

-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_ko int;
begin
  select count(*), count(*) filter (where ok is not true) into v_total, v_ko from _faits;
  raise notice '────────────────────────────────────────────────';
  raise notice 'ALIMENTS A1 — % contrôles, % échec(s)', v_total, v_ko;
  raise notice '────────────────────────────────────────────────';
  if v_ko > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_ko, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

-- ---------------------------------------------------------------------
-- Section Z — après le ROLLBACK, rien ne subsiste
-- ---------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.food_catalog) <> 0
  or (select count(*) from public.food_aliases) <> 0
  or (select count(*) from public.meal_entries) <> 0
  or exists (select 1 from public.students where id = '50000000-0000-4000-8000-00000000000a')
  or exists (select 1 from public.coaches  where id = 'c0000000-0000-4000-8000-00000000000a')
  or exists (select 1 from auth.users      where id = 'a0000000-0000-4000-8000-000000000001')
  then
    raise exception 'Z — des données de test ont survécu au ROLLBACK';
  end if;
  raise notice 'OK      — Z · aucune donnée de test ne subsiste après le ROLLBACK';
end $$;
