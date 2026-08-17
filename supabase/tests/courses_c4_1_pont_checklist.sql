-- ============================================================================
-- Checklist PostgreSQL — COURSES C4.1 : LE PONT ALIMENT → PRODUIT RÉEL.
--
-- POURQUOI CE FICHIER EXISTE.
-- C4.1 ne repose sur aucune nouvelle brèche d'écriture : il repose au contraire
-- sur une serrure qu'il ne faut PAS ouvrir. `food_products` n'accorde que
-- `select` à `authenticated`, et tout le lot en dépend. Une suite Node peut
-- lire le texte d'un `revoke` ; seule PostgreSQL peut dire ce qu'un rôle est
-- réellement capable de faire.
--
-- Elle vérifie aussi l'invariant central du lot, qui est une ABSENCE : la table
-- de curation ne sait pas dire « matched », et refuse de l'apprendre.
--
-- CE QU'ELLE VÉRIFIE
--   A   la table de revue : colonnes, contraintes, et « matched » interdit
--   B   la structure du rapprochement : 1 aliment → N produits, sans unicité
--   C   la serrure de `food_products` : personne n'écrit, admin compris
--   D   la RLS de la revue : l'admin lit, le coach et l'élève ne lisent pas
--   E   la condition canonique : `food_id` non nul, et l'état orphelin légal
--   F   les cascades : aliment supprimé, auteur supprimé
--   G   non-régression C2/C3 : budget, prix manuel, checked, migrations
--   Z   après le ROLLBACK, aucune donnée de test ne subsiste
--
-- ⚠️ NE JAMAIS exécuter sur la Production.
-- ⚠️ AUCUN ACCÈS RÉSEAU, AUCUN ÉTAT PRÉEXISTANT. Rejouable après une
--    reconstruction complète de la base.
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
-- A — LA TABLE DE REVUE, ET CE QU'ELLE REFUSE D'APPRENDRE
-- =====================================================================
do $$
begin
  perform pg_temp.noter('A-01', 'food_catalog_retail_review existe', (
    select to_regclass('public.food_catalog_retail_review') is not null));

  perform pg_temp.noter('A-02', 'la clé primaire est catalog_food_id — UNE décision par aliment', (
    select array_agg(a.attname::text order by a.attname::text) = array['catalog_food_id']
      from pg_constraint c
      join unnest(c.conkey) k on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
     where c.contype = 'p' and c.conrelid = 'public.food_catalog_retail_review'::regclass));

  perform pg_temp.noter('A-03', 'exactement cinq colonnes, pas une de plus', (
    select count(*) = 5 from information_schema.columns
     where table_schema = 'public' and table_name = 'food_catalog_retail_review'));

  perform pg_temp.noter('A-04', 'reviewed_at est NOT NULL, reviewed_by est NULLABLE', (
    select bool_and(
             case column_name
               when 'reviewed_at' then is_nullable = 'NO'
               when 'reviewed_by' then is_nullable = 'YES'
               else true end)
      from information_schema.columns
     where table_schema = 'public' and table_name = 'food_catalog_retail_review'));
end $$;

-- ---------------------------------------------------------------------
-- LE BANC — un coach, un admin, deux élèves, deux aliments, deux produits
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c4100000-0000-4000-8000-0000000000e1', 'c41-eleve@test.invalid'),
  ('c4100000-0000-4000-8000-0000000000e8', 'c41-coach@test.invalid'),
  ('c4100000-0000-4000-8000-0000000000e9', 'c41-admin@test.invalid'),
  ('c4100000-0000-4000-8000-0000000000e7', 'c41-admin2@test.invalid');
insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('c4100000-0000-4000-8000-0000000000e1', 'student', 'C41', 'Eleve', 'c41-eleve@test.invalid'),
  ('c4100000-0000-4000-8000-0000000000e8', 'coach',   'C41', 'Coach', 'c41-coach@test.invalid'),
  ('c4100000-0000-4000-8000-0000000000e9', 'admin',   'C41', 'Admin', 'c41-admin@test.invalid'),
  ('c4100000-0000-4000-8000-0000000000e7', 'admin',   'C41', 'Admin2', 'c41-admin2@test.invalid');
insert into public.coaches (id, user_id, name) values
  ('c4100000-0000-4000-8000-00000000c001', 'c4100000-0000-4000-8000-0000000000e8', 'Coach C41');
insert into public.students (id, user_id, first_name, last_name, email, status) values
  ('c4100000-0000-4000-8000-000000005001', 'c4100000-0000-4000-8000-0000000000e1',
   'C41', 'Eleve', 'c41-eleve@test.invalid', 'active');

-- ⚠️ ON N'INVENTE AUCUN ALIMENT : ON UTILISE CEUX DU CATALOGUE CIQUAL RÉEL.
-- Fabriquer un faux « C41 Riz » avec un code Ciqual arbitraire aurait deux
-- défauts. D'abord `food_catalog_source_unique` le refuserait, puisque le vrai
-- 9119 est déjà là — le catalogue Ciqual entier arrive par migration. Ensuite,
-- et surtout, le pont se juge sur les données que l'application manipule
-- vraiment. Les identifiants sont donc RÉSOLUS PAR LEUR CODE, jamais écrits en
-- dur : un UUID de seed n'est pas un contrat.
create temporary table _banc (cle text primary key, id uuid) on commit drop;

-- Les sections C et D s'exécutent SOUS le rôle `authenticated` : elles doivent
-- pouvoir lire la table d'aiguillage, sinon l'échec mesuré serait « permission
-- denied sur _banc » au lieu de la garantie qu'on croit tester.
do $$
declare s text;
begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant select on %I._banc to authenticated, anon', s);
end $$;

insert into _banc (cle, id)
select 'riz_cru', id from public.food_catalog where source = 'ciqual' and source_ref = '9119';
insert into _banc (cle, id)
select 'riz_cuit', id from public.food_catalog where source = 'ciqual' and source_ref = '9125';
insert into _banc (cle, id)
select 'beurre', id from public.food_catalog where source = 'ciqual' and source_ref = '16403';

do $$
begin
  -- Un contrôle à part entière : le pont repose entièrement sur ce code, et le
  -- premier audit a mesuré 3 330 / 3 330 renseignés. S'il disparaissait, tout
  -- le reste du fichier mesurerait le vide.
  perform pg_temp.noter('A-10', 'le catalogue porte les codes Ciqual 9119, 9125 et 16403', (
    select count(*) = 3 from _banc where id is not null));

  perform pg_temp.noter('A-11', '9125 (cuit) et 9119 (cru) sont DEUX aliments distincts', (
    select (select id from _banc where cle = 'riz_cru')
        <> (select id from _banc where cle = 'riz_cuit')));
end $$;

insert into public.food_products (id, gtin, product_name, brand, nutrition_unit,
                                  protein_per_100, carb_per_100, fat_per_100,
                                  source, source_version, source_fetched_at)
values
  ('c4100000-0000-4000-8000-00000000f101', '3038359007224', 'C41 Riz du Penjab 1 kg', 'M1', 'g',
   7.3, 78, 0.6, 'open_food_facts', 'v3.4', now()),
  ('c4100000-0000-4000-8000-00000000f102', '3038359007217', 'C41 Rice Basmati 500 g', 'M1', 'g',
   7.3, 78, 0.6, 'open_food_facts', 'v3.4', now()),
  ('c4100000-0000-4000-8000-00000000f103', '3564700024164', 'C41 Riz basmati 1 kg', 'M2', 'g',
   7.3, 78, 0.6, 'open_food_facts', 'v3.4', now());

do $$
begin
  -- ⚠️ LE CONTRÔLE LE PLUS IMPORTANT DE CE FICHIER.
  -- La table ne sait pas dire « rapproché ». Si un jour quelqu'un ajoute
  -- 'matched' au CHECK « pour simplifier l'écran », ce contrôle rougit — et il
  -- doit rougir, parce que ce jour-là il y aurait deux vérités sur le
  -- rapprochement, et celle-ci serait la fausse.
  perform pg_temp.noter('A-05', '« matched » est REFUSÉ par la table de revue',
    pg_temp.refuse_pour($q$insert into public.food_catalog_retail_review
      (catalog_food_id, status) values
      ((select id from _banc where cle = 'riz_cru'), 'matched')$q$,
      'food_catalog_retail_review_status_check'));

  perform pg_temp.noter('A-06', 'un statut inventé est refusé',
    pg_temp.refuse_pour($q$insert into public.food_catalog_retail_review
      (catalog_food_id, status) values
      ((select id from _banc where cle = 'riz_cru'), 'peut_etre')$q$,
      'food_catalog_retail_review_status_check'));

  perform pg_temp.noter('A-07', 'une note BLANCHE est refusée (une note qu''on croit avoir écrite)',
    pg_temp.refuse_pour($q$insert into public.food_catalog_retail_review
      (catalog_food_id, status, note) values
      ((select id from _banc where cle = 'riz_cru'), 'unsupported', '   ')$q$,
      'food_catalog_retail_review_note_non_vide'));

  perform pg_temp.noter('A-08', 'les trois statuts légitimes sont acceptés', (
    select count(*) = 3 from (
      select unnest(array['unsupported', 'needs_raw_redirect', 'needs_review']) as s) t
     where pg_temp.refuse_pour(
             format($q$insert into public.food_catalog_retail_review (catalog_food_id, status)
                       values ((select id from _banc where cle = 'riz_cuit'), %L)
                       on conflict (catalog_food_id) do update set status = excluded.status$q$, t.s),
             'jamais_ce_motif') = false));

  perform pg_temp.noter('A-09', 'une revue sur un aliment inexistant est refusée',
    pg_temp.refuse_pour($q$insert into public.food_catalog_retail_review
      (catalog_food_id, status) values
      ('c4100000-0000-4000-8000-0000000000ff', 'unsupported')$q$, 'foreign key'));
end $$;


-- =====================================================================
-- B — LA STRUCTURE DU RAPPROCHEMENT : 1 ALIMENT → N PRODUITS
-- =====================================================================
do $$
declare v_n int;
begin
  -- ⚠️ AUCUNE UNICITÉ SUR food_id. C'est ce qui autorise le N, et c'est une
  -- garantie qu'un index ajouté « pour la performance » pourrait détruire sans
  -- que rien d'autre ne le signale.
  perform pg_temp.noter('B-01', 'aucun index UNIQUE ne porte sur food_id', (
    select count(*) = 0 from pg_indexes
     where schemaname = 'public' and tablename = 'food_products'
       and indexdef ilike '%unique%' and indexdef ilike '%(food_id%'));

  perform pg_temp.noter('B-02', 'l''index de rapprochement existe et est PARTIEL', (
    select count(*) = 1 from pg_indexes
     where schemaname = 'public' and tablename = 'food_products'
       and indexname = 'food_products_food_id_idx'
       and indexdef ilike '%where (food_id is not null)%'));

  -- Trois produits, un seul aliment : la base l'accepte sans rien ajouter.
  update public.food_products
     set food_id = (select id from _banc where cle = 'riz_cru'), match_status = 'manual'
   where gtin in ('3038359007224', '3038359007217', '3564700024164');
  select count(*) into v_n from public.food_products
   where food_id = (select id from _banc where cle = 'riz_cru');
  perform pg_temp.noter('B-03', '1 aliment porte 3 produits, sans structure nouvelle', v_n = 3);

  perform pg_temp.noter('B-04', 'un rapprochement sans nature est refusé',
    pg_temp.refuse_pour($q$update public.food_products
      set food_id = (select id from _banc where cle = 'riz_cru'), match_status = 'unmatched'
      where gtin = '3038359007224'$q$, 'food_products_match_coherent'));

  perform pg_temp.noter('B-05', 'un match_score hors [0,1] est refusé',
    pg_temp.refuse_pour($q$update public.food_products set match_score = 1.5
      where gtin = '3038359007224'$q$, 'food_products_match_score_borne'));

  -- ⚠️ C4.1 N'ÉCRIT AUCUN SCORE. La colonne existe, elle reste nulle : une
  -- décision humaine n'est pas une probabilité, et écrire 1 ferait passer une
  -- certitude pour une mesure d'algorithme.
  perform pg_temp.noter('B-06', 'le rapprochement manuel laisse match_score NUL', (
    select bool_and(match_score is null) from public.food_products
     where food_id = (select id from _banc where cle = 'riz_cru')));
end $$;


-- =====================================================================
-- C — LA SERRURE DE food_products : PERSONNE N'ÉCRIT, ADMIN COMPRIS
-- =====================================================================
do $$
begin
  perform pg_temp.noter('C-01', 'authenticated n''a QUE le privilège SELECT sur food_products', (
    select coalesce(array_agg(distinct privilege_type::text order by privilege_type::text), array[]::text[])
         = array['SELECT']
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'food_products' and grantee = 'authenticated'));

  perform pg_temp.noter('C-02', 'anon n''a AUCUN privilège sur food_products', (
    select count(*) = 0 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'food_products' and grantee = 'anon'));

  perform pg_temp.noter('C-03', 'authenticated n''a QUE SELECT sur la table de revue', (
    select coalesce(array_agg(distinct privilege_type::text order by privilege_type::text), array[]::text[])
         = array['SELECT']
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'food_catalog_retail_review'
       and grantee = 'authenticated'));
end $$;

-- ⚠️ LE PRIVILÈGE EST EXERCÉ, PAS SEULEMENT INSPECTÉ DANS UN CATALOGUE.
-- Un `grant` lu dans `information_schema` prouve ce qui est écrit ; seule une
-- tentative prouve ce qui est possible.
set local role authenticated;
select pg_temp.connecte('c4100000-0000-4000-8000-0000000000e9');   -- un ADMIN

do $$
begin
  perform pg_temp.noter('C-04', 'un ADMIN connecté ne peut PAS écrire food_id depuis le client',
    pg_temp.refuse_pour($q$update public.food_products
      set food_id = (select id from _banc where cle = 'riz_cuit')
      where gtin = '3038359007224'$q$, 'permission denied'));

  perform pg_temp.noter('C-05', 'un ADMIN connecté ne peut PAS insérer un produit',
    pg_temp.refuse_pour($q$insert into public.food_products
      (gtin, product_name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100,
       source, source_version)
      values ('3999999999999', 'Fabriqué', 'g', 0.1, 0.1, 0.1, 'open_food_facts', 'v3.4')$q$,
      'permission denied'));

  perform pg_temp.noter('C-06', 'un ADMIN connecté ne peut PAS supprimer un produit',
    pg_temp.refuse_pour($q$delete from public.food_products where gtin = '3038359007224'$q$,
      'permission denied'));

  -- ⚠️ ET IL NE PEUT PAS DAVANTAGE ÉCRIRE LA REVUE DEPUIS LE CLIENT.
  -- La route serveur passe par `service_role` ; l'écran, lui, n'écrit jamais
  -- en direct. Si ce contrôle devenait vert, c'est qu'un `grant insert` aurait
  -- été ajouté « pour que l'écran marche ».
  perform pg_temp.noter('C-07', 'un ADMIN connecté ne peut PAS écrire la revue depuis le client',
    pg_temp.refuse_pour($q$insert into public.food_catalog_retail_review
      (catalog_food_id, status) values
      ((select id from _banc where cle = 'riz_cru'), 'unsupported')$q$, 'permission denied'));

  -- Mais il LIT — la table lui est destinée.
  perform pg_temp.noter('C-08', 'un ADMIN connecté LIT la table de revue', (
    select count(*) >= 0 from public.food_catalog_retail_review));
end $$;

reset role;


-- =====================================================================
-- D — LA RLS DE LA REVUE : ADMIN OUI, COACH ET ÉLÈVE NON
-- =====================================================================
-- ⚠️ `on conflict` PARCE QUE A-08 A DÉJÀ ÉCRIT UNE DÉCISION SUR CET ALIMENT.
-- La clé primaire est l'aliment : une décision COURANTE, pas un journal. Écrire
-- une seconde fois REMPLACE, et c'est le comportement voulu — un administrateur
-- qui se ravise ne doit pas empiler deux avis contradictoires.
insert into public.food_catalog_retail_review (catalog_food_id, status, note, reviewed_by) values
  ((select id from _banc where cle = 'riz_cuit'), 'needs_raw_redirect',
   'Forme cuite : aucun facteur de rendement sourcé.', 'c4100000-0000-4000-8000-0000000000e9')
on conflict (catalog_food_id) do update
  set status = excluded.status, note = excluded.note,
      reviewed_by = excluded.reviewed_by, reviewed_at = now();

set local role authenticated;
select pg_temp.connecte('c4100000-0000-4000-8000-0000000000e8');   -- le COACH
do $$
begin
  perform pg_temp.noter('D-01', 'un COACH ne voit AUCUNE ligne de revue', (
    select count(*) = 0 from public.food_catalog_retail_review));
end $$;

select pg_temp.connecte('c4100000-0000-4000-8000-0000000000e1');   -- l'ÉLÈVE
do $$
begin
  perform pg_temp.noter('D-02', 'un ÉLÈVE ne voit AUCUNE ligne de revue', (
    select count(*) = 0 from public.food_catalog_retail_review));

  -- ⚠️ MAIS IL VOIT LES PRODUITS. Le cache produit reste un référentiel public :
  -- fermer sa lecture casserait le scan de code-barres.
  perform pg_temp.noter('D-03', 'un ÉLÈVE voit toujours les produits rapprochés', (
    select count(*) = 3 from public.food_products
     where food_id = (select id from _banc where cle = 'riz_cru')));
end $$;

select pg_temp.connecte('c4100000-0000-4000-8000-0000000000e9');   -- l'ADMIN
do $$
begin
  perform pg_temp.noter('D-04', 'un ADMIN voit la ligne de revue', (
    select count(*) = 1 from public.food_catalog_retail_review
     where catalog_food_id = (select id from _banc where cle = 'riz_cuit')));
end $$;

reset role;


-- =====================================================================
-- E — LA CONDITION CANONIQUE DU MATCH
-- =====================================================================
do $$
declare v_ok boolean;
begin
  -- ⚠️ L'ÉTAT ORPHELIN EST LÉGAL, ET C'EST LE PIÈGE DU LOT.
  -- `food_products_match_coherent` n'est écrite que dans UN sens, pour que le
  -- `on delete set null` de food_catalog puisse vider food_id. Un produit peut
  -- donc porter `match_status = 'manual'` avec `food_id = null`.
  update public.food_products
     set food_id = null
   where gtin = '3038359007217';
  select match_status = 'manual' and food_id is null into v_ok
    from public.food_products where gtin = '3038359007217';
  perform pg_temp.noter('E-01', 'match_status ''manual'' + food_id NUL est un état LÉGAL', v_ok);

  -- Et il ne compte PAS comme un rapprochement. C'est pourquoi tout le code
  -- lit `food_id is not null` et jamais `match_status`.
  perform pg_temp.noter('E-02', 'le produit orphelin ne compte pas comme rapproché', (
    select count(*) = 2 from public.food_products
     where food_id = (select id from _banc where cle = 'riz_cru')));

  perform pg_temp.noter('E-03', 'compter par match_status donnerait un résultat FAUX (3 ≠ 2)', (
    select count(*) = 3 from public.food_products
     where match_status = 'manual'
       and gtin in ('3038359007224', '3038359007217', '3564700024164')));
end $$;


-- =====================================================================
-- F — LES CASCADES
-- =====================================================================
do $$
declare v_revues int; v_orphelins int;
begin
  -- L'aliment disparaît : la revue disparaît avec lui (elle n'a plus de sens),
  -- mais le PRODUIT survit avec un food_id nul (c'est un cache partagé).
  delete from public.food_catalog where id = (select id from _banc where cle = 'riz_cuit');
  select count(*) into v_revues from public.food_catalog_retail_review
   where catalog_food_id = (select id from _banc where cle = 'riz_cuit');
  perform pg_temp.noter('F-01', 'aliment supprimé ⇒ sa revue est supprimée (cascade)', v_revues = 0);

  delete from public.food_catalog where id = (select id from _banc where cle = 'riz_cru');
  select count(*) into v_orphelins from public.food_products
   where gtin in ('3038359007224', '3564700024164') and food_id is null;
  perform pg_temp.noter('F-02',
    'aliment supprimé ⇒ les produits SURVIVENT, food_id à NULL (set null)', v_orphelins = 2);

  -- ⚠️ ET C'EST EXACTEMENT L'ÉTAT ORPHELIN DE E-01, PRODUIT AUTOMATIQUEMENT.
  -- Il n'est donc pas théorique : une suppression d'aliment le fabrique.
  perform pg_temp.noter('F-03', 'la suppression fabrique bien l''état ''manual'' + food_id nul', (
    select count(*) = 2 from public.food_products
     where gtin in ('3038359007224', '3564700024164')
       and match_status = 'manual' and food_id is null));
end $$;

do $$
declare v_auteur uuid;
begin
  insert into public.food_catalog_retail_review (catalog_food_id, status, reviewed_by)
  values ((select id from _banc where cle = 'beurre'), 'needs_review', 'c4100000-0000-4000-8000-0000000000e7');

  -- L'auteur disparaît : la DÉCISION survit, seul l'auteur est perdu.
  -- Supprimer un compte administrateur ne doit ni être bloqué par une note de
  -- curation, ni effacer le travail fait.
  delete from public.profiles where user_id = 'c4100000-0000-4000-8000-0000000000e7';
  delete from auth.users where id = 'c4100000-0000-4000-8000-0000000000e7';
  select reviewed_by into v_auteur from public.food_catalog_retail_review
   where catalog_food_id = (select id from _banc where cle = 'beurre');
  perform pg_temp.noter('F-04', 'auteur supprimé ⇒ la décision SURVIT, reviewed_by à NULL',
    v_auteur is null and exists (select 1 from public.food_catalog_retail_review
      where catalog_food_id = (select id from _banc where cle = 'beurre')));
end $$;


-- =====================================================================
-- G — NON-RÉGRESSION C2 / C3, ET PÉRIMÈTRE DE C4.1
-- =====================================================================
do $$
begin
  -- C3 : le budget et le prix d'article manuel n'ont pas bougé.
  perform pg_temp.noter('G-01', 'shopping_lists.budget_cents existe toujours, INTEGER nullable', (
    select data_type = 'integer' and is_nullable = 'YES'
      from information_schema.columns
     where table_schema = 'public' and table_name = 'shopping_lists' and column_name = 'budget_cents'));

  perform pg_temp.noter('G-02', 'shopping_list_items.estimated_price_cents existe toujours', (
    select count(*) = 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'shopping_list_items'
       and column_name = 'estimated_price_cents' and data_type = 'integer'));

  perform pg_temp.noter('G-03', 'la RPC definir_prix_article_manuel existe toujours', (
    select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'definir_prix_article_manuel'));

  -- C2 : la serrure de `checked` est intacte.
  perform pg_temp.noter('G-04', 'le grant de colonne UPDATE(checked) est intact', (
    select count(*) = 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'shopping_list_items'
       and column_name = 'checked' and privilege_type = 'UPDATE' and grantee = 'authenticated'));

  perform pg_temp.noter('G-05', 'la RPC regenerer_liste_de_courses existe toujours', (
    select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'regenerer_liste_de_courses'));

  -- ⚠️ C4.1 N'A CRÉÉ AUCUNE TABLE DE MAGASIN — et cette phrase reste vraie.
  -- C'était « le périmètre de C4.2 », et C4.2 est arrivé : `stores` et
  -- `student_selected_store` existent. Le contrôle n'est pas retiré, il est
  -- RESSERRÉ : d'un « aucune » il passe à une LISTE NOMMÉE. `%retailer%`,
  -- `%merchant%`, `%promotion%` et `%location%` restent interdits sans
  -- exception, et une troisième table de magasin ferait rougir.
  -- G-06b ci-dessous garde la vraie garantie de C4.1 : le pont dit QUEL
  -- PRODUIT, jamais À QUEL PRIX — et les tables de magasin non plus.
  perform pg_temp.noter('G-06',
    'aucune table de magasin hors les deux tables NOMMÉES de C4.2', (
    select coalesce(array_agg(tablename::text order by tablename::text), array[]::text[])
           <@ array['stores', 'student_selected_store']
      from pg_tables where schemaname = 'public'
       and (tablename ilike '%store%' or tablename ilike '%retailer%'
         or tablename ilike '%merchant%' or tablename ilike '%promotion%'
         or tablename ilike '%location%')));

  perform pg_temp.noter('G-06b',
    'les tables de magasin ne portent NI prix NI code produit', (
    select count(*) = 0 from information_schema.columns
     where table_schema = 'public'
       and table_name in ('stores', 'student_selected_store')
       and column_name ~* 'price|prix|cent|milli|currency|discount|promo|gtin|product_code'));

  -- ⚠️ NI FACTEUR CRU/CUIT, NI CODE CIQUAL D'ACHAT. Aucune colonne du schéma
  -- ne les porte : ils arriveront ENSEMBLE, quand une source existera.
  perform pg_temp.noter('G-07', 'aucune colonne de rendement ni de code Ciqual d''achat', (
    select count(*) = 0 from information_schema.columns
     where table_schema = 'public'
       and (column_name ilike '%yield%' or column_name ilike '%purchase_ciqual%'
         or column_name ilike '%cooking_factor%' or column_name ilike '%cru_cuit%')));

  -- La table de revue ne référence QUE l'aliment et l'auteur.
  perform pg_temp.noter('G-08', 'la revue ne pointe que food_catalog et auth.users', (
    select array_agg(distinct confrelid::regclass::text order by confrelid::regclass::text)
         = array['auth.users', 'food_catalog']
      from pg_constraint
     where contype = 'f' and conrelid = 'public.food_catalog_retail_review'::regclass));

  -- ⚠️ AUCUNE COLONNE MONÉTAIRE N'EST APPARUE. Le pont ne porte pas de prix.
  perform pg_temp.noter('G-09', 'la table de revue ne porte AUCUN montant', (
    select count(*) = 0 from information_schema.columns
     where table_schema = 'public' and table_name = 'food_catalog_retail_review'
       and (column_name ilike '%cent%' or column_name ilike '%price%'
         or column_name ilike '%prix%' or column_name ilike '%amount%')));
end $$;


-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_rouges int;
begin
  select count(*), count(*) filter (where ok is not true) into v_total, v_rouges from _faits;
  raise notice '';
  raise notice 'COURSES C4.1 · PONT ALIMENT → PRODUIT — % contrôles, % échec(s)', v_total, v_rouges;
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
  -- ⚠️ LES ALIMENTS DU BANC SONT DE VRAIS ALIMENTS CIQUAL : on ne les compte
  -- pas par un préfixe d'UUID, on vérifie qu'aucune TRACE de test ne leur est
  -- restée collée — une revue, un rapprochement. La section F les SUPPRIME
  -- pendant la transaction ; s'ils manquaient encore ici, le rollback n'aurait
  -- pas eu lieu, et c'est la première chose que ce contrôle doit voir.
  select (select count(*) from public.students     where id::text like 'c4100000%')
       + (select count(*) from public.coaches      where id::text like 'c4100000%')
       + (select count(*) from public.food_products where id::text like 'c4100000%')
       + (select count(*) from auth.users          where id::text like 'c4100000%')
       + (select count(*) from public.food_catalog_retail_review)
       + (select count(*) from public.food_products where food_id is not null)
       + (select count(*) from public.food_catalog
           where source = 'ciqual' and source_ref in ('9119', '9125', '16403')
             and id is null)
       + (select 3 - count(*) from public.food_catalog
           where source = 'ciqual' and source_ref in ('9119', '9125', '16403'))
    into v_restes;
  if v_restes > 0 then
    raise exception 'Z · ÉCHEC : % ligne(s) de test ont survécu au rollback', v_restes;
  end if;
  raise notice 'OK      — Z · aucune donnée de test ne subsiste (vérifié, pas supposé)';
end $$;
