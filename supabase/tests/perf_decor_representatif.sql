-- ════════════════════════════════════════════════════════════════════════════
-- DÉCOR DE MESURE — volumétrie calquée sur la PRODUCTION (relevé 24/10/2026) :
--   29 programmes · 199 semaines · 1 395 séances · 1 417 blocs
--   5 074 exercices · 666 prescriptions
-- ⚠️ BASE DE VALIDATION ISOLÉE UNIQUEMENT — JAMAIS LA PRODUCTION. Ce fichier
-- ÉCRIT : 29 programmes, 199 semaines, 1 393 séances, 1 196 blocs, 4 975
-- exercices et 603 prescriptions, plus une identité coach dans auth.users,
-- profiles et coaches. Aucune donnée réelle n'est lue, mais l'appliquer sur la
-- production y injecterait tout ce décor. Les identifiants sont déterministes
-- (33330000-…, 55550000-…, 88880000-…) précisément pour être reconnaissables.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

-- ── Identités ──────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'coach@test.local')
on conflict (id) do nothing;

insert into public.profiles (id, user_id, email, role, first_name, last_name, phone)
values ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
        'coach@test.local', 'admin', 'Coach', 'Test', '')
on conflict (id) do update set role = 'admin';

insert into public.coaches (id, user_id, name, role, status, specialty, email)
values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
        'Coach Test', 'admin', 'actif', 'musculation', 'coach@test.local')
on conflict (id) do nothing;

-- ── 29 programmes ──────────────────────────────────────────────────────────
insert into public.programs (id, coach_id, name, goal, level, duration_weeks, status, publication_status)
select
  ('33330000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  '22222222-2222-4222-8222-222222222222',
  'Programme ' || g, 'hypertrophie', 'intermédiaire', 12, 'actif', 'published'
from generate_series(1, 29) g;

-- ── 199 semaines : 12 sur le programme 1 (la cible mesurée), le reste réparti ─
insert into public.program_weeks (id, program_id, week_number)
select
  ('44440000-0000-4000-8000-' || lpad(r::text, 12, '0'))::uuid,
  ('33330000-0000-4000-8000-' || lpad(prog::text, 12, '0'))::uuid,
  semaine
from (
  select 1 as prog, s as semaine, s as r from generate_series(1, 12) s
  union all
  select 2 + ((s - 1) / 7) as prog, 1 + ((s - 1) % 7) as semaine, 12 + s as r
  from generate_series(1, 187) s
) q;

-- ── 1 395 séances : 7 par semaine ──────────────────────────────────────────
insert into public.workout_sessions
  (id, program_id, program_week_id, day, is_rest_day, name, muscle_group, duration_minutes, warmup, coach_notes, session_type)
select
  ('55550000-0000-4000-8000-' || lpad(row_number() over (order by w.id, d)::text, 12, '0'))::uuid,
  w.program_id, w.id,
  (array['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'])[d],
  d >= 6,
  case when d >= 6 then 'Repos' else 'Séance ' || d end,
  'haut du corps', 60, '10 min vélo', 'Garde le dos droit',
  'strength'
from public.program_weeks w
cross join generate_series(1, 7) d
limit 1395;

-- ── 1 417 blocs : 1 muscu par jour d'entraînement + 1 cardio 1 jour sur 5 ──
insert into public.training_blocks (id, session_id, block_type, title, color_key, position)
select
  ('66660000-0000-4000-8000-' || lpad(row_number() over (order by s.id)::text, 12, '0'))::uuid,
  s.id, 'strength', 'Bloc musculation', 'blue', 0
from public.workout_sessions s
where not s.is_rest_day;

insert into public.training_blocks (id, session_id, block_type, title, color_key, position, cardio_type)
select
  ('67670000-0000-4000-8000-' || lpad(row_number() over (order by s.id)::text, 12, '0'))::uuid,
  s.id, 'cardio', 'Bloc cardio', 'green', 1, 'continuous_run'
from public.workout_sessions s
where not s.is_rest_day
  and (('x' || substr(replace(s.id::text,'-',''), 25, 8))::bit(32)::int) % 5 = 0;

-- ── 5 074 exercices : 5 par bloc musculation ───────────────────────────────
insert into public.workout_exercises
  (id, session_id, block_id, name, sets, reps, rest_seconds, tempo, recommended_load, video_url, notes, muscle_group, order_index)
select
  ('77770000-0000-4000-8000-' || lpad(row_number() over (order by b.id, k)::text, 12, '0'))::uuid,
  b.session_id, b.id,
  'Exercice ' || k, 4, '8-10', 90, '2-0-2', '70%', '', 'Contrôle la descente', 'pectoraux', k - 1
from public.training_blocks b
cross join generate_series(1, 5) k
where b.block_type = 'strength';

-- ── 666 prescriptions : 3 par bloc cardio ──────────────────────────────────
insert into public.training_prescriptions
  (id, block_id, segment_type, title, work_duration_seconds, intensity_target_type, set_number, set_type, load_unit, load_input_mode, coach_notes, position, data_source)
select
  ('88880000-0000-4000-8000-' || lpad(row_number() over (order by b.id, k)::text, 12, '0'))::uuid,
  b.id, 'work', 'Segment ' || k, 600, 'heart_rate_percentage', k, 'normal', 'kg', 'total', '', k - 1, 'manual'
from public.training_blocks b
cross join generate_series(1, 3) k
where b.block_type = 'cardio';

commit;

\echo '════ VOLUMÉTRIE DU DÉCOR ════'
select 'programs' t, count(*) n from public.programs
union all select 'program_weeks', count(*) from public.program_weeks
union all select 'workout_sessions', count(*) from public.workout_sessions
union all select 'training_blocks', count(*) from public.training_blocks
union all select 'workout_exercises', count(*) from public.workout_exercises
union all select 'training_prescriptions', count(*) from public.training_prescriptions;

analyze;
