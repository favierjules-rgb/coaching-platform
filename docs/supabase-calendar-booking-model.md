# Calendrier / réservation Supabase (type Calendly)

Chantier "supabase-calendar-booking-system" : système de réservation réel
pour que les élèves réservent des créneaux disponibles auprès du coach —
disponibilités récurrentes, indisponibilités ponctuelles, réservation,
confirmation, invitation `.ics`, annulation/report, affichage admin + élève.

## Audit

- **Repo** : aucune occurrence de calendar/appointments/bookings/
  availability/schedule/events/reminders liée à un système de rendez-vous
  (seul `ProgramWeekCalendar.tsx`, sans rapport — calendrier d'entraînement
  existant). Aucun mock à reprendre ou à ne pas casser sur ce périmètre.
- **Supabase réel** : aucune table calendrier/rendez-vous n'existait — 5
  tables nouvelles (`coach_availabilities`, `coach_unavailabilities`,
  `appointments`, `appointment_email_logs`, `booking_settings`), toutes
  `create table if not exists`.
- **Identifiants** : `appointments.student_id` référence `students(id)`
  (jamais `profiles.id`/`auth.users.id`/`student_profiles.id`), même
  convention que `assignments`/`workout_feedback`/`documents`.
- **coach_id** : le projet n'a jamais de vrai modèle multi-coach actif —
  `programs.coach_id`/`nutrition_plans.coach_id`/`exercise_library.coach_id`
  existent tous mais ne sont **jamais renseignés à l'écriture** (confirmé en
  lisant `lib/supabase/programs.ts`, `nutrition.ts`, `exercise-library.ts` —
  aucun ne passe `coach_id` à l'insert). Toutes les policies RLS "staff"
  utilisent `is_coach_or_admin()` (rôle) et jamais une comparaison de
  `coach_id` précis. `coach_availabilities.coach_id`/`coach_unavailabilities.coach_id`/
  `appointments.coach_id` suivent la même convention : colonne nullable, FK
  vers `coaches(id)` pour rester cohérente avec l'existant, jamais renseignée
  par l'app. L'organisateur affiché dans les invitations `.ics`/emails est la
  première fiche `coaches` (`getPrimaryCoachInfo`), pas une session "coach
  connecté" — cohérent avec le reste de l'app (espace staff partagé unique).

## Modèle de données

Toutes les tables sont neuves (aucune table existante réutilisée/dupliquée,
puisque rien n'existait) :

```sql
coach_availabilities   -- plages récurrentes : weekday (0 dimanche..6 samedi,
                        -- JS Date#getDay()), start_time, end_time,
                        -- slot_duration_minutes, appointment_type, location,
                        -- is_active
coach_unavailabilities -- exceptions ponctuelles : start_at, end_at, reason
appointments           -- student_id, coach_id, title, description,
                        -- appointment_type, start_at, end_at, timezone,
                        -- location, meeting_url, status (pending/confirmed/
                        -- cancelled/completed/no_show), cancellation_reason,
                        -- rescheduled_from_id, calendar_event_id, ics_uid
appointment_email_logs -- traçabilité des tentatives d'envoi (voir Email)
booking_settings       -- ligne singleton : min_lead_minutes, max_days_ahead,
                        -- default_duration_minutes
```

`appointments.status` : un rendez-vous `cancelled` libère immédiatement le
créneau (règle du chantier — non bloquant pour de nouvelles réservations).
Seuls `pending`/`confirmed` bloquent un créneau.

## RLS

- `coach_availabilities`/`coach_unavailabilities`/`booking_settings` :
  lecture par tout utilisateur authentifié (l'élève doit calculer les
  créneaux disponibles côté client), écriture réservée au staff
  (`is_coach_or_admin()`) — même principe que `document_levels`.
- `appointments` : staff accès complet (`for all`) ; élève limité à
  `student_id = current_student_id()` en lecture, création et modification
  (la modification n'est utilisée côté UI que pour l'annulation — RLS ne
  restreint pas les colonnes modifiables, seulement la ligne, même
  convention que `body_measurements`/`workout_feedback`).
- `appointment_email_logs` : staff uniquement, jamais exposé à l'élève.

## Calcul des créneaux disponibles

`lib/booking.ts::computeAvailableSlots` — fonction pure, sans accès réseau :
pour chaque jour de `today` à `today + max_days_ahead`, génère les créneaux
de chaque disponibilité active correspondant au jour de la semaine, exclut
ceux qui chevauchent une indisponibilité ou un rendez-vous déjà réservé
(`pending`/`confirmed`), et ceux situés avant `now + min_lead_minutes`.
`lib/supabase/appointments.ts::getAvailableSlots` charge les 4 entrées
nécessaires (disponibilités, indisponibilités, réglages, rendez-vous déjà
réservés dans la fenêtre) et appelle cette fonction.

**Fuseau horaire** : toutes les dates sont manipulées en heure locale
d'exécution (navigateur), considérée comme Europe/Paris — aucune
bibliothèque de fuseaux horaires dans le projet (`date-fns-tz`/`luxon`
absents de `package.json`). Même limite déjà assumée ailleurs dans l'app
(`ADMIN_REFERENCE_DATE`, `computeDocumentAvailability`). `appointments.timezone`
stocke `'Europe/Paris'` par défaut pour la traçabilité, sans conversion
réelle. À revoir si des élèves dans un autre fuseau utilisent l'app.

## Invitation calendrier (.ics)

`lib/ics.ts` génère un fichier `.ics` RFC 5545 sans dépendance externe :
`buildConfirmationIcs` (`METHOD:REQUEST`, `STATUS:CONFIRMED`) et
`buildCancellationIcs` (même `UID`, `SEQUENCE` incrémentée, `METHOD:CANCEL`,
`STATUS:CANCELLED`). Horaires formatés en UTC (`Z`) à partir de l'instant
absolu stocké en base plutôt qu'un bloc `VTIMEZONE` complet — plus simple et
interprété correctement par Apple Calendar/Google Calendar/Outlook (chacun
convertit vers le fuseau local à l'affichage). `ics_uid` est généré à la
création du rendez-vous (`crypto.randomUUID()@seth-coaching`) et stocké en
base pour rester stable à travers les mises à jour.

Le bouton "Télécharger l'invitation calendrier (.ics)" (admin et élève,
`components/*/AppointmentCard.tsx`) fonctionne indépendamment de l'envoi
d'email — voir `lib/ics.ts::downloadIcsFile`.

## Email

**Aucun provider n'était configuré dans le repo** (audit : aucune occurrence
de Resend/SendGrid/nodemailer/SMTP). `lib/email/appointment-emails.ts`
prépare l'intégration sans bloquer le chantier :

- `sendAppointmentConfirmationEmail`/`sendAppointmentCancellationEmail`/
  `sendAppointmentRescheduleEmail` composent sujet/corps (format demandé :
  "Confirmation de rendez-vous — [type] — [date]", corps avec date/heure/
  durée/lieu ou lien visio/coach) et le `.ics` correspondant, puis appellent
  `dispatchEmail`.
- `dispatchEmail` journalise toujours la tentative dans
  `appointment_email_logs` (`status: 'not_configured'`) et retourne
  `sent: false` — **pour brancher un vrai envoi**, remplacer uniquement le
  corps de cette fonction par un appel Resend/SendGrid, ou par l'invocation
  d'une Supabase Edge Function dédiée (recommandé pour garder la clé API
  côté serveur, jamais exposée au client browser). Le reste du fichier
  (composition du contenu, `.ics`, journalisation) n'a pas à changer.
- Aucune action de l'UI ne dépend du succès de l'envoi : la réservation, la
  confirmation, l'annulation et le report fonctionnent entièrement sans
  email réel — seul le téléchargement `.ics` manuel remplace la pièce jointe
  tant qu'aucun provider n'est branché.

## Google Calendar / Apple Calendar

- **Apple Calendar** : couvert par le `.ics` (téléchargement ou pièce jointe
  email) — aucune limite supplémentaire, ouverture directe.
- **Google Calendar** : le `.ics` fonctionne déjà (import manuel). Une
  intégration OAuth Google Calendar (création directe de l'événement dans le
  calendrier du coach, `calendar_event_id` déjà prévu en base pour stocker
  l'id de l'événement Google une fois créé) est **volontairement hors scope**
  de cette PR — complexité (flux OAuth, refresh token, stockage sécurisé)
  disproportionnée pour ce chantier. Prochaine étape documentée mais non
  implémentée.
- **CalDAV/iCloud direct** : non implémenté, gardé pour plus tard comme
  demandé.

## Composition

- `lib/booking.ts` : calcul pur des créneaux disponibles.
- `lib/ics.ts` : génération `.ics` + téléchargement navigateur.
- `lib/email/appointment-emails.ts` : abstraction d'envoi (voir Email).
- `lib/supabase/appointments.ts` : CRUD disponibilités/indisponibilités/
  réglages/rendez-vous, composition vers `AdminAppointment`/
  `CoachAvailability`/`CoachUnavailability`/`BookingSettings`, création/
  annulation/report, notifications (best-effort, n'affecte jamais le succès
  de l'action principale).
- `hooks/useSupabaseAppointments.ts` (admin, toutes les données) et
  `hooks/useSupabaseAppointmentsForStudent.ts` (élève, `ready/active/…` même
  forme que `useSupabaseStudentDocuments`).

## Pages / composants

- `/admin/calendrier` (nouveau, lien sidebar "Calendrier") : onglets
  "Rendez-vous" (aujourd'hui / à venir / historique, création manuelle,
  annulation, report, téléchargement `.ics`) et "Disponibilités" (plages
  récurrentes, exceptions, réglages de réservation).
- `/rendez-vous` (nouveau, élève, lien sidebar "Rendez-vous") : réservation
  par créneau (filtré par jour), rendez-vous à venir/anciens, annulation,
  téléchargement `.ics`, lieu/lien visio.
- `/dashboard` (élève) : carte "Prochain rendez-vous" ajoutée, visible
  seulement si un compte élève réel est identifié (même garde `active` que
  documents/nutrition/entraînement).
- `/admin` : stat card "Rendez-vous aujourd'hui" + action rapide "Voir le
  calendrier", sans section supplémentaire (pour ne pas surcharger, comme
  demandé).

## Limites

- **Email réel non branché** — voir section Email ci-dessus, documenté et
  non bloquant.
- **OAuth Google Calendar non implémenté** — `.ics` uniquement pour cette
  PR, `calendar_event_id` prêt pour une future intégration.
- **Fuseau horaire** : heure locale d'exécution uniquement, pas de vraie
  gestion multi-fuseau (voir section Calcul des créneaux).
- **Annulation élève** : autorisée à tout moment (pas de délai minimum avant
  annulation), politique volontairement simple — RLS ne restreint pas les
  colonnes modifiables par l'élève sur `appointments` (seulement la ligne),
  cohérent avec le reste du projet.
- **Vérification live non effectuée** : connecteur Supabase MCP indisponible
  au début de cette session (reconnecté en cours de session, mais aucune
  exécution SQL/lecture réelle n'a été tentée pour ce chantier au moment de
  la rédaction de ce document) — `npm run lint`, `npx tsc --noEmit` et
  `npm run build` sont passés sans erreur ; le flux complet (disponibilité →
  créneaux → réservation → email/`.ics` → annulation/report → affichage
  admin/élève) a été relu ligne à ligne contre les 21 tests demandés.
