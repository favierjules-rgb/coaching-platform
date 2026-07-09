# Progression / analytics élève

Chantier "supabase-student-progress-analytics" : vue progression complète
pour chaque élève, admin (`/admin/eleves/[studentId]/progression`) et élève
(`/progression`), basée exclusivement sur les données Supabase réelles déjà
en place.

## Audit — aucune nouvelle table, aucune nouvelle policy RLS

Toutes les données nécessaires existaient déjà et étaient déjà lisibles par
l'élève concerné (policies `*_student_or_staff` / `*_select_own_student`
posées par les chantiers précédents — poids, mensurations, retours
entraînement, suivi nutrition, rendez-vous, activité). Ce chantier est
**purement applicatif** : aucune modification de `supabase/schema.sql`,
aucune nouvelle table, aucune nouvelle policy.

Composants/fonctions déjà existants réutilisés (jamais dupliqués) :

| Donnée | Fonction déjà existante | Fichier |
|---|---|---|
| Identité, poids, mensurations, photos | `getFullAdminStudent` | `lib/supabase/students.ts` |
| Historique poids (forme graphique) | `getWeightHistory` | `lib/supabase/students.ts` |
| Graphique poids | `<WeightChart />` | `components/student/WeightChart.tsx` |
| Retours entraînement | `getWorkoutFeedbackForStudent` | `lib/supabase/workout-feedback.ts` |
| Parsing charge/reps pour tonnage réalisé | `parseLoad`, `getEffectiveLoadKg`, `getAverageReps` | `lib/training-metrics.ts` |
| Programme assigné (dénominateur assiduité) | `getAssignedProgramForStudent` | `lib/supabase/programs.ts` |
| Plan nutrition assigné | `getAssignedNutritionPlanForStudent` | `lib/supabase/nutrition.ts` |
| Logs nutrition semaine | `getNutritionLogsForDates`, `getCurrentWeekDates` | `lib/supabase/nutrition-logs.ts`, `lib/nutrition-weekly.ts` |
| Rendez-vous | `getAppointmentsForStudent` | `lib/supabase/appointments.ts` |
| Activité récente | `getActivityEventsForStudent` | `lib/supabase/activity.ts` |

## `lib/supabase/progress.ts` — les 6 fonctions demandées

Fichier d'agrégation neuf, qui ne fait qu'orchestrer les fonctions
ci-dessus (aucune requête SQL nouvelle en dehors de deux petites lectures
directes — `weight_entries.recorded_at`/`weight_kg` pour les deltas 7j/30j,
et le dernier `nutrition_daily_logs.log_date` — déjà couvertes par les
mêmes policies) :

- `getStudentProgressSummary(supabase, studentId)` — résumé global (section 1).
- `getStudentWeightProgress(supabase, studentId)` — poids + deltas 7j/30j/total + mensurations brutes (section 2/3).
- `getStudentWorkoutAnalytics(supabase, studentId)` — volume/tonnage/séries/RPE moyen réalisés + progression par exercice (section 4).
- `getStudentNutritionAnalytics(supabase, studentId)` — moyennes/écart hebdo (section 5).
- `getStudentAppointmentStats(supabase, studentId)` — réalisés/annulés/à venir (section 6).
- `getStudentRecentActivity(supabase, studentId)` — alias explicite sur `getActivityEventsForStudent`, pour respecter le nom de fonction demandé sans dupliquer la logique.

Chaque fonction reste indépendamment appelable (comme demandé), même si
certaines rechargent des données déjà lues par une autre (ex : `getFullAdminStudent`
est appelé à la fois par `getStudentProgressSummary` et `getStudentWeightProgress`)
— volume par élève faible, page appelée une fois par visite, jamais en
boucle : simplicité choisie plutôt que micro-optimisation prématurée.

## Calculs

- **Volume/tonnage réalisés** : contrairement à `calculatePlannedVsActualMetrics`
  (qui compare une séance planifiée précise à ses retours), l'agrégat de la
  page progression somme directement chaque `AdminExerciseFeedbackEntry`
  (une ligne = une série réellement effectuée) sur tout l'historique, via
  `getAverageReps`/`parseLoad`/`getEffectiveLoadKg` déjà utilisés ailleurs —
  cohérent avec le tonnage déjà affiché sur `/entrainement`.
- **Progression par exercice** : regroupe les séries réalisées par nom
  d'exercice, garde les 4 exercices les plus fréquents, trace la charge
  maximale par date. Une charge non chiffrable (poids du corps, machine
  sans valeur saisie) est signalée explicitement plutôt qu'ignorée
  silencieusement.
- **Taux d'assiduité** : `séances avec retour complété / séances planifiées
  dans le programme assigné (toutes semaines confondues)`. Simplification
  assumée — compare au nombre total de séances planifiées sur toute la
  durée du programme, pas seulement "jusqu'à aujourd'hui" (calcul exact
  nécessiterait de dater chaque semaine du programme, hors scope) ; `null`
  si aucun programme n'est assigné (pas de dénominateur).
- **Nutrition** : moyennes calculées uniquement sur les jours réellement
  remplis de la semaine courante (`nutrition_daily_logs`), jamais sur les 7
  jours si certains sont vides.

## Règles respectées

- **Jamais de donnée inventée** : chaque section affiche "Aucune donnée
  disponible pour le moment." si la table correspondante est vide pour cet
  élève — vérifié pour poids, mensurations, entraînement, nutrition (pas de
  plan / pas de log cette semaine), rendez-vous.
- **Élève limité à ses propres données** : `useSupabaseMyProgress` résout
  l'id élève via `getCurrentStudentId` (utilisateur connecté), jamais un id
  passé en paramètre — un élève ne peut techniquement pas demander les
  données d'un autre (RLS `current_student_id()` sur toutes les tables
  sources). `activity_events` n'est **pas** chargé côté élève (staff-only en
  lecture, RLS déjà en place — voir chantier centre d'activité) ; mensurations
  détaillées non plus, conformément à "le coach voit plus de détails que
  l'élève" (liste élève explicite de la demande : poids, objectif, séances,
  nutrition semaine, rendez-vous, progression générale, photos).
- **Pas de chantier photo** : les photos existantes sont affichées en
  lecture seule côté élève si `imageUrl` est déjà résolu (aucune génération
  d'URL signée, aucun upload) — reporté à une prochaine PR comme demandé.
  `progress_photos` n'a reçu aucune modification.
- **Pas d'export avant/après ni PDF** — hors scope de cette PR (précisé en
  cours de chantier), reporté à une étape suivante.

## Graphiques

Aucune nouvelle dépendance graphique : réutilisation de `<WeightChart />`
(SVG déjà existant) pour le poids, et un nouveau `<CaloriesWeekChart />`
(barres CSS pures, `components/shared/CaloriesWeekChart.tsx`) pour les
calories de la semaine — les deux exposent un résumé textuel systématique à
côté du graphique (valeurs chiffrées, jamais uniquement visuel).

## Accessibilité

- Titres `h1`/`h2` cohérents sur les deux pages (`h1` page, `h2` par
  section).
- Chaque carte statistique a un label textuel visible, jamais seulement une
  icône ou une couleur (les icônes ajoutées portent `aria-hidden="true"`).
- `CaloriesWeekChart` porte `role="img"` avec un `aria-label` résumant le
  contenu ; les groupes de statistiques portent `role="list"` +
  `aria-label`.
- Écarts au-dessus de l'objectif nutrition signalés par texte ("+X%") en
  plus de la couleur ambre — jamais la couleur seule.
- Focus visible : aucun style personnalisé ne retire l'outline par défaut
  dans les nouveaux composants.

## Pages modifiées

- `/admin/eleves/[studentId]` : bouton "Progression" (élèves Supabase réels
  uniquement) vers la nouvelle page.
- `/admin/eleves/[studentId]/progression` (nouveau) : les 7 sections
  demandées (résumé, poids, mensurations, entraînement, nutrition,
  rendez-vous, activité récente).
- `/progression` (nouveau, élève, lien sidebar "Progression") : résumé,
  poids, entraînement (sans le détail des derniers retours, déjà visible
  sur `/entrainement`), nutrition semaine, rendez-vous, photos existantes.

## Limites

- **Vérification live non effectuée** : connecteur Supabase MCP
  indisponible pour ce chantier — `npm run lint`, `npx tsc --noEmit` et
  `npm run build` sont passés sans erreur ; comportement de garde vérifié
  (redirection `/connexion` pour requête non authentifiée sur les deux
  nouvelles routes, identique aux autres pages). Aucune insertion/lecture
  réelle testée contre les 6 fonctions de `lib/supabase/progress.ts`.
- **Taux d'assiduité** simplifié (voir Calculs ci-dessus).
- **Photos** : lecture seule, sans génération d'URL signée si les photos
  sont stockées via `storagePath` plutôt que `imageUrl` direct — cohérent
  avec "ne pas faire le chantier photo ici".
