-- ============================================================================
-- RECONSTRUCTION DE SCHÉMA — POUR LE PROJET SUPABASE DE TEST UNIQUEMENT
-- ============================================================================
-- ⚠️ NE JAMAIS EXÉCUTER SUR LA PRODUCTION. Ce script recrée, sur un projet
-- Supabase gratuit ISOLÉ, la structure minimale mais FIDÈLE nécessaire pour
-- valider la RPC save_training_session_blocks (Lot 3A) et son pgTAP.
--
-- PROVENANCE : chaque définition des 6 tables « sous test » (workout_sessions,
-- training_blocks, training_prescriptions, workout_exercises, exercise_feedback,
-- workout_feedback) + fonctions (is_coach_or_admin, current_student_id,
-- set_updated_at) provient d'une introspection LECTURE SEULE de la production
-- (pg_catalog / pg_get_*def), le 2026-07-22. Rien n'a été deviné.
--
-- TABLES DE SUPPORT (students, profiles, programs, program_weeks, assignments,
-- exercise_library) : recréées en version MINIMALE — uniquement les colonnes
-- NOT NULL réelles + celles utilisées par les seeds/policies. Les clés
-- étrangères sortantes vers des tables hors périmètre (coaches,
-- subscription_templates) sont VOLONTAIREMENT OMISES (déviation documentée) ;
-- les FK vers auth.users (natif Supabase) sont conservées. Ces tables ne sont
-- pas « sous test », seulement des échafaudages pour satisfaire inserts + FK +
-- policies.
--
-- ORDRE : extensions → fonctions utilitaires → support → 6 tables cœur → RLS →
-- policies → grants. La migration RPC (20260721224252) et le pgTAP sont
-- exécutés APRÈS ce script, séparément.
--
-- STATUT : bootstrap de TEST uniquement. Ce fichier N'EST PAS un baseline
-- officiel du dépôt, N'EST PAS une migration de production et ne remplace PAS
-- supabase/schema.sql (traité à part dans le futur « Lot migration-baseline »).
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pgtap with schema public;  -- harnais de test (public : appels non qualifiés)

-- Les fonctions SQL ci-dessous référencent des tables créées plus bas ;
-- on diffère la validation de leur corps (technique standard pg_dump).
set check_function_bodies = off;

-- ── Fonctions utilitaires (copie fidèle de la prod) ─────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_coach_or_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role in ('coach', 'admin')
  );
$$;

create or replace function public.current_student_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select id from public.students where user_id = auth.uid();
$$;

-- ── Tables de support (minimales, FK hors-périmètre omises) ──────────────────
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text unique
);

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  goal text,
  level text,
  duration_weeks integer,
  description text,
  status text,
  publication_status text          -- lue par les policies « select_assigned_student »
);

create table if not exists public.program_weeks (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  week_number integer not null,
  unique (program_id, week_number)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  content_type text not null,
  content_id uuid not null,
  unique (student_id, content_type, content_id)
);

create table if not exists public.exercise_library (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

-- ── workout_sessions (structure prod actuelle) ──────────────────────────────
create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  program_week_id uuid not null references public.program_weeks(id) on delete cascade,
  day text not null,
  is_rest_day boolean not null default false,
  name text not null default ''::text,
  muscle_group text not null default ''::text,
  duration_minutes integer,
  warmup text not null default ''::text,
  coach_notes text not null default ''::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  session_type text not null default 'strength'::text
    check (session_type = any (array['strength'::text,'cardio'::text,'mixed'::text])),
  banner_url text
);

-- ── workout_exercises (structure prod actuelle : block_id + superset_label) ──
create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  order_index integer not null default 1,
  name text not null,
  sets integer not null default 0,
  reps text not null default ''::text,
  rest_seconds integer not null default 0,
  tempo text not null default ''::text,
  recommended_load text not null default ''::text,
  video_url text not null default ''::text,
  notes text not null default ''::text,
  muscle_group text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  exercise_library_id uuid references public.exercise_library(id) on delete set null,
  block_id uuid,                    -- FK ajoutée après training_blocks (ci-dessous)
  superset_label text
);

-- ── training_blocks (colonnes WOD/Hyrox conservées à l'identique) ───────────
create table if not exists public.training_blocks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  block_type text not null default 'standard'::text
    check (block_type = any (array['standard','warmup','strength','superset','tri_set','giant_set','circuit','emom','amrap','interval','cooldown','benchmark','custom','cardio']::text[])),
  title text not null default ''::text,
  description text not null default ''::text,
  scoring_type text,
  color_key text not null default 'gray'::text
    check (color_key = any (array['gray','red','orange','yellow','green','blue','purple']::text[])),
  rounds integer,
  time_cap_seconds integer,
  duration_seconds integer,
  work_seconds integer,
  rest_seconds integer,
  rest_between_rounds_seconds integer,
  emom_minutes integer,
  position integer not null default 1,
  media_path text,
  version_number integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cardio_type text
    check (cardio_type is null or cardio_type = any (array['continuous_run','easy_run','long_run','tempo_run','threshold_intervals','vma_intervals','short_intervals','long_intervals','fartlek','hill_repeats','sprint_repeats','run_walk','warmup_run','cooldown_run','race_pace','time_trial','vma_test','luc_leger','hyrox_run','cardio_machine','custom_cardio']::text[])),
  machine_type text
    check (machine_type is null or machine_type = any (array['treadmill','bike','rower','skierg','elliptical','air_bike','stepper','other']::text[]))
);

-- FK différées de workout_exercises.block_id (training_blocks existe désormais)
do $$ begin
  alter table public.workout_exercises
    add constraint workout_exercises_block_id_fkey
    foreign key (block_id) references public.training_blocks(id) on delete cascade;
exception when duplicate_object then null; end $$;

create index if not exists workout_exercises_block_id_idx on public.workout_exercises using btree (block_id);
create index if not exists training_blocks_session_id_idx on public.training_blocks using btree (session_id);

-- ── training_prescriptions (53 colonnes, à l'identique de la prod) ───────────
create table if not exists public.training_prescriptions (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid references public.workout_exercises(id) on delete cascade,
  set_number integer not null,
  set_type text not null default 'normal'::text
    check (set_type = any (array['normal','warmup','top_set','back_off','failure','optional']::text[])),
  target_reps integer,
  reps_min integer,
  reps_max integer,
  duration_seconds integer,
  distance_meters numeric,
  target_load numeric,
  load_unit text not null default 'kg'::text
    check (load_unit = any (array['kg','lb']::text[])),
  load_input_mode text not null default 'total'::text
    check (load_input_mode = any (array['total','per_side','per_implement']::text[])),
  target_percentage numeric,
  target_rpe numeric check (target_rpe is null or (target_rpe >= 0 and target_rpe <= 10)),
  target_rir numeric check (target_rir is null or (target_rir >= 0 and target_rir <= 10)),
  bodyweight_percentage numeric,
  tempo_eccentric text,
  tempo_bottom_pause text,
  tempo_concentric text,
  tempo_top_pause text,
  rest_seconds integer,
  coach_notes text not null default ''::text,
  position integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  block_id uuid references public.training_blocks(id) on delete cascade,
  parent_prescription_id uuid references public.training_prescriptions(id) on delete cascade,
  segment_type text
    check (segment_type is null or segment_type = any (array['single','repeat_group','work','recovery','ramp_up','ramp_down']::text[])),
  title text,
  elevation_gain_meters numeric,
  repetitions integer,
  work_duration_seconds integer,
  recovery_duration_seconds integer,
  recovery_distance_meters numeric,
  set_recovery_seconds integer,
  intensity_target_type text
    check (intensity_target_type is null or intensity_target_type = any (array['vma_percentage','speed_kmh','pace','heart_rate_zone','heart_rate_percentage','rpe','power','race_pace','free','custom']::text[])),
  target_vma_percentage numeric,
  target_speed_kmh numeric,
  target_pace_seconds_per_km integer,
  target_hr_percentage numeric,
  target_hr_zone text,
  target_power_watts numeric,
  target_cadence numeric,
  incline_percentage numeric,
  intensity_min numeric,
  intensity_max numeric,
  surface text,
  terrain text,
  equipment_type text,
  data_source text not null default 'manual'::text
    check (data_source = any (array['manual','garmin','apple_health','strava','coros','polar','other']::text[])),
  external_activity_id text,
  imported_at timestamptz,
  raw_summary jsonb,
  constraint training_prescriptions_exercise_or_block_check
    check ((exercise_id is not null) or (block_id is not null)),
  constraint training_prescriptions_exercise_id_set_number_key unique (exercise_id, set_number)
);

create index if not exists idx_training_prescriptions_block_id on public.training_prescriptions using btree (block_id);
create index if not exists idx_training_prescriptions_parent on public.training_prescriptions using btree (parent_prescription_id);
create index if not exists training_prescriptions_exercise_id_idx on public.training_prescriptions using btree (exercise_id);

-- ── workout_feedback / exercise_feedback (cibles de détachement SET NULL) ────
create table if not exists public.workout_feedback (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  session_id uuid references public.workout_sessions(id) on delete set null,
  program_id uuid references public.programs(id) on delete set null,
  completed boolean not null default false,
  global_rpe integer check (global_rpe >= 1 and global_rpe <= 10),
  global_comment text not null default ''::text,
  pain text not null default ''::text,
  status text not null default 'a-traiter'::text
    check (status = any (array['a-traiter','traité','important']::text[])),
  coach_reply text not null default ''::text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  session_key text,
  session_ref_label text
);

create table if not exists public.exercise_feedback (
  id uuid primary key default gen_random_uuid(),
  workout_feedback_id uuid not null references public.workout_feedback(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  exercise_id uuid references public.workout_exercises(id) on delete set null,  -- détachement
  exercise_name text not null,
  rpe integer check (rpe >= 1 and rpe <= 10),
  comment text not null default ''::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  exercise_order integer
);

-- ── Triggers set_updated_at (BEFORE UPDATE) sur les 6 tables ────────────────
do $$
declare t text;
begin
  foreach t in array array['workout_sessions','training_blocks','training_prescriptions','workout_exercises','exercise_feedback','workout_feedback'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ── RLS + policies (copie fidèle de la prod) ────────────────────────────────
alter table public.workout_sessions       enable row level security;
alter table public.training_blocks         enable row level security;
alter table public.training_prescriptions  enable row level security;
alter table public.workout_exercises       enable row level security;
alter table public.workout_feedback        enable row level security;
alter table public.exercise_feedback       enable row level security;

create policy workout_sessions_manage_staff on public.workout_sessions
  for all using (is_coach_or_admin()) with check (is_coach_or_admin());
create policy training_blocks_manage_staff on public.training_blocks
  for all using (is_coach_or_admin()) with check (is_coach_or_admin());
create policy training_prescriptions_manage_staff on public.training_prescriptions
  for all using (is_coach_or_admin()) with check (is_coach_or_admin());
create policy workout_exercises_manage_staff on public.workout_exercises
  for all using (is_coach_or_admin()) with check (is_coach_or_admin());
create policy workout_feedback_student_or_staff on public.workout_feedback
  for all using ((student_id = current_student_id()) or is_coach_or_admin())
  with check ((student_id = current_student_id()) or is_coach_or_admin());
create policy exercise_feedback_student_or_staff on public.exercise_feedback
  for all using ((student_id = current_student_id()) or is_coach_or_admin())
  with check ((student_id = current_student_id()) or is_coach_or_admin());

-- Policies élève (SELECT) — présentes pour fidélité ; non exercées par le pgTAP.
create policy workout_sessions_select_assigned_student on public.workout_sessions
  for select using (exists (
    select 1 from public.assignments a join public.programs p on p.id = a.content_id
    where a.content_type='programme' and a.content_id = workout_sessions.program_id
      and a.student_id = current_student_id() and p.publication_status = 'published'));
create policy training_blocks_select_assigned_student on public.training_blocks
  for select using (exists (
    select 1 from public.workout_sessions s
      join public.programs p on p.id = s.program_id
      join public.assignments a on a.content_type='programme' and a.content_id = p.id
    where s.id = training_blocks.session_id
      and a.student_id = current_student_id() and p.publication_status = 'published'));
create policy workout_exercises_select_assigned_student on public.workout_exercises
  for select using (exists (
    select 1 from public.workout_sessions s
      join public.programs p on p.id = s.program_id
      join public.assignments a on a.content_type='programme' and a.content_id = s.program_id
    where s.id = workout_exercises.session_id
      and a.student_id = current_student_id() and p.publication_status = 'published'));
create policy training_prescriptions_select_assigned_student on public.training_prescriptions
  for select using (
    exists (select 1 from public.workout_exercises e
        join public.workout_sessions s on s.id = e.session_id
        join public.programs p on p.id = s.program_id
        join public.assignments a on a.content_type='programme' and a.content_id = p.id
      where e.id = training_prescriptions.exercise_id
        and a.student_id = current_student_id() and p.publication_status = 'published')
    or exists (select 1 from public.training_blocks b
        join public.workout_sessions s on s.id = b.session_id
        join public.programs p on p.id = s.program_id
        join public.assignments a on a.content_type='programme' and a.content_id = p.id
      where b.id = training_prescriptions.block_id
        and a.student_id = current_student_id() and p.publication_status = 'published'));

-- ── Grants (par défaut Supabase) ────────────────────────────────────────────
grant all on public.workout_sessions, public.training_blocks, public.training_prescriptions,
             public.workout_exercises, public.workout_feedback, public.exercise_feedback,
             public.profiles, public.students, public.programs, public.program_weeks,
             public.assignments, public.exercise_library
  to anon, authenticated, service_role;
