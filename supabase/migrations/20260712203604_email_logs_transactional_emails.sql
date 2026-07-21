create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  recipient_user_id uuid references auth.users (id) on delete set null,
  email_type text not null check (email_type in (
    'welcome',
    'subscription_assigned',
    'payment_succeeded',
    'payment_failed',
    'subscription_cancelled',
    'program_assigned',
    'nutrition_assigned',
    'document_assigned',
    'appointment_created',
    'appointment_cancelled',
    'appointment_reminder'
  )),
  subject text not null,
  resend_email_id text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  related_entity_type text,
  related_entity_id uuid,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_logs_recipient_email_idx on public.email_logs (recipient_email);
create index if not exists email_logs_recipient_user_id_idx on public.email_logs (recipient_user_id);
create index if not exists email_logs_email_type_idx on public.email_logs (email_type);
create index if not exists email_logs_status_idx on public.email_logs (status);
create index if not exists email_logs_related_entity_idx on public.email_logs (related_entity_type, related_entity_id);
create index if not exists email_logs_created_at_idx on public.email_logs (created_at desc);

alter table public.email_logs enable row level security;

drop policy if exists "email_logs_select_staff" on public.email_logs;
create policy "email_logs_select_staff" on public.email_logs
  for select using (public.is_coach_or_admin());
;
