-- Migration V3 "Training Builder — Running/Fullscreen" — Étape 1
-- 100% additive, idempotent (IF NOT EXISTS partout où possible), aucune
-- suppression de colonne/table/donnée, aucune contrainte NOT NULL ajoutée
-- sur une colonne existante. Ne touche à aucune table hors du module
-- Entraînement (nutrition, documents, rendez-vous, Stripe, Resend, Brevo,
-- newsletter, abonnements : intouchés).

begin;

-- ────────────────────────────────────────────────────────────────────────
-- 1. Discriminant strength/cardio/mixed sur workout_sessions
-- ────────────────────────────────────────────────────────────────────────
alter table public.workout_sessions
  add column if not exists session_type text not null default 'strength';

alter table public.workout_sessions
  drop constraint if exists workout_sessions_session_type_check;
alter table public.workout_sessions
  add constraint workout_sessions_session_type_check
  check (session_type = any (array['strength','cardio','mixed']));

comment on column public.workout_sessions.session_type is
  'Discriminant V3 : strength (défaut, comportement historique inchangé), cardio, ou mixed. Ne modifie aucune séance existante (défaut strength).';

-- ────────────────────────────────────────────────────────────────────────
-- 2. training_blocks : ajout du type "cardio" + colonnes cardio nullables
--    (table déjà existante mais jamais utilisée par le code actuel — on
--    l'étend au lieu d'en créer une nouvelle, conformément à la décision
--    prise avec Jules)
-- ────────────────────────────────────────────────────────────────────────
alter table public.training_blocks
  drop constraint if exists training_blocks_block_type_check;
alter table public.training_blocks
  add constraint training_blocks_block_type_check
  check (block_type = any (array[
    'standard','warmup','strength','superset','tri_set','giant_set',
    'circuit','emom','amrap','interval','cooldown','benchmark','custom',
    'cardio'
  ]));

alter table public.training_blocks
  add column if not exists cardio_type text,
  add column if not exists machine_type text;

alter table public.training_blocks
  drop constraint if exists training_blocks_cardio_type_check;
alter table public.training_blocks
  add constraint training_blocks_cardio_type_check
  check (cardio_type is null or cardio_type = any (array[
    'continuous_run','easy_run','long_run','tempo_run','threshold_intervals',
    'vma_intervals','short_intervals','long_intervals','fartlek',
    'hill_repeats','sprint_repeats','run_walk','warmup_run','cooldown_run',
    'race_pace','time_trial','vma_test','luc_leger','hyrox_run',
    'cardio_machine','custom_cardio'
  ]));

alter table public.training_blocks
  drop constraint if exists training_blocks_machine_type_check;
alter table public.training_blocks
  add constraint training_blocks_machine_type_check
  check (machine_type is null or machine_type = any (array[
    'treadmill','bike','rower','skierg','elliptical','air_bike','stepper','other'
  ]));

comment on column public.training_blocks.cardio_type is
  'Type de séance cardio/course (rempli uniquement si block_type=cardio). NULL pour tous les blocs existants.';
comment on column public.training_blocks.machine_type is
  'Machine utilisée si cardio_type=cardio_machine. NULL sinon.';

-- ────────────────────────────────────────────────────────────────────────
-- 3. training_prescriptions : extension pour porter les segments cardio
--    (au lieu d'une nouvelle table "segments" — même décision qu'au 2)
--    - exercise_id devient nullable : une prescription peut être rattachée
--      SOIT à un exercice (musculation, comportement actuel inchangé)
--      SOIT directement à un bloc (segment cardio)
--    - parent_prescription_id permet de représenter un groupe de
--      répétitions (ex: 8×400m) comme parent de ses segments enfants
-- ────────────────────────────────────────────────────────────────────────
alter table public.training_prescriptions
  alter column exercise_id drop not null;

alter table public.training_prescriptions
  add column if not exists block_id uuid references public.training_blocks(id) on delete cascade,
  add column if not exists parent_prescription_id uuid references public.training_prescriptions(id) on delete cascade,
  add column if not exists segment_type text,
  add column if not exists title text,
  add column if not exists elevation_gain_meters numeric,
  add column if not exists repetitions integer,
  add column if not exists work_duration_seconds integer,
  add column if not exists recovery_duration_seconds integer,
  add column if not exists recovery_distance_meters numeric,
  add column if not exists set_recovery_seconds integer,
  add column if not exists intensity_target_type text,
  add column if not exists target_vma_percentage numeric,
  add column if not exists target_speed_kmh numeric,
  add column if not exists target_pace_seconds_per_km integer,
  add column if not exists target_hr_percentage numeric,
  add column if not exists target_hr_zone text,
  add column if not exists target_power_watts numeric,
  add column if not exists target_cadence numeric,
  add column if not exists incline_percentage numeric,
  add column if not exists intensity_min numeric,
  add column if not exists intensity_max numeric,
  add column if not exists surface text,
  add column if not exists terrain text,
  add column if not exists equipment_type text;

-- Une prescription doit toujours être rattachée à quelque chose (comme
-- avant : un exercice ; ou nouveau : un bloc directement pour le cardio).
alter table public.training_prescriptions
  drop constraint if exists training_prescriptions_exercise_or_block_check;
alter table public.training_prescriptions
  add constraint training_prescriptions_exercise_or_block_check
  check (exercise_id is not null or block_id is not null);

alter table public.training_prescriptions
  drop constraint if exists training_prescriptions_segment_type_check;
alter table public.training_prescriptions
  add constraint training_prescriptions_segment_type_check
  check (segment_type is null or segment_type = any (array[
    'single','repeat_group','work','recovery','ramp_up','ramp_down'
  ]));

alter table public.training_prescriptions
  drop constraint if exists training_prescriptions_intensity_target_type_check;
alter table public.training_prescriptions
  add constraint training_prescriptions_intensity_target_type_check
  check (intensity_target_type is null or intensity_target_type = any (array[
    'vma_percentage','speed_kmh','pace','heart_rate_zone',
    'heart_rate_percentage','rpe','power','race_pace','free','custom'
  ]));

comment on column public.training_prescriptions.block_id is
  'V3 cardio : rattachement direct à un bloc (segment cardio), alternative à exercise_id. NULL pour toutes les prescriptions musculation existantes.';
comment on column public.training_prescriptions.parent_prescription_id is
  'V3 cardio : segment parent (ex: groupe de répétitions 8×400m). NULL = segment de premier niveau.';

-- Index pour les nouvelles requêtes par bloc / hiérarchie de segments.
create index if not exists idx_training_prescriptions_block_id
  on public.training_prescriptions(block_id);
create index if not exists idx_training_prescriptions_parent
  on public.training_prescriptions(parent_prescription_id);

-- ────────────────────────────────────────────────────────────────────────
-- 4. Profil physiologique élève (student_profiles) — nouveaux champs,
--    aucun champ existant modifié ni dupliqué
-- ────────────────────────────────────────────────────────────────────────
alter table public.student_profiles
  add column if not exists vma_kmh numeric,
  add column if not exists hr_max integer,
  add column if not exists hr_resting integer,
  add column if not exists ftp_watts numeric,
  add column if not exists reference_paces jsonb not null default '{}'::jsonb,
  add column if not exists last_fitness_test_date date,
  add column if not exists fitness_test_protocol text;

comment on column public.student_profiles.vma_kmh is
  'Vitesse Maximale Aérobie (km/h), déclarée par le coach ou l''élève. Source des conversions vitesse/allure/%VMA (V3 cardio).';
comment on column public.student_profiles.reference_paces is
  'Allures de référence libres (ex: {"10km": "4:30", "semi": "4:50"}), jsonb pour rester extensible sans migration ultérieure.';

-- ────────────────────────────────────────────────────────────────────────
-- 5. Préparation future import montre/app (aucune intégration réelle
--    développée dans cette branche — champs de préparation seulement)
-- ────────────────────────────────────────────────────────────────────────
alter table public.training_prescriptions
  add column if not exists data_source text not null default 'manual',
  add column if not exists external_activity_id text,
  add column if not exists imported_at timestamptz,
  add column if not exists raw_summary jsonb;

alter table public.training_prescriptions
  drop constraint if exists training_prescriptions_data_source_check;
alter table public.training_prescriptions
  add constraint training_prescriptions_data_source_check
  check (data_source = any (array[
    'manual','garmin','apple_health','strava','coros','polar','other'
  ]));

comment on column public.training_prescriptions.data_source is
  'Origine de la donnée (prep future import montre — aucune intégration Garmin/Apple Watch/Strava développée dans cette branche). Défaut manual = comportement actuel inchangé.';

commit;
