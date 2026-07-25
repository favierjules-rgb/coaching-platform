-- ============================================================================
-- Multi-blocs — moteur d'écriture canonique transactionnel (chantier
-- feature/multi-block-training-sessions, Lot 3A — juillet 2026).
-- ============================================================================
--
-- POURQUOI UNE RPC. `supabase-js` n'offre pas de transaction multi-requêtes :
-- une suite de `.insert()/.update()/.delete()` peut laisser un état
-- partiellement écrit si une erreur survient au milieu. La sauvegarde d'une
-- séance multi-blocs touche PLUSIEURS tables (training_blocks,
-- workout_exercises, training_prescriptions, workout_sessions) et DOIT être
-- atomique. On l'implémente donc dans UNE fonction PostgreSQL appelée par un
-- unique `supabase.rpc(...)` : une exception dans la fonction annule toute la
-- transaction.
--
-- ⚠️ MIGRATION LOCALE — PAS ENCORE APPLIQUÉE À DISTANCE. À exécuter sur un
-- Supabase local (`supabase start`) ou une branche de dev pour les tests
-- d'intégration (voir scripts/tests/save_training_session_blocks.test.sql).
--
-- CONTRAT (décisions Jules, Lot 3A) :
-- - Ids de blocs STABLES : appariement par UUID, toutes catégories ;
--   plusieurs blocs strength ET plusieurs blocs cardio autorisés.
-- - Trois formats d'id de bloc acceptés, tout le reste rejeté :
--     UUID réel (doit appartenir à la séance) ;
--     legacy-strength:<session_uuid> (bloc muscu hérité, migration) ;
--     new-block:<uuid-client> (nouveau bloc).
-- - Exercices : UUID réel (de la séance) ou new-exercise:<uuid-client>.
-- - Ids d'exercices strength CONSERVÉS (diff fin) → feedback préservé.
-- - Prescriptions cardio : bloc parent conservé, prescriptions
--   supprimées+réinsérées (ids recréés — aucune table externe ne les
--   référence, audité).
-- - Feedback : exercise_feedback.exercise_id est ON DELETE SET NULL. Un
--   exercice réellement supprimé détache (ne supprime pas) son feedback. Le
--   nombre de feedbacks détachés est compté AVANT suppression et retourné
--   dans warnings.detached_exercise_feedback_count. Aucun blocage automatique
--   dans ce lot.
-- - Positions : dérivées EXCLUSIVEMENT de l'ordre du tableau (0,1,2…). Aucune
--   contrainte unique sur (session_id, position) n'existe → aucune collision
--   possible, le décalage temporaire de positions est donc inutile et omis.
-- - Optimistic lock : expected_updated_at comparé APRÈS le verrou FOR UPDATE.
-- - session_type : dérivé des blocs. La colonne n'accepte que
--   strength|cardio|mixed (CHECK) : une séance sans bloc (dérivé « rest »)
--   stocke le placeholder 'strength' dans la colonne (rest reste porté par
--   is_rest_day), mais la RPC RETOURNE la vraie valeur dérivée (« rest »
--   possible) — la règle métier TypeScript deriveSessionType(blocks) n'est
--   pas modifiée.
--
-- SÉCURITÉ : `security invoker` — l'appelant conserve ses droits RLS ; les
-- policies `*_manage_staff` (is_coach_or_admin()) autorisent déjà toutes les
-- mutations nécessaires, aucun `security definer` requis. `search_path` vidé,
-- toutes les tables qualifiées `public.`. EXECUTE révoqué à public/anon,
-- accordé à authenticated (fin de fichier).
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

  -- UUID réellement CONSERVÉS par cette sauvegarde (persistés mis à jour +
  -- nouveaux insérés). Sert de référence aux suppressions tardives (étape 7) :
  -- on ne peut pas s'appuyer sur v_incoming_*_uuids, qui n'agrège que les
  -- UUID persistés envoyés par le client et exclut donc les lignes fraîchement
  -- créées (legacy/new-block/new-exercise) — les supprimer effacerait ce qu'on
  -- vient d'insérer.
  v_kept_block_uuids uuid[] := array[]::uuid[];
  v_kept_ex_uuids uuid[] := array[]::uuid[];

  v_block_uuid uuid;
  v_ex_uuid uuid;
  v_block_pos int;
  v_ex_order int;

  v_block_map jsonb := '{}'::jsonb;   -- rawId -> uuid réel
  v_ex_map jsonb := '{}'::jsonb;      -- rawId -> uuid réel

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

  -- ── 2. Verrou de séance + appartenance ────────────────────────────────
  -- RLS restreint déjà au staff : 0 ligne = séance inexistante OU interdite.
  select ws.updated_at into v_current_updated_at
  from public.workout_sessions ws
  where ws.id = v_session_id
  for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND_OR_FORBIDDEN';
  end if;

  -- ── 3. Optimistic lock (APRÈS le verrou) ──────────────────────────────
  if v_current_updated_at is distinct from v_expected_updated_at then
    raise exception 'STALE_TRAINING_SESSION';
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

    -- Exercices strength : validation des ids
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
    raise exception 'FOREIGN_BLOCK_ID'; -- bloc d'une autre séance → rollback
  end if;
  if exists (select 1 from unnest(v_incoming_ex_uuids) x where x <> all(v_existing_ex_uuids)) then
    raise exception 'FOREIGN_EXERCISE_ID'; -- exercice d'une autre séance → rollback
  end if;

  -- ── 6. Appliquer les blocs (création/mise à jour), position = index ───
  v_block_pos := 0;
  for v_block in select * from jsonb_array_elements(v_blocks) loop
    v_raw_block_id := v_block->>'id';
    v_category := v_block->>'category';

    if v_raw_block_id ~* c_uuid_re then
      -- Bloc persisté → UPDATE (id conservé).
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
      -- legacy-strength:* ou new-block:* → INSERT d'un vrai bloc.
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
      -- Diff FIN des exercices par id : UPDATE (repointe block_id) / INSERT.
      -- Les suppressions sont traitées globalement plus bas (étape 7).
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
      -- Cardio : bloc parent conservé, prescriptions remplacées (ids recréés).
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

  -- ── 7. Suppressions TARDIVES (après création/mise à jour du conservé) ──
  -- Exercices réellement retirés = ceux de la séance qui n'ont été ni mis à
  -- jour ni (ré)insérés pendant cette sauvegarde (donc absents des UUID
  -- CONSERVÉS ; array vide ⇒ tout est supprimé, cas repos inclus).
  select coalesce(array_agg(id), array[]::uuid[]) into v_ex_ids_to_delete
  from public.workout_exercises
  where session_id = v_session_id and id <> all(v_kept_ex_uuids);

  -- Compter les feedbacks qui vont être DÉTACHÉS (SET NULL), avant suppression.
  select count(*) into v_detached_feedback_count
  from public.exercise_feedback
  where exercise_id = any(v_ex_ids_to_delete);

  if array_length(v_ex_ids_to_delete, 1) is not null then
    delete from public.workout_exercises where id = any(v_ex_ids_to_delete);
  end if;

  -- Blocs réellement retirés = ceux de la séance qui n'ont été ni mis à jour
  -- ni insérés pendant cette sauvegarde (absents des UUID CONSERVÉS ; cascade
  -- sur prescriptions/exercices résiduels ; array vide ⇒ tout est supprimé).
  delete from public.training_blocks
  where session_id = v_session_id and id <> all(v_kept_block_uuids);

  -- ── 8. session_type dérivé + mise à jour de la séance ─────────────────
  v_derived_type := case
    when not v_has_strength and not v_has_cardio then 'rest'
    when v_has_strength and v_has_cardio then 'mixed'
    when v_has_strength then 'strength'
    else 'cardio'
  end;
  -- La colonne n'accepte pas 'rest' (CHECK strength|cardio|mixed) → placeholder.
  v_column_type := case when v_derived_type = 'rest' then 'strength' else v_derived_type end;

  -- Cas repos : dans le modèle multi-blocs, une séance SANS bloc EST un jour de
  -- repos, et une séance AVEC au moins un bloc n'en est pas un. La RPC aligne
  -- donc is_rest_day sur le contenu réel (source unique de vérité = les blocs),
  -- pour ne jamais laisser un état incohérent (séance vide non-repos, ou séance
  -- « repos » portant encore des blocs). session_type reste un cache : sa valeur
  -- de colonne pour un repos est le placeholder ci-dessus, mais la RPC RETOURNE
  -- le vrai type dérivé 'rest'.
  update public.workout_sessions
    set session_type = v_column_type,
        is_rest_day = (v_derived_type = 'rest'),
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
  'Moteur d''écriture canonique multi-blocs (Lot 3A). Un seul appel RPC, transactionnel. Voir l''en-tête de la migration 20260721224252 pour le contrat complet.';

-- ── Droits d'exécution : jamais public/anon, uniquement authenticated ──
revoke execute on function public.save_training_session_blocks(jsonb) from public;
revoke execute on function public.save_training_session_blocks(jsonb) from anon;
grant execute on function public.save_training_session_blocks(jsonb) to authenticated;
