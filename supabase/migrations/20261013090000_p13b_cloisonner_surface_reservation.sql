-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ P13-B/6 — LA SURFACE DE RÉSERVATION N'EST PAS UNE PORTE D'AGENDA        ║
-- ║ Migration ADDITIVE. Les cinq migrations P13-B appliquées ne sont pas    ║
-- ║ touchées.                                                               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ════════════════════════════════════════════════════════════════════════════
-- LE DÉFAUT, TEL QUE MESURÉ
-- ════════════════════════════════════════════════════════════════════════════
-- Anomalie constatée sur Vercel Preview le 13/10/2026, reproduite sur
-- PostgreSQL 16 local. Un collaborateur dont `agenda_communication` vaut
-- « aucun accès » — et même un collaborateur SANS AUCUNE permission ET SANS
-- AUCUN élève affecté — lisait :
--
--   · `coach_availabilities`  → 1 ligne (créneaux hebdomadaires du coach) ;
--   · `booking_settings`      → 1 ligne (délai, horizon, durée par défaut) ;
--   · `get_busy_ranges()`     → 2 lignes (bornes des RDV + indisponibilités).
--
-- ════════════════════════════════════════════════════════════════════════════
-- LA CAUSE : LES POLICIES SE COMBINENT EN **OU**
-- ════════════════════════════════════════════════════════════════════════════
-- Ce n'est NI une permission mal enregistrée, NI un rôle mal résolu, NI un
-- cache client, NI une garde API. Mesuré dans la session effective du
-- collaborateur : `staff_role()` = 'collaborateur', `categories_lecture()` et
-- `categories_ecriture()` VIDES, `student_ids_portee()` = son élève affecté.
-- Le modèle SQL répond donc juste.
--
-- La migration 20261011100000 a AJOUTÉ sur ces tables des policies
-- catégorisées (`..._manage_staff_select`, gardées par
-- `'agenda_communication' in (select categories_lecture())`). Mais les
-- policies PERMISSIVES de PostgreSQL se combinent en **OU** : les policies
-- héritées du parcours de réservation élève —
--
--     coach_availabilities_select_authenticated : auth.role() = 'authenticated'
--     booking_settings_select_authenticated     : auth.role() = 'authenticated'
--
-- — restaient vraies pour n'importe quel compte connecté, staff compris.
-- Ajouter une policy stricte à côté d'une policy ouverte ne referme rien.
-- `get_busy_ranges()`, de son côté, est SECURITY DEFINER et ne portait
-- AUCUNE garde : elle lisait `appointments` et `coach_unavailabilities` hors
-- RLS pour tout appelant ayant EXECUTE, c'est-à-dire tout `authenticated`.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CE QUI RESTE OUVERT, ET POURQUOI
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ LE PARCOURS ÉLÈVE N'EST PAS REFERMÉ, ET IL NE DOIT PAS L'ÊTRE. Un élève
-- a besoin des créneaux de son coach, des réglages de réservation et des
-- bornes occupées : sans ces trois lectures il ne peut plus réserver, et
-- `get_busy_ranges()` existe précisément pour qu'il ne réserve pas un créneau
-- déjà pris par un AUTRE élève (voir lib/supabase/appointments.ts,
-- `getAvailableSlots`). Ces trois surfaces ne portent aucune donnée privée :
-- des bornes horaires anonymes, des créneaux hebdomadaires, trois nombres.
--
-- Ce correctif retire donc le STAFF de la clause ouverte, et lui seul :
--   · un élève lit exactement ce qu'il lisait avant ;
--   · `service_role` (webhook, cron) est inchangé ;
--   · l'administrateur et le coach autonome (assistant) passent par
--     `est_staff_global()`, comme partout ailleurs dans P13-B ;
--   · un collaborateur doit avoir `agenda_communication` — et le NIVEAU
--     attendu : `categories_lecture()` pour lire, `categories_ecriture()`
--     pour écrire, ce que les policies d'écriture existantes exigeaient déjà.
--
-- ⚠️ CE QUI N'ÉTAIT PAS EN CAUSE, ET QUI A ÉTÉ MESURÉ FERMÉ. Les données
-- d'agenda RÉELLEMENT protégées l'étaient déjà : `appointments` (0 ligne sans
-- la catégorie), `coach_unavailabilities` (0 ligne), et les RPC
-- `create_appointment_atomic` / `create_coach_event_atomic` /
-- `update_coach_event_atomic` refusent sans la catégorie au niveau exigé.
-- Le suivi élève détaillé était fermé lui aussi : `student_profiles`,
-- `coach_notes`, `weight_entries`, `body_measurements`, `progress_photos`,
-- `workout_feedback`, `activity_events` → 0 ligne sans `suivi_eleve`.
-- Cette migration ne les touche pas.

begin;

-- ── 1. LES DEUX POLICIES OUVERTES, RESSERRÉES AU PARCOURS ÉLÈVE ───────────
-- `current_student_id()` est la fonction SECURITY DEFINER déjà utilisée par
-- toutes les policies élève : elle rend l'identifiant `students` de
-- l'appelant, ou NULL. Un membre du staff n'a pas de fiche élève, donc elle
-- vaut NULL pour lui — c'est ce qui le sort de cette clause sans lui retirer
-- la clause catégorisée.
--
-- ⚠️ LA PORTÉE RESTE « TOUT ÉLÈVE CONNECTÉ », PAS « L'ÉLÈVE DE CE COACH ».
-- Resserrer davantage demanderait de comparer `coach_availabilities.coach_id`
-- au coach de l'élève — or cette colonne est NULLABLE et porte des lignes
-- héritées sans propriétaire : un élève dont le coach n'a que des créneaux
-- `coach_id is null` perdrait toute possibilité de réserver. Ce resserrement
-- est une décision produit, pas un correctif de sécurité : il est signalé au
-- rapport et laissé hors de cette migration.

drop policy if exists coach_availabilities_select_authenticated on public.coach_availabilities;
drop policy if exists coach_availabilities_select_eleve on public.coach_availabilities;
create policy coach_availabilities_select_eleve
  on public.coach_availabilities for select
  using ((select public.current_student_id()) is not null);

drop policy if exists booking_settings_select_authenticated on public.booking_settings;
drop policy if exists booking_settings_select_eleve on public.booking_settings;
create policy booking_settings_select_eleve
  on public.booking_settings for select
  using ((select public.current_student_id()) is not null);

-- ── 1b. LE COLLABORATEUR AVEC LA CATÉGORIE DOIT ENCORE TRAVAILLER ─────────
-- ⚠️ DÉFAUT DÉCOUVERT EN REFERMANT LE PREMIER. Les policies catégorisées de
-- la migration 20261011100000 exigent `coach_id = current_staff_id()` : un
-- membre du staff ne voit QUE SES PROPRES créneaux. Or un collaborateur ne
-- possède jamais de ligne de disponibilité — il travaille sur les élèves d'un
-- AUTRE coach. Tant que la clause ouverte existait, elle masquait ce trou ;
-- une fois retirée, un collaborateur avec `agenda_communication / lecture`
-- perdait les créneaux du coach dont il gère les élèves, et ne pouvait plus
-- proposer un rendez-vous. Mesuré : contrôle I4, rouge après le seul retrait.
--
-- On AJOUTE donc une clause de PORTÉE, sans toucher aux policies validées —
-- elles restent en place et continuent de couvrir le staff propriétaire.
-- `coach_ids_portee()` (migration 20261011090000) rend, pour un
-- collaborateur, les coachs de ses élèves AFFECTÉS : sans affectation
-- l'ensemble est vide, donc la permission seule n'ouvre rien.

drop policy if exists coach_availabilities_select_portee on public.coach_availabilities;
create policy coach_availabilities_select_portee
  on public.coach_availabilities for select
  using (
    coach_id is not null
    and coach_id in (select public.coach_ids_portee())
    and coalesce(
          'agenda_communication' in (select public.categories_lecture()),
          false
        )
  );

-- `booking_settings` ne porte aucun `coach_id` : c'est une ligne de réglages
-- GLOBALE (délai minimum, horizon, durée par défaut — trois nombres, aucune
-- donnée personnelle). Un collaborateur qui propose un créneau en a besoin
-- pour calculer la fenêtre de réservation ; la policy existante ne vise que
-- `est_staff_global()`, donc elle l'excluait.
drop policy if exists booking_settings_select_agenda on public.booking_settings;
create policy booking_settings_select_agenda
  on public.booking_settings for select
  using (
    coalesce(
      'agenda_communication' in (select public.categories_lecture()),
      false
    )
  );

-- ── 2. get_busy_ranges() : MÊME SORTIE, MAIS SOUS GARDE ───────────────────
-- Le corps est repris à l'identique (mêmes tables, mêmes statuts bloquants,
-- même tri, mêmes bornes et RIEN d'autre : aucun titre, aucun motif, aucune
-- identité). Seule une condition d'autorisation est ajoutée, évaluée une
-- fois par appel.
--
-- ⚠️ FAIL-CLOSED SUR LES NULL. `coalesce(..., false)` partout où une fonction
-- peut rendre NULL, et `current_student_id() is not null` plutôt qu'une
-- comparaison : un NULL ne doit jamais ouvrir la fonction.
create or replace function public.get_busy_ranges(
  p_from timestamptz,
  p_to timestamptz
)
returns table (start_at timestamptz, end_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with autorise as (
    select coalesce(auth.role(), '') = 'service_role'
        or public.current_student_id() is not null
        or coalesce(public.est_staff_global(), false)
        or (
             -- ⚠️ LA PERMISSION SEULE NE SUFFIT JAMAIS — invariant P13-B. Un
             -- collaborateur doit AUSSI avoir au moins un élève affecté :
             -- `coach_ids_portee()` est vide sans affectation. Mesuré :
             -- contrôle I12, rouge quand la garde ne testait que la catégorie.
             coalesce(
               'agenda_communication' in (select public.categories_lecture()),
               false
             )
             and exists (select 1 from public.coach_ids_portee())
           ) as ok
  )
  select a.start_at, a.end_at
    from public.appointments a
   where (select ok from autorise)
     and a.status in ('pending', 'confirmed')
     and a.start_at < p_to
     and a.end_at > p_from
  union all
  select u.start_at, u.end_at
    from public.coach_unavailabilities u
   where (select ok from autorise)
     and u.start_at < p_to
     and u.end_at > p_from
  order by 1;
$fn$;

alter function public.get_busy_ranges(timestamptz, timestamptz) owner to postgres;
revoke all on function public.get_busy_ranges(timestamptz, timestamptz) from public;
revoke execute on function public.get_busy_ranges(timestamptz, timestamptz) from anon;
grant execute on function public.get_busy_ranges(timestamptz, timestamptz)
  to authenticated, service_role;

comment on function public.get_busy_ranges(timestamptz, timestamptz) is
  'Bornes occupées [p_from, p_to) — bornes anonymes uniquement. P13-B/6 : '
  'réservée à service_role, à un élève connecté (parcours de réservation), au '
  'staff global, ou à un collaborateur ayant agenda_communication en lecture.';

-- ── 3. VÉRIFICATION FINALE ────────────────────────────────────────────────
do $g$
declare v_def text; v_n int;
begin
  -- Les deux policies ouvertes ont disparu, les deux nouvelles existent.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and policyname in ('coach_availabilities_select_authenticated',
                        'booking_settings_select_authenticated');
  if v_n <> 0 then
    raise exception 'P13-B/6 : % policy(ies) ouverte(s) subsiste(nt) — correctif à revoir', v_n;
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and policyname in ('coach_availabilities_select_eleve',
                        'booking_settings_select_eleve');
  if v_n <> 2 then
    raise exception 'P13-B/6 : les policies de remplacement manquent (% sur 2)', v_n;
  end if;

  -- Les policies catégorisées de P13-B sont toujours là : on n'a pas
  -- remplacé une clause ouverte par une absence de clause staff.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and policyname in ('coach_availabilities_manage_staff_select',
                        'booking_settings_manage_staff_select');
  if v_n <> 2 then
    raise exception 'P13-B/6 : les policies catégorisées du staff ont disparu (% sur 2)', v_n;
  end if;

  -- Et la clause de portée du collaborateur existe, gardée par la catégorie.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and policyname in ('coach_availabilities_select_portee',
                        'booking_settings_select_agenda')
     and coalesce(qual,'') like '%categories_lecture%';
  if v_n <> 2 then
    raise exception 'P13-B/6 : la clause de portée du collaborateur manque ou n''est pas gardée par la catégorie (% sur 2)', v_n;
  end if;

  -- La fonction porte sa garde, et son corps n'a pas été amputé.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'get_busy_ranges';
  if v_def is null then
    raise exception 'P13-B/6 : public.get_busy_ranges introuvable';
  end if;
  if position('categories_lecture' in v_def) = 0
     or position('current_student_id' in v_def) = 0
     or position('est_staff_global' in v_def) = 0
     or position('coach_ids_portee' in v_def) = 0
     or position('coalesce' in v_def) = 0 then
    raise exception 'P13-B/6 : la garde de get_busy_ranges est incomplète';
  end if;
  if position('coach_unavailabilities' in v_def) = 0
     or position('''pending'', ''confirmed''' in v_def) = 0 then
    raise exception 'P13-B/6 : le corps de get_busy_ranges a changé — les bornes ne sont plus celles du parcours de réservation';
  end if;
  if has_function_privilege(
       'anon',
       (select p.oid from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'get_busy_ranges'),
       'EXECUTE') then
    raise exception 'P13-B/6 : anon peut exécuter get_busy_ranges';
  end if;

  raise notice 'P13-B/6 : surface de réservation cloisonnée (2 policies resserrées, 2 clauses de portée, 1 fonction gardée).';
end $g$;

commit;
