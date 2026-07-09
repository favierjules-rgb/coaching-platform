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
  role text not null check (role in ('admin', 'coach', 'student')),
  first_name text not null default '',
  last_name text not null default '',
  email text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Si ce schéma avait déjà été exécuté avant l'étape "supabase-auth" (avec
-- l'ancienne contrainte role in ('eleve', 'coach', 'admin')), la met à jour
-- pour matcher le type UserRole = "admin" | "coach" | "student" du code
-- TypeScript — sans effet si la table vient d'être créée ci-dessus.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'coach', 'student'));

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
-- 3. students — identité + statut de suivi de l'élève uniquement (nom,
--    contact, coach, statut actif/pause/terminé, dates de suivi). Les
--    détails coaching (mensurations, niveau, objectif, fréquence, lieu,
--    préférences, contraintes) vivent dans student_profiles — voir
--    docs/supabase-student-model.md pour la répartition complète et le
--    bloc de migration plus bas (section 4bis) qui déplace ces colonnes
--    pour les projets déjà initialisés avec l'ancien schéma.
-- ============================================================================
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  coach_id uuid references public.coaches (id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text not null default '',
  phone text not null default '',
  -- Colonnes historiques (mensurations/objectif/niveau), conservées ici
  -- uniquement pour qu'un projet déjà initialisé avec l'ancien schéma
  -- dispose bien de ces colonnes avant que le bloc de migration
  -- (section 4bis) ne les déplace vers student_profiles et les supprime
  -- d'ici. Un nouveau projet ne les gardera jamais : la migration
  -- s'exécute juste après sa création, dans le même script.
  age integer,
  height_cm numeric,
  current_weight_kg numeric,
  start_weight_kg numeric,
  target_weight_kg numeric,
  goal text not null default '',
  level text not null default '',
  training_frequency_per_week integer,
  training_location text not null default '',
  -- Valeurs en anglais (pas 'actif'/'pause'/'terminé') pour matcher la
  -- contrainte réellement en place sur le projet Supabase de production —
  -- voir la conversion française <-> anglaise dans lib/supabase/students.ts
  -- (STATUS_DB_TO_APP / STATUS_APP_TO_DB), qui reste le seul endroit à
  -- connaître cette variante ; le reste de l'app continue d'utiliser les
  -- valeurs françaises.
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  start_date date not null default current_date,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 4. student_profiles — détails coaching de l'élève (une ligne par élève) :
--    mensurations de référence, niveau, objectif, fréquence, lieu,
--    préférences, contraintes. Regroupées en jsonb pour les préférences
--    (food_preferences/sport_preferences/injury_note) pour rester simple à
--    cette étape plutôt que de créer une table par sous-section — à
--    normaliser plus tard si besoin de requêter finement ces champs.
-- ============================================================================
create table if not exists public.student_profiles (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.students (id) on delete cascade,
  age integer,
  height_cm numeric,
  current_weight_kg numeric,
  start_weight_kg numeric,
  target_weight_kg numeric,
  goal text not null default '',
  level text not null default '',
  -- Colonne réellement utilisée en production pour le niveau sportif
  -- (`level` ci-dessus n'est qu'un repli de lecture, voir
  -- lib/supabase/students.ts) — pré-existante avant `level`, conservée pour
  -- ne pas perdre la donnée déjà en place.
  sport_level text,
  training_frequency_per_week integer,
  training_location text not null default '',
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
-- 4bis. Migration : déplacement des colonnes coaching de `students` vers
--       `student_profiles` (voir docs/supabase-student-model.md).
--
--       Sûr à exécuter plusieurs fois, aussi bien sur un projet fraîchement
--       créé (les étapes n'ont simplement rien à faire) que sur un projet
--       où `students` porte encore ces colonnes depuis un schéma plus
--       ancien (les valeurs existantes sont reportées vers
--       `student_profiles` avant suppression, aucune donnée perdue) :
--       1) ajoute les colonnes sur student_profiles si absentes ;
--       2) crée une ligne student_profiles pour chaque élève qui n'en a
--          pas encore, en reprenant les valeurs de students ;
--       3) reporte les valeurs de students vers student_profiles pour les
--          lignes déjà existantes (coalesce : ne touche pas une valeur
--          déjà renseignée côté student_profiles) ;
--       4) supprime les colonnes désormais dupliquées sur students.
-- ============================================================================
alter table public.student_profiles add column if not exists age integer;
alter table public.student_profiles add column if not exists height_cm numeric;
alter table public.student_profiles add column if not exists current_weight_kg numeric;
alter table public.student_profiles add column if not exists start_weight_kg numeric;
alter table public.student_profiles add column if not exists target_weight_kg numeric;
alter table public.student_profiles add column if not exists goal text not null default '';
alter table public.student_profiles add column if not exists level text not null default '';
alter table public.student_profiles add column if not exists sport_level text;
alter table public.student_profiles add column if not exists training_frequency_per_week integer;
alter table public.student_profiles add column if not exists training_location text not null default '';

-- Le backfill référence des colonnes de `students` déjà supprimées après un
-- premier passage de cette migration : sur un script relancé tel quel (voir
-- README.md, "coller schema.sql et l'exécuter" à chaque étape), `students.age`
-- n'existe alors plus et un simple `insert ... select s.age from students s`
-- échouerait avec "column does not exist". Le bloc dynamique ci-dessous ne
-- s'exécute que si `students.age` existe encore, pour rester rejouable.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students' and column_name = 'age'
  ) then
    insert into public.student_profiles (student_id, age, height_cm, current_weight_kg, start_weight_kg, target_weight_kg, goal, level, training_frequency_per_week, training_location)
    select s.id, s.age, s.height_cm, s.current_weight_kg, s.start_weight_kg, s.target_weight_kg, s.goal, s.level, s.training_frequency_per_week, s.training_location
    from public.students s
    where not exists (select 1 from public.student_profiles sp where sp.student_id = s.id)
    on conflict (student_id) do nothing;

    update public.student_profiles sp
    set age = coalesce(sp.age, s.age),
        height_cm = coalesce(sp.height_cm, s.height_cm),
        current_weight_kg = coalesce(sp.current_weight_kg, s.current_weight_kg),
        start_weight_kg = coalesce(sp.start_weight_kg, s.start_weight_kg),
        target_weight_kg = coalesce(sp.target_weight_kg, s.target_weight_kg),
        goal = case when sp.goal = '' then s.goal else sp.goal end,
        level = case when sp.level = '' then s.level else sp.level end,
        training_frequency_per_week = coalesce(sp.training_frequency_per_week, s.training_frequency_per_week),
        training_location = case when sp.training_location = '' then s.training_location else sp.training_location end
    from public.students s
    where sp.student_id = s.id;
  end if;
end $$;

alter table public.students drop column if exists age;
alter table public.students drop column if exists height_cm;
alter table public.students drop column if exists current_weight_kg;
alter table public.students drop column if exists start_weight_kg;
alter table public.students drop column if exists target_weight_kg;
alter table public.students drop column if exists goal;
alter table public.students drop column if exists level;
alter table public.students drop column if exists training_frequency_per_week;
alter table public.students drop column if exists training_location;

-- ============================================================================
-- 4ter. weight_entries — historique du poids (une ligne par relevé), pour
--       que la carte "Évolution du poids" ait une vraie courbe à afficher au
--       lieu de ne connaître que le poids actuel/départ/objectif de
--       student_profiles. `source` distingue le relevé initial (création de
--       l'élève), une saisie élève, ou une saisie coach.
-- ============================================================================
create table if not exists public.weight_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  weight_kg numeric not null,
  recorded_at date not null default current_date,
  source text not null default 'coach_update' check (source in ('initial', 'student_update', 'coach_update')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 4quater. Onboarding élève — questionnaire complet à la première connexion
--          (voir app/onboarding). Uniquement des colonnes additives sur
--          student_profiles, jamais de suppression ni d'écrasement — sûr à
--          rejouer sur un projet déjà initialisé. Ces champs sont pour
--          beaucoup optionnels et sensibles (santé, motivation, contexte
--          personnel) : jamais affichés sur /dashboard ou /admin, seulement
--          dans le détail de profil (/profil, /admin/eleves/[studentId]).
--          `secondary_goals`, `target_date`, `main_goal` et `food_preferences`
--          existent déjà plus haut et sont réutilisés tels quels.
-- ============================================================================
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
alter table public.student_profiles add column if not exists nutrition_notes text;

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
-- 17bis. Migration nutrition — chantier "supabase-nutrition-plans".
--
-- `nutrition_plans`/`nutrition_days`/`meals` existaient déjà (sections
-- 15-17) mais jamais branchées à l'app. Deux ajustements additifs
-- nécessaires, sûrs à rejouer plusieurs fois :
--
-- 1) `nutrition_plans.description`/`coach_notes`/`hydration_tip`/
--    `supplements` — n'existaient pas encore. NutritionPlanBuilder (mock)
--    collecte déjà ces champs (description courte, notes coach niveau
--    plan — distinctes des notes par repas déjà couvertes par
--    `meals.coach_notes` —, conseil hydratation, liste de compléments) :
--    sans ces colonnes, une saisie coach y serait silencieusement perdue.
-- 2) `nutrition_days.week_start_date` était `not null`, pensé pour une
--    journée réelle datée (suivi élève). Un "jour type" créé par le coach
--    dans le générateur de plan (NutritionPlanBuilder, un jour par nom de
--    semaine — Lundi..Dimanche, pas de vraie date) n'a pas de date
--    calendaire à fournir : la colonne est assouplie en nullable plutôt que
--    d'imposer une date arbitraire sans signification.
--
-- Aucune donnée existante n'est supprimée ou écrasée par ces instructions.
-- ============================================================================
alter table public.nutrition_plans add column if not exists description text not null default '';
alter table public.nutrition_plans add column if not exists coach_notes text not null default '';
alter table public.nutrition_plans add column if not exists hydration_tip text not null default '';
alter table public.nutrition_plans add column if not exists supplements jsonb not null default '[]'::jsonb;
alter table public.nutrition_days alter column week_start_date drop not null;

-- ============================================================================
-- 17ter. nutrition_daily_logs — chantier "nutrition-weekly-adjustment-tool".
--
-- Saisie élève réelle (calories/macros consommées un jour donné), pour
-- l'outil "Suivi de la semaine" côté /nutrition : redistribue l'objectif
-- hebdomadaire du plan actif sur les jours restants non encore remplis.
-- `nutrition_days.actual`/`target` existaient déjà mais représentent un
-- jour-modèle (Lundi..Dimanche, sans date, potentiellement partagé si un
-- plan de bibliothèque est réassigné) — impropres à porter une saisie réelle
-- datée par élève, d'où une table dédiée plutôt qu'une réutilisation.
-- `student_id` référence directement `students.id` (jamais `profiles.id`,
-- `auth.users.id` ni `student_profiles.id`), comme `weight_entries` et
-- `progress_photos`.
-- ============================================================================
create table if not exists public.nutrition_daily_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  nutrition_plan_id uuid not null references public.nutrition_plans (id) on delete cascade,
  log_date date not null,
  calories numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, nutrition_plan_id, log_date)
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
-- 20bis. Migration documents — chantier "supabase-documents-library".
--
-- `documents`/`document_levels`/`document_assignments` existaient déjà
-- (sections 18-20), avec RLS et buckets Storage `documents`/`videos` prêts,
-- mais jamais branchées à l'app (AdminDocument/DocumentResource restaient
-- 100% mock/localStorage). Ajustements additifs, sûrs à rejouer :
--
-- 1) `documents.full_description` — le mock (AdminDocument) sépare une
--    description courte (déjà couverte par `documents.description`) d'une
--    description complète affichée en détail. Colonne manquante.
-- 2) `documents.difficulty` — existe côté mock (AdminDocument.difficulty),
--    utilisé par la liste admin existante (filtre/affichage) ; absent de la
--    table.
-- 3) `documents.content_text` — nouveau type de ressource "Texte / note"
--    demandé (contenu texte affiché directement, sans fichier ni lien).
-- 4) `documents.visibility` — capacité nouvelle : un document peut être
--    'global' (visible de tout élève actif dès que publié, sans ligne
--    document_assignments) ou 'assigned' (visible uniquement des élèves
--    explicitement assignés, comportement historique). Sans cette colonne,
--    aucune diffusion "à tous" n'est possible.
-- 5) `documents.unlock_at` — déblocage à date précise, en plus du
--    déblocage par niveau/semaines (`level`/`unlock_after_weeks`) déjà
--    existant. `distribution_mode` gagne la valeur 'deblocage-date' pour ce
--    cas (colonne texte libre, pas de contrainte check existante à modifier).
-- 6) `documents.tags` — tags libres optionnels.
-- 7) `documents.type` — contrainte élargie pour accepter 'texte'.
-- 8) `document_assignments.unlock_at` — déblocage à date précise propre à
--    UNE assignation (ex : document en mode manuel débloqué pour un élève
--    donné à une date choisie), distinct de `documents.unlock_at` qui
--    s'applique à tous les élèves assignés.
--
-- Aucune donnée existante supprimée ou écrasée.
-- ============================================================================
alter table public.documents add column if not exists full_description text not null default '';
alter table public.documents add column if not exists difficulty text not null default 'intermédiaire'
  check (difficulty in ('facile', 'intermédiaire', 'avancé'));
alter table public.documents add column if not exists content_text text not null default '';
alter table public.documents add column if not exists visibility text not null default 'assigned'
  check (visibility in ('global', 'assigned'));
alter table public.documents add column if not exists unlock_at timestamptz;
alter table public.documents add column if not exists tags jsonb not null default '[]'::jsonb;

alter table public.documents drop constraint if exists documents_type_check;
alter table public.documents add constraint documents_type_check
  check (type in ('pdf', 'vidéo', 'lien', 'guide', 'image', 'texte'));

alter table public.document_assignments add column if not exists unlock_at timestamptz;

-- ============================================================================
-- 20ter. Migration documents — chantier "supabase-documents-storage-upload".
--
-- `documents.storage_path` existait déjà mais n'était jamais réellement
-- écrit (aucun upload branché) — désormais le chemin réel de l'objet dans
-- le bucket Storage "documents" (déjà créé, voir plus bas) une fois un
-- fichier uploadé, format `<document_id>/<timestamp>-<nom-fichier>`.
-- `file_url` reste réservé au cas "URL externe" (lien PDF/vidéo collé par
-- le coach, comportement de la PR #20 inchangé) ; les deux restent
-- indépendants et peuvent coexister (l'app privilégie `storage_path` à
-- l'affichage s'il est renseigné). Colonnes additives pour l'affichage
-- (nom/taille/type du fichier uploadé) — aucune nouvelle table.
-- ============================================================================
alter table public.documents add column if not exists file_name text;
alter table public.documents add column if not exists file_size_bytes bigint;
alter table public.documents add column if not exists file_mime_type text;

-- ============================================================================
-- 21. workout_feedback — retour élève global pour une séance
--     (StudentWorkoutFeedback / AdminStudentFeedback type "entrainement").
--     `session_id` / `program_id` restent uuid (FK vers workout_sessions /
--     programs) pour quand ces tables seront réellement peuplées — tant que
--     les programmes ne sont pas migrés (voir lib/supabase/workout-feedback.ts),
--     ces deux colonnes restent `null` et la séance mock est identifiée via
--     `session_key` (id mock stable, ex: "session-upper") + `session_ref_label`
--     (nom affichable), pour retrouver/mettre à jour le bon retour sans
--     dupliquer et sans dépendre de programmes non encore migrés.
-- ============================================================================
create table if not exists public.workout_feedback (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  session_id uuid references public.workout_sessions (id) on delete set null,
  program_id uuid references public.programs (id) on delete set null,
  session_key text,
  session_ref_label text not null default '',
  completed boolean not null default false,
  global_rpe integer check (global_rpe between 1 and 10),
  global_comment text not null default '',
  pain text not null default '',
  status text not null default 'a-traiter' check (status in ('a-traiter', 'traité', 'important')),
  coach_reply text not null default '',
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, session_key)
);
alter table public.workout_feedback add column if not exists session_key text;
alter table public.workout_feedback add column if not exists session_ref_label text not null default '';

-- ============================================================================
-- 22. exercise_feedback — retour élève pour un exercice complet d'une
--     séance (regroupe les séries + le ressenti sur cet exercice).
--     `exercise_order` (position dans la séance mock) permet un tri stable
--     à l'affichage tant que `exercise_id` (FK vers workout_exercises, non
--     encore peuplée) reste `null`.
-- ============================================================================
create table if not exists public.exercise_feedback (
  id uuid primary key default gen_random_uuid(),
  workout_feedback_id uuid not null references public.workout_feedback (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  exercise_id uuid references public.workout_exercises (id) on delete set null,
  exercise_name text not null,
  exercise_order integer,
  rpe integer check (rpe between 1 and 10),
  comment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.exercise_feedback add column if not exists exercise_order integer;

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
      'profiles', 'coaches', 'students', 'student_profiles', 'weight_entries', 'progress_photos',
      'body_measurements', 'custom_measurements', 'payments', 'payment_entries',
      'programs', 'program_weeks', 'workout_sessions', 'workout_exercises',
      'exercise_library', 'nutrition_plans', 'nutrition_days', 'meals', 'nutrition_daily_logs',
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
alter table public.weight_entries enable row level security;
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
alter table public.nutrition_daily_logs enable row level security;
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
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select using (auth.role() = 'authenticated');
drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin" on public.profiles
  for update using (user_id = auth.uid() or public.is_coach_or_admin());
drop policy if exists "profiles_insert_self_or_admin" on public.profiles;
create policy "profiles_insert_self_or_admin" on public.profiles
  for insert with check (user_id = auth.uid() or public.is_coach_or_admin());

drop policy if exists "coaches_select_authenticated" on public.coaches;
create policy "coaches_select_authenticated" on public.coaches
  for select using (auth.role() = 'authenticated');
drop policy if exists "coaches_manage_admin" on public.coaches;
create policy "coaches_manage_admin" on public.coaches
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

-- ----------------------------------------------------------------------------
-- students / student_profiles : un élève lit/modifie sa propre fiche, un
-- coach/admin lit et gère toutes les fiches élèves.
-- ----------------------------------------------------------------------------
drop policy if exists "students_select_self_or_staff" on public.students;
create policy "students_select_self_or_staff" on public.students
  for select using (user_id = auth.uid() or public.is_coach_or_admin());
drop policy if exists "students_update_self_or_staff" on public.students;
create policy "students_update_self_or_staff" on public.students
  for update using (user_id = auth.uid() or public.is_coach_or_admin());
drop policy if exists "students_manage_staff" on public.students;
create policy "students_manage_staff" on public.students
  for insert with check (public.is_coach_or_admin());
drop policy if exists "students_delete_staff" on public.students;
create policy "students_delete_staff" on public.students
  for delete using (public.is_coach_or_admin());

drop policy if exists "student_profiles_select_self_or_staff" on public.student_profiles;
create policy "student_profiles_select_self_or_staff" on public.student_profiles
  for select using (student_id = public.current_student_id() or public.is_coach_or_admin());
drop policy if exists "student_profiles_manage_self_or_staff" on public.student_profiles;
create policy "student_profiles_manage_self_or_staff" on public.student_profiles
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

-- ----------------------------------------------------------------------------
-- Tables où l'élève lit ET écrit ses propres données (il ajoute lui-même ses
-- photos/mensurations/retours), le coach/admin a un accès complet.
-- ----------------------------------------------------------------------------
drop policy if exists "progress_photos_student_or_staff" on public.progress_photos;
create policy "progress_photos_student_or_staff" on public.progress_photos
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

drop policy if exists "weight_entries_student_or_staff" on public.weight_entries;
create policy "weight_entries_student_or_staff" on public.weight_entries
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

drop policy if exists "body_measurements_student_or_staff" on public.body_measurements;
create policy "body_measurements_student_or_staff" on public.body_measurements
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

drop policy if exists "custom_measurements_student_or_staff" on public.custom_measurements;
create policy "custom_measurements_student_or_staff" on public.custom_measurements
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

drop policy if exists "workout_feedback_student_or_staff" on public.workout_feedback;
create policy "workout_feedback_student_or_staff" on public.workout_feedback
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

drop policy if exists "exercise_feedback_student_or_staff" on public.exercise_feedback;
create policy "exercise_feedback_student_or_staff" on public.exercise_feedback
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

drop policy if exists "exercise_set_feedback_student_or_staff" on public.exercise_set_feedback;
create policy "exercise_set_feedback_student_or_staff" on public.exercise_set_feedback
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

-- ----------------------------------------------------------------------------
-- Tables où l'élève lit seulement ses propres données, gérées par le
-- coach/admin (paiement, notes internes, statut de lecture documents).
-- ----------------------------------------------------------------------------
drop policy if exists "payments_select_self_or_staff" on public.payments;
create policy "payments_select_self_or_staff" on public.payments
  for select using (student_id = public.current_student_id() or public.is_coach_or_admin());
drop policy if exists "payments_manage_staff" on public.payments;
create policy "payments_manage_staff" on public.payments
  for insert with check (public.is_coach_or_admin());
drop policy if exists "payments_update_staff" on public.payments;
create policy "payments_update_staff" on public.payments
  for update using (public.is_coach_or_admin());
drop policy if exists "payments_delete_staff" on public.payments;
create policy "payments_delete_staff" on public.payments
  for delete using (public.is_coach_or_admin());

drop policy if exists "payment_entries_select_self_or_staff" on public.payment_entries;
create policy "payment_entries_select_self_or_staff" on public.payment_entries
  for select using (student_id = public.current_student_id() or public.is_coach_or_admin());
drop policy if exists "payment_entries_manage_staff" on public.payment_entries;
create policy "payment_entries_manage_staff" on public.payment_entries
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

drop policy if exists "coach_notes_staff_only" on public.coach_notes;
create policy "coach_notes_staff_only" on public.coach_notes
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

drop policy if exists "document_assignments_select_self_or_staff" on public.document_assignments;
create policy "document_assignments_select_self_or_staff" on public.document_assignments
  for select using (student_id = public.current_student_id() or public.is_coach_or_admin());
drop policy if exists "document_assignments_update_self_or_staff" on public.document_assignments;
create policy "document_assignments_update_self_or_staff" on public.document_assignments
  -- l'élève peut mettre à jour viewed_at (marquer un document comme consulté)
  for update
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());
drop policy if exists "document_assignments_manage_staff" on public.document_assignments;
create policy "document_assignments_manage_staff" on public.document_assignments
  for insert with check (public.is_coach_or_admin());
drop policy if exists "document_assignments_delete_staff" on public.document_assignments;
create policy "document_assignments_delete_staff" on public.document_assignments
  for delete using (public.is_coach_or_admin());

drop policy if exists "assignments_select_self_or_staff" on public.assignments;
create policy "assignments_select_self_or_staff" on public.assignments
  for select using (student_id = public.current_student_id() or public.is_coach_or_admin());
drop policy if exists "assignments_manage_staff" on public.assignments;
create policy "assignments_manage_staff" on public.assignments
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

-- ----------------------------------------------------------------------------
-- Contenus créés par le coach (programmes, plans nutrition, documents,
-- banque d'exercices) : gestion complète par coach/admin. Lecture élève
-- limitée au contenu qui lui est assigné (via assignments / document_
-- assignments, ou via le student_id direct pour les plans nutrition).
-- ----------------------------------------------------------------------------
drop policy if exists "programs_manage_staff" on public.programs;
create policy "programs_manage_staff" on public.programs
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
drop policy if exists "programs_select_assigned_student" on public.programs;
create policy "programs_select_assigned_student" on public.programs
  for select using (
    exists (
      select 1 from public.assignments a
      where a.content_type = 'programme'
        and a.content_id = programs.id
        and a.student_id = public.current_student_id()
    )
  );

drop policy if exists "program_weeks_manage_staff" on public.program_weeks;
create policy "program_weeks_manage_staff" on public.program_weeks
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
drop policy if exists "program_weeks_select_assigned_student" on public.program_weeks;
create policy "program_weeks_select_assigned_student" on public.program_weeks
  for select using (
    exists (
      select 1 from public.assignments a
      where a.content_type = 'programme'
        and a.content_id = program_weeks.program_id
        and a.student_id = public.current_student_id()
    )
  );

drop policy if exists "workout_sessions_manage_staff" on public.workout_sessions;
create policy "workout_sessions_manage_staff" on public.workout_sessions
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
drop policy if exists "workout_sessions_select_assigned_student" on public.workout_sessions;
create policy "workout_sessions_select_assigned_student" on public.workout_sessions
  for select using (
    exists (
      select 1 from public.assignments a
      where a.content_type = 'programme'
        and a.content_id = workout_sessions.program_id
        and a.student_id = public.current_student_id()
    )
  );

drop policy if exists "workout_exercises_manage_staff" on public.workout_exercises;
create policy "workout_exercises_manage_staff" on public.workout_exercises
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
drop policy if exists "workout_exercises_select_assigned_student" on public.workout_exercises;
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

drop policy if exists "exercise_library_staff_only" on public.exercise_library;
create policy "exercise_library_staff_only" on public.exercise_library
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

drop policy if exists "nutrition_plans_manage_staff" on public.nutrition_plans;
create policy "nutrition_plans_manage_staff" on public.nutrition_plans
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
-- Assignation nutrition = nutrition_plans.student_id directement (PAS la
-- table `assignments`, réservée aux programmes — voir lib/supabase/nutrition.ts).
-- Rejoue proprement même si la policy existait déjà sous une forme
-- précédente (avec ou sans branche `assignments`).
drop policy if exists "nutrition_plans_select_self" on public.nutrition_plans;
drop policy if exists "nutrition_plans_select_self_or_assigned" on public.nutrition_plans;
create policy "nutrition_plans_select_self_or_assigned" on public.nutrition_plans
  for select using (student_id = public.current_student_id());

drop policy if exists "nutrition_days_manage_staff" on public.nutrition_days;
create policy "nutrition_days_manage_staff" on public.nutrition_days
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
drop policy if exists "nutrition_days_select_self" on public.nutrition_days;
drop policy if exists "nutrition_days_select_self_or_assigned" on public.nutrition_days;
create policy "nutrition_days_select_self_or_assigned" on public.nutrition_days
  for select using (
    exists (
      select 1 from public.nutrition_plans p
      where p.id = nutrition_days.plan_id
        and p.student_id = public.current_student_id()
    )
  );
drop policy if exists "nutrition_days_update_self" on public.nutrition_days;
create policy "nutrition_days_update_self" on public.nutrition_days
  -- l'élève valide/modifie sa propre journée (champ "actual")
  for update
  using (
    exists (
      select 1 from public.nutrition_plans p
      where p.id = nutrition_days.plan_id
        and p.student_id = public.current_student_id()
    )
  )
  with check (
    exists (
      select 1 from public.nutrition_plans p
      where p.id = nutrition_days.plan_id
        and p.student_id = public.current_student_id()
    )
  );

drop policy if exists "meals_manage_staff" on public.meals;
create policy "meals_manage_staff" on public.meals
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
drop policy if exists "meals_select_self" on public.meals;
drop policy if exists "meals_select_self_or_assigned" on public.meals;
create policy "meals_select_self_or_assigned" on public.meals
  for select using (
    exists (
      select 1 from public.nutrition_days d
      join public.nutrition_plans p on p.id = d.plan_id
      where d.id = meals.nutrition_day_id
        and p.student_id = public.current_student_id()
    )
  );

-- L'élève lit/écrit uniquement ses propres logs journaliers (même pattern
-- que weight_entries/progress_photos) ; le coach/admin a un accès complet
-- (lecture des logs de ses élèves, correction si nécessaire).
drop policy if exists "nutrition_daily_logs_student_or_staff" on public.nutrition_daily_logs;
create policy "nutrition_daily_logs_student_or_staff" on public.nutrition_daily_logs
  for all
  using (student_id = public.current_student_id() or public.is_coach_or_admin())
  with check (student_id = public.current_student_id() or public.is_coach_or_admin());

drop policy if exists "documents_manage_staff" on public.documents;
create policy "documents_manage_staff" on public.documents
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
-- Un élève ne voit qu'un document publié (jamais brouillon/archivé), et
-- seulement s'il est global ou explicitement assigné — le déblocage dans le
-- temps (level/unlock_after_weeks/unlock_at) reste calculé côté app (voir
-- lib/supabase/documents.ts), même principe que le reste de l'app (aucune
-- autre fonctionnalité de déblocage temporel n'est appliquée au niveau RLS).
drop policy if exists "documents_select_assigned_student" on public.documents;
drop policy if exists "documents_select_global_or_assigned" on public.documents;
create policy "documents_select_global_or_assigned" on public.documents
  for select using (
    status = 'publié'
    and (
      visibility = 'global'
      or exists (
        select 1 from public.document_assignments da
        where da.document_id = documents.id and da.student_id = public.current_student_id()
      )
    )
  );

drop policy if exists "document_levels_select_authenticated" on public.document_levels;
create policy "document_levels_select_authenticated" on public.document_levels
  for select using (auth.role() = 'authenticated');
drop policy if exists "document_levels_manage_staff" on public.document_levels;
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
-- Supabase Storage — buckets prévus.
-- ============================================================================
-- progress-photos : photos de progression élève (Avant/Actuelle/Objectif/
--                    mensuelle). Remplacera à terme le stockage en base64
--                    dans localStorage utilisé par le mock.
-- documents        : fichiers uploadés depuis /admin/documents (PDF, images,
--                    vidéos, autres) — branché depuis le chantier
--                    "supabase-documents-storage-upload", convention de
--                    chemin `<document_id>/<timestamp>-<nom-fichier>` (voir
--                    lib/supabase/storage-documents.ts). Reste privé
--                    (public: false) — lecture élève via URL signée
--                    (`createSignedUrl`), jamais d'URL publique directe.
-- videos           : provisionné mais volontairement non utilisé — les
--                    vidéos uploadées passent aussi par le bucket
--                    "documents" pour éviter de dupliquer la policy
--                    d'accès par document sur deux buckets ; `documents.video_url`
--                    reste disponible pour un lien externe (YouTube, Vimeo...).
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
drop policy if exists "progress_photos_bucket_student_or_staff" on storage.objects;
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

-- Lecture resserrée par document (chantier "supabase-documents-storage-upload") :
-- remplace l'ancienne policy "authenticated" (n'importe quel élève pouvait
-- lire n'importe quel fichier du bucket) par un vrai contrôle d'accès —
-- même règle que la lecture de la ligne `documents` elle-même
-- (`documents_select_global_or_assigned`, voir PR #20) : staff toujours OK,
-- élève seulement si le document `<document_id>` (premier segment du
-- chemin) est publié et global ou lui est assigné. Le déblocage dans le
-- temps (niveau/semaines/date) reste calculé côté app, jamais en RLS —
-- même principe que le reste du projet (voir docs/supabase-documents-storage-upload-model.md).
drop policy if exists "documents_bucket_select_authenticated" on storage.objects;
drop policy if exists "documents_bucket_select_accessible" on storage.objects;
create policy "documents_bucket_select_accessible" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (
      public.is_coach_or_admin()
      or exists (
        select 1 from public.documents d
        where d.id::text = (storage.foldername(name))[1]
          and d.status = 'publié'
          and (
            d.visibility = 'global'
            or exists (
              select 1 from public.document_assignments da
              where da.document_id = d.id and da.student_id = public.current_student_id()
            )
          )
      )
    )
  );
drop policy if exists "documents_bucket_manage_staff" on storage.objects;
create policy "documents_bucket_manage_staff" on storage.objects
  for insert with check (bucket_id = 'documents' and public.is_coach_or_admin());
drop policy if exists "documents_bucket_update_staff" on storage.objects;
create policy "documents_bucket_update_staff" on storage.objects
  for update using (bucket_id = 'documents' and public.is_coach_or_admin());
drop policy if exists "documents_bucket_delete_staff" on storage.objects;
create policy "documents_bucket_delete_staff" on storage.objects
  for delete using (bucket_id = 'documents' and public.is_coach_or_admin());

drop policy if exists "videos_bucket_select_authenticated" on storage.objects;
create policy "videos_bucket_select_authenticated" on storage.objects
  for select using (bucket_id = 'videos' and auth.role() = 'authenticated');
drop policy if exists "videos_bucket_manage_staff" on storage.objects;
create policy "videos_bucket_manage_staff" on storage.objects
  for insert with check (bucket_id = 'videos' and public.is_coach_or_admin());
drop policy if exists "videos_bucket_update_staff" on storage.objects;
create policy "videos_bucket_update_staff" on storage.objects
  for update using (bucket_id = 'videos' and public.is_coach_or_admin());
drop policy if exists "videos_bucket_delete_staff" on storage.objects;
create policy "videos_bucket_delete_staff" on storage.objects
  for delete using (bucket_id = 'videos' and public.is_coach_or_admin());

-- ============================================================================
-- Migration additive — chantier "supabase-exercise-library" : bibliothèque
-- d'exercices réelle (branchement complet de `exercise_library`, jusqu'ici
-- créée mais jamais utilisée par l'app — voir lib/supabase/programs.ts).
-- `exercise_library` et `workout_exercises` existaient déjà : colonnes
-- ajoutées additivement, aucune table recréée, aucune colonne renommée.
-- ============================================================================
alter table public.exercise_library add column if not exists description text not null default '';
alter table public.exercise_library add column if not exists secondary_muscles jsonb not null default '[]'::jsonb;
alter table public.exercise_library add column if not exists exercise_type text not null default '';
alter table public.exercise_library add column if not exists alternative_video_url text not null default '';
alter table public.exercise_library add column if not exists technical_cues text not null default '';
alter table public.exercise_library add column if not exists common_mistakes text not null default '';
alter table public.exercise_library add column if not exists default_tempo text not null default '';
alter table public.exercise_library add column if not exists default_rest_seconds integer;
alter table public.exercise_library add column if not exists tags jsonb not null default '[]'::jsonb;
alter table public.exercise_library add column if not exists status text not null default 'active';

alter table public.exercise_library drop constraint if exists exercise_library_status_check;
alter table public.exercise_library add constraint exercise_library_status_check check (status in ('active', 'archived'));

-- Lien optionnel d'un exercice de séance vers la banque — nullable pour ne
-- jamais casser les `workout_exercises` déjà créés par valeur (copie
-- name/video_url/... sans FK), qui continuent de s'afficher normalement.
alter table public.workout_exercises add column if not exists exercise_library_id uuid references public.exercise_library (id) on delete set null;

-- RLS : le coach/admin garde un accès complet (remplace l'ancienne policy
-- "staff only" qui interdisait toute lecture élève). L'élève peut désormais
-- lire les exercices actifs (jamais archivés) — lecture générale plutôt que
-- restreinte à ses programmes assignés, car la banque est un référentiel
-- partagé non spécifique à un élève (même principe que document_levels).
drop policy if exists "exercise_library_staff_only" on public.exercise_library;
drop policy if exists "exercise_library_manage_staff" on public.exercise_library;
create policy "exercise_library_manage_staff" on public.exercise_library
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
drop policy if exists "exercise_library_select_active" on public.exercise_library;
create policy "exercise_library_select_active" on public.exercise_library
  for select using (status = 'active');

-- Données initiales — reprend les exercices mock déjà rédigés dans
-- data/admin.ts (adminExerciseLibrary) plutôt qu'une liste arbitraire,
-- uniquement si la banque est vide côté base. Idempotent : rejouable sans
-- créer de doublons (vérifie l'absence par nom avant chaque insertion).
do $$
begin
  if not exists (select 1 from public.exercise_library) then
    insert into public.exercise_library
      (name, description, muscle_group, secondary_muscles, category, exercise_type, equipment, level, video_url, technical_cues, common_mistakes, tags, status)
    values
      ('Développé couché barre', '', 'pectoraux', '["triceps","épaules"]'::jsonb, 'Force', 'Force', 'Barre', 'intermédiaire', 'https://videos.seth-coaching.mock/exercices/developpe-couche.mp4', 'Omoplates rétractées, pieds ancrés au sol, barre touche le bas de la poitrine.', 'Contrôle la descente sur 2 secondes, pousse explosif en haut.', '["pectoraux","force","barre"]'::jsonb, 'active'),
      ('Squat barre', '', 'quadriceps', '["fessiers","ischios"]'::jsonb, 'Force', 'Force', 'Barre', 'intermédiaire', 'https://videos.seth-coaching.mock/exercices/squat-barre.mp4', 'Descend jusqu''à parallèle minimum, dos neutre, genoux dans l''axe des pieds.', 'Échauffement progressif obligatoire avant les séries lourdes.', '["jambes","force","barre"]'::jsonb, 'active'),
      ('Tractions lestées', '', 'dos', '["biceps"]'::jsonb, 'Force', 'Force', 'Aucun', 'avancé', 'https://videos.seth-coaching.mock/exercices/tractions.mp4', 'Amplitude complète, menton au-dessus de la barre, descente contrôlée.', 'Ajoute du lest par palier de 2,5 kg quand 8 reps strictes sont atteintes.', '["dos","tirage","poids du corps"]'::jsonb, 'active'),
      ('Rowing barre', '', 'dos', '["biceps"]'::jsonb, 'Hypertrophie', 'Hypertrophie', 'Barre', 'intermédiaire', 'https://videos.seth-coaching.mock/exercices/rowing-barre.mp4', 'Buste penché à 45°, tire la barre vers le nombril, serre les omoplates.', 'Évite de cambrer le bas du dos pour tricher la charge.', '["dos","tirage","barre"]'::jsonb, 'active'),
      ('Développé militaire barre', '', 'épaules', '["triceps"]'::jsonb, 'Force', 'Force', 'Barre', 'intermédiaire', 'https://videos.seth-coaching.mock/exercices/developpe-militaire.mp4', 'Gainage serré, barre part du haut des clavicules, trajectoire verticale.', 'Éviter en cas de gêne d''épaule — proposer l''alternative haltères assis.', '["épaules","force","barre"]'::jsonb, 'active'),
      ('Élévations latérales', '', 'épaules', '[]'::jsonb, 'Hypertrophie', 'Hypertrophie', 'Haltères', 'débutant', 'https://videos.seth-coaching.mock/exercices/elevations-laterales.mp4', 'Coudes légèrement fléchis, monte jusqu''à hauteur d''épaule, pas plus haut.', 'Charge légère, priorité à la qualité d''exécution sur ce mouvement d''isolation.', '["épaules","isolation","haltères"]'::jsonb, 'active'),
      ('Fentes marchées haltères', '', 'quadriceps', '["fessiers"]'::jsonb, 'Hypertrophie', 'Hypertrophie', 'Haltères', 'intermédiaire', 'https://videos.seth-coaching.mock/exercices/fentes-marchees.mp4', 'Grand pas en avant, genou arrière frôle le sol, buste droit.', 'Bien adapté en fin de séance jambes pour finir en douceur.', '["jambes","unilatéral","haltères"]'::jsonb, 'active'),
      ('Gainage planche', '', 'abdos', '["lombaires"]'::jsonb, 'Gainage', 'Gainage', 'Aucun', 'débutant', 'https://videos.seth-coaching.mock/exercices/gainage-planche.mp4', 'Corps aligné tête-bassin-talons, ne pas laisser tomber les hanches.', 'Bon exercice de fin de séance ou d''échauffement pour l''activation du tronc.', '["abdos","statique","poids du corps"]'::jsonb, 'active'),
      ('Corde à sauter', '', 'cardio', '["mollets"]'::jsonb, 'Cardio', 'Cardio', 'Cardio machine', 'débutant', 'https://videos.seth-coaching.mock/exercices/corde-a-sauter.mp4', 'Petits sauts, poignets qui font tourner la corde, atterrissage sur l''avant-pied.', 'Idéal en échauffement ou en fin de séance pour la dépense calorique.', '["cardio","conditionnement"]'::jsonb, 'active'),
      ('Rotations d''épaules élastique', '', 'épaules', '[]'::jsonb, 'Échauffement', 'Échauffement', 'Élastique', 'débutant', 'https://videos.seth-coaching.mock/exercices/mobilite-epaule.mp4', 'Rotation externe contrôlée, coude fixe au corps, amplitude progressive.', 'À intégrer systématiquement en échauffement avant les séances haut du corps.', '["mobilité","échauffement","élastique"]'::jsonb, 'active')
    on conflict do nothing;
  end if;
end $$;

-- ============================================================================
-- Migration additive — chantier "supabase-calendar-booking-system" :
-- calendrier / réservation type Calendly. Aucune table de calendrier
-- n'existait déjà (audit : aucune occurrence de calendar/appointments/
-- bookings/availability dans le repo hors ce chantier) — 5 tables nouvelles,
-- toutes `create table if not exists` pour rester rejouable sans erreur.
--
-- Choix de coach_id : nullable, jamais renseigné à l'écriture (même
-- convention que programs.coach_id / nutrition_plans.coach_id /
-- exercise_library.coach_id, déjà en place et jamais réellement écrite non
-- plus) — l'app reste un espace staff partagé unique (is_coach_or_admin()),
-- pas un modèle multi-coach avec isolation par coach. FK vers coaches(id)
-- pour rester cohérent avec ces mêmes colonnes existantes.
--
-- appointments.student_id référence students(id) (jamais profiles.id,
-- auth.users.id ni student_profiles.id) — même convention que
-- assignments.student_id / workout_feedback.student_id / documents.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 26. coach_availabilities — plages récurrentes hebdomadaires du coach.
-- ----------------------------------------------------------------------------
create table if not exists public.coach_availabilities (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references public.coaches (id) on delete set null,
  weekday integer not null check (weekday between 0 and 6), -- 0 dimanche .. 6 samedi (JS Date#getDay())
  start_time time not null,
  end_time time not null,
  slot_duration_minutes integer not null default 60 check (slot_duration_minutes > 0),
  appointment_type text not null default 'Autre',
  location text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_availabilities_time_order check (end_time > start_time)
);

-- ----------------------------------------------------------------------------
-- 27. coach_unavailabilities — exceptions ponctuelles (vacances, jour
--     férié, déplacement, rendez-vous personnel...).
-- ----------------------------------------------------------------------------
create table if not exists public.coach_unavailabilities (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references public.coaches (id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_unavailabilities_time_order check (end_at > start_at)
);

-- ----------------------------------------------------------------------------
-- 28. appointments — un rendez-vous coach/élève.
-- ----------------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students (id) on delete cascade,
  coach_id uuid references public.coaches (id) on delete set null,
  title text not null default '',
  description text not null default '',
  appointment_type text not null default 'Autre',
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'Europe/Paris',
  location text not null default '',
  meeting_url text not null default '',
  status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  cancellation_reason text not null default '',
  rescheduled_from_id uuid references public.appointments (id) on delete set null,
  calendar_event_id text,
  ics_uid text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_time_order check (end_at > start_at)
);
create index if not exists appointments_student_id_idx on public.appointments (student_id);
create index if not exists appointments_start_at_idx on public.appointments (start_at);

-- ----------------------------------------------------------------------------
-- 29. appointment_email_logs — traçabilité des envois (confirmation,
--     annulation, report), y compris quand aucun provider n'est encore
--     branché (voir lib/email/appointment-emails.ts).
-- ----------------------------------------------------------------------------
create table if not exists public.appointment_email_logs (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments (id) on delete cascade,
  recipient_email text not null default '',
  type text not null default '',
  status text not null default '',
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 30. booking_settings — réglages globaux de réservation (durée par défaut,
--     délai minimum avant réservation, limite dans le futur). Ligne
--     singleton (une seule rangée utilisée, la plus ancienne) plutôt que
--     rattachée à un coach précis — même raisonnement que coach_id ci-dessus.
-- ----------------------------------------------------------------------------
create table if not exists public.booking_settings (
  id uuid primary key default gen_random_uuid(),
  min_lead_minutes integer not null default 120 check (min_lead_minutes >= 0),
  max_days_ahead integer not null default 30 check (max_days_ahead > 0),
  default_duration_minutes integer not null default 60 check (default_duration_minutes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.booking_settings (min_lead_minutes, max_days_ahead, default_duration_minutes)
select 120, 30, 60
where not exists (select 1 from public.booking_settings);

-- ----------------------------------------------------------------------------
-- Triggers updated_at pour les nouvelles tables.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'coach_availabilities', 'coach_unavailabilities', 'appointments', 'booking_settings'
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

-- ----------------------------------------------------------------------------
-- Row Level Security.
-- ----------------------------------------------------------------------------
alter table public.coach_availabilities enable row level security;
alter table public.coach_unavailabilities enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_email_logs enable row level security;
alter table public.booking_settings enable row level security;

-- coach_availabilities / coach_unavailabilities / booking_settings : lecture
-- par tout utilisateur authentifié (l'élève doit pouvoir calculer les
-- créneaux disponibles côté client), écriture réservée au staff — même
-- principe que document_levels (référentiel partagé, pas de donnée
-- personnelle).
drop policy if exists "coach_availabilities_select_authenticated" on public.coach_availabilities;
create policy "coach_availabilities_select_authenticated" on public.coach_availabilities
  for select using (auth.role() = 'authenticated');
drop policy if exists "coach_availabilities_manage_staff" on public.coach_availabilities;
create policy "coach_availabilities_manage_staff" on public.coach_availabilities
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

drop policy if exists "coach_unavailabilities_select_authenticated" on public.coach_unavailabilities;
create policy "coach_unavailabilities_select_authenticated" on public.coach_unavailabilities
  for select using (auth.role() = 'authenticated');
drop policy if exists "coach_unavailabilities_manage_staff" on public.coach_unavailabilities;
create policy "coach_unavailabilities_manage_staff" on public.coach_unavailabilities
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

drop policy if exists "booking_settings_select_authenticated" on public.booking_settings;
create policy "booking_settings_select_authenticated" on public.booking_settings
  for select using (auth.role() = 'authenticated');
drop policy if exists "booking_settings_manage_staff" on public.booking_settings;
create policy "booking_settings_manage_staff" on public.booking_settings
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

-- appointments : staff accès complet (lecture/création/modification/
-- annulation de tous les rendez-vous, y compris ceux de tous les élèves) ;
-- élève limité à ses propres rendez-vous (lecture, création pour lui-même,
-- modification pour lui-même — utilisée uniquement pour l'annulation côté
-- UI élève, jamais pour modifier le rendez-vous d'un autre puisque
-- restreinte à `student_id = current_student_id()`).
drop policy if exists "appointments_manage_staff" on public.appointments;
create policy "appointments_manage_staff" on public.appointments
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
drop policy if exists "appointments_select_own_student" on public.appointments;
create policy "appointments_select_own_student" on public.appointments
  for select using (student_id = public.current_student_id());
drop policy if exists "appointments_insert_own_student" on public.appointments;
create policy "appointments_insert_own_student" on public.appointments
  for insert with check (student_id = public.current_student_id());
drop policy if exists "appointments_update_own_student" on public.appointments;
create policy "appointments_update_own_student" on public.appointments
  for update
  using (student_id = public.current_student_id())
  with check (student_id = public.current_student_id());

-- appointment_email_logs : staff uniquement (journal interne, jamais exposé
-- à l'élève).
drop policy if exists "appointment_email_logs_manage_staff" on public.appointment_email_logs;
create policy "appointment_email_logs_manage_staff" on public.appointment_email_logs
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

-- ============================================================================
-- Migration additive — chantier "supabase-activity-notifications" : centre
-- d'activité interne coach/admin (aucune table équivalente n'existait —
-- audit : aucune occurrence de activity_events/notifications réelles dans
-- le repo, seulement des panneaux "Notifications (exemple)" mock non liés).
-- ============================================================================
create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students (id) on delete cascade,
  actor_type text not null default 'system' check (actor_type in ('student', 'coach', 'system')),
  event_type text not null,
  title text not null,
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists activity_events_student_id_idx on public.activity_events (student_id);
create index if not exists activity_events_created_at_idx on public.activity_events (created_at desc);
create index if not exists activity_events_is_read_idx on public.activity_events (is_read);

alter table public.activity_events enable row level security;

-- Staff : accès complet (lecture du centre d'activité, marquer comme lu).
-- Élève : peut uniquement créer un évènement pour lui-même (actions
-- déclenchées côté client élève — onboarding, poids, retour entraînement,
-- suivi nutrition, réservation/annulation de rendez-vous), jamais lire ni
-- modifier le centre d'activité (réservé au staff), jamais créer un
-- évènement pour un autre élève.
drop policy if exists "activity_events_manage_staff" on public.activity_events;
create policy "activity_events_manage_staff" on public.activity_events
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
drop policy if exists "activity_events_insert_own_student" on public.activity_events;
create policy "activity_events_insert_own_student" on public.activity_events
  for insert with check (student_id = public.current_student_id());

-- ============================================================================
-- Migration additive — chantier "supabase-progress-photos-before-after-export" :
-- photos de progression réelles (upload Storage, comparaison avant/après,
-- export PDF). La table `progress_photos` et le bucket Storage
-- "progress-photos" existaient déjà (voir plus haut section 21 et policies
-- `progress_photos_student_or_staff` / `progress_photos_bucket_student_or_staff`
-- ci-dessus) avec un schéma minimal (type/date/weight_kg/note/image_url/
-- storage_path/pending) pensé pour un mock local (URL objet, pas d'upload
-- réel). Ce chantier étend la table pour un vrai upload et ne crée NI
-- nouvelle table NI nouvelle policy : la RLS déjà en place (staff accès
-- complet, élève limité à `student_id = current_student_id()` ; bucket
-- limité au dossier `{studentId}/...` de l'élève) couvre déjà exactement les
-- règles de sécurité demandées.
--
-- `photo_type` (face/profil/dos/autre = angle de prise de vue) est distinct
-- de la colonne `type` existante (avant/actuelle/objectif/mensuelle = rôle
-- de la photo) — les deux coexistent, aucune ne remplace l'autre.
-- ============================================================================
alter table public.progress_photos add column if not exists photo_type text not null default 'autre';
alter table public.progress_photos drop constraint if exists progress_photos_photo_type_check;
alter table public.progress_photos add constraint progress_photos_photo_type_check check (photo_type in ('face', 'profil', 'dos', 'autre'));
alter table public.progress_photos add column if not exists uploaded_by uuid;
alter table public.progress_photos add column if not exists file_name text;
alter table public.progress_photos add column if not exists file_size_bytes bigint;
alter table public.progress_photos add column if not exists file_mime_type text;
alter table public.progress_photos add column if not exists is_before_candidate boolean not null default false;
alter table public.progress_photos add column if not exists is_after_candidate boolean not null default false;
alter table public.progress_photos add column if not exists status text not null default 'active';
alter table public.progress_photos drop constraint if exists progress_photos_status_check;
alter table public.progress_photos add constraint progress_photos_status_check check (status in ('active', 'archived'));

-- ============================================================================
-- Migration additive — chantier "supabase-stripe-payments-subscriptions" :
-- paiements/abonnements réels via Stripe Checkout + Customer Portal.
--
-- Audit : une table `payments` existe déjà (section 8 plus haut), mais elle
-- correspond à une fiche paiement saisie manuellement par le coach
-- (StudentPaymentProfile — offre, méthode virement/carte/espèces/chèque,
-- échéancier saisi à la main, une seule ligne par élève via
-- `student_id ... unique`). Ce n'est PAS un journal de transactions Stripe :
-- forme différente (pas de colonnes stripe_*), cardinalité différente (une
-- ligne par élève vs une ligne par transaction), et alimentée différemment
-- (formulaire admin vs webhook). La réutiliser aurait cassé la section
-- "Paiement" existante de /admin/eleves/[studentId] (PaymentSection). Elle
-- est donc laissée totalement intacte, et la table de transactions Stripe
-- ci-dessous est nommée `stripe_payments` pour éviter toute confusion/
-- collision de nom.
--
-- Aucune des 4 tables ci-dessous (billing_customers, subscriptions,
-- stripe_payments, billing_events) n'existait avant ce chantier.
--
-- Source de vérité : Stripe (webhook) → Supabase, jamais l'inverse. Toutes
-- les écritures viennent du webhook `/api/stripe/webhook` ou des routes
-- `/api/stripe/create-checkout-session` / `create-customer-portal-session`,
-- exécutées côté serveur avec le client service role
-- (lib/supabase/admin.ts, contourne RLS) après vérification manuelle des
-- droits de l'appelant — jamais directement depuis le navigateur élève.
-- Les policies RLS ci-dessous ne servent donc qu'à la LECTURE côté client
-- (élève : son propre statut ; staff : tous) — aucune policy d'écriture
-- n'est posée pour l'élève, conformément à "le statut abonnement ne doit
-- jamais être modifié manuellement par l'élève côté frontend".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 31. billing_customers — correspondance élève ↔ client Stripe (1:1).
-- ----------------------------------------------------------------------------
create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.students (id) on delete cascade,
  stripe_customer_id text not null unique,
  email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_customers_student_id_idx on public.billing_customers (student_id);

-- ----------------------------------------------------------------------------
-- 32. subscriptions — abonnement Stripe d'un élève. `status` reste la valeur
--     Stripe brute (active/past_due/canceled/trialing/incomplete/unpaid/
--     paused/incomplete_expired) — la traduction en statut élève (actif/en
--     attente/paiement échoué/annulé/expiré) se fait à l'affichage
--     (lib/stripe/status.ts), jamais stockée transformée.
-- ----------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text not null unique,
  stripe_price_id text,
  stripe_product_id text,
  plan_name text not null default '',
  status text not null default 'incomplete',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  amount_cents integer,
  currency text not null default 'eur',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_student_id_idx on public.subscriptions (student_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);

-- ----------------------------------------------------------------------------
-- 33. stripe_payments — journal des transactions Stripe (une ligne par
--     facture/paiement), distinct de la table `payments` existante (voir
--     note d'audit ci-dessus).
-- ----------------------------------------------------------------------------
create table if not exists public.stripe_payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  stripe_customer_id text,
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  stripe_subscription_id text,
  amount_cents integer,
  currency text not null default 'eur',
  status text not null default '',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stripe_payments_student_id_idx on public.stripe_payments (student_id);
create unique index if not exists stripe_payments_invoice_id_idx on public.stripe_payments (stripe_invoice_id) where stripe_invoice_id is not null;

-- ----------------------------------------------------------------------------
-- 34. billing_events — journal brut des évènements webhook Stripe déjà
--     traités, pour rendre le webhook idempotent (Stripe peut renvoyer le
--     même évènement plusieurs fois).
-- ----------------------------------------------------------------------------
create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Triggers updated_at pour les nouvelles tables.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in
    select unnest(array['billing_customers', 'subscriptions', 'stripe_payments'])
  loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I; ' ||
      'create trigger set_updated_at before update on public.%I ' ||
      'for each row execute function public.set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Row Level Security.
-- ----------------------------------------------------------------------------
alter table public.billing_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_payments enable row level security;
alter table public.billing_events enable row level security;

-- Staff : accès complet (lecture du statut billing de tous les élèves,
-- résumé paiement) — les écritures réelles passent par le client service
-- role depuis les routes API, cette policy ne sert qu'à une éventuelle
-- lecture directe côté navigateur admin.
drop policy if exists "billing_customers_manage_staff" on public.billing_customers;
create policy "billing_customers_manage_staff" on public.billing_customers
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
drop policy if exists "subscriptions_manage_staff" on public.subscriptions;
create policy "subscriptions_manage_staff" on public.subscriptions
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
drop policy if exists "stripe_payments_manage_staff" on public.stripe_payments;
create policy "stripe_payments_manage_staff" on public.stripe_payments
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());
drop policy if exists "billing_events_manage_staff" on public.billing_events;
create policy "billing_events_manage_staff" on public.billing_events
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

-- Élève : lecture seule de son propre statut billing. Aucune policy
-- d'insert/update/delete pour l'élève : le statut ne peut jamais être
-- modifié directement depuis le frontend élève, uniquement via le webhook
-- Stripe (client service role, contourne RLS).
drop policy if exists "billing_customers_select_own_student" on public.billing_customers;
create policy "billing_customers_select_own_student" on public.billing_customers
  for select using (student_id = public.current_student_id());
drop policy if exists "subscriptions_select_own_student" on public.subscriptions;
create policy "subscriptions_select_own_student" on public.subscriptions
  for select using (student_id = public.current_student_id());
drop policy if exists "stripe_payments_select_own_student" on public.stripe_payments;
create policy "stripe_payments_select_own_student" on public.stripe_payments
  for select using (student_id = public.current_student_id());
-- billing_events : aucune policy élève — journal interne, jamais exposé.

-- ============================================================================
-- Fin du schéma initial. Prochaine étape (pas dans ce fichier) : régénérer
-- types/supabase.ts avec `supabase gen types typescript`, puis brancher
-- progressivement chaque page mock sur ces tables (voir README.md).
-- ============================================================================
