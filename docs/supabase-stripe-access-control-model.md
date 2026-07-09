# Accès conditionnel au site selon le paiement Stripe

Chantier "supabase-stripe-access-control" : bloque l'accès élève aux
programmes (entraînement), documents et nutrition (+ progression) tant
qu'aucun abonnement Stripe actif n'existe, sauf dérogation manuelle du
coach. S'appuie entièrement sur le chantier précédent
"supabase-stripe-payments-subscriptions" (voir
`docs/supabase-stripe-payments-subscriptions-model.md`) — mêmes tables,
mêmes routes API, aucune duplication.

## Modèle de données — additif sur `student_profiles`

Aucune nouvelle table. 6 colonnes ajoutées sur `student_profiles`
(proposition de l'utilisateur — table déjà porteuse d'autres réglages
élève) :

```sql
billing_access_mode text not null default 'subscription_required'
  check (billing_access_mode in ('subscription_required', 'manual_allowed', 'manual_blocked'))
assigned_stripe_plan text
assigned_stripe_price_id text
access_note text not null default ''
access_updated_at timestamptz
access_updated_by uuid references public.coaches (id) on delete set null
```

- `subscription_required` (défaut) : accès dérivé de `subscriptions.status`.
- `manual_allowed` : accès autorisé même sans abonnement (élèves offerts,
  tests, anciens élèves, paiement hors Stripe, dérogation temporaire).
- `manual_blocked` : accès bloqué même avec un abonnement par ailleurs
  actif (suspension).

## Sécurité : colonne protégée par trigger, pas seulement par RLS

`student_profiles` a déjà une policy `student_profiles_manage_self_or_staff`
en `for all` qui laisse l'élève modifier **sa propre ligne** (utilisée pour
l'auto-édition de ses préférences/objectifs). Row Level Security Postgres
ne permet pas de restreindre l'écriture à certaines colonnes seulement
(uniquement ligne entière) — réutiliser cette policy telle quelle aurait
permis à un élève de passer lui-même `billing_access_mode` à
`manual_allowed` depuis son propre navigateur, ce qui aurait annulé tout
le chantier.

Solution : un trigger `protect_access_columns` (fonction
`protect_student_profiles_access_columns()`, `security definer`) s'exécute
avant chaque `update` sur `student_profiles` et **annule silencieusement**
toute modification des 6 colonnes d'accès si l'appelant n'est pas
coach/admin (`is_coach_or_admin()` = faux) — en revertant `new.*` à
`old.*` pour ces colonnes précises, sans toucher au reste de la ligne (les
préférences de l'élève restent modifiables normalement). C'est la seule
modification de sécurité de ce chantier ; aucune policy existante n'est
supprimée ni affaiblie.

Les écritures admin passent par le navigateur du coach connecté (RLS +
trigger autorisent car `is_coach_or_admin()` = vrai) — pas besoin du
client service role ici, contrairement au webhook Stripe.

## Calcul de l'accès — jamais stocké, toujours recalculé

`lib/stripe/access-status.ts::computeStudentAccess(accessMode, subscriptionStatus)`
est une fonction **pure** (aucun accès réseau) :

```
manual_blocked            -> refusé
manual_allowed             -> autorisé
subscription_required :
  status "active"/"trialing"          -> autorisé
  aucun abonnement                     -> refusé (no_subscription)
  "incomplete"/"incomplete_expired"/
  "past_due"/"canceled"/"unpaid"/
  "paused"                             -> refusé (raison précise)
```

`lib/supabase/student-access.ts::getStudentAccessStatus(supabase, studentId)`
lit `student_profiles.billing_access_mode` + l'abonnement le plus récent
(`lib/supabase/billing.ts::getSubscriptionForStudent`) et appelle
`computeStudentAccess` — **recalculé à chaque appel**, jamais mis en cache
ni stocké comme booléen persistant. Un grep du repo confirme qu'aucun champ
`allowed`/équivalent n'est jamais écrit en base (`lib/supabase/guards.ts:110`
est la seule occurrence de `.allowed`, en lecture). Conséquence directe :
dès que le webhook Stripe met à jour `subscriptions.status` (chantier
précédent, inchangé ici), le prochain calcul d'accès reflète immédiatement
le nouveau statut — aucune synchronisation supplémentaire nécessaire.

`computeStudentAccess` vit dans `lib/stripe/access-status.ts` (pas dans
`lib/supabase/student-access.ts` ni `lib/supabase/billing.ts`) précisément
pour éviter un import circulaire : `billing.ts` en a besoin pour
`/admin/paiements` (accès de chaque élève dans la liste), et
`student-access.ts` en a besoin pour le calcul individuel — les deux
importent la même fonction pure plutôt que l'un dépendant de l'autre.

## Guard serveur — `requireActiveStudentAccess`

`lib/supabase/guards.ts::requireActiveStudentAccess()` (même famille que
`requireAuth`/`requireStudent` déjà en place) :
- Un coach/admin en prévisualisation n'est **jamais** bloqué (même logique
  que `requireStudent`).
- Un élève sans fiche `students` n'a rien à vérifier ici.
- Sinon, résout l'élève connecté (jamais un id passé en paramètre) et
  redirige vers `/acces-limite` si `getStudentAccessStatus(...).allowed`
  est faux.

Appliqué via 4 nouveaux `layout.tsx` imbriqués (pas dans le layout partagé
`app/(student)/layout.tsx`, qui couvre aussi `/dashboard`, `/profil`,
`/rendez-vous` — volontairement non bloqués) :

```
app/(student)/entrainement/layout.tsx
app/(student)/nutrition/layout.tsx
app/(student)/documents/layout.tsx
app/(student)/progression/layout.tsx
```

Chaque layout ne fait qu'appeler le guard puis rendre ses enfants — les
routes dynamiques imbriquées (`/entrainement/[programId]`,
`/entrainement/seance/[sessionId]`, `/nutrition/[planId]`,
`/documents/[documentId]`) sont protégées automatiquement (héritage de
layout Next.js App Router), sans y toucher individuellement. C'est une
vraie protection serveur — un accès direct à l'URL, contournant le menu,
est intercepté avant tout rendu de la page (vérifié en conditions réelles,
voir Tests ci-dessous), pas seulement un lien masqué côté client.

**Progression incluse dans le blocage** (la consigne la laissait
optionnelle — "éventuellement... si elle contient des documents/photos/
coaching privé") : décision prise d'inclure, la page /progression donnant
accès aux photos de progression et au suivi coaching privé, cohérent avec
l'esprit "contenu payant" du reste de la liste. `/rendez-vous` n'est en
revanche pas bloqué (jamais demandé, réservation d'un appel jugée
distincte du contenu de coaching lui-même).

## Page `/acces-limite`

Atteinte uniquement par redirection serveur (jamais liée dans un menu).
Contenu exact demandé : titre "Accès temporairement limité", message
"Votre accès aux programmes, documents et plans nutritionnels sera activé
après validation de votre abonnement.", bouton "Régler mon abonnement"
(paiement direct pour la formule attribuée si `assigned_stripe_plan` est
renseigné, sinon sélecteur de formule — `CreateCheckoutLinkModal`
réutilisé), bouton secondaire "Retour à mon profil". Ajoutée aux
`PRIVATE_PREFIXES` de `SiteChrome.tsx` (pas de header/footer public).

## UX élève

- **Menu** (`components/student/StudentSidebar.tsx`) : cadenas (icône
  ambre) sur Entraînement/Nutrition/Documents/Progression quand l'accès est
  refusé — onglets **jamais masqués** (préférence explicite de
  l'utilisateur), toujours cliquables (le clic mène bien à la page, le
  guard redirige si besoin).
- **`/profil`** (`components/student/SubscriptionSection.tsx`) : ajout
  d'un badge "Accès au site autorisé/bloqué" + raison précise, et de la
  formule attribuée si aucun abonnement actif ne porte déjà un nom de
  formule.

## UI admin

- **Fiche élève** (`components/admin/StudentAccessSection.tsx`, sous la
  section Stripe existante) : statut + raison, sélecteur de mode d'accès,
  sélecteur de formule attribuée, note interne, bouton "Créer lien de
  paiement pour cette formule" (pré-sélectionne la formule choisie dans le
  sélecteur).
- **`/admin/paiements`** : nouvelle colonne "Accès au site" par élève
  (badge + raison), nouveau filtre Accès (tous/autorisé/bloqué) en plus du
  filtre statut d'abonnement existant (conservé, rien retiré), nouvelle
  tuile de synthèse "Accès bloqué".

## Ce qui n'a PAS changé

- Le webhook Stripe (`app/api/stripe/webhook/route.ts`) : aucune
  modification. Il continue d'écrire uniquement `billing_customers`/
  `subscriptions`/`stripe_payments`/`billing_events` — jamais
  `student_profiles`. L'accès se recalcule de lui-même au prochain appel
  de `getStudentAccessStatus`, sans action supplémentaire du webhook.
- La table `payments` (fiche manuelle du coach) et sa section admin
  existante : intactes.
- Aucune policy RLS existante supprimée ou affaiblie — uniquement le
  trigger additif décrit plus haut.

## Tests

`npm run lint`, `npx tsc --noEmit`, `npm run build` : passent tous.
Vérification runtime (serveur de prod démarré) : `/entrainement`,
`/nutrition`, `/documents`, `/progression`, `/admin/paiements` redirigent
vers `/connexion` (307) pour une requête non authentifiée, exactement
comme les autres pages protégées ; `/dashboard` et `/rendez-vous`
continuent de rediriger vers `/connexion` aussi mais ne sont **pas**
concernés par `requireActiveStudentAccess` (guard non appliqué à leur
niveau) ; `/acces-limite` répond 200 et affiche le bon contenu en accès
direct (non authentifié).

**Non vérifié en direct** (aucune session Supabase réelle disponible dans
cet environnement) : le parcours complet élève sans abonnement → redirigé
vers /acces-limite ; élève `manual_allowed` sans abonnement → accès
autorisé ; élève `active`/`trialing` → accès autorisé ; élève
`past_due`/`canceled`/`unpaid` → bloqué ; admin/coach → jamais bloqué en
prévisualisation ; création de lien de paiement pré-rempli avec la bonne
formule depuis la fiche élève ; cadenas du menu qui se met à jour après
paiement réel. La logique de calcul (`computeStudentAccess`) étant une
fonction pure entièrement déterministe par ses deux arguments, elle reste
néanmoins vérifiable par lecture directe du code sans session Supabase.
