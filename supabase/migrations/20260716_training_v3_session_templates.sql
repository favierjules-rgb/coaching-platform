-- Modèles de séances réutilisables (V3 étape 4) : une "banque de séances"
-- au même principe que exercise_library, mais pour des séances complètes
-- (muscu et/ou cardio). Contenu (exercices + blocs cardio) stocké en jsonb
-- car ce sont de simples snapshots copiés par valeur à l'insertion dans un
-- programme, jamais interrogés/filtrés champ par champ — cohérent avec le
-- choix déjà fait pour les blocs cardio (delete+reinsert, pas de diff fin).
create table if not exists session_templates (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references coaches(id) on delete set null,
  name text not null,
  description text not null default '',
  session_type text not null default 'strength' check (session_type in ('strength','cardio','mixed')),
  muscle_group text not null default '',
  duration_minutes integer,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table session_templates enable row level security;

create policy session_templates_manage_staff on session_templates
  for all using (is_coach_or_admin()) with check (is_coach_or_admin());
