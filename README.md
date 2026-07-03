# coaching-platform

Gestion de mon site internet — plateforme de coaching sportif premium (Seth — Préparation Physique).

Projet [Next.js](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS v4.

## État actuel

Site public + espace élève + espace admin fonctionnels, avec toutes les **données** encore en **mock/localStorage** (aucune donnée métier ne quitte le navigateur). L'**authentification** (Supabase Auth, rôles admin/coach/student, protection des routes) est en revanche réellement branchée — voir [Authentification](#authentification) ci-dessous — mais reste elle aussi optionnelle : sans configuration Supabase, l'application tourne en mode mock (accès libre, comme avant).
Pas encore développés : Stripe, migration effective des données métier (programmes, nutrition, documents, photos, paiements, retours) vers Supabase.

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

### Prochaine étape (données)

Brancher progressivement chaque page mock sur ces tables, une section à la fois (en commençant probablement par `/profil` et `/admin/eleves`), en gardant le fallback localStorage tant que la migration d'une section n'est pas terminée et vérifiée. Aucune des données métier (programmes, nutrition, documents, photos, paiements, retours) n'est encore migrée à ce stade — seule l'authentification l'est (voir ci-dessous).

## Authentification

Supabase Auth est branché pour distinguer trois rôles — `admin`, `coach`, `student` (type `UserRole`, `types/index.ts`) — avec redirections et protection de routes. **Sans configuration Supabase, tout reste en accès libre comme avant** (mode mock) : rien de ce qui suit ne bloque le développement tant que `.env.local` n'est pas renseigné.

### Pages

- **`/connexion`** — email + mot de passe, erreurs traduites en français, état de chargement. Redirige vers `/admin` (admin/coach) ou `/dashboard` (student) selon le rôle lu dans `profiles`. Si Supabase n'est pas configuré, affiche à la place deux boutons "mode test" (`Connexion mock élève` / `Connexion mock coach/admin`) qui naviguent directement sans session réelle.
- **`/inscription`** — volontairement pas un vrai formulaire : un élève ne doit jamais pouvoir s'auto-créer un compte actif sans validation du coach. Affiche juste "Demander un accès" avec un renvoi vers le coach.
- **`/acces-refuse`** — affichée quand un compte authentifié mais sans les droits nécessaires (ex : un student qui tente `/admin`) essaie d'accéder à une page protégée.

### Rôles et helpers (`lib/supabase/auth.ts`)

Server-only (Server Components/Actions uniquement) :

- `getCurrentUser()` — utilisateur Supabase Auth connecté, ou `null`.
- `getCurrentProfile()` / `getProfileByUserId(userId)` — ligne `profiles` correspondante, ou `null` si elle n'existe pas encore (ex : compte créé mais pas encore validé par le coach) — ne plante jamais.
- `getCurrentUserRole()` — `UserRole | null`.
- `isAdminOrCoach()` / `isStudent()` — booléens pratiques.

### Protection des routes (`lib/supabase/guards.ts`)

Appelées en tête de `app/admin/layout.tsx` et `app/(student)/layout.tsx` :

- `requireAuth()` — redirige vers `/connexion` si personne n'est connecté.
- `requireAdminOrCoach()` — utilisé par l'espace admin ; redirige un student (ou un compte sans profil) vers `/acces-refuse`.
- `requireStudent()` — utilisé par l'espace élève ; n'exige qu'une authentification (pas un rôle "student" strict), pour que le lien "Espace élève" du menu admin continue de fonctionner pour un coach qui prévisualise.

**Toutes ces guards deviennent des no-op tant que Supabase n'est pas configuré** (`isSupabaseConfigured()`, `lib/supabase/env.ts`) : le mode mock actuel (accès libre à tout) est intégralement préservé.

### Déconnexion

`components/auth/SignOutButton.tsx`, déjà câblé dans la sidebar élève et la sidebar admin — coupe la session Supabase (si configuré) puis redirige vers `/connexion`.

### Créer les premiers utilisateurs

Il n'y a pas encore d'inscription automatisée : les comptes se créent à la main pendant cette phase de transition.

1. Dashboard Supabase → **Authentication → Users → Add user** (ou **Invite user**) : créer un compte avec un email + mot de passe.
2. Copier son **User UID**.
3. Ajouter une ligne dans `profiles` avec ce `user_id` et le rôle voulu — voir l'exemple prêt à l'emploi dans [`supabase/seed-auth-example.sql`](./supabase/seed-auth-example.sql) :

```sql
insert into public.profiles (user_id, role, first_name, last_name, email)
values ('UUID_AUTH_USER_ICI', 'admin', 'Jules', 'Favier', 'ton-email@example.com');
```

Aucune vraie clé ni aucun vrai mot de passe ne doit être commité dans le repo — seul le `user_id` (un UUID, pas un secret) apparaît dans ce type de requête.

### Prochaine étape (auth)

Migrer les données métier (élèves, programmes...) vers Supabase en réutilisant `students.user_id` pour relier un compte `auth.users`/`profiles` à sa fiche élève complète ; envisager un `proxy.ts` (middleware) dédié si le rafraîchissement de session devient nécessaire en usage prolongé (actuellement géré au cas par cas par chaque guard via `getUser()`).
