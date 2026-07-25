-- Newsletter (Brevo) subscribers table. Additive migration, kept fully separate
-- from the Resend transactional email system.
create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  normalized_email text not null unique,
  profile_id uuid null references public.profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'subscribed', 'unsubscribed', 'bounced', 'complained', 'sync_failed')),
  source text not null default 'landing_page',
  consent_text_version text not null,
  consent_at timestamptz not null default now(),
  confirmed_at timestamptz null,
  unsubscribed_at timestamptz null,
  brevo_contact_id text null,
  brevo_list_id text null,
  last_sync_status text null,
  last_sync_error text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists newsletter_subscribers_status_idx
  on public.newsletter_subscribers (status);
create index if not exists newsletter_subscribers_profile_id_idx
  on public.newsletter_subscribers (profile_id);

alter table public.newsletter_subscribers enable row level security;

-- Staff (admin + coach) can read every subscriber. No public/anon read access.
drop policy if exists "newsletter_subscribers_select_staff" on public.newsletter_subscribers;
create policy "newsletter_subscribers_select_staff"
  on public.newsletter_subscribers
  for select
  using (public.is_coach_or_admin());

-- Staff can update subscriber rows (e.g. manual status fixes, resync flags).
drop policy if exists "newsletter_subscribers_update_staff" on public.newsletter_subscribers;
create policy "newsletter_subscribers_update_staff"
  on public.newsletter_subscribers
  for update
  using (public.is_coach_or_admin())
  with check (public.is_coach_or_admin());

-- Staff can delete subscriber rows if strictly necessary.
drop policy if exists "newsletter_subscribers_delete_staff" on public.newsletter_subscribers;
create policy "newsletter_subscribers_delete_staff"
  on public.newsletter_subscribers
  for delete
  using (public.is_coach_or_admin());

-- Intentionally no insert policy for anon/authenticated roles: the only way to
-- create a row is through the secured POST /api/newsletter/subscribe route,
-- which uses the service-role client and therefore bypasses RLS entirely.;
