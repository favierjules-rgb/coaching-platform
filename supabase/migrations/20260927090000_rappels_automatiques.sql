-- ============================================================================
-- LES RAPPELS AUTOMATIQUES — DEUX RAILS SYSTÈME SUR LE SOCLE EXISTANT
-- ============================================================================
--
-- ── CE QUE CETTE MIGRATION FAIT, EXACTEMENT ────────────────────────────────
--   1. ajoute la colonne `notification_campaigns.rappel_auto` (texte, nullable,
--      CHECK dans ('entrainement', 'nutrition')) ;
--   2. crée un index UNIQUE PARTIEL dessus : au plus UNE campagne par genre ;
--   3. insère les DEUX campagnes système si elles n'existent pas déjà
--      (entraînement 08:00, nutrition 20:30, fuseau Europe/Paris), avec leur
--      première échéance calculée depuis `now()` ;
--   4. rien d'autre. Aucune table créée, aucune ligne existante modifiée,
--      aucune policy touchée, aucun trigger, aucune suppression.
--
-- ── CE QU'ELLE NE FAIT PAS ─────────────────────────────────────────────────
-- Elle n'active AUCUN rappel pour personne. Un rappel est actif pour un élève
-- quand une ligne le désigne dans `notification_campaign_targets` — et cette
-- table reste vide de toute ligne de rappel à l'issue de cette migration. Après
-- application, l'état du produit est donc : deux campagnes qui tournent à vide,
-- et zéro notification envoyée.
--
-- ── POURQUOI UNE COLONNE PLUTÔT QU'UNE TABLE DE PRÉFÉRENCES ────────────────
-- Parce que le réglage « ON pour cet élève » existe déjà : c'est
-- `notification_campaign_targets (campaign_id, student_id)`, sous RLS staff
-- depuis la migration 20260828090000. Créer une table de préférences en
-- parallèle aurait donné DEUX sources de vérité pour la même question — et
-- c'est le genre de doublon qui finit par désigner deux ensembles d'élèves
-- différents. L'anti-doublon d'envoi, lui, est déjà porté par
-- `unique (campaign_id, scheduled_for)` et `unique (occurrence_id,
-- subscription_id)` : rien à ajouter.
--
-- ── POURQUOI L'INDEX UNIQUE PARTIEL ────────────────────────────────────────
-- Deux campagnes « entrainement » enverraient deux rappels le même matin, et
-- les réglages des élèves seraient répartis entre les deux sans que personne ne
-- le voie. L'unicité est la garantie qu'il n'y a qu'un rail par genre — donc
-- une seule source de vérité pour « qui reçoit le rappel d'entraînement ».
--
-- ── LA CONDITION N'EST PAS EN SQL, ET C'EST VOULU ──────────────────────────
-- « Séance prévue aujourd'hui et non terminée », « journée alimentaire
-- incomplète » sont évaluées au moment de l'envoi, côté application
-- (lib/rappels-automatiques.ts pour les règles, lib/notifications/rappels.ts
-- pour les lectures). Les écrire en SQL les aurait dupliquées : la semaine du
-- programme est déjà calculée par `computeCurrentWeekNumber`, qui reste la seule
-- autorité.
-- ============================================================================

-- ── 1. LE MARQUEUR DE CAMPAGNE SYSTÈME ─────────────────────────────────────
alter table public.notification_campaigns
  add column if not exists rappel_auto text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notification_campaigns_rappel_auto_check'
  ) then
    alter table public.notification_campaigns
      add constraint notification_campaigns_rappel_auto_check
      check (rappel_auto is null or rappel_auto in ('entrainement', 'nutrition'));
  end if;
end $$;

comment on column public.notification_campaigns.rappel_auto is
  'Genre de rappel automatique (entrainement | nutrition) quand cette campagne est un rail système : elle n''apparaît pas dans la liste du coach, ne se modifie pas comme un message ponctuel, et n''envoie qu''aux élèves dont la condition du jour est remplie. NULL = campagne ordinaire.';

-- ── 2. AU PLUS UN RAIL PAR GENRE ───────────────────────────────────────────
create unique index if not exists notification_campaigns_rappel_auto_unique
  on public.notification_campaigns (rappel_auto)
  where rappel_auto is not null;

-- ── 3. LES DEUX CAMPAGNES SYSTÈME ──────────────────────────────────────────
--
-- `created_by` reste NULL : personne ne les a écrites, et la route
-- /api/admin/notifications/campaigns/[id] les refuse de toute façon.
--
-- `next_run_at` : la prochaine occurrence de l'heure locale visée. Calculée en
-- Europe/Paris puis convertie, pour que « 08:00 » veuille dire 08:00 ICI, de
-- part et d'autre du changement d'heure. La suite est recalculée après chaque
-- occurrence par le planificateur (`prochaineEcheance`), qui est déjà la seule
-- autorité sur la récurrence.
insert into public.notification_campaigns (
  created_by, title, body, destination,
  target_kind, schedule_kind, timezone, recurrence, next_run_at,
  active, status, rappel_auto
)
select
  null,
  'Séance du jour',
  'Ta séance t''attend aujourd''hui.',
  '/entrainement',
  'students',
  'recurring',
  'Europe/Paris',
  jsonb_build_object('freq', 'daily', 'hour', 8, 'minute', 0),
  (
    -- Aujourd'hui 08:00 en heure de Paris si c'est encore devant nous, sinon demain.
    select case
      when (current_date + time '08:00') at time zone 'Europe/Paris' > now()
        then (current_date + time '08:00') at time zone 'Europe/Paris'
      else ((current_date + 1) + time '08:00') at time zone 'Europe/Paris'
    end
  ),
  true,
  'programmee',
  'entrainement'
where not exists (
  select 1 from public.notification_campaigns where rappel_auto = 'entrainement'
);

insert into public.notification_campaigns (
  created_by, title, body, destination,
  target_kind, schedule_kind, timezone, recurrence, next_run_at,
  active, status, rappel_auto
)
select
  null,
  'Journée alimentaire',
  'Il reste des repas à compléter pour aujourd''hui.',
  '/nutrition',
  'students',
  'recurring',
  'Europe/Paris',
  jsonb_build_object('freq', 'daily', 'hour', 20, 'minute', 30),
  (
    select case
      when (current_date + time '20:30') at time zone 'Europe/Paris' > now()
        then (current_date + time '20:30') at time zone 'Europe/Paris'
      else ((current_date + 1) + time '20:30') at time zone 'Europe/Paris'
    end
  ),
  true,
  'programmee',
  'nutrition'
where not exists (
  select 1 from public.notification_campaigns where rappel_auto = 'nutrition'
);
