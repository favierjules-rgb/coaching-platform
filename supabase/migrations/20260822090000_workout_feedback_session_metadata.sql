-- ────────────────────────────────────────────────────────────────────────────
-- F3 — les métadonnées de séance d'un retour cessent d'être déclaratives
--      (chantier feat/training-movement-patterns, troisième et dernière migration)
--
-- ────────────────────────────────────────────────────────────────────────────
-- L'AUDIT QUI A CONDUIT ICI
-- ────────────────────────────────────────────────────────────────────────────
-- `workout_feedback` porte QUATRE champs qui décrivent la séance prescrite.
-- Depuis 20260821090000, `session_id` est vérifié (la séance appartient
-- réellement à l'élève) et `prescribed_snapshot` est recalculé. Les trois
-- autres restaient déclaratifs — le client envoyait ce qu'il voulait, sans
-- qu'aucune cohérence avec `session_id` ne soit exigée.
--
-- Chacun a été repris un par un : existe-t-il une source AUTORITAIRE en base
-- à partir de `session_id`, et une CONSÉQUENCE MÉTIER réelle ?
--
--   program_id
--     Source     : `workout_sessions.program_id` — exacte, sans ambiguïté.
--     Conséquence: c'est une clé étrangère vers la prescription. Aujourd'hui
--                  elle n'alimente qu'une mention (« Programme non lié »)
--                  dans la modale coach — mais rien n'empêchait un retour de
--                  se réclamer du programme d'un AUTRE élève, voire d'un
--                  autre coach. Une donnée fausse dans une clé étrangère est
--                  une bombe à retardement : la première requête « tous les
--                  retours de ce programme » la ramasserait.
--     Décision   : DÉRIVÉE de la séance.
--
--   session_key
--     Source     : `session_id::text` — c'est exactement ce que le chemin
--                  applicatif envoie déjà (SessionFeedbackSection passe le
--                  même identifiant en `sessionKey` et en `sessionId`).
--     Conséquence: c'est la CLÉ D'UPSERT du retour
--                  (`getWorkoutFeedbackBySession(student, sessionKey)`), et
--                  la clé d'exclusion des « dernières perfs »
--                  (lib/previous-performance.ts). Une clé falsifiée crée un
--                  second retour parallèle pour la même séance — l'invariant
--                  « un seul retour par séance » tombe — et fait réapparaître
--                  la séance en cours dans ses propres repères.
--     Décision   : DÉRIVÉE de la séance.
--
--   session_ref_label
--     Source     : `workout_sessions.name`.
--     Conséquence: ce N'EST PAS un libellé libre. La fiche élève côté coach
--                  (app/admin/eleves/[studentId]/page.tsx) RETROUVE la séance
--                  prescrite en comparant `session.name` à `refLabel` pour
--                  bâtir le panneau « Prévu vs réalisé ». Un libellé falsifié
--                  fait pointer ce panneau vers une autre séance, ou vers
--                  aucune. Il représente donc bien la séance prescrite.
--     Décision   : DÉRIVÉ de la séance — et FIGÉ ensuite, comme
--                  `exercise_name` : renommer la séance plus tard ne réécrit
--                  pas l'étiquette d'un retour déjà envoyé.
--
--   performed_at, duration_minutes, completed, global_rpe, global_comment,
--   pain : ce sont des DÉCLARATIONS de l'élève sur ce qu'il a vécu, pas des
--   métadonnées de prescription. Aucune source autoritaire n'existe, et il
--   serait faux d'en inventer une. Inchangés.
--
-- SÉANCE HORS SUPABASE (`session_id` NULL). Il n'existe alors aucune ligne
-- de prescription d'où dériver quoi que ce soit : les trois champs restent
-- libres, exactement comme aujourd'hui. C'est le chemin mock/localStorage,
-- et il continue de fonctionner tel quel.
--
-- ────────────────────────────────────────────────────────────────────────────
-- MATRICE DE PROPRIÉTÉ — LIGNES RÉVISÉES (remplacent celles de 20260821090000)
-- ────────────────────────────────────────────────────────────────────────────
-- workout_feedback
--   program_id            C/D   DÉRIVÉ de la séance ; peut ensuite disparaître
--                               (on delete set null), jamais être repointé
--   session_key           C/D   DÉRIVÉE de la séance (session_id::text), figée
--   session_ref_label     C/D   DÉRIVÉ du nom de la séance, figé ensuite
--
-- STRICTEMENT ADDITIVE : aucune colonne, contrainte ou politique touchée —
-- seul le corps du gardien `enforce_workout_feedback_write` est remplacé.
-- Idempotente. Aucune migration déjà appliquée modifiée.
--
-- NE PAS exécuter en Production sans validation explicite.
-- ────────────────────────────────────────────────────────────────────────────

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
  'Unique gardien des écritures sur workout_feedback : DÉRIVE de la séance les métadonnées de prescription (program_id, session_key, session_ref_label, prescribed_snapshot), vérifie que la séance appartient à l''élève, fige les colonnes immuables, dérive les horodatages et réserve status/coach_reply/session_status au staff.';

revoke all on function public.enforce_workout_feedback_write() from public;
revoke execute on function public.enforce_workout_feedback_write() from anon;
revoke execute on function public.enforce_workout_feedback_write() from authenticated;

-- Le trigger pointe déjà cette fonction (migration 20260821090000) ; on le
-- repose pour rester rejouable indépendamment.
drop trigger if exists enforce_workout_feedback_write on public.workout_feedback;
create trigger enforce_workout_feedback_write
  before insert or update on public.workout_feedback
  for each row
  execute function public.enforce_workout_feedback_write();


-- ────────────────────────────────────────────────────────────────────────────
-- Contrôle final — la migration échoue si elle est incomplète
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_manque text := '';
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_workout_feedback_write';
  if v_src is null then
    raise exception 'MIGRATION INCOMPLÈTE — fonction enforce_workout_feedback_write absente';
  end if;

  if position('into new.program_id, new.session_ref_label' in v_src) = 0 then
    v_manque := v_manque || ' derivation:program_id/session_ref_label';
  end if;
  if position('new.session_key := new.session_id::text' in v_src) = 0 then
    v_manque := v_manque || ' derivation:session_key';
  end if;
  if position('new.session_ref_label := old.session_ref_label' in v_src) = 0 then
    v_manque := v_manque || ' gel:session_ref_label';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'enforce_workout_feedback_write'
       and tgrelid = 'public.workout_feedback'::regclass
  ) then v_manque := v_manque || ' trigger'; end if;

  if has_function_privilege('authenticated', 'public.enforce_workout_feedback_write()', 'execute') then
    v_manque := v_manque || ' privilege:authenticated';
  end if;

  if v_manque <> '' then
    raise exception 'MIGRATION INCOMPLÈTE —%', v_manque;
  end if;
end $$;
