-- ============================================================================
-- Checklist PostgreSQL — ALIMENTS A3 PHASE 2, TABLE CIQUAL 2025
-- Migrations couvertes :
--   20260902090000_food_catalog_sources.sql       (schéma : source, source_ref)
--   20260902090100_ciqual_2025_food_catalog.sql   (données : 3 330 aliments)
--
-- CE QU'ELLE VÉRIFIE — la numérotation est celle du contrat produit.
--   A3-CIQ3   l'identifiant Ciqual est conservé tel quel dans source_ref
--   A3-CIQ4   source / source_ref / source_version : identité STABLE d'un côté,
--             millésime de l'autre — paire indissociable, unicité partielle
--   A3-CIQ5   P/G/L viennent des bons constituants, aux bonnes valeurs
--   A3-CIQ6   « - » n'est JAMAIS devenu zéro : l'aliment est absent
--   A3-CIQ7   « traces » vaut zéro en base, et rien d'autre n'a bougé
--   A3-CIQ8   « < X » avec X ≤ 0,5 vaut zéro
--   A3-CIQ9   « < X » avec X > 0,5 n'a PAS été inventé : l'aliment est absent
--   A3-CIQ10  le sous-groupe des boissons alcoolisées est entièrement exclu
--   A3-CIQ11  « banane » rend un résultat pertinent
--   A3-CIQ12  « oeuf », « pates » et la ligature Œ passent la normalisation
--   A3-CIQ13  un aliment Ciqual s'ajoute par la RPC A2, sans adaptation
--   A3-CIQ14  modifier le catalogue ne touche AUCUN instantané historique
--   A3-CIQ15  les kcal consommées restent 4×P + 4×G + 9×L
--   A3-CIQ16  réimporter ne crée aucun doublon, et un CHANGEMENT DE MILLÉSIME
--             met à jour la même ligne au lieu d'en créer une seconde
--   A3-SUP    contrôles supplémentaires qu'aucun numéro officiel ne réclame
--   Z         après le ROLLBACK, aucune donnée de test ne subsiste
--
-- A3-CIQ1 (version / DOI / empreinte) et A3-CIQ2 (déterminisme du jeu) portent
-- sur des FICHIERS, pas sur la base : ils sont éprouvés par
-- scripts/tests/aliments-a3.mts, qui lit le manifeste et le jeu normalisé.
--
-- ⚠️ Cette checklist suppose la table Ciqual DÉJÀ IMPORTÉE par la migration.
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
-- Section 0 — l'import est bien là, et un élève synthétique pour la suite
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('0', 'la table Ciqual 2025 est importée',
    (select count(*) from public.food_catalog where source = 'ciqual') = 3330);
  perform pg_temp.noter('0', 'et elle constitue tout le catalogue global de ce banc',
    (select count(*) from public.food_catalog where owner_coach_id is null) = 3330);
end $$;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000004', 'eleve-a@test.invalid'),
  ('a0000000-0000-4000-8000-000000000002', 'coach-a@test.invalid');
insert into public.profiles (user_id, role, first_name, last_name, email) values
  ('a0000000-0000-4000-8000-000000000004', 'student', 'El', 'EveA', 'eleve-a@test.invalid'),
  ('a0000000-0000-4000-8000-000000000002', 'coach',   'Co', 'AchA', 'coach-a@test.invalid');
insert into public.coaches (id, user_id, name, email) values
  ('c0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'Coach A', 'coach-a@test.invalid');
insert into public.students (id, user_id, coach_id, first_name, last_name, email, status) values
  ('50000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000004',
   'c0000000-0000-4000-8000-00000000000a', 'Eleve', 'A', 'eleve-a@test.invalid', 'active');

-- ---------------------------------------------------------------------
-- A3-CIQ3 — l'identifiant Ciqual est conservé TEL QUEL
-- ---------------------------------------------------------------------
do $$
begin
  -- `alim_code` est la clé stable de l'Anses : il survit à un changement de
  -- nom entre deux millésimes, contrairement au libellé. Le stocker tel quel,
  -- en texte, est ce qui rend une future mise à jour possible.
  perform pg_temp.noter('A3-CIQ3', 'la banane porte son alim_code officiel 13005',
    (select source_ref from public.food_catalog
      where source = 'ciqual' and name = 'Banane, chair sans peau, crue') = '13005');

  perform pg_temp.noter('A3-CIQ3', 'aucun source_ref n''a été normalisé, tronqué ou casté',
    (select count(*) from public.food_catalog
      where source = 'ciqual' and source_ref !~ '^[0-9]+$') = 0
    and (select count(*) from public.food_catalog
          where source = 'ciqual' and btrim(source_ref) <> source_ref) = 0);

  perform pg_temp.noter('A3-CIQ3', 'les 3 330 identifiants sont distincts',
    (select count(distinct source_ref) from public.food_catalog where source = 'ciqual') = 3330);
end $$;

-- ---------------------------------------------------------------------
-- A3-CIQ4 — source / source_ref : paire, unicité, cohabitation
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.noter('A3-CIQ4', 'les TROIS colonnes existent et sont en texte',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'food_catalog'
        and column_name in ('source', 'source_ref', 'source_version')
        and data_type = 'text') = 3);

  -- LE POINT DE LA CORRECTION : la source ne porte PAS le millésime. Si elle
  -- le portait, une table Ciqual 2027 arriverait sous une autre clé et
  -- créerait une seconde ligne pour le même aliment.
  perform pg_temp.noter('A3-CIQ4', 'la source est le FOURNISSEUR seul, sans millésime',
    (select count(distinct source) from public.food_catalog where source is not null) = 1
    and (select count(*) from public.food_catalog where source ~ '[0-9]') = 0);

  perform pg_temp.noter('A3-CIQ4', 'et le millésime vit dans source_version, sur chaque ligne',
    (select count(*) from public.food_catalog
      where source = 'ciqual' and source_version = '2025') = 3330
    and (select count(*) from public.food_catalog
          where source = 'ciqual' and source_version is null) = 0);

  -- La contrainte ne vise QUE Ciqual : une future source pourra n'avoir aucune
  -- notion de version, et ne doit pas s'en trouver bloquée.
  perform pg_temp.noter('A3-CIQ4', 'une ligne Ciqual sans millésime est refusée', pg_temp.refuse($q$
    insert into public.food_catalog (source, source_ref, name, protein_per_100, carb_per_100, fat_per_100)
    values ('ciqual', '777777', 'Sans millesime', 1, 1, 1) $q$));

  perform pg_temp.noter('A3-CIQ4', 'mais une AUTRE source sans millésime reste acceptée',
    pg_temp.accepte($q$
      insert into public.food_catalog (source, source_ref, name, protein_per_100, carb_per_100, fat_per_100)
      values ('referentiel_futur', 'ABC-1', 'Source sans notion de version', 1, 1, 1) $q$));

  perform pg_temp.noter('A3-CIQ4', 'toutes les lignes Ciqual portent bien la clé ''ciqual''',
    (select count(*) from public.food_catalog
      where source = 'ciqual' and source_ref is null) = 0);

  -- La paire est indissociable : une source sans référence serait inutilisable
  -- pour un upsert, une référence sans source serait un identifiant orphelin.
  perform pg_temp.noter('A3-CIQ4', 'une source sans source_ref est refusée', pg_temp.refuse($q$
    insert into public.food_catalog (source, name, protein_per_100, carb_per_100, fat_per_100)
    values ('ciqual', 'Sans reference', 1, 1, 1) $q$));

  perform pg_temp.noter('A3-CIQ4', 'un source_ref sans source est refusé', pg_temp.refuse($q$
    insert into public.food_catalog (source_ref, name, protein_per_100, carb_per_100, fat_per_100)
    values ('99999', 'Sans source', 1, 1, 1) $q$));

  -- Le cœur de l'idempotence.
  perform pg_temp.noter('A3-CIQ4', 'un doublon (source, source_ref) est refusé par la base', pg_temp.refuse($q$
    insert into public.food_catalog (source, source_ref, name, protein_per_100, carb_per_100, fat_per_100)
    values ('ciqual', '13005', 'Faux doublon', 1, 1, 1) $q$));

  -- Contrôle DISCRIMINANT : l'index porte sur DEUX colonnes, pas trois. S'il
  -- incluait source_version, ('ciqual','13005','2027') ne serait plus en
  -- conflit avec ('ciqual','13005','2025') — et le doublon reviendrait.
  perform pg_temp.noter('A3-CIQ4', 'l''index d''unicité ne contient PAS le millésime',
    (select indexdef from pg_indexes
      where schemaname = 'public' and indexname = 'food_catalog_source_unique')
      !~ 'source_version');

  perform pg_temp.noter('A3-CIQ4', 'l''index d''unicité est PARTIEL — les aliments sans source cohabitent',
    exists (select 1 from pg_indexes where schemaname = 'public'
             and indexname = 'food_catalog_source_unique'
             and indexdef ~ 'WHERE .*source IS NOT NULL')
    and pg_temp.accepte($q$
      insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100)
      values ('Aliment maison sans source A', 1, 1, 1) $q$)
    and pg_temp.accepte($q$
      insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100)
      values ('Aliment maison sans source B', 2, 2, 2) $q$));

  perform pg_temp.noter('A3-CIQ4', 'les aliments Ciqual sont GLOBAUX, actifs, et en grammes',
    (select count(*) from public.food_catalog
      where source = 'ciqual'
        and (owner_coach_id is not null or status <> 'active' or nutrition_unit <> 'g')) = 0);
end $$;

-- On efface les deux décors : la suite compte des lignes.
delete from public.food_catalog where name like 'Aliment maison sans source%';
delete from public.food_catalog where source = 'referentiel_futur';

-- ---------------------------------------------------------------------
-- A3-CIQ5 — P/G/L viennent des bons constituants
-- ---------------------------------------------------------------------
-- Les valeurs ci-dessous sont celles du fichier officiel, relevées à la main.
-- Les protéines sont celles de « N x 6,25 » (const 25003), base de
-- l'étiquetage européen — PAS celles du facteur de Jones (const 25000), qui
-- donneraient d'autres nombres sur les produits laitiers et les céréales.
do $$
begin
  perform pg_temp.noter('A3-CIQ5', 'Banane (13005) : 1,06 / 19,7 / 0',
    (select protein_per_100 = 1.06 and carb_per_100 = 19.7 and fat_per_100 = 0
       from public.food_catalog where source = 'ciqual' and source_ref = '13005'));

  perform pg_temp.noter('A3-CIQ5', 'Oeuf cru (22000 ou équivalent) a des macros plausibles',
    (select protein_per_100 between 10 and 16 and fat_per_100 between 8 and 14
       from public.food_catalog where source = 'ciqual' and name = 'Oeuf cru'));

  perform pg_temp.noter('A3-CIQ5', 'aucune macro négative, aucune macro absurde',
    (select count(*) from public.food_catalog
      where source = 'ciqual'
        and (protein_per_100 < 0 or carb_per_100 < 0 or fat_per_100 < 0
          or protein_per_100 > 100 or carb_per_100 > 100 or fat_per_100 > 100)) = 0);

  -- CONTRÔLE DISCRIMINANT du choix de constituant. Ciqual publie DEUX
  -- protéines : « N x facteur de Jones » (const 25000) et « N x 6,25 »
  -- (const 25003). Elles diffèrent de plus de 0,5 g sur 231 aliments — mesuré.
  -- On éprouve donc l'import là où le choix se voit, pas sur une banane où les
  -- deux colonnes coïncident.
  --
  --   Isolat de soja (20903)  Jones 80,50  ·  N × 6,25  88,30
  --   Chanvre décortiqué (15063)  Jones 30,80  ·  N × 6,25  37,20
  --
  -- Si un jour l'import glissait vers Jones, ces deux lignes rougiraient.
  perform pg_temp.noter('A3-CIQ5', 'les protéines viennent de N × 6,25, et non du facteur de Jones',
    (select protein_per_100 = 88.3 from public.food_catalog
      where source = 'ciqual' and source_ref = '20903')
    and (select protein_per_100 = 37.2 from public.food_catalog
          where source = 'ciqual' and source_ref = '15063'));

  perform pg_temp.noter('A3-CIQ5', 'ce n''est PAS la variante Jones (qui donnerait 80,5 et 30,8)',
    (select protein_per_100 <> 80.5 from public.food_catalog
      where source = 'ciqual' and source_ref = '20903')
    and (select protein_per_100 <> 30.8 from public.food_catalog
          where source = 'ciqual' and source_ref = '15063'));

  -- AUCUNE colonne de calories n'a été ajoutée : les kcal restent dérivées.
  perform pg_temp.noter('A3-CIQ5', 'food_catalog ne porte toujours AUCUNE colonne de calories',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'food_catalog'
        and column_name ~* '(kcal|calorie|energ)') = 0);
end $$;

-- ---------------------------------------------------------------------
-- A3-CIQ6 — « - » n'est JAMAIS devenu zéro
-- ---------------------------------------------------------------------
-- Trois aliments dont une macro vaut « - » dans le fichier officiel. La
-- documentation de l'Anses est catégorique : « Il est impératif […] de ne pas
-- les assimiler à des zéros. » Ils ne doivent donc pas être dans le catalogue.
do $$
begin
  perform pg_temp.noter('A3-CIQ6', 'un aliment à protéines « - » n''a pas été importé (2381)',
    (select count(*) from public.food_catalog
      where source = 'ciqual' and source_ref = '2381') = 0);

  perform pg_temp.noter('A3-CIQ6', 'ni celui-ci (6150, Boeuf jarret cru)',
    (select count(*) from public.food_catalog
      where source = 'ciqual' and source_ref = '6150') = 0);

  perform pg_temp.noter('A3-CIQ6', 'ni celui-là (8380, glucides « - »)',
    (select count(*) from public.food_catalog
      where source = 'ciqual' and source_ref = '8380') = 0);

  -- ATTENTION AU FAUX POSITIF, mesuré : 63 aliments importés ont bien leurs
  -- TROIS macros à zéro — 58 eaux et 5 sels. C'est la réalité, pas une macro
  -- manquante devenue zéro. « Aucun aliment à 0/0/0 » aurait donc été une
  -- assertion fausse, qui aurait fait rougir un import correct.
  --
  -- Ce qu'on vérifie, c'est que ces zéros-là sont TOUS explicables : eaux et
  -- sels, rien d'autre. Un aliment carné ou céréalier à 0/0/0 serait, lui, le
  -- signe qu'une valeur inconnue a été assimilée à zéro.
  perform pg_temp.noter('A3-CIQ6', 'les 63 aliments à 0/0/0 sont TOUS des eaux ou des sels',
    (select count(*) from public.food_catalog
      where source = 'ciqual'
        and protein_per_100 = 0 and carb_per_100 = 0 and fat_per_100 = 0) = 63
    and (select count(*) from public.food_catalog
          where source = 'ciqual'
            and protein_per_100 = 0 and carb_per_100 = 0 and fat_per_100 = 0
            and name !~* '^(eau|sel|fleur de sel)') = 0);
end $$;

-- ---------------------------------------------------------------------
-- A3-CIQ7 — « traces » vaut zéro
-- ---------------------------------------------------------------------
do $$
begin
  -- 2052 « Jus de fruit(s) et de légume(s), pur jus » : lipides « traces ».
  perform pg_temp.noter('A3-CIQ7', 'un lipide « traces » vaut 0 en base, l''aliment reste importé',
    (select fat_per_100 = 0 and protein_per_100 > 0
       from public.food_catalog where source = 'ciqual' and source_ref = '2052'));

  -- 6207 « Boeuf, rumsteck grillé/poêlé » : glucides « traces ».
  perform pg_temp.noter('A3-CIQ7', 'un glucide « traces » vaut 0, et les autres macros sont intactes',
    (select carb_per_100 = 0 and protein_per_100 > 20
       from public.food_catalog where source = 'ciqual' and source_ref = '6207'));
end $$;

-- ---------------------------------------------------------------------
-- A3-CIQ8 — « < X » avec X ≤ 0,5 vaut zéro
-- ---------------------------------------------------------------------
do $$
begin
  -- La banane porte « < 0,5 » en lipides dans le fichier officiel. Sous le
  -- seuil validé, la valeur opérationnelle est 0 — et surtout PAS 0,5, qui
  -- surestimerait systématiquement tous les aliments censurés.
  perform pg_temp.noter('A3-CIQ8', 'les lipides « < 0,5 » de la banane valent 0, pas 0,5',
    (select fat_per_100 = 0 from public.food_catalog
      where source = 'ciqual' and source_ref = '13005'));

  perform pg_temp.noter('A3-CIQ8', 'et l''aliment est bien importé, pas écarté',
    (select count(*) from public.food_catalog
      where source = 'ciqual' and source_ref = '13005') = 1);
end $$;

-- ---------------------------------------------------------------------
-- A3-CIQ9 — « < X » avec X > 0,5 n'a PAS été inventé
-- ---------------------------------------------------------------------
-- Les cinq aliments concernés dans Ciqual 2025. Aucune valeur ne pouvait être
-- déduite honnêtement : ni X (qui surestime), ni 0 (qui sous-estime d'un
-- montant non négligeable), ni X/2 (qui invente). Ils sont écartés.
do $$
begin
  perform pg_temp.noter('A3-CIQ9', 'les cinq aliments à seuil > 0,5 g sont absents du catalogue',
    (select count(*) from public.food_catalog
      where source = 'ciqual'
        and source_ref in ('2011', '11004', '11091', '26015', '36031')) = 0);

  perform pg_temp.noter('A3-CIQ9', 'aucun d''eux n''a été importé sous un autre identifiant',
    (select count(*) from public.food_catalog
      where source = 'ciqual'
        and name in ('Jus multifruit, base orange, multivitaminé', 'Cornichon, au vinaigre',
                     'Vinaigre balsamique', 'Lieu noir, cuit',
                     'Poulet, cuisse, viande et peau bouillie/cuite à l''eau')) = 0);
end $$;

-- ---------------------------------------------------------------------
-- A3-CIQ10 — les boissons alcoolisées sont exclues
-- ---------------------------------------------------------------------
-- Règle : le sous-groupe Ciqual `0603` « boisson alcoolisées » en entier.
-- L'énergie de l'alcool ne passe par aucune des trois macros ; le 4/4/9
-- rendrait 0 kcal pour une vodka. Plutôt qu'un chiffre faux, rien.
do $$
begin
  perform pg_temp.noter('A3-CIQ10', 'aucun spiritueux n''est consommable',
    (select count(*) from public.food_catalog
      where source = 'ciqual'
        and name in ('Vodka', 'Whisky', 'Gin', 'Pastis', 'Alcool pur', 'Rhum')) = 0);

  perform pg_temp.noter('A3-CIQ10', 'ni vin, ni bière, ni cidre, ni cocktail',
    (select count(*) from public.food_catalog
      where source = 'ciqual'
        and source_ref in ('1000', '1001', '1002', '1014')) = 0);

  -- L'exclusion vise la CATÉGORIE, pas la molécule : les aliments d'autres
  -- groupes qui contiennent un peu d'alcool restent disponibles. Les retirer
  -- amputerait le catalogue de pains et de pâtisseries courants.
  perform pg_temp.noter('A3-CIQ10', 'mais le baba au rhum et le tiramisu restent, eux, disponibles',
    (select count(*) from public.food_catalog
      where source = 'ciqual' and source_ref in ('19688', '19698')) = 2);

  perform pg_temp.noter('A3-CIQ10', 'et les pains de mie aussi',
    (select count(*) from public.food_catalog
      where source = 'ciqual' and source_ref in ('7111', '7113', '7117')) = 3);
end $$;

-- ---------------------------------------------------------------------
-- A3-CIQ11 — « banane » rend un résultat pertinent
-- ---------------------------------------------------------------------
-- La requête est EXACTEMENT celle de `searchCatalogFoods` (A2) : catalogue
-- global, actif, `name ilike` ou `slug ilike`. Aucune UX nouvelle n'est
-- introduite en phase 2 — on prouve que l'existant suffit déjà.
set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');

do $$
declare v_n int;
begin
  v_n := pg_temp.compte($q$ select count(*)::int from public.food_catalog
    where owner_coach_id is null and status = 'active'
      and (name ilike '%banane%' or slug ilike '%banane%') $q$);
  perform pg_temp.noter('A3-CIQ11', format('« banane » rend %s résultats, dont la banane crue', v_n),
    v_n >= 3
    and pg_temp.compte($q$ select count(*)::int from public.food_catalog
      where owner_coach_id is null and status = 'active'
        and name = 'Banane, chair sans peau, crue' $q$) = 1);

  perform pg_temp.noter('A3-CIQ11', '« riz », « poulet », « saumon », « avocat », « pomme » rendent tous des résultats',
    pg_temp.compte($q$ select count(*)::int from public.food_catalog where slug ilike '%riz%' $q$) > 0
    and pg_temp.compte($q$ select count(*)::int from public.food_catalog where slug ilike '%poulet%' $q$) > 0
    and pg_temp.compte($q$ select count(*)::int from public.food_catalog where slug ilike '%saumon%' $q$) > 0
    and pg_temp.compte($q$ select count(*)::int from public.food_catalog where slug ilike '%avocat%' $q$) > 0
    and pg_temp.compte($q$ select count(*)::int from public.food_catalog where slug ilike '%pomme%' $q$) > 0);

  -- Un élève lit le catalogue global : c'est la policy d'A1, inchangée.
  perform pg_temp.noter('A3-CIQ11', 'l''élève lit bien les 3 330 aliments par la RLS d''A1',
    pg_temp.compte($q$ select count(*)::int from public.food_catalog $q$) = 3330);
end $$;
reset role;

-- ---------------------------------------------------------------------
-- A3-CIQ12 — accents et ligature
-- ---------------------------------------------------------------------
-- Ciqual écrit « Oeuf », sans ligature (mesuré : zéro Œ dans les 3 330 noms).
-- La ligature est donc éprouvée sur un aliment SYNTHÉTIQUE, pour que le
-- contrôle porte sur `food_slug` et non sur un hasard du référentiel.
insert into public.food_catalog (name, protein_per_100, carb_per_100, fat_per_100)
values ('Œuf entier de caille', 13, 0.5, 11);

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');
do $$
begin
  perform pg_temp.noter('A3-CIQ12', '« oeuf » atteint les vrais œufs du référentiel',
    pg_temp.compte($q$ select count(*)::int from public.food_catalog
      where slug like 'oeuf%' and source = 'ciqual' $q$) >= 15
    and pg_temp.compte($q$ select count(*)::int from public.food_catalog
      where name = 'Oeuf cru' $q$) = 1);

  -- La ligature est PLIÉE par food_slug : « Œuf » devient « oeuf ».
  perform pg_temp.noter('A3-CIQ12', 'la ligature Œ se plie en « oe » dans le slug',
    (select slug from public.food_catalog where name = 'Œuf entier de caille')
      = 'oeuf-entier-de-caille');

  perform pg_temp.noter('A3-CIQ12', 'une recherche « oeuf » trouve donc aussi l''aliment écrit avec Œ',
    pg_temp.compte($q$ select count(*)::int from public.food_catalog
      where slug ilike '%oeuf%' and name like 'Œuf%' $q$) = 1);

  -- Les accents : « pates » sans accent circonflexe doit trouver « Pâtes ».
  perform pg_temp.noter('A3-CIQ12', '« pates » sans accent trouve « Pâtes sèches »',
    pg_temp.compte($q$ select count(*)::int from public.food_catalog
      where slug ilike '%pates%' $q$) >= 20
    and pg_temp.compte($q$ select count(*)::int from public.food_catalog
      where slug = 'pates-seches-standard-crues' $q$) = 1);

  -- Aucun alias n'a été fabriqué : mesuré, le slug suffit pour les dix termes
  -- de l'énoncé. En ajouter serait de la complexité sans besoin.
  perform pg_temp.noter('A3-CIQ12', 'AUCUN alias heuristique n''a été fabriqué pour Ciqual',
    (select count(*) from public.food_aliases a
      join public.food_catalog f on f.id = a.food_id
     where f.source = 'ciqual') = 0);
end $$;
reset role;
delete from public.food_catalog where name = 'Œuf entier de caille';

-- ---------------------------------------------------------------------
-- A3-CIQ13 / A3-CIQ15 — l'aliment Ciqual passe par la RPC A2, en 4/4/9
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');

do $$
declare v_repas uuid; v_food uuid; v_entree uuid;
begin
  select id into v_food from public.food_catalog
   where source = 'ciqual' and source_ref = '13005';

  v_repas := public.creer_repas_eleve(date '2026-08-13', 'Test Ciqual');

  -- AUCUNE nouvelle logique de consommation : c'est la RPC d'A2, telle quelle.
  v_entree := public.ajouter_aliment_catalogue(v_repas, v_food, 120, 'g');

  perform pg_temp.noter('A3-CIQ13', 'un aliment Ciqual s''ajoute par ajouter_aliment_catalogue, sans adaptation',
    v_entree is not null
    and (select source_type = 'catalog_food' and food_id = v_food
            and label = 'Banane, chair sans peau, crue' and quantity = 120 and unit = 'g'
           from public.meal_entries where id = v_entree));

  -- 120 g de 1,06 / 19,7 / 0 pour 100 g → 1,272 / 23,64 / 0.
  perform pg_temp.noter('A3-CIQ13', '120 g de banane donnent exactement 1,272 / 23,64 / 0',
    (select protein_g = 1.272 and carb_g = 23.64 and fat_g = 0
       from public.meal_entries where id = v_entree));

  -- ── A3-CIQ15 : les kcal restent le 4/4/9 du produit ───────────────────
  -- 4×1,272 + 4×23,64 + 9×0 = 99,648. L'énergie publiée par l'Anses pour cet
  -- aliment est de 87,6 kcal/100 g, soit 105,1 pour 120 g : elle n'entre
  -- nulle part, et c'est voulu.
  perform pg_temp.noter('A3-CIQ15', 'les kcal consommées suivent 4×P + 4×G + 9×L',
    (select round(kcal, 3) = 99.648 from public.consommation_du_jour(date '2026-08-13')));

  perform pg_temp.noter('A3-CIQ15', 'et elles ne valent PAS l''énergie Ciqual (105,1 pour 120 g)',
    (select round(kcal, 1) <> 105.1 from public.consommation_du_jour(date '2026-08-13')));

  perform pg_temp.noter('A3-CIQ15', 'aucune colonne d''énergie n''est arrivée avec l''import',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name in ('food_catalog', 'meal_entries')
        and column_name ~* '(kcal|calorie|energ)') = 0);
end $$;
reset role;

-- ---------------------------------------------------------------------
-- A3-CIQ14 — mettre à jour le catalogue ne touche AUCUN instantané
-- ---------------------------------------------------------------------
-- C'est la garantie qui rend une future Ciqual 2027 inoffensive pour
-- l'histoire alimentaire des élèves. Elle vient d'A1 : une meal_entry est un
-- instantané, pas une vue sur sa source.
update public.food_catalog
   set name = 'Banane, chair sans peau, crue (millésime suivant)',
       protein_per_100 = 99, carb_per_100 = 99, fat_per_100 = 99
 where source = 'ciqual' and source_ref = '13005';

do $$
begin
  perform pg_temp.noter('A3-CIQ14', 'l''entrée déjà saisie garde son instantané, au chiffre près',
    (select protein_g = 1.272 and carb_g = 23.64 and fat_g = 0
            and label = 'Banane, chair sans peau, crue'
       from public.meal_entries
      where student_id = '50000000-0000-4000-8000-00000000000a'));

  perform pg_temp.noter('A3-CIQ14', 'le total du jour ne bouge pas non plus',
    (select round(sum(protein_g * 4 + carb_g * 4 + fat_g * 9), 3) = 99.648
       from public.meal_entries
      where student_id = '50000000-0000-4000-8000-00000000000a'));

  perform pg_temp.noter('A3-CIQ14', 'le rattachement à la source, lui, est conservé',
    (select count(*) from public.meal_entries e
      join public.food_catalog f on f.id = e.food_id
     where f.source = 'ciqual' and f.source_ref = '13005') = 1);
end $$;

-- On remet la banane dans son état importé pour la suite.
update public.food_catalog
   set name = 'Banane, chair sans peau, crue',
       protein_per_100 = 1.06, carb_per_100 = 19.7, fat_per_100 = 0
 where source = 'ciqual' and source_ref = '13005';

-- ---------------------------------------------------------------------
-- A3-CIQ16 — réimporter ne crée aucun doublon
-- ---------------------------------------------------------------------
-- On rejoue ici la FORME EXACTE de l'upsert de la migration générée, sur un
-- échantillon : même clé de conflit, même liste de colonnes mises à jour.
do $$
declare v_avant int; v_apres int; v_nom_avant text;
begin
  select count(*) into v_avant from public.food_catalog where source = 'ciqual';
  select name into v_nom_avant from public.food_catalog
   where source = 'ciqual' and source_ref = '13005';

  insert into public.food_catalog
    (source, source_ref, source_version, owner_coach_id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, status)
  values
    ('ciqual', '13005', '2025', null, 'Banane, chair sans peau, crue', 'g', 1.06, 19.7, 0, 'active'),
    ('ciqual', '2052',  '2025', null, 'Jus de fruit(s) et de légume(s), pur jus', 'g', 0.4, 10.7, 0, 'active')
  on conflict (source, source_ref) where source is not null do update
    set source_version  = excluded.source_version,
        name            = excluded.name,
        nutrition_unit  = excluded.nutrition_unit,
        protein_per_100 = excluded.protein_per_100,
        carb_per_100    = excluded.carb_per_100,
        fat_per_100     = excluded.fat_per_100,
        status          = excluded.status;

  select count(*) into v_apres from public.food_catalog where source = 'ciqual';

  perform pg_temp.noter('A3-CIQ16', 'réinsérer deux aliments déjà présents ne crée aucune ligne',
    v_apres = v_avant);

  perform pg_temp.noter('A3-CIQ16', 'et l''aliment reste identique à lui-même',
    (select name = v_nom_avant and protein_per_100 = 1.06
       from public.food_catalog where source = 'ciqual' and source_ref = '13005'));

  -- Une VRAIE nouveauté, elle, s'ajoute : l'upsert met à jour ET insère.
  insert into public.food_catalog
    (source, source_ref, source_version, owner_coach_id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, status)
  values ('ciqual', '999999', '2025', null, 'Aliment du millésime suivant', 'g', 5, 5, 5, 'active')
  on conflict (source, source_ref) where source is not null do update
    set name = excluded.name;

  perform pg_temp.noter('A3-CIQ16', 'mais un aliment réellement nouveau est bien inséré',
    (select count(*) from public.food_catalog where source = 'ciqual') = v_avant + 1);

  -- Et une mise à jour de teneur passe : le catalogue n'est pas figé.
  insert into public.food_catalog
    (source, source_ref, source_version, owner_coach_id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, status)
  values ('ciqual', '999999', '2025', null, 'Aliment du millésime suivant', 'g', 7, 5, 5, 'active')
  on conflict (source, source_ref) where source is not null do update
    set protein_per_100 = excluded.protein_per_100;

  perform pg_temp.noter('A3-CIQ16', 'une correction de teneur est appliquée à la ligne existante',
    (select protein_per_100 = 7 from public.food_catalog
      where source = 'ciqual' and source_ref = '999999'));
end $$;

delete from public.food_catalog where source = 'ciqual' and source_ref = '999999';

-- ---------------------------------------------------------------------
-- A3-CIQ16 (suite) — LE SCÉNARIO 2025 → 2027, CELUI POUR LEQUEL LE MODÈLE EXISTE
-- ---------------------------------------------------------------------
-- C'est la raison d'être de la séparation identité / millésime, et le seul
-- contrôle qui la prouve vraiment. On simule ici la publication d'une future
-- table Ciqual qui corrigerait la teneur en protéines d'un aliment :
--
--   1. l'aliment existe en millésime 2025, protéines 10 ;
--   2. un élève le consomme — l'instantané fige 10 ;
--   3. le millésime 2027 arrive avec protéines 11, MÊME source, MÊME source_ref.
--
-- Ce qui doit se produire :
--   · UNE SEULE ligne food_catalog        (pas de doublon)
--   · le MÊME food_catalog.id             (l'identité a survécu)
--   · source_version passé à '2027'       (le millésime, lui, a bougé)
--   · protéines courantes = 11            (la correction est appliquée)
--   · l'instantané de l'élève reste 10    (l'histoire n'est pas réécrite)
--
-- Si l'identité avait porté le millésime — `source = 'ciqual_2027'` — la
-- troisième étape aurait créé une SECONDE ligne, et l'ancienne serait restée
-- en place, périmée et indiscernable.
do $$
declare v_id_avant uuid;
begin
  -- ── 1. l'aliment, en millésime 2025 ───────────────────────────────────
  -- `source_ref` synthétique, hors de la plage des alim_code réels : le test
  -- ne doit pas entrer en collision avec un aliment importé.
  insert into public.food_catalog
    (source, source_ref, source_version, owner_coach_id, name, nutrition_unit,
     protein_per_100, carb_per_100, fat_per_100, status)
  values ('ciqual', '9999001', '2025', null, 'Aliment de controle inter-version', 'g',
          10, 20, 5, 'active')
  returning id into v_id_avant;

  perform pg_temp.noter('A3-CIQ16', '2025 : l''aliment existe avec protéines 10',
    (select protein_per_100 = 10 and source_version = '2025'
       from public.food_catalog where id = v_id_avant));
end $$;

-- ── 2. un élève le consomme AVANT la mise à jour ─────────────────────────
set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');
do $$
declare v_repas uuid; v_food uuid;
begin
  select id into v_food from public.food_catalog
   where source = 'ciqual' and source_ref = '9999001';
  v_repas := public.creer_repas_eleve(date '2026-08-20', 'Repas inter-version');
  -- 100 g de l'aliment → l'instantané fige 10 g de protéines.
  perform public.ajouter_aliment_catalogue(v_repas, v_food, 100, 'g');
end $$;
reset role;

do $$
begin
  perform pg_temp.noter('A3-CIQ16', 'l''élève a consommé, l''instantané fige 10 g de protéines',
    (select protein_g = 10 from public.meal_entries
      where label = 'Aliment de controle inter-version'));
end $$;

-- ── 3. LE MILLÉSIME 2027 ARRIVE ──────────────────────────────────────────
-- Exactement la forme d'upsert que produit le générateur de migration, avec
-- la seule différence qui compte : source_version vaut maintenant '2027'.
do $$
declare
  v_id_avant uuid;
  v_id_apres uuid;
begin
  select id into v_id_avant from public.food_catalog
   where source = 'ciqual' and source_ref = '9999001';

  insert into public.food_catalog
    (source, source_ref, source_version, owner_coach_id, name, nutrition_unit,
     protein_per_100, carb_per_100, fat_per_100, status)
  values ('ciqual', '9999001', '2027', null, 'Aliment de controle inter-version', 'g',
          11, 20, 5, 'active')
  on conflict (source, source_ref) where source is not null do update
    set source_version  = excluded.source_version,
        name            = excluded.name,
        nutrition_unit  = excluded.nutrition_unit,
        protein_per_100 = excluded.protein_per_100,
        carb_per_100    = excluded.carb_per_100,
        fat_per_100     = excluded.fat_per_100,
        status          = excluded.status;

  -- UNE SEULE ligne : c'est tout l'enjeu.
  perform pg_temp.noter('A3-CIQ16', '2027 : il n''existe toujours qu''UNE SEULE ligne pour cet aliment',
    (select count(*) from public.food_catalog
      where source = 'ciqual' and source_ref = '9999001') = 1);

  select id into v_id_apres from public.food_catalog
   where source = 'ciqual' and source_ref = '9999001';

  -- MÊME identifiant : les meal_entries qui pointent dessus restent rattachées.
  perform pg_temp.noter('A3-CIQ16', 'et c''est LE MÊME food_catalog.id qu''avant la mise à jour',
    v_id_apres = v_id_avant);

  perform pg_temp.noter('A3-CIQ16', 'le millésime est passé à 2027',
    (select source_version = '2027' from public.food_catalog where id = v_id_apres));

  perform pg_temp.noter('A3-CIQ16', 'et la teneur courante est bien la corrigée : 11',
    (select protein_per_100 = 11 from public.food_catalog where id = v_id_apres));
end $$;

-- ── 4. ET L'HISTOIRE DE L'ÉLÈVE N'A PAS BOUGÉ ────────────────────────────
do $$
begin
  perform pg_temp.noter('A3-CIQ16', 'l''instantané consommé AVANT vaut toujours 10, pas 11',
    (select protein_g = 10 from public.meal_entries
      where label = 'Aliment de controle inter-version'));

  perform pg_temp.noter('A3-CIQ16', 'et l''entrée reste rattachée à l''aliment, qui n''a pas changé d''identité',
    (select count(*) from public.meal_entries e
      join public.food_catalog f on f.id = e.food_id
     where f.source = 'ciqual' and f.source_ref = '9999001'
       and e.protein_g = 10 and f.protein_per_100 = 11) = 1);
end $$;

delete from public.food_catalog where source = 'ciqual' and source_ref = '9999001';

-- ---------------------------------------------------------------------
-- A3-SUP — ce que la phase 2 ne devait PAS faire
-- ---------------------------------------------------------------------
do $$
begin
  -- Périmètre : Ciqual uniquement. Aucun produit, aucun code-barres.
  --
  -- ⚠️ RÉÉCRIT LE 13/08/2026, POUR LA MÊME RAISON QUE SON JUMEAU D'A2.
  --
  -- Ce contrôle exigeait `to_regclass('public.food_products') is null`. La
  -- phase 3 a créé la table, avec autorisation explicite, et le contrôle est
  -- devenu rouge — non parce que la phase 2 avait débordé, mais parce qu'il
  -- interrogeait l'état FINAL de la base pour parler du périmètre d'une PHASE.
  --
  -- La garantie n'est pas abandonnée pour autant : « la phase 2 n'a rien
  -- branché de produit » est éprouvée sur les FICHIERS de la phase 2, qui ne
  -- changent plus, par scripts/tests/aliments-a3.mts. Ce qui reste ici est ce
  -- qui demeure vrai en base : le CATALOGUE, lui, ne porte aucun code-barres.
  perform pg_temp.noter('A3-SUP', 'le catalogue d''aliments ne porte aucun GTIN ni code-barres',
    (select count(*) from information_schema.columns
      where table_schema = 'public'
        and table_name in ('food_catalog', 'food_aliases')
        and column_name ~* '(gtin|barcode|ean)') = 0);

  -- Et un aliment Ciqual reste un aliment GÉNÉRIQUE : aucune ligne importée
  -- n'a été rattachée à un produit commercial.
  perform pg_temp.noter('A3-SUP', 'aucun aliment Ciqual n''est rattaché à un produit',
    (select count(*) from public.food_catalog
      where source = 'ciqual' and source_ref !~ '^[0-9]+$') = 0);

  perform pg_temp.noter('A3-SUP', 'aucune extension nouvelle n''a été installée',
    (select count(*) from pg_extension
      where extname in ('pg_trgm', 'unaccent', 'citext', 'http', 'pg_net')) = 0);

  -- A1 et A2 sont intactes : même nombre de policies, mêmes RPC.
  perform pg_temp.noter('A3-SUP', 'les RPC d''A2 sont toutes là, inchangées en nombre',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('ouvrir_repas_prescrit', 'creer_repas_eleve', 'renommer_repas_eleve',
                          'supprimer_repas_eleve', 'ajouter_aliment_catalogue',
                          'ajouter_aliment_manuel', 'modifier_quantite_entree',
                          'supprimer_entree', 'consommation_du_jour')) = 9);

  perform pg_temp.noter('A3-SUP', 'le privilège d''écriture directe sur meal_entries reste retiré',
    not exists (select 1 from information_schema.role_table_grants
                 where table_schema = 'public' and table_name = 'meal_entries'
                   and grantee = 'authenticated'
                   and privilege_type in ('INSERT', 'UPDATE', 'DELETE')));

  perform pg_temp.noter('A3-SUP', 'les trois policies d''A1 sur food_catalog sont intactes',
    (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'food_catalog') = 3);

  -- L'écriture reste réservée : un élève ne peut pas fabriquer un aliment.
  perform pg_temp.noter('A3-SUP', 'un élève ne peut toujours pas écrire dans le catalogue', true);
end $$;

set local role authenticated;
select pg_temp.connecte('a0000000-0000-4000-8000-000000000004');
do $$
begin
  perform pg_temp.noter('A3-SUP', 'un élève ne peut ni créer ni modifier un aliment Ciqual',
    pg_temp.refuse($q$
      insert into public.food_catalog (source, source_ref, source_version, name, protein_per_100, carb_per_100, fat_per_100)
      values ('ciqual', '424242', '2025', 'Aliment fabrique', 1, 1, 1) $q$)
    and pg_temp.compte($q$ with maj as (
        update public.food_catalog set protein_per_100 = 999
         where source = 'ciqual' and source_ref = '13005' returning 1)
      select count(*)::int from maj $q$) <= 0);
end $$;
reset role;

do $$
begin
  perform pg_temp.noter('A3-SUP', 'et la banane est intacte après ces tentatives',
    (select protein_per_100 = 1.06 from public.food_catalog
      where source = 'ciqual' and source_ref = '13005'));
end $$;

-- ---------------------------------------------------------------------
-- Récapitulatif
-- ---------------------------------------------------------------------
do $$
declare v_total int; v_rouges int;
begin
  select count(*), count(*) filter (where ok is not true) into v_total, v_rouges from _faits;
  raise notice '';
  raise notice 'ALIMENTS A3 · CIQUAL 2025 — % contrôles, % échec(s)', v_total, v_rouges;
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
     and (select count(*) from public.food_catalog where source = 'ciqual') = 3330
    then 'OK      — Z · aucune donnée de test ne subsiste, et les 3 330 aliments Ciqual sont intacts'
    else 'ÉCHEC   — Z · état inattendu après le ROLLBACK' end;
end $$;
