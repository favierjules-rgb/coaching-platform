-- La lecture publique (URL directe du bucket) fonctionne déjà sans policy,
-- mais l'API Storage authentifiée (list/remove) a besoin d'une policy SELECT
-- pour "voir" les objets avant de pouvoir les supprimer — sans elle,
-- `.remove()` renvoie error: null mais ne supprime rien (0 ligne visible en
-- RLS). Bug trouvé en testant la suppression de bannière depuis le builder.
drop policy if exists "banners_bucket_select_staff" on storage.objects;
create policy "banners_bucket_select_staff" on storage.objects
  for select using (bucket_id = 'banners' and public.is_coach_or_admin());
