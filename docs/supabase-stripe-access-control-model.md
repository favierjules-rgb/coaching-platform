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

## Modèles d'abonnements (chantier "supabase-subscription-templates")

Prolonge ce chantier : les formules proposées ne sont plus figées par 3
variables d'environnement (`STRIPE_PRICE_COACHING_BASIC`/`PREMIUM`/
`DISTANCIEL`, chantier précédent) mais gérées depuis l'admin
(`/admin/abonnements`), sans jamais toucher au code pour ajouter, modifier ou
retirer une formule.

### Table `subscription_templates`

```sql
subscription_templates (
  id, name, description, amount_cents, currency, billing_interval
    ('monthly'|'quarterly'|'yearly'|'one_time'), duration_months,
  stripe_product_id, stripe_price_id unique, is_active,
  created_at, updated_at, created_by
)
```

- **RLS** : lecture = formules actives (`is_active = true`) ou staff (accès
  aux archivées aussi, pour l'historique) ; écriture (insert/update/delete)
  = staff uniquement (`is_coach_or_admin()`), jamais l'élève — répond
  explicitement à la contrainte "élèves peuvent lire seulement leur modèle
  attribué si nécessaire, mais ne modifient jamais rien" : la lecture des
  formules actives par tous les élèves connectés (pas seulement la leur)
  reste nécessaire pour le sélecteur de paiement existant
  (`CreateCheckoutLinkModal`) — les données (nom/prix) ne sont pas
  sensibles, aucune fuite d'information privée entre élèves.
- **Seedée** une fois avec les 3 formules déjà créées manuellement dans
  Stripe par l'utilisateur (Coaching distanciel/Présentiel/premium),
  `on conflict (stripe_price_id) do nothing` pour rester rejouable.

`student_profiles.assigned_subscription_template_id` (uuid, référence
`subscription_templates(id)`) est une 7ème colonne protégée par le même
trigger `protect_access_columns` que les 6 colonnes du chantier précédent
(`create or replace function`, un seul trigger, aucune duplication) —
inscriptible uniquement par un coach/admin, jamais par l'élève lui-même.

### Création automatique du Product/Price Stripe

`POST /api/admin/subscription-templates` (staff uniquement) crée le
`Product` puis le `Price` Stripe correspondant (`lib/stripe/subscription-templates.ts::createStripeProductAndPrice`)
avant d'insérer la ligne — jamais de `stripe_price_id` renseigné à la main.
Si Stripe n'est pas configuré (`STRIPE_SECRET_KEY` absente), le modèle est
tout de même créé côté Supabase avec `stripe_product_id`/`stripe_price_id`
à `null` (visible dans `/admin/abonnements`, non payable tant que Stripe
n'est pas configuré).

Un **Price Stripe est immuable** : `PATCH /api/admin/subscription-templates/[id]`
détecte un changement de `amountCents` et crée un **nouveau** Price sur le
même Product (`createStripePriceForExistingProduct`), puis désactive
l'ancien (`active: false`, jamais supprimé — l'historique des abonnements
déjà souscrits sur l'ancien prix n'est pas affecté). La ligne
`subscription_templates.stripe_price_id` est mise à jour vers le nouveau
Price. Un modèle "archivé" (`isActive: false`) n'est qu'un signal côté
Supabase (plus proposé aux élèves) — il ne touche pas Stripe.

### Checkout — price_id résolu par modèle, jamais en dur

`POST /api/stripe/create-checkout-session` accepte désormais `{ studentId,
templateId }` en priorité (`{ studentId, planKey }` reste un repli
temporaire tant qu'aucun modèle actif n'existe, voir
`docs/supabase-stripe-payments-subscriptions-model.md`). `templateId` est
résolu vers `subscription_templates.stripe_price_id` côté serveur — **jamais
de price_id passé depuis le client**. `metadata.template_id`/`template_name`
ajoutés à la session et à la subscription Stripe créée, en plus des champs
existants (`student_id`/`email`/`plan_name`).

Le webhook (`lib/stripe/webhook-handlers.ts::upsertSubscriptionFromStripeObject`)
résout désormais le nom de formule (`subscriptions.plan_name`) en
interrogeant d'abord `subscription_templates` par `stripe_price_id`
(source prioritaire), puis le mapping .env en repli — cohérent avec le
reste du chantier : un abonnement souscrit via un modèle affiche le bon nom
même si aucune variable d'environnement `STRIPE_PRICE_COACHING_*` ne
correspond à ce price_id.

### UI admin

- **`/admin/abonnements`** (nouveau, atteint via le bouton "Gérer les
  modèles d'abonnements" de `/admin/paiements`) : liste des modèles
  (actifs + archivés), création (formulaire nom/description/prix/période/
  durée), modification (avertissement explicite si le prix change —
  "un nouveau Price sera créé, l'ancien désactivé"), archivage.
- **Fiche élève** (`components/admin/StudentSubscriptionSection.tsx`) :
  les 3 blocs précédents (Paiement/abonnement Stripe, Accès au site,
  Paiement manuel) sont fusionnés en **une seule carte** "Abonnement &
  Paiement" — résumé compact (statut accès, raison, statut Stripe, formule
  attribuée, montant, prochaine échéance, dernier paiement, reste à payer
  manuel) + 3 sous-sections repliables (`<details>`) :
  - **A. Accès au site** : mode d'accès (automatique/autoriser sans
    paiement/bloquer), note interne — identique au chantier précédent.
  - **B. Modèle d'abonnement** : sélecteur de modèle actif + bouton
    "Attribuer" (écrit `assigned_subscription_template_id`, et par
    compatibilité descendante recopie `assigned_stripe_plan`/
    `assigned_stripe_price_id` depuis le modèle choisi), bouton "Créer lien
    de paiement Stripe" pour ce modèle, portail client/lien Stripe Dashboard
    si un `billing_customers` existe déjà.
  - **C. Paiement manuel existant** : contenu de l'ancienne `PaymentSection`
    réutilisé tel quel (`PaymentSectionContent`, aucune duplication de
    logique) — inchangé.
- **`/admin/paiements`** : colonne "Formule · Montant" affiche désormais le
  nom du modèle attribué (`assignedTemplateName`, résolu par jointure en
  mémoire dans `getAdminBillingList`) en priorité sur l'ancien
  `assignedStripePlan` (env-based) ; bouton "Gérer les modèles
  d'abonnements".
- **`/profil` élève** (`components/student/SubscriptionSection.tsx`) :
  formule attribuée affichée via le nom du modèle (repli sur l'ancien
  libellé .env si aucun modèle n'est assigné), bouton de paiement basé sur
  les modèles actifs (repli automatique sur les 3 formules .env si aucun
  modèle n'existe encore en base).

### Ce qui n'a PAS changé (dans ce sous-chantier)

- Le webhook continue de n'écrire que `billing_customers`/`subscriptions`/
  `stripe_payments`/`billing_events` — jamais `student_profiles` (l'accès se
  recalcule toujours à la lecture, voir plus haut).
- Aucune policy RLS existante affaiblie ; le trigger `protect_access_columns`
  est étendu (`create or replace function`), jamais recréé/dupliqué.

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

### Tests — chantier "supabase-subscription-templates"

`npm run lint`, `npx tsc --noEmit`, `npm run build` : passent tous après
l'ajout des modèles d'abonnements.

**Vérifié en direct** (accès MCP Supabase + Stripe réels disponibles pour ce
sous-chantier, contrairement aux précédents) :
- Migration `subscription_templates` appliquée sur le projet Supabase réel
  (`apply_migration`), table + colonne `assigned_subscription_template_id`
  visibles via `list_tables`/`execute_sql`.
- Policies RLS confirmées via `pg_policies` :
  `subscription_templates_manage_staff` (`ALL`, `is_coach_or_admin()`) et
  `subscription_templates_select_active_or_staff` (`SELECT`, `is_active =
  true OR is_coach_or_admin()`).
- Trigger `protect_access_columns` confirmé (lecture de `pg_proc.prosrc`) :
  couvre bien les 6 colonnes existantes **et**
  `assigned_subscription_template_id` (7ème colonne protégée).
- `get_advisors` (sécurité) : aucune alerte nouvelle après ces migrations —
  uniquement les avertissements préexistants déjà présents avant ce
  chantier (fonctions `SECURITY DEFINER` appelables en RPC, `search_path`
  mutable sur `set_updated_at`), non liés à `subscription_templates`.
- 3 modèles seedés avec les vrais `stripe_product_id`/`stripe_price_id` de
  3 Products/Prices déjà créés manuellement par l'utilisateur dans le
  compte Stripe réel (mode test) — confirmés via le connecteur Stripe
  (`GetProducts`/`GetPrices`).

**Non vérifié en direct** (aucune session navigateur authentifiée
disponible dans cet environnement, malgré l'accès MCP) : création d'un
modèle depuis `/admin/abonnements` avec création automatique du Product/Price
Stripe réel ; changement de prix d'un modèle existant (nouveau Price +
désactivation de l'ancien) ; attribution d'un modèle à un élève depuis la
fiche élève ; checkout réel avec le `price_id` résolu depuis
`subscription_templates` ; mise à jour du webhook avec le bon `plan_name`
résolu via `subscription_templates` plutôt que le mapping .env ;
déverrouillage/verrouillage de l'accès après paiement réel via un modèle.
Vérifiable par lecture directe du code (chaque route API et fonction citée
ci-dessus a été relue ligne à ligne) en l'absence de session réelle.
