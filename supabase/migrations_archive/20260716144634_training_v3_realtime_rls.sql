-- V3 étape 5 — Correction RLS cardio + activation Realtime (programs, workout_sessions)

drop policy if exists training_prescriptions_select_assigned_student on public.training_prescriptions;

create policy training_prescriptions_select_assigned_student
on public.training_prescriptions
for select
using (
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

alter publication supabase_realtime add table public.programs, public.workout_sessions;
;
