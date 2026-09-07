-- ============================================================================
-- Migration 20260922090000 — C5.1 : LA CONNEXION NOLIO D'UN ÉLÈVE.
-- (chantier feat/nolio-c5-1)
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE TABLE EST
-- ────────────────────────────────────────────────────────────────────────────
-- Un élève relie son compte Nolio à Sethcoaching par OAuth2. Cette table garde
-- le lien : QUI est-il chez Nolio, et avec quels jetons Sethcoaching peut agir
-- en son nom.
--
-- ⚠️ ELLE NE CONTIENT AUCUNE DONNÉE D'ENTRAÎNEMENT. C5.1 s'arrête à la
-- connexion ; l'import, les webhooks et l'envoi de séances sont des lots
-- ultérieurs et auront leurs propres tables.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LES JETONS SONT CHIFFRÉS, ET LE TYPE `text` NE DOIT PAS TROMPER
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ `access_token` ET `refresh_token` NE CONTIENNENT JAMAIS DE CLAIR. Ils
-- portent un chiffré AES-256-GCM produit par `lib/nolio/crypto.ts`, sous la
-- forme `v<version>.<iv>.<tag>.<chiffré>` en base64url. La base ne connaît pas
-- la clé — elle vit dans `NOLIO_TOKEN_ENCRYPTION_KEY`, côté serveur
-- uniquement. Un dump SQL, une sauvegarde, ou même une fuite de la clé
-- service-role ne rendent donc rien d'exploitable.
--
-- ⚠️ POURQUOI PAS `pgcrypto`. Il faudrait faire voyager la clé jusqu'à
-- PostgreSQL — en paramètre de requête (donc potentiellement dans les logs) ou
-- stockée à côté des données. Chiffrer applicativement garde la clé dans le
-- processus Node, au même niveau que `STRIPE_SECRET_KEY`. C'est le patron
-- déjà en place dans ce dépôt pour les 22 autres secrets serveur.
--
-- `key_version` prépare la rotation : re-chiffrer sans migration de schéma.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LES DEUX UNICITÉS SONT DES GARDE-FOUS, PAS DE LA PROPRETÉ
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ `student_id` UNIQUE : un élève, une connexion. Sans elle, deux lignes
-- concurrentes pour le même élève, et le refresh en choisirait une au hasard.
--
-- ⚠️ `nolio_user_id` UNIQUE : c'est la contrainte de SÉCURITÉ. Sans elle, deux
-- élèves Sethcoaching pourraient lier le MÊME compte Nolio — et recevraient
-- alors chacun les séances de l'autre dès le premier import. La base refuse ;
-- le code refuse aussi, en amont, avec un message lisible.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LE VERROU DE REFRESH — POURQUOI UNE COLONNE, ET NON UN VERROU POSTGRES
-- ────────────────────────────────────────────────────────────────────────────
-- Nolio ROTE le refresh_token à chaque usage et INVALIDE l'ancien. Deux
-- rafraîchissements simultanés pour le même élève présenteraient donc le même
-- jeton, et le second serait rejeté — connexion perdue.
--
-- ⚠️ UN `pg_advisory_xact_lock` NE CONVIENDRAIT PAS. Il ne tient que le temps
-- d'une transaction ; or la fenêtre à protéger inclut un aller-retour HTTP
-- vers Nolio, qui se déroule ENTRE deux requêtes SQL. Le verrou serait relâché
-- pile au mauvais moment.
--
-- D'où un BAIL horodaté : `refresh_lock_at`. On le prend par un UPDATE
-- conditionnel — atomique en PostgreSQL — et on ne réécrit les jetons que si
-- on le détient encore. Un processus mort ne bloque personne : le bail périme.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ────────────────────────────────────────────────────────────────────────────
--   - AUCUN accès en lecture pour `authenticated`. C'est la divergence
--     assumée avec `push_subscriptions`, qui accorde le `select` : ici, même
--     une policy RLS mal écrite ne peut pas laisser fuir un jeton, parce que
--     le privilège n'existe pas. L'écran lit `nolio_connexion_etat`, une vue
--     qui ne porte AUCUN jeton ;
--   - AUCUNE modification de `students` — en particulier, `students.user_id`
--     n'est pas touché (son absence d'unicité est un existant hors périmètre) ;
--   - AUCUNE autre table, AUCUNE fonction métier, AUCUN cron.
--
-- ⚠️ NE PAS exécuter en Production sans runbook validé.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. LA TABLE
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.nolio_connections (
  id uuid primary key default gen_random_uuid(),

  -- ⚠️ RATTACHÉE À `students`, PAS À `auth.users`. C'est l'élève qui possède
  -- une connexion Nolio, et `on delete cascade` garantit qu'un élève supprimé
  -- n'abandonne jamais de jetons vivants derrière lui.
  student_id uuid not null unique references public.students (id) on delete cascade,

  -- L'identifiant du compte chez Nolio : le champ `id` de GET /api/get/user/.
  -- Entier — la documentation le donne comme tel (`"id": 42`).
  nolio_user_id bigint not null unique,

  -- ⚠️ CHIFFRÉS. Voir l'en-tête. Jamais de clair ici.
  access_token text not null,
  refresh_token text not null,
  key_version smallint not null default 1,

  expires_at timestamptz not null,
  scope text,

  status text not null default 'active',
  -- Message TECHNIQUE et NON SENSIBLE. Jamais un jeton, jamais une réponse
  -- brute de Nolio : `lib/nolio/oauth.ts` n'en fait remonter que des motifs.
  last_error text,

  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  updated_at timestamptz not null default now(),

  -- Le bail de rafraîchissement. `null` = libre.
  refresh_lock_at timestamptz,

  constraint nolio_connections_status_check
    check (status in ('active', 'expired', 'revoked', 'error')),
  constraint nolio_connections_key_version_positive check (key_version >= 1),
  constraint nolio_connections_nolio_user_id_positive check (nolio_user_id > 0),
  -- ⚠️ UN JETON VIDE N'EST PAS UN JETON. Sans cette garde, un bug d'écriture
  -- produirait une connexion « active » incapable de rien faire.
  constraint nolio_connections_tokens_non_vides
    check (length(btrim(access_token)) > 0 and length(btrim(refresh_token)) > 0)
);

create index if not exists nolio_connections_student_idx
  on public.nolio_connections (student_id);

create index if not exists nolio_connections_status_idx
  on public.nolio_connections (status);

comment on table public.nolio_connections is
  'C5.1 — la connexion OAuth2 d''un élève à son compte Nolio. access_token et refresh_token sont TOUJOURS chiffrés (AES-256-GCM applicatif) ; la base ne détient pas la clé.';
comment on column public.nolio_connections.refresh_lock_at is
  'C5.1 — bail de rafraîchissement. Nolio invalide l''ancien refresh_token à chaque rotation : deux refresh simultanés perdraient la connexion.';

-- ────────────────────────────────────────────────────────────────────────────
-- B. RLS — ET AUCUN PRIVILÈGE DE LECTURE POUR L'ÉLÈVE
-- ────────────────────────────────────────────────────────────────────────────
alter table public.nolio_connections enable row level security;

-- ⚠️ SEUL L'ADMINISTRATEUR A UNE POLICY. L'élève n'en a pas besoin : il ne lit
-- jamais cette table, il lit la vue `nolio_connexion_etat`. Le coach non plus —
-- une connexion Nolio est un lien personnel entre l'élève et un service tiers.
drop policy if exists "nolio_connections_manage_admin" on public.nolio_connections;
create policy "nolio_connections_manage_admin" on public.nolio_connections
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ⚠️ AUCUN GRANT À `authenticated`, PAS MÊME `select`. L'écriture passe
-- EXCLUSIVEMENT par les route handlers `server-only` en service-role.
revoke all on table public.nolio_connections from public, anon, authenticated;
grant all on table public.nolio_connections to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- C. LA VUE D'ÉTAT — CE QUE L'ÉCRAN A LE DROIT DE SAVOIR
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ ELLE NE SÉLECTIONNE AUCUN JETON, ET C'EST TOUT SON INTÉRÊT. Même si un
-- jour quelqu'un accordait le `select` à `authenticated` sur cette vue par
-- erreur, il n'y aurait rien à y voler.
--
-- `security_invoker` : la vue s'exécute avec les droits de l'appelant, donc la
-- RLS de la table s'applique. Sans cela, la vue contournerait la RLS.
create or replace view public.nolio_connexion_etat
  with (security_invoker = true) as
  select
    c.student_id,
    c.nolio_user_id,
    c.status,
    c.connected_at,
    c.last_sync_at,
    c.updated_at
  from public.nolio_connections c;

comment on view public.nolio_connexion_etat is
  'C5.1 — l''état d''une connexion Nolio, SANS aucun jeton. C''est la seule surface que l''interface élève peut voir.';

revoke all on public.nolio_connexion_etat from public, anon, authenticated;
grant select on public.nolio_connexion_etat to service_role;
