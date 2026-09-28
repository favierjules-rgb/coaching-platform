-- ════════════════════════════════════════════════════════════════════════
-- PROFIL PHYSIOLOGIQUE MULTI-SPORT — colonnes manquantes + réglages de zones
-- ════════════════════════════════════════════════════════════════════════
--
-- ⚠️ CETTE MIGRATION N'A PAS ÉTÉ APPLIQUÉE. Fichier créé le 28/09/2026,
-- aucun `supabase db push` n'a été exécuté.
--
-- ⚠️ VERSION 20260930090000, ET PAS 20260928090000. Le premier numéro choisi
-- ENTRAIT EN COLLISION avec `20260928090000_program_review_flags_grants.sql`,
-- déjà appliquée : `supabase db push` aurait vu cette version dans l'historique
-- et considéré la migration comme faite — sans jamais créer une colonne. Elle
-- est également postérieure à la dernière migration appliquée
-- (20260929090000_notifications_grants), pour ne pas être refusée comme
-- « out of order ».
--
-- CE QU'ELLE N'AJOUTE PAS, PARCE QUE ÇA EXISTE DÉJÀ (audit du 28/09/2026) :
--   · student_profiles.vma_kmh          → VMA course
--   · student_profiles.hr_max           → FC max
--   · student_profiles.hr_resting       → FC repos
--   · student_profiles.ftp_watts        → FTP
--   · student_profiles.current_weight_kg, height_cm, age
--   · student_profiles.reference_paces, last_fitness_test_date,
--     fitness_test_protocol
-- Ces sept colonnes sont posées depuis 20260716075715 et n'ont JAMAIS été
-- lues ni écrites par l'application (0 profil renseigné sur 31). Elles sont
-- réutilisées telles quelles, pas recréées.
--
-- ⚠️ AUCUNE POLICY, AUCUN GRANT. `student_profiles` porte déjà :
--   · student_profiles_select_self_or_staff  (r)  élève OU staff
--   · student_profiles_manage_self_or_staff  (*)  élève OU staff
-- et `authenticated` y a select/insert/update/delete. Une colonne ajoutée
-- hérite des policies de sa table : rien à faire, et surtout rien à élargir.
--
-- ⚠️ POINT SIGNALÉ AU COACH, PAS TRANCHÉ ICI. Ces policies autorisent
-- l'ÉLÈVE à modifier son propre profil. Les données physiologiques seront
-- donc éditables par l'athlète lui-même — ce qui est cohérent avec
-- l'interface de référence (« Modifier MES données physiologiques »), mais
-- doit être un choix conscient. Le restreindre au staff demanderait une
-- policy par colonne, que PostgreSQL ne permet pas : il faudrait une table
-- séparée. À décider avant application.

begin;

-- ────────────────────────────────────────────────────────────────────────
-- 1. GÉNÉRAL
-- ────────────────────────────────────────────────────────────────────────
alter table public.student_profiles
  add column if not exists sex text,
  add column if not exists birth_date date,
  add column if not exists hr_threshold integer,
  add column if not exists vo2max numeric;

alter table public.student_profiles
  drop constraint if exists student_profiles_sex_check;
alter table public.student_profiles
  add constraint student_profiles_sex_check
  check (sex is null or sex = any (array['male','female','unspecified']));

comment on column public.student_profiles.sex is
  'Sexe déclaré. Aucune donnée existante n''est touchée (NULL par défaut).';
comment on column public.student_profiles.birth_date is
  'Date de naissance. Remplace progressivement `age`, qui se périme ; les deux coexistent tant que `age` porte des valeurs.';
comment on column public.student_profiles.hr_threshold is
  'FC seuil (bpm), MESURÉE. Aucune formule ne la dérive : le modèle de référence n''en documente aucune.';
comment on column public.student_profiles.vo2max is
  'VO2max (ml/kg/min), MESURÉ. Aucune estimation depuis la VMA n''est calculée — voir lib/physiologie.ts.';

-- ────────────────────────────────────────────────────────────────────────
-- 2. RÉFÉRENCES PAR SPORT
--    `vma_kmh` (course) et `ftp_watts` (vélo) existent déjà et ne sont pas
--    redéclarées.
-- ────────────────────────────────────────────────────────────────────────
alter table public.student_profiles
  -- Vélo
  add column if not exists pma_watts numeric,
  add column if not exists critical_power_watts numeric,
  add column if not exists hr_max_bike integer,
  -- Course
  add column if not exists ftp_run_watts numeric,
  add column if not exists critical_power_run_watts numeric,
  add column if not exists critical_speed_kmh numeric,
  add column if not exists hr_max_run integer,
  -- Natation
  add column if not exists vma_swim_kmh numeric,
  add column if not exists critical_speed_swim_kmh numeric,
  add column if not exists hr_max_swim integer;

comment on column public.student_profiles.pma_watts is
  'PMA (W) — référentiel %PMA du vélo, distinct de %FTP.';
comment on column public.student_profiles.vma_swim_kmh is
  'VMA natation (km/h). L''allure s''y exprime en min/100 m, pas en min/km.';
comment on column public.student_profiles.hr_max_bike is
  'FC max spécifique au vélo, si l''athlète la connaît. À défaut, `hr_max` sert pour les trois sports — aucune FC spécifique n''est inventée.';

-- ────────────────────────────────────────────────────────────────────────
-- 3. SOURCE DE CHAQUE VALEUR : MESURÉE OU ESTIMÉE
--    Une colonne jsonb PLUTÔT QUE 14 colonnes `*_source`.
-- ────────────────────────────────────────────────────────────────────────
alter table public.student_profiles
  add column if not exists physio_sources jsonb not null default '{}'::jsonb;

comment on column public.student_profiles.physio_sources is
  'Provenance déclarée de chaque référence : {"vma_kmh":"mesuree","hr_max":"estimee"}. Une clé absente vaut « mesurée » dès que la valeur existe. AUCUN statut n''est déduit d''un calcul : le modèle de référence ne documente aucune formule d''estimation, et en inventer une fabriquerait une règle métier.';

-- ────────────────────────────────────────────────────────────────────────
-- 4. RÉGLAGES DE ZONES PERSONNALISÉS
-- ────────────────────────────────────────────────────────────────────────
alter table public.student_profiles
  add column if not exists zone_settings jsonb;

comment on column public.student_profiles.zone_settings is
  'Surcharges des bornes de zones pour CET athlète, partielles : {"fc":{"2":[74,84]},"vmaCourse":{"3":[72,86]}}. NULL = barème de référence (lib/zones-physiologiques.ts). « Réinitialiser mes zones » remet cette colonne à NULL — et ne PEUT donc pas atteindre la VMA, le FTP, la PMA, la FCmax, la FC de repos ni le poids, qui vivent dans leurs propres colonnes.';

-- ────────────────────────────────────────────────────────────────────────
-- 5. TRAÇABILITÉ
-- ────────────────────────────────────────────────────────────────────────
alter table public.student_profiles
  add column if not exists physio_updated_at timestamptz,
  add column if not exists physio_updated_by uuid references auth.users(id) on delete set null;

commit;
