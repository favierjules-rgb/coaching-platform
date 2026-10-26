-- ════════════════════════════════════════════════════════════════════════════
-- BANC DE MESURE — SAUVEGARDE GROUPÉE (lots A+B+C+D)
-- Chantier feat/entrainement-performances. Octobre 2026.
-- ════════════════════════════════════════════════════════════════════════════
--
-- CE FICHIER NE MESURE RIEN : il POSE le décor de mesure (constructeurs de
-- charge + procédure de chronométrage). La boucle de répétitions est dans
-- `bench_sauvegarde_groupee.sh`, et le rapport dans
-- `bench_sauvegarde_groupee_rapport.sql`.
--
-- ⚠️ POURQUOI UNE RÉPÉTITION = UNE SESSION PSQL, ET PAS UNE BOUCLE SQL.
-- `statement_timeout` est armé au début de l'INSTRUCTION DE PLUS HAUT NIVEAU.
-- Une boucle `do`/`call` qui enchaînerait 7 sauvegardes serait UNE SEULE
-- instruction : le plafond de 8 s s'appliquerait à leur TOTAL, et les
-- répétitions 2 à 7 échoueraient pour une raison qui n'existe pas en
-- production. Une requête PostgREST = une connexion, une instruction, 8 s.
-- Le pilote reproduit cela : une session par répétition.
--
-- ⚠️ CE BANC NE RELÈVE PAS LE TIMEOUT. Le pilote pose
-- `statement_timeout = 8s`, la valeur EXACTE du rôle `authenticated` en
-- production (relevé du 25/10/2026 : anon 3s, authenticated 8s,
-- authenticator 8s + lock_timeout 8s, service_role aucun). Un dépassement
-- est donc enregistré comme un ÉCHEC 57014, jamais comme une mesure longue.
-- ⚠️ Les mesures antérieures du bac à sable tournaient SANS ce plafond : les
-- 8 661 ms du pire cas y passaient, alors qu'en production la transaction
-- aurait été annulée. Le banc corrige ce biais.
--
-- Décor attendu : `perf_decor_representatif.sql` (volumétrie calquée sur la
-- production). Base de validation isolée UNIQUEMENT. Aucune donnée réelle.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

drop table if exists public.bench_mesures;
create table public.bench_mesures (
  id            bigserial primary key,
  scenario      text    not null,
  rang          int     not null,
  nb_seances    int     not null,
  ms            numeric not null,
  sqlstate      text,
  issue         text    not null,
  mesure_le     timestamptz not null default clock_timestamp()
);
grant all on public.bench_mesures to authenticated;
grant usage, select on sequence public.bench_mesures_id_seq to authenticated;
alter table public.bench_mesures enable row level security;
create policy bench_mesures_tout on public.bench_mesures for all using (true) with check (true);

-- La charge de la répétition courante. Reconstruite AVANT chaque appel, dans
-- une instruction séparée : sa construction ne doit pas entrer dans le temps
-- mesuré (en production, c'est le navigateur qui la construit).
drop table if exists public.bench_charge;
create table public.bench_charge (cle text primary key, charge jsonb not null, nb_seances int not null);
grant all on public.bench_charge to authenticated;
alter table public.bench_charge enable row level security;
create policy bench_charge_tout on public.bench_charge for all using (true) with check (true);

-- ════════════════════════════════════════════════════════════════════════════
-- CONSTRUCTEUR 1 — « modifier les N premières séances »
-- Sérialisation IDENTIQUE à celle du client (`serializeBlock`) : 26 clés par
-- prescription, `id` RÉEL compris. Sans cet `id`, la grammaire du lot D
-- traiterait chaque prescription comme neuve et on mesurerait l'ANCIEN chemin
-- (supprimer/réinsérer) en croyant mesurer le nouveau.
--
-- `p_muter` décide de ce qu'on mesure :
--   false → contenu inchangé. Le cas le PLUS FRÉQUENT (renommer, changer un
--           réglage) : le moteur traverse tout, les gardes `is distinct from`
--           n'écrivent rien.
--   true  → contenu réellement modifié (notes d'exercice ET titres de
--           prescription portent `p_jeton`) : toutes les écritures ont lieu.
--           C'est le pire cas absolu.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.bench_charge_modif(
  p_program uuid, p_n int, p_muter boolean, p_jeton text
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'program_id', p_program,
    'sessions_to_update', coalesce(jsonb_agg(jsonb_build_object(
      'session_id', q.id::text,
      'expected_updated_at', q.updated_at::text,
      'blocks', q.blocs,
      'session_patch', jsonb_build_object('coach_notes', 'banc ' || p_jeton)
    )), '[]'::jsonb))
  from (
    select ws.id, ws.updated_at, coalesce((
      select jsonb_agg(
        case when tb.block_type = 'strength' then
          jsonb_build_object(
            'id', tb.id::text, 'category', 'strength', 'title', tb.title,
            'color_key', tb.color_key, 'position', tb.position,
            'exercises', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'id', we.id::text, 'name', we.name, 'sets', we.sets, 'reps', we.reps,
                  'rest_seconds', we.rest_seconds, 'tempo', we.tempo,
                  'recommended_load', we.recommended_load, 'recommended_rpe', '',
                  'video_url', we.video_url,
                  'notes', case when p_muter then we.notes || ' ' || p_jeton else we.notes end,
                  'muscle_group', we.muscle_group, 'exercise_library_id', null)
                order by we.order_index)
              from public.workout_exercises we where we.block_id = tb.id), '[]'::jsonb))
        else
          jsonb_build_object(
            'id', tb.id::text, 'category', 'cardio', 'title', tb.title,
            'color_key', tb.color_key, 'position', tb.position,
            'cardio_type', tb.cardio_type, 'machine_type', null,
            'sport', null, 'rounds', null,
            'prescriptions', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'id', tp.id::text,
                  'segment_type', tp.segment_type,
                  'title', case when p_muter then coalesce(tp.title,'') || ' ' || p_jeton else tp.title end,
                  'repetitions', tp.repetitions,
                  'work_duration_seconds', tp.work_duration_seconds,
                  'distance_meters', tp.distance_meters,
                  'elevation_gain_meters', tp.elevation_gain_meters,
                  'incline_percentage', tp.incline_percentage,
                  'recovery_duration_seconds', tp.recovery_duration_seconds,
                  'recovery_distance_meters', tp.recovery_distance_meters,
                  'intensity_target_type', tp.intensity_target_type,
                  'target_vma_percentage', tp.target_vma_percentage,
                  'target_speed_kmh', tp.target_speed_kmh,
                  'target_pace_seconds_per_km', tp.target_pace_seconds_per_km,
                  'target_hr_percentage', tp.target_hr_percentage,
                  'target_hr_zone', tp.target_hr_zone,
                  'target_power_watts', tp.target_power_watts,
                  'target_cadence', tp.target_cadence,
                  'intensity_min', tp.intensity_min,
                  'intensity_max', tp.intensity_max,
                  'target_zone', tp.target_zone,
                  'target_power_percentage', tp.target_power_percentage,
                  'surface', tp.surface,
                  'terrain', tp.terrain,
                  'equipment_type', tp.equipment_type,
                  'coach_notes', tp.coach_notes)
                order by tp.position)
              from public.training_prescriptions tp where tp.block_id = tb.id), '[]'::jsonb))
        end order by tb.position)
      from public.training_blocks tb where tb.session_id = ws.id), '[]'::jsonb) as blocs
    from public.workout_sessions ws
    join public.program_weeks pw on pw.id = ws.program_week_id
    where pw.program_id = p_program
    order by pw.week_number, ws.day
    limit p_n
  ) q;
$$;
grant execute on function public.bench_charge_modif(uuid,int,boolean,text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- CONSTRUCTEUR 2 — « ajouter une semaine par duplication »
-- Copie les séances de la semaine source dans une semaine CIBLE qui n'existe
-- pas encore : `weeks_to_create` + `sessions_to_create`, blocs/exercices SANS
-- `id` (lignes neuves) et prescriptions en identifiants TEMPORAIRES
-- `new-prescription:<uuid>` — exactement ce que produit `duplicateBlock` après
-- le lot D. Le chemin de création est donc mesuré AVEC la grammaire du lot D,
-- pas à côté d'elle.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.bench_charge_duplication(
  p_program uuid, p_semaine_source int, p_semaine_cible int
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'program_id', p_program,
    'weeks_to_create', jsonb_build_array(p_semaine_cible),
    'sessions_to_create', coalesce(jsonb_agg(jsonb_build_object(
      'client_id', 'dup-' || p_semaine_cible || '-' || q.day,
      'week_number', p_semaine_cible,
      'day', q.day,
      'is_rest_day', q.is_rest_day,
      'name', q.name,
      'muscle_group', q.muscle_group,
      'duration_minutes', q.duration_minutes,
      'warmup', q.warmup,
      'coach_notes', q.coach_notes,
      'session_type', q.session_type,
      'blocks', q.blocs
    )), '[]'::jsonb))
  from (
    select ws.day, ws.is_rest_day, ws.name, ws.muscle_group, ws.duration_minutes,
           ws.warmup, ws.coach_notes, ws.session_type,
           coalesce((
      select jsonb_agg(
        case when tb.block_type = 'strength' then
          jsonb_build_object(
            'id', 'new-block:' || gen_random_uuid()::text,
            'category', 'strength', 'title', tb.title,
            'color_key', tb.color_key, 'position', tb.position,
            'exercises', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'id', 'new-exercise:' || gen_random_uuid()::text,
                  'name', we.name, 'sets', we.sets, 'reps', we.reps,
                  'rest_seconds', we.rest_seconds, 'tempo', we.tempo,
                  'recommended_load', we.recommended_load, 'recommended_rpe', '',
                  'video_url', we.video_url, 'notes', we.notes,
                  'muscle_group', we.muscle_group, 'exercise_library_id', null)
                order by we.order_index)
              from public.workout_exercises we where we.block_id = tb.id), '[]'::jsonb))
        else
          jsonb_build_object(
            'id', 'new-block:' || gen_random_uuid()::text,
            'category', 'cardio', 'title', tb.title,
            'color_key', tb.color_key, 'position', tb.position,
            'cardio_type', tb.cardio_type, 'machine_type', null,
            'sport', null, 'rounds', null,
            'prescriptions', coalesce((
              select jsonb_agg(jsonb_build_object(
                  -- identifiant TEMPORAIRE : la duplication ne réutilise jamais
                  -- l'identifiant persistant de la source (sinon
                  -- FOREIGN_PRESCRIPTION_ID, cf. lot D contrôle 4).
                  'id', 'new-prescription:' || gen_random_uuid()::text,
                  'segment_type', tp.segment_type, 'title', tp.title,
                  'repetitions', tp.repetitions,
                  'work_duration_seconds', tp.work_duration_seconds,
                  'distance_meters', tp.distance_meters,
                  'elevation_gain_meters', tp.elevation_gain_meters,
                  'incline_percentage', tp.incline_percentage,
                  'recovery_duration_seconds', tp.recovery_duration_seconds,
                  'recovery_distance_meters', tp.recovery_distance_meters,
                  'intensity_target_type', tp.intensity_target_type,
                  'target_vma_percentage', tp.target_vma_percentage,
                  'target_speed_kmh', tp.target_speed_kmh,
                  'target_pace_seconds_per_km', tp.target_pace_seconds_per_km,
                  'target_hr_percentage', tp.target_hr_percentage,
                  'target_hr_zone', tp.target_hr_zone,
                  'target_power_watts', tp.target_power_watts,
                  'target_cadence', tp.target_cadence,
                  'intensity_min', tp.intensity_min,
                  'intensity_max', tp.intensity_max,
                  'target_zone', tp.target_zone,
                  'target_power_percentage', tp.target_power_percentage,
                  'surface', tp.surface, 'terrain', tp.terrain,
                  'equipment_type', tp.equipment_type, 'coach_notes', tp.coach_notes)
                order by tp.position)
              from public.training_prescriptions tp where tp.block_id = tb.id), '[]'::jsonb))
        end order by tb.position)
      from public.training_blocks tb where tb.session_id = ws.id), '[]'::jsonb) as blocs
    from public.workout_sessions ws
    join public.program_weeks pw on pw.id = ws.program_week_id
    where pw.program_id = p_program and pw.week_number = p_semaine_source
    order by ws.day
  ) q;
$$;
grant execute on function public.bench_charge_duplication(uuid,int,int) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- CHRONOMÈTRE — un appel, un commit, un verdict.
-- La construction de la charge est DÉJÀ faite (table `bench_charge`) : seul
-- l'appel RPC est dans la fenêtre mesurée, comme en production.
-- Un échec est enregistré avec son SQLSTATE : 57014 = plafond de 8 s atteint,
-- transaction annulée. Il n'est JAMAIS compté comme une mesure réussie.
-- ════════════════════════════════════════════════════════════════════════════
create or replace procedure public.bench_mesurer(p_cle text, p_scenario text, p_rang int)
language plpgsql as $$
declare v_t timestamptz; v_charge jsonb; v_n int;
begin
  select charge, nb_seances into v_charge, v_n from public.bench_charge where cle = p_cle;
  if v_charge is null then
    raise exception 'BANC: charge % absente', p_cle;
  end if;
  v_t := clock_timestamp();
  begin
    perform public.save_training_program_sessions(v_charge);
    insert into public.bench_mesures (scenario, rang, nb_seances, ms, sqlstate, issue)
    values (p_scenario, p_rang, v_n,
            round(extract(epoch from (clock_timestamp() - v_t)) * 1000, 1), null, 'ok');
  exception when others then
    insert into public.bench_mesures (scenario, rang, nb_seances, ms, sqlstate, issue)
    values (p_scenario, p_rang, v_n,
            round(extract(epoch from (clock_timestamp() - v_t)) * 1000, 1), sqlstate, sqlerrm);
  end;
  commit;
end $$;
grant execute on procedure public.bench_mesurer(text,text,int) to authenticated;

\echo 'BANC PRÊT — bench_mesures, bench_charge, bench_charge_modif, bench_charge_duplication, bench_mesurer'
