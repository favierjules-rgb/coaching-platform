-- 1. Narrow the overly-broad profiles SELECT policy.
-- Previously: any authenticated user could read every column of every profile row.
-- Now: a user can read their own row, any coach/admin row (needed to display the
-- coach's name to students), or every row if the caller is themselves coach/admin.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_self_or_staff" on public.profiles
  for select using (
    user_id = auth.uid()
    or role in ('coach', 'admin')
    or public.is_coach_or_admin()
  );

-- 2. Harden the 3 SECURITY DEFINER functions flagged by the Security Advisor.
-- Revoke the default PUBLIC execute grant; explicitly re-grant only to the
-- roles that actually need to call them. This blocks anonymous/unintended
-- direct RPC calls while preserving normal app behaviour (RLS policies and
-- authenticated app code still work).
revoke execute on function public.current_student_id() from public;
grant execute on function public.current_student_id() to authenticated, service_role;

revoke execute on function public.is_coach_or_admin() from public;
grant execute on function public.is_coach_or_admin() to authenticated, service_role;

-- Trigger-only function: never meant to be called directly via RPC.
revoke execute on function public.protect_student_profiles_access_columns() from public;
;
