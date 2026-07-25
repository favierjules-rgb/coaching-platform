-- Colonnes bannière (nullable) sur programmes et séances — chantier module
-- Programmation, étape 4.
alter table public.programs add column if not exists banner_url text;
alter table public.workout_sessions add column if not exists banner_url text;

-- Bucket public dédié aux bannières — public car ces images doivent être
-- affichables sans authentification (utile dès maintenant pour l'élève,
-- et nécessaire pour l'étape 6 : programmes vendus depuis la page d'accueil).
insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do nothing;

-- Écriture réservée coach/admin ; lecture publique via l'URL directe du bucket.
drop policy if exists "banners_bucket_manage_staff" on storage.objects;
create policy "banners_bucket_manage_staff" on storage.objects
  for insert with check (bucket_id = 'banners' and public.is_coach_or_admin());
drop policy if exists "banners_bucket_update_staff" on storage.objects;
create policy "banners_bucket_update_staff" on storage.objects
  for update using (bucket_id = 'banners' and public.is_coach_or_admin());
drop policy if exists "banners_bucket_delete_staff" on storage.objects;
create policy "banners_bucket_delete_staff" on storage.objects
  for delete using (bucket_id = 'banners' and public.is_coach_or_admin());
;
