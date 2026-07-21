-- Fix mutable search_path on the updated_at trigger helper (WARN: function_search_path_mutable)
alter function public.set_updated_at() set search_path = public;

-- Stop exposing internal RLS-helper functions as public RPC endpoints
-- (WARN: anon/authenticated_security_definer_function_executable).
-- They stay usable *inside* RLS policies (Postgres checks EXECUTE for the
-- querying role when evaluating a policy), we only remove direct callability
-- for anon and the implicit PUBLIC grant, keeping authenticated/service_role.
revoke execute on function public.current_student_id() from public;
revoke execute on function public.is_coach_or_admin() from public;
revoke execute on function public.protect_student_profiles_access_columns() from public;

grant execute on function public.current_student_id() to authenticated, service_role;
grant execute on function public.is_coach_or_admin() to authenticated, service_role;
grant execute on function public.protect_student_profiles_access_columns() to authenticated, service_role;;
