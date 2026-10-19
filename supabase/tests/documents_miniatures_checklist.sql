-- ════════════════════════════════════════════════════════════════════════════
-- MINIATURES DE DOCUMENTS — DROITS RÉELS SUR LE SEAU « document-covers »
-- ════════════════════════════════════════════════════════════════════════════
-- À EXÉCUTER SUR LA BASE LOCALE UNIQUEMENT, jamais sur la production.
--
--     npm run db:local:init
--     psql "$DATABASE_URL_LOCAL" -f supabase/tests/documents_miniatures_checklist.sql
--
-- Ce que cette checklist prouve, et que le harnais TypeScript ne peut pas
-- prouver : les DROITS. Aucune policy ne s'exécute dans un test de rendu.
-- Ici, chaque acteur formule ses propres requêtes, dans sa propre session,
-- exactement comme un appel PostgREST direct — et c'est la base qui répond.
--
-- ⚠️ SIX ACTEURS, ET CHACUN POUR UNE RAISON.
--   · l'administrateur  → il ne doit RIEN perdre ;
--   · le coach A        → le propriétaire des miniatures ;
--   · le coach B        → celui qui ne doit ni les voir, ni les remplacer,
--                         ni les supprimer ;
--   · l'élève de A      → il doit voir les miniatures de CE qu'il a le droit
--                         de lire, et rien de plus ;
--   · l'élève de B      → il ne doit voir aucune miniature de A ;
--   · le visiteur anon  → aucune miniature, et aucune policy qui LÈVE (une
--                         policy qui lève fait échouer toute la requête).
--
-- ⚠️ UN REFUS REND -1, JAMAIS 0 pour les lectures. « Refusé » et « rien
-- trouvé » sont deux résultats différents, et c'est toute la question ici.
--
-- ⚠️ CE QUE CETTE CHECKLIST NE PRÉTEND PAS MESURER. Le déblocage progressif
-- n'est pas un critère de la policy, VOLONTAIREMENT (voir la section F) : la
-- miniature d'un document assigné s'affiche même avant sa date, et c'est le
-- FICHIER du document — autre seau, autre policy, plus la garde applicative —
-- qui reste inaccessible. Ce point est mesuré côté application par
-- scripts/tests/documents-miniatures.mts (C-5, C-6).
--
-- Tout se termine par un ROLLBACK : rien n'est écrit.

\set ON_ERROR_STOP on

begin;

create temporary table _faits (section text, libelle text, ok boolean) on commit drop;

create or replace function pg_temp.noter(p_section text, p_libelle text, p_ok boolean)
returns void language plpgsql as $$
begin
  insert into _faits values (p_section, p_libelle, p_ok);
  if p_ok then raise notice 'OK      — %', p_libelle;
  else raise warning 'ÉCHEC   — %', p_libelle; end if;
end $$;

/**
 * Redevenir le SERVEUR : rôle ET revendications remises à zéro.
 *
 * ⚠️ `reset role` NE SUFFIT PAS : il laisse `request.jwt.claims`, donc
 * `auth.uid()` continuerait de désigner le dernier acteur et le décor inséré
 * « en postgres » serait jugé comme lui.
 */
create or replace function pg_temp.serveur() returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

create or replace function pg_temp.devenir(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.lire(p_user uuid, p_sql text) returns int
language plpgsql as $$
declare v int;
begin
  perform pg_temp.devenir(p_user);
  begin execute p_sql into v; exception when others then v := -1; end;
  perform pg_temp.serveur(); return coalesce(v, 0);
end $$;

create or replace function pg_temp.lire_anon(p_sql text) returns int
language plpgsql as $$
declare v int;
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin execute p_sql into v; exception when others then v := -1; end;
  perform pg_temp.serveur(); return coalesce(v, 0);
end $$;

/**
 * Écriture : rend le NOMBRE DE LIGNES touchées, ou -1 si la commande a été
 * refusée.
 *
 * ⚠️ 0 ET -1 NE DISENT PAS LA MÊME CHOSE. « Aucune ligne touchée » (la policy
 * a filtré) et « refusé » (le `with check` a dit non) sont deux refus
 * légitimes ; un UPDATE ou un DELETE qui rend 1 est une fuite.
 */
create or replace function pg_temp.ecrit(p_user uuid, p_sql text) returns int
language plpgsql as $$
declare v int;
begin
  perform pg_temp.devenir(p_user);
  begin
    execute p_sql; get diagnostics v = row_count;
  exception when others then
    v := -1;
  end;
  perform pg_temp.serveur(); return coalesce(v, 0);
end $$;

create or replace function pg_temp.ecrit_anon(p_sql text) returns int
language plpgsql as $$
declare v int;
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin
    execute p_sql; get diagnostics v = row_count;
  exception when others then v := -1; end;
  perform pg_temp.serveur(); return coalesce(v, 0);
end $$;


-- ── A. LE DÉCOR ────────────────────────────────────────────────────────────
-- Huit documents, pour couvrir chaque règle d'accès une fois, et une miniature
-- par document — sauf le dernier, laissé SANS couverture : c'est l'état des
-- documents antérieurs à ce lot, et il doit continuer de fonctionner.
do $$
declare
  u_adm   constant uuid := '00000000-0000-4000-8000-00000000f001';
  u_a     constant uuid := '00000000-0000-4000-8000-00000000f002';
  u_b     constant uuid := '00000000-0000-4000-8000-00000000f003';
  u_el_a  constant uuid := '00000000-0000-4000-8000-00000000f004';
  u_el_b  constant uuid := '00000000-0000-4000-8000-00000000f005';
  c_adm   constant uuid := '00000000-0000-4000-8000-00000000f101';
  c_a     constant uuid := '00000000-0000-4000-8000-00000000f102';
  c_b     constant uuid := '00000000-0000-4000-8000-00000000f103';
  e_a     constant uuid := '00000000-0000-4000-8000-00000000f201';
  e_b     constant uuid := '00000000-0000-4000-8000-00000000f202';
  d_glob    constant uuid := '00000000-0000-4000-8000-00000000f301';
  d_assigne constant uuid := '00000000-0000-4000-8000-00000000f302';
  d_brouill constant uuid := '00000000-0000-4000-8000-00000000f303';
  d_archive constant uuid := '00000000-0000-4000-8000-00000000f304';
  d_nonaff  constant uuid := '00000000-0000-4000-8000-00000000f305';
  d_hist    constant uuid := '00000000-0000-4000-8000-00000000f306';
  d_b       constant uuid := '00000000-0000-4000-8000-00000000f307';
  d_sans    constant uuid := '00000000-0000-4000-8000-00000000f308';
  d_verrou  constant uuid := '00000000-0000-4000-8000-00000000f309';
  d_orphe   constant uuid := '00000000-0000-4000-8000-00000000f310';
  -- Le FONDS COMMUN DU CABINET : `coach_id IS NULL`. Trois états de plus que
  -- `d_hist`, pour éprouver que la couverture ne dispense d'AUCUNE règle.
  d_fc_brou constant uuid := '00000000-0000-4000-8000-00000000f311';
  d_fc_arch constant uuid := '00000000-0000-4000-8000-00000000f312';
  d_fc_assi constant uuid := '00000000-0000-4000-8000-00000000f313';
begin
  perform pg_temp.serveur();

  insert into auth.users (id, email) values
    (u_adm,'mn.adm@test.local'), (u_a,'mn.a@test.local'), (u_b,'mn.b@test.local'),
    (u_el_a,'mn.eleve.a@test.local'), (u_el_b,'mn.eleve.b@test.local');
  insert into public.profiles (user_id, email, role, first_name, last_name) values
    (u_adm,'mn.adm@test.local','admin','MN','Admin'),
    (u_a,'mn.a@test.local','coach','MN','CoachA'),
    (u_b,'mn.b@test.local','coach','MN','CoachB'),
    (u_el_a,'mn.eleve.a@test.local','student','MN','EleveA'),
    (u_el_b,'mn.eleve.b@test.local','student','MN','EleveB');
  -- `assistant` = coach autonome : c'est l'étiquette qui rendait
  -- `est_staff_global()` vrai, donc le cas le plus permissif à éprouver.
  insert into public.coaches (id, user_id, email, name, role, status, specialty) values
    (c_adm, u_adm,'mn.adm@test.local','MN Admin','admin','actif','-'),
    (c_a,   u_a,  'mn.a@test.local','MN CoachA','assistant','actif','-'),
    (c_b,   u_b,  'mn.b@test.local','MN CoachB','assistant','actif','-');
  insert into public.students (id, user_id, coach_id, first_name, last_name, email, status, access_type) values
    (e_a, u_el_a, c_a,'MN','EleveA','mn.eleve.a@test.local','active','coaching'),
    (e_b, u_el_b, c_b,'MN','EleveB','mn.eleve.b@test.local','active','coaching');

  -- ⚠️ LE CHEMIN DE LA MINIATURE EST ÉCRIT EN BASE, PAS UNE URL. C'est ce
  -- texte-là que la policy du seau confronte à la fiche de l'appelant.
  insert into public.documents (id, coach_id, title, type, category, status, visibility, cover_storage_path) values
    (d_glob,    c_a,  'MN publié global',     'pdf','administratif','publié',   'global',   c_a::text || '/' || d_glob::text    || '/1-cover.png'),
    (d_assigne, c_a,  'MN publié assigné',    'pdf','administratif','publié',   'assigned', c_a::text || '/' || d_assigne::text || '/1-cover.png'),
    (d_brouill, c_a,  'MN brouillon',         'pdf','administratif','brouillon','global',   c_a::text || '/' || d_brouill::text || '/1-cover.png'),
    (d_archive, c_a,  'MN archivé',           'pdf','administratif','archivé',  'global',   c_a::text || '/' || d_archive::text || '/1-cover.png'),
    (d_nonaff,  c_a,  'MN publié non assigné','pdf','administratif','publié',   'assigned', c_a::text || '/' || d_nonaff::text  || '/1-cover.png'),
    (d_hist,    null, 'MN historique',        'pdf','administratif','publié',   'global',   c_adm::text || '/' || d_hist::text  || '/1-cover.png'),
    (d_b,       c_b,  'MN doc du coach B',    'pdf','administratif','publié',   'global',   c_b::text || '/' || d_b::text       || '/1-cover.png'),
    (d_sans,    c_a,  'MN sans couverture',   'pdf','administratif','publié',   'global',   null),
    (d_verrou,  c_a,  'MN assigné verrouillé','pdf','administratif','publié',   'assigned', c_a::text || '/' || d_verrou::text  || '/1-cover.png'),
    -- ⚠️ FONDS COMMUN : `coach_id` NULL, trois états NON lisibles par l'élève.
    -- Leur couverture est rangée sous la fiche de l'administrateur, qui est le
    -- seul membre du staff à gérer ce fonds.
    (d_fc_brou, null, 'MN fonds brouillon',   'pdf','administratif','brouillon','global',   c_adm::text || '/' || d_fc_brou::text || '/1-cover.png'),
    (d_fc_arch, null, 'MN fonds archivé',     'pdf','administratif','archivé',  'global',   c_adm::text || '/' || d_fc_arch::text || '/1-cover.png'),
    (d_fc_assi, null, 'MN fonds non affecté', 'pdf','administratif','publié',   'assigned', c_adm::text || '/' || d_fc_assi::text || '/1-cover.png');

  -- Affectations : l'élève de A reçoit le document assigné, et le verrouillé
  -- avec une date de déblocage dans le futur.
  insert into public.document_assignments (student_id, document_id) values (e_a, d_assigne);
  insert into public.document_assignments (student_id, document_id, unlock_at)
    values (e_a, d_verrou, now() + interval '60 days');

  -- Les objets du seau, insérés EN SERVEUR pour pouvoir mesurer la lecture.
  -- Convention : <fiche_coach>/<document_id>/<horodatage>-<nom>.
  insert into storage.objects (bucket_id, name)
  select 'document-covers', cover_storage_path
    from public.documents
   where cover_storage_path is not null
     and title like 'MN %';

  -- ⚠️ UN ORPHELIN : l'objet existe, sa ligne `documents` N'EXISTE PAS. Son
  -- préfixe est la fiche du coach A — c'est la seule chose qui le protège.
  insert into storage.objects (bucket_id, name)
  values ('document-covers', c_a::text || '/' || d_orphe::text || '/1-orphelin.png');
end $$;

do $$ declare s text; begin
  s := (select nspname from pg_namespace where oid = pg_my_temp_schema());
  execute format('grant usage on schema %I to authenticated, anon', s);
  execute format('grant insert, select on %I._faits to authenticated, anon', s);
end $$;


-- ── B. LA COLONNE : ADDITIVE, NULLABLE, SANS REPRISE ───────────────────────
do $$
declare
  u_a      constant uuid := '00000000-0000-4000-8000-00000000f002';
  c_a      constant uuid := '00000000-0000-4000-8000-00000000f102';
  d_sans   constant uuid := '00000000-0000-4000-8000-00000000f308';
  v_neuf uuid;
begin
  perform pg_temp.noter('B','B1. `cover_storage_path` existe, en texte, nullable et sans défaut',
    exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='documents'
               and column_name='cover_storage_path' and data_type='text'
               and is_nullable='YES' and column_default is null));

  perform pg_temp.noter('B','B2. un document SANS couverture porte bien NULL',
    (select cover_storage_path from public.documents where id = d_sans) is null);

  -- ⚠️ LE CONTRÔLE DE COMPATIBILITÉ : un document créé sans mentionner la
  -- colonne n'en reçoit aucune valeur. C'est l'état des documents antérieurs.
  perform pg_temp.devenir(u_a);
  insert into public.documents (title, type, category, status, visibility)
  values ('MN créé sans couverture','pdf','administratif','publié','global')
  returning id into v_neuf;
  perform pg_temp.serveur();
  perform pg_temp.noter('B','B3. un document créé sans mentionner la colonne reste sans couverture',
    (select cover_storage_path from public.documents where id = v_neuf) is null);
  perform pg_temp.noter('B','B4. …et son propriétaire a bien été posé par le déclencheur',
    (select coach_id from public.documents where id = v_neuf) = c_a);
end $$;


-- ── C. LE SEAU : PRIVÉ, PLAFONNÉ, SANS SVG ─────────────────────────────────
do $$
declare v record;
begin
  select public, file_size_limit, allowed_mime_types into v
    from storage.buckets where id = 'document-covers';

  perform pg_temp.noter('C','C1. le seau `document-covers` existe', v is not null);
  perform pg_temp.noter('C','C2. …et il est PRIVÉ : aucune URL publique ne contourne la policy',
    v.public = false);
  perform pg_temp.noter('C','C3. …plafonné à 5 Mo, par le SERVEUR et pas par le navigateur',
    v.file_size_limit = 5242880);
  perform pg_temp.noter('C','C4. …borné à jpeg, png et webp',
    v.allowed_mime_types @> array['image/jpeg','image/png','image/webp']
    and array_length(v.allowed_mime_types, 1) = 3);
  perform pg_temp.noter('C','C5. …et le SVG en est exclu (XML exécutable dans une balise img)',
    not ('image/svg+xml' = any(v.allowed_mime_types)));

  -- ⚠️ ET LE SEAU `documents` N'A PAS BOUGÉ : ce lot ne le rend pas public et
  -- ne lui pose aucun plafond (il héberge des PDF de 25 Mo et des vidéos).
  perform pg_temp.noter('C','C6. le seau `documents` reste privé',
    exists (select 1 from storage.buckets where id='documents' and public = false));
  perform pg_temp.noter('C','C7. …et sans plafond d''image, qui aurait cassé les vidéos',
    (select file_size_limit from storage.buckets where id='documents') is null
    and (select allowed_mime_types from storage.buckets where id='documents') is null);

  perform pg_temp.noter('C','C8. les quatre policies du seau existent, au rôle authentifié',
    (select count(*) from pg_policies
      where schemaname='storage' and tablename='objects'
        and policyname like 'document_covers%' and roles::text='{authenticated}') = 4);
end $$;


-- ── D. ISOLATION ENTRE COACHS — LECTURE ────────────────────────────────────
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000f001';
  u_a    constant uuid := '00000000-0000-4000-8000-00000000f002';
  u_b    constant uuid := '00000000-0000-4000-8000-00000000f003';
  c_a    constant uuid := '00000000-0000-4000-8000-00000000f102';
  c_b    constant uuid := '00000000-0000-4000-8000-00000000f103';
  d_glob constant uuid := '00000000-0000-4000-8000-00000000f301';
  d_b    constant uuid := '00000000-0000-4000-8000-00000000f307';
  d_orphe constant uuid := '00000000-0000-4000-8000-00000000f310';
begin
  -- Le coach A voit ses SEPT miniatures : six documents illustrés (le global,
  -- l'assigné, le brouillon, l'archivé, le non affecté, le verrouillé) plus
  -- l'orphelin. Le fonds commun est rangé sous la fiche de l'administrateur,
  -- et le document du coach B sous la sienne.
  perform pg_temp.noter('D','D1. le coach A voit les sept miniatures rangées sous SA fiche',
    pg_temp.lire(u_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name like %L$q$, c_a::text || '/%')) = 7);

  -- ⚠️ LE CONTRÔLE QUI PORTE LE LOT : le coach B ne voit RIEN de A.
  perform pg_temp.noter('D','D2. le coach B ne voit AUCUNE miniature du coach A',
    pg_temp.lire(u_b, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name like %L$q$, c_a::text || '/%')) = 0);
  perform pg_temp.noter('D','D3. …même en désignant l''objet par son nom exact',
    pg_temp.lire(u_b, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_a::text || '/' || d_glob::text || '/1-cover.png')) = 0);
  perform pg_temp.noter('D','D4. …et il ne voit pas davantage l''ORPHELIN du coach A',
    pg_temp.lire(u_b, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_a::text || '/' || d_orphe::text || '/1-orphelin.png')) = 0);

  perform pg_temp.noter('D','D5. le coach B voit la SIENNE',
    pg_temp.lire(u_b, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name like %L$q$, c_b::text || '/%')) = 1);
  perform pg_temp.noter('D','D6. et le coach A ne voit pas celle du coach B',
    pg_temp.lire(u_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_b::text || '/' || d_b::text || '/1-cover.png')) = 0);

  -- ⚠️ LE TOTAL SE DÉDUIT, IL NE SE RÉCITE PAS. Un nombre écrit en dur ici
  -- devrait être recompté à chaque document ajouté au décor, et finirait par
  -- mentir — on compare donc à ce que le serveur voit, RLS hors jeu.
  perform pg_temp.noter('D','D7. l''administrateur, lui, voit toutes les miniatures',
    pg_temp.lire(u_adm, $q$select count(*) from storage.objects where bucket_id='document-covers'$q$)
      = (select count(*) from storage.objects where bucket_id='document-covers'));
end $$;


-- ── E. ISOLATION ENTRE COACHS — ÉCRITURE ───────────────────────────────────
do $$
declare
  u_adm  constant uuid := '00000000-0000-4000-8000-00000000f001';
  u_a    constant uuid := '00000000-0000-4000-8000-00000000f002';
  u_b    constant uuid := '00000000-0000-4000-8000-00000000f003';
  c_a    constant uuid := '00000000-0000-4000-8000-00000000f102';
  c_b    constant uuid := '00000000-0000-4000-8000-00000000f103';
  d_glob constant uuid := '00000000-0000-4000-8000-00000000f301';
  d_orphe constant uuid := '00000000-0000-4000-8000-00000000f310';
  v_nom  text;
  v_orphelin text;
begin
  v_nom := c_a::text || '/' || d_glob::text || '/1-cover.png';
  v_orphelin := c_a::text || '/' || d_orphe::text || '/1-orphelin.png';

  perform pg_temp.noter('E','E1. le coach B ne SUPPRIME pas la miniature du coach A',
    pg_temp.ecrit(u_b, format($q$delete from storage.objects
      where bucket_id='document-covers' and name=%L$q$, v_nom)) <= 0);
  perform pg_temp.noter('E','E2. …et elle est toujours là',
    (select count(*) from storage.objects where bucket_id='document-covers' and name = v_nom) = 1);

  perform pg_temp.noter('E','E3. le coach B ne REMPLACE pas la miniature du coach A',
    pg_temp.ecrit(u_b, format($q$update storage.objects set updated_at=now()
      where bucket_id='document-covers' and name=%L$q$, v_nom)) <= 0);

  -- ⚠️ LE CAS D'UNE REQUÊTE FORGÉE : écrire SOUS LE PRÉFIXE D'UN AUTRE. C'est
  -- le `with check` qui doit refuser, pas la bonne volonté du navigateur.
  perform pg_temp.noter('E','E4. le coach B ne TÉLÉVERSE rien sous le préfixe du coach A',
    pg_temp.ecrit(u_b, format($q$insert into storage.objects (bucket_id, name)
      values ('document-covers', %L)$q$, c_a::text || '/forge/1-vol.png')) = -1);

  perform pg_temp.noter('E','E5. le coach B téléverse sous SON préfixe : accepté',
    pg_temp.ecrit(u_b, format($q$insert into storage.objects (bucket_id, name)
      values ('document-covers', %L)$q$, c_b::text || '/neuf/1-ok.png')) = 1);

  -- ⚠️ SANS `with check` SUR L'UPDATE, un objet autorisé pourrait être
  -- DÉPLACÉ chez un autre coach. On mesure le déplacement, pas l'intention.
  perform pg_temp.noter('E','E6. le coach B ne DÉPLACE pas sa miniature sous le préfixe du coach A',
    pg_temp.ecrit(u_b, format($q$update storage.objects set name=%L
      where bucket_id='document-covers' and name=%L$q$,
      c_a::text || '/vol/1-vol.png', c_b::text || '/neuf/1-ok.png')) <= 0);

  perform pg_temp.noter('E','E7. l''ORPHELIN du coach A n''est pas manipulable par le coach B',
    pg_temp.ecrit(u_b, format($q$delete from storage.objects
      where bucket_id='document-covers' and name=%L$q$, v_orphelin)) <= 0);
  perform pg_temp.noter('E','E8. …et il est toujours là',
    (select count(*) from storage.objects where bucket_id='document-covers' and name = v_orphelin) = 1);
  perform pg_temp.noter('E','E9. son propriétaire, LUI, le supprime',
    pg_temp.ecrit(u_a, format($q$delete from storage.objects
      where bucket_id='document-covers' and name=%L$q$, v_orphelin)) = 1);

  perform pg_temp.noter('E','E10. le coach A remplace la SIENNE : accepté',
    pg_temp.ecrit(u_a, format($q$update storage.objects set updated_at=now()
      where bucket_id='document-covers' and name=%L$q$, v_nom)) = 1);
  perform pg_temp.noter('E','E11. l''administrateur supprime n''importe laquelle',
    pg_temp.ecrit(u_adm, format($q$delete from storage.objects
      where bucket_id='document-covers' and name=%L$q$, v_nom)) = 1);
end $$;


-- ── F. DROITS DES ÉLÈVES — PUBLICATION ET AFFECTATION ──────────────────────
-- ⚠️ CETTE SECTION EST LE CŒUR DU LOT. Une miniature ne doit JAMAIS rendre
-- visible un document que l'élève n'a pas le droit de lire.
do $$
declare
  u_el_a    constant uuid := '00000000-0000-4000-8000-00000000f004';
  u_el_b    constant uuid := '00000000-0000-4000-8000-00000000f005';
  c_a       constant uuid := '00000000-0000-4000-8000-00000000f102';
  c_adm     constant uuid := '00000000-0000-4000-8000-00000000f101';
  c_b       constant uuid := '00000000-0000-4000-8000-00000000f103';
  d_assigne constant uuid := '00000000-0000-4000-8000-00000000f302';
  d_brouill constant uuid := '00000000-0000-4000-8000-00000000f303';
  d_archive constant uuid := '00000000-0000-4000-8000-00000000f304';
  d_nonaff  constant uuid := '00000000-0000-4000-8000-00000000f305';
  d_hist    constant uuid := '00000000-0000-4000-8000-00000000f306';
  d_b       constant uuid := '00000000-0000-4000-8000-00000000f307';
  d_verrou  constant uuid := '00000000-0000-4000-8000-00000000f309';
  function_nom text;
begin
  -- Le document publié global de SON coach : visible. (Sa miniature a été
  -- supprimée par l'administrateur en E11 — on mesure donc l'ASSIGNÉ.)
  perform pg_temp.noter('F','F1. l''élève de A voit la miniature du document qui lui est ASSIGNÉ',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_a::text || '/' || d_assigne::text || '/1-cover.png')) = 1);

  perform pg_temp.noter('F','F2. …et celle du fonds commun du cabinet (document sans propriétaire)',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_adm::text || '/' || d_hist::text || '/1-cover.png')) = 1);

  -- ⚠️ ET MAINTENANT TOUT CE QU'IL NE DOIT PAS VOIR.
  perform pg_temp.noter('F','F3. un BROUILLON ne montre pas sa miniature',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_a::text || '/' || d_brouill::text || '/1-cover.png')) = 0);
  perform pg_temp.noter('F','F4. un document ARCHIVÉ ne montre pas sa miniature',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_a::text || '/' || d_archive::text || '/1-cover.png')) = 0);
  perform pg_temp.noter('F','F5. un document publié mais NON AFFECTÉ ne montre pas sa miniature',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_a::text || '/' || d_nonaff::text || '/1-cover.png')) = 0);
  perform pg_temp.noter('F','F6. le document global d''un AUTRE coach ne montre pas sa miniature',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_b::text || '/' || d_b::text || '/1-cover.png')) = 0);

  perform pg_temp.noter('F','F7. l''élève du coach B ne voit AUCUNE miniature du coach A',
    pg_temp.lire(u_el_b, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name like %L$q$, c_a::text || '/%')) = 0);

  -- ⚠️ LE DÉBLOCAGE PROGRESSIF N'EST PAS UN CRITÈRE ICI, ET C'EST LA DÉCISION
  -- PRISE : la miniature d'un document assigné s'affiche même avant sa date.
  -- Elle ANNONCE un contenu, elle ne le divulgue pas. Le FICHIER du document
  -- reste gouverné par le seau `documents` et par la garde applicative.
  perform pg_temp.noter('F','F8. un document assigné mais pas encore DÉBLOQUÉ montre sa miniature (décision assumée)',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_a::text || '/' || d_verrou::text || '/1-cover.png')) = 1);
  perform pg_temp.noter('F','F9. …et son FICHIER, dans l''autre seau, n''a pas été rendu accessible pour autant',
    pg_temp.lire(u_el_a, $q$select count(*) from storage.objects where bucket_id='documents'$q$) = 0);

  -- Aucune écriture, dans aucune branche : les trois policies d'écriture
  -- exigent une fiche staff, qu'un élève n'a pas.
  perform pg_temp.noter('F','F10. l''élève ne TÉLÉVERSE rien dans le seau des miniatures',
    pg_temp.ecrit(u_el_a, format($q$insert into storage.objects (bucket_id, name)
      values ('document-covers', %L)$q$, c_a::text || '/eleve/1-vol.png')) = -1);
  perform pg_temp.noter('F','F11. l''élève ne REMPLACE aucune miniature',
    pg_temp.ecrit(u_el_a, format($q$update storage.objects set updated_at=now()
      where bucket_id='document-covers' and name=%L$q$,
      c_a::text || '/' || d_assigne::text || '/1-cover.png')) <= 0);
  perform pg_temp.noter('F','F12. l''élève ne SUPPRIME aucune miniature',
    pg_temp.ecrit(u_el_a, format($q$delete from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_a::text || '/' || d_assigne::text || '/1-cover.png')) <= 0);
  perform pg_temp.noter('F','F13. …et elle est toujours là',
    (select count(*) from storage.objects where bucket_id='document-covers'
      and name = c_a::text || '/' || d_assigne::text || '/1-cover.png') = 1);

  -- ⚠️ ET L'ÉLÈVE N'ÉCRIT PAS DAVANTAGE LA COLONNE : il n'a aucun UPDATE sur
  -- `documents`, donc il ne peut pas se désigner une miniature.
  perform pg_temp.noter('F','F14. l''élève ne peut pas écrire `cover_storage_path` sur un document',
    pg_temp.ecrit(u_el_a, format($q$update public.documents set cover_storage_path=%L where id=%L$q$,
      'vol/1.png', d_assigne)) <= 0);
end $$;


-- ── G. LE VISITEUR ANONYME ─────────────────────────────────────────────────
-- ⚠️ ON MESURE 0, PAS -1. Une policy qui LÈVE pour `anon` ferait échouer la
-- requête entière, y compris la branche qui devait répondre — c'est le défaut
-- qu'on a déjà rencontré sur ce projet.
do $$
begin
  perform pg_temp.noter('G','G1. le visiteur anonyme ne voit AUCUNE miniature',
    pg_temp.lire_anon($q$select count(*) from storage.objects where bucket_id='document-covers'$q$) = 0);
  perform pg_temp.noter('G','G2. …et aucune policy ne lève pour lui (0, et non -1)',
    pg_temp.lire_anon($q$select count(*) from storage.objects$q$) >= 0);
  perform pg_temp.noter('G','G3. il ne téléverse rien',
    pg_temp.ecrit_anon($q$insert into storage.objects (bucket_id, name)
      values ('document-covers', 'anon/1-vol.png')$q$) = -1);
  perform pg_temp.noter('G','G4. il ne lit aucun document, donc aucun chemin de miniature',
    pg_temp.lire_anon($q$select count(*) from public.documents where cover_storage_path is not null$q$) = 0);
  perform pg_temp.noter('G','G5. `anon` n''a l''EXECUTE d''aucune fonction interne du staff',
    (select count(*) from unnest(array['public.is_admin()','public.current_staff_id()',
                                       'public.document_ids_lecture()']) f
      where has_function_privilege('anon', f::regprocedure, 'EXECUTE')) = 0);
end $$;


-- ── H. NON-RÉGRESSION : CE LOT NE DOIT RIEN AVOIR CASSÉ ────────────────────
do $$
declare
  u_el_a constant uuid := '00000000-0000-4000-8000-00000000f004';
  u_a    constant uuid := '00000000-0000-4000-8000-00000000f002';
  u_b    constant uuid := '00000000-0000-4000-8000-00000000f003';
  d_sans constant uuid := '00000000-0000-4000-8000-00000000f308';
begin
  perform pg_temp.noter('H','H1. les quatre policies du seau `documents` sont intactes',
    (select count(*) from pg_policies
      where schemaname='storage' and tablename='objects'
        and policyname in ('documents_bucket_select_accessible','documents_bucket_manage_staff',
                           'documents_bucket_update_staff','documents_bucket_delete_staff')) = 4);
  perform pg_temp.noter('H','H2. la policy de lecture des documents par l''élève est intacte',
    exists (select 1 from pg_policies where schemaname='public' and tablename='documents'
             and policyname='documents_select_global_or_assigned'));

  -- L'élève lit toujours sa bibliothèque : les globaux de son coach, le fonds
  -- commun, et ce qui lui est assigné. Rien de ce lot ne l'a réduite.
  perform pg_temp.noter('H','H3. l''élève de A lit toujours ses documents',
    pg_temp.lire(u_el_a, $q$select count(*) from public.documents$q$) >= 4);
  perform pg_temp.noter('H','H4. …y compris celui qui n''a PAS de couverture',
    pg_temp.lire(u_el_a, format($q$select count(*) from public.documents where id=%L$q$, d_sans)) = 1);

  perform pg_temp.noter('H','H5. le coach A lit toujours ses documents',
    pg_temp.lire(u_a, $q$select count(*) from public.documents where title like 'MN %'$q$) >= 8);
  perform pg_temp.noter('H','H6. et le coach B ne lit toujours pas ceux du coach A',
    pg_temp.lire(u_b, $q$select count(*) from public.documents where title = 'MN publié global'$q$) = 0);
end $$;


-- ── I. LE FONDS COMMUN DU CABINET (`documents.coach_id IS NULL`) ────────
-- ⚠️ LA SECTION QUI RÉPOND À LA QUESTION LA PLUS DIFFICILE DU LOT.
--
-- Les documents historiques portent `coach_id` NULL. Ils ne sont à personne, et
-- 20261022090000 a tranché : ils restent VISIBLES DES ÉLÈVES — les retirer
-- serait une régression pour eux, les attribuer serait une réaffectation
-- arbitraire — et INVISIBLES DES AUTRES COACHS, seul l'administrateur les gère.
--
-- La policy du seau `document-covers` reprend cette branche mot pour mot :
--
--     d.visibility = 'global' and (d.coach_id is null or d.coach_id = <coach de l'élève>)
--
-- `coach_id is null` n'est donc PAS une porte ouverte : elle reste conjointe à
-- `status = 'publié'` ET à `visibility = 'global'`. Ce qui suit le mesure état
-- par état, puis vérifie la propriété qui compte vraiment : POUR CHAQUE
-- DOCUMENT DU FONDS COMMUN, L'ACCÈS À LA COUVERTURE ÉGALE L'ACCÈS À LA LIGNE.
-- Une miniature n'élargit donc aucun droit, par construction et par mesure.
do $$
declare
  u_adm    constant uuid := '00000000-0000-4000-8000-00000000f001';
  u_a      constant uuid := '00000000-0000-4000-8000-00000000f002';
  u_b      constant uuid := '00000000-0000-4000-8000-00000000f003';
  u_el_a   constant uuid := '00000000-0000-4000-8000-00000000f004';
  u_el_b   constant uuid := '00000000-0000-4000-8000-00000000f005';
  c_adm    constant uuid := '00000000-0000-4000-8000-00000000f101';
  d_hist    constant uuid := '00000000-0000-4000-8000-00000000f306';
  d_fc_brou constant uuid := '00000000-0000-4000-8000-00000000f311';
  d_fc_arch constant uuid := '00000000-0000-4000-8000-00000000f312';
  d_fc_assi constant uuid := '00000000-0000-4000-8000-00000000f313';
  v_doc uuid;
  v_cover text;
  v_ligne int;
  v_image int;
  v_ecarts int := 0;
  v_detail text := '';
begin
  -- État par état, pour l'élève du coach A.
  perform pg_temp.noter('I','I1. fonds commun PUBLIÉ + GLOBAL : la couverture est accessible à l''élève',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_adm::text || '/' || d_hist::text || '/1-cover.png')) = 1);

  -- ⚠️ ET L'ÉLÈVE D'UN AUTRE COACH AUSSI : c'est le fonds commun DU CABINET,
  -- pas celui d'un coach. C'est exactement ce que dit la policy de la table.
  perform pg_temp.noter('I','I2. …y compris à l''élève d''un AUTRE coach (fonds du cabinet)',
    pg_temp.lire(u_el_b, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_adm::text || '/' || d_hist::text || '/1-cover.png')) = 1);

  perform pg_temp.noter('I','I3. fonds commun BROUILLON : aucune couverture',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_adm::text || '/' || d_fc_brou::text || '/1-cover.png')) = 0);
  perform pg_temp.noter('I','I4. fonds commun ARCHIVÉ : aucune couverture',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_adm::text || '/' || d_fc_arch::text || '/1-cover.png')) = 0);
  perform pg_temp.noter('I','I5. fonds commun PUBLIÉ mais en visibilité assignée, non affecté : aucune couverture',
    pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_adm::text || '/' || d_fc_assi::text || '/1-cover.png')) = 0);

  -- ⚠️ LE CONTRÔLE QUI PORTE LA SECTION : la PARITÉ, document par document.
  -- Si la couverture était accessible là où la ligne ne l'est pas, la
  -- miniature aurait élargi les droits — et c'est précisément ce qu'on refuse.
  foreach v_doc in array array[d_hist, d_fc_brou, d_fc_arch, d_fc_assi]
  loop
    v_cover := (select cover_storage_path from public.documents where id = v_doc);
    v_ligne := pg_temp.lire(u_el_a, format($q$select count(*) from public.documents where id=%L$q$, v_doc));
    v_image := pg_temp.lire(u_el_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$, v_cover));
    if v_ligne <> v_image then
      v_ecarts := v_ecarts + 1;
      v_detail := v_detail || format('%s (ligne=%s, couverture=%s) ', v_doc, v_ligne, v_image);
    end if;
  end loop;
  perform pg_temp.noter('I',
    format('I6. parité ligne/couverture sur les 4 documents du fonds commun%s',
           case when v_ecarts = 0 then '' else ' — ÉCARTS : ' || v_detail end),
    v_ecarts = 0);

  -- Et la même parité pour l'élève de l'autre coach, dont la règle diffère
  -- (aucune affectation, un autre coach) : le fonds commun seul lui revient.
  v_ecarts := 0; v_detail := '';
  foreach v_doc in array array[d_hist, d_fc_brou, d_fc_arch, d_fc_assi]
  loop
    v_cover := (select cover_storage_path from public.documents where id = v_doc);
    v_ligne := pg_temp.lire(u_el_b, format($q$select count(*) from public.documents where id=%L$q$, v_doc));
    v_image := pg_temp.lire(u_el_b, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$, v_cover));
    if v_ligne <> v_image then
      v_ecarts := v_ecarts + 1;
      v_detail := v_detail || format('%s (ligne=%s, couverture=%s) ', v_doc, v_ligne, v_image);
    end if;
  end loop;
  perform pg_temp.noter('I',
    format('I7. même parité pour l''élève de l''autre coach%s',
           case when v_ecarts = 0 then '' else ' — ÉCARTS : ' || v_detail end),
    v_ecarts = 0);

  -- CÔTÉ STAFF : le fonds commun reste à l'administrateur. Un coach ne voit ni
  -- la ligne, ni la couverture — et la parité vaut là aussi.
  perform pg_temp.noter('I','I8. le coach A ne lit pas la LIGNE du fonds commun',
    pg_temp.lire(u_a, format($q$select count(*) from public.documents where id=%L$q$, d_hist)) = 0);
  perform pg_temp.noter('I','I9. …ni sa COUVERTURE',
    pg_temp.lire(u_a, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_adm::text || '/' || d_hist::text || '/1-cover.png')) = 0);
  perform pg_temp.noter('I','I10. le coach B non plus',
    pg_temp.lire(u_b, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name like %L$q$, c_adm::text || '/%')) = 0);
  perform pg_temp.noter('I','I11. et aucun coach ne SUPPRIME une couverture du fonds commun',
    pg_temp.ecrit(u_b, format($q$delete from storage.objects
      where bucket_id='document-covers' and name=%L$q$,
      c_adm::text || '/' || d_hist::text || '/1-cover.png')) <= 0);
  perform pg_temp.noter('I','I12. …elle est toujours là',
    (select count(*) from storage.objects where bucket_id='document-covers'
      and name = c_adm::text || '/' || d_hist::text || '/1-cover.png') = 1);
  perform pg_temp.noter('I','I13. l''administrateur, lui, les gère toutes',
    pg_temp.lire(u_adm, format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name like %L$q$, c_adm::text || '/%')) = 4);

  perform pg_temp.noter('I','I14. le visiteur anonyme ne voit aucune couverture du fonds commun',
    pg_temp.lire_anon(format($q$select count(*) from storage.objects
      where bucket_id='document-covers' and name like %L$q$, c_adm::text || '/%')) = 0);
end $$;


-- ── BILAN ──────────────────────────────────────────────────────────────────
select section,
       count(*) filter (where ok) as reussis,
       count(*) filter (where not ok) as echecs
  from _faits group by section order by section;

select count(*) filter (where ok) as total_reussis,
       count(*) filter (where not ok) as total_echecs
  from _faits;

select libelle from _faits where not ok order by section, libelle;

do $$
declare v_echecs int;
begin
  select count(*) into v_echecs from _faits where not ok;
  if v_echecs > 0 then
    raise warning '% contrôle(s) en échec — voir la liste ci-dessus', v_echecs;
  else
    raise notice 'TOUS LES CONTRÔLES PASSENT : isolation entre coachs, droits des élèves, publication, orphelins, seau privé plafonné.';
  end if;
end $$;

rollback;
