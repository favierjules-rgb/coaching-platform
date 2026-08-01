-- ────────────────────────────────────────────────────────────────────────────
-- Historique immuable des séances réalisées — phase 1
-- (chantier feat/student-workout-history)
--
-- STRICTEMENT ADDITIVE : aucune colonne supprimée, aucune donnée transformée,
-- aucun champ rendu obligatoire, politiques RLS existantes conservées telles
-- quelles (la politique workout_feedback_student_or_staff [ALL] couvre les
-- nouvelles colonnes par construction). Idempotente : rejouable sans effet.
--
-- NE PAS exécuter en Production sans validation explicite.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Colonnes d'historique sur la tête du retour de séance.
alter table public.workout_feedback
  add column if not exists prescribed_snapshot jsonb,
  add column if not exists performed_at date,
  add column if not exists duration_minutes integer,
  add column if not exists session_status text;

comment on column public.workout_feedback.prescribed_snapshot is
  'Photographie du PRESCRIT au moment de la première soumission (lib/workout-history.ts, version 1). Immuable après pose — voir trigger workout_feedback_snapshot_immutable. NULL = ancien retour, le récapitulatif retombe sur la séance vivante.';
comment on column public.workout_feedback.performed_at is
  'Date réelle de réalisation déclarée (défaut : date de soumission).';
comment on column public.workout_feedback.duration_minutes is
  'Durée réelle de la séance en minutes (1..600), optionnelle.';
comment on column public.workout_feedback.session_status is
  'Cycle de vie du retour : done (réalisée) ou missed (manquée). NULL = ancien retour, statut inconnu.';

-- 2. Contraintes de validité, posées séparément pour rester idempotent.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workout_feedback_session_status_check') then
    alter table public.workout_feedback
      add constraint workout_feedback_session_status_check
      check (session_status is null or session_status in ('done', 'missed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workout_feedback_duration_minutes_check') then
    alter table public.workout_feedback
      add constraint workout_feedback_duration_minutes_check
      check (duration_minutes is null or (duration_minutes between 1 and 600));
  end if;
end $$;

-- 3. Index réellement nécessaires, et seulement eux :
--    - la future liste « historique d'un élève » trie par date de réalisation ;
--    - la jointure récapitulatif ↔ séance passe par session_id (colonne
--      existante, jusqu'ici non indexée).
--    Index partiels : les anciens retours (colonnes NULL) n'y figurent pas.
create index if not exists workout_feedback_student_performed_idx
  on public.workout_feedback (student_id, performed_at desc)
  where performed_at is not null;

create index if not exists workout_feedback_session_idx
  on public.workout_feedback (session_id)
  where session_id is not null;

-- 4. Immutabilité au niveau BASE : une fois posé, le snapshot ne change plus.
--    La couche applicative ne le réécrit jamais (garde dans
--    lib/supabase/workout-feedback.ts) ; ce trigger ferme aussi la porte à un
--    appel API direct. « Action administrative explicite » = désactiver
--    temporairement le trigger (alter table ... disable trigger), geste
--    volontaire et visible, jamais un UPDATE ordinaire.
create or replace function public.workout_feedback_protect_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.prescribed_snapshot is not null
     and new.prescribed_snapshot is distinct from old.prescribed_snapshot then
    raise exception 'prescribed_snapshot est immuable une fois posé (workout_feedback %)', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists workout_feedback_snapshot_immutable on public.workout_feedback;
create trigger workout_feedback_snapshot_immutable
  before update on public.workout_feedback
  for each row
  execute function public.workout_feedback_protect_snapshot();

-- 5. Idempotence des achats uniques (correction produit, même chantier) :
--    chaque copie individuelle issue d'un achat Stripe porte la référence de
--    sa session de paiement. Un webhook rejoué retrouve la copie existante ;
--    un NOUVEL achat (autre session) crée légitimement un nouveau cycle.
--    Unicité au niveau base : Postgres arbitre les courses de webhooks.
alter table public.programs
  add column if not exists source_checkout_session_id text;

comment on column public.programs.source_checkout_session_id is
  'Session Stripe Checkout à l''origine de cette copie individuelle (achat unique). NULL pour tout programme non issu d''un achat. Une copie au plus par session — voir l''index unique.';

create unique index if not exists programs_source_checkout_session_key
  on public.programs (source_checkout_session_id)
  where source_checkout_session_id is not null;

-- 6. Clonage TRANSACTIONNEL et idempotent d'un programme vers un élève
--    (contrôle technique phase 1). Le clonage applicatif historique
--    (duplicateProgramCore) enchaîne plusieurs écritures sans transaction :
--    un échec au milieu peut laisser une copie partielle. Cette RPC fait
--    tout — programme, semaines, séances, blocs, exercices, prescriptions,
--    assignation — dans UNE transaction : tout ou rien.
--
--    Idempotence et courses :
--      * verrou advisory transactionnel sur (élève, source) : deux webhooks
--        concurrents se sérialisent ;
--      * p_checkout_session_id fourni → une copie au plus par session
--        (recherche d'abord, index unique en dernier rempart) ;
--      * sans session (affectation coach) → réutilise la copie
--        (owner, source) du cycle en cours.
--    SECURITY DEFINER : réservée au service et au staff — un élève ne peut
--    pas se provisionner un programme (vérifié en tête de fonction).
create or replace function public.provision_program_copy(
  p_program_id uuid,
  p_student_id uuid,
  p_checkout_session_id text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_source public.programs%rowtype;
  v_copy_id uuid;
  v_week record;
  v_new_week_id uuid;
  v_session record;
  v_new_session_id uuid;
  v_block record;
  v_new_block_id uuid;
begin
  -- Autorisation : service_role (webhook) ou staff authentifié.
  select coalesce(
    (select p.role::text from public.profiles p where p.id = auth.uid()),
    case when auth.role() = 'service_role' then 'service' end
  ) into v_role;
  if v_role is null or v_role not in ('service', 'admin', 'coach') then
    raise exception 'provision_program_copy : accès refusé' using errcode = 'insufficient_privilege';
  end if;

  -- Sérialisation des appels concurrents pour ce couple (élève, source).
  perform pg_advisory_xact_lock(hashtext(p_student_id::text || '/' || p_program_id::text));

  select * into v_source from public.programs where id = p_program_id;
  if not found then
    return null;
  end if;

  -- Déjà la copie de cet élève → rien à faire.
  if v_source.owner_student_id = p_student_id then
    v_copy_id := v_source.id;
  end if;

  -- Idempotence par session d'achat.
  if v_copy_id is null and p_checkout_session_id is not null then
    select id into v_copy_id from public.programs
     where source_checkout_session_id = p_checkout_session_id;
  end if;

  -- Réaffectation du cycle en cours (chemin coach, sans session).
  if v_copy_id is null and p_checkout_session_id is null then
    select id into v_copy_id from public.programs
     where owner_student_id = p_student_id and source_template_id = p_program_id
     limit 1;
  end if;

  if v_copy_id is null then
    insert into public.programs (
      coach_id, name, goal, level, duration_weeks, description, status,
      program_type, banner_url, program_mode, group_start_date,
      is_public, public_subscription_template_id,
      owner_student_id, source_template_id, source_checkout_session_id
    )
    values (
      v_source.coach_id, v_source.name, v_source.goal, v_source.level,
      v_source.duration_weeks, v_source.description, v_source.status,
      v_source.program_type, v_source.banner_url, 'individuel', null,
      false, null,
      p_student_id, p_program_id, p_checkout_session_id
    )
    returning id into v_copy_id;

    for v_week in select * from public.program_weeks where program_id = p_program_id order by week_number loop
      insert into public.program_weeks (program_id, week_number)
      values (v_copy_id, v_week.week_number)
      returning id into v_new_week_id;

      for v_session in select * from public.workout_sessions
                        where program_week_id = v_week.id order by day loop
        insert into public.workout_sessions (
          program_id, program_week_id, day, is_rest_day, name, muscle_group,
          duration_minutes, warmup, coach_notes, session_type, banner_url
        ) values (
          v_copy_id, v_new_week_id, v_session.day, v_session.is_rest_day,
          v_session.name, v_session.muscle_group, v_session.duration_minutes,
          v_session.warmup, v_session.coach_notes, v_session.session_type,
          v_session.banner_url
        ) returning id into v_new_session_id;

        for v_block in select * from public.training_blocks
                        where session_id = v_session.id order by position loop
          insert into public.training_blocks (
            session_id, block_type, title, description, scoring_type,
            color_key, rounds, time_cap_seconds, duration_seconds,
            work_seconds, rest_seconds, rest_between_rounds_seconds,
            emom_minutes, position, media_path, cardio_type, machine_type
          ) values (
            v_new_session_id, v_block.block_type, v_block.title,
            v_block.description, v_block.scoring_type, v_block.color_key,
            v_block.rounds, v_block.time_cap_seconds, v_block.duration_seconds,
            v_block.work_seconds, v_block.rest_seconds,
            v_block.rest_between_rounds_seconds, v_block.emom_minutes,
            v_block.position, v_block.media_path, v_block.cardio_type,
            v_block.machine_type
          ) returning id into v_new_block_id;

          insert into public.workout_exercises (
            session_id, block_id, order_index, name, sets, reps, rest_seconds,
            tempo, recommended_load, video_url, notes, muscle_group,
            exercise_library_id, superset_label
          )
          select v_new_session_id, v_new_block_id, we.order_index, we.name,
                 we.sets, we.reps, we.rest_seconds, we.tempo,
                 we.recommended_load, we.video_url, we.notes, we.muscle_group,
                 we.exercise_library_id, we.superset_label
            from public.workout_exercises we
           where we.block_id = v_block.id;
        end loop;
      end loop;
    end loop;
  end if;

  -- Assignation idempotente vers la copie (unique (student, type, content)).
  insert into public.assignments (student_id, content_type, content_id)
  values (p_student_id, 'programme', v_copy_id)
  on conflict do nothing;

  return v_copy_id;
end;
$$;

-- Privilèges : les DEFAULT PRIVILEGES de Supabase accordent EXECUTE à anon,
-- authenticated et service_role à la création de toute fonction — révoquer
-- PUBLIC seul ne retire PAS ce grant direct (constat du contrôle local du
-- 01/08/2026 : anon avait EXECUTE). anon est donc révoqué explicitement.
-- authenticated reste autorisé : les coachs/staff authentifiés utilisent la
-- RPC, qui re-vérifie leur rôle en interne (insufficient_privilege sinon).
REVOKE ALL ON FUNCTION public.provision_program_copy(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provision_program_copy(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_program_copy(uuid, uuid, text)
TO authenticated, service_role;
