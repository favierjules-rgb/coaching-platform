-- ============================================================================
-- Migration 20260830090000 — le RPE avance par pas de 0,5.
-- (chantier feat/nutrition-linebreaks-rpe-halves)
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ────────────────────────────────────────────────────────────────────────────
-- Le RPE se prescrit et se ressent en demi-points — 7,5 est une note usuelle,
-- pas une coquetterie. Trois colonnes le stockent aujourd'hui en `integer` :
-- même si l'interface acceptait « 7,5 », PostgreSQL arrondirait à l'insertion
-- et rendrait 8. Corriger l'écran sans corriger la colonne aurait produit le
-- pire des cas : une valeur affichée qui n'est pas celle qui est conservée.
--
-- ────────────────────────────────────────────────────────────────────────────
-- L'ÉTAT AVANT, MESURÉ SUR LE PROJET DISTANT LE 11/08/2026
-- ────────────────────────────────────────────────────────────────────────────
--   exercise_feedback.rpe            integer   check (rpe >= 1 and rpe <= 10)
--                                              14 lignes
--   exercise_set_feedback.rpe        integer   check (null or 1..10)
--                                              64 lignes
--   workout_feedback.global_rpe      integer   check (global_rpe >= 1 and <= 10)
--                                              11 lignes
--   training_prescriptions.target_rpe numeric  check (null or 0..10)
--                                              0 ligne — DÉJÀ décimale
--   workout_exercises.recommended_rpe text     aucune contrainte
--                                              33 lignes, ex. « 7 », « 6-7-8-6 »
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE FAIT CETTE MIGRATION
-- ────────────────────────────────────────────────────────────────────────────
--   A. les trois colonnes `integer` passent en `numeric` ;
--   B. chaque contrainte est reposée avec la MÊME borne qu'avant, plus la
--      règle du demi-point ;
--   C. `training_prescriptions.target_rpe`, déjà numérique, reçoit la règle du
--      demi-point sans que sa borne (0-10, et non 1-10) soit touchée.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - AUCUNE modification des bornes existantes. `exercise_feedback` et
--     `workout_feedback` restent en 1-10, `training_prescriptions` reste en
--     0-10. Les surfaces qui bornent volontairement plus serré gardent leur
--     règle : on ajoute le demi-point, on n'élargit rien ;
--   - AUCUNE réécriture des RPE historiques. `7::integer` devient `7`, pas
--     `7.0` d'une autre valeur : la conversion `integer → numeric` est exacte
--     et totale, il n'existe aucun entier de 1 à 10 qu'elle puisse perdre ;
--   - AUCUN changement sur `workout_exercises.recommended_rpe`. Cette colonne
--     est du TEXTE À DESSEIN : elle porte des séquences par série (« 6-7-8-6 »)
--     qu'aucun type numérique ne représente. Le demi-point y est ouvert par le
--     seul analyseur applicatif (`parsePrescribedRpe`), pas par la base ;
--   - AUCUNE table, policy, RLS, RPC ni privilège modifié.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI `(rpe * 2) = trunc(rpe * 2)` ET PAS UN TEST SUR LES FLOTTANTS
-- ────────────────────────────────────────────────────────────────────────────
-- `numeric` est une arithmétique DÉCIMALE EXACTE : 7,2 × 2 vaut exactement
-- 14,4, jamais 14,399999999999999. Le test est donc rigoureusement vrai ou
-- rigoureusement faux, sans tolérance à régler. Le même contrôle écrit sur un
-- `double precision` aurait été une loterie.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. exercise_feedback.rpe — RPE global d'un exercice (et RPE d'un bloc cardio)
-- ────────────────────────────────────────────────────────────────────────────
-- La contrainte est retirée AVANT le changement de type : la reposer après
-- évite qu'elle soit revalidée deux fois, et rend le diff lisible.
alter table public.exercise_feedback
  drop constraint if exists exercise_feedback_rpe_check;

alter table public.exercise_feedback
  alter column rpe type numeric using rpe::numeric;

alter table public.exercise_feedback
  add constraint exercise_feedback_rpe_check
  check (rpe is null or (rpe >= 1 and rpe <= 10 and (rpe * 2) = trunc(rpe * 2)));

comment on column public.exercise_feedback.rpe is
  'RPE global d''un exercice, ou RPE d''un bloc cardio. numeric, de 1 à 10 par pas de 0,5. La borne 1-10 est celle d''origine : cette migration n''a ajouté que le demi-point.';

-- ────────────────────────────────────────────────────────────────────────────
-- B. exercise_set_feedback.rpe — RPE de LA série (option B)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.exercise_set_feedback
  drop constraint if exists exercise_set_feedback_rpe_check;

alter table public.exercise_set_feedback
  alter column rpe type numeric using rpe::numeric;

alter table public.exercise_set_feedback
  add constraint exercise_set_feedback_rpe_check
  check (rpe is null or (rpe >= 1 and rpe <= 10 and (rpe * 2) = trunc(rpe * 2)));

comment on column public.exercise_set_feedback.rpe is
  'RPE de CETTE série. numeric, de 1 à 10 par pas de 0,5, null quand l''élève ne l''a pas saisi — jamais inventé ni moyenné.';

-- ────────────────────────────────────────────────────────────────────────────
-- C. workout_feedback.global_rpe — RPE global de la séance
-- ────────────────────────────────────────────────────────────────────────────
alter table public.workout_feedback
  drop constraint if exists workout_feedback_global_rpe_check;

alter table public.workout_feedback
  alter column global_rpe type numeric using global_rpe::numeric;

alter table public.workout_feedback
  add constraint workout_feedback_global_rpe_check
  check (global_rpe is null or (global_rpe >= 1 and global_rpe <= 10 and (global_rpe * 2) = trunc(global_rpe * 2)));

comment on column public.workout_feedback.global_rpe is
  'RPE global de la séance. numeric, de 1 à 10 par pas de 0,5.';

-- ────────────────────────────────────────────────────────────────────────────
-- D. training_prescriptions.target_rpe — déjà numérique, borne 0-10 CONSERVÉE
-- ────────────────────────────────────────────────────────────────────────────
-- Cette colonne acceptait déjà les décimales, et 7,2 y passait. La borne
-- basse est 0 (et non 1) : c'est celle d'une cible de segment cardio, où
-- « RPE 0 » veut dire « au repos ». On ne la remonte pas.
alter table public.training_prescriptions
  drop constraint if exists training_prescriptions_target_rpe_check;

alter table public.training_prescriptions
  add constraint training_prescriptions_target_rpe_check
  check (target_rpe is null or (target_rpe >= 0 and target_rpe <= 10 and (target_rpe * 2) = trunc(target_rpe * 2)));

comment on column public.training_prescriptions.target_rpe is
  'RPE cible d''une prescription. numeric, de 0 à 10 par pas de 0,5. La borne basse est 0 — celle d''origine — parce qu''un segment cardio peut viser le repos.';
