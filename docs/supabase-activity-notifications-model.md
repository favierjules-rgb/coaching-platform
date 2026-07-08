# Centre d'activité / notifications internes Supabase

Chantier "supabase-activity-notifications" : journal interne des actions
importantes des élèves, visible par le coach/admin (`/admin`, centre
d'activité) et sur la fiche élève (`/admin/eleves/[studentId]`, historique
récent). Pas de push notification ni d'email pour cette V1 — notifications
internes uniquement, comme demandé.

## Audit

Aucune table `activity_events`/équivalente n'existait. Le panneau
"Notifications (exemple)" de `/admin` et `coachNotifications` côté élève
(`components/student/DashboardContent.tsx`, `data/student.ts`) sont des
fonctionnalités mock distinctes et non liées (messages coach → élève, pas
un journal d'activité élève → coach) — non modifiées par ce chantier.

## Modèle de données

Une seule table nouvelle, exactement comme proposé :

```sql
create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students (id) on delete cascade,
  actor_type text not null default 'system' check (actor_type in ('student', 'coach', 'system')),
  event_type text not null,
  title text not null,
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
```

`event_type` (11 valeurs) : `onboarding_completed`, `weight_added`,
`workout_feedback_submitted`, `nutrition_log_filled`, `appointment_booked`,
`appointment_cancelled`, `document_assigned`, `document_viewed`,
`program_assigned`, `nutrition_assigned`, `coach_note_added`.

`metadata` contient `{ link: "/admin/eleves/<studentId>" }` pour chaque
évènement — le "lien direct vers l'élève" demandé ; toujours disponible
(contrairement à un lien profond par contenu, qui aurait demandé un
constructeur d'URL différent pour chacun des 10 types d'évènement).

## RLS

```sql
create policy "activity_events_manage_staff" on public.activity_events
  for all using (is_coach_or_admin()) with check (is_coach_or_admin());
create policy "activity_events_insert_own_student" on public.activity_events
  for insert with check (student_id = current_student_id());
```

Le centre d'activité est **staff-only en lecture** — un élève ne peut ni
lire ni marquer un évènement comme lu, seulement créer un évènement pour
lui-même (les actions déclenchées côté client élève : onboarding, poids,
retour entraînement, suivi nutrition, réservation/annulation de
rendez-vous). Un élève ne peut jamais créer un évènement pour un autre élève
(`student_id = current_student_id()`).

## Points de journalisation — 9/10 branchés, 1 volontairement absent

Toutes les fonctions d'écriture Supabase existantes ont été localisées par
audit (aucune nouvelle table/fonction dupliquée) et une journalisation
best-effort (`logActivityEvent`, jamais bloquante, jamais d'exception) a été
ajoutée à la fin de chacune :

| Source demandée | Fonction | Fichier |
|---|---|---|
| Onboarding complété | `submitOnboarding` | `lib/supabase/onboarding.ts` |
| Poids ajouté | `addWeightEntry` (hors source `initial`, déjà couverte par l'onboarding) | `lib/supabase/students.ts` |
| Retour entraînement envoyé | `saveWorkoutFeedback` | `lib/supabase/workout-feedback.ts` |
| Suivi nutrition rempli | `upsertNutritionDailyLog` | `lib/supabase/nutrition-logs.ts` |
| Rendez-vous réservé | `createAppointment` | `lib/supabase/appointments.ts` |
| Rendez-vous annulé | `cancelAppointment` | `lib/supabase/appointments.ts` |
| Document assigné | `setDocumentAssignment` (uniquement à l'assignation, pas au retrait) | `lib/supabase/documents.ts` |
| Programme assigné | `setProgramAssignment` (idem) | `lib/supabase/programs.ts` |
| Nutrition assignée | `setNutritionAssignment` (idem) | `lib/supabase/nutrition.ts` |
| Note coach ajoutée | `addCoachNoteSupabase` | `lib/supabase/students.ts` |

**Document consulté — volontairement non implémenté.** Audit confirmé :
`document_assignments.viewed_at` existe en base et dans les types générés
mais n'est écrit nulle part dans le code actuel (aucun bouton "Voir le
document" ne le renseigne). Implémenter ce suivi serait un chantier séparé
(ajouter l'écriture de `viewed_at` elle-même) — hors scope ici, conformément
à l'instruction "si déjà suivi". Le type `document_viewed` reste défini
dans `ActivityEventType` pour brancher l'évènement dès que ce suivi existera,
sans nouvelle migration.

`createAppointment`/`cancelAppointment` acceptent désormais un `actorType`
optionnel (`"student"` par défaut ou `"coach"`) pour distinguer une
réservation élève d'une création manuelle admin — les deux pages appelantes
(`/admin/calendrier`, `/rendez-vous`) ont été mises à jour en conséquence.

## Composition

- `lib/supabase/activity.ts` : `logActivityEvent` (insertion best-effort),
  `getRecentActivityEvents` (centre d'activité admin, 200 dernières lignes),
  `getActivityEventsForStudent` (historique d'une fiche élève, 30 dernières),
  `markActivityEventRead`, `buildStudentActivityLink`.
- `hooks/useSupabaseActivity.ts` : centre d'activité admin
  (`loading/events/refetch/markRead`).
- `hooks/useSupabaseStudentDetail.ts` : étendu avec `activityEvents` (chargé
  en parallèle du reste de la fiche élève, même `refetch`).
- `components/admin/ActivityFeed.tsx` : liste réutilisable (icône par type
  d'évènement, horodatage relatif, lien vers la fiche élève, bouton "Marquer
  comme lu" si `onMarkRead` fourni) — utilisée à la fois par le centre
  d'activité (`showFilter` : Non lues/Toutes) et par l'historique élève
  (sans filtre, déjà pré-filtré par `student_id`).

## Pages modifiées

- `/admin` : nouvelle section "Centre d'activité" (entre "Notifications
  (exemple)", inchangée, et "Élèves à suivre").
- `/admin/eleves/[studentId]` : nouvelle section "Historique récent" (élèves
  Supabase réels uniquement, `isSupabaseStudent`), entre "Retours récents"
  et "Charge d'entraînement de l'élève".

## Limites

- **Pas de push/email** — notifications internes uniquement, comme demandé.
- **Document consulté non tracké** — voir ci-dessus, dépend d'un chantier
  séparé pour écrire réellement `viewed_at`.
- **Vérification live non effectuée** : connecteur Supabase MCP indisponible
  pour ce chantier — migration non rejouée, aucune insertion/lecture réelle
  testée. `npm run lint`, `npx tsc --noEmit` et `npm run build` sont passés
  sans erreur ; chacun des 10 points de journalisation a été relu ligne à
  ligne contre son appelant réel (audité avant implémentation).
