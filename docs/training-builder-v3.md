# Training Builder V3 — Running / Fullscreen

Chantier réalisé en 5 étapes validées séparément (branche
`training-builder-v3-running-fullscreen`, jamais mergée sur `main` —
voir section PR en bas de document). Ce document couvre l'ensemble du
chantier ; les décisions structurantes de chaque étape sont datées pour
qu'on retrouve facilement pourquoi une chose a été faite ainsi.

## Étape 1 — Fondations cardio + profil physio

### Audit préalable

Avant toute migration, vérifié en direct sur le projet Supabase que
`training_blocks` et `training_prescriptions` existaient déjà (créées sur
une branche `training-builder-v2` antérieure, jamais mergée) mais
n'étaient documentées nulle part dans `supabase/schema.sql` ni dans les
migrations de cette branche. Ce chantier les a reprises et étendues plutôt
que d'en recréer de nouvelles.

### Modèle de données (`20260716_training_v3_cardio_foundation.sql`)

- `workout_sessions.session_type` (`'strength' | 'cardio' | 'mixed'`,
  défaut `'strength'`) : distingue une séance musculation d'une séance
  cardio ou mixte.
- `training_blocks` : un bloc par séance (musculation ou cardio,
  `block_type`), avec pour le cardio `cardio_type` (21 valeurs : footing,
  fractionné VMA, tempo, côtes, test Luc Léger...) et `machine_type`
  (tapis, vélo, rameur...).
- `training_prescriptions.exercise_id` rendu nullable, ajout de `block_id`,
  `parent_prescription_id`, `segment_type`. Contrainte
  `training_prescriptions_exercise_or_block_check` :
  `exercise_id is not null or block_id is not null` — une ligne est soit
  une prescription musculation (exercise_id renseigné), soit un segment
  cardio (block_id renseigné, exercise_id null).
- `student_profiles` : ajout de `vma_kmh`, `hr_max`, `hr_resting`,
  `ftp_watts`, `reference_paces` (jsonb), `last_fitness_test_date`,
  `fitness_test_protocol` — profil physio de l'élève, préparé pour de
  futures conversions personnalisées vitesse/allure/%VMA.
- `diffProgramStructure` (`lib/supabase/programs.ts`) remplace le
  delete+reinsert complet utilisé jusque-là par `updateProgram` : les
  semaines/séances sont diffées par (`week_number`) et (`semaine`, `day`),
  les exercices diffés par `id`. Motivation : le delete+reinsert cassait
  `workout_feedback.session_id` (`ON DELETE SET NULL`) et aurait supprimé
  tout bloc/prescription cardio à chaque sauvegarde du coach.

### Limite déjà connue à cette étape

Garmin/Apple Watch/Strava : uniquement des champs de préparation
(`reference_paces`, `fitness_test_protocol`...), aucune intégration réelle
— hors périmètre demandé.

## Étape 2 — Builder plein écran + grille 7 jours

Nouvelle route `/admin/programmes/[programId]/builder`
(`ProgramBuilderFullscreen`), indépendante de la page de détail existante
(`/admin/programmes/[programId]`, restée un aperçu lecture seule).
`AdminShell` détecte cette route par pattern d'URL pour retirer
sidebar/menu. Grille 7 jours (`DayGridCell`) par semaine, sélection d'une
case pour éditer la séance correspondante (`DayCard`, repris de
`ProgramBuilder.tsx`).

## Étape 3 — Blocs cardio, segments, conversions VMA

- Éditeur de blocs cardio et de leurs segments dans `DayCard`
  (`CardioBlockRow`/`CardioSegmentRow`, `components/admin/ProgramBuilder.tsx`) :
  un segment `single`/`ramp_up`/`ramp_down` décrit un effort continu, un
  `repeat_group` décrit un fractionné répété N fois (effort puis
  récupération).
- `lib/cardio.ts` : labels (`cardioTypeLabels`, `machineTypeLabels`,
  `cardioSegmentTypeLabels`, `intensityTargetTypeLabels`) et conversions
  VMA → vitesse → allure (`speedFromVmaPercentage`,
  `paceSecondsFromSpeedKmh`, `segmentIntensityPreview`). L'aperçu vitesse/
  allure du builder utilise un **VMA de référence saisi par le coach au
  moment de la construction** (jamais persisté, uniquement un outil d'aide
  à la rédaction) — pas le VMA réel de chaque élève assigné, qui peut
  différer.
- Persistance : `insertCardioBlocks`/`diffProgramStructure` remplacent en
  bloc (delete + reinsert) les blocs cardio d'une séance à chaque
  sauvegarde, contrairement au diff fin des exercices — décision
  documentée dans le code (`lib/supabase/programs.ts`) : rien ne référence
  encore un bloc/segment cardio par id (pas de retour élève dessus), donc
  le problème qui a motivé le diff fin des exercices ne se pose pas ici.

## Étape 4 — Drag-and-drop, modèles de séances, duplication

- Réordonnancement par glisser-déposer (HTML5 DnD natif, poignées
  `GripVertical`) pour les exercices et les segments cardio ; flèches
  haut/bas conservées pour l'accessibilité clavier.
- Banque de séances réutilisables (`session_templates`, voir
  `20260716_training_v3_session_templates.sql`) : "Enregistrer comme
  modèle" / "Utiliser un modèle" dans `DayCard`. Contenu (exercices + blocs
  cardio) stocké en `jsonb`, copié par valeur à l'application — jamais
  référencé par clé étrangère depuis un programme.
- Glisser-déposer d'une case à l'autre de la grille (`ProgramBuilderFullscreen`)
  pour échanger le contenu éditable de deux séances (nom, exercices, blocs
  cardio...), en gardant `id`/`day`/`weekNumber`/`programId` ancrés à leur
  case — compatible tel quel avec le diff par (semaine, jour) de
  `diffProgramStructure`.
- `duplicateProgram` (`lib/supabase/programs.ts`) : duplique un programme
  complet en un nouveau brouillon "{nom} (copie)", régénère tous les ids
  (séances/exercices/blocs cardio), ne copie jamais les élèves assignés.

## Étape 5 — Realtime, correction RLS, affichage cardio élève

### RLS — bug trouvé et corrigé (`20260716_training_v3_realtime_rls.sql`)

`training_prescriptions_select_assigned_student` (créée sur l'ancienne
branche V2, jamais revue depuis) ne couvrait que le chemin musculation :

```sql
exists (
  select 1 from workout_exercises e
  join workout_sessions s on s.id = e.session_id
  join programs p on p.id = s.program_id
  join assignments a on a.content_type = 'programme' and a.content_id = p.id
  where e.id = training_prescriptions.exercise_id
    and a.student_id = current_student_id()
    and p.publication_status = 'published'
)
```

Comme un segment cardio a `exercise_id` null (`block_id` renseigné à la
place, voir contrainte étape 1), cette condition échoue toujours pour ces
lignes : **un élève ne pouvait jamais lire ses propres segments cardio**,
alors même que la lecture des blocs parents (`training_blocks`) était déjà
correcte. Corrigé en ajoutant un second `OR EXISTS` reprenant exactement
le schéma de jointure de `training_blocks_select_assigned_student` :

```sql
or exists (
  select 1 from training_blocks b
  join workout_sessions s on s.id = b.session_id
  join programs p on p.id = s.program_id
  join assignments a on a.content_type = 'programme' and a.content_id = p.id
  where b.id = training_prescriptions.block_id
    and a.student_id = current_student_id()
    and p.publication_status = 'published'
)
```

Vérifié en simulant des rôles Postgres (`set local role authenticated` +
`request.jwt.claims`, même méthode que `docs/supabase-programs-model.md`),
**puis** en conditions réelles via un client Supabase authentifié (session
générée pour le compte élève de test via l'API admin Auth, sans jamais
manipuler de mot de passe réel) :
- élève assigné → lit désormais son segment cardio (`exercise_id` bien
  `null`, confirmant que l'ancienne policy l'aurait exclu) ;
- utilisateur non assigné (id arbitraire) → 0 ligne.

### Realtime (`ALTER PUBLICATION supabase_realtime ADD TABLE programs, workout_sessions`)

Aucune table n'était enregistrée dans `supabase_realtime` avant cette
étape (vérifié via `pg_publication_tables`). Périmètre volontairement
limité à `programs` et `workout_sessions` : `diffProgramStructure` fait
toujours un `UPDATE workout_sessions` pour chaque séance existante à
chaque sauvegarde du coach, même quand seuls les exercices ou les blocs
cardio de cette séance changent — écouter ces deux tables suffit donc à
détecter tout changement pertinent pour l'élève, sans descendre au niveau
exercice/segment cardio.

`hooks/useSupabaseTrainingProgram.ts` expose désormais `refetch` et
souscrit (une fois les programmes assignés connus) à `postgres_changes`
sur `programs` (filtré `id=in.(...)`) et `workout_sessions` (filtré
`program_id=in.(...)`), avec un debounce de 500ms pour coalescer les
rafales d'événements d'une même sauvegarde en un seul rechargement.
Nettoyage (`removeChannel`) à chaque changement de liste de programmes ou
au démontage.

Vérifié de bout en bout (pas seulement lu le code) : une session Supabase
réelle pour le compte élève de test a été établie via l'API admin Auth
(génération d'un lien magique, jamais de mot de passe manipulé), un canal
Realtime souscrit avec cette session, puis une écriture `UPDATE` déclenchée
côté service (simulant une sauvegarde coach) — l'événement `UPDATE` est
bien arrivé sur le canal élève en quelques secondes.

### Affichage cardio élève

Jusqu'ici, `toEleveWorkoutSession` (`lib/training-schedule.ts`) ignorait
`sessionType`/`cardioBlocks` : même une fois la RLS corrigée, aucune UI
élève n'affichait de contenu cardio.

- `types/index.ts` : `WorkoutSession` (élève) gagne les mêmes champs
  optionnels `sessionType`/`cardioBlocks` que `AdminWorkoutSession`, en
  réutilisant directement les types admin (`SessionType`,
  `AdminCardioBlock`) plutôt que de les dupliquer.
- `components/student/CardioBlocksSection.tsx` (nouveau) : affichage
  lecture seule des blocs et segments cardio d'une séance, intégré dans
  `app/(student)/entrainement/seance/[sessionId]/page.tsx` (branche
  Supabase uniquement — la branche mock/legacy n'a pas cette structure).
- Résumés "X blocs cardio" ajoutés à `ProgramWeekCalendar` et
  `NextSessionHighlight` (au lieu de "0 exercices" pour une séance 100%
  cardio), même convention que `DayGridCell` côté admin
  (`sessionType !== "cardio"` pour l'affichage exercices,
  `sessionType !== "strength"` pour l'affichage blocs cardio).
- `lib/cardio.ts` : nouveaux formateurs `formatDurationSeconds`,
  `formatDistanceMeters`, `formatIntensityTargetRaw`.

**Choix de scope volontaire** : l'affichage montre les valeurs **telles
qu'authored par le coach** (ex : "70% VMA", "12.0 km/h", "Zone Z2"), sans
calculer de vitesse/allure personnalisée à partir du VMA réel de l'élève
(`student_profiles.vma_kmh`, préparé en étape 1 mais jamais lu par aucun
code applicatif à ce jour — confirmé par recherche dans `lib/supabase/`).
Brancher cette conversion personnalisée est un chantier séparé, plus
large que "corriger le RLS + construire l'affichage élève" tel que validé
pour cette étape.

## Modèle de données — vue d'ensemble

| Table | Rôle | RLS élève |
|---|---|---|
| `programs` | Programme, `status` (app) / `publication_status` (RLS, voir Limites) | `programs_select_assigned_student` |
| `program_weeks` | Semaine d'un programme | via `workout_sessions` |
| `workout_sessions` | Séance (jour, type, durée...) | `workout_sessions_select_assigned_student` |
| `workout_exercises` | Exercice musculation d'une séance | (pas de policy élève dédiée trouvée — lecture via jointure applicative uniquement) |
| `training_blocks` | Bloc musculation ou cardio d'une séance | `training_blocks_select_assigned_student` |
| `training_prescriptions` | Prescription musculation (`exercise_id`) ou segment cardio (`block_id`) | `training_prescriptions_select_assigned_student` (corrigée étape 5) |
| `session_templates` | Banque de séances réutilisables (coach) | pas de lecture élève (usage coach uniquement) |
| `assignments` | Association programme ↔ élève | `student_id = current_student_id()` |

## Pages/fichiers modifiés (étape 5 uniquement)

- `supabase/migrations/20260716_training_v3_realtime_rls.sql` (nouveau)
- `hooks/useSupabaseTrainingProgram.ts`
- `types/index.ts`
- `lib/training-schedule.ts`
- `lib/cardio.ts`
- `components/student/CardioBlocksSection.tsx` (nouveau)
- `components/student/ProgramWeekCalendar.tsx`
- `components/student/NextSessionHighlight.tsx`
- `app/(student)/entrainement/seance/[sessionId]/page.tsx`

## Limites connues (honnêtes, pas corrigées dans ce chantier)

- **`programs.publication_status` vs `programs.status`** : deux colonnes
  distinctes. Les policies RLS élève (`programs_select_assigned_student`,
  `workout_sessions_select_assigned_student`, et maintenant
  `training_prescriptions_select_assigned_student`) filtrent sur
  `publication_status = 'published'`, mais **aucun code applicatif actuel
  n'écrit jamais cette colonne** (seul `status`, ex. `'brouillon'`/
  `'actif'`, est géré par `createProgram`/`updateProgram`). Son défaut
  (`'published'`, NOT NULL) fait qu'un nouveau programme créé via l'app
  satisfait toujours la policy, indépendamment de son vrai `status`.
  Aucun trigger ne synchronise les deux colonnes (vérifié via
  `pg_trigger`). Hérité de l'ancienne branche V2 (workflow de publication/
  versions plus ambitieux, jamais terminé) — redesigner ça demande une
  décision produit hors du périmètre de ce chantier.
- **Conversion VMA personnalisée côté élève** : non branchée (voir étape
  5 ci-dessus) — l'affichage montre les valeurs brutes du coach.
- **Garmin / Apple Watch / Strava** : champs de préparation uniquement
  (étape 1), aucune intégration réelle demandée ni construite.
- **Pas de framework de tests automatisé** dans ce projet (confirmé via
  `package.json` : ni jest, ni vitest, ni playwright/cypress). Toute la
  vérification de ce chantier (étapes 1 à 5) a été faite manuellement :
  `npx tsc --noEmit`, `npm run lint`, tests en direct dans le navigateur
  et via requêtes SQL contre le vrai projet Supabase, avec nettoyage
  systématique des données de test créées.
- **`workout_exercises`** : aucune policy RLS élève dédiée n'a été trouvée
  sur cette table lors de l'audit de cette étape — la lecture élève passe
  par la composition applicative (`lib/supabase/programs.ts`), pas
  vérifiée indépendamment ici puisque hors du périmètre demandé
  (RLS cardio + Realtime programs/workout_sessions).

## PR (à ouvrir manuellement — rien n'est mergé automatiquement)

Branche : `training-builder-v3-running-fullscreen`, poussée sur GitHub,
non mergée sur `main`. Pas de template de PR dans ce repo.

**Titre suggéré** : `Training Builder V3 — cardio, plein écran, Realtime + RLS`

**Description suggérée** :

> Refonte du module Entraînement (Training Builder) en 5 étapes validées
> séparément :
> 1. Fondations cardio (blocs/segments/VMA) + profil physio élève + diff
>    fin de sauvegarde de programme.
> 2. Builder plein écran avec grille 7 jours.
> 3. Éditeur de blocs cardio/segments + conversions VMA→vitesse→allure
>    (aperçu coach uniquement).
> 4. Drag-and-drop (exercices, segments, échange de séances), banque de
>    séances réutilisables, duplication de programme.
> 5. Correction RLS (élève peut désormais lire ses segments cardio),
>    Realtime (l'élève voit les mises à jour du coach sans recharger la
>    page), affichage cardio côté élève.
>
> Voir `docs/training-builder-v3.md` pour le détail complet, y compris les
> limites connues (non corrigées volontairement, hors périmètre).
>
> Aucune intégration Garmin/Apple Watch/Strava réelle (champs de
> préparation uniquement). Pas de tests automatisés (aucun framework dans
> ce projet) — vérifications manuelles documentées dans le fichier
> ci-dessus.
