-- ============================================================================
-- LOT 1 / M1 — AFFECTATION MULTI-COACH : TOUT CE QUI S'AJOUTE
--
-- ⚠️ CETTE MIGRATION NE SUPPRIME AUCUNE FONCTION, ET C'EST TOUT SON INTÉRÊT.
-- L'application en service (65cc297) appelle encore
-- `create_appointment_atomic` sur sa signature à 10 arguments. Supprimer cette
-- fonction ici imposerait une simultanéité stricte entre l'application du SQL
-- et la promotion du déploiement Vercel — simultanéité qui n'existe pas — et
-- supprimerait du même coup tout repli.
--
-- Le retrait est donc une SECONDE migration (M2), volontairement absente de ce
-- dossier : son SQL est préparé dans `docs/lot1-m2-retrait-ancienne-rpc.md` et
-- le fichier de migration ne sera créé qu'après le déploiement de M1, la
-- vérification de vraies réservations, 24 à 48 h d'observation et une décision
-- explicite de fermer le retour arrière. Tant qu'il n'existe pas, aucun
-- `supabase db push` ne peut appliquer M1 et M2 ensemble.
--
-- Deux chantiers dans un seul fichier, dans cet ordre : la REPRISE des données
-- opérationnelles, puis le CONTRAT qui empêche le défaut de revenir.
--
-- ⚠️ CE QUI A ÉTÉ MESURÉ LE 15/11/2026 SUR LA BASE RÉELLE, et qui justifie ce
-- lot (relevés en lecture seule, revérifiés juste avant d'écrire ce fichier) :
--
--   • `create_appointment_atomic` déduisait `coach_id` de `students.coach_id`,
--     JAMAIS du créneau réservé. Le propriétaire de la disponibilité n'était
--     pas lu une seule fois.
--   • 7 rendez-vous sur 9 avaient `coach_id IS NULL`. Et un rendez-vous sans
--     propriétaire ne bloque PERSONNE : `calendar_has_conflict` comme
--     `get_busy_ranges` écartent `a.coach_id is null` sauf pour
--     l'administrateur. C'était un trou de double réservation réel.
--   • 5 disponibilités sur 7 étaient sans propriétaire, et la policy élève
--     (`coach_id IS NULL OR coach_id = …`) les rendait visibles à TOUS les
--     élèves : un pool partagé non voulu.
--   • Aucun des 9 rendez-vous n'était attribuable depuis sa disponibilité
--     d'origine : toutes les disponibilités compatibles étaient elles-mêmes
--     sans propriétaire. La reprise ci-dessous repose donc sur une DÉCISION
--     MÉTIER explicite (coach B était un compte de test), pas sur une preuve
--     technique. C'est écrit ici pour que personne ne la relise comme telle.
--
-- Hors périmètre, volontairement : les titres d'invitation .ics, Google OAuth,
-- l'abonnement Apple Calendar, les notifications e-mail. Aucune policy P13-B
-- n'est touchée.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. REPRISE DES DONNÉES — coach B (compte de test) → coach A (coach réel)
--
-- ⚠️ CE BLOC NE S'EXÉCUTE QUE SUR L'ENVIRONNEMENT QU'IL A ÉTÉ ÉCRIT POUR
-- RÉPARER. Sur un projet neuf (test, CI, `db reset`), ces deux fiches coach
-- n'existent pas : le bloc se retire avec un `notice` au lieu d'échouer, sinon
-- plus aucune migration ne pourrait rejouer. En revanche, si coach A existe
-- ET que les quantités ne correspondent pas à l'état constaté, on ÉCHOUE :
-- cela veut dire que la base a bougé depuis l'audit et que la décision métier
-- doit être revalidée avant de réattribuer quoi que ce soit.
-- ----------------------------------------------------------------------------
do $$
declare
  c_coach_a constant uuid := '53c76658-9560-41c1-9382-6588972271c2';
  c_coach_b constant uuid := 'f5dfa5ae-56b2-436e-a99d-ad390247c6e9';
  v_a_existe boolean;
  v_b_existe boolean;
  -- État attendu AVANT reprise (mesuré le 15/11/2026).
  v_eleves_total int;      v_eleves_a int;      v_eleves_b int;      v_eleves_nul int;
  v_dispos_total int;      v_dispos_a int;      v_dispos_b int;      v_dispos_nul int;
  v_indispos_total int;    v_indispos_b int;    v_indispos_nul int;
  v_reglages_total int;    v_reglages_b int;    v_reglages_nul int;
  v_rdv_total int;         v_rdv_a int;         v_rdv_b int;         v_rdv_nul int;
begin
  select exists (select 1 from public.coaches where id = c_coach_a),
         exists (select 1 from public.coaches where id = c_coach_b)
    into v_a_existe, v_b_existe;

  if not v_a_existe then
    raise notice 'LOT1 : coach A (%) absent — environnement neuf, reprise de données ignorée.', c_coach_a;
    return;
  end if;

  select count(*), count(*) filter (where coach_id = c_coach_a),
         count(*) filter (where coach_id = c_coach_b), count(*) filter (where coach_id is null)
    into v_eleves_total, v_eleves_a, v_eleves_b, v_eleves_nul
    from public.students;
  select count(*), count(*) filter (where coach_id = c_coach_a),
         count(*) filter (where coach_id = c_coach_b), count(*) filter (where coach_id is null)
    into v_dispos_total, v_dispos_a, v_dispos_b, v_dispos_nul
    from public.coach_availabilities;
  select count(*), count(*) filter (where coach_id = c_coach_b), count(*) filter (where coach_id is null)
    into v_indispos_total, v_indispos_b, v_indispos_nul
    from public.coach_unavailabilities;
  select count(*), count(*) filter (where coach_id = c_coach_b), count(*) filter (where coach_id is null)
    into v_reglages_total, v_reglages_b, v_reglages_nul
    from public.booking_settings;
  select count(*), count(*) filter (where coach_id = c_coach_a),
         count(*) filter (where coach_id = c_coach_b), count(*) filter (where coach_id is null)
    into v_rdv_total, v_rdv_a, v_rdv_b, v_rdv_nul
    from public.appointments;

  raise notice 'LOT1 avant : eleves %/%A/%B/%nul — dispos %/%A/%B/%nul — indispos %/%B/%nul — reglages %/%B/%nul — rdv %/%A/%B/%nul',
    v_eleves_total, v_eleves_a, v_eleves_b, v_eleves_nul,
    v_dispos_total, v_dispos_a, v_dispos_b, v_dispos_nul,
    v_indispos_total, v_indispos_b, v_indispos_nul,
    v_reglages_total, v_reglages_b, v_reglages_nul,
    v_rdv_total, v_rdv_a, v_rdv_b, v_rdv_nul;

  -- ── Assertions AVANT : l'état doit être exactement celui qui a été audité.
  if not v_b_existe then
    raise exception 'LOT1/avant : coach B (%) absent alors que coach A existe — état inattendu, reprise refusée', c_coach_b;
  end if;
  if (v_eleves_total, v_eleves_a, v_eleves_b, v_eleves_nul) <> (39, 37, 0, 2) then
    raise exception 'LOT1/avant : eleves attendus (39,37,0,2), trouvés (%,%,%,%)', v_eleves_total, v_eleves_a, v_eleves_b, v_eleves_nul;
  end if;
  if (v_dispos_total, v_dispos_a, v_dispos_b, v_dispos_nul) <> (7, 0, 2, 5) then
    raise exception 'LOT1/avant : disponibilites attendues (7,0,2,5), trouvées (%,%,%,%)', v_dispos_total, v_dispos_a, v_dispos_b, v_dispos_nul;
  end if;
  if (v_indispos_total, v_indispos_b, v_indispos_nul) <> (2, 0, 2) then
    raise exception 'LOT1/avant : indisponibilites attendues (2,0,2), trouvées (%,%,%)', v_indispos_total, v_indispos_b, v_indispos_nul;
  end if;
  if (v_reglages_total, v_reglages_b, v_reglages_nul) <> (1, 0, 1) then
    raise exception 'LOT1/avant : booking_settings attendus (1,0,1), trouvés (%,%,%)', v_reglages_total, v_reglages_b, v_reglages_nul;
  end if;
  if (v_rdv_total, v_rdv_a, v_rdv_b, v_rdv_nul) <> (9, 2, 0, 7) then
    raise exception 'LOT1/avant : rendez-vous attendus (9,2,0,7), trouvés (%,%,%,%)', v_rdv_total, v_rdv_a, v_rdv_b, v_rdv_nul;
  end if;

  -- ── Photo d'avant, pour prouver après qu'on n'a touché QUE `coach_id`.
  create temporary table lot1_rdv_avant on commit drop as
    select id, student_id, status, start_at, end_at, timezone, title, description,
           appointment_type, location, meeting_url, cancellation_reason,
           rescheduled_from_id, ics_uid, calendar_event_id, created_at
      from public.appointments;
  create temporary table lot1_dispos_avant on commit drop as
    select id, weekday, start_time, end_time, slot_duration_minutes,
           appointment_type, location, is_active, created_at
      from public.coach_availabilities;

  -- ── Reprise. `updated_at` est repositionné par le trigger `set_updated_at`
  --    de chaque table : c'est le seul champ qui bouge en plus de `coach_id`.
  update public.students
     set coach_id = c_coach_a
   where coach_id is null or coach_id = c_coach_b;
  update public.coach_availabilities
     set coach_id = c_coach_a
   where coach_id is null or coach_id = c_coach_b;
  update public.coach_unavailabilities
     set coach_id = c_coach_a
   where coach_id is null or coach_id = c_coach_b;
  update public.booking_settings
     set coach_id = c_coach_a
   where coach_id is null or coach_id = c_coach_b;
  update public.appointments
     set coach_id = c_coach_a
   where coach_id is null or coach_id = c_coach_b;

  -- ── Assertions APRÈS : plus rien d'orphelin, plus rien sur coach B,
  --    rien de perdu, et aucune donnée de réservation altérée.
  if exists (select 1 from public.students where coach_id is null or coach_id = c_coach_b)
     or exists (select 1 from public.coach_availabilities where coach_id is null or coach_id = c_coach_b)
     or exists (select 1 from public.coach_unavailabilities where coach_id is null or coach_id = c_coach_b)
     or exists (select 1 from public.booking_settings where coach_id is null or coach_id = c_coach_b)
     or exists (select 1 from public.appointments where coach_id is null or coach_id = c_coach_b) then
    raise exception 'LOT1/apres : une ligne operationnelle reste orpheline ou rattachee au compte de test';
  end if;

  if (select count(*) from public.appointments) <> v_rdv_total then
    raise exception 'LOT1/apres : % rendez-vous au lieu de %', (select count(*) from public.appointments), v_rdv_total;
  end if;
  if (select count(*) from public.coach_availabilities) <> v_dispos_total then
    raise exception 'LOT1/apres : % disponibilites au lieu de %', (select count(*) from public.coach_availabilities), v_dispos_total;
  end if;
  if (select count(*) from public.students) <> v_eleves_total then
    raise exception 'LOT1/apres : % eleves au lieu de %', (select count(*) from public.students), v_eleves_total;
  end if;

  if exists (
    select 1 from public.appointments a join lot1_rdv_avant b on b.id = a.id
     where (a.student_id, a.status, a.start_at, a.end_at, a.timezone, a.title, a.description,
            a.appointment_type, a.location, a.meeting_url, a.cancellation_reason,
            a.ics_uid, a.created_at)
        is distinct from
           (b.student_id, b.status, b.start_at, b.end_at, b.timezone, b.title, b.description,
            b.appointment_type, b.location, b.meeting_url, b.cancellation_reason,
            b.ics_uid, b.created_at)
        or a.rescheduled_from_id is distinct from b.rescheduled_from_id
        or a.calendar_event_id is distinct from b.calendar_event_id
  ) then
    raise exception 'LOT1/apres : une donnee de reservation autre que coach_id a ete modifiee';
  end if;
  if exists (
    select 1 from public.coach_availabilities d join lot1_dispos_avant b on b.id = d.id
     where (d.weekday, d.start_time, d.end_time, d.slot_duration_minutes,
            d.appointment_type, d.location, d.is_active, d.created_at)
        is distinct from
           (b.weekday, b.start_time, b.end_time, b.slot_duration_minutes,
            b.appointment_type, b.location, b.is_active, b.created_at)
  ) then
    raise exception 'LOT1/apres : une disponibilite a ete modifiee au-dela de coach_id';
  end if;

  -- Le compte de test n'est PAS supprimé : seule son activité opérationnelle
  -- a bougé. Sa fiche, son identité et son historique de compte sont intacts.
  if not exists (select 1 from public.coaches where id = c_coach_b) then
    raise exception 'LOT1/apres : le compte de test a disparu — ce lot ne doit jamais le supprimer';
  end if;

  raise notice 'LOT1 : reprise terminee — tout est rattache a coach A, compte de test conserve.';
end $$;

-- ----------------------------------------------------------------------------
-- 2. CONFLIT PAR COACH DÉSIGNÉ
--
-- `calendar_has_conflict` déduit sa portée de l'APPELANT
-- (`agenda_portee_conflit()`). C'est juste quand l'appelant EST le coach
-- concerné — création manuelle par le staff — et faux dès que le coach visé
-- est un autre : un élève réservant chez son coach, un administrateur
-- reportant le rendez-vous d'un tiers.
--
-- On n'y touche donc pas (ses appelants existants sont corrects) et on ajoute
-- une fonction qui prend le coach EN PARAMÈTRE. Nom distinct, pas de surcharge
-- de signature : aucune résolution ambiguë possible.
--
-- ⚠️ `SECURITY DEFINER` LIT HORS RLS, ET C'EST INDISPENSABLE : un élève doit
-- être bloqué par les rendez-vous des AUTRES élèves, qu'il n'a pas le droit de
-- lire. La fonction ne rend qu'un booléen, jamais une ligne — et elle n'est
-- exécutable que par `service_role` et le propriétaire, exactement comme
-- `calendar_has_conflict` (mesuré : `proacl` sans `authenticated`). Les RPC qui
-- l'appellent étant elles aussi `SECURITY DEFINER`, l'appel interne passe.
-- ----------------------------------------------------------------------------
create or replace function public.calendar_has_conflict_pour_coach(
  p_coach_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_exclude_appointment_id uuid default null,
  p_exclude_coach_event_id uuid default null
) returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
as $$
  -- ⚠️ FAIL-CLOSED SUR LES DEUX BORNES. Sans coach désigné, on répond
  -- « conflit » : un appelant qui aurait oublié de résoudre le coach doit
  -- échouer, pas réserver à l'aveugle. Et une ligne SANS propriétaire bloque,
  -- parce qu'on ne peut pas prouver qu'elle n'est pas celle de ce coach — la
  -- reprise ci-dessus en a laissé zéro, et plus aucun chemin n'en crée.
  select p_coach_id is null
      or exists (
        select 1 from public.appointments a
         where a.status in ('pending', 'confirmed')
           and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
           and a.start_at < p_end_at
           and a.end_at > p_start_at
           and (a.coach_id = p_coach_id or a.coach_id is null)
      )
      or exists (
        select 1 from public.coach_unavailabilities u
         where (p_exclude_coach_event_id is null or u.id <> p_exclude_coach_event_id)
           and u.start_at < p_end_at
           and u.end_at > p_start_at
           and (u.coach_id = p_coach_id or u.coach_id is null)
      );
$$;

revoke all on function public.calendar_has_conflict_pour_coach(uuid, timestamptz, timestamptz, uuid, uuid) from public;
grant execute on function public.calendar_has_conflict_pour_coach(uuid, timestamptz, timestamptz, uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 3. DEUX PARCOURS, DEUX RPC — UN POINT D'ENTRÉE PAR INTENTION
--
-- ⚠️ POURQUOI UNE SEULE FONCTION NE POUVAIT PAS SUFFIRE. Elle choisissait son
-- comportement avec un discriminant : d'abord `current_staff_id() is not
-- null`, puis `… or is_admin()`. Or une même personne peut avoir une fiche
-- `coaches` ET une fiche `students` : `coaches.user_id` et `students.user_id`
-- pointent tous deux vers `auth.users`, rien ne l'interdit. Une telle
-- identité double entrait dans la branche STAFF même en réservant depuis son
-- espace élève — donc sans aucune validation de disponibilité : ni jour, ni
-- horaire, ni durée, ni grille, ni propriétaire du créneau.
--
-- Aucun durcissement du discriminant ne corrige cela : le problème n'est pas
-- de savoir QUI appelle, c'est que le même point d'entrée servait deux
-- intentions. On les sépare donc en deux fonctions, et l'intention devient le
-- point d'entrée choisi — vérifié côté serveur dans les deux cas.
--
-- ⚠️ ET SURTOUT : AUCUNE DES DEUX NE PREND L'IDENTITÉ EN PARAMÈTRE.
--   • `reserver_creneau_eleve` n'a PAS de `p_student_id` : l'élève est
--     `current_student_id()`. Il n'y a donc rien à falsifier, et la
--     disponibilité est obligatoire — une identité double qui passe par là est
--     traitée en élève, point.
--   • `creer_rendez_vous_staff` exige d'être staff AVANT tout, et déduit le
--     propriétaire de la règle métier validée. Un non-staff y est refusé.
-- Aucun `actorType` ne circule : il n'y en a jamais eu côté SQL, et il n'en
-- apparaît pas ici.
--
-- ⚠️ `create_appointment_atomic` N'EST PAS SUPPRIMÉE ICI. Elle survit à M1,
-- strictement réduite (bloc 6), parce que l'application en service l'appelle
-- encore. M2 la supprimera dans ses deux signatures, et vérifiera qu'aucune
-- surcharge ne subsiste.
-- ----------------------------------------------------------------------------

-- ─── 3a. RÉSERVATION AUTONOME PAR L'ÉLÈVE ────────────────────────────────────
create or replace function public.reserver_creneau_eleve(
  p_availability_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_ics_uid text
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid;
  v_student_id uuid;
  v_coach_eleve uuid;
  v_dispo public.coach_availabilities%rowtype;
  v_fuseau constant text := 'Europe/Paris';
  v_debut_local timestamp;
  v_fin_local timestamp;
  v_minutes_depuis_debut int;
begin
  /*
   * ⚠️ L'ÉLÈVE EST L'APPELANT, JAMAIS UN ARGUMENT. `current_student_id()` est
   * `SECURITY DEFINER` et ne rend que la fiche rattachée à `auth.uid()` : il
   * n'existe aucun moyen de réserver pour autrui par cette porte. C'est aussi
   * ce qui rend l'identité double inoffensive ici — qui appelle cette fonction
   * est traité en élève, quelles que soient ses autres fiches.
   */
  v_student_id := public.current_student_id();
  if v_student_id is null then
    raise exception 'calendar_student_required' using errcode = '42501';
  end if;
  if p_availability_id is null then
    raise exception 'calendar_slot_required';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'calendar_invalid_period';
  end if;

  /*
   * ⚠️ LE VERROU EST PRIS AVANT LA MOINDRE LECTURE, ET TOUTES LES VALIDATIONS
   * PORTENT SUR LA LIGNE VERROUILLÉE — UNE SEULE FOIS. Valider avant le verrou
   * puis ne revérifier qu'une partie après laisse une modification concurrente
   * rendre les contrôles caducs : c'est le défaut corrigé le 15/11/2026.
   *
   * ORDRE DE VERROUILLAGE DU PROJET : `coach_availabilities` PUIS `students`.
   * Mesuré le même jour : une transaction qui prend les deux dans l'ordre
   * inverse en concurrence d'une réservation produit un interblocage
   * (`deadlock detected`) ; dans cet ordre-ci, elle attend. L'ordre est figé
   * par `scripts/tests/affectation-multi-coach.mts` (TEXTE-13).
   */
  perform pg_advisory_xact_lock(hashtext('calendar_booking'));

  /*
   * ⚠️ CETTE LECTURE EST HORS RLS. En `SECURITY DEFINER`, lire
   * `coach_availabilities` ne passe par AUCUNE policy : la policy élève
   * `coach_availabilities_select_eleve` ne protège rien ici, et le droit est
   * donc réécrit explicitement plus bas. Supposer le contraire rouvrirait le
   * pool de créneaux que ce lot ferme.
   */
  select * into v_dispo
    from public.coach_availabilities
   where id = p_availability_id
     for share;
  if not found then
    raise exception 'calendar_slot_not_found';
  end if;
  if not v_dispo.is_active then
    raise exception 'calendar_slot_inactive';
  end if;
  if v_dispo.coach_id is null then
    -- Aucun repli sur un coach par défaut : ce serait choisir un coach
    -- arbitrairement, exactement ce que ce lot supprime.
    raise exception 'calendar_slot_unowned';
  end if;

  -- La ligne élève est verrouillée elle aussi : une réaffectation concurrente
  -- attend la fin de la réservation au lieu de s'intercaler.
  select s.coach_id into v_coach_eleve
    from public.students s
   where s.id = v_student_id
     for share;
  if not found or v_coach_eleve is null or v_coach_eleve <> v_dispo.coach_id then
    raise exception 'calendar_slot_forbidden' using errcode = '42501';
  end if;

  -- ⚠️ LE JOUR ET L'HEURE SE COMPARENT DANS LE FUSEAU DU RENDEZ-VOUS, pas en
  -- UTC : `weekday` et `start_time` sont des données locales, et comparer en
  -- UTC décalerait les créneaux de début et de fin de journée.
  v_debut_local := p_start_at at time zone v_fuseau;
  v_fin_local := p_end_at at time zone v_fuseau;

  if extract(dow from v_debut_local)::int <> v_dispo.weekday then
    raise exception 'calendar_slot_mismatch';
  end if;
  if v_debut_local::date <> v_fin_local::date then
    raise exception 'calendar_slot_mismatch';
  end if;
  if v_debut_local::time < v_dispo.start_time or v_fin_local::time > v_dispo.end_time then
    raise exception 'calendar_slot_mismatch';
  end if;
  if (p_end_at - p_start_at) <> make_interval(mins => v_dispo.slot_duration_minutes) then
    raise exception 'calendar_slot_mismatch';
  end if;
  -- Le début doit tomber SUR la grille, pas n'importe où dans la plage :
  -- sinon un décalage de 5 minutes permettrait de doubler les créneaux.
  v_minutes_depuis_debut := (extract(epoch from (v_debut_local::time - v_dispo.start_time)) / 60)::int;
  if v_minutes_depuis_debut < 0 or mod(v_minutes_depuis_debut, v_dispo.slot_duration_minutes) <> 0 then
    raise exception 'calendar_slot_mismatch';
  end if;

  if public.calendar_has_conflict_pour_coach(v_dispo.coach_id, p_start_at, p_end_at) then
    raise exception 'calendar_conflict';
  end if;

  /*
   * ⚠️ TOUT LE CONTENU VIENT DE LA LIGNE VERROUILLÉE, RIEN DU NAVIGATEUR. Le
   * coach, le type, le lieu et le titre sont ceux qui viennent d'être
   * contrôlés. Le statut est forcé à `confirmed` : une réservation d'élève
   * n'est pas un brouillon, et lui laisser choisir son statut n'avait aucune
   * raison d'être. `meeting_url` reste vide — `coach_availabilities` ne porte
   * pas cette information, et l'inventer serait afficher un lien qui n'existe
   * pas.
   */
  insert into public.appointments
    (student_id, coach_id, title, description, appointment_type, start_at, end_at,
     location, meeting_url, status, ics_uid)
  values
    (v_student_id, v_dispo.coach_id, v_dispo.appointment_type, '',
     v_dispo.appointment_type, p_start_at, p_end_at, v_dispo.location,
     '', 'confirmed', coalesce(p_ics_uid, ''))
  returning id into v_id;
  return v_id;
end;
$$;

/*
 * ⚠️ `authenticated` SEUL, PAS `service_role`. Relevé le 15/11/2026 : les
 * SEULS appelants des fonctions de création de rendez-vous sont deux pages
 * `"use client"` qui passent par `createSupabaseBrowserClient`, donc par le
 * rôle `authenticated`. Les deux routes serveur qui touchent `appointments`
 * (`app/api/email/appointment-notification`, `app/api/cron/appointment-reminders`)
 * ne font que LIRE — aucune n'appelle de RPC d'écriture.
 *
 * Et le grant ne servirait à rien : sous `service_role`, `auth.uid()` est NULL,
 * donc `current_student_id()` rend NULL et cette fonction lèverait
 * `calendar_student_required`. Un éventuel besoin backend futur demandera une
 * conception propre — une RPC dédiée avec son autorisation — pas un grant.
 *
 * L'appel interne depuis `create_appointment_atomic` (bloc 6) ne dépend pas de
 * ce grant : une fonction `SECURITY DEFINER` s'exécute avec les droits de son
 * propriétaire.
 */
revoke all on function public.reserver_creneau_eleve(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.reserver_creneau_eleve(uuid, timestamptz, timestamptz, text) to authenticated;

-- ─── 3b. CRÉATION MANUELLE PAR LE STAFF ──────────────────────────────────────
create or replace function public.creer_rendez_vous_staff(
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
  v_coach_eleve uuid;
begin
  /*
   * ⚠️ ÊTRE STAFF EST LA PREMIÈRE CONDITION, ET ELLE SE LIT SUR LA SESSION.
   * Un élève — même avec une fiche `students` et rien d'autre — est refusé
   * ici : il n'a pas d'autre porte que `reserver_creneau_eleve`, où la
   * disponibilité est obligatoire. C'est ce couple de gardes qui ferme le
   * contournement par identité double.
   *
   * ⚠️ `is_admin()` EN PLUS DE `current_staff_id()`. L'administrateur
   * applicatif est reconnu par `profiles.role = 'admin'`, et le projet connaît
   * le cas de l'administrateur RÉEL SANS fiche `coaches` — le commentaire de
   * `protect_students_ownership_columns` le nomme. Tester la seule présence
   * d'une fiche l'aurait écarté de la création manuelle.
   */
  if public.current_staff_id() is null and not coalesce(public.is_admin(), false) then
    raise exception 'calendar_staff_required' using errcode = '42501';
  end if;

  /*
   * Garde d'autorisation — reprise de la version du 13/10/2026, à une
   * différence près : la branche « l'appelant agit pour SA propre fiche
   * élève » a disparu. Ce cas relève désormais de `reserver_creneau_eleve`,
   * et le laisser ici aurait maintenu ouverte la porte sans disponibilité.
   *
   * `coalesce(…, false)` est INDISPENSABLE : une sous-requête vide rend NULL,
   * `false or NULL` vaut NULL, et `if not (NULL)` ne prend pas la branche.
   */
  if not coalesce(
       (p_student_id is not null
        and p_student_id in (select public.student_ids_agenda_communication_ecriture()))
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

  perform pg_advisory_xact_lock(hashtext('calendar_booking'));

  /*
   * ⚠️ L'AUTEUR DE L'ACTION N'EST PAS LE PROPRIÉTAIRE DE L'AGENDA.
   * `current_staff_id()` rend une ligne de `coaches` sans distinguer ce
   * qu'elle représente : la contrainte vivante de `coaches.role` est
   * `{admin, assistant, collaborateur}`. Un collaborateur devenait donc
   * propriétaire d'une séance au seul motif qu'il l'avait saisie, et un
   * administrateur créant pour l'élève d'un autre coach rangeait la séance
   * dans SON agenda.
   *
   * Règle retenue, explicite :
   *   • séance POUR UN ÉLÈVE → le coach TITULAIRE de cet élève
   *     (`students.coach_id`), qui que soit l'auteur ;
   *   • séance SANS ÉLÈVE → l'agenda de l'auteur, et seulement s'il en a un
   *     (fiche `admin` ou `assistant`) ; un collaborateur n'a pas d'agenda
   *     propre dans ce modèle, et un administrateur sans fiche n'en a pas non
   *     plus ;
   *   • sinon REFUS — on ne choisit pas un propriétaire par défaut.
   *
   * ⚠️ IL N'Y A JAMAIS PLUSIEURS PROPRIÉTAIRES POSSIBLES, et ce n'est pas un
   * arbitrage : `students.coach_id` est une colonne SCALAIRE. Si le modèle
   * passait au multi-titulaire, il faudrait un paramètre de sélection vérifié
   * côté serveur, pas un départage implicite.
   */
  if p_student_id is not null then
    -- Même verrou, même ordre que dans la réservation élève : la ligne qui
    -- désigne le propriétaire est tenue jusqu'au `commit`.
    select s.coach_id into v_coach_eleve
      from public.students s
     where s.id = p_student_id
       for share;
    if not found or v_coach_eleve is null then
      raise exception 'calendar_owner_unresolved';
    end if;
    v_coach_id := v_coach_eleve;
  else
    if not coalesce(public.staff_role() in ('admin', 'assistant'), false) then
      raise exception 'calendar_owner_unresolved';
    end if;
    v_coach_id := public.current_staff_id();
  end if;

  if public.calendar_has_conflict_pour_coach(v_coach_id, p_start_at, p_end_at) then
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

-- Même raisonnement que pour `reserver_creneau_eleve` : aucun appelant
-- backend, et sous `service_role` cette fonction lèverait
-- `calendar_staff_required` (`is_admin()` faux, `current_staff_id()` NULL).
revoke all on function public.creer_rendez_vous_staff(
  uuid, text, text, text, timestamptz, timestamptz, text, text, text, text
) from public;
grant execute on function public.creer_rendez_vous_staff(
  uuid, text, text, text, timestamptz, timestamptz, text, text, text, text
) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. L'ANCIENNE RPC SURVIT À M1, MAIS STRICTEMENT RÉDUITE
--
-- ⚠️ POURQUOI ELLE SURVIT. L'application en service (65cc297) l'appelle encore,
-- sur sa signature à 10 arguments — vérifié par `git show`. La supprimer ici
-- imposerait une simultanéité stricte entre l'application du SQL et la
-- promotion du déploiement, et supprimerait tout repli. M2 la retirera.
--
-- ⚠️ POURQUOI ELLE EST RÉDUITE. Cette signature n'a AUCUN paramètre de
-- disponibilité : elle est structurellement incapable de valider un créneau.
-- « Ne plus permettre de réserver sans validation » s'y traduit donc par une
-- seule règle : tout appelant porteur d'une fiche élève est refusé. C'est
-- l'arbitrage du 15/11/2026 — la sécurité avant la continuité temporaire de
-- l'ancien parcours élève.
--
-- ⚠️ ET L'IDENTITÉ SE LIT SUR LE RÔLE, PAS SUR LA PRÉSENCE D'UNE FICHE. Une
-- première rédaction de cette garde ne testait que `current_staff_id()`. Elle
-- aurait laissé passer un administrateur applicatif SANS fiche `coaches` —
-- `profiles.role = 'admin'`, reconnu par `is_admin()` seul. Le projet connaît
-- ce profil : le commentaire de `protect_students_ownership_columns` le nomme
-- après l'avoir subi une fois, et c'est exactement le trou qu'avait déjà ouvert
-- le discriminant `v_est_staff` de la première version de ce lot. Les trois
-- fonctions sont donc lues : `current_student_id()`, `current_staff_id()` ET
-- `is_admin()`.
--
-- ⚠️ DEUX MOTIFS DISTINCTS, PARCE QU'ILS NE DISENT PAS LA MÊME CHOSE.
--   • `calendar_identite_ambigue` : un compte portant les DEUX identités a
--     touché l'ancienne porte. Mesuré le 15/11/2026 : 0 compte de ce type
--     existe, et seules les écritures de l'administrateur peuvent en créer
--     (`coaches_manage_admin_*`). Ce motif ne devrait JAMAIS se déclencher —
--     c'est pour cela qu'il porte un nom à lui : il mérite une alerte.
--   • `calendar_parcours_obsolete` : un onglet encore ouvert sur l'ancienne
--     page. Attendu pendant la fenêtre de bascule, et l'écran doit dire de
--     recharger.
--
-- ⚠️ LE CHEMIN STAFF NE RÉIMPLÉMENTE RIEN : IL DÉLÈGUE. Une seule
-- implémentation de l'attribution, du verrou `for share` sur la ligne élève et
-- du conflit par coach. L'ancienne application admin hérite donc immédiatement
-- de la bonne attribution : un collaborateur cesse d'être propriétaire d'une
-- séance qu'il saisit, et un administrateur cesse de s'attribuer la séance de
-- l'élève d'un autre coach.
--
-- Déléguer ne contourne aucune garde : `current_staff_id()` et `is_admin()`
-- lisent le JWT de session (`auth.uid()`), pas le rôle SQL courant, et restent
-- donc exacts à travers un appel `SECURITY DEFINER`.
-- ----------------------------------------------------------------------------
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
  v_identite_eleve boolean;
  v_identite_staff boolean;
begin
  v_identite_eleve := public.current_student_id() is not null;
  v_identite_staff := public.current_staff_id() is not null
                   or coalesce(public.is_admin(), false);

  if v_identite_eleve and v_identite_staff then
    raise exception 'calendar_identite_ambigue' using errcode = '42501';
  end if;
  if v_identite_eleve then
    raise exception 'calendar_parcours_obsolete' using errcode = '42501';
  end if;

  return public.creer_rendez_vous_staff(
    p_student_id, p_title, p_description, p_appointment_type,
    p_start_at, p_end_at, p_location, p_meeting_url, p_ics_uid, p_status);
end;
$$;

-- Droits inchangés par rapport à l'existant mesuré
-- (`{postgres=X, authenticated=X, service_role=X}`) : M1 ne doit rien casser
-- pour l'application en service, et ce n'est pas le lieu de resserrer les
-- droits d'une fonction en sursis.
revoke all on function public.create_appointment_atomic(
  uuid, text, text, text, timestamptz, timestamptz, text, text, text, text
) from public;
grant execute on function public.create_appointment_atomic(
  uuid, text, text, text, timestamptz, timestamptz, text, text, text, text
) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. `reschedule_appointment_atomic` — le conflit suit le coach du RDV
--
-- Seule ligne changée : le contrôle de conflit. Il utilisait
-- `calendar_has_conflict`, donc la portée de l'APPELANT — un administrateur
-- déplaçant le rendez-vous d'un autre coach vérifiait son propre agenda. Le
-- reste du corps est identique à la version du 13/10/2026.
-- ----------------------------------------------------------------------------
create or replace function public.reschedule_appointment_atomic(
  p_appointment_id uuid,
  p_new_start_at timestamptz,
  p_new_end_at timestamptz,
  p_ics_uid text
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $$
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
       or (v_original.student_id is null and coalesce(public.is_admin(), false))
       or (v_original.student_id is null and v_original.coach_id is not null
           and v_original.coach_id = public.current_staff_id()
           and coalesce('agenda_communication' in (select public.categories_ecriture()), false))
     , false) then
    raise exception 'calendar_not_allowed' using errcode = '42501';
  end if;
  update public.appointments
     set status = 'cancelled', cancellation_reason = 'Reporté', updated_at = now()
   where id = p_appointment_id;
  /*
   * ⚠️ LE COACH DU RENDEZ-VOUS, ET RIEN D'AUTRE. La version précédente
   * repliait un rendez-vous sans propriétaire sur `current_staff_id()` — donc
   * potentiellement sur un collaborateur, exactement le défaut corrigé plus
   * haut. On refuse au lieu de deviner : la reprise du bloc 1 n'a laissé
   * aucun rendez-vous orphelin et plus aucun chemin n'en crée, cette branche
   * est inatteignable et doit le rester visiblement.
   */
  if v_original.coach_id is null then
    raise exception 'calendar_owner_unresolved';
  end if;
  if public.calendar_has_conflict_pour_coach(
       v_original.coach_id, p_new_start_at, p_new_end_at) then
    -- Annule toute la transaction (l'original redevient actif).
    raise exception 'calendar_conflict';
  end if;
  insert into public.appointments
    (student_id, coach_id, title, description, appointment_type, start_at, end_at,
     location, meeting_url, status, rescheduled_from_id, ics_uid)
  values
    (v_original.student_id, v_original.coach_id,
     v_original.title, v_original.description,
     v_original.appointment_type, p_new_start_at, p_new_end_at, v_original.location,
     v_original.meeting_url, 'confirmed', v_original.id, coalesce(p_ics_uid, ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Index — le filtre par coach devient systématique
-- Les index existants sont `(student_id)` et `(start_at)`.
-- ----------------------------------------------------------------------------
create index if not exists appointments_coach_id_start_at_idx
  on public.appointments (coach_id, start_at);

-- ----------------------------------------------------------------------------
-- 7. Assertions finales sur le CONTRAT DE M1
--
-- `coach_id` n'est volontairement PAS passé `not null` : la stratégie pour des
-- rendez-vous futurs non attribuables n'est pas tranchée, et une contrainte
-- posée trop tôt bloquerait une reprise ultérieure. À rouvrir dans un lot
-- dédié, après M2.
-- ----------------------------------------------------------------------------
do $$
declare
  v_n int;
  v_corps text;
begin
  /*
   * ⚠️ M1 NE SUPPRIME RIEN — on le VÉRIFIE. L'application en service appelle
   * encore la 10-arguments : si une rédaction future la faisait disparaître
   * d'ici, la bascule redeviendrait un saut sans filet.
   */
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_appointment_atomic';
  if v_n <> 1 then
    raise exception 'LOT1/M1 : % signature(s) de create_appointment_atomic — M1 doit en conserver EXACTEMENT une (la 10-arguments)', v_n;
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_appointment_atomic'
     and pg_get_function_identity_arguments(p.oid) =
         'p_student_id uuid, p_title text, p_description text, p_appointment_type text, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_location text, p_meeting_url text, p_ics_uid text, p_status text';
  if v_n <> 1 then
    raise exception 'LOT1/M1 : la signature conservee n''est pas la 10-arguments historique';
  end if;

  /*
   * ⚠️ ET SON CORPS EST UN GARDE-FOU QUI DÉLÈGUE, pas une seconde
   * implémentation. Les trois lectures d'identité, les deux refus, l'appel
   * délégué — et AUCUNE écriture directe : réintroduire un `insert` ici
   * rouvrirait un chemin d'écriture parallèle à celui qu'on vient de cadrer.
   */
  select pg_get_functiondef(p.oid) into v_corps
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_appointment_atomic';
  if v_corps !~ 'current_student_id\(\)' or v_corps !~ 'current_staff_id\(\)' or v_corps !~ 'is_admin\(\)' then
    raise exception 'LOT1/M1 : la garde ne lit pas les trois fonctions d''identite';
  end if;
  if v_corps !~ 'calendar_identite_ambigue' or v_corps !~ 'calendar_parcours_obsolete' then
    raise exception 'LOT1/M1 : les deux motifs de refus doivent etre leves nommement';
  end if;
  if v_corps !~ 'return public\.creer_rendez_vous_staff\(' then
    raise exception 'LOT1/M1 : le chemin staff doit DELEGUER, pas reimplementer';
  end if;
  if v_corps ~* 'insert\s+into\s+public\.appointments' then
    raise exception 'LOT1/M1 : le garde-fou ne doit contenir aucune ecriture directe';
  end if;

  -- Les deux portes existent, chacune en UNE seule signature.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reserver_creneau_eleve';
  if v_n <> 1 then
    raise exception 'LOT1/M1 : % signature(s) de reserver_creneau_eleve au lieu d''une', v_n;
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'creer_rendez_vous_staff';
  if v_n <> 1 then
    raise exception 'LOT1/M1 : % signature(s) de creer_rendez_vous_staff au lieu d''une', v_n;
  end if;

  -- ⚠️ LA RÉSERVATION ÉLÈVE NE PREND NI ÉLÈVE NI COACH EN PARAMÈTRE. C'est la
  -- propriété qui ferme le contournement par identité double : il n'y a rien à
  -- falsifier, et la disponibilité est le premier argument.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reserver_creneau_eleve'
     and pg_get_function_identity_arguments(p.oid) = 'p_availability_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_ics_uid text';
  if v_n <> 1 then
    raise exception 'LOT1/M1 : signature inattendue pour reserver_creneau_eleve — %',
      (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'reserver_creneau_eleve');
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'reserver_creneau_eleve'
       and pg_get_function_identity_arguments(p.oid) ~* '(student|coach)'
  ) then
    raise exception 'LOT1/M1 : reserver_creneau_eleve expose une identite en parametre';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'calendar_has_conflict_pour_coach'
  ) then
    raise exception 'LOT1/M1 : calendar_has_conflict_pour_coach absente';
  end if;

  -- Aucune policy P13-B n'a été touchée : on vérifie que les surfaces
  -- d'écriture directe restent fermées (aucune policy INSERT/UPDATE/DELETE
  -- sur `appointments` — mesuré le 15/11/2026 : seules 2 policies SELECT).
  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename = 'appointments' and cmd <> 'SELECT';
  if v_n <> 0 then
    raise exception 'LOT1/M1 : % policy(ies) d''ecriture directe sur appointments — les RPC ne seraient plus le seul chemin', v_n;
  end if;

  raise notice 'LOT1/M1 : contrat en place — deux portes ouvertes, ancienne RPC reduite a un garde-fou.';
end $$;
