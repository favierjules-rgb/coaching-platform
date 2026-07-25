-- Onboarding élève (PR #16) : colonnes additives uniquement sur
-- student_profiles, aucune suppression, aucune donnée écrasée.
alter table public.student_profiles add column if not exists onboarding_completed boolean not null default false;
alter table public.student_profiles add column if not exists onboarding_completed_at timestamptz;

-- Objectifs / activité / entraînement
alter table public.student_profiles add column if not exists target_timeframe text;
alter table public.student_profiles add column if not exists activity_level text;
alter table public.student_profiles add column if not exists neat_level text;
alter table public.student_profiles add column if not exists sports_practiced jsonb;
alter table public.student_profiles add column if not exists other_activities jsonb;
alter table public.student_profiles add column if not exists available_equipment jsonb;
alter table public.student_profiles add column if not exists favorite_exercises jsonb;
alter table public.student_profiles add column if not exists favorite_gym_exercises jsonb;
alter table public.student_profiles add column if not exists avoided_exercises jsonb;
alter table public.student_profiles add column if not exists injuries text;
alter table public.student_profiles add column if not exists training_notes text;

-- Santé / contraintes (sensible)
alter table public.student_profiles add column if not exists medical_treatments text;
alter table public.student_profiles add column if not exists medications text;
alter table public.student_profiles add column if not exists health_notes text;

-- Hygiène de vie
alter table public.student_profiles add column if not exists hydration_level text;
alter table public.student_profiles add column if not exists daily_water_intake text;
alter table public.student_profiles add column if not exists sleep_duration text;
alter table public.student_profiles add column if not exists sleep_quality text;
alter table public.student_profiles add column if not exists recovery_notes text;
alter table public.student_profiles add column if not exists lifestyle_notes text;

-- Motivation / contexte personnel (sensible)
alter table public.student_profiles add column if not exists motivation_source text;
alter table public.student_profiles add column if not exists recent_life_events text;
alter table public.student_profiles add column if not exists mental_wellbeing_goal text;
alter table public.student_profiles add column if not exists emotional_wellbeing_notes text;

-- Nutrition
alter table public.student_profiles add column if not exists disliked_foods jsonb;
alter table public.student_profiles add column if not exists allergies jsonb;
alter table public.student_profiles add column if not exists intolerances jsonb;
alter table public.student_profiles add column if not exists diet_type text;
alter table public.student_profiles add column if not exists preferred_meal_count integer;
alter table public.student_profiles add column if not exists meal_timing_notes text;
alter table public.student_profiles add column if not exists hunger_notes text;
alter table public.student_profiles add column if not exists snacking_notes text;
alter table public.student_profiles add column if not exists work_schedule_notes text;
alter table public.student_profiles add column if not exists nutrition_notes text;;
