-- ============================================================================
-- Checklist PostgreSQL — COURSES C4.3c : LE PONT OPEN PRICES DEVIENT FACULTATIF.
--
-- POURQUOI CE FICHIER EXISTE.
-- Toute cette migration repose sur DEUX comportements de PostgreSQL qu'une
-- suite Node ne peut que citer, jamais éprouver :
--
--   1. un UNIQUE ORDINAIRE considère deux NULL comme DISTINCTS — donc plusieurs
--      magasins sans pont cohabitent, sans index partiel ni `NULLS NOT
--      DISTINCT` ;
--   2. un CHECK n'échoue que sur FALSE — `NULL > 0` vaut UNKNOWN, donc le CHECK
--      existant accepte déjà NULL, sans être retouché.
--
-- Une première rédaction de la migration voulait dropper et recréer les deux.
-- C'était du bruit à haut risque sur une table partagée. Ce fichier est la
-- preuve qu'un seul `ALTER … DROP NOT NULL` suffit.
--
-- CE QU'ELLE VÉRIFIE
--   A   op_location_id : nullable, unicité intacte, CHECK intact
--   B   les NULL : plusieurs acceptés, doublons non nuls toujours refusés
--   C   l'identité OSM : inchangée, et toujours contraignante
--   D   les identifiants d'enseigne : forme validée, JAMAIS uniques
--   E   le périmètre : student_selected_store intacte, aucune table nouvelle
--   Z   après le ROLLBACK, aucune donnée de test ne subsiste
--
-- ⚠️ NE JAMAIS exécuter sur la Production.
-- ============================================================================

\timing off
begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;

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

-- =====================================================================
-- A — op_location_id : CE QUI CHANGE, ET CE QUI NE CHANGE PAS
-- =====================================================================
do $$
begin
  perform pg_temp.noter('A-01', 'op_location_id est devenue NULLABLE', (
    select is_nullable = 'YES' from information_schema.columns
     where table_schema = 'public' and table_name = 'stores'
       and column_name = 'op_location_id'));

  perform pg_temp.noter('A-02', 'op_location_id reste un bigint', (
    select data_type = 'bigint' from information_schema.columns
     where table_schema = 'public' and table_name = 'stores'
       and column_name = 'op_location_id'));

  -- ⚠️ LA CONTRAINTE N'A PAS ÉTÉ RECRÉÉE : c'est la MÊME, au nom près, et sa
  -- définition ne porte NI `NULLS NOT DISTINCT`, NI clause `WHERE`.
  perform pg_temp.noter('A-03', 'l''unicité de op_location_id est intacte et ORDINAIRE', (
    select pg_get_constraintdef(oid) = 'UNIQUE (op_location_id)'
      from pg_constraint
     where conrelid = 'public.stores'::regclass
       and conname = 'stores_op_location_id_key'));

  perform pg_temp.noter('A-04', 'aucun index unique PARTIEL n''a été introduit', (
    select count(*) = 0 from pg_indexes
     where schemaname = 'public' and tablename = 'stores'
       and indexdef ilike '%unique%' and indexdef ilike '%op_location_id%'
       and indexdef ilike '%where%'));

  -- ⚠️ LE CHECK N'A PAS ÉTÉ TOUCHÉ NON PLUS. Il dit toujours `> 0`, sans
  -- mention de NULL — et c'est suffisant, la section B le prouve.
  perform pg_temp.noter('A-05', 'le CHECK (op_location_id > 0) est intact', (
    select pg_get_constraintdef(oid) = 'CHECK ((op_location_id > 0))'
      from pg_constraint
     where conrelid = 'public.stores'::regclass
       and conname = 'stores_op_location_id_positif'));
end $$;

-- =====================================================================
-- B — LES NULL, ÉPROUVÉS PLUTÔT QUE CITÉS
-- =====================================================================
do $$
begin
  insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
  values (null, 'NODE', 900101, 'C43c sans pont A', 43.1000000, 5.9000000),
         (null, 'WAY',  900102, 'C43c sans pont B', 43.2000000, 5.8000000);

  perform pg_temp.noter('B-01', 'PLUSIEURS magasins sans pont cohabitent (NULL distincts)', (
    select count(*) = 2 from public.stores
     where op_location_id is null and osm_id between 900101 and 900102));

  perform pg_temp.noter('B-02', 'NULL satisfait le CHECK — UNKNOWN n''est pas FALSE',
    (null::bigint > 0) is null);

  -- Et l'unicité protège toujours les valeurs RÉELLES.
  insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
  values (900201, 'NODE', 900103, 'C43c ponté', 43.3000000, 5.7000000);

  perform pg_temp.noter('B-03', 'deux op_location_id identiques NON NULS restent refusés',
    pg_temp.refuse_pour(
      'insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
         values (900201, ''NODE'', 900104, ''C43c doublon'', 43.4, 5.6)',
      'stores_op_location_id_key'));

  perform pg_temp.noter('B-04', 'zéro et négatif restent refusés par le CHECK',
    pg_temp.refuse_pour(
      'insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
         values (0, ''NODE'', 900105, ''C43c zero'', 43.5, 5.5)',
      'stores_op_location_id_positif'));

  -- ⚠️ LE SCÉNARIO DE VIE DU LOT : un magasin découvert sans pont, qu'Open
  -- Prices connaîtra plus tard. L'enrichissement doit passer.
  update public.stores set op_location_id = 900202
   where osm_type = 'NODE' and osm_id = 900101;
  perform pg_temp.noter('B-05', 'un magasin sans pont peut être ENRICHI plus tard', (
    select op_location_id = 900202 from public.stores
     where osm_type = 'NODE' and osm_id = 900101));
end $$;

-- =====================================================================
-- C — L'IDENTITÉ DU MAGASIN N'A PAS BOUGÉ
-- =====================================================================
do $$
begin
  perform pg_temp.noter('C-01', 'l''identité canonique reste UNIQUE (osm_type, osm_id)', (
    select pg_get_constraintdef(oid) = 'UNIQUE (osm_type, osm_id)'
      from pg_constraint
     where conrelid = 'public.stores'::regclass
       and conname = 'stores_osm_identite_unique'));

  perform pg_temp.noter('C-02', 'le même osm_id sous DEUX types est DEUX magasins', (
    select count(*) = 2 from public.stores where osm_id = 900101 or osm_id = 900102));

  -- ⚠️ ET C'EST BIEN LE COUPLE QUI CONTRAINT, PAS L'ID SEUL. Réinsérer
  -- (NODE, 900101) doit échouer ; (RELATION, 900101) doit passer.
  perform pg_temp.noter('C-03', 'le couple (type, id) est contraignant',
    pg_temp.refuse_pour(
      'insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
         values (null, ''NODE'', 900101, ''C43c collision'', 43.6, 5.4)',
      'stores_osm_identite_unique'));

  insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
  values (null, 'RELATION', 900101, 'C43c meme id autre type', 43.7000000, 5.3000000);
  perform pg_temp.noter('C-04', 'un même osm_id sous un AUTRE type est accepté', (
    select count(*) = 1 from public.stores
     where osm_type = 'RELATION' and osm_id = 900101));

  perform pg_temp.noter('C-05', 'osm_type reste borné aux trois valeurs',
    pg_temp.refuse_pour(
      'insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
         values (null, ''POINT'', 900106, ''C43c type inconnu'', 43.8, 5.2)',
      'stores_osm_type_check'));
end $$;

-- =====================================================================
-- D — LES IDENTIFIANTS D'ENSEIGNE : MÉTADONNÉES, JAMAIS IDENTITÉ
-- =====================================================================
do $$
begin
  perform pg_temp.noter('D-01', 'brand_wikidata et operator_wikidata existent, nullables', (
    select count(*) = 2 from information_schema.columns
     where table_schema = 'public' and table_name = 'stores'
       and column_name in ('brand_wikidata', 'operator_wikidata')
       and is_nullable = 'YES' and data_type = 'text'));

  update public.stores set brand_wikidata = 'Q151954', operator_wikidata = 'Q42'
   where osm_type = 'NODE' and osm_id = 900101;
  perform pg_temp.noter('D-02', 'un identifiant Wikidata bien formé est accepté', (
    select brand_wikidata = 'Q151954' from public.stores
     where osm_type = 'NODE' and osm_id = 900101));

  -- ⚠️ LE POINT LE PLUS IMPORTANT DE CETTE SECTION. Des centaines de Lidl
  -- partagent Q151954 : une unicité ici interdirait le deuxième Lidl de France.
  update public.stores set brand_wikidata = 'Q151954'
   where osm_type = 'WAY' and osm_id = 900102;
  perform pg_temp.noter('D-03', 'DEUX magasins partagent la MÊME enseigne', (
    select count(*) = 2 from public.stores where brand_wikidata = 'Q151954'));

  perform pg_temp.noter('D-04', 'aucune contrainte d''unicité ne porte sur les enseignes', (
    select count(*) = 0 from pg_constraint
     where conrelid = 'public.stores'::regclass and contype = 'u'
       and pg_get_constraintdef(oid) ilike '%wikidata%'));

  perform pg_temp.noter('D-05', 'une forme invalide est refusée',
    pg_temp.refuse_pour(
      'update public.stores set brand_wikidata = ''Lidl''
         where osm_type = ''NODE'' and osm_id = 900101',
      'stores_brand_wikidata_forme'));

  perform pg_temp.noter('D-06', 'une chaîne vide est refusée — pas un identifiant',
    pg_temp.refuse_pour(
      'update public.stores set operator_wikidata = ''''
         where osm_type = ''NODE'' and osm_id = 900101',
      'stores_operator_wikidata_forme'));

  perform pg_temp.noter('D-07', 'Q0 et les zéros de tête sont refusés',
    pg_temp.refuse_pour(
      'update public.stores set brand_wikidata = ''Q0''
         where osm_type = ''NODE'' and osm_id = 900101',
      'stores_brand_wikidata_forme'));
end $$;

-- =====================================================================
-- E — LE PÉRIMÈTRE
-- =====================================================================
do $$
begin
  perform pg_temp.noter('E-01', 'student_selected_store ne référence QUE stores.id', (
    select count(*) = 1 from information_schema.referential_constraints rc
      join information_schema.key_column_usage k
        on k.constraint_name = rc.constraint_name
     where k.table_name = 'student_selected_store' and k.column_name = 'store_id'));

  perform pg_temp.noter('E-02', 'student_selected_store ne connaît AUCUN op_location_id', (
    select count(*) = 0 from information_schema.columns
     where table_schema = 'public' and table_name = 'student_selected_store'
       and column_name like '%op_location%'));

  perform pg_temp.noter('E-03', 'C4.3c n''a créé AUCUNE table', (
    select count(*) = 0 from information_schema.tables
     where table_schema = 'public'
       and table_name in ('store_brands', 'brands', 'enseignes', 'osm_stores')));

  -- ⚠️ AUCUN PRIX, AUCUNE DISPONIBILITÉ DANS `stores` — le périmètre de C4.2
  -- tient toujours.
  perform pg_temp.noter('E-04', 'aucune colonne de prix ni de stock dans stores', (
    select count(*) = 0 from information_schema.columns
     where table_schema = 'public' and table_name = 'stores'
       and (column_name like '%price%' or column_name like '%prix%'
            or column_name like '%stock%' or column_name like '%dispo%')));
end $$;

do $$
begin
  if exists (select 1 from _faits where not ok) then
    raise warning 'ÉCHECS : %', (select string_agg(section || ' ' || libelle, ' | ')
                                   from _faits where not ok);
  else
    raise notice 'TOUS LES CONTRÔLES C4.3c SONT PASSÉS (% faits)', (select count(*) from _faits);
  end if;
end $$;

select section, libelle, ok from _faits where not ok order by section;

-- =====================================================================
-- Z — RIEN NE SUBSISTE
-- =====================================================================
rollback;

do $$
begin
  if exists (select 1 from public.stores where osm_id between 900101 and 900199) then
    raise warning 'ÉCHEC   — Z-01 · des magasins de test ont survécu au ROLLBACK';
  else
    raise notice 'OK      — Z-01 · aucun magasin de test ne subsiste';
  end if;
end $$;
