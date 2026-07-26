-- ============================================================================
-- POST-BASELINE 1/3 — Objets STORAGE absents de la baseline
-- ============================================================================
-- POURQUOI CE FICHIER EXISTE
-- La baseline `20260724000000_baseline_remote_schema.sql` provient d'un
-- `pg_dump --schema-only` dont la commande exclut explicitement le schéma
-- `storage` (cf. baseline-audit-20260724/pg-dump-command.txt). Vérification
-- faite sur le dump : `storage.buckets` = 0 occurrence, `storage.objects` = 0
-- occurrence. Les buckets et leurs policies doivent donc être rejoués ici.
--
-- SOURCES (SQL repris à l'identique quant à la sémantique) :
--   - 20260715084950_program_covers_bucket.sql
--   - 20260716202426_training_v3_programmation_banners.sql   (partie storage)
--   - 20260716203727_training_v3_programmation_banners_select_policy.sql
--
-- VOLONTAIREMENT NON REJOUÉ (déjà présent dans la baseline) :
--   - `alter table public.programs add column banner_url`         -> présent
--   - `alter table public.workout_sessions add column banner_url` -> présent
--     (2 occurrences de "banner_url" confirmées dans la baseline)
--   - la fonction `public.is_coach_or_admin()`                    -> présente
--
-- IDEMPOTENCE : `on conflict do nothing` pour les buckets, `drop policy if
-- exists` avant chaque `create policy` pour les policies. Un second
-- `supabase db reset` rejoue ce fichier sans erreur.
--
-- AUCUNE table/colonne du schéma `public` n'est créée ou modifiée ici.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Buckets
-- ---------------------------------------------------------------------------
-- Bucket public des photos de bannière/couverture des programmes
-- (public en lecture : image décorative, évite des URLs signées côté élève ;
-- écriture réservée au staff via les policies ci-dessous).
insert into storage.buckets (id, name, public)
values ('program-covers', 'program-covers', true)
on conflict (id) do nothing;

-- Bucket public des bannières (affichables sans authentification, requis pour
-- les programmes vendus depuis la page d'accueil).
insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Policies sur storage.objects — bucket "program-covers"
-- ---------------------------------------------------------------------------
-- NOTE : la migration d'origine (20260715084950) ne comportait pas de
-- `drop policy if exists`. On l'ajoute ici UNIQUEMENT pour rendre le rejeu
-- idempotent lors d'un second `db reset` ; la sémantique des policies est
-- inchangée.
drop policy if exists "program_covers_bucket_manage_staff" on storage.objects;
create policy "program_covers_bucket_manage_staff"
on storage.objects for insert
with check (bucket_id = 'program-covers' and public.is_coach_or_admin());

drop policy if exists "program_covers_bucket_update_staff" on storage.objects;
create policy "program_covers_bucket_update_staff"
on storage.objects for update
using (bucket_id = 'program-covers' and public.is_coach_or_admin());

drop policy if exists "program_covers_bucket_delete_staff" on storage.objects;
create policy "program_covers_bucket_delete_staff"
on storage.objects for delete
using (bucket_id = 'program-covers' and public.is_coach_or_admin());

-- ---------------------------------------------------------------------------
-- 3. Policies sur storage.objects — bucket "banners"
-- ---------------------------------------------------------------------------
drop policy if exists "banners_bucket_manage_staff" on storage.objects;
create policy "banners_bucket_manage_staff" on storage.objects
  for insert with check (bucket_id = 'banners' and public.is_coach_or_admin());

drop policy if exists "banners_bucket_update_staff" on storage.objects;
create policy "banners_bucket_update_staff" on storage.objects
  for update using (bucket_id = 'banners' and public.is_coach_or_admin());

drop policy if exists "banners_bucket_delete_staff" on storage.objects;
create policy "banners_bucket_delete_staff" on storage.objects
  for delete using (bucket_id = 'banners' and public.is_coach_or_admin());

-- La lecture publique passe par l'URL directe du bucket, mais l'API Storage
-- authentifiée (list/remove) exige une policy SELECT pour "voir" les objets :
-- sans elle, `.remove()` renvoie error: null sans rien supprimer.
drop policy if exists "banners_bucket_select_staff" on storage.objects;
create policy "banners_bucket_select_staff" on storage.objects
  for select using (bucket_id = 'banners' and public.is_coach_or_admin());
