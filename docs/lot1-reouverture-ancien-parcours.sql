-- ============================================================================
-- LOT 1 — D4 : RÉOUVERTURE EXCEPTIONNELLE DE L'ANCIEN PARCOURS DE RÉSERVATION
--
-- ⛔ PROCÉDURE D'URGENCE. ⛔
--
-- CE SCRIPT RÉACTIVE UN CHEMIN DE RÉSERVATION QUI NE VALIDE AUCUNE
-- DISPONIBILITÉ. Après son exécution, un élève peut créer un rendez-vous :
--   • hors de toute plage de disponibilité (n'importe quel jour, n'importe
--     quelle heure, y compris 03:00 un dimanche) ;
--   • hors de la grille de créneaux, donc en doublant les créneaux ;
--   • sur un créneau désactivé ou supprimé ;
--   • avec un type et un lieu choisis par le navigateur ;
--   • et un compte portant à la fois une fiche `coaches` et une fiche
--     `students` retrouve le contournement que le lot 1 a fermé.
--
-- Le seul propriétaire déduit est `coalesce(current_staff_id(), students.coach_id)`,
-- donc un collaborateur redevient propriétaire d'une séance qu'il saisit.
--
-- ⚠️ CE N'EST PAS UNE OPTION DE CONFORT. Elle ne se justifie que dans un
-- incident déclaré : la nouvelle application est en échec, l'ancienne a été
-- redéployée, le staff travaille mais les élèves ne peuvent plus réserver, et
-- l'indisponibilité dure assez longtemps pour que ce soit le moindre mal.
--
-- ⚠️ ELLE N'EST APPLICABLE QU'AVANT M2. Après M2 la fonction a été supprimée
-- et ce script la RECRÉERAIT — ce qui reviendrait à défaire le lot. Le script
-- refuse de s'exécuter si l'état n'est pas celui de M1.
--
-- ⚠️ À REFERMER DÈS QUE POSSIBLE en rejouant le bloc 4 de
-- `supabase/migrations/20261115090000_lot1_multi_coach_ajout.sql`, qui
-- rétablit le garde-fou.
--
-- Exécution :
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/lot1-reouverture-ancien-parcours.sql
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'create_appointment_atomic'
  ) then
    raise exception 'D4 : create_appointment_atomic est absente — M2 a deja ete appliquee. Ce script ne doit pas la recreer : il defferait le lot.';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'creer_rendez_vous_staff'
  ) then
    raise exception 'D4 : creer_rendez_vous_staff est absente — M1 n''a pas ete appliquee, ce script n''a pas d''objet.';
  end if;
  raise notice 'D4 : etat M1 confirme. Reouverture du chemin HISTORIQUE, sans validation de disponibilite.';
end $$;

-- Corps HISTORIQUE, repris mot pour mot de l'état d'avant M1
-- (relevé par `pg_get_functiondef` le 15/11/2026).
create or replace function public.create_appointment_atomic(
  p_student_id uuid,
  p_title text,
  p_description text,
  p_appointment_type text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_location text,
  p_meeting_url text,
  p_ics_uid text,
  p_status text default 'confirmed'
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid;
  v_coach_id uuid;
begin
  if not coalesce(
       (p_student_id is not null
        and p_student_id in (select public.student_ids_agenda_communication_ecriture()))
       or (p_student_id is not null and public.current_student_id() is not null
           and p_student_id = public.current_student_id())
       or (p_student_id is null and public.current_staff_id() is not null
           and coalesce('agenda_communication' in (select public.categories_ecriture()), false))
     , false) then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'calendar_invalid_period';
  end if;
  if p_status not in ('pending', 'confirmed') then
    raise exception 'calendar_invalid_status';
  end if;

  v_coach_id := coalesce(
    public.current_staff_id(),
    (select s.coach_id from public.students s where s.id = p_student_id)
  );

  perform pg_advisory_xact_lock(hashtext('calendar_booking'));
  if public.calendar_has_conflict(p_start_at, p_end_at) then
    raise exception 'calendar_conflict';
  end if;

  insert into public.appointments
    (student_id, coach_id, title, description, appointment_type, start_at, end_at,
     location, meeting_url, status, ics_uid)
  values
    (p_student_id, v_coach_id, coalesce(p_title, ''), coalesce(p_description, ''),
     coalesce(p_appointment_type, 'Autre'), p_start_at, p_end_at, coalesce(p_location, ''),
     coalesce(p_meeting_url, ''), p_status, coalesce(p_ics_uid, ''))
  returning id into v_id;
  return v_id;
end;
$$;

do $$ begin
  raise notice 'D4 : chemin historique reouvert. A REFERMER en rejouant le bloc 4 de M1.';
end $$;
