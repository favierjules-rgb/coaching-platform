-- ────────────────────────────────────────────────────────────────────────────
-- F3 — passe de sécurité : le RETOUR DE SÉANCE devient serveur-autoritaire
--      (chantier feat/training-movement-patterns, seconde migration)
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI DES TRIGGERS ET NON UNE RPC
-- ────────────────────────────────────────────────────────────────────────────
-- La demande : « choisis la solution la plus simple qui rend le snapshot
-- serveur-autoritaire », et « ne laisse pas un deuxième chemin d'écriture
-- direct permettant de contourner la RPC ».
--
-- Une RPC SECURITY DEFINER rendrait le snapshot autoritaire UNIQUEMENT pour
-- qui passe par elle. Comme la politique `workout_feedback_student_or_staff`
-- est [ALL], il faudrait EN PLUS retirer le droit d'écriture directe des
-- élèves sur trois tables — donc réécrire trois politiques du baseline, et
-- déplacer toute la couche d'écriture applicative. Beaucoup de surface pour
-- une garantie qui reste conditionnelle : le jour où une politique se
-- desserre, le contournement revient.
--
-- Un TRIGGER `before insert or update` s'exécute sur TOUTE écriture, quel
-- que soit le chemin : PostgREST direct, RPC, psql, service_role. Il n'y a
-- donc AUCUN deuxième chemin à fermer — il n'en existe pas. Le snapshot
-- n'est pas « validé » : il est RECALCULÉ à partir des lignes de
-- prescription réelles et la valeur reçue est jetée sans être lue. C'est
-- strictement plus fort qu'une RPC, et c'est plus simple.
--
-- Les mêmes triggers portent tout le reste : appartenance réelle de la
-- séance à l'élève, cohérence parent/enfant des lignes de retour, colonnes
-- immuables, colonnes dérivées, colonnes réservées au coach.
--
-- ────────────────────────────────────────────────────────────────────────────
-- MATRICE DE PROPRIÉTÉ DES COLONNES (A = élève, B = coach/admin,
-- C = dérivée par la base, D = immuable après création)
-- ────────────────────────────────────────────────────────────────────────────
-- workout_feedback
--   id                    C/D   clé technique, jamais réécrite
--   student_id            D     imposée par la RLS à la création, figée ensuite
--   session_id            A/D   fournie à la création, VÉRIFIÉE, figée ensuite
--   program_id            A/D   idem
--   session_key           D     clé logique du retour, figée
--   session_ref_label     A     libellé affiché, saisi par le chemin élève
--   completed             A
--   global_rpe            A
--   global_comment        A
--   pain                  A
--   performed_at          A     (borne applicative ; pas de CHECK en base)
--   duration_minutes      A     CHECK 1..600 (migration 20260801120000)
--   status                B     réservé au staff
--   coach_reply           B     réservé au staff
--   session_status        B/C   dérivé de `completed` pour un élève ; libre pour le staff
--   prescribed_snapshot   C     RECALCULÉ en base, jamais accepté du client
--   submitted_at          C     now() à chaque écriture élève
--   created_at            C/D   figée
--   updated_at            C     now()
--
-- exercise_feedback
--   id                              C/D
--   workout_feedback_id             D     + le parent doit appartenir au même élève
--   student_id                      D     + doit ÉGALER celui du parent
--   exercise_id                     A     + doit appartenir à la séance du parent
--   exercise_name                   C/D   nom PRESCRIT : DÉRIVÉ de exercise_id
--                                         quand il est fourni ; libre sinon
--                                         (cardio, séance hors Supabase) ; figé
--                                         après création dans tous les cas
--   exercise_order                  A
--   rpe                             A
--   comment                         A
--   substitute_exercise_library_id  A     + validé (pattern, statut, séance)
--   substitute_exercise_name        C     DÉRIVÉ de l'identifiant
--   created_at / updated_at         C/D
--
-- exercise_set_feedback
--   id                       C/D
--   exercise_feedback_id     D     + le parent doit appartenir au même élève
--   student_id               D     + doit ÉGALER celui du parent
--   set_number               A
--   load_used                A
--   reps_done                A
--   rpe                      A     CHECK 1..10
--   created_at / updated_at  C/D
--
-- FAILLE SUPPLÉMENTAIRE FERMÉE ICI. `exercise_feedback_student_or_staff` ne
-- contrôle que `student_id` : rien n'empêchait un élève d'INSÉRER une ligne
-- d'exercice, portant SON student_id, rattachée au `workout_feedback_id`
-- d'un AUTRE élève — la ligne apparaissait alors dans le retour de l'autre,
-- côté coach. Le contrôle de cohérence parent/enfant ferme cette porte, et
-- la même sur `exercise_set_feedback`.
--
-- STRICTEMENT ADDITIVE : aucune colonne supprimée, aucune politique modifiée,
-- aucune migration déjà appliquée touchée. Idempotente.
--
-- NE PAS exécuter en Production sans validation explicite.
-- ────────────────────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────────────────────
-- 1. La séance appartient-elle réellement à cet élève ?
-- ────────────────────────────────────────────────────────────────────────────
-- Deux formes légitimes, exactement celles que contrôle déjà la route
-- POST /api/student/workout-feedback : programme POSSÉDÉ (copie
-- individuelle, `owner_student_id`) ou programme ASSIGNÉ (`assignments`).
-- SECURITY DEFINER : la vérification doit être autoritaire, donc lire sans
-- être filtrée par la RLS de l'appelant. Elle ne rend qu'un booléen.
create or replace function public.student_owns_workout_session(p_student_id uuid, p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.workout_sessions s
     where s.id = p_session_id
       and (
         exists (select 1 from public.programs p
                  where p.id = s.program_id and p.owner_student_id = p_student_id)
         or exists (select 1 from public.assignments a
                     where a.student_id = p_student_id
                       and a.content_type = 'programme'
                       and a.content_id = s.program_id)
       )
  );
$$;

alter function public.student_owns_workout_session(uuid, uuid) owner to postgres;
comment on function public.student_owns_workout_session(uuid, uuid) is
  'Vrai si la séance appartient à un programme possédé ou assigné à cet élève. Mêmes deux formes que la route de soumission des retours.';
revoke all on function public.student_owns_workout_session(uuid, uuid) from public;
revoke execute on function public.student_owns_workout_session(uuid, uuid) from anon;
grant execute on function public.student_owns_workout_session(uuid, uuid) to authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. LA PHOTOGRAPHIE DU PRESCRIT, CONSTRUITE PAR LA BASE
-- ────────────────────────────────────────────────────────────────────────────
-- Forme IDENTIQUE à `buildPrescribedSnapshot` (lib/workout-history.ts,
-- version 1) : le récapitulatif élève et `isPrescribedSnapshot` la relisent
-- sans rien changer. Les lignes lues sont celles de la séance RÉELLE ; rien
-- de ce que le navigateur envoie n'est consulté.
--
-- Une seule différence, volontaire et compatible : `weekNumber` est
-- réellement renseigné depuis `program_weeks`, là où le chargeur applicatif
-- ne sélectionnait pas la colonne et laissait toujours `null`. Le champ est
-- typé `number | null` et n'est affiché nulle part : aucun écran ne change.
create or replace function public.build_prescribed_snapshot(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'sessionId', s.id::text,
    'sessionName', coalesce(s.name, ''),
    'day', s.day,
    'weekNumber', pw.week_number,
    -- Même format que `new Date().toISOString()` : le récapitulatif le passe
    -- directement à `new Date(...)`.
    'capturedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'blocks', coalesce((
      select jsonb_agg(t.bloc order by t.position, t.id)
        from (
          select b.id,
                 coalesce(b.position, 0) as position,
                 jsonb_build_object(
                   'title', b.title,
                   'category', b.block_type,
                   'position', coalesce(b.position, 0),
                   'exercises', coalesce((
                     select jsonb_agg(
                              jsonb_build_object(
                                'exerciseLibraryId', we.exercise_library_id,
                                'name', coalesce(we.name, ''),
                                'order', coalesce(we.order_index, 0),
                                'sets', we.sets,
                                'reps', we.reps,
                                'recommendedLoad', we.recommended_load,
                                'recommendedRpe', we.recommended_rpe,
                                'restSeconds', we.rest_seconds,
                                'tempo', we.tempo,
                                'notes', we.notes
                              )
                              order by coalesce(we.order_index, 0), we.id
                            )
                       from public.workout_exercises we
                      where we.block_id = b.id
                   ), '[]'::jsonb)
                 ) as bloc
            from public.training_blocks b
           where b.session_id = s.id
        ) t
    ), '[]'::jsonb)
  )
  from public.workout_sessions s
  left join public.program_weeks pw on pw.id = s.program_week_id
  where s.id = p_session_id;
$$;

alter function public.build_prescribed_snapshot(uuid) owner to postgres;
comment on function public.build_prescribed_snapshot(uuid) is
  'Photographie du PRESCRIT (format version 1 de lib/workout-history.ts) reconstruite depuis les lignes réelles de la séance. Seule source autoritaire de workout_feedback.prescribed_snapshot.';
revoke all on function public.build_prescribed_snapshot(uuid) from public;
revoke execute on function public.build_prescribed_snapshot(uuid) from anon;
revoke execute on function public.build_prescribed_snapshot(uuid) from authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. `workout_feedback` : tout ce qui n'appartient pas à l'élève
-- ────────────────────────────────────────────────────────────────────────────
-- Remplace `protect_workout_feedback_coach_columns` (migration
-- 20260820090000, jamais appliquée en Production) : même rôle, périmètre
-- élargi à TOUTES les colonnes B, C et D, plus la vérification de la séance.
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

  -- ── B. Colonnes du coach ─────────────────────────────────────────────────
  if v_systeme or v_staff then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'a-traiter';
    new.coach_reply := '';
    new.session_status := case when new.completed then 'done' else null end;
  else
    new.status := old.status;
    new.coach_reply := old.coach_reply;
    new.session_status := case when new.completed then 'done' else null end;
  end if;

  return new;
end;
$$;

alter function public.enforce_workout_feedback_write() owner to postgres;
comment on function public.enforce_workout_feedback_write() is
  'Unique gardien des écritures sur workout_feedback : recalcule prescribed_snapshot depuis la prescription réelle, vérifie que la séance appartient à l''élève, fige les colonnes immuables, dérive les horodatages et réserve status/coach_reply/session_status au staff.';
revoke all on function public.enforce_workout_feedback_write() from public;
revoke execute on function public.enforce_workout_feedback_write() from anon;
revoke execute on function public.enforce_workout_feedback_write() from authenticated;

-- L'ancien trigger et sa fonction sont remplacés — pas empilés : deux
-- gardiens partiels sur la même table finiraient par diverger.
drop trigger if exists protect_workout_feedback_coach_columns on public.workout_feedback;
drop function if exists public.protect_workout_feedback_coach_columns();

drop trigger if exists enforce_workout_feedback_write on public.workout_feedback;
create trigger enforce_workout_feedback_write
  before insert or update on public.workout_feedback
  for each row
  execute function public.enforce_workout_feedback_write();


-- ────────────────────────────────────────────────────────────────────────────
-- 4. `exercise_feedback` : cohérence parent/enfant + remplacement
-- ────────────────────────────────────────────────────────────────────────────
-- Reprend intégralement `enforce_exercise_feedback_substitution` (migration
-- 20260820090000) et y ajoute :
--   * le parent doit exister et appartenir AU MÊME élève que la ligne ;
--   * `exercise_id`, dès qu'il est fourni, doit appartenir à la séance du
--     parent — plus seulement quand un remplacement est déclaré ;
--   * les colonnes de rattachement sont figées après création.
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
begin
  -- ── D. Rattachement figé après création ──────────────────────────────────
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.workout_feedback_id := old.workout_feedback_id;
    new.student_id := old.student_id;
    new.created_at := old.created_at;
    -- Le nom PRESCRIT est une photographie : il ne se retouche pas.
    new.exercise_name := old.exercise_name;
  end if;
  new.updated_at := now();

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

  -- a/b. La fiche de remplacement existe, est active, et porte un pattern.
  select el.name, el.movement_pattern, el.status
    into v_sub_name, v_sub_pattern, v_sub_status
    from public.exercise_library el
   where el.id = new.substitute_exercise_library_id;
  if not found then
    raise exception 'Remplacement refusé : exercice de banque introuvable (%)', new.substitute_exercise_library_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_sub_status <> 'active' then
    raise exception 'Remplacement refusé : l''exercice de remplacement est archivé (%)', new.substitute_exercise_library_id
      using errcode = 'check_violation';
  end if;
  if v_sub_pattern is null then
    raise exception 'Remplacement refusé : l''exercice de remplacement n''a pas de pattern de mouvement (%)', new.substitute_exercise_library_id
      using errcode = 'check_violation';
  end if;

  -- c. L'exercice PRESCRIT doit être identifié et venir de la banque.
  if new.exercise_id is null then
    raise exception 'Remplacement refusé : exercice prescrit non identifié (exercise_id absent)'
      using errcode = 'check_violation';
  end if;
  if v_src_library_id is null then
    raise exception 'Remplacement refusé : l''exercice prescrit ne vient pas de la banque, aucun pattern à comparer (%)', new.exercise_id
      using errcode = 'check_violation';
  end if;

  -- e. Se remplacer par soi-même n'est pas un remplacement.
  if v_src_library_id = new.substitute_exercise_library_id then
    raise exception 'Remplacement refusé : le remplaçant est l''exercice prescrit lui-même (%)', v_src_library_id
      using errcode = 'check_violation';
  end if;

  -- d. Même pattern, sinon ce n'est pas un remplacement mais un autre exercice.
  select el.movement_pattern into v_src_pattern
    from public.exercise_library el
   where el.id = v_src_library_id;
  if v_src_pattern is null then
    raise exception 'Remplacement refusé : l''exercice prescrit n''a pas de pattern de mouvement (%)', v_src_library_id
      using errcode = 'check_violation';
  end if;
  if v_src_pattern <> v_sub_pattern then
    raise exception 'Remplacement refusé : patterns de mouvement différents (% ≠ %)', v_src_pattern, v_sub_pattern
      using errcode = 'check_violation';
  end if;

  -- a. Le nom est DÉRIVÉ, jamais reçu.
  new.substitute_exercise_name := v_sub_name;
  return new;
end;
$$;

alter function public.enforce_exercise_feedback_write() owner to postgres;
comment on function public.enforce_exercise_feedback_write() is
  'Unique gardien des écritures sur exercise_feedback : impose la cohérence parent/enfant (même élève, même séance), fige le rattachement, dérive substitute_exercise_name de son identifiant et refuse tout remplacement de pattern discordant.';
revoke all on function public.enforce_exercise_feedback_write() from public;
revoke execute on function public.enforce_exercise_feedback_write() from anon;
revoke execute on function public.enforce_exercise_feedback_write() from authenticated;

drop trigger if exists enforce_exercise_feedback_substitution on public.exercise_feedback;
drop function if exists public.enforce_exercise_feedback_substitution();

drop trigger if exists enforce_exercise_feedback_write on public.exercise_feedback;
create trigger enforce_exercise_feedback_write
  before insert or update on public.exercise_feedback
  for each row
  execute function public.enforce_exercise_feedback_write();


-- ────────────────────────────────────────────────────────────────────────────
-- 5. `exercise_set_feedback` : même cohérence parent/enfant
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_exercise_set_feedback_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_student_id uuid;
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.exercise_feedback_id := old.exercise_feedback_id;
    new.student_id := old.student_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();

  select ef.student_id into v_parent_student_id
    from public.exercise_feedback ef
   where ef.id = new.exercise_feedback_id;
  if not found then
    raise exception 'Série refusée : ligne d''exercice parente introuvable (%)', new.exercise_feedback_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_parent_student_id <> new.student_id then
    raise exception 'Série refusée : la ligne d''exercice parente appartient à un autre élève'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

alter function public.enforce_exercise_set_feedback_write() owner to postgres;
comment on function public.enforce_exercise_set_feedback_write() is
  'Impose qu''une série appartienne à la même personne que la ligne d''exercice qui la porte, et fige son rattachement après création.';
revoke all on function public.enforce_exercise_set_feedback_write() from public;
revoke execute on function public.enforce_exercise_set_feedback_write() from anon;
revoke execute on function public.enforce_exercise_set_feedback_write() from authenticated;

drop trigger if exists enforce_exercise_set_feedback_write on public.exercise_set_feedback;
create trigger enforce_exercise_set_feedback_write
  before insert or update on public.exercise_set_feedback
  for each row
  execute function public.enforce_exercise_set_feedback_write();


-- ────────────────────────────────────────────────────────────────────────────
-- 6. Contrôle final — la migration échoue si elle est incomplète
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_manque text := '';
  v_fn text;
begin
  foreach v_fn in array array[
    'student_owns_workout_session',
    'build_prescribed_snapshot',
    'enforce_workout_feedback_write',
    'enforce_exercise_feedback_write',
    'enforce_exercise_set_feedback_write'
  ] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_fn
    ) then v_manque := v_manque || ' fonction:' || v_fn; end if;
  end loop;

  foreach v_fn in array array[
    'enforce_workout_feedback_write',
    'enforce_exercise_feedback_write',
    'enforce_exercise_set_feedback_write'
  ] loop
    if not exists (select 1 from pg_trigger where tgname = v_fn and not tgisinternal) then
      v_manque := v_manque || ' trigger:' || v_fn;
    end if;
  end loop;

  -- Les gardiens remplacés ne doivent plus exister : deux gardiens
  -- partiels sur la même table finiraient par diverger.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('protect_workout_feedback_coach_columns',
                                  'enforce_exercise_feedback_substitution')) then
    v_manque := v_manque || ' ancien gardien encore présent';
  end if;

  -- Aucune fonction de garde n'est appelable directement.
  foreach v_fn in array array[
    'public.enforce_workout_feedback_write()',
    'public.enforce_exercise_feedback_write()',
    'public.enforce_exercise_set_feedback_write()',
    'public.build_prescribed_snapshot(uuid)'
  ] loop
    if has_function_privilege('authenticated', v_fn, 'execute') then
      v_manque := v_manque || ' privilege:' || v_fn;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.student_owns_workout_session(uuid,uuid)', 'execute') then
    v_manque := v_manque || ' privilege:student_owns_workout_session(anon)';
  end if;

  if v_manque <> '' then
    raise exception 'MIGRATION INCOMPLÈTE —%', v_manque;
  end if;
end $$;
