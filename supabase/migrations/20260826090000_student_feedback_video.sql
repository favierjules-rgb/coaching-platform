-- ────────────────────────────────────────────────────────────────────────────
-- F4 — VIDÉO DE TECHNIQUE DE L'ÉLÈVE (socle : base, stockage, autorité)
--      chantier feat/student-feedback-video
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION APPORTE
-- ────────────────────────────────────────────────────────────────────────────
-- L'élève peut joindre UNE vidéo courte à UNE ligne d'exercice de son retour
-- de séance, pour que le coach voie le mouvement au lieu de le deviner. Une
-- seule vidéo par ligne, remplaçable : redéposer écrase le choix précédent.
--
--   • `exercise_feedback.video_path`        — chemin dans le bucket dédié
--   • `exercise_feedback.video_uploaded_at` — DÉRIVÉ, jamais reçu du client
--   • bucket privé `feedback-videos`, cloisonné par élève
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI UN BUCKET DÉDIÉ, ET PAS `videos`
-- ────────────────────────────────────────────────────────────────────────────
-- Le bucket `videos` existe déjà et il est privé — mais sa policy de lecture
-- est `bucket_id = 'videos' and auth.role() = 'authenticated'` : N'IMPORTE
-- QUEL compte connecté y lit n'importe quel objet. C'est acceptable pour des
-- démonstrations de catalogue ; c'est inacceptable pour la vidéo d'un élève
-- en train de s'entraîner. Le même raisonnement vaut pour `documents`, dont
-- la lecture est ouverte par assignation de document.
--
-- On reprend donc le modèle éprouvé du dépôt :
--   • le CLOISONNEMENT de `progress-photos` — premier segment du chemin =
--     identifiant de l'élève, lu par la RLS via storage.foldername() ;
--   • la RIGUEUR de `recipe-images` — plafond de taille et liste blanche de
--     types POSÉS EN BASE, prédicat d'appartenance écrit une fois et utilisé
--     par les quatre policies, contrainte de forme sur la colonne.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LA FORME DU CHEMIN : `<student_id>/<uuid>.<mp4|mov|webm>`
-- ────────────────────────────────────────────────────────────────────────────
-- Deux segments, pas trois. On aurait pu nommer la ligne d'exercice dans le
-- chemin — c'est ce que fait `recipe-images` avec la recette — mais une
-- RESOUMISSION de retour SUPPRIME puis RECRÉE les lignes `exercise_feedback`
-- (le retour est réécrit en entier). L'identifiant de ligne change donc à
-- chaque envoi : un chemin qui le contiendrait rendrait la vidéo orpheline
-- dès la première correction. Le lien ligne → fichier est porté par la
-- COLONNE, qui survit à la réécriture parce que l'écran la renvoie ; le
-- chemin, lui, ne porte que ce qui ne bouge jamais : à qui appartient ce
-- fichier.
--
-- Le nom de fichier est un uuid neuf à chaque dépôt : jamais d'écrasement en
-- place, donc jamais de vidéo servie depuis un cache alors qu'elle a changé.
--
-- ────────────────────────────────────────────────────────────────────────────
-- MATRICE DE PROPRIÉTÉ — SUITE DE CELLE DE 20260821090000
-- ────────────────────────────────────────────────────────────────────────────
-- Le classement A/B/C/D des trois tables de retour vit en tête de
-- `20260821090000` et `20260822090000`. Ces deux migrations sont appliquées,
-- donc immuables : les deux colonnes ajoutées ici se classent ICI, et
-- `scripts/tests/training-movement-patterns.mts` (contrôle BB1) lit
-- désormais les trois en-têtes. Une colonne ajoutée demain sans être classée
-- fera toujours échouer la suite.
--
-- A = écrit par l'élève · B = dérivé par la base · C = réservé au staff
-- D = figé après création
--
-- exercise_feedback (suite)
--   video_path                      A     + SEULEMENT vers son propre dossier :
--                                         le trigger refuse un chemin dont le
--                                         premier segment n'est pas l'identifiant
--                                         de l'élève. Le staff peut le vider
--                                         (modération) mais jamais le poser.
--   video_uploaded_at               B     posé quand un chemin apparaît ou
--                                         change, remis à NULL au retrait.
--                                         Jamais accepté du client : c'est LUI
--                                         qui datera la purge des 30 jours, et
--                                         qui pourrait l'écrire garderait sa
--                                         vidéo indéfiniment.
--
-- Le staff (coach, admin) peut RETIRER une vidéo — modération d'un contenu
-- déplacé — mais ne peut pas en POSER une : une vidéo attribuée à un élève
-- doit avoir été déposée par cet élève. Le trigger restaure silencieusement
-- l'ancienne valeur plutôt que de refuser, comme les autres gardiens du
-- chantier : les tests mesurent donc la VALEUR, jamais le nombre de lignes.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
-- • Aucune purge. La rétention de 30 jours est une décision produit prise et
--   inscrite ici (`video_uploaded_at` en est le seul point d'appui fiable),
--   mais le mécanisme qui efface — route planifiée et balayage des objets
--   orphelins — arrive dans un chantier séparé. Une colonne posée sans purge
--   est réparable ; une purge posée sans colonne fiable ne l'est pas.
-- • Aucune borne de DURÉE en base. PostgreSQL ne sait pas combien de temps
--   dure un fichier. Les 20 secondes sont tenues par le navigateur, à la
--   capture comme à l'import ; la base tient ce qu'elle sait tenir : la
--   taille, le type, le propriétaire.
-- • Aucun backfill : tout l'historique reste à NULL.
--
-- Idempotente : rejouable sans effet.
-- ────────────────────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════════════
-- A. LES COLONNES
-- ════════════════════════════════════════════════════════════════════════════
alter table public.exercise_feedback
  add column if not exists video_path text,
  add column if not exists video_uploaded_at timestamptz;

comment on column public.exercise_feedback.video_path is
  'Chemin de la vidéo de technique dans le bucket privé feedback-videos, sous la forme <student_id>/<uuid>.<mp4|mov|webm>. NULL = aucune vidéo. Une seule par ligne : redéposer remplace. Miroir applicatif : lib/feedback-video.ts.';

comment on column public.exercise_feedback.video_uploaded_at is
  'Instant du dépôt de la vidéo, DÉRIVÉ par enforce_exercise_feedback_write() : jamais accepté du client. Remis à NULL quand la vidéo est retirée. C''est la date de référence de la rétention de 30 jours.';

-- La FORME est tenue par une contrainte de colonne ; l'APPARTENANCE, par le
-- trigger. Séparer les deux permet de refuser un chemin difforme même sur un
-- chemin d'écriture qui contournerait le trigger.
alter table public.exercise_feedback
  drop constraint if exists exercise_feedback_video_path_shape;

alter table public.exercise_feedback
  add constraint exercise_feedback_video_path_shape
  check (
    video_path is null
    or video_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov|webm)$'
  );

-- Une date de dépôt sans vidéo n'a aucun sens, et une vidéo sans date de
-- dépôt échapperait à la purge : les deux colonnes vivent et meurent ensemble.
alter table public.exercise_feedback
  drop constraint if exists exercise_feedback_video_uploaded_at_coherent;

alter table public.exercise_feedback
  add constraint exercise_feedback_video_uploaded_at_coherent
  check ((video_path is null) = (video_uploaded_at is null));


-- ════════════════════════════════════════════════════════════════════════════
-- B. LE BUCKET — privé, plafonné, typé, EN BASE
-- ════════════════════════════════════════════════════════════════════════════
-- `on conflict do update` et non `do nothing` : si le bucket a été créé à la
-- main au tableau de bord, sans plafond, cette migration les POSE. Une
-- migration qui se tairait devant un bucket préexistant laisserait la
-- protection au hasard de l'historique (leçon de 20260819090000).
--
-- 50 Mo : une capture de 20 s en 720p pèse quelques mégaoctets ; un import
-- de 20 s filmé en 1080p par un téléphone récent tourne autour de 25 Mo. Le
-- plafond laisse passer le cas réel et arrête le fichier de 3 minutes qu'on
-- aurait renommé pour tenter sa chance.
--
-- `video/quicktime` est là parce que c'est ce que produit un iPhone (.mov).
-- L'absence de `video/x-matroska`, `image/*` et de tout le reste est
-- délibérée : ce bucket ne reçoit que des vidéos, dans trois conteneurs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-videos', 'feedback-videos', false, 52428800,
        array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ════════════════════════════════════════════════════════════════════════════
-- C. LE PRÉDICAT D'APPARTENANCE — ÉCRIT UNE FOIS, UTILISÉ QUATRE FOIS
-- ════════════════════════════════════════════════════════════════════════════
-- Les quatre policies posent exactement la même question : « ce chemin
-- désigne-t-il une vidéo que l'appelant a le droit de manipuler ? » L'écrire
-- quatre fois garantirait qu'un jour trois versions coexistent.
--
-- CE QUE LA FONCTION VÉRIFIE, DANS L'ORDRE
--   1. la FORME : exactement un dossier, et le chemin complet conforme au
--      gabarit `<uuid>/<uuid>.<extension>`. Un chemin plus profond est
--      refusé AVANT toute lecture — sans quoi `<élève A>/../<élève B>/x.mp4`
--      ou un dossier surnuméraire deviendraient des angles d'attaque ;
--   2. l'APPELANT, dans cet ordre :
--      • l'ÉLÈVE nommé au premier segment — ses propres vidéos ;
--      • l'ADMIN — convention déjà en vigueur sur toute la plateforme
--        (`is_admin()` est distinct de `is_coach_or_admin()`) ;
--      • le COACH RÉELLEMENT RATTACHÉ à cet élève, et lui seul.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI PAS `is_coach_or_admin()`
-- ────────────────────────────────────────────────────────────────────────────
-- Parce que ce prédicat-là répond « oui » à N'IMPORTE QUEL compte de rôle
-- coach, pour n'importe quel élève. C'est la convention du reste du dépôt —
-- assumée tant qu'il n'y a qu'un coach — mais elle ne peut pas s'appliquer
-- ici : une vidéo d'entraînement filmée chez soi n'est pas une fiche
-- d'exercice. L'appartenance est donc PROUVÉE par une jointure sur
-- `public.students.coach_id`, la relation que le schéma fournit déjà
-- (`students.coach_id uuid references coaches(id) on delete set null`) — on
-- n'invente aucun nouvel identifiant de coach, et `current_coach_id()`
-- existe depuis longtemps.
--
-- UN ÉLÈVE SANS `coach_id` RESTE VISIBLE DE LUI-MÊME ET DE L'ADMIN, ET DE
-- PERSONNE D'AUTRE. La Production porte aujourd'hui des rattachements
-- incomplets : la migration ne les invente pas. Un coach qui ne voit pas la
-- vidéo d'un élève doit d'abord se voir attribuer cet élève — c'est une
-- décision humaine, pas un effet de bord de migration.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI `security definer` ICI, ALORS QUE `recipe-images` EST `invoker`
-- ────────────────────────------------------------------------------------
-- Parce que la réponse ne doit PAS dépendre de ce que la RLS laisse voir à
-- l'appelant. En `invoker`, la jointure sur `public.students` serait filtrée
-- par les policies de cette table : le jour où elles se resserrent, l'accès
-- aux vidéos changerait sans que personne n'ait touché à ce fichier — dans
-- un sens comme dans l'autre. La question « à quel coach cet élève est-il
-- rattaché ? » a UNE réponse, la même pour tout le monde ; on la pose donc
-- sur la donnée réelle. `auth.uid()` reste celui de l'appelant, un
-- `security definer` ne change pas le porteur du jeton.
create or replace function public.feedback_video_path_owner_ok(p_name text)
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
      -- l'élève, ses propres vidéos
      (storage.foldername(p_name))[1] = public.current_student_id()::text
      -- l'administrateur, convention de la plateforme
      or public.is_admin()
      -- le coach RATTACHÉ à cet élève. `s.coach_id is not null` est explicite
      -- plutôt qu'implicite : sans lui, un appelant sans coach
      -- (current_coach_id() = NULL) comparerait NULL à NULL — ce qui rend
      -- NULL, donc faux, mais par accident et non par intention.
      or exists (
        select 1
          from public.students s
         where s.id::text = (storage.foldername(p_name))[1]
           and s.coach_id is not null
           and s.coach_id = public.current_coach_id()
      )
    )
$$;

comment on function public.feedback_video_path_owner_ok(text) is
  'Prédicat unique des quatre policies du bucket feedback-videos : forme du chemin, puis appartenance — l''élève lui-même, l''admin, ou le coach RÉELLEMENT rattaché via students.coach_id. Jamais is_coach_or_admin(). Voir 20260826090000.';

-- ────────────────────────────────────────────────────────────────────────────
-- LES DROITS D'EXÉCUTION — le strict nécessaire, nommément
-- ────────────────────────────────────────────────────────────────────────────
-- `revoke ... from public` NE SUFFIT PAS : Supabase pose des DEFAULT
-- PRIVILEGES qui accordent EXECUTE à `anon`, `authenticated` ET
-- `service_role` sur toute nouvelle fonction de `public`. Ce sont des grants
-- NOMINATIFS ; un revoke sur `public` ne les touche pas.
--
-- On repart donc de zéro, et on ne rend QUE ce qui sert :
--   • `authenticated`  → OUI. C'est le rôle sous lequel PostgreSQL évalue
--     les quatre policies du bucket. Sans ce droit, plus personne ne lit ni
--     n'écrit une vidéo.
--   • `anon`           → NON. Il n'approche pas les vidéos d'élèves. Et la
--     fonction étant SECURITY DEFINER, la lui laisser reviendrait à offrir
--     un oracle : « ce chemin appartient-il à quelqu'un ? », interrogeable
--     sans compte.
--   • `service_role`   → NON. Il porte BYPASSRLS : les policies ne sont
--     JAMAIS évaluées pour lui, donc ce droit ne lui sert à rien. Un
--     privilège inutile sur une fonction SECURITY DEFINER est un privilège
--     de trop.
--   • `postgres`       → propriétaire, conservé de fait.
revoke all on function public.feedback_video_path_owner_ok(text) from public;
revoke all on function public.feedback_video_path_owner_ok(text) from anon;
revoke all on function public.feedback_video_path_owner_ok(text) from service_role;
grant execute on function public.feedback_video_path_owner_ok(text) to authenticated;

-- `enforce_exercise_feedback_write()` n'est pas re-privilégiée ici : elle
-- EXISTAIT déjà (20260821090000), et `create or replace` conserve l'ACL
-- d'origine — les DEFAULT PRIVILEGES ne s'appliquent qu'à une fonction
-- NOUVELLE. Elle reste donc, comme avant, hors de portée d'`anon` et
-- d'`authenticated` : une fonction de trigger n'a pas besoin d'être
-- exécutable par l'appelant, c'est le trigger qui l'invoque.


-- ════════════════════════════════════════════════════════════════════════════
-- D. LES QUATRE POLICIES DU BUCKET
-- ════════════════════════════════════════════════════════════════════════════
-- La policy SELECT n'est pas décorative sur un bucket privé : sans elle,
-- `.remove()` renvoie `error: null` sans rien supprimer, et `createSignedUrl`
-- rend null. Le dépôt s'est déjà fait piéger deux fois (banners,
-- program-covers) — on ne se laisse pas piéger une troisième.
--
-- `to authenticated` partout : `anon` n'a aucune raison d'approcher.
drop policy if exists "feedback_videos_select_owner_or_staff" on storage.objects;
create policy "feedback_videos_select_owner_or_staff" on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback-videos' and public.feedback_video_path_owner_ok(name));

drop policy if exists "feedback_videos_insert_owner_or_staff" on storage.objects;
create policy "feedback_videos_insert_owner_or_staff" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feedback-videos' and public.feedback_video_path_owner_ok(name));

-- UPDATE porte `using` ET `with check` : sans le second, on pourrait lire un
-- objet qu'on a le droit de voir et le DÉPLACER vers un chemin qu'on n'a pas
-- le droit d'écrire.
drop policy if exists "feedback_videos_update_owner_or_staff" on storage.objects;
create policy "feedback_videos_update_owner_or_staff" on storage.objects
  for update to authenticated
  using (bucket_id = 'feedback-videos' and public.feedback_video_path_owner_ok(name))
  with check (bucket_id = 'feedback-videos' and public.feedback_video_path_owner_ok(name));

drop policy if exists "feedback_videos_delete_owner_or_staff" on storage.objects;
create policy "feedback_videos_delete_owner_or_staff" on storage.objects
  for delete to authenticated
  using (bucket_id = 'feedback-videos' and public.feedback_video_path_owner_ok(name));


-- ════════════════════════════════════════════════════════════════════════════
-- E. LE GARDIEN — `create or replace` de enforce_exercise_feedback_write()
-- ════════════════════════════════════════════════════════════════════════════
-- Reprise INTÉGRALE de la version de 20260821090000 (elle-même déjà en
-- Production), à laquelle s'ajoute UNIQUEMENT le traitement des deux
-- nouvelles colonnes. On ne réécrit pas 20260821 : elle a été appliquée,
-- elle est immuable — on la corrige par celle-ci.
create or replace function public.enforce_exercise_feedback_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_student_id uuid;
  v_parent_session_id uuid;
  v_src_name text;
  v_sub_name text;
  v_sub_pattern text;
  v_sub_status text;
  v_src_library_id uuid;
  v_src_session_id uuid;
  v_src_pattern text;
  v_systeme boolean;
  v_staff boolean;
begin
  v_systeme := auth.uid() is null or coalesce(auth.role(), '') = 'service_role';
  v_staff := (not v_systeme) and public.is_coach_or_admin();

  -- ── D. Rattachement figé après création ──────────────────────────────────
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.workout_feedback_id := old.workout_feedback_id;
    new.student_id := old.student_id;
    new.created_at := old.created_at;
    -- Le nom PRESCRIT est une photographie : il ne se retouche pas.
    new.exercise_name := old.exercise_name;

    -- ── F4. Le staff RETIRE, il ne DÉPOSE pas ──────────────────────────────
    -- Modération d'une vidéo déplacée : oui. Attribuer à un élève une vidéo
    -- qu'il n'a pas déposée : non. On restaure au lieu de refuser, comme les
    -- autres gardiens — l'ordre passe, la valeur ne bouge pas.
    if v_staff and new.video_path is distinct from old.video_path
       and new.video_path is not null then
      new.video_path := old.video_path;
    end if;
  end if;
  new.updated_at := now();

  -- ── F4. Une vidéo ne peut désigner QUE le dossier de son propre élève ────
  -- La RLS du bucket dit déjà cela du FICHIER. Ici on le dit de la COLONNE :
  -- écrire un chemin n'exige aucun dépôt, donc rien ne garantit que la RLS
  -- du stockage ait été consultée. Sans ce contrôle, l'élève A pourrait
  -- pointer la vidéo de l'élève B et la faire afficher au coach sous son
  -- propre nom — la RLS de lecture, elle, laisserait passer le coach.
  if new.video_path is not null
     and split_part(new.video_path, '/', 1) is distinct from new.student_id::text then
    raise exception 'Vidéo refusée : le chemin % ne désigne pas le dossier de cet élève', new.video_path
      using errcode = 'insufficient_privilege';
  end if;

  -- ── F4. `video_uploaded_at` est DÉRIVÉ, toujours ────────────────────────
  -- Il date la rétention : un client qui pourrait l'écrire pourrait garder
  -- sa vidéo indéfiniment. On ne le lit donc jamais depuis `new`.
  --
  -- `clock_timestamp()` et non `now()`, à dessein. `now()` rend l'heure de
  -- DÉBUT DE TRANSACTION : deux écritures d'une même transaction portent
  -- alors la même date à la microseconde près, et « la date a-t-elle été
  -- repoussée quand la vidéo a changé ? » devient INVÉRIFIABLE — le test
  -- passerait aussi bien si la règle était fausse. Une garantie qu'on ne
  -- peut pas mesurer n'est pas une garantie. `updated_at` garde `now()` :
  -- lui n'a rien à prouver.
  if tg_op = 'INSERT' then
    new.video_uploaded_at := case when new.video_path is null then null else clock_timestamp() end;
  else
    new.video_uploaded_at := case
      when new.video_path is null then null
      when new.video_path is distinct from old.video_path then clock_timestamp()
      else old.video_uploaded_at
    end;
  end if;

  -- ── Le parent existe et appartient au MÊME élève ─────────────────────────
  select wf.student_id, wf.session_id
    into v_parent_student_id, v_parent_session_id
    from public.workout_feedback wf
   where wf.id = new.workout_feedback_id;
  if not found then
    raise exception 'Ligne d''exercice refusée : retour parent introuvable (%)', new.workout_feedback_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_parent_student_id <> new.student_id then
    raise exception 'Ligne d''exercice refusée : le retour parent appartient à un autre élève'
      using errcode = 'insufficient_privilege';
  end if;

  -- ── L'exercice prescrit désigné appartient bien à la séance du retour ────
  -- …et c'est LUI qui donne le nom prescrit. `exercise_name` est ce que le
  -- coach lit sous l'étiquette « PRESCRIT » : le laisser au client, c'était
  -- laisser réécrire la prescription ligne par ligne. Il est donc DÉRIVÉ dès
  -- que l'exercice prescrit est identifié. Il reste libre quand il ne l'est
  -- pas — bloc cardio (`Cardio · Résultats`) ou séance hors Supabase — car
  -- il n'y a alors aucune ligne de prescription d'où le tirer.
  if new.exercise_id is not null then
    select we.exercise_library_id, we.session_id, we.name
      into v_src_library_id, v_src_session_id, v_src_name
      from public.workout_exercises we
     where we.id = new.exercise_id;
    if not found then
      raise exception 'Ligne d''exercice refusée : exercice prescrit introuvable (%)', new.exercise_id
        using errcode = 'foreign_key_violation';
    end if;
    if v_parent_session_id is not null and v_src_session_id is distinct from v_parent_session_id then
      raise exception 'Ligne d''exercice refusée : l''exercice prescrit n''appartient pas à la séance du retour'
        using errcode = 'check_violation';
    end if;
    if tg_op = 'INSERT' then
      new.exercise_name := v_src_name;
    end if;
  end if;

  -- ── UPDATE : la trace d'un remplacement est un fait, elle ne se réécrit pas
  if tg_op = 'UPDATE' then
    new.substitute_exercise_name := old.substitute_exercise_name;
    if new.substitute_exercise_library_id is distinct from old.substitute_exercise_library_id
       and new.substitute_exercise_library_id is not null then
      raise exception 'Le remplacement d''un retour enregistré ne peut pas être modifié par UPDATE (exercise_feedback %)', old.id
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- ── INSERT sans remplacement : chemin ultra-majoritaire, zéro requête ────
  if new.substitute_exercise_library_id is null then
    new.substitute_exercise_name := null;
    return new;
  end if;

  -- ── INSERT avec remplacement : la banque a le dernier mot ────────────────
  select el.name, el.movement_pattern, el.status
    into v_sub_name, v_sub_pattern, v_sub_status
    from public.exercise_library el
   where el.id = new.substitute_exercise_library_id;
  if not found then
    raise exception 'Remplacement refusé : fiche de banque introuvable (%)', new.substitute_exercise_library_id
      using errcode = 'foreign_key_violation';
  end if;
  if coalesce(v_sub_status, '') <> 'active' then
    raise exception 'Remplacement refusé : « % » n''est pas une fiche active', v_sub_name
      using errcode = 'check_violation';
  end if;
  if new.exercise_id is null then
    raise exception 'Remplacement refusé : aucun exercice prescrit n''est désigné, le pattern ne peut pas être comparé'
      using errcode = 'check_violation';
  end if;
  if v_src_library_id is null then
    raise exception 'Remplacement refusé : l''exercice prescrit ne vient pas de la banque, il n''a aucun pattern'
      using errcode = 'check_violation';
  end if;
  if v_src_library_id = new.substitute_exercise_library_id then
    raise exception 'Remplacement refusé : « % » est déjà l''exercice prescrit', v_sub_name
      using errcode = 'check_violation';
  end if;
  select el.movement_pattern into v_src_pattern
    from public.exercise_library el where el.id = v_src_library_id;
  if v_src_pattern is null then
    raise exception 'Remplacement refusé : l''exercice prescrit n''a pas de pattern de mouvement'
      using errcode = 'check_violation';
  end if;
  if v_sub_pattern is distinct from v_src_pattern then
    raise exception 'Remplacement refusé : « % » ne partage pas le pattern de mouvement de l''exercice prescrit', v_sub_name
      using errcode = 'check_violation';
  end if;

  -- Le NOM est DÉRIVÉ de la banque, jamais reçu du client.
  new.substitute_exercise_name := v_sub_name;
  return new;
end
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- F. CONTRÔLE FINAL — la migration échoue si elle est incomplète
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_manque text := '';
  v_def    text;
  v_bucket record;
begin
  -- Les colonnes
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'exercise_feedback'
                    and column_name = 'video_path') then
    v_manque := v_manque || ' colonne video_path absente ;';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'exercise_feedback'
                    and column_name = 'video_uploaded_at') then
    v_manque := v_manque || ' colonne video_uploaded_at absente ;';
  end if;

  -- Les deux contraintes de colonne
  if not exists (select 1 from pg_constraint where conname = 'exercise_feedback_video_path_shape') then
    v_manque := v_manque || ' contrainte de forme absente ;';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'exercise_feedback_video_uploaded_at_coherent') then
    v_manque := v_manque || ' contrainte de cohérence absente ;';
  end if;

  -- Le bucket, ses plafonds et sa liste blanche
  select * into v_bucket from storage.buckets where id = 'feedback-videos';
  if not found then
    v_manque := v_manque || ' bucket feedback-videos absent ;';
  else
    if v_bucket.public then
      v_manque := v_manque || ' le bucket est PUBLIC — inacceptable pour une vidéo d''élève ;';
    end if;
    if coalesce(v_bucket.file_size_limit, 0) <> 52428800 then
      v_manque := v_manque || ' plafond de taille absent ou différent ;';
    end if;
    if v_bucket.allowed_mime_types is null
       or exists (select 1 from unnest(v_bucket.allowed_mime_types) as t
                   where t not like 'video/%') then
      v_manque := v_manque || ' liste blanche de types absente ou non exclusivement vidéo ;';
    end if;
  end if;

  -- Le prédicat, sa nature, et surtout CE QU'IL N'AUTORISE PAS
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'feedback_video_path_owner_ok';
  if v_def is null then
    v_manque := v_manque || ' prédicat absent ;';
  else
    if position('is_coach_or_admin' in v_def) > 0 then
      v_manque := v_manque || ' le prédicat autorise TOUT coach (is_coach_or_admin) ;';
    end if;
    if position('students' in v_def) = 0 or position('coach_id' in v_def) = 0 then
      v_manque := v_manque || ' l''appartenance coach n''est pas prouvée par students.coach_id ;';
    end if;
    if position('current_student_id' in v_def) = 0 then
      v_manque := v_manque || ' l''élève ne peut plus lire ses propres vidéos ;';
    end if;
  end if;

  -- Les quatre policies, une par commande
  if (select count(distinct cmd) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'feedback_videos_%') <> 4 then
    v_manque := v_manque || ' les quatre policies du bucket ne sont pas toutes posées ;';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'feedback_videos_update_owner_or_staff'
                    and with_check is not null) then
    v_manque := v_manque || ' la policy UPDATE n''a pas de WITH CHECK ;';
  end if;

  -- Le gardien connaît les deux colonnes
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_exercise_feedback_write';
  if v_def is null or position('video_uploaded_at' in v_def) = 0
     or position('video_path' in v_def) = 0 then
    v_manque := v_manque || ' enforce_exercise_feedback_write() ne traite pas les colonnes vidéo ;';
  end if;

  if v_manque <> '' then
    raise exception 'MIGRATION INCOMPLÈTE —%', v_manque;
  end if;

  raise notice 'F4 socle posé : bucket feedback-videos privé (50 Mo, 3 types vidéo), 4 policies, colonnes video_path et video_uploaded_at sous gardien.';
end $$;
