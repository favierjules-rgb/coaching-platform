-- ============================================================================
-- Multi-blocs — moteur d'écriture canonique v2 : métadonnées de séance
-- ATOMIQUES (session_patch) — chantier feature/multi-block-training-sessions,
-- Lot 3B (correction). Juillet 2026.
-- ============================================================================
--
-- REMPLACE la fonction créée par la migration 20260721224252 (create or replace
-- — on NE modifie PAS rétroactivement cette migration déjà appliquée au projet
-- de test). Signature INCHANGÉE : public.save_training_session_blocks(jsonb).
--
-- POURQUOI. Le câblage (updateProgram) faisait auparavant : UPDATE workout_
-- sessions (champs) → relecture updated_at → RPC. Ce pré-UPDATE bumpait
-- updated_at et NEUTRALISAIT le verrou optimiste (un conflit concurrent passait
-- inaperçu), et laissait un état partiel si la RPC échouait ensuite. Cette v2
-- rend la sauvegarde d'une séance ENTIÈREMENT atomique : les métadonnées
-- éditables arrivent dans le payload (`session_patch`) et sont écrites dans
-- l'UNIQUE UPDATE final de workout_sessions, APRÈS le contrôle STALE, dans la
-- même transaction que les blocs/exercices/prescriptions.
--
-- CONTRAT (inchangé vs 3A, + session_patch) :
--   1. verrou workout_sessions FOR UPDATE ;
--   2. comparaison expected_updated_at (issu du SNAPSHOT builder) ;
--   3. rejet STALE_TRAINING_SESSION AVANT toute mutation ;
--   4. validation stricte de session_patch (objet, clés autorisées seulement) ;
--   5. écriture contenu + métadonnées ;
--   6. UN SEUL UPDATE final de workout_sessions (session_patch + session_type +
--      is_rest_day + updated_at) ;
--   7. retourne le nouvel updated_at.
--
-- session_patch (optionnel, fourni par updateProgram pour une séance
-- EXISTANTE) : { day, name, muscle_group, duration_minutes, warmup,
-- coach_notes, banner_url }. Absent en création (la ligne vient d'être
-- insérée avec ses champs).
--
-- SÉCURITÉ : identique (security invoker, search_path='', revoke public/anon,
-- grant authenticated — rappelés en fin de fichier).
-- ============================================================================

create or replace function public.save_training_session_blocks(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  v_session_id uuid;
  v_expected_updated_at timestamptz;
  v_current_updated_at timestamptz;
  v_new_updated_at timestamptz;
  v_blocks jsonb;
  v_patch jsonb;

  v_block jsonb;
  v_exercise jsonb;
  v_prescription jsonb;

  v_raw_block_id text;
  v_category text;
  v_raw_ex_id text;

  v_legacy_seen boolean := false;
  v_temp_block_ids text[] := array[]::text[];
  v_temp_ex_ids text[] := array[]::text[];

  v_incoming_block_uuids uuid[] := array[]::uuid[];
  v_incoming_ex_uuids uuid[] := array[]::uuid[];

  v_existing_block_uuids uuid[];
  v_existing_ex_uuids uuid[];

  v_kept_block_uuids uuid[] := array[]::uuid[];
  v_kept_ex_uuids uuid[] := array[]::uuid[];

  v_block_uuid uuid;
  v_ex_uuid uuid;
  v_block_pos int;
  v_ex_order int;

  v_block_map jsonb := '{}'::jsonb;
  v_ex_map jsonb := '{}'::jsonb;

  v_ex_ids_to_delete uuid[];
  v_detached_feedback_count int := 0;

  v_has_strength boolean := false;
  v_has_cardio boolean := false;
  v_derived_type text;
  v_column_type text;

  v_result_blocks jsonb;
begin
  -- ── 0. Authentification : coach/admin uniquement ──────────────────────
  if not public.is_coach_or_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- ── 1. Enveloppe ──────────────────────────────────────────────────────
  v_session_id := nullif(p_payload->>'session_id', '')::uuid;
  if v_session_id is null then
    raise exception 'INVALID_PAYLOAD: session_id manquant';
  end if;
  if (p_payload ? 'expected_updated_at') = false or (p_payload->>'expected_updated_at') is null then
    raise exception 'INVALID_PAYLOAD: expected_updated_at obligatoire';
  end if;
  v_expected_updated_at := (p_payload->>'expected_updated_at')::timestamptz;
  v_blocks := coalesce(p_payload->'blocks', '[]'::jsonb);
  if jsonb_typeof(v_blocks) <> 'array' then
    raise exception 'INVALID_PAYLOAD: blocks doit être un tableau';
  end if;
  v_patch := p_payload->'session_patch';

  -- ── 2. Verrou de séance + appartenance ────────────────────────────────
  select ws.updated_at into v_current_updated_at
  from public.workout_sessions ws
  where ws.id = v_session_id
  for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND_OR_FORBIDDEN';
  end if;

  -- ── 3. Optimistic lock (APRÈS le verrou, AVANT toute mutation) ────────
  if v_current_updated_at is distinct from v_expected_updated_at then
    raise exception 'STALE_TRAINING_SESSION';
  end if;

  -- ── 3bis. Validation STRICTE de session_patch (aucune mutation encore) ─
  if v_patch is not null then
    if jsonb_typeof(v_patch) <> 'object' then
      raise exception 'INVALID_SESSION_PATCH: doit être un objet';
    end if;
    if exists (
      select 1 from jsonb_object_keys(v_patch) k
      where k not in ('day','name','muscle_group','duration_minutes','warmup','coach_notes','banner_url')
    ) then
      raise exception 'INVALID_SESSION_PATCH: clé non autorisée';
    end if;
  end if;

  -- ── 4. Validation STRICTE des ids + collecte ──────────────────────────
  for v_block in select * from jsonb_array_elements(v_blocks) loop
    v_raw_block_id := v_block->>'id';
    v_category := v_block->>'category';
    if v_category not in ('strength', 'cardio') then
      raise exception 'INVALID_BLOCK_CATEGORY: %', coalesce(v_category, '(null)');
    end if;
    if v_category = 'strength' then v_has_strength := true; else v_has_cardio := true; end if;

    if v_raw_block_id like 'legacy-strength:%' then
      if substring(v_raw_block_id from length('legacy-strength:') + 1) <> v_session_id::text then
        raise exception 'INVALID_LEGACY_BLOCK_ID: % (séance attendue %)', v_raw_block_id, v_session_id;
      end if;
      if v_category <> 'strength' then
        raise exception 'LEGACY_BLOCK_MUST_BE_STRENGTH: %', v_raw_block_id;
      end if;
      if v_legacy_seen then
        raise exception 'MULTIPLE_LEGACY_BLOCKS';
      end if;
      v_legacy_seen := true;
      if v_raw_block_id = any(v_temp_block_ids) then raise exception 'DUPLICATE_TEMP_BLOCK_ID: %', v_raw_block_id; end if;
      v_temp_block_ids := array_append(v_temp_block_ids, v_raw_block_id);
    elsif v_raw_block_id like 'new-block:%' then
      if substring(v_raw_block_id from length('new-block:') + 1) !~* c_uuid_re then
        raise exception 'INVALID_NEW_BLOCK_ID: %', v_raw_block_id;
      end if;
      if v_raw_block_id = any(v_temp_block_ids) then raise exception 'DUPLICATE_TEMP_BLOCK_ID: %', v_raw_block_id; end if;
      v_temp_block_ids := array_append(v_temp_block_ids, v_raw_block_id);
    elsif v_raw_block_id ~* c_uuid_re then
      v_incoming_block_uuids := array_append(v_incoming_block_uuids, v_raw_block_id::uuid);
    else
      raise exception 'UNRECOGNIZED_BLOCK_ID: %', coalesce(v_raw_block_id, '(null)');
    end if;

    if v_category = 'strength' then
      for v_exercise in select * from jsonb_array_elements(coalesce(v_block->'exercises', '[]'::jsonb)) loop
        v_raw_ex_id := v_exercise->>'id';
        if v_raw_ex_id like 'new-exercise:%' then
          if substring(v_raw_ex_id from length('new-exercise:') + 1) !~* c_uuid_re then
            raise exception 'INVALID_NEW_EXERCISE_ID: %', v_raw_ex_id;
          end if;
          if v_raw_ex_id = any(v_temp_ex_ids) then raise exception 'DUPLICATE_TEMP_EXERCISE_ID: %', v_raw_ex_id; end if;
          v_temp_ex_ids := array_append(v_temp_ex_ids, v_raw_ex_id);
        elsif v_raw_ex_id ~* c_uuid_re then
          v_incoming_ex_uuids := array_append(v_incoming_ex_uuids, v_raw_ex_id::uuid);
        else
          raise exception 'UNRECOGNIZED_EXERCISE_ID: %', coalesce(v_raw_ex_id, '(null)');
        end if;
      end loop;
    end if;
  end loop;

  -- ── 5. Vérifier que tout UUID entrant appartient à CETTE séance ───────
  select coalesce(array_agg(id), array[]::uuid[]) into v_existing_block_uuids
  from public.training_blocks where session_id = v_session_id;
  select coalesce(array_agg(id), array[]::uuid[]) into v_existing_ex_uuids
  from public.workout_exercises where session_id = v_session_id;

  if exists (select 1 from unnest(v_incoming_block_uuids) x where x <> all(v_existing_block_uuids)) then
    raise exception 'FOREIGN_BLOCK_ID';
  end if;
  if exists (select 1 from unnest(v_incoming_ex_uuids) x where x <> all(v_existing_ex_uuids)) then
    raise exception 'FOREIGN_EXERCISE_ID';
  end if;

  -- ── 6. Appliquer les blocs (création/mise à jour), position = index ───
  v_block_pos := 0;
  for v_block in select * from jsonb_array_elements(v_blocks) loop
    v_raw_block_id := v_block->>'id';
    v_category := v_block->>'category';

    if v_raw_block_id ~* c_uuid_re then
      v_block_uuid := v_raw_block_id::uuid;
      update public.training_blocks set
        block_type = v_category,
        title = coalesce(v_block->>'title', ''),
        color_key = coalesce(v_block->>'color_key', 'gray'),
        position = v_block_pos,
        cardio_type = case when v_category = 'cardio' then v_block->>'cardio_type' else null end,
        machine_type = case when v_category = 'cardio' then v_block->>'machine_type' else null end,
        updated_at = now()
      where id = v_block_uuid and session_id = v_session_id;
    else
      insert into public.training_blocks (session_id, block_type, title, color_key, position, cardio_type, machine_type)
      values (
        v_session_id,
        v_category,
        coalesce(v_block->>'title', ''),
        coalesce(v_block->>'color_key', 'gray'),
        v_block_pos,
        case when v_category = 'cardio' then v_block->>'cardio_type' else null end,
        case when v_category = 'cardio' then v_block->>'machine_type' else null end
      )
      returning id into v_block_uuid;
      v_block_map := v_block_map || jsonb_build_object(v_raw_block_id, v_block_uuid::text);
    end if;
    v_kept_block_uuids := array_append(v_kept_block_uuids, v_block_uuid);

    if v_category = 'strength' then
      v_ex_order := 0;
      for v_exercise in select * from jsonb_array_elements(coalesce(v_block->'exercises', '[]'::jsonb)) loop
        v_raw_ex_id := v_exercise->>'id';
        if v_raw_ex_id ~* c_uuid_re then
          v_ex_uuid := v_raw_ex_id::uuid;
          update public.workout_exercises set
            block_id = v_block_uuid,
            order_index = v_ex_order,
            name = coalesce(v_exercise->>'name', ''),
            sets = coalesce((v_exercise->>'sets')::int, 0),
            reps = coalesce(v_exercise->>'reps', ''),
            rest_seconds = coalesce((v_exercise->>'rest_seconds')::int, 0),
            tempo = coalesce(v_exercise->>'tempo', ''),
            recommended_load = coalesce(v_exercise->>'recommended_load', ''),
            video_url = coalesce(v_exercise->>'video_url', ''),
            notes = coalesce(v_exercise->>'notes', ''),
            muscle_group = v_exercise->>'muscle_group',
            exercise_library_id = nullif(v_exercise->>'exercise_library_id', '')::uuid,
            updated_at = now()
          where id = v_ex_uuid and session_id = v_session_id;
        else
          insert into public.workout_exercises (
            session_id, block_id, order_index, name, sets, reps, rest_seconds, tempo,
            recommended_load, video_url, notes, muscle_group, exercise_library_id
          ) values (
            v_session_id, v_block_uuid, v_ex_order,
            coalesce(v_exercise->>'name', ''),
            coalesce((v_exercise->>'sets')::int, 0),
            coalesce(v_exercise->>'reps', ''),
            coalesce((v_exercise->>'rest_seconds')::int, 0),
            coalesce(v_exercise->>'tempo', ''),
            coalesce(v_exercise->>'recommended_load', ''),
            coalesce(v_exercise->>'video_url', ''),
            coalesce(v_exercise->>'notes', ''),
            v_exercise->>'muscle_group',
            nullif(v_exercise->>'exercise_library_id', '')::uuid
          ) returning id into v_ex_uuid;
          v_ex_map := v_ex_map || jsonb_build_object(v_raw_ex_id, v_ex_uuid::text);
        end if;
        v_kept_ex_uuids := array_append(v_kept_ex_uuids, v_ex_uuid);
        v_ex_order := v_ex_order + 1;
      end loop;
    else
      delete from public.training_prescriptions where block_id = v_block_uuid;
      v_ex_order := 0;
      for v_prescription in select * from jsonb_array_elements(coalesce(v_block->'prescriptions', '[]'::jsonb)) loop
        insert into public.training_prescriptions (
          block_id, exercise_id, set_number, set_type, segment_type, title, position,
          repetitions, work_duration_seconds, distance_meters, elevation_gain_meters, incline_percentage,
          recovery_duration_seconds, recovery_distance_meters, intensity_target_type,
          target_vma_percentage, target_speed_kmh, target_pace_seconds_per_km, target_hr_percentage,
          target_hr_zone, target_power_watts, target_cadence, intensity_min, intensity_max,
          surface, terrain, equipment_type, coach_notes
        ) values (
          v_block_uuid, null, v_ex_order, 'normal',
          coalesce(v_prescription->>'segment_type', 'single'),
          nullif(v_prescription->>'title', ''), v_ex_order,
          (v_prescription->>'repetitions')::int,
          (v_prescription->>'work_duration_seconds')::int,
          (v_prescription->>'distance_meters')::numeric,
          (v_prescription->>'elevation_gain_meters')::numeric,
          (v_prescription->>'incline_percentage')::numeric,
          (v_prescription->>'recovery_duration_seconds')::int,
          (v_prescription->>'recovery_distance_meters')::numeric,
          coalesce(v_prescription->>'intensity_target_type', 'free'),
          (v_prescription->>'target_vma_percentage')::numeric,
          (v_prescription->>'target_speed_kmh')::numeric,
          (v_prescription->>'target_pace_seconds_per_km')::int,
          (v_prescription->>'target_hr_percentage')::numeric,
          nullif(v_prescription->>'target_hr_zone', ''),
          (v_prescription->>'target_power_watts')::numeric,
          (v_prescription->>'target_cadence')::numeric,
          (v_prescription->>'intensity_min')::numeric,
          (v_prescription->>'intensity_max')::numeric,
          nullif(v_prescription->>'surface', ''),
          nullif(v_prescription->>'terrain', ''),
          nullif(v_prescription->>'equipment_type', ''),
          coalesce(v_prescription->>'coach_notes', '')
        );
        v_ex_order := v_ex_order + 1;
      end loop;
    end if;

    v_block_pos := v_block_pos + 1;
  end loop;

  -- ── 7. Suppressions TARDIVES ──────────────────────────────────────────
  select coalesce(array_agg(id), array[]::uuid[]) into v_ex_ids_to_delete
  from public.workout_exercises
  where session_id = v_session_id and id <> all(v_kept_ex_uuids);

  select count(*) into v_detached_feedback_count
  from public.exercise_feedback
  where exercise_id = any(v_ex_ids_to_delete);

  if array_length(v_ex_ids_to_delete, 1) is not null then
    delete from public.workout_exercises where id = any(v_ex_ids_to_delete);
  end if;

  delete from public.training_blocks
  where session_id = v_session_id and id <> all(v_kept_block_uuids);

  -- ── 8. session_type dérivé + UPDATE FINAL unique (métadonnées incluses) ─
  v_derived_type := case
    when not v_has_strength and not v_has_cardio then 'rest'
    when v_has_strength and v_has_cardio then 'mixed'
    when v_has_strength then 'strength'
    else 'cardio'
  end;
  v_column_type := case when v_derived_type = 'rest' then 'strength' else v_derived_type end;

  -- session_patch appliqué ICI, dans l'UNIQUE UPDATE final : atomique avec le
  -- contenu et postérieur au contrôle STALE. Seules les clés présentes sont
  -- écrites (les autres conservent leur valeur). is_rest_day/session_type
  -- restent DÉRIVÉS des blocs (source de vérité), non pilotés par le patch.
  update public.workout_sessions
    set session_type = v_column_type,
        is_rest_day = (v_derived_type = 'rest'),
        day = case when v_patch ? 'day' then coalesce(v_patch->>'day', day) else day end,
        name = case when v_patch ? 'name' then coalesce(v_patch->>'name', '') else name end,
        muscle_group = case when v_patch ? 'muscle_group' then coalesce(v_patch->>'muscle_group', '') else muscle_group end,
        duration_minutes = case when v_patch ? 'duration_minutes' then (v_patch->>'duration_minutes')::int else duration_minutes end,
        warmup = case when v_patch ? 'warmup' then coalesce(v_patch->>'warmup', '') else warmup end,
        coach_notes = case when v_patch ? 'coach_notes' then coalesce(v_patch->>'coach_notes', '') else coach_notes end,
        banner_url = case when v_patch ? 'banner_url' then nullif(v_patch->>'banner_url', '') else banner_url end,
        updated_at = now()
    where id = v_session_id
    returning updated_at into v_new_updated_at;

  -- ── 9. Modèle canonique retourné (recomposé depuis la base) ──────────
  select coalesce(jsonb_agg(blk order by blk_position), '[]'::jsonb) into v_result_blocks
  from (
    select
      tb.position as blk_position,
      jsonb_build_object(
        'id', tb.id,
        'sessionId', tb.session_id,
        'category', case when tb.block_type = 'cardio' then 'cardio' else 'strength' end,
        'position', tb.position,
        'title', case when tb.title = '' then null else tb.title end,
        'colorKey', tb.color_key,
        'cardioType', tb.cardio_type,
        'machineType', tb.machine_type,
        'exercises', case when tb.block_type = 'cardio' then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', we.id, 'order', we.order_index, 'name', we.name, 'sets', we.sets, 'reps', we.reps,
            'restSeconds', we.rest_seconds, 'tempo', we.tempo, 'recommendedLoad', we.recommended_load,
            'videoUrl', we.video_url, 'notes', we.notes, 'muscleGroup', we.muscle_group,
            'libraryExerciseId', we.exercise_library_id
          ) order by we.order_index)
          from public.workout_exercises we where we.block_id = tb.id
        ), '[]'::jsonb) end,
        'prescriptions', case when tb.block_type <> 'cardio' then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', tp.id, 'order', tp.position, 'segmentType', tp.segment_type, 'title', tp.title
          ) order by tp.position)
          from public.training_prescriptions tp where tp.block_id = tb.id
        ), '[]'::jsonb) end
      ) as blk
    from public.training_blocks tb
    where tb.session_id = v_session_id
  ) s;

  return jsonb_build_object(
    'session_id', v_session_id,
    'updated_at', v_new_updated_at,
    'session_type', v_derived_type,
    'blocks', v_result_blocks,
    'id_mapping', jsonb_build_object('blocks', v_block_map, 'exercises', v_ex_map),
    'warnings', jsonb_build_object('detached_exercise_feedback_count', v_detached_feedback_count)
  );
end;
$fn$;

comment on function public.save_training_session_blocks(jsonb) is
  'Moteur d''écriture canonique multi-blocs v2 (Lot 3B). Un seul appel RPC transactionnel : contenu + métadonnées (session_patch) écrites atomiquement après contrôle STALE. Voir l''en-tête de la migration 20260722120000.';

revoke execute on function public.save_training_session_blocks(jsonb) from public;
revoke execute on function public.save_training_session_blocks(jsonb) from anon;
grant execute on function public.save_training_session_blocks(jsonb) to authenticated;
