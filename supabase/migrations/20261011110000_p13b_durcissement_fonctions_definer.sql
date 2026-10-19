-- ════════════════════════════════════════════════════════════════════════════
-- P13-B — DURCISSEMENT DES 10 FONCTIONS SECURITY DEFINER
-- ════════════════════════════════════════════════════════════════════════════
-- POURQUOI CETTE MIGRATION EXISTE
--
-- 20261011100000 a refermé les 72 policies. Elle ne suffit pas : 23 fonctions
-- SQL appellent `is_coach_or_admin()` dans leur corps, et DIX d'entre elles
-- sont `SECURITY DEFINER` — elles s'exécutent avec les droits du propriétaire
-- et la RLS n'est jamais consultée.
--
-- Un collaborateur passe `is_coach_or_admin()` : son `profiles.role` vaut
-- 'coach', comme celui d'un assistant. Sans cette migration il pourrait donc
-- appeler `create_appointment_atomic` pour N'IMPORTE QUEL élève, affecté ou
-- non, catégorie ou non — par un simple `/rest/v1/rpc/…`. Le cloisonnement
-- posé par les policies serait contournable en une requête.
--
-- Les 13 fonctions restantes sont `SECURITY INVOKER` : la RLS s'y applique,
-- les policies les brident déjà. Elles ne sont pas touchées.
--
-- AUCUN PRÉDICAT GÉNÉRIQUE
--
-- Chaque fonction reçoit la règle qui lui correspond, déterminée après lecture
-- de son corps complet : qui l'appelle, sur quel élève, dans quelle catégorie,
-- pour quelle opération. Deux d'entre elles ne demandent qu'un drapeau
-- « staff », trois sont des gardiens de colonnes, cinq sont des RPC de
-- calendrier dont le contrôle doit porter sur la ligne visée.
--
-- AU PASSAGE : `search_path`
--
-- Les dix portaient `set search_path = 'public'`, sans nommer `pg_temp`. Sur
-- une fonction SECURITY DEFINER, `pg_temp` non nommé est consulté EN PREMIER :
-- un objet temporaire peut masquer les tables lues ici. Elles sont réécrites
-- avec `set search_path = public, pg_temp`, pg_temp en dernier — la convention
-- déjà appliquée aux fonctions de P13-A.


-- ── 1. LES TROIS GARDIENS DE COLONNES ──────────────────────────────────────

-- `students` : `coach_id`, `user_id`, `access_type`, `status`.
-- C'EST LA FONCTION LA PLUS SENSIBLE DU LOT. Telle qu'elle était, tout compte
-- passant `is_coach_or_admin()` pouvait réécrire `coach_id` — donc un
-- collaborateur pouvait S'APPROPRIER un élève ou le déplacer vers une autre
-- équipe. Un collaborateur est désormais traité comme un élève sur ces quatre
-- colonnes : elles sont RESTAURÉES, silencieusement, comme pour tout le monde.
-- L'administrateur et l'assistant gardent exactement le droit d'aujourd'hui.
create or replace function public.protect_students_ownership_columns()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $f$
begin
  -- Contexte non-utilisateur : rien à protéger.
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- Le staff PROPRIÉTAIRE gère ses élèves : rattachement, accès et statut lui
  -- appartiennent. Un collaborateur n'est pas propriétaire.
  if coalesce(public.staff_role(), '') in ('admin', 'assistant') then
    return new;
  end if;

  -- Ni un élève, ni un collaborateur ne choisit le coach d'une fiche, son
  -- type d'accès, son statut, ni le compte auth auquel elle est rattachée.
  new.coach_id := old.coach_id;
  new.access_type := old.access_type;
  new.status := old.status;
  new.user_id := old.user_id;

  return new;
end;
$f$;

-- `student_profiles` : colonnes de FACTURATION et d'ACCÈS (mode de facturation,
-- plan Stripe, modèle d'abonnement). C'est de l'administration : la
-- cartographie range ces données dans `admin_seul`, et aucune catégorie
-- accordable ne les ouvre. Un collaborateur ne les écrit jamais.
create or replace function public.protect_student_profiles_access_columns()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $f$
begin
  if coalesce(public.staff_role(), '') not in ('admin', 'assistant') then
    new.billing_access_mode := old.billing_access_mode;
    new.assigned_stripe_plan := old.assigned_stripe_plan;
    new.assigned_stripe_price_id := old.assigned_stripe_price_id;
    new.access_note := old.access_note;
    new.access_updated_at := old.access_updated_at;
    new.access_updated_by := old.access_updated_by;
    new.assigned_subscription_template_id := old.assigned_subscription_template_id;
  end if;
  return new;
end;
$f$;

-- `nutrition_days` : colonnes structurantes du plan. Ici, contrairement aux
-- deux précédentes, un collaborateur PEUT légitimement écrire — s'il a la
-- nutrition EN ÉCRITURE. La RLS a déjà décidé que la LIGNE lui est accessible ;
-- ce gardien ne tranche que les COLONNES. Exiger la catégorie suffit donc, et
-- un collaborateur en lecture seule les voit restaurées.
create or replace function public.protect_nutrition_days_coach_columns()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $f$
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if coalesce(public.staff_role(), '') in ('admin', 'assistant')
     or 'nutrition' in (select public.categories_ecriture()) then
    return new;
  end if;

  new.plan_id := old.plan_id;
  new.day := old.day;
  new.week_start_date := old.week_start_date;
  new.target := old.target;
  new.profile_key := old.profile_key;

  return new;
end;
$f$;


-- ── 2. LES DEUX GARDIENS DE RETOURS D'ENTRAÎNEMENT ─────────────────────────
-- `enforce_exercise_feedback_write` et `enforce_workout_feedback_write` font
-- ~150 lignes chacune, dont UNE SEULE porte une décision d'autorisation :
--
--     v_staff := (not v_systeme) and public.is_coach_or_admin();
--
-- `v_staff` commande ensuite le droit de poser une réponse vidéo, d'écrire
-- `status` et `coach_reply`, et de ne pas faire remonter `submitted_at`. La
-- bonne règle est « entraînement EN ÉCRITURE » : vraie pour l'administrateur
-- et l'assistant — donc comportement rigoureusement inchangé pour eux — et
-- fausse pour un collaborateur sans cette permission, qui retombe alors sur le
-- chemin élève.
--
-- RECOPIER CES DEUX CORPS ICI SERAIT PIRE QUE LA SUBSTITUTION : 300 lignes
-- transcrites à la main, dont la moindre divergence silencieuse casserait des
-- règles de rétention vidéo et d'immuabilité de snapshot sans qu'aucun test de
-- cette migration ne la voie. On substitue donc LA LIGNE EXACTE, et on exige
-- de la trouver : si le motif a changé, la migration ÉCHOUE au lieu de laisser
-- la fonction ouverte.
do $$
declare
  f text;
  v_src text;
  v_motif constant text := 'v_staff := (not v_systeme) and public.is_coach_or_admin();';
  v_neuf constant text := 'v_staff := (not v_systeme) and (''entrainement'' in (select public.categories_ecriture()));';
  v_n int;
begin
  foreach f in array array['enforce_exercise_feedback_write','enforce_workout_feedback_write'] loop
    select p.prosrc into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f and p.prokind = 'f';
    if v_src is null then
      raise exception 'P13-B : fonction public.%() introuvable', f;
    end if;

    -- Exactement une occurrence : zéro voudrait dire que la fonction a changé
    -- sous nos pieds, plusieurs que la décision d'autorisation est prise à
    -- plusieurs endroits et que substituer n'en corrigerait qu'un.
    v_n := (length(v_src) - length(replace(v_src, v_motif, ''))) / length(v_motif);
    if v_n <> 1 then
      raise exception
        'P13-B : public.%() contient % occurrence(s) du motif d''autorisation attendu, 1 exigée — migration interrompue', f, v_n;
    end if;

    execute format(
      'create or replace function public.%I() returns trigger language plpgsql security definer set search_path = public, pg_temp as %L',
      f, replace(v_src, v_motif, v_neuf));
  end loop;
end $$;


-- ── 3. LES CINQ RPC DE CALENDRIER ──────────────────────────────────────────
-- Elles sont courtes (19 à 38 lignes) et leur corps est reproduit À
-- L'IDENTIQUE : verrou consultatif, contrôles de période, détection de
-- conflit, insertions. Seule l'autorisation change.

-- Création d'un rendez-vous POUR UN ÉLÈVE. L'élève garde le droit de réserver
-- pour lui-même, le staff doit avoir cet élève dans sa portée `agenda_
-- communication` EN ÉCRITURE. Un rendez-vous sans élève reste réservé à
-- l'administration et aux assistants.
create or replace function public.create_appointment_atomic(
  p_student_id uuid, p_title text, p_description text, p_appointment_type text,
  p_start_at timestamptz, p_end_at timestamptz, p_location text,
  p_meeting_url text, p_ics_uid text, p_status text default 'confirmed')
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $f$
declare
  v_id uuid;
begin
  -- `coalesce(…, false)` est INDISPENSABLE : `current_student_id()` rend NULL
  -- pour qui n'est pas élève, donc la comparaison rend NULL, et `false or NULL`
  -- vaut NULL. Or `if not (NULL)` ne prend pas la branche `then` : sans ce
  -- coalesce la garde ne se déclenche jamais. Vérifié en base, pas déduit.
  if not coalesce(
       (p_student_id is not null
          and p_student_id in (select public.student_ids_agenda_communication_ecriture()))
    or (p_student_id is not null and public.current_student_id() is not null
          and p_student_id = public.current_student_id())
    or (p_student_id is null and coalesce(public.staff_role(), '') in ('admin', 'assistant'))
  , false) then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'calendar_invalid_period';
  end if;
  if p_status not in ('pending', 'confirmed') then
    raise exception 'calendar_invalid_status';
  end if;

  perform pg_advisory_xact_lock(hashtext('calendar_booking'));

  if public.calendar_has_conflict(p_start_at, p_end_at) then
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
$f$;

-- Annulation. L'élève concerné peut annuler le sien ; le staff doit l'avoir
-- dans sa portée en écriture. L'ordre des contrôles est conservé : ligne
-- introuvable → `false`, comme avant, avant toute question de droits.
create or replace function public.cancel_appointment_atomic(
  p_appointment_id uuid, p_reason text)
returns boolean language plpgsql security definer
set search_path = public, pg_temp as $f$
declare
  v_student_id uuid;
begin
  select student_id into v_student_id from public.appointments where id = p_appointment_id;
  if not found then
    return false;
  end if;
  if not coalesce(
       (v_student_id is not null
          and v_student_id in (select public.student_ids_agenda_communication_ecriture()))
    or (v_student_id is not null and public.current_student_id() is not null
          and v_student_id = public.current_student_id())
    or (v_student_id is null and coalesce(public.staff_role(), '') in ('admin', 'assistant'))
  , false) then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;

  update public.appointments
  set status = 'cancelled',
      cancellation_reason = coalesce(p_reason, ''),
      updated_at = now()
  where id = p_appointment_id;
  return true;
end;
$f$;

-- Report. Le contrôle fin ne peut PAS rester en tête : il porte sur l'élève du
-- rendez-vous, qui n'est connu qu'après le chargement de `v_original`. On garde
-- donc un contrôle grossier à l'entrée — être membre du staff — pour ne pas
-- révéler l'existence d'un rendez-vous à un inconnu, puis le contrôle précis
-- une fois la ligne lue.
create or replace function public.reschedule_appointment_atomic(
  p_appointment_id uuid, p_new_start_at timestamptz, p_new_end_at timestamptz, p_ics_uid text)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $f$
declare
  v_original public.appointments%rowtype;
  v_id uuid;
begin
  if public.current_staff_id() is null then
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

  if not coalesce(
       (v_original.student_id is not null
          and v_original.student_id in (select public.student_ids_agenda_communication_ecriture()))
    or (v_original.student_id is null and coalesce(public.staff_role(), '') in ('admin', 'assistant'))
  , false) then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;

  update public.appointments
  set status = 'cancelled', cancellation_reason = 'Reporté', updated_at = now()
  where id = p_appointment_id;

  if public.calendar_has_conflict(p_new_start_at, p_new_end_at) then
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
$f$;

-- Création d'une indisponibilité. DEUX changements, et le second est un
-- changement de COMPORTEMENT assumé : la fonction ne renseignait pas
-- `coach_id`, si bien que toutes les indisponibilités naissaient sans
-- propriétaire. Elle pose désormais `current_staff_id()`, de sorte que chaque
-- nouvelle ligne appartienne à son auteur et tombe sous la policy de portée.
-- Les 2 lignes historiques, elles, ne sont PAS modifiées : elles restent sans
-- propriétaire et donc hors d'atteinte d'un collaborateur.
create or replace function public.create_coach_event_atomic(
  p_category text, p_title text, p_notes text, p_location text, p_all_day boolean,
  p_start_at timestamptz, p_end_at timestamptz, p_reason text default '',
  p_allow_overlap boolean default false)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $f$
declare
  v_id uuid;
  v_staff uuid;
begin
  v_staff := public.current_staff_id();
  if v_staff is null
     or 'agenda_communication' not in (select public.categories_ecriture()) then
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
    if public.calendar_has_conflict(p_start_at, p_end_at) then
      raise exception 'calendar_conflict';
    end if;
  end if;

  insert into public.coach_unavailabilities
    (coach_id, category, title, notes, location, all_day, start_at, end_at, reason)
  values
    (v_staff, p_category, coalesce(p_title, ''), coalesce(p_notes, ''), coalesce(p_location, ''),
     coalesce(p_all_day, false), p_start_at, p_end_at, coalesce(p_reason, ''))
  returning id into v_id;

  return v_id;
end;
$f$;

-- Modification d'une indisponibilité. Même structure que le report : contrôle
-- grossier en tête, contrôle précis une fois la ligne lue. Un collaborateur ne
-- modifie QUE les siennes ; une ligne sans propriétaire n'est accessible qu'à
-- l'administration et aux assistants.
create or replace function public.update_coach_event_atomic(
  p_id uuid, p_title text, p_notes text, p_location text, p_all_day boolean,
  p_start_at timestamptz, p_end_at timestamptz)
returns boolean language plpgsql security definer
set search_path = public, pg_temp as $f$
declare
  v_category text;
  v_coach_id uuid;
begin
  if public.current_staff_id() is null then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'calendar_invalid_period';
  end if;

  perform pg_advisory_xact_lock(hashtext('calendar_booking'));

  select category, coach_id into v_category, v_coach_id
    from public.coach_unavailabilities where id = p_id;
  if not found then
    return false;
  end if;

  if not coalesce(
       coalesce(public.staff_role(), '') in ('admin', 'assistant')
    or (v_coach_id is not null
          and public.current_staff_id() is not null
          and v_coach_id = public.current_staff_id()
          and 'agenda_communication' in (select public.categories_ecriture()))
  , false) then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;

  if v_category <> 'unavailability' and public.calendar_has_conflict(p_start_at, p_end_at, null, p_id) then
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
$f$;


-- ── 4. CONTRÔLE INTÉGRÉ ────────────────────────────────────────────────────
-- À l'application, plus aucune fonction SECURITY DEFINER du schéma public ne
-- doit opposer `is_coach_or_admin()`. Un oubli fait échouer la migration.
do $$
declare v_reste text;
begin
  select string_agg(p.proname, ', ')
    into v_reste
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
     and p.prosrc like '%is_coach_or_admin%'
     and p.proname <> 'is_coach_or_admin';
  if v_reste is not null then
    raise exception
      'P13-B : fonctions SECURITY DEFINER opposant encore is_coach_or_admin() : %', v_reste;
  end if;
end $$;
