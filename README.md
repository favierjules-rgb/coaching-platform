# coaching-platform

Gestion de mon site internet — plateforme de coaching sportif premium (Seth — Préparation Physique).

Projet [Next.js](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS v4.

## État actuel

Site public + espace élève + espace admin fonctionnels, entièrement en **mock/localStorage** (aucune donnée ne quitte le navigateur). La configuration Supabase (clients, schéma SQL) est présente dans le repo mais **pas encore branchée** aux pages — voir [Connexion Supabase](#connexion-supabase) ci-dessous.
Pas encore développés : authentification réelle, Stripe, migration effective des pages vers Supabase.

## Démarrer en local

```bash
npm install
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000). Fonctionne sans aucune configuration Supabase : toutes les données restent en localStorage tant que les variables d'environnement Supabase ne sont pas renseignées.

## Structure

```
app/              # Routes App Router (pages publiques, espace élève, espace admin)
components/       # Composants React (layout, sections publiques, ui, student/, admin/, shared/)
data/             # Données mockées (data/student.ts, data/admin.ts)
hooks/            # Hooks localStorage (useStudentProfile, useAdminData)
lib/              # Logique métier (calculs, formatage, helpers) + lib/supabase/
supabase/         # Schéma SQL Supabase (supabase/schema.sql)
types/            # Types TypeScript partagés (types/index.ts, types/supabase.ts)
```

## Connexion Supabase

Cette étape ajoute la configuration Supabase (clients, types de base, schéma SQL) **sans encore remplacer le mock/localStorage**. Aucune page n'est branchée dessus pour l'instant — c'est la prochaine étape.

### 1. Créer le projet Supabase

1. Créer un compte sur [supabase.com](https://supabase.com) puis un nouveau projet.
2. Dans le dashboard du projet, aller dans **Project Settings > API** pour récupérer :
   - **Project URL**
   - **anon / public key**
   - **service_role key** (⚠️ secrète — ne jamais l'exposer côté navigateur)

### 2. Variables d'environnement

Créer un fichier `.env.local` à la racine du projet (déjà ignoré par git) :

```bash
# Client navigateur (exposées publiquement, uniquement la clé anon)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Client serveur "admin" (service role) — lib/supabase/admin.ts uniquement,
# jamais utilisé côté navigateur. Optionnelle tant que l'admin Supabase
# n'est pas utilisé.
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Sans ces variables, l'application continue de fonctionner normalement en mock/localStorage (un warning s'affiche dans la console en développement, jamais en production, jamais d'erreur bloquante — voir `lib/supabase/env.ts`).

### 3. Exécuter le schéma SQL

1. Dans le dashboard Supabase, ouvrir **SQL Editor**.
2. Coller le contenu de [`supabase/schema.sql`](./supabase/schema.sql) et l'exécuter.
3. Ce script crée les 25 tables (profils, élèves, mensurations, paiements, programmes, nutrition, documents, retours d'entraînement...), active Row Level Security avec des policies de base (un élève lit ses propres données, un coach/admin lit et gère tout), et crée les 3 buckets Storage (`progress-photos`, `documents`, `videos`).
4. Il est idempotent (`create table if not exists`, `on conflict do nothing`) : il peut être ré-exécuté sans dupliquer les données de référence.

### 4. Clients Supabase disponibles

- `lib/supabase/browser.ts` → `createSupabaseBrowserClient()` — Client Components, utilise la clé anon.
- `lib/supabase/server.ts` → `createSupabaseServerClient()` — Server Components / Route Handlers, lit la session via les cookies (`next/headers`).
- `lib/supabase/admin.ts` → `createSupabaseAdminClient()` — service role, **serveur uniquement** (le fichier importe `server-only`, qui fait échouer le build s'il est importé depuis un Client Component). Contourne RLS : à réserver aux tâches de confiance, jamais pour répondre directement à une requête élève sans revérifier les droits.

Les trois renvoient `null` si Supabase n'est pas configuré — toujours vérifier la valeur avant de l'utiliser.

### 5. Régénérer les types après le schéma

Une fois le schéma appliqué, régénérer `types/supabase.ts` avec le [CLI Supabase](https://supabase.com/docs/guides/api/rest/generating-types) :

```bash
npx supabase gen types typescript --project-id <project-id> > types/supabase.ts
```

### Prochaine étape

Brancher progressivement chaque page mock sur ces tables, une section à la fois (en commençant probablement par `/profil` et `/admin/eleves`), en gardant le fallback localStorage tant que la migration d'une section n'est pas terminée et vérifiée.
