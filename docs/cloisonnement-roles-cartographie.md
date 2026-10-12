# Cloisonnement par rôle et par catégorie — cartographie

Branche `feat/cloisonnement-roles-collaborateurs`, partant de `85a76f8`
(état exact de la production : les quatre migrations P13-A y sont appliquées).

## Le constat de départ

**72 policies sur 48 tables** opposent encore `is_coach_or_admin()`, c'est-à-dire
aucun cloisonnement. Vérifié sur `students` :

    students_select_self_or_staff : (user_id = auth.uid()) OR is_coach_or_admin()
    students_delete_staff         : is_coach_or_admin()

N'importe quel compte coach peut donc lire, modifier et supprimer les élèves de
tous les coachs. P13-A n'avait traité que les 8 tables du cœur nutrition.

## Le modèle retenu

Trois rôles :

| rôle | portée élèves | catégories |
|---|---|---|
| `admin` | tous | toutes, plus l'administration |
| `coach` | ses élèves (`students.coach_id`) | toutes |
| `collaborateur` | ses élèves (`students.coach_id`) | celles que l'admin accorde |

Chaque catégorie accordée porte un niveau : **lecture** ou **écriture**.
`lecture` alimente le `USING` des policies, `écriture` le `WITH CHECK` —
la RLS sépare nativement les deux.

## La partition des 48 tables

Vérifiée en base : 48 tables à traiter, 48 cartographiées, aucune oubliée,
aucune inventée, aucun doublon.

### entrainement (15 tables)

La chaîne de propriété passe par `programs` :
`program_weeks → programs`, `workout_sessions → programs / program_weeks`,
`training_blocks → workout_sessions`, `workout_exercises → training_blocks`,
`training_prescriptions → training_blocks / workout_exercises`.

programs, program_weeks, workout_sessions, training_blocks, workout_exercises,
training_prescriptions, program_exercise_progression, program_review_flags,
exercise_library, session_templates, exercise_feedback, exercise_set_feedback,
workout_feedback, training_change_history, assignments

`exercise_library` et `session_templates` sont rattachées au coach
(`coach_id`), pas à l'élève : ce sont ses bibliothèques.

### suivi_eleve (12 tables)

students, student_profiles, body_measurements, custom_measurements,
weight_entries, progress_photos, coach_notes, activity_events, legal_consents,
documents, document_assignments, document_levels

### agenda_communication (12 tables)

appointments, appointment_email_logs, coach_availabilities,
coach_unavailabilities, booking_settings, email_logs, newsletter_subscribers,
notification_campaigns, notification_occurrences, notification_deliveries,
notification_campaign_targets, push_subscriptions

### nutrition (8 tables)

Déjà cloisonnées par P13-A — aucune n'apparaît dans les 48, elles ne portent
plus `is_coach_or_admin()`. Elles entrent néanmoins dans le modèle de
catégories : un collaborateur sans la catégorie `nutrition` ne doit pas y
accéder, même pour ses propres élèves.

### admin_seul (9 tables) — jamais accordable à un collaborateur

billing_customers, billing_events, payments, payment_entries, stripe_payments,
subscriptions, subscription_templates, coaches, profiles

Ce n'est pas une des quatre catégories demandées : c'est le complément. La
facturation et la gestion des comptes restent à l'administrateur seul, ce qui
est déjà la règle écrite dans `lib/api/authz.ts` (« le coach ne touche jamais
aux données de facturation globales », « le coach ne gère jamais globalement
les coachs »). Aucune case ne permettra de l'accorder.

## Deux points tranchés en cours de route

**`students` en lecture est un préalable, pas une catégorie.** Un collaborateur
nutrition qui ne verrait pas la fiche de ses élèves ne pourrait rien faire du
tout. La lecture de l'identité de ses élèves affectés est donc ouverte à tout
non-admin, quelle que soit sa catégorie ; l'écriture sur `students` et sur le
reste du suivi reste, elle, derrière `suivi_eleve`.

**Un élève n'a qu'un seul `coach_id`.** C'est la conséquence assumée du choix
« seulement les élèves affectés » : un collaborateur nutrition ne verra pas les
élèves rattachés à un autre coach. Si le besoin d'un spécialiste transversal
apparaît, il faudra une table d'affectation explicite — c'est une extension, pas
une correction.

## L'intégration applicative (11/10/2026)

La RLS ne protège que ce qui passe par PostgreSQL. Trois couches ont été
alignées sur le même modèle, sans qu'aucune ne remplace les autres.

### 1. `lib/api/authz.ts`

`profiles.role` reste `admin | coach | student`. Le rôle fin est lu dans
`coaches.role`, par `fichesStaff()`, au service role — comme le faisait déjà
`requireStaffForStudent`, pour que le verdict de l'API ne dépende pas des
policies en vigueur.

| Garde | admin | assistant | collaborateur |
| --- | --- | --- | --- |
| `requireAdmin()` | passe | 403 | 403 |
| `requireStaff()` | passe | passe | **403** |
| `requireStaffForStudent(id)` | passe | `students.coach_id` | **403** |
| `requireStaffForStudent(id, {categorie, niveau})` | passe | `students.coach_id` | affectation **et** permission |

Deux points qui ne vont pas de soi :

- **Une route qui ne déclare aucune catégorie refuse le collaborateur.**
  L'absence d'exigence n'est pas un laissez-passer : facturation, Stripe et
  création de compte ne sont couverts par aucune des quatre catégories.
  Les routes concernées portent le commentaire correspondant, et
  `authz-hardening` échoue si une catégorie y réapparaît.
- **`estCollaborateur` regarde TOUTES les fiches, y compris inactives.** La
  fiche de *portée* est l'active (mêmes critères que `current_staff_id()` :
  `status = 'actif'`, tri `created_at, id`), mais si le rôle n'était lu que
  sur l'active, passer une fiche à `inactif` ferait repasser son titulaire
  pour « staff sans fiche », donc pour un coach autonome. Retirer un statut
  serait devenu une élévation de privilège.

La catégorie exigée par `/api/email/content-assigned` suit **le contenu
attribué** (`programme → entrainement`, `nutrition → nutrition`,
`document → suivi_eleve`), et non la route : un collaborateur nutrition ne
notifie pas une attribution d'entraînement.

### 2. L'interface d'administration

`components/admin/CollaborateurAccesModal.tsx`, ouverte depuis la section
« Coachs » de `/admin/parametres` pour les seules fiches
`role = 'collaborateur'`. Elle écrit les deux tables du modèle par un client
de **session** (`lib/supabase/collaborateurs.ts`) : le refus est rendu par les
policies `collaborateur_*_manage_admin` (`is_admin()`), vérifié en base — un
collaborateur qui tente de s'accorder une catégorie ou de s'affecter un élève
reçoit `42501`. Aucune route service role n'a été ajoutée : elle aurait
contourné précisément la policy qui protège ces tables.

« Aucun accès » n'est jamais écrit : c'est la suppression de la ligne. Une
catégorie absente s'affiche comme telle, sans valeur par défaut, et tout refus
déclenche un rechargement — l'écran ne montre jamais un droit qui n'a pas été
enregistré.

### 3. L'identité staff côté navigateur

Un collaborateur **ne peut pas lire sa propre ligne `coaches`** : la policy la
réserve à l'administrateur, et le contrôle B6 de la checklist vérifie qu'il y
compte zéro ligne. `hooks/useStaffContext.ts` et `hooks/useCurrentCoachId.ts`
passent donc par `public.staff_role()` et `public.current_staff_id()`
(SECURITY DEFINER, `execute` à `authenticated` seul), qui ne renvoient que
l'identité de l'appelant. Tant que les migrations ne sont pas appliquées, ces
fonctions sont absentes : les hooks renvoient `null`, traité comme
« inconnu » — jamais comme une autorisation.

### 4. La navigation de l'espace admin

`lib/admin-shell-nav.ts::sectionAdminVisible` — fonction pure, testée sans DOM
dans `scripts/tests/admin-shell-nav.mts`. La catégorie de chaque section est
déduite des TABLES qu'elle lit, telles que la migration les range :

| Section | Catégorie | Table de référence |
| --- | --- | --- |
| `/admin` | accueil | point d'entrée, tuiles filtrées par la RLS |
| `/admin/eleves` | `suivi_eleve` | `students`, `coach_notes` |
| `/admin/programmes`, `/exercices`, `/seances` | `entrainement` | `programs`, `workout_sessions` |
| `/admin/calendrier` | `agenda_communication` | `appointments` |
| `/admin/nutrition` | `nutrition` | `nutrition_plans` |
| `/admin/documents` | les trois ci-dessus | `documents`, routés par `category` |
| `/admin/retours` | `entrainement` | `workout_feedback` |
| `/admin/paiements`, `/abonnements`, `/emails`, `/notifications`, `/newsletter`, `/parametres` | aucune | `payments`, `email_logs`, `notification_campaigns`, `newsletter_subscribers`, `coaches` |

Les six dernières ne sont pas un oubli : leurs tables opposent
`est_staff_global()` ou `is_admin()`, qui ne sont vrais pour aucun
collaborateur. Leur liste de catégories est VIDE, et une liste vide signifie
« jamais visible pour un collaborateur ». Une section ajoutée demain et oubliée
dans la table est traitée de la même façon — c'est le refus par défaut.

`/admin/notifications` mérite un mot : son nom évoque la communication, mais
elle administre `notification_campaigns`, en `est_staff_global()`. La catégorie
`agenda_communication` ouvre les rendez-vous d'un élève affecté, pas le centre
de campagnes de l'application.

Trois cas ne sont PAS traités comme des refus :
l'administrateur (reconnu par `profiles.role`, donc jamais dépendant d'une
fonction P13-B), l'assistant, et l'état « fonctions P13-B introuvables »
(migrations non appliquées) — qui conserve la navigation d'avant P13-B. Un
collaborateur dont les permissions ne peuvent pas être lues n'a, lui, que
l'accueil.

⚠️ Ce masquage ne protège rien : il rend l'interface honnête. Les refus réels
restent ceux de la RLS et de `lib/api/authz.ts`.

## La quatrième migration : le cœur nutrition (11/10/2026)

`supabase/migrations/20261011120000_p13b_integration_nutrition.sql`.

Les trois premières migrations ne suffisaient pas, et c'était mesurable : un
collaborateur `nutrition / ecriture` explicitement affecté obtenait **zéro
plan**. Les huit tables du cœur n'opposaient pas les ensembles du modèle mais
ceux de PROPRIÉTÉ de P13-A (`nutrition_plan_ids_geres()` →
`is_coach_of_student()` → `students.coach_id`), qu'un collaborateur ne vaut
jamais — par construction, puisque le coach principal ne change pas.

**Pourquoi de nouvelles fonctions.** `nutrition_plan_ids_geres()` est un
ensemble UNIQUE, opposé en lecture comme en écriture par des policies
`FOR ALL`. Y ajouter la portée du collaborateur aurait accordé l'écriture avec
la lecture, donc rendu le niveau `lecture` inopérant. Les anciennes fonctions
ne sont ni modifiées ni supprimées — elles restent la définition de la
propriété pour `food_lists`, `nutrition_recipes` et `can_manage_*`. Dix
fonctions neuves portent la portée PAR NIVEAU, et les 32 policies du cœur sont
scindées en quatre par table.

**Ce qu'aucune catégorie n'ouvre** : le plan MODÈLE (sans élève, donc hors de
toute affectation — réservé à `est_staff_global()`, et un collaborateur pouvait
même en créer avant) ; la SUPPRESSION du plan d'un élève (permise à aucun
coach, seul l'administrateur) ; le catalogue personnel du coach (`food_lists`,
`food_catalog`, `nutrition_recipes` — tables de propriété) ; le JOURNAL écrit
par l'élève (les huit RPC `SECURITY DEFINER` sont gardées par
`current_student_id()`, NULL pour un collaborateur) ; les cinq tables
dépendantes, qui restent en lecture seule même au niveau `ecriture`.

### Le défaut révélé au passage : `coaches.role` avait pour défaut `'admin'`

En intégrant la nutrition, la checklist P13-A est passée à 22 contrôles rouges,
tous de la famille « le coach B ne lit pas le plan de l'élève de A ». La cause
n'était pas dans la nutrition : `coaches.role` avait pour DÉFAUT `'admin'`, et
P13-B faisait de cette étiquette un pouvoir (`student_ids_portee()` ouvrait
tous les élèves dès `staff_role() = 'admin'`). Toute fiche créée sans rôle
explicite — la checklist P13-A le fait, et toute ligne de production antérieure
au formulaire d'ajout aussi — devenait donc administrateur de cabinet.

Deux correctifs, les deux dans la 4ᵉ migration : le défaut passe à
`'assistant'` (aucune ligne existante réécrite — un DEFAULT ne vaut que pour
les insertions futures), et les droits GLOBAUX suivent désormais
`public.is_admin()`, c'est-à-dire `profiles.role = 'admin'`, la définition de
l'administrateur dans tout le reste du dépôt. Une fiche `coaches.role = 'admin'`
dont le profil est `coach` redevient ce qu'elle était avant P13-B : un coach
autonome borné à ses élèves.
