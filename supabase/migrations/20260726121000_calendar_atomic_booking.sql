-- Chantier "admin-apple-calendar" — 3/3 : protection ATOMIQUE des conflits.
--
-- Architecture retenue (option C + D de la directive) — défense en
-- profondeur à deux niveaux :
--
--  1. RPC transactionnelles SECURITY DEFINER avec verrou consultatif
--     `pg_advisory_xact_lock(hashtext('calendar_booking'))` : TOUTES les
--     écritures calendrier (réservation élève, création admin, événements
--     personnels/professionnels, indisponibilités, report/déplacement)
--     passent par ces fonctions et sont donc SÉRIALISÉES — le contrôle de
--     chevauchement couvre les DEUX tables (appointments +
--     coach_unavailabilities) dans la même transaction que l'écriture, ce
--     qu'une contrainte d'exclusion mono-table ne peut pas garantir. Deux
--     requêtes simultanées : la seconde attend le verrou puis revoit l'état
--     à jour → une seule peut réussir. (Un seul coach dans l'app : aucune
--     contention réelle.)
--
--  2. Contrainte d'exclusion GiST partielle sur `appointments` (filet de
--     sécurité au niveau base) : même si un chemin d'écriture contournait
--     les RPC, deux RDV bloquants (pending/confirmed) ne peuvent jamais se
--     chevaucher. Contrôle read-only préalable effectué sur la prod le
--     26/07/2026 : 0 RDV actif chevauchant (2 RDV, tous deux 'cancelled'),
--     0 borne nulle, 0 durée négative — la contrainte s'applique sans
--     conflit de données.
--
-- Verrouillage des accès directs (condition 4) : les policies RLS
-- INSERT/UPDATE des élèves et du staff sur `appointments`, et
-- INSERT/UPDATE du staff sur `coach_unavailabilities`, sont RETIRÉES —
-- depuis le navigateur, seules les RPC ci-dessous peuvent écrire. Le
-- DELETE reste possible pour le staff sur `coach_unavailabilities`
-- (suppression d'un événement privé / d'une indisponibilité : ne crée
-- jamais de conflit). Aucun chemin de l'app ne supprime un RDV (annulation
-- par statut uniquement) : aucune policy DELETE sur `appointments`.
--
-- Règle de chevauchement (directive §8) :
--   nouveau_debut < fin_existante AND nouvelle_fin > debut_existant
-- (chevauchements partiels inclus ; bornes qui se touchent autorisées).
-- Un RDV 'cancelled' libère son créneau (règle métier existante préservée).
--
-- Compatibilité onglet Disponibilités (condition 8) : la création d'une
-- indisponibilité simple pouvait historiquement chevaucher un RDV existant
-- (le coach se bloque par-dessus) — ce comportement est préservé via
-- p_allow_overlap, mais l'écriture est désormais sérialisée par le même
-- verrou, donc plus aucune course avec une réservation élève simultanée.

create extension if not exists btree_gist;

-- 1) Filet de sécurité au niveau base.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_no_overlap_active'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_no_overlap_active
      exclude using gist (tstzrange(start_at, end_at) with &&)
      where (status in ('pending', 'confirmed'));
  end if;
end $$;

-- 2) Conflit : périodes occupées chevauchant [p_start_at, p_end_at).
--    (fonction interne, non exposée)
create or replace function public.calendar_has_conflict(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_exclude_appointment_id uuid default null,
  p_exclude_coach_event_id uuid default null
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.appointments a
    where a.status in ('pending', 'confirmed')
      and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
      and a.start_at < p_end_at
      and a.end_at > p_start_at
  ) or exists (
    select 1 from public.coach_unavailabilities u
    where (p_exclude_coach_event_id is null or u.id <> p_exclude_coach_event_id)
      and u.start_at < p_end_at
      and u.end_at > p_start_at
  );
$$;

revoke all on function public.calendar_has_conflict(timestamptz, timestamptz, uuid, uuid) from public;
-- Les default privileges Supabase accordent EXECUTE à anon/authenticated sur
-- toute nouvelle fonction : REVOKE explicites obligatoires (constat du test
-- local PHASE 2.5 — `revoke from public` ne retire pas ces grants-là).
revoke execute on function public.calendar_has_conflict(timestamptz, timestamptz, uuid, uuid) from anon, authenticated;

-- 3) Réservation / création d'un RDV élève (élève propriétaire OU staff).
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
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not (is_coach_or_admin() or (p_student_id is not null and p_student_id = current_student_id())) then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'calendar_invalid_period';
  end if;
  if p_status not in ('pending', 'confirmed') then
    raise exception 'calendar_invalid_status';
  end if;

  perform pg_advisory_xact_lock(hashtext('calendar_booking'));

  if calendar_has_conflict(p_start_at, p_end_at) then
    raise exception 'calendar_conflict';
  end if;

  insert into public.appointments
    (student_id, title, description, appointment_type, start_at, end_at, location, meeting_url, status, ics_uid)
  values
    (p_student_id, coalesce(p_title, ''), coalesce(p_description, ''), coalesce(p_appointment_type, 'Autre'),
     p_start_at, p_end_at, coalesce(p_location, ''), coalesce(p_meeting_url, ''), p_status, coalesce(p_ics_uid, ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_appointment_atomic(uuid, text, text, text, timestamptz, timestamptz, text, text, text, text) from public;
revoke execute on function public.create_appointment_atomic(uuid, text, text, text, timestamptz, timestamptz, text, text, text, text) from anon;
grant execute on function public.create_appointment_atomic(uuid, text, text, text, timestamptz, timestamptz, text, text, text, text) to authenticated;

-- 4) Annulation d'un RDV (élève propriétaire OU staff) — statut + motif,
--    jamais de suppression (logique existante préservée).
create or replace function public.cancel_appointment_atomic(
  p_appointment_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
begin
  select student_id into v_student_id from public.appointments where id = p_appointment_id;
  if not found then
    return false;
  end if;
  if not (is_coach_or_admin() or (v_student_id is not null and v_student_id = current_student_id())) then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;

  update public.appointments
  set status = 'cancelled',
      cancellation_reason = coalesce(p_reason, ''),
      updated_at = now()
  where id = p_appointment_id;
  return true;
end;
$$;

revoke all on function public.cancel_appointment_atomic(uuid, text) from public;
revoke execute on function public.cancel_appointment_atomic(uuid, text) from anon;
grant execute on function public.cancel_appointment_atomic(uuid, text) to authenticated;

-- 5) Report / déplacement d'un RDV (staff) : annule l'original et crée le
--    nouveau DANS LA MÊME TRANSACTION (corrige la non-atomicité de
--    l'implémentation précédente : deux requêtes séparées côté client).
--    L'original est annulé AVANT le contrôle de conflit pour permettre un
--    déplacement partiel sur sa propre plage (ex. décalage de 30 min).
create or replace function public.reschedule_appointment_atomic(
  p_appointment_id uuid,
  p_new_start_at timestamptz,
  p_new_end_at timestamptz,
  p_ics_uid text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.appointments%rowtype;
  v_id uuid;
begin
  if not is_coach_or_admin() then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;
  if p_new_start_at is null or p_new_end_at is null or p_new_end_at <= p_new_start_at then
    raise exception 'calendar_invalid_period';
  end if;

  perform pg_advisory_xact_lock(hashtext('calendar_booking'));

  select * into v_original from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'calendar_not_found';
  end if;

  update public.appointments
  set status = 'cancelled', cancellation_reason = 'Reporté', updated_at = now()
  where id = p_appointment_id;

  if calendar_has_conflict(p_new_start_at, p_new_end_at) then
    -- Annule toute la transaction (l'original redevient actif).
    raise exception 'calendar_conflict';
  end if;

  insert into public.appointments
    (student_id, title, description, appointment_type, start_at, end_at, location, meeting_url, status, rescheduled_from_id, ics_uid)
  values
    (v_original.student_id, v_original.title, v_original.description, v_original.appointment_type,
     p_new_start_at, p_new_end_at, v_original.location, v_original.meeting_url, 'confirmed',
     v_original.id, coalesce(p_ics_uid, ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.reschedule_appointment_atomic(uuid, timestamptz, timestamptz, text) from public;
revoke execute on function public.reschedule_appointment_atomic(uuid, timestamptz, timestamptz, text) from anon;
grant execute on function public.reschedule_appointment_atomic(uuid, timestamptz, timestamptz, text) to authenticated;

-- 6) Création d'un événement du coach (staff uniquement).
--    p_allow_overlap = true UNIQUEMENT pour les indisponibilités simples de
--    l'onglet Disponibilités (comportement historique : le coach peut se
--    bloquer par-dessus un RDV existant). Les événements personnels et
--    professionnels sont toujours contrôlés strictement.
create or replace function public.create_coach_event_atomic(
  p_category text,
  p_title text,
  p_notes text,
  p_location text,
  p_all_day boolean,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_reason text default '',
  p_allow_overlap boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not is_coach_or_admin() then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'calendar_invalid_period';
  end if;
  if p_category not in ('unavailability', 'personal', 'professional') then
    raise exception 'calendar_invalid_category';
  end if;

  perform pg_advisory_xact_lock(hashtext('calendar_booking'));

  if not (p_allow_overlap and p_category = 'unavailability') then
    if calendar_has_conflict(p_start_at, p_end_at) then
      raise exception 'calendar_conflict';
    end if;
  end if;

  insert into public.coach_unavailabilities
    (category, title, notes, location, all_day, start_at, end_at, reason)
  values
    (p_category, coalesce(p_title, ''), coalesce(p_notes, ''), coalesce(p_location, ''),
     coalesce(p_all_day, false), p_start_at, p_end_at, coalesce(p_reason, ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_coach_event_atomic(text, text, text, text, boolean, timestamptz, timestamptz, text, boolean) from public;
revoke execute on function public.create_coach_event_atomic(text, text, text, text, boolean, timestamptz, timestamptz, text, boolean) from anon;
grant execute on function public.create_coach_event_atomic(text, text, text, text, boolean, timestamptz, timestamptz, text, boolean) to authenticated;

-- 7) Modification d'un événement du coach (staff uniquement) — déplacement,
--    changement de durée ou de contenu, même contrôle de conflit (en
--    s'excluant soi-même).
create or replace function public.update_coach_event_atomic(
  p_id uuid,
  p_title text,
  p_notes text,
  p_location text,
  p_all_day boolean,
  p_start_at timestamptz,
  p_end_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text;
begin
  if not is_coach_or_admin() then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'calendar_invalid_period';
  end if;

  perform pg_advisory_xact_lock(hashtext('calendar_booking'));

  select category into v_category from public.coach_unavailabilities where id = p_id;
  if not found then
    return false;
  end if;

  if v_category <> 'unavailability' and calendar_has_conflict(p_start_at, p_end_at, null, p_id) then
    raise exception 'calendar_conflict';
  end if;

  update public.coach_unavailabilities
  set title = coalesce(p_title, ''),
      notes = coalesce(p_notes, ''),
      location = coalesce(p_location, ''),
      all_day = coalesce(p_all_day, false),
      start_at = p_start_at,
      end_at = p_end_at,
      updated_at = now()
  where id = p_id;
  return true;
end;
$$;

revoke all on function public.update_coach_event_atomic(uuid, text, text, text, boolean, timestamptz, timestamptz) from public;
revoke execute on function public.update_coach_event_atomic(uuid, text, text, text, boolean, timestamptz, timestamptz) from anon;
grant execute on function public.update_coach_event_atomic(uuid, text, text, text, boolean, timestamptz, timestamptz) to authenticated;

-- 8) Verrouillage RLS : plus aucun INSERT/UPDATE direct depuis le
--    navigateur sur les tables calendrier sensibles.
drop policy if exists appointments_insert_own_student on public.appointments;
drop policy if exists appointments_update_own_student on public.appointments;
drop policy if exists appointments_manage_staff on public.appointments;
create policy appointments_select_staff on public.appointments
  for select using (is_coach_or_admin());

drop policy if exists coach_unavailabilities_manage_staff on public.coach_unavailabilities;
create policy coach_unavailabilities_select_staff on public.coach_unavailabilities
  for select using (is_coach_or_admin());
create policy coach_unavailabilities_delete_staff on public.coach_unavailabilities
  for delete using (is_coach_or_admin());
