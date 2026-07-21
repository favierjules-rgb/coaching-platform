-- The previous migration only revoked the implicit PUBLIC grant; anon had
-- its own explicit EXECUTE grant (from the original schema.sql / default
-- privileges) that survived. Revoke it directly so anon can no longer call
-- these as RPC endpoints, while authenticated/service_role keep access
-- (required so RLS policies still evaluate for logged-in users).
revoke execute on function public.current_student_id() from anon;
revoke execute on function public.is_coach_or_admin() from anon;
revoke execute on function public.protect_student_profiles_access_columns() from anon;;
