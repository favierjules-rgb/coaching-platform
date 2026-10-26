-- ============================================================================
-- PRESCRIPTIONS CARDIO — SYNCHRONISATION DIFFÉRENTIELLE À LA PLACE DE
-- DELETE + INSERT. Chantier feat/entrainement-performances, lot D. Octobre 2026.
-- ============================================================================
--
-- ════════════════════════════════════════════════════════════════════════════
-- POURQUOI — UN ENREGISTREMENT DÉTRUISAIT DES IDENTITÉS SANS RIEN CHANGER
-- ════════════════════════════════════════════════════════════════════════════
-- `save_training_session_blocks` traitait les blocs et les exercices par DIFF
-- (ids conservés, mise à jour en place, suppressions tardives bornées) mais les
-- prescriptions cardio par REMPLACEMENT :
--
--   delete from public.training_prescriptions where block_id = v_block_uuid;
--   -- puis réinsertion de toute la liste
--
-- Conséquences, toutes constatées :
--   · les `id` des prescriptions changeaient à CHAQUE enregistrement de la
--     séance, même quand le coach n'avait pas touché au bloc cardio ;
--   · `created_at` était perdu — un horodatage métier, pas un détail ;
--   · tout ce qui aurait pointé vers une prescription se détachait en silence.
--
-- ⚠️ CE N'EST PAS UNE HYPOTHÈSE : c'est exactement le mécanisme qui a produit
-- les 228 retours d'exercice orphelins relevés en production le 24/10/2026
-- (228 sur 1 041, soit 21,9 % de `exercise_feedback`, dont l'`exercise_id` ne
-- correspond plus à aucune ligne). Cette migration NE RÉPARE PAS ces données
-- historiques — elle ferme la cause. Aucune ligne existante n'est lue,
-- modifiée ni supprimée par cette migration.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUI CHANGE, ET CE QUI NE CHANGE PAS
-- ════════════════════════════════════════════════════════════════════════════
-- `create or replace` de `save_training_session_blocks(jsonb)` — signature
-- INCHANGÉE, et on NE modifie PAS rétroactivement les migrations déjà
-- appliquées (20260721224252, puis 20260722120000, puis l'ajout de
-- `target_zone`/`target_power_percentage`).
--
-- Le corps est REPRIS À L'IDENTIQUE, à trois endroits près :
--   1. étape 4 — validation de la FORME des identifiants de prescription,
--      calquée mot pour mot sur celle des blocs et des exercices ;
--   2. étape 6, branche cardio — le DELETE + INSERT devient un DIFF ;
--   3. le retour — `id_mapping` porte désormais `prescriptions`.
--
-- Tout le reste est inchangé : garde `is_coach_or_admin()`, verrou
-- `for update`, contrôle `STALE_TRAINING_SESSION` AVANT toute mutation,
-- validation stricte de `session_patch`, refus des identifiants étrangers,
-- dérivation de `session_type`/`is_rest_day` depuis les blocs, UPDATE final
-- unique, `security invoker`, `search_path` figé, droits bornés à
-- `authenticated`.
--
-- ⚠️ ATOMICITÉ INCHANGÉE, ET C'EST CE QUI REND LE DIFF SÛR. Une fonction
-- plpgsql s'exécute dans la transaction de l'appelant : si la moindre étape
-- lève — `FOREIGN_PRESCRIPTION_ID`, `DUPLICATE_TEMP_PRESCRIPTION_ID`, un refus
-- de la RLS — TOUTES les écritures sont annulées, y compris les mises à jour de
-- prescriptions déjà appliquées dans la boucle. Il ne peut pas exister de bloc
-- à moitié synchronisé. Appelée depuis `save_training_program_sessions`
-- (lot B), elle partage la transaction de la programmation entière.
--
-- ⚠️ UNE CHARGE SANS `id` RESTE ACCEPTÉE, et c'est ce qui autorise un
-- déploiement progressif. Un client antérieur à ce lot n'envoie aucun
-- identifiant de prescription : chaque segment est alors traité comme NEUF, le
-- comportement observable redevient celui d'avant (lignes recréées), et rien ne
-- casse. La base peut donc être migrée AVANT le client.
--
-- ════════════════════════════════════════════════════════════════════════════
-- GRAMMAIRE DES IDENTIFIANTS DE PRESCRIPTION
-- ════════════════════════════════════════════════════════════════════════════
--   · UUID réel                  → ligne existante, mise à jour en place ;
--   · `new-prescription:<uuid>`  → ligne neuve, insérée, id réel rendu dans
--                                  `id_mapping.prescriptions` ;
--   · absent (`null`)            → ligne neuve (client antérieur à ce lot) ;
--   · toute autre forme          → `UNRECOGNIZED_PRESCRIPTION_ID`.
--
-- Erreurs ajoutées, toutes identifiables :
--   INVALID_NEW_PRESCRIPTION_ID: <id> ...... suffixe non UUID
--   DUPLICATE_TEMP_PRESCRIPTION_ID: <id> ... deux fois le même id temporaire
--   UNRECOGNIZED_PRESCRIPTION_ID: <id> ..... forme inconnue
--   FOREIGN_PRESCRIPTION_ID: <id> .......... UUID n'appartenant pas à CE bloc
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
  v_raw_presc_id text;

  v_legacy_seen boolean := false;
  v_temp_block_ids text[] := array[]::text[];
  v_temp_ex_ids text[] := array[]::text[];
  v_temp_presc_ids text[] := array[]::text[];

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
  v_presc_map jsonb := '{}'::jsonb;

  -- Prescriptions CONSERVÉES pour le bloc cardio en cours de traitement.
  -- ⚠️ REMIS À VIDE À CHAQUE BLOC, et c'est ce qui borne la suppression : une
  -- liste cumulée sur toute la séance laisserait un bloc effacer les lignes
  -- d'un autre.
  v_kept_presc_uuids uuid[] := array[]::uuid[];
  v_presc_uuid uuid;
  v_incoming_presc_uuids uuid[];
  v_existing_presc_uuids uuid[];

  v_ex_ids_to_delete uuid[];
  v_detached_feedback_count int := 0;

  v_has_strength boolean := false;
  v_has_cardio boolean := false;
  v_derived_type text;
  v_column_type text;

  v_result_blocks jsonb;
  v_scheduled_date date;

  -- PORTÉE DE LA SAUVEGARDE — voir l'en-tête de la migration.
  v_scope text;
  v_existing_cardio_uuids uuid[];
  v_existing_strength_uuids uuid[];
  v_position_explicite boolean;
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

  -- ── 1bis. LA PORTÉE : 'all', 'cardio' ou 'strength' ───────────────────
  --
  -- ⚠️ C'EST LA GARANTIE CENTRALE DE CE CHANTIER. Un appel de portée 'cardio'
  -- ne peut PAS supprimer, modifier ni même déplacer une ligne de musculation :
  -- il ne lit les exercices que pour les compter, et ses suppressions sont
  -- bornées aux blocs `cardio` de la séance. Un appel de portée 'strength' est
  -- l'exact symétrique. 'all' (le défaut, donc le comportement inchangé de tous
  -- les appelants existants) remplace la séance entière, et c'est la seule
  -- portée qui en a le pouvoir.
  v_scope := coalesce(nullif(p_payload->>'scope', ''), 'all');
  if v_scope not in ('all', 'cardio', 'strength') then
    raise exception 'INVALID_SCOPE: %', v_scope;
  end if;
  -- Hors portée 'all', l'ordre des blocs de la séance n'est pas déductible du
  -- payload (il ne porte qu'une catégorie) : la position doit être FOURNIE.
  v_position_explicite := v_scope <> 'all';

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
      where k not in ('day','name','muscle_group','duration_minutes','warmup','coach_notes','banner_url','scheduled_date')
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
    -- ⚠️ UN BLOC HORS PORTÉE EST UN REFUS, PAS UNE TOLÉRANCE. Accepter un bloc
    -- de musculation dans un enregistrement cardio rouvrirait exactement le
    -- trou que la portée ferme.
    if v_scope <> 'all' and v_category <> v_scope then
      raise exception 'SCOPE_VIOLATION: bloc % refusé par la portée %', v_category, v_scope;
    end if;
    if v_category = 'strength' then v_has_strength := true; else v_has_cardio := true; end if;

    if v_position_explicite and (v_block ? 'position') = false then
      raise exception 'MISSING_BLOCK_POSITION: la portée % exige une position par bloc', v_scope;
    end if;

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

    -- ⚠️ LES PRESCRIPTIONS ONT MAINTENANT UNE IDENTITÉ, DONC UNE VALIDATION.
    -- Elles n'en avaient pas : la charge ne portait aucun `id`, et le moteur
    -- supprimait puis réinsérait tout le bloc. Même grammaire que les blocs et
    -- les exercices — UUID réel, ou `new-prescription:<uuid>`, et rien d'autre.
    -- L'APPARTENANCE, elle, se vérifie au moment de l'écriture (étape 6) :
    -- pour un bloc neuf, l'UUID du bloc n'existe pas encore ici.
    if v_category = 'cardio' then
      for v_prescription in select * from jsonb_array_elements(coalesce(v_block->'prescriptions', '[]'::jsonb)) loop
        v_raw_presc_id := v_prescription->>'id';
        if v_raw_presc_id is null then
          -- ⚠️ CHARGE D'UN CLIENT ANTÉRIEUR À CE LOT : aucune identité envoyée.
          -- Traitée comme une ligne NEUVE, jamais comme une erreur — sinon
          -- cette migration casserait toute version du client non encore
          -- déployée, et le déploiement progressif deviendrait impossible.
          continue;
        end if;
        if v_raw_presc_id ~* c_uuid_re then
          continue;
        end if;
        if v_raw_presc_id like 'new-prescription:%' then
          if substring(v_raw_presc_id from length('new-prescription:') + 1) !~* c_uuid_re then
            raise exception 'INVALID_NEW_PRESCRIPTION_ID: %', v_raw_presc_id;
          end if;
          if v_raw_presc_id = any(v_temp_presc_ids) then
            raise exception 'DUPLICATE_TEMP_PRESCRIPTION_ID: %', v_raw_presc_id;
          end if;
          v_temp_presc_ids := array_append(v_temp_presc_ids, v_raw_presc_id);
        else
          raise exception 'UNRECOGNIZED_PRESCRIPTION_ID: %', v_raw_presc_id;
        end if;
      end loop;
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

  select coalesce(array_agg(id), array[]::uuid[]) into v_existing_cardio_uuids
  from public.training_blocks where session_id = v_session_id and block_type = 'cardio';
  select coalesce(array_agg(id), array[]::uuid[]) into v_existing_strength_uuids
  from public.training_blocks where session_id = v_session_id and block_type <> 'cardio';

  if exists (select 1 from unnest(v_incoming_block_uuids) x where x <> all(v_existing_block_uuids)) then
    raise exception 'FOREIGN_BLOCK_ID';
  end if;
  /*
   * ⚠️ UN BLOC EXISTANT NE CHANGE PAS DE CATÉGORIE DANS UN APPEL DE PORTÉE.
   * Sans ce contrôle, un enregistrement 'cardio' pouvait nommer l'UUID d'un bloc
   * de musculation : l'UPDATE aurait basculé son `block_type` à 'cardio' et
   * orphelinné ses exercices — une suppression de musculation déguisée en
   * modification.
   */
  if v_scope = 'cardio' and exists (
    select 1 from unnest(v_incoming_block_uuids) x where x <> all(v_existing_cardio_uuids)
  ) then
    raise exception 'SCOPE_VIOLATION: un bloc visé n''est pas un bloc cardio de cette séance';
  end if;
  if v_scope = 'strength' and exists (
    select 1 from unnest(v_incoming_block_uuids) x where x <> all(v_existing_strength_uuids)
  ) then
    raise exception 'SCOPE_VIOLATION: un bloc visé n''est pas un bloc de musculation de cette séance';
  end if;
  if exists (select 1 from unnest(v_incoming_ex_uuids) x where x <> all(v_existing_ex_uuids)) then
    raise exception 'FOREIGN_EXERCISE_ID';
  end if;

  -- ── 6. Appliquer les blocs (création/mise à jour) ─────────────────────
  --     position = index du tableau en portée 'all' (inchangé), valeur
  --     FOURNIE par l'appelant sinon (il est seul à connaître l'ordre complet
  --     de la séance, l'autre catégorie n'étant pas dans son payload).
  v_block_pos := 0;
  for v_block in select * from jsonb_array_elements(v_blocks) loop
    v_raw_block_id := v_block->>'id';
    v_category := v_block->>'category';
    if v_position_explicite then
      v_block_pos := (v_block->>'position')::int;
    end if;

    if v_raw_block_id ~* c_uuid_re then
      v_block_uuid := v_raw_block_id::uuid;
      update public.training_blocks set
        block_type = v_category,
        title = coalesce(v_block->>'title', ''),
        color_key = coalesce(v_block->>'color_key', 'gray'),
        position = v_block_pos,
        cardio_type = case when v_category = 'cardio' then v_block->>'cardio_type' else null end,
        machine_type = case when v_category = 'cardio' then v_block->>'machine_type' else null end,
        -- ⚠️ `sport` ET `rounds` NE SONT ÉCRITS QUE POUR UN BLOC CARDIO. Un bloc
        -- de musculation garde son `rounds` tel quel : la colonne existe depuis
        -- juillet 2026 pour les formats AMRAP/EMOM, et l'écraser à NULL depuis
        -- un enregistrement cardio détruirait une donnée que ce chantier ne
        -- touche pas.
        sport = case when v_category = 'cardio' then nullif(v_block->>'sport', '') else sport end,
        rounds = case when v_category = 'cardio' then (v_block->>'rounds')::int else rounds end,
        updated_at = now()
      where id = v_block_uuid and session_id = v_session_id;
    else
      insert into public.training_blocks (session_id, block_type, title, color_key, position, cardio_type, machine_type, sport, rounds)
      values (
        v_session_id,
        v_category,
        coalesce(v_block->>'title', ''),
        coalesce(v_block->>'color_key', 'gray'),
        v_block_pos,
        case when v_category = 'cardio' then v_block->>'cardio_type' else null end,
        case when v_category = 'cardio' then v_block->>'machine_type' else null end,
        case when v_category = 'cardio' then nullif(v_block->>'sport', '') else null end,
        case when v_category = 'cardio' then (v_block->>'rounds')::int else null end
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
            -- RPE CIBLE (feat/student-previous-set-performance) : texte libre
            -- nullable, '' normalisé en NULL (aucune prescription).
            recommended_rpe = nullif(v_exercise->>'recommended_rpe', ''),
            video_url = coalesce(v_exercise->>'video_url', ''),
            notes = coalesce(v_exercise->>'notes', ''),
            muscle_group = v_exercise->>'muscle_group',
            exercise_library_id = nullif(v_exercise->>'exercise_library_id', '')::uuid,
            updated_at = now()
          where id = v_ex_uuid and session_id = v_session_id;
        else
          insert into public.workout_exercises (
            session_id, block_id, order_index, name, sets, reps, rest_seconds, tempo,
            recommended_load, recommended_rpe, video_url, notes, muscle_group, exercise_library_id
          ) values (
            v_session_id, v_block_uuid, v_ex_order,
            coalesce(v_exercise->>'name', ''),
            coalesce((v_exercise->>'sets')::int, 0),
            coalesce(v_exercise->>'reps', ''),
            coalesce((v_exercise->>'rest_seconds')::int, 0),
            coalesce(v_exercise->>'tempo', ''),
            coalesce(v_exercise->>'recommended_load', ''),
            nullif(v_exercise->>'recommended_rpe', ''),
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
      /*
       * ════════════════════════════════════════════════════════════════════
       * SYNCHRONISATION DIFFÉRENTIELLE DES PRESCRIPTIONS
       * ════════════════════════════════════════════════════════════════════
       * Avant : `delete from training_prescriptions where block_id = …` suivi
       * de la réinsertion de toute la liste. Les lignes étaient donc DÉTRUITES
       * et RECRÉÉES à chaque enregistrement de la séance, même sans aucune
       * modification : leurs `id` changeaient, leur `created_at` était perdu,
       * et tout ce qui pointait vers elles se détachait. C'est le mécanisme
       * qui a produit les 228 retours d'exercice orphelins relevés en
       * production — ce lot ne les répare pas, il ferme la cause.
       *
       * Désormais, le même traitement que les blocs et les exercices :
       *   · UUID réel → la ligne EXISTE : mise à jour EN PLACE, id conservé ;
       *   · autre id  → ligne NEUVE : insertion, et l'identifiant réel est
       *                 rendu au client dans `id_mapping.prescriptions` ;
       *   · absente de la liste du bloc → retirée par le coach : supprimée,
       *     et UNIQUEMENT elle.
       *
       * ⚠️ LA MISE À JOUR EST CONDITIONNELLE, ET CE N'EST PAS UNE MICRO-
       * OPTIMISATION. Le `where … is distinct from …` compare l'ancienne ligne
       * à la nouvelle : sans lui, le déclencheur `set_updated_at` bougerait
       * `updated_at` à chaque enregistrement de la séance, y compris quand
       * rien n'a changé dans le segment. `updated_at` doit dire « cette
       * prescription a été modifiée », pas « la séance a été enregistrée ».
       *
       * ⚠️ `block_id` ET `exercise_id` NE SONT JAMAIS DANS LE `SET`. Une
       * prescription ne change pas de parent : elle serait déplacée dans un
       * autre bloc, en silence. Le rattachement est posé à l'insertion et ne
       * bouge plus. `created_at` n'y figure pas davantage — c'est un
       * horodatage métier, et le perdre était le défaut corrigé ici.
       *
       * ⚠️ LES 28 COLONNES DU `SET`, DU `ROW(…)` ET DE L'`INSERT` SONT LA MÊME
       * LISTE, dérivée de l'INSERT d'origine. `target_zone` et
       * `target_power_percentage` y figurent : elles ont été ajoutées au moteur
       * après la migration 20260722120000, et une liste recopiée à la main les
       * aurait oubliées — donc jamais mises à jour, en silence.
       */
      /*
       * ⚠️ L'APPARTENANCE EST VÉRIFIÉE UNE FOIS PAR BLOC, PAS UNE FOIS PAR
       * LIGNE — et c'est une mesure, pas une élégance. La première version
       * posait un `exists (…)` par prescription : chacun est une instruction
       * SQL distincte, qui paie son évaluation de politique RLS. Sur le pire
       * cas du banc (91 séances, ~54 prescriptions), cela coûtait environ
       * 1,5 s et faisait passer l'appel de ~5,5 s à ~7,2 s, pour un plafond
       * `statement_timeout` de 8 s : la marge tombait à 366 ms.
       *
       * Deux instructions par bloc cardio suffisent, et c'est exactement le
       * motif que le moteur applique déjà aux blocs et aux exercices à
       * l'étape 5 (`array_agg` puis `unnest … <> all(…)`).
       */
      select coalesce(array_agg((p->>'id')::uuid), array[]::uuid[])
        into v_incoming_presc_uuids
        from jsonb_array_elements(coalesce(v_block->'prescriptions', '[]'::jsonb)) p
       where p->>'id' is not null and p->>'id' ~* c_uuid_re;

      if array_length(v_incoming_presc_uuids, 1) is not null then
        select coalesce(array_agg(id), array[]::uuid[]) into v_existing_presc_uuids
          from public.training_prescriptions where block_id = v_block_uuid;
        /*
         * Un UUID entrant qui n'est pas une prescription de CE bloc est refusé.
         * Se contenter de « elle appartient à cette séance » laisserait une
         * charge mal formée réécrire la prescription d'un bloc voisin — et
         * comme `block_id` n'est pas modifiable, la ligne resterait sur son
         * bloc d'origine avec le contenu d'un autre, puis disparaîtrait au
         * bornage de son vrai bloc. Symétrique de `FOREIGN_BLOCK_ID` et
         * `FOREIGN_EXERCISE_ID`.
         */
        if exists (
          select 1 from unnest(v_incoming_presc_uuids) x
           where x <> all(v_existing_presc_uuids)
        ) then
          raise exception 'FOREIGN_PRESCRIPTION_ID: %',
            (select x::text from unnest(v_incoming_presc_uuids) x
              where x <> all(v_existing_presc_uuids) limit 1);
        end if;
      end if;

      v_kept_presc_uuids := array[]::uuid[];
      v_ex_order := 0;
      for v_prescription in select * from jsonb_array_elements(coalesce(v_block->'prescriptions', '[]'::jsonb)) loop
        v_raw_presc_id := v_prescription->>'id';

        if v_raw_presc_id is not null and v_raw_presc_id ~* c_uuid_re then
          v_presc_uuid := v_raw_presc_id::uuid;

          -- L'appartenance a déjà été prouvée pour tout le bloc, juste avant
          -- la boucle : inutile de la redemander ligne par ligne.
          /*
           * ⚠️ UNE CLÉ ABSENTE DE LA CHARGE NE TOUCHE PAS SA COLONNE, et c'est
           * la différence entre « mettre à jour » et « remplacer ». Écrire
           * `colonne = (v_prescription->>'clé')::type` sans garde met la
           * colonne à NULL dès que la clé manque : une charge partielle
           * EFFACERAIT en silence tout ce qu'elle ne mentionne pas.
           *
           * Le `case when v_prescription ? 'clé'` distingue les deux cas que le
           * JSON confond autrement :
           *   · clé ABSENTE          → la valeur en base est conservée ;
           *   · clé présente à null  → la valeur est effacée, comme demandé.
           *
           * C'est exactement le contrat de `session_patch`, déjà en place dans
           * ce moteur pour les métadonnées de séance — on l'étend aux
           * prescriptions plutôt que d'inventer une seconde règle.
           *
           * ⚠️ `set_number`, `position` et `set_type` restent INCONDITIONNELS :
           * ils ne viennent pas de la charge. Les deux premiers sont dérivés du
           * rang dans la liste — c'est ce qui fait qu'un réordonnancement
           * s'écrit — et le troisième est une constante du modèle cardio.
           *
           * ⚠️ J'AI ESSAYÉ UN CHEMIN RAPIDE, ET LA MESURE L'A REFUSÉ. La garde
           * se paie deux fois par colonne (dans le `set` et dans le
           * `row(…) is distinct from row(…)`), soit 50 opérations jsonb par
           * prescription. J'ai donc ajouté un branchement `v_prescription ?&
           * array[…25 clés…]` prenant un `update` sans garde quand la charge est
           * exhaustive — ce que `serializeBlock` garantit. Mesuré sur le banc,
           * pire cas, trois passages :
           *
           *   garde partout ...... 7 316 · 7 374 · 7 707 ms
           *   avec chemin rapide . 7 197 · 8 592 · 7 505 ms
           *
           * Aucun gain : l'écart est dans le bruit de la machine. Le
           * branchement dupliquait une liste de 28 colonnes pour rien, et une
           * liste dupliquée est une liste qui finit par diverger. Retiré.
           *
           * Le coût réel du diff est ailleurs et il est mesuré — voir la note
           * sur la marge au `statement_timeout`, plus bas dans cet en-tête.
           */
          update public.training_prescriptions set
            set_number = v_ex_order,
            set_type = 'normal',
            segment_type =
              case when v_prescription ? 'segment_type' then coalesce(v_prescription->>'segment_type', 'single') else segment_type end,
            title =
              case when v_prescription ? 'title' then nullif(v_prescription->>'title', '') else title end,
            position = v_ex_order,
            repetitions =
              case when v_prescription ? 'repetitions' then (v_prescription->>'repetitions')::int else repetitions end,
            work_duration_seconds =
              case when v_prescription ? 'work_duration_seconds' then (v_prescription->>'work_duration_seconds')::int else work_duration_seconds end,
            distance_meters =
              case when v_prescription ? 'distance_meters' then (v_prescription->>'distance_meters')::numeric else distance_meters end,
            elevation_gain_meters =
              case when v_prescription ? 'elevation_gain_meters' then (v_prescription->>'elevation_gain_meters')::numeric else elevation_gain_meters end,
            incline_percentage =
              case when v_prescription ? 'incline_percentage' then (v_prescription->>'incline_percentage')::numeric else incline_percentage end,
            recovery_duration_seconds =
              case when v_prescription ? 'recovery_duration_seconds' then (v_prescription->>'recovery_duration_seconds')::int else recovery_duration_seconds end,
            recovery_distance_meters =
              case when v_prescription ? 'recovery_distance_meters' then (v_prescription->>'recovery_distance_meters')::numeric else recovery_distance_meters end,
            intensity_target_type =
              case when v_prescription ? 'intensity_target_type' then coalesce(v_prescription->>'intensity_target_type', 'free') else intensity_target_type end,
            target_vma_percentage =
              case when v_prescription ? 'target_vma_percentage' then (v_prescription->>'target_vma_percentage')::numeric else target_vma_percentage end,
            target_speed_kmh =
              case when v_prescription ? 'target_speed_kmh' then (v_prescription->>'target_speed_kmh')::numeric else target_speed_kmh end,
            target_pace_seconds_per_km =
              case when v_prescription ? 'target_pace_seconds_per_km' then (v_prescription->>'target_pace_seconds_per_km')::int else target_pace_seconds_per_km end,
            target_hr_percentage =
              case when v_prescription ? 'target_hr_percentage' then (v_prescription->>'target_hr_percentage')::numeric else target_hr_percentage end,
            target_hr_zone =
              case when v_prescription ? 'target_hr_zone' then nullif(v_prescription->>'target_hr_zone', '') else target_hr_zone end,
            target_power_watts =
              case when v_prescription ? 'target_power_watts' then (v_prescription->>'target_power_watts')::numeric else target_power_watts end,
            target_cadence =
              case when v_prescription ? 'target_cadence' then (v_prescription->>'target_cadence')::numeric else target_cadence end,
            intensity_min =
              case when v_prescription ? 'intensity_min' then (v_prescription->>'intensity_min')::numeric else intensity_min end,
            intensity_max =
              case when v_prescription ? 'intensity_max' then (v_prescription->>'intensity_max')::numeric else intensity_max end,
            target_zone =
              case when v_prescription ? 'target_zone' then (v_prescription->>'target_zone')::smallint else target_zone end,
            target_power_percentage =
              case when v_prescription ? 'target_power_percentage' then (v_prescription->>'target_power_percentage')::numeric else target_power_percentage end,
            surface =
              case when v_prescription ? 'surface' then nullif(v_prescription->>'surface', '') else surface end,
            terrain =
              case when v_prescription ? 'terrain' then nullif(v_prescription->>'terrain', '') else terrain end,
            equipment_type =
              case when v_prescription ? 'equipment_type' then nullif(v_prescription->>'equipment_type', '') else equipment_type end,
            coach_notes =
              case when v_prescription ? 'coach_notes' then coalesce(v_prescription->>'coach_notes', '') else coach_notes end
          where id = v_presc_uuid
            and row(
              set_number,
              set_type,
              segment_type,
              title,
              position,
              repetitions,
              work_duration_seconds,
              distance_meters,
              elevation_gain_meters,
              incline_percentage,
              recovery_duration_seconds,
              recovery_distance_meters,
              intensity_target_type,
              target_vma_percentage,
              target_speed_kmh,
              target_pace_seconds_per_km,
              target_hr_percentage,
              target_hr_zone,
              target_power_watts,
              target_cadence,
              intensity_min,
              intensity_max,
              target_zone,
              target_power_percentage,
              surface,
              terrain,
              equipment_type,
              coach_notes
            ) is distinct from row(
              v_ex_order,
              'normal',
              case when v_prescription ? 'segment_type' then coalesce(v_prescription->>'segment_type', 'single') else segment_type end,
              case when v_prescription ? 'title' then nullif(v_prescription->>'title', '') else title end,
              v_ex_order,
              case when v_prescription ? 'repetitions' then (v_prescription->>'repetitions')::int else repetitions end,
              case when v_prescription ? 'work_duration_seconds' then (v_prescription->>'work_duration_seconds')::int else work_duration_seconds end,
              case when v_prescription ? 'distance_meters' then (v_prescription->>'distance_meters')::numeric else distance_meters end,
              case when v_prescription ? 'elevation_gain_meters' then (v_prescription->>'elevation_gain_meters')::numeric else elevation_gain_meters end,
              case when v_prescription ? 'incline_percentage' then (v_prescription->>'incline_percentage')::numeric else incline_percentage end,
              case when v_prescription ? 'recovery_duration_seconds' then (v_prescription->>'recovery_duration_seconds')::int else recovery_duration_seconds end,
              case when v_prescription ? 'recovery_distance_meters' then (v_prescription->>'recovery_distance_meters')::numeric else recovery_distance_meters end,
              case when v_prescription ? 'intensity_target_type' then coalesce(v_prescription->>'intensity_target_type', 'free') else intensity_target_type end,
              case when v_prescription ? 'target_vma_percentage' then (v_prescription->>'target_vma_percentage')::numeric else target_vma_percentage end,
              case when v_prescription ? 'target_speed_kmh' then (v_prescription->>'target_speed_kmh')::numeric else target_speed_kmh end,
              case when v_prescription ? 'target_pace_seconds_per_km' then (v_prescription->>'target_pace_seconds_per_km')::int else target_pace_seconds_per_km end,
              case when v_prescription ? 'target_hr_percentage' then (v_prescription->>'target_hr_percentage')::numeric else target_hr_percentage end,
              case when v_prescription ? 'target_hr_zone' then nullif(v_prescription->>'target_hr_zone', '') else target_hr_zone end,
              case when v_prescription ? 'target_power_watts' then (v_prescription->>'target_power_watts')::numeric else target_power_watts end,
              case when v_prescription ? 'target_cadence' then (v_prescription->>'target_cadence')::numeric else target_cadence end,
              case when v_prescription ? 'intensity_min' then (v_prescription->>'intensity_min')::numeric else intensity_min end,
              case when v_prescription ? 'intensity_max' then (v_prescription->>'intensity_max')::numeric else intensity_max end,
              case when v_prescription ? 'target_zone' then (v_prescription->>'target_zone')::smallint else target_zone end,
              case when v_prescription ? 'target_power_percentage' then (v_prescription->>'target_power_percentage')::numeric else target_power_percentage end,
              case when v_prescription ? 'surface' then nullif(v_prescription->>'surface', '') else surface end,
              case when v_prescription ? 'terrain' then nullif(v_prescription->>'terrain', '') else terrain end,
              case when v_prescription ? 'equipment_type' then nullif(v_prescription->>'equipment_type', '') else equipment_type end,
              case when v_prescription ? 'coach_notes' then coalesce(v_prescription->>'coach_notes', '') else coach_notes end
            );
        else
          insert into public.training_prescriptions (
                    block_id, exercise_id, set_number, set_type, segment_type, title, position,
          repetitions, work_duration_seconds, distance_meters, elevation_gain_meters, incline_percentage,
          recovery_duration_seconds, recovery_distance_meters, intensity_target_type,
          target_vma_percentage, target_speed_kmh, target_pace_seconds_per_km, target_hr_percentage,
          target_hr_zone, target_power_watts, target_cadence, intensity_min, intensity_max,
          target_zone, target_power_percentage,
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
          (v_prescription->>'target_zone')::smallint,
          (v_prescription->>'target_power_percentage')::numeric,
          nullif(v_prescription->>'surface', ''),
          nullif(v_prescription->>'terrain', ''),
          nullif(v_prescription->>'equipment_type', ''),
          coalesce(v_prescription->>'coach_notes', '')
          ) returning id into v_presc_uuid;
          if v_raw_presc_id is not null then
            v_presc_map := v_presc_map || jsonb_build_object(v_raw_presc_id, v_presc_uuid::text);
          end if;
        end if;

        v_kept_presc_uuids := array_append(v_kept_presc_uuids, v_presc_uuid);
        v_ex_order := v_ex_order + 1;
      end loop;

      /*
       * Suppression BORNÉE À CE BLOC — seules les lignes que le coach a
       * retirées de la liste disparaissent.
       *
       * ⚠️ LA LISTE D'UN BLOC EST EXHAUSTIVE, et c'est ce qui autorise cette
       * suppression. Contrairement aux séances d'une programmation — où
       * « absente de la charge » signifie « inchangée » — l'éditeur détient le
       * bloc ENTIER : une prescription qui n'y figure plus a bien été retirée.
       * Le bornage à `block_id = v_block_uuid` préserve de surcroît
       * l'isolation de portée (`SaveScope`) : un enregistrement `strength` ne
       * touche aucun bloc cardio, puisqu'aucun bloc cardio n'entre dans cette
       * boucle.
       */
      delete from public.training_prescriptions
       where block_id = v_block_uuid
         and id <> all(v_kept_presc_uuids);
    end if;    v_block_pos := v_block_pos + 1;
  end loop;

  -- ── 7. Suppressions TARDIVES, STRICTEMENT BORNÉES À LA PORTÉE ─────────
  --
  -- ⚠️ EN PORTÉE 'cardio', AUCUN EXERCICE N'EST MÊME REGARDÉ. `v_ex_ids_to_delete`
  -- reste vide, le DELETE sur `workout_exercises` n'est pas exécuté, et la
  -- suppression de blocs est filtrée sur `block_type = 'cardio'`. C'est la
  -- raison d'être de cette portée : un enregistrement cardio N'A PAS le pouvoir
  -- de supprimer de la musculation, indépendamment de ce que le client envoie.
  if v_scope = 'cardio' then
    v_ex_ids_to_delete := array[]::uuid[];
  else
    select coalesce(array_agg(id), array[]::uuid[]) into v_ex_ids_to_delete
    from public.workout_exercises
    where session_id = v_session_id and id <> all(v_kept_ex_uuids);
  end if;

  select count(*) into v_detached_feedback_count
  from public.exercise_feedback
  where exercise_id = any(v_ex_ids_to_delete);

  if array_length(v_ex_ids_to_delete, 1) is not null then
    delete from public.workout_exercises where id = any(v_ex_ids_to_delete);
  end if;

  if v_scope = 'all' then
    delete from public.training_blocks
    where session_id = v_session_id and id <> all(v_kept_block_uuids);
  elsif v_scope = 'cardio' then
    delete from public.training_blocks
    where session_id = v_session_id and block_type = 'cardio' and id <> all(v_kept_block_uuids);
  else
    delete from public.training_blocks
    where session_id = v_session_id and block_type <> 'cardio' and id <> all(v_kept_block_uuids);
  end if;

  -- ── 8. session_type dérivé + UPDATE FINAL unique (métadonnées incluses) ─
  --
  -- ⚠️ DÉRIVÉ DE LA SÉANCE TELLE QU'ELLE EST MAINTENANT, PAS DU PAYLOAD. En
  -- portée 'cardio', le payload ne contient aucun bloc de musculation : dériver
  -- le type depuis lui aurait transformé une séance MIXTE en séance « cardio »
  -- à chaque modification d'un bloc cardio — un mensonge sur une séance dont la
  -- musculation est toujours là.
  select
    bool_or(block_type <> 'cardio'),
    bool_or(block_type = 'cardio')
  into v_has_strength, v_has_cardio
  from public.training_blocks where session_id = v_session_id;
  v_has_strength := coalesce(v_has_strength, false);
  v_has_cardio := coalesce(v_has_cardio, false);

  v_derived_type := case
    when not v_has_strength and not v_has_cardio then 'rest'
    when v_has_strength and v_has_cardio then 'mixed'
    when v_has_strength then 'strength'
    else 'cardio'
  end;
  v_column_type := case when v_derived_type = 'rest' then 'strength' else v_derived_type end;

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
        -- ⚠️ LA DATE N'EST TOUCHÉE QUE SI LA CLÉ EST PRÉSENTE. Une séance non
        -- datée (`scheduled_date` NULL) garde son calcul historique ; un patch
        -- qui ne parle pas de date ne peut pas la faire disparaître.
        scheduled_date = case when v_patch ? 'scheduled_date' then nullif(v_patch->>'scheduled_date', '')::date else scheduled_date end,
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
        'sport', tb.sport,
        'rounds', tb.rounds,
        'machineType', tb.machine_type,
        'exercises', case when tb.block_type = 'cardio' then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', we.id, 'order', we.order_index, 'name', we.name, 'sets', we.sets, 'reps', we.reps,
            'restSeconds', we.rest_seconds, 'tempo', we.tempo, 'recommendedLoad', we.recommended_load,
            'recommendedRpe', we.recommended_rpe,
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

  select ws.scheduled_date into v_scheduled_date from public.workout_sessions ws where ws.id = v_session_id;

  return jsonb_build_object(
    'session_id', v_session_id,
    'updated_at', v_new_updated_at,
    'scheduled_date', v_scheduled_date,
    'session_type', v_derived_type,
    'blocks', v_result_blocks,
    'id_mapping', jsonb_build_object('blocks', v_block_map, 'exercises', v_ex_map, 'prescriptions', v_presc_map),
    'warnings', jsonb_build_object('detached_exercise_feedback_count', v_detached_feedback_count)
  );
end;
$fn$;
comment on function public.save_training_session_blocks(jsonb) is
  'Moteur d''écriture canonique multi-blocs v3 (lot D du chantier performances). Identique à la v2 — un seul appel transactionnel, contenu + session_patch écrits après le contrôle STALE — SAUF les prescriptions cardio, désormais synchronisées DIFFÉRENTIELLEMENT : identifiants conservés, mise à jour en place des seules lignes réellement modifiées, insertion des seules nouvelles, suppression des seules lignes retirées. Voir l''en-tête de la migration 20261029090000.';

-- Droits RAPPELÉS à l'identique : jamais public, jamais anon.
revoke execute on function public.save_training_session_blocks(jsonb) from public;
revoke execute on function public.save_training_session_blocks(jsonb) from anon;
grant execute on function public.save_training_session_blocks(jsonb) to authenticated;

-- ── VÉRIFICATION FINALE ─────────────────────────────────────────────────────
-- Catalogue + une preuve PAR L'USAGE. Une migration d'intégrité qui ne tient
-- pas sa promesse doit se voir à l'application.
do $verif$
declare
  v_n int; v_sec boolean; v_path text; v_src text;
begin
  -- 1. La fonction existe, signature inchangée.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_training_session_blocks'
     and p.pronargs = 1 and p.proargtypes[0] = 'jsonb'::regtype;
  if v_n <> 1 then
    raise exception 'save_training_session_blocks(jsonb) absente (% trouvée(s))', v_n;
  end if;

  -- 2. `security invoker` : la RLS DOIT continuer de s'appliquer.
  select p.prosecdef into v_sec from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_training_session_blocks';
  if v_sec then
    raise exception 'save_training_session_blocks est devenue SECURITY DEFINER : la RLS serait contournée';
  end if;

  -- 3. `search_path` figé.
  select array_to_string(p.proconfig, ',') into v_path
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_training_session_blocks';
  if v_path is null or v_path not like 'search_path=%' then
    raise exception 'save_training_session_blocks sans search_path figé (%)', coalesce(v_path, '(null)');
  end if;

  -- 4. Droits bornés.
  if has_function_privilege('public', 'public.save_training_session_blocks(jsonb)', 'execute') then
    raise exception 'save_training_session_blocks exécutable par public';
  end if;
  if has_function_privilege('anon', 'public.save_training_session_blocks(jsonb)', 'execute') then
    raise exception 'save_training_session_blocks exécutable par anon';
  end if;
  if not has_function_privilege('authenticated', 'public.save_training_session_blocks(jsonb)', 'execute') then
    raise exception 'save_training_session_blocks NON exécutable par authenticated';
  end if;

  -- 5. ⚠️ LE DELETE INCONDITIONNEL A DISPARU. C'est la promesse de cette
  --    migration, et elle se lit dans le corps de la fonction.
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_training_session_blocks';
  if v_src like '%delete from public.training_prescriptions where block_id = v_block_uuid;%' then
    raise exception 'le DELETE inconditionnel des prescriptions est encore là : les identifiants changeraient toujours';
  end if;
  if v_src not like '%id <> all(v_kept_presc_uuids)%' then
    raise exception 'la suppression bornée aux prescriptions retirées est absente';
  end if;
  if v_src not like '%FOREIGN_PRESCRIPTION_ID%' then
    raise exception 'le contrôle d''appartenance FOREIGN_PRESCRIPTION_ID est absent';
  end if;
  if v_src not like '%is distinct from row(%' then
    raise exception 'la mise à jour conditionnelle est absente : updated_at bougerait sans modification';
  end if;

  -- 6. `block_id` et `exercise_id` ne sont PAS dans le SET de l'UPDATE : une
  --    prescription ne change jamais de parent.
  if v_src ~ 'update public\.training_prescriptions set[^;]*\m(block_id|exercise_id)\M\s*=' then
    raise exception 'l''UPDATE des prescriptions modifie block_id ou exercise_id : la ligne changerait de parent';
  end if;

  -- 7. ⚠️ LA GARDE DE PRÉSENCE EST EXIGÉE. Sans elle, une charge partielle
  --    mettrait à NULL toutes les colonnes qu'elle ne mentionne pas. On compte
  --    les 25 colonnes issues de la charge : une seule oubliée serait effacée
  --    en silence, et aucun test de bout en bout ne le verrait si le client
  --    envoie toujours tout.
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_training_session_blocks';
  select count(*) into v_n from regexp_matches(v_src, 'case when v_prescription \? ''[a-z_]+'' then', 'g');
  if v_n <> 50 then
    raise exception
      'garde de présence comptée % fois au lieu de 50 (25 colonnes, dans le set ET dans la comparaison) : une charge partielle effacerait les colonnes non gardées', v_n;
  end if;
  -- UN SEUL update des prescriptions : le chemin rapide tenté n'apportait rien
  -- de mesurable et dupliquait une liste de 28 colonnes (voir l'en-tête).
  select count(*) into v_n from regexp_matches(v_src, 'update public\.training_prescriptions set', 'g');
  if v_n <> 1 then
    raise exception 'update des prescriptions : % au lieu de 1', v_n;
  end if;

  -- 8. SI la RPC groupée (lot B) est là, elle appelle toujours ce moteur.
  --
  -- ⚠️ CE CONTRÔLE ÉTAIT UNE SUR-CONTRAINTE, et c'est une correction. Il
  -- exigeait la PRÉSENCE de `save_training_program_sessions` et levait sinon
  -- (« lot B absent ou retiré »). Or ce lot ne dépend pas du lot B : il
  -- remplace `save_training_session_blocks`, dont la signature est inchangée.
  -- Exiger B avait trois conséquences, toutes mauvaises :
  --   · D devenait impossible à appliquer avant B, sans raison technique ;
  --   · un retour arrière sur B seul aurait fait échouer toute réapplication
  --     de D ;
  --   · la migration mentait sur sa propre dépendance, et le plan de
  --     déploiement héritait d'un couplage inexistant.
  --
  -- La vraie propriété à vérifier est l'inverse : que ce lot ne CASSE pas B.
  -- Elle se vérifie quand B est présent, et n'a pas de sens quand il est
  -- absent — d'où le `if found`.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_training_program_sessions';
  if v_n = 1 then
    select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'save_training_program_sessions';
    if v_src not like '%public.save_training_session_blocks(%' then
      raise exception
        'save_training_program_sessions n''appelle plus save_training_session_blocks : le lot B perdrait toutes ses validations métier';
    end if;
    raise notice '20261029090000 — lot B présent, et il appelle toujours ce moteur';
  else
    raise notice '20261029090000 — lot B absent : normal si D est appliqué en premier, aucune dépendance';
  end if;

  raise notice '20261029090000 — 8 contrôles sur 8 verts (diff des prescriptions, security invoker, droits bornés, parents immuables, 25 gardes de présence, lot B non requis)';
end
$verif$;
