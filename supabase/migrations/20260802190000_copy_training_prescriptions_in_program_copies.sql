-- ────────────────────────────────────────────────────────────────────────────
-- provision_program_copy : copier AUSSI les prescriptions d'entraînement
-- (chantier fix/program-copy-training-prescriptions).
--
-- Défaut corrigé : la fonction copiait programs → program_weeks →
-- workout_sessions → training_blocks → workout_exercises → assignments,
-- mais JAMAIS public.training_prescriptions (segments cardio rattachés aux
-- blocs par block_id, prescriptions par exercice via exercise_id, hiérarchie
-- interne parent_prescription_id — repeat_group → segments enfants, ON
-- DELETE CASCADE). Toute copie d'un programme cardio naissait donc avec des
-- blocs vides. Constaté en production : la copie « TEST CARDIO MUSCU »
-- (8 blocs cardio, 0 segment) ; risque principal : le programme commercial
-- en vente porte 72 prescriptions qu'un achat ne copierait pas.
--
-- Technique de copie : variables %rowtype + INSERT ... VALUES (rec.*) —
-- TOUTES les colonnes sont copiées par construction (y compris de futures
-- colonnes), seuls id / rattachements (block_id, exercise_id,
-- parent_prescription_id) / created_at / updated_at sont réécrits vers les
-- NOUVEAUX identifiants de la copie. Les exercices passent d'un INSERT en
-- masse à une copie ligne à ligne pour disposer du mapping id source → id
-- copie qu'exigent leurs éventuelles prescriptions.
--
-- Toutes les garanties existantes sont conservées à l'identique :
-- SECURITY DEFINER, owner postgres, search_path vide, relations public.*,
-- garde staff par profiles.user_id = auth.uid(), service_role autorisé,
-- verrou advisory, échelle d'idempotence (owner → session Checkout →
-- owner+source), assignation vers la copie, privilèges authenticated +
-- service_role uniquement (ni anon ni PUBLIC).
-- CETTE MIGRATION NE RÉPARE AUCUNE COPIE EXISTANTE (script séparé, dry-run).
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
  v_exercise public.workout_exercises%rowtype;
  v_new_exercise_id uuid;
  v_prescription public.training_prescriptions%rowtype;
  v_child public.training_prescriptions%rowtype;
  v_new_prescription_id uuid;
begin
  -- Autorisation : service_role (webhook) ou staff authentifié.
  -- Le profil se résout par user_id (jamais par id) — correctif 20260801210000.
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

          -- Exercices : copie LIGNE À LIGNE (le mapping id source → id copie
          -- est indispensable pour rattacher leurs prescriptions).
          for v_exercise in select * from public.workout_exercises we
                             where we.block_id = v_block.id order by we.order_index loop
            insert into public.workout_exercises (
              session_id, block_id, order_index, name, sets, reps, rest_seconds,
              tempo, recommended_load, video_url, notes, muscle_group,
              exercise_library_id, superset_label
            ) values (
              v_new_session_id, v_new_block_id, v_exercise.order_index, v_exercise.name,
              v_exercise.sets, v_exercise.reps, v_exercise.rest_seconds,
              v_exercise.tempo, v_exercise.recommended_load, v_exercise.video_url,
              v_exercise.notes, v_exercise.muscle_group,
              v_exercise.exercise_library_id, v_exercise.superset_label
            ) returning id into v_new_exercise_id;

            -- Prescriptions PAR EXERCICE : parents puis enfants, ordre
            -- conservé, rattachées aux NOUVEAUX identifiants.
            for v_prescription in select * from public.training_prescriptions tp
                                   where tp.exercise_id = v_exercise.id
                                     and tp.parent_prescription_id is null
                                   order by tp.position, tp.set_number loop
              v_new_prescription_id := gen_random_uuid();
              declare
                v_source_prescription_id uuid := v_prescription.id;
              begin
                v_prescription.id := v_new_prescription_id;
                v_prescription.exercise_id := v_new_exercise_id;
                v_prescription.block_id := null;
                v_prescription.parent_prescription_id := null;
                v_prescription.created_at := now();
                v_prescription.updated_at := now();
                insert into public.training_prescriptions values (v_prescription.*);

                for v_child in select * from public.training_prescriptions c
                                where c.parent_prescription_id = v_source_prescription_id
                                order by c.position, c.set_number loop
                  v_child.id := gen_random_uuid();
                  v_child.exercise_id := v_new_exercise_id;
                  v_child.block_id := null;
                  v_child.parent_prescription_id := v_new_prescription_id;
                  v_child.created_at := now();
                  v_child.updated_at := now();
                  insert into public.training_prescriptions values (v_child.*);
                end loop;
              end;
            end loop;
          end loop;

          -- Prescriptions PAR BLOC (segments cardio) : parents (segments
          -- simples et repeat_group) puis leurs enfants, rattachés aux
          -- NOUVEAUX identifiants — jamais ceux du modèle.
          for v_prescription in select * from public.training_prescriptions tp
                                 where tp.block_id = v_block.id
                                   and tp.parent_prescription_id is null
                                 order by tp.position, tp.set_number loop
            v_new_prescription_id := gen_random_uuid();
            declare
              v_source_prescription_id uuid := v_prescription.id;
            begin
              v_prescription.id := v_new_prescription_id;
              v_prescription.block_id := v_new_block_id;
              v_prescription.exercise_id := null;
              v_prescription.parent_prescription_id := null;
              v_prescription.created_at := now();
              v_prescription.updated_at := now();
              insert into public.training_prescriptions values (v_prescription.*);

              for v_child in select * from public.training_prescriptions c
                              where c.parent_prescription_id = v_source_prescription_id
                              order by c.position, c.set_number loop
                v_child.id := gen_random_uuid();
                v_child.block_id := v_new_block_id;
                v_child.exercise_id := null;
                v_child.parent_prescription_id := v_new_prescription_id;
                v_child.created_at := now();
                v_child.updated_at := now();
                insert into public.training_prescriptions values (v_child.*);
              end loop;
            end;
          end loop;
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
