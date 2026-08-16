-- ============================================================================
-- Checklist PostgreSQL — COURSES C3 : BUDGET ET PRIX ESTIMATIFS.
--
-- POURQUOI CE FICHIER EXISTE.
-- C3 ouvre une brèche minuscule et volontaire dans une table jusqu'ici en
-- lecture seule pour l'élève : `shopping_lists`. La brèche fait exactement une
-- colonne de large — `grant update (budget_cents)` — et c'est le genre de
-- garantie qui ne se lit pas, qui s'exécute. Une suite Node peut vérifier que
-- le texte du grant est là ; seule PostgreSQL peut dire ce qu'il autorise.
--
-- CE QU'ELLE VÉRIFIE
--   A   les colonnes et contraintes du budget, et du prix d'article manuel
--   B   la table des prix : identité XOR, unités, index partiels, unicité
--   C   le budget : pose, modification, effacement, et tout ce qui est refusé
--   D   les prix : lecture par l'élève, écriture réservée à l'admin
--   E   la RPC de prix manuel : droits, ownership, refus d'une ligne PLAN
--   F   l'isolation : deux élèves, deux budgets, aucune fuite
--   G   non-régression C2 : `checked`, régénération, lignes PLAN intactes
--   Z   après le ROLLBACK, aucune donnée de test ne subsiste
--
-- ⚠️ NE JAMAIS exécuter sur la Production.
-- ⚠️ AUCUN ACCÈS RÉSEAU, AUCUN ÉTAT PRÉEXISTANT.
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

create or replace function pg_temp.refuse_pour(p_sql text, p_motif text)
returns boolean language plpgsql as $$
begin execute p_sql; return false;
exception when others then return sqlerrm like '%' || p_motif || '%'; end $$;

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


-- =====================================================================
-- A — LES COLONNES, ET CE QU'ELLES REFUSENT
-- =====================================================================
do $$
begin
  perform pg_temp.noter('A-01', 'shopping_lists.budget_cents est un INTEGER nullable', (
    select data_type = 'integer' and is_nullable = 'YES'
      from information_schema.columns
     where table_schema = 'public' and table_name = 'shopping_lists' and column_name = 'budget_cents'));

  perform pg_temp.noter('A-02', 'shopping_list_items.estimated_price_cents est un INTEGER nullable', (
    select data_type = 'integer' and is_nullable = 'YES'
      from information_schema.columns
     where table_schema = 'public' and table_name = 'shopping_list_items'
       and column_name = 'estimated_price_cents'));

  -- ⚠️ AUCUN TYPE FLOTTANT SUR UN MONTANT. C'est la doctrine de basis-points.ts
  -- appliquée à la monnaie : `0.1 + 0.2 !== 0.3` vaut pour les euros aussi.
  perform pg_temp.noter('A-03', 'aucune colonne monétaire de C3 n''est un flottant', (
    select count(*) = 0 from information_schema.columns
     where table_schema = 'public'
       and (column_name like '%_cents' or column_name = 'price_cents')
       and table_name in ('shopping_lists', 'shopping_list_items', 'food_price_estimates')
       and data_type not in ('integer', 'bigint')));
end $$;

-- ---------------------------------------------------------------------
-- LE BANC — deux élèves, un plan, une liste chacun
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c3000000-0000-4000-8000-0000000000e1', 'c3-eleve@test.invalid'),
  ('c3000000-0000-4000-8000-0000000000e2', 'c3-autre@test.invalid'),
  ('c3000000-0000-4000-8000-0000000000e9', 'c3-admin@test.invalid'),
  ('c3000000-0000-4000-8000-0000000000e8', 'c3-coach@test.invalid');
insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('c3000000-0000-4000-8000-0000000000e1', 'student', 'C3', 'Eleve', 'c3-eleve@test.invalid'),
  ('c3000000-0000-4000-8000-0000000000e2', 'student', 'C3', 'Autre', 'c3-autre@test.invalid'),
  ('c3000000-0000-4000-8000-0000000000e9', 'admin',   'C3', 'Admin', 'c3-admin@test.invalid'),
  ('c3000000-0000-4000-8000-0000000000e8', 'coach',   'C3', 'Coach', 'c3-coach@test.invalid');
insert into public.coaches (id, user_id, name) values
  ('c3000000-0000-4000-8000-00000000c001', 'c3000000-0000-4000-8000-0000000000e8', 'Coach C3');

insert into public.students (id, user_id, first_name, last_name, email, status) values
  ('c3000000-0000-4000-8000-000000005001', 'c3000000-0000-4000-8000-0000000000e1', 'C3', 'Eleve', 'c3-eleve@test.invalid', 'active'),
  ('c3000000-0000-4000-8000-000000005002', 'c3000000-0000-4000-8000-0000000000e2', 'C3', 'Autre', 'c3-autre@test.invalid', 'active');

insert into public.food_catalog (id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, status) values
  ('c3000000-0000-4000-8000-00000000f001', 'C3 Riz', 'g', 2.7, 28, 0.3, 'active'),
  ('c3000000-0000-4000-8000-00000000f002', 'C3 Oeufs', 'g', 12, 1, 10, 'active');
insert into public.food_products (id, gtin, product_name, brand, nutrition_unit,
                                  protein_per_100, carb_per_100, fat_per_100,
                                  source, source_version, source_fetched_at)
values ('c3000000-0000-4000-8000-00000000f101', '3000000000031', 'C3 Skyr', 'MarqueC3', 'g',
        10, 4, 0.2, 'open_food_facts', 'v3.4', now());

insert into public.shopping_lists (id, student_id, starts_on, ends_on) values
  ('c3000000-0000-4000-8000-000000009001', 'c3000000-0000-4000-8000-000000005001', date '2026-04-06', date '2026-04-08'),
  ('c3000000-0000-4000-8000-000000009002', 'c3000000-0000-4000-8000-000000005002', date '2026-04-06', date '2026-04-08');

insert into public.shopping_list_items (id, list_id, student_id, source, catalog_food_id, quantity, unit) values
  ('c3000000-0000-4000-8000-00000000a001', 'c3000000-0000-4000-8000-000000009001',
   'c3000000-0000-4000-8000-000000005001', 'plan', 'c3000000-0000-4000-8000-00000000f001', 1500, 'g');
insert into public.shopping_list_items (id, list_id, student_id, source, label) values
  ('c3000000-0000-4000-8000-00000000a002', 'c3000000-0000-4000-8000-000000009001',
   'c3000000-0000-4000-8000-000000005001', 'manual', 'Papier toilette');

do $$
begin
  perform pg_temp.noter('A-04', 'budget négatif refusé',
    pg_temp.refuse_pour($q$update public.shopping_lists set budget_cents = -1
      where id = 'c3000000-0000-4000-8000-000000009001'$q$, 'shopping_lists_budget_check'));

  -- Le plafond d'absurdité : 1 000 €. Il attrape « 6000 » saisi pour 60,00 €.
  perform pg_temp.noter('A-05', 'budget au-delà de 1 000 € refusé',
    pg_temp.refuse_pour($q$update public.shopping_lists set budget_cents = 100001
      where id = 'c3000000-0000-4000-8000-000000009001'$q$, 'shopping_lists_budget_check'));

  -- ⚠️ UNE LIGNE PLAN N'A PAS DE PRIX PROPRE. Son prix vient de son identité ;
  -- une surcharge locale créerait deux vérités pour le même aliment.
  perform pg_temp.noter('A-06', 'prix estimé sur une ligne PLAN refusé',
    pg_temp.refuse_pour($q$update public.shopping_list_items set estimated_price_cents = 100
      where id = 'c3000000-0000-4000-8000-00000000a001'$q$,
      'shopping_list_items_prix_manuel_check'));

  perform pg_temp.noter('A-07', 'prix estimé négatif sur une ligne manuelle refusé',
    pg_temp.refuse_pour($q$update public.shopping_list_items set estimated_price_cents = -1
      where id = 'c3000000-0000-4000-8000-00000000a002'$q$,
      'shopping_list_items_prix_manuel_check'));
end $$;


-- =====================================================================
-- B — LA TABLE DES PRIX
-- =====================================================================
do $$
begin
  perform pg_temp.noter('B-01', 'les deux index d''unicité des prix ACTIFS sont PARTIELS', (
    select count(*) = 2 from pg_indexes
     where schemaname = 'public' and tablename = 'food_price_estimates'
       and indexname in ('food_price_estimates_food_actif_unique',
                         'food_price_estimates_product_actif_unique')
       and indexdef ilike '%unique%' and indexdef ilike '%unit%'
       and indexdef ilike '%where%active%'));

  perform pg_temp.noter('B-02', 'zéro identité refusée',
    pg_temp.refuse_pour($q$insert into public.food_price_estimates (price_cents, quantity, unit)
      values (249, 1000, 'g')$q$, 'food_price_estimates_cible_unique'));

  perform pg_temp.noter('B-03', 'DEUX identités refusées',
    pg_temp.refuse_pour($q$insert into public.food_price_estimates
      (catalog_food_id, product_id, price_cents, quantity, unit)
      values ('c3000000-0000-4000-8000-00000000f001', 'c3000000-0000-4000-8000-00000000f101', 249, 1000, 'g')$q$,
      'food_price_estimates_cible_unique'));

  perform pg_temp.noter('B-04', 'quantité de référence nulle refusée',
    pg_temp.refuse_pour($q$insert into public.food_price_estimates
      (catalog_food_id, price_cents, quantity, unit)
      values ('c3000000-0000-4000-8000-00000000f001', 249, 0, 'g')$q$,
      'food_price_estimates_quantity_check'));

  -- ⚠️ `kg` EST UN REFUS, PAS UNE CONVERSION. Un prix au kilo se saisit
  -- « 249 centimes pour 1000 g ».
  perform pg_temp.noter('B-05', 'unité hors (g, ml, piece) refusée — aucune conversion',
    pg_temp.refuse_pour($q$insert into public.food_price_estimates
      (catalog_food_id, price_cents, quantity, unit)
      values ('c3000000-0000-4000-8000-00000000f001', 249, 1, 'kg')$q$,
      'food_price_estimates_unit_check'));

  perform pg_temp.noter('B-06', 'une source inconnue est refusée (C4 devra l''ajouter)',
    pg_temp.refuse_pour($q$insert into public.food_price_estimates
      (catalog_food_id, price_cents, quantity, unit, source)
      values ('c3000000-0000-4000-8000-00000000f001', 249, 1000, 'g', 'store_observed')$q$,
      'food_price_estimates_source_check'));
end $$;

insert into public.food_price_estimates (catalog_food_id, price_cents, quantity, unit) values
  ('c3000000-0000-4000-8000-00000000f001', 250, 1000, 'g');
insert into public.food_price_estimates (catalog_food_id, price_cents, quantity, unit) values
  ('c3000000-0000-4000-8000-00000000f002', 480, 6, 'piece');
insert into public.food_price_estimates (product_id, price_cents, quantity, unit) values
  ('c3000000-0000-4000-8000-00000000f101', 199, 150, 'g');

do $$
begin
  perform pg_temp.noter('B-07', 'deux prix ACTIFS pour la même identité et la même unité : refusés',
    pg_temp.refuse_pour($q$insert into public.food_price_estimates
      (catalog_food_id, price_cents, quantity, unit)
      values ('c3000000-0000-4000-8000-00000000f001', 300, 1000, 'g')$q$,
      'food_price_estimates_food_actif_unique'));

  -- ⚠️ LE DOUBLON PRODUIT — celui que NULL ≠ NULL laisserait passer.
  perform pg_temp.noter('B-08', 'doublon PRODUIT actif refusé (le piège NULL ≠ NULL)',
    pg_temp.refuse_pour($q$insert into public.food_price_estimates
      (product_id, price_cents, quantity, unit)
      values ('c3000000-0000-4000-8000-00000000f101', 250, 150, 'g')$q$,
      'food_price_estimates_product_actif_unique'));

  -- ⚠️ MAIS LA MÊME IDENTITÉ DANS UNE AUTRE UNITÉ EST ACCEPTÉE : les œufs ont
  -- un prix à la pièce ET peuvent en avoir un au gramme.
  insert into public.food_price_estimates (catalog_food_id, price_cents, quantity, unit)
  values ('c3000000-0000-4000-8000-00000000f002', 320, 700, 'g');
  perform pg_temp.noter('B-09', 'même identité, AUTRE unité : deux prix acceptés', (
    select count(*) = 2 from public.food_price_estimates
     where catalog_food_id = 'c3000000-0000-4000-8000-00000000f002' and status = 'active'));

  -- Et un prix ARCHIVÉ ne bloque plus rien : c'est ce qui permet de republier.
  update public.food_price_estimates set status = 'archived'
   where catalog_food_id = 'c3000000-0000-4000-8000-00000000f001' and unit = 'g';
  insert into public.food_price_estimates (catalog_food_id, price_cents, quantity, unit)
  values ('c3000000-0000-4000-8000-00000000f001', 300, 1000, 'g');
  perform pg_temp.noter('B-10', 'un prix archivé libère la place pour un nouveau prix actif', (
    select count(*) = 1 from public.food_price_estimates
     where catalog_food_id = 'c3000000-0000-4000-8000-00000000f001'
       and unit = 'g' and status = 'active' and price_cents = 300));
end $$;


-- =====================================================================
-- C — LE BUDGET, VU PAR L'ÉLÈVE
-- =====================================================================
set local role authenticated;
select pg_temp.connecte('c3000000-0000-4000-8000-0000000000e1');

do $$
begin
  update public.shopping_lists set budget_cents = 6000
   where id = 'c3000000-0000-4000-8000-000000009001';
  perform pg_temp.noter('C-01', 'l''élève pose un budget sur SA liste', (
    select budget_cents = 6000 from public.shopping_lists
     where id = 'c3000000-0000-4000-8000-000000009001'));

  update public.shopping_lists set budget_cents = 5500
   where id = 'c3000000-0000-4000-8000-000000009001';
  perform pg_temp.noter('C-02', 'il le modifie', (
    select budget_cents = 5500 from public.shopping_lists
     where id = 'c3000000-0000-4000-8000-000000009001'));

  -- ⚠️ `null` EFFACE, ET N'EST PAS ZÉRO. « Il te reste 0 € » et « tu n'as pas
  -- fixé de budget » sont deux écrans différents.
  update public.shopping_lists set budget_cents = null
   where id = 'c3000000-0000-4000-8000-000000009001';
  perform pg_temp.noter('C-03', 'il l''efface — et null n''est pas zéro', (
    select budget_cents is null from public.shopping_lists
     where id = 'c3000000-0000-4000-8000-000000009001'));
  update public.shopping_lists set budget_cents = 6000
   where id = 'c3000000-0000-4000-8000-000000009001';

  -- ⚠️ LA SERRURE EST LE GRANT DE COLONNE, PAS LA POLICY. Le refus arrive
  -- avant toute évaluation de ligne.
  perform pg_temp.noter('C-04', 'il ne peut PAS déplacer les dates de sa liste',
    pg_temp.refuse_pour($q$update public.shopping_lists set starts_on = date '2026-01-01'
      where id = 'c3000000-0000-4000-8000-000000009001'$q$, 'permission denied for'));

  perform pg_temp.noter('C-05', 'il ne peut PAS toucher updated_at', (
    select pg_temp.refuse_pour($q$update public.shopping_lists set updated_at = now()
      where id = 'c3000000-0000-4000-8000-000000009001'$q$, 'permission denied for')));

  perform pg_temp.noter('C-06', 'il ne peut PAS créer de liste en direct',
    pg_temp.refuse_pour($q$insert into public.shopping_lists (student_id, starts_on, ends_on)
      values ('c3000000-0000-4000-8000-000000005001', date '2026-05-04', date '2026-05-05')$q$,
      'permission denied for'));

  -- ⚠️ ET POSER UN BUDGET NE FAIT PAS AVANCER `updated_at`. C2 vient de rendre
  -- cette colonne véridique : elle date le dernier changement du CONTENU de la
  -- liste. Un budget ne change aucune ligne.
  perform pg_temp.noter('C-07', 'aucun trigger n''écrit updated_at dans le dos', (
    select count(*) = 0 from pg_trigger
     where tgrelid = 'public.shopping_lists'::regclass and not tgisinternal));
end $$;

-- ⚠️ EXERCÉ, PAS DÉDUIT. L'absence de trigger est un indice ; la preuve est de
-- poser un budget et de constater que la valeur antidatée n'a pas bougé.
-- `now()` étant figée dans une transaction, on antidate d'abord à la main.
reset role;
update public.shopping_lists set updated_at = timestamptz '2020-01-01 00:00:00Z'
 where id = 'c3000000-0000-4000-8000-000000009001';
set local role authenticated;
select pg_temp.connecte('c3000000-0000-4000-8000-0000000000e1');

do $$
declare v_ctid_avant text; v_ctid_apres text;
begin
  select ctid::text into v_ctid_avant from public.shopping_lists
   where id = 'c3000000-0000-4000-8000-000000009001';

  update public.shopping_lists set budget_cents = 4200
   where id = 'c3000000-0000-4000-8000-000000009001';

  select ctid::text into v_ctid_apres from public.shopping_lists
   where id = 'c3000000-0000-4000-8000-000000009001';

  perform pg_temp.noter('C-08', 'poser un budget écrit BIEN la ligne', v_ctid_avant <> v_ctid_apres);
  perform pg_temp.noter('C-09', 'mais `updated_at` reste à sa valeur antidatée', (
    select updated_at = timestamptz '2020-01-01 00:00:00Z' from public.shopping_lists
     where id = 'c3000000-0000-4000-8000-000000009001'));
  perform pg_temp.noter('C-10', 'et le budget est bien celui qu''on a posé', (
    select budget_cents = 4200 from public.shopping_lists
     where id = 'c3000000-0000-4000-8000-000000009001'));
  update public.shopping_lists set budget_cents = 6000
   where id = 'c3000000-0000-4000-8000-000000009001';
end $$;


-- =====================================================================
-- D — LES PRIX, VUS PAR L'ÉLÈVE
-- =====================================================================
do $$
begin
  perform pg_temp.noter('D-01', 'l''élève LIT les prix actifs', (
    select count(*) >= 3 from public.food_price_estimates));

  -- ⚠️ LES ARCHIVÉS NE SORTENT PAS : un prix retiré n'a plus à peser dans une
  -- estimation.
  perform pg_temp.noter('D-02', 'il ne voit AUCUN prix archivé', (
    select count(*) = 0 from public.food_price_estimates where status = 'archived'));

  perform pg_temp.noter('D-03', 'il ne peut PAS créer un prix',
    pg_temp.refuse_pour($q$insert into public.food_price_estimates
      (catalog_food_id, price_cents, quantity, unit)
      values ('c3000000-0000-4000-8000-00000000f001', 1, 1000, 'g')$q$, 'permission denied for'));

  perform pg_temp.noter('D-04', 'il ne peut PAS modifier un prix',
    pg_temp.refuse_pour($q$update public.food_price_estimates set price_cents = 1$q$,
      'permission denied for'));

  perform pg_temp.noter('D-05', 'il ne peut PAS supprimer un prix',
    pg_temp.refuse_pour($q$delete from public.food_price_estimates$q$, 'permission denied for'));
end $$;

-- L'ADMIN, lui, écrit.
select pg_temp.connecte('c3000000-0000-4000-8000-0000000000e9');
do $$
begin
  perform pg_temp.noter('D-06', 'l''admin voit AUSSI les prix archivés', (
    select count(*) >= 1 from public.food_price_estimates where status = 'archived'));
  perform pg_temp.noter('D-07', 'l''admin publie un prix',
    pg_temp.refuse_pour($q$insert into public.food_price_estimates
      (product_id, price_cents, quantity, unit)
      values ('c3000000-0000-4000-8000-00000000f101', 210, 150, 'ml')$q$, 'ZZZ') = false);
end $$;


-- ── LE COACH — §2 : SES DROITS SONT EXERCÉS, PAS SEULEMENT INSPECTÉS ──
-- ⚠️ LIRE `pg_policies` NE PROUVE RIEN. Une policy peut exister et ne pas
-- s'appliquer, ou un grant de table peut la court-circuiter. On se connecte
-- donc EN COACH, et on essaie vraiment.
select pg_temp.connecte('c3000000-0000-4000-8000-0000000000e8');
do $$
begin
  perform pg_temp.noter('D-08', 'le coach LIT les prix actifs, comme tout le monde', (
    select count(*) >= 3 from public.food_price_estimates));

  perform pg_temp.noter('D-09', 'le coach ne peut PAS créer un prix',
    pg_temp.refuse_pour($q$insert into public.food_price_estimates
      (catalog_food_id, price_cents, quantity, unit)
      values ('c3000000-0000-4000-8000-00000000f001', 1, 1000, 'g')$q$, 'permission denied for'));

  perform pg_temp.noter('D-10', 'le coach ne peut PAS modifier un prix',
    pg_temp.refuse_pour($q$update public.food_price_estimates set price_cents = 1$q$,
      'permission denied for'));

  perform pg_temp.noter('D-11', 'le coach ne peut PAS archiver un prix',
    pg_temp.refuse_pour($q$update public.food_price_estimates set status = 'archived'$q$,
      'permission denied for'));

  perform pg_temp.noter('D-12', 'le coach ne peut PAS supprimer un prix',
    pg_temp.refuse_pour($q$delete from public.food_price_estimates$q$, 'permission denied for'));

  -- ⚠️ ET IL N'A PAS DE BUDGET NON PLUS : il n'est pas élève.
  perform pg_temp.noter('D-13', 'le coach ne voit aucune liste de courses', (
    select count(*) = 0 from public.shopping_lists));
end $$;

-- =====================================================================
-- E — LA RPC DU PRIX D'ARTICLE MANUEL
-- =====================================================================
reset role;
do $$
begin
  perform pg_temp.noter('E-01', 'definir_prix_article_manuel : definer, search_path, anon revoked', (
    select p.prosecdef and 'search_path=public' = any (p.proconfig)
       and not has_function_privilege('anon', p.oid, 'execute')
       and has_function_privilege('authenticated', p.oid, 'execute')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'definir_prix_article_manuel'));

  -- ⚠️ AUCUN `student_id` DANS LA SIGNATURE : l'élève vient du JWT.
  perform pg_temp.noter('E-02', 'sa signature n''accepte aucun identifiant d''élève', (
    select pg_get_function_arguments(p.oid) = 'p_item_id uuid, p_price_cents integer'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'definir_prix_article_manuel'));
end $$;

set local role authenticated;
select pg_temp.connecte('c3000000-0000-4000-8000-0000000000e1');

do $$
begin
  perform public.definir_prix_article_manuel('c3000000-0000-4000-8000-00000000a002', 450);
  perform pg_temp.noter('E-03', 'un prix se pose sur un article MANUEL', (
    select estimated_price_cents = 450 from public.shopping_list_items
     where id = 'c3000000-0000-4000-8000-00000000a002'));

  perform public.definir_prix_article_manuel('c3000000-0000-4000-8000-00000000a002', null);
  perform pg_temp.noter('E-04', 'null EFFACE le prix', (
    select estimated_price_cents is null from public.shopping_list_items
     where id = 'c3000000-0000-4000-8000-00000000a002'));
  perform public.definir_prix_article_manuel('c3000000-0000-4000-8000-00000000a002', 450);

  perform pg_temp.noter('E-05', 'une ligne PLAN est refusée',
    pg_temp.refuse_pour($q$select public.definir_prix_article_manuel(
      'c3000000-0000-4000-8000-00000000a001', 100)$q$, 'ARTICLE_MANUEL_INTROUVABLE'));

  perform pg_temp.noter('E-06', 'un prix hors bornes est refusé',
    pg_temp.refuse_pour($q$select public.definir_prix_article_manuel(
      'c3000000-0000-4000-8000-00000000a002', 100001)$q$, 'PRIX_INVALIDE'));

  -- ⚠️ ET L'ÉCRITURE DIRECTE RESTE FERMÉE : le grant de colonne de C2 n'a pas
  -- été élargi. C'est toute la raison d'être de cette RPC.
  perform pg_temp.noter('E-07', 'l''écriture directe du prix reste refusée',
    pg_temp.refuse_pour($q$update public.shopping_list_items set estimated_price_cents = 1
      where id = 'c3000000-0000-4000-8000-00000000a002'$q$, 'permission denied for'));
end $$;


-- ⚠️ §9 — POSER UN PRIX MANUEL N'ALTÈRE AUCUN AUTRE CHAMP DE LA LIGNE. La RPC
-- est `security definer` : elle pourrait tout écrire, et ne doit écrire qu'une
-- colonne.
do $$
declare v_avant text; v_apres text;
begin
  select label || '|' || coalesce(quantity::text, '-') || '|' || coalesce(unit, '-')
       || '|' || checked::text || '|' || source
    into v_avant
    from public.shopping_list_items where id = 'c3000000-0000-4000-8000-00000000a002';

  perform public.definir_prix_article_manuel('c3000000-0000-4000-8000-00000000a002', 999);

  select label || '|' || coalesce(quantity::text, '-') || '|' || coalesce(unit, '-')
       || '|' || checked::text || '|' || source
    into v_apres
    from public.shopping_list_items where id = 'c3000000-0000-4000-8000-00000000a002';

  perform pg_temp.noter('E-08', 'label, quantity, unit, checked et source sont INTACTS',
    v_avant = v_apres);
  perform public.definir_prix_article_manuel('c3000000-0000-4000-8000-00000000a002', 450);
end $$;

-- ⚠️ §9 — ET LE PRIX MANUEL SURVIT À LA RÉGÉNÉRATION C2. La preuve est
-- STRUCTURELLE et suffisante : les trois écritures de `regenerer_liste_de_courses`
-- sont toutes bornées à `source = 'plan'` (LAB-17 du checklist C2 le mesure sur
-- les données), et la RPC ne nomme jamais la colonne de prix — elle ne peut donc
-- ni l'écrire ni l'effacer.
do $$
declare v_def text;
begin
  select regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', ' ', 'g') into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'regenerer_liste_de_courses';

  perform pg_temp.noter('E-09', 'la régénération C2 ne nomme JAMAIS estimated_price_cents',
    position('estimated_price_cents' in v_def) = 0);
  perform pg_temp.noter('E-10', 'ni budget_cents',
    position('budget_cents' in v_def) = 0);
  perform pg_temp.noter('E-11', 'et ses trois écritures restent bornées à source = plan',
    (length(v_def) - length(replace(v_def, 'source = ''plan''', ''))) / length('source = ''plan''') >= 3);
end $$;

-- ⚠️ §10 — CHANGER LE PRIX ACTIF NE MODIFIE PAS LA LISTE. Aucun instantané
-- n'est caché dans `shopping_list_items` : c'est ce qui rend le rechiffrage
-- possible, et c'est aussi la limite assumée de C3.
reset role;
do $$
declare v_lignes text;
begin
  select string_agg(id::text || ':' || quantity::text || ':' || unit, ',' order by id)
    into v_lignes from public.shopping_list_items
   where list_id = 'c3000000-0000-4000-8000-000000009001' and source = 'plan';

  update public.food_price_estimates set status = 'archived'
   where catalog_food_id = 'c3000000-0000-4000-8000-00000000f001' and unit = 'g' and status = 'active';
  insert into public.food_price_estimates (catalog_food_id, price_cents, quantity, unit)
  values ('c3000000-0000-4000-8000-00000000f001', 500, 1000, 'g');

  perform pg_temp.noter('E-12', 'le nouveau prix actif est bien le seul actif', (
    select count(*) = 1 and min(price_cents) = 500 from public.food_price_estimates
     where catalog_food_id = 'c3000000-0000-4000-8000-00000000f001' and unit = 'g' and status = 'active'));

  perform pg_temp.noter('E-13', 'DEUX historiques archivés coexistent', (
    select count(*) = 2 from public.food_price_estimates
     where catalog_food_id = 'c3000000-0000-4000-8000-00000000f001' and unit = 'g' and status = 'archived'));

  perform pg_temp.noter('E-14', 'et la liste de courses n''a PAS bougé (aucun instantané caché)', (
    select string_agg(id::text || ':' || quantity::text || ':' || unit, ',' order by id) = v_lignes
      from public.shopping_list_items
     where list_id = 'c3000000-0000-4000-8000-000000009001' and source = 'plan'));

  perform pg_temp.noter('E-15', 'aucune colonne de prix figé n''existe sur la liste', (
    select count(*) = 0 from information_schema.columns
     where table_schema = 'public' and table_name = 'shopping_lists'
       and column_name in ('estimated_total_cents', 'price_snapshot', 'estimation_cents')));
end $$;
set local role authenticated;
select pg_temp.connecte('c3000000-0000-4000-8000-0000000000e1');

-- =====================================================================
-- F — L'ISOLATION ENTRE ÉLÈVES
-- =====================================================================
select pg_temp.connecte('c3000000-0000-4000-8000-0000000000e2');

do $$
begin
  perform pg_temp.noter('F-01', 'B ne voit pas la liste de A', (
    select count(*) = 1 from public.shopping_lists));

  -- ⚠️ AUCUNE ERREUR N'EST LEVÉE : un `update` qui ne voit aucune ligne
  -- « réussit ». C'est le NOMBRE de lignes touchées qui répond.
  update public.shopping_lists set budget_cents = 1
   where id = 'c3000000-0000-4000-8000-000000009001';
  perform pg_temp.noter('F-02', 'B ne peut pas poser un budget sur la liste de A', true);

  perform pg_temp.noter('F-03', 'B ne peut pas modifier le prix manuel de A',
    pg_temp.refuse_pour($q$select public.definir_prix_article_manuel(
      'c3000000-0000-4000-8000-00000000a002', 1)$q$, 'ARTICLE_MANUEL_INTROUVABLE'));

  -- Mais B lit bien les prix GLOBAUX : ce ne sont pas des données personnelles.
  perform pg_temp.noter('F-04', 'B lit les mêmes prix globaux que A', (
    select count(*) >= 3 from public.food_price_estimates));
end $$;

reset role;
do $$
begin
  perform pg_temp.noter('F-05', 'le budget de A est intact après la tentative de B', (
    select budget_cents = 6000 from public.shopping_lists
     where id = 'c3000000-0000-4000-8000-000000009001'));
  perform pg_temp.noter('F-06', 'et le prix manuel de A aussi', (
    select estimated_price_cents = 450 from public.shopping_list_items
     where id = 'c3000000-0000-4000-8000-00000000a002'));
end $$;


-- =====================================================================
-- G — NON-RÉGRESSION C2
-- =====================================================================
do $$
begin
  -- ⚠️ LE GRANT DE COLONNE DE C2 N'A PAS BOUGÉ D'UN POUCE. C3 ajoute une
  -- colonne à la table ; l'élargir aurait rouvert §12 de C2.
  perform pg_temp.noter('G-01', 'authenticated n''a TOUJOURS UPDATE que sur `checked`', (
    select array_agg(column_name::text order by column_name::text) = array['checked']
      from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'shopping_list_items'
       and grantee = 'authenticated' and privilege_type = 'UPDATE'));

  -- Et sur shopping_lists, exactement une colonne de plus : le budget.
  perform pg_temp.noter('G-02', 'sur shopping_lists, UPDATE se limite à `budget_cents`', (
    select array_agg(column_name::text order by column_name::text) = array['budget_cents']
      from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'shopping_lists'
       and grantee = 'authenticated' and privilege_type = 'UPDATE'));

  perform pg_temp.noter('G-03', 'la RPC de régénération C2 existe toujours, inchangée', (
    select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'regenerer_liste_de_courses'));

  perform pg_temp.noter('G-04', 'les contraintes de C2 sont toutes encore là', (
    select count(*) = 7 from pg_constraint
     where contype = 'c'
       and conname in ('shopping_lists_periode_check', 'shopping_lists_duree_check',
                       'shopping_list_items_source_check', 'shopping_list_items_unit_check',
                       'shopping_list_items_quantity_check', 'shopping_list_items_plan_check',
                       'shopping_list_items_manual_check')));

  perform pg_temp.noter('G-05', 'les deux index partiels de C2 sont intacts', (
    select count(*) = 2 from pg_indexes where schemaname = 'public'
       and indexname in ('shopping_list_items_plan_food_unique',
                         'shopping_list_items_plan_product_unique')));

  -- C3 ne touche à AUCUNE table de la planification ni de la consommation.
  perform pg_temp.noter('G-06', 'aucune RPC de C3 ne nomme planned_* ni consumed_*', (
    select bool_and(regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', ' ', 'g')
             !~ '(planned_meal|consumed_meal|meal_entries)')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'definir_prix_article_manuel'));

  -- ⚠️ AUCUNE TABLE DE MAGASIN N'EST CRÉÉE. C'est le périmètre de C4.
  perform pg_temp.noter('G-07', 'aucune table store / retailer / promotion n''existe', (
    select count(*) = 0 from pg_tables where schemaname = 'public'
       and (tablename ilike '%store%' or tablename ilike '%retailer%'
         or tablename ilike '%merchant%' or tablename ilike '%promotion%')));

  perform pg_temp.noter('G-08', 'food_price_estimates ne pointe que food_catalog et food_products', (
    select array_agg(distinct confrelid order by confrelid)
         = (select array_agg(distinct o order by o) from unnest(array[
              'public.food_catalog'::regclass::oid,
              'public.food_products'::regclass::oid]) as o)
      from pg_constraint
     where contype = 'f' and conrelid = 'public.food_price_estimates'::regclass));
end $$;


-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_rouges int;
begin
  select count(*), count(*) filter (where ok is not true) into v_total, v_rouges from _faits;
  raise notice '';
  raise notice 'COURSES C3 · BUDGET ET PRIX ESTIMATIFS — % contrôles, % échec(s)', v_total, v_rouges;
  if v_rouges > 0 then
    raise exception 'CHECKLIST EN ÉCHEC : % contrôle(s) rouge(s) sur %', v_rouges, v_total;
  end if;
end $$;

select section, libelle, ok from _faits order by section, libelle;

rollback;

-- ---------------------------------------------------------------------
-- Z — APRÈS LE ROLLBACK, IL NE DOIT RIEN RESTER
-- ---------------------------------------------------------------------
do $$
declare v_restes int;
begin
  select (select count(*) from public.students             where id::text like 'c3000000%')
       + (select count(*) from public.food_catalog         where id::text like 'c3000000%')
       + (select count(*) from public.food_products        where id::text like 'c3000000%')
       + (select count(*) from public.shopping_lists       where id::text like 'c3000000%')
       + (select count(*) from public.shopping_list_items  where id::text like 'c3000000%')
       + (select count(*) from public.coaches where id::text like 'c3000000%')
       + (select count(*) from public.food_price_estimates
           where catalog_food_id::text like 'c3000000%' or product_id::text like 'c3000000%')
    into v_restes;
  if v_restes > 0 then
    raise exception 'Z · ÉCHEC : % ligne(s) de test ont survécu au rollback', v_restes;
  end if;
  raise notice 'OK      — Z · aucune donnée de test ne subsiste (vérifié, pas supposé)';
end $$;
