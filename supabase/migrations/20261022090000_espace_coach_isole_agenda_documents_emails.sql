-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ESPACE COACH ISOLÉ — AGENDA, DOCUMENTS, JOURNAL D'EMAILS                 ║
-- ║ Migration ADDITIVE. Aucune donnée réattribuée, aucune ligne supprimée.   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUI A ÉTÉ MESURÉ, ET POURQUOI
-- ════════════════════════════════════════════════════════════════════════════
-- Base locale propre, un administrateur et deux coachs autonomes (fiche
-- `coaches.role = 'assistant'`, le rôle d'un coach qui n'est pas
-- collaborateur). Relevé AVANT ce lot :
--
--   est_staff_global() pour le coach B ............................... VRAI
--   disponibilités récurrentes vues par le coach B ...................... 1
--   indisponibilités vues par le coach B ................................ 1
--   réglages de réservation lus par le coach B .......................... 1
--   réglages de réservation MODIFIÉS par le coach B ............. 1 ligne
--   documents de l'administrateur vus par le coach B .................... 1
--   journal d'emails lu par le coach B .................................. 1
--   SUPPRESSION par le coach B de la disponibilité de l'administrateur :
--                                                    1 ligne, et elle a disparu
--
-- ⚠️ LA CAUSE N'EST PAS UNE FUITE D'INTERFACE, C'EST `est_staff_global()`.
-- Cette fonction rend VRAI pour `is_admin()` OU `staff_role() in
-- ('admin','assistant')`. Un coach autonome porte `assistant` : il passe donc
-- la première branche de toutes les policies `…_manage_staff_*` de l'agenda,
-- qui lui ouvrent l'ensemble des lignes — celles de l'administrateur comprises.
-- « Supprimer une disponibilité depuis le compte coach la supprime aussi côté
-- administrateur » parce que C'EST LA MÊME LIGNE.
--
-- ⚠️ ET AUCUNE LIGNE N'AVAIT DE PROPRIÉTAIRE. `coach_availabilities.coach_id`
-- et `coach_unavailabilities.coach_id` sont nullables, sans valeur par défaut
-- ni déclencheur, et `createCoachAvailability` n'envoie pas `coach_id` : toutes
-- les disponibilités existantes portent NULL. Même défaut que `programs` avant
-- 20261020090000, même correctif — la propriété posée EN BASE.
--
-- ⚠️ `booking_settings` N'A PAS DE COLONNE DE PROPRIÉTAIRE DU TOUT. Une seule
-- ligne, lue et écrite par tout le staff : les réglages de réservation du
-- coach et de l'administrateur étaient littéralement le même enregistrement.
--
-- ⚠️ LES DOCUMENTS FUITENT PAR UNE POLICY SANS ACTEUR.
-- `documents_select_global_or_assigned` dit `status = 'publié' and (visibility
-- = 'global' or …assigné à l'élève…)`. La première branche ne contient AUCUNE
-- condition sur l'appelant : tout compte authentifié voit tous les documents
-- publiés en visibilité globale. C'est par là que le nouveau coach voit les
-- 17 documents de l'espace administrateur.
--
-- ⚠️ ET LE FICHIER SUIT LA LIGNE. La policy Storage
-- `documents_bucket_select_accessible` autorise la signature d'URL dès
-- `is_coach_or_admin()` : masquer la ligne n'aurait rien protégé, le coach
-- pouvait télécharger le fichier. Les policies d'écriture du seau sont sur le
-- même critère : n'importe quel coach pouvait supprimer le fichier d'un autre.
--
-- ⚠️ `email_logs` N'A AUCUNE NOTION D'AUTEUR. Une seule policy,
-- `est_staff_global()`, et pas une colonne pour dire qui a déclenché l'envoi.
-- Le cloisonnement du journal exige donc d'abord un modèle.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUI N'EST PAS TOUCHÉ
-- ════════════════════════════════════════════════════════════════════════════
--   · `appointments` : déjà cloisonné, et mesuré comme tel (le coach B voit 0
--     rendez-vous de A, ne le modifie ni ne le supprime). Aucune policy
--     d'écriture n'existe sur cette table : les écritures passent par le
--     serveur. Rien à changer ici, et on ne touche pas à ce qui tient.
--   · P13-B : les policies `…_select_portee` du collaborateur et les fonctions
--     `categories_lecture()` / `categories_ecriture()` restent à l'identique.
--     Un coach autonome garde `est_staff_global()` VRAI, donc ses quatre
--     catégories : borner les policies au PROPRIÉTAIRE ne lui retire rien sur
--     ses propres lignes.
--   · Les fournisseurs partagés (Stripe, Brevo, Resend) : aucune clé, aucun
--     webhook, aucune configuration d'envoi.
--   · Les 17 documents et les disponibilités existantes : AUCUNE
--     réattribution. `coach_id` NULL reste NULL — c'est-à-dire réservé à
--     l'administrateur — jusqu'à décision métier.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ CETTE MIGRATION NE CHANGE PAS LE RÔLE ACTIF DE SA SESSION
-- ════════════════════════════════════════════════════════════════════════════
-- Ni bascule de rôle, ni retour de bascule, ni réglage équivalent par
-- paramètre de session : la CLI Supabase enregistre le passage de la migration
-- sur la même connexion, et une bascule peut lui faire perdre les droits
-- nécessaires (« 42501 permission denied for schema supabase_migrations »,
-- déjà rencontré ici). Le bloc de vérification final ne lit donc que le
-- catalogue système. L'exécution réelle par rôle est mesurée hors migration :
--
--     supabase/tests/espace_coach_isolation_checklist.sql

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. LA PROPRIÉTÉ EST POSÉE À LA CRÉATION, EN BASE
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ EN BASE ET PAS DANS L'APPLICATION. Un correctif applicatif laisserait
-- `coach_id` NULL pour toute insertion directe en PostgREST. Le déclencheur,
-- lui, ne peut pas être contourné.
--
-- ⚠️ LA VALEUR N'EST PAS CELLE QUE LE CLIENT ENVOIE. `current_staff_id()` est
-- SECURITY DEFINER et ne rend que la fiche de l'appelant. Et si l'appelant
-- FORGE un `coach_id` qui n'est pas le sien, ce n'est pas ce déclencheur qui
-- le refuse mais le `with check` des policies de la section 2 — le contrôle
-- est au même endroit que pour `programs`, par cohérence.

create or replace function public.poser_proprietaire_staff()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  -- Déjà renseigné : on respecte le choix (parcours administrateur, imports,
  -- régularisations en service_role). Le `with check` de la policy tranchera
  -- si l'appelant n'avait pas le droit de désigner ce propriétaire.
  if new.coach_id is not null then
    return new;
  end if;

  -- Contexte serveur (service_role, cron, migration) : aucune fiche à poser.
  -- La ligne reste sans propriétaire, donc réservée à l'administrateur.
  if auth.uid() is null then
    return new;
  end if;

  new.coach_id := public.current_staff_id();
  return new;
end;
$fn$;
alter function public.poser_proprietaire_staff() owner to postgres;
revoke all on function public.poser_proprietaire_staff() from public, anon, authenticated, service_role;

comment on function public.poser_proprietaire_staff() is
  'Déclencheur BEFORE INSERT générique : pose coach_id = current_staff_id() quand '
  'l''appelant authentifié n''en a pas fourni. Utilisé par coach_availabilities, '
  'coach_unavailabilities, booking_settings et documents — toutes des tables où '
  'coach_id était nullable, sans défaut, et laissé NULL par l''application.';

drop trigger if exists coach_availabilities_poser_proprietaire on public.coach_availabilities;
create trigger coach_availabilities_poser_proprietaire
  before insert on public.coach_availabilities
  for each row execute function public.poser_proprietaire_staff();

drop trigger if exists coach_unavailabilities_poser_proprietaire on public.coach_unavailabilities;
create trigger coach_unavailabilities_poser_proprietaire
  before insert on public.coach_unavailabilities
  for each row execute function public.poser_proprietaire_staff();

drop trigger if exists documents_poser_proprietaire on public.documents;
create trigger documents_poser_proprietaire
  before insert on public.documents
  for each row execute function public.poser_proprietaire_staff();


-- ════════════════════════════════════════════════════════════════════════════
-- 2. L'AGENDA D'UN COACH N'EST PLUS CELUI DE TOUT LE STAFF
-- ════════════════════════════════════════════════════════════════════════════
-- `est_staff_global()` remplacé par `coalesce(is_admin(), false)` dans les
-- policies `…_manage_staff_*`. Ce qui reste accordé au coach autonome passe
-- par la SECONDE branche, inchangée : `coach_id = current_staff_id()` et
-- `agenda_communication` dans ses catégories. Il garde donc tout sur SES
-- lignes, et perd exactement ce qu'il n'aurait jamais dû avoir : celles des
-- autres.
--
-- ⚠️ `to authenticated` SUR TOUTES LES POLICIES DE CES TABLES. Elles appellent
-- des fonctions internes dont `anon` n'a pas l'EXECUTE : laissées au rôle
-- `{public}`, elles LÈVENT pour un visiteur au lieu de refuser, et une policy
-- qui lève fait échouer toute la requête. C'est le piège qui avait rendu la
-- vitrine publique illisible (20261020090000). Aucune page anonyme ne lit
-- l'agenda — vérifié : seules les pages `/admin/calendrier` et
-- `/(student)/rendez-vous` l'interrogent, toutes deux authentifiées.

-- ── Disponibilités récurrentes ─────────────────────────────────────────────
drop policy if exists "coach_availabilities_manage_staff_select" on public.coach_availabilities;
create policy "coach_availabilities_manage_staff_select" on public.coach_availabilities
  for select to authenticated
  using (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_lecture()))
  );

drop policy if exists "coach_availabilities_manage_staff_insert" on public.coach_availabilities;
create policy "coach_availabilities_manage_staff_insert" on public.coach_availabilities
  for insert to authenticated
  with check (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_ecriture()))
  );

drop policy if exists "coach_availabilities_manage_staff_update" on public.coach_availabilities;
create policy "coach_availabilities_manage_staff_update" on public.coach_availabilities
  for update to authenticated
  using (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_ecriture()))
  )
  with check (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_ecriture()))
  );

drop policy if exists "coach_availabilities_manage_staff_delete" on public.coach_availabilities;
create policy "coach_availabilities_manage_staff_delete" on public.coach_availabilities
  for delete to authenticated
  using (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_ecriture()))
  );

-- Le collaborateur garde sa lecture de portée (P13-B), et l'élève la sienne :
-- on ne change que leur ROLE, pas leur condition.
alter policy "coach_availabilities_select_portee" on public.coach_availabilities to authenticated;

-- ⚠️ L'ÉLÈVE NE DOIT VOIR QUE L'AGENDA DE SON COACH. La policy sortante
-- disait « il existe un élève courant » — donc tout élève voyait les
-- disponibilités de tous les coachs du cabinet, ce qui lui proposait des
-- créneaux chez un coach qui n'est pas le sien.
drop policy if exists "coach_availabilities_select_eleve" on public.coach_availabilities;
create policy "coach_availabilities_select_eleve" on public.coach_availabilities
  for select to authenticated
  using (
    (select public.current_student_id()) is not null
    and (
      coach_id is null
      or coach_id = (select s.coach_id from public.students s
                      where s.id = (select public.current_student_id()))
    )
  );

-- ── Indisponibilités ponctuelles ───────────────────────────────────────────
drop policy if exists "coach_unavailabilities_select_staff" on public.coach_unavailabilities;
create policy "coach_unavailabilities_select_staff" on public.coach_unavailabilities
  for select to authenticated
  using (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_lecture()))
  );

drop policy if exists "coach_unavailabilities_delete_staff" on public.coach_unavailabilities;
create policy "coach_unavailabilities_delete_staff" on public.coach_unavailabilities
  for delete to authenticated
  using (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_ecriture()))
  );

alter policy "coach_unavailabilities_select_portee" on public.coach_unavailabilities to authenticated;

-- ⚠️ IL MANQUAIT LES POLICIES D'ÉCRITURE. `coach_unavailabilities` n'avait ni
-- INSERT ni UPDATE : avec RLS active, aucun coach ne pouvait créer ni modifier
-- une indisponibilité depuis son compte. On les ajoute, bornées au
-- propriétaire — c'est un manque, pas un durcissement.
drop policy if exists "coach_unavailabilities_insert_staff" on public.coach_unavailabilities;
create policy "coach_unavailabilities_insert_staff" on public.coach_unavailabilities
  for insert to authenticated
  with check (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_ecriture()))
  );

drop policy if exists "coach_unavailabilities_update_staff" on public.coach_unavailabilities;
create policy "coach_unavailabilities_update_staff" on public.coach_unavailabilities
  for update to authenticated
  using (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_ecriture()))
  )
  with check (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_ecriture()))
  );


-- ════════════════════════════════════════════════════════════════════════════
-- 3. LES RÉGLAGES DE RÉSERVATION DEVIENNENT CEUX D'UN COACH
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ IL N'Y AVAIT PAS DE PROPRIÉTAIRE À BORNER : on ajoute la colonne.
-- Additif, nullable, sans valeur par défaut — la ligne existante garde donc
-- `coach_id` NULL et reste ce qu'elle est : le RÉGLAGE PAR DÉFAUT DU CABINET,
-- géré par l'administrateur. Aucune réattribution.
--
-- Un coach qui modifie ses réglages crée SA ligne ; tant qu'il n'en a pas, le
-- défaut du cabinet s'applique. C'est pour ça que la lecture laisse passer
-- `coach_id is null`.

alter table public.booking_settings
  add column if not exists coach_id uuid references public.coaches(id) on delete cascade;

comment on column public.booking_settings.coach_id is
  'Coach propriétaire de ces réglages. NULL = réglage par défaut du cabinet, '
  'géré par l''administrateur (c''est l''état de la ligne historique unique). '
  'Un coach lit son réglage s''il en a un, sinon le défaut.';

-- Un seul jeu de réglages par coach, et un seul défaut de cabinet.
create unique index if not exists booking_settings_un_par_coach
  on public.booking_settings (coach_id) where coach_id is not null;

drop trigger if exists booking_settings_poser_proprietaire on public.booking_settings;
create trigger booking_settings_poser_proprietaire
  before insert on public.booking_settings
  for each row execute function public.poser_proprietaire_staff();

-- Lecture : l'administrateur voit tout ; un membre du staff voit SON réglage
-- et le défaut du cabinet ; un élève voit celui de SON coach et le défaut.
drop policy if exists "booking_settings_manage_staff_select" on public.booking_settings;
create policy "booking_settings_manage_staff_select" on public.booking_settings
  for select to authenticated
  using (
    coalesce(public.is_admin(), false)
    -- ⚠️ LE DÉFAUT DU CABINET N'EST PAS LISIBLE PAR TOUT LE MONDE, et c'est un
    -- contrôle P13-B existant qui l'a rappelé (I2 : « agenda/aucun accès :
    -- aucun réglage de réservation »). Un collaborateur sans la catégorie
    -- `agenda_communication` ne doit rien lire ici, pas même le défaut.
    or (coach_id is null
        and coalesce('agenda_communication' in (select public.categories_lecture()), false))
    or coach_id = (select public.current_staff_id())
    or (coach_id in (select public.coach_ids_portee())
        and coalesce('agenda_communication' in (select public.categories_lecture()), false))
  );

drop policy if exists "booking_settings_select_agenda" on public.booking_settings;
drop policy if exists "booking_settings_select_eleve" on public.booking_settings;
create policy "booking_settings_select_eleve" on public.booking_settings
  for select to authenticated
  using (
    (select public.current_student_id()) is not null
    and (
      coach_id is null
      or coach_id = (select s.coach_id from public.students s
                      where s.id = (select public.current_student_id()))
    )
  );

-- Écriture : l'administrateur sur tout, un coach sur SA ligne seulement. Le
-- `with check` est ce qui refuse à un coach de désigner le `coach_id` d'un
-- autre, insertion directe en PostgREST comprise.
drop policy if exists "booking_settings_manage_staff_insert" on public.booking_settings;
create policy "booking_settings_manage_staff_insert" on public.booking_settings
  for insert to authenticated
  with check (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_ecriture()))
  );

drop policy if exists "booking_settings_manage_staff_update" on public.booking_settings;
create policy "booking_settings_manage_staff_update" on public.booking_settings
  for update to authenticated
  using (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_ecriture()))
  )
  with check (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_ecriture()))
  );

drop policy if exists "booking_settings_manage_staff_delete" on public.booking_settings;
create policy "booking_settings_manage_staff_delete" on public.booking_settings
  for delete to authenticated
  using (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and 'agenda_communication' in (select public.categories_ecriture()))
  );


-- ════════════════════════════════════════════════════════════════════════════
-- 4. LES DOCUMENTS : UN ESPACE PAR COACH, FICHIER COMPRIS
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ LA POLICY FAUTIVE EST CELLE DE L'ÉLÈVE, PAS CELLE DU STAFF.
-- `documents_select_global_or_assigned` n'avait aucune condition sur
-- l'appelant dans sa branche « visibilité globale » : tout compte authentifié
-- la satisfaisait. On la remplace par la même intention, mais exprimée pour
-- un ÉLÈVE, et bornée au coach de cet élève.
--
-- ⚠️ `coach_id is null` RESTE VISIBLE DES ÉLÈVES, VOLONTAIREMENT. Les 17
-- documents historiques portent NULL. Les retirer de la vue des élèves serait
-- une régression pour eux ; les attribuer à un coach serait la réattribution
-- arbitraire qu'on s'interdit. Ils restent donc le fonds commun du cabinet,
-- géré par l'administrateur seul — et invisibles aux autres coachs.
drop policy if exists "documents_select_global_or_assigned" on public.documents;
create policy "documents_select_global_or_assigned" on public.documents
  for select to authenticated
  using (
    (select public.current_student_id()) is not null
    and status = 'publié'
    and (
      (visibility = 'global'
       and (coach_id is null
            or coach_id = (select s.coach_id from public.students s
                            where s.id = (select public.current_student_id()))))
      or exists (select 1 from public.document_assignments da
                  where da.document_id = documents.id
                    and da.student_id = (select public.current_student_id()))
    )
  );

-- ⚠️ ET L'INSERTION N'ÉTAIT BORNÉE À RIEN NON PLUS. `documents_manage_staff_insert`
-- acceptait tout `est_staff_global()` sans regarder `coach_id` : un coach
-- pouvait créer un document AU NOM d'un autre. On exige le propriétaire.
drop policy if exists "documents_manage_staff_insert" on public.documents;
create policy "documents_manage_staff_insert" on public.documents
  for insert to authenticated
  with check (
    coalesce(public.is_admin(), false)
    or (coach_id is not null
        and coach_id = (select public.current_staff_id())
        and (
          (category = 'nutrition' and coalesce('nutrition' in (select public.categories_ecriture()), false))
          or (category = 'entrainement' and coalesce('entrainement' in (select public.categories_ecriture()), false))
          or (category = 'administratif' and coalesce('suivi_eleve' in (select public.categories_ecriture()), false))
        ))
  );

-- Les trois autres policies du staff étaient DÉJÀ bornées au propriétaire par
-- `coach_ids_portee()` : on ne change que leur rôle.
alter policy "documents_manage_staff_select" on public.documents to authenticated;
alter policy "documents_manage_staff_update" on public.documents to authenticated;
alter policy "documents_manage_staff_delete" on public.documents to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 5. LE FICHIER SUIT LA LIGNE — POLICIES STORAGE DU SEAU « documents »
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ MASQUER LA LIGNE NE PROTÉGEAIT PAS LE FICHIER, et c'est tout l'objet de
-- cette section. La policy sortante signait n'importe quel objet du seau dès
-- `is_coach_or_admin()` — c'est-à-dire pour tout compte dont
-- `profiles.role in ('coach','admin')`. Un nouveau coach pouvait obtenir une
-- URL signée vers le PDF privé de l'administrateur, et les policies
-- d'écriture, sur le même critère, lui permettaient de le SUPPRIMER.
--
-- ⚠️ CONVENTION DE CHEMIN : `<document_id>/<nom de fichier>` (voir
-- lib/supabase/storage-documents.ts). Le premier segment est donc l'identifiant
-- du document, et c'est lui qui porte la propriété. La comparaison se fait en
-- TEXTE, sans transtypage en uuid : un chemin qui ne respecte pas la
-- convention ne fait pas lever la policy, il ne correspond simplement à rien.
--
-- ⚠️ LE SEAU EST CRÉÉ ICI S'IL MANQUE. Il existe en production (créé à la main
-- via supabase/schema.sql), mais le baseline local ne le contient pas : sans
-- cette ligne, l'isolation des fichiers ne serait pas TESTABLE en local.
-- `on conflict do nothing` : sans effet là où il existe déjà.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Lecture : l'administrateur, le propriétaire du document, le staff qui y a
-- accès par affectation d'élève (P13-B), et l'élève qui a le droit de lire le
-- document — même règle que la ligne, appliquée au fichier.
drop policy if exists "documents_bucket_select_authenticated" on storage.objects;
drop policy if exists "documents_bucket_select_accessible" on storage.objects;
create policy "documents_bucket_select_accessible" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      coalesce(public.is_admin(), false)
      or exists (
        select 1 from public.documents d
         where d.id::text = (storage.foldername(name))[1]
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

-- Écriture : l'administrateur, ou un membre du staff sur un fichier dont le
-- document lui appartient.
--
-- ⚠️ LE CAS « AUCUNE LIGNE » EST ACCORDÉ, ET IL FAUT LE DIRE. À la création,
-- le fichier est téléversé AVANT que la ligne existe (l'identifiant est tiré
-- côté client puis passé à `createDocument`) : exiger la ligne interdirait
-- tout envoi. Un fichier ORPHELIN — dont le document a été supprimé — reste
-- donc manipulable par n'importe quel membre du staff. C'est le prix de la
-- convention actuelle, et ça ne donne accès à rien qui soit encore rattaché à
-- un autre coach.
drop policy if exists "documents_bucket_manage_staff" on storage.objects;
create policy "documents_bucket_manage_staff" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (select public.current_staff_id()) is not null
    and (
      coalesce(public.is_admin(), false)
      or not exists (select 1 from public.documents d
                      where d.id::text = (storage.foldername(name))[1])
      or exists (select 1 from public.documents d
                  where d.id::text = (storage.foldername(name))[1]
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
      or not exists (select 1 from public.documents d
                      where d.id::text = (storage.foldername(name))[1])
      or exists (select 1 from public.documents d
                  where d.id::text = (storage.foldername(name))[1]
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
      or not exists (select 1 from public.documents d
                      where d.id::text = (storage.foldername(name))[1])
      or exists (select 1 from public.documents d
                  where d.id::text = (storage.foldername(name))[1]
                    and d.coach_id is not null
                    and d.coach_id = (select public.current_staff_id()))
    )
  );


-- ════════════════════════════════════════════════════════════════════════════
-- 6. LE JOURNAL D'EMAILS A ENFIN UN AUTEUR
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ IL N'Y AVAIT RIEN À FILTRER. `email_logs` ne portait aucune colonne
-- d'auteur : la seule policy, `est_staff_global()`, donnait le journal entier
-- à tout coach autonome. On ajoute donc d'abord le modèle.
--
-- ⚠️ NULLABLE, ET LES ANCIENNES LIGNES RESTENT NULL. Les emails déjà
-- journalisés — invitations administrateur, webhooks Stripe, cron de rappel —
-- n'ont pas d'auteur identifiable : les attribuer à un coach serait inventer
-- une donnée. NULL signifie « envoi système ou administrateur », lisible par
-- l'administrateur seul.
alter table public.email_logs
  add column if not exists sent_by_coach_id uuid references public.coaches(id) on delete set null;

comment on column public.email_logs.sent_by_coach_id is
  'Fiche staff à l''origine de l''envoi, posée côté SERVEUR et jamais depuis le '
  'navigateur. NULL = envoi système ou administrateur (toutes les lignes '
  'antérieures à 20261022090000), lisible par l''administrateur seul.';

create index if not exists email_logs_sent_by_coach_id_idx
  on public.email_logs (sent_by_coach_id) where sent_by_coach_id is not null;

-- ⚠️ LE DÉCLENCHEUR NE PEUT PAS SERVIR SEUL ICI, et c'est une différence
-- importante avec l'agenda. Les envois passent par `service_role`
-- (createSupabaseAdminClient) : `auth.uid()` y est NULL, donc rien à poser.
-- L'auteur est résolu côté serveur par la route, depuis la SESSION de
-- l'appelant, puis passé explicitement. Le déclencheur ci-dessous ne couvre
-- que le cas d'un insert fait dans une session authentifiée, et il REFUSE
-- qu'un non-administrateur signe au nom d'un autre.
create or replace function public.email_logs_poser_auteur()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if auth.uid() is null then
    return new;                      -- service_role, cron : la route décide.
  end if;

  if new.sent_by_coach_id is null then
    new.sent_by_coach_id := public.current_staff_id();
    return new;
  end if;

  if not coalesce(public.is_admin(), false)
     and new.sent_by_coach_id is distinct from public.current_staff_id() then
    raise exception 'Journal d''emails : un envoi ne peut pas être signé au nom d''un autre coach'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$fn$;
alter function public.email_logs_poser_auteur() owner to postgres;
revoke all on function public.email_logs_poser_auteur() from public, anon, authenticated, service_role;

drop trigger if exists email_logs_poser_auteur on public.email_logs;
create trigger email_logs_poser_auteur
  before insert on public.email_logs
  for each row execute function public.email_logs_poser_auteur();

drop policy if exists "email_logs_select_staff" on public.email_logs;
create policy "email_logs_select_staff" on public.email_logs
  for select to authenticated
  using (
    coalesce(public.is_admin(), false)
    or (sent_by_coach_id is not null
        and sent_by_coach_id = (select public.current_staff_id()))
  );

-- ⚠️ ET LE JOURNAL DES EMAILS DE RENDEZ-VOUS SUIT LE RENDEZ-VOUS.
-- `appointment_email_logs` portait les mêmes quatre policies
-- `est_staff_global()`. Sa propriété se lit sur le rendez-vous, qui a déjà un
-- `coach_id` : inutile d'ajouter une colonne.
drop policy if exists "appointment_email_logs_manage_staff_select" on public.appointment_email_logs;
create policy "appointment_email_logs_manage_staff_select" on public.appointment_email_logs
  for select to authenticated
  using (
    coalesce(public.is_admin(), false)
    or exists (select 1 from public.appointments a
                where a.id = appointment_email_logs.appointment_id
                  and a.coach_id is not null
                  and a.coach_id = (select public.current_staff_id()))
  );

drop policy if exists "appointment_email_logs_manage_staff_insert" on public.appointment_email_logs;
create policy "appointment_email_logs_manage_staff_insert" on public.appointment_email_logs
  for insert to authenticated
  with check (
    coalesce(public.is_admin(), false)
    or exists (select 1 from public.appointments a
                where a.id = appointment_email_logs.appointment_id
                  and a.coach_id is not null
                  and a.coach_id = (select public.current_staff_id()))
  );

drop policy if exists "appointment_email_logs_manage_staff_update" on public.appointment_email_logs;
create policy "appointment_email_logs_manage_staff_update" on public.appointment_email_logs
  for update to authenticated
  using (
    coalesce(public.is_admin(), false)
    or exists (select 1 from public.appointments a
                where a.id = appointment_email_logs.appointment_id
                  and a.coach_id is not null
                  and a.coach_id = (select public.current_staff_id()))
  )
  with check (
    coalesce(public.is_admin(), false)
    or exists (select 1 from public.appointments a
                where a.id = appointment_email_logs.appointment_id
                  and a.coach_id is not null
                  and a.coach_id = (select public.current_staff_id()))
  );

drop policy if exists "appointment_email_logs_manage_staff_delete" on public.appointment_email_logs;
create policy "appointment_email_logs_manage_staff_delete" on public.appointment_email_logs
  for delete to authenticated
  using (
    coalesce(public.is_admin(), false)
    or exists (select 1 from public.appointments a
                where a.id = appointment_email_logs.appointment_id
                  and a.coach_id is not null
                  and a.coach_id = (select public.current_staff_id()))
  );


-- ════════════════════════════════════════════════════════════════════════════
-- 7. LE RESTE DES POLICIES `{public}` DE CES TABLES PASSE À `authenticated`
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ CE N'EST PAS DE L'ESTHÉTIQUE. Une policy permissive au rôle `{public}`
-- est évaluée pour `anon`, et celles-ci appellent des fonctions internes dont
-- `anon` n'a pas l'EXECUTE : elles LÈVENT au lieu de refuser, et une policy
-- qui lève fait échouer TOUTE la requête — y compris la branche qui aurait dû
-- répondre. C'est ce mécanisme qui avait rendu la vitrine publique illisible
-- avant 20261020090000. Aucune page anonyme ne lit ces tables.
--
-- Ni la condition, ni le périmètre : seul le rôle change.
alter policy "document_assignments_select_self_or_staff" on public.document_assignments to authenticated;
alter policy "document_assignments_manage_staff" on public.document_assignments to authenticated;
alter policy "document_assignments_update_staff" on public.document_assignments to authenticated;
alter policy "document_assignments_delete_staff" on public.document_assignments to authenticated;
alter policy "appointments_select_own_student" on public.appointments to authenticated;
alter policy "appointments_select_staff" on public.appointments to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 8. LE CHEMIN D'ÉCRITURE RÉEL DU CALENDRIER : LES RPC `SECURITY DEFINER`
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ SANS CETTE SECTION, TOUT LE RESTE SERAIT DÉCORATIF. Les écritures du
-- calendrier ne passent pas par PostgREST mais par cinq fonctions
-- `SECURITY DEFINER` (`lib/supabase/appointments.ts`), qui s'exécutent avec
-- les droits de leur propriétaire et NE SONT DONC PAS SOUMISES À LA RLS. Ce
-- qu'elles autorisent, elles l'autorisent vraiment. Relevé dans leur code :
--
--   · `update_coach_event_atomic` autorise sur
--     `staff_role() in ('admin','assistant')` — donc TOUT coach autonome
--     pouvait modifier l'événement de n'importe qui, l'administrateur compris ;
--   · `cancel_appointment_atomic` et `reschedule_appointment_atomic` ont la
--     même branche pour un rendez-vous SANS élève ;
--   · `create_appointment_atomic` n'écrit PAS `coach_id` : tous les
--     rendez-vous créés par l'application sont sans propriétaire ;
--   · `calendar_has_conflict` et `get_busy_ranges` balaient le cabinet
--     ENTIER : les créneaux occupés de l'administrateur bloquaient ceux du
--     coach, et réciproquement. C'est la forme la plus visible de
--     « leurs plannings partagent les mêmes données ».
--
-- `create or replace` conserve les privilèges d'exécution et le propriétaire :
-- on ne retouche ni l'un ni l'autre.
--
-- ⚠️ LE PÉRIMÈTRE DE CONFLIT EST CELUI D'UN SEUL AGENDA, et il se déduit de
-- l'appelant — jamais d'un paramètre, qui serait déclaratif :
--   · membre du staff      → sa propre fiche ;
--   · élève                → la fiche de SON coach ;
--   · `service_role`       → le cabinet entier (travaux serveur, inchangé).
-- Les lignes SANS propriétaire (héritage : `coach_id` NULL) ne bloquent que
-- l'ADMINISTRATEUR. Les rendre bloquantes pour tous recréerait le couplage
-- qu'on corrige ; les attribuer serait la réattribution qu'on s'interdit.

create or replace function public.agenda_portee_conflit()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(
    public.current_staff_id(),
    (select s.coach_id from public.students s where s.id = public.current_student_id())
  );
$fn$;
alter function public.agenda_portee_conflit() owner to postgres;
revoke all on function public.agenda_portee_conflit() from public, anon, authenticated, service_role;
grant execute on function public.agenda_portee_conflit() to authenticated, service_role;

comment on function public.agenda_portee_conflit() is
  'Fiche coach dont l''agenda fait foi pour l''appelant : la sienne s''il est staff, '
  'celle de son coach s''il est élève, NULL en contexte serveur (le cabinet entier). '
  'Sert à borner calendar_has_conflict et get_busy_ranges à UN agenda.';

create or replace function public.calendar_has_conflict(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_exclude_appointment_id uuid default null,
  p_exclude_coach_event_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with portee as (
    select public.agenda_portee_conflit() as coach_id,
           coalesce(public.is_admin(), false) as est_admin
  )
  select exists (
    select 1 from public.appointments a, portee p
     where a.status in ('pending', 'confirmed')
       and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
       and a.start_at < p_end_at
       and a.end_at > p_start_at
       and (p.coach_id is null
            or a.coach_id = p.coach_id
            or (a.coach_id is null and p.est_admin))
  ) or exists (
    select 1 from public.coach_unavailabilities u, portee p
     where (p_exclude_coach_event_id is null or u.id <> p_exclude_coach_event_id)
       and u.start_at < p_end_at
       and u.end_at > p_start_at
       and (p.coach_id is null
            or u.coach_id = p.coach_id
            or (u.coach_id is null and p.est_admin))
  );
$fn$;
alter function public.calendar_has_conflict(timestamptz, timestamptz, uuid, uuid) owner to postgres;

-- ⚠️ DEUX PÉRIMÈTRES DISTINCTS, ET LES CONFONDRE CASSE P13-B.
--   · le périmètre de CONFLIT est l'agenda qu'on ÉCRIT : un seul, celui de
--     l'auteur (ou celui du coach de l'élève qui réserve). L'administrateur
--     qui pose son propre événement ne doit pas être bloqué par celui d'un
--     coach — c'est exactement le couplage qu'on corrige ;
--   · le périmètre de LECTURE des bornes occupées est la PORTÉE P13-B :
--     l'administrateur voit tout (visibilité globale), un coach autonome ses
--     propres bornes, et un collaborateur celles des coachs de ses élèves
--     affectés. Le contrôle I10 de la checklist P13-B l'exige, et il a
--     rougi quand les deux périmètres étaient confondus.
create or replace function public.agenda_portee_lecture()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select c from public.coach_ids_portee() c
   where public.current_staff_id() is not null
  union
  select s.coach_id from public.students s
   where s.id = public.current_student_id() and s.coach_id is not null;
$fn$;
alter function public.agenda_portee_lecture() owner to postgres;
revoke all on function public.agenda_portee_lecture() from public, anon, authenticated, service_role;
grant execute on function public.agenda_portee_lecture() to authenticated, service_role;

comment on function public.agenda_portee_lecture() is
  'Fiches coach dont les bornes occupées sont visibles par l''appelant : sa portée '
  'P13-B s''il est staff (admin = tout le cabinet), le coach de son élève s''il est '
  'élève. À ne pas confondre avec agenda_portee_conflit(), qui désigne LE seul '
  'agenda écrit et borne les collisions.';

create or replace function public.get_busy_ranges(p_from timestamptz, p_to timestamptz)
returns table(start_at timestamptz, end_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with autorise as (
    select coalesce(auth.role(), '') = 'service_role'
        or public.current_student_id() is not null
        or coalesce(public.est_staff_global(), false)
        or (
          -- ⚠️ LA PERMISSION SEULE NE SUFFIT JAMAIS — invariant P13-B. Un
          -- collaborateur doit AUSSI avoir au moins un élève affecté :
          -- `coach_ids_portee()` est vide sans affectation.
          coalesce('agenda_communication' in (select public.categories_lecture()), false)
          and exists (select 1 from public.coach_ids_portee())
        ) as ok
  ),
  portee as (
    select coalesce(auth.role(), '') = 'service_role' as serveur,
           coalesce(public.is_admin(), false) as est_admin
  )
  select a.start_at, a.end_at
    from public.appointments a, portee p
   where (select ok from autorise)
     and a.status in ('pending', 'confirmed')
     and a.start_at < p_to
     and a.end_at > p_from
     and (p.serveur
          or a.coach_id in (select public.agenda_portee_lecture())
          or (a.coach_id is null and p.est_admin))
  union all
  select u.start_at, u.end_at
    from public.coach_unavailabilities u, portee p
   where (select ok from autorise)
     and u.start_at < p_to
     and u.end_at > p_from
     and (p.serveur
          or u.coach_id in (select public.agenda_portee_lecture())
          or (u.coach_id is null and p.est_admin))
   order by 1;
$fn$;
alter function public.get_busy_ranges(timestamptz, timestamptz) owner to postgres;

-- ── L'événement d'agenda ne se modifie que par son propriétaire ────────────
-- Seule la première branche change : `staff_role() in ('admin','assistant')`
-- devient `is_admin()`. La branche propriétaire, elle, est conservée mot pour
-- mot — un coach garde la main sur SES événements.
create or replace function public.update_coach_event_atomic(
  p_id uuid,
  p_title text,
  p_notes text,
  p_location text,
  p_all_day boolean,
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_category text;
  v_coach_id uuid;
begin
  if public.current_staff_id() is null then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'calendar_invalid_period';
  end if;

  perform pg_advisory_xact_lock(hashtext('calendar_booking'));

  select category, coach_id into v_category, v_coach_id
    from public.coach_unavailabilities where id = p_id;
  if not found then
    return false;
  end if;

  if not coalesce(
       coalesce(public.is_admin(), false)
       or (v_coach_id is not null
           and v_coach_id = public.current_staff_id()
           and 'agenda_communication' in (select public.categories_ecriture()))
     , false) then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;

  if v_category <> 'unavailability'
     and public.calendar_has_conflict(p_start_at, p_end_at, null, p_id) then
    raise exception 'calendar_conflict';
  end if;

  update public.coach_unavailabilities
     set title = coalesce(p_title, ''),
         notes = coalesce(p_notes, ''),
         location = coalesce(p_location, ''),
         all_day = coalesce(p_all_day, false),
         start_at = p_start_at,
         end_at = p_end_at,
         updated_at = now()
   where id = p_id;
  return true;
end;
$fn$;
alter function public.update_coach_event_atomic(uuid, text, text, text, boolean, timestamptz, timestamptz) owner to postgres;

-- ── Le rendez-vous reçoit enfin un propriétaire à sa création ──────────────
-- ⚠️ `coach_id` N'ÉTAIT PAS ÉCRIT DU TOUT. La colonne existe depuis le
-- baseline, et aucun rendez-vous créé par l'application ne la renseignait :
-- tous sans propriétaire. On la pose, en la DÉDUISANT de l'appelant — la fiche
-- du staff qui crée, ou le coach de l'élève qui réserve. Le cloisonnement
-- effectif des rendez-vous, lui, reposait déjà sur l'élève (mesuré : un coach
-- ne voit pas le rendez-vous d'un élève qui n'est pas le sien) ; ce qui
-- manquait était l'agenda auquel le créneau appartient.
create or replace function public.create_appointment_atomic(
  p_student_id uuid,
  p_title text,
  p_description text,
  p_appointment_type text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_location text,
  p_meeting_url text,
  p_ics_uid text,
  p_status text default 'confirmed'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_id uuid;
  v_coach_id uuid;
begin
  -- `coalesce(…, false)` est INDISPENSABLE : `current_student_id()` rend NULL
  -- pour qui n'est pas élève, donc la comparaison rend NULL, et `false or NULL`
  -- vaut NULL. Or `if not (NULL)` ne prend pas la branche `then`.
  if not coalesce(
       (p_student_id is not null
        and p_student_id in (select public.student_ids_agenda_communication_ecriture()))
       or (p_student_id is not null and public.current_student_id() is not null
           and p_student_id = public.current_student_id())
       or (p_student_id is null and public.current_staff_id() is not null
           and coalesce('agenda_communication' in (select public.categories_ecriture()), false))
     , false) then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'calendar_invalid_period';
  end if;
  if p_status not in ('pending', 'confirmed') then
    raise exception 'calendar_invalid_status';
  end if;

  -- Propriétaire de l'agenda : la fiche de l'appelant s'il est staff, sinon
  -- (réservation par l'élève) le coach de cet élève.
  v_coach_id := coalesce(
    public.current_staff_id(),
    (select s.coach_id from public.students s where s.id = p_student_id)
  );

  perform pg_advisory_xact_lock(hashtext('calendar_booking'));
  if public.calendar_has_conflict(p_start_at, p_end_at) then
    raise exception 'calendar_conflict';
  end if;

  insert into public.appointments
    (student_id, coach_id, title, description, appointment_type, start_at, end_at,
     location, meeting_url, status, ics_uid)
  values
    (p_student_id, v_coach_id, coalesce(p_title, ''), coalesce(p_description, ''),
     coalesce(p_appointment_type, 'Autre'), p_start_at, p_end_at, coalesce(p_location, ''),
     coalesce(p_meeting_url, ''), p_status, coalesce(p_ics_uid, ''))
  returning id into v_id;
  return v_id;
end;
$fn$;
alter function public.create_appointment_atomic(uuid, text, text, text, timestamptz, timestamptz, text, text, text, text) owner to postgres;

-- ── Annuler et reporter : le rendez-vous sans élève suit son propriétaire ──
create or replace function public.cancel_appointment_atomic(p_appointment_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_student_id uuid;
  v_coach_id uuid;
begin
  select student_id, coach_id into v_student_id, v_coach_id
    from public.appointments where id = p_appointment_id;
  if not found then
    return false;
  end if;
  if not coalesce(
       (v_student_id is not null
        and v_student_id in (select public.student_ids_agenda_communication_ecriture()))
       or (v_student_id is not null and public.current_student_id() is not null
           and v_student_id = public.current_student_id())
       -- Rendez-vous sans élève : l'administrateur, ou le coach à qui
       -- l'agenda appartient. Avant, tout coach autonome passait ici.
       or (v_student_id is null and coalesce(public.is_admin(), false))
       or (v_student_id is null and v_coach_id is not null
           and v_coach_id = public.current_staff_id()
           and coalesce('agenda_communication' in (select public.categories_ecriture()), false))
     , false) then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;
  update public.appointments
     set status = 'cancelled',
         cancellation_reason = coalesce(p_reason, ''),
         updated_at = now()
   where id = p_appointment_id;
  return true;
end;
$fn$;
alter function public.cancel_appointment_atomic(uuid, text) owner to postgres;

create or replace function public.reschedule_appointment_atomic(
  p_appointment_id uuid,
  p_new_start_at timestamptz,
  p_new_end_at timestamptz,
  p_ics_uid text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_original public.appointments%rowtype;
  v_id uuid;
begin
  if public.current_staff_id() is null then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;
  if p_new_start_at is null or p_new_end_at is null or p_new_end_at <= p_new_start_at then
    raise exception 'calendar_invalid_period';
  end if;
  perform pg_advisory_xact_lock(hashtext('calendar_booking'));
  select * into v_original from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'calendar_not_found';
  end if;
  if not coalesce(
       (v_original.student_id is not null
        and v_original.student_id in (select public.student_ids_agenda_communication_ecriture()))
       or (v_original.student_id is null and coalesce(public.is_admin(), false))
       or (v_original.student_id is null and v_original.coach_id is not null
           and v_original.coach_id = public.current_staff_id()
           and coalesce('agenda_communication' in (select public.categories_ecriture()), false))
     , false) then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;
  update public.appointments
     set status = 'cancelled', cancellation_reason = 'Reporté', updated_at = now()
   where id = p_appointment_id;
  if public.calendar_has_conflict(p_new_start_at, p_new_end_at) then
    -- Annule toute la transaction (l'original redevient actif).
    raise exception 'calendar_conflict';
  end if;
  insert into public.appointments
    (student_id, coach_id, title, description, appointment_type, start_at, end_at,
     location, meeting_url, status, rescheduled_from_id, ics_uid)
  values
    (v_original.student_id, v_original.coach_id, v_original.title, v_original.description,
     v_original.appointment_type, p_new_start_at, p_new_end_at, v_original.location,
     v_original.meeting_url, 'confirmed', v_original.id, coalesce(p_ics_uid, ''))
  returning id into v_id;
  return v_id;
end;
$fn$;
alter function public.reschedule_appointment_atomic(uuid, timestamptz, timestamptz, text) owner to postgres;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. VÉRIFICATION — LECTURES DU CATALOGUE SYSTÈME UNIQUEMENT
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare
  v_n int;
  v_txt text;
begin
  -- 1. La propriété est posée à la création, sur les quatre tables.
  select count(*) into v_n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
         join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     and p.proname = 'poser_proprietaire_staff'
     and c.relname in ('coach_availabilities','coach_unavailabilities','booking_settings','documents');
  if v_n <> 4 then
    raise exception 'Espace coach : le déclencheur de propriété manque sur une table (% sur 4)', v_n;
  end if;

  -- 2. Les deux colonnes de propriété ajoutées existent.
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='booking_settings' and column_name='coach_id') then
    raise exception 'Espace coach : booking_settings.coach_id manque — les réglages resteraient communs';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='email_logs' and column_name='sent_by_coach_id') then
    raise exception 'Espace coach : email_logs.sent_by_coach_id manque — le journal n''aurait pas d''auteur';
  end if;

  -- 3. ⚠️ LE CONTRÔLE QUI PORTE LA CORRECTION : plus aucune policy de ces
  --    tables ne s'appuie sur `est_staff_global()`, qui rend VRAI pour tout
  --    coach autonome et ouvrait donc les lignes des autres.
  select count(*), coalesce(string_agg(tablename || '.' || policyname, ', '), '')
    into v_n, v_txt
    from pg_policies
   where schemaname = 'public'
     and tablename in ('coach_availabilities','coach_unavailabilities','booking_settings',
                       'documents','email_logs','appointment_email_logs')
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'est_staff_global';
  if v_n <> 0 then
    raise exception 'Espace coach : % policy(ies) s''appuient encore sur est_staff_global() — %', v_n, v_txt;
  end if;

  -- 4. …et toutes sont bornées au rôle authentifié. `= '{authenticated}'` et
  --    non `~ 'authenticated'` : `{anon,authenticated}` satisferait une
  --    recherche de sous-chaîne tout en laissant le visiteur dans la règle.
  select count(*), coalesce(string_agg(tablename || '.' || policyname || ' ' || roles::text, ', '), '')
    into v_n, v_txt
    from pg_policies
   where schemaname = 'public'
     and tablename in ('coach_availabilities','coach_unavailabilities','booking_settings',
                       'documents','email_logs','appointment_email_logs',
                       'document_assignments','appointments')
     and roles::text <> '{authenticated}';
  if v_n <> 0 then
    raise exception 'Espace coach : % policy(ies) ne sont pas bornées à authenticated — %', v_n, v_txt;
  end if;

  -- 5. Les écritures manquantes des indisponibilités existent désormais.
  select count(*) into v_n
    from pg_policies
   where schemaname='public' and tablename='coach_unavailabilities' and cmd in ('INSERT','UPDATE');
  if v_n <> 2 then
    raise exception 'Espace coach : coach_unavailabilities n''a pas ses policies INSERT et UPDATE (% sur 2)', v_n;
  end if;

  -- 6. Le fichier suit la ligne : le seau existe, ses quatre policies sont là,
  --    et plus une seule ne s'appuie sur `is_coach_or_admin()`.
  if not exists (select 1 from storage.buckets where id = 'documents') then
    raise exception 'Espace coach : le seau Storage « documents » est absent';
  end if;
  select count(*) into v_n
    from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname in ('documents_bucket_select_accessible','documents_bucket_manage_staff',
                        'documents_bucket_update_staff','documents_bucket_delete_staff')
     and roles::text = '{authenticated}';
  if v_n <> 4 then
    raise exception 'Espace coach : les policies Storage du seau documents ne sont pas les quatre attendues au rôle authentifié (% sur 4)', v_n;
  end if;
  select count(*) into v_n
    from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname like 'documents_bucket%'
     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'is_coach_or_admin';
  if v_n <> 0 then
    raise exception 'Espace coach : une policy Storage du seau documents signe encore sur le seul is_coach_or_admin() (%)', v_n;
  end if;

  -- 7. Un seul jeu de réglages de réservation par coach.
  if not exists (select 1 from pg_indexes
                  where schemaname='public' and indexname='booking_settings_un_par_coach') then
    raise exception 'Espace coach : l''index d''unicité des réglages par coach manque';
  end if;

  -- 8. Et `anon` n'a récupéré l'EXECUTE d'aucune fonction interne : la
  --    correction passe par les rôles et la propriété, jamais par une
  --    réouverture.
  select count(*) into v_n
    from unnest(array['public.is_admin()','public.est_staff_global()','public.current_staff_id()',
                      'public.coach_ids_portee()','public.categories_lecture()',
                      'public.document_ids_lecture()']) f
   where has_function_privilege('anon', f::regprocedure, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'Espace coach : anon a récupéré l''EXECUTE de % fonction(s) interne(s) — interdit', v_n;
  end if;

  -- 9. ⚠️ LE CHEMIN D'ÉCRITURE RÉEL : plus une seule RPC du calendrier
  --    n'autorise sur l'étiquette `assistant`, qui est celle de tout coach
  --    autonome. On lit le code source des fonctions, commentaires retirés —
  --    sans quoi le contrôle se déclencherait sur l'explication elle-même.
  select count(*), coalesce(string_agg(p.proname, ', '), '')
    into v_n, v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('update_coach_event_atomic','cancel_appointment_atomic',
                       'reschedule_appointment_atomic','create_appointment_atomic')
     and regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
         ~ 'staff_role\(\)[^;]*assistant';
  if v_n <> 0 then
    raise exception 'Espace coach : % RPC du calendrier autorisent encore sur staff_role() = assistant — %', v_n, v_txt;
  end if;

  -- 10. …et le rendez-vous créé par l'application reçoit un propriétaire.
  if regexp_replace(pg_get_functiondef('public.create_appointment_atomic(uuid,text,text,text,timestamptz,timestamptz,text,text,text,text)'::regprocedure),
                    '--[^' || chr(10) || ']*', '', 'g') !~ 'coach_id' then
    raise exception 'Espace coach : create_appointment_atomic n''écrit toujours pas coach_id — les rendez-vous resteraient sans propriétaire';
  end if;

  -- 11. Le périmètre de conflit est borné à un agenda, dans les deux
  --     fonctions qui le calculent.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and ((p.proname = 'calendar_has_conflict'
           and pg_get_functiondef(p.oid) ~ 'agenda_portee_conflit')
       or (p.proname = 'get_busy_ranges'
           and pg_get_functiondef(p.oid) ~ 'agenda_portee_lecture'));
  if v_n <> 2 then
    raise exception 'Espace coach : le périmètre par agenda manque à calendar_has_conflict ou get_busy_ranges (% sur 2)', v_n;
  end if;

  /*
   * ⚠️ CE QUE CES ONZE CONTRÔLES NE PROUVENT PAS. Ils lisent le catalogue
   * système : ils établissent que la RÈGLE est celle attendue, pas que deux
   * coachs se croisent correctement sur le chemin réel. Ça se mesure en
   * ouvrant une session par acteur — donc hors d'une migration, qui ne doit
   * pas toucher au rôle actif de sa session :
   *
   *     supabase/tests/espace_coach_isolation_checklist.sql
   */
  raise notice 'Espace coach : propriété posée sur agenda/réglages/documents, policies bornées au propriétaire et au rôle authentifié, fichiers du seau documents alignés sur la ligne, journal d''emails doté d''un auteur. Isolation réelle mesurée par supabase/tests/espace_coach_isolation_checklist.sql.';
end $g$;

commit;
