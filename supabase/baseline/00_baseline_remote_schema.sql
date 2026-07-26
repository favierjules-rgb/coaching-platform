


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."current_student_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select id from public.students where user_id = auth.uid();
$$;


ALTER FUNCTION "public"."current_student_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_coach_or_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role in ('coach', 'admin')
  );
$$;


ALTER FUNCTION "public"."is_coach_or_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_student_profiles_access_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_coach_or_admin() then
    new.billing_access_mode := old.billing_access_mode;
    new.assigned_stripe_plan := old.assigned_stripe_plan;
    new.assigned_stripe_price_id := old.assigned_stripe_price_id;
    new.access_note := old.access_note;
    new.access_updated_at := old.access_updated_at;
    new.access_updated_by := old.access_updated_by;
    new.assigned_subscription_template_id := old.assigned_subscription_template_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_student_profiles_access_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_training_session_blocks"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "public"."save_training_session_blocks"("p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."save_training_session_blocks"("p_payload" "jsonb") IS 'Moteur d''écriture canonique multi-blocs v2 (Lot 3B). Un seul appel RPC transactionnel : contenu + métadonnées (session_patch) écrites atomiquement après contrôle STALE. Voir l''en-tête de la migration 20260722120000.';



CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activity_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid",
    "actor_type" "text" DEFAULT 'system'::"text" NOT NULL,
    "event_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."activity_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointment_email_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "appointment_id" "uuid",
    "recipient_email" "text" DEFAULT ''::"text" NOT NULL,
    "type" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT ''::"text" NOT NULL,
    "sent_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."appointment_email_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid",
    "coach_id" "uuid",
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "appointment_type" "text" DEFAULT 'Autre'::"text" NOT NULL,
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "timezone" "text" DEFAULT 'Europe/Paris'::"text" NOT NULL,
    "location" "text" DEFAULT ''::"text" NOT NULL,
    "meeting_url" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'confirmed'::"text" NOT NULL,
    "cancellation_reason" "text" DEFAULT ''::"text" NOT NULL,
    "rescheduled_from_id" "uuid",
    "calendar_event_id" "text",
    "ics_uid" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "appointments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'cancelled'::"text", 'completed'::"text", 'no_show'::"text"]))),
    CONSTRAINT "appointments_time_order" CHECK (("end_at" > "start_at"))
);


ALTER TABLE "public"."appointments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "content_type" "text" NOT NULL,
    "content_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "assignments_content_type_check" CHECK (("content_type" = ANY (ARRAY['programme'::"text", 'nutrition'::"text"])))
);


ALTER TABLE "public"."assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "stripe_customer_id" "text" NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."billing_customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stripe_event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'processing'::"text" NOT NULL,
    "processing_started_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "error_message" "text",
    "attempts_count" integer DEFAULT 0 NOT NULL,
    "last_attempt_at" timestamp with time zone,
    CONSTRAINT "billing_events_attempts_check" CHECK (("attempts_count" >= 0)),
    CONSTRAINT "billing_events_processed_at_check" CHECK ((("status" = 'processed'::"text") = ("processed_at" IS NOT NULL))),
    CONSTRAINT "billing_events_status_check" CHECK (("status" = ANY (ARRAY['processing'::"text", 'processed'::"text", 'failed'::"text", 'unknown_legacy'::"text"])))
);


ALTER TABLE "public"."billing_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."billing_events"."processed_at" IS 'Renseigné UNIQUEMENT après la réussite complète du handler (Lot W1). Ne plus utiliser comme horodatage de réception : voir created_at.';



COMMENT ON COLUMN "public"."billing_events"."status" IS 'processing | processed | failed | unknown_legacy. "unknown_legacy" = ligne antérieure au Lot W1, réussite du handler inconnue — ne déclenche aucun rejeu.';



CREATE TABLE IF NOT EXISTS "public"."body_measurements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "unit" "text" DEFAULT 'cm'::"text" NOT NULL,
    "start_value" numeric NOT NULL,
    "current_value" numeric NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "last_updated_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."body_measurements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "min_lead_minutes" integer DEFAULT 120 NOT NULL,
    "max_days_ahead" integer DEFAULT 30 NOT NULL,
    "default_duration_minutes" integer DEFAULT 60 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_settings_default_duration_minutes_check" CHECK (("default_duration_minutes" > 0)),
    CONSTRAINT "booking_settings_max_days_ahead_check" CHECK (("max_days_ahead" > 0)),
    CONSTRAINT "booking_settings_min_lead_minutes_check" CHECK (("min_lead_minutes" >= 0))
);


ALTER TABLE "public"."booking_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_availabilities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid",
    "weekday" integer NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "slot_duration_minutes" integer DEFAULT 60 NOT NULL,
    "appointment_type" "text" DEFAULT 'Autre'::"text" NOT NULL,
    "location" "text" DEFAULT ''::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "coach_availabilities_slot_duration_minutes_check" CHECK (("slot_duration_minutes" > 0)),
    CONSTRAINT "coach_availabilities_time_order" CHECK (("end_time" > "start_time")),
    CONSTRAINT "coach_availabilities_weekday_check" CHECK ((("weekday" >= 0) AND ("weekday" <= 6)))
);


ALTER TABLE "public"."coach_availabilities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."coach_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_unavailabilities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid",
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "coach_unavailabilities_time_order" CHECK (("end_at" > "start_at"))
);


ALTER TABLE "public"."coach_unavailabilities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coaches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "role" "text" DEFAULT 'admin'::"text" NOT NULL,
    "status" "text" DEFAULT 'actif'::"text" NOT NULL,
    "specialty" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "coaches_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'assistant'::"text"]))),
    CONSTRAINT "coaches_status_check" CHECK (("status" = ANY (ARRAY['actif'::"text", 'inactif'::"text"])))
);


ALTER TABLE "public"."coaches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_measurements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "unit" "text" DEFAULT 'cm'::"text" NOT NULL,
    "start_value" numeric NOT NULL,
    "current_value" numeric NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "last_updated_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."custom_measurements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "viewed_at" timestamp with time zone,
    "manually_unlocked" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "unlock_at" timestamp with time zone
);


ALTER TABLE "public"."document_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_levels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "level_number" integer NOT NULL,
    "label" "text" NOT NULL,
    "weeks_required" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."document_levels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "level" integer DEFAULT 1 NOT NULL,
    "distribution_mode" "text" DEFAULT 'disponible-immediatement'::"text" NOT NULL,
    "unlock_after_weeks" integer,
    "file_url" "text",
    "video_url" "text",
    "external_url" "text",
    "storage_path" "text",
    "status" "text" DEFAULT 'brouillon'::"text" NOT NULL,
    "important" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "full_description" "text" DEFAULT ''::"text" NOT NULL,
    "difficulty" "text" DEFAULT 'intermédiaire'::"text" NOT NULL,
    "content_text" "text" DEFAULT ''::"text" NOT NULL,
    "visibility" "text" DEFAULT 'assigned'::"text" NOT NULL,
    "unlock_at" timestamp with time zone,
    "tags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "file_name" "text",
    "file_size_bytes" bigint,
    "file_mime_type" "text",
    CONSTRAINT "documents_category_check" CHECK (("category" = ANY (ARRAY['nutrition'::"text", 'entrainement'::"text", 'administratif'::"text"]))),
    CONSTRAINT "documents_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['facile'::"text", 'intermédiaire'::"text", 'avancé'::"text"]))),
    CONSTRAINT "documents_status_check" CHECK (("status" = ANY (ARRAY['brouillon'::"text", 'publié'::"text", 'archivé'::"text"]))),
    CONSTRAINT "documents_type_check" CHECK (("type" = ANY (ARRAY['pdf'::"text", 'vidéo'::"text", 'lien'::"text", 'guide'::"text", 'image'::"text", 'texte'::"text"]))),
    CONSTRAINT "documents_visibility_check" CHECK (("visibility" = ANY (ARRAY['global'::"text", 'assigned'::"text"])))
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_email" "text" NOT NULL,
    "recipient_user_id" "uuid",
    "email_type" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "resend_email_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "related_entity_type" "text",
    "related_entity_id" "uuid",
    "error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_logs_email_type_check" CHECK (("email_type" = ANY (ARRAY['welcome'::"text", 'subscription_assigned'::"text", 'payment_succeeded'::"text", 'payment_failed'::"text", 'subscription_cancelled'::"text", 'program_assigned'::"text", 'nutrition_assigned'::"text", 'document_assigned'::"text", 'appointment_created'::"text", 'appointment_cancelled'::"text", 'appointment_reminder'::"text", 'password_reset'::"text", 'account_expiry_warning'::"text", 'coach_invite'::"text", 'collaborator_invite'::"text"]))),
    CONSTRAINT "email_logs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."email_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercise_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workout_feedback_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "exercise_id" "uuid",
    "exercise_name" "text" NOT NULL,
    "rpe" integer,
    "comment" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "exercise_order" integer,
    CONSTRAINT "exercise_feedback_rpe_check" CHECK ((("rpe" >= 1) AND ("rpe" <= 10)))
);


ALTER TABLE "public"."exercise_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercise_library" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid",
    "name" "text" NOT NULL,
    "category" "text" DEFAULT ''::"text" NOT NULL,
    "equipment" "text" DEFAULT ''::"text" NOT NULL,
    "level" "text" DEFAULT ''::"text" NOT NULL,
    "muscle_group" "text" DEFAULT ''::"text" NOT NULL,
    "video_url" "text" DEFAULT ''::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "secondary_muscles" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "exercise_type" "text" DEFAULT ''::"text" NOT NULL,
    "alternative_video_url" "text" DEFAULT ''::"text" NOT NULL,
    "technical_cues" "text" DEFAULT ''::"text" NOT NULL,
    "common_mistakes" "text" DEFAULT ''::"text" NOT NULL,
    "default_tempo" "text" DEFAULT ''::"text" NOT NULL,
    "default_rest_seconds" integer,
    "tags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    CONSTRAINT "exercise_library_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."exercise_library" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercise_set_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "exercise_feedback_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "set_number" integer NOT NULL,
    "load_used" "text" DEFAULT ''::"text" NOT NULL,
    "reps_done" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."exercise_set_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legal_consents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "consent_type" "text" NOT NULL,
    "consent_text_version" "text" NOT NULL,
    "consent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "legal_consents_consent_type_check" CHECK (("consent_type" = ANY (ARRAY['cgv_programme'::"text", 'sante_onboarding'::"text", 'retractation_programme'::"text"])))
);


ALTER TABLE "public"."legal_consents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nutrition_day_id" "uuid" NOT NULL,
    "slot" "text" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "macros" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "coach_notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."meals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."newsletter_subscribers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "normalized_email" "text" NOT NULL,
    "profile_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "source" "text" DEFAULT 'landing_page'::"text" NOT NULL,
    "consent_text_version" "text" NOT NULL,
    "consent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "confirmed_at" timestamp with time zone,
    "unsubscribed_at" timestamp with time zone,
    "brevo_contact_id" "text",
    "brevo_list_id" "text",
    "last_sync_status" "text",
    "last_sync_error" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "newsletter_subscribers_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'subscribed'::"text", 'unsubscribed'::"text", 'bounced'::"text", 'complained'::"text", 'sync_failed'::"text"])))
);


ALTER TABLE "public"."newsletter_subscribers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nutrition_daily_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "nutrition_plan_id" "uuid" NOT NULL,
    "log_date" "date" NOT NULL,
    "calories" numeric,
    "protein_g" numeric,
    "carbs_g" numeric,
    "fat_g" numeric,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."nutrition_daily_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nutrition_days" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "week_start_date" "date",
    "day" "text" NOT NULL,
    "status" "text" DEFAULT 'non-commence'::"text" NOT NULL,
    "target" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "actual" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "nutrition_days_status_check" CHECK (("status" = ANY (ARRAY['non-commence'::"text", 'en-cours'::"text", 'valide'::"text"])))
);


ALTER TABLE "public"."nutrition_days" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nutrition_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid",
    "coach_id" "uuid",
    "name" "text" NOT NULL,
    "goal_type" "text" DEFAULT 'maintien'::"text" NOT NULL,
    "daily_target" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "weekly_target_calories" numeric,
    "status" "text" DEFAULT 'prochain'::"text" NOT NULL,
    "shopping_list" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "coach_notes" "text" DEFAULT ''::"text" NOT NULL,
    "hydration_tip" "text" DEFAULT ''::"text" NOT NULL,
    "supplements" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "nutrition_plans_goal_type_check" CHECK (("goal_type" = ANY (ARRAY['perte-de-poids'::"text", 'maintien'::"text", 'prise-de-masse'::"text", 'performance'::"text"]))),
    CONSTRAINT "nutrition_plans_status_check" CHECK (("status" = ANY (ARRAY['actif'::"text", 'ancien'::"text", 'prochain'::"text"])))
);


ALTER TABLE "public"."nutrition_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "method" "text" DEFAULT 'autre'::"text" NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'terminé'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_entries_method_check" CHECK (("method" = ANY (ARRAY['virement'::"text", 'carte'::"text", 'espèces'::"text", 'chèque'::"text", 'autre'::"text"]))),
    CONSTRAINT "payment_entries_status_check" CHECK (("status" = ANY (ARRAY['à jour'::"text", 'en attente'::"text", 'en retard'::"text", 'terminé'::"text"])))
);


ALTER TABLE "public"."payment_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "offer_name" "text" DEFAULT ''::"text" NOT NULL,
    "monthly_price_euros" numeric DEFAULT 0 NOT NULL,
    "duration_months" integer DEFAULT 0 NOT NULL,
    "total_price_euros" numeric DEFAULT 0 NOT NULL,
    "paid_amount_euros" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'en attente'::"text" NOT NULL,
    "method" "text" DEFAULT 'autre'::"text" NOT NULL,
    "next_payment_date" "date",
    "installments_total" integer DEFAULT 0 NOT NULL,
    "installments_paid" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payments_method_check" CHECK (("method" = ANY (ARRAY['virement'::"text", 'carte'::"text", 'espèces'::"text", 'chèque'::"text", 'autre'::"text"]))),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['à jour'::"text", 'en attente'::"text", 'en retard'::"text", 'terminé'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "first_name" "text" DEFAULT ''::"text" NOT NULL,
    "last_name" "text" DEFAULT ''::"text" NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "phone" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'coach'::"text", 'student'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."program_weeks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid" NOT NULL,
    "week_number" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."program_weeks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."programs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid",
    "name" "text" NOT NULL,
    "goal" "text" DEFAULT ''::"text" NOT NULL,
    "level" "text" DEFAULT ''::"text" NOT NULL,
    "duration_weeks" integer DEFAULT 1 NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'brouillon'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "program_type" "text" DEFAULT 'group'::"text" NOT NULL,
    "publication_status" "text" DEFAULT 'published'::"text" NOT NULL,
    "cover_image_path" "text",
    "experience_level" integer,
    "expected_days_per_week" integer,
    "estimated_session_duration_minutes" integer,
    "source_template_id" "uuid",
    "owner_student_id" "uuid",
    "version_number" integer DEFAULT 1 NOT NULL,
    "published_at" timestamp with time zone,
    "last_updated_by" "uuid",
    "banner_url" "text",
    "program_mode" "text" DEFAULT 'individuel'::"text" NOT NULL,
    "group_start_date" "date",
    "is_public" boolean DEFAULT false NOT NULL,
    "public_subscription_template_id" "uuid",
    CONSTRAINT "programs_experience_level_check" CHECK ((("experience_level" IS NULL) OR (("experience_level" >= 1) AND ("experience_level" <= 5)))),
    CONSTRAINT "programs_program_mode_check" CHECK (("program_mode" = ANY (ARRAY['individuel'::"text", 'groupe'::"text"]))),
    CONSTRAINT "programs_program_type_check" CHECK (("program_type" = ANY (ARRAY['individual'::"text", 'group'::"text", 'fixed_duration'::"text"]))),
    CONSTRAINT "programs_publication_status_check" CHECK (("publication_status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'archived'::"text"]))),
    CONSTRAINT "programs_status_check" CHECK (("status" = ANY (ARRAY['brouillon'::"text", 'actif'::"text", 'archivé'::"text"])))
);


ALTER TABLE "public"."programs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."progress_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "weight_kg" numeric,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "image_url" "text",
    "storage_path" "text",
    "pending" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "photo_type" "text" DEFAULT 'autre'::"text" NOT NULL,
    "uploaded_by" "uuid",
    "file_name" "text",
    "file_size_bytes" bigint,
    "file_mime_type" "text",
    "is_before_candidate" boolean DEFAULT false NOT NULL,
    "is_after_candidate" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    CONSTRAINT "progress_photos_photo_type_check" CHECK (("photo_type" = ANY (ARRAY['face'::"text", 'profil'::"text", 'dos'::"text", 'autre'::"text"]))),
    CONSTRAINT "progress_photos_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text"]))),
    CONSTRAINT "progress_photos_type_check" CHECK (("type" = ANY (ARRAY['avant'::"text", 'actuelle'::"text", 'objectif'::"text", 'mensuelle'::"text"])))
);


ALTER TABLE "public"."progress_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "session_type" "text" DEFAULT 'strength'::"text" NOT NULL,
    "muscle_group" "text" DEFAULT ''::"text" NOT NULL,
    "duration_minutes" integer,
    "content" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "session_templates_session_type_check" CHECK (("session_type" = ANY (ARRAY['strength'::"text", 'cardio'::"text", 'mixed'::"text"])))
);


ALTER TABLE "public"."session_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_payment_intent_id" "text",
    "stripe_invoice_id" "text",
    "stripe_subscription_id" "text",
    "amount_cents" integer,
    "currency" "text" DEFAULT 'eur'::"text" NOT NULL,
    "status" "text" DEFAULT ''::"text" NOT NULL,
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."stripe_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "food_preferences" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sport_preferences" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "injury_note" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "main_goal" "text" DEFAULT ''::"text" NOT NULL,
    "secondary_goals" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "target_date" "date",
    "priority" "text",
    "tracked_indicators" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "age" integer,
    "height_cm" numeric,
    "current_weight_kg" numeric,
    "start_weight_kg" numeric,
    "target_weight_kg" numeric,
    "sport_level" "text",
    "training_frequency_per_week" integer,
    "training_location" "text",
    "onboarding_completed" boolean DEFAULT false NOT NULL,
    "onboarding_completed_at" timestamp with time zone,
    "target_timeframe" "text",
    "activity_level" "text",
    "neat_level" "text",
    "sports_practiced" "jsonb",
    "other_activities" "jsonb",
    "available_equipment" "jsonb",
    "favorite_exercises" "jsonb",
    "favorite_gym_exercises" "jsonb",
    "avoided_exercises" "jsonb",
    "injuries" "text",
    "training_notes" "text",
    "medical_treatments" "text",
    "medications" "text",
    "health_notes" "text",
    "hydration_level" "text",
    "daily_water_intake" "text",
    "sleep_duration" "text",
    "sleep_quality" "text",
    "recovery_notes" "text",
    "lifestyle_notes" "text",
    "motivation_source" "text",
    "recent_life_events" "text",
    "mental_wellbeing_goal" "text",
    "emotional_wellbeing_notes" "text",
    "disliked_foods" "jsonb",
    "allergies" "jsonb",
    "intolerances" "jsonb",
    "diet_type" "text",
    "preferred_meal_count" integer,
    "meal_timing_notes" "text",
    "hunger_notes" "text",
    "snacking_notes" "text",
    "work_schedule_notes" "text",
    "nutrition_notes" "text",
    "goal" "text" DEFAULT ''::"text" NOT NULL,
    "level" "text" DEFAULT ''::"text" NOT NULL,
    "billing_access_mode" "text" DEFAULT 'subscription_required'::"text" NOT NULL,
    "assigned_stripe_plan" "text",
    "assigned_stripe_price_id" "text",
    "access_note" "text" DEFAULT ''::"text" NOT NULL,
    "access_updated_at" timestamp with time zone,
    "access_updated_by" "uuid",
    "assigned_subscription_template_id" "uuid",
    "vma_kmh" numeric,
    "hr_max" integer,
    "hr_resting" integer,
    "ftp_watts" numeric,
    "reference_paces" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_fitness_test_date" "date",
    "fitness_test_protocol" "text",
    CONSTRAINT "student_profiles_billing_access_mode_check" CHECK (("billing_access_mode" = ANY (ARRAY['subscription_required'::"text", 'manual_allowed'::"text", 'manual_blocked'::"text"]))),
    CONSTRAINT "student_profiles_priority_check" CHECK (("priority" = ANY (ARRAY['haute'::"text", 'moyenne'::"text", 'basse'::"text"])))
);


ALTER TABLE "public"."student_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."student_profiles"."vma_kmh" IS 'Vitesse Maximale Aérobie (km/h), déclarée par le coach ou l''élève. Source des conversions vitesse/allure/%VMA (V3 cardio).';



COMMENT ON COLUMN "public"."student_profiles"."reference_paces" IS 'Allures de référence libres (ex: {"10km": "4:30", "semi": "4:50"}), jsonb pour rester extensible sans migration ultérieure.';



CREATE TABLE IF NOT EXISTS "public"."students" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "coach_id" "uuid",
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "phone" "text" DEFAULT ''::"text",
    "status" "text" DEFAULT 'actif'::"text" NOT NULL,
    "start_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "last_login_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "access_type" "text" DEFAULT 'coaching'::"text" NOT NULL,
    "deletion_warning_sent_at" timestamp with time zone,
    CONSTRAINT "students_access_type_check" CHECK (("access_type" = ANY (ARRAY['coaching'::"text", 'programme_seul'::"text"]))),
    CONSTRAINT "students_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."students" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscription_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "amount_cents" integer NOT NULL,
    "currency" "text" DEFAULT 'eur'::"text" NOT NULL,
    "billing_interval" "text" DEFAULT 'monthly'::"text" NOT NULL,
    "duration_months" integer,
    "stripe_product_id" "text",
    "stripe_price_id" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "subscription_templates_amount_cents_check" CHECK (("amount_cents" >= 0)),
    CONSTRAINT "subscription_templates_billing_interval_check" CHECK (("billing_interval" = ANY (ARRAY['monthly'::"text", 'quarterly'::"text", 'yearly'::"text", 'one_time'::"text"])))
);


ALTER TABLE "public"."subscription_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text" NOT NULL,
    "stripe_price_id" "text",
    "stripe_product_id" "text",
    "plan_name" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'incomplete'::"text" NOT NULL,
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "cancelled_at" timestamp with time zone,
    "amount_cents" integer,
    "currency" "text" DEFAULT 'eur'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "block_type" "text" DEFAULT 'standard'::"text" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "scoring_type" "text",
    "color_key" "text" DEFAULT 'gray'::"text" NOT NULL,
    "rounds" integer,
    "time_cap_seconds" integer,
    "duration_seconds" integer,
    "work_seconds" integer,
    "rest_seconds" integer,
    "rest_between_rounds_seconds" integer,
    "emom_minutes" integer,
    "position" integer DEFAULT 1 NOT NULL,
    "media_path" "text",
    "version_number" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cardio_type" "text",
    "machine_type" "text",
    CONSTRAINT "training_blocks_block_type_check" CHECK (("block_type" = ANY (ARRAY['standard'::"text", 'warmup'::"text", 'strength'::"text", 'superset'::"text", 'tri_set'::"text", 'giant_set'::"text", 'circuit'::"text", 'emom'::"text", 'amrap'::"text", 'interval'::"text", 'cooldown'::"text", 'benchmark'::"text", 'custom'::"text", 'cardio'::"text"]))),
    CONSTRAINT "training_blocks_cardio_type_check" CHECK ((("cardio_type" IS NULL) OR ("cardio_type" = ANY (ARRAY['continuous_run'::"text", 'easy_run'::"text", 'long_run'::"text", 'tempo_run'::"text", 'threshold_intervals'::"text", 'vma_intervals'::"text", 'short_intervals'::"text", 'long_intervals'::"text", 'fartlek'::"text", 'hill_repeats'::"text", 'sprint_repeats'::"text", 'run_walk'::"text", 'warmup_run'::"text", 'cooldown_run'::"text", 'race_pace'::"text", 'time_trial'::"text", 'vma_test'::"text", 'luc_leger'::"text", 'hyrox_run'::"text", 'cardio_machine'::"text", 'custom_cardio'::"text"])))),
    CONSTRAINT "training_blocks_color_key_check" CHECK (("color_key" = ANY (ARRAY['gray'::"text", 'red'::"text", 'orange'::"text", 'yellow'::"text", 'green'::"text", 'blue'::"text", 'purple'::"text"]))),
    CONSTRAINT "training_blocks_machine_type_check" CHECK ((("machine_type" IS NULL) OR ("machine_type" = ANY (ARRAY['treadmill'::"text", 'bike'::"text", 'rower'::"text", 'skierg'::"text", 'elliptical'::"text", 'air_bike'::"text", 'stepper'::"text", 'other'::"text"]))))
);


ALTER TABLE "public"."training_blocks" OWNER TO "postgres";


COMMENT ON COLUMN "public"."training_blocks"."cardio_type" IS 'Type de séance cardio/course (rempli uniquement si block_type=cardio). NULL pour tous les blocs existants.';



COMMENT ON COLUMN "public"."training_blocks"."machine_type" IS 'Machine utilisée si cardio_type=cardio_machine. NULL sinon.';



CREATE TABLE IF NOT EXISTS "public"."training_change_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "student_id" "uuid",
    "actor_id" "uuid",
    "actor_role" "text",
    "action_type" "text" NOT NULL,
    "before_data" "jsonb",
    "after_data" "jsonb",
    "version_number" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."training_change_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_prescriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "exercise_id" "uuid",
    "set_number" integer NOT NULL,
    "set_type" "text" DEFAULT 'normal'::"text" NOT NULL,
    "target_reps" integer,
    "reps_min" integer,
    "reps_max" integer,
    "duration_seconds" integer,
    "distance_meters" numeric,
    "target_load" numeric,
    "load_unit" "text" DEFAULT 'kg'::"text" NOT NULL,
    "load_input_mode" "text" DEFAULT 'total'::"text" NOT NULL,
    "target_percentage" numeric,
    "target_rpe" numeric,
    "target_rir" numeric,
    "bodyweight_percentage" numeric,
    "tempo_eccentric" "text",
    "tempo_bottom_pause" "text",
    "tempo_concentric" "text",
    "tempo_top_pause" "text",
    "rest_seconds" integer,
    "coach_notes" "text" DEFAULT ''::"text" NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "block_id" "uuid",
    "parent_prescription_id" "uuid",
    "segment_type" "text",
    "title" "text",
    "elevation_gain_meters" numeric,
    "repetitions" integer,
    "work_duration_seconds" integer,
    "recovery_duration_seconds" integer,
    "recovery_distance_meters" numeric,
    "set_recovery_seconds" integer,
    "intensity_target_type" "text",
    "target_vma_percentage" numeric,
    "target_speed_kmh" numeric,
    "target_pace_seconds_per_km" integer,
    "target_hr_percentage" numeric,
    "target_hr_zone" "text",
    "target_power_watts" numeric,
    "target_cadence" numeric,
    "incline_percentage" numeric,
    "intensity_min" numeric,
    "intensity_max" numeric,
    "surface" "text",
    "terrain" "text",
    "equipment_type" "text",
    "data_source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "external_activity_id" "text",
    "imported_at" timestamp with time zone,
    "raw_summary" "jsonb",
    CONSTRAINT "training_prescriptions_data_source_check" CHECK (("data_source" = ANY (ARRAY['manual'::"text", 'garmin'::"text", 'apple_health'::"text", 'strava'::"text", 'coros'::"text", 'polar'::"text", 'other'::"text"]))),
    CONSTRAINT "training_prescriptions_exercise_or_block_check" CHECK ((("exercise_id" IS NOT NULL) OR ("block_id" IS NOT NULL))),
    CONSTRAINT "training_prescriptions_intensity_target_type_check" CHECK ((("intensity_target_type" IS NULL) OR ("intensity_target_type" = ANY (ARRAY['vma_percentage'::"text", 'speed_kmh'::"text", 'pace'::"text", 'heart_rate_zone'::"text", 'heart_rate_percentage'::"text", 'rpe'::"text", 'power'::"text", 'race_pace'::"text", 'free'::"text", 'custom'::"text"])))),
    CONSTRAINT "training_prescriptions_load_input_mode_check" CHECK (("load_input_mode" = ANY (ARRAY['total'::"text", 'per_side'::"text", 'per_implement'::"text"]))),
    CONSTRAINT "training_prescriptions_load_unit_check" CHECK (("load_unit" = ANY (ARRAY['kg'::"text", 'lb'::"text"]))),
    CONSTRAINT "training_prescriptions_segment_type_check" CHECK ((("segment_type" IS NULL) OR ("segment_type" = ANY (ARRAY['single'::"text", 'repeat_group'::"text", 'work'::"text", 'recovery'::"text", 'ramp_up'::"text", 'ramp_down'::"text"])))),
    CONSTRAINT "training_prescriptions_set_type_check" CHECK (("set_type" = ANY (ARRAY['normal'::"text", 'warmup'::"text", 'top_set'::"text", 'back_off'::"text", 'failure'::"text", 'optional'::"text"]))),
    CONSTRAINT "training_prescriptions_target_rir_check" CHECK ((("target_rir" IS NULL) OR (("target_rir" >= (0)::numeric) AND ("target_rir" <= (10)::numeric)))),
    CONSTRAINT "training_prescriptions_target_rpe_check" CHECK ((("target_rpe" IS NULL) OR (("target_rpe" >= (0)::numeric) AND ("target_rpe" <= (10)::numeric))))
);


ALTER TABLE "public"."training_prescriptions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."training_prescriptions"."block_id" IS 'V3 cardio : rattachement direct à un bloc (segment cardio), alternative à exercise_id. NULL pour toutes les prescriptions musculation existantes.';



COMMENT ON COLUMN "public"."training_prescriptions"."parent_prescription_id" IS 'V3 cardio : segment parent (ex: groupe de répétitions 8×400m). NULL = segment de premier niveau.';



COMMENT ON COLUMN "public"."training_prescriptions"."data_source" IS 'Origine de la donnée (prep future import montre — aucune intégration Garmin/Apple Watch/Strava développée dans cette branche). Défaut manual = comportement actuel inchangé.';



CREATE TABLE IF NOT EXISTS "public"."weight_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "weight_kg" numeric NOT NULL,
    "recorded_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "source" "text" DEFAULT 'migration'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "weight_entries_source_check" CHECK (("source" = ANY (ARRAY['initial'::"text", 'student_update'::"text", 'coach_update'::"text", 'migration'::"text"])))
);


ALTER TABLE "public"."weight_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "order_index" integer DEFAULT 1 NOT NULL,
    "name" "text" NOT NULL,
    "sets" integer DEFAULT 0 NOT NULL,
    "reps" "text" DEFAULT ''::"text" NOT NULL,
    "rest_seconds" integer DEFAULT 0 NOT NULL,
    "tempo" "text" DEFAULT ''::"text" NOT NULL,
    "recommended_load" "text" DEFAULT ''::"text" NOT NULL,
    "video_url" "text" DEFAULT ''::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "muscle_group" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "exercise_library_id" "uuid",
    "block_id" "uuid",
    "superset_label" "text"
);


ALTER TABLE "public"."workout_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "session_id" "uuid",
    "program_id" "uuid",
    "completed" boolean DEFAULT false NOT NULL,
    "global_rpe" integer,
    "global_comment" "text" DEFAULT ''::"text" NOT NULL,
    "pain" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'a-traiter'::"text" NOT NULL,
    "coach_reply" "text" DEFAULT ''::"text" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_key" "text",
    "session_ref_label" "text",
    CONSTRAINT "workout_feedback_global_rpe_check" CHECK ((("global_rpe" >= 1) AND ("global_rpe" <= 10))),
    CONSTRAINT "workout_feedback_status_check" CHECK (("status" = ANY (ARRAY['a-traiter'::"text", 'traité'::"text", 'important'::"text"])))
);


ALTER TABLE "public"."workout_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid" NOT NULL,
    "program_week_id" "uuid" NOT NULL,
    "day" "text" NOT NULL,
    "is_rest_day" boolean DEFAULT false NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "muscle_group" "text" DEFAULT ''::"text" NOT NULL,
    "duration_minutes" integer,
    "warmup" "text" DEFAULT ''::"text" NOT NULL,
    "coach_notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_type" "text" DEFAULT 'strength'::"text" NOT NULL,
    "banner_url" "text",
    CONSTRAINT "workout_sessions_session_type_check" CHECK (("session_type" = ANY (ARRAY['strength'::"text", 'cardio'::"text", 'mixed'::"text"])))
);


ALTER TABLE "public"."workout_sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."workout_sessions"."session_type" IS 'Discriminant V3 : strength (défaut, comportement historique inchangé), cardio, ou mixed. Ne modifie aucune séance existante (défaut strength).';



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointment_email_logs"
    ADD CONSTRAINT "appointment_email_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_student_id_content_type_content_id_key" UNIQUE ("student_id", "content_type", "content_id");



ALTER TABLE ONLY "public"."billing_customers"
    ADD CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_customers"
    ADD CONSTRAINT "billing_customers_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."billing_customers"
    ADD CONSTRAINT "billing_customers_student_id_key" UNIQUE ("student_id");



ALTER TABLE ONLY "public"."billing_events"
    ADD CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_events"
    ADD CONSTRAINT "billing_events_stripe_event_id_key" UNIQUE ("stripe_event_id");



ALTER TABLE ONLY "public"."body_measurements"
    ADD CONSTRAINT "body_measurements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."body_measurements"
    ADD CONSTRAINT "body_measurements_student_id_type_key" UNIQUE ("student_id", "type");



ALTER TABLE ONLY "public"."booking_settings"
    ADD CONSTRAINT "booking_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_availabilities"
    ADD CONSTRAINT "coach_availabilities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_notes"
    ADD CONSTRAINT "coach_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_unavailabilities"
    ADD CONSTRAINT "coach_unavailabilities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coaches"
    ADD CONSTRAINT "coaches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_measurements"
    ADD CONSTRAINT "custom_measurements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_assignments"
    ADD CONSTRAINT "document_assignments_document_id_student_id_key" UNIQUE ("document_id", "student_id");



ALTER TABLE ONLY "public"."document_assignments"
    ADD CONSTRAINT "document_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_levels"
    ADD CONSTRAINT "document_levels_level_number_key" UNIQUE ("level_number");



ALTER TABLE ONLY "public"."document_levels"
    ADD CONSTRAINT "document_levels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_logs"
    ADD CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercise_feedback"
    ADD CONSTRAINT "exercise_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercise_library"
    ADD CONSTRAINT "exercise_library_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercise_set_feedback"
    ADD CONSTRAINT "exercise_set_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legal_consents"
    ADD CONSTRAINT "legal_consents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meals"
    ADD CONSTRAINT "meals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."newsletter_subscribers"
    ADD CONSTRAINT "newsletter_subscribers_normalized_email_key" UNIQUE ("normalized_email");



ALTER TABLE ONLY "public"."newsletter_subscribers"
    ADD CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nutrition_daily_logs"
    ADD CONSTRAINT "nutrition_daily_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nutrition_daily_logs"
    ADD CONSTRAINT "nutrition_daily_logs_student_id_nutrition_plan_id_log_date_key" UNIQUE ("student_id", "nutrition_plan_id", "log_date");



ALTER TABLE ONLY "public"."nutrition_days"
    ADD CONSTRAINT "nutrition_days_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nutrition_plans"
    ADD CONSTRAINT "nutrition_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_entries"
    ADD CONSTRAINT "payment_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_student_id_key" UNIQUE ("student_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."program_weeks"
    ADD CONSTRAINT "program_weeks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."program_weeks"
    ADD CONSTRAINT "program_weeks_program_id_week_number_key" UNIQUE ("program_id", "week_number");



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."progress_photos"
    ADD CONSTRAINT "progress_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_templates"
    ADD CONSTRAINT "session_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_payments"
    ADD CONSTRAINT "stripe_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_profiles"
    ADD CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_profiles"
    ADD CONSTRAINT "student_profiles_student_id_key" UNIQUE ("student_id");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_email_unique" UNIQUE ("email");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_templates"
    ADD CONSTRAINT "subscription_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_templates"
    ADD CONSTRAINT "subscription_templates_stripe_price_id_key" UNIQUE ("stripe_price_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."training_blocks"
    ADD CONSTRAINT "training_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_change_history"
    ADD CONSTRAINT "training_change_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_prescriptions"
    ADD CONSTRAINT "training_prescriptions_exercise_id_set_number_key" UNIQUE ("exercise_id", "set_number");



ALTER TABLE ONLY "public"."training_prescriptions"
    ADD CONSTRAINT "training_prescriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weight_entries"
    ADD CONSTRAINT "weight_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_exercises"
    ADD CONSTRAINT "workout_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_feedback"
    ADD CONSTRAINT "workout_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_sessions"
    ADD CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id");



CREATE INDEX "activity_events_created_at_idx" ON "public"."activity_events" USING "btree" ("created_at" DESC);



CREATE INDEX "activity_events_is_read_idx" ON "public"."activity_events" USING "btree" ("is_read");



CREATE INDEX "activity_events_student_id_idx" ON "public"."activity_events" USING "btree" ("student_id");



CREATE INDEX "appointments_start_at_idx" ON "public"."appointments" USING "btree" ("start_at");



CREATE INDEX "appointments_student_id_idx" ON "public"."appointments" USING "btree" ("student_id");



CREATE INDEX "billing_customers_student_id_idx" ON "public"."billing_customers" USING "btree" ("student_id");



CREATE INDEX "billing_events_processing_started_idx" ON "public"."billing_events" USING "btree" ("processing_started_at") WHERE ("status" = 'processing'::"text");



CREATE INDEX "billing_events_status_idx" ON "public"."billing_events" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['processing'::"text", 'failed'::"text"]));



CREATE INDEX "email_logs_created_at_idx" ON "public"."email_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "email_logs_email_type_idx" ON "public"."email_logs" USING "btree" ("email_type");



CREATE INDEX "email_logs_recipient_email_idx" ON "public"."email_logs" USING "btree" ("recipient_email");



CREATE INDEX "email_logs_recipient_user_id_idx" ON "public"."email_logs" USING "btree" ("recipient_user_id");



CREATE INDEX "email_logs_related_entity_idx" ON "public"."email_logs" USING "btree" ("related_entity_type", "related_entity_id");



CREATE INDEX "email_logs_status_idx" ON "public"."email_logs" USING "btree" ("status");



CREATE INDEX "idx_training_prescriptions_block_id" ON "public"."training_prescriptions" USING "btree" ("block_id");



CREATE INDEX "idx_training_prescriptions_parent" ON "public"."training_prescriptions" USING "btree" ("parent_prescription_id");



CREATE UNIQUE INDEX "legal_consents_program_checkout_unique_idx" ON "public"."legal_consents" USING "btree" ("consent_type", (("metadata" ->> 'checkout_session_id'::"text"))) WHERE ((("metadata" ->> 'checkout_session_id'::"text") IS NOT NULL) AND ("consent_type" = ANY (ARRAY['cgv_programme'::"text", 'retractation_programme'::"text"])));



CREATE INDEX "legal_consents_student_id_idx" ON "public"."legal_consents" USING "btree" ("student_id");



CREATE INDEX "newsletter_subscribers_profile_id_idx" ON "public"."newsletter_subscribers" USING "btree" ("profile_id");



CREATE INDEX "newsletter_subscribers_status_idx" ON "public"."newsletter_subscribers" USING "btree" ("status");



CREATE UNIQUE INDEX "stripe_payments_invoice_id_idx" ON "public"."stripe_payments" USING "btree" ("stripe_invoice_id") WHERE ("stripe_invoice_id" IS NOT NULL);



CREATE INDEX "stripe_payments_student_id_idx" ON "public"."stripe_payments" USING "btree" ("student_id");



CREATE INDEX "subscription_templates_is_active_idx" ON "public"."subscription_templates" USING "btree" ("is_active");



CREATE INDEX "subscriptions_status_idx" ON "public"."subscriptions" USING "btree" ("status");



CREATE INDEX "subscriptions_student_id_idx" ON "public"."subscriptions" USING "btree" ("student_id");



CREATE INDEX "training_blocks_session_id_idx" ON "public"."training_blocks" USING "btree" ("session_id");



CREATE INDEX "training_change_history_created_at_idx" ON "public"."training_change_history" USING "btree" ("created_at" DESC);



CREATE INDEX "training_change_history_program_id_idx" ON "public"."training_change_history" USING "btree" ("program_id");



CREATE INDEX "training_prescriptions_exercise_id_idx" ON "public"."training_prescriptions" USING "btree" ("exercise_id");



CREATE INDEX "weight_entries_recorded_at_idx" ON "public"."weight_entries" USING "btree" ("recorded_at");



CREATE INDEX "weight_entries_student_id_idx" ON "public"."weight_entries" USING "btree" ("student_id");



CREATE INDEX "workout_exercises_block_id_idx" ON "public"."workout_exercises" USING "btree" ("block_id");



CREATE OR REPLACE TRIGGER "protect_access_columns" BEFORE UPDATE ON "public"."student_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."protect_student_profiles_access_columns"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."assignments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."billing_customers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."body_measurements" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."booking_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."coach_availabilities" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."coach_notes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."coach_unavailabilities" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."coaches" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."custom_measurements" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."document_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."document_levels" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."documents" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."exercise_feedback" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."exercise_library" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."exercise_set_feedback" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."meals" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."nutrition_daily_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."nutrition_days" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."nutrition_plans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."payment_entries" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."program_weeks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."programs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."progress_photos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."stripe_payments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."student_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."subscription_templates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."training_blocks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."training_prescriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."weight_entries" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."workout_exercises" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."workout_feedback" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."workout_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_email_logs"
    ADD CONSTRAINT "appointment_email_logs_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_rescheduled_from_id_fkey" FOREIGN KEY ("rescheduled_from_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_customers"
    ADD CONSTRAINT "billing_customers_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."body_measurements"
    ADD CONSTRAINT "body_measurements_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_availabilities"
    ADD CONSTRAINT "coach_availabilities_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coach_notes"
    ADD CONSTRAINT "coach_notes_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coach_notes"
    ADD CONSTRAINT "coach_notes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_unavailabilities"
    ADD CONSTRAINT "coach_unavailabilities_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coaches"
    ADD CONSTRAINT "coaches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."custom_measurements"
    ADD CONSTRAINT "custom_measurements_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_assignments"
    ADD CONSTRAINT "document_assignments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_assignments"
    ADD CONSTRAINT "document_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."email_logs"
    ADD CONSTRAINT "email_logs_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."exercise_feedback"
    ADD CONSTRAINT "exercise_feedback_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."workout_exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."exercise_feedback"
    ADD CONSTRAINT "exercise_feedback_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_feedback"
    ADD CONSTRAINT "exercise_feedback_workout_feedback_id_fkey" FOREIGN KEY ("workout_feedback_id") REFERENCES "public"."workout_feedback"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_library"
    ADD CONSTRAINT "exercise_library_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."exercise_set_feedback"
    ADD CONSTRAINT "exercise_set_feedback_exercise_feedback_id_fkey" FOREIGN KEY ("exercise_feedback_id") REFERENCES "public"."exercise_feedback"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_set_feedback"
    ADD CONSTRAINT "exercise_set_feedback_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."legal_consents"
    ADD CONSTRAINT "legal_consents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meals"
    ADD CONSTRAINT "meals_nutrition_day_id_fkey" FOREIGN KEY ("nutrition_day_id") REFERENCES "public"."nutrition_days"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."newsletter_subscribers"
    ADD CONSTRAINT "newsletter_subscribers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."nutrition_daily_logs"
    ADD CONSTRAINT "nutrition_daily_logs_nutrition_plan_id_fkey" FOREIGN KEY ("nutrition_plan_id") REFERENCES "public"."nutrition_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nutrition_daily_logs"
    ADD CONSTRAINT "nutrition_daily_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nutrition_days"
    ADD CONSTRAINT "nutrition_days_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."nutrition_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nutrition_plans"
    ADD CONSTRAINT "nutrition_plans_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."nutrition_plans"
    ADD CONSTRAINT "nutrition_plans_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_entries"
    ADD CONSTRAINT "payment_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_entries"
    ADD CONSTRAINT "payment_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."program_weeks"
    ADD CONSTRAINT "program_weeks_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_last_updated_by_fkey" FOREIGN KEY ("last_updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_owner_student_id_fkey" FOREIGN KEY ("owner_student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_public_subscription_template_id_fkey" FOREIGN KEY ("public_subscription_template_id") REFERENCES "public"."subscription_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "public"."programs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."progress_photos"
    ADD CONSTRAINT "progress_photos_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_templates"
    ADD CONSTRAINT "session_templates_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stripe_payments"
    ADD CONSTRAINT "stripe_payments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_profiles"
    ADD CONSTRAINT "student_profiles_access_updated_by_fkey" FOREIGN KEY ("access_updated_by") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_profiles"
    ADD CONSTRAINT "student_profiles_assigned_subscription_template_id_fkey" FOREIGN KEY ("assigned_subscription_template_id") REFERENCES "public"."subscription_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_profiles"
    ADD CONSTRAINT "student_profiles_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subscription_templates"
    ADD CONSTRAINT "subscription_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."coaches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_blocks"
    ADD CONSTRAINT "training_blocks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_change_history"
    ADD CONSTRAINT "training_change_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_change_history"
    ADD CONSTRAINT "training_change_history_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_change_history"
    ADD CONSTRAINT "training_change_history_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_prescriptions"
    ADD CONSTRAINT "training_prescriptions_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "public"."training_blocks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_prescriptions"
    ADD CONSTRAINT "training_prescriptions_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."workout_exercises"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_prescriptions"
    ADD CONSTRAINT "training_prescriptions_parent_prescription_id_fkey" FOREIGN KEY ("parent_prescription_id") REFERENCES "public"."training_prescriptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weight_entries"
    ADD CONSTRAINT "weight_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_exercises"
    ADD CONSTRAINT "workout_exercises_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "public"."training_blocks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_exercises"
    ADD CONSTRAINT "workout_exercises_exercise_library_id_fkey" FOREIGN KEY ("exercise_library_id") REFERENCES "public"."exercise_library"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workout_exercises"
    ADD CONSTRAINT "workout_exercises_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_feedback"
    ADD CONSTRAINT "workout_feedback_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workout_feedback"
    ADD CONSTRAINT "workout_feedback_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workout_feedback"
    ADD CONSTRAINT "workout_feedback_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_sessions"
    ADD CONSTRAINT "workout_sessions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_sessions"
    ADD CONSTRAINT "workout_sessions_program_week_id_fkey" FOREIGN KEY ("program_week_id") REFERENCES "public"."program_weeks"("id") ON DELETE CASCADE;



CREATE POLICY "Admin and coach can insert weight entries" ON "public"."weight_entries" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"]))))));



CREATE POLICY "Admin and coach can read student profiles" ON "public"."student_profiles" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"]))))));



CREATE POLICY "Admin and coach can read students" ON "public"."students" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"]))))));



CREATE POLICY "Admin and coach can read weight entries" ON "public"."weight_entries" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"]))))));



CREATE POLICY "Admin and coach can update student profiles" ON "public"."student_profiles" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"]))))));



CREATE POLICY "Admin and coach can update students" ON "public"."students" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"]))))));



CREATE POLICY "Admin and coach can update weight entries" ON "public"."weight_entries" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"]))))));



CREATE POLICY "Students can insert own weight entries" ON "public"."weight_entries" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."students" "s"
  WHERE (("s"."id" = "weight_entries"."student_id") AND ("s"."user_id" = "auth"."uid"())))));



CREATE POLICY "Students can read own student profile" ON "public"."student_profiles" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."students" "s"
  WHERE (("s"."id" = "student_profiles"."student_id") AND ("s"."user_id" = "auth"."uid"())))));



CREATE POLICY "Students can read own student row" ON "public"."students" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Students can read own weight entries" ON "public"."weight_entries" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."students" "s"
  WHERE (("s"."id" = "weight_entries"."student_id") AND ("s"."user_id" = "auth"."uid"())))));



CREATE POLICY "Students can update own student profile" ON "public"."student_profiles" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."students" "s"
  WHERE (("s"."id" = "student_profiles"."student_id") AND ("s"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."students" "s"
  WHERE (("s"."id" = "student_profiles"."student_id") AND ("s"."user_id" = "auth"."uid"())))));



CREATE POLICY "Students can update own weight entries" ON "public"."weight_entries" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."students" "s"
  WHERE (("s"."id" = "weight_entries"."student_id") AND ("s"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."students" "s"
  WHERE (("s"."id" = "weight_entries"."student_id") AND ("s"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."activity_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_events_insert_own_student" ON "public"."activity_events" FOR INSERT WITH CHECK (("student_id" = "public"."current_student_id"()));



CREATE POLICY "activity_events_manage_staff" ON "public"."activity_events" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "activity_events_staff_delete" ON "public"."activity_events" FOR DELETE USING ("public"."is_coach_or_admin"());



CREATE POLICY "activity_events_staff_insert" ON "public"."activity_events" FOR INSERT WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "activity_events_staff_select" ON "public"."activity_events" FOR SELECT USING ("public"."is_coach_or_admin"());



CREATE POLICY "activity_events_staff_update" ON "public"."activity_events" FOR UPDATE USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "activity_events_student_insert_own" ON "public"."activity_events" FOR INSERT WITH CHECK (("student_id" IN ( SELECT "s"."id"
   FROM "public"."students" "s"
  WHERE ("s"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."appointment_email_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appointment_email_logs_manage_staff" ON "public"."appointment_email_logs" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appointments_insert_own_student" ON "public"."appointments" FOR INSERT WITH CHECK (("student_id" = "public"."current_student_id"()));



CREATE POLICY "appointments_manage_staff" ON "public"."appointments" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "appointments_select_own_student" ON "public"."appointments" FOR SELECT USING (("student_id" = "public"."current_student_id"()));



CREATE POLICY "appointments_update_own_student" ON "public"."appointments" FOR UPDATE USING (("student_id" = "public"."current_student_id"())) WITH CHECK (("student_id" = "public"."current_student_id"()));



ALTER TABLE "public"."assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assignments_manage_staff" ON "public"."assignments" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "assignments_select_self_or_staff" ON "public"."assignments" FOR SELECT USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."billing_customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_customers_manage_staff" ON "public"."billing_customers" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "billing_customers_select_own_student" ON "public"."billing_customers" FOR SELECT USING (("student_id" = "public"."current_student_id"()));



ALTER TABLE "public"."billing_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_events_manage_staff" ON "public"."billing_events" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



ALTER TABLE "public"."body_measurements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "body_measurements_student_or_staff" ON "public"."body_measurements" USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"())) WITH CHECK ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."booking_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "booking_settings_manage_staff" ON "public"."booking_settings" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "booking_settings_select_authenticated" ON "public"."booking_settings" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."coach_availabilities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coach_availabilities_manage_staff" ON "public"."coach_availabilities" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "coach_availabilities_select_authenticated" ON "public"."coach_availabilities" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."coach_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coach_notes_staff_only" ON "public"."coach_notes" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



ALTER TABLE "public"."coach_unavailabilities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coach_unavailabilities_manage_staff" ON "public"."coach_unavailabilities" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "coach_unavailabilities_select_authenticated" ON "public"."coach_unavailabilities" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."coaches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coaches_manage_admin" ON "public"."coaches" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "coaches_select_authenticated" ON "public"."coaches" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."custom_measurements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "custom_measurements_student_or_staff" ON "public"."custom_measurements" USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"())) WITH CHECK ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."document_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "document_assignments_delete_staff" ON "public"."document_assignments" FOR DELETE USING ("public"."is_coach_or_admin"());



CREATE POLICY "document_assignments_manage_staff" ON "public"."document_assignments" FOR INSERT WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "document_assignments_select_self_or_staff" ON "public"."document_assignments" FOR SELECT USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



CREATE POLICY "document_assignments_update_self_or_staff" ON "public"."document_assignments" FOR UPDATE USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"())) WITH CHECK ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."document_levels" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "document_levels_manage_staff" ON "public"."document_levels" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "document_levels_select_authenticated" ON "public"."document_levels" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "documents_manage_staff" ON "public"."documents" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "documents_select_global_or_assigned" ON "public"."documents" FOR SELECT USING ((("status" = 'publié'::"text") AND (("visibility" = 'global'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."document_assignments" "da"
  WHERE (("da"."document_id" = "documents"."id") AND ("da"."student_id" = "public"."current_student_id"())))))));



ALTER TABLE "public"."email_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_logs_select_staff" ON "public"."email_logs" FOR SELECT USING ("public"."is_coach_or_admin"());



ALTER TABLE "public"."exercise_feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "exercise_feedback_student_or_staff" ON "public"."exercise_feedback" USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"())) WITH CHECK ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."exercise_library" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "exercise_library_manage_staff" ON "public"."exercise_library" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "exercise_library_select_active" ON "public"."exercise_library" FOR SELECT USING (("status" = 'active'::"text"));



ALTER TABLE "public"."exercise_set_feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "exercise_set_feedback_student_or_staff" ON "public"."exercise_set_feedback" USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"())) WITH CHECK ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."legal_consents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "legal_consents_insert_own_health_or_staff" ON "public"."legal_consents" FOR INSERT WITH CHECK (((("student_id" = "public"."current_student_id"()) AND ("consent_type" = 'sante_onboarding'::"text")) OR "public"."is_coach_or_admin"()));



CREATE POLICY "legal_consents_select_self_or_staff" ON "public"."legal_consents" FOR SELECT USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."meals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "meals_manage_staff" ON "public"."meals" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "meals_select_self_or_assigned" ON "public"."meals" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."nutrition_days" "d"
     JOIN "public"."nutrition_plans" "p" ON (("p"."id" = "d"."plan_id")))
  WHERE (("d"."id" = "meals"."nutrition_day_id") AND ("p"."student_id" = "public"."current_student_id"())))));



ALTER TABLE "public"."newsletter_subscribers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "newsletter_subscribers_delete_staff" ON "public"."newsletter_subscribers" FOR DELETE USING ("public"."is_coach_or_admin"());



CREATE POLICY "newsletter_subscribers_select_staff" ON "public"."newsletter_subscribers" FOR SELECT USING ("public"."is_coach_or_admin"());



CREATE POLICY "newsletter_subscribers_update_staff" ON "public"."newsletter_subscribers" FOR UPDATE USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



ALTER TABLE "public"."nutrition_daily_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "nutrition_daily_logs_student_or_staff" ON "public"."nutrition_daily_logs" USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"())) WITH CHECK ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."nutrition_days" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "nutrition_days_manage_staff" ON "public"."nutrition_days" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "nutrition_days_select_self_or_assigned" ON "public"."nutrition_days" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."nutrition_plans" "p"
  WHERE (("p"."id" = "nutrition_days"."plan_id") AND ("p"."student_id" = "public"."current_student_id"())))));



CREATE POLICY "nutrition_days_update_self" ON "public"."nutrition_days" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."nutrition_plans" "p"
  WHERE (("p"."id" = "nutrition_days"."plan_id") AND ("p"."student_id" = "public"."current_student_id"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."nutrition_plans" "p"
  WHERE (("p"."id" = "nutrition_days"."plan_id") AND ("p"."student_id" = "public"."current_student_id"())))));



ALTER TABLE "public"."nutrition_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "nutrition_plans_manage_staff" ON "public"."nutrition_plans" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "nutrition_plans_select_self_or_assigned" ON "public"."nutrition_plans" FOR SELECT USING (("student_id" = "public"."current_student_id"()));



ALTER TABLE "public"."payment_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payment_entries_manage_staff" ON "public"."payment_entries" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "payment_entries_select_self_or_staff" ON "public"."payment_entries" FOR SELECT USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payments_delete_staff" ON "public"."payments" FOR DELETE USING ("public"."is_coach_or_admin"());



CREATE POLICY "payments_manage_staff" ON "public"."payments" FOR INSERT WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "payments_select_self_or_staff" ON "public"."payments" FOR SELECT USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



CREATE POLICY "payments_update_staff" ON "public"."payments" FOR UPDATE USING ("public"."is_coach_or_admin"());



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_self_or_admin" ON "public"."profiles" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_coach_or_admin"()));



CREATE POLICY "profiles_select_authenticated" ON "public"."profiles" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "profiles_select_self_or_staff" ON "public"."profiles" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("role" = ANY (ARRAY['coach'::"text", 'admin'::"text"])) OR "public"."is_coach_or_admin"()));



CREATE POLICY "profiles_update_self_or_admin" ON "public"."profiles" FOR UPDATE USING ((("user_id" = "auth"."uid"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."program_weeks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "program_weeks_manage_staff" ON "public"."program_weeks" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "program_weeks_select_assigned_student" ON "public"."program_weeks" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."assignments" "a"
     JOIN "public"."programs" "p" ON (("p"."id" = "a"."content_id")))
  WHERE (("a"."content_type" = 'programme'::"text") AND ("a"."content_id" = "program_weeks"."program_id") AND ("a"."student_id" = "public"."current_student_id"()) AND ("p"."publication_status" = 'published'::"text")))));



ALTER TABLE "public"."programs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "programs_manage_staff" ON "public"."programs" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "programs_select_assigned_student" ON "public"."programs" FOR SELECT USING ((("publication_status" = 'published'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."assignments" "a"
  WHERE (("a"."content_type" = 'programme'::"text") AND ("a"."content_id" = "programs"."id") AND ("a"."student_id" = "public"."current_student_id"()))))));



CREATE POLICY "programs_select_public" ON "public"."programs" FOR SELECT TO "anon" USING ((("is_public" = true) AND ("status" = 'actif'::"text")));



ALTER TABLE "public"."progress_photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "progress_photos_student_or_staff" ON "public"."progress_photos" USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"())) WITH CHECK ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."session_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "session_templates_manage_staff" ON "public"."session_templates" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



ALTER TABLE "public"."stripe_payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stripe_payments_manage_staff" ON "public"."stripe_payments" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "stripe_payments_select_own_student" ON "public"."stripe_payments" FOR SELECT USING (("student_id" = "public"."current_student_id"()));



ALTER TABLE "public"."student_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_profiles_manage_self_or_staff" ON "public"."student_profiles" USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"())) WITH CHECK ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



CREATE POLICY "student_profiles_select_self_or_staff" ON "public"."student_profiles" FOR SELECT USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."students" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "students_delete_staff" ON "public"."students" FOR DELETE USING ("public"."is_coach_or_admin"());



CREATE POLICY "students_manage_staff" ON "public"."students" FOR INSERT WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "students_select_self_or_staff" ON "public"."students" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_coach_or_admin"()));



CREATE POLICY "students_update_self_or_staff" ON "public"."students" FOR UPDATE USING ((("user_id" = "auth"."uid"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."subscription_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscription_templates_manage_staff" ON "public"."subscription_templates" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "subscription_templates_select_active_or_staff" ON "public"."subscription_templates" FOR SELECT USING ((("is_active" = true) OR "public"."is_coach_or_admin"() OR ("id" IN ( SELECT "student_profiles"."assigned_subscription_template_id"
   FROM "public"."student_profiles"
  WHERE ("student_profiles"."student_id" = "public"."current_student_id"())))));



ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_manage_staff" ON "public"."subscriptions" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "subscriptions_select_own_student" ON "public"."subscriptions" FOR SELECT USING (("student_id" = "public"."current_student_id"()));



ALTER TABLE "public"."training_blocks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "training_blocks_manage_staff" ON "public"."training_blocks" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "training_blocks_select_assigned_student" ON "public"."training_blocks" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."workout_sessions" "s"
     JOIN "public"."programs" "p" ON (("p"."id" = "s"."program_id")))
     JOIN "public"."assignments" "a" ON ((("a"."content_type" = 'programme'::"text") AND ("a"."content_id" = "p"."id"))))
  WHERE (("s"."id" = "training_blocks"."session_id") AND ("a"."student_id" = "public"."current_student_id"()) AND ("p"."publication_status" = 'published'::"text")))));



ALTER TABLE "public"."training_change_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "training_change_history_staff_only" ON "public"."training_change_history" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



ALTER TABLE "public"."training_prescriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "training_prescriptions_manage_staff" ON "public"."training_prescriptions" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "training_prescriptions_select_assigned_student" ON "public"."training_prescriptions" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM ((("public"."workout_exercises" "e"
     JOIN "public"."workout_sessions" "s" ON (("s"."id" = "e"."session_id")))
     JOIN "public"."programs" "p" ON (("p"."id" = "s"."program_id")))
     JOIN "public"."assignments" "a" ON ((("a"."content_type" = 'programme'::"text") AND ("a"."content_id" = "p"."id"))))
  WHERE (("e"."id" = "training_prescriptions"."exercise_id") AND ("a"."student_id" = "public"."current_student_id"()) AND ("p"."publication_status" = 'published'::"text")))) OR (EXISTS ( SELECT 1
   FROM ((("public"."training_blocks" "b"
     JOIN "public"."workout_sessions" "s" ON (("s"."id" = "b"."session_id")))
     JOIN "public"."programs" "p" ON (("p"."id" = "s"."program_id")))
     JOIN "public"."assignments" "a" ON ((("a"."content_type" = 'programme'::"text") AND ("a"."content_id" = "p"."id"))))
  WHERE (("b"."id" = "training_prescriptions"."block_id") AND ("a"."student_id" = "public"."current_student_id"()) AND ("p"."publication_status" = 'published'::"text"))))));



ALTER TABLE "public"."weight_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "weight_entries_student_or_staff" ON "public"."weight_entries" USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"())) WITH CHECK ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."workout_exercises" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workout_exercises_manage_staff" ON "public"."workout_exercises" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "workout_exercises_select_assigned_student" ON "public"."workout_exercises" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."workout_sessions" "s"
     JOIN "public"."programs" "p" ON (("p"."id" = "s"."program_id")))
     JOIN "public"."assignments" "a" ON ((("a"."content_type" = 'programme'::"text") AND ("a"."content_id" = "s"."program_id"))))
  WHERE (("s"."id" = "workout_exercises"."session_id") AND ("a"."student_id" = "public"."current_student_id"()) AND ("p"."publication_status" = 'published'::"text")))));



ALTER TABLE "public"."workout_feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workout_feedback_student_or_staff" ON "public"."workout_feedback" USING ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"())) WITH CHECK ((("student_id" = "public"."current_student_id"()) OR "public"."is_coach_or_admin"()));



ALTER TABLE "public"."workout_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workout_sessions_manage_staff" ON "public"."workout_sessions" USING ("public"."is_coach_or_admin"()) WITH CHECK ("public"."is_coach_or_admin"());



CREATE POLICY "workout_sessions_select_assigned_student" ON "public"."workout_sessions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."assignments" "a"
     JOIN "public"."programs" "p" ON (("p"."id" = "a"."content_id")))
  WHERE (("a"."content_type" = 'programme'::"text") AND ("a"."content_id" = "workout_sessions"."program_id") AND ("a"."student_id" = "public"."current_student_id"()) AND ("p"."publication_status" = 'published'::"text")))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."programs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."workout_sessions";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































REVOKE ALL ON FUNCTION "public"."current_student_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_student_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_student_id"() TO "service_role";
GRANT ALL ON FUNCTION "public"."current_student_id"() TO "anon";



REVOKE ALL ON FUNCTION "public"."is_coach_or_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_coach_or_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_coach_or_admin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_coach_or_admin"() TO "anon";



REVOKE ALL ON FUNCTION "public"."protect_student_profiles_access_columns"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protect_student_profiles_access_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_training_session_blocks"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_training_session_blocks"("p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_training_session_blocks"("p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";
























GRANT ALL ON TABLE "public"."activity_events" TO "anon";
GRANT ALL ON TABLE "public"."activity_events" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_events" TO "service_role";



GRANT ALL ON TABLE "public"."appointment_email_logs" TO "anon";
GRANT ALL ON TABLE "public"."appointment_email_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."appointment_email_logs" TO "service_role";



GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



GRANT ALL ON TABLE "public"."assignments" TO "anon";
GRANT ALL ON TABLE "public"."assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."assignments" TO "service_role";



GRANT ALL ON TABLE "public"."billing_customers" TO "anon";
GRANT ALL ON TABLE "public"."billing_customers" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_customers" TO "service_role";



GRANT ALL ON TABLE "public"."billing_events" TO "anon";
GRANT ALL ON TABLE "public"."billing_events" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_events" TO "service_role";



GRANT ALL ON TABLE "public"."body_measurements" TO "anon";
GRANT ALL ON TABLE "public"."body_measurements" TO "authenticated";
GRANT ALL ON TABLE "public"."body_measurements" TO "service_role";



GRANT ALL ON TABLE "public"."booking_settings" TO "anon";
GRANT ALL ON TABLE "public"."booking_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_settings" TO "service_role";



GRANT ALL ON TABLE "public"."coach_availabilities" TO "anon";
GRANT ALL ON TABLE "public"."coach_availabilities" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_availabilities" TO "service_role";



GRANT ALL ON TABLE "public"."coach_notes" TO "anon";
GRANT ALL ON TABLE "public"."coach_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_notes" TO "service_role";



GRANT ALL ON TABLE "public"."coach_unavailabilities" TO "anon";
GRANT ALL ON TABLE "public"."coach_unavailabilities" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_unavailabilities" TO "service_role";



GRANT ALL ON TABLE "public"."coaches" TO "anon";
GRANT ALL ON TABLE "public"."coaches" TO "authenticated";
GRANT ALL ON TABLE "public"."coaches" TO "service_role";



GRANT ALL ON TABLE "public"."custom_measurements" TO "anon";
GRANT ALL ON TABLE "public"."custom_measurements" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_measurements" TO "service_role";



GRANT ALL ON TABLE "public"."document_assignments" TO "anon";
GRANT ALL ON TABLE "public"."document_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."document_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."document_levels" TO "anon";
GRANT ALL ON TABLE "public"."document_levels" TO "authenticated";
GRANT ALL ON TABLE "public"."document_levels" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."email_logs" TO "anon";
GRANT ALL ON TABLE "public"."email_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."email_logs" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_feedback" TO "anon";
GRANT ALL ON TABLE "public"."exercise_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_library" TO "anon";
GRANT ALL ON TABLE "public"."exercise_library" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_library" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_set_feedback" TO "anon";
GRANT ALL ON TABLE "public"."exercise_set_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_set_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."legal_consents" TO "anon";
GRANT ALL ON TABLE "public"."legal_consents" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_consents" TO "service_role";



GRANT ALL ON TABLE "public"."meals" TO "anon";
GRANT ALL ON TABLE "public"."meals" TO "authenticated";
GRANT ALL ON TABLE "public"."meals" TO "service_role";



GRANT ALL ON TABLE "public"."newsletter_subscribers" TO "anon";
GRANT ALL ON TABLE "public"."newsletter_subscribers" TO "authenticated";
GRANT ALL ON TABLE "public"."newsletter_subscribers" TO "service_role";



GRANT ALL ON TABLE "public"."nutrition_daily_logs" TO "anon";
GRANT ALL ON TABLE "public"."nutrition_daily_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."nutrition_daily_logs" TO "service_role";



GRANT ALL ON TABLE "public"."nutrition_days" TO "anon";
GRANT ALL ON TABLE "public"."nutrition_days" TO "authenticated";
GRANT ALL ON TABLE "public"."nutrition_days" TO "service_role";



GRANT ALL ON TABLE "public"."nutrition_plans" TO "anon";
GRANT ALL ON TABLE "public"."nutrition_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."nutrition_plans" TO "service_role";



GRANT ALL ON TABLE "public"."payment_entries" TO "anon";
GRANT ALL ON TABLE "public"."payment_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_entries" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."program_weeks" TO "anon";
GRANT ALL ON TABLE "public"."program_weeks" TO "authenticated";
GRANT ALL ON TABLE "public"."program_weeks" TO "service_role";



GRANT ALL ON TABLE "public"."programs" TO "anon";
GRANT ALL ON TABLE "public"."programs" TO "authenticated";
GRANT ALL ON TABLE "public"."programs" TO "service_role";



GRANT ALL ON TABLE "public"."progress_photos" TO "anon";
GRANT ALL ON TABLE "public"."progress_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."progress_photos" TO "service_role";



GRANT ALL ON TABLE "public"."session_templates" TO "anon";
GRANT ALL ON TABLE "public"."session_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."session_templates" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_payments" TO "anon";
GRANT ALL ON TABLE "public"."stripe_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_payments" TO "service_role";



GRANT ALL ON TABLE "public"."student_profiles" TO "anon";
GRANT ALL ON TABLE "public"."student_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."student_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."students" TO "anon";
GRANT ALL ON TABLE "public"."students" TO "authenticated";
GRANT ALL ON TABLE "public"."students" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_templates" TO "anon";
GRANT ALL ON TABLE "public"."subscription_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_templates" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."training_blocks" TO "anon";
GRANT ALL ON TABLE "public"."training_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."training_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."training_change_history" TO "anon";
GRANT ALL ON TABLE "public"."training_change_history" TO "authenticated";
GRANT ALL ON TABLE "public"."training_change_history" TO "service_role";



GRANT ALL ON TABLE "public"."training_prescriptions" TO "anon";
GRANT ALL ON TABLE "public"."training_prescriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."training_prescriptions" TO "service_role";



GRANT ALL ON TABLE "public"."weight_entries" TO "anon";
GRANT ALL ON TABLE "public"."weight_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."weight_entries" TO "service_role";



GRANT ALL ON TABLE "public"."workout_exercises" TO "anon";
GRANT ALL ON TABLE "public"."workout_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_exercises" TO "service_role";



GRANT ALL ON TABLE "public"."workout_feedback" TO "anon";
GRANT ALL ON TABLE "public"."workout_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."workout_sessions" TO "anon";
GRANT ALL ON TABLE "public"."workout_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_sessions" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































