# Paiements / abonnements Stripe

Chantier "supabase-stripe-payments-subscriptions" : Stripe Checkout (mode
subscription) + Stripe Customer Portal, statut d'abonnement/paiement visible
admin et élève, source de vérité = webhook Stripe.

## Audit — 4 tables nouvelles, aucune réutilisée par erreur

**Repo** : aucune trace de Stripe/checkout/billing/subscription/webhook
avant ce chantier (`stripe` absent de `package.json`).

**Supabase réel** : une table `payments` existait déjà (section 8 de
`supabase/schema.sql`), mais c'est la fiche paiement saisie **manuellement**
par le coach (`StudentPaymentProfile` — offre, méthode virement/carte/
espèces/chèque, échéancier, une seule ligne par élève via `student_id ...
unique`). Ce n'est pas un journal de transactions Stripe : forme différente
(aucune colonne `stripe_*`), cardinalité différente (une ligne par élève vs
une ligne par transaction), alimentée différemment (formulaire admin vs
webhook). La réutiliser aurait cassé la section "Paiement" existante de
`/admin/eleves/[studentId]` (`PaymentSection`). Elle est **laissée
totalement intacte** ; la table de transactions Stripe s'appelle
`stripe_payments` pour éviter toute confusion de nom.

Aucune des 4 tables suivantes n'existait avant ce chantier : `billing_customers`,
`subscriptions`, `stripe_payments`, `billing_events`. Toutes créées via
`create table if not exists` (rejouable sans erreur).

## Schéma

```sql
billing_customers (student_id unique, stripe_customer_id unique, email)
subscriptions (student_id, stripe_customer_id, stripe_subscription_id unique,
                stripe_price_id, stripe_product_id, plan_name, status,
                current_period_start/end, cancel_at_period_end, cancelled_at,
                amount_cents, currency)
stripe_payments (student_id, stripe_customer_id, stripe_payment_intent_id,
                  stripe_invoice_id, stripe_subscription_id, amount_cents,
                  currency, status, paid_at)
billing_events (stripe_event_id unique, event_type, payload jsonb, processed_at)
```

`student_id` référence toujours `students(id)` (jamais `profiles.id` ni
`auth.users.id`), conformément à la convention déjà en place sur tout le
reste du schéma.

`subscriptions.status` reste la valeur **Stripe brute** (`active`,
`past_due`, `canceled`, `trialing`, `incomplete`, `incomplete_expired`,
`unpaid`, `paused`) — jamais stockée traduite. La traduction vers le statut
élève demandé (actif / en attente / paiement échoué / annulé / expiré / sans
abonnement) se fait à l'affichage, voir `lib/stripe/status.ts::toStudentBillingStatus`.

## Sécurité / RLS

Aucune policy existante modifiée. Sur les 4 nouvelles tables :

- **Staff** (`is_coach_or_admin()`) : `for all` — lecture du statut billing
  de tous les élèves, résumé paiement.
- **Élève** : `for select` uniquement, limité à `student_id =
  current_student_id()`. **Aucune policy d'insert/update/delete pour
  l'élève** — un élève ne peut jamais modifier son statut d'abonnement
  depuis le frontend, quelle que soit la route empruntée.
- `billing_events` : staff uniquement, aucun accès élève (journal interne).

Toutes les écritures réelles (création/mise à jour de `billing_customers`/
`subscriptions`/`stripe_payments`) passent par les routes API
`/api/stripe/*`, exécutées côté serveur avec le client **service role**
(`lib/supabase/admin.ts`, contourne RLS) — légitime ici car :
- pour `create-checkout-session`/`create-customer-portal-session` : les
  droits de l'appelant (élève sur son propre `student_id` uniquement, staff
  sur n'importe lequel) sont vérifiés manuellement avant tout accès service
  role (comparaison avec `getCurrentStudentId()` résolu depuis la session) ;
- pour `webhook` : l'appelant est Stripe lui-même, après vérification de
  signature (`STRIPE_WEBHOOK_SECRET`), jamais un utilisateur du site.

## Routes API

- `POST /api/stripe/create-checkout-session` — `{ studentId, planKey }` →
  `{ url }`. Mode `subscription`, réutilise le `stripe_customer_id`
  existant si connu (sinon Stripe crée le customer via `customer_email`),
  `client_reference_id` + `metadata.student_id/email/plan_name` sur la
  session **et** sur la subscription créée (`subscription_data.metadata`),
  `success_url = APP_URL/dashboard?payment=success`,
  `cancel_url = APP_URL/profil?payment=cancelled`.
- `POST /api/stripe/create-customer-portal-session` — `{ studentId }` →
  `{ url }`. 404 explicite si l'élève n'a pas encore de `billing_customers`
  (jamais passé par Checkout).
- `POST /api/stripe/webhook` — vérifie la signature
  (`stripe.webhooks.constructEvent`, corps brut jamais parsé avant), déduplique
  via `billing_events.stripe_event_id` (un évènement déjà traité renvoie 200
  immédiatement), gère `checkout.session.completed`,
  `customer.subscription.created/updated/deleted`,
  `invoice.payment_succeeded`, `invoice.payment_failed`. Toute erreur de
  traitement renvoie 500 (Stripe retentera), une signature invalide renvoie
  400.

Les deux premières routes rejettent (403) un élève tentant d'agir pour un
`studentId` autre que le sien ; un rôle `admin`/`coach` peut agir pour
n'importe quel élève ; un appelant non authentifié reçoit 401.

## Formules (plans)

`lib/stripe/plans.ts` (client-safe, aucun price_id) définit 3 clés :

| Clé | Libellé affiché | Variable d'env du price_id |
|---|---|---|
| `basic` | Coaching mensuel | `STRIPE_PRICE_COACHING_BASIC` |
| `premium` | Coaching premium | `STRIPE_PRICE_COACHING_PREMIUM` |
| `distanciel` | Coaching distanciel | `STRIPE_PRICE_COACHING_DISTANCIEL` |

`lib/stripe/plans-server.ts` (serveur uniquement) résout le vrai `price_id`
depuis `process.env` au moment de créer la session Checkout — **aucun
price_id en dur dans le code**. Une formule dont la variable d'env n'est pas
renseignée est simplement absente de `getAvailablePlans()` (la création de
checkout échoue proprement avec un message explicite plutôt que de planter).

## À faire manuellement dans le dashboard Stripe

1. Créer 3 produits : **Coaching mensuel**, **Coaching premium**, **Coaching
   distanciel**.
2. Pour chacun, créer un prix récurrent (mensuel), montant libre — ce
   chantier ne suppose aucun montant précis, tout est piloté par les price_id
   en variable d'environnement.
3. Copier les 3 `price_id` (`price_...`) dans `STRIPE_PRICE_COACHING_BASIC`
   / `STRIPE_PRICE_COACHING_PREMIUM` / `STRIPE_PRICE_COACHING_DISTANCIEL`.
4. Récupérer la clé secrète (`sk_...`) → `STRIPE_SECRET_KEY`, et la clé
   publique (`pk_...`) → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (non utilisée
   par le code actuel — Checkout/Portal redirigent côté serveur, aucun
   Stripe.js chargé côté client en V1 — mais gardée en variable pour une
   future évolution embarquée).
5. Activer le **Customer Portal** (Settings > Billing > Customer portal) et
   au minimum autoriser l'annulation d'abonnement.
6. Créer un endpoint webhook pointant vers
   `https://<votre-domaine>/api/stripe/webhook`, avec au minimum les 6
   évènements listés ci-dessus. Copier le "Signing secret" (`whsec_...`)
   dans `STRIPE_WEBHOOK_SECRET`.
7. Renseigner `NEXT_PUBLIC_APP_URL` (ex: `https://votredomaine.fr`).
8. Rejouer `supabase/schema.sql` sur le projet Supabase (4 nouvelles
   tables + policies).

## Pages modifiées

- `/profil` (élève) : nouvelle section "Mon abonnement"
  (`components/student/SubscriptionSection.tsx`), visible uniquement pour
  un compte élève Supabase réel (`useSupabase`). Bannière de retour Checkout
  (`?payment=cancelled`) via `components/shared/PaymentStatusBanner.tsx`.
- `/dashboard` (élève) : même bannière pour `?payment=success`.
- `/admin/eleves/[studentId]` : nouvelle section "Paiement / abonnement
  (Stripe)" (`components/admin/StudentBillingSection.tsx`), sous la section
  "Paiement" manuelle existante (inchangée), visible uniquement pour un
  élève Supabase réel.
- `/admin/paiements` (nouveau, lien "Paiements" dans le menu admin) : liste
  de tous les élèves avec statut/formule/montant/échéance/dernier paiement,
  filtres (tous/actifs/en retard/annulés/sans abonnement), recherche,
  boutons "Créer lien de paiement"/"Portail"/"Stripe".
- `/admin` (dashboard) : 3 nouvelles tuiles (abonnements actifs, paiements
  en retard, revenu mensuel estimé), sous les tuiles existantes — grille
  séparée, aucune tuile existante déplacée.

## Activité

Chaque webhook pertinent journalise un `activity_event` best-effort :
`payment_succeeded`, `payment_failed`, `subscription_cancelled` (icônes
ajoutées dans `ActivityFeed`).

## Limites

- **Vérification live non effectuée** : aucune clé Stripe réelle
  disponible dans cet environnement. `npm run lint`, `npx tsc --noEmit` et
  `npm run build` passent sans erreur ; comportement de garde vérifié en
  conditions réelles (serveur de prod démarré) :
  - `/admin/paiements` et `/profil` redirigent vers `/connexion` (307) pour
    une requête non authentifiée, comme les autres pages privées ;
  - `POST /api/stripe/create-checkout-session` et
    `create-customer-portal-session` renvoient 401 sans session ;
  - `POST /api/stripe/webhook` renvoie 503 tant que `STRIPE_SECRET_KEY`/
    `STRIPE_WEBHOOK_SECRET` ne sont pas configurées.

  Aucun test de checkout réel, aucune simulation d'évènement webhook (Stripe
  CLI), aucune vérification d'écriture Supabase par le webhook n'a pu être
  effectuée — à faire manuellement une fois les clés Stripe et le schéma
  appliqués (voir liste "À faire manuellement" ci-dessus).
- **Revenu mensuel estimé** : somme naïve de `amount_cents` des abonnements
  actifs. Ne distingue pas un éventuel abonnement facturé annuellement (non
  prévu par les 3 formules définies, mais si un tel prix était ajouté un
  jour, ce chiffre le compterait comme mensuel) — approximation assumée pour
  une V1 "si simple" comme demandé.
- **Résolution de champs de facture Stripe** (`lib/stripe/invoice-helpers.ts`)
  gérée défensivement pour couvrir à la fois l'ancien emplacement
  (`invoice.subscription`/`invoice.payment_intent`) et le nouveau
  (`invoice.parent.subscription_details.subscription`) selon la version
  d'API du compte Stripe réel — non testé contre un vrai webhook.
- Le portail client Stripe n'est accessible que si l'élève a déjà un
  `billing_customers` (donc déjà passé par Checkout au moins une fois) —
  comportement volontaire, pas de création de customer "à vide".
