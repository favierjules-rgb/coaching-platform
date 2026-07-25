drop policy if exists "programs_select_public" on public.programs;

create policy "programs_select_public"
on public.programs
for select
to anon
using (is_public = true and status = 'actif');;
