# Emails transactionnels (Resend)

Chantier "supabase-resend-transactional-emails" : envoi automatique
d'emails transactionnels aux élèves et au coach selon les actions
importantes de l'application (bienvenue, abonnement, paiement, rendez-vous,
attribution de contenu...). Provider : [Resend](https://resend.com).
Migration Supabase additive (table `email_logs`) — aucune table/colonne
existante modifiée ou supprimée.

## 1. Créer un compte Resend et vérifier un domaine

1. Créer un compte sur [resend.com](https://resend.com).
2. **Domains > Add Domain** : ajouter le domaine d'envoi (ex :
   `votredomaine.fr`). Resend affiche 3 enregistrements DNS à créer chez
   votre registrar/hébergeur DNS :
   - **SPF** (`TXT`, autorise Resend à envoyer en votre nom) — souvent à
     fusionner avec un enregistrement SPF existant si vous en avez déjà un
     (un domaine ne doit avoir qu'un seul enregistrement `TXT` `v=spf1`).
   - **DKIM** (`TXT`, signature cryptographique des emails) — Resend fournit
     un ou plusieurs enregistrements `resend._domainkey.votredomaine.fr`.
   - **DMARC** (`TXT` sur `_dmarc.votredomaine.fr`) — recommandé même en
     politique souple au départ (`v=DMARC1; p=none; rua=mailto:...`), à
     durcir (`p=quarantine`/`p=reject`) une fois les flux vérifiés propres.
3. Attendre la vérification (quelques minutes à quelques heures selon le
   DNS) — le domaine passe en statut "Verified" dans le dashboard Resend.
4. **API Keys > Create API Key** : créer une clé (accès "Sending" suffit,
   pas besoin d'un accès complet) → `RESEND_API_KEY`.

Tant que le domaine n'est pas vérifié, Resend autorise l'envoi uniquement
depuis `onboarding@resend.dev` (adresse de test, limitée) — pratique pour
un premier test en local sans configuration DNS, mais à ne jamais utiliser
en production (délivrabilité très limitée, ne passe pas pour un vrai
domaine de marque).

## 2. Variables d'environnement

Voir `.env.example` pour la liste complète. Résumé :

| Variable | Rôle |
|---|---|
| `RESEND_API_KEY` | Clé secrète Resend, serveur uniquement (`lib/email/resend.ts`). Absente → aucun envoi réel, tout journalisé `skipped`, l'app ne plante jamais. |
| `RESEND_FROM_EMAIL` | Adresse d'expédition, doit appartenir au domaine vérifié (ex : `"SETH Préparation Physique <contact@votredomaine.fr>"`). |
| `RESEND_REPLY_TO` | Adresse "Répondre à" affichée aux destinataires (peut être différente de l'adresse d'envoi). |
| `EMAILS_ENABLED` | `"false"` coupe tout envoi réel même si `RESEND_API_KEY` est configurée (préproduction/staging) — journalisé `skipped`. Par défaut activé. |
| `NEXT_PUBLIC_APP_URL` | Déjà utilisée par Stripe — sert aussi de base pour tous les liens cliquables des emails. |
| `CRON_SECRET` | Secret partagé pour authentifier l'appel du cron des rappels de rendez-vous (voir section 8). |

**Aucune clé Resend côté client** : `lib/email/resend.ts`,
`lib/email/send-transactional-email.ts`, `lib/email/recompose.ts` et
`lib/email/templates/*` importent tous `server-only` — le build Next.js
échoue s'ils sont jamais importés depuis un Client Component.

## 3. Architecture

```
lib/email/resend.ts                  Client Resend (server-only), coupe-circuit EMAILS_ENABLED
lib/email/send-transactional-email.ts Envoi + journalisation email_logs (server-only)
lib/email/templates/base.ts          Composant HTML de base (header/contenu/bouton/footer)
lib/email/templates/index.ts         Un composeur par type d'email (server-only)
lib/email/recompose.ts               Recomposition pour le bouton admin "Renvoyer" (server-only)
lib/email/appointment-emails.ts      Déclencheurs appelés depuis du code client (PAS server-only)
lib/supabase/email-logs.ts           Lecture du journal (RLS staff uniquement)
```

`lib/email/appointment-emails.ts` est le seul fichier de `lib/email/*` qui
n'est **pas** `server-only` : `createAppointment`/`cancelAppointment`/
`rescheduleAppointment` (`lib/supabase/appointments.ts`) s'exécutent dans
le navigateur (écriture directe via RLS, comme partout ailleurs dans ce
repo) — ce fichier se contente donc de notifier
`POST /api/email/appointment-notification`, seul point où la clé Resend
est réellement utilisée pour ce flux.

### Deux clients Supabase par route `/api/email/*`

Chaque route utilise **deux** clients Supabase, jamais un seul :

1. **Client session** (`createSupabaseServerClient()`) — uniquement pour
   vérifier qui appelle (rôle, propriétaire du `studentId`...).
2. **Client service role** (`createSupabaseAdminClient()`) — pour tout le
   reste (lectures, composition, envoi, écriture dans `email_logs`).

C'est nécessaire : `email_logs` n'a **aucune** policy RLS d'insert/update,
même pour un coach/admin connecté (voir section 6) — seul le service role
peut y écrire, exactement comme le webhook Stripe.

## 4. Table `email_logs`

Additive, RLS activée :

```sql
email_logs (
  id, recipient_email, recipient_user_id, email_type, subject,
  resend_email_id, status ('pending'|'sent'|'failed'|'skipped'),
  related_entity_type, related_entity_id, error_message,
  metadata jsonb, sent_at, created_at
)
```

- **Lecture** : staff uniquement (`is_coach_or_admin()`) — un élève ne peut
  jamais lire le journal, même ses propres emails.
- **Écriture** : aucune policy pour personne — uniquement via le service
  role, depuis le serveur.

`related_entity_type`/`related_entity_id` sont une référence polymorphe
(appointment/student/student_profile/programme/nutrition/document/
stripe_invoice/subscription selon le type) — sert à l'idempotence et à la
recomposition pour le bouton "Renvoyer".

`appointment_email_logs` (chantier calendrier, jamais lu ailleurs) reste en
base sans modification mais n'est plus alimentée — remplacée par ce
journal unique.

## 5. Liste des emails

| Type (`email_type`) | Déclencheur | Destinataire(s) |
|---|---|---|
| `welcome` | Fin de l'onboarding (`OnboardingWizard`) ou déclenchement manuel admin | Élève |
| `subscription_assigned` | Bouton "Attribuer" (fiche élève admin) | Élève |
| `payment_succeeded` | Webhook `invoice.payment_succeeded` (jamais `checkout.session.completed`, voir ci-dessous) | Élève |
| `payment_failed` | Webhook `invoice.payment_failed` | Élève |
| `subscription_cancelled` | Webhook `customer.subscription.deleted` | Élève |
| `program_assigned` | Attribution d'un programme (`useContentAssignment`) | Élève |
| `nutrition_assigned` | Attribution d'un plan nutritionnel | Élève |
| `document_assigned` | Attribution d'un document | Élève |
| `appointment_created` | Réservation ou report d'un rendez-vous | Élève **et** coach |
| `appointment_cancelled` | Annulation d'un rendez-vous | Élève **et** coach |
| `appointment_reminder` | Cron 24h / 2h avant (section 8) | Élève |

### Pourquoi `invoice.payment_succeeded` et pas `checkout.session.completed`

Les deux évènements arrivent pour un premier paiement (`checkout.session.completed`
relie juste le customer Stripe à l'élève, `invoice.payment_succeeded`
confirme le paiement effectif). Envoyer l'email sur les deux doublonnerait
la confirmation. `invoice.payment_succeeded` est la seule source retenue —
c'est aussi le seul évènement qui se répète à chaque renouvellement
d'abonnement (utile pour confirmer les paiements récurrents, pas seulement
le premier).

## 6. Idempotence

- **Évènements Stripe** : `billing_events.stripe_event_id` (déjà en place,
  chantier paiements) garantit qu'un évènement Stripe n'est traité qu'une
  fois — l'email est envoyé depuis l'intérieur du handler, donc jamais
  dupliqué par un retry Stripe.
- **Attributions** (abonnement/programme/nutrition/document) et
  **rendez-vous** : `wasEmailRecentlySent()` (fenêtre de 30 secondes) —
  protège contre un double-clic/double appel réseau sans bloquer une vraie
  nouvelle attribution plus tard. Pour les programmes/documents
  (réutilisables entre élèves via une table de jonction), la clé
  d'idempotence est l'id de la ligne de jonction (`assignments.id`/
  `document_assignments.id`), jamais l'id du contenu seul — sinon attribuer
  le même programme à deux élèves proches dans le temps ferait ignorer le
  second email par erreur.
- **Bienvenue** : `wasEmailAlreadySent()` (sans fenêtre de temps) — jamais
  un deuxième email de bienvenue pour le même élève, même si l'onboarding
  est soumis plusieurs fois.
- **Rappels de rendez-vous** : un rappel 24h et un rappel 2h pour le même
  rendez-vous sont deux envois distincts (`metadata.reminderHours`), mais
  jamais renvoyés deux fois pour la même fenêtre.

## 7. Sécurité

- Aucune route `/api/email/*` n'accepte de destinataire ou de HTML depuis
  le client — chaque route ne reçoit qu'un ou deux identifiants
  (`studentId`, `appointmentId`, `contentId`...) et relit tout le reste
  (email, contenu, formule attribuée...) côté serveur.
- Chaque route vérifie les droits de l'appelant avant tout envoi (élève
  uniquement pour lui-même, admin/coach pour n'importe quel élève, cron
  protégé par `CRON_SECRET`).
- `email_logs` n'est jamais accessible en écriture directe depuis le
  frontend (voir section 4).
- Le bouton admin "Renvoyer" (`/admin/emails`) ne fonctionne que sur un
  email en statut `"failed"` — jamais sur un email déjà envoyé, ce qui
  empêche tout double envoi dangereux (double confirmation de paiement,
  double notification de rendez-vous...). Le contenu est recomposé à partir
  des données actuelles (`lib/email/recompose.ts`), jamais rejoué depuis un
  HTML stocké.

## 8. Rappels de rendez-vous (cron)

`GET /api/cron/appointment-reminders` — vérifie tous les rendez-vous à
venir et envoie un rappel aux élèves dont le rendez-vous a lieu dans ~24h
ou ~2h (tolérance de ±35 min pour absorber l'intervalle entre deux appels
du cron).

**Configuration Vercel** (`vercel.json`, déjà présent dans le repo) :

```json
{
  "crons": [
    { "path": "/api/cron/appointment-reminders", "schedule": "*/30 * * * *" }
  ]
}
```

Toutes les 30 minutes couvre les deux fenêtres (24h et 2h) sans en
manquer. **Le plan Vercel Hobby limite les cron jobs à 1 exécution par jour**
— sur Hobby, passer à un schedule quotidien (ex: `"0 8 * * *"`) et accepter
une précision de rappel plus faible, ou passer au plan Pro pour une
fréquence de 30 min. Voir [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs).

**Sécurité** : Vercel envoie automatiquement l'en-tête
`Authorization: Bearer $CRON_SECRET` pour ses propres appels de cron dès
que `CRON_SECRET` est configuré dans les variables d'environnement du
projet — la route refuse tout appel sans ce header exact (401), et refuse
même de démarrer si `CRON_SECRET` n'est pas configuré (503) plutôt que de
rester ouverte par défaut.

**Tester manuellement en local** :

```bash
curl -X GET http://localhost:3000/api/cron/appointment-reminders \
  -H "Authorization: Bearer $CRON_SECRET"
```

## 9. Tests en local

1. Renseigner `.env.local` avec au minimum `RESEND_API_KEY` (clé de test
   Resend ou clé réelle) et `RESEND_FROM_EMAIL` (peut être
   `onboarding@resend.dev` tant qu'aucun domaine n'est vérifié).
2. Sans `RESEND_API_KEY` : toutes les actions (onboarding, attribution,
   paiement, rendez-vous) doivent continuer à fonctionner normalement,
   simplement sans email réel — vérifier `email_logs` en base (`status =
   'skipped'`, `error_message = 'RESEND_API_KEY non configurée'`).
3. Avec `EMAILS_ENABLED=false` (clé présente) : même comportement,
   `error_message = 'EMAILS_ENABLED=false'`.
4. Avec une vraie clé : déclencher chaque action ci-dessus depuis l'UI et
   vérifier réception + `/admin/emails` (statut `sent`, `resend_email_id`
   renseigné).
5. Provoquer un échec volontaire (ex : couper la connexion réseau pendant
   l'appel, ou une adresse email invalide) et vérifier `status = 'failed'`
   + `error_message` explicite + bouton "Renvoyer" fonctionnel sur
   `/admin/emails`.

## 10. Configuration Vercel (déploiement)

Dans **Project Settings > Environment Variables**, renseigner (Production
et Preview séparément si utile) : `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
`RESEND_REPLY_TO`, `EMAILS_ENABLED`, `CRON_SECRET`, en plus des variables
Supabase/Stripe déjà documentées dans les autres fichiers `docs/*.md`.
`vercel.json` (cron) est déjà commité — aucune configuration
supplémentaire nécessaire côté Vercel pour l'activer, au-delà des
variables d'environnement.

## 11. Interface admin — `/admin/emails`

Liste tous les emails journalisés (le plus récent en premier), avec
filtres statut/type/recherche destinataire, et bouton "Renvoyer" pour les
emails en échec (voir section 7). Accessible depuis le menu latéral admin
("Emails").

## Limites connues / non vérifié en direct

Aucune clé Resend réelle ni domaine vérifié disponible dans cet
environnement de développement — le code a été relu ligne à ligne et le
build (`npm run build`) passe, mais aucun email réel n'a pu être envoyé ni
reçu pendant ce chantier. À vérifier manuellement une fois Resend configuré
(checklist section 9). Le cron des rappels n'a pas non plus pu être
déclenché en conditions réelles (nécessite un déploiement Vercel avec
`vercel.json` actif).
