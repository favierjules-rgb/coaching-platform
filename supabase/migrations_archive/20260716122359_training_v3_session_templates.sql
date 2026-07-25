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
;
