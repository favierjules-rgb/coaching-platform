-- ────────────────────────────────────────────────────────────────────────────
-- F5 — RÉPONSE VIDÉO DU COACH (socle : base, stockage, autorité, annotations)
--      chantier feat/coach-reply-video
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION APPORTE
-- ────────────────────────────────────────────────────────────────────────────
-- Le coach répond déjà par écrit (`workout_feedback.coach_reply`). Il peut
-- désormais joindre UNE vidéo à cette réponse, éventuellement recouverte
-- d'annotations dessinées.
--
--   • `workout_feedback.coach_reply_video_path`        — chemin dans le bucket
--   • `workout_feedback.coach_reply_video_uploaded_at` — DÉRIVÉ, jamais reçu
--   • `workout_feedback.coach_reply_video_annotations` — calque horodaté
--   • bucket privé `coach-reply-videos`
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI UN SECOND BUCKET, ET PAS `feedback-videos`
-- ────────────────────────────────────────────────────────────────────────────
-- Parce que le SENS DE LECTURE EST INVERSÉ, et qu'un bucket ne porte qu'un
-- jeu de policies.
--
--   feedback-videos    : l'ÉLÈVE écrit, le coach rattaché et l'admin lisent.
--   coach-reply-videos : le COACH rattaché écrit, l'élève concerné lit.
--
-- Loger les deux au même endroit obligerait chaque policy à démêler qui
-- écrit quoi selon un préfixe — c'est-à-dire à faire reposer le cloisonnement
-- sur une convention de nommage plutôt que sur une règle. Deux buckets, deux
-- jeux de policies, chacun lisible d'un coup d'œil.
--
-- La FORME DU CHEMIN reste `<student_id>/<uuid>.<ext>`, et le premier segment
-- reste l'élève — même quand c'est le coach qui dépose. C'est délibéré : ce
-- qui cloisonne, c'est À QUI la vidéo est destinée. Un coach qui change
-- d'élève, ou un élève qui change de coach, ne doit jamais faire basculer la
-- visibilité d'un fichier déjà déposé.
--
-- ────────────────────────────────────────────────────────────────────────────
-- MATRICE DE PROPRIÉTÉ — SUITE DE CELLE DE 20260821090000
-- ────────────────────────────────────────────────────────────────────────────
-- A = écrit par l'élève · B = dérivé par la base · C = réservé au staff
-- D = figé après création
--
-- workout_feedback (suite)
--   coach_reply_video_path          C     réservé au staff, comme coach_reply.
--                                         Un élève ne peut ni le poser ni le
--                                         modifier : le gardien restaure
--                                         l'ancienne valeur. Le chemin doit
--                                         par ailleurs désigner le dossier de
--                                         L'ÉLÈVE DU RETOUR — sans quoi un
--                                         coach pourrait faire lire à un élève
--                                         la réponse destinée à un autre.
--   coach_reply_video_annotations   C     même règle : le calque appartient au
--                                         coach qui l'a dessiné.
--   coach_reply_video_uploaded_at   B     posé quand un chemin apparaît ou
--                                         change, remis à NULL au retrait.
--                                         Jamais accepté de personne, staff
--                                         compris : c'est lui qui datera la
--                                         purge des 3 jours.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LES ANNOTATIONS NE SONT PAS GRAVÉES DANS LA VIDÉO
-- ────────────────────────────────────────────────────────────────────────────
-- Aucun transcodage n'a lieu dans le navigateur (règle tenue depuis F4). Le
-- calque est donc une LISTE DE TRACÉS HORODATÉS, rejouée par-dessus la vidéo
-- à la lecture : flèche, cercle, trait libre, texte, chacun avec son instant
-- d'apparition et sa durée. Non destructif, modifiable après coup, et l'élève
-- voit exactement ce que le coach a dessiné.
--
-- Les coordonnées sont NORMALISÉES entre 0 et 1, jamais en pixels : la même
-- annotation doit tomber au bon endroit sur un téléphone et sur un écran de
-- bureau.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
-- • Aucune purge. La rétention de 3 jours est portée par le balayeur existant
--   (F4.1), étendu à ce second bucket avec son propre seuil. Rien ici.
-- • Aucun backfill : tout l'historique reste à NULL.
--
-- Idempotente : rejouable sans effet.
-- ────────────────────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════════════
-- A. LE CALQUE D'ANNOTATIONS — sa forme, vérifiée en base
-- ════════════════════════════════════════════════════════════════════════════
-- Une colonne `jsonb` sans contrainte accepte n'importe quoi, y compris ce
-- que le lecteur ne saura pas rejouer. On valide donc la STRUCTURE ici, comme
-- `exercise_library.movement_pattern` valide son vocabulaire.
--
-- `immutable` et sans accès aux tables : c'est une condition nécessaire pour
-- être utilisable dans un CHECK.
create or replace function public.coach_reply_video_annotations_ok(p_calque jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_calque is null
    or (
      jsonb_typeof(p_calque) = 'array'
      -- Un calque n'est pas un journal : au-delà de 200 tracés, c'est une
      -- boucle de dessin partie en vrille, pas une intention pédagogique.
      and jsonb_array_length(p_calque) <= 200
      -- ET une borne en TAILLE, parce que la précédente ne borne rien d'utile
      -- toute seule : deux cents traits libres de deux cent quarante points
      -- pèsent plus d'un mégaoctet et passeraient le compte de 200 sans
      -- broncher. L'éditeur s'arrête, lui, à 200 000 caractères — donc un
      -- calque produit par l'application n'atteint JAMAIS ce plafond-ci, et
      -- le coach ne découvre pas un refus après vingt minutes de dessin.
      and length(p_calque::text) <= 262144
      and not exists (
        select 1
          from jsonb_array_elements(p_calque) as tr
         where jsonb_typeof(tr) <> 'object'
            -- Un type que le lecteur ne sait pas dessiner ne doit pas entrer.
            or coalesce(tr->>'type', '') not in ('fleche', 'cercle', 'trait', 'texte')
            -- Instant d'apparition et durée : sans eux, rien n'est rejouable.
            --
            -- `coalesce(..., '')` N'EST PAS DÉCORATIF. `tr->'duree'` vaut SQL
            -- NULL quand la clé est ABSENTE, `jsonb_typeof(NULL)` vaut NULL,
            -- et `NULL <> 'number'` vaut NULL — donc la ligne ne satisfait pas
            -- le WHERE, donc `not exists` est vrai, donc le calque PASSE. Une
            -- annotation sans durée aurait été acceptée en silence. Même
            -- leçon que `coalesce(p_ok, false)` dans les checklists : un
            -- verdict NULL doit compter comme un échec, jamais comme un
            -- succès muet. Tous les `jsonb_typeof` de cette fonction sont
            -- protégés pour cette raison.
            or coalesce(jsonb_typeof(tr->'debut'), '') <> 'number'
            or coalesce(jsonb_typeof(tr->'duree'), '') <> 'number'
            or (tr->>'debut')::numeric < 0
            or (tr->>'duree')::numeric <= 0
            -- 120 s : la durée maximale d'une réponse. Un tracé qui apparaît
            -- à la troisième minute d'une vidéo qui en dure deux ne désigne
            -- rien, et une durée d'affichage d'un an non plus.
            or (tr->>'debut')::numeric > 120
            or (tr->>'duree')::numeric > 120
            -- CHAQUE TYPE PORTE DE QUOI ÊTRE DESSINÉ. Sans ces contrôles, une
            -- « flèche » sans extrémités passait la validation : la base
            -- acceptait un tracé que le lecteur écarte silencieusement, et la
            -- seule borne réelle vivait dans le navigateur.
            or (tr->>'type' = 'fleche'
                and (coalesce(jsonb_typeof(tr->'de'), '') <> 'object'
                     or coalesce(jsonb_typeof(tr->'a'), '') <> 'object'))
            or (tr->>'type' = 'cercle'
                and (coalesce(jsonb_typeof(tr->'centre'), '') <> 'object'
                     or coalesce(jsonb_typeof(tr->'rayon'), '') <> 'number'
                     or (tr->>'rayon')::numeric <= 0
                     or (tr->>'rayon')::numeric > 1))
            or (tr->>'type' = 'trait'
                and (coalesce(jsonb_typeof(tr->'points'), '') <> 'array'
                     -- Un trait d'un seul point ne se dessine pas.
                     or jsonb_array_length(tr->'points') < 2
                     or jsonb_array_length(tr->'points') > 240))
            or (tr->>'type' = 'texte'
                and (coalesce(jsonb_typeof(tr->'position'), '') <> 'object'
                     or coalesce(jsonb_typeof(tr->'contenu'), '') <> 'string'
                     or length(tr->>'contenu') = 0
                     -- Une étiquette, pas un paragraphe. Miroir de
                     -- ANNOTATION_TEXTE_MAX.
                     or length(tr->>'contenu') > 80))
      )
      -- ET TOUT POINT TOMBE DANS LE CADRE. Les coordonnées sont normalisées
      -- entre 0 et 1 ; hors de là, le tracé désigne le vide. Le lecteur les
      -- BORNE déjà à l'affichage — mais une protection qui ne vit que dans le
      -- navigateur n'est pas une protection, elle est un affichage poli.
      and not exists (
        select 1
          from jsonb_array_elements(p_calque) as tr,
               lateral jsonb_array_elements(
                 (case when jsonb_typeof(tr->'points') = 'array' then tr->'points' else '[]'::jsonb end)
                 || (case when jsonb_typeof(tr->'de') = 'object' then jsonb_build_array(tr->'de') else '[]'::jsonb end)
                 || (case when jsonb_typeof(tr->'a') = 'object' then jsonb_build_array(tr->'a') else '[]'::jsonb end)
                 || (case when jsonb_typeof(tr->'centre') = 'object' then jsonb_build_array(tr->'centre') else '[]'::jsonb end)
                 || (case when jsonb_typeof(tr->'position') = 'object' then jsonb_build_array(tr->'position') else '[]'::jsonb end)
               ) as pt
         where coalesce(jsonb_typeof(pt->'x'), '') <> 'number'
            or coalesce(jsonb_typeof(pt->'y'), '') <> 'number'
            or (pt->>'x')::numeric < 0 or (pt->>'x')::numeric > 1
            or (pt->>'y')::numeric < 0 or (pt->>'y')::numeric > 1
      )
    )
$$;

comment on function public.coach_reply_video_annotations_ok(jsonb) is
  'Valide la STRUCTURE du calque d''annotations d''une réponse vidéo de coach : tableau, 200 tracés et 256 Ko maximum, type connu, instant et durée numériques bornés à 120 s, champs obligatoires par type, texte de 80 caractères maximum, coordonnées normalisées entre 0 et 1. Miroir applicatif : lib/video-annotations.ts. Voir 20260827090000.';


-- ════════════════════════════════════════════════════════════════════════════
-- B. LES COLONNES
-- ════════════════════════════════════════════════════════════════════════════
alter table public.workout_feedback
  add column if not exists coach_reply_video_path text,
  add column if not exists coach_reply_video_uploaded_at timestamptz,
  add column if not exists coach_reply_video_annotations jsonb;

comment on column public.workout_feedback.coach_reply_video_path is
  'Chemin de la réponse vidéo du coach dans le bucket privé coach-reply-videos, sous la forme <student_id>/<uuid>.<mp4|mov|webm>. Le premier segment est l''élève DESTINATAIRE, pas l''auteur. NULL = aucune vidéo. Réservé au staff.';

comment on column public.workout_feedback.coach_reply_video_uploaded_at is
  'Instant du dépôt, DÉRIVÉ par enforce_workout_feedback_write() : jamais accepté du client, staff compris. Remis à NULL au retrait. Date de référence de la rétention de 3 jours.';

comment on column public.workout_feedback.coach_reply_video_annotations is
  'Calque d''annotations horodatées rejoué PAR-DESSUS la vidéo à la lecture (jamais gravé dedans) : flèche, cercle, trait, texte. Coordonnées normalisées 0..1. Structure validée par coach_reply_video_annotations_ok().';

-- La FORME du chemin, tenue par une contrainte de colonne — l'APPARTENANCE,
-- par le gardien. Séparer les deux permet de refuser un chemin difforme même
-- sur un chemin d'écriture qui contournerait le trigger.
alter table public.workout_feedback
  drop constraint if exists workout_feedback_coach_reply_video_path_shape;

alter table public.workout_feedback
  add constraint workout_feedback_coach_reply_video_path_shape
  check (
    coach_reply_video_path is null
    or coach_reply_video_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov|webm)$'
  );

alter table public.workout_feedback
  drop constraint if exists workout_feedback_coach_reply_video_uploaded_at_coherent;

-- Une date sans vidéo échapperait à toute logique ; une vidéo sans date
-- échapperait à la purge. Les deux vivent et meurent ensemble.
alter table public.workout_feedback
  add constraint workout_feedback_coach_reply_video_uploaded_at_coherent
  check ((coach_reply_video_path is null) = (coach_reply_video_uploaded_at is null));

alter table public.workout_feedback
  drop constraint if exists workout_feedback_coach_reply_video_annotations_shape;

alter table public.workout_feedback
  add constraint workout_feedback_coach_reply_video_annotations_shape
  check (public.coach_reply_video_annotations_ok(coach_reply_video_annotations));

alter table public.workout_feedback
  drop constraint if exists workout_feedback_coach_reply_video_annotations_sans_video;

-- Un calque sans vidéo ne se rejoue par-dessus rien.
alter table public.workout_feedback
  add constraint workout_feedback_coach_reply_video_annotations_sans_video
  check (coach_reply_video_annotations is null or coach_reply_video_path is not null);


-- ════════════════════════════════════════════════════════════════════════════
-- C. LE BUCKET — privé, plafonné, typé
-- ════════════════════════════════════════════════════════════════════════════
-- 200 Mo : la réponse du coach peut aller jusqu'à 120 s, six fois la vidéo
-- d'un élève. `on conflict do update` et non `do nothing` — un bucket créé à
-- la main au tableau de bord, sans plafond, doit être CORRIGÉ, pas ignoré.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('coach-reply-videos', 'coach-reply-videos', false, 209715200,
        array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ════════════════════════════════════════════════════════════════════════════
-- D. LES DEUX PRÉDICATS — parce que lire et écrire ne sont pas la même question
-- ════════════════════════════════════════════════════════════════════════════
-- F4 n'avait qu'un prédicat : celui qui pouvait lire pouvait écrire. Ici les
-- deux populations diffèrent — l'élève LIT sans jamais ÉCRIRE — et un
-- prédicat unique avec un drapeau booléen rendrait chaque policy muette sur
-- son intention. Deux fonctions nommées, donc, chacune lisible seule.
--
-- `security definer` pour la même raison qu'en F4 : la question « à quel
-- coach cet élève est-il rattaché ? » a UNE réponse, qui ne doit pas dépendre
-- de ce que la RLS de `students` laisse voir à l'appelant.

-- LECTURE : l'élève destinataire, son coach rattaché, l'admin.
create or replace function public.coach_reply_video_readable(p_name text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov|webm)$'
    and coalesce(array_length(storage.foldername(p_name), 1), 0) = 1
    and (
      -- L'élève à qui la réponse est destinée.
      (storage.foldername(p_name))[1] = public.current_student_id()::text
      or public.is_admin()
      -- Le coach RATTACHÉ à cet élève, et lui seul.
      or exists (
        select 1
          from public.students s
         where s.id::text = (storage.foldername(p_name))[1]
           and s.coach_id is not null
           and s.coach_id = public.current_coach_id()
      )
    )
$$;

-- ÉCRITURE : le coach rattaché, ou l'admin. JAMAIS l'élève — une réponse de
-- coach que l'élève pourrait déposer lui-même ne serait plus une réponse de
-- coach.
create or replace function public.coach_reply_video_writable(p_name text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov|webm)$'
    and coalesce(array_length(storage.foldername(p_name), 1), 0) = 1
    and (
      public.is_admin()
      or exists (
        select 1
          from public.students s
         where s.id::text = (storage.foldername(p_name))[1]
           and s.coach_id is not null
           and s.coach_id = public.current_coach_id()
      )
    )
$$;

comment on function public.coach_reply_video_readable(text) is
  'Qui peut LIRE une réponse vidéo de coach : l''élève destinataire, son coach rattaché, l''admin. Voir 20260827090000.';
comment on function public.coach_reply_video_writable(text) is
  'Qui peut ÉCRIRE une réponse vidéo de coach : le coach rattaché ou l''admin. Jamais l''élève. Voir 20260827090000.';

-- Les DEFAULT PRIVILEGES de Supabase accordent EXECUTE à `anon`,
-- `authenticated` et `service_role` sur toute fonction nouvelle de `public` —
-- des grants NOMINATIFS que le revoke sur `public` ne touche pas. On ne garde
-- que `authenticated`, le rôle sous lequel les policies sont évaluées :
-- `anon` n'a rien à faire ici, et `service_role` porte BYPASSRLS, donc les
-- policies ne sont jamais évaluées pour lui.
revoke all on function public.coach_reply_video_readable(text) from public;
revoke all on function public.coach_reply_video_readable(text) from anon;
revoke all on function public.coach_reply_video_readable(text) from service_role;
grant execute on function public.coach_reply_video_readable(text) to authenticated;

revoke all on function public.coach_reply_video_writable(text) from public;
revoke all on function public.coach_reply_video_writable(text) from anon;
revoke all on function public.coach_reply_video_writable(text) from service_role;
grant execute on function public.coach_reply_video_writable(text) to authenticated;

-- Le validateur de calque, lui, est appelé par une CONTRAINTE : il doit
-- rester exécutable par qui écrit la table.
revoke all on function public.coach_reply_video_annotations_ok(jsonb) from public;
revoke all on function public.coach_reply_video_annotations_ok(jsonb) from anon;
grant execute on function public.coach_reply_video_annotations_ok(jsonb) to authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- E. LES QUATRE POLICIES — asymétriques, à dessein
-- ════════════════════════════════════════════════════════════════════════════
-- SELECT est LARGE (l'élève doit voir la réponse qui lui est destinée) ;
-- INSERT, UPDATE et DELETE sont ÉTROITS (seul le coach rattaché dépose).
-- C'est exactement l'inverse de `feedback-videos`, et c'est pour cela que les
-- deux buckets ne peuvent pas être le même.
drop policy if exists "coach_reply_videos_select_student_or_staff" on storage.objects;
create policy "coach_reply_videos_select_student_or_staff" on storage.objects
  for select to authenticated
  using (bucket_id = 'coach-reply-videos' and public.coach_reply_video_readable(name));

drop policy if exists "coach_reply_videos_insert_coach" on storage.objects;
create policy "coach_reply_videos_insert_coach" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'coach-reply-videos' and public.coach_reply_video_writable(name));

-- UPDATE porte `using` ET `with check` : sans le second, on pourrait lire un
-- objet qu'on a le droit de voir et le DÉPLACER vers un chemin qu'on n'a pas
-- le droit d'écrire.
drop policy if exists "coach_reply_videos_update_coach" on storage.objects;
create policy "coach_reply_videos_update_coach" on storage.objects
  for update to authenticated
  using (bucket_id = 'coach-reply-videos' and public.coach_reply_video_writable(name))
  with check (bucket_id = 'coach-reply-videos' and public.coach_reply_video_writable(name));

drop policy if exists "coach_reply_videos_delete_coach" on storage.objects;
create policy "coach_reply_videos_delete_coach" on storage.objects
  for delete to authenticated
  using (bucket_id = 'coach-reply-videos' and public.coach_reply_video_writable(name));


-- ════════════════════════════════════════════════════════════════════════════
-- F. LE GARDIEN — `create or replace` de enforce_workout_feedback_write()
-- ════════════════════════════════════════════════════════════════════════════
-- Reprise INTÉGRALE de la version en Production (20260821090000 puis
-- 20260822090000), à laquelle s'ajoute UNIQUEMENT le traitement des trois
-- nouvelles colonnes. On ne réécrit pas une migration appliquée : on la
-- corrige par celle-ci.
create or replace function public.enforce_workout_feedback_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff boolean;
  v_systeme boolean;
begin
  -- Contexte non-utilisateur (webhook, tâche service) : aucun claim JWT.
  v_systeme := auth.uid() is null or coalesce(auth.role(), '') = 'service_role';
  v_staff := (not v_systeme) and public.is_coach_or_admin();

  -- ── D. Colonnes figées après création ────────────────────────────────────
  -- `session_id` et `program_id` portent un `on delete set null` : supprimer
  -- une séance ou un programme déclenche un UPDATE de cette ligne vers NULL.
  -- Les figer aveuglément ferait échouer la suppression sur une violation de
  -- clé étrangère — le coach ne pourrait plus supprimer une séance. La règle
  -- exacte est donc : ces colonnes ne peuvent que DISPARAÎTRE, jamais être
  -- repointées ailleurs.
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.student_id := old.student_id;
    new.session_key := old.session_key;
    new.created_at := old.created_at;
    -- Le libellé de la séance est une photographie, au même titre que
    -- `exercise_name` : renommer la séance ne réécrit pas l'histoire.
    new.session_ref_label := old.session_ref_label;
    if new.session_id is distinct from old.session_id and new.session_id is not null then
      new.session_id := old.session_id;
    end if;
    if new.program_id is distinct from old.program_id and new.program_id is not null then
      new.program_id := old.program_id;
    end if;
  end if;

  -- ── La séance visée doit RÉELLEMENT être celle de cet élève ──────────────
  -- Sans ce contrôle, un élève pouvait créer un retour pointant la séance
  -- d'un autre — et se voir construire le snapshot d'une prescription qui
  -- n'est pas la sienne. Le staff n'est pas dispensé : un retour rattaché à
  -- une séance étrangère n'a de sens pour personne.
  if tg_op = 'INSERT' and new.session_id is not null then
    if not public.student_owns_workout_session(new.student_id, new.session_id) then
      raise exception 'Retour refusé : cette séance n''appartient pas à cet élève (séance %)', new.session_id
        using errcode = 'insufficient_privilege';
    end if;

    -- ── C. Les métadonnées de la séance sont DÉRIVÉES, pas déclarées ───────
    -- Voir l'audit en tête de fichier. Ce que l'appelant a envoyé dans ces
    -- trois colonnes n'est pas comparé : il est REMPLACÉ. Aucun écart entre
    -- `session_id` et le reste n'est donc représentable en base.
    select s.program_id, s.name
      into new.program_id, new.session_ref_label
      from public.workout_sessions s
     where s.id = new.session_id;
    new.session_key := new.session_id::text;
  end if;

  -- ── C. Le snapshot est RECALCULÉ, jamais reçu ────────────────────────────
  -- La valeur envoyée par l'appelant n'est même pas lue. Universel : ni un
  -- élève, ni un coach, ni le service ne peuvent en fabriquer un. Une
  -- intervention volontaire passe par la désactivation explicite du trigger.
  if tg_op = 'INSERT' then
    new.prescribed_snapshot := case
      when new.completed and new.session_id is not null
        then public.build_prescribed_snapshot(new.session_id)
      else null
    end;
  else
    new.prescribed_snapshot := case
      -- Immuable dès qu'elle est posée (le trigger
      -- workout_feedback_snapshot_immutable reste le second verrou).
      when old.prescribed_snapshot is not null then old.prescribed_snapshot
      when new.completed and new.session_id is not null
        then public.build_prescribed_snapshot(new.session_id)
      else null
    end;
  end if;

  -- ── C. Horodatages ───────────────────────────────────────────────────────
  -- Une resoumission d'ÉLÈVE réactualise la date d'envoi. Une action de coach
  -- (marquer traité, répondre) ou une cascade technique (suppression d'une
  -- séance) ne doit pas faire remonter le retour en tête de file.
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.submitted_at := now();
  elsif v_systeme or v_staff then
    new.submitted_at := old.submitted_at;
  else
    new.submitted_at := now();
  end if;

  -- ── F5. La réponse vidéo doit être destinée à L'ÉLÈVE DE CE RETOUR ───────
  -- La RLS du bucket dit déjà à quel dossier un coach a le droit d'écrire.
  -- Ici on dit autre chose : que le chemin RATTACHÉ À CETTE LIGNE désigne
  -- bien son élève. Sans ce contrôle, un coach qui suit deux élèves pourrait
  -- coller sur le retour de l'un la réponse destinée à l'autre — les deux
  -- chemins lui étant légitimement ouverts côté Storage.
  if new.coach_reply_video_path is not null
     and split_part(new.coach_reply_video_path, '/', 1) is distinct from new.student_id::text then
    raise exception 'Réponse vidéo refusée : le chemin % ne désigne pas l''élève de ce retour', new.coach_reply_video_path
      using errcode = 'insufficient_privilege';
  end if;

  -- ── F5. RETIRER LA VIDÉO EMPORTE SON CALQUE ──────────────────────────────
  -- La contrainte `..._annotations_sans_video` interdit déjà un calque
  -- orphelin, mais elle le REFUSE : un appelant qui remet le chemin à NULL
  -- sans penser aux annotations verrait sa requête échouer. Or il y en aura —
  -- le balayeur de rétention en est un.
  --
  -- LA CONDITION EST ÉTROITE À DESSEIN : uniquement la TRANSITION d'un chemin
  -- vers NULL. Nettoyer dès que le chemin « se trouve être » NULL avalerait
  -- en silence un calque posé sur un retour qui n'a pas de vidéo — le coach
  -- verrait sa requête réussir et son travail disparaître. Là, la contrainte
  -- doit parler, et fort.
  if tg_op = 'UPDATE'
     and new.coach_reply_video_path is null
     and old.coach_reply_video_path is not null then
    new.coach_reply_video_annotations := null;
  end if;

  -- ── F5/B. `coach_reply_video_uploaded_at` est DÉRIVÉ, pour TOUT LE MONDE ──
  -- Y compris le staff : c'est cette date qui déclenche la purge à 3 jours.
  -- Qui pourrait l'écrire pourrait garder sa vidéo indéfiniment.
  --
  -- `clock_timestamp()` et non `now()`, pour la même raison qu'en F4 : `now()`
  -- rend l'heure de DÉBUT DE TRANSACTION, ce qui rend « la date a-t-elle été
  -- repoussée ? » invérifiable — un test passerait aussi bien si la règle
  -- était fausse.
  if tg_op = 'INSERT' then
    new.coach_reply_video_uploaded_at :=
      case when new.coach_reply_video_path is null then null else clock_timestamp() end;
  else
    new.coach_reply_video_uploaded_at := case
      when new.coach_reply_video_path is null then null
      when new.coach_reply_video_path is distinct from old.coach_reply_video_path then clock_timestamp()
      else old.coach_reply_video_uploaded_at
    end;
  end if;

  -- ── B. Colonnes du coach ─────────────────────────────────────────────────
  if v_systeme or v_staff then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'a-traiter';
    new.coach_reply := '';
    new.session_status := case when new.completed then 'done' else null end;
    -- F5 : un élève ne se répond pas à lui-même, en vidéo pas plus qu'en texte.
    new.coach_reply_video_path := null;
    new.coach_reply_video_annotations := null;
    new.coach_reply_video_uploaded_at := null;
  else
    new.status := old.status;
    new.coach_reply := old.coach_reply;
    new.session_status := case when new.completed then 'done' else null end;
    -- F5 : restauré, jamais refusé — comme les autres colonnes de staff.
    -- L'UPDATE rapporte « 1 ligne » sans avoir rien changé : les tests
    -- mesurent donc la VALEUR, jamais le nombre de lignes.
    new.coach_reply_video_path := old.coach_reply_video_path;
    new.coach_reply_video_annotations := old.coach_reply_video_annotations;
    new.coach_reply_video_uploaded_at := old.coach_reply_video_uploaded_at;
  end if;

  return new;
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- G. CONTRÔLE FINAL — la migration échoue si elle est incomplète
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_manque text := '';
  v_def    text;
  v_bucket record;
  v_n      int;
begin
  for v_def in select unnest(array['coach_reply_video_path',
                                   'coach_reply_video_uploaded_at',
                                   'coach_reply_video_annotations']) loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'workout_feedback'
                      and column_name = v_def) then
      v_manque := v_manque || format(' colonne %s absente ;', v_def);
    end if;
  end loop;

  for v_def in select unnest(array['workout_feedback_coach_reply_video_path_shape',
                                   'workout_feedback_coach_reply_video_uploaded_at_coherent',
                                   'workout_feedback_coach_reply_video_annotations_shape',
                                   'workout_feedback_coach_reply_video_annotations_sans_video']) loop
    if not exists (select 1 from pg_constraint where conname = v_def) then
      v_manque := v_manque || format(' contrainte %s absente ;', v_def);
    end if;
  end loop;

  select * into v_bucket from storage.buckets where id = 'coach-reply-videos';
  if not found then
    v_manque := v_manque || ' bucket coach-reply-videos absent ;';
  else
    if v_bucket.public then
      v_manque := v_manque || ' le bucket est PUBLIC — inacceptable pour une réponse nominative ;';
    end if;
    if coalesce(v_bucket.file_size_limit, 0) <> 209715200 then
      v_manque := v_manque || ' plafond de taille absent ou différent ;';
    end if;
    if v_bucket.allowed_mime_types is null
       or exists (select 1 from unnest(v_bucket.allowed_mime_types) as t where t not like 'video/%') then
      v_manque := v_manque || ' liste blanche absente ou non exclusivement vidéo ;';
    end if;
  end if;

  -- Les deux prédicats, et surtout ce qu'ils N'AUTORISENT PAS.
  for v_def in select unnest(array['coach_reply_video_readable', 'coach_reply_video_writable']) loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_def) then
      v_manque := v_manque || format(' prédicat %s absent ;', v_def);
    end if;
  end loop;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'coach_reply_video_writable';
  if v_def is null or position('current_student_id' in v_def) > 0 then
    v_manque := v_manque || ' l''élève peut ÉCRIRE sa propre réponse de coach ;';
  end if;
  if v_def is null or position('coach_id = public.current_coach_id()' in v_def) = 0 then
    v_manque := v_manque || ' l''écriture n''est pas restreinte au coach rattaché ;';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'coach_reply_video_readable';
  if v_def is null or position('current_student_id' in v_def) = 0 then
    v_manque := v_manque || ' l''élève ne peut pas LIRE la réponse qui lui est destinée ;';
  end if;
  if v_def is null or position('is_coach_or_admin' in v_def) > 0 then
    v_manque := v_manque || ' la lecture autorise TOUT coach (is_coach_or_admin) ;';
  end if;

  select count(distinct cmd) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'coach_reply_videos_%';
  if v_n <> 4 then
    v_manque := v_manque || ' les quatre policies du bucket ne sont pas toutes posées ;';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'coach_reply_videos_update_coach'
                    and with_check is not null) then
    v_manque := v_manque || ' la policy UPDATE n''a pas de WITH CHECK ;';
  end if;

  -- Le gardien connaît les trois colonnes.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write';
  if v_def is null
     or position('coach_reply_video_path' in v_def) = 0
     or position('coach_reply_video_uploaded_at' in v_def) = 0
     or position('coach_reply_video_annotations' in v_def) = 0 then
    v_manque := v_manque || ' enforce_workout_feedback_write() ne traite pas les colonnes de réponse vidéo ;';
  end if;

  -- Retirer la vidéo doit EMPORTER le calque, sans quoi la contrainte
  -- refuserait la requête du balayeur de rétention.
  select count(*) into v_n
    from public.workout_feedback
   where coach_reply_video_annotations is not null
     and coach_reply_video_path is null;
  if v_n > 0 then
    v_manque := v_manque || format(' %s calque(s) sans vidéo en base ;', v_n);
  end if;

  if v_manque <> '' then
    raise exception 'MIGRATION INCOMPLÈTE —%', v_manque;
  end if;

  raise notice 'F5 socle posé : bucket coach-reply-videos privé (200 Mo), 4 policies asymétriques, 3 colonnes sous gardien, calque validé en base.';
end $$;
