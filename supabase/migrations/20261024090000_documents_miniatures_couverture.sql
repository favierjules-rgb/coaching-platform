-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ MINIATURES DE DOCUMENTS — UNE IMAGE DE COUVERTURE FACULTATIVE            ║
-- ║ Migration ADDITIVE : une colonne nullable, un seau dédié, 4 policies.    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE CETTE MIGRATION AJOUTE, ET CE QU'ELLE NE TOUCHE PAS
-- ════════════════════════════════════════════════════════════════════════════
--   + `public.documents.cover_storage_path` : le CHEMIN de stockage de la
--     couverture, nullable, sans défaut, sans reprise de données.
--   + le seau privé `document-covers`, plafonné en taille et en type MIME.
--   + quatre policies Storage sur ce seau, décalquées de celles du seau
--     `documents` posées par 20261023090000.
--
--   = RIEN D'AUTRE. Le seau `documents` n'est pas modifié et ne devient pas
--     public. Les policies de la table `documents` ne bougent pas. Les règles
--     de publication, les affectations d'élèves et les droits entre coachs
--     restent exactement ce qu'ils étaient.
--
-- ════════════════════════════════════════════════════════════════════════════
-- POURQUOI UNE COLONNE, ET POURQUOI ELLE NE PEUT PAS ÊTRE UNE URL
-- ════════════════════════════════════════════════════════════════════════════
-- `documents.storage_path` porte le fichier DU document — le PDF, la vidéo,
-- l'image qu'on télécharge. La couverture est un second objet, facultatif, et
-- valable pour TOUS les types : la ranger dans `storage_path` écraserait le
-- contenu. Aucune colonne existante ne peut l'accueillir, d'où l'ajout.
--
-- ⚠️ ELLE CONTIENT UN CHEMIN, JAMAIS UNE URL SIGNÉE. Une URL signée expire :
-- la stocker produirait, quelques heures plus tard, des cartes dont l'image
-- est cassée pour tout le monde — et la faire durer longtemps équivaudrait à
-- rendre le fichier public sans le dire. Le chemin est stable, la signature
-- est demandée à chaque affichage et repasse donc par la policy ci-dessous.
--
-- ════════════════════════════════════════════════════════════════════════════
-- POURQUOI UN SEAU DÉDIÉ, ET PAS LE SEAU `documents`
-- ════════════════════════════════════════════════════════════════════════════
-- Le seau `documents` héberge des PDF de 25 Mo et des vidéos de 200 Mo : il
-- n'a donc NI `file_size_limit`, NI `allowed_mime_types` (relevé en
-- production comme en local). Y poser des plafonds d'image casserait les
-- téléversements de vidéos ; ne pas en poser laisserait la seule validation
-- du côté du navigateur, c'est-à-dire du côté qu'on ne contrôle pas.
--
-- Un seau dédié permet au SERVEUR de refuser lui-même : 5 Mo, et trois types
-- MIME. `image/svg+xml` en est absent VOLONTAIREMENT — un SVG est du XML
-- exécutable, et une couverture finit dans une balise `<img>`.
--
-- Le seau reste PRIVÉ. Aucune lecture publique : toute vue passe par une URL
-- signée, donc par la policy de lecture, donc par les règles d'accès.
--
-- ⚠️ ET CE QUE CES PLAFONDS GARANTISSENT RÉELLEMENT, SANS EXAGÉRER :
--   · `file_size_limit` porte sur les octets REÇUS — vraie garantie serveur ;
--   · `allowed_mime_types` est comparé au `content-type` ANNONCÉ par la
--     requête, PAS au contenu réel du fichier. Un appel qui annonce
--     `image/png` en envoyant n'importe quels octets est accepté par le seau.
-- La confrontation des premiers octets au type déclaré existe, mais elle est
-- dans le NAVIGATEUR (`lib/supabase/storage-document-covers.ts`), donc
-- contournable par un client forgé. AUCUNE VÉRIFICATION DE LA SIGNATURE RÉELLE
-- N'EXISTE CÔTÉ SERVEUR, et cette migration ne prétend pas le contraire.
-- Ce qui tient : le SVG est exclu du seau, le seau est privé, l'écriture est
-- réservée au staff et bornée à son propre préfixe, et une couverture n'est
-- jamais rendue autrement que dans une balise `<img>`.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONVENTION DE CHEMIN — IDENTIQUE À CELLE DU SEAU `documents`
-- ════════════════════════════════════════════════════════════════════════════
--
--     <fiche_coach>/<document_id>/<horodatage>-<nom de fichier>
--
-- Le premier segment est la fiche staff du PROPRIÉTAIRE, comparée par la
-- policy à `public.current_staff_id()` — fonction SECURITY DEFINER qui ne
-- rend que la fiche de l'appelant. Le navigateur PROPOSE un emplacement ; la
-- base REFUSE si ce n'est pas le sien. C'est ce préfixe qui autorise le
-- premier téléversement sans exiger que la ligne existe, et c'est lui qui
-- protège un objet devenu orphelin : aucune branche « aucune ligne n'existe »
-- n'est reconduite ici.
--
-- Ce seau étant neuf, il n'a aucun objet à l'ancienne convention. La branche
-- de propriété PAR LA LIGNE est néanmoins conservée, pour la seule raison que
-- le raisonnement doit rester le même que sur `documents` : une règle unique
-- à relire, pas deux à faire concorder.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUE LA COUVERTURE MONTRE, ET CE QU'ELLE NE MONTRE PAS
-- ════════════════════════════════════════════════════════════════════════════
-- La policy de lecture est celle du seau `documents`, mot pour mot : un élève
-- obtient une signature si le document est `status = 'publié'` ET
-- (en visibilité globale rattachée à SON coach, OU assigné à lui).
--
--   · un brouillon, un archivé                  → refusé
--   · un document non assigné et non global      → refusé
--   · un document global d'un AUTRE coach        → refusé
--   · un document d'un autre coach, côté staff   → refusé
--   · `anon`                                     → refusé (policy `authenticated`)
--
-- ⚠️ LE DÉBLOCAGE PROGRESSIF N'EST PAS UN CRITÈRE ICI, ET C'EST VOULU. Un
-- document assigné mais pas encore débloqué affiche sa COUVERTURE — une
-- annonce, pas un contenu. Son FICHIER reste inaccessible : la garde est dans
-- l'application (`availability.available` conditionne le bouton d'ouverture
-- et la miniature de l'original), exactement comme avant ce lot. Cette
-- migration n'ouvre donc aucun accès au contenu d'un document verrouillé.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ CETTE MIGRATION NE CHANGE PAS LE RÔLE ACTIF DE SA SESSION
-- ════════════════════════════════════════════════════════════════════════════
-- Ni bascule de rôle, ni retour de bascule, ni réglage équivalent par
-- paramètre de session : la CLI Supabase enregistre le passage de la migration
-- sur la même connexion, et une bascule peut lui faire perdre les droits
-- nécessaires. Le bloc de vérification final ne lit que le catalogue système.
-- L'exécution réelle par acteur est mesurée hors migration :
--
--     supabase/tests/documents_miniatures_checklist.sql

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. LA COLONNE — NULLABLE, SANS DÉFAUT, SANS REPRISE
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ AUCUN BACKFILL. Les documents existants restent à NULL, donc sans
-- couverture, donc affichés avec le repli discret. La compatibilité est
-- obtenue par construction et non par un rattrapage qu'il faudrait vérifier.
alter table public.documents
  add column if not exists cover_storage_path text;

comment on column public.documents.cover_storage_path is
  'Chemin de la miniature de couverture dans le seau prive document-covers '
  '(<fiche_coach>/<document_id>/<horodatage>-<nom>), ou NULL si le document '
  'na pas de couverture. JAMAIS une URL signee : la signature est demandee a '
  'chaque affichage et repasse par la policy de lecture du seau.';


-- ════════════════════════════════════════════════════════════════════════════
-- 2. LE SEAU — PRIVÉ, 5 Mo, TROIS TYPES MIME
-- ════════════════════════════════════════════════════════════════════════════
-- `on conflict do update` plutôt que `do nothing` : si le seau existe déjà
-- (relance, environnement déjà provisionné), ses plafonds doivent devenir
-- ceux déclarés ici — un seau d'images sans plafond serait pire que pas de
-- seau du tout.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'document-covers',
  'document-covers',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. LECTURE — SIGNER UNE URL EST DÉJÀ UN ACCÈS
-- ════════════════════════════════════════════════════════════════════════════
-- `createSignedUrl` est soumis à cette policy : un refus ici empêche
-- l'obtention du lien, donc l'affichage de la couverture.
drop policy if exists "document_covers_select_accessible" on storage.objects;
create policy "document_covers_select_accessible" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'document-covers'
    and (
      coalesce(public.is_admin(), false)
      -- a. Propriété par le CHEMIN : le préfixe est la fiche de l'appelant.
      --    C'est la branche qui protège aussi les objets ORPHELINS.
      or (storage.foldername(name))[1] = (select public.current_staff_id())::text
      -- b. Propriété par la LIGNE, et accès élève selon les règles existantes.
      or exists (
        select 1 from public.documents d
         where d.id::text = any(storage.foldername(name))
           and (
             (d.coach_id is not null and d.coach_id = (select public.current_staff_id()))
             or d.id in (select public.document_ids_lecture())
             or ((select public.current_student_id()) is not null
                 and d.status = 'publié'
                 and (
                   (d.visibility = 'global'
                    and (d.coach_id is null
                         or d.coach_id = (select s.coach_id from public.students s
                                           where s.id = (select public.current_student_id()))))
                   or exists (select 1 from public.document_assignments da
                               where da.document_id = d.id
                                 and da.student_id = (select public.current_student_id()))
                 ))
           )
      )
    )
  );


-- ════════════════════════════════════════════════════════════════════════════
-- 4. ÉCRITURE — TÉLÉVERSER, REMPLACER, SUPPRIMER
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ AUCUNE BRANCHE « AUCUNE LIGNE N'EXISTE ». Le premier téléversement passe
-- par le préfixe de propriété, pas par une exception : un objet orphelin
-- n'est donc accessible qu'à son propriétaire et à l'administrateur.
--
-- ⚠️ AUCUN ACCÈS ÉLÈVE EN ÉCRITURE. Les trois policies ci-dessous exigent
-- `current_staff_id() is not null` : un élève n'a ni INSERT, ni UPDATE, ni
-- DELETE sur ce seau, quelle que soit la branche.
drop policy if exists "document_covers_insert_staff" on storage.objects;
create policy "document_covers_insert_staff" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'document-covers'
    and (select public.current_staff_id()) is not null
    and (
      coalesce(public.is_admin(), false)
      or (storage.foldername(name))[1] = (select public.current_staff_id())::text
      or exists (select 1 from public.documents d
                  where d.id::text = any(storage.foldername(name))
                    and d.coach_id is not null
                    and d.coach_id = (select public.current_staff_id()))
    )
  );

drop policy if exists "document_covers_update_staff" on storage.objects;
create policy "document_covers_update_staff" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'document-covers'
    and (select public.current_staff_id()) is not null
    and (
      coalesce(public.is_admin(), false)
      or (storage.foldername(name))[1] = (select public.current_staff_id())::text
      or exists (select 1 from public.documents d
                  where d.id::text = any(storage.foldername(name))
                    and d.coach_id is not null
                    and d.coach_id = (select public.current_staff_id()))
    )
  )
  -- ⚠️ `with check` AUTANT QUE `using` : sans lui, un `update` pourrait
  -- DÉPLACER un objet qu'on a le droit de modifier vers le préfixe d'un autre
  -- coach, ou l'y renommer. La règle doit tenir sur la ligne d'arrivée.
  with check (
    bucket_id = 'document-covers'
    and (select public.current_staff_id()) is not null
    and (
      coalesce(public.is_admin(), false)
      or (storage.foldername(name))[1] = (select public.current_staff_id())::text
      or exists (select 1 from public.documents d
                  where d.id::text = any(storage.foldername(name))
                    and d.coach_id is not null
                    and d.coach_id = (select public.current_staff_id()))
    )
  );

drop policy if exists "document_covers_delete_staff" on storage.objects;
create policy "document_covers_delete_staff" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'document-covers'
    and (select public.current_staff_id()) is not null
    and (
      coalesce(public.is_admin(), false)
      or (storage.foldername(name))[1] = (select public.current_staff_id())::text
      or exists (select 1 from public.documents d
                  where d.id::text = any(storage.foldername(name))
                    and d.coach_id is not null
                    and d.coach_id = (select public.current_staff_id()))
    )
  );


-- ════════════════════════════════════════════════════════════════════════════
-- 5. VÉRIFICATION — LECTURES DU CATALOGUE SYSTÈME UNIQUEMENT
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare
  v_n int;
  v_txt text;
  v_seau record;
begin
  -- 1. La colonne existe, elle est de type texte, nullable, et sans défaut.
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'documents'
     and column_name = 'cover_storage_path'
     and data_type = 'text'
     and is_nullable = 'YES'
     and column_default is null;
  if v_n <> 1 then
    raise exception 'documents.cover_storage_path : absente, ou non conforme (texte, nullable, sans defaut)';
  end if;

  -- 2. Le seau existe, reste PRIVÉ, et porte les deux plafonds.
  select b.public, b.file_size_limit, b.allowed_mime_types
    into v_seau
    from storage.buckets b
   where b.id = 'document-covers';
  if not found then
    raise exception 'Seau document-covers : absent';
  end if;
  if v_seau.public then
    raise exception 'Seau document-covers : devenu public — une URL publique contournerait la policy';
  end if;
  if coalesce(v_seau.file_size_limit, 0) <> 5242880 then
    raise exception 'Seau document-covers : plafond de taille attendu 5242880, trouve %', coalesce(v_seau.file_size_limit, 0);
  end if;
  if v_seau.allowed_mime_types is null
     or 'image/svg+xml' = any(v_seau.allowed_mime_types)
     or exists (select 1 from unnest(v_seau.allowed_mime_types) as t where t not like 'image/%')
     or not ('image/jpeg' = any(v_seau.allowed_mime_types))
     or not ('image/png' = any(v_seau.allowed_mime_types))
     or not ('image/webp' = any(v_seau.allowed_mime_types)) then
    raise exception 'Seau document-covers : allowed_mime_types doit valoir exactement jpeg/png/webp, sans SVG (trouve %)', v_seau.allowed_mime_types;
  end if;

  -- 3. Le seau `documents` n'a pas bougé, et surtout n'est pas devenu public.
  if not exists (select 1 from storage.buckets where id = 'documents' and public = false) then
    raise exception 'Seau documents : absent, ou devenu public — cette migration ne doit pas y toucher';
  end if;

  -- 4. Les quatre policies du nouveau seau existent, au rôle authentifié.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('document_covers_select_accessible','document_covers_insert_staff',
                        'document_covers_update_staff','document_covers_delete_staff')
     and roles::text = '{authenticated}';
  if v_n <> 4 then
    raise exception 'Seau document-covers : les quatre policies attendues ne sont pas au role authentifie (% sur 4)', v_n;
  end if;

  -- 5. ⚠️ LE CONTRÔLE QUI PORTE LE LOT : aucune branche « aucune ligne
  --    n'existe » dans les trois policies d'écriture. C'est elle qui, sur le
  --    seau `documents`, laissait un orphelin manipulable par tout le staff.
  select count(*), coalesce(string_agg(policyname, ', '), '') into v_n, v_txt
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('document_covers_insert_staff','document_covers_update_staff',
                        'document_covers_delete_staff')
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'NOT \(EXISTS';
  if v_n <> 0 then
    raise exception 'Seau document-covers : % policy(ies) decriture gardent la branche aucune ligne (%)', v_n, v_txt;
  end if;

  -- 6. Les quatre portent la propriété par le CHEMIN, comparée à la fiche
  --    résolue en base.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'document_covers%'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'foldername'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'current_staff_id';
  if v_n <> 4 then
    raise exception 'Seau document-covers : la propriete par le chemin manque a une policy (% sur 4)', v_n;
  end if;

  -- 7. L'UPDATE porte bien un `with check`.
  if not exists (select 1 from pg_policies
                  where schemaname='storage' and tablename='objects'
                    and policyname='document_covers_update_staff'
                    and with_check is not null) then
    raise exception 'Seau document-covers : la policy UPDATE na pas de with_check — un objet pourrait etre deplace chez un autre coach';
  end if;

  -- 8. Les trois policies d'écriture exigent une fiche staff : aucun élève,
  --    aucun compte sans fiche ne peut écrire dans ce seau.
  select count(*) into v_n
    from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname in ('document_covers_insert_staff','document_covers_update_staff',
                        'document_covers_delete_staff')
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'current_staff_id';
  if v_n <> 3 then
    raise exception 'Seau document-covers : une policy decriture nexige pas de fiche staff (% sur 3)', v_n;
  end if;

  -- 9. Aucune ne s'appuie sur `is_coach_or_admin()`, qui valait pour tout
  --    compte dont `profiles.role in ('coach','admin')`.
  select count(*) into v_n
    from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname like 'document_covers%'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'is_coach_or_admin';
  if v_n <> 0 then
    raise exception 'Seau document-covers : une policy signe sur le seul is_coach_or_admin() (%)', v_n;
  end if;

  -- 10. Les policies de la table `documents` et du seau `documents` sont
  --     INTACTES : cette migration ne doit pas les avoir redéfinies.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('documents_bucket_select_accessible','documents_bucket_manage_staff',
                        'documents_bucket_update_staff','documents_bucket_delete_staff');
  if v_n <> 4 then
    raise exception 'Seau documents : ses quatre policies ne sont plus la (% sur 4) — regression', v_n;
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='documents'
                    and policyname='documents_select_global_or_assigned') then
    raise exception 'Table documents : documents_select_global_or_assigned a disparu — regression';
  end if;

  raise notice 'Miniatures de documents : colonne cover_storage_path (nullable, sans reprise), seau prive document-covers (5 Mo, jpeg/png/webp, sans SVG), quatre policies alignees sur celles du seau documents. Acces reels mesures par supabase/tests/documents_miniatures_checklist.sql.';
end $g$;

commit;
