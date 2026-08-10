-- ============================================================================
-- WEB PUSH — SOCLE : ABONNEMENTS, CAMPAGNES, OCCURRENCES, ENVOIS
-- ============================================================================
-- Chantier « notifications push » (lot 1 : socle). Cette migration ne crée
-- que des tables neuves — elle ne touche à aucun objet existant.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUI EST STOCKÉ, ET CE QUI NE L'EST PAS
-- ────────────────────────────────────────────────────────────────────────────
-- `push_subscriptions` contient les secrets d'un abonnement (`endpoint`,
-- `p256dh`, `auth`) : c'est inévitable, ce sont eux qui permettent de chiffrer
-- un message pour un appareil. Ils ne sortent JAMAIS vers le navigateur — RLS
-- interdit toute lecture à l'élève, y compris sur ses propres lignes. Le seul
-- lecteur est le serveur d'envoi (service role).
--
-- `notification_deliveries` ne recopie ni endpoint ni clés : une référence
-- vers l'abonnement, un statut, un code d'erreur. L'historique reste lisible
-- sans exposer de secret.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE TABLE D'OCCURRENCES
-- ────────────────────────────────────────────────────────────────────────────
-- Une campagne récurrente produit N occurrences ; chaque occurrence vise M
-- utilisateurs ; chaque utilisateur peut avoir plusieurs appareils. Les trois
-- niveaux sont distincts, et les confondre casse l'idempotence :
--
--     campagne  ──1:N──▶  occurrence  ──1:N──▶  envoi (un par ABONNEMENT)
--
-- `unique (campaign_id, scheduled_for)` empêche deux occurrences pour la même
-- échéance — c'est ce qui rend deux passages du planificateur inoffensifs.
-- `unique (occurrence_id, subscription_id)` empêche qu'un même appareil soit
-- servi deux fois pour la même occurrence, tout en laissant l'iPhone ET
-- l'ordinateur du même élève recevoir chacun le sien.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. LES APPAREILS ABONNÉS
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- L'URL du service push (Apple, Google, Mozilla…). Elle identifie
  -- l'APPAREIL, pas le compte : un même endpoint qui se réabonne après un
  -- changement de compte doit être rattaché au nouveau, jamais dupliqué.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  -- Renseigné quand le service push répond 404/410 : l'abonnement est mort.
  -- On désactive au lieu de supprimer, pour que l'historique d'envoi garde
  -- une référence lisible.
  disabled_at timestamptz,
  disabled_reason text
);

comment on table public.push_subscriptions is
  'Appareils autorisés à recevoir une notification Web Push. Un utilisateur peut en avoir plusieurs.';

create index if not exists push_subscriptions_user_actives_idx
  on public.push_subscriptions (user_id)
  where disabled_at is null;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. LES CAMPAGNES
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.notification_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 80),
  body text not null check (length(btrim(body)) between 1 and 300),

  -- DESTINATION INTERNE UNIQUEMENT.
  -- Le coach ne saisit jamais d'URL : l'interface propose une liste. La
  -- contrainte le garantit côté base, donc même une insertion directe ne peut
  -- pas faire pointer une notification vers l'extérieur.
  destination text not null default '/dashboard'
    check (destination ~ '^/(dashboard|entrainement|nutrition|documents|profil|progression|rendez-vous)$'
        or destination ~ '^/entrainement/seance/[0-9a-fA-F-]{36}$'),

  target_kind text not null check (target_kind in ('all', 'students')),

  schedule_kind text not null check (schedule_kind in ('now', 'once', 'recurring')),
  -- Le fuseau de la RÈGLE, pas du serveur. « 08:00 » veut dire 08:00 ICI.
  timezone text not null default 'Europe/Paris',
  -- {freq: daily|weekly|monthly, weekdays: [1..7], hour: 0..23, minute: 0..59}
  -- La règle est stockée en heure LOCALE et `next_run_at` recalculé après
  -- chaque occurrence : 08:00 reste 08:00 de part et d'autre du changement
  -- d'heure.
  recurrence jsonb,
  next_run_at timestamptz,

  active boolean not null default true,
  status text not null default 'programmee'
    check (status in ('programmee', 'envoyee', 'partielle', 'echouee', 'annulee')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Une récurrence sans règle, ou une règle sans récurrence, n'a pas de sens.
  constraint notification_campaigns_recurrence_coherente check (
    (schedule_kind = 'recurring' and recurrence is not null)
    or (schedule_kind <> 'recurring' and recurrence is null)
  ),
  -- Une campagne programmée sans échéance ne partirait jamais.
  constraint notification_campaigns_echeance_coherente check (
    schedule_kind = 'now' or next_run_at is not null
  )
);

comment on table public.notification_campaigns is
  'Message + cible + programmation. Une campagne « now » produit une occurrence unique.';

-- L'index que le planificateur interroge à chaque passage.
create index if not exists notification_campaigns_a_traiter_idx
  on public.notification_campaigns (next_run_at)
  where active and next_run_at is not null;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. LES DESTINATAIRES EXPLICITES
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.notification_campaign_targets (
  campaign_id uuid not null references public.notification_campaigns (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  primary key (campaign_id, student_id)
);

comment on table public.notification_campaign_targets is
  'Élèves visés quand target_kind = students. Vide pour target_kind = all.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. LES OCCURRENCES
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.notification_occurrences (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.notification_campaigns (id) on delete cascade,
  -- L'échéance VISÉE, pas l'instant du traitement. C'est elle qui identifie
  -- l'occurrence, donc elle qui rend le planificateur idempotent.
  scheduled_for timestamptz not null,
  status text not null default 'en_attente'
    check (status in ('en_attente', 'en_cours', 'envoyee', 'partielle', 'echouee')),
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, scheduled_for)
);

comment on table public.notification_occurrences is
  'Une échéance d''une campagne. unique(campaign_id, scheduled_for) : deux passages du planificateur ne peuvent pas la dédoubler.';

create index if not exists notification_occurrences_a_traiter_idx
  on public.notification_occurrences (status, scheduled_for);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. LES ENVOIS, UN PAR APPAREIL
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.notification_occurrences (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  status text not null default 'en_attente'
    check (status in ('en_attente', 'en_cours', 'envoyee', 'echouee', 'interrompue')),
  error_code text,
  attempted_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  -- Le même appareil n'est jamais servi deux fois pour la même occurrence ;
  -- deux appareils du même élève le sont chacun une fois.
  unique (occurrence_id, subscription_id)
);

comment on table public.notification_deliveries is
  'Résultat d''envoi, un par abonnement. Aucun secret d''abonnement n''y est recopié.';

create index if not exists notification_deliveries_occurrence_idx
  on public.notification_deliveries (occurrence_id, status);

-- ============================================================================
-- RLS — RIEN N'EST LISIBLE PAR DÉFAUT
-- ============================================================================
alter table public.push_subscriptions enable row level security;
alter table public.notification_campaigns enable row level security;
alter table public.notification_campaign_targets enable row level security;
alter table public.notification_occurrences enable row level security;
alter table public.notification_deliveries enable row level security;

-- ── Abonnements ────────────────────────────────────────────────────────────
-- L'élève peut CRÉER et SUPPRIMER son propre abonnement — c'est le geste
-- « activer / désactiver les notifications ». Il ne peut PAS le lire : les
-- clés de chiffrement n'ont aucune raison de revenir dans un navigateur, et
-- un compte compromis ne doit pas pouvoir énumérer les appareils.
drop policy if exists push_subscriptions_insert_self on public.push_subscriptions;
create policy push_subscriptions_insert_self on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete_self on public.push_subscriptions;
create policy push_subscriptions_delete_self on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- Le staff consulte, pour savoir qui est joignable. Jamais l'élève.
drop policy if exists push_subscriptions_select_staff on public.push_subscriptions;
create policy push_subscriptions_select_staff on public.push_subscriptions
  for select to authenticated using (public.is_coach_or_admin());

-- ── Campagnes, cibles, occurrences, envois : staff uniquement ─────────────
drop policy if exists notification_campaigns_staff on public.notification_campaigns;
create policy notification_campaigns_staff on public.notification_campaigns
  for all to authenticated using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

drop policy if exists notification_campaign_targets_staff on public.notification_campaign_targets;
create policy notification_campaign_targets_staff on public.notification_campaign_targets
  for all to authenticated using (public.is_coach_or_admin()) with check (public.is_coach_or_admin());

-- Occurrences et envois sont écrits par le planificateur (service role, qui
-- contourne RLS). Le staff les LIT seulement : l'historique ne se réécrit pas.
drop policy if exists notification_occurrences_select_staff on public.notification_occurrences;
create policy notification_occurrences_select_staff on public.notification_occurrences
  for select to authenticated using (public.is_coach_or_admin());

drop policy if exists notification_deliveries_select_staff on public.notification_deliveries;
create policy notification_deliveries_select_staff on public.notification_deliveries
  for select to authenticated using (public.is_coach_or_admin());

-- ============================================================================
-- AUCUN DROIT POUR anon
-- ============================================================================
revoke all on public.push_subscriptions from anon;
revoke all on public.notification_campaigns from anon;
revoke all on public.notification_campaign_targets from anon;
revoke all on public.notification_occurrences from anon;
revoke all on public.notification_deliveries from anon;
