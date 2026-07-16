-- V3 étape 5 — Correction RLS cardio + activation Realtime (programs, workout_sessions)
--
-- Contexte : training_prescriptions_select_assigned_student (créée avant ce
-- chantier, sur la branche training-builder-v2 jamais mergée) ne couvrait que
-- le chemin musculation (exercise_id -> workout_exercises -> workout_sessions
-- -> programs -> assignments). Depuis la migration cardio V3
-- (20260716_training_v3_cardio_foundation.sql), une ligne training_prescriptions
-- peut aussi être un segment cardio : exercise_id est alors NULL et block_id
-- renseigné (contrainte training_prescriptions_exercise_or_block_check). Ces
-- lignes n'étaient donc jamais lisibles par l'élève : la policy ne matchait
-- que sur exercise_id = training_prescriptions.exercise_id, qui échoue
-- toujours si exercise_id est NULL.
--
-- Fix : on ajoute un second OR EXISTS couvrant le chemin bloc cardio
-- (block_id -> training_blocks -> workout_sessions -> programs -> assignments),
-- en reprenant exactement le même schéma de jointure que
-- training_blocks_select_assigned_student (déjà correcte, inchangée).
-- Postgres n'a pas de CREATE OR REPLACE POLICY : DROP IF EXISTS + CREATE.

drop policy if exists training_prescriptions_select_assigned_student on public.training_prescriptions;

create policy training_prescriptions_select_assigned_student
on public.training_prescriptions
for select
using (
  -- Chemin musculation (inchangé)
  exists (
    select 1
    from workout_exercises e
    join workout_sessions s on s.id = e.session_id
    join programs p on p.id = s.program_id
    join assignments a on a.content_type = 'programme' and a.content_id = p.id
    where e.id = training_prescriptions.exercise_id
      and a.student_id = current_student_id()
      and p.publication_status = 'published'
  )
  or
  -- Chemin cardio (nouveau) : mêmes jointures que training_blocks_select_assigned_student
  exists (
    select 1
    from training_blocks b
    join workout_sessions s on s.id = b.session_id
    join programs p on p.id = s.program_id
    join assignments a on a.content_type = 'programme' and a.content_id = p.id
    where b.id = training_prescriptions.block_id
      and a.student_id = current_student_id()
      and p.publication_status = 'published'
  )
);

-- Realtime : côté élève, /entrainement doit se mettre à jour tout seul quand
-- le coach publie/modifie un programme assigné (pas de rechargement manuel).
-- Aucune table n'est actuellement enregistrée dans la publication
-- supabase_realtime (vérifié via pg_publication_tables). Périmètre volontairement
-- limité à programs + workout_sessions : diffProgramStructure (voir
-- lib/supabase/programs.ts) fait toujours un UPDATE workout_sessions pour
-- chaque séance existante à chaque sauvegarde du coach — même quand seuls les
-- exercices ou les blocs cardio de cette séance changent — donc écouter ces
-- deux tables suffit à détecter tout changement pertinent pour l'élève, sans
-- descendre au niveau exercice/segment cardio.
alter publication supabase_realtime add table public.programs, public.workout_sessions;
