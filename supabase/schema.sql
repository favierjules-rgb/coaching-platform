-- ============================================================================
-- Seth — Préparation Physique — schéma Supabase initial
-- ============================================================================
-- Étape "supabase-setup" : ce fichier prépare la structure de base de données
-- cible. Il n'est PAS encore branché à l'application (qui reste en
-- mock/localStorage, voir README.md). À exécuter dans Supabase SQL Editor
-- une fois le projet créé.
--
-- Convention commune à toutes les tables (demandée pour cette étape) :
--   - id uuid primary key default gen_random_uuid()
--   - created_at timestamptz not null default now()
--   - updated_at timestamptz not null default now()
--   - student_id  si la ligne est liée à un élève (-> students.id)
--   - coach_id    si la ligne est liée à un coach  (-> coaches.id)
--   - user_id     si la ligne est liée à un compte auth.users
--
-- Ce schéma est un point de départ : les policies RLS ci-dessous couvrent les
-- cas d'usage principaux décrits dans la demande (élève lit ses propres
-- données, coach/admin lit/gère les données des élèves, admin gère les
-- contenus). Elles sont volontairement simples pour un coaching solo (un
-- seul coach "Seth") plutôt que pensées pour un modèle multi-coach avec
-- assignation fine coach <-> élève — à affiner avant un vrai lancement
-- multi-coachs.
-- ============================================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ============================================================================
-- Fonction utilitaire : met à jour updated_at automatiquement sur chaque
-- UPDATE. Appliquée à chaque table via un trigger (voir bas de fichier).
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. profiles — une ligne par compte auth.users, quel que soit son rôle.
--    Source de vérité pour le rôle (élève / coach / admin) utilisé par les
--    policies RLS ci-dessous.
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  role text not null check (role in ('eleve', 'coach', 'admin')),
  first_name text not null default '',
  last_name text not null default '',
  email text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 2. coaches — fiche coach (extension de profiles pour le rôle coach/admin).
-- ============================================================================
create table if not exists public.coaches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  name text not null,
  email text not null default '',
  role text not null default 'admin' check (role in ('admin', 'assistant')),
  status text not null default 'actif' check (status in ('actif', 'inactif')),
  specialty text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 3. students — fiche élève côté admin (correspond à AdminStudent en mock).
-- ============================================================================
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  coach_id uuid references public.coaches (id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text not null default '',
  phone text not null default '',
  age integer,
  height_cm numeric,
  current_weight_kg numeric,
  start_weight_kg numeric,
  target_weight_kg numeric,
  goal text not null default '',
  level text not null default '',
  training_frequency_per_week integer,
  training_location text not null default '',
  status text not null default 'actif' check (status in ('actif', 'pause', 'terminé')),
  start_date date not null default current_date,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 4. student_profiles — données de profil élève éditables (préférences,
--    blessures, objectifs). Regroupées en jsonb pour rester simples à cette
--    étape plutôt que de créer une table par sous-section — à normaliser
--    plus tard si besoin de requêter finement ces champs.
-- ============================================================================
create table if not exists public.student_profiles (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.students (id) on delete cascade,
  food_preferences jsonb not null default '{}'::jsonb,
  sport_preferences jsonb not null default '{}'::jsonb,
  injury_note jsonb not null default '{}'::jsonb,
  main_goal text not null default '',
  secondary_goals jsonb not null default '[]'::jsonb,
  target_date date,
  priority text check (priority in ('haute', 'moyenne', 'basse')),
  tracked_indicators jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 5. progress_photos
-- ============================================================================
create table if not exists public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  type text not null check (type in ('avant', 'actuelle', 'objectif', 'mensuelle')),
  date date not null default current_date,
  weight_kg numeric,
  note text not null default '',
  image_url text,
  storage_path text, -- chemin dans le bucket Storage "progress-photos" (voir bas de fichier)
  pending boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 6. body_measurements — mensurations préréglées (une ligne par type de
--    mensuration suivie, mise à jour à chaque relevé — pas un historique).
-- ============================================================================
create table if not exists public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  type text not null,
  unit text not null default 'cm',
  start_value numeric not null,
  current_value numeric not null,
  note text not null default '',
  last_updated_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, type)
);

-- ============================================================================
-- 7. custom_measurements — mensurations personnalisées (nom libre).
-- ============================================================================
create table if not exists public.custom_measurements (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  name text not null,
  unit text not null default 'cm',
  start_value numeric not null,
  current_value numeric not null,
  note text not null default '',
  last_updated_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 8. payments — fiche paiement (une par élève, correspond à
--    StudentPaymentProfile en mock).
-- ============================================================================
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.students (id) on delete cascade,
  offer_name text not null default '',
  monthly_price_euros numeric not null default 0,
  duration_months integer not null default 0,
  total_price_euros numeric not null default 0,
  paid_amount_euros numeric not null default 0,
  status text not null default 'en attente' check (status in ('à jour', 'en attente', 'en retard', 'terminé')),
  method text not null default 'autre' check (method in ('virement', 'carte', 'espèces', 'chèque', 'autre')),
  next_payment_date date,
  installments_total integer not null default 0,
  installments_paid integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 9. payment_entries — historique des versements reçus.
-- ============================================================================
create table if not exists public.payment_entries (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  amount numeric not null,
  date date not null default current_date,
  method text not null default 'autre' check (method in ('virement', 'carte', 'espèces', 'chèque', 'autre')),
  note text not null default '',
  status text not null default 'terminé' check (status in ('à jour', 'en attente', 'en retard', 'terminé')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 10. programs — programme d'entraînement créé par le coach.
-- ============================================================================
create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references public.coaches (id) on delete set null,
  name text not null,
  goal text not null default '',
  level text not null default '',
  duration_weeks integer not null default 1,
  description text not null default '',
  status text not null default 'brouillon' check (status in ('brouillon', 'actif', 'archivé')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 11. program_weeks — structure semaine par semaine d'un programme.
-- ============================================================================
create table if not exists public.program_weeks (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  week_number integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, week_number)
);

-- ============================================================================
-- 12. workout_sessions — une séance (jour) au sein d'une semaine de
--     programme.
-- ============================================================================
create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  program_week_id uuid not null references public.program_weeks (id) on delete cascade,
  day text not null,
  is_rest_day boolean not null default false,
  name text not null default '',
  muscle_group text not null default '',
  duration_minutes integer,
  warmup text not null default '',
  coach_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 13. workout_exercises — exercices planifiés d'une séance.
-- ============================================================================
create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  order_index integer not null default 1,
  name text not null,
  sets integer not null default 0,
  reps text not null default '',
  rest_seconds integer not null default 0,
  tempo text not null default '',
  recommended_load text not null default '',
  video_url text not null default '',
  notes text not null default '',
  muscle_group text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 14. exercise_library — banque d'exercices réutilisable par le coach.
-- ============================================================================
create table if not exists public.exercise_library (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references public.coaches (id) on delete set null,
  name text not null,
  category text not null default '',
  equipment text not null default '',
  level text not null default '',
  muscle_group text not null default '',
  video_url text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 15. nutrition_plans
-- ============================================================================
create table if not exists public.nutrition_plans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students (id) on delete cascade,
  coach_id uuid references public.coaches (id) on delete set null,
  name text not null,
  goal_type text not null default 'maintien' check (
    goal_type in ('perte-de-poids', 'maintien', 'prise-de-masse', 'performance')
  ),
  daily_target jsonb not null default '{}'::jsonb, -- { calories, protein, carbs, fat }
  weekly_target_calories numeric,
  status text not null default 'prochain' check (status in ('actif', 'ancien', 'prochain')),
  shopping_list jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 16. nutrition_days — une journée type/réelle au sein d'un plan.
-- ============================================================================
create table if not exists public.nutrition_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.nutrition_plans (id) on delete cascade,
  week_start_date date not null,
  day text not null,
  status text not null default 'non-commence' check (status in ('non-commence', 'en-cours', 'valide')),
  target jsonb not null default '{}'::jsonb, -- MacroTarget
  actual jsonb, -- ActualDailyIntake saisi par l'élève, null tant que non validé
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 17. meals — repas planifiés d'une journée de plan.
-- ============================================================================
create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  nutrition_day_id uuid not null references public.nutrition_days (id) on delete cascade,
  slot text not null,
  name text not null default '',
  items jsonb not null default '[]'::jsonb, -- MealFoodItem[]
  macros jsonb not null default '{}'::jsonb, -- MacroTarget
  coach_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 18. documents — ressources partagées par le coach.
-- ============================================================================
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references public.coaches (id) on delete set null,
  title text not null,
  description text not null default '',
  type text not null check (type in ('pdf', 'vidéo', 'lien', 'guide', 'image')),
  category text not null check (category in ('nutrition', 'entrainement', 'administratif')),
  level integer not null default 1,
  distribution_mode text not null default 'disponible-immediatement',
  unlock_after_weeks integer,
  file_url text,
  video_url text,
  external_url text,
  storage_path text, -- chemin dans le bucket "documents" ou "videos" (voir bas de fichier)
  status text not null default 'brouillon' check (status in ('brouillon', 'publié', 'archivé')),
  important boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 19. document_levels — référentiel des niveaux de déblocage progressif
--     (level 1 = dispo dès le début, puis un niveau de plus tous les N
--     semaines — voir documents.unlock_after_weeks / level).
-- ============================================================================
create table if not exists public.document_levels (
  id uuid primary key default gen_random_uuid(),
  level_number integer not null unique,
  label text not null,
  weeks_required integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 20. document_assignments — association document <-> élève, porte le
--     viewedAt par élève (StudentDocumentAccess) + le déblocage manuel
--     (StudentDocumentUnlock).
-- ============================================================================
create table if not exists public.document_assignments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  viewed_at timestamptz,
  manually_unlocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, student_id)
);

-- ============================================================================
-- 21. workout_feedback — retour élève global pour une séance
--     (StudentWorkoutFeedback / AdminStudentFeedback type "entrainement").
-- ============================================================================
create table if not exists public.workout_feedback (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  session_id uuid references public.workout_sessions (id) on delete set null,
  program_id uuid references public.programs (id) on delete set null,
  completed boolean not null default false,
  global_rpe integer check (global_rpe between 1 and 10),
  global_comment text not null default '',
  pain text not null default '',
  status text not null default 'a-traiter' check (status in ('a-traiter', 'traité', 'important')),
  coach_reply text not null default '',
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 22. exercise_feedback — retour élève pour un exercice complet d'une
--     séance (regroupe les séries + le ressenti sur cet exercice).
-- ============================================================================
create table if not exists public.exercise_feedback (
  id uuid primary key default gen_random_uuid(),
  workout_feedback_id uuid not null references public.workout_feedback (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  exercise_id uuid references public.workout_exercises (id) on delete set null,
  exercise_name text not null,
  rpe integer check (rpe between 1 and 10),
  comment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 23. exercise_set_feedback — retour élève pour une série d'un exercice.
-- ============================================================================
create table if not exists public.exercise_set_feedback (
  id uuid primary key default gen_random_uuid(),
  exercise_feedback_id uuid not null references public.exercise_feedback (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  set_number integer not null,
  load_used text not null default '',
  reps_done text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 24. coach_notes — note privée du coach sur un élève.
-- ============================================================================
create table if not exists public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  coach_id uuid references public.coaches (id) on delete set null,
  text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 25. assignments — association contenu (programme / plan nutrition) <->
--     élève. Les documents ont leur propre table de liaison dédiée
--     (document_assignments) car ils portent en plus viewed_at.
-- ============================================================================
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  content_type text not null check (content_type in ('programme', 'nutrition')),
  content_id uuid not null,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, content_type, content_id)
);

-- ============================================================================
-- Triggers updated_at — une ligne par table.
-- ============================================================================
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'profiles', 'coaches', 'students', 'student_profiles', 'progress_photos',
      'body_measurements', 'custom_measurements', 'payments', 'payment_entries',
      'programs', 'program_weeks', 'workout_sessions', 'workout_exercises',
      'exercise_library', 'nutrition_plans', 'nutrition_days', 'meals',
      'documents', 'document_levels', 'document_assignments', 'workout_feedback',
      'exercise_feedback', 'exercise_set_feedback', 'coach_notes', 'assignments'
    ])
  loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I; ' ||
      'create trigger set_updated_at before update on public.%I ' ||
      'for each row execute function public.set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- ============================================================================
-- Row Level Security — activée sur toutes les tables.
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.coaches enable row level security;
alter table public.students enable row level security;
alter table public.student_profiles enable row level security;
alter table public.progress_photos enable row level security;
alter table public.body_measurements enable row level security;
alter table public.custom_measurements enable row level security;
alter table public.payments enable row level security;
alter table public.payment_entries enable row level security;
alter table public.programs enable row level security;
alter table public.program_weeks enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.exercise_library enable row level security;
alter table public.nutrition_plans enable row level security;
alter table public.nutrition_days enable row level security;
alter table public.meals enable row level security;
alter table public.documents enable row level security;
alter table public.document_levels enable row level security;
alter table public.document_assignments enable row level security;
alter table public.workout_feedback enable row level security;
alter table public.exercise_feedback enable row level security;
alter table public.exercise_set_feedback enable row level security;
alter table public.coach_notes enable row level security;
alter table public.assignments enable row level security;

-- ----------------------------------------------------------------------------
-- Fonctions utilitaires pour les policies (SECURITY DEFINER : peuvent lire
-- profiles/students même si l'appelant n'a pas directement le droit, pour
-- éviter les policies récursives).
-- ----------------------------------------------------------------------------
create or replace function public.is_coach_or_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role in ('coach', 'admin')
  );
$$;

create or replace function public.current_student_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from public.students where user_id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- profiles / coaches : lecture par tout utilisateur authentifié (utile pour
-- afficher le nom du coach côté élève), écriture réservée à soi-même ou à
-- un coach/admin.
-- ----------------------------------------------------------------------------
create policy "profiles_select_authenticated" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "profiles_update_self_or_admin" on public.profiles
  for update using (user_id = auth.uid() or public.is_coach_or_admin());
create policy "profiles_insert_self_or_admin" on public.profiles
  for insert with check (user_id = auth.uid() or public.is_coach_or_admin());

create policy "coaches_select_authenticated" on public.coaches
  for select using (auth.role() = 'authenticated');
create policy "coaches_manage_admin" on public.coaches
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

-- ----------------------------------------------------------------------------
-- students / student_profiles : un élève lit/modifie sa propre fiche, un
-- coach/admin lit et gère toutes les fiches élèves.
-- ----------------------------------------------------------------------------
create policy "students_select_self_or_staff" on public.students
  for select using (user_id = auth.uid() or public.is_coach_or_admin());
create policy "students_update_self_or_staff" on public.students
  for update using (user_id = auth.uid() or public.is_coach_or_admin());
create policy "students_manage_staff" on public.students
  for insert with check (public.is_coach_or_admin());
create policy "students_delete_staff" on public.students
  for delete using (public.is_coach_or_admin());

create policy "student_profiles_select_self_or_staff" on public.student_profiles
  for select using (student_id = public.current_student_id() or public.is_coach_or_admin());
create policy "student_profiles_manage_self_or_staff" on public.student_profiles
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

-- ----------------------------------------------------------------------------
-- Tables où l'élève lit ET écrit ses propres données (il ajoute lui-même ses
-- photos/mensurations/retours), le coach/admin a un accès complet.
-- ----------------------------------------------------------------------------
create policy "progress_photos_student_or_staff" on public.progress_photos
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

create policy "body_measurements_student_or_staff" on public.body_measurements
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

create policy "custom_measurements_student_or_staff" on public.custom_measurements
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

create policy "workout_feedback_student_or_staff" on public.workout_feedback
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

create policy "exercise_feedback_student_or_staff" on public.exercise_feedback
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

create policy "exercise_set_feedback_student_or_staff" on public.exercise_set_feedback
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

-- ----------------------------------------------------------------------------
-- Tables où l'élève lit seulement ses propres données, gérées par le
-- coach/admin (paiement, notes internes, statut de lecture documents).
-- ----------------------------------------------------------------------------
create policy "payments_select_self_or_staff" on public.payments
  for select using (student_id = public.current_student_id() or public.is_coach_or_admin());
create policy "payments_manage_staff" on public.payments
  for insert with check (public.is_coach_or_admin());
create policy "payments_update_staff" on public.payments
  for update using (public.is_coach_or_admin());
create policy "payments_delete_staff" on public.payments
  for delete using (public.is_coach_or_admin());

create policy "payment_entries_select_self_or_staff" on public.payment_entries
  for select using (student_id = public.current_student_id() or public.is_coach_or_admin());
create policy "payment_entries_manage_staff" on public.payment_entries
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

create policy "coach_notes_staff_only" on public.coach_notes
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

create policy "document_assignments_select_self_or_staff" on public.document_assignments
  for select using (student_id = public.current_student_id() or public.is_coach_or_admin());
create policy "document_assignments_update_self_or_staff" on public.document_assignments
  -- l'élève peut mettre à jour viewed_at (marquer un document comme consulté)
  for update
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());
create policy "document_assignments_manage_staff" on public.document_assignments
  for insert with check (public.is_coach_or_admin());
create policy "document_assignments_delete_staff" on public.document_assignments
  for delete using (public.is_coach_or_admin());

create policy "assignments_select_self_or_staff" on public.assignments
  for select using (student_id = public.current_student_id() or public.is_coach_or_admin());
create policy "assignments_manage_staff" on public.assignments
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

-- ----------------------------------------------------------------------------
-- Contenus créés par le coach (programmes, plans nutrition, documents,
-- banque d'exercices) : gestion complète par coach/admin. Lecture élève
-- limitée au contenu qui lui est assigné (via assignments / document_
-- assignments, ou via le student_id direct pour les plans nutrition).
-- ----------------------------------------------------------------------------
create policy "programs_manage_staff" on public.programs
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
create policy "programs_select_assigned_student" on public.programs
  for select using (
    exists (
      select 1 from public.assignments a
      where a.content_type = 'programme'
        and a.content_id = programs.id
        and a.student_id = public.current_student_id()
    )
  );

create policy "program_weeks_manage_staff" on public.program_weeks
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
create policy "program_weeks_select_assigned_student" on public.program_weeks
  for select using (
    exists (
      select 1 from public.assignments a
      where a.content_type = 'programme'
        and a.content_id = program_weeks.program_id
        and a.student_id = public.current_student_id()
    )
  );

create policy "workout_sessions_manage_staff" on public.workout_sessions
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
create policy "workout_sessions_select_assigned_student" on public.workout_sessions
  for select using (
    exists (
      select 1 from public.assignments a
      where a.content_type = 'programme'
        and a.content_id = workout_sessions.program_id
        and a.student_id = public.current_student_id()
    )
  );

create policy "workout_exercises_manage_staff" on public.workout_exercises
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
create policy "workout_exercises_select_assigned_student" on public.workout_exercises
  for select using (
    exists (
      select 1 from public.workout_sessions s
      join public.assignments a
        on a.content_type = 'programme' and a.content_id = s.program_id
      where s.id = workout_exercises.session_id
        and a.student_id = public.current_student_id()
    )
  );

create policy "exercise_library_staff_only" on public.exercise_library
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

create policy "nutrition_plans_manage_staff" on public.nutrition_plans
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
create policy "nutrition_plans_select_self" on public.nutrition_plans
  for select using (student_id = public.current_student_id());

create policy "nutrition_days_manage_staff" on public.nutrition_days
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
create policy "nutrition_days_select_self" on public.nutrition_days
  for select using (
    exists (
      select 1 from public.nutrition_plans p
      where p.id = nutrition_days.plan_id and p.student_id = public.current_student_id()
    )
  );
create policy "nutrition_days_update_self" on public.nutrition_days
  -- l'élève valide/modifie sa propre journée (champ "actual")
  for update
  using (
    exists (
      select 1 from public.nutrition_plans p
      where p.id = nutrition_days.plan_id and p.student_id = public.current_student_id()
    )
  )
  with check (
    exists (
      select 1 from public.nutrition_plans p
      where p.id = nutrition_days.plan_id and p.student_id = public.current_student_id()
    )
  );

create policy "meals_manage_staff" on public.meals
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
create policy "meals_select_self" on public.meals
  for select using (
    exists (
      select 1 from public.nutrition_days d
      join public.nutrition_plans p on p.id = d.plan_id
      where d.id = meals.nutrition_day_id and p.student_id = public.current_student_id()
    )
  );

create policy "documents_manage_staff" on public.documents
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
create policy "documents_select_assigned_student" on public.documents
  for select using (
    exists (
      select 1 from public.document_assignments da
      where da.document_id = documents.id and da.student_id = public.current_student_id()
    )
  );

create policy "document_levels_select_authenticated" on public.document_levels
  for select using (auth.role() = 'authenticated');
create policy "document_levels_manage_staff" on public.document_levels
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

-- ============================================================================
-- Données de référence : niveaux de déblocage progressif des documents.
-- ============================================================================
insert into public.document_levels (level_number, label, weeks_required)
values
  (1, 'Niveau 1', 0),
  (2, 'Niveau 2', 4),
  (3, 'Niveau 3', 8),
  (4, 'Niveau 4', 12)
on conflict (level_number) do nothing;

-- ============================================================================
-- Supabase Storage — buckets prévus (pas encore utilisés par l'application).
-- ============================================================================
-- progress-photos : photos de progression élève (Avant/Actuelle/Objectif/
--                    mensuelle). Remplacera à terme le stockage en base64
--                    dans localStorage utilisé par le mock.
-- documents        : fichiers PDF partagés par le coach (guides, contrats,
--                    grilles de suivi...).
-- videos           : vidéos techniques hébergées directement (à défaut,
--                    documents.video_url peut aussi pointer vers un lien
--                    externe — YouTube, Vimeo... — sans passer par ce bucket).
--
-- Ces inserts sont idempotents (on conflict do nothing) et peuvent aussi être
-- faits depuis Dashboard > Storage si préféré à cette étape.
insert into storage.buckets (id, name, public)
values
  ('progress-photos', 'progress-photos', false),
  ('documents', 'documents', false),
  ('videos', 'videos', false)
on conflict (id) do nothing;

-- Policies Storage de base : un élève ne peut lire/écrire que dans un dossier
-- nommé avec son propre student_id (convention : "<student_id>/<fichier>"),
-- le coach/admin a accès à tout. À affiner selon la convention de nommage
-- réellement choisie côté application au moment du branchement.
create policy "progress_photos_bucket_student_or_staff" on storage.objects
  for all
  using (
    bucket_id = 'progress-photos'
    and (
      public.is_coach_or_admin()
      or (storage.foldername(name))[1] = public.current_student_id()::text
    )
  )
  with check (
    bucket_id = 'progress-photos'
    and (
      public.is_coach_or_admin()
      or (storage.foldername(name))[1] = public.current_student_id()::text
    )
  );

create policy "documents_bucket_select_authenticated" on storage.objects
  for select using (bucket_id = 'documents' and auth.role() = 'authenticated');
create policy "documents_bucket_manage_staff" on storage.objects
  for insert with check (bucket_id = 'documents' and public.is_coach_or_admin());
create policy "documents_bucket_update_staff" on storage.objects
  for update using (bucket_id = 'documents' and public.is_coach_or_admin());
create policy "documents_bucket_delete_staff" on storage.objects
  for delete using (bucket_id = 'documents' and public.is_coach_or_admin());

create policy "videos_bucket_select_authenticated" on storage.objects
  for select using (bucket_id = 'videos' and auth.role() = 'authenticated');
create policy "videos_bucket_manage_staff" on storage.objects
  for insert with check (bucket_id = 'videos' and public.is_coach_or_admin());
create policy "videos_bucket_update_staff" on storage.objects
  for update using (bucket_id = 'videos' and public.is_coach_or_admin());
create policy "videos_bucket_delete_staff" on storage.objects
  for delete using (bucket_id = 'videos' and public.is_coach_or_admin());

-- ============================================================================
-- Fin du schéma initial. Prochaine étape (pas dans ce fichier) : régénérer
-- types/supabase.ts avec `supabase gen types typescript`, puis brancher
-- progressivement chaque page mock sur ces tables (voir README.md).
-- ============================================================================
