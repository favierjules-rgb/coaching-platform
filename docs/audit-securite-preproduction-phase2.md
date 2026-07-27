# Audit de sécurité pré-production — seconde passe

**Branche** `audit/security-final` · **Date** 27/07/2026 · **Périmètre** dépôt, API, RLS Supabase (production, lecture seule), en-têtes, journalisation, dépendances, variables d'environnement.

Aucune modification n'a été apportée. Aucune écriture Supabase. Aucun déploiement. Stripe non touché.

---

## Synthèse

| Niveau | Nombre | Constats |
|---|---|---|
| **Critical** | 0 | — |
| **High** | 3 | H-1 magiclink via `session_id`, H-2 rate limit contournable, H-3 coach = admin côté API |
| **Medium** | 5 | M-1 privilèges `anon`, M-2 secret webhook en query string, M-3 buckets sans limites, M-4 `next` vulnérable, M-5 `exercise_library` publique |
| **Low** | 6 | L-1 à L-6 |
| **Faux positifs** | 4 | signalés en fin de rapport |

Les correctifs de la passe précédente (C-1, H-1 rate limit, H-2 guards, H-3 fuite d'annuaire, M-4 en-têtes) sont **en place et vérifiés** en production. Aucun n'a régressé.

---

## Ce qui est solide

Avant les problèmes, ce qui a résisté à l'examen :

- **Aucun secret** dans les fichiers suivis ni dans les 174 commits de l'historique. Aucun `.env` n'a jamais été committé ; `.gitignore` couvre `.env*` avec exception explicite pour `.env.example`.
- **Webhook Stripe** (`app/api/stripe/webhook/route.ts`) : signature vérifiée sur le corps brut avant tout traitement, garde `livemode`, idempotence atomique avec reprise sur échec. Rien à redire.
- **RLS active sur les 44 tables**, 104 policies, aucune table sans RLS, aucune vue exposée. Les tables sensibles (`coach_notes`, `body_measurements`, `progress_photos`, `legal_consents`, `payments`, `stripe_payments`) sont toutes conditionnées par `current_student_id()` ou `is_coach_or_admin()`.
- **RPC atomiques** : les six fonctions `SECURITY DEFINER` exposées à `authenticated` vérifient toutes les droits en interne (`is_coach_or_admin()` et/ou `current_student_id()`), et toutes ont `search_path=public` figé.
- **Validation Zod** systématique en `.strict()`, params de route inclus ; erreurs sans stack trace ni détail interne.
- **Anti-énumération** sur `password-reset` et `newsletter/unsubscribe` (réponse identique que le compte existe ou non).

---

## High

### H-1 — Un `session_id` Stripe suffit à obtenir un lien de connexion au compte

**Fichier** `app/api/public/programs/checkout-status/route.ts:39-144` (génération lignes 131-143)

**Constat.** Cette route publique, sans authentification, accepte un `session_id` Stripe en paramètre d'URL et renvoie, si le paiement est abouti, un **magiclink Supabase à usage unique** (`linkData.properties.action_link`) qui connecte directement au compte de l'acheteur.

**Scénario d'exploitation.** Le `session_id` (`cs_live_...`) apparaît dans l'URL de retour Stripe : `/programmes/merci?session_id=cs_...`. Il se retrouve donc dans l'historique du navigateur, dans les journaux d'accès du CDN et de la plateforme, et potentiellement dans un presse-papier partagé ou une capture d'écran. Quiconque met la main dessus appelle :

```
GET /api/public/programs/checkout-status?session_id=cs_...
```

et reçoit un lien de connexion valide. Si le compte est neuf (`isNewAccount`, ligne 128), le lien redirige vers `/reinitialiser-mot-de-passe` : l'attaquant **définit lui-même le mot de passe**.

Aucune contrainte temporelle n'est appliquée : `stripe.checkout.sessions.retrieve` répond indéfiniment après le paiement, et la route régénère un magiclink neuf à chaque appel. Un `session_id` fuité des mois plus tard reste exploitable.

**Impact.** Prise de contrôle complète d'un compte élève : données de santé, mesures, photos de progression, historique de paiement.

**Atténuations réelles.** `cs_...` est à haute entropie et non devinable ; le rate limit `CHECKOUT_STATUS_IP` borne le bruteforce ; `Referrer-Policy: strict-origin-when-cross-origin` empêche la fuite du query string vers un tiers. Le vecteur suppose donc une fuite du `session_id`, pas une attaque à l'aveugle — c'est ce qui le maintient en High plutôt qu'en Critical.

**Correction recommandée.** Trois pistes, cumulables :

1. **Fenêtre temporelle** — refuser de générer un lien si `session.created` remonte à plus de quelques minutes. Le polling légitime dure moins d'une minute ; au-delà, renvoyer `{ ready: true }` sans `loginUrl` et laisser l'email de bienvenue prendre le relais.
2. **Consommation unique** — marquer le `session_id` comme « lien déjà délivré » (colonne dédiée ou `billing_events`) et ne jamais en émettre un second.
3. **Retirer le magiclink** — se contenter de `{ ready: true }` et rediriger vers `/connexion`. L'email de bienvenue contient déjà un lien de définition de mot de passe. C'est l'option la plus sûre, au prix d'un pas supplémentaire pour l'acheteur.

---

### H-2 — Le rate limit de quatre routes publiques est contournable par un en-tête HTTP

**Fichiers** `lib/newsletter/rate-limit.ts:69-75` (`getClientIp`), utilisé par `app/api/business-inquiry/route.ts:51`, `app/api/free-assessment/route.ts:53`, `app/api/newsletter/subscribe/route.ts:33`, `app/api/newsletter/unsubscribe/route.ts:18`

**Constat.** Deux systèmes de limitation coexistent depuis la passe précédente :

| | `lib/security/rate-limit.ts` | `lib/newsletter/rate-limit.ts` |
|---|---|---|
| Magasin | Upstash Redis, partagé | mémoire de l'instance |
| Production sans magasin | refuse (fail-closed) | continue |
| Source d'IP | `getTrustedClientIp` — ignore `X-Forwarded-For` en production | `getClientIp` — **fait confiance à `X-Forwarded-For`** |
| Routes | 4 routes programme/mot de passe | 4 routes formulaire/newsletter |

`getClientIp` lit `X-Forwarded-For` en premier, sans distinction d'environnement. Or cet en-tête est fourni par le client : sur Vercel, seul `x-vercel-forwarded-for` est fiable.

**Scénario d'exploitation.** Une boucle triviale :

```
POST /api/business-inquiry
X-Forwarded-For: 1.2.3.<n>
```

en incrémentant `n` à chaque requête. Chaque valeur ouvre un compteur neuf ; la limite n'est jamais atteinte. Même sans cette astuce, le compteur mémoire ne survit pas aux démarrages à froid ni au partage entre instances serverless — le fichier le reconnaît lui-même en commentaire (lignes 3-8), mais ce constat date d'avant la mise en place d'Upstash.

**Impact.** `business-inquiry` et `free-assessment` **envoient un email par requête** via Resend. Un attaquant peut donc : saturer la boîte de réception du coach, consommer le quota Resend, et surtout **dégrader la réputation d'expéditeur du domaine** — ce qui ferait ensuite tomber en spam les emails transactionnels légitimes (confirmations de rendez-vous, liens de mot de passe). Sur les routes newsletter, l'abus se répercute sur l'API Brevo et pollue la liste.

**Correction recommandée.** Basculer ces quatre routes sur `consumeRateLimit` + `getTrustedClientIp` de `lib/security/rate-limit.ts`, avec des règles dédiées dans `lib/security/rules.ts`. Le honeypot `website` déjà présent sur `business-inquiry` et `free-assessment` ne suffit pas : il n'arrête qu'un robot naïf.

---

### H-3 — Un compte `coach` dispose des mêmes pouvoirs qu'un administrateur sur toute l'API

**Fichiers** les dix routes `app/api/admin/**` — motif `if (role !== "admin" && role !== "coach")`, par exemple `app/api/admin/coaches/[coachId]/route.ts:32`, `app/api/admin/students/[studentId]/route.ts:33`, `app/api/admin/billing/payments/[id]/route.ts`

**Constat.** La passe précédente a introduit `public.is_admin()` précisément pour distinguer l'administrateur du coach au niveau SQL : un coach ne peut plus modifier un rôle. **La couche API n'a pas suivi.** Toutes les routes `/api/admin/*` traitent `coach` et `admin` de façon interchangeable.

**Scénario d'exploitation.** Un compte coach compromis — ou un collaborateur malveillant — peut :

- `DELETE /api/admin/coaches/[coachId]` → **supprimer le compte de l'administrateur principal** (fiche `coaches`, `profiles` et `auth.users`). La seule garde est `cannot_delete_self` : on ne peut pas se supprimer soi-même, mais rien n'empêche de supprimer l'autre ;
- `DELETE /api/admin/students/[studentId]` → suppression définitive d'un élève et de toutes ses données ;
- `DELETE /api/admin/billing/payments/[id]` et `/subscriptions/[id]` → effacer des traces comptables ;
- `POST /api/admin/coaches` → inviter d'autres collaborateurs.

**Impact.** Destruction de données et perte de contrôle du compte propriétaire, sans possibilité de restauration depuis l'application.

**Nuance importante.** Il peut s'agir d'un **choix produit assumé** : structure à un seul coach, collaborateurs de confiance. Le commentaire de `lib/supabase/coach-account-provisioning.ts:56-60` va dans ce sens (« sans incidence sur les droits réels »), mais ce commentaire est devenu inexact depuis l'introduction de `is_admin()`. À trancher avant correction.

**Correction recommandée, si l'asymétrie est souhaitée.** Réserver à `role === "admin"` les opérations destructrices ou structurantes : suppression d'un coach, création d'un coach, suppression d'un élève, suppression d'une ligne de facturation. Laisser le reste à `admin | coach`. Et mettre à jour le commentaire devenu faux.

---

## Medium

### M-1 — `anon` conserve INSERT, UPDATE et DELETE sur 43 tables

**Constat.** Relevé en production : seules `profiles` et `coaches` ont vu les privilèges d'`anon` révoqués (correctif de la passe précédente). Les 43 autres tables — dont `coach_notes`, `body_measurements`, `progress_photos`, `payments`, `legal_consents` — accordent encore à `anon` les quatre privilèges.

**Aucune fuite active** : la RLS bloque effectivement, aucune policy ne s'applique à `anon` sans condition d'authentification. C'est un défaut de **défense en profondeur**, pas une brèche ouverte.

**Scénario.** La sécurité repose sur une seule couche. Une future policy écrite `TO public` avec une condition incomplète devient immédiatement exploitable sans session — c'est exactement le scénario survenu avec `coaches_select_authenticated`, corrigé la semaine dernière.

**Correction recommandée.** `revoke insert, update, delete on all tables in schema public from anon;` puis `revoke select` table par table après audit des flux publics (`programs` et `exercise_library` doivent rester lisibles, voir M-5). À faire dans une migration testée localement, les policies restant la protection principale.

---

### M-2 — Le secret du webhook Brevo transite en paramètre d'URL

**Fichier** `app/api/brevo/webhook/route.ts:22-33`

**Constat.** L'authentification repose sur `?secret=<BREVO_WEBHOOK_SECRET>` dans l'URL, comparé par `provided === expected` (ligne 32).

Deux problèmes distincts :

1. **Le secret est journalisé partout** — journaux d'accès Vercel, journaux Brevo, tout intermédiaire réseau. Un paramètre d'URL n'est jamais confidentiel.
2. **Comparaison non constante en temps** et **aucun rate limit** sur la route : rien n'empêche un attaquant de tenter le secret en boucle.

**Impact.** Un attaquant disposant du secret peut désabonner, marquer en `bounced` ou `complained` n'importe quelle adresse connue de la table `newsletter_subscribers` (`handleEvent`, lignes 54-107). Impact limité à la newsletter — aucune donnée n'est exposée en lecture.

**Nuance.** Le commentaire (lignes 12-21) documente que **Brevo ne signe pas ses webhooks** et que le secret en query string est la méthode recommandée par l'éditeur. Le choix est donc contraint, pas négligent.

**Correction recommandée.** Conserver le mécanisme mais : comparer avec `crypto.timingSafeEqual`, ajouter une limite de fréquence par IP via `lib/security/rate-limit.ts`, et accepter en priorité le secret depuis un en-tête personnalisé si Brevo permet de le configurer.

---

### M-3 — Aucun bucket Storage n'a de limite de taille ni de type de fichier

**Constat (production).** Les cinq buckets — `banners`, `documents`, `program-covers`, `progress-photos`, `videos` — ont `file_size_limit = NULL` et `allowed_mime_types = NULL`.

**Scénario.** Un élève authentifié peut téléverser dans `progress-photos/<son_id>/` (policy `progress_photos_bucket_student_or_staff`) un fichier de n'importe quelle taille et de n'importe quel type. Coût de stockage non borné, et fichiers non maîtrisés (SVG, HTML) servis depuis le domaine Supabase.

**Impact.** Abus de stockage et de bande passante. Le risque XSS reste faible : le contenu est servi depuis `*.supabase.co`, hors origine de l'application.

**Correction recommandée.** Poser `file_size_limit` (par exemple 10 Mo pour les photos, 200 Mo pour les vidéos) et `allowed_mime_types` (`image/jpeg`, `image/png`, `image/webp` pour les photos ; `application/pdf` pour les documents). Configuration Supabase, aucune migration de code.

---

### M-4 — `next@16.2.10` cumule neuf vulnérabilités connues

**Constat.** `npm audit` : 4 high, 1 low. La correction est **non majeure** — `next@16.2.12`.

Parmi les avis concernant Next.js : contournement de middleware en App Router avec Turbopack, SSRF dans les Server Actions et les rewrites, confusion de cache sur les réponses avec corps, divulgation d'endpoints de Server Functions non authentifiés. S'y ajoutent `postcss` (lecture de fichier arbitraire via `sourceMappingURL`), `sharp` (quatre CVE libvips) et `brace-expansion` (DoS).

**Applicabilité au projet.** Le projet n'utilise **pas** de Server Actions ni de rewrites, ce qui écarte les avis SSRF les plus graves. La confusion de cache et le contournement de middleware restent pertinents. `postcss` et `brace-expansion` sont des dépendances de build, non exposées au trafic.

**Correction recommandée.** `npm install next@16.2.12`, puis relancer lint, TypeScript, les 28 suites de tests et le build. Mise à jour de correctif, risque de régression faible.

---

### M-5 — La bibliothèque d'exercices est lisible sans authentification

**Constat (production).** Policy `exercise_library_select_active` : `TO public`, `using (status = 'active')`. Aucune condition d'authentification.

**Scénario.** `GET /rest/v1/exercise_library?select=*` avec la seule clé `anon` (publique par nature, présente dans le bundle navigateur) renvoie toute la bibliothèque active : noms, descriptions, consignes, groupes musculaires, vidéos associées.

**Impact.** Aucune donnée personnelle. C'est le contenu métier du coach qui est exposé — sa valeur ajoutée, récupérable intégralement par un concurrent.

**Nuance.** C'est peut-être délibéré (catalogue de démonstration). C'est exactement le même motif que le défaut H-3 corrigé précédemment sur `coaches` : une policy `TO public` sans condition d'authentification. À trancher.

**Correction recommandée, si l'exposition n'est pas voulue.** Passer la policy en `to authenticated` et retirer le `SELECT` d'`anon` sur cette table.

---

## Low

| # | Constat | Fichier / objet | Recommandation |
|---|---|---|---|
| **L-1** | `INTERNAL_CRON_SECRET` utilisée mais absente de `.env.example` | `app/api/internal/cleanup-expired-accounts/route.ts:29` | Documenter. Sans elle, la route répond 401 (fail-closed, bon) mais **la suppression RGPD des comptes après 6 mois ne tourne jamais**, silencieusement — enjeu de conformité plus que de sécurité. |
| **L-2** | Adresses email des destinataires écrites dans les journaux d'erreur | `lib/email/send-transactional-email.ts:162,174` | Tronquer ou hacher l'adresse. Donnée personnelle conservée dans les journaux Vercel. |
| **L-3** | `is_coach_or_admin()` et `current_student_id()` exécutables par `anon` | production | Elles renvoient `false`/`NULL` sans session — aucune fuite. Incohérence avec `is_admin()`, dont `anon` a été révoqué. Révoquer par cohérence. |
| **L-4** | Policies en double sur `students` et `student_profiles` | production | Anciennes policies anglaises (« Admin and coach can read students ») coexistant avec les nouvelles. Conditions équivalentes, combinaison en OU, donc sans effet — mais source d'erreur à la maintenance. Supprimer les anciennes. |
| **L-5** | `NEXT_PUBLIC_APP_URL` déclarée deux fois dans `.env.example` (l. 61 et 106) ; `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` documentée mais jamais lue | `.env.example` | Nettoyer. |
| **L-6** | `Strict-Transport-Security` non déclaré explicitement | `next.config.ts:53-64` | Vercel l'ajoute en HTTPS, mais le rendre explicite protège d'un changement d'hébergeur. |

---

## Faux positifs — signalés pour éviter le travail inutile

1. **`function_search_path_mutable` sur `set_updated_at`** (advisor Supabase, WARN). Non exploitable : ni `anon` ni `authenticated` n'ont le privilège `CREATE` sur le schéma `public` (vérifié), condition nécessaire pour faire jouer un `search_path` mutable. À corriger par hygiène, sans urgence.

2. **`authenticated_security_definer_function_executable`** sur `create_appointment_atomic`, `cancel_appointment_atomic`, `reschedule_appointment_atomic`, `create_coach_event_atomic`, `update_coach_event_atomic` (advisor, WARN). L'exposition est **intentionnelle** et le contrôle d'accès est **interne à chaque fonction** — vérifié dans les corps : toutes commencent par `if not is_coach_or_admin() then raise exception 'calendar_not_allowed'` ou une variante incluant `current_student_id()`.

3. **`protect_profiles_role_column()` exécutable par `authenticated`** (advisor, WARN). C'est une fonction de trigger : l'appeler directement en RPC échoue (« can only be called as a trigger »). Révoquer reste propre, mais il n'y a rien à exploiter.

4. **`programs_select_public`** (`TO anon`, `is_public = true and status = 'actif'`). C'est le catalogue public des programmes, exposition voulue et nécessaire à la page `/programmes`.

Deux points volontairement **non listés comme défauts** :

- **CSP en `Report-Only`** — dette assumée et documentée dans `next.config.ts:105-120`, avec la procédure de bascule. À traiter, mais c'était une décision explicite, pas un oubli.
- **Absence de protection CSRF explicite** — les cookies Supabase sont `SameSite=Lax` et toutes les routes consomment du JSON via `request.json()`, ce qu'un formulaire HTML cross-origin ne peut pas produire sans déclencher un contrôle CORS préalable. Aucun en-tête CORS permissif n'est posé. La protection est structurelle ; l'expliciter par une vérification d'`Origin` sur les routes mutantes serait une ceinture supplémentaire, pas un correctif.

---

## Autre

**Protection contre les mots de passe compromis désactivée** (advisor Supabase). Supabase Auth peut refuser les mots de passe présents dans HaveIBeenPwned. Activation en une case à cocher dans le tableau de bord, aucun code. À faire avant la mise en production.

---

## Ordre de traitement suggéré

1. **H-1** — le seul chemin menant à une prise de contrôle de compte.
2. **M-4** — mise à jour de correctif, effort minimal.
3. **H-2** — unifier les deux systèmes de limitation.
4. **H-3** — après arbitrage produit sur le rôle des coachs.
5. **M-1, M-3, M-5** — durcissement de la base et du stockage.
6. **M-2, L-1 à L-6** — finitions.
