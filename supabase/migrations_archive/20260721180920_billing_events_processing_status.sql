-- ============================================================================
-- Lot W1 — Fiabilisation de l'idempotence des webhooks Stripe (juillet 2026)
-- ============================================================================
--
-- CONTEXTE (audit lecture seule préalable) : `billing_events` ne portait
-- aucun statut de traitement. La route webhook insérait la ligne AVANT
-- d'exécuter le handler, et `processed_at` avait `default now()` : tout
-- évènement reçu était donc marqué "traité" à l'instant de sa réception,
-- que le handler réussisse, échoue ou ne s'exécute jamais.
--
-- Conséquence observée : un handler en échec renvoyait 500, Stripe
-- réessayait, mais la ligne existait déjà — la route répondait alors 200
-- "deduplicated" et le handler n'était PLUS JAMAIS rejoué. Un échec
-- transitoire (timeout Supabase, redéploiement) devenait une perte
-- définitive et silencieuse.
--
-- Le verrou déjà en place pour les achats de programmes publics
-- (`acquirePublicProgramPurchaseEventLock`, Lot E-bis) stockait ses états
-- dans des clés `_seth_*` À L'INTÉRIEUR de `payload`, faute de colonnes
-- dédiées. Cette migration crée ces colonnes pour TOUS les types
-- d'évènements et migre les états `_seth_*` existants vers elles.
--
-- ── LIGNES HISTORIQUES : règle de migration documentée ────────────────
-- On ne peut PAS savoir si les handlers des lignes antérieures ont
-- réellement réussi (aucune trace n'existait). Inventer un succès serait
-- faux ; inventer un échec provoquerait un rejeu. La règle retenue :
--
--   1. Ligne portant `payload->>'_seth_status'` (chemin programme public,
--      déjà instrumenté) : on REPREND l'état réellement enregistré.
--   2. Toute autre ligne historique : `status = 'unknown_legacy'`.
--      Cet état ne déclenche AUCUN rejeu (la route ne reprend que
--      'failed' et 'processing' expiré) et n'affirme aucune réussite.
--      Il rend simplement visible le fait que l'information n'existe pas.
--
-- Aucun payload n'est modifié : les clés `_seth_*` restent en place, en
-- lecture seule, comme trace d'origine.
--
-- Cette migration est purement additive. Aucune ligne n'est supprimée,
-- aucun évènement n'est rejoué.
-- ============================================================================

-- ── 1. Colonnes de suivi du traitement ──────────────────────────────────
alter table public.billing_events
  add column if not exists status text,
  add column if not exists processing_started_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists error_message text,
  add column if not exists attempts_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz;

-- ── 2. `processed_at` ne doit plus mentir ───────────────────────────────
-- Avant : `not null default now()` — rempli à l'insertion, donc dénué de
-- sens. Après : nullable, sans défaut, renseigné UNIQUEMENT par
-- markStripeEventProcessed après la réussite complète du handler.
alter table public.billing_events
  alter column processed_at drop default,
  alter column processed_at drop not null;

-- ── 3. Backfill des lignes historiques (règle ci-dessus) ────────────────
-- 3a. Lignes du chemin programme public : reprise de l'état réel.
update public.billing_events
   set status                = payload->>'_seth_status',
       processing_started_at = nullif(payload->>'_seth_lease_started_at', '')::timestamptz,
       failed_at             = nullif(payload->>'_seth_failed_at', '')::timestamptz,
       error_message         = nullif(payload->>'_seth_error', ''),
       attempts_count        = 1,
       last_attempt_at       = created_at,
       -- `processed_at` n'est conservé QUE si l'état enregistré prouve la réussite
       processed_at          = case when payload->>'_seth_status' = 'processed'
                                    then processed_at else null end
 where status is null
   and payload ? '_seth_status'
   and payload->>'_seth_status' in ('processing', 'processed', 'failed');

-- 3b. Toutes les autres lignes historiques : réussite INCONNUE, pas supposée.
update public.billing_events
   set status          = 'unknown_legacy',
       processed_at    = null,
       attempts_count  = 1,
       last_attempt_at = created_at
 where status is null;

-- ── 4. Contrainte de statut (posée après le backfill) ───────────────────
alter table public.billing_events
  alter column status set default 'processing',
  alter column status set not null;

alter table public.billing_events
  drop constraint if exists billing_events_status_check;
alter table public.billing_events
  add constraint billing_events_status_check
  check (status in ('processing', 'processed', 'failed', 'unknown_legacy'));

-- Cohérence : `processed_at` non nul si et seulement si status = 'processed'
alter table public.billing_events
  drop constraint if exists billing_events_processed_at_check;
alter table public.billing_events
  add constraint billing_events_processed_at_check
  check ((status = 'processed') = (processed_at is not null));

alter table public.billing_events
  drop constraint if exists billing_events_attempts_check;
alter table public.billing_events
  add constraint billing_events_attempts_check
  check (attempts_count >= 0);

-- ── 5. Index de reprise (balayage des évènements bloqués / en échec) ────
create index if not exists billing_events_status_idx
  on public.billing_events (status)
  where status in ('processing', 'failed');

create index if not exists billing_events_processing_started_idx
  on public.billing_events (processing_started_at)
  where status = 'processing';

comment on column public.billing_events.status is
  'processing | processed | failed | unknown_legacy. "unknown_legacy" = ligne antérieure au Lot W1, réussite du handler inconnue — ne déclenche aucun rejeu.';
comment on column public.billing_events.processed_at is
  'Renseigné UNIQUEMENT après la réussite complète du handler (Lot W1). Ne plus utiliser comme horodatage de réception : voir created_at.';
