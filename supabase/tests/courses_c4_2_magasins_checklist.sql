-- ============================================================================
-- Checklist PostgreSQL — COURSES C4.2 : LE MAGASIN, ET LE MAGASIN CHOISI.
--
-- POURQUOI CE FICHIER EXISTE.
-- Une suite Node peut lire le TEXTE d'un `primary key` ou d'un `revoke`. Seule
-- PostgreSQL peut dire si un élève est RÉELLEMENT incapable d'écrire dans le
-- référentiel, si une seconde sélection est RÉELLEMENT refusée, et si l'élève B
-- voit RÉELLEMENT zéro ligne de l'élève A. Tout le reste est de la relecture.
--
-- ⚠️ AUCUN RÉSEAU. C4.2 ne parle à personne : les magasins de cette checklist
-- sont insérés à la main, avec le rôle qui a le droit de le faire. Ce n'est pas
-- un contournement, c'est le mode de remplissage réel du lot — la découverte,
-- donc l'arrivée d'un magasin par Open Prices, est le sujet de C4.3a.
--
-- CE QU'ELLE VÉRIFIE
--   A   la table `stores` : colonnes, clés, contraintes, bornes
--   B   l'identité empruntée : op_location_id, couple OSM, et deux magasins de
--       MÊME ENSEIGNE qui restent deux magasins différents
--   C   la serrure de `stores` : personne n'écrit depuis un navigateur
--   D   `student_selected_store` : un seul magasin actif, structurellement
--   E   la RLS : l'élève A, l'élève B, le coach, l'administrateur
--   F   les scénarios de vie : sélection initiale, remplacement, magasin
--       inexistant, deux élèves sur le même magasin, et la DATE DU CHOIX —
--       produite par la base, renouvelée sans que l'appelant la nomme, et
--       qu'un client `authenticated` ne peut pas fabriquer : ses privilèges
--       de colonne ne couvrent la date NI à l'INSERT NI à l'UPDATE
--   G   le périmètre : aucune colonne de prix, de disponibilité ni d'unité,
--       et non-régression de C2/C3/C4.1
--   Z   après le ROLLBACK, aucune donnée de test ne subsiste
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
-- LES ACTEURS — deux élèves, un coach, un administrateur
-- =====================================================================
create temporary table _acteurs (
  role_test text primary key, user_id uuid, student_id uuid
) on commit drop;

do $$
declare
  u_a uuid := gen_random_uuid(); u_b uuid := gen_random_uuid();
  u_coach uuid := gen_random_uuid(); u_admin uuid := gen_random_uuid();
  s_a uuid; s_b uuid;
begin
  insert into auth.users (id, email) values
    (u_a, 'c42-eleve-a@test.invalid'), (u_b, 'c42-eleve-b@test.invalid'),
    (u_coach, 'c42-coach@test.invalid'), (u_admin, 'c42-admin@test.invalid');

  insert into public.profiles (user_id, role) values
    (u_a, 'student'), (u_b, 'student'), (u_coach, 'coach'), (u_admin, 'admin');

  -- `status` est contraint par la table élève : on reprend la valeur qu'utilisent
  -- déjà les checklists C2 et C3, plutôt que de laisser jouer un défaut supposé.
  insert into public.students (user_id, first_name, last_name, email, status)
  values (u_a, 'Ada', 'C42A', 'c42-eleve-a@test.invalid', 'active') returning id into s_a;
  insert into public.students (user_id, first_name, last_name, email, status)
  values (u_b, 'Bo', 'C42B', 'c42-eleve-b@test.invalid', 'active') returning id into s_b;

  insert into _acteurs values
    ('eleve_a', u_a, s_a), ('eleve_b', u_b, s_b),
    ('coach', u_coach, null), ('admin', u_admin, null);
end $$;

-- Les magasins de référence : DEUX de la MÊME ENSEIGNE, dans la MÊME VILLE.
-- C'est le cas qui casserait toute identité fabriquée à partir du nom.
create temporary table _magasins (cle text primary key, id uuid) on commit drop;

do $$
declare a uuid; b uuid;
begin
  insert into public.stores
    (op_location_id, osm_type, osm_id, name, brand, city, postcode, country_code, lat, lon)
  values (900001, 'WAY', 872934393, 'Enseigne Nord', 'Enseigne', 'Villetest', '38100', 'FR',
          45.1793824, 5.7266610)
  returning id into a;

  insert into public.stores
    (op_location_id, osm_type, osm_id, name, brand, city, postcode, country_code, lat, lon)
  values (900002, 'NODE', 2415879881, 'Enseigne Sud', 'Enseigne', 'Villetest', '38100', 'FR',
          45.1880104, 5.7253841)
  returning id into b;

  insert into _magasins values ('a', a), ('b', b);
end $$;


-- =====================================================================
-- A — LA TABLE `stores`
-- =====================================================================
do $$
begin
  perform pg_temp.noter('A-01', 'la table stores existe', (
    select to_regclass('public.stores') is not null));

  perform pg_temp.noter('A-02', 'la clé primaire est id, seule', (
    select array_agg(a.attname::text order by a.attname::text) = array['id']
      from pg_constraint c
      join unnest(c.conkey) k on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
     where c.contype = 'p' and c.conrelid = 'public.stores'::regclass));

  perform pg_temp.noter('A-03', 'douze colonnes, pas une de plus', (
    select count(*) = 12 from information_schema.columns
     where table_schema = 'public' and table_name = 'stores'));

  perform pg_temp.noter('A-04', 'lat et lon sont numeric(11,7), jamais flottants', (
    select bool_and(data_type = 'numeric'
                    and numeric_precision = 11 and numeric_scale = 7)
      from information_schema.columns
     where table_schema = 'public' and table_name = 'stores'
       and column_name in ('lat', 'lon')));

  -- ⚠️ LE TYPE EST LU DANS LE CATALOGUE, PAS DANS LE TEXTE DE LA MIGRATION.
  -- Une regex TypeScript dit ce que le fichier ÉCRIT ; `information_schema`
  -- dit ce que PostgreSQL a réellement CRÉÉ. Les deux sont nécessaires : la
  -- première attrape une faute de frappe, la seconde attrape un type promu ou
  -- rétrogradé par une migration ultérieure.
  perform pg_temp.noter('A-04b',
    'op_location_id est bigint (64 bits) — l''amont est un BigAutoField', (
    select data_type = 'bigint' and numeric_precision = 64
      from information_schema.columns
     where table_schema = 'public' and table_name = 'stores'
       and column_name = 'op_location_id'));

  perform pg_temp.noter('A-04c', 'op_location_id est NOT NULL et UNIQUE', (
    select (select is_nullable = 'NO' from information_schema.columns
             where table_schema = 'public' and table_name = 'stores'
               and column_name = 'op_location_id')
       and (select count(*) = 1
              from pg_constraint c
              join unnest(c.conkey) k on true
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
             where c.conrelid = 'public.stores'::regclass and c.contype = 'u'
               and a.attname = 'op_location_id')));

  -- Il accepte réellement une valeur hors des 32 bits : la preuve par l'usage.
  perform pg_temp.noter('A-04d',
    'un identifiant amont au-delà de 2 147 483 647 est ACCEPTÉ', (
    select pg_temp.refuse_pour($q$
      insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
      values (4294967296, 'NODE', 987654321, 'Grand identifiant', 45.0, 5.0)$q$,
      'out of range') = false));

  perform pg_temp.noter('A-05', 'osm_id est bigint — les identifiants OSM dépassent 32 bits', (
    select data_type = 'bigint' from information_schema.columns
     where table_schema = 'public' and table_name = 'stores' and column_name = 'osm_id'));

  perform pg_temp.noter('A-06', 'name est NOT NULL, brand est NULLABLE', (
    select bool_and(case column_name when 'name' then is_nullable = 'NO'
                                     when 'brand' then is_nullable = 'YES' end)
      from information_schema.columns
     where table_schema = 'public' and table_name = 'stores'
       and column_name in ('name', 'brand')));

  perform pg_temp.noter('A-07', 'aucune colonne de mise à jour : rien ne modifie une ligne ici', (
    select count(*) = 0 from information_schema.columns
     where table_schema = 'public' and table_name = 'stores' and column_name = 'updated_at'));

  perform pg_temp.noter('A-08', 'un nom blanc est refusé', (
    select pg_temp.refuse_pour($q$
      insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
      values (900101, 'NODE', 111111, '   ', 45.0, 5.0)$q$, 'stores_name_non_vide')));

  perform pg_temp.noter('A-09', 'un osm_type inconnu est refusé', (
    select pg_temp.refuse_pour($q$
      insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
      values (900102, 'BUILDING', 111112, 'X', 45.0, 5.0)$q$, 'stores_osm_type_check')));

  perform pg_temp.noter('A-10', 'une latitude hors bornes est refusée', (
    select pg_temp.refuse_pour($q$
      insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
      values (900103, 'NODE', 111113, 'X', 200.0, 5.0)$q$, 'stores_lat_bornee')));

  perform pg_temp.noter('A-11', 'un code pays non ISO-2 est refusé', (
    select pg_temp.refuse_pour($q$
      insert into public.stores (op_location_id, osm_type, osm_id, name, country_code, lat, lon)
      values (900104, 'NODE', 111114, 'X', 'France', 45.0, 5.0)$q$, 'stores_country_code_iso')));
end $$;


-- =====================================================================
-- B — L'IDENTITÉ EST EMPRUNTÉE, JAMAIS FABRIQUÉE
-- =====================================================================
do $$
begin
  perform pg_temp.noter('B-01', 'op_location_id est unique', (
    select pg_temp.refuse_pour($q$
      insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
      values (900001, 'NODE', 222221, 'Doublon', 45.0, 5.0)$q$, 'op_location_id')));

  perform pg_temp.noter('B-02', 'le couple (osm_type, osm_id) est unique', (
    select pg_temp.refuse_pour($q$
      insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
      values (900201, 'WAY', 872934393, 'Doublon OSM', 45.0, 5.0)$q$,
      'stores_osm_identite_unique')));

  -- ⚠️ LE CONTRÔLE CENTRAL DU LOT. Même enseigne, même ville, même code postal :
  -- toute identité fabriquée à partir du nom les aurait fusionnés.
  perform pg_temp.noter('B-03',
    'deux magasins de MÊME ENSEIGNE et MÊME VILLE restent deux magasins', (
    select count(*) = 2 and count(distinct id) = 2
      from public.stores where brand = 'Enseigne' and city = 'Villetest'));

  -- Le même identifiant numérique sous un autre `osm_type` désigne un AUTRE
  -- objet OpenStreetMap : l'unicité porte sur le COUPLE, jamais sur `osm_id`.
  insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
  values (900202, 'RELATION', 872934393, 'Relation homonyme', 45.0, 5.0);
  perform pg_temp.noter('B-04', 'le même osm_id sous un autre osm_type est un AUTRE lieu', (
    select count(*) = 2 from public.stores where osm_id = 872934393));

  perform pg_temp.noter('B-05', 'aucune contrainte d''unicité ne porte sur name, brand ou city', (
    select count(*) = 0
      from pg_constraint c
      join unnest(c.conkey) k on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
     where c.conrelid = 'public.stores'::regclass
       and c.contype in ('p', 'u')
       and a.attname in ('name', 'brand', 'city', 'postcode', 'lat', 'lon')));
end $$;


-- =====================================================================
-- C — LA SERRURE DE `stores` : PERSONNE N'ÉCRIT DEPUIS UN NAVIGATEUR
-- =====================================================================
do $$
declare v_a uuid; v_admin uuid;
begin
  select user_id into v_a from _acteurs where role_test = 'eleve_a';
  select user_id into v_admin from _acteurs where role_test = 'admin';

  perform pg_temp.noter('C-01', 'authenticated n''a QUE select sur stores', (
    select array_agg(distinct privilege_type::text order by privilege_type::text)
           = array['SELECT']
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'stores' and grantee = 'authenticated'));

  perform pg_temp.noter('C-02', 'anon n''a AUCUN privilège sur stores', (
    select count(*) = 0 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'stores' and grantee = 'anon'));

  set local role authenticated;
  perform pg_temp.connecte(v_a);

  perform pg_temp.noter('C-03', 'un élève LIT le référentiel', (
    select count(*) >= 2 from public.stores));

  perform pg_temp.noter('C-04', 'un élève ne peut PAS insérer un magasin', (
    select pg_temp.refuse_pour($q$
      insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
      values (900301, 'NODE', 333331, 'Faux magasin', 45.0, 5.0)$q$, 'denied')));

  perform pg_temp.noter('C-05', 'un élève ne peut PAS modifier un magasin', (
    select pg_temp.refuse_pour(
      $q$update public.stores set name = 'Renommé'$q$, 'denied')));

  perform pg_temp.noter('C-06', 'un élève ne peut PAS supprimer un magasin', (
    select pg_temp.refuse_pour($q$delete from public.stores$q$, 'denied')));

  -- ⚠️ MÊME L'ADMINISTRATEUR : la serrure est un PRIVILÈGE, pas une policy, et
  -- `is_admin()` ne le rend pas capable d'écrire un référentiel externe.
  perform pg_temp.connecte(v_admin);
  perform pg_temp.noter('C-07', 'un administrateur non plus n''écrit dans stores', (
    select pg_temp.refuse_pour($q$
      insert into public.stores (op_location_id, osm_type, osm_id, name, lat, lon)
      values (900302, 'NODE', 333332, 'Admin', 45.0, 5.0)$q$, 'denied')));

  reset role;
end $$;


-- =====================================================================
-- D — UN SEUL MAGASIN ACTIF, STRUCTURELLEMENT
-- =====================================================================
do $$
begin
  perform pg_temp.noter('D-01', 'la table student_selected_store existe', (
    select to_regclass('public.student_selected_store') is not null));

  perform pg_temp.noter('D-02', 'la clé primaire est student_id, SEUL', (
    select array_agg(a.attname::text order by a.attname::text) = array['student_id']
      from pg_constraint c
      join unnest(c.conkey) k on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
     where c.contype = 'p' and c.conrelid = 'public.student_selected_store'::regclass));

  perform pg_temp.noter('D-03', 'trois colonnes, pas une de plus', (
    select count(*) = 3 from information_schema.columns
     where table_schema = 'public' and table_name = 'student_selected_store'));

  perform pg_temp.noter('D-04', 'store_id est NOT NULL', (
    select is_nullable = 'NO' from information_schema.columns
     where table_schema = 'public' and table_name = 'student_selected_store'
       and column_name = 'store_id'));

  perform pg_temp.noter('D-05', 'store_id référence stores en ON DELETE RESTRICT', (
    select c.confdeltype = 'r'
      from pg_constraint c
     where c.conrelid = 'public.student_selected_store'::regclass
       and c.contype = 'f' and c.confrelid = 'public.stores'::regclass));

  perform pg_temp.noter('D-06', 'student_id référence students en ON DELETE CASCADE', (
    select c.confdeltype = 'c'
      from pg_constraint c
     where c.conrelid = 'public.student_selected_store'::regclass
       and c.contype = 'f' and c.confrelid = 'public.students'::regclass));

  -- ⚠️ LA SERRURE TEMPORELLE, MOITIÉ 1 : le trigger du dépôt, pas une fonction
  -- neuve. On vérifie qu'il existe, qu'il est BEFORE UPDATE, et qu'il appelle
  -- bien `public.set_updated_at()` — celui que neuf autres tables utilisent.
  perform pg_temp.noter('D-08',
    'le trigger set_updated_at du dépôt est installé, BEFORE UPDATE', (
    select count(*) = 1
      from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = 'public.student_selected_store'::regclass
       and not t.tgisinternal
       and p.proname = 'set_updated_at'
       and (t.tgtype & 2) = 2      -- BEFORE
       and (t.tgtype & 16) = 16)); -- UPDATE

  -- ⚠️ MOITIÉ 2 : le GRANT DE COLONNE, doctrine de C2 (`checked`) et de C3
  -- (`budget_cents`). Il refuse la falsification avant même le déclencheur.
  perform pg_temp.noter('D-09',
    'l''élève ne peut modifier QUE store_id — jamais la date', (
    select array_agg(column_name::text order by column_name::text) = array['store_id']
      from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'student_selected_store'
       and privilege_type = 'UPDATE' and grantee = 'authenticated'));

  -- ⚠️ L'INSERT AUSSI EST NOMMÉ, ET C'EST LE CORRECTIF LE PLUS RÉCENT. Un
  -- `grant insert` de TABLE autorise toutes les colonnes : l'élève pouvait
  -- poser la date lui-même à la création de sa ligne, sans jamais heurter la
  -- RLS puisque la ligne était la sienne. Le trigger ne l'attrapait pas — il
  -- est `before UPDATE`. Ces deux contrôles lisent le catalogue, pas le texte.
  perform pg_temp.noter('D-10',
    'INSERT de l''élève : student_id et store_id, et RIEN d''autre', (
    select array_agg(column_name::text order by column_name::text)
           = array['store_id', 'student_id']
      from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'student_selected_store'
       and privilege_type = 'INSERT' and grantee = 'authenticated'));

  -- Un privilège accordé au niveau de la TABLE apparaît ici ; un privilège de
  -- colonne, non. C'est donc la lecture qui distingue les deux formes de grant.
  perform pg_temp.noter('D-11',
    'aucun privilège d''écriture au niveau de la TABLE pour l''élève', (
    select coalesce(array_agg(distinct privilege_type::text
                              order by privilege_type::text), array[]::text[])
           = array['DELETE', 'SELECT']
      from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'student_selected_store'
       and grantee = 'authenticated'));

  perform pg_temp.noter('D-07', 'aucune colonne d''ordre, de favori ni d''historique', (
    select count(*) = 0 from information_schema.columns
     where table_schema = 'public' and table_name = 'student_selected_store'
       and column_name in ('position', 'rank', 'is_active', 'archived_at',
                           'deleted_at', 'selected_at')));
end $$;


-- =====================================================================
-- E — LA RLS : L'ÉLÈVE A, L'ÉLÈVE B, LE COACH, L'ADMINISTRATEUR
-- =====================================================================
do $$
declare
  v_ua uuid; v_ub uuid; v_ucoach uuid; v_uadmin uuid;
  v_sa uuid; v_sb uuid; v_ma uuid; v_mb uuid; v_touchees int;
begin
  select user_id, student_id into v_ua, v_sa from _acteurs where role_test = 'eleve_a';
  select user_id, student_id into v_ub, v_sb from _acteurs where role_test = 'eleve_b';
  select user_id into v_ucoach from _acteurs where role_test = 'coach';
  select user_id into v_uadmin from _acteurs where role_test = 'admin';
  select id into v_ma from _magasins where cle = 'a';
  select id into v_mb from _magasins where cle = 'b';

  set local role authenticated;

  -- ── sélection initiale, par l'élève lui-même ──────────────────────────
  perform pg_temp.connecte(v_ua);
  execute format('insert into public.student_selected_store (student_id, store_id) values (%L, %L)',
                 v_sa, v_ma);
  perform pg_temp.noter('E-01', 'sélection initiale : l''élève A lit SON magasin', (
    select count(*) = 1 from public.student_selected_store where store_id = v_ma));

  perform pg_temp.noter('E-02', 'l''élève A ne peut pas écrire la sélection de l''élève B', (
    select pg_temp.refuse_pour(format(
      'insert into public.student_selected_store (student_id, store_id) values (%L, %L)',
      v_sb, v_ma), 'row-level security')));

  -- ── l'élève B : isolation ─────────────────────────────────────────────
  perform pg_temp.connecte(v_ub);
  perform pg_temp.noter('E-03', 'l''élève B ne voit AUCUNE ligne de l''élève A', (
    select count(*) = 0 from public.student_selected_store));

  -- ⚠️ La ligne n'est pas « protégée en écriture » : elle est INVISIBLE. Un
  -- `update` de l'élève B ne lève donc pas d'erreur, il ne touche RIEN — et
  -- c'est exactement ce qu'il faut mesurer, car un test qui attendrait une
  -- exception passerait vert le jour où la RLS disparaîtrait.
  begin
    execute format('update public.student_selected_store set store_id = %L where student_id = %L',
                   v_mb, v_sa);
    get diagnostics v_touchees = row_count;
  exception when others then v_touchees := -1;
  end;
  perform pg_temp.noter('E-04',
    'l''élève B ne modifie AUCUNE ligne de l''élève A (elle lui est invisible)',
    v_touchees = 0);

  -- deux élèves peuvent choisir LE MÊME magasin : rien ne l'interdit.
  execute format('insert into public.student_selected_store (student_id, store_id) values (%L, %L)',
                 v_sb, v_ma);
  perform pg_temp.noter('E-05', 'deux élèves peuvent sélectionner le même magasin', (
    select count(*) = 1 from public.student_selected_store where student_id = v_sb));

  -- ── le coach ne voit rien ─────────────────────────────────────────────
  perform pg_temp.connecte(v_ucoach);
  perform pg_temp.noter('E-06', 'le coach ne lit AUCUNE sélection — comme pour shopping_lists', (
    select count(*) = 0 from public.student_selected_store));

  -- ── l'administrateur, avec la capacité qui existait déjà ──────────────
  perform pg_temp.connecte(v_uadmin);
  perform pg_temp.noter('E-07', 'l''administrateur lit les deux sélections', (
    select count(*) = 2 from public.student_selected_store));

  reset role;
end $$;


-- =====================================================================
-- F — LES SCÉNARIOS DE VIE
-- =====================================================================
do $$
declare v_ua uuid; v_sa uuid; v_ma uuid; v_mb uuid; v_avant timestamptz; v_apres timestamptz;
begin
  select user_id, student_id into v_ua, v_sa from _acteurs where role_test = 'eleve_a';
  select id into v_ma from _magasins where cle = 'a';
  select id into v_mb from _magasins where cle = 'b';

  -- On repart d'une ardoise vierge pour cet élève.
  delete from public.student_selected_store where student_id = v_sa;

  set local role authenticated;
  perform pg_temp.connecte(v_ua);

  -- ── F-00a — LA TENTATIVE DE FABRIQUER LA DATE, SUR SA PROPRE LIGNE ─────
  -- ⚠️ `v_sa` EST BIEN L'ÉLÈVE CONNECTÉ : si l'insertion échoue, ce ne peut
  -- pas être la RLS. C'est le PRIVILÈGE DE COLONNE sur l'INSERT qui ferme la
  -- porte, et c'est exactement ce qu'on veut prouver.
  perform pg_temp.noter('F-00a',
    'un élève ne peut pas fournir la date à l''INSERT, même sur SA ligne', (
    select pg_temp.refuse_pour(format($q$
      insert into public.student_selected_store (student_id, store_id, updated_at)
      values (%L, %L, timestamptz '2000-01-01 00:00:00+00')$q$,
      v_sa, v_ma), 'denied')));

  -- ⚠️ FILET DE DIAGNOSTIC, PAS UN ASSOUPLISSEMENT. Si F-00a vient d'échouer,
  -- c'est que l'insertion antidatée est PASSÉE : la ligne existe, et F-00
  -- buterait sur la clé primaire, ce qui ferait ABANDONNER toute la checklist
  -- au lieu d'afficher ses autres verdicts. On nettoie donc avant de mesurer.
  delete from public.student_selected_store where student_id = v_sa;

  -- ── F-00 — LE GESTE RÉEL : deux colonnes, et la base fait le reste ─────
  execute format($q$
    insert into public.student_selected_store (student_id, store_id)
    values (%L, %L)$q$, v_sa, v_ma);

  select updated_at into v_apres from public.student_selected_store where student_id = v_sa;
  -- `now()` est l'horodatage de la TRANSACTION : le DEFAULT vaut donc
  -- exactement `now()` ici, et l'égalité est déterministe — pas un « à peu près ».
  perform pg_temp.noter('F-00',
    'INSERT sans nommer la date : PostgreSQL la produit lui-même', (
    select v_apres = now()));

  -- ── fixture pour mesurer le renouvellement ────────────────────────────
  -- ⚠️ CE N'EST PAS UNE PROPRIÉTÉ SOUHAITABLE, C'EST UN MONTAGE DE TEST, et il
  -- passe par un rôle PRIVILÉGIÉ. `now()` ne bouge pas à l'intérieur d'une
  -- transaction : comparer deux `now()` successifs ne prouverait rien. On pose
  -- donc une vieille date avec les droits du serveur — le trigger étant
  -- `before UPDATE`, il ne touche pas à un INSERT — puis on regarde si le
  -- geste de l'élève la renouvelle.
  set local role postgres;
  delete from public.student_selected_store where student_id = v_sa;
  execute format($q$
    insert into public.student_selected_store (student_id, store_id, updated_at)
    values (%L, %L, timestamptz '2020-01-01 00:00:00+00')$q$, v_sa, v_ma);
  select updated_at into v_avant from public.student_selected_store where student_id = v_sa;

  set local role authenticated;
  perform pg_temp.connecte(v_ua);

  -- ── remplacement : de A vers B, SANS jamais nommer la date ─────────────
  -- ⚠️ C'EST LE GESTE RÉEL DE L'ÉCRAN, et c'est tout ce qu'il écrit.
  execute format(
    'update public.student_selected_store set store_id = %L where student_id = %L',
    v_mb, v_sa);

  select updated_at into v_apres from public.student_selected_store where student_id = v_sa;
  perform pg_temp.noter('F-01b',
    'changer de magasin SANS nommer la date la renouvelle quand même', (
    select v_apres > v_avant));

  perform pg_temp.noter('F-01', 'remplacement : l''élève passe du magasin A au magasin B', (
    select store_id = v_mb from public.student_selected_store where student_id = v_sa));

  perform pg_temp.noter('F-02',
    'jamais deux lignes actives : une seule ligne subsiste après le remplacement', (
    select count(*) = 1 from public.student_selected_store where student_id = v_sa));

  -- ⚠️ ET LA SECONDE INSERTION EST REFUSÉE PAR LA BASE, pas par du code.
  perform pg_temp.noter('F-03', 'une seconde sélection pour le même élève est REFUSÉE', (
    select pg_temp.refuse_pour(format(
      'insert into public.student_selected_store (student_id, store_id) values (%L, %L)',
      v_sa, v_ma), 'student_selected_store_pkey')));

  -- ── un magasin inexistant est rejeté ──────────────────────────────────
  perform pg_temp.noter('F-04', 'sélectionner un magasin inexistant est refusé', (
    select pg_temp.refuse_pour(format(
      'update public.student_selected_store set store_id = %L where student_id = %L',
      gen_random_uuid(), v_sa), 'violates foreign key constraint')));

  -- ── l'upsert, geste réel de l'écran ───────────────────────────────────
  -- ⚠️ L'UPSERT NON PLUS NE NOMME PAS LA DATE. C'est le geste réel de l'écran :
  -- « choisis ce magasin », sans que l'appelant ait à penser à autre chose.
  execute format($q$
    insert into public.student_selected_store (student_id, store_id)
    values (%L, %L)
    on conflict (student_id) do update
      set store_id = excluded.store_id$q$, v_sa, v_ma);

  perform pg_temp.noter('F-05', 'l''upsert sur student_id remplace sans jamais dupliquer', (
    select count(*) = 1 and bool_and(store_id = v_ma)
      from public.student_selected_store where student_id = v_sa));

  -- ── l'autre verbe d'écriture : l'UPDATE ───────────────────────────────
  -- F-00a a fermé l'INSERT ; celui-ci ferme la mise à jour. Les deux portes
  -- sont nécessaires : fermer l'une seulement, c'était le défaut d'origine.
  perform pg_temp.noter('F-08',
    'un élève ne peut pas davantage écrire la date à l''UPDATE : privilège refusé', (
    select pg_temp.refuse_pour(format(
      'update public.student_selected_store set updated_at = %L where student_id = %L',
      timestamptz '2000-01-01 00:00:00+00', v_sa), 'denied')));

  reset role;
end $$;

do $$
declare v_sa uuid; v_ma uuid; v_date timestamptz;
begin
  select student_id into v_sa from _acteurs where role_test = 'eleve_a';
  select id into v_ma from _magasins where cle = 'a';

  -- Et le trigger agit quel que soit le rôle : une date fournie à un UPDATE
  -- est réécrite par `now()`. Ce n'est pas une garantie CONTRE le serveur —
  -- `service_role` reste un rôle de confiance et pourrait retirer le trigger —
  -- c'est la preuve que le mécanisme est bien branché sur la table.
  update public.student_selected_store
     set updated_at = timestamptz '2000-01-01 00:00:00+00'
   where student_id = v_sa;
  select updated_at into v_date from public.student_selected_store where student_id = v_sa;

  perform pg_temp.noter('F-09',
    'le trigger réécrit la date à chaque UPDATE, quel que soit le rôle', (
    select v_date > timestamptz '2020-01-01 00:00:00+00'));
end $$;

-- ── suppression d'un magasin choisi : refusée ───────────────────────────
do $$
declare v_ma uuid; v_sa uuid;
begin
  select id into v_ma from _magasins where cle = 'a';
  select student_id into v_sa from _acteurs where role_test = 'eleve_a';

  perform pg_temp.noter('F-06', 'supprimer un magasin choisi par quelqu''un est REFUSÉ', (
    select pg_temp.refuse_pour(format('delete from public.stores where id = %L', v_ma),
                               'violates foreign key constraint')));

  delete from public.students where id = v_sa;
  perform pg_temp.noter('F-07', 'supprimer l''élève emporte SA sélection, et elle seule', (
    select (select count(*) from public.student_selected_store where student_id = v_sa) = 0
       and (select count(*) from public.stores where id = v_ma) = 1));
end $$;


-- =====================================================================
-- G — PÉRIMÈTRE ET NON-RÉGRESSION
-- =====================================================================
do $$
begin
  -- ⚠️ AUCUNE COLONNE DE PRIX, DE DISPONIBILITÉ NI D'UNITÉ dans les deux
  -- tables neuves. La disponibilité n'est pas reportée : elle n'existe pas
  -- chez la source, qui publie des observations datées.
  perform pg_temp.noter('G-01', 'aucune colonne de montant, de remise ou de disponibilité', (
    select count(*) = 0 from information_schema.columns
     where table_schema = 'public'
       and table_name in ('stores', 'student_selected_store')
       and (column_name ~* 'price|cent|milli|currency|euro|discount|promo'
         or column_name ~* 'stock|availab|inventor|disponib')));

  perform pg_temp.noter('G-02', 'aucune colonne d''unité — le CONTRACT reste hors de portée', (
    select count(*) = 0 from information_schema.columns
     where table_schema = 'public'
       and table_name in ('stores', 'student_selected_store')
       and column_name ~* 'unit'));

  -- ⚠️ Le motif est ancré, et ce n'est pas de la coquetterie : un `~* 'count'`
  -- nu accusait `country_code`, qui contient « count ». Un test qui rougit
  -- pour une sous-chaîne fortuite finit par être neutralisé au lieu d'être lu.
  perform pg_temp.noter('G-03', 'aucun compteur de relevés : il appartient à la découverte', (
    select count(*) = 0 from information_schema.columns
     where table_schema = 'public' and table_name = 'stores'
       and column_name ~* '(^|_)count$'));

  -- Non-régression : les structures des lots précédents sont intactes.
  perform pg_temp.noter('G-04', 'C2 intact : shopping_lists et ses lignes', (
    select to_regclass('public.shopping_lists') is not null
       and to_regclass('public.shopping_list_items') is not null));

  perform pg_temp.noter('G-05', 'C3 intact : budget_cents et le grant de colonne', (
    select count(*) = 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'shopping_lists'
       and column_name = 'budget_cents'));

  perform pg_temp.noter('G-06', 'C4.1 intact : la table de revue et son refus de « matched »', (
    select to_regclass('public.food_catalog_retail_review') is not null
       and not exists (
         select 1 from pg_constraint
          where conrelid = 'public.food_catalog_retail_review'::regclass
            and contype = 'c' and pg_get_constraintdef(oid) ilike '%matched%')));

  perform pg_temp.noter('G-07', 'la serrure de food_products n''a pas bougé', (
    select array_agg(distinct privilege_type::text order by privilege_type::text)
           = array['SELECT']
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'food_products'
       and grantee = 'authenticated'));
end $$;


-- =====================================================================
-- SYNTHÈSE
-- =====================================================================
do $$
declare v_total int; v_ko int;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_ko from _faits;
  raise notice '────────────────────────────────────────────────────────';
  raise notice 'C4.2 — MAGASINS : % contrôles, % en échec', v_total, v_ko;
  raise notice '────────────────────────────────────────────────────────';
  if v_ko > 0 then
    raise warning 'ÉCHECS : %', (select string_agg(section || ' ' || libelle, ' | ')
                                   from _faits where not ok);
  end if;
end $$;

select section, libelle, ok from _faits where not ok order by section;

-- =====================================================================
-- Z — RIEN NE SUBSISTE
-- =====================================================================
rollback;

do $$
begin
  if exists (select 1 from public.stores where op_location_id between 900001 and 900999) then
    raise warning 'ÉCHEC   — Z-01 · des magasins de test ont survécu au ROLLBACK';
  else
    raise notice 'OK      — Z-01 · aucun magasin de test ne subsiste';
  end if;
  if exists (select 1 from public.students where email like 'c42-%@test.invalid') then
    raise warning 'ÉCHEC   — Z-02 · des élèves de test ont survécu au ROLLBACK';
  else
    raise notice 'OK      — Z-02 · aucun élève de test ne subsiste';
  end if;
end $$;
