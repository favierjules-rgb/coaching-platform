-- ────────────────────────────────────────────────────────────────────────────
-- Correctif provision_program_copy — chemin STAFF (fix/program-assignment-checkbox)
--
-- Bug démontré en production (lecture seule, 01/08/2026) : la garde
-- d'autorisation lisait `public.profiles p where p.id = auth.uid()`, or les
-- profils se résolvent par `p.user_id = auth.uid()` (0 profil sur 4 n'a
-- id = user_id ; toutes les fonctions du schéma — is_admin,
-- is_coach_or_admin — utilisent user_id). Conséquence : tout coach/admin
-- authentifié recevait `insufficient_privilege` → l'assignation d'un
-- programme individuel depuis l'admin n'écrivait JAMAIS rien. Le chemin
-- webhook (service_role) n'était pas affecté.
--
-- CREATE OR REPLACE conserve owner et privilèges existants ; les REVOKE/GRANT
-- sont ré-affirmés par sûreté (mêmes règles que 20260801120000 : ni anon,
-- ni PUBLIC — authenticated + service_role uniquement).
-- NE PAS exécuter en Production sans validation explicite.
-- ────────────────────────────────────────────────────────────────────────────

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
  -- CORRECTIF : le profil se résout par user_id (jamais par id).
  select coalesce(
    (select p.role::text from public.profiles p where p.user_id = auth.uid() limit 1),
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

  if v_source.owner_student_id = p_student_id then
    v_copy_id := v_source.id;
  end if;

  if v_copy_id is null and p_checkout_session_id is not null then
    select id into v_copy_id from public.programs
     where source_checkout_session_id = p_checkout_session_id;
  end if;

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

  insert into public.assignments (student_id, content_type, content_id)
  values (p_student_id, 'programme', v_copy_id)
  on conflict do nothing;

  return v_copy_id;
end;
$$;

REVOKE ALL ON FUNCTION public.provision_program_copy(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provision_program_copy(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_program_copy(uuid, uuid, text)
TO authenticated, service_role;
