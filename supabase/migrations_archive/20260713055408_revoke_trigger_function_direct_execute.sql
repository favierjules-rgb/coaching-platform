-- This function is only meant to run as a BEFORE UPDATE trigger on
-- public.student_profiles. It had an explicit EXECUTE grant to `authenticated`
-- (in addition to the PUBLIC grant already revoked), letting any signed-in
-- user call it directly via /rest/v1/rpc/protect_student_profiles_access_columns.
-- Postgres invokes trigger functions internally without checking EXECUTE
-- privilege, so revoking direct-call access does not affect the trigger.
revoke execute on function public.protect_student_profiles_access_columns() from authenticated;
revoke execute on function public.protect_student_profiles_access_columns() from anon;
;
