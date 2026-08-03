-- =====================================================================
-- Migration 20260803120000 — RPE par série
-- (chantier feat/student-previous-set-performance, option B validée).
--
-- BESOIN PRODUIT : un RPE réellement enregistré POUR CHAQUE SÉRIE de
-- musculation. Jusqu'ici le RPE ne vivait qu'au niveau de l'exercice
-- (exercise_feedback.rpe) et était recopié à l'affichage sur chaque série —
-- présentation trompeuse corrigée par ce chantier.
--
-- CONTENU — strictement additif :
--   1. colonne nullable public.exercise_set_feedback.rpe integer ;
--   2. contrainte : rpe IS NULL OR rpe BETWEEN 1 AND 10 (même bornage que
--      exercise_feedback_rpe_check et workout_feedback.global_rpe).
--
-- GARANTIES :
--   - AUCUNE ligne existante modifiée (pas de DEFAULT, pas de backfill) :
--     les anciens retours gardent rpe NULL — leur RPE global d'exercice
--     (exercise_feedback.rpe) reste leur seule vérité, affichée comme telle ;
--   - exercise_feedback et prescribed_snapshot inchangés ;
--   - RLS inchangée : la table reste couverte par ses policies existantes,
--     aucune policy créée/modifiée ici ;
--   - contrainte ajoutée NOT VALID puis VALIDATE : le VALIDATE ne prend
--     qu'un SHARE UPDATE EXCLUSIVE (pas de blocage des écritures) et les
--     lignes existantes (rpe NULL) la satisfont trivialement.
-- =====================================================================

alter table public.exercise_set_feedback
  add column if not exists rpe integer;

alter table public.exercise_set_feedback
  drop constraint if exists exercise_set_feedback_rpe_check;

alter table public.exercise_set_feedback
  add constraint exercise_set_feedback_rpe_check
  check (rpe is null or (rpe >= 1 and rpe <= 10)) not valid;

alter table public.exercise_set_feedback
  validate constraint exercise_set_feedback_rpe_check;

comment on column public.exercise_set_feedback.rpe is
  'RPE de LA série (1-10), saisi par l''élève depuis le chantier feat/student-previous-set-performance. NULL pour toute série antérieure (aucun backfill) : le RPE global historique reste exercise_feedback.rpe et ne doit jamais être présenté comme un RPE par série.';
