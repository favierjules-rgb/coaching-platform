# Newsletter Brevo

Systeme de newsletter separe du systeme d'emails transactionnels (Resend).
Aucun fichier de `lib/email/*` ou `app/api/email/*` n'est touche par cette
fonctionnalite.

## 1. Vue d'ensemble

- Un visiteur s'inscrit depuis la page d'accueil (formulaire avec consentement
  explicite) ou un eleve active une preference dans son profil.
- L'inscription est stockee dans `public.newsletter_subscribers` (Supabase) et
  synchronisee avec un contact Brevo.
- Les campagnes (V1) se creent et s'envoient directement depuis Brevo, pas
  depuis l'application. `/admin/newsletter` ne sert qu'a consulter et gerer la
  liste des abonnes.
- La desinscription passe par un lien a token signe
  (`/newsletter/desinscription`) ou par le mecanisme natif de desinscription
  de Brevo dans ses propres campagnes (remonte ici via le webhook).

## 2. Variables d'environnement

A ajouter dans `.env.local` (valeurs reelles) et deja presentes en tant que
noms uniquement dans `.env.example` :

- `BREVO_API_KEY` : cle API Brevo (Settings > SMTP & API > API Keys). Ne
  jamais exposer cote client.
- `BREVO_NEWSLETTER_LIST_ID` : ID numerique de la liste Brevo dediee a la
  newsletter.
- `BREVO_WEBHOOK_SECRET` : secret partage, utilise (a) pour authentifier les
  appels webhook entrants et (b) pour signer les liens de desinscription.
- `NEWSLETTER_ENABLED` : "true"/"false". Controle l'affichage du formulaire et
  de la preference profil. Les routes API restent fonctionnelles meme si
  false.
- `NEXT_PUBLIC_APP_URL` : deja utilisee ailleurs dans le projet (Stripe, cron,
  emails).

Tant que `BREVO_API_KEY` est absente, toutes les fonctions de
`lib/brevo/client.ts` renvoient un resultat `{ skipped: true }` au lieu de
lever une erreur : l'inscription est quand meme enregistree en base avec
`status = 'pending'` et `last_sync_status = 'skipped'`.

## 3. Configuration cote Brevo

1. Liste : creer une liste "Newsletter site" dans Brevo, recuperer son ID
   numerique -> `BREVO_NEWSLETTER_LIST_ID`.
2. Double opt-in (optionnel) : ce projet enregistre le consentement explicite
   via la case a cocher du formulaire (opt-in simple, suffisant en droit
   francais/CNIL des lors que le consentement est explicite et non pre-coche).
   Si vous souhaitez en plus un double opt-in Brevo, activez l'option "double
   opt-in" sur la liste dans Brevo : aucune modification de code n'est
   necessaire.
3. Webhook : Settings > Webhooks > creer un webhook pointant vers :

   https://<votre-domaine>/api/brevo/webhook?secret=<BREVO_WEBHOOK_SECRET>

   Evenements a cocher : unsubscribe, hardBounce, spam/complaint, delivered
   (optionnel). Brevo ne signe pas ses webhooks avec un HMAC par defaut ; le
   secret en query string est le mecanisme d'authentification recommande et
   utilise ici.

## 4. Consentement et RGPD/CNIL

- Case a cocher jamais pre-cochee, texte exact affiche sur le formulaire :
  "J'accepte de recevoir par email les conseils, actualites et offres de SETH
  Preparation Physique. Je peux me desinscrire a tout moment."
- `consent_at` et `consent_text_version` sont enregistres a chaque
  (re)inscription et ne sont jamais supprimes, y compris apres desinscription.
- Aucune inscription automatique : creer un compte eleve n'inscrit jamais a la
  newsletter. L'eleve doit explicitement activer la preference dans /profil.
- RLS sur newsletter_subscribers : lecture/ecriture reservees aux roles
  admin/coach via public.is_coach_or_admin(). Aucune policy d'insertion
  n'existe pour anon/authenticated : la seule voie d'ecriture publique est la
  route serveur POST /api/newsletter/subscribe (client service_role, qui
  contourne RLS intentionnellement).

## 5. Desinscription

- /newsletter/desinscription?token=... : le token est un HMAC signe (voir
  lib/newsletter/tokens.ts), jamais un email en clair dans l'URL.
- Le secret de signature reutilise BREVO_WEBHOOK_SECRET plutot que d'introduire
  une 6e variable d'environnement dediee.
- Pour les campagnes envoyees directement depuis Brevo (V1), le mecanisme de
  desinscription principal est celui, natif, de Brevo : l'evenement
  unsubscribe recu sur le webhook met alors a jour notre base.
- Le lien a token signe sert de canal secondaire (support, admin, etc).
- Dans tous les cas : le contact est supprime cote Brevo, mais la ligne
  newsletter_subscribers et son historique de consentement sont conserves.

## 6. Fichiers ajoutes

- lib/brevo/client.ts : wrapper HTTP minimal pour l'API Contacts de Brevo.
- lib/newsletter/validation.ts, rate-limit.ts, tokens.ts, db.ts.
- app/api/newsletter/subscribe, unsubscribe, preference.
- app/api/brevo/webhook.
- app/api/admin/newsletter/resync.
- app/newsletter/desinscription (page + UnsubscribeForm).
- app/admin/newsletter (page + composants/admin/NewsletterAdminTable.tsx).
- components/marketing/NewsletterSignupForm.tsx.
- components/student/NewsletterPreferenceToggle.tsx.

## 7. Types TypeScript

types/supabase.ts est un fichier de types maintenu a la main (voir son
en-tete), pas une sortie brute de `supabase gen types typescript`. Pour ne pas
risquer une regression sur ce fichier partage, lib/newsletter/db.ts declare son
propre type NewsletterSubscriberRow (qui reflete exactement la migration SQL)
plutot que d'etendre le type Database global.

## 8. Checklist de tests avant merge

- Email invalide -> erreur 400, aucun enregistrement cree.
- Consentement non coche -> erreur 400, bouton desactive cote client.
- Nouvelle inscription -> ligne creee, statut coherent avec Brevo.
- Reinscription d'un email deja desabonne -> statut repasse a
  subscribed/pending, unsubscribed_at remis a null, historique conserve.
- BREVO_API_KEY absente -> aucune exception, last_sync_status = 'skipped'.
- Echec API Brevo simule -> status = 'sync_failed', erreur loggee sans la cle.
- Desinscription via token valide -> contact supprime cote Brevo, historique
  conserve.
- Token expire/invalide -> message generique, aucune action DB.
- Webhook Brevo (hardBounce/spam/unsubscribe) -> statut local mis a jour ;
  secret manquant ou invalide -> 401.
- RLS : un utilisateur student ne peut pas lire/ecrire directement dans
  newsletter_subscribers.
- /admin/newsletter : filtres, export CSV, resync, lien Brevo, staff only.
- /profil : case jamais cochee par defaut.
- Formulaire accessible au clavier, messages annonces, responsive mobile.
- npm run lint, npx tsc --noEmit, npm run build passent sans erreur.
