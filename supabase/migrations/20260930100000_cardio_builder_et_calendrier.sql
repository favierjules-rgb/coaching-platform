-- ════════════════════════════════════════════════════════════════════════════
-- Migration 20260930100000 — BLOC CARDIO COMPLET + CALENDRIER ATHLÈTE DATÉ
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ CETTE MIGRATION N'A PAS ÉTÉ APPLIQUÉE. Fichier créé le 28/09/2026 ; aucun
-- `supabase db push` n'a été exécuté. Elle attend une demande explicite.
--
-- ⚠️ VERSION POSTÉRIEURE À LA DERNIÈRE MIGRATION APPLIQUÉE
-- (20260929090000_notifications_grants). Le numéro initial, 20260928120000,
-- était ANTÉRIEUR : `supabase db push` l'aurait refusé comme migration
-- « out of order », ou l'aurait sautée.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QU'ELLE N'AJOUTE PAS, PARCE QUE ÇA EXISTE DÉJÀ (audit du 28/09/2026)
-- ════════════════════════════════════════════════════════════════════════════
--   · `training_blocks.rounds` (integer, nullable) EXISTE depuis
--     20260716075715 et porte 0 ligne. Les « séries » d'un bloc cardio vont
--     dedans : créer une colonne `cardio_rounds` aurait fabriqué un doublon ;
--   · `training_blocks.color_key` porte déjà la couleur du bloc (CHECK sur
--     7 valeurs) ;
--   · `training_prescriptions` porte déjà work_duration_seconds,
--     distance_meters, repetitions, recovery_*, target_vma_percentage,
--     target_speed_kmh, target_pace_seconds_per_km, target_hr_percentage,
--     target_hr_zone, target_power_watts, intensity_min/max ;
--   · les segments « effort » et « contre-effort » EXISTENT déjà dans le
--     vocabulaire de `segment_type` sous les noms `work` et `recovery`
--     (20260716075715). Cette migration n'en crée donc PAS de nouveaux :
--     elle ajoute seulement `warmup` et `cooldown`, qui manquaient.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QU'ELLE AJOUTE, ET POURQUOI IL N'Y AVAIT PAS D'AUTRE CHOIX
-- ════════════════════════════════════════════════════════════════════════════
-- 1. `workout_sessions.scheduled_date date` — LA SÉANCE N'A AUCUNE DATE
--    AUJOURD'HUI. Elle porte `program_week_id` + `day` (« Lundi »), et la date
--    réelle est RECALCULÉE à l'affichage depuis
--    `assignments.program_start_date`. Ce calcul reste la référence pour les
--    847 séances existantes : la colonne est NULLABLE et SANS DÉFAUT, et NULL
--    veut dire « date calculée », jamais « pas de date ».
--
-- 2. `training_blocks.sport` — AUCUNE COLONNE NE PORTE LE SPORT. `cardio_type`
--    est un vocabulaire de course à pied (continuous_run, vma_intervals, …) et
--    `machine_type` désigne une machine de salle. Or « Z3 » n'a aucun sens sans
--    sport : la même zone se lit en % VMA course, en % FTP vélo ou en % VMA
--    natation, contre trois références physiologiques DIFFÉRENTES. Sans cette
--    colonne, un bloc prescrit en zones serait interprété au hasard.
--
-- 3. `training_prescriptions.target_zone smallint` — une prescription « Z4 »
--    n'était représentable que par le TEXTE LIBRE `target_hr_zone`, où la
--    production porte déjà « Zone 3 », « Zone 2 » et « 1-2 » (343 lignes).
--    Un entier contraint 1..7 rend la zone calculable ; le texte libre est
--    CONSERVÉ tel quel, aucune ligne n'est réécrite.
--
-- 4. `training_prescriptions.target_power_percentage numeric` — %FTP et %PMA
--    n'avaient AUCUN support. `target_power_watts` est une valeur absolue, et
--    `intensity_min` porte déjà le RPE dans le builder existant : y ranger un
--    pourcentage de puissance aurait donné deux sens à une même colonne. Le
--    référentiel visé (FTP ou PMA) est lu dans `intensity_target_type`
--    (`ftp_percentage` / `pma_percentage`), qui est étendu ci-dessous.
--
-- 5. `save_training_session_blocks` recréée (create or replace, SIGNATURE
--    INCHANGÉE) pour écrire et relire ces champs. Le corps est celui de la
--    migration 20260803190000, À L'IDENTIQUE hors les ajouts listés — mêmes
--    gardes : security invoker, search_path vide, `is_coach_or_admin`, verrou
--    `for update`, contrôle `STALE_TRAINING_SESSION`, validation stricte des
--    ids et de `session_patch`, revoke public/anon, grant authenticated.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 6. LA PORTÉE DE SAUVEGARDE — LA CORRECTION DEMANDÉE LE 28/09/2026
-- ════════════════════════════════════════════════════════════════════════════
-- AVANT : `save_training_session_blocks` remplaçait TOUJOURS la séance entière.
-- Mesuré sur PostgreSQL 16 : un payload ne portant que le bloc cardio faisait
-- passer `workout_exercises` de 1 à 0 et `training_blocks` de 2 à 1. Un
-- enregistrement cardio avait donc le POUVOIR IMPLICITE de supprimer la
-- musculation de la même séance ; seule la bonne tenue du client l'en empêchait.
--
-- MAINTENANT : le payload porte `scope`.
--
--   · `scope` absent ou 'all'  → comportement INCHANGÉ (remplacement complet).
--     C'est ce que fait le builder de séance historique, qui détient bien la
--     séance entière ; aucun appelant existant n'a à être modifié.
--
--   · `scope = 'cardio'`       → SEULS les blocs cardio sont créés, modifiés et
--     supprimés. La fonction :
--       – REFUSE (`SCOPE_VIOLATION`) tout bloc `strength` dans le payload ;
--       – REFUSE tout UUID de bloc qui n'est pas déjà un bloc cardio de cette
--         séance (sans quoi un UPDATE aurait pu basculer le `block_type` d'un
--         bloc de musculation et orphelinner ses exercices) ;
--       – ne construit AUCUNE liste d'exercices à supprimer et n'exécute PAS le
--         DELETE sur `workout_exercises` ;
--       – borne la suppression de blocs à `block_type = 'cardio'`.
--     Aucune ligne de musculation n'est lue pour suppression, écrite, ni même
--     repositionnée.
--
--   · `scope = 'strength'`     → l'exact symétrique : `training_prescriptions`
--     et les blocs cardio ne sont jamais touchés.
--
-- ⚠️ HORS PORTÉE 'all', LA POSITION DE CHAQUE BLOC EST OBLIGATOIRE
-- (`MISSING_BLOCK_POSITION`). Le payload ne contient qu'une catégorie : l'ordre
-- complet de la séance n'en est pas déductible, et le déduire de l'index du
-- tableau écraserait l'entrelacement muscu/cardio/muscu.
--
-- ⚠️ `session_type` EST DÉSORMAIS DÉRIVÉ DE LA SÉANCE EN BASE, pas du payload.
-- Sinon une modification cardio sur une séance mixte l'aurait réétiquetée
-- « cardio » alors que sa musculation est toujours là.
--
-- RÉORDONNER À TRAVERS LES CATÉGORIES (glisser un bloc cardio entre deux blocs
-- de musculation) reste l'affaire d'un enregistrement 'all' : c'est la seule
-- opération qui a légitimement besoin d'écrire les deux catégories.
--
-- Ne modifie AUCUNE migration déjà appliquée, AUCUNE ligne existante.
-- NE PAS exécuter en production sans runbook validé.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. LA SÉANCE PEUT PORTER SA DATE ────────────────────────────────────────

alter table public.workout_sessions
  add column if not exists scheduled_date date;

comment on column public.workout_sessions.scheduled_date is
  'Date réelle de la séance. NULL = date CALCULÉE (assignments.program_start_date + 7 × (semaine − 1) + index du jour), qui reste la règle pour toutes les séances existantes. Renseignée, elle prime : c''est ce qui permet de déplacer une séance sans toucher au programme.';

-- Index partiel : seules les séances DATÉES sont interrogées par date, et il y
-- en a zéro aujourd'hui. Un index complet porterait 847 lignes NULL pour rien.
create index if not exists workout_sessions_scheduled_date_idx
  on public.workout_sessions (program_id, scheduled_date)
  where scheduled_date is not null;

-- ── 2. LE BLOC CARDIO PORTE SON SPORT ───────────────────────────────────────

alter table public.training_blocks
  add column if not exists sport text;

alter table public.training_blocks
  drop constraint if exists training_blocks_sport_check;
alter table public.training_blocks
  add constraint training_blocks_sport_check
  check (sport is null or sport = any (array['course','velo','natation','autre']));

comment on column public.training_blocks.sport is
  'Sport du bloc cardio : course, velo, natation, autre. NULL sur les 441 blocs cardio existants — ils gardent leur lecture actuelle (cardio_type/machine_type) et AUCUNE valeur n''est devinée pour eux. Indispensable dès qu''une prescription est exprimée en zone ou en pourcentage : la même zone se convertit contre trois références différentes.';

-- ── 3. SEGMENTS : ÉCHAUFFEMENT ET RETOUR AU CALME ───────────────────────────
--
-- ⚠️ `work` ET `recovery` NE SONT PAS RECRÉÉS. Ils existent depuis
-- 20260716075715 et portent déjà « effort » et « contre-effort » — les tests
-- SQL du dépôt s'en servent (supabase/tests/save_training_session_blocks_test.sql).
-- Inventer `effort` et `counter_effort` aurait donné deux noms à une seule
-- notion, et rendu incohérentes les lignes déjà écrites.

alter table public.training_prescriptions
  drop constraint if exists training_prescriptions_segment_type_check;
alter table public.training_prescriptions
  add constraint training_prescriptions_segment_type_check
  check (segment_type is null or segment_type = any (array[
    'single','repeat_group','work','recovery','ramp_up','ramp_down','warmup','cooldown'
  ]));

-- ── 4. INTENSITÉS : ZONE, %FTP, %PMA ────────────────────────────────────────

alter table public.training_prescriptions
  drop constraint if exists training_prescriptions_intensity_target_type_check;
alter table public.training_prescriptions
  add constraint training_prescriptions_intensity_target_type_check
  check (intensity_target_type is null or intensity_target_type = any (array[
    'vma_percentage','speed_kmh','pace','heart_rate_zone','heart_rate_percentage',
    'rpe','power','race_pace','free','custom','zone','ftp_percentage','pma_percentage'
  ]));

alter table public.training_prescriptions
  add column if not exists target_zone smallint,
  add column if not exists target_power_percentage numeric;

alter table public.training_prescriptions
  drop constraint if exists training_prescriptions_target_zone_check;
alter table public.training_prescriptions
  add constraint training_prescriptions_target_zone_check
  check (target_zone is null or (target_zone >= 1 and target_zone <= 7));

comment on column public.training_prescriptions.target_zone is
  'Zone d''intensité prescrite, 1 à 7 (barème iDO — lib/zones-physiologiques.ts). Le texte libre `target_hr_zone` est CONSERVÉ pour les 343 lignes de production qui l''utilisent : aucune n''est réécrite, aucune n''est devinée.';
comment on column public.training_prescriptions.target_power_percentage is
  'Pourcentage de puissance prescrit. Le référentiel (FTP ou PMA) est porté par `intensity_target_type` = ftp_percentage | pma_percentage. Distinct de `target_power_watts` (valeur absolue) et de `intensity_min` (qui porte déjà le RPE dans le builder existant).';

-- ── 5. LA RPC D'ÉCRITURE : v5, PORTÉE PAR CATÉGORIE ────────────────────────

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
      delete from public.training_prescriptions where block_id = v_block_uuid;
      v_ex_order := 0;
      for v_prescription in select * from jsonb_array_elements(coalesce(v_block->'prescriptions', '[]'::jsonb)) loop
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
        );
        v_ex_order := v_ex_order + 1;
      end loop;
    end if;

    v_block_pos := v_block_pos + 1;
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
    'id_mapping', jsonb_build_object('blocks', v_block_map, 'exercises', v_ex_map),
    'warnings', jsonb_build_object('detached_exercise_feedback_count', v_detached_feedback_count)
  );
end;
$fn$;

comment on function public.save_training_session_blocks(jsonb) is
  'Moteur d''écriture canonique multi-blocs v5 : v3 (20260803190000, recommended_rpe) + sport et rounds du bloc cardio, target_zone et target_power_percentage des prescriptions, scheduled_date dans session_patch, et PORTÉE `scope` (all | cardio | strength). Signature et gardes inchangées. `scope` absent = ''all'' = comportement historique (remplacement complet de la séance). En portée ''cardio'', aucune ligne de musculation n''est supprimée, modifiée ni repositionnée — et l''inverse en portée ''strength''. Voir l''en-tête de la migration.';

revoke execute on function public.save_training_session_blocks(jsonb) from public;
revoke execute on function public.save_training_session_blocks(jsonb) from anon;
grant execute on function public.save_training_session_blocks(jsonb) to authenticated;

commit;
