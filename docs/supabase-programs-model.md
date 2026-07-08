# Modèle Supabase programmes/séances

Ce document fixe le modèle utilisé pour la migration des programmes
d'entraînement mockés vers de vrais programmes Supabase.

## Décision : aucune nouvelle table

`supabase/schema.sql` contenait déjà, avant cette étape, les tables cibles
entièrement conçues (sections 10-14 et 25) : `programs`, `program_weeks`,
`workout_sessions`, `workout_exercises`, `exercise_library`, `assignments`
(association contenu ↔ élève, `content_type` = `"programme"` ou
`"nutrition"`) — RLS comprise. Elles n'avaient simplement jamais été
branchées à l'application (`types/supabase.ts` ne les décrivait pas, et il
n'existait aucune couche `lib/supabase/*`).

Vérifié en direct sur le projet Supabase avant toute migration :
- les 6 tables existent bien, colonnes et policies RLS identiques à
  `supabase/schema.sql` (aucune dérive) ;
- toutes vides (0 lignes) avant cette étape ;
- `get_advisors` ne remonte que des avertissements préexistants sans lien
  avec ces tables.

Aucune migration DDL n'a donc été nécessaire pour cette étape.

## Portée volontairement exclue : `exercise_library`

La banque d'exercices (`/admin/programmes` → onglet "Banque d'exercices")
reste en mock/localStorage. Sa forme mock (`category`/`equipment`/`level`
typés, `tags`, `technicalNote`/`coachInstructions` séparés) diverge de la
table réelle (colonnes texte libres, pas de `tags`) et ce n'est qu'un outil
de préremplissage dans `ProgramBuilder` : les exercices choisis sont copiés
par valeur dans `workout_exercises`, jamais référencés par clé étrangère.
Migrer cette banque est un chantier séparé, indépendant de la présente
étape.

## Composition vers les types existants

- **Admin** : `lib/supabase/programs.ts` compose les lignes Supabase en
  `AdminProgram` / `AdminWorkoutSession` / `AdminExercise` (types mock déjà
  utilisés par `ProgramBuilder` et tout `/admin/programmes`), pour que ces
  composants n'aient rien à changer.
- **Élève** : les pages `/entrainement` utilisent historiquement un jeu de
  types différent (`TrainingProgram` / `WorkoutSession` / `ProgramScheduleDay`,
  voir `data/student.ts`), pensé pour un planning hebdomadaire répété plutôt
  que pour une structure semaine par semaine. `lib/training-schedule.ts`
  fait la conversion `AdminProgram` → ces types élève (semaine "actuelle"
  calculée à partir de la date de début de suivi de l'élève, comme déjà
  fait côté admin dans `/admin/eleves/[studentId]`), pour que
  `TrainingProgramCard`, `NextSessionHighlight`, `ProgramWeekCalendar` et
  `WeekAnalysisSection` n'aient rien à changer non plus.

## Assignation

`useAdminData().setAssignment` (mock, synchronise `assignedStudentIds` sur
le contenu et `assignedProgramIds` sur l'élève) reste utilisé tel quel pour
les élèves/programmes mock. `hooks/useProgramAssignment.ts` route vers
`setProgramAssignment` (écriture réelle dans `assignments`) uniquement
quand le programme **et** l'élève affichés sont tous les deux réels ; sinon
il retombe sur le mock. Ça débloque le point bloquant identifié avant cette
étape : `assignments.content_id` est un `uuid not null`, donc inutilisable
tant que les programmes étaient mockés (ids du type `"adm-prog-masse"`) —
résolu maintenant que de vrais programmes ont de vrais `uuid`.

`lib/supabase/students.ts::toAdminStudent` peuple désormais
`assignedProgramIds` depuis la vraie table `assignments` (auparavant
toujours `[]`), via `getAssignedProgramIdsByStudent`.

## `workout_feedback.session_id` / `program_id`

Avant cette étape, ces deux colonnes (déjà présentes, nullable) restaient
toujours `null` : la séance était identifiée uniquement via `session_key`
(id mock stable en texte). `SessionFeedbackSection` détermine maintenant si
`sessionId`/`programId` sont de vrais `uuid` (voir `lib/uuid.ts::isUuid`) et
les transmet à `saveWorkoutFeedback`, qui les écrit dans les colonnes FK
réelles — tout en continuant à écrire `session_key` dans tous les cas
(retro-compatible avec les retours déjà envoyés sur des séances mock).

## Vérification RLS (sans exposer d'identifiants réels)

Les policies RLS ont été vérifiées en simulant des rôles Postgres
(`set local role authenticated` + `set_config('request.jwt.claims', …)`)
plutôt qu'en automatisant une connexion avec un mot de passe réel :

- élève assigné → lit son programme/séances/exercices assignés ;
- élève non assigné → ne lit rien (0 ligne) ;
- élève → peut écrire son propre `workout_feedback`/`exercise_feedback`/
  `exercise_set_feedback`, avec `session_id`/`program_id` réels ;
- élève non lié → ne voit aucun retour d'un autre élève ;
- admin → lit tous les programmes, peut modifier un statut (`programs_manage_staff`).
