alter table public.student_profiles add column if not exists billing_access_mode text not null default 'subscription_required';
alter table public.student_profiles drop constraint if exists student_profiles_billing_access_mode_check;
alter table public.student_profiles add constraint student_profiles_billing_access_mode_check check (billing_access_mode in ('subscription_required', 'manual_allowed', 'manual_blocked'));
alter table public.student_profiles add column if not exists assigned_stripe_plan text;
alter table public.student_profiles add column if not exists assigned_stripe_price_id text;
alter table public.student_profiles add column if not exists access_note text not null default '';
alter table public.student_profiles add column if not exists access_updated_at timestamptz;
alter table public.student_profiles add column if not exists access_updated_by uuid references public.coaches (id) on delete set null;

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
  end if;
  return new;
end;
$$;

drop trigger if exists protect_access_columns on public.student_profiles;
create trigger protect_access_columns
  before update on public.student_profiles
  for each row
  execute function public.protect_student_profiles_access_columns();
;
