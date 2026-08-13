-- ============================================================================
-- Checklist PostgreSQL — ALIMENTS A3 PHASE 3, PRODUITS COMMERCIAUX
-- Migrations couvertes :
--   20260903090000_food_products.sql          (table, product_id, RLS)
--   20260903090100_ajouter_aliment_produit.sql (RPC, correction de quantité)
--
-- CE QU'ELLE VÉRIFIE — la numérotation est celle du contrat produit.
--   A3-PROD1   la table existe, et un GTIN y est une CHAÎNE, pas un nombre
--   A3-PROD2   les zéros de tête survivent : '0000000000017' ≠ 17
--   A3-PROD3   la forme du code-barres est contrainte (8, 12, 13 ou 14 chiffres)
--   A3-PROD4   une macro absente n'entre pas ; 0 explicite est valide ;
--              une macro négative est refusée
--   A3-PROD5   AUCUNE colonne de calories : les kcal restent dérivées 4/4/9
--   A3-PROD6   un second scan MET À JOUR la ligne — même id, pas de doublon
--   A3-PROD7   `authenticated` LIT le cache et ne l'écrit JAMAIS
--   A3-PROD8   meal_entries.product_id : cohérent avec source_type, et jamais
--              deux provenances à la fois
--   A3-PROD9   la RPC calcule l'instantané : le client n'envoie ni student_id
--              ni macro
--   A3-PROD10  la RPC refuse un repas étranger et un produit inexistant
--   A3-PROD11  PURGER le cache ne touche AUCUN instantané historique
--   A3-PROD12  corriger une quantité RECHARGE le produit et réécrit
--              l'instantané depuis la source ACTUELLE
--   A3-PROD-SUP  la pièce = le conditionnement, et seulement s'il est en
--              grammes ; aucune conversion ml → g nulle part
--   Z          après le ROLLBACK, aucune donnée de test ne subsiste
--
-- A3-OFF1..16 portent sur la couche serveur TypeScript (lecture d'une réponse
-- Open Food Facts, erreurs métier, TTL, contrat périmé) : ils sont éprouvés
-- par scripts/tests/aliments-a3-off.mts, sur fixtures, sans réseau.
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

-- NULL est rangé comme un ÉCHEC : `accepte(sql) and (select …)` rend NULL
-- quand la sous-requête ne voit rien, et `count(*) filter (where not ok)` ne
-- compterait pas ce NULL — le contrôle disparaîtrait du total sans avoir été
-- vérifié. Mesuré sur A1, pas supposé.
create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, coalesce(p_ok, false));
  if p_ok is null then
    raise warning 'INDÉTERMINÉ — % · % (contrôle mal formé : traité comme un échec)', p_section, p_libelle;
  elsif p_ok then raise notice 'OK      — % · %', p_section, p_libelle;
  else raise warning 'ÉCHEC   — % · %', p_section, p_libelle; end if;
end $$;

create or replace function pg_temp.refuse(p_sql text)
returns boolean language plpgsql as $$
begin execute p_sql; return false;
exception when others then return true; end $$;

create or replace function pg_temp.accepte(p_sql text)
returns boolean language plpgsql as $$
begin execute p_sql; return true;
exception when others then return false; end $$;

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
-- Section 0 — le banc : deux élèves, deux coachs, trois produits
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('b0000000-0000-4000-8000-000000000004', 'eleve-p@test.invalid'),
  ('b0000000-0000-4000-8000-000000000005', 'eleve-q@test.invalid'),
  ('b0000000-0000-4000-8000-000000000002', 'coach-p@test.invalid');
insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('b0000000-0000-4000-8000-000000000004', 'student', 'El', 'EveP', 'eleve-p@test.invalid'),
  ('b0000000-0000-4000-8000-000000000005', 'student', 'El', 'EveQ', 'eleve-q@test.invalid'),
  ('b0000000-0000-4000-8000-000000000002', 'coach',   'Co', 'AchP', 'coach-p@test.invalid');
insert into public.coaches (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-000000000002', 'Coach P', 'coach-p@test.invalid');
insert into public.students (id, user_id, coach_id, first_name, last_name, email, status) values
  ('60000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-000000000004',
   'c0000000-0000-4000-8000-00000000000b', 'Eleve', 'P', 'eleve-p@test.invalid', 'active'),
  ('60000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-000000000005',
   'c0000000-0000-4000-8000-00000000000b', 'Eleve', 'Q', 'eleve-q@test.invalid', 'active');

-- Trois fiches produit, écrites en `postgres` — c'est-à-dire par le chemin
-- serveur, exactement comme la route de lookup le fera.
--
--   solide  : nutrition en g, conditionnement 400 g       → la pièce existe
--   liquide : nutrition en ml, conditionnement 1000 ml    → la pièce N'EXISTE PAS
--   zero    : 0 g de lipides DÉCLARÉ — une valeur, pas une absence
insert into public.food_products
  (id, gtin, brand, product_name, net_quantity, net_unit, nutrition_unit,
   protein_per_100, carb_per_100, fat_per_100, source, source_version, source_fetched_at)
values
  ('70000000-0000-4000-8000-000000000001', '3017620422003', 'Ferrero', 'Pate a tartiner',
   400, 'g', 'g', 6.3, 57.5, 30.9, 'open_food_facts', 'v3.4', now()),
  ('70000000-0000-4000-8000-000000000002', '5449000000996', 'Marque L', 'Boisson gazeuse',
   1000, 'ml', 'ml', 0, 10.6, 0, 'open_food_facts', 'v3.4', now()),
  ('70000000-0000-4000-8000-000000000003', '0000000000017', null, 'Produit a zeros de tete',
   null, null, 'g', 12, 0, 0, 'open_food_facts', 'v3.4', now());

do $$
begin
  perform pg_temp.noter('0', 'le banc compte trois produits',
    (select count(*) from public.food_products) = 3);
end $$;

-- ---------------------------------------------------------------------
-- A3-PROD1 — le GTIN est une CHAÎNE
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('A3-PROD1', 'food_products.gtin est de type text',
    (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'food_products' and column_name = 'gtin') = 'text');

  -- Un `bigint` aurait suffi à stocker 3017620422003 : c'est précisément ce
  -- qui rend l'erreur facile à commettre, et invisible jusqu'au premier
  -- produit à zéros de tête.
  perform pg_temp.noter('A3-PROD1', 'aucune colonne numérique ne prétend porter le code-barres',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'food_products'
        and column_name like '%gtin%' and data_type <> 'text') = 0);

  perform pg_temp.noter('A3-PROD1', 'un GTIN est unique : le même code deux fois est refusé',
    pg_temp.refuse($q$
      insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, source_version)
      values ('3017620422003', 'Doublon', 'g', 1, 1, 1, 'v3.4') $q$));
end $$;

-- ---------------------------------------------------------------------
-- A3-PROD2 — LES ZÉROS DE TÊTE SURVIVENT
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('A3-PROD2', 'un GTIN à zéros de tête est rendu caractère pour caractère',
    (select gtin from public.food_products
      where id = '70000000-0000-4000-8000-000000000003') = '0000000000017');

  perform pg_temp.noter('A3-PROD2', 'et il ne vaut PAS 17 : la recherche par le nombre ne le trouve pas',
    (select count(*) from public.food_products where gtin = '17') = 0
    and (select count(*) from public.food_products where gtin = '0000000000017') = 1);

  -- Le contrôle DISCRIMINANT : si la colonne était numérique, ces deux codes
  -- seraient le même. Ils doivent cohabiter.
  perform pg_temp.noter('A3-PROD2', '00000000000017 et 0000000000017 sont deux produits différents',
    pg_temp.accepte($q$
      insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, source_version)
      values ('00000000000017', 'Homonyme numerique', 'g', 1, 1, 1, 'v3.4') $q$));
end $$;

do $$
begin
  perform pg_temp.noter('A3-PROD2', 'les deux coexistent en base',
    (select count(*) from public.food_products where gtin in ('0000000000017', '00000000000017')) = 2);
end $$;

-- ---------------------------------------------------------------------
-- A3-PROD3 — LA FORME DU CODE-BARRES
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('A3-PROD3', 'un code de 5 chiffres est refusé',
    pg_temp.refuse($q$
      insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, source_version)
      values ('12345', 'Trop court', 'g', 1, 1, 1, 'v3.4') $q$));

  perform pg_temp.noter('A3-PROD3', 'un code contenant une lettre est refusé',
    pg_temp.refuse($q$
      insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, source_version)
      values ('301762042200X', 'Lettre', 'g', 1, 1, 1, 'v3.4') $q$));

  perform pg_temp.noter('A3-PROD3', 'un code de 9, 10 ou 11 chiffres est refusé',
    pg_temp.refuse($q$ insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, source_version)
      values ('123456789', 'Neuf', 'g', 1, 1, 1, 'v3.4') $q$)
    and pg_temp.refuse($q$ insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, source_version)
      values ('12345678901', 'Onze', 'g', 1, 1, 1, 'v3.4') $q$));

  -- Les quatre longueurs légitimes passent, y compris GTIN-14.
  perform pg_temp.noter('A3-PROD3', 'GTIN-8, GTIN-12 et GTIN-14 sont acceptés',
    pg_temp.accepte($q$ insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, source_version)
      values ('20000015', 'Huit', 'g', 1, 1, 1, 'v3.4'),
             ('012345678905', 'Douze', 'g', 1, 1, 1, 'v3.4'),
             ('10012345678902', 'Quatorze', 'g', 1, 1, 1, 'v3.4') $q$));

  -- Un produit dont la clé de contrôle est FAUSSE reste acceptable : elle
  -- n'est délibérément pas vérifiée, parce qu'OFF héberge de vrais produits
  -- dans ce cas et que les refuser rendrait un produit réel inajoutable.
  perform pg_temp.noter('A3-PROD3', 'la clé de contrôle n''est pas exigée (choix documenté)',
    pg_temp.accepte($q$ insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, source_version)
      values ('3017620422000', 'Cle de controle fausse', 'g', 1, 1, 1, 'v3.4') $q$));
end $$;

-- ---------------------------------------------------------------------
-- A3-PROD4 — ABSENT ≠ ZÉRO
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('A3-PROD4', 'une macro absente ne peut pas entrer en base',
    pg_temp.refuse($q$ insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, source_version)
      values ('40000000000009', 'Sans lipides', 'g', 1, 1, 'v3.4') $q$)
    and pg_temp.refuse($q$ insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, source_version)
      values ('40000000000009', 'Lipides NULL', 'g', 1, 1, null, 'v3.4') $q$));

  -- Et le corollaire, qui est le vrai enjeu : un ZÉRO DÉCLARÉ est une valeur.
  -- Confondre les deux ferait de « on ne sait pas » un « il n'y en a pas ».
  perform pg_temp.noter('A3-PROD4', 'un 0 explicite est parfaitement valide et conservé',
    (select fat_per_100 = 0 and protein_per_100 = 12
       from public.food_products where gtin = '0000000000017'));

  perform pg_temp.noter('A3-PROD4', 'une macro négative est refusée',
    pg_temp.refuse($q$ insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, source_version)
      values ('40000000000009', 'Negatif', 'g', -1, 1, 1, 'v3.4') $q$));

  perform pg_temp.noter('A3-PROD4', 'une quantité nette sans unité, ou nulle, est refusée',
    pg_temp.refuse($q$ insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, net_quantity, source_version)
      values ('40000000000009', 'Quantite orpheline', 'g', 1, 1, 1, 400, 'v3.4') $q$)
    and pg_temp.refuse($q$ insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, net_quantity, net_unit, source_version)
      values ('40000000000009', 'Pot de zero gramme', 'g', 1, 1, 1, 0, 'g', 'v3.4') $q$));

  perform pg_temp.noter('A3-PROD4', 'un produit Open Food Facts sans version d''API est refusé',
    pg_temp.refuse($q$ insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, source)
      values ('40000000000009', 'Sans version', 'g', 1, 1, 1, 'open_food_facts') $q$));
end $$;

-- ---------------------------------------------------------------------
-- A3-PROD5 — AUCUNE CALORIE STOCKÉE
-- ---------------------------------------------------------------------
do $$
begin
  -- La règle SETH : les kcal sont 4×P + 4×G + 9×L, dérivées à la lecture. Une
  -- colonne d'énergie serait une seconde autorité, et deux autorités sur la
  -- même grandeur finissent toujours par se contredire.
  perform pg_temp.noter('A3-PROD5', 'food_products ne porte aucune colonne d''énergie',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'food_products'
        and (column_name like '%kcal%' or column_name like '%calor%'
             or column_name like '%energ%')) = 0);

  perform pg_temp.noter('A3-PROD5', 'meal_entries non plus, après l''ajout de product_id',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'meal_entries'
        and (column_name like '%kcal%' or column_name like '%calor%'
             or column_name like '%energ%')) = 0);
end $$;

-- ---------------------------------------------------------------------
-- A3-PROD6 — UN SECOND SCAN MET À JOUR, IL NE DUPLIQUE PAS
-- ---------------------------------------------------------------------
do $$
declare v_id_avant uuid; v_id_apres uuid;
begin
  select id into v_id_avant from public.food_products where gtin = '3017620422003';

  -- Exactement l'upsert de la couche serveur : `on conflict (gtin)`.
  insert into public.food_products
    (gtin, brand, product_name, net_quantity, net_unit, nutrition_unit,
     protein_per_100, carb_per_100, fat_per_100, source, source_version, source_fetched_at)
  values ('3017620422003', 'Ferrero', 'Pate a tartiner (recette 2027)',
          400, 'g', 'g', 7.1, 56.0, 30.0, 'open_food_facts', 'v3.4', now())
  on conflict (gtin) do update
    set brand = excluded.brand, product_name = excluded.product_name,
        net_quantity = excluded.net_quantity, net_unit = excluded.net_unit,
        nutrition_unit = excluded.nutrition_unit,
        protein_per_100 = excluded.protein_per_100,
        carb_per_100 = excluded.carb_per_100,
        fat_per_100 = excluded.fat_per_100,
        source_version = excluded.source_version,
        source_fetched_at = excluded.source_fetched_at;

  select id into v_id_apres from public.food_products where gtin = '3017620422003';

  perform pg_temp.noter('A3-PROD6', 'un second scan ne crée PAS de seconde ligne',
    (select count(*) from public.food_products where gtin = '3017620422003') = 1);

  -- Le point qui compte vraiment : l'identifiant est CONSERVÉ. Des
  -- meal_entries pointent dessus ; en créer un nouveau les orphelinerait.
  perform pg_temp.noter('A3-PROD6', 'et il conserve le MÊME identifiant',
    v_id_apres = v_id_avant);

  perform pg_temp.noter('A3-PROD6', 'les teneurs et le nom ont bien été rafraîchis',
    (select protein_per_100 = 7.1 and product_name = 'Pate a tartiner (recette 2027)'
       from public.food_products where gtin = '3017620422003'));
end $$;

-- Retour à la recette d'origine pour la suite de la checklist.
update public.food_products
   set product_name = 'Pate a tartiner', protein_per_100 = 6.3,
       carb_per_100 = 57.5, fat_per_100 = 30.9
 where gtin = '3017620422003';

-- ---------------------------------------------------------------------
-- A3-PROD7 — L'ÉLÈVE LIT LE CACHE, ET NE L'ÉCRIT JAMAIS
-- ---------------------------------------------------------------------
-- ⚠️ DEUX REMPARTS, ET IL FAUT LES MESURER SÉPARÉMENT.
--
-- Mesuré en écrivant cette checklist : rendre `insert` à `authenticated` ne
-- suffisait PAS à faire passer l'insertion — la RLS la refusait encore, faute
-- de policy `for insert`. Autrement dit, le contrôle de comportement ci-dessous
-- restait vert alors même que le privilège avait été rendu : il prouvait la
-- policy, pas le retrait.
--
-- Or c'est le PRIVILÈGE qui est la garantie structurelle du lot : une policy
-- dit quelles LIGNES, jamais quelles VALEURS, et il suffirait d'une future
-- policy « for all » écrite trop large pour que tout retombe. On mesure donc
-- le catalogue de privilèges directement, en plus du comportement.
do $$
begin
  perform pg_temp.noter('A3-PROD7', 'le privilège SELECT est accordé à authenticated',
    has_table_privilege('authenticated', 'public.food_products', 'select'));

  perform pg_temp.noter('A3-PROD7', 'les privilèges INSERT, UPDATE et DELETE ne le sont PAS',
    not has_table_privilege('authenticated', 'public.food_products', 'insert')
    and not has_table_privilege('authenticated', 'public.food_products', 'update')
    and not has_table_privilege('authenticated', 'public.food_products', 'delete'));

  perform pg_temp.noter('A3-PROD7', 'anon n''a aucun privilège, pas même la lecture',
    not has_table_privilege('anon', 'public.food_products', 'select')
    and not has_table_privilege('anon', 'public.food_products', 'insert'));

  -- Et la RLS est bien active : sans elle, les policies ne s'appliqueraient
  -- pas du tout, et le second rempart n'existerait pas.
  perform pg_temp.noter('A3-PROD7', 'la RLS est activée sur food_products',
    (select relrowsecurity from pg_class where oid = 'public.food_products'::regclass));

  -- Aucune policy d'écriture n'existe : la seule policy est une lecture.
  perform pg_temp.noter('A3-PROD7', 'aucune policy d''écriture n''existe sur food_products',
    (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'food_products'
        and cmd <> 'SELECT') = 0);
end $$;

set local role authenticated;
select pg_temp.connecte('b0000000-0000-4000-8000-000000000004');

do $$
begin
  perform pg_temp.noter('A3-PROD7', 'un élève authentifié LIT le catalogue produits',
    pg_temp.compte($q$ select count(*)::int from public.food_products $q$) >= 3);

  -- Le cœur de la migration. Une policy dit quelles LIGNES ; seul le retrait
  -- du PRIVILÈGE dit quelles VALEURS. Sans ce retrait, un navigateur pourrait
  -- fabriquer un « produit » à 0,1 g de lipides et le consommer ensuite par la
  -- RPC — qui aurait calculé un instantané rigoureusement exact à partir d'une
  -- source inventée par le client.
  perform pg_temp.noter('A3-PROD7', 'il ne peut PAS insérer un produit',
    pg_temp.refuse($q$ insert into public.food_products (gtin, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, source_version)
      values ('99000000000000', 'Produit fabrique par le client', 'g', 0, 0, 0.1, 'v3.4') $q$));

  perform pg_temp.noter('A3-PROD7', 'il ne peut PAS modifier un produit',
    pg_temp.compte($q$ with maj as (
        update public.food_products set fat_per_100 = 0
         where gtin = '3017620422003' returning 1)
      select count(*)::int from maj $q$) <= 0);

  perform pg_temp.noter('A3-PROD7', 'il ne peut PAS supprimer un produit',
    pg_temp.compte($q$ with sup as (
        delete from public.food_products where gtin = '3017620422003' returning 1)
      select count(*)::int from sup $q$) <= 0);
end $$;
reset role;

do $$
begin
  perform pg_temp.noter('A3-PROD7', 'et la fiche est intacte après ces tentatives',
    (select fat_per_100 = 30.9 from public.food_products where gtin = '3017620422003'));
end $$;

-- ---------------------------------------------------------------------
-- A3-PROD8 — LE POINTEUR DE PROVENANCE
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('b0000000-0000-4000-8000-000000000004');

do $$
declare v_repas uuid; v_entree uuid;
begin
  v_repas := public.creer_repas_eleve(date '2026-08-13', 'Gouter');
  v_entree := public.ajouter_aliment_produit(
    v_repas, '70000000-0000-4000-8000-000000000001', 30, 'g');

  perform pg_temp.noter('A3-PROD8', 'une entrée produit porte source_type = product et product_id',
    (select source_type = 'product' and product_id = '70000000-0000-4000-8000-000000000001'
       from public.meal_entries where id = v_entree));

  -- Le pointeur d'aliment générique reste NULL : un produit n'est pas un
  -- catalog_food, et la contrainte d'A1 l'interdirait de toute façon.
  perform pg_temp.noter('A3-PROD8', 'et food_id reste NULL',
    (select food_id is null and recipe_id is null
       from public.meal_entries where id = v_entree));
end $$;
reset role;

do $$
declare v_repas uuid; v_food uuid;
begin
  select id into v_repas from public.consumed_meals
   where student_id = '60000000-0000-4000-8000-00000000000a' limit 1;
  select id into v_food from public.food_catalog where source = 'ciqual' limit 1;

  perform pg_temp.noter('A3-PROD8', 'un product_id sur une entrée qui n''est pas un produit est refusé',
    pg_temp.refuse(format($q$
      insert into public.meal_entries (student_id, consumed_meal_id, source_type,
        product_id, label, quantity, unit, protein_g, carb_g, fat_g)
      values ('60000000-0000-4000-8000-00000000000a', %L, 'free',
              '70000000-0000-4000-8000-000000000001', 'Incoherent', 100, 'g', 1, 1, 1) $q$, v_repas)));

  perform pg_temp.noter('A3-PROD8', 'deux provenances à la fois sont refusées',
    pg_temp.refuse(format($q$
      insert into public.meal_entries (student_id, consumed_meal_id, source_type,
        product_id, food_id, label, quantity, unit, protein_g, carb_g, fat_g)
      values ('60000000-0000-4000-8000-00000000000a', %L, 'product',
              '70000000-0000-4000-8000-000000000001', %L, 'Deux sources', 100, 'g', 1, 1, 1) $q$,
      v_repas, v_food)));
end $$;

-- ---------------------------------------------------------------------
-- A3-PROD9 — LE SERVEUR CALCULE, LE CLIENT N'ENVOIE RIEN D'AUTRE
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('b0000000-0000-4000-8000-000000000004');

do $$
declare v_repas uuid; v_entree uuid;
begin
  select id into v_repas from public.consumed_meals
   where student_id = '60000000-0000-4000-8000-00000000000a' limit 1;

  -- 30 g de 6,3 / 57,5 / 30,9 pour 100 g → 1,89 / 17,25 / 9,27.
  v_entree := public.ajouter_aliment_produit(
    v_repas, '70000000-0000-4000-8000-000000000001', 30, 'g');
  perform pg_temp.noter('A3-PROD9', '30 g de pâte à tartiner donnent exactement 1,89 / 17,25 / 9,27',
    (select protein_g = 1.89 and carb_g = 17.25 and fat_g = 9.27
       from public.meal_entries where id = v_entree));

  perform pg_temp.noter('A3-PROD9', 'le libellé figé porte la marque',
    (select label = 'Ferrero — Pate a tartiner' from public.meal_entries where id = v_entree));

  -- L'élève n'a jamais nommé d'élève : la RPC le dérive.
  perform pg_temp.noter('A3-PROD9', 'student_id est dérivé du serveur, pas du client',
    (select student_id = '60000000-0000-4000-8000-00000000000a'
       from public.meal_entries where id = v_entree));

  -- Et il n'y a AUCUN paramètre par lequel il pourrait en envoyer une.
  perform pg_temp.noter('A3-PROD9', 'la signature de la RPC n''accepte aucune macro ni aucun élève',
    (select pg_get_function_arguments(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'ajouter_aliment_produit')
    = 'p_consumed_meal_id uuid, p_product_id uuid, p_quantity numeric, p_unit text');

  perform pg_temp.noter('A3-PROD9', 'une quantité nulle ou négative est refusée',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_produit(%L,
      '70000000-0000-4000-8000-000000000001', 0, 'g') $q$, v_repas))
    and pg_temp.refuse(format($q$ select public.ajouter_aliment_produit(%L,
      '70000000-0000-4000-8000-000000000001', -5, 'g') $q$, v_repas)));
end $$;
reset role;

-- ---------------------------------------------------------------------
-- A3-PROD10 — LA RPC REFUSE CE QUI N'EST PAS À L'APPELANT
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('b0000000-0000-4000-8000-000000000005');   -- élève Q

do $$
declare v_repas_de_p uuid;
begin
  select id into v_repas_de_p from public.consumed_meals
   where student_id = '60000000-0000-4000-8000-00000000000a' limit 1;

  perform pg_temp.noter('A3-PROD10', 'un élève ne peut pas ajouter un produit au repas d''un autre',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_produit(%L,
      '70000000-0000-4000-8000-000000000001', 30, 'g') $q$, v_repas_de_p)));
end $$;

select pg_temp.connecte('b0000000-0000-4000-8000-000000000004');   -- élève P

do $$
declare v_repas uuid;
begin
  select id into v_repas from public.consumed_meals
   where student_id = '60000000-0000-4000-8000-00000000000a' limit 1;

  perform pg_temp.noter('A3-PROD10', 'un produit inexistant est refusé',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_produit(%L,
      '70000000-0000-4000-8000-0000000000ff', 30, 'g') $q$, v_repas)));

  perform pg_temp.noter('A3-PROD10', 'aucune entrée n''a été créée par ces refus',
    (select count(*) from public.meal_entries
      where student_id = '60000000-0000-4000-8000-00000000000b') = 0);
end $$;
reset role;

-- ---------------------------------------------------------------------
-- A3-PROD11 — PURGER LE CACHE NE RÉÉCRIT PAS L'HISTOIRE
-- ---------------------------------------------------------------------
do $$
declare v_entree uuid; v_avant numeric;
begin
  select id, protein_g into v_entree, v_avant from public.meal_entries
   where product_id = '70000000-0000-4000-8000-000000000001'
   order by created_at limit 1;

  -- Le cache produit est un cache : il DOIT pouvoir être vidé. Ce que cette
  -- suppression ne doit pas faire, c'est emporter le repas d'un élève —
  -- `on delete cascade` l'aurait fait.
  delete from public.food_products where id = '70000000-0000-4000-8000-000000000001';

  perform pg_temp.noter('A3-PROD11', 'supprimer un produit du cache ne supprime AUCUNE entrée',
    (select count(*) from public.meal_entries where id = v_entree) = 1);

  perform pg_temp.noter('A3-PROD11', 'l''instantané est intact, au gramme près',
    (select protein_g = v_avant and carb_g = 17.25 and fat_g = 9.27
       from public.meal_entries where id = v_entree));

  perform pg_temp.noter('A3-PROD11', 'le libellé figé survit à la disparition de la fiche',
    (select label = 'Ferrero — Pate a tartiner' from public.meal_entries where id = v_entree));

  perform pg_temp.noter('A3-PROD11', 'seul le pointeur est tombé à NULL',
    (select product_id is null and source_type = 'product'
       from public.meal_entries where id = v_entree));
end $$;

-- ---------------------------------------------------------------------
-- A3-PROD12 — CORRIGER RECHARGE LA SOURCE ACTUELLE
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('b0000000-0000-4000-8000-000000000004');

do $$
declare v_repas uuid; v_entree uuid;
begin
  select id into v_repas from public.consumed_meals
   where student_id = '60000000-0000-4000-8000-00000000000a' limit 1;
  v_entree := public.ajouter_aliment_produit(
    v_repas, '70000000-0000-4000-8000-000000000003', 100, 'g');
  perform set_config('pg_temp.entree_a_corriger', v_entree::text, true);
end $$;
reset role;

-- La source change ENTRE la saisie et la correction — un contributeur OFF a
-- corrigé la fiche. C'est exactement ce que le contrat A1 distingue : la
-- ligne déjà posée ne bouge pas, mais une CORRECTION VOLONTAIRE relit la
-- source.
update public.food_products
   set protein_per_100 = 20, carb_per_100 = 5, fat_per_100 = 1
 where id = '70000000-0000-4000-8000-000000000003';

do $$
declare v_entree uuid;
begin
  v_entree := current_setting('pg_temp.entree_a_corriger')::uuid;
  perform pg_temp.noter('A3-PROD12', 'la fiche a changé, mais l''instantané déjà posé n''a pas bougé',
    (select protein_g = 12 and carb_g = 0 and fat_g = 0
       from public.meal_entries where id = v_entree));
end $$;

set local role authenticated;
select pg_temp.connecte('b0000000-0000-4000-8000-000000000004');

do $$
declare v_entree uuid;
begin
  v_entree := current_setting('pg_temp.entree_a_corriger')::uuid;
  perform public.modifier_quantite_entree(v_entree, 200, 'g');
end $$;
reset role;

-- Écriture et lecture SÉPARÉES : `accepte(sql) and (select …)` évaluerait la
-- sous-requête dans le même instantané que l'écriture, et ne la verrait pas.
-- Piège rencontré sur A1 comme sur A2 ; on ne le repose pas.
do $$
declare v_entree uuid;
begin
  v_entree := current_setting('pg_temp.entree_a_corriger')::uuid;

  -- 200 g de la NOUVELLE fiche (20 / 5 / 1) → 40 / 10 / 2.
  -- Une simple règle de trois sur l'ancien instantané aurait donné 24 / 0 / 0 :
  -- les deux résultats sont assez différents pour que le contrôle discrimine.
  perform pg_temp.noter('A3-PROD12', 'la correction relit la fiche ACTUELLE : 200 g → 40 / 10 / 2',
    (select protein_g = 40 and carb_g = 10 and fat_g = 2
       from public.meal_entries where id = v_entree));

  perform pg_temp.noter('A3-PROD12', 'et le libellé est réécrit depuis la fiche actuelle',
    (select label = 'Produit a zeros de tete' and quantity = 200
       from public.meal_entries where id = v_entree));
end $$;

-- Produit purgé du cache : il n'y a plus de source à relire. On refuse plutôt
-- que de retomber en silence sur la règle de trois — ce qui aurait fait d'un
-- produit un aliment manuel déguisé.
set local role authenticated;
select pg_temp.connecte('b0000000-0000-4000-8000-000000000004');

do $$
declare v_orpheline uuid;
begin
  select id into v_orpheline from public.meal_entries
   where source_type = 'product' and product_id is null limit 1;

  perform pg_temp.noter('A3-PROD12', 'corriger une entrée dont le produit a disparu est REFUSÉ',
    pg_temp.refuse(format($q$ select public.modifier_quantite_entree(%L, 60, 'g') $q$, v_orpheline)));
end $$;
reset role;

-- ---------------------------------------------------------------------
-- A3-PROD-SUP — LA PIÈCE, ET L'ABSENCE DE DENSITÉ
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('b0000000-0000-4000-8000-000000000004');

do $$
declare v_repas uuid; v_entree uuid;
begin
  select id into v_repas from public.consumed_meals
   where student_id = '60000000-0000-4000-8000-00000000000a' limit 1;

  -- La boisson : nutrition pour 100 ml, conditionnement 1000 ml.
  -- 250 ml de 0 / 10,6 / 0 → 0 / 26,5 / 0. AUCUNE conversion en grammes.
  v_entree := public.ajouter_aliment_produit(
    v_repas, '70000000-0000-4000-8000-000000000002', 250, 'ml');
  perform pg_temp.noter('A3-PROD-SUP', '250 ml d''une boisson pour 100 ml donnent 0 / 26,5 / 0',
    (select carb_g = 26.5 and unit = 'ml' and quantity = 250
       from public.meal_entries where id = v_entree));

  -- Le contrôle DISCRIMINANT du contrat g/ml : demander des grammes sur un
  -- produit dont la nutrition est en ml n'est pas converti — c'est REFUSÉ.
  -- Une conversion aurait exigé une densité, et nous n'en inventons aucune.
  perform pg_temp.noter('A3-PROD-SUP', 'demander des grammes sur un produit en ml est REFUSÉ',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_produit(%L,
      '70000000-0000-4000-8000-000000000002', 250, 'g') $q$, v_repas)));

  -- La pièce d'une boisson n'existe pas : son conditionnement est en ml, et
  -- le helper d'A2 n'accepte la pièce qu'en grammes.
  perform pg_temp.noter('A3-PROD-SUP', 'la pièce d''un produit liquide est REFUSÉE',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_produit(%L,
      '70000000-0000-4000-8000-000000000002', 1, 'piece') $q$, v_repas)));

  -- La pièce d'un produit sans quantité nette non plus.
  perform pg_temp.noter('A3-PROD-SUP', 'la pièce d''un produit sans quantité nette est REFUSÉE',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_produit(%L,
      '70000000-0000-4000-8000-000000000003', 1, 'piece') $q$, v_repas)));

  -- Une unité inconnue est refusée, elle n'est pas ignorée.
  perform pg_temp.noter('A3-PROD-SUP', 'une unité hors vocabulaire est REFUSÉE',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_produit(%L,
      '70000000-0000-4000-8000-000000000003', 1, 'cuillere') $q$, v_repas)));
end $$;
reset role;

-- Un produit solide AVEC quantité nette : là, la pièce existe — et elle vaut
-- le conditionnement déclaré, lu chez la source, jamais estimé.
insert into public.food_products
  (id, gtin, brand, product_name, net_quantity, net_unit, nutrition_unit,
   protein_per_100, carb_per_100, fat_per_100, source, source_version, source_fetched_at)
values ('70000000-0000-4000-8000-000000000004', '3175680011480', 'Marque B', 'Barre cerealiere',
        40, 'g', 'g', 5, 60, 10, 'open_food_facts', 'v3.4', now());

set local role authenticated;
select pg_temp.connecte('b0000000-0000-4000-8000-000000000004');

do $$
declare v_repas uuid; v_entree uuid;
begin
  select id into v_repas from public.consumed_meals
   where student_id = '60000000-0000-4000-8000-00000000000a' limit 1;

  -- 1 pièce = 40 g → 2 / 24 / 4.
  v_entree := public.ajouter_aliment_produit(
    v_repas, '70000000-0000-4000-8000-000000000004', 1, 'piece');
  perform pg_temp.noter('A3-PROD-SUP', '1 pièce d''une barre de 40 g donne 2 / 24 / 4',
    (select protein_g = 2 and carb_g = 24 and fat_g = 4 and unit = 'piece'
       from public.meal_entries where id = v_entree));
end $$;
reset role;

-- ---------------------------------------------------------------------
-- A3-PROD-HYDRATE — LA CONSOMMATION SUIT L'HYDRATATION (phase 4.1)
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('A3-PROD-HYDRATE', 'detail_fetched_at existe et est NULLABLE',
    (select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'food_products'
        and column_name = 'detail_fetched_at') = 'YES');

  -- Une fiche née d'une RECHERCHE : vue à l'instant, jamais hydratée. La base
  -- doit l'accepter telle quelle — c'est l'état normal d'un produit trouvé par
  -- son nom, et le rendre impossible obligerait à mentir sur la date.
  perform pg_temp.noter('A3-PROD-HYDRATE', 'une fiche non hydratée est acceptée (detail_fetched_at NULL)',
    pg_temp.accepte($q$
      insert into public.food_products (id, gtin, brand, product_name, nutrition_unit,
        protein_per_100, carb_per_100, fat_per_100, source, source_version,
        source_fetched_at, detail_fetched_at)
      values ('70000000-0000-4000-8000-000000000005', '5449000131836', 'Marque L',
              'Boisson trouvee par recherche', 'g', 0, 10.6, 0,
              'open_food_facts', 'v3.4', now(), null) $q$));
end $$;

set local role authenticated;
select pg_temp.connecte('b0000000-0000-4000-8000-000000000004');

do $$
declare v_repas uuid; v_entree_avant uuid;
begin
  select id into v_repas from public.consumed_meals
   where student_id = '60000000-0000-4000-8000-00000000000a' limit 1;

  -- L'élève consomme la fiche NON HYDRATÉE : elle dit « pour 100 g », faute
  -- de mieux. 200 g → 21,2 g de glucides.
  v_entree_avant := public.ajouter_aliment_produit(
    v_repas, '70000000-0000-4000-8000-000000000005', 200, 'g');
  perform set_config('pg_temp.entree_avant_hydratation', v_entree_avant::text, true);

  perform pg_temp.noter('A3-PROD-HYDRATE', 'avant hydratation, la RPC lit l''unité provisoire',
    (select carb_g = 21.2 and unit = 'g' from public.meal_entries where id = v_entree_avant));
end $$;
reset role;

-- HYDRATATION : le lookup GTIN a chargé la fiche complète, qui dit « ml »,
-- donne la quantité nette et pose `detail_fetched_at`.
update public.food_products
   set nutrition_unit = 'ml', net_quantity = 1000, net_unit = 'ml',
       ingredients_text = 'Eau gazeifiee, sucre', detail_fetched_at = now()
 where id = '70000000-0000-4000-8000-000000000005';

do $$
declare v_entree uuid;
begin
  v_entree := current_setting('pg_temp.entree_avant_hydratation')::uuid;

  -- CONTRAT A1, inchangé depuis le premier jour : hydrater une fiche ne
  -- réécrit AUCUN instantané déjà posé. L'élève a mangé ce qu'il a mangé.
  perform pg_temp.noter('A3-PROD-HYDRATE', 'l''hydratation ne touche AUCUN instantané déjà saisi',
    (select carb_g = 21.2 and unit = 'g' from public.meal_entries where id = v_entree));
end $$;

set local role authenticated;
select pg_temp.connecte('b0000000-0000-4000-8000-000000000004');

do $$
declare v_repas uuid; v_entree_apres uuid;
begin
  select id into v_repas from public.consumed_meals
   where student_id = '60000000-0000-4000-8000-00000000000a' limit 1;

  -- Une consommation POSTÉRIEURE à l'hydratation utilise la fiche corrigée :
  -- l'unité est « ml », et demander des grammes est désormais refusé.
  perform pg_temp.noter('A3-PROD-HYDRATE', 'après hydratation, les grammes sont refusés sur ce produit',
    pg_temp.refuse(format($q$ select public.ajouter_aliment_produit(%L,
      '70000000-0000-4000-8000-000000000005', 200, 'g') $q$, v_repas)));

  v_entree_apres := public.ajouter_aliment_produit(
    v_repas, '70000000-0000-4000-8000-000000000005', 250, 'ml');
  perform pg_temp.noter('A3-PROD-HYDRATE', '250 ml après hydratation donnent 26,5 g de glucides',
    (select carb_g = 26.5 and unit = 'ml' from public.meal_entries where id = v_entree_apres));
end $$;
reset role;

-- Et la correction VOLONTAIRE d'une quantité relit bien la fiche courante —
-- contrat de la phase 3, qu'on revérifie ici sur une fiche hydratée entre
-- temps. L'entrée d'avant était en grammes ; le produit est passé en ml : la
-- correction doit échouer plutôt que convertir en silence.
set local role authenticated;
select pg_temp.connecte('b0000000-0000-4000-8000-000000000004');

do $$
declare v_entree uuid;
begin
  v_entree := current_setting('pg_temp.entree_avant_hydratation')::uuid;
  perform pg_temp.noter('A3-PROD-HYDRATE', 'corriger en grammes une entrée dont le produit est passé en ml est REFUSÉ',
    pg_temp.refuse(format($q$ select public.modifier_quantite_entree(%L, 300, 'g') $q$, v_entree)));
end $$;
reset role;

do $$
declare v_entree uuid;
begin
  v_entree := current_setting('pg_temp.entree_avant_hydratation')::uuid;
  perform pg_temp.noter('A3-PROD-HYDRATE', 'et l''instantané d''origine est resté intact après ce refus',
    (select carb_g = 21.2 and quantity = 200 and unit = 'g'
       from public.meal_entries where id = v_entree));
end $$;

-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_rouges int;
begin
  select count(*), count(*) filter (where ok is not true) into v_total, v_rouges from _faits;
  raise notice '';
  raise notice 'ALIMENTS A3 · PRODUITS — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

do $$
begin
  raise notice '%', case
    when (select count(*) from public.students where email like '%@test.invalid') = 0
     and (select count(*) from public.meal_entries) = 0
     and (select count(*) from public.food_products) = 0
     and (select count(*) from public.food_catalog where source = 'ciqual') = 3330
    then 'OK      — Z · aucune donnée de test ne subsiste, et les 3 330 aliments Ciqual sont intacts'
    else 'ÉCHEC   — Z · état inattendu après le ROLLBACK' end;
end $$;
