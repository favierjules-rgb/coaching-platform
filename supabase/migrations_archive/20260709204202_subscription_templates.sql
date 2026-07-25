create table if not exists public.subscription_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'eur',
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'quarterly', 'yearly', 'one_time')),
  duration_months integer,
  stripe_product_id text,
  stripe_price_id text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.coaches (id) on delete set null
);
create index if not exists subscription_templates_is_active_idx on public.subscription_templates (is_active);

drop trigger if exists set_updated_at on public.subscription_templates;
create trigger set_updated_at before update on public.subscription_templates
  for each row execute function public.set_updated_at();

alter table public.subscription_templates enable row level security;

drop policy if exists "subscription_templates_select_active_or_staff" on public.subscription_templates;
create policy "subscription_templates_select_active_or_staff" on public.subscription_templates
  for select using (is_active = true or public.is_coach_or_admin());
drop policy if exists "subscription_templates_manage_staff" on public.subscription_templates;
create policy "subscription_templates_manage_staff" on public.subscription_templates
  for all using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

insert into public.subscription_templates (name, description, amount_cents, currency, billing_interval, stripe_product_id, stripe_price_id)
values
  ('Coaching distanciel', 'Coaching à distance — suivi personnalisé.', 15000, 'eur', 'monthly', 'prod_Uqy4ixEkxNgZLf', 'price_1TrG83LBSSMeCJsshZXkkXW6'),
  ('Coaching Présentiel', 'Coaching en salle — séances encadrées.', 24700, 'eur', 'monthly', 'prod_Uqzhuc21b5EznN', 'price_1TrHi7LBSSMeCJssb0gnx2Fi'),
  ('Coaching premium', 'Formule complète — suivi renforcé.', 39700, 'eur', 'monthly', 'prod_UqzhniwVDaqmBG', 'price_1TrHiNLBSSMeCJssVW33aKUw')
on conflict (stripe_price_id) do nothing;

alter table public.student_profiles add column if not exists assigned_subscription_template_id uuid references public.subscription_templates (id) on delete set null;

create or replace function public.protect_student_profiles_access_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_coach_or_admin() then
    new.billing_access_mode := old.billing_access_mode;
    new.assigned_stripe_plan := old.assigned_stripe_plan;
    new.assigned_stripe_price_id := old.assigned_stripe_price_id;
    new.access_note := old.access_note;
    new.access_updated_at := old.access_updated_at;
    new.access_updated_by := old.access_updated_by;
    new.assigned_subscription_template_id := old.assigned_subscription_template_id;
  end if;
  return new;
end;
$$;
;
