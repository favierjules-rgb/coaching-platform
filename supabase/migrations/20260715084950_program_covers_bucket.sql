
-- Bucket public pour les photos de bannière/couverture des programmes
-- d'entraînement (training-builder-v2, tâche #55). Public en lecture (image
-- décorative, faible sensibilité, évite d'avoir à générer des URLs signées
-- côté élève) ; écriture réservée aux coachs/admins via is_coach_or_admin().
insert into storage.buckets (id, name, public)
values ('program-covers', 'program-covers', true)
on conflict (id) do nothing;

create policy "program_covers_bucket_manage_staff"
on storage.objects for insert
with check (bucket_id = 'program-covers' and is_coach_or_admin());

create policy "program_covers_bucket_update_staff"
on storage.objects for update
using (bucket_id = 'program-covers' and is_coach_or_admin());

create policy "program_covers_bucket_delete_staff"
on storage.objects for delete
using (bucket_id = 'program-covers' and is_coach_or_admin());
;
