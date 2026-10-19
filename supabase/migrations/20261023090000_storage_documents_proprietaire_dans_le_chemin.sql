-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SEAU « documents » — LE PROPRIÉTAIRE PASSE DANS LE CHEMIN                ║
-- ║ Migration ADDITIVE : quatre policies Storage remplacées, rien d'autre.   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ════════════════════════════════════════════════════════════════════════════
-- LE RISQUE QUI RESTAIT, ET POURQUOI IL RESTAIT
-- ════════════════════════════════════════════════════════════════════════════
-- 20261022090000 a aligné les fichiers du seau sur la LIGNE du document :
-- lecture et écriture réservées à l'administrateur, au propriétaire de la
-- ligne, au staff qui y a accès par affectation, et à l'élève autorisé.
--
-- Mais ces policies portaient une porte dérobée assumée, et elle était écrite
-- noir sur blanc dans le fichier : la branche « AUCUNE LIGNE N'EXISTE ».
--
--     or not exists (select 1 from public.documents d
--                     where d.id::text = (storage.foldername(name))[1])
--
-- ⚠️ POURQUOI ELLE EXISTAIT. Le fichier est téléversé AVANT que la ligne
-- existe : l'identifiant du document est tiré côté client, le fichier part
-- dans `<document_id>/<horodatage>-<nom>`, et la ligne n'est créée qu'à
-- l'enregistrement du formulaire. Exiger la ligne au moment du téléversement
-- aurait interdit toute création de document.
--
-- ⚠️ CE QU'ELLE COÛTAIT. Un fichier ORPHELIN — dont la ligne a été supprimée —
-- retombait dans cette branche : n'importe quel membre du staff pouvait le
-- lire, le remplacer et le supprimer. Le chemin ne disait rien du
-- propriétaire, et la seule source de propriété avait disparu avec la ligne.
--
-- ════════════════════════════════════════════════════════════════════════════
-- LA CORRECTION : LE CHEMIN PORTE LUI-MÊME LE PROPRIÉTAIRE
-- ════════════════════════════════════════════════════════════════════════════
-- Nouvelle convention, posée par `lib/supabase/storage-documents.ts` :
--
--     <fiche_coach>/<document_id>/<horodatage>-<nom de fichier>
--
-- Le premier segment est la fiche staff du propriétaire. La policy le compare
-- à `public.current_staff_id()`.
--
-- ⚠️ ET CE N'EST PAS « FAIRE CONFIANCE AU CHEMIN », C'EST L'INVERSE. Le
-- navigateur ne DÉCLARE pas un propriétaire : il propose un chemin, et la
-- policy REFUSE l'écriture si le premier segment n'est pas la fiche de
-- l'appelant — fiche résolue en base par une fonction SECURITY DEFINER qui ne
-- rend que la sienne. Un coach qui forge `<fiche d'un autre>/…` est refusé à
-- l'écriture comme à la lecture. Le chemin n'est pas une preuve d'identité :
-- c'est un emplacement, et l'emplacement autorisé est vérifié en base.
--
-- ⚠️ LA BRANCHE « AUCUNE LIGNE » DISPARAÎT, et c'est tout l'objet du lot. Le
-- premier téléversement fonctionne non pas parce qu'on ferme les yeux, mais
-- parce que le préfixe suffit à établir la propriété sans la ligne.
--
-- ⚠️ LES DEUX FORMES DE CHEMIN COEXISTENT, sans migration de fichiers :
--   · ancienne : `<document_id>/<nom>` — les 17 documents de production ;
--   · nouvelle : `<fiche_coach>/<document_id>/<nom>`.
-- La propriété par la LIGNE est donc conservée en parallèle, et l'identifiant
-- du document est cherché dans N'IMPORTE QUEL segment du chemin
-- (`d.id::text = any(storage.foldername(name))`) : les téléchargements élèves
-- existants, les partages et P13-B continuent de fonctionner à l'identique.
--
-- ⚠️ UN OBJET ANCIEN DEVENU ORPHELIN RESTE À L'ADMINISTRATEUR. Son premier
-- segment est un identifiant de document, pas une fiche coach : aucun coach ne
-- peut le réclamer. On ne lui attribue pas de propriétaire — décision métier,
-- pas décision technique.
--
-- ⚠️ ET LA COMPARAISON RESTE TEXTUELLE. Jamais de transtypage du segment en
-- uuid : un chemin qui ne respecte aucune des deux conventions ne fait pas
-- LEVER la policy (ce qui ferait échouer toute la requête), il ne correspond
-- simplement à rien.

begin;

-- Sans effet là où le seau existe déjà (production) ; indispensable pour que
-- l'isolation des fichiers soit testable en local.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 1. LECTURE — SIGNER UNE URL EST DÉJÀ UN ACCÈS
-- ════════════════════════════════════════════════════════════════════════════
-- `createSignedUrl` est soumis à cette policy : un refus ici empêche
-- l'obtention du lien, donc le téléchargement.
drop policy if exists "documents_bucket_select_authenticated" on storage.objects;
drop policy if exists "documents_bucket_select_accessible" on storage.objects;
create policy "documents_bucket_select_accessible" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      coalesce(public.is_admin(), false)
      -- a. Propriété par le CHEMIN : le préfixe est la fiche de l'appelant.
      --    C'est la branche qui protège aussi les objets ORPHELINS.
      or (storage.foldername(name))[1] = (select public.current_staff_id())::text
      -- b. Propriété par la LIGNE, pour les deux formes de chemin.
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
-- 2. ÉCRITURE — TÉLÉVERSER, REMPLACER, SUPPRIMER
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ PLUS DE BRANCHE « AUCUNE LIGNE ». Le premier téléversement passe par le
-- préfixe de propriété (branche a), pas par une exception. Un orphelin n'est
-- donc accessible qu'à son propriétaire et à l'administrateur.
--
-- ⚠️ LA BRANCHE PAR LA LIGNE EST CONSERVÉE POUR L'ÉCRITURE AUSSI : un document
-- rangé à l'ancienne convention et appartenant à l'appelant doit rester
-- remplaçable et supprimable par lui.
drop policy if exists "documents_bucket_manage_staff" on storage.objects;
create policy "documents_bucket_manage_staff" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
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

drop policy if exists "documents_bucket_update_staff" on storage.objects;
create policy "documents_bucket_update_staff" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
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
    bucket_id = 'documents'
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

drop policy if exists "documents_bucket_delete_staff" on storage.objects;
create policy "documents_bucket_delete_staff" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
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
-- 3. VÉRIFICATION — LECTURES DU CATALOGUE SYSTÈME UNIQUEMENT
-- ════════════════════════════════════════════════════════════════════════════
-- Aucun changement de rôle de session : ni bascule, ni retour de bascule, ni
-- réglage équivalent par paramètre. La CLI enregistre le passage de la
-- migration sur la même connexion, et une bascule peut lui faire perdre les
-- droits nécessaires. L'exécution réelle par acteur est mesurée hors
-- migration : supabase/tests/espace_coach_isolation_checklist.sql, section K.
do $g$
declare
  v_n int;
  v_txt text;
begin
  -- 1. Les quatre policies du seau sont là, bornées au rôle authentifié.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('documents_bucket_select_accessible','documents_bucket_manage_staff',
                        'documents_bucket_update_staff','documents_bucket_delete_staff')
     and roles::text = '{authenticated}';
  if v_n <> 4 then
    raise exception 'Seau documents : les quatre policies attendues ne sont pas au rôle authentifié (% sur 4)', v_n;
  end if;

  -- 2. ⚠️ LE CONTRÔLE QUI PORTE LE LOT : la branche « aucune ligne n'existe »
  --    a disparu des trois policies d'écriture. C'est elle qui laissait un
  --    fichier orphelin manipulable par tout le staff.
  select count(*), coalesce(string_agg(policyname, ', '), '') into v_n, v_txt
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('documents_bucket_manage_staff','documents_bucket_update_staff',
                        'documents_bucket_delete_staff')
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'NOT \(EXISTS';
  if v_n <> 0 then
    raise exception 'Seau documents : % policy(ies) d''écriture gardent la branche « aucune ligne » — un orphelin resterait manipulable (%)', v_n, v_txt;
  end if;

  -- 3. …et les quatre portent la propriété par le CHEMIN, comparée à la fiche
  --    résolue en base.
  select count(*) into v_n
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'documents_bucket%'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'foldername'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'current_staff_id';
  if v_n <> 4 then
    raise exception 'Seau documents : la propriété par le chemin manque à une policy (% sur 4)', v_n;
  end if;

  -- 4. L'UPDATE porte bien un `with check` : sans lui, un objet autorisé
  --    pourrait être DÉPLACÉ sous le préfixe d'un autre coach.
  if not exists (select 1 from pg_policies
                  where schemaname='storage' and tablename='objects'
                    and policyname='documents_bucket_update_staff'
                    and with_check is not null) then
    raise exception 'Seau documents : la policy UPDATE n''a pas de with_check — un objet pourrait être déplacé chez un autre coach';
  end if;

  -- 5. Aucune ne s'appuie plus sur `is_coach_or_admin()`, qui valait pour
  --    tout compte dont `profiles.role in ('coach','admin')`.
  select count(*) into v_n
    from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname like 'documents_bucket%'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'is_coach_or_admin';
  if v_n <> 0 then
    raise exception 'Seau documents : une policy signe encore sur le seul is_coach_or_admin() (%)', v_n;
  end if;

  -- 6. Le seau existe, et il reste PRIVÉ : toute lecture passe par une URL
  --    signée, donc par la policy ci-dessus.
  if not exists (select 1 from storage.buckets where id = 'documents' and public = false) then
    raise exception 'Seau documents : absent, ou devenu public — une URL publique contournerait la policy';
  end if;

  /*
   * 7. Et `anon` n'a l'EXECUTE d'aucune fonction interne DU STAFF.
   *
   * ⚠️ `current_student_id()` EST VOLONTAIREMENT ABSENTE DE CETTE LISTE, et
   * c'est une mesure, pas une tolérance : `anon` en a l'EXECUTE en production
   * comme en local (relevé des deux côtés). Elle lui vient des privilèges par
   * défaut du schéma `public` chez Supabase, et elle est inoffensive — la
   * fonction rend l'élève de `auth.uid()`, donc NULL pour un visiteur. La
   * première version de ce contrôle l'avait incluse : la migration a échoué
   * sur la base locale propre, ce qui lui aurait fait échouer en production.
   * La liste ne garde donc que les fonctions réservées au staff, les mêmes
   * que le contrôle H14 de la checklist P13-B.
   */
  select count(*) into v_n
    from unnest(array['public.is_admin()','public.current_staff_id()',
                      'public.document_ids_lecture()']) f
   where has_function_privilege('anon', f::regprocedure, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'Seau documents : anon a récupéré l''EXECUTE de % fonction(s) interne(s) — interdit', v_n;
  end if;

  raise notice 'Seau documents : propriété portée par le chemin (<fiche_coach>/<document_id>/<nom>), branche « aucune ligne » supprimée, ancienne convention et accès élèves conservés. Isolation des orphelins mesurée par supabase/tests/espace_coach_isolation_checklist.sql (section K).';
end $g$;

commit;
